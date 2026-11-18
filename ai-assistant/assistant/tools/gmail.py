"""Gmail via the official Gmail API (OAuth, runs locally)."""
import base64
from email.message import EmailMessage
from functools import lru_cache

from ..config import GMAIL_CREDENTIALS_FILE, GMAIL_TOKEN_FILE
from . import tool

SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


@lru_cache(maxsize=1)
def service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if GMAIL_TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(GMAIL_TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not GMAIL_CREDENTIALS_FILE.exists():
                raise RuntimeError(f"Gmail credentials not found at {GMAIL_CREDENTIALS_FILE}. "
                                   "See README: 'Connect Gmail'.")
            flow = InstalledAppFlow.from_client_secrets_file(str(GMAIL_CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        GMAIL_TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        GMAIL_TOKEN_FILE.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _header(msg, name):
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def _body_text(payload) -> str:
    """Return the plain-text body, falling back to stripped HTML."""
    def walk(p):
        mime = p.get("mimeType", "")
        data = p.get("body", {}).get("data")
        if mime == "text/plain" and data:
            return base64.urlsafe_b64decode(data).decode("utf-8", "replace")
        for part in p.get("parts", []) or []:
            t = walk(part)
            if t:
                return t
        if mime == "text/html" and data:
            import re
            html = base64.urlsafe_b64decode(data).decode("utf-8", "replace")
            return re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(style|script).*?</\1>", "", html))
        return ""
    return walk(payload)


def search(query: str, max_results: int = 20) -> list[dict]:
    svc = service()
    res = svc.users().messages().list(userId="me", q=query, maxResults=max_results).execute()
    out = []
    for m in res.get("messages", []):
        msg = svc.users().messages().get(
            userId="me", id=m["id"], format="metadata",
            metadataHeaders=["From", "To", "Subject", "Date"]).execute()
        out.append({"id": m["id"], "thread_id": msg["threadId"],
                    "from": _header(msg, "From"), "subject": _header(msg, "Subject"),
                    "date": _header(msg, "Date"), "snippet": msg.get("snippet", ""),
                    "unread": "UNREAD" in msg.get("labelIds", [])})
    return out


@tool("gmail", "Search Gmail with Gmail search syntax (e.g. 'is:unread newer_than:1d', "
      "'from:jane@x.com', 'category:primary'). Returns sender, subject, date and snippet.",
      {"query": {"type": "string"}, "max_results": {"type": "integer", "default": 20}},
      ["query"])
def search_gmail(query, max_results=20):
    rows = search(query, max_results)
    if not rows:
        return "No matching emails."
    return "\n".join(f"[{r['id']}] {'*' if r['unread'] else ' '} {r['date']} | {r['from']} | "
                     f"{r['subject']} — {r['snippet']}" for r in rows)


@tool("gmail", "Read the full text of one Gmail message by id.",
      {"message_id": {"type": "string"}}, ["message_id"])
def read_gmail(message_id):
    msg = service().users().messages().get(userId="me", id=message_id, format="full").execute()
    body = _body_text(msg["payload"]).strip()
    return (f"From: {_header(msg, 'From')}\nTo: {_header(msg, 'To')}\n"
            f"Date: {_header(msg, 'Date')}\nSubject: {_header(msg, 'Subject')}\n"
            f"Thread: {msg['threadId']}\n\n{body[:8000]}")


def _reply_mime(message_id, body):
    svc = service()
    orig = svc.users().messages().get(
        userId="me", id=message_id, format="metadata",
        metadataHeaders=["From", "Reply-To", "Subject", "Message-ID", "References"]).execute()
    subject = _header(orig, "Subject")
    if not subject.lower().startswith("re:"):
        subject = "Re: " + subject
    em = EmailMessage()
    em["To"] = _header(orig, "Reply-To") or _header(orig, "From")
    em["Subject"] = subject
    mid = _header(orig, "Message-ID")
    if mid:
        em["In-Reply-To"] = mid
        em["References"] = (_header(orig, "References") + " " + mid).strip()
    em.set_content(body)
    raw = base64.urlsafe_b64encode(em.as_bytes()).decode()
    return {"raw": raw, "threadId": orig["threadId"]}, em["To"]


@tool("gmail", "Save a reply to a Gmail message as a draft in the user's Drafts folder. "
      "Nothing is sent. Use this for any email that needs a reply.",
      {"message_id": {"type": "string"}, "body": {"type": "string"}},
      ["message_id", "body"])
def draft_gmail_reply(message_id, body):
    msg, to = _reply_mime(message_id, body)
    d = service().users().drafts().create(userId="me", body={"message": msg}).execute()
    return f"Draft saved (draft id {d['id']}) replying to {to}."


@tool("gmail", "Send a reply to a Gmail message.",
      {"message_id": {"type": "string"}, "body": {"type": "string"}},
      ["message_id", "body"], needs_approval=True)
def send_gmail_reply(message_id, body):
    msg, to = _reply_mime(message_id, body)
    service().users().messages().send(userId="me", body=msg).execute()
    return f"Reply sent to {to}."


@tool("gmail", "Send a new email from Gmail.",
      {"to": {"type": "string"}, "subject": {"type": "string"}, "body": {"type": "string"}},
      ["to", "subject", "body"], needs_approval=True)
def send_gmail(to, subject, body):
    em = EmailMessage()
    em["To"], em["Subject"] = to, subject
    em.set_content(body)
    raw = base64.urlsafe_b64encode(em.as_bytes()).decode()
    service().users().messages().send(userId="me", body={"raw": raw}).execute()
    return f"Email sent to {to}."


@tool("gmail", "Mark Gmail messages as read.",
      {"message_ids": {"type": "array", "items": {"type": "string"}}}, ["message_ids"])
def mark_gmail_read(message_ids):
    service().users().messages().batchModify(
        userId="me", body={"ids": message_ids, "removeLabelIds": ["UNREAD"]}).execute()
    return f"Marked {len(message_ids)} message(s) as read."
