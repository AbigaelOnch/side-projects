"""Local web interface for the assistant.

Runs only on this computer (127.0.0.1). Because it can read mail and approve
sends, every request is checked:
  * the Host header must be localhost / 127.0.0.1 (blocks DNS-rebinding attacks)
  * API calls need a random token that is only embedded in the page itself, so
    other websites open in your browser can't read it (same-origin policy)
  * POSTs from other origins are refused, and the page can't be framed
"""
import json
import logging
import os
import re
import secrets
import shutil
import sys
import threading
import urllib.request
import uuid
import webbrowser
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from flask import Flask, Response, abort, jsonify, request

from . import db, life
from .config import (AUTO_CHECK_MINUTES, DATA_DIR, ENABLED_TOOLS, GMAIL_TOKEN_FILE, MODEL, PROFILE_PATH,
                     api_key_problem)
from .errors import explain_error
from .tools import available_sources, load_tools

PAGE = Path(__file__).with_name("ui.html")
FIRST_PORT = 8765
LOCAL_HOSTS = {"127.0.0.1", "localhost"}
VIEW_NAMES = {"today": "Today", "approvals": "Waiting for you", "tasks": "Tasks", "money": "Money",
              "health": "Health", "appts": "Appointments", "briefs": "Briefs"}
EDITABLE_ARGS = {"body", "text", "subject"}   # fields you may edit before approving
CSP = ("default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
       "connect-src 'self'; img-src data:; base-uri 'none'; form-action 'none'; "
       "frame-ancestors 'none'")


def _row(r):
    d = dict(r)
    if "args" in d:
        d["args"] = json.loads(d["args"])
    return d


def calendar_connected() -> bool:
    return "gmail" in available_sources(ENABLED_TOOLS) and \
        GMAIL_TOKEN_FILE.with_name("calendar_token.json").exists()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 4 * 1024**3  # Apple Health exports can be large
    token = secrets.token_urlsafe(32)
    lock = threading.Lock()  # one Claude request at a time
    S = {"agent": None, "tools": None, "jobs": {}, "transcript": [], "active": None}

    def tools():
        if S["tools"] is None:
            S["tools"] = load_tools(ENABLED_TOOLS)
        return S["tools"]

    # ---- protection --------------------------------------------------------
    @app.before_request
    def guard():
        host = request.host.rsplit(":", 1)[0] if ":" in request.host else request.host
        if host not in LOCAL_HOSTS:
            abort(403)
        if request.path.startswith("/api/"):
            sent = request.headers.get("X-Assistant-Token", "")
            if not secrets.compare_digest(sent.encode(), token.encode()):
                abort(403)
            origin = request.headers.get("Origin")
            if request.method != "GET" and origin and urlparse(origin).hostname not in LOCAL_HOSTS:
                abort(403)

    @app.after_request
    def headers(resp):
        resp.headers["Content-Security-Policy"] = CSP
        resp.headers["Cache-Control"] = "no-store"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        return resp

    @app.errorhandler(403)
    def forbidden(_):
        return jsonify(error="Blocked: this page only works from the assistant's own window."), 403

    # ---- page --------------------------------------------------------------
    @app.get("/")
    def index():
        html = PAGE.read_text(encoding="utf-8").replace("__TOKEN__", token)
        return Response(html, mimetype="text/html")

    @app.get("/health")
    def health():
        return jsonify(app="ai-assistant")

    # ---- jobs (chat and checks run in the background; the page polls) -------
    def start_job(kind, fn):
        if not lock.acquire(blocking=False):
            return None
        job = {"id": uuid.uuid4().hex[:10], "kind": kind, "status": "running",
               "events": [], "error": None}
        S["jobs"][job["id"]] = job
        S["active"] = job["id"]
        for old in list(S["jobs"])[:-20]:
            S["jobs"].pop(old, None)

        def worker():
            try:
                fn(job["events"].append)
                job["status"] = "done"
            except Exception as e:  # shown to you in plain words
                job["error"] = explain_error(e)
                job["status"] = "error"
            finally:
                S["active"] = None
                lock.release()

        threading.Thread(target=worker, daemon=True).start()
        return job

    def busy_response():
        return jsonify(error="Still working on the last request. Wait for it to finish."), 409

    @app.get("/api/jobs/<job_id>")
    def job_status(job_id):
        job = S["jobs"].get(job_id)
        if not job:
            return jsonify(error="Unknown job."), 404
        return jsonify(job)

    # ---- chat --------------------------------------------------------------
    def get_agent():
        if S["agent"] is None:
            from .agent import Agent
            S["agent"] = Agent(verbose=False)
        return S["agent"]

    @app.get("/api/chat")
    def chat_get():
        return jsonify(transcript=S["transcript"], active_job=S["active"])

    @app.post("/api/chat")
    def chat_send():
        data = request.get_json(silent=True) or {}
        text = (data.get("text") or "").strip()
        view = data.get("view") if data.get("view") in VIEW_NAMES else "today"
        if not text:
            return jsonify(error="Type a message first."), 400
        problem = api_key_problem()
        if problem:
            return jsonify(error=problem), 400

        def work(emit):
            agent = get_agent()
            agent.on_event = emit
            steps: list[str] = []
            agent.on_event = lambda e: (steps.append(e.get("tool", "")) if e["type"] == "tool" else None,
                                        emit(e))
            S["transcript"].append({"role": "user", "text": text, "view": view, "at": db.now()})
            keep = len(agent.messages)
            try:
                reply = agent.ask(f"[The user is asking from the {VIEW_NAMES[view]} page of the app. "
                                  f"Questions are probably about that area.]\n{text}")
            except Exception as e:
                del agent.messages[keep:]  # drop the half-finished turn, keep earlier context
                S["transcript"].append({"role": "error", "text": explain_error(e), "view": view,
                                        "at": db.now()})
                raise
            S["transcript"].append({"role": "assistant", "text": reply, "steps": steps,
                                    "view": view, "at": db.now()})

        job = start_job("chat", work)
        return busy_response() if job is None else jsonify(job_id=job["id"])

    @app.post("/api/chat/reset")
    def chat_reset():
        if lock.locked():
            return busy_response()
        S["agent"] = None
        S["transcript"] = []
        return jsonify(ok=True)

    def launch_check():
        """Start a check of all accounts; returns the job, or None if busy."""
        def work(emit):
            from .checks import run_check
            steps: list[str] = []
            S["transcript"].append({"role": "user", "text": "Check now", "kind": "check",
                                    "view": "today", "at": db.now()})

            def on_event(e):
                if e["type"] == "tool":
                    steps.append(e.get("tool", ""))
                emit(e)
            try:
                brief, path = run_check(on_event)
            except Exception as e:
                S["transcript"].append({"role": "error", "text": explain_error(e), "view": "today",
                                        "at": db.now()})
                raise
            S["transcript"].append({"role": "assistant", "text": brief, "steps": steps,
                                    "kind": "check", "brief": path.name, "view": "today",
                                    "at": db.now()})
        return start_job("check", work)

    @app.post("/api/check")
    def check_now():
        problem = api_key_problem()
        if problem:
            return jsonify(error=problem), 400
        job = launch_check()
        return busy_response() if job is None else jsonify(job_id=job["id"])

    def autocheck_loop():
        """While the app is open, check on its own every AUTO_CHECK_MINUTES."""
        import time
        time.sleep(15)
        while True:
            try:
                every = AUTO_CHECK_MINUTES * 60
                last = db.last_run_time()
                last_ts = datetime.fromisoformat(last).timestamp() if last else 0
                due = time.time() - max(last_ts, S.get("auto_last", 0)) >= every
                sources = available_sources(ENABLED_TOOLS) - {"gmail"} or \
                    ({"gmail"} if GMAIL_TOKEN_FILE.exists() else set())
                if every and due and sources and not api_key_problem() and not lock.locked():
                    S["auto_last"] = time.time()   # one attempt per interval, even if it fails
                    launch_check()
            except Exception:
                pass
            time.sleep(60)

    app.start_autocheck = lambda: threading.Thread(target=autocheck_loop, daemon=True).start()

    # ---- tasks -------------------------------------------------------------
    @app.get("/api/tasks")
    def tasks_get():
        show_all = request.args.get("status") == "all"
        with db.connect() as c:
            rows = c.execute(
                "SELECT * FROM tasks" + ("" if show_all else " WHERE status='open'") +
                " ORDER BY status DESC, due IS NULL, due, id DESC").fetchall()
        return jsonify(tasks=[dict(r) for r in rows])

    @app.post("/api/tasks")
    def tasks_add():
        from .tools.tasks import add_task
        body = request.get_json(silent=True) or {}
        title = (body.get("title") or "").strip()[:200]
        due = (body.get("due") or "").strip() or None
        priority = body.get("priority") or "normal"
        if not title:
            return jsonify(error="Give the task a title."), 400
        if due and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due):
            return jsonify(error="Use a date like 2026-12-01."), 400
        if priority not in ("low", "normal", "high"):
            return jsonify(error="Priority must be low, normal or high."), 400
        return jsonify(message=add_task(title=title, due=due, priority=priority,
                                        source="Added by you"))

    @app.post("/api/tasks/<int:task_id>")
    def tasks_update(task_id):
        status = (request.get_json(silent=True) or {}).get("status")
        if status not in ("open", "done"):
            return jsonify(error="Status must be open or done."), 400
        with db.connect() as c:
            n = c.execute("UPDATE tasks SET status=? WHERE id=?", (status, task_id)).rowcount
        return (jsonify(ok=True) if n else (jsonify(error="No such task."), 404))

    # ---- approvals ---------------------------------------------------------
    @app.get("/api/approvals")
    def approvals_get():
        return jsonify(pending=[_row(r) for r in db.pending_approvals()],
                       recent=[_row(r) for r in db.recent_approvals()])

    @app.post("/api/approvals/<int:aid>/approve")
    def approvals_approve(aid):
        row = db.get_approval(aid)
        if not row:
            return jsonify(error="No such request."), 404
        t = tools().get(row["tool"])
        if not t or not t.needs_approval:
            return jsonify(error="That action isn't available any more."), 400
        args = json.loads(row["args"])
        edits = (request.get_json(silent=True) or {}).get("args") or {}
        for k, v in edits.items():
            if k in EDITABLE_ARGS and k in args and isinstance(v, str) and v.strip():
                args[k] = v
        if not db.claim_approval(aid):  # stops a double click from sending twice
            return jsonify(error="This request was already handled."), 409
        try:
            result = str(t.fn(**args))
        except Exception as e:
            db.decide_approval(aid, "failed", str(e))
            return jsonify(error=f"It wasn't sent: {e}"), 500
        db.decide_approval(aid, "approved", result)
        return jsonify(ok=True, result=result)

    @app.post("/api/approvals/<int:aid>/deny")
    def approvals_deny(aid):
        row = db.get_approval(aid)
        if not row or row["status"] != "pending":
            return jsonify(error="This request was already handled."), 409
        db.decide_approval(aid, "denied")
        return jsonify(ok=True)

    # ---- what's new: a short feed of recent happenings ------------------------
    @app.get("/api/new")
    def whats_new():
        since = (datetime.now() - timedelta(days=7)).isoformat(timespec="seconds")
        feed = []
        with db.connect() as c:
            for r in c.execute("SELECT title, source, created_at FROM tasks WHERE created_at >= ?", (since,)):
                feed.append({"at": r["created_at"], "text": "New task: " + r["title"]})
            for r in c.execute("SELECT tool, reason, status, decided_at FROM approvals "
                               "WHERE decided_at >= ? AND status IN ('approved','denied','failed')", (since,)):
                word = {"approved": "Done", "denied": "Declined", "failed": "Failed"}[r["status"]]
                feed.append({"at": r["decided_at"], "text": f"{word}: {r['reason'] or r['tool']}"})
            for r in c.execute("SELECT kind, provider, created_at FROM appointments WHERE created_at >= ?", (since,)):
                feed.append({"at": r["created_at"], "text": f"Appointment added: {r['kind']}"
                             + (f" with {r['provider']}" if r["provider"] else "")})
            for r in c.execute("SELECT day, kind, source FROM workouts WHERE day >= ? ORDER BY day DESC LIMIT 5",
                               (since[:10],)):
                feed.append({"at": r["day"] + "T12:00:00", "text": f"Workout: {r['kind']}"})
            last = c.execute("SELECT started_at, summary FROM runs ORDER BY id DESC LIMIT 1").fetchone()
        brief = None
        if last and last["started_at"] >= since:
            line = next((l.strip("#-*• ").strip() for l in (last["summary"] or "").splitlines() if l.strip()), "")
            feed.append({"at": last["started_at"], "text": "Checked your accounts" + (": " + line[:140] if line else "")})
        feed.sort(key=lambda x: x["at"], reverse=True)
        return jsonify(items=feed[:10])

    # ---- briefs ------------------------------------------------------------
    @app.get("/api/briefs")
    def briefs_get():
        folder = DATA_DIR / "briefs"
        items = []
        if folder.exists():
            for p in sorted(folder.glob("*.md"), reverse=True)[:60]:
                first = p.read_text(encoding="utf-8").splitlines()[:1]
                items.append({"name": p.name, "title": (first[0].lstrip("# ") if first else p.name),
                              "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat()})
        return jsonify(briefs=items)

    @app.get("/api/briefs/<name>")
    def brief_get(name):
        if not re.fullmatch(r"[\w\-]+\.md", name):
            abort(404)
        p = DATA_DIR / "briefs" / name
        if not p.exists():
            abort(404)
        return jsonify(name=name, text=p.read_text(encoding="utf-8"))

    # ---- profile -----------------------------------------------------------
    @app.get("/api/profile")
    def profile_get():
        return jsonify(text=PROFILE_PATH.read_text(encoding="utf-8") if PROFILE_PATH.exists() else "")

    @app.post("/api/profile")
    def profile_save():
        text = (request.get_json(silent=True) or {}).get("text")
        if not isinstance(text, str) or len(text) > 20000:
            return jsonify(error="The profile must be text under 20,000 characters."), 400
        PROFILE_PATH.write_text(text, encoding="utf-8")
        return jsonify(ok=True)

    # ---- status / quit -----------------------------------------------------
    @app.get("/api/status")
    def status():
        sources = available_sources(ENABLED_TOOLS)
        with db.connect() as c:
            open_tasks = c.execute("SELECT COUNT(*) FROM tasks WHERE status='open'").fetchone()[0]
            due = c.execute("SELECT COUNT(*) FROM tasks WHERE status='open' AND due IS NOT NULL "
                            "AND due <= ?", (date.today().isoformat(),)).fetchone()[0]
        return jsonify(
            model=MODEL, key_problem=api_key_problem(), sources=sorted(sources),
            gmail_signed_in="gmail" in sources and GMAIL_TOKEN_FILE.exists(),
            gmail_needs_signin="gmail" in sources and not GMAIL_TOKEN_FILE.exists(),
            outlook="outlook" in sources, last_run=db.last_run_time(),
            busy=lock.locked(), active_job=S["active"], auto_minutes=AUTO_CHECK_MINUTES,
            pending=len(db.pending_approvals()), open_tasks=open_tasks, due_tasks=due,
            alerts=len(life.compute_alerts()), calendar=calendar_connected())

    # ---- money, health, appointments ----------------------------------------
    def body():
        return request.get_json(silent=True) or {}

    @app.get("/api/alerts")
    def alerts():
        return jsonify(alerts=life.compute_alerts())

    @app.get("/api/budget")
    def budget():
        latest = life.latest_tx_date()
        month = request.args.get("month") or (latest or date.today().isoformat())[:7]
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            abort(400)
        rows = life.spending_by_category(month)
        groups = {}
        ov = life.category_overrides()
        for r in life._tx(*life.month_bounds(month)):
            groups[r["grp"]] = groups.get(r["grp"], 0) + r["spend"]
        return jsonify(month=month, latest=latest, rows=rows, categories=life.categories_seen(),
                       groups={k: round(v, 2) for k, v in groups.items()})

    @app.post("/api/budget/limit")
    def budget_limit():
        b = body()
        cat = str(b.get("category", "")).strip()[:80]
        if not cat:
            return jsonify(error="Pick a category."), 400
        try:
            amt = float(b.get("monthly") or 0)
        except ValueError:
            return jsonify(error="Enter the limit as a number."), 400
        return jsonify(message=life.set_limit(cat, amt))

    @app.post("/api/import/<kind>")
    def import_file(kind):
        if kind not in ("transactions", "health"):
            abort(404)
        name = re.sub(r"[^\w .\-()]", "_", request.headers.get("X-Filename", "upload"))[-100:]
        want = (".csv",) if kind == "transactions" else (".zip", ".xml")
        if not name.lower().endswith(want):
            return jsonify(error="Wrong kind of file. Choose " + " or ".join(want) + "."), 400
        dest = life.IMPORT_DIR / name
        with open(dest, "wb") as f:
            shutil.copyfileobj(request.stream, f)
        try:
            if kind == "transactions":
                r = life.import_transactions_csv(dest.read_text(encoding="utf-8-sig", errors="replace"))
                msg = (f"Added {r['added']} transactions" +
                       (f" ({r['already_had']} were already here)" if r["already_had"] else "") +
                       f". Data now runs {r['first_date']} to {r['last_date']}.")
            else:
                r = life.import_apple_health(dest)
                msg = f"Found {r['workouts_found']} workouts and added {r['added']} new ones."
        except Exception as e:
            return jsonify(error=str(e)), 400
        return jsonify(message=msg)

    @app.get("/api/health")
    def health_data():
        with db.connect() as c:
            workouts = [dict(r) for r in c.execute("SELECT * FROM workouts ORDER BY day DESC, id DESC LIMIT 20")]
            meals = [dict(r) for r in c.execute("SELECT * FROM meals ORDER BY day DESC, id DESC LIMIT 12")]
        return jsonify(goals=life.goal_progress(), workouts=workouts, meals=meals)

    @app.post("/api/goals")
    def goals_add():
        b = body()
        title = str(b.get("title", "")).strip()[:100]
        if not title or b.get("metric") not in ("workouts", "minutes", "distance_km") \
                or b.get("period") not in ("week", "month"):
            return jsonify(error="Fill in the goal name, what to count and the period."), 400
        try:
            target = float(b.get("target"))
        except (TypeError, ValueError):
            return jsonify(error="The target must be a number."), 400
        with db.connect() as c:
            c.execute("INSERT INTO goals(title,metric,target,period,created_at) VALUES(?,?,?,?,?)",
                      (title, b["metric"], target, b["period"], db.now()))
        return jsonify(ok=True)

    @app.post("/api/goals/<int:gid>/remove")
    def goals_remove(gid):
        with db.connect() as c:
            c.execute("UPDATE goals SET active=0 WHERE id=?", (gid,))
        return jsonify(ok=True)

    @app.post("/api/workouts")
    def workouts_add():
        b = body()
        kind = str(b.get("kind", "")).strip()[:60]
        if not kind:
            return jsonify(error="Say what you did."), 400
        try:
            mins = float(b.get("minutes") or 0)
            dist = float(b.get("distance") or 0)
        except ValueError:
            return jsonify(error="Minutes and distance must be numbers."), 400
        if b.get("unit") == "mi":
            dist *= 1.609344
        life.log_workout(kind, mins, round(dist, 2), (b.get("day") or None))
        return jsonify(ok=True)

    @app.post("/api/meals")
    def meals_add():
        meal = str(body().get("meal", "")).strip()[:120]
        if not meal:
            return jsonify(error="Say what you ate."), 400
        life.log_meal(meal)
        return jsonify(ok=True)

    @app.get("/api/appointments")
    def appointments_get():
        with db.connect() as c:
            rows = [dict(r) for r in c.execute(
                "SELECT * FROM appointments WHERE status IN ('to_book','booked') ORDER BY start='', start")]
        return jsonify(appointments=rows, calendar=calendar_connected())

    @app.post("/api/appointments")
    def appointments_add():
        b = body()
        if b.get("kind") not in ("doctor", "dentist", "beauty", "other"):
            return jsonify(error="Pick the kind of appointment."), 400
        link = str(b.get("booking_link", "")).strip()
        if link and not link.startswith("https://"):
            return jsonify(error="The booking link should start with https://"), 400
        start = str(b.get("start", "")).strip()
        if start:
            try:
                datetime.fromisoformat(start)
            except ValueError:
                return jsonify(error="That date and time isn't valid."), 400
        with db.connect() as c:
            c.execute("INSERT INTO appointments(kind,provider,purpose,start,status,booking_link,created_at) "
                      "VALUES(?,?,?,?,?,?,?)",
                      (b["kind"], str(b.get("provider", ""))[:100], str(b.get("purpose", ""))[:200], start,
                       "booked" if b.get("booked") else "to_book", link, db.now()))
        return jsonify(ok=True)

    @app.post("/api/appointments/<int:aid>")
    def appointments_update(aid):
        st = body().get("status")
        if st not in ("booked", "done", "cancelled", "to_book"):
            abort(400)
        with db.connect() as c:
            c.execute("UPDATE appointments SET status=? WHERE id=?", (st, aid))
        return jsonify(ok=True)

    @app.post("/api/quit")
    def quit_app():
        threading.Timer(0.4, lambda: os._exit(0)).start()
        return jsonify(ok=True)

    return app


def _already_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as r:
            return json.load(r).get("app") == "ai-assistant"
    except Exception:
        return False


def _free_port() -> int:
    import socket
    for port in range(FIRST_PORT, FIRST_PORT + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise RuntimeError("No free port found between 8765 and 8784.")


def serve(open_browser: bool = True) -> None:
    if sys.stdout is None or sys.stderr is None:  # started without a console window
        log = open(DATA_DIR / "ui.log", "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stderr = log
    if _already_running(FIRST_PORT):
        if open_browser:
            webbrowser.open(f"http://127.0.0.1:{FIRST_PORT}/")
        return
    port = _free_port()
    url = f"http://127.0.0.1:{port}/"
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    print(f"[{datetime.now():%H:%M:%S}] Assistant running at {url}", flush=True)
    if open_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    app = create_app()
    app.start_autocheck()
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
