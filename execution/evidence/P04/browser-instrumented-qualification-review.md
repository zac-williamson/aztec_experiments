# P04 instrumented browser qualification

**FAIL: first consumer exceeded the unchanged evaluation limit during BN254 SRS initialization.** No repeated retry was started. Node 24.15 executed the reviewed test once; session 15300 completed with exit 1. No application/CRS sources, setup bytes or point counts changed. Root held concurrent heavy work during this run.

## Instrumentation and source binding

Only `scripts/test-sdk-browser.mjs` changed. It now separates page creation, exposed-function installation and readiness-marker setup; records bounded HTTP request/read/response completion and browser request/header/body-completion metadata; and marks before/after script execution, script load/error and document readiness with browser-relative timestamps. Logs omit response bodies, headers and query strings. Transport records are capped at 200 and script markers at 30 per document. The fixed local script paths and actual SDK/adapter calls are unchanged.

Navigation still waits for `load`, explicitly preserving its existing 30000 ms limit. Each cold consumer keeps its own 120000 ms evaluation limit, actual byte/hash and SRS checks, Buffer/export/Poseidon assertions, worker initialization/destruction, and SQLite write/read/close checks. Syntax validation passed, and root reviewed the change before the single run. The final source SHA-256 is `f04f5dd9877bab5f07a4409976fb6f4733bf2b983b5b5734f58764d66a01d743`; it still matches after execution. All five other observed input hashes exactly match the prior qualification.

## Actual startup milestones

| Milestone | Observed result |
|---|---|
| Local HTTP listening | elapsed 0.020 seconds |
| Chrome launch | 0.025 to 9.022 seconds |
| Page creation | 9.035 to 23.950 seconds (14.915 seconds) |
| Exposed function setup | 23.958 to 25.296 seconds (1.338 seconds) |
| Navigation | 25.463 to 53.284 seconds (27.821 seconds), passed |
| SDK file read | 50,130,889 bytes, completed at27.913 seconds; request-to-read990 ms |
| SDK server response finished | 34.465 seconds; HTTP200; request-to-finish7.542 seconds |
| Browser SDK body finished | 38.880 seconds |
| SDK script-load / following inline marker | host52.852 /52.867 seconds; browser27.161 /27.246 seconds |
| Document load | host53.282 seconds; browser27.660 seconds |
| All three CRS content checks | completed before BN254; no page/HTTP faults |
| BN254 call started | 59.293 seconds |
| Evaluation watchdog | 173.298 seconds, while BN254 remained active |
| Browser disconnected | 176.947 seconds during cleanup |

Server response finish establishes server-side response completion; the browser request-finished event separately establishes body completion. The subsequent script marker establishes progress past SDK top-level execution. The gap between them is not a CPU profile: parsing, execution, scheduling and event delivery are not separately measured. Browser-relative marker timestamps prevent treating host callback delivery as the exact browser event time.

The watchdog was serviced about14 ms beyond120 seconds after evaluation began just after elapsed53.284 seconds. BN254 had been active for approximately114.005 seconds when it fired. The recorded `evaluationMs` is121510 including failure handling. This run therefore reproduced incomplete BN254 initialization within the qualification budget after successful navigation. It does not isolate the cause or assign the whole call duration to decompression.

## Checks not completed and cleanup

Grumpkin initialization, Poseidon, async workers and SQLite were not reached. The engine-adapter consumer was not run because the harness stops at the first failure. No proof, wallet, remote RPC, funding or transaction was involved. Older successful stages remain historical observations and do not satisfy these current missing checks.

The process was polled to completion, browser disconnection was recorded, and the harness awaited browser/server cleanup. No owned execution session remains active and no additional browser run was launched. This is not an OS-wide orphan-process audit. The Linux lane received the completion signal; root subsequently held that separate work for a source decision.

These observations do not establish the cause of the previous pre-evaluation navigation failure. They also do not prove that Docker, host pressure or application code caused the current SRS delay. P04 browser qualification remains unresolved. U01/T04 performance work and any proposed derived-asset optimization require new source-bound evidence.

## Evidence hashes

- `browser-instrumented-qualification.json`: SHA-256 `c5df275fcfd123e3eb0a38fc50661eac899752ae743ec245e91f36cb85198862`.
- `browser-instrumented-qualification.stderr`: SHA-256 `22c27b806313ee7ebc64dfae9fc70dd5e39af82b594b1074320b64d3d3d5607b`.
- `browser-instrumented-qualification-context.json`: SHA-256 `fba770afa31e0279644d431a82fb032cf1929e755681b6a88d2a28cf58bc1ac9`.
