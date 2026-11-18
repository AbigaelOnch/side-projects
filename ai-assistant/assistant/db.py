"""Local SQLite store for tasks, pending approvals and a run log."""
import json
import sqlite3
from datetime import datetime

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT,
    source TEXT,
    due TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    args TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    result TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_date TEXT NOT NULL,
    name TEXT,
    spend REAL NOT NULL,          -- positive = money out, negative = refund
    category TEXT,
    parent_category TEXT,
    account TEXT,
    uid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS tx_date_idx ON transactions(tx_date);
CREATE TABLE IF NOT EXISTS limits (category TEXT PRIMARY KEY, monthly REAL NOT NULL);
CREATE TABLE IF NOT EXISTS category_groups (category TEXT PRIMARY KEY, grp TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL, meal TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    metric TEXT NOT NULL,         -- workouts | minutes | distance_km
    target REAL NOT NULL,
    period TEXT NOT NULL,         -- week | month
    active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    minutes REAL DEFAULT 0,
    distance_km REAL DEFAULT 0,
    source TEXT DEFAULT 'manual',
    notes TEXT,
    uid TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,           -- doctor | dentist | beauty | other
    provider TEXT,
    purpose TEXT,
    start TEXT,                   -- local ISO date-time, empty until a time is chosen
    minutes INTEGER DEFAULT 60,
    status TEXT DEFAULT 'to_book',-- to_book | booked | done | cancelled
    booking_link TEXT,
    notes TEXT,
    event_id TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    summary TEXT
);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


# --- approvals -------------------------------------------------------------

def queue_approval(tool: str, args: dict, reason: str) -> int:
    with connect() as c:
        cur = c.execute(
            "INSERT INTO approvals (tool, args, reason, created_at) VALUES (?,?,?,?)",
            (tool, json.dumps(args), reason, now()))
        return cur.lastrowid


def pending_approvals() -> list[sqlite3.Row]:
    with connect() as c:
        return c.execute(
            "SELECT * FROM approvals WHERE status='pending' ORDER BY id").fetchall()


def decide_approval(approval_id: int, status: str, result: str = "") -> None:
    with connect() as c:
        c.execute("UPDATE approvals SET status=?, result=?, decided_at=? WHERE id=?",
                  (status, result, now(), approval_id))


def log_run(summary: str) -> None:
    with connect() as c:
        c.execute("INSERT INTO runs (started_at, summary) VALUES (?,?)", (now(), summary))


def last_run_time() -> str | None:
    with connect() as c:
        row = c.execute("SELECT started_at FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        return row["started_at"] if row else None


def get_approval(approval_id: int):
    with connect() as c:
        return c.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()


def recent_approvals(limit: int = 15) -> list[sqlite3.Row]:
    with connect() as c:
        return c.execute("SELECT * FROM approvals WHERE status!='pending' "
                         "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()


def claim_approval(approval_id: int) -> bool:
    """Atomically move pending -> sending. False if someone already took it."""
    with connect() as c:
        return c.execute("UPDATE approvals SET status='sending' WHERE id=? AND status='pending'",
                         (approval_id,)).rowcount == 1
