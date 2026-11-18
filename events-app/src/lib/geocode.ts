// Turn an approved event's address into map coordinates, once (C4a). OpenStreetMap Nominatim: light use, 1 request a second, cached.
import { db } from "./db";
import { safeFetch } from "./safefetch";

export type Lookup = (q: string) => Promise<{ lat: number; lng: number } | null>;

let chain: Promise<unknown> = Promise.resolve();
const nominatim: Lookup = (q) => {
  const run = async () => {
    await new Promise((r) => setTimeout(r, 1100));
    const r = await safeFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, { accept: "application/json", maxBytes: 200_000 });
    if (r.status !== 200) throw new Error(String(r.status));
    const hit = (JSON.parse(r.body.toString("utf8")) as { lat: string; lon: string }[])[0];
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  };
  const p = chain.then(run, run);
  chain = p.catch(() => null);
  return p;
};

export async function geocodeEvent(id: number, lookup: Lookup = nominatim): Promise<"ok" | "failed" | "skipped"> {
  const e = db().prepare(`SELECT e.venue_name, e.address, e.online, e.lat, c.name AS city FROM events e LEFT JOIN cities c ON c.id = e.city_id WHERE e.id = ?`)
    .get(id) as { venue_name: string | null; address: string | null; online: number; lat: number | null; city: string | null } | undefined;
  if (!e || e.online || e.lat != null) return "skipped";
  const base = e.address || e.venue_name;
  if (!base) { db().prepare("UPDATE events SET geo_status = 'failed' WHERE id = ?").run(id); return "failed"; }
  const q = (e.city && !base.toLowerCase().includes(e.city.toLowerCase()) ? `${base}, ${e.city}` : base).toLowerCase().replace(/\s+/g, " ").trim();
  let hit = db().prepare("SELECT lat, lng, ok FROM geocode_cache WHERE q = ?").get(q) as { lat: number; lng: number; ok: number } | undefined;
  if (!hit) {
    let found: { lat: number; lng: number } | null;
    try { found = await lookup(q); } catch { return "failed"; } // service down: try again on the next approve/edit, don't cache
    db().prepare("INSERT OR REPLACE INTO geocode_cache (q, lat, lng, ok) VALUES (?, ?, ?, ?)").run(q, found?.lat ?? null, found?.lng ?? null, found ? 1 : 0);
    hit = { lat: found?.lat ?? 0, lng: found?.lng ?? 0, ok: found ? 1 : 0 };
  }
  if (!hit.ok) { db().prepare("UPDATE events SET geo_status = 'failed' WHERE id = ?").run(id); return "failed"; }
  db().prepare("UPDATE events SET lat = ?, lng = ?, geo_status = 'ok' WHERE id = ?").run(hit.lat, hit.lng, id);
  return "ok";
}
