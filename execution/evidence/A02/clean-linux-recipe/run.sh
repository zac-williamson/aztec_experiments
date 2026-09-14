#!/usr/bin/env bash
set -euo pipefail
cd /work
export TAR_OPTIONS=--no-same-owner
export PATH="/opt/foundry:$PATH"
exec python3 clean-steps.py
