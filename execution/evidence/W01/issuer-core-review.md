# Independent issuer core source review

Reviewed `sponsor-service/issuer.mjs`, its maintained tests, `issuer-core-handoff.md` and `issuance-integration-plan.md` read-only. The normal-operation transaction and Merkle design has no identified spending-race defect in this bounded review. Two concrete corrections remain before production integration; this review does not approve W01 or constitute an external audit.

## Findings

1. **Reservation expiry is checked before acquiring the database write lock** (`issuer.mjs:109–110`). `BEGIN IMMEDIATE` can wait up to the configured 5000ms. A request entering near a window boundary can pass the check, acquire the lock after expiry, then reserve liability and return a token already unusable by `submit`. Recheck the same requested window using the current trusted clock inside the transaction after acquiring its lock. Test a genuine competing SQLite writer crossing the boundary; require no allocation, batch-ID advancement or budget write. This is an availability/accounting boundary defect, not an onchain expiry bypass: submit/seal/retrieve and the sponsor still enforce expiration.

2. **Reopening validates scope but not logical persisted-state integrity** (`issuer.mjs:69–84`, `111`, `175–180`). No reconciliation verifies that `windows.reserved == sum(batch.count) * maxFeePerTicket`, positions/counts are contiguous and consistent, IDs/counters are canonical and monotonic, or sealed roots/paths match stored leaves. For example, a logically corrupted reserved TEXT value of `0` alongside already allocated slots is accepted and permits more admission than the stated budget. A syntactically valid altered `paths.siblings` array or root is returned unchanged. SQLite transactions protect ordinary atomic writes; they do not authenticate application invariants after logical corruption. Add fail-closed persisted-state checks and bounded malformed-budget/count/root/path restart tests, without claiming they detect coordinated whole-database rollback. The client independently recomputes membership and the contract reserves actual public liabilities, so these examples do not bypass sponsor contract spending caps. The handoff correctly identifies whole-database rollback as unresolved; the narrower corruption gap should also be explicit until fixed.

Minor consistency issue: `counters()` calls the clock separately for `currentWindow` and `currentWindowReserved`. One sample at the boundary can label the new/old liability incorrectly. Capture the window once. Retention/body limits remain deliberately unimplemented integration work, not a surprise additional acceptance claim.

## Supported observations

- `BEGIN IMMEDIATE` covers reserve's budget read, batch/index allocation, counter increment and liability write together. SQL failure rolls back all these writes. Competing processes share the same database lock; full batches cannot overallocate. New batches opened while another batch hashes still reserve against the same window total.
- Batch sealing snapshots positions/leaves under a transaction and durably freezes before async hashing. Submission rejects sealing/sealed batches. Final root and paths commit together; concurrent seal attempts compare roots and are idempotent. Startup recovery manually exercised `sealing` state, not a power-loss filesystem test.
- All allocated positions, including unsubmitted holes, count against the immutable batch ticketCount and budget. The issuer rejects submitted zero leaves; unfilled positions are zero padding. The contract recomputes a domain-separated owner/blind leaf, so treating padding as a usable coupon would require a matching hash preimage (the usual cryptographic assumption), not merely knowing its position. Nodes use actual `DomainSeparator.MERKLE_HASH` and LSB-first sibling indices, agreeing with corrected production `computeSponsorCouponRoot` and the separately qualified Noir vector.
- Public requests accept only reservation window, token and opaque leaf fields. Owner/blind are absent from database schemas and counters. Retrieval token hashes are persisted, raw tokens are not. No logger serializes requests or SDK exception details. This does not remove transport metadata or the issuer's linkage among reservation, commitment, batch/index and retrieval.
- Every returned batch explicitly says `registration:'pending', usable:false`; no canonical registration receipt or public proof was fabricated. Fixed scope/policy changes reject on reopen. Public onchain registration/funding, rollback reconciliation, transport, admission retention, timing/anonymity-set observations and live client issuance are still missing, as the handoff states.

## Evidence binding

Source hashes match the implementer's handoff:

- issuer.mjs: `5029edcb211946cbed3f10d5a57492852a7dd745f2dd917f7beeacddd92bcb23`
- test-sponsor-issuer.mjs: `50dd4b22b72e32b1dd075b8d7197303ff37a87347f250429905cded5599e8acb`
- issuer-core-handoff.md: `c1e9cf730f7a3cbcb3680091386fdb4afe10f4593bf9cb99fe4f2b4a9ae56916`
- issuer-core-tests.log: `48a3fd48d92ff4a9cf4634a6cc0b918c7ca5ea13f359cf63331d16f23c46e37e`

The implementer reports 11/11 passing actual SQLite/SDK tests. Their assertions meaningfully cover rollback, competing processes, capacity, token-only persistence, expiry, policy mismatch, restart and corrected membership. I inspected them without rerunning tests or changing implementation. Corruption and lock-boundary controls above are absent; passing existing tests does not qualify those cases.

## Follow-up disposition — corrected core

Both substantive findings above are closed for this core's declared scope after read-only inspection of the revised source and maintained controls:

- `reserve` now rechecks current window inside `BEGIN IMMEDIATE`, before any allocation or budget mutation. The new test holds an actual SQLite write lock in a separate process, crosses the expiry boundary while the call waits, then requires `ISSUER_INACTIVE_WINDOW` and no allocated slot/batch. The transaction therefore cannot commit the expired reservation identified above.
- `await openIssuer(...)` now captures a coherent transaction snapshot, checks foreign keys, bounded record counts, canonical IDs/values, exact allocated count/contiguous positions, token/leaf forms, state-specific roots/paths and per-window `count * ticketFee` liabilities. It rebuilds every sealed tree with the production Merkle domain and compares every sibling path. A final transaction verifies unchanged SQLite `data_version` after asynchronous hashing; concurrent commit causes fail-closed reopening. Tests directly alter reserved total, allocated count, next ID, position, token hash, sealed root, path shape and a validly shaped wrong sibling, then require reopening rejection. A concurrent-write validation test exercises the generation check.

The source caps retained history at 64 batches, 64 windows and 65,536 slots/paths. Admission stops explicitly at the cap and does not prune liabilities or reuse IDs. Validation checks its 15-second deadline between batch validations; this is not a hard interrupt of an individual hash call or a complete disk-size policy. Consistent wholesale rewrites/rollback, writes by hostile same-user processes after validation, canonical registration reconciliation and operational pruning remain outside this correction. The handoff states these limitations. The minor aggregate `counters()` two-clock-read label issue remains; it neither reopens the two substantive findings nor affects atomic admission.

Current source hashes match the updated handoff:

- issuer.mjs: `2908ed7ca1b1db0c033bb57d473a3e25e74245900462829502d733ab972a2607`
- test-sponsor-issuer.mjs: `1f5ccda64a297c16d285dc8c8fa8dbc6db788e36c53cbeeac30d1b52d63e68e2`
- issuer-core-handoff.md: `b101c732357b74eb62adfc55d6005a30a3f437c6fb02a038e15e246b5bb83f83`
- issuer-core-tests.log: `30f344f1cf191bf5091dc679e5a00ffd4b90d795fb0ecd7d60eed1d6b50e5930`

Implementer result: 22/22 actual SQLite/SDK tests passed. This follow-up inspected code and assertions without executing tests. Initial 11-test evidence is preserved separately. No remaining blocker to these two corrections was identified; this is not W01 acceptance, a live issuer test, or an external audit.

Root disposition of minor metrics observation: counters now takes one clock sample; actual boundary test passes with the complete23-test suite (issuer-core-integrated.json). This is root implementation/verification, distinct from the preceding independent review.
