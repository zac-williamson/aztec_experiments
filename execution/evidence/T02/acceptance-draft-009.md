# T02 acceptance draft — conditional, not completion

Read-only preparation, 2026-09-17. This draft does not mark the graph complete. The unflagged/wrong-origin run007 was still in progress when this draft was prepared; no passing result is inferred from source review or progress logs.

| Criterion | Evidence available | Disposition and limit |
|---|---|---|
| A01: full journey with actual proof generation/verification | `application-294e5d3a-f794-4316-94ef-86195d42b1f1.json` and `flagged-disposition-004.md`; `application-b6698c24-7c15-4035-81cd-b3af28f32dc8.json` and `redeposit-disposition-006.md` | Local flagged lifecycle and two no-post/refund lifecycles passed with actual application proofs and normal node verification. Official controlled settlement uses the actual bridge contracts; no mocked Inbox/Outbox or disabled application prover is asserted. This qualifies application composition, not network epoch proofs or public settlement. Unflagged lifecycle remains pending007. |
| A02: balances, liabilities, notes, public posts and flags match | Same genuine reports: exact notes/nullifiers and public post/flag/reason, private fee debit/protocol balance, receipt/liability deltas, gas-adjusted refunds | Passed for completed profiles. Moderator is distinct and authorized, using its own genesis-funded public fee balance; author transactions pay privately. Unflagged screening and its resulting state must still pass007. |
| A03: wrong portal/note/replay reject without false success | Redeosit006 old-claim/old-exit rejection and changed genuine Outbox sibling; flagged004 premature withdrawal constraints | Replay and malformed Outbox membership passed; wrong-origin and absent-chain cases await007. If007 passes, describe exact scope: genuine wrong-sender Inbox message rejected by origin-bound message witness lookup, absent deposit chain rejected by private execution, followed by a successful legitimate claim. These are not a universal forged-note/hostile-oracle soundness proof. |
| A04: demonstrated public compatibility OR explicit suitable-environment blocker | `public-testnet-review-005.md` | Actual public compatibility has **not** passed. The criterion permits a documented blocker; retain the candidate network, live identity checks not yet performed, official-guidance uncertainty, unblock conditions and next actions. Treat this as documented-blocker disposition, never as a successful public deployment. |

## Completed report scope

Flagged004 passed in 428824 ms with sampled aggregate peak 1642224 KiB and full cleanup. It includes private author claim/post, distinct moderator flag before deadline, dummy screening, unscreened/time-debt rejection, eligible withdrawal and actual L1 refund.

Redeposit006 passed in 442386 ms with sampled aggregate peak 1629568 KiB and full cleanup. It includes two genuine private-fee claim/exit/refund cycles, incremented nonce, distinct private chain, original consumed claim rejection with the fresh note unchanged, old exit rejection with the fresh receipt/accounting unchanged, and malformed sibling rejection before each valid withdrawal. `Outbox__AlreadyNullified` precedes membership verification, so old-exit replay does not independently prove receipt-content/nonce binding.

Reports preserve their own source hashes. Subsequent harness edits do not retroactively become part of earlier run evidence. Root should verify007's finished report, per-stage observations, source hashes and cleanup before updating this draft's pending dispositions.

## Work that remains even if007 succeeds

T02 Work item4 explicitly requires reconciliation against final emitted **application/protocol** artifacts and relevant adverse proof/privacy cases plus independent disposition. `compiler-reconciliation-008.{md,json}` verifies unchanged application contract/artifact bytes, eight compiler inputs and 34 manifest inputs. It does not establish all protocol circuit/verification-key correspondence or complete hostile kernel/private-call/delivery/privacy coverage.

All 26 original occurrences at 12 sites and 57 fresh occurrences at 18 sites remain preserved and unresolved. Open obligations include private-call return/counter/target constraints, pending/settled request routing and discharge, initialization/class authorization, malicious delivery/tagging/randomness behavior, AES metadata/entropy privacy and exact protocol-artifact correspondence. Honest-path proofs and narrow replay checks do not supply independent disposition.

Therefore a blanket statement that every T02 work item is fulfilled would be inaccurate even after007. Root must either retain this work explicitly incomplete or record a graph-level handoff of each remaining compiler/protocol/privacy obligation to the appropriate final-source/security-review gates (including T05/X01), with evidence links and no waiver. External review remains external; agent review is not its substitute.

The public candidate's live canonical Registry/rollup, node, Inbox/Outbox and artifact identities remain unchecked, and no public deployment/settlement journey has run. A04 allows an explicit blocker, but the release/public compatibility gate must stay open until the documented next actions are completed. A maintenance version difference alone is not established incompatibility.

## Finalization checklist for root

- Inspect007's completed, source-bound result and adverse-case/positive-control observations; record failure honestly if it does not pass.
- Retain exact commands/environment and sanitized receipts/timings, all three profile source inventories, and cleanup observations.
- Record the separate diff/assumption reviews and distinguish controlled local settlement from public network settlement.
- Resolve graph ownership of Work item4's outstanding protocol/privacy/independent-review obligations explicitly.
- Use A04's documented-blocker branch without declaring public compatibility successful; retain blocker/unblock conditions in graph evidence.
- Only then reconcile acceptance/prerequisites, validate graph, and update status/evidence as appropriate.
