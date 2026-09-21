#!/bin/bash
# Run as root on the deployed host; never run wallet commands during this backup.
set -euo pipefail
umask 077
[[ $# == 2 && $(id -u) == 0 ]] || { echo 'Usage: backup-moderator.sh RELEASE_DIRECTORY PRIVATE_BUCKET' >&2; exit 64; }
release=$(realpath "$1")
[[ $release == /srv/board/operator-* && ${release#/srv/board/} != */* ]]
bucket=$2
[[ $bucket =~ ^[a-z0-9][a-z0-9.-]+[a-z0-9]$ ]]
exec 9>/run/lock/board-moderator-backup.lock
flock -n 9
systemctl is-active --quiet board-moderator.service
systemctl show --property=ExecStart --value board-moderator.service | grep -Fq "path=$release/scripts/operator-launch.sh ;"
work=$(mktemp -d /srv/board/state/backup.XXXXXX)
stopped=0
cleanup() {
  result=$?
  trap - EXIT
  if [[ $stopped == 1 ]]; then systemctl start board-moderator.service || result=1; fi
  rm -rf -- "$work"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
stopped=1
systemctl stop board-moderator.service
[[ $(systemctl show --property=Result --value board-moderator.service) == success ]]
[[ $(systemctl show --property=MainPID --value board-moderator.service) == 0 ]]
cd /srv/board
inputs=(state/moderator.json state/private-fee-retroactive.json state/deployment-retroactive.json
  state/transaction-journal-v1 state/moderation-retroactive
  "${release#/srv/board/}/.pxe-cache-v2" "${release#/srv/board/}/operator-package.json"
  model-manifest.json runtime.json)
for item in "${inputs[@]}"; do [[ -e $item ]]; done
[[ -z $(find "${inputs[@]}" -type l -print -quit) ]]
[[ -z $(find state/transaction-journal-v1 "$release/.pxe-cache-v2" -name '*.lock' -print -quit) ]]
mkdir "$work/metadata" "$work/restored"
cp /etc/systemd/system/board-moderator.service "$work/metadata/board-moderator.service"
find "${inputs[@]}" -type f -print0 | sort -z | xargs -0 sha256sum > "$work/metadata/files.sha256"
tar -czf "$work/state.tar.gz" "${inputs[@]}" -C "$work" metadata
key="moderator-state/$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
aws s3 cp "$work/state.tar.gz" "s3://$bucket/$key" --sse AES256 --only-show-errors
aws s3 cp "s3://$bucket/$key" "$work/download.tar.gz" --only-show-errors
cmp "$work/state.tar.gz" "$work/download.tar.gz"
tar -xzf "$work/download.tar.gz" -C "$work/restored" --no-same-owner
(cd "$work/restored" && sha256sum --check --quiet metadata/files.sha256)
python3 - "$work/restored/state/moderation-retroactive" <<'PY'
import pathlib, sqlite3, sys
databases = list(pathlib.Path(sys.argv[1]).glob('*.sqlite'))
assert databases, 'Moderation database missing'
for filename in databases:
    with sqlite3.connect(filename.as_uri() + '?mode=ro', uri=True) as db:
        assert db.execute('PRAGMA integrity_check').fetchall() == [('ok',)]
print('Downloaded backup: file hashes and moderation database integrity verified.')
PY
printf 'Backup: s3://%s/%s\n' "$bucket" "$key"
printf 'Archive SHA256: '
sha256sum "$work/download.tar.gz" | cut -d' ' -f1
