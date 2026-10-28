# Small launch safeguards

Open the [private operator dashboard](https://d30njln0kead8n.cloudfront.net/_ops/).
Team access is invite-only with individual logins and authenticator MFA; board
visitors have no persistent analytics profile. See the
[operations guide](../docs/LAUNCH_OPERATIONS.md) for access and ownership.

Slack ALARM and subsequent OK recovery delivery were actually observed on
28 October using an explicit test alarm and real healthy datapoints, without an
application outage. Candidate `aad8c265` passed its exact full build on
28 October. Its staged journey passed ETH signup, posting, reply, like and reload,
then stopped at Bok credit; USDC signup and promotion were not attempted.
Baseline `48c2750f` remains live and automatic release is disabled. A local
actual-panel reproduction confirmed the harness omitted funding-wallet
reconnection after reload. The next repaired candidate's exact full build,
complete genuine journey, promotion, pruning and operator rollback remain
**pending final receipts**. A subsequent read-only check found insufficient
USDC/FEE test liquidity, which must be repaired and quoted again before retrying.
Fresh off-host restores now verify twenty
core inputs and four Bok inputs, with both daily timers active; see
[`backup-verification.json`](../deploy/launch-ops/backup-verification.json).

The public reader now links to Help and privacy. It explains public posting and
funding, the trusted prover, aggregate analytics, retention and the existing
browser opt-out. Its problem-report link is the existing public GitHub issue
tracker, explicitly labelled as public and requiring a GitHub account. It does
not claim an anonymous or confidential reporting channel. Before announcing the
site, designate who monitors reports; a private content-reporting address still
requires an operator-selected destination. No address or response promise was
invented, and no message has been sent on the user's behalf.

Existing capacity and spending controls were retained:

- Public saved-item operations: 600 reads and 120 writes per minute globally,
  at most 16 active operations, bounded encrypted-document size/storage.
- Funding relay: 60 requests per minute globally, one signer-owned operation,
  a configured maximum gas cost and a cumulative conservative gas budget. A
  consumed budget is not reset by reimbursement or a restart.
- Prover: default six proof admissions per minute per transient network client,
  at most eight uploads, four active/queued jobs per client, bounded queue files
  and result observers. Network addresses remain in memory for admission; they
  are not added to analytics or logs. Check the installed override values.
- Bok: onchain request budgets and maximum quoted provider charges are enforced
  before provider work. Existing operator/provider account caps still apply.

The new global ceiling of 128 active public HTTP handlers prevents waiting
reader requests from growing without bound when index synchronization is slow.
It returns a retryable capacity response without creating IP buckets or visitor
identities. This is basic overload control, not a claim of DDoS protection.

# Daily backup and restore job

`ops/backup-job.mjs` is a root-owned, one-shot job using the existing instance
role and its installed Python/boto3 runtime. A fixed-operation adapter takes JSON
through a private stdin pipe; cloud errors and metadata never enter logs. It does
not restart services or invoke a signer. Each run:

1. Prunes the core analytics database even if nobody visited the site.
2. Requires a private S3 bucket, seven-day prefix expiration and no versioning.
3. Reads one role-specific SSM SecureString containing a base64 32-byte random
   backup key. The key is never written to S3 or included in the archive.
4. Snapshots only the explicitly listed stable files and analytics SQLite.
5. Encrypts with the existing AES-256-GCM archive format, then uploads ciphertext.
6. Downloads that exact object and actually restores it into a new private
   directory, checking archive/member digests and SQLite integrity.
7. Removes temporary plaintext/key files and atomically writes safe status.

Failure leaves previous successful timestamps intact. Upload success and restore
success are separate. `backup-failed`, `restore-failed` and `cleanup-failed`
immediately produce critical backup checks in `buildReliability`. The installed snapshot collector projects these status fields into Reliability;
never forward archive paths or AWS responses.

## Root deployment sequence

Use a dedicated, unversioned private S3 bucket. Generate its public-access,
ownership, lifecycle, TLS-only bucket policy and narrow instance-role policy
using `backupCloudConfiguration` from `ops/backup-deployment.mjs`. It has no cloud
side effects. Apply the returned documents with the authorized deployment role.
Each returned policy permits only its selected archive prefix, bucket control
reads, and one SSM parameter through SSM with the matching KMS encryption context.
It cannot replace the key, alter retention, or delete objects. The current hosts
share one instance IAM role: attaching both policies gives that role both scopes.
These separate archive/key namespaces do not establish isolation between hosts.

Provision separate random keys at `/rolling/operations/backup-key/core` and
`/rolling/operations/backup-key/bok` as SSM SecureStrings under an operator-managed
KMS key. Generate and submit values through private files or direct APIs, never
shell arguments, source, logs or chat. Do not overwrite an existing key during a
routine install. Keep the KMS key and parameters available for disaster recovery;
their only copies must not reside on either application host. Budget the KMS/S3
resources within the existing $50 incremental allowance.

Write each configuration as root-owned mode 0600. Exact fields are:

```json
{
  "schemaVersion": 1,
  "role": "core",
  "region": "us-east-1",
  "bucket": "YOUR-PRIVATE-BACKUP-BUCKET",
  "prefix": "rolling-ops/core",
  "keyParameter": "/rolling/operations/backup-key/core",
  "stateFile": "/var/lib/rolling-ops-backup-core/status.json",
  "workDirectory": "/run/rolling-ops-backup-core",
  "files": [
    {"name":"configuration/application.json","path":"/CANONICAL/ACTIVE/application.json","kind":"file"},
    {"name":"analytics.sqlite","path":"/var/lib/rolling-ops/analytics.sqlite","kind":"sqlite"}
  ]
}
```

Replace placeholders with the current service's explicit canonical paths. Read
the active unit/config references; do not guess from an old release or recursively
scan secret directories. `BACKUP_NAMES` defines the admitted small inventory:

| Host | Stable inputs to select when used by its current services |
|---|---|
| Core | Application, wallet deployment, funding relay, prover, query, moderator, operations and release configs; application Caddyfile/unit and its availability/release drop-ins; release public verifier, job unit and sudoers; staging unit; moderator, query and funding-relayer credentials; analytics SQLite |
| Bok | Service config; operator credential; GitHub App private key; model-provider environment file |

Do not include public index databases, archives of posts, proof queues, browser
accounts, disposable test fixtures, generic logs, or live transaction journals.
Keep CI test-wallet keys, the stage relay test key and the automatic-release
`enabled` marker out of the inventory. Recovery never implies permission to
enable automatic deployment again.
This job protects stable credentials/configuration and aggregates. It is not a
snapshot/recovery protocol for in-flight financial operations. Existing onchain
reconciliation remains necessary before any restored signer is started.

Use `backupUnits` to generate `rolling-ops-backup-{core,bok}.service` and `.timer`.
Supply the installed pinned Node binary, immutable operations code directory,
private config path, and the core analytics directory. The job expects Python
and boto3 at `/usr/bin/python3`. Units run daily with a ten-minute ceiling, private
runtime directories and read-only system paths. State files must be under the
generated `/var/lib/rolling-ops-backup-ROLE` directory. The core analytics directory
must be writable for pruning and SQLite locking. Validate and install the units,
then run one job and inspect only its projected status before enabling its timer.

For a traffic-independent retention schedule without backups, call
`pruneAnalytics(filename)` or the `ops/prune-analytics.mjs` CLI daily. The store's
`prune()` API is also available to a running maintenance owner. Missing databases
fail; the maintenance CLI does not manufacture a healthy empty database.

S3 expiration is a seven-day policy, with deletion processed asynchronously by
AWS; it is not a promise of erasure at an exact minute. Use the dedicated
unversioned bucket so old object versions cannot extend this retention. See
[S3 lifecycle timing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html)
and [SecureString encryption](https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html).

## Recovery and acceptance

An authorized operator can download an archive from the role prefix and obtain
the separate SSM key into a private temporary file. Run `restoreBackup` into a
new empty directory. Never overwrite live files or start an additional signer
automatically. Inspect the recovered inventory and the current contract/runtime
identity before deliberately installing selected configurations and credentials.
Delete temporary plaintext once that operation is complete.

The daily job itself performs the download-and-restore drill. The implementation
tests exercise real encryption and SQLite restoration against a local cloud
adapter, including damaged downloads, private-bucket/retention failures and
cleanup. They do not establish that an AWS installation or timer is active.

```sh
node --test ops/backup.test.mjs ops/backup-job.test.mjs ops/monitor.test.mjs ops/analytics.test.mjs scripts/rolling-public-capacity.test.mjs
python3 -m unittest discover -s ops -p 'backup_cloud_test.py'
```

## Initial installation — 28 October 2026

The initial installation enabled `rolling-ops-backup-core.timer` and
`rolling-ops-backup-bok.timer`. Both initially used immutable backup source revision
`37c2c1ba791d50eda242f0f59c3b89c9eeef959d`, under `/opt/rolling-ops-backup/releases/`;
the copied existing Node runtime is 24.21.0. See
[`backup-hosts.json`](../deploy/launch-ops/backup-hosts.json) for the explicit
canonical file inventory, source hashes, unit/status paths and SSM evidence.

At 12:03 UTC both jobs uploaded an encrypted archive to the dedicated bucket,
downloaded it, restored its members and verified integrity. Core included ten
small inputs including analytics SQLite; Bok included four. Temporary keys and
plaintext were removed. The first archives were 20,961 and 8,602 bytes. Both
oneshot services exited successfully and both daily timers were enabled after
this drill. This is a first-run check; subsequent status must remain fresh.

Read only `/var/lib/rolling-ops-backup-ROLE/status.json` for monitoring. To repeat
the same safe drill, start the corresponding `rolling-ops-backup-ROLE.service`;
it never installs recovered files or starts a signer. Changes to active secret
or configuration locations require reviewing and updating that role's explicit
private configuration. No application service was restarted by this installation.

A post-cutover read-only check at 20:35 UTC on 28 October confirmed that Bok
release `48c2750f` still uses all four configured backup inputs: its service
configuration, operator credential, GitHub App key and provider environment file.
The running configuration and loaded credential references matched the inventory.
No credential contents were read and no backup or restore was started by that check.

The two added IAM policy names are `RollingLaunchBackupCore20261028` and
`RollingLaunchBackupBok20261028`; existing policies were retained. Both hosts
share the same instance role and therefore have the union of these permissions.
The $3 reservation covers the first 31 days within the shared launch budget;
review by 28 November 2026. It is an allocation, not a billing cap. KMS and SSM
keys must outlive all retained archives if backups are later retired.

## Verified core coverage update — 28 October 2026 UTC

The final read-only coverage review found ten missing inputs: the already
admitted live wallet/release configs and eight exact live control-file names.
[`core-backup-update-plan.json`](../deploy/launch-ops/core-backup-update-plan.json)
records their observed paths and the additive change from ten to twenty inputs.
The update is installed at source `5c13d4d6186ba6300c77f4debd93eeafb4d01c1b`.
The twenty-input core restore passed at **20:47:50.817 UTC**; a fresh four-input
Bok restore passed at **20:45:08.473 UTC**. Core essential-file metadata and active
application references stayed unchanged through verification. Temporary core
plaintext was removed, the jobs exited successfully, and both daily timers are
active. Exact hashes, status timestamps and command receipts are in
[`backup-verification.json`](../deploy/launch-ops/backup-verification.json).

The installed update followed this guarded sequence. Any later change needs a
new comparison with current state and a coordinated window after configuration
writes finish; do not pause the backup timer during an application cutover:

1. Pause only the core backup timer, confirm its job is inactive, and read the
   current units/config references again. Require all selected paths to be canonical
   regular files; missing or changed references block the update. Record current
   ownership/modes without reading file contents into logs. Match the effective
   application service command and running process to the backed-up public,
   wallet and relay config paths; a stale but unchanged file is not coverage.
2. Install the reviewed backup source into a new immutable
   `/opt/rolling-ops-backup/releases/FULL_COMMIT` directory and verify its source
   hashes. Keep the existing pinned Node runtime, cloud adapter dependencies,
   encryption keys, bucket, IAM policies, retention and Bok installation.
3. Add only the plan's `fileAdditions` to `/etc/rolling-ops-backup/core.json`,
   preserving every existing entry and scalar setting. Reject duplicate names
   or paths; validate the resulting twenty-input configuration with the newly
   installed `validateBackupJobConfig`. Atomically install the private config
   with its existing owner/mode. Update only the core backup service's code
   directory to the new immutable source and reload systemd.
4. Start `rolling-ops-backup-core.service` once. Require successful encrypted
   upload, actual download/restore integrity checks and cleanup before recording
   the fresh projected status and resuming its daily timer. Require unchanged
   essential-file metadata and active application references throughout this
   drill; analytics SQLite uses its concurrent snapshot. Preserve a failed
   result honestly; do not change any application, prover or proxy service.

The restore drill recovers exact bytes into a private directory; it does not
install them or automatically recreate uid/gid/modes. Reapply separately reviewed
metadata when deliberately restoring selected control files. Source bundles,
browser files, old application data and deployment activation remain outside
this backup change. No crypto, archive, cloud-access or restore logic changes.

## Incremental spending visibility

The operator dashboard's **Recorded estimate** is a manually reviewed planning
forecast for the initial 31 days, currently **$25 against the $50 incremental
allowance**. Existing application hosting has a separate $1,500/month allowance.
Actual billed launch charges are unknown; they are never represented as zero.
The reservation breakdown remains in the single infrastructure ledger. See
[`spending-estimate.json`](../deploy/launch-ops/spending-estimate.json) for the
review timestamp, components, publication evidence and exact expiry.

The core input is `/var/lib/rolling-ops/spending.json`, owned by
`root:rolling-ops` with mode 0640. Its only fields are `observedAt`, `limitUsd`,
`forecastUsd` and `incurredUsd` (null when unknown). The snapshot collector carries
this timestamp unchanged. After 48 hours the forecast becomes unknown. No timer
refreshes the planning estimate. An operator must reconcile the resource ledger
and pending charges before atomically replacing the file with a genuinely fresh
review; merely updating its timestamp would hide stale information.

The live account has a $20 account-wide budget and the existing $1,500 hosting
budget. Neither identifies the new launch resources, and no cost allocation tags
are active. Service-only filters would also include existing hosting resources.
No budget or billing settings were changed. [AWS Budget tag filters require
active allocation tags](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create-filters.html);
[activation can take time](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/activating-tags.html).

The practical guard is the small fixed resource set and service limits: existing
hosts, one monitoring worker with bounded memory/runtime/concurrency and no
retries, a two-minute schedule ending 28 November 2026 at 11:12 UTC, explicit small daily backups
with seven-day retention, and existing proof/relay/provider spending limits.
The $25 forecast leaves a $25 unallocated buffer. This is not an automatic AWS
billing cap. Review before additional paid work, refresh the manual forecast
within 48 hours, and reconcile or retire dedicated resources at the 31-day review.
Alarm, KMS and storage charges can continue after a schedule stops.
