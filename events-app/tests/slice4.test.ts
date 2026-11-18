import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afro4-"));
process.env.ADMIN_PASSCODE = "correct-horse";
const { db } = await import("@/lib/db");
const admin = await import("@/lib/admin");
const sub = await import("@/lib/submit");
const ev = await import("@/lib/events");
const { geocodeEvent } = await import("@/lib/geocode");

const TZ = "America/Los_Angeles";
const NOW = new Date("2026-11-18T03:00:00Z");
const base = { title: "Queue me", start_local: "2026-11-20T18:30", category: "networking", address: "2101 Broadway, Oakland" };
const feed = () => ev.listEvents({ city: ev.cityBySlug("oakland")!, tab: "month", cats: [], free: false, dating: true, now: NOW }).events.map((e) => e.title);
const queue = (o: object = {}, ip = Math.random().toString()) => (sub.submit({ ...base, ...o }, ip, NOW) as { id: number }).id;

beforeAll(() => { db().exec(`INSERT INTO cities (id, slug, name, tz) VALUES (1, 'oakland', 'Oakland', '${TZ}'), (2, 'nyc', 'New York', 'America/New_York')`); });

describe("S-045/S-046 admin sign-in", () => {
  it("no token, bad token or expired token is not admin", () => {
    expect(admin.isAdmin(undefined)).toBe(false);
    expect(admin.isAdmin("x".repeat(64))).toBe(false);
    expect(admin.isAdmin("a".repeat(64))).toBe(false);
  });
  it("right passcode signs in; session expires", () => {
    const r = admin.login("correct-horse", 1000) as { ok: true; token: string };
    expect(r.ok).toBe(true);
    expect(admin.isAdmin(r.token, 2000)).toBe(true);
    expect(admin.isAdmin(r.token, 1000 + 8 * 24 * 3600 * 1000)).toBe(false);
    admin.logout(r.token);
    expect(admin.isAdmin(r.token, 2000)).toBe(false);
  });
  it("10 wrong tries lock sign-in for 15 minutes, even with the right passcode", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < 10; i++) expect(admin.login("nope", t0 + i)).toEqual({ ok: false, reason: "wrong" });
    expect(admin.login("correct-horse", t0 + 20)).toEqual({ ok: false, reason: "locked" });
    expect((admin.login("correct-horse", t0 + 16 * 60 * 1000) as { ok: boolean }).ok).toBe(true);
  });
  it("no passcode set means nobody can sign in", () => {
    const keep = process.env.ADMIN_PASSCODE; process.env.ADMIN_PASSCODE = "";
    expect(admin.login("")).toEqual({ ok: false, reason: "unset" });
    process.env.ADMIN_PASSCODE = keep;
  });
});

describe("S-040/S-041 review queue", () => {
  it("pending is hidden; approve makes it public; reject never shows", () => {
    const a = queue({ title: "Approve me", email: "a@example.com", source: "https://lu.ma/approve-me" });
    const r = queue({ title: "Reject me" });
    expect(feed()).not.toContain("Approve me");
    const q = admin.pending();
    expect(q.find((x) => x.id === a)).toMatchObject({ submitter_email: "a@example.com", source_url: "https://lu.ma/approve-me", start_local: "2026-11-20T18:30" });
    expect(admin.approve(a)).toBe(true);
    expect(admin.approve(a)).toBe(false);
    expect(admin.reject(r, "spam")).toBe(true);
    expect(feed()).toContain("Approve me");
    expect(feed()).not.toContain("Reject me");
    expect(admin.pending().some((x) => x.id === a || x.id === r)).toBe(false);
  });
  it("edits show publicly; changing city re-reads the time in that city's zone", () => {
    const id = queue({ title: "Edit me" });
    expect(admin.updateEvent(id, { title: "Edited", category: "social", start_local: "2026-11-21T20:00" }).ok).toBe(true);
    admin.approve(id);
    const e = ev.getEvent(id)!;
    expect(e.title).toBe("Edited");
    expect(e.category).toBe("social");
    expect(e.start_utc).toBe("2026-11-22T04:00:00.000Z");
    admin.updateEvent(id, { city_id: 2, start_local: "2026-11-21T20:00" });
    expect(ev.getEvent(id)!.start_utc).toBe("2026-11-22T01:00:00.000Z");
    expect(admin.updateEvent(id, { category: "nonsense" }).ok).toBe(false);
  });
  it("S-027 a new-city submission is flagged for the admin", () => {
    const id = queue({ address: "Peachtree St, Atlanta" });
    expect(admin.pending().find((x) => x.id === id)!.new_city).toContain("Atlanta");
  });
});

describe("cities", () => {
  it("adds a city; rejects duplicates and bad time zones", () => {
    expect(admin.addCity({ name: "Atlanta", tz: "America/New_York" }).ok).toBe(true);
    expect(admin.addCity({ name: "Atlanta", tz: "America/New_York" }).ok).toBe(false);
    expect(admin.addCity({ name: "Nowhere", tz: "Mars/Olympus" }).ok).toBe(false);
    expect(ev.cityBySlug("atlanta")?.name).toBe("Atlanta");
  });
});

describe("S-095 reports", () => {
  it("a report reaches the admin and changes nothing until they act", () => {
    const id = queue({ title: "Reported" }); admin.approve(id);
    expect(admin.addReport(id, "Wrong date")).toBe(true);
    expect(admin.addReport(999999, "x")).toBe(false);
    expect(feed()).toContain("Reported");
    const rep = admin.openReports().find((r) => r.event_id === id)!;
    expect(rep.reason).toBe("Wrong date");
    expect(admin.resolveReport(rep.id, true)).toBe(true);
    expect(feed()).not.toContain("Reported");
    expect(admin.openReports().some((r) => r.event_id === id)).toBe(false);
  });
});

describe("S-008 venue locations", () => {
  it("geocodes once, caches, and flags addresses that can't be found", async () => {
    let calls = 0;
    const a = queue({ title: "Geo A" }); const b = queue({ title: "Geo B" }); const c = queue({ title: "Geo C", address: "Nowhere Rd, Oakland" });
    const lookup = async (q: string) => { calls++; return q.includes("nowhere") ? null : { lat: 37.81, lng: -122.27 }; };
    expect(await geocodeEvent(a, lookup)).toBe("ok");
    expect(await geocodeEvent(b, lookup)).toBe("ok");
    expect(calls).toBe(1);
    expect(await geocodeEvent(c, lookup)).toBe("failed");
    admin.approve(c);
    expect(admin.needsLocation().some((x) => x.id === c)).toBe(true);
    expect(await geocodeEvent(queue({ title: "Geo D", address: "Down St, Oakland" }), async () => { throw new Error("down"); })).toBe("failed");
  });
});
