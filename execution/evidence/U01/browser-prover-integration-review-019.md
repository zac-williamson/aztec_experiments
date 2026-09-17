# Browser prover integration review 019

Read-only review while browser-post-019 is running. No application/test changes, builds, browser launches or proving jobs. This record does not assert the result of the in-progress run.

## Current source integration

The central wrapper now selects browser WasmWorker, two requested proving threads and `skipSrsInit: true`; checks the cached singleton's options; and loads verified local SRS into that exact async singleton before SDK PXE creation. The existing client checks pinned sizes and hashes and validates initialization responses. The wrapper explicitly denies CDN fallback and HTTP redirects. `makeInitCRS` and the shared-library `initCRS` both initialize lightweight Sync primitives, then call the exported `initializeBrowserProver`. The subsequent PXE call awaits the same WeakMap-cached initialization. Only its promise is retained, not local setup buffers. Node/native options remain separate. No additional source defect found in this integration review.

Two threads describes the BB proving pool, not the total number of browser, SQLite, ACVM or renderer threads. Verified SRS initialization is not proof generation, and a sampled whole-tree RSS result is not an allocation cap.

## Historical evidence requires explicit qualification

- `cold-crs-011.log`: 772 ms total CRS initialization, 235 ms hash time.
- `cold-crs-013.log`: 808 ms total CRS initialization, 243 ms hash time.

Those executions used the historical `makeInitCRS` which installed SRS into **BarretenbergSync**, not the async transaction prover. Their measurements remain valid historical Sync initialization/asset/hash/hosting observations. They do not qualify async prover readiness, its SRS initialization cost, or transaction performance. The separate worker smoke check used `Barretenberg.new({threads:2,skipSrsInit:true})`, so its success did not supply the missing async SRS qualification. Existing `provingQualified:false` fields were correct and must remain.

Update `docs/hosting.md:87–105` to name the Sync-only scope of those old timings. Do not relabel or overwrite original evidence. Any new async measurement needs its own report/source hashes and must distinguish setup time from proof and inclusion. `execution/evidence/U01/integration-review-014.md:5` likewise refers to historical worker/storage plus Sync setup, not an initialized transaction prover; preserve the record and append/supersede its interpretation in current completion records. Earlier prose in `browser-prover-thread-review.md` is chronological pre-fix analysis; its later correction supersedes statements about current defaults.

## Existing smoke-test expectations to update after the running job

`test-sdk-browser.mjs` still labels Sync initialization `sync-prover-init`; use `sync-primitives-init`. Its exported SDK checks should explicitly include `initializeBrowserProver`. With CRS enabled, record/assert the actual cached async singleton policy (`backend`, `threads:2`, `skipSrsInit:true`) and adapter identity, while keeping its one verified G1 initialization assertion. The existing proxy calls the real SRS methods, so that assertion remains useful.

Both `test-sdk-browser.mjs:189` and `test-u01-hosting-browser.mjs:43` create and destroy an additional standalone async backend after the now-real async CRS adapter has already initialized a proving singleton. This duplicates workers/WASM memory during smoke checks and makes the generic `workers: initialized and destroyed` description incomplete: it refers to the extra backend, while the real singleton remains until browser teardown. For CRS-enabled runs, inspect/reuse the real singleton and avoid the extra allocation; retain an explicit standalone worker probe only in the no-CRS smoke profile if needed. Closing the browser still owns final cleanup, but current peak resource numbers can include both heaps. These findings do not modify or invalidate the separately scoped in-progress transaction run automatically.

The nine wrapper tests are dependency-injected policy/ordering/loader tests, not actual browser proof evidence. Do not substitute their success, earlier native proof evidence or historical Sync timings for browser-post-019's observed outcome.
