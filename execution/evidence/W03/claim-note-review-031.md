# Claim and same-note recovery — AI re-review

Bounded source re-review of `apps/src/billboard/user/engine.js` and its focused
regressions. No application or harness files were edited, and this reviewer did
not launch a native job. This is AI review, not independent security review.

## Findings resolved

- Stale claim recovery preserves exact receipt identity, depositor, amount,
  nonce, message leaf index, secret commitment and derived deposit chain. The
  chain derivation includes the scoped Aztec owner. A changed original receipt
  or beneficiary fails before another fee payment. An existing note is not
  accepted as confirmation of an unresolved saved claim transaction.
- Claim receipt preparation now wraps `doReuseDeposit()` in a 20-second bound.
  The saved Ethereum receipt must match the requested transaction hash and its
  block hash must match the canonical block read before its event is used.
- A successful private send clears `resumedSpend`, allowing the next intentional
  step rather than incorrectly enforcing the previous recovered dummy's head
  and operation. Root reports a regression covering automatic dummy retry
  followed by withdrawal.
- The previous thirty-attempt claim loop was replaced with one send per action.
  Post-confirmation wallet synchronization has a bounded wait and a truthful
  pending-sync message.

No additional blocker found in the reviewed changes. Root reports 68 focused
checks passing, including sampler checks; this reviewer did not independently
rerun them. This disposition does not assert whole-application readiness.

## Genuine attribution remains pending

The initial genuine dummy attribution attempt failed with
`BB_APPLICATION_ATTRIBUTION_UNSUPPORTED`. The extractor now emits only bounded
structural diagnostics (categorical stages, types, counts and booleans), with no
field values, addresses, secrets or raw errors. Its source guards were not
relaxed to obtain a pass. Controlled fixture tests do not establish actual
pinned SDK execution behavior.

At this review checkpoint native attempt 031 is running. Do not describe the
application-nullifier helper as genuinely qualified until that run establishes
attribution to the actual PXE deposit note, agreement with the withdrawal proof,
and the expected post-withdrawal invalidation. Even a successful attribution run
would not by itself qualify every regenerated-dummy race or stale-claim path.
