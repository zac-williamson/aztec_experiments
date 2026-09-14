# P04 focused native qualification after reboot

**All five focused checks passed on the unchanged candidate.** The browser verification lane ran first and completed before this lane started. These checks reused the installed pinned native toolchain and existing artifacts; no dependency reinstall, full build, Docker container or large source copy was needed.

| Check | Actual result | Elapsed |
|---|---|---:|
| Noir interface/note-layout and commitment fixtures | 22/22 tests passed | 10.005s |
| Solidity commitment fixture | 7/7 tests passed | 0.243s |
| Portal regression suites | 9/9 tests passed | 0.235s |
| CLI SDK smoke | All 5 lanes passed | 5.134s |
| Full Noir contract suite using ephemeral TXE | 62/62 tests passed | 263.476s |

Exact commands, test names, pinned runtime/version output, time limits, raw-log hashes and process cleanup are retained in `post-reboot-contract-results-20260914.json` and the two run directories it references. The CLI smoke operates on named extracted functions with in-memory disposable wallet outputs; it does not run live CLI commands or use existing wallets. TXE exercises contract execution and stateful cases, not a real proof pipeline or production chain.

## Source and output binding

All 147 application/source input hashes and both intended internal links match the prior frozen candidate. Source checks before and after both runs found no changes, and a final comparison against the current root tree also found none. All 34 complete generated outputs matched the retained native reference before and after the checks. The Noir target artifact still equals the canonical app artifact.

`post-reboot-contract-comparison-20260914.json` binds the source attestation, four before/after output snapshots and native reference by SHA-256. The reference remains `derived-crs-root-output-hashes.json`, SHA-256 `f0f24b0338535d0e20c7b290155fad29f6bf7ccfa0222380b85350039e3cfb30`. No artifact fields were excluded. The separate successful fresh Linux build/34-output comparison remains valid historical evidence; this native fixture pass does not retroactively turn the earlier Linux fixture timeout into a pass.

## Permission failures retained separately

The initial sandboxed invocation passed the Solidity, portal and CLI checks. Its Noir fixture failed because Nargo could not lock the existing git dependency cache (`Operation not permitted`); its full Noir runner failed on `listen EPERM` for `127.0.0.1`, before its temporary service started. Those exact logs remain in `post-reboot-contract-20260914/`. They are environment permission failures, not failed application assertions.

Only those two blocked checks were rerun with scoped permission for the normal dependency-cache lock and ephemeral loopback service. Both then passed, using the same source, test cases and internal deadlines. Their successful logs remain in `post-reboot-contract-escalated-20260914/`.

## Deadlines and cleanup

The Noir interface and Solidity fixture retained their existing 120-second internal limits. CLI checks retained 120 seconds per lane with a 600-second outer supervisor for the five-lane suite. The full Noir runner retained its 1,200-second internal test deadline, 60-second readiness deadline and existing bounded child-service teardown. The initial orchestration reused a shorter 300-second outer limit; review correctly identified it as infrastructure rather than product acceptance. The full 62-case run completed naturally in 263.476 seconds, so that outer limit did not interrupt it and no rerun or deadline change occurred. A future full-suite supervisor should cover readiness, the maintained test budget and cleanup rather than impose that inherited short cap.

All owned parent processes were reaped and every owned process group was absent at completion. No additional cleanup signal from the outer supervisor was needed. The existing full-Noir runner sent SIGTERM to its TXE service during normal teardown and awaited closure. No ephemeral service or heavy work remains active in this lane.

No application implementation or production test source changed. Passing existing adverse-case tests does not imply that all downstream contract repairs or security requirements are complete. Actual transaction proofs, target-network qualification, independent review and the remaining graph gates retain their separate requirements.
