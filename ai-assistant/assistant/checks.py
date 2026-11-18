"""The regular check: one pass over everything new, shared by the CLI, the
schedule and the web UI."""
from datetime import datetime
from pathlib import Path
from typing import Callable

from . import db
from .config import DATA_DIR, ENABLED_TOOLS, LOOKBACK_HOURS
from .tools import available_sources

SOURCE_NAMES = {"gmail": "Gmail (unread / important)", "outlook": "Outlook (unread / important)",
                "linkedin": "LinkedIn activity", "notes": "Apple Notes I've changed",
                "imessage": "iMessages"}


def run_check(on_event: Callable[[dict], None] | None = None) -> tuple[str, Path]:
    """Run one check. Returns (brief text, path of the saved brief)."""
    from .agent import Agent
    sources = available_sources(ENABLED_TOOLS)
    checks = ", ".join(v for k, v in SOURCE_NAMES.items() if k in sources)
    last = db.last_run_time()
    window = f"since {last}" if last else f"in the last {LOOKBACK_HOURS} hours"
    title = f"Brief — {datetime.now():%a %b %d, %H:%M}"
    save = (f"save it as an Apple Note titled '{title}' in a folder named 'Assistant'"
            if "notes" in sources else "reply with it in full (it is saved to a file for you)")
    prompt = (f"Do my regular check of everything new {window}: {checks}. Add action items "
              "to my task list, save draft replies where a reply is clearly needed, queue "
              f"anything that needs my approval, call check_alerts and include anything it reports, then write today's brief and {save}.")
    brief = Agent(verbose=False, on_event=on_event).ask(prompt)
    db.log_run(brief)
    folder = DATA_DIR / "briefs"
    folder.mkdir(exist_ok=True)
    path = folder / f"{datetime.now():%Y-%m-%d_%H%M%S}.md"
    path.write_text(f"# {title}\n\n{brief}\n", encoding="utf-8")
    return brief, path
