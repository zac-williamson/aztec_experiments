# Small launch safeguards

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
role and AWS CLI. It does not restart services or invoke a signer. Each run:

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
immediately produce critical backup checks in `buildReliability`. The dashboard
collector should read the status through `projectBackupStatus` and put it in
`buildReliability({backup: ...})`; never forward archive paths or AWS responses.

## Root deployment sequence

Use a dedicated, unversioned private S3 bucket. Generate its public-access,
ownership, lifecycle, TLS-only bucket policy and narrow instance-role policy
using `backupCloudConfiguration` from `ops/backup-deployment.mjs`. It has no cloud
side effects. Apply the returned documents with the authorized deployment role.
The runtime role can only read/write its own archive prefix, inspect the bucket
controls, and decrypt its one SSM parameter through SSM with the matching KMS
encryption context. It cannot replace the key, alter retention, or delete objects.

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
| Core | Application, wallet deployment, funding relay, prover, moderator, operations and release configs; moderator and funding-relayer credentials; analytics SQLite |
| Bok | Service config; operator credential; GitHub App private key; model-provider environment file |

Do not include public index databases, archives of posts, proof queues, browser
accounts, disposable test fixtures, generic logs, or live transaction journals.
This job protects stable credentials/configuration and aggregates. It is not a
snapshot/recovery protocol for in-flight financial operations. Existing onchain
reconciliation remains necessary before any restored signer is started.

Use `backupUnits` to generate `rolling-ops-backup-{core,bok}.service` and `.timer`.
Supply the installed pinned Node binary, immutable operations code directory,
private config path, and the core analytics directory. The job expects AWS CLI
at `/usr/local/bin/aws`. Units run daily with a ten-minute ceiling, private
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
```
