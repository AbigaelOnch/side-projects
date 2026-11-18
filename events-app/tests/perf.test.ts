import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afro8-"));
const { db } = await import("@/lib/db");
const ev = await import("@/lib/events");

describe("S-003 a city with 2,000 upcoming events", () => {
  it("returns the first page, and a near-me page, quickly and pages without repeats", () => {
    db().exec("INSERT INTO cities (id, slug, name, tz, lat, lng) VALUES (1, 'oakland', 'Oakland', 'America/Los_Angeles', 37.8, -122.27)");
    const now = new Date("2026-11-18T03:00:00Z");
    const ins = db().prepare("INSERT INTO events (title, start_utc, tz, city_id, category, status, lat, lng) VALUES (?, ?, 'America/Los_Angeles', 1, ?, 'approved', ?, ?)");
    db().transaction(() => {
      for (let i = 0; i < 2000; i++) ins.run(`Event ${i}`, new Date(now.getTime() + (i % 600) * 3600e3 + i * 1000).toISOString(), ["social", "career", "wellness", "networking"][i % 4], 37.8 + (i % 50) / 1000, -122.27 + (i % 40) / 1000);
    })();
    const city = ev.cityBySlug("oakland")!;
    const q = { city, tab: "month" as const, cats: [], free: false, dating: false, now };
    let t = performance.now();
    const first = ev.listEvents(q);
    const ms1 = performance.now() - t;
    t = performance.now();
    const near = ev.listEvents({ ...q, near: { lat: 37.81, lng: -122.26, radius: 25 } });
    const ms2 = performance.now() - t;
    expect(first.events).toHaveLength(12);
    expect(near.events).toHaveLength(12);
    expect(ms1).toBeLessThan(200);
    expect(ms2).toBeLessThan(400);
    const seen = new Set<number>(); let cur: string | null = null; let pages = 0;
    do { const r = ev.listEvents({ ...q, cursor: cur }); r.events.forEach((e) => { expect(seen.has(e.id)).toBe(false); seen.add(e.id); }); cur = r.next; pages++; } while (cur && pages < 20);
    expect(seen.size).toBe(240);
  });
});
