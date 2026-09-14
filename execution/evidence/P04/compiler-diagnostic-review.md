# P04 compiler diagnostic review

**Disposition: sufficient source evidence to continue compatibility engineering, with explicit unresolved proof/release gates; not a clean compiler-security result.** The unchanged application compiled under pinned Noir beta.25 and Aztec 5.2.0 with 26 manual-constraint diagnostics at 12 distinct locations. This read-only review identifies the intended validating paths, including actual assertions where visible. It neither proves that the compiler warnings are false positives nor establishes soundness of the final application/kernel proof. No checker was disabled and no dependency source was edited.

The full occurrences and call stacks remain in `toolchain-compiler-diagnostics.json`. Counts below refer to that isolated compile, not an assurance that all future compiler diagnostics have been inventoried. Official Noir documentation describes the pass as tracing returned values into later constraints; it also acknowledges limitations, but those general limitations do not resolve a particular instance. The documented lookback option is absent from this exact beta.25 executable's saved help, so it was not used. [Noir security checks](https://noir-lang.org/docs/language/unconstrained#security-checks).

## Source and review boundary

Aztec-NR sources are from immutable commit `22e152679f69a2307fdb1b17f60fd4f51a3fd4f5`; protocol sources are from monorepo commit `49a592109ec4f18d79212b43d621891aaf36f7b6`. Their official archives were downloaded during this lane; additional reviewed protocol files are compared directly with those archives in `compiler-diagnostic-review-sources.json`. The source paths below are relative to Aztec-NR's `aztec/src/` unless marked `protocol`, whose base is `noir-projects/noir-protocol-circuits/crates/`.

This is source inspection, not execution of the upstream kernel suites or hostile-witness proving. In particular, 5.2 uses pinned prebuilt protocol artifacts: inspecting source in its repository does **not** establish that those exact source bytes generated the installed circuit artifacts or the target network's verification keys. That correspondence and end-to-end proof acceptance remain separate qualifications.

## Per-location review

### 1. `context/private_context.nr:561` — `in_revertible_phase` (2 occurrences)

**Category: cross-circuit/context check.** The oracle's Boolean chooses which expected side-effect counter is recorded. `PrivateContext::finish` exposes both expectations in private circuit public inputs (lines 526–527). Protocol `private-kernel-lib/src/components/private_call_data_validator.nr:360–381` then asserts the non-revertible expectation lies below the claimed boundary, and the revertible expectation lies at/after a nonzero boundary; `validate` calls this validation at line 117. This is a concrete validator, not merely the adjacent safety comment.

**Unresolved:** correctness of counter initialization, the zero sentinel, aggregation across calls and the protocol-artifact correspondence were not proved here. T01/T02 should include incorrect phase/counter claims at setup/app boundaries in real composed proofs; X01 must cover the counter/context assumptions. [Pinned application context](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/context/private_context.nr#L557), [pinned validator](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/components/private_call_data_validator.nr#L360).

### 2. `context/private_context.nr:829` — `request_sk_app` (1)

**Category: local binding plus kernel key check.** The application asserts that the returned request's public-key hash matches the requested hash, then pushes the request with the selected key-type separator. The request is exported at `finish`. Protocol `reset/key_validation_request/validate_key_validation_request.nr:48–82` derives a master public key from the supplied master secret, rejects infinity, checks its hash, derives the app-siloed secret using contract address and separator, and checks it against `request.sk_app`.

**Unresolved:** the application circuit alone cannot establish possession/correctness of the master secret. T01/T02 must reject mismatched app keys, key types and contract scopes with the actual reset/kernel artifacts; X01 must review request propagation and caching. [Pinned key validator](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/reset/key_validation_request/validate_key_validation_request.nr#L48).

### 3. `history/note.nr:46` — `assert_note_existed_by` (1)

**Category: demonstrable local membership check, narrower than application authorization.** The helper computes the note commitment including owner, slot and randomness, siloes it with the **hinted** contract address, adds its settled nonce, and asserts membership against the supplied header's note-tree root. `types/src/merkle_tree/membership.nr:27–38` recomputes that root from the sibling path and leaf index. The oracle's full header is not an assertion that every header field must affect this witness; the particular tree root is the relevant binding.

**Unresolved/application gap:** existence of a note from any contract is the API's deliberate guarantee. It does not establish that the hinted owner/slot/contract belongs to this billboard's intended deposit chain, nor non-nullification. This warning's local inclusion rationale therefore does **not** fix B05. C02 must add intended origin/chain bindings; T01 must exercise wrong-origin and wrong-chain notes and malformed membership witnesses. Anchor-header authenticity still depends on composed context/protocol validation. [Pinned helper](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/history/note.nr#L30).

### 4. `history/storage.nr:26` — `public_storage_historical_read` (3)

**Category: demonstrable local indexed-tree check.** The expected leaf slot is hashed from contract address and storage slot. `types/src/data/storage_read.nr:22–62` checks membership and the expected leaf/low-leaf relationship, returning the committed value for an existing slot or zero for a proven absent slot. Thus the returned witness/preimage is not accepted as a bare value.

**Unresolved:** header/root authenticity and application choice of address/slot remain caller responsibilities. C01/C02/T01 should cover wrong-slot/root/preimage and authenticated portal configuration. This helper does not fix `claim_deposit` accepting its portal argument. [Pinned storage verifier](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/types/src/data/storage_read.nr#L22).

### 5. `keys/getters/mod.nr:27` — `get_public_keys` (2)

**Category: demonstrable local address-preimage binding.** The returned public keys and partial address are passed to `AztecAddress::compute`; line 28 asserts the resulting address equals the requested account. The source also contains a bad-hint test, which was read but not run in this review.

**Unresolved:** this validates the address derivation under the framework/hash assumptions; it is not an independent proof of private-key possession or of every higher-level authorization condition. T01 should retain wrong-key/partial-address rejection with real proofs; X01 reviews the address/key assumptions. [Pinned getter](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/keys/getters/mod.nr#L25).

### 6. `messages/delivery/tag_derivation.nr:88` — `existing_handshake_secrets_or_else` (2)

**Category: downstream conditional and cross-contract validation; needs composed coverage.** The oracle selects existing handshake secrets or a fallback strategy. The board explicitly requests `onchain_constrained()` delivery at its three note-emission sites. `delivery/tag.nr:71–72` invokes `source.constrain_tag_secret`; `tag_secret_source.nr:75–101` validates the existing-handshake branch, requires index zero for new handshakes, and rejects unconstrained-secret sources. `constrained_delivery.nr:34–54` calls registry `validate_handshake` at index zero, otherwise requests the previous sequence nullifier; every send emits a sequence nullifier.

**Unresolved:** merely selecting a permitted branch is not full handshake authentication. Registry code/address/artifact identity, first-use bootstrap, predecessor validation and concurrent sequence semantics must be exercised together. W02/T02/T03 and X01 should cover nonexistent/fabricated existing secrets, first-use and reused handshakes, invalid indices, real recipient discovery, and concurrent sends. No old board compatibility path is required. [Pinned branch constraints](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/messages/delivery/tag_secret_source.nr#L75), [registry/predecessor requests](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/messages/delivery/constrained_delivery.nr#L34).

### 7. `messages/encryption/aes128.nr:260` — invalid-recipient fallback in `AES128::encrypt` (2)

**Category: intentionally sender-chosen fallback randomness.** The ordinary branch uses `recipient.to_address_point()`. Only an invalid address triggers a randomly chosen address point; encryption then uses the resulting ECDH secret. The stated framework behavior avoids forcing an otherwise impossible encryption operation for an invalid recipient. Since the sender already knows plaintext and ephemeral secret, requiring that fallback value equal a specific oracle result would not establish confidentiality against that sender.

**Unresolved:** this is not a guarantee that an invalid recipient can decrypt, or that the random implementation has adequate entropy. For this product, address validation and real note discoverability must be verified (W02/T02/T03); X01 should confirm the valid-address branch cannot be bypassed in the compiled circuit and the fallback does not affect authorization/state commitments. [Pinned encryption branch](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/messages/encryption/aes128.nr#L237).

### 8. `messages/encryption/aes128.nr:356` — ciphertext padding in `AES128::encrypt` (2)

**Category: intentionally unconstrained random padding.** The code first fills the ephemeral-key and masked ciphertext fields, then fills only the remaining padding positions with random field elements. There is no intended equation forcing a particular padding value. This is distinct from an unconstrained balance, recipient, note commitment or signature result.

**Unresolved:** source reasoning does not establish padding bounds in emitted ACIR, entropy quality or resistance to sender-chosen metadata leakage. W02/T02/T03 should exercise encrypt/decrypt/discovery across payload sizes, and X01 must review privacy and entropy assumptions. Do not call this warning a demonstrated compiler false positive. [Pinned padding](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/messages/encryption/aes128.nr#L344).

### 9. `messaging.nr:35` — `process_l1_to_l2_message` (1)

**Category: demonstrable local message membership check.** The helper computes a message hash and nullifier from its arguments. It ignores the oracle-returned leaf index, recomputes the tree root using the **caller-supplied** leaf index and returned sibling path, and asserts that root equals the supplied L1-to-L2 root at lines 41–42. An unused returned field and an oracle argument used to select an available message are not themselves evidence of an accepted fabricated message.

**Unresolved:** membership proves a message under the provided sender/content/network parameters; it does not authorize the application's choice of portal. C01 must bind that origin and preserve replay/conservation checks. T01/T02 must reject wrong content/index/root/origin and replay with actual L1/L2 proof composition. [Pinned messaging](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/messaging.nr#L29).

### 10. `note/note_getter.nr:173` — `get_notes` (2)

**Category: local note metadata checks plus kernel existence check.** `confirm_hinted_notes` bounds the count, checks contract address, optional owner, storage slot, packed selection and ordering, computes a note-existence request, and pushes it through the context. The board uses the owned private-set abstraction. Kernel reset validates pending reads against an earlier matching same-contract value, or settled reads via membership against the selected root. The read-request validator also constrains propagation of requests not discharged in that reset; the tail validator requires no outstanding requests.

**Unresolved:** existence is not non-nullification; the consuming `pop_notes`/nullifier flow must be checked too. Oracle completeness is not guaranteed: passing metadata constraints does not guarantee every available note was returned, and it does not repair the separate fixed-history utility. C02/C04/T01/T02 should cover altered owner/slot/contract, invented notes, duplicate/omitted notes and actual spending/nullifier behavior. [Pinned note checks](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/note/note_getter.nr#L188), [read request validator](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/reset/read_request/read_request_validator.nr#L50).

### 11. `nullifier/utils.nr:18` — `compute_nullifier_existence_request` (4)

**Category: cross-circuit branch validation.** Both candidate requests are computed from the caller's nullifier/address; the oracle only selects pending versus settled. Initialization then pushes the selected request. Pending validation checks matching value, same contract and earlier counter. Settled validation requires zero scoped address, matches the siloed leaf and verifies membership. Tail validation rejects leftover nullifier requests.

**Unresolved:** this is a request-routing rationale, not a proof the particular compiled kernel discharges all requests correctly. T01/T02 should use incorrect pending/settled hints, wrong scopes and missing/late initialization nullifiers; X01 must review reset propagation and initialization ordering. [Pinned pending checks](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/reset/read_request/validate_pending_read_requests.nr#L35), [settled checks](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/reset/read_request/validate_settled_read_requests.nr#L43).

### 12. `oracle/get_contract_instance.nr:18` — `get_contract_instance` (4)

**Category: demonstrable local address-preimage binding.** Line 19 asserts `instance.to_address() == address`. The pinned `types/src/contract_instance.nr:17–43` includes salt, deployer, original class ID, initialization hash, immutables hash and public keys in address derivation. The initialization caller consumes the bound initialization hash. This struct deliberately contains the original class ID, not an upgradeable contract's current class ID.

**Unresolved:** current executable class authorization and initialization-nullifier existence are separate protocol checks. T01/T02 should reject altered instance preimages and absent initialization; X01 must inspect the actual protocol class/address linkage. [Pinned instance binding](https://github.com/AztecProtocol/aztec-nr/blob/22e152679f69a2307fdb1b17f60fd4f51a3fd4f5/aztec/src/oracle/get_contract_instance.nr#L15), [pinned preimage](https://github.com/AztecProtocol/aztec-packages/blob/49a592109ec4f18d79212b43d621891aaf36f7b6/noir-projects/noir-protocol-circuits/crates/types/src/contract_instance.nr#L17).

## Qualification and remaining gates

There are five locations with directly visible local verification (11 occurrences), four relying on context/kernel validation in addition to any local checks (9), one handshake path requiring downstream/cross-contract coverage (2), and two intentionally nondeterministic encryption paths (4). This accounts for all 26 observations. No newly demonstrated unconstrained application-state exploit was established by this source review; equally, no warning is closed as a proven false positive.

Official framework documentation corroborates that contexts submit note/key requests and the private kernel/reset circuits validate and accumulate them. These are architecture explanations; the pinned code above is the version-specific evidence. [Function context](https://docs.aztec.network/developers/docs/aztec-nr/framework-description/functions/context), [private kernel](https://docs.aztec.network/developers/docs/foundational-topics/advanced/circuits/private_kernel). Note discovery documentation further supports treating registry and encryption behavior as a real client integration requirement. [Note discovery](https://docs.aztec.network/developers/docs/foundational-topics/advanced/storage/note_discovery).

Recommended disposition for root: P04 may qualify matched source/API/build compatibility only if these diagnostics are preserved as explicit unresolved security qualifications. T01/T02 must add the adverse proof cases above against the installed protocol artifacts, T05 must reconcile final-source diagnostics and artifact identities, and R01/X01 must include this inventory for a qualified independent Aztec/Noir reviewer. The known C01/C02/C04 application defects and X03 deployment clearance remain independent gates. A success-only real proof is a compatibility control, not sufficient adversarial coverage. Agent source review cannot satisfy X01.
