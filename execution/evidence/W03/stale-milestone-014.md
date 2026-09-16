# Safe replacement of an invalid real-post proof

The encrypted journal now retains the logical post intent and up to eight exact
predecessor transactions. Fresh proving requires every saved attempt to be dropped
and invalid for supported pinned state-conflict reasons. It repeats reconciliation
before persisting the replacement and preserves the original post ID, message and
deposit chain. Pending, unknown, included and concurrently changed records block
replacement. Non-post operations cannot inherit post metadata. RPC reads have
bounded deadlines; a timeout does not authorize a new transaction.

Evidence:
- stale-integrated-008.log:159 integrated checks; actual encrypted journal and SDK
  serialization, engine routing, receipts, deployment and fee recovery.
- stale-supervisor-010.log:5 process-supervisor checks, including real detached
  children and cleanup when process discovery fails after freezing them.
- stale-artifacts-013.log:143 artifact/provenance/client checks.
- stale-browser-012.log:actual built browser restores wallet, claim custody and
  journals, rejects wrong passwords and enforces cross-tab exclusion. Four fresh
  profiles are exercised with at most two concurrently open; one external request
  was blocked. Synthetic chain fixtures are used for UI transaction checks.
- stale-sdk-009.log and stale-apps-009.log:current application builds.
- ../W01/application-8df5c9f5-4b7d-4a4c-9a90-4d726f9748e5.json:
  genuine native proof qualification passed296744ms, peak1851936KiB, with all owned
  processes and temporary data removed. A separate real private-fee transaction
  consumed the original post proof's fee note. The real node rejected that original
  proof with Existing nullifier; encrypted journal export/restore then produced
  and included a fresh proof of the same post. Fee accounting and normal post/note
  invariants passed. No network epoch prover was used.

Two earlier harness failures and the interrupted cleanup are preserved in
stale-test-interruption-008.md. Supervisor cleanup now kills remembered owned
children even when process discovery fails, and malformed snapshots are retried
once before failing closed. The native limit was reduced to2GiB; the540-second
wall-time bound remains. Browser contexts close as soon as their checks finish.
These changes do not establish the cause of the reported22GB ChatGPT memory use.

Root self-review checked exact-byte ancestry, double reconciliation, logical post
identity, non-post metadata isolation, resource cleanup and honest failure states.
This is not independent review. W03 remains open for other stale-action handling,
withdrawal absence truthfulness and final all-stage qualification. Binding files:
source-stale-014.json, artifact-manifest-stale-014.json, recovery-runbook-stale-014.md.
