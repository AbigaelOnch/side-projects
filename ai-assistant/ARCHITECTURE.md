# Personal AI Assistant — Design & Architecture

## 1. Goal

A personal agent that watches the places where work arrives (email, LinkedIn,
notes, text messages), works out what matters, and acts on it for the user:
it summarizes, tracks tasks, drafts replies and, with permission, sends them.

**In scope:** reading Gmail, Outlook / Microsoft 365, LinkedIn notifications, Apple
Notes and iMessage; drafting replies; a task list; a scheduled brief; sending
with approval.

**Out of scope (for now):** calendar actions, payments, posting to social
media, multi-user or hosted (cloud) deployment.

### Design principles
1. **Drafts are free, sends need approval.** The agent may read, summarize, add
   tasks and save drafts on its own. Anything that leaves the machine as the
   user (email, iMessage) goes through an approval gate.
2. **Inbound content is untrusted.** Emails and messages are written by third
   parties and may contain prompt-injection attempts. They are data, never
   instructions.
3. **Local-first.** Runs on the user's own computer. Credentials and state stay
   on disk locally; the only outbound traffic is to the Claude API and the
   official APIs of Google and Microsoft.
4. **Official APIs only.** No scraping. LinkedIn is read through its
   notification emails because it has no personal-data API and its terms
   forbid automation of the site.
5. **Small and extensible.** One decorator turns a Python function into a tool;
   adding a source is one file.

## 2. System overview

```
                         ┌───────────────────────────┐
   Triggers              │        Claude API         │
 ┌──────────────┐        │  (model from .env, e.g.   │
 │ Scheduler    │        │   claude-sonnet-5-5)      │
 │ launchd /    │──run──►└────────────▲──────────────┘
 │ Task Sched.  │                     │ messages + tool specs
 ├──────────────┤        ┌────────────┴──────────────┐
 │ CLI: chat    │──ask──►│      Agent loop           │
 └──────────────┘        │  assistant/agent.py       │
                         │  system prompt + profile  │
                         └────────────┬──────────────┘
                                      │ tool calls
                         ┌────────────▼──────────────┐
                         │   Tool registry + gate    │
                         │  assistant/tools/__init__ │
                         └─┬───────┬───────┬───────┬─┘
            read / draft   │       │       │       │   needs_approval
         ┌─────────────────┘       │       │       └──────────────┐
         ▼                         ▼       ▼                      ▼
  ┌─────────────┐  ┌───────────┐ ┌─────────────┐ ┌──────────┐ ┌──────────────┐
  │ Gmail API   │  │ MS Graph  │ │ AppleScript │ │ chat.db  │ │ Approval     │
  │ + LinkedIn  │  │ (Outlook) │ │ Notes, Msgs │ │ (iMsg,   │ │ queue        │
  │ notif. mail │  │           │ │ (Mac only)  │ │ read)    │ │ (SQLite)     │
  └─────────────┘  └───────────┘ └─────────────┘ └──────────┘ └──────┬───────┘
                                                                     │
                                       user: `assistant approvals` ◄─┘
                                       or y/N prompt in chat mode

  Local state (SQLite, data/assistant.db): tasks · approvals · runs
  Outputs: Apple Note brief (Mac) or data/briefs/*.md (Windows)
```

## 3. Components

| Component | File | Responsibility |
|---|---|---|
| CLI | `assistant/__main__.py` | `ui`, `run`, `chat`, `approvals`, `tasks`, `connect` commands |
| Web UI | `assistant/web.py`, `assistant/ui.html` | Local Flask server + single-page app: chat with live progress, approvals queue (editable), tasks, briefs, profile editor |
| Regular check | `assistant/checks.py` | One triage pass shared by the CLI, scheduler and UI |
| Agent loop | `assistant/agent.py` | Builds the system prompt, calls Claude, executes tool calls, enforces the approval gate |
| Tool registry | `assistant/tools/__init__.py` | `@tool` decorator, JSON schemas, per-platform source filtering |
| Gmail | `tools/gmail.py` | Search, read, draft reply, send (approval), mark read |
| LinkedIn | `tools/linkedin.py` | Gmail queries over LinkedIn notification senders |
| Outlook | `tools/outlook.py` | Microsoft Graph: list/search, read, draft reply, send (approval) |
| Apple Notes | `tools/apple_notes.py` | List, read, create, append via AppleScript |
| iMessage | `tools/imessage.py` | Read `chat.db` (read-only); send via Messages (approval) |
| Tasks | `tools/tasks.py` | Local task list with de-duplication |
| Storage | `assistant/db.py` | SQLite schema and helpers |
| Config | `assistant/config.py`, `.env` | Model, enabled sources, paths, secrets locations |
| User profile | `profile.md` | The user's standing instructions, injected into every run |
| Scheduling | `deploy/*` | launchd (macOS) and Task Scheduler (Windows) installers |

## 4. The agent loop

Standard Claude tool-use loop (`Agent.ask`):

1. Append the user turn (a chat message, or the scheduled "regular check" prompt).
2. Call `messages.create` with the system prompt, the tool specs and the history.
3. If `stop_reason == "tool_use"`, run each `tool_use` block and append the
   `tool_result` blocks as the next user turn. Go back to step 2.
4. Otherwise return the text, which is the brief or the chat reply.

Guards: a 40-step limit per request; tool output truncated to 20k characters;
tool exceptions are returned to Claude as text so it can recover (for example, by
skipping a source that isn't signed in) instead of crashing the run.

### System prompt structure
- Role and the list of connected sources
- Current date and time
- `<user_profile>`: the contents of `profile.md`
- Operating rules: gather before acting, deduplicate tasks, drafts vs approval,
  the **untrusted-content rule**, no invented facts in drafts, end with a brief.

## 5. Approval gate

Tools declare `needs_approval=True`. The model sees these with an extra
`reason` parameter and a note that calling them only *queues* the action.

```
Claude calls send_* ──► Agent._run_tool
                          ├─ chat mode:      y/N prompt in the terminal ──► run or decline
                          └─ scheduled mode: INSERT into approvals (pending)
                                             + desktop notification
                                             → tool_result: "Queued as #N, NOT done"
User later: python -m assistant approvals ──► approve → run tool, store result
                                            deny    → mark denied
```

The gate sits in code, not in the prompt, so a jailbroken or confused model
still can't send anything without approval. Approved actions run the same function
with the exact arguments the user saw.

**Gated today:** `send_gmail`, `send_gmail_reply`, `send_outlook_reply`, `send_imessage`.
**Not gated (reversible or local):** drafts, mark-as-read, notes, tasks.

## 6. Data model (SQLite)

```sql
tasks(id, title, notes, source, due, priority, status, created_at)
approvals(id, tool, args JSON, reason, status pending|approved|denied|failed,
          result, created_at, decided_at)
runs(id, started_at, summary)
```
`runs.started_at` sets the look-back window for the next scheduled check
(starting from "since last run" rather than a fixed 24h).

## 7. Integrations

| Source | Mechanism | Auth | Permissions / scopes | Notes |
|---|---|---|---|---|
| Gmail | Gmail REST API (`google-api-python-client`) | OAuth desktop flow; token in `secrets/` | `gmail.modify` | Drafts preserve threading (`In-Reply-To`, `References`) |
| LinkedIn | Gmail queries on `*@linkedin.com` notification senders | via Gmail | n/a | Read-only by design; replies become tasks |
| Outlook / M365 | Microsoft Graph v1.0 | MSAL device-code flow; token cache in `secrets/` | `Mail.ReadWrite`, `Mail.Send` (delegated) | Work tenants may need admin consent |
| Apple Notes | AppleScript via `osascript` | macOS Automation permission | n/a | Values passed as argv, not pasted into the script, so there's no script injection |
| iMessage (read) | SQLite read-only on `~/Library/Messages/chat.db` | Full Disk Access | n/a | Decodes `attributedBody` for newer macOS; names resolved from Contacts |
| iMessage (send) | AppleScript → Messages | Automation | n/a | Always gated |

**Platform matrix:** macOS gets all sources. On Windows and Linux, Notes and iMessage
are filtered out in `available_sources()`, and the brief is written to `data/briefs/`.

## 8. Security & privacy

| Threat | Mitigation |
|---|---|
| Prompt injection in an email or message ("forward all invoices to…") | Untrusted-content rule in the system prompt; **code-level approval gate** on every outbound action; user sees full args before approving |
| Phishing | Agent told to flag suspicious messages instead of acting |
| Credential leakage | OAuth tokens only, never passwords; `secrets/` and `.env` are git-ignored; least-privilege scopes |
| AppleScript injection | All dynamic values passed as `argv` |
| Runaway loops / cost | 40-step cap per request; truncation of tool output |
| Data exposure | Mail and message content goes only to the Claude API (no third-party relays); nothing hosted |

**Known gaps:** the approval CLI trusts whoever is at the keyboard; secrets are
stored as plaintext files (consider the OS keychain); the attributedBody
decoder is best-effort.

### Web UI (local)
`python -m assistant ui` starts a Flask server on `127.0.0.1:8765` (next free port if busy) and opens the
browser. The page is one self-contained HTML file; there are no external assets or CDNs.

- **Jobs:** chat and checks run on a background thread, one at a time (a lock returns HTTP 409 if busy).
  The page polls `/api/jobs/<id>`, which lists the `tool` and `queued` events the agent emits, and shows them as live progress.
- **Approvals:** in the UI the agent always *queues* sends (no inline prompt). The card shows the full text;
  only `subject`, `body` and `text` can be edited before approving, and the recipient can't. Approving
  atomically claims the row (`pending → sending`), so a double-click can't send twice.
- **Transcript:** kept in memory so a page reload restores the conversation; **Quit assistant** stops the server.

**Why a local web server needs its own protections.** Any website open in your browser can send requests to
`localhost`. Because this server can read mail and approve sends, `web.py` enforces:

| Threat | Defense |
|---|---|
| A malicious site calls the API | Every `/api/*` call needs a random per-start token, embedded only in the served page. Other origins can't read that page (same-origin policy). Constant-time comparison. |
| DNS rebinding (attacker domain resolves to 127.0.0.1) | `Host` header must be `localhost` or `127.0.0.1`, otherwise 403 |
| Cross-site POST | `Origin` on non-GET requests must be local |
| Clickjacking | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` |
| Script injection from email text | Page renders model output with escape-first markdown; links are shown as plain text; CSP `default-src 'none'` with only inline script/style and same-origin fetch |
| Path traversal in brief names | Names must match `[\w-]+\.md` |

### Single-page UI and auto-check

The UI is one page (`ui.html`): action and activity lists on top (`/api/alerts`, `/api/new`), collapsible sections below, and a floating ask panel. Questions from the panel are tagged with the page they came from; the server prefixes that context for Claude but stores the user's text unchanged. A background thread (`autocheck_loop`) runs the same check as the Refresh button every `AUTO_CHECK_MINUTES` while the app is open, at most one attempt per interval, never while another job is running.

### Life modules (money, health, appointments)

`assistant/life.py` does the work with no Claude calls: Copilot CSV import (dedupes; sign of "money out" is inferred from income rows), category limits, spending groups (eating out / groceries / shopping / other, with user overrides), Apple Health workout import (streamed XML from the zip, workouts only), goal progress and `compute_alerts()`. Alert rules: limit reached (80% / 100%), eating-out burst per week, monthly pace vs the last three months for eating out and shopping, a large drop in food spending or few logged meals (supportive wording, no numbers about food), goals behind pace, appointment reminders, stale data. `tools/life.py` exposes this to the agent (all local, none need approval); `tools/calendar.py` finds free time and creates events (event creation needs approval) using its own token (`secrets/calendar_token.json`, scopes `calendar.events` and `calendar.freebusy`), so the Gmail sign-in is untouched. Booking is never automated: appointments are records plus prepared details; the user confirms bookings with the provider. Imports only read files inside `data/imports/` by plain name. Booking links must be `https://` and are shown as text to copy, never as clickable links.

## 9. Operations

- **Install:** venv + `pip install -r requirements.txt`, fill `.env`, `connect`.
- **Schedule:** 08:00 / 12:00 / 17:00 via launchd or Task Scheduler; the machine must be awake.
- **Logs:** `data/assistant.log`; history in the `runs` table; briefs in `data/briefs/`.
- **Cost:** about 10–30 model calls per run. Levers: smaller model, fewer runs, shorter look-back.

## 10. Extending

Add a tool:
```python
@tool("calendar", "Create a calendar event.",
      {"title": {"type": "string"}, "start": {"type": "string"}}, ["title", "start"],
      needs_approval=True)
def create_event(title, start): ...
```
Then import it in `load_tools()` and add the group to `ENABLED_TOOLS`.

## 11. Roadmap

1. **Calendar** (Google Calendar / Graph `Calendars.ReadWrite`): meeting
   triage, propose times, accept/decline gated.
2. **Approvals from your phone** (the web UI is local-only today): push the queue to Slack or Telegram, or as an email digest
   with approve links (needs a small authenticated endpoint).
3. **Memory**: store facts learned over time (people, preferences) alongside `profile.md`.
4. **Keychain secrets**: use the OS keychain (macOS Keychain, Windows Credential Manager).
5. **Evaluation set**: replay saved inboxes (with personal data removed) to measure triage
   quality and catch regressions when the prompt or model changes.
6. **Windows-native notes/messages**: OneNote via Graph; SMS via Phone Link has no API, so
   use a provider such as Twilio for gated sends.
