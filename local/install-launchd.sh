#!/bin/bash
# Runs local/now-sync.mjs every 30 minutes (and at login) via launchd.
# Usage: bash local/install-launchd.sh        install / update
#        bash local/install-launchd.sh remove  uninstall
set -euo pipefail
LABEL="site.gloria.now-sync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/now-sync.mjs"
NODE="$(command -v node || true)"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
if [ "${1:-}" = "remove" ]; then rm -f "$PLIST"; echo "Removed $LABEL."; exit 0; fi
[ -n "$NODE" ] || { echo "Node.js not found. Install it first (brew install node)."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$SCRIPT</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NODE"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StartInterval</key><integer>1800</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/gloria-now.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/gloria-now.log</string>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL: runs every 30 minutes. Log: ~/Library/Logs/gloria-now.log"
