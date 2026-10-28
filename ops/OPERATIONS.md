# Rolling Chat operations

These modules observe services; they never restart them, repeat payments, submit
proofs or invoke models. Root deploys them beside the authenticated dashboard.

## Interfaces

`buildReliability({hosts:{core,bok},external,spending,backup,now})` returns
`{schemaVersion:1,observedAt,status,hosts,checks,spending,backup}`. Each check has
`{id,label,status,value,unit,actionable,message,action}`. Timestamps are ISO8601; `now` is epoch
milliseconds. Unknown and stale inputs never become healthy. Only fixed fields,
service names and numeric counters survive projection. Source messages, logs,
identities, hostnames and request data are discarded.

Host freshness is180seconds; external observations have a separate
660second freshness limit. The installed collector runs every2minutes. Missing hosts alert once per host rather than once
per missing dependency. Optional unconfigured health/metrics remain unknown
without notifying. Configured health sources include `configured:true`, so an
unavailable configured source can alert. The initial CPU sample is quiet. Set
`backup.configured:true` once scheduled backups are installed so absence alerts.

`spending` input: `{observedAt,limitUsd,forecastUsd,incurredUsd}`. Forecasts older
than48hours are unknown. `backup`: `{lastSuccessAt,lastVerifiedRestoreAt}`.
`external`: `{schemaVersion:1,observedAt,website:{ok,latencyMs},prover:{ok,latencyMs},feed:{ok,latencyMs}}`.

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
not queue length. The new queue projection adds distinct waiting/active counts,
oldest waiting/active age, and latest worker/queue-wait duration. These measure
existing progress only; they never cancel or advance work. Current Bok health exposes active jobs and readiness, not its
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

`node ops/external-stack.mjs` emits CloudFormation JSON: a Lambda outside the
application hosts, a fixed parameterless SSM document, a private encrypted S3
bucket, an SNS topic, two scoped IAM roles, a2minute schedule and six CloudWatch
alarms. HTTPS homepage, real-proof/query and `/api/home?limit=1` checks exercise
read-only functional endpoints. SSM invokes only the root-owned host observer on
the two configured instances. Two failed/missing periods alarm; recovery notifies
too. Capacity, waiting work, current ingestion and configured work-health thresholds
feed each host's readiness alarm. Unsupported optional measures remain unknown.

Root supplies canonical `Origin`, the exact core/Bok instance IDs and authorized
UTC `EndDate`. Connect SNS to `#rolling-chat-updates` using Amazon Q/AWS Chatbot
after workspace authorization, and verify delivery. Concurrency is one, timeout75s,
retries zero. Lambda can publish only the fixed CloudWatch namespace, invoke this
one SSM document on two hosts, read its invocation results, and write the single
`snapshots/latest.json` object. The GetCommandInvocation API requires Resource`*`;
code only uses the CommandId returned by its own SendCommand. It cannot modify
host code, services, shared IAM roles or application configuration. No Lambda
runtime logs or response bodies are collected. SSM stdout contains aggregates only.

S3 blocks all public access, requires TLS/AES256 writes, disables ACLs, and expires
unrefreshed snapshots after2days. No historical user activity is stored there.
The `SnapshotReadPolicy` stack output grants only GetObject on the exact aggregate
key. Root applies that small policy to the existing host role; the monitoring
stack never changes the host role. A root timer imports and re-projects the file
every30seconds, atomically retaining observation timestamps. Failed pulls leave
the prior timestamp intact so the dashboard becomes stale. The local spending projection in
`/var/lib/rolling-ops/spending.json` is independently read using closed fields.
Each host reads its own `/var/lib/rolling-ops-backup-{core,bok}/status.json`; only
configured/outcome/success/verified-restore timestamps leave the host. A loaded
backup service with no usable status is configured but unknown. Missing optional
backup units do not alert. The external collector and snapshot pull re-project
these fields, aggregate the oldest success/restore times and worst outcome across
configured hosts, and preserve immediate backup/restore/cleanup failures. A missing
host cannot produce an aggregate positive backup observation. Configured backups
older than48hours, verified restores older than7days, unknown status and explicit
failures make the corresponding host alarm unhealthy. The dashboard process has
no access to EC2 instance metadata.

Reserve USD10 for31days within the shared USD50 incremental budget. At the maximum
75second runtime on every invocation:22,320 calls ×75s ×0.125GiB ×USD0.0000166667
isUSD3.49; six metrics plus six standard alarms are approximatelyUSD2.40/month.
AllowUSD0.50 for S3/API/SNS/schedule/transfer and the balance for tax/billing delay.
Typical short observations cost less. Estimates ignore free tiers and use
[AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/) and
[CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/), checked28October2026.
SSM Run Command on existing EC2 instances has no extra charge; hybrid-node pricing
does not apply ([Systems Manager](https://aws.amazon.com/systems-manager/pricing/)).
This is a forecast, not a hard cap. EndDate stops invocations; alarm charges can
continue. Delete this dedicated stack at the end of its authorized period unless
renewed; empty the single snapshot key first if necessary. Never stop the app.

## Host installation

`deploy/launch-ops/install-host.py` defaults to packet validation only. Apply only
after independent review. The packet contains a40hex revision, role, allowlisted
source files with base64 bytes and SHA256, root observer config, and for core the
public Cognito configuration, pinned Node hash and approved Caddy hash. Include
`apps/rolling/analytics-schema.mjs`, imported by the aggregate store, and
`ops/community.mjs` alongside the core ops modules/public assets. Core data paths
are fixed beneath `/var/lib/rolling-ops`.

The installer stages root-owned source beneath `/opt/rolling-ops/releases/<revision>`
and changes `/opt/rolling-ops/current`. Core receives a dedicated copy of the
installed pinned Node runtime. Only `rolling-ops.service` is started/restarted,
as an unprivileged user on loopback4320 with256MiB memory and25%CPU limits. Data
is mode0700, server config is root-owned0640, observer config0600. The optional
snapshot timer runs separately as root using existing boto3 and the exact read
policy above. Its config contains bucket/region only.

Caddy's sibling `/_ops` route is staged, validated and installed only if the original
fingerprint still matches. SIGUSR1 reloads the existing Caddy2.11.7 process; the
proxy is never restarted. If route readiness fails, the original bytes are restored
only when the config still matches this installer's bytes. Before/after PIDs of all
existing application services must match. Bok receives only the observer source
and configuration. No app, prover, Bok worker, node or moderator is restarted.

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
