# P04 browser consumer qualification: unresolved timeout

## Observed diagnostic

The original final browser run failed because the 120-second evaluation watchdog closed the browser. Its old stderr had no stages, so it did not identify the slow operation. Root authorized test-only instrumentation and one run without changing that limit. The instrumented run completed all three local CRS reads and SHA-256 checks. Actual BN254 SRS initialization completed in 109642 ms, Grumpkin completed in 435 ms, and the shared library adapter completed in 113951 ms. The combined deadline then expired while the second adapter loaded its G2 file. This establishes a successful first initialization in that run, but not completion of the full smoke test or acceptable production latency.

## Corrected test structure

Root authorized separate cold qualifications for the two independent consumer paths. `scripts/test-sdk-browser.mjs` now launches a fresh Chromium process with a disposable profile for each path, sequentially. Each consumer has its own unchanged 120000 ms evaluation limit beginning after navigation. Each retains Buffer compatibility, singleton initialization, its actual shared/engine CRS adapter, exact local byte/hash verification, BN254 and Grumpkin initialization/response checks, Poseidon hashing, asynchronous prover worker initialization/destruction and SQLite write/read/close assertions. No assets, point counts, production CRS code or successful-result checks were changed. Stage wrappers delegate the actual calls and results; they do not mock the prover.

The harness stops at the first failure and never retries automatically. Node syntax validation passed before the single authorized qualification run. Full input fingerprints and per-consumer stages are included in its JSON output.

## Qualification result

**FAIL / incomplete qualification.** The first `shared-library` consumer's evaluation watchdog expired at 120 seconds. Its actual BN254 call had begun at elapsed 57149 ms and was still active when the watchdog fired at 167301 ms, approximately 110.2 seconds later. All three local reads and their hash checks had completed; recorded page/HTTP faults were empty. The evaluation was reported as 121280 ms including failure/closure handling.

The engine-adapter consumer was **not run**, because the first consumer failed. Poseidon, asynchronous worker and SQLite checks in this qualification were **not reached**. Their presence in the script and results from older source snapshots are not current passes. No subsequent browser retry was started.

The separately owned stalled Docker container could not be confirmed stopped. Root explicitly authorized this one sequential qualification despite that unresolved state. These observations do not establish that Docker, the OS, source code or another particular cause produced the timing. No global Docker cleanup, host restart, wallet, RPC call or transaction was performed by this lane.

## Performance and evidence handoff

The measured 109.6-second successful cold initialization and the later incomplete call belong in U01 and T04 performance work. The former W04 shorthand did not identify a graph task and was corrected. Separate consumer qualification budgets are not a new production SLO or proof of usable latency. Before release, measure cold/warm initialization, resource use and repeated-call behavior on representative supported browsers/hosts, define an acceptable interaction budget and verify the actual user flow against it. Do not reduce CRS capacity, bypass content checks or claim environment causation merely to obtain a green smoke result.

The earlier native 33-output comparison and 110 build-guard results remain historical results for their recorded inputs. This browser test was subsequently changed under an explicit source-freeze exception; it does not affect those generated outputs, but its current consumer qualification remains failed. P04 acceptance must account for that unresolved result rather than treating earlier browser evidence as a current pass.

## Fingerprints

- `scripts/test-sdk-browser.mjs`: SHA-256 `057b86fb66d71a642fcd6143d9cc369cf4eab9b119221d89cdd4509ff560af01`.
- `execution/evidence/P04/browser-stage-diagnostic.json`: SHA-256 `18f697e33f4c3d29526eaa3147b1558096935abdabe960618138a6938dc64fba`.
- `execution/evidence/P04/browser-stage-diagnostic.stderr`: SHA-256 `a066c9e8ebac0d955ec3ef1c53bd8656e66da46d51d50cba17259ebe518a044d`.
- `execution/evidence/P04/browser-stage-context.json`: SHA-256 `3818edf16a5d4670bba1b82ff354ba20841c40075f268e24be1aaeb7ab008f47`.
- `execution/evidence/P04/browser-consumer-qualification.json`: SHA-256 `5c229e5eb5eaca63ed5c6b036687bee49a5e917d5e35eb8e81dbfc9b6044ed26`.
- `execution/evidence/P04/browser-consumer-qualification.stderr`: SHA-256 `78d8a46eeaf3ac5fd990398694d12fb8ef0df720a59f32d267cf28a929d2373f`.
- `execution/evidence/P04/browser-consumer-context.json`: SHA-256 `b96949e43e9440e553a1b28bd11f200f42cf05cc15a72ab330f88c8db039abb6`.
