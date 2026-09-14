# Exit settlement stall: broker retention

Bounded read-only source diagnosis plus a separately prepared scheduling regression, 2026-09-14. No agent proof runs, process mutations or dependency edits. This is an integration review, not a cryptographic audit.

The captured live exit progress showed epoch 26 awaiting its root, checkpoint subtrees 3–5 still present, all checkpoint block processing enqueued, an idle running agent, and twelve retained broker jobs all fulfilled. Those retained counts do **not** establish that epoch 26's required proofs completed. Root subsequently identified the surviving jobs as epochs 27/28 and stopped run `8a92f555` with recorded cleanup.

The installed Aztec 5.2 broker has an exact source-supported failure mechanism. `proving_broker/config.ts:70–74` defaults `proverBrokerMaxEpochsToKeepResultsFor` to 1. `proving_broker.ts:780–792` advances epoch height to the highest **enqueued** job and computes the retention floor as that height minus retention. Enqueuing epoch 28 therefore makes epoch 26 stale. `cleanupPass` and `cleanupJobsOlderThanEpoch` at lines 712–738 select all older jobs solely by epoch, without a settled-status condition. They delete queued and in-progress work as well as results. `cleanUpProvingJobState` at lines 399–415 removes cache/promise/in-progress state and completion notifications; the memory database also removes the job/input at `proving_broker_database/memory.ts:65–72`. Remaining stale queue entries are skipped when dispatch cannot find metadata (`proving_broker.ts:466–503`). A producer attempting to enqueue the old job again receives `Epoch too old` (lines 344–350).

The facade keeps its own outstanding deferred promises. Its snapshot mechanism only learns broker jobs with settled results (`broker_prover_facade.ts:227–279`, broker `getCompletedJobs` at lines 448–453). A silently removed pending job has no completed notification/result to resolve that deferred. Thus the first epoch can wait without a reported failed subtree even while all **remaining** broker jobs are fulfilled. This mechanism is a stronger explanation than deduplication or an unsupported empty-checkpoint hypothesis; no distinct defect in either was established here.

Empty first blocks have an explicit supported path in `checkpoint-sub-tree-orchestrator.ts` (zero transactions initialize end state/sponge, then parity and empty-block-root proofs). A single-block checkpoint still requires its actual block-root proof in `CheckpointProvingState.getSubTreeOutputProofs()` at lines 197–201. Also, `CheckpointProver.completed=true` at line 411 only means processing/enqueuing has completed: the subtree's result callback at line 329 resolves the block proofs later. Neither the progress flag nor absence of checkpoint-root jobs proves the missing prerequisite finished.

The narrow local remedy is an explicit broker retention of 64 matching this experiment's 64-epoch proof window, asserted on the actual instantiated broker and exposed in diagnostics. It keeps epochs 26–28 eligible; it is not a dependency patch or relaxed proof/finality check. Retention is finite: root should also require every requested epoch to be at or above the broker's actual floor and reject missing prerequisites promptly. Raising retention cannot recover the already deleted inputs/promises in the stopped run. A fresh full bridge run remains necessary to demonstrate settlement and refund; this review alone does not establish either.

Reviewed installed source/runtime SHA-256 (includes the previously recorded local broker memory changes; version number alone is not an assertion of pristine upstream bytes):

- `src/proving_broker/proving_broker.ts`: `9657264b83088b21a169a4487dcc176c59a143f0d190745b1ff363e4335ed810`
- `dest/proving_broker/proving_broker.js`: `51dcca4af6efb72b72edfd3d1f7e2a23d99ec923ba044e2afc476a2864472316`
- `src/proving_broker/proving_broker_database/memory.ts`: `ab1019ee85fab4897cf8040adeee984a4477b755df0c86a53e6de7d0d4830232`
- `src/proving_broker/broker_prover_facade.ts`: `bb8678e7b7c85d9837ac8f50e3152223d0f3df5ac247ec9c7c93320340836922`

Prepared `scripts/test-c01-broker-retention.mjs`, SHA-256 `3e8e9e26433337e43fc889063eac395873fba7902569b944a05a229d48af4396`, for root execution with pinned Node 24.21.0: `node --test scripts/test-c01-broker-retention.mjs`. It uses the actual installed broker and memory DB with deterministic direct invocation of its ordinary cleanup method; it does not start a background polling timer. Two controls observe default-1 pending eviction/no notification/stale reenqueue rejection, versus 64 retaining and dispatching epoch 26 before 28 and preserving the in-progress job through another cleanup. Inputs are opaque scheduling fixtures, never decoded or proved. Tests were prepared, **not run by this reviewer**; root records execution separately.

## Root execution and integration

The actual paired broker tests were executed with pinned Node24.21.0:2 passed,
0 failed/skipped (`broker-retention-runtime.log`). No agent, native proof or RPC
was used. Root reviewed the actual scheduling calls and deterministic cleanup
boundary; opaque fixture inputs cannot be mistaken for accepted proofs.

Local node startup and settlement now assert the actual constructed broker
retention64. Progress includes highest enqueued epoch, retention and floor. The
settlement health check rejects an unproven target below that floor, rather than
waiting indefinitely for discarded work. No verifier/circuit/consumption path
changed. Full genuine retry remains required.
