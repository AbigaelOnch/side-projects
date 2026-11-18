import { APP_NAME } from "./config";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** RFC 5545 calendar file. Times are in UTC (…Z), so every calendar shows the correct local time. */
export function buildIcs(e: {
  id: number; title: string; start_utc: string; end_utc: string | null;
  venue_name: string | null; address: string | null; description: string | null; url?: string;
}, host = "localhost"): string {
  const end = e.end_utc ?? new Date(new Date(e.start_utc).getTime() + 2 * 3600_000).toISOString();
  const loc = [e.venue_name, e.address].filter(Boolean).join(", ");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${esc(APP_NAME)}//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${e.id}@${host}`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(e.start_utc)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    loc ? `LOCATION:${esc(loc)}` : "",
    e.description ? `DESCRIPTION:${esc(e.description.slice(0, 1000))}` : "",
    e.url ? `URL:${e.url}` : "",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  // fold lines longer than 75 octets
  return lines.map((l) => l.match(/.{1,74}/g)!.join("\r\n ")).join("\r\n") + "\r\n";
}
