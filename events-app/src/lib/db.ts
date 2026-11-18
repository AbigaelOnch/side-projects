import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// One SQLite file on this computer. Versioned migrations below; the same tables move to Postgres when hosted.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

const MIGRATIONS: string[] = [
  `
  CREATE TABLE cities (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tz TEXT NOT NULL,
    lat REAL, lng REAL,
    radius_mi REAL NOT NULL DEFAULT 25
  );
  CREATE TABLE series (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    rule_text TEXT,
    organiser TEXT
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    start_utc TEXT NOT NULL,
    end_utc TEXT,
    tz TEXT NOT NULL,
    venue_name TEXT, address TEXT,
    city_id INTEGER REFERENCES cities(id),
    lat REAL, lng REAL,
    online INTEGER NOT NULL DEFAULT 0,
    price_min REAL, price_text TEXT,
    image_path TEXT,
    organiser TEXT,
    description TEXT,
    category TEXT NOT NULL,
    singles_friendly INTEGER NOT NULL DEFAULT 0,
    go_solo INTEGER NOT NULL DEFAULT 0,
    dating_format TEXT, age_range TEXT, audience_tags TEXT,
    dress_code TEXT, structure TEXT, spots_text TEXT,
    series_id INTEGER REFERENCES series(id),
    status TEXT NOT NULL DEFAULT 'pending',
    merged_into INTEGER,
    auto_approved INTEGER NOT NULL DEFAULT 0,
    sample INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    approved_at TEXT
  );
  CREATE INDEX events_feed ON events(status, city_id, start_utc, id);
  CREATE TABLE event_sources (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    url TEXT NOT NULL UNIQUE,
    platform TEXT,
    origin TEXT NOT NULL DEFAULT 'submit',
    first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX sources_event ON event_sources(event_id);
  `,
  `
  CREATE TABLE submissions (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    submitter_email TEXT,
    new_city TEXT,
    source_url TEXT,
    raw_extract TEXT,
    ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE rate_hits (key TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX rate_hits_key ON rate_hits(key, at);
  `,
];

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "app.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

// Reuse one connection across hot reloads in dev.
const g = globalThis as unknown as { __eventsDb?: Database.Database };
export function db(): Database.Database {
  if (!g.__eventsDb) g.__eventsDb = open();
  return g.__eventsDb;
}

export function resetForTests() {
  g.__eventsDb?.close();
  g.__eventsDb = undefined;
}
