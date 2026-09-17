#!/bin/sh
# This check MUST precede the first Node process: Node preloads run before JS.
set -eu
if [ -n "${NODE_OPTIONS-}" ] || [ -n "${NODE_PATH-}" ]; then
  echo 'Unsupported Node preload or module-path configuration' >&2; exit 64
fi
if [ "${OTEL_PROPAGATORS-none}" != none ] || [ "${OTEL_SDK_DISABLED-true}" != true ]; then
  echo 'Unsupported telemetry configuration; operator telemetry is disabled' >&2; exit 64
fi
if ! /usr/bin/env | /usr/bin/awk '
 /^OTEL_/ { if ($0 != "OTEL_SDK_DISABLED=true" && $0 != "OTEL_PROPAGATORS=none") bad=1 }
 END { exit bad ? 1 : 0 }'; then
  echo 'Unsupported telemetry configuration; operator telemetry is disabled' >&2; exit 64
fi
case "${1-}" in author|deploy|moderator|recover-wallet) ;; *) echo 'Use author, deploy, moderator or recover-wallet' >&2; exit 64;; esac
root=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")/.." && pwd -P)
[ -x "$root/runtime/bin/node" ] || { echo 'Pinned packaged Node is missing' >&2; exit 64; }
# Fresh process: no inherited global propagator, instrumentation, Node flags or proxies.
exec /usr/bin/env -i HOME="${HOME:?HOME is required}" TMPDIR="${TMPDIR-/tmp}" \
 PATH="$root/runtime/bin:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" \
 LANG=C.UTF-8 OTEL_SDK_DISABLED=true OTEL_PROPAGATORS=none BILLBOARD_OPERATOR_PROFILE=1 \
 "$root/runtime/bin/node" "$root/scripts/operator-launch.mjs" "$@"
