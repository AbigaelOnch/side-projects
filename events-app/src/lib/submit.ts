// One-step sharing (C5–C7): read a link or flyer into a draft, then take the (possibly edited) draft into the review queue.
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { DraftSchema, firstUrl, fromJsonLd, guessCategory, normaliseUrl, openGraph, pageText, platformOf, splitIso, type Draft } from "./extract";
import { ClaudeUnavailable, readWithClaude } from "./claude";
import { FetchRefused, safeFetch } from "./safefetch";
import { BadImage, fetchImage, saveImage } from "./images";
import { listCities, type City } from "./events";
import { zonedToUtc } from "./time";

export const DEFAULT_TZ = process.env.DEFAULT_TZ || "America/Los_Angeles";

export type ReadResult =
  | { status: "ok"; draft: Partial<Draft>; image: string | null; source: string | null; platform: string | null; note?: string }
  | { status: "already"; eventId: number; title: string }
  | { status: "need_screenshot"; message: string; source: string }
  | { status: "not_event"; message: string }
  | { status: "unreachable"; message: string }
  | { status: "error"; message: string };

const today = () => new Date().toISOString().slice(0, 10);

function claudeNote(e: ClaudeUnavailable): string {
  return e.reason === "credit" ? "Claude credit has run out" : e.reason === "invalid" ? "Claude key is invalid" :
    e.reason === "missing" ? "Claude key missing" : "Claude didn't respond";
}

export function existingBySource(url: string): { id: number; title: string; status: string } | undefined {
  return db().prepare(`SELECT e.id, e.title, e.status FROM event_sources s JOIN events e ON e.id = s.event_id
    WHERE s.url = ? AND e.status IN ('approved','pending')`).get(url) as { id: number; title: string; status: string } | undefined;
}

export async function readLink(input: string): Promise<ReadResult> {
  const found = firstUrl(input) ?? input.trim();
  const url = normaliseUrl(/^https?:\/\//i.test(found) ? found : `https://${found}`);
  const platform = platformOf(url);
  const dupe = existingBySource(url);
  if (dupe) return { status: "already", eventId: dupe.id, title: dupe.title };

  let html: string;
  try {
    const r = await safeFetch(url);
    if (r.status >= 400) throw new Error(String(r.status));
    if (/^image\//.test(r.contentType)) return readFlyerBuffer(r.body, url);
    html = r.body.toString("utf8");
  } catch (e) {
    if (e instanceof FetchRefused) return { status: "error", message: e.message };
    if (platform === "instagram" || platform === "tiktok") return needShot(url);
    return { status: "unreachable", message: "We couldn't open that link. Add a screenshot of the flyer instead, or fill it in yourself." };
  }

  const og = openGraph(html);
  let draft: Partial<Draft> | null = fromJsonLd(html);
  let note: string | undefined;
  if (draft?.title && draft.start_local) {
    draft.category ??= guessCategory(`${draft.title} ${draft.description ?? ""}`);
    draft.image_url ??= og.image;
  } else {
    try {
      const text = [og.title, og.description, pageText(html)].filter(Boolean).join("\n");
      if (text.length < 40 && (platform === "instagram" || platform === "tiktok")) return needShot(url);
      const c = await readWithClaude({ kind: "text", text, url }, today());
      if (!c.is_event || !c.draft.start_local) {
        if (platform === "instagram" || platform === "tiktok") return needShot(url);
        return { status: "not_event", message: "We couldn't find an event on that page. Add a screenshot of the flyer, or fill it in yourself." };
      }
      draft = { ...c.draft, image_url: og.image ?? null };
    } catch (e) {
      if (!(e instanceof ClaudeUnavailable)) throw e;
      note = claudeNote(e);
      if (platform === "instagram" || platform === "tiktok") return needShot(url);
      // No Claude: offer what the page itself says, and let the submitter fill in the rest (S-050).
      const start = splitIso(og.start);
      draft = { title: og.title ?? undefined, description: og.description ?? null, image_url: og.image ?? null,
        start_local: start?.local, utc_offset_min: start?.offset };
    }
  }
  const image = draft.image_url ? await fetchImage(draft.image_url) : null;
  return { status: "ok", draft, image, source: url, platform, note };
}

function needShot(source: string): ReadResult {
  return { status: "need_screenshot", source,
    message: "Instagram and TikTok hide some posts from apps. Add a screenshot of the flyer and we'll fill in the rest." };
}

export async function readFlyerBuffer(buf: Buffer, source: string | null = null): Promise<ReadResult> {
  let saved: { name: string; jpeg: Buffer };
  try { saved = await saveImage(buf); } catch (e) {
    if (e instanceof BadImage) return { status: "error", message: e.message };
    throw e;
  }
  try {
    const c = await readWithClaude({ kind: "image", base64: saved.jpeg.toString("base64"), mediaType: "image/jpeg" }, today());
    if (!c.is_event) return { status: "ok", draft: {}, image: saved.name, source, platform: source ? platformOf(source) : null,
      note: "We couldn't read an event from that image. Fill in the details below." };
    return { status: "ok", draft: c.draft, image: saved.name, source, platform: source ? platformOf(source) : null };
  } catch (e) {
    if (!(e instanceof ClaudeUnavailable)) throw e;
    return { status: "ok", draft: {}, image: saved.name, source, platform: source ? platformOf(source) : null, note: claudeNote(e) };
  }
}

// ---------- taking a submission ----------

export const SubmitSchema = DraftSchema.extend({
  image: z_imageName(),
  source: z_optUrl(),
  email: z_optEmail(),
  website: z_honeypot(),
  category: DraftSchema.shape.category.unwrap().unwrap(),
});
function z_imageName() { return z.string().regex(/^[a-f0-9]{24}\.jpg$/).nullable().optional(); }
function z_optUrl() { return z.string().url().max(2000).refine((u) => /^https?:/i.test(u), "http(s) only").nullable().optional(); }
function z_optEmail() { return z.string().trim().max(200).email().nullable().optional().or(z.literal("").transform(() => null)); }
function z_honeypot() { return z.string().max(500).optional(); }

export function matchCity(d: Pick<Draft, "city" | "address">): City | undefined {
  const hay = `${d.city ?? ""} ${d.address ?? ""}`.toLowerCase();
  return listCities().find((c) => hay.includes(c.name.toLowerCase()));
}

export function toUtc(local: string, tz: string, offset?: number | null): Date {
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, min] = t.split(":").map(Number);
  if (offset != null) return new Date(Date.UTC(y, m - 1, day, h, min) - offset * 60000);
  return zonedToUtc(y, m, day, h, min, tz);
}

const RATE_LIMIT = 10;
export function hashIp(ip: string) {
  return crypto.createHash("sha256").update(`afro-social:${ip}`).digest("hex").slice(0, 24);
}
function rateLimited(key: string): boolean {
  const hourAgo = Date.now() - 3600_000;
  db().prepare("DELETE FROM rate_hits WHERE at < ?").run(hourAgo);
  const n = (db().prepare("SELECT COUNT(*) n FROM rate_hits WHERE key = ?").get(key) as { n: number }).n;
  if (n >= RATE_LIMIT) return true;
  db().prepare("INSERT INTO rate_hits (key, at) VALUES (?, ?)").run(key, Date.now());
  return false;
}

export type SubmitOutcome =
  | { status: "queued"; id: number; newCity: string | null }
  | { status: "already"; eventId: number; title: string }
  | { status: "invalid"; message: string; fields?: string[] }
  | { status: "past"; message: string }
  | { status: "limited"; message: string }
  | { status: "dropped" };

export function submit(body: unknown, ip: string, now = new Date()): SubmitOutcome {
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    if (fields.includes("website")) return { status: "dropped" };
    return { status: "invalid", message: "Please check the highlighted details.", fields };
  }
  const d = parsed.data;
  if (d.website) return { status: "dropped" }; // honeypot (S-065)
  const ipKey = hashIp(ip);
  if (rateLimited(ipKey)) return { status: "limited", message: "Too many submissions — try again later." };

  const source = d.source ? normaliseUrl(d.source) : null;
  if (source) {
    const dupe = existingBySource(source);
    if (dupe) return { status: "already", eventId: dupe.id, title: dupe.title };
  }
  const city = matchCity(d);
  const tz = city?.tz ?? DEFAULT_TZ;
  const start = toUtc(d.start_local, tz, d.utc_offset_min);
  const end = d.end_local ? toUtc(d.end_local, tz, d.utc_offset_min) : null;
  if ((end ?? new Date(start.getTime() + 2 * 3600_000)) < now) return { status: "past", message: "That event has already happened." };

  const newCity = city ? null : (d.city || d.address || "").trim() || null;
  const id = db().transaction(() => {
    const r = db().prepare(`INSERT INTO events (title, start_utc, end_utc, tz, venue_name, address, city_id, online, price_min, price_text,
        image_path, organiser, description, category, singles_friendly, go_solo, dating_format, age_range, status)
      VALUES (@title, @start, @end, @tz, @venue, @address, @city, @online, @price, @price_text, @image, @organiser, @description, @category,
        @singles, @solo, @dating_format, @age_range, 'pending')`).run({
      title: d.title, start: start.toISOString(), end: end?.toISOString() ?? null, tz, venue: d.venue_name ?? null, address: d.address ?? null,
      city: city?.id ?? null, online: d.online ? 1 : 0, price: d.price_min ?? null, price_text: d.price_text ?? null, image: d.image ?? null,
      organiser: d.organiser ?? null, description: d.description ?? null, category: d.category,
      singles: d.singles_friendly ? 1 : 0, solo: d.go_solo ? 1 : 0, dating_format: d.dating_format ?? null, age_range: d.age_range ?? null,
    });
    const eventId = Number(r.lastInsertRowid);
    if (source) db().prepare("INSERT INTO event_sources (event_id, url, platform, origin) VALUES (?, ?, ?, 'submit')").run(eventId, source, platformOf(source));
    db().prepare("INSERT INTO submissions (event_id, submitter_email, new_city, source_url, raw_extract, ip_hash) VALUES (?, ?, ?, ?, ?, ?)")
      .run(eventId, d.email ?? null, newCity, source, JSON.stringify(d), ipKey);
    return eventId;
  })();
  return { status: "queued", id, newCity };
}
