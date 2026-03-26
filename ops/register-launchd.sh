#!/bin/bash
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.redprint.transcode-worker.plist"

mkdir -p "$PLIST_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.redprint.transcode-worker</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>-lc</string>
      <string>cd \"$WORKER_DIR\" && /usr/local/bin/docker compose up -d --build</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>$WORKER_DIR/worker-launchd.log</string>

    <key>StandardErrorPath</key>
    <string>$WORKER_DIR/worker-launchd.err.log</string>
  </dict>
</plist>
PLIST

# Handle Apple Silicon Homebrew default path
if [ ! -x /usr/local/bin/docker ] && [ -x /opt/homebrew/bin/docker ]; then
  sed -i '' 's|/usr/local/bin/docker|/opt/homebrew/bin/docker|g' "$PLIST_PATH"
fi

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load "$PLIST_PATH"

echo "Installed and loaded: $PLIST_PATH"
echo "Check worker status with: docker ps | grep redprint-worker"
