#!/usr/bin/env bash
# ============================================================
# run_integration.sh — Full integration test on local Aztec network
# ============================================================
#
# This script runs the complete billboard flow against a local
# Aztec network using `aztec-wallet` with pre-funded test accounts.
#
# Prerequisites:
#   - Local network must be running (./start_local.sh)
#   - aztec-wallet must be on PATH
#   - Test accounts must be imported (aztec-wallet import-test-accounts)
#
# Flow:
#   1. Deploy billboard contract (L2 only — L1 portal tested separately)
#   2. Verify init parameters (post_count, censor, k, min_deposit, cooldown)
#   3. Flag post 0 before any posts exist (should fail — invalid index)
#   4. Transfer censor rights (test0 → test1 → back)
#   5. Verify old censor lost rights
#
# NOTE: The full L1→L2 deposit/claim/withdraw flow is tested via the
# Noir TestEnvironment tests (which support L1→L2 messaging) and the
# mainnet CLI tests. This integration test focuses on L2-only flows
# that can be tested with pre-funded accounts.
#
# Usage:
#   ./run_integration.sh [CONTRACT_SALT]
#
# Environment:
#   AZTEC_NODE_URL  — Aztec node URL (default: http://localhost:5080)
#   SKIP_START      — if set, don't start/stop the network
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BILLBOARD_DIR="$PROJECT_ROOT/billboard"

AZTEC_NODE_URL="${AZTEC_NODE_URL:-http://localhost:5080}"
CONTRACT_SALT="${1:-9999}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

pass=0
fail=0

section() {
    echo ""
    echo -e "${BLUE}=== $1 ===${NC}"
}

check() {
    local desc="$1"
    local actual="$2"
    local expected="$3"
    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✓${NC} $desc (got: $actual)"
        pass=$((pass + 1))
    else
        echo -e "  ${RED}✗${NC} $desc (expected: $expected, got: $actual)"
        fail=$((fail + 1))
    fi
}

check_contains() {
    local desc="$1"
    local haystack="$2"
    local needle="$3"
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✓${NC} $desc"
        pass=$((pass + 1))
    else
        echo -e "  ${RED}✗${NC} $desc (expected to contain: $needle)"
        fail=$((fail + 1))
    fi
}

check_fails() {
    local desc="$1"
    local output="$2"
    local error_msg="$3"
    if echo "$output" | grep -qi "error\|failed\|revert"; then
        echo -e "  ${GREEN}✓${NC} $desc (correctly failed)"
        pass=$((pass + 1))
    else
        echo -e "  ${RED}✗${NC} $desc (expected to fail with: $error_msg)"
        fail=$((fail + 1))
    fi
}

# Wallet CLI helper
WALLET="aztec-wallet"
# Use --prover none for fast local testing (no proof generation)
WALLET_OPTS="--node-url $AZTEC_NODE_URL --prover none"

# Deployer = test0, Censor = test1
DEPLOYER="test0"
CENSOR="test1"
CENSOR_ADDR=$(aztec-wallet get-alias accounts:test1 --node-url "$AZTEC_NODE_URL" 2>/dev/null | grep -E '^0x[0-9a-f]{64}$' | head -1)
if [ -z "$CENSOR_ADDR" ]; then
    # Fallback: import test accounts first
    echo "  Importing test accounts..."
    aztec-wallet import-test-accounts --node-url "$AZTEC_NODE_URL" 2>/dev/null
    CENSOR_ADDR=$(aztec-wallet get-alias accounts:test1 --node-url "$AZTEC_NODE_URL" 2>/dev/null | grep -E '^0x[0-9a-f]{64}$' | head -1)
fi
DEPLOYER_ADDR=$(aztec-wallet get-alias accounts:test0 --node-url "$AZTEC_NODE_URL" 2>/dev/null | grep -E '^0x[0-9a-f]{64}$' | head -1)

echo "  Deployer: $DEPLOYER ($DEPLOYER_ADDR)"
echo "  Censor:   $CENSOR ($CENSOR_ADDR)"

# ============================================================
# Start network if needed
# ============================================================
if [ -z "${SKIP_START:-}" ]; then
    section "Starting local network"
    "$SCRIPT_DIR/start_local.sh"
    # Import test accounts
    echo "  Importing test accounts..."
    aztec-wallet import-test-accounts --node-url "$AZTEC_NODE_URL" 2>/dev/null || true
    CENSOR_ADDR=$(aztec-wallet get-alias accounts:test1 --node-url "$AZTEC_NODE_URL" 2>/dev/null | grep -E '^0x[0-9a-f]{64}$' | head -1)
    DEPLOYER_ADDR=$(aztec-wallet get-alias accounts:test0 --node-url "$AZTEC_NODE_URL" 2>/dev/null | grep -E '^0x[0-9a-f]{64}$' | head -1)
fi

# ============================================================
# Step 1: Deploy contract
# ============================================================
section "Deploying billboard contract"

MIN_DEPOSIT=1000000000000000   # 0.001 ETH in wei
BASE_COOLDOWN=10
K=4
CENSOR_WINDOW=3600
MAX_SAVE_UP=16
POLICY_LEN=0  # empty policy for integration tests
# Build JSON array of 48 zero fields for the policy array (POLICY_FIELDS=48)
# aztec-wallet CLI expects arrays as JSON strings, not individual args
POLICY_JSON=$(node -e "process.stdout.write(JSON.stringify(Array(48).fill('0')))")

DEPLOY_OUTPUT=$(cd "$BILLBOARD_DIR" && aztec-wallet deploy @billboard_contract/Billboard \
    --from "$DEPLOYER" \
    --args "$MIN_DEPOSIT" "$BASE_COOLDOWN" "$CENSOR_ADDR" "$K" "$CENSOR_WINDOW" "$MAX_SAVE_UP" "$POLICY_JSON" "$POLICY_LEN" \
    --init init \
    --node-url "$AZTEC_NODE_URL" \
    --prover none \
    -a bbtest \
    --json 2>&1)

# Extract contract address: the JSON block with contract info appears at the end.
# The last "address" match in the output is the deployed contract address.
CONTRACT_ADDR=$(echo "$DEPLOY_OUTPUT" | grep -oP '"address":\s*"\K0x[a-f0-9]+' | tail -1)

if [ -z "$CONTRACT_ADDR" ]; then
    echo -e "${RED}Deploy failed:${NC}"
    echo "$DEPLOY_OUTPUT" | tail -20
    if [ -z "${SKIP_START:-}" ]; then "$SCRIPT_DIR/stop_local.sh"; fi
    exit 1
fi

echo "  Contract deployed at: $CONTRACT_ADDR"
check_contains "Deploy succeeded" "$DEPLOY_OUTPUT" "contract"

# Helper for simulate
simulate() {
    local fn="$1"
    shift
    local -a cmd=(aztec-wallet simulate "$fn" \
        --from "$DEPLOYER" \
        --contract-address "$CONTRACT_ADDR" \
        --node-url "$AZTEC_NODE_URL" \
        --prover none)
    if [ $# -gt 0 ]; then cmd+=(--args "$@"); fi
    "${cmd[@]}" 2>&1 | grep "Simulation result:" | sed 's/.*Simulation result:\s*//' | tr -d ' ' || true
}

# Helper for send
send() {
    local from="$1"
    local fn="$2"
    shift 2
    local -a cmd=(aztec-wallet send "$fn" \
        --from "$from" \
        --contract-address "$CONTRACT_ADDR" \
        --node-url "$AZTEC_NODE_URL" \
        --prover none)
    if [ $# -gt 0 ]; then cmd+=(--args "$@"); fi
    "${cmd[@]}" 2>&1 || true
}

# ============================================================
# Step 2: Verify init parameters
# ============================================================
section "Verifying init parameters"

POST_COUNT=$(simulate get_post_count)
check "Initial post count" "$POST_COUNT" "0n"

CENSOR_CHECK=$(simulate get_censor)
check_contains "Censor set correctly" "$CENSOR_CHECK" "$CENSOR_ADDR"

K_CHECK=$(simulate get_k_multiplier)
check "K multiplier" "$K_CHECK" "4n"

MIN_DEP_CHECK=$(simulate get_min_deposit)
check "Min deposit" "$MIN_DEP_CHECK" "1000000000000000n"

COOLDOWN_CHECK=$(simulate get_base_cooldown)
check "Base cooldown" "$COOLDOWN_CHECK" "10n"

CW_CHECK=$(simulate get_censor_window)
check "Censor window" "$CW_CHECK" "3600n"

MSU_CHECK=$(simulate get_max_save_up)
check "Max save up" "$MSU_CHECK" "16n"

PORTAL_SET=$(simulate is_portal_set)
check "Portal not set" "$PORTAL_SET" "false"

# Moderation policy (empty at deploy)
# get_moderation_policy returns [[fields...], len] which is multi-line,
# so we can't use the simulate() helper (which only captures one line).
# Call aztec-wallet directly and extract the last number (the length).
POLICY_RAW=$(aztec-wallet simulate get_moderation_policy \
    --from "$DEPLOYER" \
    --contract-address "$CONTRACT_ADDR" \
    --node-url "$AZTEC_NODE_URL" \
    --prover none 2>&1 || true)
POLICY_LEN_CHECK=$(echo "$POLICY_RAW" | grep -oP '\d+(?=n)' | tail -1)
check "Policy length is 0" "${POLICY_LEN_CHECK:-0}" "0"

# ============================================================
# Step 3: Test set_moderation_policy + declare_immoral access control
# ============================================================
section "Testing set_moderation_policy access control"

# Non-censor tries to set policy → should fail
# aztec-wallet expects arrays as JSON strings
POLICY_JSON2=$(node -e "process.stdout.write(JSON.stringify(Array(48).fill('0')))")
SET_POL_OUTPUT=$(send "$DEPLOYER" set_moderation_policy "$POLICY_JSON2" 1 2>&1)
check_fails "Non-censor cannot set_moderation_policy" "$SET_POL_OUTPUT" "Only censor can set policy"

# Censor successfully sets a non-empty policy
# Encode "Be excellent to each other." into 48 fields (31 bytes each)
POLICY_TEXT="Be excellent to each other."
POLICY_JSON3=$(node -e "
  const text = process.argv[1];
  const fields = Array(48).fill('0');
  const bytes = Buffer.from(text, 'utf8');
  for (let i = 0; i < bytes.length && i < 48*31; i++) {
    const fieldIdx = Math.floor(i / 31);
    const byteIdx = i % 31;
    fields[fieldIdx] = (BigInt(fields[fieldIdx]) + (BigInt(bytes[i]) << (8n * BigInt(byteIdx)))).toString();
  }
  process.stdout.write(JSON.stringify(fields));
" "$POLICY_TEXT" 2>&1)
POLICY_BYTES_LEN=${#POLICY_TEXT}
SET_POL_OK=$(send "$CENSOR" set_moderation_policy "$POLICY_JSON3" "$POLICY_BYTES_LEN" 2>&1)
check_contains "Censor can set_moderation_policy" "$SET_POL_OK" "Transaction\|success\|mined"

# Verify policy length is now correct
POLICY_RAW2=$(aztec-wallet simulate get_moderation_policy \
    --from "$DEPLOYER" \
    --contract-address "$CONTRACT_ADDR" \
    --node-url "$AZTEC_NODE_URL" \
    --prover none 2>&1 || true)
POLICY_LEN_CHECK2=$(echo "$POLICY_RAW2" | grep -oP '\d+(?=n)' | tail -1)
check "Policy length is $POLICY_BYTES_LEN" "${POLICY_LEN_CHECK2:-0}" "$POLICY_BYTES_LEN"

section "Testing declare_immoral access control"

# Non-censor tries to flag → should fail
# declare_immoral takes (post_index: u32, response: [Field; 32])
RESPONSE_JSON=$(node -e "process.stdout.write(JSON.stringify(Array(32).fill('0')))")
FLAG_OUTPUT=$(send "$DEPLOYER" declare_immoral 0 "$RESPONSE_JSON" 2>&1)
check_fails "Non-censor cannot declare_immoral" "$FLAG_OUTPUT" "Only censor can declare immoral"

# Censor tries to flag post 0 (doesn't exist yet) → should fail on index
FLAG_OUTPUT2=$(send "$CENSOR" declare_immoral 0 "$RESPONSE_JSON" 2>&1)
check_fails "Censor cannot flag non-existent post" "$FLAG_OUTPUT2" "Invalid post index"

# ============================================================
# Step 4: Test transfer_censor
# ============================================================
section "Testing transfer_censor"

# Non-censor tries to transfer → should fail
TRANSFER_OUTPUT=$(send "$DEPLOYER" transfer_censor "$DEPLOYER_ADDR" 2>&1)
check_fails "Non-censor cannot transfer_censor" "$TRANSFER_OUTPUT" "Only censor can transfer rights"

# Censor transfers to deployer (test0)
TRANSFER_OUTPUT2=$(send "$CENSOR" transfer_censor "$DEPLOYER_ADDR" 2>&1)
check_contains "Censor can transfer rights" "$TRANSFER_OUTPUT2" "Transaction\|success\|mined"

# Verify censor changed
CENSOR_CHECK2=$(simulate get_censor)
check_contains "Censor is now deployer" "$CENSOR_CHECK2" "$DEPLOYER_ADDR"

# Old censor tries to transfer back → should fail
TRANSFER_OUTPUT3=$(send "$CENSOR" transfer_censor "$CENSOR_ADDR" 2>&1)
check_fails "Old censor lost rights" "$TRANSFER_OUTPUT3" "Only censor can transfer rights"

# New censor (deployer) transfers back to original censor
TRANSFER_OUTPUT4=$(send "$DEPLOYER" transfer_censor "$CENSOR_ADDR" 2>&1)
check_contains "New censor can transfer back" "$TRANSFER_OUTPUT4" "Transaction\|success\|mined"

# Verify censor is back to original
CENSOR_CHECK3=$(simulate get_censor)
check_contains "Censor restored" "$CENSOR_CHECK3" "$CENSOR_ADDR"

# ============================================================
# Step 5: Test transfer_censor to zero address
# ============================================================
section "Testing transfer_censor edge cases"

# Censor tries to transfer to zero address → should fail
ZERO_ADDR="0x0000000000000000000000000000000000000000000000000000000000000000"
TRANSFER_OUTPUT5=$(send "$CENSOR" transfer_censor "$ZERO_ADDR" 2>&1)
check_fails "Cannot transfer to zero address" "$TRANSFER_OUTPUT5" "Cannot transfer to zero address"

# ============================================================
# Step 6: Test get_post on invalid index
# ============================================================
section "Testing view function validation"

GET_POST_OUTPUT=$(aztec-wallet simulate get_post 0 --from "$DEPLOYER" --contract-address "$CONTRACT_ADDR" --node-url "$AZTEC_NODE_URL" --prover none 2>&1 || true)
check_fails "get_post rejects invalid index" "$GET_POST_OUTPUT" "Invalid post id"

GET_FLAG_OUTPUT=$(simulate is_post_flagged 0)
check_contains "is_post_flagged(0) returns false" "$GET_FLAG_OUTPUT" "false"

# ============================================================
# Summary
# ============================================================
section "Integration Test Results"
echo -e "  ${GREEN}Passed:${NC} $pass"
echo -e "  ${RED}Failed:${NC} $fail"
echo ""

if [ "$fail" -gt 0 ]; then
    echo -e "${RED}INTEGRATION TESTS FAILED${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}ALL INTEGRATION TESTS PASSED${NC}"
    EXIT_CODE=0
fi

# ============================================================
# Cleanup
# ============================================================
if [ -z "${SKIP_START:-}" ]; then
    section "Stopping local network"
    "$SCRIPT_DIR/stop_local.sh"
fi

exit $EXIT_CODE
