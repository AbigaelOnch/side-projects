"""Google Calendar: find free time and (after approval) put events on the calendar.
Uses its own sign-in token so the Gmail sign-in is never disturbed."""
from datetime import datetime, timedelta
from functools import lru_cache

from ..config import GMAIL_CREDENTIALS_FILE, GMAIL_TOKEN_FILE
from . import tool

SCOPES = ["https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/calendar.freebusy"]
TOKEN_FILE = GMAIL_TOKEN_FILE.with_name("calendar_token.json")


def signed_in() -> bool:
    return TOKEN_FILE.exists()


@lru_cache(maxsize=1)
def service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build
    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(GMAIL_CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _local_tz():
    return datetime.now().astimezone().tzinfo


@tool("calendar", "Find free time slots on the user's Google Calendar.",
      {"days_ahead": {"type": "integer", "description": "How many days to look (max 21)"},
       "minutes": {"type": "integer", "description": "Length needed"},
       "earliest_hour": {"type": "integer"}, "latest_hour": {"type": "integer"},
       "weekdays_only": {"type": "boolean"}}, ["minutes"])
def find_free_times(minutes, days_ahead=10, earliest_hour=9, latest_hour=17, weekdays_only=True):
    tz = _local_tz()
    start = datetime.now(tz)
    end = start + timedelta(days=min(days_ahead, 21))
    fb = service().freebusy().query(body={"timeMin": start.isoformat(), "timeMax": end.isoformat(),
                                          "items": [{"id": "primary"}]}).execute()
    busy = [(datetime.fromisoformat(b["start"]).astimezone(tz), datetime.fromisoformat(b["end"]).astimezone(tz))
            for b in fb["calendars"]["primary"]["busy"]]
    slots, day = [], start.date()
    while day <= end.date() and len(slots) < 12:
        if not (weekdays_only and day.weekday() >= 5):
            t = datetime(day.year, day.month, day.day, earliest_hour, tzinfo=tz)
            close = datetime(day.year, day.month, day.day, latest_hour, tzinfo=tz)
            while t + timedelta(minutes=minutes) <= close and len(slots) < 12:
                e = t + timedelta(minutes=minutes)
                if t > start and not any(t < b1 and e > b0 for b0, b1 in busy):
                    slots.append(t)
                    t = e
                else:
                    t += timedelta(minutes=30)
        day += timedelta(days=1)
    return "Free times:\n" + "\n".join(f"- {s:%a %b %d, %I:%M %p}".replace(" 0", " ") for s in slots) \
        if slots else "No free slots found in that window."


@tool("calendar", "Put an event on the user's Google Calendar. Use a short neutral title "
      "(e.g. 'Appointment', not the medical reason).",
      {"title": {"type": "string"}, "start": {"type": "string", "description": "Local YYYY-MM-DDTHH:MM"},
       "minutes": {"type": "integer"}, "location": {"type": "string"}},
      ["title", "start", "minutes"], needs_approval=True)
def add_calendar_event(title, start, minutes, location=""):
    tz = _local_tz()
    s = datetime.fromisoformat(start).replace(tzinfo=tz)
    ev = service().events().insert(calendarId="primary", body={
        "summary": title, "location": location,
        "start": {"dateTime": s.isoformat()},
        "end": {"dateTime": (s + timedelta(minutes=minutes)).isoformat()}}).execute()
    return f"Added to your calendar: {title}, {s:%a %b %d %I:%M %p}."
