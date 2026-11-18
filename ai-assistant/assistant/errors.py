"""Plain-language messages for errors that come back from the Claude API."""


def explain_error(e: Exception) -> str:
    import anthropic
    msg = getattr(e, "message", None) or str(e)
    if isinstance(e, anthropic.APIStatusError):
        try:
            msg = e.body["error"]["message"]
        except Exception:
            pass
        if "credit balance" in msg:
            return ("Your Anthropic API account is out of credit. Add credit at "
                    "console.anthropic.com/settings/billing, then try again.")
        if e.status_code == 401:
            return "The API key was rejected. Create a new key and paste it into the .env file."
        if e.status_code == 404 and "model" in msg:
            return f"Your account can't use this model: {msg}. Change ASSISTANT_MODEL in .env."
        if e.status_code == 429:
            return "Claude is rate limiting requests right now. Wait a minute and try again."
        return f"Claude API error {e.status_code}: {msg}"
    if isinstance(e, anthropic.APIConnectionError):
        return "Couldn't reach the Claude API. Check your internet connection."
    return f"{type(e).__name__}: {msg}"
