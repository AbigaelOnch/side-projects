"""Helpers for talking to macOS apps through AppleScript."""
import subprocess


def osascript(script: str, *args: str, timeout: int = 60) -> str:
    """Run AppleScript. Values are passed as argv (never pasted into the
    script text), so email/message content can't inject AppleScript."""
    r = subprocess.run(["osascript", "-e", script, *args],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"AppleScript error: {r.stderr.strip()}")
    return r.stdout.strip()


def notify(title: str, message: str) -> None:
    try:
        osascript('on run argv\n display notification (item 2 of argv) with title (item 1 of argv)'
                  '\nend run', title, message[:200])
    except Exception:
        pass  # not on macOS, or notifications blocked
