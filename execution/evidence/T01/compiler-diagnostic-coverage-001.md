# Compiler diagnostic reconciliation — open security qualifications

The adjacent JSON preserves **all 26 original occurrences and their complete call stacks**, covering 12 locations. The current Billboard artifact embeds exactly the P04-reviewed source bytes at all 12 locations. It records current application bytecode/verification-key hashes per emitted function, both application artifacts, build-manifest hashes and all 50 protocol JSON artifacts embedded in the current SDK. Each installed protocol file was hashed and compared to the SDK manifest. Simulation artifacts are explicitly distinguished from proving artifacts.

This is exact-byte reconciliation, not proof that an old warning still reaches every listed entrypoint. Named original Billboard callers still exist; macro-generated callers conservatively map to current private entrypoints. A fresh compiler diagnostic inventory remains required. Matching embedded source is not a demonstration of emitted ACIR soundness, protocol source-to-artifact correspondence, or target-network verification-key identity. **No warning is closed. Independent disposition remains open.**

## Existing coverage and the missing proof boundary

| Original location (occurrences) | Existing application evidence | Still missing |
|---|---|---|
| private_context.nr:561 (2) | Genuine composed claim/post/withdraw controls in C01/C02 | Incorrect phase/counter oracle claims through setup/application boundaries and actual kernel rejection |
| private_context.nr:829 (1) | Genuine withdrawal uses configured owner key | Tampered app secret, key-type separator, public-key hash and contract-scope requests against actual reset/kernel artifacts |
| history/note.nr:46 (1) | C02: included foreign contract/owner/slot/schema/chain and successor constraints; genuine second-post proof; wrong-chain mutation rejected during constrained witness generation | Fabricated sibling path/leaf index/header root and cryptographic witness mutation; current application proof rejection of each hostile case |
| history/storage.nr:26 (3) | C01 portal-origin/configuration binding tests; D01 runtime/config/actor preflight | Corrupted indexed-tree preimage/low leaf/root, wrong storage address/slot; authenticate supplied header via actual composed proof |
| keys/getters/mod.nr:27 (2) | Genuine owner note creation/spending and recovery controls | Altered public keys/partial address at oracle boundary; proof rejection, not only client validation |
| tag_derivation.nr:88 (2) | Genuine claim/post note discovery in C01/C02/W01 | Fabricated existing handshake, invalid index, false predecessor, wrong registry artifact and concurrent-sequence hostile cases |
| aes128.nr:260 (2) | Genuine recipient discovery and spendability | Invalid-recipient branch manipulation; prove valid recipient cannot be replaced and state authorization unaffected; independent privacy review |
| aes128.nr:356 (2) | Genuine note encryption/discovery controls | Padding boundaries across payload sizes and entropy/privacy review; padding need not equal one prescribed random value |
| messaging.nr:35 (1) | C01 actual Ethereum deposit, genuine claim, consumed-message replay rejection; TXE wrong sender/content/amount/nonce/recipient/secret cases | Malicious oracle sibling/index/root manipulation under actual composed proof; no epoch proving is required for application probes |
| note_getter.nr:173 (2) | C02 scoped included-note tests; W03 genuine same-note nullifier/spend recovery | Fabricated/duplicated notes, incorrect pending/settled routing and read-request discharge; omitted notes are availability/completeness, not automatically soundness |
| nullifier/utils.nr:18 (4) | Normal initialization and authentic note spending controls | Wrong pending/settled hint, wrong scope and missing/late initialization nullifier through actual kernel/reset artifacts |
| get_contract_instance.nr:18 (4) | D01 original/current class and deployed configuration checks | Tampered instance address preimage and absent initialization at constrained oracle boundary; current class authorization remains a separate protocol obligation |

Evidence scope is deliberately conservative:

- `execution/evidence/C02/application-results.json` reports two genuine post proofs and a wrong-chain included hint mutation rejected at **PXE constrained witness generation**, with no transaction submitted. It explicitly does not claim an authentic second receipt in that run.
- `execution/evidence/C02/full-noir-tests.log` and the maintained `billboard/billboard_test/src/c02.nr` cover actual TXE-included fixture notes. Those fixtures establish application constraints; they are not malicious kernel proofs.
- `execution/evidence/C01.json` distinguishes genuine application transaction flows/replay from TXE/test-root cases and controlled Outbox settlement. Controlled settlement is not epoch-proof qualification.
- `execution/evidence/W01/application-8df5c9f5-4b7d-4a4c-9a90-4d726f9748e5.json` and `application-74babdac-4283-478d-97ae-5dd5fa9c0909.json` provide genuine post/spend/recovery controls. Success-only real proofs do not close compiler diagnostics.
- These are historical runs for their recorded source. T01/T05 must rerun or reconcile affected behavior against the candidate; this table does not promote old runs to fresh acceptance.

## Narrow feasible next probes

1. Extend the existing C02 included-hint mutation path, retaining the actual included note and changing only one field at a time: randomness/nonce, owner, slot, contract and post-chain/head. Assert exact failure stage and unchanged original note. Current C02 already covers several scope cases; prioritize missing cryptographic membership mutations rather than duplicating those tests.
2. Interpose a test-only oracle response at the existing membership-witness boundary, change one sibling or leaf index, and execute the same constrained application witness generation. Keep a valid unmodified control. A rejection there is evidence of application constraint enforcement, **not** an actual rejected completed proof. If the current harness exposes no safe oracle interception, document the missing seam instead of changing protocol dependency sources or compiling with checks disabled.
3. Exercise the real claim with wrong supplied message index/content/secret after creating one authentic L1 deposit, preserving a successful control. Actual replay is already measured; add only gaps and keep the entire application test below the established deadline.
4. Public-key/contract-instance oracle-preimage corruption can be bounded application-circuit probes if the PXE oracle can be wrapped. Claims about key possession, request propagation and pending/settled discharge require the actual relevant kernel/reset circuits and a qualified reviewer. Do not build a network epoch prover for these tests.

Independent Aztec/Noir review must disposition all 26 occurrences, source/artifact correspondence, cross-circuit requests and privacy assumptions. Application probes can reduce uncertainty but cannot substitute for that disposition.
