# Service interfaces — fresh deployment, version 1

This is the normative handoff for W01–W03 and U01, F01, M02 and D01. The validators and
fixtures exercise wire agreement; they do not mean the current wallet, feed,
deployment scripts or daemon already implement these services. No old board ABI
or old wallet database is supported. Recovery for wallets created by this version
remains required.

## Shared scope and serialization

Use `shared/protocol-schema.mjs` and `interface-fixtures/service-v1.json` in every
consumer. A scope is the complete tuple of L1 chain ID, rollup address, rollup
version, board address and portal address specified in `interface-spec.md`.
Never infer it from an RPC URL or an SDK package version. Numbers crossing JSON
boundaries are canonical decimal strings; schemaVersion is the number 1. Field
values, addresses and digests have distinct bounds. Unknown versions and extra
fields fail explicitly. These checks validate data shape, not authenticity.

Deployment verifies chain and protocol identity, deployed code and immutable
configuration against a release manifest before constructing the application
scope. It computes configuration with the board address before deploying the
portal, then verifies the one-time authenticated Ready handshake. A configured
URL or a deployed address alone cannot enable deposits.

PXE storage is partitioned by chain, rollup, full account address and actual SDK
schema. Application journals additionally partition by complete board scope.
Do not delete another namespace on mismatch. Fail closed and let the user select
the correct deployment or a supported backup for this fresh version.

## Fees: W01 adapter boundary

The wallet requests fee preparation for a locally bound transaction intent. The
adapter receives the verified scope, operation kind, transaction-intent digest,
fee ceiling and deadline. It returns a supported SDK payment method plus a
reservation identifier and observed maximum charge, or a typed failure. The SDK
object remains local; it is not JSON and is not serialized into the journal.
W01 selects and verifies the actual supported mechanism before implementing this
adapter. P04 does not invent a protocol sponsorship API.

Failures are `unsupported`, `unavailable`, `budget-exhausted`, `rate-limited`,
`quote-expired`, `scope-mismatch` or `fee-limit-exceeded`. The first five may be
retried after their cause is resolved, with a fresh fee preparation. The last
two require correcting configuration or explicit user intent. None permits an
automatic fallback to a reusable public author fee payer.

The reservation must bind the permitted operation and fee ceiling to the actual
submitted request and expire without retaining author identifiers. Admission,
budget accounting, release on failed preparation, and reconciliation after an
uncertain submission must be atomic and restart-safe. A lost response cannot
release a budget reservation while its transaction may still land. W01 must
measure who can observe IP, timing, funding and request metadata and document
that boundary; an opaque reservation ID alone is not an anonymity mechanism.

## Transaction journal and receipts: W03

Persist the operation intent before proving and persist the exact transaction
hash and submission intent before network submission. Each operation has a
random local operation ID, complete scope, operation kind, immutable intent
digest, attempt history, timestamps and current state. Private values belong
only in the protected local wallet/journal or its encrypted backup; never in the
public feed, telemetry or moderation job. Keep necessary recovery secrets until
the operation reaches a verified terminal state and backup retention permits
removal.

States are `prepared`, `proving`, `submit-intent`, `submitted`, `reconciling`,
`confirmed-success`, `confirmed-revert`, `cancelled` and `manual-review`.
Cancellation is available before submission only. A timeout or process crash
after submit-intent enters reconciliation, retaining the hash and intent.
Retries query the same transaction and relevant canonical onchain state before
creating a replacement attempt. A lease prevents concurrent tabs or restarted
workers from independently submitting the same operation. The journal must
detect inconsistent observations, not overwrite them as success.

Use `receiptDisposition` and the receipt cases in the shared fixture. Default
confirmation is finalized inclusion **and** successful execution. Earlier
inclusion can be shown as progress, but does not complete deposits, claims,
withdrawals, policy changes or flags. The classifier's optional lower threshold
is reserved for diagnostic/progress callers; W03 production completion paths must
use finalized and bind the receipt hash to their submitted transaction.
Reverted execution is a recorded failure;
dropped receipts require reconciliation; unknown status or missing execution
result is not success. A transport error conveys no execution result.

For claims and withdrawals, observe the authenticated cross-chain message and
its consumption in addition to the sending receipt. Never display an L1 refund
as complete from an L2 submission alone. The C06 invariant is that L2 rights are
consumed before a unique authenticated exit can release the corresponding L1
deposit. Restart recovery preserves that invariant. No timeout or administrator
refund bypass may leave live posting rights.

## Public feed: F01

Decode only logs from the verified board and canonical chain. Raw contract
events and their packed Field arrays are defined in `interface-spec.md`; the
shared JSON fixture is the decoded projection, not an alternate onchain ABI.
Decode exact UTF-8 byte lengths and reject malformed or noncanonical payloads.
`PostFlagged.censorAddress` comes from the authenticated actor in the raw event.
Recompute policy content commitments, resolve the post's publication policy and
each flag's applied policy, and verify publication/deadline relationships before
serving the projection. The current policy may remove older posts; publication
policy and deadline determine penalty eligibility.

Order by the numeric tuple (blockNumber, txIndexWithinBlock, logIndexWithinTx),
preserving the
public orderIndex assigned by the contract. The transaction hash and within-transaction log index
identify an event within its block hash and scope; postId identifies a post.
Do not use a private sequence, account or deposit identity for public ordering.
Advance a durable cursor only in the same database commit as its decoded events.
Deduplicate overlapping backfills. Store block hashes and detect ancestry changes;
roll back orphaned events, derived flags and cursors before replaying the common
ancestor's descendants. Mark unfinalized views as such. Divergence below the
accepted finality checkpoint halts serving authoritative state for investigation.

The feed reads without a wallet or proving assets. Policy and flag history stays
available even if presentation hides content. Never export depositChainId,
depositNonce, owner, depositor, accountAddress, note material or wallet errors in
the public envelope. Validation tests explicitly reject private linking fields.

## Moderation queue: M02

Use the same post, policy, deadline and scope fixtures as the feed and wallet.
`moderationJobKey` combines full scope, postId, the policyVersion being applied and
an immutable modelVersion digest. A new current policy or model creates a distinct
evaluation record; the post’s publication policy remains unchanged. Retain both
policies and the exact model configuration for reproducibility.

Define modelVersion as the full SHA-256 digest of six consecutive 32-byte words:
the ASCII domain `AZTEC_BB_MODEL_V1` right-padded with zeroes, schema version 1
as an unsigned big-endian word, the resolved platform-specific OCI image SHA-256
digest, the exact model-weights file SHA-256, the exact runtime-configuration file
SHA-256, and the exact prompt-template file SHA-256. This digest is a bytes32,
not an Aztec Field or truncated hash. The configuration file records engine
version, all sampling parameters, seed policy, context/output limits and any
additional behavior-affecting assets by immutable content digest. Its exact UTF-8
bytes are hashed without normalization; changing whitespace creates a new version.
The policy is bound separately by policyVersion. M02 implements one shared codec
and deterministic vectors for this transcript; M03 verifies that the running
image, weights, template and configuration actually match it before quality
qualification. An operator-supplied label or a mutable image tag is insufficient.

`queued → leased` requires a durable exclusive lease and bounded expiry. A valid
OK result becomes evaluated-ok. A valid flag result becomes submit-intent and
then submitted only after durable transaction identity is recorded. Invalid
output, unavailable policy, model failure or timeout becomes retryable-error or
manual-review, never evaluated-ok. A lost lease or submission response enters
reconciling. A successful finalized flag plus canonical flag event completes
confirmed-flag. Submitted and confirmed-flag records require transaction hashes.
Deadlines are checked u64 sums of a publication timestamp below 2^63 and a
positive u32 censor window; the future deadline may exceed 2^63 even though an
observed runtime timestamp must remain below that bound. Do not truncate the sum.
Database transition rules and leases are M02 work; the P04 validator checks
record shape, not valid state transitions.

Before submitting, refresh canonical post, current-policy and flag state. A passed
publication deadline does not expire removal work or prohibit a flag. The contract
adds a collateral penalty only when the flag arrives strictly before the original
deadline and applies the publication policy; other valid flags remove the post
without that penalty. Retry backoff and attempt limits remain bounded independently
of the publication deadline. Reorged observations trigger reconciliation for already
submitted work. Preserve authenticated transaction history without wallet secrets
or unbounded child-process output.

## Executable handoff and downstream acceptance

`scripts/test-protocol-schema.mjs` checks cross-consumer identities, canonical
serialization, forbidden private fields, moderation records and actual SDK
receipt classes. `scripts/test-protocol-commitments.mjs` and the independent
Noir/Solidity fixture runners agree on exact configuration, Ready, escrow and
policy bytes. These fixtures are shared input, not parallel consumer-specific
copies. Fixture changes require review across all affected consumers.

W01 must add real supported fee preparation and observation tests; W03 must add
durable transitions, restart/uncertain-submission tests and wire receipt handling
into every wallet consumer. F01 must add actual event decode, backfill and reorg
tests. M02 must add durable job transition, policy rollover and restart tests.
D01 must verify deployment identity and the Ready sequence on disposable chains.
C01–C06 implement the contract invariants. T01–T05 then test their interaction
with actual proofs and a single final candidate. None is replaced by schema tests.
