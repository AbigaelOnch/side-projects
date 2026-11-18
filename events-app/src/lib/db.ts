import type { DatabaseSync, StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { parseAge } from "./age";

// One SQLite file on this computer, using the SQLite built into Node.js (no native add-on to compile).
// Versioned migrations below; the same tables move to Postgres when hosted.
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
  `
  CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
  CREATE TABLE login_attempts (at INTEGER NOT NULL);
  CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    reason TEXT,
    handled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE geocode_cache (q TEXT PRIMARY KEY, lat REAL, lng REAL, ok INTEGER NOT NULL);
  ALTER TABLE events ADD COLUMN reject_reason TEXT;
  ALTER TABLE events ADD COLUMN geo_status TEXT;
  `,
  `
  ALTER TABLE events ADD COLUMN review_by TEXT;
  ALTER TABLE events ADD COLUMN review_note TEXT;
  ALTER TABLE events ADD COLUMN reviewed_at TEXT;
  `,
  `
  CREATE TABLE dupe_flags (id INTEGER PRIMARY KEY, event_a INTEGER NOT NULL, event_b INTEGER NOT NULL, score REAL, resolved INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE merges (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL,
    dropped_event_id INTEGER,
    prev_status TEXT,
    source_urls TEXT NOT NULL DEFAULT '[]',
    raw_extract TEXT,
    undone INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  ALTER TABLE events ADD COLUMN age_min INTEGER;
  ALTER TABLE events ADD COLUMN age_max INTEGER;
  `,
  `
  CREATE TABLE orgs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    page_url TEXT NOT NULL UNIQUE,
    platform TEXT,
    trusted INTEGER NOT NULL DEFAULT 0,
    city_id INTEGER REFERENCES cities(id),
    last_checked INTEGER,
    last_result TEXT,
    last_error TEXT
  );
  ALTER TABLE events ADD COLUMN org_id INTEGER;
  `,
];

type Param = string | number | bigint | null | Uint8Array;
const clean = (v: unknown): Param => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as Param));
function args(a: unknown[]): never[] {
  if (a.length === 1 && a[0] && typeof a[0] === "object" && !ArrayBuffer.isView(a[0])) {
    return [Object.fromEntries(Object.entries(a[0] as object).map(([k, v]) => [k, clean(v)]))] as never[];
  }
  return a.map(clean) as never[];
}

class Statement {
  constructor(private s: StatementSync) {}
  run(...a: unknown[]) { const r = this.s.run(...args(a)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }
  // Rows come back without a prototype; copy them into plain objects so they can be passed to the page.
  get(...a: unknown[]): unknown { const r = this.s.get(...args(a)); return r ? { ...r } : undefined; }
  all(...a: unknown[]): unknown[] { return this.s.all(...args(a)).map((r) => ({ ...r })); }
}

export class Db {
  private depth = 0;
  constructor(private d: DatabaseSync) {}
  prepare(sql: string) { return new Statement(this.d.prepare(sql)); }
  exec(sql: string) { this.d.exec(sql); }
  close() { this.d.close(); }
  /** Same shape as before: db.transaction(fn)() runs fn inside a transaction. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      if (this.depth > 0) return fn();
      this.d.exec("BEGIN");
      this.depth++;
      try { const out = fn(); this.d.exec("COMMIT"); return out; }
      catch (e) { this.d.exec("ROLLBACK"); throw e; }
      finally { this.depth--; }
    };
  }
}

function open(): Db {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // getBuiltinModule keeps bundlers and test runners from trying to resolve "sqlite" as a package.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const raw = new DatabaseSync(path.join(DATA_DIR, "app.db"));
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const db = new Db(raw);
  const current = Number((raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  // keep the numeric age range in step with the text one (used by the age filter)
  for (const r of raw.prepare("SELECT id, age_range FROM events WHERE age_range IS NOT NULL AND age_min IS NULL").all() as { id: number; age_range: string }[]) {
    const a = parseAge(r.age_range);
    if (a) raw.prepare("UPDATE events SET age_min = ?, age_max = ? WHERE id = ?").run(a.min, a.max, r.id);
  }
  return db;
}

// Reuse one connection across hot reloads in dev.
const g = globalThis as unknown as { __eventsDb?: Db };
export function db(): Db {
  if (!g.__eventsDb) g.__eventsDb = open();
  return g.__eventsDb;
}

export function resetForTests() {
  g.__eventsDb?.close();
  g.__eventsDb = undefined;
}
