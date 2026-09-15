# Local durable coupon provider handoff

Frozen implementation: shared/sponsor-coupon-provider.mjs, shared/sponsor-coupon-store.mjs, scripts/test-sponsor-coupon-provider.mjs. Final coupon-provider-tests-004.log has 13/13 passing tests in 829ms under pinned Node24.21. No browser build, genuine proof or issuer operation was run in this lane.

## Provider interface

`createSponsorCouponProvider({transport,sponsorAddress,windowDuration,store,nowSeconds?,maxPolls=10,pollIntervalMs=1000,deadlineMs=30000})` returns `{acquire}`. Transport is the separate reviewed `{reserve,submit,retrieve}` object. Duration is the reviewed deployment's immutable duration. nowSeconds is a trusted synchronous clock (default local Unix time); actual registered-chain timestamp is checked before handoff, and the preparer performs final scope/config/gas checks before signing. Maximum factory bounds are 30 polls, 5s interval, 60s deadline.

`acquire({scope,owner,actionKind,readRegisteredBatch})` accepts claim/post/withdraw. Scope fields are l1ChainId,rollupVersion,rollupAddress,boardAddress,portalAddress. `readRegisteredBatch({batchId,signal})` is a read-only callback returning `{root,window,ticket_count,timestamp}`; canonical decimal strings are accepted. AbortSignal is optional for the callback implementation but allows cancelling a timed-out read. It must perform the separate actual deployment identity check and return actual chain state, not issuer assertions.

The provider creates a fresh nonzero blind locally and hashes the exact production coupon domain0x42420104 with chain/version/sponsor/window/batch/index/owner/blind. Only `{window}`, `{token,leaf}` and `{token}` reach the transport. The local reservation plus blind and leaf are durably committed before submit. Existing pending records first try retrieval, then idempotent submission if still unavailable; a lost submit response can resume a sealed batch without submitting it again. Root/path/scope/position/leaf are checked with actual computeSponsorCouponRoot and exact actual-chain batch/time before use. Issuer `registration:'pending',usable:false` is deliberately not treated as an authorization decision.

Return shape remains `{batchId,index,blind,siblings}`. Before return, the durable attempted transition must succeed. Concurrent calls against one pending record can hand it out only once; a losing caller fails explicitly. Subsequent acquisition may allocate a distinct coupon. It is the calling transaction controller's responsibility to reconcile ambiguous submissions before asking for another logical attempt. Failed delivery after the attempted commit deliberately loses local coupon availability rather than risking reuse.

## Durable adapter contract

All methods are async:

- `pending({partition,nowSeconds}) -> record[]`: atomically purge expired records, return unattempted records for the partition. Reject at capacity if no existing pending record can be resumed. Maximum 64 records.
- `put(record,{nowSeconds}) -> true`: add only if absent and under capacity; await durable transaction completion, then return. No submit occurs if this fails.
- `markAttempted(id) -> boolean`: atomic one-way compare/update; true exactly once. False/error never hands out the coupon.
- `close()` for the supplied browser adapter.

Record shape: `{schemaVersion:1,id,partition,expiresAt,scope,owner,sponsorAddress,windowDuration,reservation:{window,batchId,index,token},blind,leaf}`. IDs/partition are lowercase 64-character SHA256 strings; time/batch/window/duration are decimal strings; index is an integer0..1023; field/address strings are canonical hex. No redundant plaintext status field is used. The adapter owns attempted state.

`await createIndexedDBSponsorCouponStore({indexedDB?,crypto?,encryptionKey,databaseName?,maxRecords=64})` requires a caller-provided AES-GCM key with encrypt/decrypt usages. The application must derive/recover that key locally; it is not persisted by this module. Records are AES-GCM encrypted. Only opaque id/partition, expiry, attempted flag and encryption envelope are clear. AAD is JSON `['AZTEC_BB_SPONSOR_COUPON_V1',id,partition,expiresAt,attempted]`. Updates re-encrypt outside the IndexedDB transaction, then a strict-durability transaction compares the entire prior encrypted row before committing the new attempted envelope. Resetting attempted, extending expiry or moving partition without a valid envelope fails authentication. Failed transaction completion is not success.

CLI requires a real durable adapter to this contract. fake-indexeddb is only a test implementation and does not persist CLI restarts. Root owns the CLI adapter and engine/SDK wiring.

## Limits and tests

Partition is SHA256 of fixed domain, deployment scope, owner and sponsor. A party already able to read local metadata can dictionary-test a known owner; this is explicitly local metadata exposure, not a transmitted account identifier. Encrypted storage does not protect against malicious same-origin code with the wallet key, complete local database rollback, deletion, browser storage eviction or a compromised host. Whole-database rollback needs external chain/reconciliation; authenticated attempted flags only prevent in-place unauthenticated edits. Clearing/purging attempted records is allowed only after expiry under the trusted clock.

A lost reserve response can strand an issuer reservation without a recoverable token; a storage failure after reservation can likewise leave unused liability. There is no unsafe cancellation or automatic allocation retry. Individual transport calls have their own timeout; the provider bounds its caller-facing wait and aborts readRegisteredBatch's signal, but an implementation ignoring cancellation may finish a read later. No late read can hand out a coupon after timeout. A timed-out durable mark may still commit conservatively, consuming availability.

Tests use actual encrypted fake-indexeddb transactions and real SDK hashes, with explicit transport/chain doubles: durable restart, exact transport field confinement, lost submit response, unavailable retrieval/registration, two-connection CAS, storage failure before submission, wrong scope/root/path/count/time, attempted/expiry/partition tampering, wrong key/ciphertext, cap/purge, deadline and actual transaction abort. Test fixtures do not claim actual HTTP registration or cryptographic transaction qualification.

Source hashes:

- provider: 1cd0894cf08a6d3d4458453cf314778bf6b91b25183902a9574f7fee6da437a7
- store: b270e8ca96e1c850ec26910c6d3cc8bc7cff9ebd930aecc428767a2bf8cefaca
- tests: 0ef007f408b507c3d6ab9bbc33f34424d2e848f957eb4cf1bf507c445f9f738e
