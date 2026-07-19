#!/usr/bin/env bash
# ============================================================
# start_local.sh — Start a local Aztec network for testing
# ============================================================
#
# Starts:
#   1. aztec-anvil L1 at http://localhost:5854 (pre-funded ETH accounts)
#   2. aztec start --local-network at http://localhost:5080 (L2 node + PXE)
#
# Uses 5000s ports to avoid conflicts with host services.
#
# Pre-funded L1 accounts (from mnemonic "test test test test ... junk"):
#   Account 0: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (pk: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
#   Account 1: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 (pk: 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d)
#   ...each with 10000 ETH
#
# Usage:
#   ./start_local.sh
#
# Environment:
#   AZTEC_PID_FILE  — file to write PIDs (default: ./aztec.pid)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AZTEC_PID_FILE="${AZTEC_PID_FILE:-$SCRIPT_DIR/aztec.pid}"

L1_PORT=5854
L2_PORT=5080

echo "=== Starting local Aztec network ==="
echo "  L2 node:  http://localhost:$L2_PORT"
echo "  L1 anvil: http://localhost:$L1_PORT"

# Kill any existing processes
if [ -f "$AZTEC_PID_FILE" ]; then
  while read -r PID; do
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      echo "  Killing existing process (PID $PID)..."
      kill "$PID" 2>/dev/null || true
    fi
  done < "$AZTEC_PID_FILE"
  sleep 2
  # Force kill
  while read -r PID; do
    kill -9 "$PID" 2>/dev/null || true
  done < "$AZTEC_PID_FILE"
  rm -f "$AZTEC_PID_FILE"
fi

# Also kill any stray processes on our ports
pkill -f "aztec-anvil.*--port $L1_PORT" 2>/dev/null || true
pkill -f "aztec start --local-network.*--port $L2_PORT" 2>/dev/null || true
sleep 1

# ============================================================
# 1. Start anvil (L1)
# ============================================================
echo -n "  Starting anvil (L1) on port $L1_PORT..."
nohup aztec-anvil --port "$L1_PORT" --host 127.0.0.1 > "$SCRIPT_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!
echo "$ANVIL_PID" >> "$AZTEC_PID_FILE"
echo " PID $ANVIL_PID"

# Wait for anvil to be ready
for i in $(seq 1 15); do
  if curl -s -X POST "http://localhost:$L1_PORT" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null | grep -q "result"; then
    echo "  Anvil ready!"
    break
  fi
  echo -n "."
  sleep 1
done

# ============================================================
# 2. Start aztec local network (L2)
# ============================================================
echo -n "  Starting aztec L2 on port $L2_PORT..."
nohup aztec start --local-network --node-debug --port "$L2_PORT" --admin-port 5880 --l1-rpc-urls "http://localhost:$L1_PORT" > "$SCRIPT_DIR/aztec.log" 2>&1 &
AZTEC_PID=$!
echo "$AZTEC_PID" >> "$AZTEC_PID_FILE"
echo " PID $AZTEC_PID"

# Wait for the L2 node to be ready
echo -n "  Waiting for L2 node to be ready..."
for i in $(seq 1 90); do
  # Check process is still alive first
  if ! kill -0 "$AZTEC_PID" 2>/dev/null; then
    echo ""
    echo "ERROR: Aztec L2 process died. Last 30 lines of log:"
    tail -30 "$SCRIPT_DIR/aztec.log"
    exit 1
  fi
  if curl -s -X POST "http://localhost:$L2_PORT" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"aztec_getNodeInfo","params":[],"id":1}' 2>/dev/null | grep -q "nodeVersion"; then
    echo " ready!"
    echo ""
    echo "  Node info:"
    curl -s -X POST "http://localhost:$L2_PORT" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"aztec_getNodeInfo","params":[],"id":1}' 2>/dev/null | python3 -m json.tool 2>/dev/null | head -20
    echo ""
    exit 0
  fi
  echo -n "."
  sleep 2
done

echo ""
echo "ERROR: Aztec L2 node did not become ready within 180 seconds."
echo "Check the logs:"
echo "  L2: $SCRIPT_DIR/aztec.log"
echo "  L1: $SCRIPT_DIR/anvil.log"
echo ""
echo "=== Last 30 lines of aztec.log ==="
tail -30 "$SCRIPT_DIR/aztec.log"
exit 1
