"""iMessage / SMS on macOS.

Reading: opens ~/Library/Messages/chat.db read-only. macOS protects this file,
so give your terminal app (or the Python that runs the assistant) Full Disk
Access under System Settings > Privacy & Security > Full Disk Access.

Sending: uses AppleScript to drive the Messages app, and always needs your
approval first.
"""
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from . import tool
from .macos import osascript

CHAT_DB = Path.home() / "Library/Messages/chat.db"
APPLE_EPOCH = datetime(2001, 1, 1)


def _decode_attributed_body(blob: bytes | None) -> str:
    """Newer macOS often stores text only in attributedBody (a typedstream).
    Pull out the NSString payload; good enough for reading messages."""
    if not blob:
        return ""
    try:
        data = blob.split(b"NSString", 1)[1][5:]  # skip class header bytes
        length = data[0]
        start = 1
        if length == 0x81:  # 2-byte little-endian length follows
            length = int.from_bytes(data[1:3], "little")
            start = 3
        return data[start:start + length].decode("utf-8", "replace")
    except Exception:
        return ""


def _contacts_map() -> dict[str, str]:
    """Best-effort phone/email -> name map from the Contacts app."""
    try:
        raw = osascript('''
tell application "Contacts"
    set out to {}
    repeat with p in people
        set nm to name of p
        repeat with ph in phones of p
            set end of out to (value of ph) & "\t" & nm
        end repeat
        repeat with em in emails of p
            set end of out to (value of em) & "\t" & nm
        end repeat
    end repeat
    set AppleScript's text item delimiters to linefeed
    return out as text
end tell''', timeout=60)
    except Exception:
        return {}
    m = {}
    for line in raw.splitlines():
        if "\t" in line:
            handle, name = line.split("\t", 1)
            key = re.sub(r"[^\d+@a-z.]", "", handle.lower())
            m[key] = name
            if key.startswith("+1"):
                m[key[2:]] = name
    return m


def _name(handle: str, contacts: dict) -> str:
    key = re.sub(r"[^\d+@a-z.]", "", (handle or "").lower())
    return contacts.get(key) or contacts.get(key.removeprefix("+1")) or handle


@tool("imessage", "Get recent iMessages/SMS received (and optionally sent), grouped by "
      "conversation, with sender names from Contacts.",
      {"hours": {"type": "integer", "default": 24},
       "include_sent": {"type": "boolean", "default": True},
       "limit": {"type": "integer", "default": 150}})
def recent_imessages(hours=24, include_sent=True, limit=150):
    if not CHAT_DB.exists():
        return "Messages database not found (this only works on a Mac signed in to iMessage)."
    since = int((datetime.now() - timedelta(hours=hours) - APPLE_EPOCH).total_seconds() * 1e9)
    try:
        conn = sqlite3.connect(f"file:{CHAT_DB}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        return f"Can't open Messages database ({e}). Grant Full Disk Access; see README."
    rows = conn.execute("""
        SELECT m.date, m.is_from_me, m.text, m.attributedBody, h.id AS handle,
               c.display_name, c.chat_identifier
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.date > ? AND m.associated_message_type = 0
        ORDER BY m.date DESC LIMIT ?""", (since, limit)).fetchall()
    conn.close()
    if not rows:
        return "No messages in that window."
    contacts = _contacts_map()
    convos: dict[str, list[str]] = {}
    for date, from_me, text, attributed, handle, display, ident in reversed(rows):
        if from_me and not include_sent:
            continue
        body = text or _decode_attributed_body(attributed)
        if not body.strip():
            body = "[attachment]"
        when = (APPLE_EPOCH + timedelta(seconds=date / 1e9)).strftime("%m-%d %H:%M")
        convo = display or _name(ident or handle, contacts)
        who = "Me" if from_me else _name(handle, contacts)
        convos.setdefault(f"{convo} (reply-to: {ident or handle})", []).append(
            f"  {when} {who}: {body[:500]}")
    return "\n\n".join(f"{k}\n" + "\n".join(v) for k, v in convos.items())


@tool("imessage", "Send an iMessage to a phone number or Apple ID email.",
      {"recipient": {"type": "string", "description": "Phone (+15551234567) or email"},
       "text": {"type": "string"}},
      ["recipient", "text"], needs_approval=True)
def send_imessage(recipient, text):
    osascript('''
on run argv
    tell application "Messages"
        set svc to 1st account whose service type = iMessage
        send (item 2 of argv) to participant (item 1 of argv) of svc
    end tell
end run''', recipient, text)
    return f"iMessage sent to {recipient}."
