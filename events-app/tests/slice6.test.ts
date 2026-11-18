import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "afro7-"));
const { db } = await import("@/lib/db");
const orgs = await import("@/lib/orgs");
const claude = await import("@/lib/claude");
const ex = await import("@/lib/extract");
const ev = await import("@/lib/events");

const TZ = "America/Los_Angeles";
let clock = new Date("2026-11-18T03:00:00Z").getTime();
const now = () => new Date(clock);
const ld = (events: object[]) => `<html><script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement: events.map((e, i) => ({ "@type": "ListItem", position: i + 1, item: e })) })}</script></html>`;
const event = (name: string, date: string, url: string, extra: object = {}) => ({ "@type": "Event", name, startDate: `${date}:00-08:00`, url,
  location: { "@type": "Place", name: "Lagos Lounge", address: { streetAddress: "500 Main St", addressLocality: "Oakland" } }, ...extra });
const status = (title: string) => (db().prepare("SELECT status, review_by, org_id FROM events WHERE title = ?").get(title) as Record<string, unknown> | undefined);
const deps = (html: string, st = 200) => ({ fetchPage: async () => ({ status: st, html }), image: async () => null, now });

beforeAll(() => {
  db().exec(`INSERT INTO cities (id, slug, name, tz) VALUES (1, 'oakland', 'Oakland', '${TZ}')`);
  claude.setReviewForTests(async () => ({ decision: "hold", reason: "Needs a look." }));
});

describe("reading an organiser's page", () => {
  it("finds every event in the page's structured data", () => {
    const list = ex.allJsonLdEvents(ld([event("A Night", "2026-11-21T20:00", "https://x.example/a"), event("B Night", "2026-11-28T20:00", "https://x.example/b")]));
    expect(list.map((e) => e.title)).toEqual(["A Night", "B Night"]);
    expect(list[0].url).toBe("https://x.example/a");
  });
  it("finds event links when there's no structured data", () => {
    const html = `<a href="/e/afrobeats-night-123456789">x</a><a href="https://www.eventbrite.com/o/naija-nights-99">o</a><a href="https://www.eventbrite.com/e/brunch-222?aff=x">y</a>`;
    expect(ex.eventLinks(html, "https://www.eventbrite.com/o/naija-nights-99")).toEqual(["https://eventbrite.com/e/afrobeats-night-123456789", "https://eventbrite.com/e/brunch-222"]);
  });
});

describe("followed organisations", () => {
  let id: number;
  it("adds an organisation; refuses duplicates and private links", () => {
    const r = orgs.addOrg({ page_url: "https://www.eventbrite.com/o/naija-nights-12345678", city_id: 1 });
    expect(r.ok).toBe(true); id = r.id!;
    expect(orgs.listOrgs()[0]).toMatchObject({ name: "naija nights", platform: "eventbrite", trusted: 0 });
    expect(orgs.addOrg({ page_url: "https://eventbrite.com/o/naija-nights-12345678/" }).ok).toBe(false);
    expect(orgs.addOrg({ page_url: "http://192.168.0.4/events" }).ok).toBe(false);
    expect(orgs.addOrg({ page_url: "not a link" }).ok).toBe(false);
  });
  it("S-042 a check queues the organisation's new events, and a second check adds nothing twice", async () => {
    const page = ld([event("Amapiano Sundays", "2026-11-22T16:00", "https://www.eventbrite.com/e/amapiano-1"), event("Highlife Brunch", "2026-11-29T11:00", "https://www.eventbrite.com/e/highlife-2"),
      event("Old Party", "2026-11-01T20:00", "https://www.eventbrite.com/e/old-3")]);
    const r = await orgs.checkOrg(id, { deps: deps(page) });
    expect(r).toMatchObject({ ok: true, added: 2 });
    expect(status("Amapiano Sundays")).toMatchObject({ status: "pending", org_id: id });
    expect(status("Old Party")).toBeUndefined();
    clock += 13 * 3600e3;
    expect((await orgs.checkOrg(id, { deps: deps(page) })).added).toBe(0);
    expect(orgs.listOrgs()[0].last_result).toBe("Nothing new.");
  });
  it("is polite: no more than twice a day by schedule, and Check now waits 10 minutes", async () => {
    let fetched = 0;
    const d = { ...deps(ld([])), fetchPage: async () => { fetched++; return { status: 200, html: "" }; } };
    clock += 60e3;
    expect((await orgs.checkOrg(id, { deps: d })).message).toMatch(/recently/);
    expect((await orgs.checkOrg(id, { manual: true, deps: d })).message).toMatch(/recently/);
    expect(fetched).toBe(0);
    clock += 11 * 60e3;
    await orgs.checkOrg(id, { manual: true, deps: d });
    expect(fetched).toBe(1);
  });
  it("S-043 a trusted organisation's events go live; S-094 its dating events still wait", async () => {
    orgs.setTrusted(id, true); clock += 13 * 3600e3;
    const page = ld([event("Trusted Jollof Night", "2026-12-05T19:00", "https://www.eventbrite.com/e/jollof-4"),
      event("Speed Dating for Singles", "2026-12-06T19:00", "https://www.eventbrite.com/e/speed-5")]);
    await orgs.checkOrg(id, { deps: deps(page) });
    expect(status("Trusted Jollof Night")).toMatchObject({ status: "approved", review_by: "org" });
    expect(status("Speed Dating for Singles")).toMatchObject({ status: "pending" });
    expect(ev.listEvents({ city: ev.cityBySlug("oakland")!, tab: "month", cats: [], free: false, dating: true, now: now() }).events.map((e) => e.title)).toContain("Trusted Jollof Night");
  });
  it("S-044 a blocked or broken page is recorded and the other organisations still run", async () => {
    const other = orgs.addOrg({ page_url: "https://lu.ma/diaspora-collective", city_id: 1 }).id!;
    clock += 13 * 3600e3;
    let calls = 0;
    const d = { image: async () => null, now, fetchPage: async (url: string) => {
      calls++;
      if (url.includes("eventbrite")) return { status: 403, html: "" };
      return { status: 200, html: ld([event("Collective Mixer", "2026-12-10T18:00", "https://lu.ma/collective-mixer")]) };
    } };
    expect(await orgs.checkDue(d)).toBe(1);
    expect(calls).toBe(2);
    const rows = orgs.listOrgs();
    expect(rows.find((o) => o.id === id)!.last_error).toMatch(/isn't letting/);
    expect(rows.find((o) => o.id === other)!.last_result).toBe("1 new event found.");
    clock += 13 * 3600e3;
    const down = { ...d, fetchPage: async () => { throw new Error("timeout"); } };
    expect((await orgs.checkOrg(other, { deps: down })).ok).toBe(false);
  });
  it("events without structured data are read one link at a time", async () => {
    const o = orgs.addOrg({ page_url: "https://www.meetup.com/black-hikers-bay", city_id: 1 }).id!;
    const read = async (url: string) => ({ status: "ok" as const, draft: { title: "Sunrise Hike", start_local: "2026-12-12T07:00", address: "Redwood Park, Oakland", category: "wellness" }, image: null, source: url, platform: "meetup" });
    const r = await orgs.checkOrg(o, { deps: { ...deps(`<a href="https://www.meetup.com/black-hikers-bay/events/301234567/">Hike</a>`), read } });
    expect(r.added).toBe(1);
    expect(status("Sunrise Hike")).toMatchObject({ status: "pending", org_id: o });
  });
  it("unfollow removes it", () => { expect(orgs.removeOrg(id)).toBe(true); expect(orgs.listOrgs().some((o) => o.id === id)).toBe(false); });
});
