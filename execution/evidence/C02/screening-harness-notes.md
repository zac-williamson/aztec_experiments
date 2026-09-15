# C02 application screening helper

Source-only handoff, 2026-09-15. Pinned Node24.21 syntax check passed; no application proof, network or TXE test was run by this lane. Root owns integration and the under-nine-minute supervisor. This helper is not passing runtime evidence yet.

## Integration

Import `proveAndIncludeC02Screening` and call with `{node, preparation, instance, claimResult, l1Client, directory, rpcUrl, mineL1, reportStage}` inside the existing awaited `withC01ClientMining` callback, after `depositAndClaimC01`. The helper owns/stops its ephemeral proving wallet and restores the original sequencer configuration. The original no-post exit helper is unsuitable after this screening scenario; stop the screening profile after its assertions.

Requires the same fresh account/board/native singleton and actual claimed deposit; asserts genuine node verification and absent server prover. Uses the current generated artifact and manifest/input hashes. Parent handles genuine Ready/claim application proofs and official test-controlled settlement, not protocol proving. No foreign service, new depositor, setup download or server proof is introduced.

## Assertions

1. Exact original eight-field deposit plus eleven-field logical view and canonical claim receipt.
2. Actual eligible checkpoint anchor obtained through ordinary mining, then restore minTxs1 before proof work.
3. Genuine first real post: actual PXE proveTx, nonempty proof, normal node.isValidTx, ordinary successful checkpoint inclusion, exact old-note nullifier, single replacement deposit and seven-field PostNote. Verify public counter/message/clear flag, sequence1, no screened progress, exact unpenalized next timer.
4. Wait an actual canonical anchor at both next eligibility and original post anchor+censor_window (bounded fixture values at most60s). Fetch the actual utility hint; match contract/owner/slot/randomness and private chain/sequence/timestamp to the included PostNote.
5. Change only the hint's chain word and require the exact production `C02 wrong chain` error during constrained witness generation. No transaction is submitted. Check original active deposit and logical state remain identical. This is a fabricated-hint guard control, **not** a claim that an independently included wrong-chain note has been supplied.
6. Supply the original actual hint for the second genuine real post, with the same anchor. Require all proof/admission/inclusion checks again, sequence2/screened1/last-real2, screened link exactly equal to the previous head, new PostNote previous link equal to that head, exact nullifier and replacement note, public text/counter, and no unexpected penalty.

All hints, private chain links, identities and note contents stay in memory. Output contains only public tx/proof identifiers, count/boolean assertions and error stage/class/location. Fresh local messages are fixture text. Exact link relationships are checked against included notes and the successful production constraint path; the helper does not copy/reimplement Noir note hashing or manufacture membership.

## Sources and limits

Actual pinned BaseWallet/PXE native request/prove flow and NoteDao debug shapes reuse the already-qualified C01 helpers. SDK ABI decoder maps Option::None to undefined, Option::Some to its value, and field/integer primitives to bigint (`@aztec/stdlib/src/abi/{encoder,decoder}.ts`). PostNote seven-field order and screening state derive from current production main.nr. No note oracle, scope check or proof requirement is patched.

The two independently authenticated receipts, old cycles, foreign owner/contract/slot, grandchild and dummy maturity cases remain in maintained TXE tests. They are not claimed as two-receipt genuine integration evidence by this helper. A second real deposit would add proof and inclusion cost without being essential to this first bounded genuine-screening qualification. Current anchor-based real-post maturity is inherited until C03/C05 public inclusion deadlines; this does not certify their future guarantee.

Each anchor or inclusion loop has a120s local failure limit; the parent540s supervisor remains the total budget. No automatic retries or larger deadlines. Empty checkpoints are enabled only while obtaining eligibility, then restored before expensive client proving. Parent continuous L1 mining stays live through proofs/admission/inclusion to avoid the previously diagnosed publication-clock discontinuity.

Source SHA-256: `584f0830de16c91912d79faf496a7f1dd6318fb9ff61760188025646435db9cb`.

## Root integration source review

Reviewed `--screening` branch read-only: parent enables board/Ready/bridge prerequisites, sets C02_SCREENING in the fresh worker environment and saves evidence under C02; real-node passes screeningOnly; bridge calls helper within the awaited continuous miner after actual claim and returns before the incompatible no-post exit. Failure observations are forwarded, miner teardown is awaited, and native proof/node verification remain unchanged. No source-level runtime/API blocker identified; no runtime pass claimed.

- `scripts/test-c01-application.mjs`: `c48de4f3d5d016b9830b4aac845222cae76e0e9f5f5706a8eba02fc9c30883ad`
- `scripts/c01-real-node.mjs`: `a79ea6b9a9d5b8b2d07d1da5b01f775e202d33353bb03be2a35e6eee09bab374`
- `scripts/c01-bridge-flow.mjs`: `e4472232533622d08ce70a026a26dbd3d44e68b6915cf5a824cbb10cf6c986bb`
- `scripts/c02-screening-flow.mjs`: `584f0830de16c91912d79faf496a7f1dd6318fb9ff61760188025646435db9cb`
