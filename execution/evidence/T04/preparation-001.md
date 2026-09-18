# Browser and recovery qualification: minimum next work

Read-only preparation, 2026-09-18. No application/harness changes, browser launches, network requests or heavy tests. Browser run044 remains owned/frozen by root and is not presumed passed here.

## What already counts, and what does not

- U01 browser041: real built HTTPS UI, encrypted wallet import, disposable Ethereum adapter, actual browser-generated private-fee post and independent canonical effects; 320.682s whole test, 1,809,728KiB aggregate sampled peak. Its 54.840s GUI posting interval includes simulation/proving/submission. Native setup supplies the collateral claim and fee credit: this is not a full GUI lifecycle or external wallet-extension qualification.
- T02 native flagged/unflagged/redeposit journeys establish genuine contract/accounting behavior. Reuse their parent-side note/nullifier, cooldown, fee and L1 refund assertions; do not repeat these cases merely to recollect identical evidence.
- W03 `remaining-stage-coverage.md`: actual built browser reload/portable restore plus real Anvil response-loss recovery, real post replacement and withdrawal attribution. Several combined screening/withdrawal races are engine fixtures. Preserve those distinctions.
- `test-u01-journey-browser.mjs` is actual DOM with injected engine/read results; its busy-state, navigation, screening/time gates and settlement-pending UX are useful, but its deposit/claim/withdrawal outcomes are not real proofs.

## Minimal genuine GUI profile

Extend existing `test-c01-application.mjs` browser mode and `u01-browser-flow.mjs`/`u01-browser-post.mjs`, not a new node or browser service. Required future edit ownership includes these scripts and verifier; current T04 lane permits evidence only.

Keep native disposable deployment/board activation and private-fee preparation. Move author collateral creation/claim into the actual browser UI: wallet import, Ethereum connect, deposit, claim, real post, required dummy screening, eligible withdrawal, then L1 refund. Use the existing wallet adapter and exact public configuration; label the adapter as test-only. Parent independently verifies original depositor/nonce/amount, included claims/posts, physical note/nullifier changes, eligible anchor, fee debit and final escrow/refund balance.

The current `completeU01BrowserPost` requires an already completed claim and `prepareU01BrowserPostVerification`; a genuine full lifecycle must change that handoff, rather than pretending the preseeded claim was made by GUI. Keep the existing native-PXE disposal before browser startup. Existing `startU01BrowserRpc`, disposable HTTPS/Caddy, browser ownership supervisor, encrypted fixture custody and one-thread browser prover remain reusable.

Settlement remains the existing official local Outbox test control after the actual exit message. No network epoch prover, proof bypass, fabricated settled receipt or broad infrastructure qualification. Time advancement must retain actual application proof-anchor eligibility assertions.

Run one bounded complete-lifecycle attempt first. Whole owned tree remains <=540s and <=2GiB, including deployment and cleanup. Measure elapsed phase durations; browser041 does not guarantee four browser transactions fit. If it fails budget, inspect one measured bottleneck before any retry. If necessary, qualify two independent genuine stage profiles (GUI deposit/claim/post; GUI screening/withdraw/refund from a declared native preseed) under the same per-profile limits. Do not relabel those as one uninterrupted full journey, reset the clock inside a test, or silently waive the complete-journey criterion.

## Restart and response-loss cases still worth adding

Reuse persistent browser context/profile, existing encrypted backup and production journals. The current browser post runner creates a new ordinary context; a genuine restart case needs context/profile lifetime retained within the same owned test and removed at cleanup.

1. After actual collateral deposit is mined, lose the response before UI completion; restart and recover the same nonce/event, then claim once. Parent asserts no second payment. Existing real-Anvil tests supply the error-injection pattern.
2. For claim/post/screen/withdraw, after genuine node submission lose the response, close/reopen the browser with the same encrypted storage/journal and invoke production recovery. Require original canonical receipt/effects or explicit unresolved state; no additional proof/send merely because UI restarted. Start with post (existing genuine browser verifier), then apply the same parameterized case to remaining distinct journal operation types only.
3. After actual withdrawal, restart before settlement: UI retains claim page and pending status. Apply official local settlement, claim refund; after lost mined L1 refund response, recover exact event/payment without another transfer.
4. Backup export/restore into a fresh profile: reuse W03 built custody tests; add one genuine interrupted operation only where they currently use engine/node fixtures. Explicitly test wrong password/context remains blocked and preserves original journal.

Each genuine run is serial and separately source-bound under 540s/2GiB. Cheap failure-state/UI matrix stays on existing fixtures; real proof coverage is reserved for distinct operation/recovery integration gaps. No thousand-proof repetition.

## Browser/hardware matrix: observed availability, not qualification

Host carried from U01: Apple M4 Pro / Mac16,8, 12 CPUs, 24GiB RAM. Current filesystem inspection found:

| Engine | Installed evidence | Current coverage |
|---|---|---|
| Playwright Chromium/headless shell | revision1208; bundled browsers.json version145.0.7632.6; corresponding cache directories present | Existing real browser041 and bounded UI tests on this host. Exact executable version should be captured next launch. |
| Stable Google Chrome | /Applications/Google Chrome.app, CFBundleShortVersionString153.0.8010.52 | Installed, not exercised by existing chromium.launch default. Qualify real journey using explicit channel; do not equate it to bundled Chromium. |
| Safari | /Applications/Safari.app, version26.5 | Installed, not tested. No cached Playwright WebKit; Playwright WebKit is not installed Safari. Native Safari automation requires a separately verified available interface. |
| Firefox | No Firefox application in inspected /Applications; no Playwright Firefox cache | Unavailable here; no support qualification claim. |
| Mobile / Linux / Windows | No inspected representative device/host evidence | Viewport emulation may qualify reading layout only, not mobile proving or physical-device performance. |

P01 product-spec lines138–143 prescribe three deposit cycles with1,000 lifetime posts, ten same-anchor authors, >=30-post per-engine p95 samples and feed budgets. These are recorded engineering targets, not results. Existing c04_seeded Noir boundary tests and screening-history PXE pagination tests exercise long history without1,000 expensive proofs. Reuse their evidence, then add source-backed browser read/history pagination and bounded concurrency integration where missing; explicitly distinguish seeded history from accrued live posts. Do not claim p95/device acceptance from one localhost proof or silently lower those targets. Any revised product promise requires explicit recorded disposition, not hidden test substitution.

## Practical execution order

1. Finish current root browser044/privacy observation and freeze its result.
2. Expand T04 ownership for minimal existing-harness lifecycle mode; review source and measured time budget before running.
3. Real GUI lifecycle, then one genuine restart-at-submit case; use independent verifier and fixed attempt budget.
4. Reuse/extend cheap built-browser recovery/failure cases and source-bound long-history tests; qualify stable Chrome and mobile reading if available under the same serial resource limits.
5. Keep unsupported engines/external wallets/missing-device performance and unrehearsed operator failures explicit. T04 completion still requires O01 and its remaining drills.
