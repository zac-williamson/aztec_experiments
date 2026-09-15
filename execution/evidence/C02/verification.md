# C02 verification

Production target is unchanged. C02 authenticates screening hints against board, owner, owned storage slot and deposit chain, actual historic inclusion, consecutive sequence/previous links and timestamps. Real candidates cannot be skipped; included dummies do not acquire real-post penalties. This package does not claim C03 public identity, C04 unlimited history, or C05 public-inclusion deadline fixes.

## Executed checks

Repository: /Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments. Pinned Node24.21.0, Aztec5.2.0, pinned Noir and native client prover; HARDWARE_CONCURRENCY=1.

- `node scripts/build-contracts.mjs`: passed; canonical Noir/VK artifacts synchronized. Build-fourth.log is final build. Standard preexisting Brillig coverage/lint diagnostics remain visible; no circuit constraints were disabled.
- `node scripts/test-noir.mjs --filter c02`:21 original tests passed, focused-tests-003.log. Earlier attempts recorded a reserved identifier and private SDK accessors in the new fixture; corrected using public get_anchor_block_header/get_new_note APIs.
- `node scripts/test-noir.mjs`:129 tests passed, exit0, full-noir-tests.log. First/last service timestamps span525.57s (about8m46s; log interval, not an independently timed parent). Includes22 C02 regressions after review added the young-real/mature-dummy control.
- `npm run test:c01-clients`:53 tests passed, exit0, client-tests-final.log after final integration.
- `node scripts/test-c01-application.mjs --screening`:passed, exit0; application-775dfdd5-518d-4bb9-bbe8-b3e346d88f6d.json and application-screening-001.log.301649ms total, peak1157056KiB sampled descendant memory (~1.1GiB). Real board deployment, Ready, deposit claim, and two post proofs with ordinary node validation/inclusion. Both post proof stages took about16.46s. Exact original note nullification, single replacement, post note and public content checked. Sequence1/screened0 becomes sequence2/screened1 with prior head as screened link. Wrong-chain hint rejects specifically during constrained witness generation, leaves original note unchanged and sends no transaction.

## Coverage and limits

TXE fixtures first verify actual note-tree membership before expecting exact production authorization errors for foreign contract, owner, slot, schema, fabricated chain, timestamps and sequence/head substitutions. Two authentic TXE receipt claims under the same private owner cannot exchange histories; old included history after private withdrawal/burn cannot screen a new nonce2 receipt. These are maintained constrained execution tests, not generated cryptographic proofs or a simulated claim of L1 refund.

The separate genuine proof run uses one real local L1 deposit and two posts. Its negative changes a chain field of an included hint and is explicitly not an authentic second receipt. Together with included-note TXE controls it qualifies C02's new constraints; it does not assert all adversarial cases were separately proved.

Official SDK controlled Ready/Outbox settlement is the test boundary. There is no network prover, epoch proof, Ethereum finality claim or synthetic application message. The parent enforces a nine-minute limit; all owned process groups/descendants and temporary directory were removed. Source and artifact hashes are checked before and after runtime.

Independent external review, full release reconciliation and target-network clearance remain graph gates. Separate AI source review is supporting engineering evidence, not an external audit.
