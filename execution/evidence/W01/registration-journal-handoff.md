# Bounded registration journal

Implemented only `sponsor-service/registration-journal.mjs` and its maintained test. This is a local persistence increment, not an issuer worker or W01 acceptance. No signing, transaction submission, deployment, network request or cryptographic proof verification occurred in this lane.

## API

`await openRegistrationJournal({dbPath,scope,sponsorArtifact,maxJobs=64,maxTxBytes=1048576})`

- `dbPath`: normalized absolute private SQLite path; directory must equal its canonical real path (no symlink ancestors), be owned and private. Database and existing journal/WAL/SHM sidecars must be regular/non-symlink, single-link and mode0600. Dangling sidecar symlinks also reject. New directory/database use0700/0600. Scope, artifact ABI hash and bounds are bound on first open and must match on restart. Canonicalize the caller-owned directory before constructing the path.
- `scope`: exact `{chainId,version,rollupAddress,sponsorAddress,boardAddress,sponsorClassId}`. Chain/version are canonical decimal strings; L1 rollup is lowercase20-byte hex; L2 addresses/class are canonical nonzero field hex. The supplied compiled `sponsorArtifact` must compute to `sponsorClassId` and expose the actual public `register_batch` ABI. This does not verify a deployed instance or immutable board configuration: the operator must do that against its already verified network.
- `maxJobs`:1–64, no deletion/recycling. `maxTxBytes`:1024–4194304. Actual tests use the default1MiB; genuine registration byte-size qualification remains integration work.

Methods are async except `close()`:

```js
enqueue({batchId,root,window,ticketCount})
get(batchId)
list({limit=16,cursor='0'}={})
claim({batchId,expectedRevision})
savePrepared({batchId,expectedRevision,txBytes})
beginSubmission({batchId,expectedRevision})
loadPrepared(batchId)
observe({batchId,expectedRevision,observation})
close()
```

Intent numbers are canonical decimal strings; batch ID positiveu64, windowu64, ticket count1–1024, root nonzero field. Views contain intent/revision/state/claimed/txHash/txSha256/txBytesLength/observation. They exclude bytes. Only `loadPrepared` returns a fresh private byte copy with its hash/SHA256. Do not log this result.

SQLite `BEGIN IMMEDIATE`, FULL synchronous, `trusted_schema=OFF` and a unique partial claim index provide short atomic mutations, revision CAS and one durable active claim across connections/processes. No transaction spans asynchronous hashing or caller proving/RPC work. Startup validates bounded rows, states/claims, immutable intents, actual Tx bytes/hashes and observations, with a final `data_version` fence against concurrent validation drift.

One attempt per job: `sealed → preparing → prepared → submission-uncertain → pending → included → confirmed`; explicit `reverted` and `blocked` outcomes. Persisted bytes cannot be replaced. Call `beginSubmission` once, then submit those exact bytes externally; crash before/after that send remains uncertain. A preparing job can be recovered by the external single-worker owner and current revision. There is no lease that automatically steals a job and no resend/reproof mechanism. Capacity, failed attempts and unknown states require explicit operational disposition, not deletion or a new batch identity.

## Exact transaction binding

The implementation uses actual pinned `Tx.fromBuffer/toBuffer`, recomputed `Tx.computeTxHash`, nonempty Chonk proof bytes, and actual `FunctionSelector`/`encodeArguments` from the supplied compiled artifact. It accepts exactly one public call (including the SDK's teardown enumeration), to this sponsor, nonstatic, exact full selector field and ABI-encoded immutable tuple; its sender must equal the nonzero fee payer. Chain/version must match scope. Extra public calls/calldata are rejected. Operator identity/authority, fee settings, expiration and valid proof remain the external preparation/verification responsibility; nonempty is not valid proof.

Pinned `Tx.getPublicCallRequestsWithCalldata` combines values using stored `HashedValues.hash`, and explicitly leaves calldata/hash verification to callers. The journal separately recomputes `computeCalldataHash` over the exact values. The discriminating regression keeps a valid recomputed Tx hash and lookup-visible intended count4, while the signed calldata hash actually commits to count5; it must reject. Checking only cached Tx/calldata hashes would accept this inconsistent structure.

SDK source: `@aztec/stdlib/src/tx/{tx.ts,hashed_values.ts,public_call_request_with_calldata.ts,tx_receipt.ts}`, `src/abi/{encoder.ts,function_selector.ts}`, `src/proofs/chonk_proof.ts`. Compressed proofs use the pinned Chonk decoder, which requires its Barretenberg runtime. Tests use actual uncompressed SDK mock proof serialization; decoder/proof resource supervision is not implemented here. Inputs are trusted local operator outputs/private recovery data, not an HTTP upload interface.

## Observation boundary

Observation formats:

```js
{status:'pending'|'proposed'|'unknown'|'dropped'|'rollback',txHash}
{status:'checkpointed'|'proven'|'finalized',txHash,
 executionResult:'success'|'reverted',blockNumber,
 blockHash,canonicalBlockHash,registeredBatch}
```

Block number is a positive decimal string; hashes are canonical L2 block field hashes. Successful mined observations require exact registeredBatch intent and equal block/canonicalBlock hashes. Reverted observations require registeredBatch:null and never become confirmed. Proposed is deliberately retained as pending. Checkpointed/proven successes retain the active claim; a caller-observed finalized success releases it. Changed confirmed/reverted observations require an explicit rollback first. A blocked row globally fences enqueue/claim/save/submit, including when a later job already owns the claim. Reconciliation can record a subsequent supported exact-hash observation; there is no arbitrary clear flag.

Pending/included states always own the claim, including on restart. Reconciliation from a previously terminal rollback back to pending/included must reacquire it; another active claim leaves reconciliation blocked with BUSY. This can require manual recovery if the other job has not yet prepared a transaction. The bounded first increment deliberately has no automatic claim abandonment or replacement attempt.

**These values are caller observations, not attestations.** The journal performs consistency checks but no RPC, canonical-chain proof or finality verification. The trusted operator must obtain and recheck actual receipt, canonical block, registration state, expected deployment scope/admin and finality. A malicious or incorrect caller can provide internally consistent false observations. HTTP must not expose `observe` or journal mutations.

The journal does not solve coherent whole-database rollback, unknown registrations or missing high-water history. The external recovery fence from `operator-registration-design.md` remains required. It does not bridge issuer sealing/accounting atomically; that worker integration is pending. It is private-file storage, not encryption or protection against the owning OS account.

## Validation

Pinned Node24.21.0 command:

```text
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node --test scripts/test-registration-journal.mjs
```

Final `registration-journal-tests-004.log`:15/15 pass,0 fail/skip,6773.381541ms. Actual SQLite reopen, two independent connections, two simultaneously released real worker processes, and an abrupt SIGKILL after committed uncertain submission are covered. Worker processes exited; private temporary trees were removed. Codec fixtures use explicitly random mock Chonk proofs, not valid application transactions.

Initial001 failed its common test setup because `AztecAddress.fromString` is unavailable in the pinned SDK; preserved. Corrected002 passed12/12. Run003 passed13/13 with abrupt-death control and full selector-field equality. Root review then identified that startup allowed pending/included rows with claimed=0. Final004 rejects both actual stored corruptions, exercises proper rollback claim reacquisition/BUSY, and qualifies canonical paths/private sidecars. Root-requested `trusted_schema=OFF` is also applied. No evidence overwritten.

Final SHA256:

- journal: `688420e9407d10999291c45114121256b0aad89e2d314a21d015cabf301531eb`
- maintained test: `5cafd655a9b5e4a527aec818ecb8914eb535bf201ac4be06dc9603ce10f14637`
- actual sponsor artifact used: `939a7f5db9d29dad6d2cb42574251c20bc818313fc2ecf130a67bf76457ca8da`

This is implementer review. Independent review and genuine operator registration integration remain open; source/codec/SQLite tests do not establish those criteria.
