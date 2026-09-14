# P04 CRS startup options — bounded feasibility review

Read-only review on 2026-09-12. No browser, prover, performance or proof-generation run was started; no source, setup data, manifest, timeout or point count was changed. This is proposed U01/T04 work, not a P04 pass or production-performance claim.

## Conclusion

Both precomputing decompressed G1 during the build and retaining verified decompressed bytes between browser sessions are supported by the pinned 5.2 API. Either can preserve the exact current setup, point order and capacity. Neither is implemented or measured here. The most direct cold-start experiment is a separately pinned build-derived uncompressed asset; a verified persistent cache can improve subsequent starts while retaining the smaller compressed first download. Both require whole-content integrity verification before initialization. The current generic SDK cache is not a drop-in replacement for that guarantee.

## Verified source semantics

Primary sources read from the official `AztecProtocol/aztec-packages` v5.2.0 tag:

- [SRS command implementation](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/cpp/src/barretenberg/bbapi/bbapi_srs.cpp): `SrsInitSrs` chooses its input path from bytes per point. Compressed input uses 32 bytes per point, requires a positive multiple of 4 MiB, checks compressed chunks against embedded hashes, decompresses points, serializes each to 64 bytes and returns that serialized vector. Uncompressed input uses 64 bytes per point, deserializes directly and returns an empty output vector. Both initialize the BN254 memory CRS factory and check the first two G1 points; only compressed mode performs the embedded whole-chunk checks. The G2 input is hash-pinned, rejected at infinity and subgroup-checked. Exact lengths must remain enforced in our loader because the implementation selects a branch using integer division.
- [SRS response schema](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/cpp/src/barretenberg/bbapi/bbapi_srs.hpp) explicitly specifies empty output when input is already uncompressed.
- [SDK SRS orchestration](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/src/barretenberg/index.ts) passes the data/count/G2 to `srsInitSrs`, then caches returned data only if its length is positive. This confirms both response paths are intentional.
- [Browser cache](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/src/crs/browser/cached_net_crs.ts) prefers cached uncompressed G1 and slices it to exactly `numPoints * 64`. It otherwise obtains compressed data. The inspected code checks cache length, not a pinned whole-content digest, so reusing its cache directly would weaken this application's content checks.
- [WASM backend](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/barretenberg/ts/src/bb_backends/wasm.ts) constructs the synchronous instance with one thread and executes the underlying API synchronously. A JavaScript `await` around this call does not move it off the browser main thread. The async worker backend is a separate instance; moving work there would require correctly initializing every prover instance that actually needs the setup, not assuming WASM state is shared.

The installed `@aztec/bb.js` package reports 5.2.0. Local source copies for SDK behavior were inspected alongside the remote C++ implementation. The remote files were retrieved using bounded read-only HTTPS requests; no compiler or binary equivalence audit was performed in this lane.

## Exact setup to preserve

The current BN254 compressed prefix contains 1,179,648 points: 37,748,736 bytes (36 MiB), SHA-256 `8d6fb7829bcfbfeaf02a79104539bfd3777a328ec46d3331e37effca2ee1b416`. Its uncompressed representation must be exactly 75,497,472 bytes (72 MiB), preserving every point and its order. This review does **not** supply a newly verified digest for that derived asset. It must be computed from the full current prefix and cross-checked during an authorized implementation experiment.

Keep G2 at 128 bytes and Grumpkin at 65,537 points / 4,194,368 bytes with their existing pins. No smaller generic SDK default is evidence that a smaller application setup is sufficient. The historical P02 probe observed a full decompressed result and compared a shorter old prefix, but used version 5.0.0; it is not a substitute for a new complete 5.2 derived-asset verification.

## Option A: build-derived uncompressed asset

Proposed pipeline: load the exact compressed bytes through the existing bounded/hash-verified provisioner; invoke explicitly selected, pinned 5.2 WASM `SrsInitSrs` with the existing point count and pinned G2; require a 75,497,472-byte result; compute and freeze its full SHA-256; publish it as an explicitly named derived format. The provenance must bind the compressed input digest, count, format, pinned SDK/WASM identity and derivation implementation. Independently regenerate and compare the entire derived digest across clean builds/platforms. Do not reinterpret the compressed CDN URL or accept a derivation result merely because its first two points match.

At runtime, verify the derived file's entire size and hash before passing it to the actual API, and require its documented empty `pointsBuf` return. Keep compressed mode's current nonempty-return assertion. A format branch must be driven by the trusted build manifest, never content-length guessing or a cache-supplied manifest.

Concrete integration work would touch manifest schema/provenance, provisioning, client validation, app copying/build manifests, output comparison and regression tests. The current provisioner rejects assets over 64 MiB; do not globally relax download bounds for the new 72 MiB derived output. Separate verified-download limits from the fixed-size derivation output bound. Preserve bounded network responses and atomic writes. The uncompressed asset doubles G1 transfer/storage size before any transport compression; it still requires hashing, copying, parsing and CRS-factory initialization. Whether that tradeoff improves real cold startup is unmeasured.

## Option B: verified persistent browser cache

After successful initialization of pinned compressed input, retain its full decompressed return under an application-specific, versioned key binding input digest, output digest, format and point count. For a later session, require exact output size and its trusted pinned full digest before choosing uncompressed mode. Cache bytes and cache metadata are untrusted; a hash stored alongside mutable bytes is not an independent pin. Publishing the build-derived output digest is the simplest way to preserve offline warm-cache verification without repeating decompression.

Use atomic completion, reject wrong/truncated/oversized/corrupt entries, and fall back to the existing verified compressed path when storage is unavailable, evicted or corrupt. A corrupt cache must never reach SRS initialization. Never cache wallet data in this CRS cache. Do not mark the singleton ready until initialization succeeds, and bind any in-session deduplication to the actual instance and manifest identity. Cache write failure should not invalidate an otherwise successful verified initialization. Persistent caching helps subsequent sessions; it does not remove the initial cold decompression or prove fresh-browser qualification will pass.

## Minimum acceptance experiment before adoption

1. Derive the full uncompressed output using pinned 5.2 and independently compare its full hash from a fresh derivation. Initialize both compressed and uncompressed forms through the actual API in fresh instances; assert format-specific return behavior and unchanged Grumpkin/G2 handling.
2. Exercise actual loader/cache interfaces with valid controls and corrupted middle-point bytes (past the first two), wrong count, truncated/oversized input, stale format/digest, incomplete writes and storage rejection. Assert the invalid uncompressed path is rejected before calling the API. Retain current HTTP/download rejection tests.
3. Run fresh browser qualification for both real consumers, with unchanged limits first, then record cold/warm transfer bytes, hashing, parsing/decompression, total time, peak memory and main-thread responsiveness on representative supported hosts. The existing stage wraps the whole SRS call; its historical 109.642 seconds must not be labelled decompression-only time.
4. Renew generated-output/source binding and affected clean-build checks. Later real workload proofs still establish capacity and end-to-end compatibility. Do not substitute initialization alone for that gate.

The post-recovery retry failed during local page navigation before SRS evaluation. This optimization does not address or explain that failure. Root's host memory/swap/load observations are context, not a causal diagnosis or a reason to weaken qualification.

## Inspected local source fingerprints

- `node_modules/@aztec/bb.js/src/barretenberg/index.ts`: SHA-256 `2c46d64be23c8c9926ce11dab144604b97d3fa46806f6529df8b1dca95a0c24c`.
- `node_modules/@aztec/bb.js/src/crs/browser/cached_net_crs.ts`: SHA-256 `559c2c2c72672d1eebe62950ea531511cb8fc2f61ee8059590be2302caf5704b`.
- `node_modules/@aztec/bb.js/src/bb_backends/wasm.ts`: SHA-256 `624b6975add94244221bad21cec08594bcbb4bd5d390ccdb411857d4e7e64d85`.
- `shared/crs-client.js`: SHA-256 `4b448da1a3476ab4a4afff709297d5c1d03849ecda392662b0e2dcdfe3310860`.
- `scripts/build-crs.mjs`: SHA-256 `89af144e29c34e5bd5ce6eaa1b1e7bfaf20275f29c166dcb358834851ec55155`.
- `crs-manifest.json`: SHA-256 `485de34aa39dde1a5683921ce6c4f614774f64bc453568300020a36d776c3891`.
