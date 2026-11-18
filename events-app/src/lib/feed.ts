import { DEFAULT_TAB, TABS, type TabId } from "./config";
import { cityBySlug, listCities, listEvents, parseCats, priceLabel, type City, type EventRow } from "./events";
import { milesBetween, parseNear, parseRadius } from "./geo";
import type { CardData } from "@/components/EventCard";
import { dayInfo, fmtTime } from "./time";

export type FeedParams = { city?: string; tab?: string; cat?: string; free?: string; dating?: string; cursor?: string; near?: string; r?: string; sf?: string; solo?: string; fmt?: string; age?: string };

/** The nearest configured city: gives the time zone for date tabs in "near me" mode. */
export function nearestCity(p: { lat: number; lng: number }): City | undefined {
  let best: City | undefined;
  let bestD = Infinity;
  for (const c of listCities()) {
    if (c.lat == null || c.lng == null) continue;
    const d = milesBetween(p, { lat: c.lat, lng: c.lng });
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export function readFeed(sp: FeedParams, cookieCity?: string, cookieDating?: string) {
  const nearPt = sp.city ? null : parseNear(sp.near);
  const near = nearPt ? { ...nearPt, radius: parseRadius(sp.r) } : null;
  const city: City | undefined = near ? nearestCity(near) ?? listCities()[0] : cityBySlug(sp.city) ?? cityBySlug(cookieCity);
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? DEFAULT_TAB) as TabId;
  const cats = parseCats(sp.cat);
  const free = sp.free === "1";
  const dating = sp.dating ? sp.dating === "1" : cookieDating === "1";
  const list = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 6);
  return { city, tab, cats, free, dating, near, singles: sp.sf === "1", solo: sp.solo === "1", formats: dating ? list(sp.fmt) : [], ages: list(sp.age) };
}

export function toCard(e: EventRow): CardData {
  const day = dayInfo(e.start_utc, e.tz);
  return {
    id: e.id, title: e.title, venue_name: e.venue_name, image_path: e.image_path,
    category: e.category, price: priceLabel(e), singles_friendly: e.singles_friendly, go_solo: e.go_solo,
    series_rule: e.series_rule ?? null, distance_mi: e.distance_mi ?? null,
    time: fmtTime(e.start_utc, e.tz), day_key: day.key, day_label: day.label, day_sub: day.sub,
  };
}

/** A few upcoming events with flyers, for the shelf at the top of the home page. */
export function featured(f: ReturnType<typeof readFeed>): CardData[] {
  if (!f.city) return [];
  const pick = (tab: "weekend" | "week") =>
    listEvents({ city: f.city!, near: f.near, tab, cats: [], free: false, dating: f.dating, limit: 40 }).events.filter((e) => e.image_path);
  let rows = pick("weekend");
  if (rows.length < 3) rows = pick("week");
  return rows.length < 2 ? [] : rows.slice(0, 6).map(toCard);
}

/** Build a feed URL query string, keeping filters shareable (S-012). */
export function feedQuery(p: { city?: string; near?: { lat: number; lng: number; radius: number } | null; tab?: string; cats?: string[]; free?: boolean; dating?: boolean; singles?: boolean; solo?: boolean; formats?: string[]; ages?: string[] }): string {
  const q = new URLSearchParams();
  if (p.near) { q.set("near", `${p.near.lat},${p.near.lng}`); q.set("r", String(p.near.radius)); }
  else if (p.city) q.set("city", p.city);
  if (p.tab && p.tab !== DEFAULT_TAB) q.set("tab", p.tab);
  if (p.cats?.length) q.set("cat", p.cats.join(","));
  if (p.free) q.set("free", "1");
  if (p.dating) q.set("dating", "1");
  if (p.singles) q.set("sf", "1");
  if (p.solo) q.set("solo", "1");
  if (p.formats?.length) q.set("fmt", p.formats.join(","));
  if (p.ages?.length) q.set("age", p.ages.join(","));
  return q.toString();
}

export function feedPage(sp: FeedParams, cookieCity?: string, cookieDating?: string) {
  const f = readFeed(sp, cookieCity, cookieDating);
  if (!f.city) return { ...f, events: [] as CardData[], next: null as string | null };
  const r = listEvents({ city: f.city, near: f.near, tab: f.tab, cats: f.cats, free: f.free, dating: f.dating, singles: f.singles, solo: f.solo, formats: f.formats, ages: f.ages, cursor: sp.cursor });
  return { ...f, events: r.events.map(toCard), next: r.next };
}
