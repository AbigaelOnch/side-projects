import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afro-"));
process.env.DATA_DIR = dir;

const { db } = await import("@/lib/db");
const ev = await import("@/lib/events");
const t = await import("@/lib/time");
const { buildIcs } = await import("@/lib/ics");

const TZ = "America/Los_Angeles";
// Tue 2026-11-17 12:00 in Oakland
const NOW = t.zonedToUtc(2026, 11, 17, 12, 0, TZ);

function add(o: Partial<Record<string, unknown>> & { title: string; start: Date; category?: string }) {
  const r = db().prepare(`INSERT INTO events (title, start_utc, end_utc, tz, city_id, category, price_min, status, series_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    o.title, o.start.toISOString(), new Date(o.start.getTime() + 2 * 3600e3).toISOString(), TZ, o.city ?? 1,
    o.category ?? "networking", o.price ?? null, o.status ?? "approved", o.series ?? null);
  return Number(r.lastInsertRowid);
}
const at = (d: number, h: number) => t.zonedToUtc(2026, 11, d, h, 0, TZ);

beforeAll(() => {
  db().exec(`INSERT INTO cities (id, slug, name, tz) VALUES (1, 'oakland', 'Oakland', '${TZ}'), (2, 'la', 'Los Angeles', '${TZ}');
             INSERT INTO series (id, title, rule_text) VALUES (1, 'Run', 'Every Saturday');`);
  add({ title: "Tonight mixer", start: at(17, 19), price: 0 });
  add({ title: "Past brunch", start: at(16, 10) });
  add({ title: "Saturday party", start: at(21, 21), category: "social", price: 20 });
  add({ title: "Thursday speed dating", start: at(19, 19), category: "dating" });
  add({ title: "Pending thing", start: at(18, 19), status: "pending" });
  add({ title: "LA event", start: at(18, 19), city: 2 });
  add({ title: "Run", start: at(21, 8), category: "wellness", series: 1, price: 0 });
  add({ title: "Run", start: at(28, 8), category: "wellness", series: 1, price: 0 });
  add({ title: "Next month", start: at(30, 19), category: "career" });
});

const city = () => ev.cityBySlug("oakland")!;
const titles = (q: Partial<Parameters<typeof ev.listEvents>[0]>) =>
  ev.listEvents({ city: city(), tab: "month", cats: [], free: false, dating: false, now: NOW, ...q }).events.map((e) => e.title);

describe("S-001/S-002 empty states", () => {
  it("a city with nothing matching returns an empty list", () => {
    expect(titles({ tab: "tonight", cats: ["career"] })).toEqual([]);
  });
});

describe("S-010 city feed", () => {
  it("shows only approved, upcoming events in the city, soonest first", () => {
    const ts = titles({});
    expect(ts[0]).toBe("Tonight mixer");
    expect(ts).not.toContain("Past brunch");
    expect(ts).not.toContain("Pending thing");
    expect(ts).not.toContain("LA event");
  });
});

describe("S-011 filters and tabs", () => {
  it("tonight only includes today's events", () => {
    expect(titles({ tab: "tonight" })).toEqual(["Tonight mixer"]);
  });
  it("this weekend is Friday 5pm to Sunday", () => {
    expect(titles({ tab: "weekend" })).toEqual(["Run", "Saturday party"]);
  });
  it("category filter", () => {
    expect(titles({ cats: ["social"] })).toEqual(["Saturday party"]);
  });
  it("parseCats ignores unknown categories", () => {
    expect(ev.parseCats("social,bogus,career,social")).toEqual(["social", "career"]);
  });
});

describe("S-015 free only", () => {
  it("unknown price counts as not free", () => {
    const ts = titles({ free: true });
    expect(ts).toContain("Tonight mixer");
    expect(ts).not.toContain("Next month");
    expect(ts).not.toContain("Saturday party");
  });
});

describe("S-090 dating hidden by default", () => {
  it("hidden unless turned on", () => {
    expect(titles({})).not.toContain("Thursday speed dating");
    expect(titles({ cats: ["dating"] })).toEqual([]);
    expect(titles({ dating: true })).toContain("Thursday speed dating");
  });
});

describe("S-034 series show once", () => {
  it("a weekly series appears once, at its next date", () => {
    expect(titles({}).filter((x) => x === "Run")).toHaveLength(1);
  });
});

describe("paging", () => {
  it("cursor pages without repeats", () => {
    const a = ev.listEvents({ city: city(), tab: "month", cats: [], free: false, dating: true, now: NOW, limit: 2 });
    expect(a.next).toBeTruthy();
    const b = ev.listEvents({ city: city(), tab: "month", cats: [], free: false, dating: true, now: NOW, limit: 2, cursor: a.next });
    const ids = [...a.events, ...b.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("S-013 local time", () => {
  it("formats in the event's time zone, not the device's", () => {
    const iso = at(21, 19).toISOString();
    expect(t.fmtTime(iso, TZ)).toBe("7 pm");
    expect(t.fmtTime(iso, "America/New_York")).toBe("10 pm");
    expect(t.fmtTzName(iso, TZ)).toBe("PST");
  });
  it("zonedToUtc handles daylight saving", () => {
    expect(t.zonedToUtc(2026, 7, 1, 12, 0, TZ).toISOString()).toBe("2026-07-01T19:00:00.000Z");
    expect(t.zonedToUtc(2026, 12, 1, 12, 0, TZ).toISOString()).toBe("2026-12-01T20:00:00.000Z");
  });
});

describe("S-016 calendar file", () => {
  it("is valid ICS with UTC times", () => {
    const s = buildIcs({ id: 5, title: "Mixer, with; commas", start_utc: "2026-11-21T03:00:00.000Z", end_utc: null,
      venue_name: "The Hive", address: "Uptown, Oakland", description: "Line one\nLine two" });
    expect(s).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(s).toContain("DTSTART:20261121T030000Z");
    expect(s).toContain("DTEND:20261121T050000Z");
    expect(s).toContain("SUMMARY:Mixer\\, with\\; commas");
    expect(s).toContain("DESCRIPTION:Line one\\nLine two");
    expect(s.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
});

describe("S-066 safe links", () => {
  it("only http(s) links are shown", () => {
    expect(ev.isSafeUrl("https://lu.ma/x")).toBe(true);
    expect(ev.isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(ev.isSafeUrl("data:text/html,hi")).toBe(false);
  });
});

describe("events further out than a month", () => {
  it("show under All upcoming", () => {
    const id = add({ title: "New Year Gala", start: t.zonedToUtc(2026, 12, 31, 21, 0, TZ) });
    expect(titles({ tab: "month" })).not.toContain("New Year Gala");
    expect(titles({ tab: "all" as never })).toContain("New Year Gala");
    expect(id).toBeGreaterThan(0);
  });
});
