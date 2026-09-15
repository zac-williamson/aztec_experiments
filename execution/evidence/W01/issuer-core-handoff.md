# Opaque coupon issuer core — implementation handoff

Implemented `sponsor-service/issuer.mjs`; focused actual SQLite/SDK tests are
`scripts/test-sponsor-issuer.mjs`. All **22 tests passed** under publisher-verified
Node24.21.0 in under three seconds. Raw output is `issuer-core-tests.log` and source hashes
are in `issuer-core-handoff.json`. No HTTP endpoint, network transaction, proof,
operator signer, owner/blind collection or canonical-registration result was added.
This core alone does not complete W01.

## API

`await openIssuer({dbPath,chainId,version,sponsorAddress,windowDuration,windowBudget,
maxFeePerTicket},{nowSeconds})` opens a private SQLite database. Integer config
and windows/IDs use bigint or canonical decimal strings, never JS numbers.
`nowSeconds` is a trusted optional clock returning bigint/decimal string; default
uses current Unix seconds. The absolute database path must be inside an owner-only
existing/new directory. Existing directory permissions are never broadened or
silently changed. The database is owner-owned0600, not a symlink/hardlink, with
DELETE journaling and synchronousFULL. Deployment must control the private parent
and filesystem; hostile same-user processes and rollback of the whole database
are outside this core's protections.

- `reserve({window})`: current Unix-aligned window only. Atomically reserves one
  maximum-fee liability, assigns the next position in its open batch, and returns
  fixed network/sponsor/window/batch/index plus a random32-byte retrieval token.
  Only its SHA256 is stored. One open batch per window; full1024-slot batch returns
  explicit `ISSUER_BATCH_FULL` until it is sealed. Budget exhaustion is explicit.
- `submit({token,leaf})`: one nonzero canonical Fr commitment; exact repeat is
  idempotent, replacement rejected. Unknown fields (including owner/blind) reject.
- `seal({batchId})`: atomically freezes the batch before async hashing, then stores
  root and sibling paths atomically. All-empty batches reject. Exact SDK
  MERKLE_HASH depth10; unfilled/unallocated leaves are zero. `ticketCount` remains
  highest allocated position+1, including holes, and exactly matches reserved
  liabilities. Sealing prevents submissions and cannot reopen. A process can
  resume durable `sealing` state after restart; simultaneous seal attempts are
  idempotent against the same frozen input.
- `retrieve({token})`: only submitted slots of sealed, unexpired batches return
  root/path/scope. Always `registration:'pending', usable:false`: no operator
  confirmation was invented. Clients must independently verify actual canonical
  registration before authorizing an application action.
- `counters()`: aggregate batch/slot/submission/sealed counts and current window's
  reserved maximum fee. No token/commitment/owner metric labels.
- `close()`: closes the connection; later operations reject.

Startup now validates a bounded coherent SQLite snapshot before returning the API:
exact reserved amounts equal allocated slots times the fee cap; positions/counts,
foreign keys, metadata/next IDs, status and path cardinality must agree. Every
sealed root and sibling path is independently recomputed from stored leaves.
Asynchronous hash validation is guarded by SQLite data_version checked again
under a write lock; a concurrent commit causes ISSUER_STATE_CHANGED and requires
reopening, never acceptance of an unchecked changed snapshot.

Explicit caps are64 retained batches,64 windows and65,536 slots/paths; admission
stops with ISSUER_RETENTION_LIMIT and does not prune or rewrite history. Startup
checks a15-second validation deadline between bounded batch validations. These
are conservative core limits, not a complete disk-size/backup/retention policy.

No reservation cancellation, expiry refund, batch-ID reuse or budget decrement
exists. IDs are global within the one fixed network/sponsor database and increase
monotonically across windows. The counter is decimalTEXT validated as u64; windows
and amounts are also TEXT, avoiding SQLite signed64 and unsafe-number truncation.
Only bounded counts/positions use INTEGER. A changed network/sponsor/config fails
on reopening the database. Destroying/restoring an old database can defeat that
history: deployment backup/rollback reconciliation remains required.

## Verification and limits

Tests exercise real DatabaseSync files/reopen, hashed-only token storage, exact
configuration matching, missing/invalid tokens/leaf/identity fields, expiry and clock rollback,
1024 capacity, transactional rollback after an injected SQLite write failure,
two competing OS processes under one admission budget, actual SQLite lock waiting
that crosses expiry (rechecked inside BEGIN IMMEDIATE), eight corruption cases
covering accounting/IDs/counts/root/path data, concurrent validation-generation
changes, retention-limit admission, u64IDs above2^63,
concurrent sealing and depth10 membership against production
`computeSponsorCouponRoot`. Sealing recovery tests explicitly create the durable
`sealing` state in SQLite and reopen; they are not a power-loss/filesystem test.

Privacy remains bounded: opaque commitments/tokens avoid collecting author/blind,
but a transport can observe connection metadata, time and reservation/submission
linkage. No Sybil-resistance claim is made. Service request/body/rate limits,
capacity retention, secure token delivery, minimum anonymity set and batch timing,
canonical registration records/reconciliation, actual fee-balance admission and
operator replenishment are unimplemented integration work. An attacker rewriting all database records consistently or restoring an old whole
database cannot be detected without an external chain/backup anchor. This consistency
validation does not claim tamper-proof storage or solve rollback reconciliation.
The core does not
return usable coupons prematurely and does not log request data or SDK errors.
