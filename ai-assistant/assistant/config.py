import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
# override=True: values in .env win over any (possibly empty) variables
# already set in the Windows/macOS environment.
load_dotenv(ENV_FILE, override=True, encoding="utf-8-sig")


def api_key_problem() -> str | None:
    """Explain what's wrong with the API key setup, without revealing the key."""
    if ENV_FILE.exists():
        lines = ENV_FILE.read_text(encoding="utf-8-sig", errors="replace").splitlines()
    elif os.getenv("ANTHROPIC_API_KEY"):
        lines = []  # key set as a real environment variable instead
    else:
        names = [p.name for p in ROOT.glob(".env*")]
        return (f"No .env file found in {ROOT}. Files starting with .env here: {names}. "
                "If you see '.env.txt', rename it to '.env'.")
    key_lines = [i + 1 for i, l in enumerate(lines)
                 if l.strip().lstrip("#").strip().startswith("ANTHROPIC_API_KEY")]
    active = [i + 1 for i, l in enumerate(lines) if l.strip().startswith("ANTHROPIC_API_KEY")]
    key = os.getenv("ANTHROPIC_API_KEY", "").strip().strip('"').strip("'")
    loose = [i + 1 for i, l in enumerate(lines) if "sk-ant-" in l and "=" not in l]
    where = f"(.env lines mentioning ANTHROPIC_API_KEY: {key_lines or 'none'})"
    if loose:
        return (f"Found what looks like a key on line(s) {loose} of .env, but not after "
                f"'ANTHROPIC_API_KEY='. Put it on that line instead, e.g. "
                f"ANTHROPIC_API_KEY=sk-ant-api03-... {where}")
    if not key:
        return f"ANTHROPIC_API_KEY is empty. {where}"
    if key == "sk-ant-..." or "..." in key:
        return (f"ANTHROPIC_API_KEY is still the placeholder 'sk-ant-...'. Replace the whole "
                f"placeholder with your key. {where}")
    if not key.startswith("sk-ant-"):
        return (f"ANTHROPIC_API_KEY doesn't start with 'sk-ant-' (starts with "
                f"'{key[:3]}…', {len(key)} characters). {where}")
    if " " in key:
        return f"ANTHROPIC_API_KEY contains a space. {where}"
    if len(active) > 1:
        print(f"Note: ANTHROPIC_API_KEY appears on several lines {active}; the last one is used.")
    return None


def _path(name: str, default: str) -> Path:
    p = Path(os.getenv(name, default)).expanduser()
    return p if p.is_absolute() else ROOT / p


MODEL = os.getenv("ASSISTANT_MODEL", "claude-sonnet-5-5")
ENABLED_TOOLS = {t.strip() for t in os.getenv(
    "ENABLED_TOOLS", "gmail,outlook,linkedin,notes,imessage,tasks").split(",") if t.strip()}

DATA_DIR = _path("DATA_DIR", "data")
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "assistant.db"

PROFILE_PATH = ROOT / "profile.md"          # your own copy; never committed
_example = ROOT / "profile.example.md"
if not PROFILE_PATH.exists() and _example.exists():
    PROFILE_PATH.write_text(_example.read_text(encoding="utf-8"), encoding="utf-8")
LOOKBACK_HOURS = int(os.getenv("LOOKBACK_HOURS", "24"))
AUTO_CHECK_MINUTES = int(os.getenv("AUTO_CHECK_MINUTES", "60") or 0)   # 0 = only when you press Check now
NOTIFY = os.getenv("NOTIFY", "true").lower() == "true"

GMAIL_CREDENTIALS_FILE = _path("GMAIL_CREDENTIALS_FILE", "secrets/gmail_credentials.json")
GMAIL_TOKEN_FILE = _path("GMAIL_TOKEN_FILE", "secrets/gmail_token.json")

MS_CLIENT_ID = os.getenv("MS_CLIENT_ID", "")
MS_TENANT = os.getenv("MS_TENANT", "common")
MS_TOKEN_CACHE = _path("MS_TOKEN_CACHE", "secrets/ms_token_cache.json")
