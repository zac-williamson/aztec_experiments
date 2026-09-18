# CLI local proving setup repair 030

Implemented within the two CLI entry points, operator packaging and a focused regression file. No SDK/app/package build or proof run was performed by this change author.

## Change

Both `initCRSNode` implementations now initialize `BarretenbergSync` for hashing only, then await the bundled `initializeCliProver({manifest,loadLocal,sha256})` API. The old full-SRS initialization on the synchronous backend is removed. The trusted imported `BillboardCRS` helper is explicitly assigned to `globalThis` because its Node CommonJS export does not install the browser global that the bundled async initializer consumes.

The manifest comes from the package/repository root. The local callback reads full bytes from `apps/dist/crs`, rejects a non-basename name, uses `O_NOFOLLOW`, verifies a regular file and exact size, and passes the complete data to the initializer's pinned SHA-256 verification. Failed initialization never sets `_crsDone`. Browser initialization is untouched.

Operator inventory now validates the existing schema-2 manifest and includes the derived `g1_uncompressed.dat` asset as well as all three original files. Existing inventory/copy code checks each expected hash and copied bytes. This closes the missing local derived-G1 package input; the async initializer separately controls single-thread WASM, SRS capacity and prohibition of remote fallback.

## Verification

`node --test scripts/test-cli-crs.mjs` with pinned Node: **5 tests passed**, approximately 119 ms.

The tests extract and evaluate each actual CLI `initCRSNode` source function with an injected SDK call recorder. They establish hashing-only Sync initialization, async initializer argument wiring, trusted helper visibility, one successful initialization, no success caching on failure, and rejection/retry behavior for missing, truncated, modified and symlink files. The fake SDK verifies the complete callback bytes using the supplied SHA-256 callback; these tests do not claim actual WASM proving. The actual operator CRS resource selector is tested against the real manifest: all four names/hash pins are present, and missing/escaping derived metadata is rejected.

Root integration must rebuild the SDK and apps, rebuild the operator package, and repeat the actual initialization probe to demonstrate zero remote CRS requests. Genuine packaged command/proof qualification remains separate. No production-readiness claim follows from these lightweight tests alone.
