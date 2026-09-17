# T02 local application qualification

All three serial genuine-proof profiles passed on pinned Node24.21.0/Aztec5.2.0/Foundry1.4.1, macOS arm64. Commands ran from the repository using scripts/test-c01-application.mjs with --flagged-journey, --redeposit, --unflagged-journey respectively. No prover-none, mocked Inbox/Outbox or network epoch prover. Official local settlement controls apply to actual emitted messages; node proof verification remains enabled. All reports include source/artifact hashes, timings and cleanup.

| Profile | Evidence | Total ms | Peak aggregate KiB |
|---|---|---:|---:|
| Flagged | application-294e5d3a-f794-4316-94ef-86195d42b1f1.json |428824|1642224|
| Redeposit | application-b6698c24-7c15-4035-81cd-b3af28f32dc8.json |442386|1629568|
| Unflagged and wrong origin | application-493aed31-a6a2-4e70-9a30-0eea551a8c78.json |426752|1247936|

All three completed process/temp cleanup within unchanged540s/2GiB limits.

A01 local full journeys pass: genuine claim/post/authorized flag/dummy screening/eligible exit/refund; unflagged posted exit; two no-post cycles with redeposit. A02 exact deposit replacement notes/nullifiers, posts/flags/reasons, screening sequences/cooldown penalty, private author fee balance and payer protocol fees, collateral liabilities and gas-adjusted L1 refunds pass. Moderator uses distinct genesis-funded test identity/public fees, not author private balance.

A03 actual wrong-origin Inbox message has independently checked canonical membership and is rejected for the exact missing bound-portal message during witness generation; subsequent legitimate claim succeeds. Missing-chain withdrawal rejects during constrained execution, preserving valid note. Unscreened and time-locked withdrawals reject. Old consumed claim and exit reject after redeposit without altering fresh state. Corrupted unconsumed exit membership rejects with exact InvalidRoot, followed by valid refund. These are precisely scoped rejection probes, not completed hostile proofs or arbitrary kernel attacks. Consumed-exit rejection occurs before membership and does not independently prove nonce binding.

A04 uses its explicitly permitted documented-blocker branch: public compatibility has NOT been demonstrated. See public-testnet-review005 for current official guidance and required live identity checks.

Work item4 remains unfinished: compiler008 preserves26original and57fresh diagnostics at18sites; unchanged application artifacts do not resolve protocol/VK/private-call/delivery/privacy obligations or replace independent disposition. T02 is therefore blocked, not declared complete. See acceptance-draft009 and compiler008. No browser proof or production readiness claim.

Final source adds optional adverse probes after earlier passing runs. Each report retains its original source hashes. Contract/artifact hashes remain unchanged per compiler008; final release T05 must reverify all required behavior on one candidate.
