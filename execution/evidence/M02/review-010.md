# M02 integration review

Root integrated the durable SQLite queue, worker, read-only wallet inspection,
structured signer outcomes, historical policies and model identity codec.
Delegated AI reviewers moderation_queue_review and moderation_integration_review
examined separate queue and worker/CLI paths. This is self-review with AI help,
not independent external audit.

Concrete findings addressed with regressions:
- Stale included receipt metadata could survive a transition to uncertain recovery;
  entering reconciling now removes receipt/event confidence and fences signing.
- Changing models omitted older included transactions from finality polling and
  could permit another model to sign for the same post. Signed duties remain
  eligible across model versions; prior durable intent fences same-post work.
- A lost replacement response left the queue referring to its dropped predecessor.
  Read-only journal lineage now recovers the newer attempt before deadline checks,
  including after restart and expiry. Pending replacements remain fenced; finalized
  reverts remain retryable; unrelated saved hashes are rejected.

- Unsigned jobs from a previous model could remain pending forever. Atomic
  ingestion explicitly supersedes only unsigned queued/leased/retryable duties;
  signed intents and permanent failures remain visible, and stale leases are revoked.

Reviewed exact policy selection, strict deadline checks, bounded retry/lease
behavior, current canonical block and flag-event validation, immutable operation
projection and six-word SHA-256 model transcript. Controlled model/node fixtures
are deliberately distinct from genuine Aztec proof evidence. Current runtime
identity uses the configured OCI digest; M03 must resolve the actual platform
image and qualify real running model assets and quality.

The wallet journal retains one logical operation: if an earlier included flag is
reorganised out after later activity replaces its journal, automatic recovery may
require operator investigation and stay in manual review. This is documented,
not represented as unlimited unattended reorg recovery. External audit, current
network compatibility, real model evaluation and soak remain open release gates.
