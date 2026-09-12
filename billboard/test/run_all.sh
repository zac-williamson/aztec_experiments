#!/usr/bin/env bash
# ============================================================
# run_all.sh — Run all tests (Noir unit tests + integration tests)
# ============================================================
#
# This script runs the complete test suite:
#   1. Noir unit tests via `aztec test` (fast, in-process, ~30s)
#      - Pure function tests (cooldown, message hashes)
#      - init() validation
#      - Access control (transfer_censor, declare_immoral)
#      - Full flow with L1→L2 messaging and time travel
#      - Screening (child/grandchild Merkle proofs), censor window
#      - Dummy posts, save-up rule, flag penalty
#
#   2. Integration tests on local network (slower, ~5min)
#      - Deploy contract + L1 portal
#      - Deposit ETH → claim on L2
#      - Post, flag, screen, dummy post, withdraw
#      - Transfer censor rights
#
# Usage:
#   ./run_all.sh              — Run both tiers
#   ./run_all.sh --noir-only  — Run only Noir tests
#   ./run_all.sh --integration-only — Run only integration tests
#
# Environment:
#   SKIP_INTEGRATION  — if set, skip integration tests
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BILLBOARD_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_ROOT="$(cd "$BILLBOARD_DIR/.." && pwd)"

MODE="${1:-all}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║        Billboard Test Suite — Full Run               ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"

TOTAL_PASS=0
TOTAL_FAIL=0

# ============================================================
# Tier 1: Noir unit tests
# ============================================================
if [ "$MODE" = "all" ] || [ "$MODE" = "--noir-only" ]; then
    echo ""
    echo -e "${BLUE}=== Tier 1: Noir Unit Tests (aztec test) ===${NC}"
    echo ""

    cd "$BILLBOARD_DIR"
    if (cd "$PROJECT_ROOT" && npm run test:noir) 2>&1; then
        echo -e "  ${GREEN}✓ Noir tests passed${NC}"
        TOTAL_PASS=$((TOTAL_PASS + 1))
    else
        echo -e "  ${RED}✗ Noir tests failed${NC}"
        TOTAL_FAIL=$((TOTAL_FAIL + 1))
    fi
fi

# ============================================================
# Tier 1.5: Censor daemon tests (no network required)
# ============================================================
if [ "$MODE" = "all" ] || [ "$MODE" = "--noir-only" ]; then
    echo ""
    echo -e "${BLUE}=== Tier 1.5: Censor Daemon Tests (mock infra) ===${NC}"
    echo ""

    DAEMON_DIR="$PROJECT_ROOT/censor-daemon"
    if [ -d "$DAEMON_DIR" ]; then
        if bash "$DAEMON_DIR/run_tests.sh" 2>&1; then
            echo -e "  ${GREEN}✓ Daemon tests passed${NC}"
            TOTAL_PASS=$((TOTAL_PASS + 1))
        else
            echo -e "  ${RED}✗ Daemon tests failed${NC}"
            TOTAL_FAIL=$((TOTAL_FAIL + 1))
        fi
    else
        echo -e "  ${YELLOW}Skipping daemon tests (censor-daemon not found)${NC}"
    fi
fi

# ============================================================
# Tier 2: Integration tests on local network
# ============================================================
if [ "$MODE" = "all" ] || [ "$MODE" = "--integration-only" ]; then
    if [ -n "${SKIP_INTEGRATION:-}" ]; then
        echo ""
        echo -e "  ${BLUE}Skipping integration tests (SKIP_INTEGRATION set)${NC}"
    else
        echo ""
        echo -e "${BLUE}=== Tier 2: Integration Tests (local network) ===${NC}"
        echo ""

        if "$SCRIPT_DIR/run_integration.sh"; then
            echo -e "  ${GREEN}✓ Integration tests passed${NC}"
            TOTAL_PASS=$((TOTAL_PASS + 1))
        else
            echo -e "  ${RED}✗ Integration tests failed${NC}"
            TOTAL_FAIL=$((TOTAL_FAIL + 1))
        fi
    fi
fi

# ============================================================
# Summary
# ============================================================
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                Test Suite Summary                    ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║  Test suites passed: ${TOTAL_PASS}                              ║${NC}"
echo -e "${BLUE}║  Test suites failed: ${TOTAL_FAIL}                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"

if [ "$TOTAL_FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
