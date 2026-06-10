#!/usr/bin/env bash
# Install Mona distill launchd agents (interrupt queue watcher + nightly deep distill).
# Run manually after approval — registers gui-domain LaunchAgents on this machine.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="$SCRIPT_DIR/../worker.py"
PYTHON3="$(command -v python3)"
NEXT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ROOT="${MONA_DATA_ROOT:-$NEXT_ROOT/data/${MONA_DATA_DIRNAME:-mona-english}}"
ROOT="$(cd "$ROOT" && pwd -P)"   # resolve symlink so WatchPaths sees the real dir
QUEUE_DIR="$ROOT/_queue"
mkdir -p "$QUEUE_DIR"

AGENTS_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS_DIR"

for name in watch nightly; do
  src="$SCRIPT_DIR/com.feno.mona-distill-$name.plist.template"
  dst="$AGENTS_DIR/com.feno.mona-distill-$name.plist"
  sed -e "s|__PYTHON3__|$PYTHON3|g" \
      -e "s|__WORKER__|$WORKER|g" \
      -e "s|__QUEUE_DIR__|$QUEUE_DIR|g" \
      -e "s|__PENDING_FILE__|$QUEUE_DIR/pending.json|g" \
      "$src" > "$dst"
  launchctl bootout "gui/$(id -u)" "$dst" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$dst"
  echo "installed $dst"
done
launchctl list | grep com.feno.mona-distill || true
