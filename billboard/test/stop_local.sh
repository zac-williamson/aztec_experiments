#!/usr/bin/env bash
# ============================================================
# stop_local.sh — Stop the local Aztec network
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AZTEC_PID_FILE="${AZTEC_PID_FILE:-$SCRIPT_DIR/aztec.pid}"

if [ ! -f "$AZTEC_PID_FILE" ]; then
  echo "No PID file found at $AZTEC_PID_FILE — nothing to stop."
  # Try to find processes on our ports
  pkill -f "aztec-anvil.*--port 5854" 2>/dev/null || true
  pkill -f "aztec start --local-network.*--port 5080" 2>/dev/null || true
  exit 0
fi

echo "Stopping local network..."
while read -r PID; do
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "  Killing PID $PID..."
    kill "$PID" 2>/dev/null || true
  fi
done < "$AZTEC_PID_FILE"

sleep 2

# Force kill any remaining
while read -r PID; do
  kill -9 "$PID" 2>/dev/null || true
done < "$AZTEC_PID_FILE"

rm -f "$AZTEC_PID_FILE"

# Also kill any stray processes on our ports
pkill -f "aztec-anvil.*--port 5854" 2>/dev/null || true
pkill -f "aztec start --local-network.*--port 5080" 2>/dev/null || true

echo "Stopped."
