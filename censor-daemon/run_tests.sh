#!/usr/bin/env bash
# ============================================================
# run_daemon_tests.sh — Run censor daemon unit + integration tests
# ============================================================
#
# These tests do NOT require:
#   - Real llama.cpp compilation
#   - Real model download
#   - Real Aztec network
#   - Real FeeJuice or ETH
#
# They use mock HTTP servers and mock CLI scripts to test the
# daemon's orchestration logic in isolation.
#
# Usage:
#   ./run_daemon_tests.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Censor Daemon Tests ==="
echo ""

echo "--- Unit tests: moderation parsing (test_moderation.mjs) ---"
if node "$SCRIPT_DIR/test_moderation.mjs"; then
    echo "  ✓ Moderation unit tests passed"
else
    echo "  ✗ Moderation unit tests failed"
    exit 1
fi

echo ""
echo "--- Integration tests: daemon orchestration (test_daemon.mjs) ---"
if node "$SCRIPT_DIR/test_daemon.mjs"; then
    echo "  ✓ Daemon integration tests passed"
else
    echo "  ✗ Daemon integration tests failed"
    exit 1
fi

echo ""
echo "=== All daemon tests passed ==="
