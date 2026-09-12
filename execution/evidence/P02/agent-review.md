# P02 delegated integration review

Review lane: `build_review`, separate AI reviewer. This is an integration review, not the independent external Aztec/Noir/Solidity audit required by X02. The root agent is editing concurrently; findings describe the reviewed state and require explicit disposition and verification before acceptance.

## Confirmed regression: missing browser-global Buffer (high priority)

The old browser bundle installs `globalThis.Buffer` (`shared/aztec_bundle.js:2022`). The new `shared/sdk-entry.mjs` and `scripts/build-sdk.mjs` inject Buffer only inside bundled modules. Existing unbundled consumers still use the global: `shared/aztec-lib.js:670,798` (L1-to-L2 message hashing) and `apps/src/billboard/user/engine.js:1813` plus the censor engine copy (withdrawal witness serialization). Those paths now throw `ReferenceError: Buffer is not defined` in a browser.

An isolated Node v24.15.0 VM with browser-like globals and no Node Buffer loaded each actual bundle separately. Exact expression `Buffer.from(new Uint8Array([1])).toString("hex")` produced:

```json
{"filename":"shared/aztec_bundle.js","appBufferExpression":"01"}
{"filename":".build/sdk/aztec_bundle.js","error":"ReferenceError: Buffer is not defined"}
```

This reproduces the broken compatibility boundary without wallets or remote requests. The VM is not a substitute for browser proving. Fix by explicit compatibility-global installation or removing reliance on the global at all consumers, and test the application consumer path in a real browser.

## Stale SDK inputs accepted (medium priority)

The reviewed `apps/build.mjs` checked SDK output hashes and the root lockfile, but did not compare `sdkManifest.inputs` or `sdkManifest.buildScript` against their current files. Editing `shared/sdk-entry.mjs` or worker-patch logic while retaining `.build/sdk` could therefore produce successful app builds containing the old SDK. The SDK manifest also initially omitted copied WASM/SQLite assets from its input list. Root has been notified and is implementing checks; closure needs mutation tests showing source/script/asset changes are rejected.

## Two remaining opaque-bundle consumers (medium priority)

`apps/src/billboard/deploy/gen_user_wallet.mjs:25` and `gen_censor_wallet.mjs:27` still read `shared/aztec_bundle.js` while the three main CLIs were migrated to `.build/sdk`. Wallet derivation would continue using the old artifact. Both should use the canonical source-built SDK. Generators were not executed, to avoid touching existing wallet files or printing secrets.

## CRS files remain outside clean-build provenance (medium priority)

The reviewed `apps/build.mjs:191-205` treated existence of `apps/dist/crs` as sufficient and did not check individual required files or hashes. If the directory is absent, it only optionally copies from another generated dist directory. This prevents the app build alone from restoring a complete proving bundle from pinned inputs after output deletion and allows stale/truncated CRS inputs through. Record explicit CRS inputs/checksums and restore or fail clearly; CDN availability is not deterministic local build evidence.

## Noir test artifact binding (medium priority)

`scripts/test-noir.mjs:7` validates canonical shipped artifacts, while TXE tests resolve the compiled artifact under `billboard/target`. The wrapper did not verify equality between that target artifact and the canonical processed artifact. A clean target deletion or stale target can make the test run fail despite checkArtifacts passing, and a stale target can test a different contract. Build immediately before tests or check the actual target input against the canonical artifact. This is a test evidence boundary, not a reported contract vulnerability.

## Positive observations and limits

- Compared exports from the old and new actual bundles: none removed; 64 became 68, adding `AztecSQLiteOPFSStore`, `Barretenberg`, `PrivateFeePaymentMethod`, and `SponsoredFeePaymentMethod`.
- Compiler archive download is checksum-pinned; direct Aztec package versions and installed versions are checked. Root and portal dependency lockfiles now exist.
- Worker patches operate on exact pinned source locations and fail if the expected URL expression is not unique.
- Portal artifact verification compares source metadata and bytecode copies; root is adding a broader contract input manifest and deterministic source-path normalization.
- The existing browser smoke checks SDK initialization, hash shape, worker startup, and SQLite operations. It does not exercise actual application wallet/PXE integration or generate a proof. Its original version lacked a bounded evaluation timeout and an expected hash known-answer assertion; strengthen these without describing the original pass as more than a smoke check.
- Observed `execution/evidence/P02/noir-processed-baseline.log` ending in `59 tests passed`. These are baseline tests and do not establish repair of the production vulnerabilities assigned to later packages.
- No full build, transaction, existing wallet access, remote RPC call, source edit, graph mutation, or commit was performed by this lane.

## Snapshot hashes

These hashes were captured after initial findings were sent, during concurrent root edits. The reproduced new bundle hash binds the exact evaluated SDK; source hashes are a review checkpoint, not a complete release fingerprint.

- `shared/sdk-entry.mjs`: `bfbba751647b87729a869d3a1e74fdacf0955f7692b0866784c404b633ec1d05`
- `scripts/build-sdk.mjs`: `75027cb3e7250260c8609da00750d3a1105dede9c170cdcef9741f2160dfc243`
- `apps/build.mjs`: `bf02fd44c5268bf32d071bb5a808bbdbaf78ef0aa3533074a42e25671d320458`
- `.build/sdk/aztec_bundle.js`: `c40234535381729549accae018bc9aa8f73c888fa6188fd3dd10cfd086dac9f1`
- `shared/aztec_bundle.js`: `4418ca4e73b3d09df35134897094e7de77623f05fe953edd7b52cf5469ec6347`
- `scripts/test-sdk-browser.mjs`: `7bfa806e14fcacf128dfd30c3636c91c5b3826ee42c02067b4c5f1dce989fdc2`

## Follow-up source dispositions

Rechecked the integrating source after communicating the findings:

- **Buffer:** `shared/sdk-entry.mjs` now explicitly installs the pinned Buffer polyfill when the global is missing. Source repair observed; final rebuilt browser consumer validation remains with the root agent.
- **SDK provenance:** `apps/build.mjs` now calls `checkSdk`. That checker compares current lockfile, build script, every listed source input and emitted output, requires known runtime inputs/outputs, and binds copied runtime assets to their source digest. The SDK builder includes copied assets and toolchain inputs. Source repair observed; final integrated regression results remain to be bound to the final source.
- **Wallet generators:** both generators now use `.build/sdk/aztec_bundle.js`. Source repair observed; they were not run against existing wallet paths.
- **CRS:** `crs-manifest.json` plus `scripts/build-crs.mjs` now provision exact content-pinned files from official URLs and restore clean output directories from verified cache. `apps/build.mjs` rejects files differing in length or checksum. Fresh provisioning, offline cache restoration, seven response tests, and direct V5 WASM SRS initialization passed in this lane; see `crs-verification.md` and `crs-build-tests.log`. Browser/CLI consumers are being integrated separately and final real-browser verification is pending.
- **TXE binding:** `scripts/test-noir.mjs` now compares the exact target bytes with the validated canonical artifact before starting TXE. Source repair observed; rerun the wrapper on the integrated build before final acceptance.

These are dispositions of the earlier findings, not a declaration that P02 or the product is complete.
