# Receipt and withdrawal-history milestone — W03 remains active

Source inventory: `source-milestone-001.json`, fingerprint
`b622d975bb385c29fcebc385589c330ba94715918d0d405853154f22d3cd91cf`.
Runtime: pinned Node24.21.0 and Aztec5.2.0. No public transactions or network proofs.

## Changes verified

Shared, deployment and user wallets submit once and reconcile the exact transaction
hash. Successful execution must have a checkpointed/proven/finalized receipt in a
currently canonical block. Reverted receipts never confirm; reverted receipts on
reorganized blocks remain unknown. Structured dropped-transaction revalidation is
separate from free-form RPC errors. The transaction hash is displayed before send.

Withdrawal lookup covers the requested history in the actual pinned API's50-block
pages, rather than a500/1000-block lookback. Missing pages, failed RPC calls, invalid
receipts and changed anchors remain unknown. Each lookup has a20-second read budget.
Settlement witness absence returns a pending outcome immediately. Neither consumed
Outbox state nor an error containing “already” proves an Ethereum refund.

## Verification

- `integrated-milestone-003.log`:106 passing tests of actual wallet/engine functions,
  SDK receipt classes, withdrawal history, private fees, public errors and clients.
- `artifacts-001.log`:80 passing artifact, CI drift and affected client checks.
- `sdk-002.log`, `apps-003.log`: successful canonical SDK and frontend builds.
- `cli-sdk-001.log`: actual built SDK execution through CLI loader boundaries.
- `browser-001.log`: actual rebuilt browser, two fresh profiles, encrypted recovery,
  wrong-password rejection, claim commitment and cross-tab exclusion.
- `artifact-manifest-milestone-001.json`, `manifest-001.log`: validated36-file inventory.
- Root diff review caught and repaired classification of noncanonical reverted
  receipts, a remaining1000-block call site, stale settlement UI instructions and
  removal of the displayed recovery hash. Delegated final review unavailable after
  earlier quota errors; this is self-review, not independent release assurance.

The controlled RPC/prover regressions are not new cryptographic proof evidence.
Existing genuine transaction evidence remains historical for its source snapshot.

## Outstanding before W03 completion

No durable operation journal is integrated yet. A page/process restart can lose an
unresolved transaction identity; log output is not durable recovery. Implement
pre-broadcast encrypted records, exact transaction replay/reconciliation, logical
operation identity across refreshed proofs and interruption tests for every stage.
Persist and validate history cursors so large chains can resume beyond the per-call
budget. Match canonical Ethereum refund receipts and Withdrawn events against the
original depositor/nonce/amount. Ethereum deposit/refund receipt validation and
fee-funding stage recovery need the same journal. No W03 acceptance criterion is
marked complete solely from this milestone.
