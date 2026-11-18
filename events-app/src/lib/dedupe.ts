// No duplicate listings (C7) and recurring events as one series (C8).
import { db } from "./db";
import { partsIn } from "./time";

const STOP = new Set(["the", "a", "an", "for", "of", "and", "at", "in", "with", "to", "on", "by"]);
export function tokens(s: string | null | undefined): string[] {
  return [...new Set((s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w && !STOP.has(w)))];
}
/** 0–1. Same words in any order score 1; a short title fully contained in a longer one scores 0.85. */
export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = tokens(a), y = tokens(b);
  if (!x.length || !y.length) return 0;
  const common = x.filter((w) => y.includes(w)).length;
  const dice = (2 * common) / (x.length + y.length);
  const small = Math.min(x.length, y.length);
  return small >= 2 && common === small ? Math.max(dice, 0.85) : dice;
}
type Place = { venue_name: string | null; address: string | null; online?: number | boolean };
/** true = same place, false = different, null = can't tell. */
export function samePlace(a: Place, b: Place): boolean | null {
  if (a.online && b.online) return true;
  if (a.venue_name && b.venue_name) { if (similarity(a.venue_name, b.venue_name) >= 0.6) return true; }
  const street = (s: string | null) => /^\s*(\d+)\s+([a-z0-9]+)/i.exec(s ?? "");
  const sa = street(a.address), sb = street(b.address);
  if (sa && sb) return sa[1] === sb[1] && sa[2].toLowerCase() === sb[2].toLowerCase();
  if (a.venue_name && b.venue_name) return false;
  return null;
}

type Cand = { id: number; title: string; start_utc: string; venue_name: string | null; address: string | null; online: number; status: string; city_id: number | null };
export type Match = { kind: "same" | "maybe"; event: Cand; score: number };

export function findDuplicate(c: { title: string; start: Date; venue_name: string | null; address: string | null; online: boolean; city_id: number | null }, excludeId?: number): Match | null {
  const from = new Date(c.start.getTime() - 18 * 3600e3).toISOString(), to = new Date(c.start.getTime() + 18 * 3600e3).toISOString();
  const rows = db().prepare(`SELECT id, title, start_utc, venue_name, address, online, status, city_id FROM events
    WHERE status IN ('approved','pending') AND start_utc BETWEEN ? AND ? AND id <> ?`).all(from, to, excludeId ?? 0) as Cand[];
  let best: Match | null = null;
  for (const r of rows) {
    if (c.city_id && r.city_id && c.city_id !== r.city_id) continue;
    const t = similarity(c.title, r.title);
    if (t < 0.5) continue;
    const mins = Math.abs(new Date(r.start_utc).getTime() - c.start.getTime()) / 60000;
    const place = samePlace(c, r);
    const kind: Match["kind"] | null = t >= 0.6 && mins <= 60 && place === true ? "same" : (place === true || (mins <= 60 && place !== false)) ? "maybe" : null;
    if (!kind) continue;
    if (!best || (kind === "same" && best.kind !== "same") || (kind === best.kind && t > best.score)) best = { kind, event: r, score: t };
  }
  return best;
}

const FILL = ["image_path", "description", "price_min", "price_text", "venue_name", "address", "organiser", "end_utc", "lat", "lng"] as const;
function fillBlanks(keepId: number, from: Record<string, unknown>) {
  const keep = db().prepare("SELECT * FROM events WHERE id = ?").get(keepId) as Record<string, unknown>;
  const set = FILL.filter((k) => (keep[k] === null || keep[k] === "") && from[k] != null && from[k] !== "");
  if (set.length) db().prepare(`UPDATE events SET ${set.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ id: keepId, ...Object.fromEntries(set.map((k) => [k, from[k]])) });
}

/** A new submission turned out to be an event we already have: keep one listing, add the new link and any missing details. */
export function absorbSubmission(keepId: number, incoming: Record<string, unknown>, source: string | null, platform: string | null): number {
  return db().transaction(() => {
    fillBlanks(keepId, incoming);
    if (source) db().prepare("INSERT OR IGNORE INTO event_sources (event_id, url, platform, origin) VALUES (?, ?, ?, 'submit')").run(keepId, source, platform);
    const r = db().prepare("INSERT INTO merges (event_id, source_urls, raw_extract) VALUES (?, ?, ?)").run(keepId, JSON.stringify(source ? [source] : []), JSON.stringify(incoming));
    return r.lastInsertRowid;
  })();
}

/** The owner merges two listings into one. */
export function mergeEvents(keepId: number, dropId: number): boolean {
  if (keepId === dropId) return false;
  const drop = db().prepare("SELECT * FROM events WHERE id = ? AND status IN ('approved','pending')").get(dropId) as Record<string, unknown> | undefined;
  const keep = db().prepare("SELECT id FROM events WHERE id = ? AND status IN ('approved','pending')").get(keepId);
  if (!drop || !keep) return false;
  db().transaction(() => {
    const urls = (db().prepare("SELECT url FROM event_sources WHERE event_id = ?").all(dropId) as { url: string }[]).map((x) => x.url);
    fillBlanks(keepId, drop);
    db().prepare("UPDATE event_sources SET event_id = ? WHERE event_id = ?").run(keepId, dropId);
    db().prepare("UPDATE events SET status = 'merged', merged_into = ? WHERE id = ?").run(keepId, dropId);
    db().prepare("INSERT INTO merges (event_id, dropped_event_id, prev_status, source_urls) VALUES (?, ?, ?, ?)").run(keepId, dropId, drop.status, JSON.stringify(urls));
    db().prepare("UPDATE dupe_flags SET resolved = 1 WHERE event_a IN (?, ?) AND event_b IN (?, ?)").run(keepId, dropId, keepId, dropId);
  })();
  return true;
}

export type MergeItem = { id: number; event_id: number; title: string; dropped_event_id: number | null; source_urls: string; created_at: string };
export function recentMerges(): MergeItem[] {
  return db().prepare(`SELECT m.id, m.event_id, e.title, m.dropped_event_id, m.source_urls, m.created_at FROM merges m JOIN events e ON e.id = m.event_id
    WHERE m.undone = 0 ORDER BY m.id DESC LIMIT 10`).all() as MergeItem[];
}

/** Undo a merge: both listings exist again (S-033). `recreate` builds a pending event from a stored submission. */
export function unmerge(mergeId: number, recreate: (raw: Record<string, unknown>) => number | null): boolean {
  const m = db().prepare("SELECT * FROM merges WHERE id = ? AND undone = 0").get(mergeId) as
    { id: number; event_id: number; dropped_event_id: number | null; prev_status: string | null; source_urls: string; raw_extract: string | null } | undefined;
  if (!m) return false;
  return db().transaction(() => {
    let target = m.dropped_event_id;
    if (target) db().prepare("UPDATE events SET status = ?, merged_into = NULL WHERE id = ? AND status = 'merged'").run(m.prev_status ?? "pending", target);
    else if (m.raw_extract) target = recreate(JSON.parse(m.raw_extract));
    if (!target) return false;
    for (const u of JSON.parse(m.source_urls) as string[]) db().prepare("UPDATE event_sources SET event_id = ? WHERE url = ? AND event_id = ?").run(target, u, m.event_id);
    db().prepare("UPDATE merges SET undone = 1 WHERE id = ?").run(m.id);
    return true;
  })();
}

export type FlagItem = { id: number; a: number; b: number; a_title: string; b_title: string; a_when: string; b_when: string; a_venue: string | null; b_venue: string | null; a_status: string; b_status: string; tz: string };
export function openFlags(): FlagItem[] {
  return db().prepare(`SELECT f.id, a.id AS a, b.id AS b, a.title AS a_title, b.title AS b_title, a.start_utc AS a_when, b.start_utc AS b_when,
      a.venue_name AS a_venue, b.venue_name AS b_venue, a.status AS a_status, b.status AS b_status, a.tz AS tz
    FROM dupe_flags f JOIN events a ON a.id = f.event_a JOIN events b ON b.id = f.event_b
    WHERE f.resolved = 0 AND a.status IN ('approved','pending') AND b.status IN ('approved','pending') ORDER BY f.id`).all() as FlagItem[];
}
export function flagPair(a: number, b: number, score: number) {
  db().prepare("INSERT INTO dupe_flags (event_a, event_b, score) VALUES (?, ?, ?)").run(a, b, score);
}
export function keepBoth(flagId: number): boolean {
  return db().prepare("UPDATE dupe_flags SET resolved = 1 WHERE id = ? AND resolved = 0").run(flagId).changes === 1;
}
export function flaggedWith(eventId: number): string | null {
  const r = db().prepare(`SELECT a.title FROM dupe_flags f JOIN events a ON a.id = f.event_a WHERE f.event_b = ? AND f.resolved = 0 LIMIT 1`).get(eventId) as { title: string } | undefined;
  return r?.title ?? null;
}

// ---------- recurring series ----------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** If this event repeats (same name, place, weekday and time on other dates), group them so the feed shows one card. */
export function linkSeries(id: number): number | null {
  const e = db().prepare("SELECT * FROM events WHERE id = ? AND status IN ('approved','pending')").get(id) as
    (Cand & { tz: string; series_id: number | null; organiser: string | null }) | undefined;
  if (!e) return null;
  const p = partsIn(new Date(e.start_utc), e.tz);
  const others = (db().prepare(`SELECT id, title, start_utc, venue_name, address, online, status, city_id, tz, series_id FROM events
    WHERE status IN ('approved','pending') AND id <> ? AND COALESCE(city_id, 0) = COALESCE(?, 0)`).all(id, e.city_id) as (Cand & { tz: string; series_id: number | null })[])
    .filter((o) => {
      const q = partsIn(new Date(o.start_utc), o.tz);
      const days = Math.round(Math.abs(new Date(o.start_utc).getTime() - new Date(e.start_utc).getTime()) / 86400e3);
      return days >= 6 && q.wd === p.wd && q.h === p.h && q.min === p.min && similarity(o.title, e.title) >= 0.85 && samePlace(o, e) !== false;
    });
  if (!others.length) return e.series_id;
  const gap = Math.min(...others.map((o) => Math.round(Math.abs(new Date(o.start_utc).getTime() - new Date(e.start_utc).getTime()) / 86400e3)));
  const rule = gap <= 8 ? `Every ${DAYS[p.wd]}` : gap <= 15 ? `Every other ${DAYS[p.wd]}` : `Monthly on ${DAYS[p.wd]}s`;
  return db().transaction(() => {
    let sid = e.series_id ?? others.find((o) => o.series_id)?.series_id ?? null;
    if (!sid) sid = db().prepare("INSERT INTO series (title, rule_text, organiser) VALUES (?, ?, ?)").run(e.title, rule, e.organiser).lastInsertRowid;
    else if (gap <= 8) db().prepare("UPDATE series SET rule_text = ? WHERE id = ?").run(rule, sid);
    db().prepare(`UPDATE events SET series_id = ? WHERE id IN (${[id, ...others.map((o) => o.id)].join(",")})`).run(sid);
    return sid;
  })();
}
