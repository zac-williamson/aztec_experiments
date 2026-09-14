# BaseParity next experiment recipe

Read-only preparation, 2026-09-14. No harness edits, download, test, proof or network request. Padding success is recorded separately; it does not qualify this larger circuit.

## Inputs and independent output checks

Use the real installed `ParityBaseArtifact` (SHA256 `429ce3ba64ebb4a1c1c0674cff23cc2a0bb3896e56cab37d215ed03289f4394e`) with `ParityBasePrivateInputs`: exactly256 canonical Fr messages, `vkTreeRoot: Fr`, `proverId: Fr`. Use a deterministic asymmetric sequence including zero/nonzero leaves and two distinct nonzero metadata fields. These are fresh test values, not chain messages or an authenticated prover identity.

Actual Noir `rollup-lib/src/parity/parity_base.nr` returns four fields in order: SHA Merkle root, Poseidon converted root, unchanged VK tree root, unchanged prover ID. Both trees pair adjacent leaves through8 levels. For every SHA node use SHA256(left32BE || right32BE), retain the **first31 digest bytes**, prefix zero (not digest modulo Fr and not dropping the first digest byte). For every Poseidon node use actual SDK Poseidon2 hash with separator2982624097 (`DOM_SEP__MERKLE_HASH`) over left/right. Implement independent tree reduction in the harness, compare all four decoded outputs and the four actual proof public-input fields. SDK parity constructor also requires the SHA root's first byte zero.

The proof settings are `ultra_honk`: disableZk=true, Poseidon transcript, ipaAccumulation=false; do not reuse padding's `ultra_rollup_honk` settings. Use installed real input/output converters, WASM witness execution, and exact native BB with one thread. Verify the real proof; alter one public root to a different canonical field while preserving the proof and require false; restore original inputs and require true. This directly binds the proof to a computed result. Preserve corrupted-proof content rejection as an additional control if bounded. A second proof is unnecessary for this first capacity measurement.

## Actual CRS degree; no inherited +1 rule

Installed VK field0 encodes log domain22 => 4,194,304. The native `UltraProver::construct_proof` sets `key_size = prover_instance->polynomials.max_end_index()`; only ZK flavors add a separate minimum. `CommitmentKey(num_points)` forwards **exactly num_points** to the CRS factory; there is no +1 here. `max_end_index` is the largest actual polynomial end, not automatically the full dyadic domain. Shiftable polynomial construction retains its final end within the virtual domain. Thus a full2^22-point BN254 prefix is a safe source-derived capacity bound for the non-ZK circuit; the exact request count is not established by the VK alone and has not been measured here. Require actual stats domain2^22 and observe successful use of the bounded prefix. Do not label a guessed max-end count as observed.

Required full-domain prefix: **268,435,456 uncompressed bytes**, corresponding to **134,217,728 compressed bytes**, HTTP range **0–134,217,727**. This is32 complete4MiB compressed chunks /131072 points each. No IPA/Grumpkin proving requirement is introduced by BaseParity's non-IPA flavor; keep already-verified G2 and existing small Grumpkin profile unchanged if the native startup expects it. Do not preload all server circuits.

## Qualifying existing cache without trusting it

The existing global1GiB uncompressed file covers2^24 points by size only. Qualify only its first256MiB for this experiment; do not claim the remaining768MiB is verified.

Preferred bounded cache-reuse method:

1. Obtain the official compressed range over HTTPS (`https://crs.aztec-cdn.foundation/g1_compressed.dat`), with exact206/Content-Range/total bound and32 sequential4MiB chunks. Bind and verify every chunk against the **matching pinned5.2 embedded BN254 chunk hashes**, in addition to recording HTTP provenance and full-range SHA256. First confirm the reference header's provenance/version matches the installed BB; a checksum newly computed over arbitrary cached header bytes alone is not publisher attestation.
2. Stream corresponding global-cache8MiB uncompressed chunks. For every point require canonical BN254 base-field x,y and y² = x³+3; serialize x | ((y & 1)<<255) as32BE and compare byte-for-byte with the verified official compressed chunk. **Recompression alone is insufficient**: a wrong y with matching parity would otherwise pass. Pinned `affine_element_impl.hpp:21–47` establishes this sign convention. No square roots are needed for this check.
3. Write only the validated256MiB prefix into an isolated file while computing its SHA256. Hold a regular no-symlink source descriptor, check source identity/size before/after, and rehash the staged file; never hardlink a mutable global cache into a supposedly immutable proof input. Keep at most one4MiB network chunk plus8MiB uncompressed chunk resident, discard network chunks after validation, retain only the256MiB staged prefix/provenance. This adds no duplicate GB file and no persistent128MiB compressed file. Reading the global file does not confer trust on it; every consumed byte must pass point validation and reference comparison.

Simpler alternative: ignore global cache, download/pin the128MiB compressed prefix, let the pinned native code derive its256MiB uncompressed file in a disposable directory, then retain only the output hash/provenance needed for the proof. This avoids custom per-point validation, but native cached-compressed integrity handling needs the following qualification first.

**Native verification caveat:** inspected cached `get_bn254_crs.cpp` has `verify_bn254_crs_integrity`, compiled chunk hashes, and optional `BB_VERIFY_CRS=1`. Download validation covers rounded complete chunks. In the cached-compressed branch it reads only `num_points*32` bytes before that validation; a partial final chunk is compared with the embedded chunk hash. If actual `max_end_index` is not a131072-point boundary, this can reject correct cached bytes even when the file has a complete larger prefix. The inspected source does not contain a `verify_bn254_compressed_buffer` function or callable `verify-crs` implementation (despite a comment mentioning that command). Read-only `strings` inspection of the exact installed arm64-macOS executable also found no `verify-crs` or `verify_bn254_compressed_buffer` text. This is corroboration, not a run of its CLI help. Resolve any difference with the root's inspected source and actual pinned executable before choosing this convenience route. Do not disable an integrity requirement just to obtain a pass; independently verified full chunks plus verified derivation/point comparison provide a maintainable alternative.

A bounded simpler recipe therefore does **not** depend on `bb verify-crs`: verify all whole compressed chunks in JavaScript using SHA256 and version-bound embedded pins, then let normal pinned native code derive its uncompressed file. If source-cache provenance needs strengthening, check whether the complete763x32-byte hash table extracted from the header occurs verbatim in the pinned BB executable; require that match before treating that table as the executable's pins, otherwise stop and resolve its provenance. This byte-table match is proposed, not performed here. Permit only the derived BN254 file and lock writes in the isolated CRS directory; keep compressed/G2/Grumpkin input files immutable and IP networking denied. Posthash inputs and record derived output size/hash, then remove temporary compressed/derived files after the proof. Retained evidence stays small.32 full chunks cover the non-ZK domain bound;33 is a conservative additional4MiB compressed chunk only if explicitly chosen, not evidence of a protocol +1 requirement.

## Proposed execution bounds and result

Separate setup qualification from proof timing. After the source/prefix preparation has passed, reuse the successfully qualified padding supervisor, offline sandbox, explicit NODE_BACKEND=js, one native thread, safe failure diagnostics and process-group cleanup. Start with the existing300second proof budget and bounded setup budget agreed before implementation; record actual witness/proving/verification timings, native resource observations and exact failure stage. No automatic retry or timeout increase. This first real BaseParity proof measures a nontrivial server-circuit workload on this host; it still does not establish full rollup capacity, C01 application proofs, accepted epochs, or genuine bridge roots.

## Inspected source fingerprints

Paths below are relative to the cached5.2 checkout; publisher contents were not freshly retrieved.

| File | SHA256 |
|---|---|
| `barretenberg/cpp/src/barretenberg/srs/factories/get_bn254_crs.cpp` | `50acc7fd0279f78c966512d958c66b0086832ccb47da0610d637717d843eaa1c` |
| `barretenberg/cpp/src/barretenberg/srs/factories/bn254_g1_chunk_hashes.hpp` | `fed28be863d5941f0f3325628c87ab11e61887cff306b0fae4b872f88f9b8f40` |
| `barretenberg/cpp/src/barretenberg/ultra_honk/ultra_prover.cpp` | `701b4cc9590f0c8fd82538924d52c24c6742374a3045de828fb5b56c2fc71441` |
| `noir-projects/noir-protocol-circuits/crates/rollup-lib/src/parity/parity_base.nr` | `8f66bf4dac87434761926cd25a2a1c882fd6df0082475be531bb356fc880ec7b` |

## Completed read-only embedded-pin binding

Parsed763 rows of32 bytes from the cached header and searched the exact pinned BB file for the first33 concatenated rows (1056 bytes). Observed occurrence offsets: [16269120, 16679870]. Binary SHA256 `208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031`; first33-row transcript SHA256 `c55bd14dfb3258cefdde3fd76d7f056e325baa92467b67507fd8f49e9a9d7915`. The exact1056-byte sequence occurs twice. Both are exact matches to the same33 expected hashes; uniqueness is unnecessary for binding those values to this executable, and no claim is made about which copy is read at runtime. This supports independent SHA256 verification against the first33 embedded values before normal pinned native decompression. Use this route without a verify-crs CLI, recompression implementation or global-cache comparison. No downloaded bytes or cache data were verified in this lane.
