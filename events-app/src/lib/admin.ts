// Admin: passcode sign-in with lockout, and the review queue (C9, C11). Only the owner signs in; visitors never do.
import crypto from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { CATEGORY_IDS } from "./config";
import { partsIn } from "./time";
import { toUtc } from "./submit";
import { linkSeries } from "./dedupe";
import { parseAge } from "./age";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const LOCK_WINDOW = 15 * 60 * 1000;
const MAX_WRONG = 10;
const SESSION_MS = 7 * 24 * 3600 * 1000;

export const passcodeSet = () => (process.env.ADMIN_PASSCODE ?? "").length >= 6;

export function login(passcode: string, now = Date.now()): { ok: true; token: string } | { ok: false; reason: "locked" | "wrong" | "unset" } {
  if (!passcodeSet()) return { ok: false, reason: "unset" };
  const d = db();
  d.prepare("DELETE FROM login_attempts WHERE at < ?").run(now - LOCK_WINDOW);
  const wrong = (d.prepare("SELECT COUNT(*) n FROM login_attempts").get() as { n: number }).n;
  if (wrong >= MAX_WRONG) return { ok: false, reason: "locked" }; // S-045
  const a = Buffer.from(sha(passcode), "hex");
  const b = Buffer.from(sha(process.env.ADMIN_PASSCODE!), "hex");
  if (!crypto.timingSafeEqual(a, b)) {
    d.prepare("INSERT INTO login_attempts (at) VALUES (?)").run(now);
    return { ok: false, reason: "wrong" };
  }
  d.prepare("DELETE FROM login_attempts").run();
  const token = crypto.randomBytes(32).toString("hex");
  d.prepare("INSERT INTO admin_sessions (token_hash, expires) VALUES (?, ?)").run(sha(token), now + SESSION_MS);
  return { ok: true, token };
}

export function isAdmin(token: string | undefined | null, now = Date.now()): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const row = db().prepare("SELECT expires FROM admin_sessions WHERE token_hash = ?").get(sha(token)) as { expires: number } | undefined;
  return !!row && row.expires > now;
}

export function logout(token: string | undefined | null) {
  if (token) db().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha(token));
}

// ---------- queue ----------

export type QueueItem = {
  id: number; title: string; start_utc: string; end_utc: string | null; tz: string; start_local: string;
  venue_name: string | null; address: string | null; city_id: number | null; city_name: string | null; category: string;
  price_min: number | null; image_path: string | null; organiser: string | null; description: string | null;
  singles_friendly: number; go_solo: number; dating_format: string | null; age_range: string | null; online: number;
  source_url: string | null; submitter_email: string | null; new_city: string | null; created_at: string; review_note: string | null;
};

function localString(iso: string, tz: string): string {
  const p = partsIn(new Date(iso), tz);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.min)}`;
}

export function pending(): QueueItem[] {
  const rows = db().prepare(`
    SELECT e.*, c.name AS city_name,
      (SELECT url FROM event_sources s WHERE s.event_id = e.id ORDER BY s.id LIMIT 1) AS source_url,
      (SELECT submitter_email FROM submissions b WHERE b.event_id = e.id ORDER BY b.id LIMIT 1) AS submitter_email,
      (SELECT new_city FROM submissions b WHERE b.event_id = e.id ORDER BY b.id LIMIT 1) AS new_city
    FROM events e LEFT JOIN cities c ON c.id = e.city_id
    WHERE e.status = 'pending' ORDER BY e.created_at, e.id`).all() as QueueItem[];
  return rows.map((r) => ({ ...r, start_local: localString(r.start_utc, r.tz) }));
}

export function approve(id: number): boolean {
  const r = db().prepare("UPDATE events SET status = 'approved', review_by = 'admin', approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'").run(id);
  if (r.changes === 1) linkSeries(id);
  return r.changes === 1;
}

export function reject(id: number, reason?: string | null): boolean {
  const r = db().prepare("UPDATE events SET status = 'rejected', review_by = 'admin', reject_reason = ? WHERE id = ? AND status IN ('pending','approved')")
    .run((reason ?? "").slice(0, 300) || null, id);
  return r.changes === 1;
}

const EditSchema = z.object({
  title: z.string().trim().min(2).max(160),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  venue_name: z.string().trim().max(160).nullable(),
  address: z.string().trim().max(300).nullable(),
  city_id: z.number().int().positive().nullable(),
  category: z.enum(CATEGORY_IDS as [string, ...string[]]),
  price_min: z.number().min(0).max(100000).nullable(),
  singles_friendly: z.boolean(),
  go_solo: z.boolean(),
}).partial();

export function updateEvent(id: number, fields: unknown): { ok: boolean; message?: string } {
  const p = EditSchema.safeParse(fields);
  if (!p.success) return { ok: false, message: "Check the details and try again." };
  const cur = db().prepare("SELECT tz, start_utc, end_utc, city_id FROM events WHERE id = ?").get(id) as
    { tz: string; start_utc: string; end_utc: string | null; city_id: number | null } | undefined;
  if (!cur) return { ok: false, message: "That event no longer exists." };
  const f = p.data;
  const set: Record<string, unknown> = {};
  for (const k of ["title", "venue_name", "address", "category", "price_min"] as const) if (f[k] !== undefined) set[k] = f[k] === "" ? null : f[k];
  if (f.singles_friendly !== undefined) set.singles_friendly = f.singles_friendly ? 1 : 0;
  if (f.go_solo !== undefined) set.go_solo = f.go_solo ? 1 : 0;
  let tz = cur.tz;
  if (f.city_id !== undefined) {
    set.city_id = f.city_id;
    const c = f.city_id ? (db().prepare("SELECT tz FROM cities WHERE id = ?").get(f.city_id) as { tz: string } | undefined) : undefined;
    if (f.city_id && !c) return { ok: false, message: "Pick a city from the list." };
    if (c) { tz = c.tz; set.tz = tz; }
  }
  if (f.start_local !== undefined) {
    const start = toUtc(f.start_local, tz);
    const length = cur.end_utc ? new Date(cur.end_utc).getTime() - new Date(cur.start_utc).getTime() : null;
    set.start_utc = start.toISOString();
    if (length != null) set.end_utc = new Date(start.getTime() + length).toISOString();
  }
  if (set.address !== undefined || set.venue_name !== undefined) { set.lat = null; set.lng = null; set.geo_status = null; }
  const keys = Object.keys(set);
  if (!keys.length) return { ok: true };
  db().prepare(`UPDATE events SET ${keys.map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...set, id });
  return { ok: true };
}

// ---------- cities ----------

const CitySchema = z.object({
  name: z.string().trim().min(2).max(60),
  tz: z.string().trim().min(3).max(60).refine((t) => { try { new Intl.DateTimeFormat("en-US", { timeZone: t }); return true; } catch { return false; } }),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

export function addCity(input: unknown): { ok: boolean; message?: string } {
  const p = CitySchema.safeParse(input);
  if (!p.success) return { ok: false, message: "Enter a city name and a valid time zone (for example America/Chicago)." };
  const slug = p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return { ok: false, message: "Enter a city name." };
  try {
    db().prepare("INSERT INTO cities (slug, name, tz, lat, lng) VALUES (?, ?, ?, ?, ?)").run(slug, p.data.name, p.data.tz, p.data.lat ?? null, p.data.lng ?? null);
  } catch {
    return { ok: false, message: "That city is already on the list." };
  }
  return { ok: true };
}

// ---------- reports ----------

export function addReport(eventId: number, reason: string | null): boolean {
  const e = db().prepare("SELECT id FROM events WHERE id = ? AND status = 'approved'").get(eventId);
  if (!e) return false;
  db().prepare("INSERT INTO reports (event_id, reason) VALUES (?, ?)").run(eventId, (reason ?? "").trim().slice(0, 500) || null);
  return true;
}

export type ReportItem = { id: number; event_id: number; title: string; reason: string | null; created_at: string };
export function openReports(): ReportItem[] {
  return db().prepare(`SELECT r.id, r.event_id, e.title, r.reason, r.created_at FROM reports r JOIN events e ON e.id = r.event_id
    WHERE r.handled = 0 ORDER BY r.id`).all() as ReportItem[];
}
export function resolveReport(id: number, removeEvent: boolean): boolean {
  const r = db().prepare("SELECT event_id FROM reports WHERE id = ? AND handled = 0").get(id) as { event_id: number } | undefined;
  if (!r) return false;
  db().transaction(() => {
    if (removeEvent) {
      reject(r.event_id, "Removed after a report");
      db().prepare("UPDATE reports SET handled = 1 WHERE event_id = ?").run(r.event_id);
    } else db().prepare("UPDATE reports SET handled = 1 WHERE id = ?").run(id);
  })();
  return true;
}

export function needsLocation(): { id: number; title: string; address: string | null }[] {
  return db().prepare("SELECT id, title, address FROM events WHERE status = 'approved' AND geo_status = 'failed' AND start_utc > ? ORDER BY start_utc LIMIT 20")
    .all(new Date().toISOString()) as { id: number; title: string; address: string | null }[];
}
