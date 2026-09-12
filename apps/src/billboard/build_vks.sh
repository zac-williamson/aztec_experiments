#!/usr/bin/env bash
# Process and verify all private-function keys using the pinned package binary.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/build_artifact.mjs" "$@"
