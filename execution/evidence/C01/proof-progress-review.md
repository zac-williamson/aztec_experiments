# Read-only circuit progress seam

`scripts/c01-proof-progress.mjs` SHA-256 `643983ab77229417cbd864cca68743b07e0ef255b30c2e2f98df98404c92dfab`; Node 24.21.0 syntax check passed. No prover/test execution occurred in this lane.

Integration: `await readC01ProofProgress({prover, epochs: observation.epochs.map(item => item.epoch)})` within the existing parent poll. No extra timer, polling loop or monkeypatch is installed.

Actual pinned object path: `ProverNode.getProver()` returns the ProverClient; `getProvingJobSource()` returns its in-process ProvingBroker (factory constructs that broker directly). Public `getJobs`, checkpoint-store `list`, checkpoint failure/cancel methods and agent `getStatus` provide summaries. Test-only access to the emitted JavaScript's TypeScript-private `agents`, agent controller, checkpoint `completed`/`subTree`, and broker scheduling Maps supplies missing details. No dependency source is changed.

Output includes per-circuit retained job counts by queue/running/settled status, current dispatch/queue age and retry counts, controller status, epoch-session state, and checkpoint flags. `blockProvingFullyEnqueued` explicitly describes the production field named `completed`; it does **not** mean the subtree proof finished. Job IDs are hashed for correlation; input URIs, witness/proof data, failure reasons, keys and raw SDK objects are never serialized. Bounds: 32 selected epochs, 128 sessions/checkpoints, 16 agents, 10,000 retained metadata entries, 64 current details, 64 KiB total output. Shape mismatch returns an explicit unavailable diagnostic.

The observer never calls `getProvingJob` (claims work), `getCompletedJobs` (drains notifications), or `getProvingJobStatus` (may fetch a full proof result). Queue timers are read through `ms()` only. Synchronous checkpoint-store listing avoids its per-epoch L1-constant lookup. The only awaited call is the public in-memory session summary.

Limits: ages measure dispatch/wait wall time, not CPU time or completed circuit duration; completed counts cover retained broker metadata and can decrease on eviction. This cannot identify subphases inside a long native AVM call. A snapshot reports observed states, never liveness, work progress percentage or proof acceptance. The subsequent supervised genuine run must qualify the actual object shape and explain any unavailable diagnostics.
