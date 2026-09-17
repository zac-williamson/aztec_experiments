# Browser prover memory review 027

Read-only source/artifact inspection. No proving, gate-count jobs, builds, CRS changes or resource-limit changes. Parent reported run 026 sampled 2,113,264 KiB at browser start, approximately 16 MiB above the 2 GiB acceptance threshold. This review does not attribute that excess solely to CRS.

## Supported smaller BN254 initialization

Pinned `@aztec/bb.js/src/barretenberg/index.ts` sets `DEFAULT_BB_CRS_SIZE = 2 ** 19` (524,288), with a smaller iOS-specific default. Its `initSRSChonk` requests that BN254 count and a separate `2 ** 16` Grumpkin count. The browser `CachedNetCrs` forwards the count unchanged to `NetCrs` and to SRS initialization; there is no extra BN254 `+1` in this path.

`node_modules/@aztec/bb.js/src/crs/browser/cached_net_crs.ts:27–34` explicitly supports taking a prefix from a larger cached uncompressed CRS. Its comment requires exactly `numPoints * 64` bytes so WASM's compressed/uncompressed format detection remains correct. Thus a prefix is supported protocol setup handling, not a new or modified ceremony.

The repository's 1,179,648-point BN254 manifest budget preserves a historical 1,048,577-point capacity rounded to the compressed download chunk size; that provenance is not evidence current client Chonk requires every point. Existing uncompressed setup is 75,497,472 bytes. A 524,288-point uncompressed prefix is 33,554,432 bytes, a 41,943,040-byte (40 MiB) reduction in the initialization input. Internal tables, heap reservation, serialization/copies and garbage collection determine actual RSS savings; do not promise a fixed RSS reduction.

## Current artifact observations and capacity limits

Read current generated application JSON only; no compilation or gate computation:

- Billboard raw VK first 32-byte words: claim_deposit 17; post 18; update_portal 14; withdraw 16.
- PrivateFeePayment: mint 16; mint_and_pay_fee 16; pay_fee 14; recurse_subtract_balance_internal 15.
- The SDK input manifest contains 50 protocol artifact JSON inputs, including simulated variants. Twenty-eight have structured verification keys. Their first field/first raw word distribution is 16:5, 17:12, 18:9, 19:2. The two highest are private_kernel_reset_tail and private_kernel_reset_tail_to_public.

These values are consistent with logarithmic circuit sizes, but this review did not verify the pinned C++ serialized VK interpretation or run its circuit-size API. The TypeScript `VerificationKeyAsFields.circuitSize` simply returns field zero, whose observed value is 14–19 rather than a literal gate count. **Do not turn those observed words into an independent capacity certificate by assuming a byte layout.** Supported SDK default 524,288 is the primary evidence for a candidate profile. Per-step gate sizing and actual full transaction proving must establish application compatibility; total Chonk behavior is not proven merely by the largest application VK.

## Narrow safe candidate

1. Preserve the full existing manifest, URLs, hashes and downloaded bytes. Verify the entire selected file against its existing size/hash before selecting a prefix. No new unverified ranged source, no weakened hash check.
2. Add an explicit application BN254 initialization point budget of 524,288. Require an integer positive budget no larger than the verified source's point count. Pass exactly count × 64 bytes for derived uncompressed data, or count × 32 for verified compressed fallback, and pass the same count to `srsInitSrs`. Keep G2 unchanged. Keep the current 65,537-point Grumpkin initialization unchanged to avoid an unrelated change.
3. Update initialization response-size assertions to the selected count/format. Do not retain the full source array in a long-lived promise or cache. A `subarray` avoids an immediate copy but retains the original backing buffer until completion; WASM/worker transfer behavior must be observed. A `slice` owns a smaller buffer but briefly overlaps both allocations. Either still requires full hashing first.
4. Record verified source point count and applied initialization count separately. Assert actual loaded count in browser qualification. Use the pinned circuit-stats/gates API with its documented field semantics for any automated capacity check; do not infer capacity from compressed ACIR byte length or guessed VK offsets.
5. Run the unchanged real private-fee transaction proof and actual verifier/inclusion checks under the same 540-second/2-GiB sampled bound. A setup smoke pass alone does not qualify this reduction. If the actual step requires a larger supported capacity, fail clearly rather than silently increasing memory or using a different backend.

A two-thread cap, no debugger and avoiding duplicate worker heaps remain separate controls. This candidate can reduce CRS-associated memory but cannot establish that a test crossing the RSS threshold before setup initialization will fit: stage/resource attribution still matters.
