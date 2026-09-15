# C03 same-anchor contention helper — preparation

Own source: `scripts/c03-contention-flow.mjs`.

Export `proveAndIncludeC03Contention({node, preparation, instance, authorClaims, l1Client, rpcUrl, directory, mineL1, reportStage})`. `authorClaims` must contain exactly ten `{account, claimResult}` records in the existing C01 in-memory claim shape. The new batch-claim helper supplies this shape. Private accounts, notes, nonces and transactions remain in memory; returned observations contain public transaction/identity/order data and proof fingerprints only.

The helper registers all ten distinct initializerless accounts in one ephemeral, native-proving wallet. It validates canonical successful claims and exact receipt-bound notes, acquires a common eligible checkpoint header, then restores the ordinary sequencer configuration before proving. With PXE `autoSync:false`, every actual client proof must contain exactly the same header bytes; the canonical anchor is checked during preparation. Ten genuine proofs pass normal `node.isValidTx` checks before any post is submitted. This is stronger than the separate sequential TXE ten-author control, which does not pin a common anchor.

After ordinary inclusion, it requires ten successful canonical receipts, ten unique stable IDs, exact public content/byte lengths, the original deposit nullifier exactly once, one exact eight-field replacement and one exact seven-field first PostNote for each author. Public append order must equal actual raw-block transaction execution order. Publication time must equal that block's timestamp. No private chain or post nonce is serialized. Wallet shutdown and sequencer restoration are awaited/fail closed.

Pinned API checks: PXE `sync()` explicitly advances state, while `autoSync:false` prevents implicit advancement (`@aztec/pxe/dest/pxe.js`). Public node `getBlock(number)` returns BlockResponse.hash; raw `getBlockSource().getBlock({number})` returns L2Block with asynchronous `hash()`, header and ordered TxEffects. Stable ID construction calls actual SDK Poseidon2 over `[1, board, nonce]` with separator `0x42420102`, matching production `lib.nr::post_id`.

Batch setup review: `scripts/c03-author-claims.mjs` creates ten fresh local L1 depositors, records real portal receipts, binds message content and membership paths to one actual Inbox anchor, proves ten claims serially, submits them as a batch and validates their exact owner-bound delivered notes and consumed-message nullifiers. Its nonenumerable `authorClaims` agrees with this helper; no integration blocker found in the reviewed source. Local `anvil_setBalance` provisions fresh test L1 balances only. It does not fabricate portal messages or insert roots. The controlled settlement remains the explicitly authorized application-test boundary, not an epoch-proof claim.

Validation here: pinned Node24.21.0 syntax check passed; no proof, node, build or performance run launched by this lane. Runtime and the parent 540-second limit remain unmeasured. The helper has bounded eligibility/inclusion waits, but the parent must enforce its whole-run resource/deadline budget. Serial ten-claim plus ten-post proving may challenge that budget and must be observed. This qualifies distinct rights only; same-note conflict detection and refresh/reproof remain separate C03 acceptance work. It is an internal integration review, not an external audit.

Source SHA256:

- contention helper: `2a923d8d476f38a067937a83dc155b18e1dcfc372e3d91fd15625a432ba23476`
- reviewed batch claims: `d51e570b62120fd6ea2812740e9ee1cd3d06195911dfb8de1765c66acb23dddf`

## Deadline diagnosis instrumentation

Root's first run reached all ten prepared/submitted proofs near480s but hit the540s parent deadline; no passing contention result is claimed. The helper now atomically writes `c03-contention-progress.json` in the parent's disposable directory on stages, each prepared/submitted proof, changed receipt projection, each verified author and final/cleanup. Only public transaction/identity/hash data, enum receipt results, numeric limits/counts and fixed error categories are written. Accounts, secrets, note fields, proof/transaction bytes and raw exception messages are excluded. Parent must copy this file into the bounded evidence record before deleting its directory. Atomic rename leaves the preceding complete snapshot if a write is interrupted.

The earlier wait loop also waited indefinitely (within its bound) for checkpointed/proven/finalized *failed* execution, since it checked only SUCCESS or DROPPED. This is corrected: the current status projection is persisted first, then any included non-SUCCESS result fails immediately. The stage changes to verification immediately once all ten receipts satisfy inclusion; per-author verification progress distinguishes inclusion delay from post-inclusion checks. No gas/point/time limits have changed.

Read-only capacity findings: the fixture overrides12s Aztec slots and2s blocks but does not configure a max transaction count or absolute block gas cap. Pinned shared/sequencer config leaves maxTxsPerBlock/maxTxsPerCheckpoint/maxL2BlockGas/maxDABlockGas optional; the defined shared DEFAULT_MAX_TXS_PER_BLOCK constant is32, not10. The builder still applies remaining checkpoint budgets, per-block allocation and slot build deadlines. Thus there is no source evidence of a fixture ten-transaction count cap, but ten publications fitting one checkpoint is not established. Public ordering qualification does not require one checkpoint, only one private preparation anchor.

The current helper uses `completeFeeOptions` without estimation. Actual BaseWallet fills each transaction's limits from node-advertised `txsLimits.gas` via GasSettings.fallback, reserving one-eighth of L2 and half DA for teardown by default. This is neither an observed out-of-gas failure nor proof that sufficient public gas remains. The new snapshots include advertised gas, chosen total/teardown gas and actual sequencer limits so the next run can distinguish these cases. Installed constants include MAX_PROCESSABLE_L2_GAS6540000 and MAX_PROCESSABLE_DA_GAS_PER_CHECKPOINT786432; these alone do not determine the live network's per-tx or checkpoint schedule.

Validation: syntax only with pinned Node24.21.0, exit0. No runtime launched, no deadline increased. New helper SHA256: `23901ef1df96aad12aab61eeb9dc131f930b23e25701b392d6c1d97d57f7a7fe`.

## Isolated posting diagnostic mode

Added parent `--posting-diagnostic` with explicit nonqualifying profile, C03_POSTING_DIAGNOSTIC=true, authorCount1 and contentionQualified=false. It runs the same board/Ready/actual deposit/claim/post branch and retains540s/8GiB supervision. The batch-claim helper now accepts exactly1 or10 actual generated accounts;1 requires that diagnostic environment flag. Deposit totals and identity counts use the actual count, with unchanged per-message membership/proof/receipt/note checks. Root owns the corresponding count-generalized post helper. Both edited modules passed pinned Node24.21.0 syntax checks; no diagnostic execution by this lane.
