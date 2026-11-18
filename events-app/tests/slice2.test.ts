import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afro2-"));
const { db } = await import("@/lib/db");
const ev = await import("@/lib/events");
const geo = await import("@/lib/geo");
const t = await import("@/lib/time");
const TZ = "America/Los_Angeles";
const NOW = t.zonedToUtc(2026, 11, 17, 12, 0, TZ);

beforeAll(() => {
  db().exec(`INSERT INTO cities (id, slug, name, tz, lat, lng) VALUES (1, 'oakland', 'Oakland', '${TZ}', 37.80, -122.27)`);
  const ins = db().prepare(`INSERT INTO events (title, start_utc, tz, city_id, category, status, lat, lng, online) VALUES (?, ?, ?, 1, 'social', 'approved', ?, ?, ?)`);
  const s = t.zonedToUtc(2026, 11, 19, 19, 0, TZ).toISOString();
  ins.run("Lake Merritt (1 mi)", s, TZ, 37.80, -122.25, 0);
  ins.run("Berkeley (5 mi)", s, TZ, 37.89, -122.27, 0);
  ins.run("San Jose (40 mi)", s, TZ, 37.34, -121.89, 0);
  ins.run("No location", s, TZ, null, null, 0);
  ins.run("Online thing", s, TZ, null, null, 1);
});

const near = (radius: number) => ev.listEvents({ city: ev.cityBySlug("oakland")!, near: { lat: 37.81, lng: -122.27, radius },
  tab: "month", cats: [], free: false, dating: false, now: NOW }).events;

describe("S-005 near me", () => {
  it("filters by radius and reports distance", () => {
    const r10 = near(10);
    expect(r10.map((e) => e.title).sort()).toEqual(["Berkeley (5 mi)", "Lake Merritt (1 mi)"]);
    expect(r10.every((e) => typeof e.distance_mi === "number" && e.distance_mi! <= 10)).toBe(true);
    expect(near(50).map((e) => e.title)).toContain("San Jose (40 mi)");
    expect(near(5).map((e) => e.title)).toEqual(["Lake Merritt (1 mi)"]);
  });
  it("S-008 events without a location are left out of near-me but stay in the city list", () => {
    expect(near(50).map((e) => e.title)).not.toContain("No location");
    const city = ev.listEvents({ city: ev.cityBySlug("oakland")!, tab: "month", cats: [], free: false, dating: false, now: NOW }).events;
    expect(city.map((e) => e.title)).toContain("No location");
    expect(near(50).map((e) => e.title)).not.toContain("Online thing");
  });
});

describe("S-009 coordinate privacy", () => {
  it("only accepts coordinates rounded to ~1 km", () => {
    expect(geo.parseNear("37.81,-122.27")).toEqual({ lat: 37.81, lng: -122.27 });
    expect(geo.parseNear("37.80441,-122.27118")).toBeNull();
    expect(geo.parseNear("abc")).toBeNull();
    expect(geo.parseNear("95,0")).toBeNull();
    expect(geo.roundCoord(37.80441)).toBe(37.8);
  });
  it("radius falls back to 25", () => {
    expect(geo.parseRadius("10")).toBe(10);
    expect(geo.parseRadius("7")).toBe(25);
  });
  it("distance is right", () => {
    expect(geo.milesBetween({ lat: 37.8044, lng: -122.2712 }, { lat: 37.7749, lng: -122.4194 })).toBeCloseTo(8.4, 0);
  });
});
