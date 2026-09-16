# Durable moderation jobs

Run the existing moderation daemon with Node 24 and its required portal, Ethereum
RPC, Aztec RPC, dedicated censor wallet, private-fee configuration, pinned model
image and model weights. `--state-dir` selects durable local storage; its default
is `.moderation-state` in the repository. The directory must be private (0700).
Do not delete it to clear a failed job. It contains public post/policy content,
model identity transcripts, decisions, leases and transaction references. Wallet
secrets and exact signed transactions remain in the separate encrypted wallet
journal. Back up both consistently with the daemon stopped; preserve SQLite WAL
files when making a filesystem backup. Never share a writable state directory
between unrelated boards/operators or operate independent queues on one wallet.

The queue database is scoped to the complete chain, rollup, board and portal
identity. Each job additionally binds the post, its historical policy version and
model content identity. New models do not retire unresolved prior transactions. Unsigned queued/retryable
work from the previous model is explicitly superseded; its records remain for
review and the new model evaluates its own job. Permanent incidents are retained.
A SQLite transaction commits snapshots and jobs atomically. Competing local
workers share a single signing lease. Leases last six minutes and signing child
processes have a five-minute timeout. One poll handles at most ten jobs, ordered
by deadline; the default interval is thirty seconds. Restart with the same state
directory to resume. A nonzero `--from` is rejected because skipping a cursor must
not silently discard moderation obligations.

Inference uses the exact policy captured by each post. Empty boards still require
validated current policy metadata. Before signing, refresh the canonical public
feed and check the unchanged post and strict censor deadline again. Persist the
verdict and submission intent before invoking the fixed trusted signer. Child
success only records progress: completion requires a finalized successful receipt
and the matching canonical flag event, including reason. Lost responses use the
read-only wallet journal inspection route; an expired deadline does not prevent
receipt reconciliation. Replacement proofs retain authenticated predecessor
hashes and the original operation. Pending, unknown or nonfinal reverts never
permit blind signing retries.

Defaults allow three evaluation/signing attempts, thirty-second retry backoff and
twenty uncertain reconciliation attempts. Healthy included transactions awaiting
finality do not exhaust that uncertainty budget. Unknown signing outcomes fence
new signing; confirmed inclusion can permit unrelated duties to proceed. Expired
jobs, exhausted retries and unresolved signing become explicit attention states.
The daemon warns about duties within five minutes of deadline and prints state
counts. `--once` exits unsuccessfully while work remains unresolved. These are
local diagnostics, not an external alert delivery service. A permanent error must
be investigated against the canonical feed, receipt and encrypted journal; there
is deliberately no generic command to erase or acknowledge an unknown transaction.

Dry run never signs. It records violating posts as explicit dry-run attention
states; use a separate state directory for dry runs so those decisions cannot
silently suppress subsequent live duties. Read-only public caches can be rebuilt;
the moderation database and wallet journal cannot be treated as disposable caches.

The model identity is SHA-256 over six fixed 32-byte words: padded domain,
schema version, image digest, weights digest, configuration digest, prompt digest.
Exact runtime and prompt bytes are saved by content identity. The current runtime
uses the configured immutable OCI image digest. M03 must verify the resolved
platform image, running assets and real model quality/capacity. M02 tests use
controlled model/network fixtures and do not qualify model accuracy, real proof
performance, RPC honesty, production target compatibility or external audit.

Recovery limit: the encrypted wallet journal retains the latest logical operation.
If a previously included flag is reorganised out after a later operation replaces
that journal entry, the old job may lack the exact saved proof required for
automatic recovery. It remains unresolved and can exhaust into manual review;
the daemon never substitutes the later operation or reports completion. Monitor
these attention states and account for missed duties in incident handling. This
queue does not provide unlimited automatic recovery of historical wallet actions.
