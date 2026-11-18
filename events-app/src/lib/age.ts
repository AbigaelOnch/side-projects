/** "30s" → 30–39, "25–40" → 25–40, "40+" → 40–120. Null when it can't be read. */
export function parseAge(s: string | null | undefined): { min: number; max: number } | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/[–—]/g, "-");
  let m = /(\d{2})\s*-\s*(\d{2})/.exec(t);
  if (m) return { min: Math.min(+m[1], +m[2]), max: Math.max(+m[1], +m[2]) };
  m = /(\d{2})\s*\+|over\s*(\d{2})/.exec(t);
  if (m) return { min: +(m[1] ?? m[2]), max: 120 };
  m = /(\d)0'?s/.exec(t);
  if (m) return { min: +m[1] * 10, max: +m[1] * 10 + 9 };
  return null;
}
export const AGE_BUCKETS: Record<string, [number, number]> = { "20s": [20, 29], "30s": [30, 39], "40plus": [40, 120] };
