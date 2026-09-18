# Bounded public feed lag measurement

Source review, 2026-09-18. Design only; no implementation or measurement claimed.

## Existing semantics

`shared/public-feed-source.mjs:getHead` already calls
`node.getBlockData('checkpointed')`. `shared/public-feed.mjs` stores the last
successfully scanned page endpoint as `{number,hash}`. Despite its name, that
feed checkpoint is an **L2 block height**, not an Aztec checkpoint sequence number.
The signer snapshot exports that verified feed progress; the moderation store
retains it as `status().checkpoint`.

Pinned `@aztec/stdlib/src/block/l2_block_source.ts` defines `checkpointed` as the
latest L2 block whose enclosing checkpoint was published on L1. It is different
from proposed, proven and finalized. Compare two L2 block heights within this
checkpointed feed scope. Do not compare with an epoch, checkpoint identifier,
`latest`/proposed block number, or finality height.

## Minimal integration

The daemon already creates a read-only `publicNode`; its existing allowlist exposes
`getNodeInfo` and `getBlockData`, so no new RPC API or service is needed.

After a successful moderation cycle, take `result.status.checkpoint` and make
one bounded observation, with no retries:

1. In parallel, read `getNodeInfo()`, `getBlockData('checkpointed')`, and
   `getBlockData(savedCheckpoint.number)` from that same configured node.
2. Check node chain ID, rollup version and rollup address against `storeScope`.
   Parse both block headers using the same typed-or-plain header extraction as
   the existing public feed adapter. Require safe positive block numbers and
   canonical hashes.
3. Require the numeric lookup to return the saved height and exact saved hash.
   Require node checkpointed height >= saved height. At equal heights require
   the head hash to equal the saved hash too.
4. Report only fixed classification, `feedBlockHeight`,
   `nodeCheckpointedBlockHeight`, and their nonnegative difference
   `lagL2Blocks`. This is relative to the observed node tip, not independently
   established global chain freshness, duration, or missed moderation count.
   A mismatch or regression is unknown/reorg, never zero or a negative lag.

Use a small configured RPC timeout (for example 5 seconds) on this daemon's
existing `publicNode`, which aborts the actual fetch. The three parallel reads
share one observation window; do not combine an outer short Promise.race with
uncancelled longer reads. Existing receipt reconciliation should be checked for
compatibility before changing the node client's shared timeout. An alternative
is a dedicated instance of the same read-only helper with the shorter timeout;
that is a client object, not a service.

Missing checkpoint, identity failure, unavailable data or timeout produces a fixed
`FEED_LAG_UNKNOWN` warning. Keep ingestion age as a separate measurement.
Health can show measured positive lag without asserting that one delayed L2 block
is a critical incident. Pick/document a lag threshold separately from measurement;
retain deadline alerts for actual moderation urgency. Do not make informational
monitor errors trigger a fresh signature, delete state, or turn a complete job
into a retry. In `--once` mode, distinguish completed work from unavailable health
observation in output rather than inventing pending jobs.

## Lightweight cases

- Same height/hash: zero measured lag.
- Canonical saved height behind checkpointed head: exact positive difference.
- Proposed tip ahead while checkpointed matches: still zero checkpointed lag.
- Wrong saved hash, node head behind saved height, equal-height different hashes:
  unknown/reorg, never healthy zero.
- Missing header/checkpoint, unsafe number, malformed hash, wrong node identity:
  fixed unknown output without raw provider content.
- One stalled request: bounded failure with actual request abortion; other results
  cannot be used to infer zero lag.
- Fresh ingestion with positive chain lag: both measurements retained separately.
- Read-only observation cannot call signing, evaluation or journal mutation.

The existing RPC guards, field parser and local HTTP timeout tests can support
this without launching Aztec or running proofs. Reorgs during observation remain
possible: this health snapshot is advisory, while existing per-operation canonical
checks remain the authority for signing and reconciliation.
