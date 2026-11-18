// Distance and privacy helpers for "Near me" (C4). Visitor coordinates are never stored or logged.

export const RADII = [5, 10, 25, 50] as const;
export const DEFAULT_RADIUS = 25;

/** Round to 2 decimals (~1.1 km), the most precision the server ever sees (S-009). */
export const roundCoord = (x: number) => Math.round(x * 100) / 100;

export function parseNear(v: string | undefined | null): { lat: number; lng: number } | null {
  if (!v) return null;
  const m = /^(-?\d{1,2}(?:\.\d{1,2})?),(-?\d{1,3}(?:\.\d{1,2})?)$/.exec(v.trim());
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function parseRadius(v: string | undefined | null): number {
  const n = Number(v);
  return (RADII as readonly number[]).includes(n) ? n : DEFAULT_RADIUS;
}

export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lat/lng box that contains the circle, for a cheap SQL pre-filter. */
export function boundingBox(c: { lat: number; lng: number }, miles: number) {
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180)));
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLng: c.lng - dLng, maxLng: c.lng + dLng };
}
