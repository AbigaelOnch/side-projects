"""Outlook / Microsoft 365 mail via Microsoft Graph (device-code sign-in)."""
import re
from functools import lru_cache

import requests

from ..config import MS_CLIENT_ID, MS_TENANT, MS_TOKEN_CACHE
from . import tool

GRAPH = "https://graph.microsoft.com/v1.0"
SCOPES = ["Mail.ReadWrite", "Mail.Send"]


@lru_cache(maxsize=1)
def _app():
    import msal
    if not MS_CLIENT_ID:
        raise RuntimeError("MS_CLIENT_ID is not set. See README: 'Connect Outlook'.")
    cache = msal.SerializableTokenCache()
    if MS_TOKEN_CACHE.exists():
        cache.deserialize(MS_TOKEN_CACHE.read_text())
    app = msal.PublicClientApplication(
        MS_CLIENT_ID, authority=f"https://login.microsoftonline.com/{MS_TENANT}",
        token_cache=cache)
    return app, cache


def _token() -> str:
    app, cache = _app()
    accounts = app.get_accounts()
    result = app.acquire_token_silent(SCOPES, account=accounts[0]) if accounts else None
    if not result:
        flow = app.initiate_device_flow(scopes=SCOPES)
        if "user_code" not in flow:
            raise RuntimeError(f"Could not start Microsoft sign-in: {flow}")
        print(flow["message"], flush=True)  # tells you the code + URL to sign in
        result = app.acquire_token_by_device_flow(flow)
    if "access_token" not in result:
        raise RuntimeError(f"Microsoft sign-in failed: {result.get('error_description')}")
    if cache.has_state_changed:
        MS_TOKEN_CACHE.parent.mkdir(parents=True, exist_ok=True)
        MS_TOKEN_CACHE.write_text(cache.serialize())
    return result["access_token"]


def _graph(method, path, **kw):
    headers = {"Authorization": f"Bearer {_token()}"}
    if "params" in kw and "$search" in kw["params"]:
        headers["ConsistencyLevel"] = "eventual"
    r = requests.request(method, GRAPH + path, headers=headers, timeout=30, **kw)
    r.raise_for_status()
    return r.json() if r.content else {}


def _fmt(m):
    sender = m.get("from", {}).get("emailAddress", {})
    return (f"[{m['id']}] {'*' if not m.get('isRead') else ' '} {m.get('receivedDateTime')} | "
            f"{sender.get('name')} <{sender.get('address')}> | {m.get('subject')} — "
            f"{(m.get('bodyPreview') or '')[:200]}")


@tool("outlook", "List or search Outlook / Microsoft 365 email. Leave 'search' empty to get "
      "the latest inbox messages; set unread_only to limit to unread mail.",
      {"search": {"type": "string", "description": "Free-text search, e.g. a name or topic"},
       "unread_only": {"type": "boolean", "default": False},
       "since_iso": {"type": "string", "description": "Only mail received after this ISO time"},
       "max_results": {"type": "integer", "default": 20}})
def search_outlook(search="", unread_only=False, since_iso=None, max_results=20):
    params = {"$top": max_results,
              "$select": "id,subject,from,receivedDateTime,bodyPreview,isRead"}
    if search:
        params["$search"] = f'"{search}"'
    else:
        filters = []
        if unread_only:
            filters.append("isRead eq false")
        if since_iso:
            filters.append(f"receivedDateTime ge {since_iso}")
        if filters:
            params["$filter"] = " and ".join(filters)
        params["$orderby"] = "receivedDateTime desc"
    data = _graph("GET", "/me/mailFolders/inbox/messages", params=params)
    msgs = data.get("value", [])
    return "\n".join(_fmt(m) for m in msgs) or "No matching emails."


@tool("outlook", "Read the full text of one Outlook message by id.",
      {"message_id": {"type": "string"}}, ["message_id"])
def read_outlook(message_id):
    m = _graph("GET", f"/me/messages/{message_id}",
               params={"$select": "subject,from,toRecipients,receivedDateTime,body"})
    body = m.get("body", {}).get("content", "")
    if m.get("body", {}).get("contentType") == "html":
        body = re.sub(r"<[^>]+>", " ", re.sub(r"(?is)<(style|script).*?</\1>", "", body))
    sender = m.get("from", {}).get("emailAddress", {})
    to = ", ".join(r["emailAddress"]["address"] for r in m.get("toRecipients", []))
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\s*\n\s*", "\n", body).strip()[:8000]
    return (f"From: {sender.get('name')} <{sender.get('address')}>\nTo: {to}\n"
            f"Date: {m.get('receivedDateTime')}\nSubject: {m.get('subject')}\n\n{body}")


@tool("outlook", "Save a reply to an Outlook message as a draft in the user's Drafts folder. "
      "Nothing is sent.",
      {"message_id": {"type": "string"}, "body": {"type": "string"}},
      ["message_id", "body"])
def draft_outlook_reply(message_id, body):
    d = _graph("POST", f"/me/messages/{message_id}/createReply", json={"comment": body})
    return f"Draft reply saved in Outlook Drafts (id {d.get('id', '?')[:20]}…)."


@tool("outlook", "Send a reply to an Outlook message.",
      {"message_id": {"type": "string"}, "body": {"type": "string"}},
      ["message_id", "body"], needs_approval=True)
def send_outlook_reply(message_id, body):
    _graph("POST", f"/me/messages/{message_id}/reply", json={"comment": body})
    return "Reply sent from Outlook."


@tool("outlook", "Mark an Outlook message as read.",
      {"message_id": {"type": "string"}}, ["message_id"])
def mark_outlook_read(message_id):
    _graph("PATCH", f"/me/messages/{message_id}", json={"isRead": True})
    return "Marked as read."
