# CLI prover integration review 031

Read-only review of `shared/private-pxe.mjs` and `scripts/test-cli-prover-offline.mjs`, cross-checked against the installed pinned SDK, `shared/crs-client.js`, and the streaming proof adapter. No source changes or heavy checks performed.

## Verdict

No blocker found for the next bounded genuine packaged governance command. The offline probe verifies actual initialization, not transaction proving or peak proof memory; the genuine command remains necessary.

## Source-backed checks

- Pinned async `Barretenberg.initSingleton` returns its actual singleton and ignores later initialization options. The new initializer explicitly checks the returned backend, single thread, and skipped automatic SRS setup, so an incompatible pre-existing singleton fails closed. It publishes CLI readiness only after local CRS verification succeeds. A replacement singleton invalidates readiness at PXE creation.
- The CLI initializes the separate Sync singleton for hashing only. Its explicit CommonJS `BillboardCRS` assignment supplies the API required by the bundled initializer; the offline probe now imports that CommonJS default correctly. Node stays on the CLI branch because the CLI loader does not introduce `window`.
- CRS verification authenticates complete local file bytes and hashes before passing the 524288-point prefix to the same async singleton. Network fallback is replaced with a rejecting function. Existing verified compressed local fallback remains possible if derived G1 is unavailable; it does not permit remote downloads or unverified bytes.
- The SDK lazy PXE accepts a `PrivateKernelProver` instance rather than constructing another prover. The subclass retains its installed lazy artifact provider and simulator, while its Chonk override calls the initialized singleton and returns the SDK proof-fields/compressed-proof representation. The streaming helper preserves native verification and compression; it expands one circuit/witness pair at a time instead of upstream's eager arrays.
- `PXE.stop()` closes queue, synchronizer and store, not the global BB singleton. The offline probe explicitly destroys both singleton instances; ordinary CLI process exit owns final backend lifetime. Failed initialization clears application readiness but can retain an allocated async heap until retry or process exit. This is bounded by the enclosing command lifecycle, not a guarantee of immediate memory reclamation.

## Evidence limits and remaining execution

The actual offline probe extracts the real user CLI loader and initializer, loads the real bundle, disables non-data fetches, and asserts the selected backend and zero Sync SRS calls. Its second initializer call checks CLI idempotence. It does not exercise PXE construction, streaming proof generation, the deploy CLI end to end, or memory under proving load. Its fetch counter specifically covers the browser-bundled fetch download path; it is not a general operating-system network sandbox.

Local initialization still temporarily holds the complete approximately 72 MiB derived G1 file, local read/copy buffers, and the WASM prefix. Streaming reduces expanded circuit/witness retention, not BB intrinsic proof memory. Retain the existing aggregate 2 GiB and 540-second limits for the real packaged command. No increase is justified by this review.
