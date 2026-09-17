# Browser prover thread review

Read-only inspection of installed pinned Aztec 5.2.0 implementation. No proof, browser or build run.

The current `shared/private-pxe.mjs` only supplies private loggers. Its browser callers pass a store, not `proverOrOptions`; therefore it does not constrain proving threads today.

## Supported production option

`createPXE(node, config, {proverOrOptions: {threads: 2, backend: BackendType.WasmWorker}, ...})` is the supported API:

- `@aztec/pxe/dest/entrypoints/pxe_creation_options.d.ts:16` permits a `BBPrivateKernelProverOptions` object.
- `@aztec/pxe/dest/entrypoints/client/bundle/utils.js:44–51` creates `BBBundlePrivateKernelProver` with that options object (unless given a custom prover instance).
- `@aztec/bb-prover/dest/prover/client/bb_private_kernel_prover.d.ts` defines its options as `BackendOptions` plus logger.
- The same prover's `createChonkProof` at line 142 and gate-count path at line 167 forward those options to `Barretenberg.initSingleton`.
- `@aztec/bb.js/dest/browser/bb_backends/wasm.js:64–65` forwards `options.threads` to `fetchModuleAndThreads` and WASM initialization.
- `@aztec/bb.js/dest/browser/barretenberg_wasm/index.js:3–13` defaults to 32 requested threads, then uses `min(requested, available hardware threads, 32)`. Setting 2 therefore gives at most 2 proving threads, possibly 1 on lower-capacity devices.
- `barretenberg_wasm_main/index.js:46–50` creates `threads - 1` auxiliary workers because the main proving worker counts as one thread. With 2, the proving backend has one main worker and one auxiliary worker; this does not cap every browser/service/storage worker.

## Singleton constraint

`Barretenberg.initSingleton` caches its first promise and ignores later options (`barretenberg/index.js:115–130`). Passing `{threads:2}` later is insufficient if an earlier caller already initialized the async singleton with defaults.

The reviewed browser Poseidon path uses the distinct `BarretenbergSync` singleton (`@aztec/foundation/dest/crypto/poseidon/index.js:5–13`). Existing CRS initialization also uses Sync. Its WASM backend explicitly fetches with one thread (`bb_backends/wasm.js:22`). Those do not by themselves reserve the async proving singleton with an excessive thread count.

## Narrow implementation recommendation

Centralize the browser policy in `shared/private-pxe.mjs`, using imported `Barretenberg` and `BackendType` rather than guessing enum strings:

1. In the actual browser branch, enforce `proverOrOptions` backend `WasmWorker` and threads 2 after any caller options. Reject a caller-supplied custom prover instance in this browser path rather than letting it bypass the bound. Keep the existing Node/native path unchanged.
2. Initialize the async singleton with those same options before handing off to SDK PXE construction and assert returned `.options.backend` and `.options.threads` match. Reject a previously initialized incompatible singleton with a fixed public error; do not destroy or replace it while other work may use it.
3. Continue existing private logger injection. Do not expose prover logs just to count threads, mutate `navigator.hardwareConcurrency`, replace workers, or use a test-only backend override.
4. Verify option forwarding and incompatible-singleton rejection in lightweight unit tests. Actual browser qualification can observe the returned singleton options plus worker construction without changing production settings.

This limits the private proving backend's configured thread count. It is not a process-wide browser concurrency limit, a two-gigabyte memory guarantee, or evidence that a representative transaction proves within the target runtime. Those require the existing bounded real-browser proof measurement.

## Implemented policy

`shared/private-pxe.mjs` now enforces the browser-only supported `WasmWorker`/2-thread options before SDK PXE creation, initializes and checks the async singleton, and refuses custom prover instances or incompatible cached options without destroying them. Node/native options remain unchanged. Prover, PXE and store diagnostics remain silent; initialization failures use a fixed public classification. This initializes the async proving backend when creating browser PXE rather than waiting for its first proof.

Five lightweight tests in `scripts/test-private-pxe-browser.mjs` pass: option forwarding/override, cached mismatch, custom-prover bypass rejection, unchanged Node/native behavior, and log/error privacy. These execute the actual wrapper with injected SDK seams; they are not real-browser proof or resource measurements. SDK rebuild and bounded real-browser qualification remain the parent's next steps.

## Separate-heap CRS correction

A subsequent source check identified that async `Barretenberg.new` otherwise calls `initSRSChonk`, which downloads its own `NetCrs`. Loading setup into `BarretenbergSync` does not initialize the separate async proving heap. The wrapper now forces and checks `skipSrsInit: true`, then uses the existing SHA-256/size-verifying `BillboardCRS.initialize` on the exact async singleton before PXE is created. Browser fallback network fetching is explicitly denied; only locally served pinned CRS files are accepted, with redirects rejected. In-flight/success initialization is cached by singleton in a WeakMap, retaining only its promise, not setup byte arrays. Failures block PXE and clear that cache for retry.

The supported `initializeBrowserProver` helper is exported through the SDK entry point and shared with `aztec-lib` initialization. Sync hashing/signing initialization remains, without loading a second full SRS copy. Pinned async default BN254 capacity is 2^19 points (2^18 on iOS); Grumpkin requests 2^16. Existing pinned local setup contains 1,179,648 BN254 and 65,537 Grumpkin points; it preserves the larger established application budget rather than shrinking capacity.

Nine lightweight wrapper tests now pass, including deferred setup ordering, concurrent deduplication, failed setup/retry, default-NetCrs bypass rejection and local-only loader policy. Actual async browser CRS/proof resource qualification remains separate.
