#!/bin/bash
set -euo pipefail

PLIST_PATH="$HOME/Library/LaunchAgents/com.redprint.transcode-worker.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "Removed: $PLIST_PATH"
else
  echo "No launchd plist found: $PLIST_PATH"
fi
