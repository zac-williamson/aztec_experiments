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

L2 component extension097 now passes145 combined journal/engine checks; the final
wallet integration extension passes91 engine checks. Four real operation-record
shapes survive prepared, accepted-response-loss-state, before-confirmed and
after-confirmed boundaries on file/IndexedDB. Original transaction bytes/hash,
operation and screening/withdrawal nullifier binding are preserved with one total
submission. The matrix's response-loss throw follows its fixture send; it proves
retained journal state, not production RPC promise handling.

The actual wallet also rejects submission after failed durable preparation and
recovers an actual encrypted journal after interruption at local confirmation,
without another proof or send. SDK transactions, prover and chain responses are
fixtures; this is not additional cryptographic integration evidence. Independent
application_change_review approved. Claim-specific sync-failure restarted
completion and genuine accepted claim/screen browser cases remain distinct gaps.

## Layered application-specific closure100/101

Actual engine claim and screening recovery now runs in a fresh VM with real
encrypted journals, controlled canonical receipts and synthetic SDK transactions.
Claim is interrupted after confirmation during sync; screening after acceptance.
Changing current UI intent does not replace saved intent or cause another action.
Both recover the original hash and subsequently refresh state.93engine checks
pass; independent application review approved. Contract state transitions remain
explicit fixtures here, separately qualified by genuine journeys.

The built HTTPS UI reload check101 passes with persisted public configuration and
only recover/status dispatch before navigation. Its explicit callEngine fixture
is not another engine/journal/proof integration. Run100 failed first because its
old timestamp fixture did not match current RPC; that fixture was corrected without
a timeout or application change. Independent structure review approved.

Genuine post050 and withdrawal096 stages bound complete browser restart/restore/
reconciliation/cleanup at14.643s and14.358s respectively, excluding preceding proof
construction; see recovery-timing-100.json. These are conservative healthy-local-RPC
bounds, not total-run-time claims or public-network guarantees.

The earlier preparation-001 suggestion of one genuine crash run per operation was
an implementation plan, not a distinct governing criterion. The current hierarchy
uses genuine post/withdraw crash integration, all-stage durable-boundary tests,
actual engine claim/screen restart and builtUI reload routing. This avoids a second
mechanism or redundant proof matrix while retaining REQ07/T04 interruption coverage.
It does not close unrelated stable-browser, wallet, performance, soak or release gates.
