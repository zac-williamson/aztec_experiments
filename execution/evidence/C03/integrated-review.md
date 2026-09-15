# C03 integrated source review — runtime pending

Internal integration review; this lane authored parts of the contract, engines and harness. This is not an independent external audit. Read-only final review performed while root supervises the sole genuine ten-author run; no production edits or additional tests launched.

Binding: `source-bounded-blocks.json`, fingerprint `459da5273160c6e878d48b8a0145455bdd5748b13f1a619738e10b9c7dd35843`, records the frozen candidate. All reviewed files listed below match their snapshot SHA256. Evidence documents remain outside the running source mutation boundary.

## Findings and criteria

No additional concrete C03 source blocker identified after the recorded retry fixes. Overall C03 is **not yet passed**: C03-A01 still requires the active actual ten-author inclusion result. Earlier ten-author runs timed out/remained pending and are retained as failures; the one-author diagnostic's success is explicitly nonqualifying.

- **A01, pending runtime:** private `post` no longer reads or reserves the public count. It derives Field identity with actual Poseidon2 `[1,board,nonce]`, separator0x42420102. Only the self-authorized public callback assigns a u64 append order. The genuine harness requires ten distinct claimed rights, byte-identical private anchor headers for all ten proofs before any submission, normal node validation, all successful canonical receipts, exact consumed/replacement notes and ordered public identities. The local maxTxsPerBlock1 geometry does not weaken this invariant; it excludes node batch-throughput qualification.
- **A02, source/tests supported:** nonzero real nonce and ID, uniqueness guard, checked u64 order, canonical UTF-8 byte length/padding and public inclusion timestamp are implemented. Field-keyed content/flag/response maps preserve large identities. The maintained TXE ten-author test checks unique IDs/content/order and flags only the intended seventh identity. Client listing resolves order to identity; moderation carries that identity through getters and signing. Signer rejects malformed/duplicate identities and uses fixed argv with `--post-id`; model output supplies reason/verdict rather than selecting the authority/configuration.
- **A03, source/unit supported:** actual wallet path submits once through the raw node, reconciles the exact hash, revalidates a generic dropped transaction against structured pinned reasons, then rechecks its receipt. Ambiguity stays unknown/no-resend. One real-post nonce survives whole-state refresh; refreshed attempts reread rights/hints and produce a new proof. Included SUCCESS is required; proposed/reverted/mismatched receipts fail. Dummy retry is limited to missing-anchor failure and owns a single two-refresh budget; outer dispatcher and auto-screening cannot override refusal. Focused helper controls cover both retry propagation seams, receipt becoming included during validation, ambiguity and budget exhaustion. These are actual-used-function unit controls, not a genuine concurrent same-note conflict proof experiment.
- **A04, source/tests supported within counter scope:** dummy requires zero nonce, empty content/length, produces private ID0 and never calls public publication; withdrawal does not read the public post counter. Maintained TXE controls show dummy private advancement, unchanged public count, and subsequent real order0, together with existing screening/exit tests. This does not assert arbitrary network scheduling/fee availability or long-history liveness.

## Actual evidence versus pending checks

Read recorded logs: full-noir-tests-001.log says137 tests passed; client-final-tests-007.log says174 passed, zero failures; daemon-final-tests.log says one integration test passed. The Noir suite includes eight C03 controls plus migrated C01/C02 behavior. Its ten-author case uses sequential actual TXE claims/calls and is correctly labelled **not same-anchor proof preparation**. Exact generated artifacts and proof runtime are bound by the parent harness; this review does not substitute log counts for the pending actual ten-author criterion.

No broad release claim follows. C04 retains required-link/paginated discovery beyond16/32/1000 and multiple-deposit long-history work. C05 retains penalty survival, timing/arithmetic/finite-exit invariants and publication-policy/final-deadline integration. Current publication deliberately does not fabricate policy versions/events; the current censor call lacks the future expectedPolicyVersion binding. These staged omissions remain production blockers in their own work packages, not waived requirements. Fee sponsorship/privacy and external release/network checks likewise remain separate graph gates.

## Reviewed source SHA256

- `billboard/billboard_contract/src/main.nr`: `1fd727ad380d6a4478911b0a6c7b17092f9fe9dfe83688bbd1690d5cf6a83dd0` (snapshot match: true)
- `billboard/billboard_contract/src/lib.nr`: `dcccd20777da4b6871c1e47a358675f9c7e26d0067a15ebbdde18c0490e0b5af` (snapshot match: true)
- `billboard/billboard_test/src/lib.nr`: `3eaaa9c1da3484eb715a60a39204a74b85322a846a662ffa3223606e7072ceea` (snapshot match: true)
- `billboard/billboard_test/src/c03.nr`: `7772009d9ede0ae13e00d146af18fe1369d2fbf9fae5bc640379ee759eadb416` (snapshot match: true)
- `apps/src/billboard/user/engine.js`: `48527f20da1b34f63a29bf157ce9a418c92bed6047110ba4d9b19ff4224c7231` (snapshot match: true)
- `apps/src/billboard/censor/engine.js`: `48527f20da1b34f63a29bf157ce9a418c92bed6047110ba4d9b19ff4224c7231` (snapshot match: true)
- `apps/src/billboard/user/cli.mjs`: `0854bafebf2f78300c0e44f75556ca5c70a5c8dc3515975f1e4aaca76ceb9e39` (snapshot match: true)
- `censor-daemon/signer.mjs`: `07180a97e5e27e9df4d73fca991e6d0fec4114ea0f570e76da6d4e3ce1c8b2ae` (snapshot match: true)
- `censor-daemon/daemon.mjs`: `50eeadc782765e5815f1390e57a4a41ed8bd49eae3fc91d93ca05949a385a152` (snapshot match: true)
- `scripts/test-c03-post-client.mjs`: `7abbc0ce2b4396c1f9cebb035af0326339c7f0eadebcaa034e6026f9080673fb` (snapshot match: true)
- `scripts/c03-contention-flow.mjs`: `a718bf68546fee6b35018e1558505ff3043be6234ca0d2221567b05481af9ea1` (snapshot match: true)
- `scripts/c03-author-claims.mjs`: `8c4f2ff5f24d18e188a26dddc409d3603a993a740dc2bb61184f28b703227a25` (snapshot match: true)
- `scripts/test-c01-application.mjs`: `304d6b90fe7aa5729945e26a3fe24dd2077e4971aebdf5577dfa10c660948374` (snapshot match: true)

## Post-review test-harness clock delta

Root subsequently corrected the disposable mining clock and added a deterministic actual-SDK regression. Reviewed in slot-timing-review.md; one recorded regression passes. This changes the harness snapshot, not production contracts/clients. The next run must bind its current sources explicitly; earlier failed results remain historical. Ten-author acceptance remains pending at this note.

## Final genuine ten-author runtime disposition

Independently inspected application-db6d60e3-d8cf-43a4-9c5d-e6f3a796c23c.json and its source bindings. **C03-A01 is now supported by this passing actual application run**, not the prior one-author control or sequential TXE test. Diagnostic mode is false; worker result and durable progress agree on substantive fields (the progress file additionally carries stage/elapsedMs).

Observed476849ms overall below540000ms; peak1521136KiB below8GiB. Ten fresh author claims passed exact note/message-nullifier checks. Ten distinct client proof fingerprints and transaction hashes were prepared before any submission at common header fingerprint `e25deef5669d375583532b04ceecff95cb6700021abc4d334eb0ed5cf6703867`. The source asserts each actual proof's header bytes equal the frozen PXE header, not merely a shared label. Each passed normal node verification and reached canonical checkpointed SUCCESS. All ten original deposit nullifiers, replacement notes, PostNotes and public contents were checked. Ten unique IDs received orders0..9 matching actual block execution order across blocks17..26; preparation order differed.

Actual node realProofs is true, network prover absent. Local maxTxsPerBlock1 is explicitly application-test geometry, not throughput qualification. Ready/Outbox settlement remains official test-controlled setup, not epoch proof or economic finality. Wallet/mining shutdown, singleton shutdown, absent descendant tree and directory removal all succeeded. Mining recorded378 ordinary blocks and maximum pre-sync clock lead0. This supports the local clock repair's observed outcome; previous failed reports remain unchanged.

All22 run fingerprints match current files. Project entries also match source-clock-fixed.json fingerprint `a801ecd983fd606a1f8085d5aafec2a1b19ade8b261bb97613cf6748df1cfa42`; installed dependency entries outside that project snapshot are separately bound by the run fingerprints: `node_modules/@aztec/ethereum/dest/deploy_aztec_l1_contracts.js`. Additionally reviewed contracts, C03 tests, both engines, signer/daemon, retry tests and clock test match the project snapshot. Result SHA256 `8a5584ff4c4bafca6a66d3eeb5d9e385634a36008b91ccacb682a22a72f82e19`. No source changes or runtime launched by this final review.

No remaining C03 acceptance blocker found in combined evidence: A01 now has actual ten-author same-anchor success; A02–A04 retain reviewed source/maintained controls. Root owns graph closure. C04/C05 and other production release gates remain open; this is not a whole-application production-readiness or external-audit claim.
