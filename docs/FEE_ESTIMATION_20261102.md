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
| Draft entered to displayed fee | 12.400s | 9.887s |

Rows include nested totals: do not add the native sync and enclosing sync step, or exact-estimation total and its child phases. Additional measured preparation: contract state 0.550/0.760s; second policy preparation 1.199/1.236s; history prefetch 0.666/0.718s (inside policy preparation); payment metadata 0.599/0.530s; credit discovery/read 2.024/1.542s. These spans do not establish a complete CPU-only decomposition; some preparation overlaps and all remote waits remain included.

Available credit was 31.5926638048254 versus maximum reservation 16.350002616. Native GasSettings.getFeeLimit multiplies gasLimits by maxFeesPerGas; teardown is not added again. Each sample ran exactly one private simulation, public simulation and admission check. No affordability search occurred. Both displayed 1.25 credits. Zero remote proof-job requests occurred.

Execution location: synchronization and private WASM execution are orchestrated in the dedicated browser worker and use remote node reads. Synthetic kernel construction is local. Public AVM simulation and admission validation run on the remote Aztec node through the application's RPC gateway. The gateway shares the prover service host but is separate from cryptographic proof jobs. Therefore the entire flow is not local.

Diagnostic instrumentation was temporary, with exact original SDK/worker hashes retained in the [sanitized evidence](../execution/evidence/G21/stable6/fee-estimation/20-character-20261102.json). Production estimator code was not changed. An initial attempt after funding failed before reaching the estimator and is excluded from successful samples; its precise cause was not established. Source review separately identified composer warm-up aborting an active estimate and leaving the unchanged draft Unavailable without automatically retrying; that is not claimed as the measured cause of these successful runs.
