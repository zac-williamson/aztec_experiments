# C03 client submission/retry review

Read-only integration review; no execution or source edits by this lane. This is not an external audit. Source snapshot:

- `apps/src/billboard/user/engine.js`: `af9a19772d9ead9379daed0972be26ee50b49df6ffb3647bd20eea275462c0c0`
- `apps/src/billboard/censor/engine.js`: `af9a19772d9ead9379daed0972be26ee50b49df6ffb3647bd20eea275462c0c0`
- `scripts/test-c03-post-client.mjs`: `8b383ab445785fc5d8f80d458e0d8f24b06bf96cf3875abd62bf3cb37edc5466`

## Verified behavior

The actual `createAztecWallet.sendTx` uses `submitOnceWithReconciliation(rawNode, tx)`, avoiding the generic retry proxy for mutation. A failed send is reconciled against the exact transaction hash. Known pending/proposed/included status resumes receipt monitoring without resending; absent or mismatched evidence and transport ambiguity fail closed. Final success requires the exact hash, included status, executionResult `success`, block number and hash. Proposed/reverted/dropped receipts cannot pass this guard.

Both ordinary and dummy post paths call `withFreshPostState`; a classified conflict re-enters the whole attempt after explicit PXE synchronization. This rereads the live deposit and hints and creates a new transaction/proof. The helper defaults to at most two refreshes. Ordinary post nonce is regenerated on that confirmed-failed attempt; it is retained within wallet approval retries. No automatic fresh transaction is created for ambiguous submission. The maintained user/censor copies agree at this snapshot.

The maintained tests execute functions exported from the actual engine in a VM, not copied implementations or source slicing. They provide useful normal/negative controls for identity, canonical encoding, single send, receipt reconciliation, conflict retry and failure status. Their synthetic `proof-1/proof-2` values show helper control flow only; they are not cryptographic proof or whole-wallet integration evidence. No test presently checks exhaustion of the two-refresh budget or the queued-drop phase.

## Concrete remaining gaps reported to root

1. `sendTx` can succeed, then receipt polling can observe a dropped transaction because a competing transaction spent its right. The polling path unconditionally raises `BB_TRANSACTION_DROPPED`; the outer helper only refreshes on `BB_STATE_CONFLICT`. Thus A03 conflict recovery is not yet complete for queued drops, although it fails safely without resending. The pinned `NodeTxReceiptBuilder` deliberately exposes only generic `Tx dropped by P2P node`, so receipt.error alone cannot establish the cause. A narrow repair can read-only validate the retained exact transaction via `node.isValidTx`, classify only explicit invalid state reasons, and preserve unknown/failure for valid or unavailable responses. A matching actual-used-helper test should cover this phase and unknown/no-retry control.
2. The current text classifier recognizes invented stale/anchor phrases but misses the actual pinned `TX_ERROR_BLOCK_HEADER = 'Block header not found'`. `AztecNodeService.#sendTx` formats validator reasons as `Invalid tx: ${reason}`. Prefer exact pinned reason handling and a corresponding regression, without treating incorrect scope, malformed proof or arbitrary errors as retryable. `Existing nullifier` already matches the current case-insensitive classifier.

Source references: installed `@aztec/aztec-node/dest/aztec-node/server.js` send validation; `@aztec/aztec-node/dest/modules/node_tx_receipt.js` generic dropped receipt; `@aztec/stdlib/dest/tx/validator/error_texts.js` exact reason strings; engine actual wallet path and `doPost`/`doDummyPost` wrappers. No current genuine contention run has been used as evidence for these retry cases.

## Follow-up disposition (client-final-tests-003)

Both original findings are corrected in source: initial send and later queued-drop polling share `classifyDroppedTransaction`, requiring the exact hash and read-only validation of the retained exact transaction. Only a nonempty array consisting entirely of pinned `Existing nullifier` / `Block header not found` reasons becomes a state conflict. Unknown, mixed, valid or failed validation remains unknown and does not resend. The new test covers queued conflict and invalid/mixed/valid controls. I read the recorded log: 168 tests passed, zero failure/skip; I did not rerun it.

A further ambiguity was reported before closure: a generic dropped receipt followed by existing-nullifier validation does not prove the old transaction never landed. Receipt/index views can lag or change between reads. `doPostAttempt` currently generates a fresh nonce when the whole attempt is retried, which could turn such ambiguity into a second logical post. Preserve one logical nonce outside the refresh loop so refreshed proofs carry the same public identity; re-read the exact receipt after revalidation and reconcile if now known. Add the included-during-revalidation control. No broader wallet or network-finality change is required. This remains a review blocker for claiming safe logical post retry until disposition.

Batch author / runner review: authorCount10 flows into ten fresh initializerless accounts and all ten genesis FeeJuice funding addresses. The bridge executes real batch deposits/claims then passes their nonenumerable records to the contention helper, inside the continuous ordinary local mining lifecycle. The parent fingerprints both new helpers, pins genuine client BB/CRS, keeps network provers absent and controlled settlement explicit, enforces its existing540s/8GiB limits and fails on input drift. It reads worker/resource evidence before cleanup and removes the owned directory only after confirmed descendant-tree cleanup. No additional batch preflight, artifact or cleanup correction found in this bounded review. No runtime result is asserted yet.

Follow-up source hashes:

- `apps/src/billboard/user/engine.js`: `cd652451b03370464a4f0a4fee1421d848164f0b89ae38731aff71eb2797a05e`
- `apps/src/billboard/censor/engine.js`: `cd652451b03370464a4f0a4fee1421d848164f0b89ae38731aff71eb2797a05e`
- `scripts/test-c03-post-client.mjs`: `05a841e87fb814db4571d6c4c417c36d659994163ed42b944ff9c50e8aab4aa4`
- `scripts/c03-author-claims.mjs`: `d51e570b62120fd6ea2812740e9ee1cd3d06195911dfb8de1765c66acb23dddf`
- `scripts/test-c01-application.mjs`: `f3cc78e0357d452e936c127f0d13cdfc7429d04cb81eee5c4e486a71b4143e00`
- `scripts/c01-bridge-flow.mjs`: `2d944d4b558b4b6b90edcf341fc663b7fe74d9cbbba49a3c476590b43eb653b4`
- `scripts/c01-board-flow.mjs`: `5b4054c95363f33eed69e0268e771258662e33d7fa0c0a7525aac3f9fdd9b284`

## Final delta review (client-final-tests-005)

The real-post ambiguity finding is resolved: `doPost` allocates one logical nonce outside the full-state refresh loop and passes it into every attempt. `classifyDroppedTransaction` now re-reads the exact receipt after structured validation. A newly known pending/proposed/included receipt is returned to the real polling path; no fresh proof is requested. The new included-during-revalidation and retry-budget exhaustion controls are present. I read the recorded 170-pass, zero-failure/skip log; no tests were run in this lane.

One narrow dummy-specific residual remains for follow-up after the frozen genuine fixture: all dummy operations intentionally have public ID0, so they lack real-post identity deduplication. If an already accepted dummy still appears generically dropped and its own nullifier is observed, automatic Existing-nullifier refresh can advance private history a second time. Keep conflict reasons on the tagged error and fail closed for dummy Existing-nullifier conflicts until exact receipt reconciliation; allowing only an unambiguous missing-anchor refresh is a bounded alternative. This does not require a new public dummy identity or production ABI. Root has been notified; no running sources were changed.

Final inspected hashes:

- `apps/src/billboard/user/engine.js`: `5e1ce9036c93cca829769b800a17588021217b1096827b56d765968f9b1ee659`
- `apps/src/billboard/censor/engine.js`: `5e1ce9036c93cca829769b800a17588021217b1096827b56d765968f9b1ee659`
- `scripts/test-c03-post-client.mjs`: `dc7487da1aa87a159537679596ef579ae52afac871a71d58b8b9852a1f0b5c21`

## Dummy predicate integration review (client-final-tests-006)

Read source and the recorded171-pass, zero-failure/skip log; no runtime launched. The new `dummyStateCanRetry` predicate correctly permits only a nonempty all-`Block header not found` reason array, and `classifyDroppedTransaction` preserves a copied structured reason list. Its direct unit control correctly rejects Existing-nullifier refresh and permits missing-anchor refresh. Real-post stable nonce and post-validation receipt reconciliation remain intact; user/censor engine files are byte-identical.

Two actual outer call sites still override the inner fail-closed decision and were reported to root:

1. `doPost` uses unrestricted `withFreshPostState` even when config.isDummy causes `doPostAttempt` to call `doDummyPost`. An Existing-nullifier error rejected by the inner predicate reaches that outer unrestricted wrapper and is retried. Apply the same dummy predicate at the outer boundary (or dispatch dummy outside the real-post wrapper). A nested-wrapper control should fail the current behavior.
2. Auto-withdraw's dummy screening loop catches all errors except BB_DEPOSIT_READ, sleeps and continues. It must propagate unknown submission, nonretryable state-conflict and failed-transaction tags to retain the inner no-retry decision. Timing-only failures can retain the separate bounded wait policy.

These are concrete integration blockers for the dummy retry claim, not an objection to the correct predicate itself. No running source was edited.

Inspected source hashes:

- `apps/src/billboard/user/engine.js`: `95765580d8201155494b7b3af1b54af53530787935bc72e4e16fc83b214e2d3c`
- `apps/src/billboard/censor/engine.js`: `95765580d8201155494b7b3af1b54af53530787935bc72e4e16fc83b214e2d3c`
- `scripts/test-c03-post-client.mjs`: `69c521ff0da22507e0e56c16b3dca0920b4592d39a9db7ddd843f2dd86d793bf`

## Propagation fixes implemented and focused qualification

The outer post controller now never retries dummy dispatch: dummy attempts already own their sole bounded missing-anchor retry controller. This prevents both Existing-nullifier refusal bypass and multiplicative nested retry budgets. Auto-withdraw screening propagates all tagged BB_ custody/transaction outcomes instead of sleeping and repeating. Unconfirmed polling timeout is explicitly tagged BB_SUBMISSION_UNKNOWN so this rule also covers a lost inclusion response. Ordinary timing-only failures retain the previous wait behavior. Both maintained engine copies remain identical.

Actual engine-exported helper tests now exercise inner/outer refusal, normal real-post refresh, the sole two-refresh dummy anchor budget, and auto-screening propagation with a timing control. Focused `node --test scripts/test-c03-post-client.mjs` under pinned24.21.0 passed16/16, zero failure/skip; raw log `client-propagation-tests.log`. No heavy execution. No additional retry correctness blocker identified within this reviewed scope; genuine ten-author contention remains a separate runtime criterion.

Frozen hashes:

- `apps/src/billboard/user/engine.js`: `48527f20da1b34f63a29bf157ce9a418c92bed6047110ba4d9b19ff4224c7231`
- `apps/src/billboard/censor/engine.js`: `48527f20da1b34f63a29bf157ce9a418c92bed6047110ba4d9b19ff4224c7231`
- `scripts/test-c03-post-client.mjs`: `7abbc0ce2b4396c1f9cebb035af0326339c7f0eadebcaa034e6026f9080673fb`
