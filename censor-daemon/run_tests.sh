#!/usr/bin/env bash
# Local checks use disposable fixtures, no real wallets or network transactions.
# --with-docker requires Docker and the cached pinned probe image; never skips.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != '--with-docker' ) ]]; then
  echo 'Usage: run_tests.sh [--with-docker]' >&2
  exit 2
fi
node "$SCRIPT_DIR/test_moderation.mjs"
node "$SCRIPT_DIR/test_signer.mjs"
node "$SCRIPT_DIR/test_daemon.mjs"
node --test "$SCRIPT_DIR/test_wallet_authority.mjs"
if [[ "${1:-}" == '--with-docker' ]]; then
  node --test "$SCRIPT_DIR/model-runtime.test.mjs"
fi
