"""LinkedIn, read through the notification emails LinkedIn sends to Gmail.

LinkedIn has no public API for your personal messages, invitations or feed,
and automating the website breaks LinkedIn's terms (and can get the account
restricted). Its notification emails carry the same information: new
messages, connection requests, InMail, job alerts, comments and mentions.
Make sure these are turned on under LinkedIn > Settings > Notifications > Email.
"""
from . import gmail, tool

CATEGORIES = {
    "messages": 'from:(messages-noreply@linkedin.com OR inmail-hit-reply@linkedin.com)',
    "invitations": 'from:invitations@linkedin.com',
    "notifications": 'from:(notifications-noreply@linkedin.com OR updates-noreply@linkedin.com)',
    "jobs": 'from:(jobalerts-noreply@linkedin.com OR jobs-noreply@linkedin.com)',
}


@tool("linkedin", "Get recent LinkedIn activity (messages, InMail, connection invitations, "
      "mentions/comments, job alerts) from LinkedIn's notification emails. To reply to a "
      "LinkedIn message, the user must do it on LinkedIn: add a task instead.",
      {"newer_than_hours": {"type": "integer", "default": 24},
       "category": {"type": "string", "enum": ["all", *CATEGORIES]}})
def linkedin_updates(newer_than_hours=24, category="all"):
    days = max(1, round(newer_than_hours / 24))
    sources = CATEGORIES.values() if category == "all" else [CATEGORIES[category]]
    query = f"({' OR '.join(f'({s})' for s in sources)}) newer_than:{days}d"
    rows = gmail.search(query, 30)
    if not rows:
        return "No LinkedIn activity in that window."
    return "\n".join(f"[{r['id']}] {r['date']} | {r['from']} | {r['subject']} — {r['snippet']}"
                     for r in rows) + "\n(Use read_gmail with an id for full details.)"
