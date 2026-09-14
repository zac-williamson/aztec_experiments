# Authenticated bridge acceptance — current candidate

C01 remains open. Source snapshot `source-claim-retry.json` identifies commit
3de1bea and fingerprint b7952ab81c874a49d28f6b8cfeda55e18b74dee16f5cd7554b24b249b6aaa91a.
This document distinguishes passing local checks from the still-running genuine
bridge retry. It is not production-readiness or external-audit evidence.

| Criterion | Recorded evidence | Remaining evidence |
| --- | --- | --- |
| A01: intended collateral creates exact rights | Current Noir exact-receipt/eligibility controls pass; prior real L1 deposit and claim proof/admission passed | Actual delivered note and complete current bridge journey |
| A02: wrong actor/scope/amount/secret/unbound reject | Current103-test Noir suite includes changed nonzero depositor and changed in-range amount, wrong portal/recipient/version/chain/nonce/secret and unbound controls; historical canonical portal envelope tests | Reconcile final portal test snapshot |
| A03: no repeated claims/refunds | Current TXE cross-owner replay and repeated burn controls; canonical portal replay and fresh-nonce controls | Actual consumed-message replay rejection and real refund/repeat-refund check |
| A04: genuine integrated message/proof path | Genuine Ready proofs, Ethereum proof receipts, finalized local membership and portal activation passed; failed claim-inclusion attempt remains recorded | Current complete deposit/claim/no-post-exit/refund run with cleanup |
| A05: eight physical and eleven logical fields | Current compact-note maximum-width, selector, delivery, selection, burn and two-receipt tests pass | Actual private claim delivery and exact note nullification in genuine journey |

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
