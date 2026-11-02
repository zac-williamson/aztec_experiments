# Twenty-character fee estimation — 2 November 2026

Measured two consecutive ordinary anonymous 20-character ASCII drafts in one isolated Chromium browser using the live SDK and worker. A disposable test account was signed in, funded, and composer preparation completed before each measured window. Both drafts were left unchanged until the number appeared. No posts were submitted. The owned browser and processes were closed afterwards.

| Stage | First draft | Second draft, same worker |
|---|---:|---:|
| Native account synchronization stream | 0.518s | 0.495s |
| Complete synchronization step including policy preparation | 1.056s | 1.194s |
| Private execution, including remote oracle waits | 3.607s | 1.238s |
| Synthetic kernel and serialization | 0.678s | 0.546s |
| Public simulation RPC, including gateway/network/node execution | 0.596s | 0.569s |
| Admission validation RPC | 0.956s | 0.940s |
| Exact-estimation function, encompassing private/kernel/public/admission | 5.847s | 3.301s |
| Automation starts filling draft to observing displayed fee | 12.400s | 9.887s |

Rows include nested totals: do not add the native sync and enclosing sync step, or exact-estimation total and its child phases. Additional measured preparation: contract state 0.550/0.760s; second policy preparation 1.199/1.236s; history prefetch 0.666/0.718s (inside policy preparation); payment metadata 0.599/0.530s; credit discovery/read 2.024/1.542s. These spans do not establish a complete CPU-only decomposition; some preparation overlaps and all remote waits remain included.

Available credit was 31.5926638048254 versus maximum reservation 16.350002616. Native GasSettings.getFeeLimit multiplies gasLimits by maxFeesPerGas; teardown is not added again. Each sample ran exactly one private simulation, public simulation and admission check. No affordability search occurred. Both displayed 1.25 credits. Zero remote proof-job requests occurred.

Execution location: synchronization and private WASM execution are orchestrated in the dedicated browser worker and use remote node reads. Synthetic kernel construction is local. Public AVM simulation and admission validation run on the remote Aztec node through the application's RPC gateway. The gateway shares the prover service host but is separate from cryptographic proof jobs. Therefore the entire flow is not local.

Diagnostic instrumentation was temporary, with exact original SDK/worker hashes retained in the [sanitized evidence](../execution/evidence/G21/stable6/fee-estimation/20-character-20261102.json). Production estimator code was not changed. An initial attempt after funding failed before reaching the estimator and is excluded from successful samples; its precise cause was not established. Source review separately identified composer warm-up aborting an active estimate and leaving the unchanged draft Unavailable without automatically retrying; that is not claimed as the measured cause of these successful runs.


## Complete elapsed-time reconciliation

The original end-to-end endpoint was the test tool observing the ready fee, not a browser paint timestamp. The following intervals partition those original windows without overlap. The detailed [interval evidence](../execution/evidence/G21/stable6/fee-estimation/20-character-additive-20261102.json) records every boundary. Input includes the explicit 250 ms debounce; the final interval includes automation observation latency. Neither is a pure computation measurement.

| Disjoint elapsed interval | First draft (ms) | Second draft (ms) |
|---|---:|---:|
| Input update, debounce, dispatch | 264.705 | 262.485 |
| Synchronization incl first policy | 1055.625 | 1194.210 |
| Contract state incl handoff | 550.125 | 759.800 |
| Uninstrumented preparation barrier | 488.405 | 926.590 |
| Arguments: policy/history concurrent | 1199.000 | 1236.220 |
| Payment metadata, binding and handoffs | 602.165 | 536.855 |
| Private fee-credit discovery | 2024.445 | 1542.210 |
| Payment/request construction and handoffs | 7.710 | 5.855 |
| Private execution incl oracle waits | 3607.215 | 1237.585 |
| Synthetic kernel, serialization and handoffs | 678.435 | 546.240 |
| Public simulation RPC | 595.505 | 569.475 |
| Admission validation incl handoff | 955.805 | 939.935 |
| Exact estimate finalization | 2.530 | 2.355 |
| Return, UI and harness observation | 368.330 | 127.185 |
| **Total** | **12,400.000** | **9,887.000** |

The uninstrumented preparation barrier is the interval after contract-state preparation and before argument/policy preparation. Readiness checking starts concurrently with contract-state preparation; the application awaits it before local contract construction, nonce creation and argument processing. Source includes `inspectTrustedNode`, `getChainInfo` and `getAccounts`. The original trace cannot divide this gap further or attribute all of it to one request. Screening/history work is nested inside the second policy interval, and is not added again.


## Follow-up: identify the preparation gap and remove automation polling from the endpoint

One further 20-character draft on the same funded test identity and same SDK/worker bytes added only targeted diagnostic spans and input/DOM mutation timestamps. No production code changed; no post or new funding was submitted. Instrumentation received independent review before the run.

- Actual input event → cost DOM updated: **11.943465 seconds**.
- The automation endpoint reported 12.391 seconds: it included 15.325 ms before the input event and 432.210 ms after the DOM had updated.
- Estimator return → cost DOM update: **0.940 ms**, not hundreds of milliseconds.
- First preview readiness guard: **1,213.785 ms**, overlapping **598.720 ms** of contract-state preparation. Its remaining **615.015 ms** accounts for virtually all the formerly uninstrumented preparation gap in this repeat (616.100 ms). The remaining handoff was 1.085 ms.
- Contract object construction took **0.070 ms**; the already-resolved contract-state promise took **0.015 ms**. These are not the source of that delay.
- This guard checks node readiness, chain identity and registered accounts using `inspectTrustedNode`, `getChainInfo` and `getAccounts`. The combined guard is measured; its individual requests were not separately timed.

The original 488.405/926.590 ms gaps were not individually instrumented; do not retroactively label their entire duration as a measured single RPC. This repeat establishes the same interval's dominant cause. Browser DOM mutation notification is measured, not physical screen paint. [Focused evidence](../execution/evidence/G21/stable6/fee-estimation/20-character-detail-20261102.json).
