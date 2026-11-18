"""Budget, eating habits, fitness and appointments (all stored locally)."""
from datetime import date, datetime

from .. import db, life
from . import tool

NOTE = ("Spending data comes from the user's Copilot export. ")


@tool("life", NOTE + "Import a Copilot transactions CSV the user placed in the imports folder "
      "(the Budget page can also do this).", {"filename": {"type": "string"}}, ["filename"])
def import_transactions(filename):
    p = life.safe_import_path(filename)
    r = life.import_transactions_csv(p.read_text(encoding="utf-8-sig", errors="replace"))
    return f"Imported {r['added']} new transactions ({r['already_had']} already had, {r['skipped']} skipped). " \
           f"Data covers {r['first_date']} to {r['last_date']}."


@tool("life", NOTE + "Spending this month (or another month) by category next to the user's limits.",
      {"month": {"type": "string", "description": "YYYY-MM; default = latest month with data"}})
def spending_summary(month=None):
    month = month or (life.latest_tx_date() or date.today().isoformat())[:7]
    rows = life.spending_by_category(month)
    if not rows:
        return "No spending data yet. Ask the user to import their Copilot export."
    return f"Spending for {month} (data through {life.latest_tx_date()}):\n" + "\n".join(
        f"- {r['category']}: ${r['spent']:,.0f}" + (f" of ${r['limit']:,.0f} limit" if r["limit"] else "")
        for r in rows[:25])


@tool("life", "Set (or remove, with 0) the user's monthly spending limit for a category.",
      {"category": {"type": "string"}, "monthly_amount": {"type": "number"}},
      ["category", "monthly_amount"])
def set_budget_limit(category, monthly_amount):
    return life.set_limit(category, monthly_amount)


@tool("life", "Tell the assistant how a spending category should be treated for habit alerts.",
      {"category": {"type": "string"},
       "group": {"type": "string", "enum": list(life.GROUPS)}}, ["category", "group"])
def set_category_group(category, group):
    return life.set_category_group(category, group)


@tool("life", "Change an alert level: " + ", ".join(life.DEFAULTS) + ".",
      {"name": {"type": "string", "enum": list(life.DEFAULTS)}, "value": {"type": "number"}},
      ["name", "value"])
def set_alert_setting(name, value):
    life.set_setting(name, value)
    return f"{name} set to {value:g}."


@tool("life", "Check the user's budget, eating-out, shopping, food, fitness and appointment "
      "alerts. Report them kindly and without judgment. For possible under-eating never give "
      "calorie or weight numbers or diet advice; be supportive and suggest their doctor.")
def check_alerts():
    a = life.compute_alerts()
    return "\n".join(f"[{x['level']}] {x['title']}: {x['detail']}" for x in a) or "No alerts."


@tool("life", "Record a meal the user mentions (what and roughly when). No calorie counting.",
      {"meal": {"type": "string", "description": "e.g. 'breakfast: eggs and toast'"},
       "day": {"type": "string", "description": "YYYY-MM-DD, default today"}}, ["meal"])
def log_meal(meal, day=None):
    return life.log_meal(meal, "", day)


@tool("life", "Set a fitness goal, e.g. 4 workouts per week or 120 minutes per week.",
      {"title": {"type": "string"},
       "metric": {"type": "string", "enum": ["workouts", "minutes", "distance_km"]},
       "target": {"type": "number"}, "period": {"type": "string", "enum": ["week", "month"]}},
      ["title", "metric", "target", "period"])
def set_goal(title, metric, target, period):
    with db.connect() as c:
        cur = c.execute("INSERT INTO goals(title,metric,target,period,created_at) VALUES(?,?,?,?,?)",
                        (title, metric, target, period, db.now()))
    return f"Goal #{cur.lastrowid} set: {title}."


@tool("life", "Log a workout the user did.",
      {"kind": {"type": "string"}, "minutes": {"type": "number"},
       "distance": {"type": "number"}, "distance_unit": {"type": "string", "enum": ["km", "mi"]},
       "day": {"type": "string", "description": "YYYY-MM-DD, default today"}}, ["kind"])
def log_workout(kind, minutes=0, distance=0, distance_unit="km", day=None):
    km = distance * 1.609344 if distance_unit == "mi" else distance
    life.log_workout(kind, minutes, round(km, 2), day)
    return f"Logged {kind}."


@tool("life", "Workout progress against goals, plus the last 30 days of workouts.")
def fitness_summary():
    lines = [f"- {g['title']}: {g['done']:g}/{g['target']:g} {g['metric'].replace('_', ' ')} this "
             f"{g['period']} (on track ≈ {g['expected']:g})" for g in life.goal_progress()]
    with db.connect() as c:
        w = c.execute("SELECT day,kind,minutes,distance_km FROM workouts WHERE day >= date('now','-30 day') "
                      "ORDER BY day DESC LIMIT 40").fetchall()
    lines.append(f"Last 30 days: {len(w)} workouts.")
    lines += [f"  {r['day']} {r['kind']} {r['minutes']:g} min" + (f", {r['distance_km']:g} km" if r["distance_km"] else "")
              for r in w[:10]]
    return "\n".join(lines) if lines else "No goals or workouts yet."


@tool("life", "Import workouts from an Apple Health export (export.zip) the user put in the imports folder.",
      {"filename": {"type": "string"}}, ["filename"])
def import_apple_health(filename):
    r = life.import_apple_health(life.safe_import_path(filename))
    return f"Found {r['workouts_found']} workouts; added {r['added']} new."


@tool("life", "Add an appointment (doctor, dentist, beauty, other) to the user's list. Keep the purpose "
      "short and non-sensitive. status 'booked' only if it is actually confirmed.",
      {"kind": {"type": "string", "enum": ["doctor", "dentist", "beauty", "other"]},
       "provider": {"type": "string"}, "purpose": {"type": "string"},
       "start": {"type": "string", "description": "Local date-time YYYY-MM-DDTHH:MM, if known"},
       "minutes": {"type": "integer"},
       "status": {"type": "string", "enum": ["to_book", "booked"]},
       "booking_link": {"type": "string", "description": "https:// link to the booking page, if known"},
       "notes": {"type": "string"}}, ["kind"])
def add_appointment(kind, provider="", purpose="", start="", minutes=60, status="to_book",
                    booking_link="", notes=""):
    if booking_link and not booking_link.startswith("https://"):
        booking_link = ""
    if start:
        datetime.fromisoformat(start)
    with db.connect() as c:
        cur = c.execute("INSERT INTO appointments(kind,provider,purpose,start,minutes,status,booking_link,notes,created_at) "
                        "VALUES(?,?,?,?,?,?,?,?,?)",
                        (kind, provider, purpose, start, minutes, status, booking_link, notes, db.now()))
    return f"Appointment #{cur.lastrowid} added ({status})."


@tool("life", "List the user's appointments.", {"include_past": {"type": "boolean"}})
def list_appointments(include_past=False):
    q = "SELECT * FROM appointments" + ("" if include_past else " WHERE status IN ('to_book','booked')")
    with db.connect() as c:
        rows = c.execute(q + " ORDER BY start='' , start").fetchall()
    return "\n".join(f"#{r['id']} [{r['status']}] {r['kind']}"
                     + (f" with {r['provider']}" if r["provider"] else "")
                     + (f", {r['purpose']}" if r["purpose"] else "")
                     + (f" — {r['start']}" if r["start"] else " — no time yet")
                     + (f" — book at {r['booking_link']}" if r["booking_link"] else "") for r in rows) or "No appointments."


@tool("life", "Update an appointment's status or time (e.g. after the user says they booked it).",
      {"appointment_id": {"type": "integer"},
       "status": {"type": "string", "enum": ["to_book", "booked", "done", "cancelled"]},
       "start": {"type": "string"}, "notes": {"type": "string"}}, ["appointment_id"])
def update_appointment(appointment_id, status=None, start=None, notes=None):
    with db.connect() as c:
        for col, v in (("status", status), ("start", start), ("notes", notes)):
            if v is not None:
                if col == "start" and v:
                    datetime.fromisoformat(v)
                c.execute(f"UPDATE appointments SET {col}=? WHERE id=?", (v, appointment_id))
    return f"Appointment #{appointment_id} updated."
