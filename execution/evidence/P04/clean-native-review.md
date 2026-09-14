# P04 final integration review and native build verification

This lane reviewed the final CI/build instructions, Solidity fixture runner, service specification and pre-portal configuration encoder. It performed an isolated native macOS arm64 build and reported actual failures without weakening the comparisons. This is an AI integration review, not an external audit or a production-readiness claim.

## Review dispositions

- BUILDING initially named Aztec 5.0.0 and ran a browser test before installing Chromium. Root corrected the version, moved browser installation before the first browser test and included the CLI smoke command. CI already installed Chromium first. A checked-in workflow is not evidence of a successful hosted run.
- The Solidity runner verifies the pinned Node, Foundry and protocol package versions, plus the frozen commitment-vector fingerprint, before invoking offline Foundry. Its isolated native run passes 7/7. This host already has solc 0.8.27; the earlier normal portal build makes that compiler available to the offline runner.
- The configuration encoder now accepts an exact four-field scope before portal deployment and rejects extra or missing fields. Ready still requires the actual deployed portal. The commitment bytes remain unchanged. Final isolated service/commitment tests pass 33/33, including transaction index and within-transaction log index in event cursors.
- The service specification agrees on receipt execution/finality separation, journal reconciliation, public privacy exclusions, actual event positions/deadlines and authenticated refund completion. The composite model identifier now has an exact 192-byte transcript and full SHA-256. Its shared codec is assigned to M02 and runtime content verification to M03.

## Isolated source setup and retained failures

The copy at `.build/P04-clean-native` started with 132 selected source/fixture files and two internal relative source symlinks. It excluded existing dependencies, generated consumer artifacts, portal outputs/cache, Noir target, build outputs, generated apps, wallet/model/runtime data and legacy `shared/rpc-config.json`. `clean-native-inputs.json` records all copied hashes and exclusions. Root and portal npm installations used fresh task-local caches. The compiler bootstrap downloaded and verified a fresh binary.

The installed Node, Foundry and Solidity tools and the existing content-verified Noir source cache were shared. This therefore does not establish installation with an empty host cache. Neither HOME nor an existing cache was changed or erased.

The initial build compiled and transpiled Noir, generated verification keys, compiled Solidity and built the SDK. CRS provisioning then correctly rejected stale 5.0 manifest metadata. `clean-native-build.log` preserves that failed attempt. The actual 5.2 downloader source had the same recorded hash, and fresh downloads from the configured official hosts matched all three content pins. Root corrected the metadata; isolated provisioning, app assembly and artifact checks then passed. `crs-migration-review.md` and `crs-official-reverification.json` record the source and download evidence and its limitations.

The first exact comparison failed solely on Solidity source-map IDs in the portal artifact. Contract bytecode and the other 32 outputs matched. The failure remains in `clean-native-build-recovery.log`; no source-map fields were removed. Root regenerated its outputs from a cleared compiler cache; the final exact comparison passes all 33 outputs, confirming the older cached artifact explained the source-map difference. An actual browser check also found the runtime CRS validator's old version constant. The corrected client and negative-version regression were explicitly copied into the isolated tree, and its apps were rebuilt.

## Process fixture repair and final tests

An early guard run encountered the CRS validator mismatch and a process test race: its 200 ms timeout could expire before the test child installed its SIGTERM handler. Root authorized a test-only repair in `scripts/test-process-lifecycle.mjs`.

The repaired test waits for actual IPC readiness from both children before advancing its controlled 200 ms timeout and 100 ms termination grace. A real 10-second watchdog bounds startup/teardown. The test still spawns real processes, sends real OS signals, asserts SIGKILL for both stubborn children and verifies reaping. A subsequent run under heavy compiler load exposed ordinary Node startup exceeding the old two-second fixture budget in three other cases. Root authorized a bounded 10-second ordinary startup budget and moving the service-death latency measurement after actual IPC startup. The explicit 100/50/200 ms timeout cases remain unchanged. No production lifecycle code changed, and failed runs were retained rather than reclassified as passes.

Final focused lifecycle tests pass 12/12. The complete isolated `npm run test:build` then passes 110/110, with zero failures or skips, recorded in `clean-native-verified-build-tests.log`. The isolated shared interface tests pass 33/33 and Solidity commitment tests pass 7/7. Source-copy corrections are recorded in the separate input, CRS-client and lifecycle delta files.

The exact final 33-output comparison passes without removing any fields (`clean-native-final-comparison.log`). All 132 copied source/fixture files agree with their initial hashes plus the explicitly recorded corrections and with the final root files (`clean-native-final-inputs.json`). These checks do not establish real proof generation, bridge authentication, production workload capacity, hosted CI success, independent review or target-network clearance.

## Fingerprints

- `BUILDING.md`: `f9f337fb4d261045a3c889ab07d4dfb611ccea842e538701e37ccb6cefa59649`.
- `.github/workflows/build.yml`: `f51bad436f3363a68e567f936e5d707bcd4c0999b577a0464fc57f1065dd497d`.
- `execution/service-interface-spec.md`: `d99518d53ca78e508ce041f054f7be9f065275ccbf8ee99857e5dca9583e2897`.
- `shared/protocol-commitments.mjs`: `2a6e2221f769bff7aa98e61600d40e03faeca8d191aaa361aa473789096f2c66`.
- `shared/protocol-schema.mjs`: `996ad92705b563cea6a4972d475f4600a8acb5ab92801671f50fda6c4cdfe4b2`.
- `scripts/test-process-lifecycle.mjs`: `f77955aae2cef9c879d60aa5b86aa11690717fa5b2f02e10060087c76cc226de`.
- `scripts/fixtures/solidity-interface-v1/run.mjs`: `5a1739928ec836911bff59ecfa9aabe8f83f0540d8277c3b68c5d0b4c4c47c6a`.
- `scripts/fixtures/solidity-interface-v1/commitment-vectors.sha256`: `90194544142f66f9a7b29c09ba22a2f531a54b38dbfbd0593b3cd510d6c663c2`.
- `execution/evidence/P04/process-lifecycle-final-tests.log`: `598859601bc97e3936f1f9a7e4b2b8eb5d2321a07ba7ab9e538b324c8d7195b0`.
- `execution/evidence/P04/clean-native-interface-tests.log`: `173154151aec1c744a586a62261a7a3c86b3df7076c4f82158e42eb9e2fd247e`.
- `execution/evidence/P04/clean-native-solidity-interface-tests.log`: `d223fbfd04a6e53ae14c5599135ef278cba1577783853e6301dc560d85d96774`.

- `execution/evidence/P04/clean-native-verified-build-tests.log`: `870b7b6141fec6e78eea6ca29a795da49b8eb3a56b1b23583f74d9e96580e026`.

## Canonical protocol contract consistency review

Read root's `verify-handshake.mjs` and `handshake-consistency.json`. The script removes the cached artifact hash, derives the class from the actual artifact/verification keys, recomputes the instance address and compares it with the SDK address and the content-locked Noir constant. All logged source hashes match the current files. This reviewer did not rerun that computation; root's saved actual result passes. The report correctly limits this to local artifact/address consistency, without asserting a live deployed protocol contract or network clearance.

Editorial follow-up: reviewed the service handoff reference correction to W01–W03 and U01. The earlier W04 reference did not identify a graph node. No wire semantics changed; browser startup performance is assigned to U01 and T04. The service specification fingerprint above reflects this correction.

Browser qualification follow-up: the test harness changed after the native source-copy verification, under an explicit test-only exception. Generated outputs and native build-guard inputs are unchanged. The current separate-consumer browser qualification failed its first 120-second budget and did not run the second consumer; see `browser-qualification-review.md`. The native pass does not resolve this browser acceptance result.
