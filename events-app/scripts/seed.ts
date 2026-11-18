// Sample data for trying the app locally. Every event and organiser here is made up.
// Usage: npm run seed            (adds sample cities + events if there are none)
//        npm run seed -- --reset (removes sample events first)
import { db } from "../src/lib/db";
import { partsIn, zonedToUtc } from "../src/lib/time";
import fs from "node:fs";
import path from "node:path";

// Made-up sample flyers, by event title.
const FLYERS: Record<string, string> = {
  "Afrobeats & Amapiano Night": "afrobeats.jpg",
  "Founders & Funders Breakfast": "founders.jpg",
  "Lake Merritt Saturday Run": "run.jpg",
  "Singles Paint & Sip": "paint.jpg",
  "Diaspora Book Club: New Voices": "books.jpg",
};
function copyFlyers() {
  const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of Object.values(FLYERS)) fs.copyFileSync(path.join(process.cwd(), "sample-flyers", f), path.join(dir, `sample-${f}`));
}

const CITIES = [
  { slug: "oakland", name: "Oakland", tz: "America/Los_Angeles", lat: 37.8044, lng: -122.2712 },
  { slug: "san-francisco", name: "San Francisco", tz: "America/Los_Angeles", lat: 37.7749, lng: -122.4194 },
  { slug: "los-angeles", name: "Los Angeles", tz: "America/Los_Angeles", lat: 34.0522, lng: -118.2437 },
];

type T = {
  title: string; category: string; venue: string; hood: string; hour: number; min?: number; hours?: number;
  price: number | null; price_text?: string; organiser: string; go_solo?: boolean; singles?: boolean;
  dating_format?: string; age_range?: string; desc: string;
};

const TEMPLATES: T[] = [
  { title: "First Friday Mixer for Black Professionals", category: "networking", venue: "The Hive", hood: "Uptown", hour: 18, min: 30, hours: 3, price: 0, organiser: "Diaspora Professionals Collective", go_solo: true, singles: true, desc: "Our monthly mixer. Name tags at the door and hosts who'll introduce you around. Come solo, leave with a crew." },
  { title: "Founders & Funders Breakfast", category: "career", venue: "Kola Café", hood: "Downtown", hour: 9, hours: 2, price: 15, organiser: "Black Founders Table", go_solo: true, desc: "Coffee, jollof breakfast bowls and short pitches from five local founders. Investors in the room." },
  { title: "Afrobeats & Amapiano Night", category: "social", venue: "Lagos Lounge", hood: "Downtown", hour: 21, hours: 4, price: 20, organiser: "Naija Nights", singles: true, desc: "DJs spinning Afrobeats, amapiano and highlife all night. Dress to impress." },
  { title: "Soul Food & Vinyl Night", category: "social", venue: "Record Room", hood: "Temescal", hour: 20, hours: 3, price: 20, organiser: "Sunday Spin Club", singles: true, desc: "Bring a record, get a plate. Soul, funk and Afro-jazz on the decks." },
  { title: "Women in Tech Panel: Leading While Black", category: "career", venue: "Innovation Hub", hood: "SoMa", hour: 18, hours: 2, price: 0, organiser: "Black Women Who Code (local chapter)", desc: "Engineering leaders share how they got there. Q&A and networking after." },
  { title: "Diaspora Book Club: New Voices", category: "social", venue: "Marcus Corner Books", hood: "North Oakland", hour: 14, hours: 2, price: 0, organiser: "Pages of Us", go_solo: true, desc: "This month: a debut novel set between Accra and Houston. All welcome, even if you haven't finished it." },
  { title: "Yoga & Meditation for Us", category: "wellness", venue: "Studio Sankofa", hood: "Fruitvale", hour: 10, hours: 1, price: 12, organiser: "Rooted Wellness", go_solo: true, desc: "A gentle flow and guided meditation. Mats provided." },
  { title: "Career Clinic: Resume & LinkedIn Reviews", category: "career", venue: "Public Library, Main Branch", hood: "Downtown", hour: 11, hours: 3, price: 0, organiser: "Next Level Careers", go_solo: true, desc: "One-to-one reviews with recruiters from local companies. Bring a printed or digital resume." },
  { title: "Ethiopian Coffee Ceremony & Culture Talk", category: "social", venue: "Abyssinia Cultural Center", hood: "Temescal", hour: 15, hours: 2, price: 10, organiser: "Habesha Collective", go_solo: true, desc: "A traditional coffee ceremony with a short talk on its history." },
  { title: "Black Tech Happy Hour", category: "networking", venue: "Brick & Barrel", hood: "Jack London", hour: 17, min: 30, hours: 3, price: 0, organiser: "Code & Culture", singles: true, desc: "Engineers, designers and product folks. First drink on us for the first 50." },
  { title: "Speed Dating: 30s", category: "dating", venue: "Velvet Room", hood: "Uptown", hour: 19, hours: 2, price: 35, organiser: "Linked Hearts", dating_format: "speed", age_range: "30s", desc: "Eight-minute dates, a host to keep it moving, and drinks after." },
  { title: "Singles Paint & Sip", category: "dating", venue: "Canvas Collective", hood: "Lake Merritt", hour: 19, min: 30, hours: 2, price: 45, organiser: "Linked Hearts", dating_format: "activity", age_range: "25–40", go_solo: true, desc: "Paint, sip and swap seats every 20 minutes. All materials included." },
  { title: "Ghana Independence Day Celebration", category: "social", venue: "Community Hall", hood: "Eastlake", hour: 18, hours: 5, price: 25, organiser: "Ghanaian Association of the Bay", desc: "Food, music and dance. Kente encouraged." },
  { title: "Money Moves: Investing 101", category: "career", venue: "Online", hood: "Online", hour: 18, min: 30, hours: 1, price: 0, organiser: "Wealth Circle", desc: "A beginner-friendly session on index funds, retirement accounts and building generational wealth." },
];

const RUN: T = { title: "Lake Merritt Saturday Run", category: "wellness", venue: "Lake Merritt Pergola", hood: "Lake Merritt", hour: 8, hours: 1, price: 0, organiser: "Afro Run Crew", go_solo: true, singles: true, desc: "3 miles around the lake at a no-drop pace, then coffee. Every Saturday." };

function at(daysFromNow: number, hour: number, min: number, tz: string): Date {
  const now = new Date();
  const p = partsIn(new Date(now.getTime() + daysFromNow * 86400000), tz);
  return zonedToUtc(p.y, p.m, p.d, hour, min, tz);
}

function main() {
  const d = db();
  copyFlyers();
  if (process.argv.includes("--reset")) {
    d.exec("DELETE FROM event_sources WHERE event_id IN (SELECT id FROM events WHERE sample = 1); DELETE FROM events WHERE sample = 1;");
  }
  const insCity = d.prepare("INSERT OR IGNORE INTO cities (slug, name, tz, lat, lng) VALUES (@slug, @name, @tz, @lat, @lng)");
  for (const c of CITIES) insCity.run(c);
  const has = d.prepare("SELECT COUNT(*) n FROM events WHERE sample = 1").get() as { n: number };
  if (has.n > 0) { console.log(`Sample events already there (${has.n}). Use --reset to recreate.`); return; }

  const ins = d.prepare(`INSERT INTO events (title, start_utc, end_utc, tz, venue_name, address, city_id, online, price_min, price_text,
    organiser, description, category, singles_friendly, go_solo, dating_format, age_range, series_id, status, sample, approved_at, image_path, lat, lng)
    VALUES (@title, @start, @end, @tz, @venue, @address, @city, @online, @price, @price_text, @organiser, @desc, @category, @singles, @solo,
    @dating_format, @age_range, @series, 'approved', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), @image, @lat, @lng)`);
  const src = d.prepare("INSERT INTO event_sources (event_id, url, platform, origin) VALUES (?, ?, ?, 'admin')");
  const platforms = ["eventbrite", "luma", "partiful", "posh", "meetup"];
  let n = 0;
  d.transaction(() => {
    const cities = d.prepare("SELECT * FROM cities").all() as { id: number; slug: string; name: string; tz: string; lat: number; lng: number }[];
    cities.forEach((c, ci) => {
      TEMPLATES.forEach((t, ti) => {
        for (let rep = 0; rep < 2; rep++) {
          const day = ((ti * 3 + ci * 2 + rep * 13) % 28);
          const start = at(day, t.hour, t.min ?? 0, c.tz);
          const end = new Date(start.getTime() + (t.hours ?? 2) * 3600000);
          const online = t.venue === "Online";
          const r = ins.run({
            title: t.title, start: start.toISOString(), end: end.toISOString(), tz: c.tz,
            venue: online ? null : t.venue, address: online ? null : `${t.hood}, ${c.name}`, city: c.id, online: online ? 1 : 0,
            price: t.price, price_text: t.price_text ?? null, organiser: t.organiser, desc: t.desc, category: t.category,
            singles: t.singles ? 1 : 0, solo: t.go_solo ? 1 : 0, dating_format: t.dating_format ?? null, age_range: t.age_range ?? null, series: null,
            image: FLYERS[t.title] ? `sample-${FLYERS[t.title]}` : null,
            // spread venues within a few miles of the city centre
            lat: online ? null : c.lat + (((ti * 37 + rep * 11) % 100) / 100 - 0.5) * 0.07,
            lng: online ? null : c.lng + (((ti * 53 + rep * 17) % 100) / 100 - 0.5) * 0.09,
          });
          const p = platforms[(ti + rep + ci) % platforms.length];
          src.run(r.lastInsertRowid, `https://example.com/${p}/${c.slug}-${ti}-${rep}`, p);
          n++;
        }
      });
    });
    // A weekly series in Oakland (C8)
    const oak = cities.find((c) => c.slug === "oakland")!;
    const s = d.prepare("INSERT INTO series (title, rule_text, organiser) VALUES (?, 'Every Saturday', ?)").run(RUN.title, RUN.organiser);
    const p = partsIn(new Date(), oak.tz);
    const toSat = (6 - p.wd + 7) % 7 || 7;
    for (let w = 0; w < 6; w++) {
      const start = at(toSat + w * 7, RUN.hour, 0, oak.tz);
      const r = ins.run({
        title: RUN.title, start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), tz: oak.tz,
        venue: RUN.venue, address: "Lake Merritt, Oakland", city: oak.id, online: 0, price: 0, price_text: null, organiser: RUN.organiser,
        desc: RUN.desc, category: RUN.category, singles: 1, solo: 1, dating_format: null, age_range: null, series: s.lastInsertRowid,
        image: `sample-${FLYERS[RUN.title]}`, lat: 37.8019, lng: -122.2588,
      });
      src.run(r.lastInsertRowid, `https://example.com/luma/afro-run-crew-${w}`, "luma");
      n++;
    }
  })();
  console.log(`Added ${CITIES.length} cities and ${n} sample events.`);
}

main();
