#!/bin/bash
# Installs a macOS launchd job that runs the assistant on a schedule.
# Usage: ./deploy/install_schedule.sh            (default: 8:00, 12:00, 17:00 daily)
#        ./deploy/install_schedule.sh uninstall
set -euo pipefail

LABEL="com.$(whoami).ai-assistant"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$PROJECT/.venv/bin/python"

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed schedule."
  exit 0
fi

[[ -x "$PYTHON" ]] || { echo "Create the virtualenv first (see README)."; exit 1; }
mkdir -p "$PROJECT/data" "$HOME/Library/LaunchAgents"

times=""
for hour in 8 12 17; do
  times+="<dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>"
done

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PYTHON</string><string>-m</string><string>assistant</string><string>run</string></array>
  <key>WorkingDirectory</key><string>$PROJECT</string>
  <key>StartCalendarInterval</key><array>$times</array>
  <key>StandardOutPath</key><string>$PROJECT/data/assistant.log</string>
  <key>StandardErrorPath</key><string>$PROJECT/data/assistant.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Scheduled: runs at 8:00, 12:00 and 17:00. Log: $PROJECT/data/assistant.log"
echo "Run now with: launchctl kickstart gui/$(id -u)/$LABEL"
