# A01 consumer review

Read-only source/ABI review against current artifacts after C06 (`1102814`). No native build or proof job was run in this lane.

## Concrete integration gap

At review time `censor-daemon/daemon.mjs` and `censor-daemon/signer.mjs` do not accept or forward a private-fee configuration. The signer invokes the user CLI to flag; `apps/src/billboard/user/engine.js` routes censor flag/policy/authority actions through `createPrivateFeeSender`, which requires configured private fees. Consequently the actual daemon cannot flag, although mock CLI tests can pass. Root was notified to add a startup-fixed public configuration path to the restricted signer. This note records the finding before remediation, not the final disposition.

## Matching consumers

- Root, deploy and censor Billboard JSON copies have identical SHA-256 `50009f964ca8496c645e8bbb4d9a3b18621c9b26a7a2c7376e4f33c3b7e53696`.
- Root/deploy portal bytecode copies have identical SHA-256 `deee4cff684948e1d6469b8432f122c2290678f4f83f6d8ba573a350baedf5cb`.
- Deploy passes all twelve current init arguments, including chain, rollup, version and maximum deposit. Its constructor comment is old, but executable argument order matches the current ABI.
- User CLI loads current deploy artifacts plus canonical private FPC artifact. Censor engine is a symlink to the shared user engine, avoiding an independently stale implementation.
- Screening calls pass both owner and exact deposit chain. Current claim calls provide five arguments. Private posting/withdrawal continue selecting the exact deposit.
- Flag arguments contain stable post ID, expected policy version, seven reason fields and explicit byte length. Both feeds resolve order to stable ID and use the seven-field reason decoder.
- Automated list uses the atomic policy content/length/version snapshot. Manual display retains the existing content/length getter; this display does not bind an automated signing decision.
- SDK entry exports the application's private fee classes, not the deprecated protocol SDK class with the same name. Browser configuration carries the same mandatory fee route as CLI.
- Pinned SDK encoding explicitly supports field-like values for address structs and converts integer arguments using BigInt; deploy's field wrappers therefore are not an ABI mismatch.

## Scope limits

Matching copied hashes is not build provenance; root owns regeneration, source binding, workers/WASM/CRS and bundled HTML verification. Historical-policy event retrieval remains unfinished and the daemon fails closed when that historical policy is unavailable. This review does not replace genuine browser/PXE transactions or deployed generated-portal checks.

## Daemon fee configuration remediation

Implemented mandatory daemon `--private-fee-config`, validated via the restricted signer's existing real-file boundary and fixed in its frozen startup configuration. The signer forwards that public file path to CLI calls; model requests cannot supply or replace it. No recurring claim-file option was added: the documented prerequisite is an already funded and claimed censor private balance.

The signer suite passes 76 cases, including exact inert arguments, quoted configuration paths, startup object mutation, model override rejection and invalid/missing files (`signer-fee-tests.log`). The first daemon run exposed a test expectation using macOS `/var` instead of its canonical `/private/var` real path; production normalization was correct. The assertion now compares real paths, with the first log retained. Root owns final suite disposition and release integration.

An additional old regression consumer was reported to root: `scripts/test-shell-baseline.mjs` still uses `postIndex` in its signer request and lacks required policy/fee configuration. This stale test predates the new fee configuration fix and needs current signer arguments while preserving its historical shell construction control.

Final lane verification: daemon suite passes 21/21 (`daemon-fee-tests-002.log`). With root's ownership extension, the historical shell regression was updated to the current stable post ID, policy version and public fee configuration arguments while retaining its known-bad shell control. It passes 2/2 (`shell-baseline-tests.log`). All lane source edits are frozen for integration.
