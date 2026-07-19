#!/usr/bin/env bash
# Helper: start network + run integration tests in one process
# (avoids sandbox issues with long-running background processes)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Kill any stray processes on our ports
for pid in $(pgrep -f "local-network" 2>/dev/null || true); do kill "$pid" 2>/dev/null || true; done
sleep 2

# Start anvil
aztec-anvil --port 5854 --host 127.0.0.1 > "$SCRIPT_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!

# Wait for anvil
for i in $(seq 1 15); do
  if curl -s -X POST "http://localhost:5854" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null | grep -q "result"; then
    echo "Anvil ready!"
    break
  fi
  sleep 1
done

# Start aztec L2
aztec start --local-network --node-debug --port 5080 --admin-port 5880 \
  --l1-rpc-urls "http://localhost:5854" > "$SCRIPT_DIR/aztec.log" 2>&1 &
AZTEC_PID=$!

# Wait for aztec
echo "Waiting for aztec L2..."
for i in $(seq 1 120); do
  if curl -s -X POST "http://localhost:5080" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"aztec_getNodeInfo","params":[],"id":1}' 2>/dev/null | grep -q "chainId"; then
    echo "Aztec ready after $i seconds!"
    break
  fi
  sleep 1
done

# Import test accounts
echo "Importing test accounts..."
aztec-wallet import-test-accounts --node-url "http://localhost:5080" 2>/dev/null || true

# Ensure contract artifact is transpiled
BB_PATH=$(find /nix/store -maxdepth 5 -path "*/bb.js/build/amd64-linux/bb" -type f 2>/dev/null | head -1)
if [ -n "$BB_PATH" ]; then
  echo "Transpiling contract artifact with bb..."
  "$BB_PATH" aztec_process -i "$SCRIPT_DIR/../target/billboard_contract-Billboard.json" -o "$SCRIPT_DIR/../target/billboard_contract-Billboard.json" 2>&1 | tail -3
else
  echo "WARNING: bb not found, assuming artifact already transpiled"
fi

# Run integration tests
echo "Running integration tests..."
SKIP_START=1 bash "$SCRIPT_DIR/run_integration.sh"
RESULT=$?

# Cleanup
echo "Cleaning up..."
kill $AZTEC_PID 2>/dev/null || true
kill $ANVIL_PID 2>/dev/null || true
sleep 2

exit $RESULT
