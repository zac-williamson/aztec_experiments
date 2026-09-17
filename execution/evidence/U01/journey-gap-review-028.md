# U01 journey gap review — 028

Read-only source/evidence review on 2026-09-17. No application changes, build or browser/prover job. Root is updating the CRS consumer and preparing the next genuine browser run; this note does not assess that unfinished change or claim the upcoming run passed.

## Highest-priority remaining work

1. **Finish a genuine browser application transaction within the unchanged bound.** The current browser driver imports configuration and an encrypted, already-funded wallet, connects a disposable external-wallet adapter, and presses the actual Post button. Native setup has already supplied private fees and claimed collateral. Its GUI success must be followed by the worker's independent canonical post/note/fee-effect checks. Historical runs 021/024 failed inside the actual browser flow; 026 crossed the 2 GiB aggregate bound before a useful diagnostic. These are unresolved browser compatibility/capacity observations, not evidence the contract itself needs different network infrastructure. Current default diagnostics are off; optional formatter/CDP diagnosis must remain distinguished from performance evidence.
2. **Connect recovery outcomes back to usable UI state.** Author `recoverSavedTransaction()` invokes recovery and records the transaction acknowledgement through callEngine, but does not refresh `_handles`, `_stateResult` or navigation. A recovered claim/withdrawal can leave the page showing the state from before recovery. The Ethereum recovery handler already performs a status refresh when handles exist. After successful Aztec recovery, refresh canonical status and reconcile the displayed step without silently issuing another transaction; retain explicit unknown/reverted outcomes. Exercise actual GUI recovery with controlled response loss and fresh-page storage, while retaining the existing genuine proof/receipt evidence separately.
3. **Provide an actionable setup retry.** `_checkReady()` sets `_readyFired=true`, but user/moderator onReady catches status/setup failure internally. Therefore the outer rejection handler never resets `_readyFired`; wallet buttons remain disabled because wallets are loaded. The displayed generic setup failure offers no explicit reconnect action and does not clearly require a reload. A deliberate retry-status control, or an explicit reload-and-restore instruction with preserved recovery data, should resolve this. Do not allow wallet replacement while an operation is unresolved.
4. **Complete GUI journey coverage beyond the preseeded post.** Qualify private-fee approval/deposit/recovery/claim, collateral deposit/claim, screening and withdrawal readiness, L2 withdrawal, pending settlement and Ethereum refund, plus moderator actions and deployment configuration/result export at the appropriate layer. These need not be one expensive all-in-one proof run: use small GUI state/recovery tests and existing real transaction evidence, then narrowly chosen browser proofs for browser-only integration risks. Do not simulate receipt success and call that cryptographic qualification.
5. **Make supported-browser and resource claims match measurements.** Readiness establishes required APIs/storage/worker prerequisites, not memory headroom or the ability to finish a proof. A Chromium local HTTPS proof would qualify that tested profile; it would not qualify Safari, Firefox, mobile, real extension UX, Internet RPC latency or devices near memory limits. Startup/CRS initialization and gzip transport are useful separate measurements, not substitutes for transaction proving. The two-thread/local verified CRS changes require final source-bound actual proof evidence.

## Evidence that already exists — do not repeat it unnecessarily

W03 final-review-043 and remaining-stage-coverage record 468 integrated checks, genuine native post replacement (296,744 ms) and same-note attribution (300,088 ms), real local Ethereum nonce/event recovery, and actual browser storage/locks/portable restore. Their source hashes and original scope remain authoritative. Browser recovery/withdrawal-history tests use controlled chain fixtures; they are real browser/storage tests, not new browser proofs. Native genuine proofs establish application behavior under that client/backend, not Wasm/browser compatibility.

U01 keyboard-023 is a passing actual built HTTPS UI-only check. It covers keyboard configuration import, heading focus, empty-message validation, disclosure expansion/focus preservation, and fee/deploy labels using explicit public-data fixtures and no RPC transactions. This addresses the earlier keyboard findings at that scope; it is not a full assistive-technology audit. The prior hosted worker/OPFS/encrypted-export/local-CRS checks similarly establish their explicit narrower capabilities.

## Acceptance disposition

- A01: wallet-free reading and core page wiring exist; the unfinished genuine browser post and the recovery/status follow-through above prevent treating complete GUI journeys as established.
- A02: literal untrusted rendering, fixed error classifications and focused keyboard checks are substantial evidence. Setup/recovery status usability needs the concrete follow-through above; screen-reader speech and broad visual/accessibility qualification were not demonstrated by this review.
- A03: pinned HTTPS/CSP/isolation/worker checks passed for previous built candidates. Rebind/rehearse the final changed release; do not reuse hashes of a prior SDK/CRS consumer as final qualification.
- A04: public configuration and API prerequisite detection are explicit; full proving capacity is still being measured. No browser-delivered endpoint/path secret becomes confidential through schema validation. The test's loopback token proxy and disposable EIP-1193 adapter are test infrastructure, not production actors or a deployment recommendation.

## Driver limitations to preserve in reports

The driver uses native form controls but fill/click automation, so its proof pass cannot replace keyboard tests. It uses a preseeded account, native fee funding/collateral claim, an unlocked disposable Anvil Ethereum account behind an allowlisted adapter, and controlled local settlement. No genuine browser fee funding or deposit claim follows merely from a genuine browser post. Its elapsed GUI post time includes application setup, simulation, proving, submission and inclusion; the proofTimingMs=null field correctly avoids inventing an isolated prover measurement. Aggregate RSS includes parent, node, native fixture and browser workers; it is sampled, not an OS allocation cap or browser-only memory number.

## Source snapshot

- `scripts/u01-browser-post.mjs`: `a5c78638d939fb0f0d4a583ef953d9a6d093888375c1abe8cbb7847915e02c2e`
- `scripts/u01-browser-flow.mjs`: `707fe6a037290892c1166090703ceef2f67318cbaf6e183ed208176815abea5b`
- `scripts/u01-browser-post-verify.mjs`: `f088d90a4a6d39691559e730710d4a7fa6e2520ed37b897ce03fe39a15a2a58f`
- `scripts/test-c01-application.mjs`: `b124add8f04c7cfc7a63c00584c3c1428a5c156fff4b9cc68af3f321597be019`
- `apps/src/billboard/user/app.js`: `80e9ab74cbb962bd11798000786776b84d06a822587a85e6c92f70084ba8e19d`
- `apps/src/billboard/censor/app.js`: `f5d3101649f9609acd703990a58713fd1bd793ebd2060322250603f408ff595a`
- `apps/src/fee-juice/app.js`: `9ab0099bb9195d378df34710e48ea3baff012fc8310f478fd5468e2acd80e38a`
- `shared/wallet-buttons.js`: `42a75630a4251588c2eb96095972c797e4a13ac81be860f931172edcb3d005a6`
- `shared/browser-readiness.js`: `62fd221b476826d1b6a0573d9e511da2efbb29c17b94bbda5b4b352263401bbf`
