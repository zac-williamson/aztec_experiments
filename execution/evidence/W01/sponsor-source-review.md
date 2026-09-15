# W01 sponsor source/integration review

2026-09-15. Bounded read-only review; no compiler, build, proof or test execution in this lane. Root reports the16 pure policy tests and37 artifact/dependency guards passing; these results are not independently rerun here. Genuine composed sponsorship remains unqualified.

## Integration disposition

No concrete source blocker found in the inspected sponsor/budget delta. The three external roots are fixed to the configured immutable board and exact delegated methods. There is no caller-supplied target, selector, relay or additional-call array. Internal coupon consumption retains the private root context, checks membership/actual gas/anchor range, lowers protocol expiry and consumes its owner-bound claim before each external method elects the payer and ends setup. Supplied screening hints must be settled before that transition; board historical authentication checks them again. Explicit owner continues to govern notes and coupon NHK; admin can register future capacity but cannot replace a batch or reclaim reservations.

Public registration reads current reserved state, validates division bounds before multiplying, and performs immutable batch initialization plus reservation update in one public call. Private roots read only immutable config/batch, so an old anchor cannot recover an obsolete lower reservation balance. Admin rotation does not revoke issued coupons. Fixed windows have nonoverlapping inclusive ends; protocol expiry, rather than anchor-time check alone, limits eventual inclusion. Reserved capacity is worst-case authorization, not refundable actual spending.

`contractInputs` recursively includes the new packages. Build processing checks dependency trees, normalizes artifacts, verifies per-contract embedded source inventories and writes/copies sponsor hash into the contracts manifest. `check-artifacts` requires exactly the three named private roots and their VKs plus byte hash binding. That structural check is not itself semantic verification of root-only constraints; those are in reviewed source and must be exercised. Initial read found missing BillboardSponsor embedded inventory; root subsequently reports populating103 sources against existing locked package hashes. Current inventory is fingerprinted below. Production client/deployment still must identify the reviewed sponsor instance/class and immutable board/config, not trust a remote address solely because an artifact has matching method names.

One required integration detail was reported: NO_FROM does not supply a default author tag sender. SDK constrained delivery resolves `get_sender_for_tags()` independently of the owner passed into the board. Genuine client execution must pass the controlled owner as PXE `senderForTags` (wallet `sendMessagesAs` seam) and supply that owner's scopes. Root reports recording this in its client integration notes. This is privacy/availability configuration, not authority to change the board's authenticated owner.

## Retained Brillig diagnostics

The sponsor compile log contains30 diagnostics at seven SDK origin files. The earlier fee fixture v2 contains22 at the same seven; C01 board build6 contains34, with six of these origin files shared and additional board paths. Repetition or upstream ownership is not the disposition. The constrained paths inspected are:

- `public_immutable.nr:328`: the availability oracle is followed by a scoped initialization-nullifier existence request submitted to the context/kernel, plus historical storage read of the immutable hash. `WithHash` binds the returned structured value to that stored hash.
- `history/storage.nr`: an oracle supplies a witness, but `public_data_storage_read` verifies the address-siloed leaf index and indexed-tree membership against the actual header public-data root.
- `oracle/get_contract_instance.nr`: the returned instance is required to recompute the requested address. This is address-preimage binding, not an unsupported assertion about arbitrary upgradable runtime code.
- `keys/getters/mod.nr`: public keys and partial address must recompute the owner address. `private_context.nr` separately requests the relevant siloed key, checks the requested public-key hash, and exports a key-validation request. The kernel reset validator derives the master public key and application-siloed key and checks the requested values.
- `nullifier/utils.nr`: oracle choice selects pending or settled existence-request representation; it is not an existence proof. The scoped request is passed to kernel validation. The availability assertion is not being treated as the constraint.
- `private_context.nr:1184`: the simulated nested call is exported as a `PrivateCallRequest` carrying exact caller, target, selector, args hash, return hash and counter range. `private_call_data_validator.nr` validates it against the child's public inputs; no unused return value allows omission of the child call.
- `context/returns_hash.nr:30`: the oracle preimage is rehashed and compared, including the empty return case. A zero-length result does not remove the separate call request.

This trace identifies explicit intended constraints for the warned paths; it does not prove compiler soundness, exhaustively audit kernels or replace genuine composed application proof qualification. Diagnostics remain retained and are not suppressed. No demonstrated missing constraint was found in this bounded review.

## Unapplied public-storage test draft

`sponsor-public-tests.patch` adds a separate sponsor_test package and workspace membership, with9 actual TXE public-call tests: constructor/config reads, two-batch exact same-window capacity and independent later-window reservation, exhaustion, globally duplicate batch ID, unauthorized registration/rotation, authorized rotation preserving earlier commitments, old-admin rejection and registration after the actual current-time boundary. No private payer root is called. The configured target is explicitly inert for these policy-only public calls. Exact actual refund, sponsor fee payment, genuine proofs and live issuance remain separate acceptance work. Patch applicability was checked without applying it; no tests were run.

## Source hashes

- `billboard/sponsor_common/src/lib.nr`: `5a619d185100cb482ce0ec988cf5fe694be35764307fe2f389306653a9fdff5d`
- `billboard/sponsor_contract/src/main.nr`: `33ab289d70c04b1cc30b0de75737a15ff949669fbb9360ce5071cc98bcdf70af`
- `scripts/check-noir-dependencies.mjs`: `17be15dc0297b52fe959b9581067284c19e8426ecfc72463c1bd36c963123549`
- `scripts/build-contracts.mjs`: `d0874a181e58d74022386e3baba04550b58ffbda388589955dd4da9ff7f97d00`
- `scripts/check-artifacts.mjs`: `195fad77ff41efd4376f6e7264b1c0f2d50ae3786f10158378ef8100ed371cfa`
- `scripts/artifact-provenance.mjs`: `7a0bc1717b199a8425f6bf846f7fdd184f98e62a733e3eac7baadc50d12a9ef4`
- `noir-dependencies.json`: `8a02779c0403461deb0e6e641786b353aa6105cf84cd065b479c2a36b9bc7470`
- `execution/evidence/W01/sponsor-compile-001.log`: `ae93b3078951638f15272b5a57979ec2fadad669614e52cf4669e7019622efde`
- `execution/evidence/W01/fixture-v2-compile.log`: `d7fd8fa2db46d4505c11be8c0851a3b889946bc86d6179fdfa029405f689fe11`
- `execution/evidence/C01/contracts-build-6.log`: `a6d9e34cdfc9c8c6ed4ea0133c97ebb0f96380aae0b0e51b59b48f0024fe6967`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/state_vars/public_immutable.nr`: `20156f921f526047c882a8be36290aa74d379995556160186afe260f654924da`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/history/storage.nr`: `c73be49d2d219051e1079cca667cf6f5caa23547ad0a969fcbcada5ce64fa395`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/utils/with_hash.nr`: `10d8ef1c558f63c6766a75020519f84c10a73e98e3f314c179b7a1dbbcfaae3d`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/keys/getters/mod.nr`: `354144ac27ea16d71b3c090c0c4db02f07dd85b09a8656cf7dcccfb4173a374a`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/oracle/get_contract_instance.nr`: `d9c296e45885a5a32e20b1f942ca6b00d150afcaf15b1d262f8ebdb239ce8903`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/context/private_context.nr`: `29a0032aa88697997495a7ef73498d920d29bea222b48bdb3dcff170c2a9ab86`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/context/returns_hash.nr`: `b37560f27c929c2643e6c0616f00f82d015577f57f15727126fc70d2c3b972ce`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/nullifier/utils.nr`: `3e0bda86c100a2c80fa945763939720a1d30915b9ef0d9969154f7b044f24f1f`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/messages/delivery/mod.nr`: `7553f3e0d0a153aff1ae5d1ec191d9aaeff68eab2bd0010de3d3f0ac02cc79a0`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-nr/v5.2.0/aztec/src/state_vars/single_use_claim.nr`: `4092053ccaa2cee72aee084d5f67ee77180355b2a9012d630ef530f478571c20`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/components/private_call_data_validator.nr`: `2051d33161576bb6f2966bffb1b6e8f97733e2662a25a9f4958ff58e5f2b3946`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/noir-protocol-circuits/crates/private-kernel-lib/src/reset/key_validation_request/validate_key_validation_request.nr`: `0adf4b2478ad79410249e73010608ca2f65f20befb7c92ed90cdcf013c2911a9`
- `execution/evidence/W01/sponsor-public-tests.patch`: `e913b3ddf5aefc00a586f9f002a184c7808cede2467eed8d5afd80045bd79134`
