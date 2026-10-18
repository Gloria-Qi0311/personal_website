#!/bin/bash
# Keeps local/agent.mjs running in the background (starts at login,
# restarts if it stops).
# Usage: bash local/install-launchd.sh        install / update
#        bash local/install-launchd.sh remove  uninstall
set -euo pipefail
LABEL="site.gloria.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/agent.mjs"
NODE="$(command -v node || true)"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
if [ "${1:-}" = "remove" ]; then rm -f "$PLIST"; echo "Removed $LABEL."; exit 0; fi
[ -n "$NODE" ] || { echo "Node.js not found. Install it first (brew install node)."; exit 1; }
[ -f "$HOME/.gloria-agent.json" ] || { echo "Run 'node $SCRIPT' once first to create ~/.gloria-agent.json."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$SCRIPT</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/gloria-agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/gloria-agent.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. Log: ~/Library/Logs/gloria-agent.log"
