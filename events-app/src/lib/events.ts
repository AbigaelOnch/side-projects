import { db } from "./db";
import { CATEGORY_IDS, PAGE_SIZE, type TabId } from "./config";
import { tabRange } from "./time";

export type City = { id: number; slug: string; name: string; tz: string; lat: number | null; lng: number | null; radius_mi: number };

export type EventRow = {
  id: number; title: string; start_utc: string; end_utc: string | null; tz: string;
  venue_name: string | null; address: string | null; city_id: number | null;
  online: number; price_min: number | null; price_text: string | null; image_path: string | null;
  organiser: string | null; description: string | null; category: string;
  singles_friendly: number; go_solo: number; dating_format: string | null; age_range: string | null;
  dress_code: string | null; structure: string | null; spots_text: string | null;
  series_id: number | null; status: string; city_name?: string; series_rule?: string | null;
};

export type Source = { url: string; platform: string | null };

export function listCities(): City[] {
  return db().prepare("SELECT * FROM cities ORDER BY name").all() as City[];
}

export function cityBySlug(slug: string | undefined | null): City | undefined {
  if (!slug) return undefined;
  return db().prepare("SELECT * FROM cities WHERE slug = ?").get(slug) as City | undefined;
}

export type FeedQuery = {
  city: City;
  tab: TabId;
  cats: string[];
  free: boolean;
  dating: boolean;
  cursor?: string | null; // "<start_utc>|<id>"
  now?: Date;
  limit?: number;
};

export function parseCats(v: string | string[] | undefined): string[] {
  const raw = (Array.isArray(v) ? v.join(",") : v || "").split(",").map((s) => s.trim());
  return [...new Set(raw.filter((c) => (CATEGORY_IDS as string[]).includes(c)))];
}

export function listEvents(q: FeedQuery): { events: EventRow[]; next: string | null } {
  const now = q.now ?? new Date();
  const [from, to] = tabRange(q.tab, now, q.city.tz);
  const limit = q.limit ?? PAGE_SIZE;
  const where: string[] = [
    "e.status = 'approved'",
    "e.city_id = @city",
    // still upcoming or happening now (C12): ended events drop off
    "COALESCE(e.end_utc, e.start_utc) > @now",
    "e.start_utc < @to",
    // started within the window, or already under way
    "(e.start_utc >= @from OR (e.start_utc <= @now AND COALESCE(e.end_utc, e.start_utc) > @now))",
  ];
  const params: Record<string, unknown> = {
    city: q.city.id, now: now.toISOString(), from: from.toISOString(), to: to.toISOString(), limit: limit + 1,
  };
  let cats = q.cats;
  if (!q.dating) cats = cats.filter((c) => c !== "dating");
  if (cats.length) {
    where.push(`e.category IN (${cats.map((_, i) => `@c${i}`).join(",")})`);
    cats.forEach((c, i) => (params[`c${i}`] = c));
  } else if (!q.dating) {
    where.push("e.category <> 'dating'");
  }
  if (q.cats.length && !cats.length) return { events: [], next: null }; // only dating picked, dating hidden
  if (q.free) where.push("e.price_min = 0");
  if (q.cursor) {
    const [cs, ci] = q.cursor.split("|");
    where.push("(e.start_utc > @cs OR (e.start_utc = @cs AND e.id > @ci))");
    params.cs = cs;
    params.ci = Number(ci) || 0;
  }
  const rows = db().prepare(`
    SELECT e.*, s.rule_text AS series_rule FROM events e LEFT JOIN series s ON s.id = e.series_id
    WHERE ${where.join(" AND ")}
    ORDER BY e.start_utc, e.id LIMIT @limit`).all(params) as EventRow[];
  // A recurring series shows once: its next date (C8).
  const seen = new Set<number>();
  const out: EventRow[] = [];
  for (const r of rows.slice(0, limit)) {
    if (r.series_id && !q.cursor) {
      if (seen.has(r.series_id)) continue;
      seen.add(r.series_id);
    }
    out.push(r);
  }
  const last = rows.length > limit ? rows[limit - 1] : null;
  return { events: out, next: last ? `${last.start_utc}|${last.id}` : null };
}

export function getEvent(id: number): (EventRow & { sources: Source[]; nextDates: string[] }) | undefined {
  const e = db().prepare(`
    SELECT e.*, c.name AS city_name, s.rule_text AS series_rule FROM events e
    LEFT JOIN cities c ON c.id = e.city_id LEFT JOIN series s ON s.id = e.series_id
    WHERE e.id = ? AND e.status = 'approved'`).get(id) as EventRow | undefined;
  if (!e) return undefined;
  const sources = db().prepare("SELECT url, platform FROM event_sources WHERE event_id = ? ORDER BY id").all(id) as Source[];
  const nextDates = e.series_id
    ? (db().prepare(`SELECT start_utc FROM events WHERE series_id = ? AND status = 'approved' AND start_utc > ? ORDER BY start_utc LIMIT 5`)
        .all(e.series_id, new Date().toISOString()) as { start_utc: string }[]).map((r) => r.start_utc)
    : [];
  return { ...e, sources: sources.filter((s) => isSafeUrl(s.url)), nextDates };
}

export function isSafeUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:";
  } catch {
    return false;
  }
}

export function priceLabel(e: Pick<EventRow, "price_min" | "price_text">): string | null {
  if (e.price_min === 0) return "Free";
  if (e.price_text) return e.price_text;
  if (e.price_min != null) return `From $${e.price_min % 1 ? e.price_min.toFixed(2) : e.price_min}`;
  return null;
}
