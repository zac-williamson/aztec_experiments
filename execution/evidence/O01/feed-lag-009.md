# Checkpointed feed lag implementation

Implemented 2026-09-18, following design008. `censor-daemon/feed-health.mjs`
performs one read-only parallel sample of node identity, checkpointed L2 tip and
the saved feed height. It validates scope and saved canonical hash, compares L2
block heights, and returns fixed classified aggregate output. Positive node-relative
lag is an advisory warning; missing, malformed, regressed, reorged or unavailable
observations return unknown without a fabricated zero.

The daemon uses a separate instance of its existing read-only RPC client with
five-second actual HTTP timeouts. Existing signing/reconciliation timeout policy
is unchanged. The health helper waits for all three settled requests so no request
from its bounded sample is left running on early rejection. It changes no job,
signing fence, transaction state or `--once` completion result. It skips this
additional observation when shutdown is already requested.

Validation retained in `feed-lag-009.log`:

- Five focused cases cover plain and typed block headers, exact positive/zero lag,
  checkpointed tag usage, wrong node identity, saved-hash mismatch, reorg/regression,
  missing/malformed state and no-RPC behavior without a saved checkpoint.
- The focused real local HTTP fixture launches three hanging requests. The existing
  public RPC timeout aborts them, the helper reports unknown, and server-side socket
  closure is asserted within one second after the request timeout.
- Combined feed and moderation health suites: 14 tests passed, approximately 0.25s.
- Existing daemon integration script passed, approximately 3s (its internal
  scenario tally is retained in the log).

No Aztec network, model or proving job was run. This is implementation and bounded
local behavior evidence, not a live production lag measurement. Relative node
progress does not prove global chain freshness or elapsed lag duration. Same-window
reorgs remain possible; existing canonical signing and receipt checks remain the
safety boundary. Documentation now distinguishes ingestion age and measured
checkpointed feed lag, including unavailable observation semantics.

Root integration: actual isolated operator package smoke011 also passed with the
new feed-health module explicitly required in the packaged import closure. This
checks packaged dependency resolution and prior recovery/launcher safeguards;
it does not upgrade this record into live chain or model qualification.
