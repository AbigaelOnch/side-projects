// Turn a shared page or flyer into a draft event (C6): the page's own structured data first, then Open Graph,
// then Claude. Everything read here is untrusted content.
import { z } from "zod";
import { CATEGORY_IDS } from "./config";

export const DraftSchema = z.object({
  title: z.string().trim().min(2).max(160),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), // wall-clock time at the venue
  end_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  utc_offset_min: z.number().int().min(-840).max(840).nullable().optional(), // when the page states it
  venue_name: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  online: z.boolean().optional(),
  price_min: z.number().min(0).max(100000).nullable().optional(),
  price_text: z.string().trim().max(60).nullable().optional(),
  image_url: z.string().url().max(2000).nullable().optional(),
  organiser: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(CATEGORY_IDS as [string, ...string[]]).nullable().optional(),
  singles_friendly: z.boolean().optional(),
  go_solo: z.boolean().optional(),
  dating_format: z.enum(["speed", "mixer", "activity", "social"]).nullable().optional(),
  age_range: z.string().trim().max(20).nullable().optional(),
});
export type Draft = z.infer<typeof DraftSchema>;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
export const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? m;
  });

/** Visible text of a page, for Claude. */
export function pageText(html: string, max = 15000): string {
  return decode(html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t\f\r]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max);
}

function meta(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? decode(c).trim() : null;
}

export function openGraph(html: string) {
  return {
    title: meta(html, "og:title") ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]).trim() : null),
    description: meta(html, "og:description") ?? meta(html, "description"),
    image: meta(html, "og:image") ?? meta(html, "twitter:image"),
    start: meta(html, "event:start_time"),
  };
}

/** ISO date → wall-clock "YYYY-MM-DDTHH:mm" plus the offset if the string had one. */
export function splitIso(s: string | undefined | null): { local: string; offset: number | null } | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
  if (!m) return null;
  const local = `${m[1]}T${m[2] ?? "00"}:${m[3] ?? "00"}`;
  let offset: number | null = null;
  if (m[4] === "Z") offset = 0;
  else if (m[4]) {
    const sign = m[4][0] === "-" ? -1 : 1;
    const digits = m[4].slice(1).replace(":", "");
    offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)));
  }
  return { local, offset };
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? decode(v).trim() || null : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

function findEvent(node: unknown): Obj | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) { const e = findEvent(n); if (e) return e; }
    return null;
  }
  const o = node as Obj;
  const t = ([] as unknown[]).concat(o["@type"] ?? []).map(String);
  if (t.some((x) => /Event$/.test(x))) return o;
  return findEvent(o["@graph"]);
}

/** schema.org Event in the page's JSON-LD, if any. */
export function fromJsonLd(html: string): Partial<Draft> | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let data: unknown;
    try { data = JSON.parse(b[1].trim()); } catch { continue; }
    const e = findEvent(data);
    if (!e) continue;
    const start = splitIso(str(e.startDate));
    if (!start) continue;
    const end = splitIso(str(e.endDate));
    const loc = first(e.location) as Obj | undefined;
    const addr = loc?.address;
    const addrText = typeof addr === "string" ? addr : addr && typeof addr === "object"
      ? [str((addr as Obj).streetAddress), str((addr as Obj).addressLocality), str((addr as Obj).addressRegion)].filter(Boolean).join(", ")
      : null;
    const city = addr && typeof addr === "object" ? str((addr as Obj).addressLocality) : null;
    const offers = first(e.offers) as Obj | undefined;
    const price = offers ? Number(offers.lowPrice ?? offers.price) : NaN;
    const img = first(e.image);
    const online = String(e.eventAttendanceMode ?? "").includes("Online") || loc?.["@type"] === "VirtualLocation";
    return {
      title: str(e.name) ?? undefined,
      start_local: start.local, utc_offset_min: start.offset, end_local: end?.local ?? null,
      venue_name: loc && loc["@type"] !== "VirtualLocation" ? str(loc.name) : null,
      address: addrText || null, city, online,
      price_min: Number.isFinite(price) ? price : null,
      image_url: typeof img === "string" ? img : str((img as Obj | undefined)?.url),
      organiser: str((first(e.organizer) as Obj | undefined)?.name),
      description: str(e.description)?.slice(0, 2000) ?? null,
    };
  }
  return null;
}

/** Simple category guess for pages read without Claude. */
export function guessCategory(text: string): Draft["category"] {
  const t = text.toLowerCase();
  if (/speed dating|singles|matchmak|date night/.test(t)) return "dating";
  if (/\b(run|yoga|fitness|wellness|meditat|hike|workout|health)\b/.test(t)) return "wellness";
  if (/\b(tech|founder|career|resume|investor|panel|workshop|engineer|startup|pitch)\b/.test(t)) return "career";
  if (/\b(network|mixer|happy hour|professionals)\b/.test(t)) return "networking";
  return "social";
}

export function platformOf(url: string): string | null {
  const h = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (h.endsWith("eventbrite.com") || h.includes("eventbrite.")) return "eventbrite";
  if (h === "lu.ma" || h.endsWith("luma.com")) return "luma";
  if (h.endsWith("partiful.com")) return "partiful";
  if (h.endsWith("posh.vip")) return "posh";
  if (h.endsWith("meetup.com")) return "meetup";
  if (h.endsWith("instagram.com")) return "instagram";
  if (h.endsWith("tiktok.com")) return "tiktok";
  return null;
}

/** Strip tracking bits so the same event shared twice is recognised (S-030). */
export function normaliseUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|igsh|igshid|ref|aff|_branch|si$|mc_)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    if (u.hostname === "luma.com") u.hostname = "lu.ma";
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s.replace(/\?$/, "");
  } catch {
    return raw.trim();
  }
}

/** Pull the first link out of shared text ("Check this out https://…"). */
export function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i) ?? text.match(/\b(?:lu\.ma|[a-z0-9-]+\.(?:com|vip|events|org|co|io))\/[^\s<>"']*/i);
  if (!m) return null;
  const u = m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
  return u.replace(/[).,!?]+$/, "");
}
