# Recovery boundary coverage — current work inventory

Independent read-only review: application_change_review. This maps existing tests;
it is not a claim that the missing cases have passed.

L2 stores the entire transaction before submission (`shared/l2-journal.mjs`).
Its confirmation acknowledgement is memory-only: reopening rechecks the saved
transaction against the chain. There is no separate L2 response-persistence write
to add or simulate. L1 persists intent before signing and transaction hash after
submission, so both persistence boundaries matter there.

| Stage | Before submission | Accepted / response lost | Included / local completion interrupted |
|---|---|---|---|
| Claim | Shared L2 journal restart; exact claim intent fixtures | Shared journal; genuine browser interruption missing | Shared included receipt; claim sync-failure fixture; stage-specific restarted completion missing |
| Post | Shared L2 journal; genuine stale-proof replacement is distinct | Genuine browser restart050 | Shared journal; deterministic completion-boundary injection missing |
| Screening | Shared journal plus exact source-sequence/application-nullifier intent | Shared journal; genuine accepted-screen restart missing | Stage-specific restarted completion missing |
| Withdrawal | Shared journal plus source-note/exit attribution | Genuine accepted-withdraw browser restart missing | Canonical exit fixtures; stage-specific completion interruption missing |
| Ethereum deposit | Exact nonce/calldata/value recovery, failed storage prevents signing | Real mined response loss in test-w03-ethereum-anvil.mjs | Same real test covers inclusion before hash persistence; successful-send restart also covered |
| Ethereum refund | Shared implementation; fault tests need explicit withdraw parameter | Real mined response loss in test-w03-ethereum-anvil.mjs | Same real test plus explicit successful-send refund restart |

Existing component sources: `scripts/test-w03-journal.mjs` (file/IndexedDB,
actual SDK transaction fixtures, not genuine proofs),
`scripts/test-w03-ethereum-journal.mjs`, `scripts/test-engine-private-fee.mjs`,
`scripts/test-w03-proof-replacement.mjs`. Real Ethereum source:
`scripts/test-w03-ethereum-anvil.mjs` (deposit/refund and private-fee funding).

Next component work: parameterize Ethereum faults over deposit/withdraw; interrupt
immediately before/after hash persistence and reopen without resending. Preserve
actual operation metadata across L2 boundaries. Use existing actual-wallet tests
for stage-specific completion failures; do not multiply every boundary by a full
browser proof run.

Next genuine integration: accepted withdrawal of an unposted claimed deposit,
using the existing response-loss hook and full persistent-profile restart. Verify
one original transaction/fee, consumed original note, exact exit leaf, no active
note, and unchanged outstanding Ethereum escrow. Reconnect the same Ethereum
account after recovery to discover the pending refund in the UI. Do not claim a
completed Ethereum refund or introduce settlement into this recovery scenario.

Ethereum component boundary extension now passes47 tests across file/IndexedDB and deposit/withdraw, including interruptions immediately before/after hash persistence. Original hash/event and no second send checked; independent review approved. Evidence: ethereum-recovery-boundaries-095.log. These are simulated chain responses with actual storage adapters, not additional genuine proofs.
