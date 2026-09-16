# F01 final AI review

Scope: public event source/decoder, durable feed core, connection/RPC boundary,
standalone browser reader, user/censor feed integration, public CLI listing and
public cache separation. Read-only source review; only the assigned independent
review test was extended. This is AI review, not independent security review.

## Disposition

No unresolved release-blocking defect identified within the reviewed F01 scope.
Previously reported gaps are addressed:

- Full-history publication order must begin at zero and remain contiguous.
- Every post requires an earlier publication of its policy version.
- Both original and current board class IDs must match the pinned release.
- Identical policy republication moves that policy to the latest position;
  conflicting content under one version is rejected. A new A → B → A regression
  confirms that CLI consumers identify A as the restored current policy.

Pinned storage layout was checked against the embedded contract/library source:
`Config` derives Packable over ten scalar fields in declaration order;
PublicImmutable writes the packed value at its base slot and appends its hash.
Portal slot 1 and configuration slot 3 with censor-window offset 7 are correct.
Connection reads are pinned to one checkpoint hash and reject mismatched scope
and class IDs. RPC methods are restricted to public reads.

The index commits only validated complete ranges, checks occupied blocks and
canonical endpoints, preserves prior committed data on failed reads/writes,
rolls back orphaned events, and invalidates pagination after rollback. New-post
arrival preserves an existing pagination snapshot's upper order boundary.
Public event payloads cannot introduce additional private fields into the cache.

The standalone runtime has no SDK/PXE/wallet/prover imports. Public browser
storage is separate from wallet storage, and the CLI uses a separate atomic
public cache directory. The CLI list branch bypasses wallet initialization.
Rendering uses textContent or explicit escaping for event text and reasons.
Older-message navigation is available through the standalone reader.

## Verification and limits

This reviewer ran `node --test scripts/test-public-feed-review.mjs`: **18 passed**,
including the new policy-restoration regression (132.6 ms recorded run).
Earlier independent probes reproduced missing-order defects before their fixes.
Root reports an actual browser/CLI fixture covering 55 posts, pagination/reload
without a historical log rescan, a roughly 23 KB reader bundle, and no proving
asset requests or wallet database creation. Root also reports 501 broader tests
before subsequent small fixes; this review does not treat that earlier count as
verification of later edits or independently rerun the browser/build jobs.

Remaining limits are explicit engineering boundaries, not completed production
assurance:

- RPC nodes remain trusted data sources; this reader is not a cryptographic
  light client. Canonicality checks detect inconsistent/reorganized responses,
  not an endpoint consistently fabricating an entire chain.
- RPC queries scale with changes, but local projection and public CLI listing
  still materialize cached history. A durable incremental moderation job queue
  belongs to the later moderation package.
- Cache/event/checkpoint and CLI listing limits fail explicitly rather than
  silently dropping history. Operators must retain sufficient public-index
  capacity; there is no automatic archival/pruning service in this package.
- Displayed cache data can be stale between refreshes. Fresh scope/state checks
  remain necessary before signing moderation or other transactions.
- Fixture tests and source review do not replace a live target-network
  qualification, independent review, or the project's production release gates.
