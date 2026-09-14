# P04 consumer SDK routing review

Read-only review of actual imports, path construction, app templates, generated pages, build scripts and SDK manifest. No production consumer was found loading the tracked historical `shared/aztec_bundle.js`. No source, generated output or dependency was changed by this review.

## Active paths

| Consumer | Observed source/routing |
| --- | --- |
| Contract build | `scripts/build-contracts.mjs` uses the pinned native Noir/prover and installed Solidity dependencies; it does not load either JavaScript bundle. It writes the canonical artifact plus deploy/censor copies and both portal bytecode copies. |
| SDK build | `scripts/build-sdk.mjs` builds `shared/sdk-entry.mjs` and actual upstream worker entrypoints into `.build/sdk`, records imported source/copy-asset hashes and output hashes in its manifest. |
| Browser app build | `apps/build.mjs:42` selects `.build/sdk`; `checkSdk` verifies that tree before its manifest outputs are copied to `apps/dist`. The builder does not copy a bundle from `shared`. `checkArtifacts` validates the synchronized contract copies before assembly. |
| Four browser pages | Each source template and current generated page loads the relative `aztec_bundle.js`, which resolves alongside the generated HTML in `apps/dist`. `apps/serve.py` serves that directory. |
| Deploy CLI | `apps/src/billboard/deploy/cli.mjs:163` has a one-entry bundle path list containing only `.build/sdk/aztec_bundle.js`. |
| User CLI | `apps/src/billboard/user/cli.mjs:221` uses only `.build/sdk/aztec_bundle.js`. |
| Fee-juice CLI | `apps/src/fee-juice/cli.mjs:154` and its later wallet setup at line396 both use `.build/sdk/aztec_bundle.js`. |
| Aztec wallet generators | `gen_user_wallet.mjs:25` and `gen_censor_wallet.mjs:27` under `apps/src/billboard/deploy/` both use `.build/sdk/aztec_bundle.js`. These generators were inspected, not executed. |

A read-only assertion checked all four current generated pages: their sole external script source is `aztec_bundle.js`. The current SDK manifest has 1361 inputs and excludes both `shared/aztec_bundle.js` and `shared/thread_worker.js`. Its generated bundle and the dist copy have identical SHA-256 `5f4b360ff3bbbef4707ea67f435e35487b7356f15833c6260e38b30a18a7da41`. Its eight declared outputs are the bundle, two Barretenberg workers, SQLite worker/proxy/WASM and Noir ACVM/ABI WASM assets. This corroborates the inspected routing and earlier full-output comparison; it is not a proof or a runtime mutation test.

## Residual files versus active inputs

`shared/aztec_bundle.js`, `shared/thread_worker.js`, `shared/extract_thread_worker.cjs` and `shared/patch_bundle_workers.cjs` remain historical bundle/worker tools. The extraction and patch scripts explicitly operate on the old shared bundle when manually invoked, but no active package/build/consumer call to those scripts was found. The fresh build emits the actual upstream workers instead. These files may be removed in a separately reviewed cleanup; this lane did not delete them or imply old-board compatibility is required.

The tracked `shared/ethers.min.js` is also bypassed by app assembly: the builder loads the locked `node_modules/ethers/dist/ethers.umd.min.js` for that placeholder. Other shared files remain active application sources, including `aztec-lib.js`, `crs-client.js`, `app-env.js`, `helpers.js`, `poseidon2.js`, moderation policy, wallet buttons and styles. They must not be classified as obsolete merely because they live in `shared`.

A separate configuration issue remains relevant to W/D implementation: all three CLIs still load `shared/rpc-config.json` when it exists, whereas the browser builder defaults to `shared/rpc-config.example.json` or explicit `BILLBOARD_RPC_CONFIG`. This is an active legacy configuration path, not an SDK-bundle fallback. The existing file's contents were not read or copied in this review, no credential is reproduced, and no CLI/RPC/wallet action was executed. Final deployment configuration should use the verified fresh-deployment scope specified in P04 rather than silently relying on that file.

The CLI/generator path inspection does not assert they validate the SDK manifest at runtime; the app builder performs that validation. Nor does it establish completed migration of transaction receipts, wallet recovery, fees, moderation or contract interfaces. Those remain the assigned downstream gates.

## Source binding

- `scripts/build-contracts.mjs`: SHA-256 `7a5b3db9b40204fb0fe811081df2705c04f915efc7505f582bd6e836da4fabd3`.
- `scripts/build-sdk.mjs`: SHA-256 `c9377ed150243ffbc92e8e61ce11576fac793e727050857a3887ed6626108d64`.
- `scripts/check-sdk.mjs`: SHA-256 `06c37b966e55740e4a5c91c7b7cfc6f7eb59ebba07da47440a575ab51b120efb`.
- `apps/build.mjs`: SHA-256 `51c1732d24b216e62e5d8b113547bb4d144a5fa3d03c4f9c57aa269d70ffbf94`.
- `apps/serve.py`: SHA-256 `2d187c03ddc3002d367d58cd2b883b38a64da9c951b4d5e9266efc7de339e4f3`.
- `apps/src/billboard/deploy/cli.mjs`: SHA-256 `20c8a6a6f092c00a996b165384cbf5441ffd896d7c33fbe8e57724e9b17552ee`.
- `apps/src/billboard/user/cli.mjs`: SHA-256 `3f57e8f120051c6c928a2475da3af4ce0bf5a2df78fe78ba2b7d41c5c7c87b77`.
- `apps/src/fee-juice/cli.mjs`: SHA-256 `84c3eb08854f5d7701bce1922fb8e2db22971e9d3982bab6aae6b0b1edd62fbb`.
- `apps/src/billboard/deploy/gen_user_wallet.mjs`: SHA-256 `bcd85e6c6217e8dcabbaa4b8d8b880a53054776f38a13f429dd4b7a84226b19d`.
- `apps/src/billboard/deploy/gen_censor_wallet.mjs`: SHA-256 `33b3c4ea35f66b10e287292538d9d80a2f0b9c449213bc09bd63879bd1094443`.
- `.build/sdk/sdk-manifest.json`: SHA-256 `646a5c21a95e74e7a1cae46858752db8f4eb976530f895bed0961e151e6631d6`.
