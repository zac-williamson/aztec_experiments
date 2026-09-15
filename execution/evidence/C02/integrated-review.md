# C02 integrated source review

Read-only review of applied production and maintained TXE controls, 2026-09-15. No tests/proofs/builds run by this reviewer. Production review is a separate integration lane; this reviewer drafted the C02 tests and therefore does not present their test-design review as independent external assurance.

## Conclusion

No concrete C02 production authorization or ancestry defect found in the reviewed diff. Runtime qualification remains root-owned. One focused additional test would distinguish the new dummy-maturity behavior from the inherited real-only checks; see below.

## Production reasoning

- ScreeningScope is constructed from the executing board, actual caller, posts.at(caller) storage slot and selected live deposit identity. Both raw supplied typed metadata and confirmed note metadata must match; actual assert_note_existed_by remains between these checks. Merkle inclusion is not substituted for application authorization.
- Deposit sequence ordering, sentinel/head relationships and equality of screened/head sequence iff screened/head link fail closed. Child must be precisely screened+1, no greater than head, with previous link equal the stored screened link. Its recomputed keyed note link equals head iff its sequence is the head sequence.
- A head child rejects extra grandchild. A mature non-head child requires the immediate successor; any supplied successor is authenticated even when the child is young. Grandchild sequence, previous link, nondecreasing timestamps and head iff relation are checked. Advancement uses child_mature AND gc_mature, preventing a young unscreened real child from being skipped.
- Included dummy notes are immediately mature and never read a public flag. A real candidate retains the current anchor-age and historical flag behavior. Future timestamps are rejected before maturity; subtraction is guarded. This does not implement C03 stable public identity or C05 inclusion-based deadlines/economic overflow bounds.
- New head sentinel rejection and consumed DepositNote replacement preserve the existing single-use state transition. u64 successor arithmetic remains checked: reaching the horizon fails rather than creating wrapped ancestry. Finite-horizon behavior and current public post_id truncation/counter allocation remain explicit downstream C03/C05 work, not newly introduced C02 guarantees.

## Test quality and exact failures

The applied c02.nr contains21 tests with exact should_fail_with application errors. The seven child-substitution variants insert actual test-context notes, select by fresh randomness, verify their actual typed metadata, then call assert_note_existed_by successfully before attempting the production post. A failure in setup or membership does not satisfy an unrelated expected C02 error. Artificial note issuance is explicitly test-only; no production mint bypass is claimed.

Normal matching child, young real pair, dummy flag/no-penalty, independent same-owner receipts and new-cycle controls exercise successful production transitions. Two receipt tests use production message content/chain functions and actual TXE message consumption, with independent private chains and unchanged other-receipt state. Old-cycle controls actually withdraw/burn the old private right before a fresh nonce2 claim; genuine L1 refund/redeposit is not simulated or claimed in that bounded fixture.

Foreign contract/owner/slot/schema/chain, sequence gap, identical-content different randomness/head, unused/duplicate hints, future timestamp, reversed grandchild time and grandchild sequence failures target distinct actual production predicates. Current public SDK utility_context_at and last_block_timestamp accessors are used rather than private test-environment fields. Existing legacy suite retains valid grandchild/flag/timer and dummy/withdraw transitions for root to rerun.

## Recommended discriminating addition

Add one valid included young-real-child/mature-dummy-grandchild control, using the young_pair timing:2x deposit, real post at+1801, dummy post at+3600, next post at+5400. Authenticate both actual hints before the call; assert child1 remains young, grandchild2 is dummy, and screened sequence/link stay zero afterward. Existing two-real young_pair cannot distinguish removal of child_mature from the advancement condition because ordered real grandchild timestamps make that grandchild young too. The implementation already has the correct condition; this is a narrow regression-coverage improvement.

## Scope limitations

C04 lifetime hint discovery remains capped at16. C03 retains dummy public-order removal and stable post identity; C05 retains inclusion-time maturity, penalty overflow/finite-exit semantics. C02 must not claim those future interfaces from this diff. TXE controls do not become cryptographic proofs; the separate genuine application screening mode must prove and include the actual private transitions, using only user-authorized official controlled protocol settlement.

## Reviewed source hashes

- `billboard/billboard_contract/src/main.nr`: `3b97859fe3f694410a0155743e6c25b2eaf286ee0e40cc2a1fe494cc72b7cab1`
- `billboard/billboard_test/src/c02.nr`: `31cd5da52520dd912c5c301eb3d2dbaec02b19d290f29c1abe33f76a7a2f0e43`
- `billboard/billboard_test/src/lib.nr`: `2ea1d30a2f30a31be2579a35760b53885705d9a7f8122bfd2c0a4f4cfcabbc7b`
- `execution/interface-spec.md`: `13824f7d093ea6c5b460c771609b4188e4770fd0af834cfc8b372cb4ef0c12c1`

## Unapplied discriminating test patch

`young-dummy-regression.patch` extends the existing young_pair helper with a dummy-grandchild switch, preserves both previous calls, and adds one positive no-skip test. Both candidates undergo actual membership checks. Explicit assertions establish that the real child is one second too young, the grandchild is already included, and its timestamp remains younger than the real-post censor delay; dummy status alone makes it mature. The production call must still leave screened sequence/link unchanged. No source applied and no test run. Root must apply only after the active source-bound suite finishes.

Base c02.nr SHA-256 `31cd5da52520dd912c5c301eb3d2dbaec02b19d290f29c1abe33f76a7a2f0e43`; patch SHA-256 `cf9df9e8e4e384ca65bb4fa929c903657277647c4040fae286d146299d5c5756`. This changes tests only, from21 to22 C02 tests; no production input semantics change.

## Applied regression and final local-suite disposition

2026-09-15: Read the applied young_pair(dummy_grandchild) change and new c02_young_real_child_blocks_mature_dummy_grandchild test. It preserves both existing cases, verifies membership for both notes, establishes the real child is exactly one second too young and the included dummy would independently be mature, then requires screened sequence/link remain unchanged. This resolves the narrow coverage finding above without changing the reviewed production condition. C02 now contributes22 maintained tests.

Root reports the final integrated full Noir suite **129 passed, exit0**, logged duration525.57s, including this regression; client suite **53 passed**. This reviewer read the log summaries and the specific new test line but did not execute these suites. The active genuine --screening run has no outcome yet and is not treated as passed. No application/test/harness source was edited by this disposition.

- `billboard/billboard_contract/src/main.nr`: `3b97859fe3f694410a0155743e6c25b2eaf286ee0e40cc2a1fe494cc72b7cab1`
- `billboard/billboard_test/src/c02.nr`: `9b0f06c632ebbbb32625ff91e55338828e63fd946f7223fa9dcb9921f3c37320`
- `billboard/billboard_test/src/lib.nr`: `2ea1d30a2f30a31be2579a35760b53885705d9a7f8122bfd2c0a4f4cfcabbc7b`
- `scripts/c02-screening-flow.mjs`: `584f0830de16c91912d79faf496a7f1dd6318fb9ff61760188025646435db9cb`
- `execution/evidence/C02/full-noir-tests.log`: `900ab9c70314dd3b18026c61d02ce5d5bf122385aa3f123ef11f1553168f1828`
- `execution/evidence/C02/client-tests.log`: `f5da0d884dab2057b968ca12eb3244dba1dab81e35dac4f4f372a0df70df816e`
- `execution/evidence/C02/source-candidate.json`: `ba8d3b4097df7e79207b3356b7dfd70d4aaaaacc660b6db88c1f47e91d3da4ec`

## Genuine application screening qualification — complete

Independently read compact fields of `application-775dfdd5-518d-4bb9-bbe8-b3e346d88f6d.json` (SHA-256 `60026d6a86c6836f9019374ffff3c4d3b119fc519ae669ad2f4a67b381ebc8d7`). The first actual screening attempt passed in **301649 ms (5m01.649s)**, peak sampled descendant RSS **1157056 KiB**, with node/Anvil/wallet/singleton shutdown, miner stopped, descendant tree absent and temporary directory removed. All 20 recorded source hashes match the current files exactly; no post-run source delta was found.

The real claim precedes two actual nonempty client proofs, normal node verification and ordinary successful checkpoint inclusion (blocks10 and13). Both posts check the exact old DepositNote nullifier, single eight-field replacement and seven-field PostNote, unchanged immutable receipt identity, expected public content/order and exact unpenalized timer. First transition has head sequence1/screened0; second has head2/screened1/last-real2, screened link equal to the prior head and new PostNote previous link equal to that head. This exercises production C02 authentication/history in genuine application proofs, not a copied local validator.

The deliberately changed chain field fails specifically with C02 wrong chain during PXE constrained witness generation. No rejected transaction is submitted; the original note/state remains unchanged, followed by successful use of the untouched actual hint. This is a **one-receipt mutated-hint control**, not an independently included second-receipt attack. The22 maintained TXE controls separately cover genuinely included test-context foreign metadata, two authentic same-owner receipts, old cycle, grandchild and dummy conditions; their inclusion checks and explicit limitations remain as described above.

Protocol settlement is explicitly official TEST CONTROLLED. The node retains real application proof verification and creates no server prover; this result does not claim an epoch proof, production network finality, throughput or external cryptographic audit. No additional C02 blocker is identified by this review. C03–C05 ownership remains unchanged.

Source binding for final helper: `584f0830de16c91912d79faf496a7f1dd6318fb9ff61760188025646435db9cb`.
