"""Apple Notes via AppleScript (macOS only).

The first run triggers a macOS prompt asking to let your terminal (or Python)
control Notes. Approve it, or enable it later under System Settings >
Privacy & Security > Automation.
"""
import html
import re

from . import tool
from .macos import osascript

SEP = "␞"  # record separator unlikely to appear in notes


@tool("notes", "List Apple Notes, most recently modified first. Optionally only notes "
      "modified in the last N hours, or only those in one folder.",
      {"modified_within_hours": {"type": "integer"},
       "folder": {"type": "string"},
       "limit": {"type": "integer", "default": 30}})
def list_notes(modified_within_hours=None, folder=None, limit=30):
    script = f'''
on run argv
    set hrs to (item 1 of argv) as integer
    set folderName to item 2 of argv
    set out to {{}}
    tell application "Notes"
        if folderName is "" then
            set theNotes to every note
        else
            set theNotes to every note of folder folderName
        end if
        repeat with n in theNotes
            set md to modification date of n
            if hrs is 0 or md > ((current date) - hrs * hours) then
                set end of out to (id of n) & "{SEP}" & (name of n) & "{SEP}" & (md as «class isot» as string)
            end if
        end repeat
    end tell
    set AppleScript's text item delimiters to linefeed
    return out as text
end run'''
    raw = osascript(script, str(modified_within_hours or 0), folder or "", timeout=120)
    rows = [r.split(SEP) for r in raw.splitlines() if r.count(SEP) == 2]
    rows.sort(key=lambda r: r[2], reverse=True)
    if not rows:
        return "No notes found."
    return "\n".join(f"[{nid}] {mod} | {name}" for nid, name, mod in rows[:limit])


def _html_to_text(body: str) -> str:
    body = re.sub(r"(?i)<br\s*/?>|</(div|p|li|h\d)>", "\n", body)
    return html.unescape(re.sub(r"<[^>]+>", "", body)).strip()


@tool("notes", "Read one Apple Note by id (from list_notes).",
      {"note_id": {"type": "string"}}, ["note_id"])
def read_note(note_id):
    body = osascript('on run argv\n tell application "Notes" to return body of note id '
                     '(item 1 of argv)\nend run', note_id)
    return _html_to_text(body)[:8000]


def _to_html(text: str) -> str:
    return "<br>".join(html.escape(line) for line in text.splitlines())


@tool("notes", "Create a new Apple Note (e.g. a daily brief or meeting notes).",
      {"title": {"type": "string"}, "body": {"type": "string"},
       "folder": {"type": "string", "description": "Folder name; default 'Notes'"}},
      ["title", "body"])
def create_note(title, body, folder="Notes"):
    content = f"<h1>{html.escape(title)}</h1>{_to_html(body)}"
    script = '''
on run argv
    tell application "Notes"
        if not (exists folder (item 1 of argv)) then make new folder with properties {name:(item 1 of argv)}
        set n to make new note at folder (item 1 of argv) with properties {body:(item 2 of argv)}
        return id of n
    end tell
end run'''
    nid = osascript(script, folder, content)
    return f"Created note '{title}' in {folder} ({nid})."


@tool("notes", "Append text to the end of an existing Apple Note.",
      {"note_id": {"type": "string"}, "text": {"type": "string"}}, ["note_id", "text"])
def append_to_note(note_id, text):
    script = '''
on run argv
    tell application "Notes"
        set n to note id (item 1 of argv)
        set body of n to (body of n) & (item 2 of argv)
    end tell
end run'''
    osascript(script, note_id, "<br>" + _to_html(text))
    return "Appended to note."
