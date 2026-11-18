"""The assistant's own task list (stored locally in SQLite)."""
from ..db import connect, now
from . import tool


@tool("tasks", "Add an action item to the user's task list. Use for anything the user "
      "needs to do that came up in email, messages, notes or LinkedIn.",
      {"title": {"type": "string", "description": "Short imperative task title"},
       "notes": {"type": "string", "description": "Context: who asked, links, details"},
       "source": {"type": "string", "description": "Where it came from, e.g. 'Gmail: <subject>'"},
       "due": {"type": "string", "description": "Due date YYYY-MM-DD, if known"},
       "priority": {"type": "string", "enum": ["low", "normal", "high"]}},
      ["title"])
def add_task(title, notes="", source="", due=None, priority="normal"):
    with connect() as c:
        dup = c.execute("SELECT id FROM tasks WHERE status='open' AND lower(title)=lower(?)",
                        (title,)).fetchone()
        if dup:
            return f"Task already exists (#{dup['id']})."
        cur = c.execute(
            "INSERT INTO tasks (title, notes, source, due, priority, created_at) "
            "VALUES (?,?,?,?,?,?)", (title, notes, source, due, priority, now()))
        return f"Added task #{cur.lastrowid}: {title}"


@tool("tasks", "List the user's tasks.",
      {"status": {"type": "string", "enum": ["open", "done", "all"]}})
def list_tasks(status="open"):
    with connect() as c:
        q = "SELECT * FROM tasks" + ("" if status == "all" else " WHERE status=?")
        rows = c.execute(q + " ORDER BY due IS NULL, due, id",
                         () if status == "all" else (status,)).fetchall()
    if not rows:
        return "No tasks."
    return "\n".join(
        f"#{r['id']} [{r['status']}] ({r['priority']}) {r['title']}"
        + (f" — due {r['due']}" if r["due"] else "")
        + (f" — from {r['source']}" if r["source"] else "") for r in rows)


@tool("tasks", "Mark a task as done.", {"task_id": {"type": "integer"}}, ["task_id"])
def complete_task(task_id):
    with connect() as c:
        n = c.execute("UPDATE tasks SET status='done' WHERE id=?", (task_id,)).rowcount
    return f"Task #{task_id} marked done." if n else f"No task #{task_id}."
