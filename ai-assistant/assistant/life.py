"""Money, health and appointment logic that runs locally with no Claude calls:
Copilot CSV import, budget limits, Apple Health import and the alert rules.
The tools in tools/ and the web UI both call into here."""
import csv
import hashlib
import io
import re
import zipfile
from calendar import monthrange
from datetime import date, datetime, timedelta
from pathlib import Path
from statistics import median

from . import db
from .config import DATA_DIR

IMPORT_DIR = DATA_DIR / "imports"
IMPORT_DIR.mkdir(exist_ok=True)
FILENAME_RE = re.compile(r"[\w][\w .\-()]{0,120}\.(csv|zip|xml)", re.I)

DEFAULTS = {"takeout_orders_week": 5, "takeout_jump_pct": 40, "shopping_jump_pct": 50,
            "low_food_pct": 35, "stale_days": 10}
GROUPS = ("eating_out", "groceries", "shopping", "other")
DELIVERY = re.compile(r"doordash|uber ?eats|grubhub|postmates|seamless|caviar|deliveroo|"
                      r"waitr|gopuff|favor delivery", re.I)


def safe_import_path(name: str) -> Path:
    """Only files inside data/imports, by plain file name."""
    name = Path(name).name
    if not FILENAME_RE.fullmatch(name):
        raise ValueError("Use a plain file name ending in .csv, .zip or .xml.")
    p = IMPORT_DIR / name
    if not p.exists():
        raise FileNotFoundError(f"{name} isn't in the imports folder ({IMPORT_DIR}).")
    return p


# --- settings --------------------------------------------------------------

def get_setting(key: str) -> float:
    with db.connect() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return float(r["value"]) if r else float(DEFAULTS[key])


def set_setting(key: str, value: float) -> None:
    if key not in DEFAULTS:
        raise ValueError("Unknown setting. Choices: " + ", ".join(DEFAULTS))
    with db.connect() as c:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                  "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(float(value))))


# --- Copilot CSV import ------------------------------------------------------

def _num(s) -> float | None:
    s = str(s or "").strip().replace("$", "").replace(",", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _day(s) -> str | None:
    s = str(s or "").strip()[:19]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def import_transactions_csv(text: str) -> dict:
    """Import a Copilot 'Export your transactions' CSV. Skips income, transfers and
    excluded rows. Safe to re-run: rows already imported are ignored."""
    rdr = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not rdr.fieldnames:
        raise ValueError("That file is empty.")
    rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in rdr]
    need = {"date", "amount"}
    if not need <= set(rows[0] if rows else rdr.fieldnames):
        raise ValueError("This doesn't look like a Copilot transactions export "
                         "(it needs at least Date and Amount columns).")
    # Which sign means "money out"? The opposite of income's sign; else the majority.
    inc = [_num(r.get("amount")) for r in rows if "income" in r.get("type", "").lower()]
    inc = [v for v in inc if v]
    if inc:
        out_sign = -1 if median(inc) > 0 else 1
    else:
        vals = [_num(r.get("amount")) or 0 for r in rows]
        out_sign = 1 if sum(v > 0 for v in vals) >= sum(v < 0 for v in vals) else -1
    added = skipped = dup = 0
    with db.connect() as c:
        for r in rows:
            kind = (r.get("type") or "regular").lower()
            if kind not in ("regular", "") or r.get("excluded", "").lower() in ("true", "yes", "1"):
                skipped += 1
                continue
            d, a = _day(r.get("date")), _num(r.get("amount"))
            if not d or a is None:
                skipped += 1
                continue
            spend = a * out_sign
            uid = hashlib.sha1(f"{d}|{r.get('name','')}|{a}|{r.get('account','')}".encode()).hexdigest()
            # identical same-day purchases are real: number them
            n = c.execute("SELECT COUNT(*) FROM transactions WHERE uid LIKE ?", (uid + "%",)).fetchone()[0]
            seen_here = sum(1 for x in rows[:rows.index(r)] if x == r)
            uid = f"{uid}:{seen_here}"
            try:
                c.execute("INSERT INTO transactions(tx_date,name,spend,category,parent_category,account,uid) "
                          "VALUES(?,?,?,?,?,?,?)",
                          (d, r.get("name", ""), spend, r.get("category", ""),
                           r.get("parent category", ""), r.get("account", ""), uid))
                added += 1
            except Exception:
                dup += 1
        first, last = c.execute("SELECT MIN(tx_date), MAX(tx_date) FROM transactions").fetchone()
    return {"added": added, "already_had": dup, "skipped": skipped,
            "first_date": first, "last_date": last}


# --- spending groups -----------------------------------------------------------

def group_of(category: str, parent: str, name: str, overrides: dict | None = None) -> str:
    if overrides is None:
        overrides = category_overrides()
    if category in overrides:
        return overrides[category]
    cat = f"{category} {parent}".lower()
    if "grocer" in cat or "supermarket" in cat:
        return "groceries"
    if DELIVERY.search(name or "") or re.search(
            r"restaurant|fast food|coffee|cafe|café|\bbars?\b|dining|takeout|take-out|delivery|"
            r"food & drink|food and drink|alcohol", cat):
        return "eating_out"
    if re.search(r"shop|cloth|apparel|electronic|merchandise|department|amazon|gadget|"
                 r"accessor|online|home goods|furniture", cat):
        return "shopping"
    return "other"


def category_overrides() -> dict:
    with db.connect() as c:
        return {r["category"]: r["grp"] for r in c.execute("SELECT * FROM category_groups")}


def set_category_group(category: str, grp: str) -> str:
    if grp not in GROUPS:
        raise ValueError("Group must be one of: " + ", ".join(GROUPS))
    with db.connect() as c:
        c.execute("INSERT INTO category_groups(category,grp) VALUES(?,?) "
                  "ON CONFLICT(category) DO UPDATE SET grp=excluded.grp", (category, grp))
    return f"'{category}' now counts as {grp.replace('_', ' ')}."


def _tx(since: str, until: str | None = None) -> list[dict]:
    q, a = "SELECT * FROM transactions WHERE tx_date >= ?", [since]
    if until:
        q += " AND tx_date <= ?"
        a.append(until)
    ov = category_overrides()
    with db.connect() as c:
        rows = [dict(r) for r in c.execute(q, a)]
    for r in rows:
        r["grp"] = group_of(r["category"] or "", r["parent_category"] or "", r["name"] or "", ov)
    return rows


def latest_tx_date() -> str | None:
    with db.connect() as c:
        return c.execute("SELECT MAX(tx_date) FROM transactions").fetchone()[0]


def month_bounds(m: str) -> tuple[str, str]:
    y, mo = int(m[:4]), int(m[5:7])
    return f"{m}-01", f"{m}-{monthrange(y, mo)[1]:02d}"


def spending_by_category(month: str) -> list[dict]:
    lo, hi = month_bounds(month)
    tot: dict[str, float] = {}
    for r in _tx(lo, hi):
        k = r["category"] or "Uncategorized"
        tot[k] = tot.get(k, 0) + r["spend"]
    with db.connect() as c:
        limits = {r["category"]: r["monthly"] for r in c.execute("SELECT * FROM limits")}
    out = [{"category": k, "spent": round(v, 2), "limit": limits.get(k)} for k, v in tot.items()]
    out += [{"category": k, "spent": 0.0, "limit": v} for k, v in limits.items() if k not in tot]
    return sorted(out, key=lambda x: -x["spent"])


def set_limit(category: str, monthly: float | None) -> str:
    with db.connect() as c:
        if monthly is None or monthly <= 0:
            c.execute("DELETE FROM limits WHERE category=?", (category,))
            return f"Removed the limit for {category}."
        c.execute("INSERT INTO limits(category,monthly) VALUES(?,?) "
                  "ON CONFLICT(category) DO UPDATE SET monthly=excluded.monthly", (category, monthly))
    return f"Monthly limit for {category}: ${monthly:,.0f}."


def categories_seen() -> list[str]:
    with db.connect() as c:
        return [r[0] for r in c.execute(
            "SELECT DISTINCT category FROM transactions WHERE category<>'' ORDER BY category")]


# --- meals ---------------------------------------------------------------------

def log_meal(meal: str, notes: str = "", day: str | None = None) -> str:
    with db.connect() as c:
        c.execute("INSERT INTO meals(day,meal,notes,created_at) VALUES(?,?,?,?)",
                  (day or date.today().isoformat(), meal, notes, db.now()))
    return f"Logged {meal}."


# --- fitness -------------------------------------------------------------------

def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def log_workout(kind: str, minutes: float = 0, distance_km: float = 0, day: str | None = None,
                notes: str = "", source: str = "manual", uid: str | None = None) -> bool:
    with db.connect() as c:
        try:
            c.execute("INSERT INTO workouts(day,kind,minutes,distance_km,source,notes,uid) "
                      "VALUES(?,?,?,?,?,?,?)",
                      (day or date.today().isoformat(), kind, minutes, distance_km, source, notes, uid))
            return True
        except Exception:
            return False


def goal_progress(today: date | None = None) -> list[dict]:
    today = today or date.today()
    out = []
    with db.connect() as c:
        goals = [dict(r) for r in c.execute("SELECT * FROM goals WHERE active=1")]
        for g in goals:
            lo = week_start(today) if g["period"] == "week" else today.replace(day=1)
            days_in = 7 if g["period"] == "week" else monthrange(today.year, today.month)[1]
            elapsed = (today - lo).days + 1
            col = {"workouts": "COUNT(*)", "minutes": "COALESCE(SUM(minutes),0)",
                   "distance_km": "COALESCE(SUM(distance_km),0)"}[g["metric"]]
            done = c.execute(f"SELECT {col} FROM workouts WHERE day>=? AND day<=?",
                             (lo.isoformat(), today.isoformat())).fetchone()[0]
            g.update(done=round(done, 1), elapsed=elapsed, days_in=days_in,
                     expected=round(g["target"] * elapsed / days_in, 1))
            out.append(g)
    return out


def import_apple_health(path: Path) -> dict:
    """Read workouts from an Apple Health export.zip (or the export.xml inside it)."""
    import xml.etree.ElementTree as ET
    if path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(path)
        member = next((n for n in zf.namelist() if n.lower().endswith("export.xml")
                       and "cda" not in n.lower()), None)
        if not member:
            raise ValueError("That zip doesn't contain Apple Health's export.xml.")
        stream = zf.open(member)
    else:
        stream = open(path, "rb")
    added = seen = 0
    try:
        for _, el in ET.iterparse(stream, events=("end",)):
            if el.tag != "Workout":
                if el.tag in ("Record", "MetadataEntry", "WorkoutEvent", "WorkoutStatistics",
                              "HeartRateVariabilityMetadataList", "InstantaneousBeatsPerMinute"):
                    el.clear()   # keep memory flat on very large exports
                continue
            seen += 1
            a = el.attrib
            start = a.get("startDate", "")[:19]
            kind = re.sub(r"(?<!^)(?=[A-Z])", " ", a.get("workoutActivityType", "").replace(
                "HKWorkoutActivityType", "")) or "Workout"
            dur = float(a.get("duration") or 0)
            unit = a.get("durationUnit", "min")
            minutes = dur / 60 if unit.startswith("s") else dur * 60 if unit.startswith("h") else dur
            dist = float(a.get("totalDistance") or 0)
            du = a.get("totalDistanceUnit", "km")
            km = dist * 1.609344 if du == "mi" else dist / 1000 if du == "m" else dist
            if start and log_workout(kind, round(minutes, 1), round(km, 2), start[:10],
                                     source="apple_health", uid=f"ah:{start}:{kind}"):
                added += 1
            el.clear()
    finally:
        stream.close()
    return {"workouts_found": seen, "added": added}


# --- alerts --------------------------------------------------------------------

def _alert(kind, area, level, title, detail):
    return {"id": f"{kind}", "area": area, "level": level, "title": title, "detail": detail}


def compute_alerts(today: date | None = None) -> list[dict]:
    today = today or date.today()
    out: list[dict] = []
    latest = latest_tx_date()
    fresh = False
    if latest:
        age = (today - date.fromisoformat(latest)).days
        fresh = age <= get_setting("stale_days")
        if not fresh:
            out.append(_alert("stale", "budget", "info", "Your spending data is out of date",
                              f"The newest transaction is from {latest}. Export again from Copilot "
                              "(Settings, Account, Export your transactions) and import it so alerts stay accurate."))
    if latest and fresh:
        anchor = min(today, date.fromisoformat(latest))
        month = f"{anchor:%Y-%m}"
        # 1. category limits
        for r in spending_by_category(month):
            if not r["limit"]:
                continue
            pct = r["spent"] / r["limit"]
            if pct >= 1:
                out.append(_alert(f"limit-{r['category']}", "budget", "warn",
                                  f"Over budget: {r['category']}",
                                  f"${r['spent']:,.0f} spent against a ${r['limit']:,.0f} limit this month."))
            elif pct >= 0.8:
                out.append(_alert(f"limit-{r['category']}", "budget", "info",
                                  f"Close to your {r['category']} limit",
                                  f"${r['spent']:,.0f} of ${r['limit']:,.0f} used, "
                                  f"${r['limit'] - r['spent']:,.0f} left this month."))
        prev_lo = (anchor.replace(day=1) - timedelta(days=1)).replace(day=1) - timedelta(days=62)
        rows = _tx(prev_lo.isoformat(), anchor.isoformat())
        this_m = [r for r in rows if r["tx_date"][:7] == month]
        history = [r for r in rows if r["tx_date"][:7] != month]
        hist_months = sorted({r["tx_date"][:7] for r in history})[-3:]

        def month_avg(grp):
            if not hist_months:
                return None
            return sum(r["spend"] for r in history if r["grp"] == grp
                       and r["tx_date"][:7] in hist_months) / len(hist_months)

        dim = monthrange(anchor.year, anchor.month)[1]
        pace = dim / max(anchor.day, 1)
        # 2. ordering out too much
        week = [r for r in rows if r["tx_date"] > (anchor - timedelta(days=7)).isoformat()
                and r["grp"] == "eating_out" and r["spend"] > 0]
        limit_n = int(get_setting("takeout_orders_week"))
        if len(week) >= limit_n:
            total = sum(r["spend"] for r in week)
            out.append(_alert("takeout-week", "health", "warn", "A lot of eating out this week",
                              f"{len(week)} restaurant, coffee or delivery charges in the last 7 days "
                              f"(${total:,.0f}). Your alert level is {limit_n}; you can change it in chat."))
        eo = sum(r["spend"] for r in this_m if r["grp"] == "eating_out")
        base = month_avg("eating_out")
        if base and anchor.day >= 7 and eo * pace >= base * (1 + get_setting("takeout_jump_pct") / 100) \
                and eo * pace - base >= 75:
            out.append(_alert("takeout-month", "budget", "warn", "Eating out is running above your usual",
                              f"${eo:,.0f} so far this month, on pace for about ${eo * pace:,.0f}. "
                              f"Your recent months averaged ${base:,.0f}."))
        # 3. shopping too much
        sh = sum(r["spend"] for r in this_m if r["grp"] == "shopping")
        base = month_avg("shopping")
        if base and anchor.day >= 7 and sh * pace >= base * (1 + get_setting("shopping_jump_pct") / 100) \
                and sh * pace - base >= 100:
            out.append(_alert("shopping-month", "budget", "warn", "Shopping is running above your usual",
                              f"${sh:,.0f} so far this month, on pace for about ${sh * pace:,.0f}. "
                              f"Your recent months averaged ${base:,.0f}."))
        # 4. possibly not eating enough: a big drop in food spending, or few meals logged
        food7 = sum(r["spend"] for r in rows if r["grp"] in ("eating_out", "groceries")
                    and r["tx_date"] > (anchor - timedelta(days=7)).isoformat())
        older = [r for r in rows if r["grp"] in ("eating_out", "groceries")
                 and (anchor - timedelta(days=63)).isoformat() < r["tx_date"]
                 <= (anchor - timedelta(days=7)).isoformat()]
        span = (anchor - date.fromisoformat(min([r["tx_date"] for r in rows], default=anchor.isoformat()))).days
        if span >= 35 and older:
            weekly = sum(r["spend"] for r in older) / 8
            if weekly >= 40 and food7 < weekly * get_setting("low_food_pct") / 100:
                out.append(_alert("food-low", "health", "info", "Your food spending dropped a lot this week",
                                  "That might just be travel or a stocked fridge. If you've been skipping meals "
                                  "or not eating much, it's worth paying attention to. If it keeps up, "
                                  "I can help you book a check-in with your doctor."))
    # meal check-ins: only if the user uses them
    with db.connect() as c:
        recent = c.execute("SELECT COUNT(*) FROM meals WHERE day >= ?",
                           ((today - timedelta(days=14)).isoformat(),)).fetchone()[0]
        if recent >= 3:
            low_days = 0
            for i in range(1, 4):
                d = (today - timedelta(days=i)).isoformat()
                n = c.execute("SELECT COUNT(*) FROM meals WHERE day=?", (d,)).fetchone()[0]
                low_days += n < 2
            if low_days == 3:
                out.append(_alert("meals-low", "health", "info", "Few meals logged lately",
                                  "You logged fewer than two meals a day for three days. If that's skipped "
                                  "meals rather than skipped logging, consider eating something and "
                                  "talking to your doctor if it's a pattern."))
    # fitness
    gp = goal_progress(today)
    for g in gp:
        if g["elapsed"] >= (4 if g["period"] == "week" else 10) and g["done"] < g["target"] \
                and g["done"] < g["expected"] * 0.6:
            out.append(_alert(f"goal-{g['id']}", "health", "info", f"Behind on: {g['title']}",
                              f"{g['done']:g} of {g['target']:g} {g['metric'].replace('_', ' ')} this "
                              f"{g['period']}; about {g['expected']:g} would be on track."))
    # appointments
    with db.connect() as c:
        for a in c.execute("SELECT * FROM appointments WHERE status IN ('to_book','booked')"):
            label = f"{a['kind']} appointment" + (f" with {a['provider']}" if a["provider"] else "")
            if a["status"] == "booked" and a["start"]:
                try:
                    st = datetime.fromisoformat(a["start"])
                except ValueError:
                    continue
                hrs = (st - datetime.now()).total_seconds() / 3600
                if 0 <= hrs <= 48:
                    out.append(_alert(f"appt-{a['id']}", "appointments", "info", f"Coming up: {label}",
                                      f"{st:%A %b %d, %I:%M %p}".replace(" 0", " ")))
            if a["status"] == "to_book" and (datetime.now() - datetime.fromisoformat(a["created_at"])).days >= 3:
                out.append(_alert(f"appt-{a['id']}", "appointments", "info", f"Still to book: {label}",
                                  "It's been on the list for 3 days or more."))
    order = {"warn": 0, "info": 1}
    return sorted(out, key=lambda a: order[a["level"]])
