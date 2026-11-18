// Followed organisations (C10): the app looks at an organiser's public page at most twice a day and queues any new events.
// One request per check where the page lists its events as structured data; otherwise a few event pages are read one by one.
import { z } from "zod";
import { db } from "./db";
import { allJsonLdEvents, eventLinks, guessCategory, normaliseUrl, platformOf, type Draft } from "./extract";
import { safeFetch, FetchRefused, checkUrl } from "./safefetch";
import { existingBySource, ingest, readLink, SubmitSchema, type ReadResult } from "./submit";
import { fetchImage } from "./images";
import { reviewEvent, reviewWaiting } from "./review";
import { linkSeries } from "./dedupe";
import { geocodeEvent } from "./geocode";

export type Org = { id: number; name: string; page_url: string; platform: string | null; trusted: number; city_id: number | null;
  last_checked: number | null; last_result: string | null; last_error: string | null; city_name?: string | null };

export const MIN_GAP_MS = 12 * 3600e3;      // scheduled checks: at most twice a day per organisation
export const MANUAL_GAP_MS = 10 * 60e3;     // "Check now": at most every 10 minutes
const MAX_NEW_PER_CHECK = 12;

const AddSchema = z.object({
  page_url: z.string().trim().url().max(500), name: z.string().trim().max(80).optional(),
  city_id: z.number().int().positive().nullable().optional(), trusted: z.boolean().optional(),
});

export function listOrgs(): Org[] {
  return db().prepare("SELECT o.*, c.name AS city_name FROM orgs o LEFT JOIN cities c ON c.id = o.city_id ORDER BY o.name").all() as Org[];
}

export function addOrg(input: unknown): { ok: boolean; message?: string; id?: number } {
  const p = AddSchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Enter the full link to the organiser's page, starting with https://" };
  let url: string;
  try { url = normaliseUrl(checkUrl(p.data.page_url).toString()); } catch (e) { return { ok: false, message: (e as Error).message }; }
  const name = p.data.name || new URL(url).pathname.split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ").replace(/\s*\d{6,}$/, "") || new URL(url).hostname;
  try {
    const r = db().prepare("INSERT INTO orgs (name, page_url, platform, trusted, city_id) VALUES (?, ?, ?, ?, ?)")
      .run(name.slice(0, 80), url, platformOf(url), p.data.trusted ? 1 : 0, p.data.city_id ?? null);
    return { ok: true, id: r.lastInsertRowid };
  } catch { return { ok: false, message: "You're already following that page." }; }
}
export function setTrusted(id: number, on: boolean) { return db().prepare("UPDATE orgs SET trusted = ? WHERE id = ?").run(on ? 1 : 0, id).changes === 1; }
export function removeOrg(id: number) { return db().prepare("DELETE FROM orgs WHERE id = ?").run(id).changes === 1; }

export type Deps = {
  fetchPage: (url: string) => Promise<{ status: number; html: string }>;
  read: (url: string) => Promise<ReadResult>;
  image: (url: string) => Promise<string | null>;
  now: () => Date;
};
const live: Deps = {
  fetchPage: async (url) => { const r = await safeFetch(url); return { status: r.status, html: r.body.toString("utf8") }; },
  read: readLink, image: fetchImage, now: () => new Date(),
};

export type CheckResult = { ok: boolean; added: number; message: string };

export async function checkOrg(id: number, opts: { manual?: boolean; deps?: Partial<Deps> } = {}): Promise<CheckResult> {
  const d = { ...live, ...opts.deps };
  const org = db().prepare("SELECT * FROM orgs WHERE id = ?").get(id) as Org | undefined;
  if (!org) return { ok: false, added: 0, message: "That organisation isn't on the list." };
  const nowMs = d.now().getTime();
  const gap = opts.manual ? MANUAL_GAP_MS : MIN_GAP_MS;
  if (org.last_checked && nowMs - org.last_checked < gap) return { ok: true, added: 0, message: "Checked recently. Try again a little later." };
  const done = (ok: boolean, added: number, message: string): CheckResult => {
    db().prepare("UPDATE orgs SET last_checked = ?, last_result = ?, last_error = ? WHERE id = ?").run(nowMs, ok ? message : null, ok ? null : message, id);
    return { ok, added, message };
  };
  let html: string;
  try {
    const r = await d.fetchPage(org.page_url);
    if (r.status === 403 || r.status === 429) return done(false, 0, "That site isn't letting the app check this page. Share its events by link instead.");
    if (r.status >= 400) return done(false, 0, `The page couldn't be opened (error ${r.status}). It will be tried again later.`);
    html = r.html;
  } catch (e) {
    return done(false, 0, e instanceof FetchRefused ? e.message : "The page couldn't be reached. It will be tried again later.");
  }
  let added = 0, seen = 0;
  const take = async (draft: Partial<Draft>, source: string | null, image: string | null) => {
    if (!draft.title || !draft.start_local) return;
    const parsed = SubmitSchema.safeParse({
      ...draft, image, source, description: draft.description?.slice(0, 2000) ?? null,
      organiser: draft.organiser ?? org.name, category: draft.category ?? guessCategory(`${draft.title} ${draft.description ?? ""}`) ?? "social",
    });
    if (!parsed.success) return; // page data we can't trust as an event: skip it
    const out = ingest(parsed.data, { origin: "org", orgId: org.id, cityId: org.city_id, now: d.now() });
    if (out.status !== "queued") return;
    added++;
    await settle(out.id, org);
  };
  // 1) events the page lists as structured data (one request in total)
  for (const ev of allJsonLdEvents(html)) {
    if (added >= MAX_NEW_PER_CHECK) break;
    seen++;
    const source = ev.url ? normaliseUrl(ev.url) : null;
    if (source && existingBySource(source)) continue;
    const { url: _u, ...draft } = ev;
    await take(draft, source, draft.image_url ? await d.image(draft.image_url) : null);
  }
  // 2) otherwise, links on the page that look like event pages
  if (seen === 0) {
    for (const link of eventLinks(html, org.page_url)) {
      if (added >= MAX_NEW_PER_CHECK) break;
      seen++;
      if (existingBySource(link)) continue;
      const r = await d.read(link).catch(() => null);
      if (r?.status === "ok") await take(r.draft as Partial<Draft>, r.source ?? link, r.image);
    }
  }
  if (seen === 0) return done(true, 0, "No events found on that page. Some sites hide their listings from apps.");
  return done(true, added, added ? `${added} new event${added === 1 ? "" : "s"} found.` : "Nothing new.");
}

/** A trusted organisation's events go live by themselves, except dating events (S-043, S-094). Everything else gets the AI review. */
async function settle(eventId: number, org: Org) {
  const e = db().prepare("SELECT category, city_id, online FROM events WHERE id = ? AND status = 'pending'").get(eventId) as { category: string; city_id: number | null; online: number } | undefined;
  if (!e) return;
  if (org.trusted && e.category !== "dating" && (e.city_id || e.online) &&
      !(db().prepare("SELECT 1 x FROM dupe_flags WHERE event_b = ? AND resolved = 0").get(eventId))) {
    db().prepare(`UPDATE events SET status = 'approved', auto_approved = 1, review_by = 'org', review_note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(`From ${org.name}, which you trust.`, eventId);
    linkSeries(eventId);
    void geocodeEvent(eventId).catch(() => null);
    return;
  }
  await reviewEvent(eventId).catch(() => null);
}

/** Check every organisation that's due. One failing never stops the rest (S-044). */
export async function checkDue(deps?: Partial<Deps>): Promise<number> {
  let n = 0;
  for (const o of listOrgs()) {
    try { const r = await checkOrg(o.id, { deps }); n += r.added; } catch { /* next one */ }
  }
  return n;
}

const g = globalThis as unknown as { __orgTimer?: ReturnType<typeof setInterval> };
export function startOrgChecks() {
  if (g.__orgTimer) return;
  g.__orgTimer = setInterval(() => { void checkDue().catch(() => null); void reviewWaiting().catch(() => null); }, 30 * 60e3);
  setTimeout(() => { void reviewWaiting().catch(() => null); }, 10e3).unref?.();
  g.__orgTimer.unref?.();
  setTimeout(() => { void checkDue().catch(() => null); }, 60e3).unref?.();
}
