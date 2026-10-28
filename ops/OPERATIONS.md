# Rolling Chat operations

These modules observe services; they never restart them, repeat payments, submit
proofs or invoke models. Root deploys them beside the authenticated dashboard.

## Interfaces

`buildReliability({hosts:{core,bok},external,spending,backup,now})` returns
`{schemaVersion:1,observedAt,status,hosts,checks,spending,backup}`. Each check has
`{id,label,status,value,unit,message,action}`. Timestamps are ISO8601; `now` is epoch
milliseconds. Unknown and stale inputs never become healthy. Only fixed fields,
service names and numeric counters survive projection. Source messages, logs,
identities, hostnames and request data are discarded.

`spending` input: `{observedAt,limitUsd,forecastUsd,incurredUsd}`. Forecasts older
than48hours are unknown. `backup`: `{lastSuccessAt,lastVerifiedRestoreAt}`.
`external`: `{schemaVersion:1,observedAt,website:{ok,latencyMs},prover:{ok,latencyMs}}`.

```sh
python3 ops/host-observer.py core --config /etc/rolling-ops/core-observer.json --state /var/lib/rolling-ops-observer/cpu.json
python3 ops/host-observer.py bok --config /etc/rolling-ops/bok-observer.json --state /var/lib/rolling-ops-observer/cpu.json
```

Observer configuration has `health` with loopback-only HTTP URLs. Core `prover`
and `query` may use the same installed prover `/healthz` URL (discover the actual
port). Bok uses `http://127.0.0.1:8807/health`. Set `moderator` to
`current-daemon-journal`: only recent current-PID health records are projected;
raw bounded journal material never leaves the host. The PID is rechecked. Omit
unavailable sources and they remain unknown. CPU needs two successive `/proc/stat`
samples; the first is unknown. Process availability and work health are separate.

Existing prover `jobs` includes completed results and is called `retainedJobs`,
not queue length. Current Bok health exposes active jobs and readiness, not its
full queue, cost or latency. Exact node/index lag, provider spending and funding
liquidity need real aggregate sources; this patch does not invent their values.
An optional loopback funding source accepts
`{schemaVersion:1,status,pendingPayments,feeBalance,minimumFeeBalance}` only.

## Alerts

`nextAlertState(previous,checks)` returns `{state,notifications}`. Persist state
atomically after successful notification delivery. If transport rejects, keep
the prior state so the bounded batch can retry. Default debounce is two samples;
initial healthy state is quiet; changes/escalation/recovery notify once. At most
eight changes are emitted per call. Combine concurrent changes in one Slack
message with a private dashboard link. Messages use fixed service labels only.

Initial thresholds: disk85%/95%, memory and CPU90%/98%, oldest queued work120s/300s,
moderation ingestion90s/180s. Tune with actual load. Cumulative failure counts do
not themselves trigger new incidents. Monitoring never stops healthy services.

## External monitoring

`node ops/external-stack.mjs` emits CloudFormation JSON: Lambda HTTPS homepage
and real-proof/query checks outside the app hosts, SNS topic, five-minute
schedule, and three CloudWatch alarms. Two failed/missing periods alarm; recovery
notifies too. A missing heartbeat is breaching. Root supplies canonical `Origin`
and authorized UTC `EndDate`, records costs, deploys, and connects the topic to
`#rolling-chat-updates` using AWS Chatbot/Amazon Q after workspace authorization.
Explicitly test delivery. Lambda concurrency is one, timeout15s, retries zero.
Its role can publish only the fixed CloudWatch namespace; it cannot change hosts.
No Lambda runtime logs or response bodies are collected.

Reserve USD5 for31days of this small probe as a conservative estimate (three
custom metrics, three standard alarms, about8,928 short calls and notifications).
Root must verify current region prices and reconcile against the total USD50
incremental budget. This is not a hard AWS cap. EndDate stops invocations; alarm
charges can continue. Delete the monitoring stack at the end of its authorized
period unless renewed; do not stop the application. Existing hosting has a
separate ongoing allowance. See AWS CloudWatch/Lambda pricing and alarm docs.

## Encrypted operational backups

`backup.mjs` takes an explicit list of files and SQLite databases. It does not
scan credential directories. Each item is `{name,path,kind:'file'|'sqlite'}`.
Create configuration is `{keyFile,output,files}`; restore configuration is
`{archive,keyFile,destination}`. Paths must be canonical and have no symlinks.
The32-byte random key must be a private file and cannot be a backup item. AES256
GCM authenticates the archive before any restore writes. Output is mode0600.
Store encrypted archives privately off-host, and the key in a separate operator
secret store. An archive plus its only key on one host is not a recovery plan.

```sh
node ops/backup.mjs create /etc/rolling-ops/backup-create.json
node ops/backup.mjs verify-restore /etc/rolling-ops/backup-restore.json
```

Use immutable private configs/keys, required ops state and the analytics SQLite
DB. The native SQLite online backup includes committed WAL state and verifies
integrity. Ordinary files must not change during copying. This is not a coherent
snapshot of unrelated financial journals: use their existing snapshot/drain
procedure, then back up the stable snapshot. Disposable old test state does not
need preservation. Limits:64entries,32MiB per input,64MiB total.

Restore uses a **new** directory, checks every digest and SQLite integrity, and
never overwrites live state or starts a signer. For live acceptance, download
the off-host ciphertext before restoring it in an isolated directory. Record
returned `lastSuccessAt` and `lastVerifiedRestoreAt`. Suggested schedule: daily
backup, weekly restore check. No schedule or live restoration is claimed merely
because this source exists.

## Verification

```sh
node --test ops/monitor.test.mjs ops/backup.test.mjs
python3 -m unittest discover -s ops -p '*_test.py' -v
```

Root acceptance: demonstrate missing/stale data, an alert and recovery reaching
the destination, external heartbeat failure notification, and a downloaded
backup restoring correctly. These local tests do not substitute for those live
checks.
