import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afro6-"));
process.env.AI_REVIEW = "on";
const { db } = await import("@/lib/db");
const sub = await import("@/lib/submit");
const dd = await import("@/lib/dedupe");
const admin = await import("@/lib/admin");
const ev = await import("@/lib/events");
const review = await import("@/lib/review");
const claude = await import("@/lib/claude");
const { parseAge } = await import("@/lib/age");

const NOW = new Date("2026-11-18T03:00:00Z");
const TZ = "America/Los_Angeles";
const mixer = { title: "First Friday Mixer for Black Professionals", start_local: "2026-11-20T18:30", category: "networking", venue_name: "The Hive", address: "2101 Broadway, Oakland" };
const send = (o: object) => sub.submit({ ...mixer, ...o }, Math.random().toString(), NOW) as { status: string; id: number; eventId: number; live?: boolean };
const count = () => (db().prepare("SELECT COUNT(*) n FROM events WHERE status IN ('approved','pending')").get() as { n: number }).n;
const feed = (o: object = {}) => ev.listEvents({ city: ev.cityBySlug("oakland")!, tab: "month", cats: [], free: false, dating: true, now: NOW, limit: 100, ...o }).events;

beforeAll(() => { db().exec(`INSERT INTO cities (id, slug, name, tz) VALUES (1, 'oakland', 'Oakland', '${TZ}')`); });

describe("title and place matching", () => {
  it("scores titles", () => {
    expect(dd.similarity("First Friday Mixer", "First Friday Mixer for Black Professionals")).toBeGreaterThanOrEqual(0.85);
    expect(dd.similarity("Soul Food & Vinyl Night", "Vinyl Night: Soul Food")).toBe(1);
    expect(dd.similarity("Yoga in the Park", "Founders Breakfast")).toBe(0);
  });
  it("compares places", () => {
    expect(dd.samePlace({ venue_name: "The Hive", address: null }, { venue_name: "Hive", address: "2101 Broadway" })).toBe(true);
    expect(dd.samePlace({ venue_name: null, address: "2101 Broadway, Oakland" }, { venue_name: null, address: "2101 Broadway St" })).toBe(true);
    expect(dd.samePlace({ venue_name: "The Hive", address: null }, { venue_name: "Lagos Lounge", address: null })).toBe(false);
    expect(dd.samePlace({ venue_name: null, address: "Oakland" }, { venue_name: "The Hive", address: null })).toBeNull();
  });
});

describe("S-031 the same event from another site is one listing", () => {
  let first: number;
  it("merges, keeps both links and fills in missing details", () => {
    first = send({ source: "https://www.eventbrite.com/e/first-friday-1" }).id;
    const before = count();
    const again = send({ title: "First Friday Mixer", start_local: "2026-11-20T19:00", source: "https://www.instagram.com/p/abc", description: "Name tags at the door.", price_min: 0 });
    expect(again.status).toBe("already");
    expect(again.eventId).toBe(first);
    expect(again.live).toBe(false);
    expect(count()).toBe(before);
    const urls = (db().prepare("SELECT url FROM event_sources WHERE event_id = ?").all(first) as { url: string }[]).map((x) => x.url);
    expect(urls).toEqual(["https://eventbrite.com/e/first-friday-1", "https://instagram.com/p/abc"]);
    const e = db().prepare("SELECT description, price_min FROM events WHERE id = ?").get(first) as Record<string, unknown>;
    expect(e).toEqual({ description: "Name tags at the door.", price_min: 0 });
  });
  it("S-033 unmerge brings back two listings, each with its own link", () => {
    const m = dd.recentMerges()[0];
    const before = count();
    expect(dd.unmerge(m.id, sub.recreateFromMerge)).toBe(true);
    expect(count()).toBe(before + 1);
    const moved = db().prepare("SELECT event_id FROM event_sources WHERE url = 'https://instagram.com/p/abc'").get() as { event_id: number };
    expect(moved.event_id).not.toBe(first);
    expect(dd.unmerge(m.id, sub.recreateFromMerge)).toBe(false);
  });
});

describe("S-032 close calls go to the owner", () => {
  it("similar title, same venue, 3 hours apart: both kept and flagged; AI review holds it", async () => {
    const a = send({ title: "Afrobeats Night", venue_name: "Lagos Lounge", address: "500 Main St, Oakland", start_local: "2026-11-27T19:00" }).id;
    const b = send({ title: "Afrobeats Night Late Set", venue_name: "Lagos Lounge", address: "500 Main St, Oakland", start_local: "2026-11-27T22:00" });
    expect(b.status).toBe("queued");
    const flag = dd.openFlags().find((f) => f.a === a && f.b === b.id)!;
    expect(flag).toBeTruthy();
    claude.setReviewForTests(async () => ({ decision: "approve", reason: "fine" }));
    expect(await review.reviewEvent(b.id)).toBe("hold");
    expect(dd.keepBoth(flag.id)).toBe(true);
    expect(await review.reviewEvent(b.id)).toBe("approve");
  });
  it("the owner can merge a flagged pair and undo it", () => {
    const a = send({ title: "Wine Tasting Social", venue_name: "Cellar", address: "9 Oak St, Oakland", start_local: "2026-11-28T17:00", source: "https://lu.ma/wine-a" }).id;
    const b = send({ title: "Wine Tasting Social Hour", venue_name: "Cellar", address: "9 Oak St, Oakland", start_local: "2026-11-28T20:00", source: "https://partiful.com/e/wine-b" }).id;
    admin.approve(a);
    expect(dd.mergeEvents(a, b)).toBe(true);
    expect(ev.getEvent(a)!.sources.map((s) => s.url)).toEqual(["https://lu.ma/wine-a", "https://partiful.com/e/wine-b"]);
    expect((db().prepare("SELECT status, merged_into FROM events WHERE id = ?").get(b) as Record<string, unknown>)).toEqual({ status: "merged", merged_into: a });
    expect(dd.openFlags().some((f) => f.b === b)).toBe(false);
    expect(dd.unmerge(dd.recentMerges()[0].id, sub.recreateFromMerge)).toBe(true);
    expect((db().prepare("SELECT status FROM events WHERE id = ?").get(b) as { status: string }).status).toBe("pending");
    expect(ev.getEvent(a)!.sources.map((s) => s.url)).toEqual(["https://lu.ma/wine-a"]);
  });
  it("different events at the same time are left alone", () => {
    const before = dd.openFlags().length;
    expect(send({ title: "Founders Breakfast", venue_name: "Kola Cafe", address: "77 Pine St, Oakland" }).status).toBe("queued");
    expect(dd.openFlags().length).toBe(before);
  });
});

describe("S-034 recurring events show as one series", () => {
  it("six weekly runs become one card with the rule and next date", () => {
    const ids = [0, 1, 2, 3].map((w) => send({ title: "Lake Merritt Saturday Run", venue_name: "Pergola", address: "599 El Embarcadero, Oakland", category: "wellness",
      start_local: `2026-11-${21 + w * 7 > 30 ? "" : ""}${String(new Date(Date.UTC(2026, 10, 21 + w * 7)).getUTCDate()).padStart(2, "0")}T08:00`.replace("2026-11-", w >= 2 ? "2026-12-" : "2026-11-") }).id);
    ids.forEach((id) => admin.approve(id));
    const cards = feed().filter((e) => e.title === "Lake Merritt Saturday Run");
    expect(cards).toHaveLength(1);
    expect(cards[0].series_rule).toBe("Every Saturday");
    expect(cards[0].start_utc.slice(0, 10)).toBe("2026-11-21");
    expect(ev.getEvent(ids[0])!.nextDates.length).toBeGreaterThanOrEqual(3);
  });
});

describe("singles filters (S-091 to S-093)", () => {
  it("reads age ranges", () => {
    expect(parseAge("30s")).toEqual({ min: 30, max: 39 });
    expect(parseAge("25–40")).toEqual({ min: 25, max: 40 });
    expect(parseAge("40+")).toEqual({ min: 40, max: 120 });
    expect(parseAge("all ages")).toBeNull();
  });
  it("filters by singles-friendly, go solo, format and age", () => {
    const mk = (o: object) => { const id = send({ venue_name: null, ...o }).id; admin.approve(id); return id; };
    mk({ title: "Happy Hour Tech", address: "1 A St, Oakland", start_local: "2026-12-01T18:00", singles_friendly: true });
    mk({ title: "Book Circle", address: "2 B St, Oakland", start_local: "2026-12-02T18:00", go_solo: true });
    mk({ title: "Speed Dating Thirties", address: "3 C St, Oakland", start_local: "2026-12-03T19:00", category: "dating", dating_format: "speed", age_range: "30s" });
    mk({ title: "Singles Hike", address: "4 D St, Oakland", start_local: "2026-12-04T10:00", category: "dating", dating_format: "activity", age_range: "25–40" });
    mk({ title: "Singles Mixer Open", address: "5 E St, Oakland", start_local: "2026-12-05T19:00", category: "dating", dating_format: "mixer" });
    const t = (o: object) => feed(o).map((e) => e.title);
    expect(t({ singles: true })).toEqual(expect.arrayContaining(["Happy Hour Tech", "Speed Dating Thirties"]));
    expect(t({ singles: true })).not.toContain("Book Circle");
    expect(t({ singles: true, dating: false })).toContain("Happy Hour Tech");
    expect(t({ singles: true, dating: false })).not.toContain("Speed Dating Thirties");
    expect(t({ solo: true })).toEqual(["Book Circle"]);
    expect(t({ formats: ["activity"], ages: ["30s"] })).toEqual(["Singles Hike"]);
    expect(t({ ages: ["30s"] }).sort()).toEqual(["Singles Hike", "Speed Dating Thirties"]);
    expect(t({ ages: ["40plus"] })).toEqual(["Singles Hike"]);
    expect(t({ formats: ["mixer"] })).toEqual(["Singles Mixer Open"]);
  });
});
