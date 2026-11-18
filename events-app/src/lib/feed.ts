import { DEFAULT_TAB, TABS, type TabId } from "./config";
import { cityBySlug, listEvents, parseCats, priceLabel, type City, type EventRow } from "./events";
import type { CardData } from "@/components/EventCard";

export type FeedParams = { city?: string; tab?: string; cat?: string; free?: string; dating?: string; cursor?: string };

export function readFeed(sp: FeedParams, cookieCity?: string, cookieDating?: string) {
  const city: City | undefined = cityBySlug(sp.city) ?? cityBySlug(cookieCity);
  const tab: TabId = (TABS.find((t) => t.id === sp.tab)?.id ?? DEFAULT_TAB) as TabId;
  const cats = parseCats(sp.cat);
  const free = sp.free === "1";
  const dating = sp.dating ? sp.dating === "1" : cookieDating === "1";
  return { city, tab, cats, free, dating };
}

export function toCard(e: EventRow): CardData {
  return {
    id: e.id, title: e.title, start_utc: e.start_utc, tz: e.tz, venue_name: e.venue_name, image_path: e.image_path,
    category: e.category, price: priceLabel(e), singles_friendly: e.singles_friendly, go_solo: e.go_solo,
    series_rule: e.series_rule ?? null,
  };
}

/** Build a feed URL query string, keeping filters shareable (S-012). */
export function feedQuery(p: { city?: string; tab?: string; cats?: string[]; free?: boolean; dating?: boolean }): string {
  const q = new URLSearchParams();
  if (p.city) q.set("city", p.city);
  if (p.tab && p.tab !== DEFAULT_TAB) q.set("tab", p.tab);
  if (p.cats?.length) q.set("cat", p.cats.join(","));
  if (p.free) q.set("free", "1");
  if (p.dating) q.set("dating", "1");
  return q.toString();
}

export function feedPage(sp: FeedParams, cookieCity?: string, cookieDating?: string) {
  const f = readFeed(sp, cookieCity, cookieDating);
  if (!f.city) return { ...f, events: [] as CardData[], next: null as string | null };
  const r = listEvents({ city: f.city, tab: f.tab, cats: f.cats, free: f.free, dating: f.dating, cursor: sp.cursor });
  return { ...f, events: r.events.map(toCard), next: r.next };
}
