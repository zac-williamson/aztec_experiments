# P02 final delegated integration review

Reviewer lane: `build_review`. This is an AI integration review with separate responsibility from the implementation lanes. It does not satisfy the external cryptographic/security audit gate. The reviewer also implemented CRS provisioning under a bounded earlier assignment; the root and consumer regression lane must review that portion independently.

## Finding raised during review (subsequently resolved below)

**High priority: the browser engine CRS adapter was missed.** At review time, `shared/app-env.js:84` still implemented the old `makeInitCRS` downloader. Every engine's `buildEnv` uses that adapter, and the deploy template uses it without including `AZTEC_LIB`. The adapter passed 1048577 BN254 points and requested 64 bytes per point, while the newly provisioned compressed data contains 1179648 points at 32 bytes per point. This mismatch prevents valid SRS initialization and bypasses the new checksum-verifying loader. Separately, `apps/build.mjs` initially injected the new CRS manifest/client only through `AZTEC_LIB`, so deploy received neither. Root and the consumer regression agent were notified immediately. Required resolution: route this adapter through the verified client, provide the client and manifest in all apps, and exercise the adapter and deploy output in browser validation. Testing only the direct `aztec-lib.js` initializer misses this path.

## Corrections verified by source inspection

- Explicit `globalThis.Buffer ??= Buffer` restores the compatibility global required by unbundled consumers. The earlier regression was reproduced against actual old/new bundles; final rebuilt browser verification must demonstrate the fix.
- Both wallet generators and all three main CLIs now select the source-built SDK path.
- `checkSdk` validates current source inputs, build script, lockfile, required runtime outputs, output digests, and copied assets' equality to their source digests. Paths are confined, including symlink resolution. `build-sdk` pins source-boundary worker relocation patches.
- `build-contracts` force-compiles and force-processes the artifact, checks every private function has a verification key, normalizes diagnostic paths only, verifies external source inventories, and synchronizes all canonical/legacy consumers. The contract manifest binds local source and build inputs; Solidity provenance checks compare portal source metadata and bytecode copies.
- `check-noir-dependencies` validates six complete dependency source trees and their manifests after compiler resolution, plus embedded dependency sources. The official-origin verifier records resolved commits and archive/file hashes. The check is explicitly an output acceptance gate, not a sandbox for compiler macro execution.
- The Noir test wrapper now rejects any difference between the TXE target artifact and the validated canonical artifact.
- CRS provisioning now verifies pinned lengths and hashes for local output/cache or official bounded ranged downloads. Runtime clients use the same manifest and verify bytes before initialization. This corrects the old Grumpkin-file selection; old BN254 bytes were independently shown to match the official uncompressed prefix.
- CI installs pinned Node/Foundry/compiler/npm dependencies, removes generated directories, builds twice, compares outputs, then runs guards, Noir tests, moderation tests, browser smoke, and graph checks. The workflow is configured but has not run on hosted CI in this task.

## Limited fixes made by this review lane

Root explicitly authorized updating `BUILDING.md` to describe current CRS provisioning and the default CRS-enabled browser test, and updating `scripts/check-reproducibility.mjs` to include the emitted `apps/dist/crs/crs-manifest.json`. The clean-build lane was notified to copy the updated comparator. The comparator now includes the actual provisioned CRS bytes and copied manifest rather than only the three binary files.

## Evidence inspected and boundaries

- `crs-build-tests.log`: seven downloader tests pass, including ignored Range, wrong range, oversized/truncated responses, checksum mismatch, and content-pinned fallback.
- `crs-verification.md`: actual official downloads, offline cache restoration, and direct V5 WASM BN254/Grumpkin SRS initialization succeeded. No proof was generated.
- `integrated-guard-tests.log`: the inspected earlier run reported 93 tests passed. Affected guards must rerun after the latest adapter/injection fixes.
- `noir-processed-baseline.log`: inspected earlier matching-toolchain run reported 59 tests passed. This is baseline coverage, not proof that later contract vulnerabilities are repaired.
- The `browser-smoke.json` inspected during this review was an earlier result containing exports/hash/SQLite/worker fields; it did not contain the new CRS or Buffer fields. It cannot serve as final CRS/Buffer acceptance evidence. Root is running renewed browser checks.
- `clean-build-inputs.json` records a separate copied source tree, but its existence alone does not establish successful fresh installation/build or current source equivalence. The build-verification lane is refreshing changed files and producing real output comparisons.

P02 must remain incomplete until the adapter/injection regression is corrected and the final source has fresh clean-build/comparison, guard, browser, and matching Noir evidence (or explicitly classified baseline failures). No release audit, mainnet clearance, real proof journey, browser support matrix, or soak gate is waived by this review.

## Final adapter finding disposition

**Resolved in source and browser smoke evidence.** Rechecked the integrated source and generated files:

- `shared/app-env.js` now delegates `makeInitCRS` to `BillboardCRS.initialize` using the pinned manifest and checksum verification.
- `apps/build.mjs` injects the manifest and client through the RPC configuration placeholder shared by all four templates. The old adapter count/range loader is absent from the outputs.
- Examined generated deploy, user, censor, and fee-juice HTML. Each contains exactly one CRS manifest assignment and one client definition, plus the verified engine adapter. The deploy page now receives the same required setup client.
- Parsed every inline script in the generated pages with Node's `vm.Script`, without executing app code or contacting a network: deploy 10, user 12, censor 12, fee-juice 9 scripts; all parsed successfully.
- Inspected `browser-crs-adapters-smoke.json`: outcome `pass`, Chrome 152.0.7977.84, CRS `verified and initialized through shared library and engine adapter`, `legacyBuffer: "01"`, 68 SDK exports, cross-origin isolation, SQLite round trip, and worker initialization. The updated test explicitly calls both `initCRS()` and `makeInitCRS()()` against the actual WASM API. This closes the observed adapter and Buffer compatibility regressions within smoke-test scope.

The historical `browser-smoke.json` has not been relabeled as current evidence.

## Final evidence update and remaining limits

- `pinned-runner-noir.log` now ends with 59 tests passed and graceful TXE termination. This is the rerun through the wrapper that validates actual target/canonical artifact equality.
- `clean-build-result.json` reports a successful separate-path fresh npm installation, compiler bootstrap, full build, updated app assembly, artifact checks, 33 output hashes, and 93 guard tests. The separate checkout reused the origin-verified Noir dependency cache and native Foundry/Solidity installation; that limitation is explicit. It is not evidence of an empty-cache Noir dependency resolution or a hosted Linux run.
- At this review's stopping point, the final root-versus-clean-checkout byte comparison was still assigned to the root agent. Require that result to pass before marking P02-A02 complete. The review does not invent a comparison result from two independent successful builds.
- No additional high-confidence functional regression was identified in the bounded final inspection. Proof generation, live transaction journeys, persistent wallet recovery, supported-browser coverage, network readiness, external audit and soak testing remain outside P02 and are not established by these results.

The earlier adapter blocker is closed. P02 completion remains conditional on the root agent binding all acceptance evidence to its final source snapshot and verifying the outstanding output comparison; this review itself does not alter graph state.
