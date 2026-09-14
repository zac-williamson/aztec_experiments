# Authenticated bridge acceptance — current candidate

C01 remains open. Source snapshot `source-retention-retry.json` identifies fingerprint
999d8e784679f3c8b42edf0570ffc90459f62c06d694b8a1011ca2b0ab826a2f.
The snapshot precedes commit9faee45, whose source is running unchanged.
This document distinguishes passing local checks from the still-running genuine
bridge retry. It is not production-readiness or external-audit evidence.

| Criterion | Recorded evidence | Remaining evidence |
| --- | --- | --- |
| A01: intended collateral creates exact rights | Current Noir exact-receipt/eligibility controls pass; prior real L1 deposit and claim proof/admission passed | Current run has passed actual delivered-note assertions; complete journey still pending |
| A02: wrong actor/scope/amount/secret/unbound reject | Current103-test Noir suite includes changed nonzero depositor and changed in-range amount, wrong portal/recipient/version/chain/nonce/secret and unbound controls; historical canonical portal envelope tests | 29/29 current portal tests and4/4 additional binding controls pass |
| A03: no repeated claims/refunds | Current TXE cross-owner replay and repeated burn controls; canonical portal replay and fresh-nonce controls | Actual consumed-message replay rejection passed in current run; real refund/repeat-refund pending |
| A04: genuine integrated message/proof path | Genuine Ready proofs, Ethereum proof receipts, finalized local membership and portal activation passed; failed claim-inclusion attempt remains recorded | Current complete deposit/claim/no-post-exit/refund run with cleanup |
| A05: eight physical and eleven logical fields | Current compact-note maximum-width, selector, delivery, selection, burn and two-receipt tests pass | Both actual delivery and exact note nullification assertions passed in current run; final whole-run record pending |

Current checks: `noir-full-negative-controls.log`103 passed, no failed tests;
`client-artifact-negative-controls.log`53 passed; `client-mining-runtime.log`one
actual zero-account Anvil lifecycle test passed, covering ordinary mining during
unticked work and stopped loops after success, work error and RPC failure.
`build-negative-controls-final.log` records the successful pinned build. Earlier
failed cache-lock/compiler-selection attempts remain preserved and were corrected,
not counted as passes. Existing Noir oracle diagnostic warnings were not suppressed
or treated as an independent cryptographic audit.

`real-network-c40e5544-d29c-49ce-bc37-7c2b3dce5fd4.json` is a failed full journey:
real activation/deposit and claim proof/admission passed, inclusion did not. It
cannot substantiate a delivered note or refund. The continuous-mining correction
has source/lifecycle evidence in `client-mining-review.md`; the actual sequencer
retry must still qualify it. All fresh identities and claim secrets remain in
owned disposable memory. Only sanitized observations are retained.

Local Anvil finality is an actual RPC/rollup check, not Ethereum economic finality.
The test uses an explicitly local long proof window and one native proof agent;
its timings are not a production throughput promise. Later screening, posting,
penalty, wallet recovery, fee privacy, operations, independent audit, fourteen-day
soak and current V5 clearance retain their graph gates.

Current eIh909 run has passed claim inclusion, exact note and consumed-message
replay checks, plus genuine exit proof/inclusion and original-note nullification.
These are intermediate assertion stages, not a completed journey. Actual exit
settlement and L1 refund remain pending. The previous8a92f555 stalled run is
preserved; broker retention1 discarded pending epochs. Two actual broker
scheduling regressions pass with retention64, which the current runtime asserts.
Additional current logs: noir-binding-controls.log4/4, portal-final-current.json
29/29, client-artifact-binding-controls.log53/53, build-binding-controls.log pass.
The production board artifact stayed byte-identical through the test additions.

Run879494b1 is now complete with outcome FAIL: all four genuine exit epochs
were accepted, including canonical proof receipt covering checkpoint11, but the
30-minute exit deadline fired during finality wait. No L1 refund was attempted.
Claim/replay/exact note/exit assertions passed; cleanup confirmed; peak7966464KiB.
See exit-finality-timeout-summary.json and original run for the full record. The
next source snapshot is source-finality-retry.json; its only source changes are
test deadlines45minutes exit/75minutes overall. Application artifacts unchanged.
