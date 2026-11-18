// Time helpers. Events are stored in UTC and always shown in the event's own time zone (S-013).

type Parts = { y: number; m: number; d: number; h: number; min: number; wd: number };
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function partsIn(date: Date, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: WD[p.weekday] };
}

/** Offset of tz from UTC at `date`, in minutes (e.g. -480 for PST). */
export function offsetMinutes(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** The UTC instant of wall-clock time y-m-d h:min in tz. */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, h, min));
  for (let i = 0; i < 3; i++) {
    const off = offsetMinutes(guess, tz);
    const next = new Date(Date.UTC(y, m - 1, d, h, min) - off * 60000);
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess;
}

function addDays(p: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** [from, to) in UTC for a feed tab, in the city's time zone. `from` is never earlier than now. */
export function tabRange(tab: string, now: Date, tz: string): [Date, Date] {
  const p = partsIn(now, tz);
  const midnight = (q: { y: number; m: number; d: number }) => zonedToUtc(q.y, q.m, q.d, 0, 0, tz);
  let end: Date;
  let start = now;
  switch (tab) {
    case "tonight":
      end = midnight(addDays(p, 1));
      break;
    case "weekend": {
      // Friday 5 pm to Sunday midnight; if it's already the weekend, from now.
      const toFri = (5 - p.wd + 7) % 7;
      const isWeekend = p.wd === 0 || p.wd === 6 || (p.wd === 5 && p.h >= 17);
      if (!isWeekend) {
        const fri = addDays(p, toFri);
        start = zonedToUtc(fri.y, fri.m, fri.d, 17, 0, tz);
      }
      const toMon = p.wd === 0 ? 1 : (8 - p.wd) % 7 || 7;
      end = midnight(addDays(p, toMon));
      break;
    }
    case "month":
      end = midnight(addDays(p, 31));
      break;
    case "week":
    default:
      end = midnight(addDays(p, 8));
  }
  return [start, end];
}

export function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(new Date(iso)).replace(" AM", " am").replace(" PM", " pm").replace(":00", "");
}

export function fmtTzName(iso: string, tz: string): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(iso));
  return p.find((x) => x.type === "timeZoneName")?.value ?? tz;
}

/** "Tonight", "Tomorrow", "Sat, Nov 22" relative to now in tz. */
export function fmtDay(iso: string, tz: string, now = new Date()): string {
  const a = partsIn(new Date(iso), tz);
  const b = partsIn(now, tz);
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
  if (days === 0) return a.h >= 17 ? "Tonight" : "Today";
  if (days === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

export function fmtLongDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(iso));
}

/** Day header for the feed: key for grouping, a big label and a small date. */
export function dayInfo(iso: string, tz: string, now = new Date()): { key: string; label: string; sub: string } {
  const a = partsIn(new Date(iso), tz);
  const b = partsIn(now, tz);
  const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(new Date(iso));
  const md = f({ month: "short", day: "numeric" });
  if (days < 0) return { key: "now", label: "Happening now", sub: "" };
  const key = `${a.y}-${String(a.m).padStart(2, "0")}-${String(a.d).padStart(2, "0")}`;
  if (days === 0) return { key, label: "Today", sub: `${f({ weekday: "short" })}, ${md}` };
  if (days === 1) return { key, label: "Tomorrow", sub: `${f({ weekday: "short" })}, ${md}` };
  return { key, label: f({ weekday: "long" }), sub: md };
}
