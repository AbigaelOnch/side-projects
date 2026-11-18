"""Tool registry.

Every integration registers its tools with @tool. Tools marked
needs_approval=True never run directly when the assistant calls them:
they are queued and only run after you approve them (see approvals.py).
"""
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    fn: Callable
    group: str
    needs_approval: bool = False

    def spec(self) -> dict:
        desc = self.description
        if self.needs_approval:
            desc += (" This action needs the user's approval: calling it queues the "
                     "action for review instead of running it immediately.")
        return {"name": self.name, "description": desc, "input_schema": self.input_schema}


REGISTRY: dict[str, Tool] = {}


def tool(group: str, description: str, properties: dict | None = None,
         required: list[str] | None = None, needs_approval: bool = False):
    def wrap(fn):
        REGISTRY[fn.__name__] = Tool(
            name=fn.__name__,
            description=description,
            input_schema={"type": "object", "properties": properties or {},
                          "required": required or []},
            fn=fn, group=group, needs_approval=needs_approval)
        return fn
    return wrap


MAC_ONLY = {"notes", "imessage"}


def available_sources(enabled: set[str]) -> set[str]:
    """Drop Mac-only sources (Apple Notes, iMessage) on Windows/Linux."""
    import sys
    from ..config import MS_CLIENT_ID
    sources = set(enabled) if sys.platform == "darwin" else set(enabled) - MAC_ONLY
    if not MS_CLIENT_ID:  # Outlook isn't set up yet
        sources.discard("outlook")
    return sources


def load_tools(enabled: set[str]) -> dict[str, Tool]:
    enabled = available_sources(enabled)
    # Importing each module registers its tools.
    from . import tasks, life  # noqa: F401  (always on)
    if "gmail" in enabled or "calendar" in enabled:
        from . import calendar  # noqa: F401
    if "gmail" in enabled or "linkedin" in enabled:
        from . import gmail  # noqa: F401
    if "linkedin" in enabled:
        from . import linkedin  # noqa: F401
    if "outlook" in enabled:
        from . import outlook  # noqa: F401
    if "notes" in enabled:
        from . import apple_notes  # noqa: F401
    if "imessage" in enabled:
        from . import imessage  # noqa: F401
    groups = enabled | {"tasks", "life"}
    if "gmail" in enabled:
        groups.add("calendar")  # same Google account; separate sign-in
    if "linkedin" in enabled and "gmail" not in enabled:
        # LinkedIn reads through Gmail, but don't expose general Gmail tools.
        groups.discard("gmail")
    return {n: t for n, t in REGISTRY.items() if t.group in groups}
