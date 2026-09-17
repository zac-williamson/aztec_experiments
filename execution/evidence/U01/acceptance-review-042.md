# Independent U01 acceptance review

Read-only review, 2026-09-17. No application edits or additional tests were performed. Reviewed U01/T04 task criteria, final038 GUI evidence, hosting041, actual browser-post041 and its source-bound application report, relevant hosting/readiness source and retained lazy-provider assessments.

## Disposition

U01 can close as an **implementation and bounded integration package**, subject to root's final affected GUI/CLI checks passing and the evidence/status handoff being updated. No additional concrete missing U01 implementation was identified in this review. This disposition must retain the explicit limits below; it does not qualify a complete genuine browser deposit-to-withdraw journey or a production browser/device performance matrix.

U01-A01 says core journeys are usable without a CLI; it does not demand that every cryptographic lifecycle be executed end-to-end through a browser in this package. Real DOM fixture checks establish the implemented navigation/actions/status wiring, existing actual engine/application tests establish their underlying behaviors, and041 now establishes one actual browser-generated private-fee post through the shipping GUI. T04 explicitly owns all promised browser journeys, supported wallet routes, device/load/failure/recovery qualification. Keep the missing full genuine GUI lifecycle there as concrete work, not an implicit assumption or waiver.

| Criterion | Evidence and judgment | Boundary |
|---|---|---|
| A01 — core journeys without CLI; public reading before wallet | Actual built public page and config/keyboard/journey038, fee/deploy UI fixtures, implemented engine routes, plus genuine GUI post041 provide implementation/integration evidence. | Journey038 explicitly substitutes engine/read results. Native setup preclaims/funds the041 wallet. Neither proves browser-native deposit/claim/screen/withdraw/L1-refund integration end to end. T04 must run those actual routes. |
| A02 — safe untrusted rendering, keyboard and status | Journey038 verifies literal untrusted text, explicit withdrawal, busy-action prevention, screening/time gates, pending settlement and recovery state navigation; keyboard/config tests qualify their implemented UI boundaries. | Fixtures and bounded keyboard cases are not exhaustive accessibility, malicious-content or assistive-device certification. Final affected tests must remain source-bound. |
| A03 — actual release HTTPS/security headers/workers/isolation | Hosting041 passes actual built public/wallet pages, private workers, storage, WASM, encrypted wallet creation, local verified CRS, range handling, private-path denial and zero external requests. Actual post041 records no CSP violation/failed HTTP/external request. | Disposable loopback TLS with a context-scoped certificate exception; operator public DNS/certificate/RPC deployment remains separate. |
| A04 — honest environment detection, credentials/privacy | Readiness checks state that prerequisites do not guarantee proof performance/capacity. Configuration treats browser endpoints as public and excludes privileged credentials; hosting limits endpoint origins. Retained request-footprint/lazy-provider assessment addresses loading privacy. | One supported desktop run cannot predict all usable/unsupported devices. No guarantee of anonymity against timing/network observers follows from same-origin assets. T03/T04 must retain those boundaries. |

## What041 actually demonstrates

`one-thread-proof-041.json` passed in **320682 ms** for the aggregate disposable fixture, with sampled descendant peak **1809728 KiB**, no budget increase, and verified owned-tree/temp-directory cleanup. The substantive report is `application-b37a54c6-cf64-470f-9f5a-a0b9535cf5c7.json`.

The browser restored an encrypted backup of a natively prepared disposable private-fee-funded author, connected the test Ethereum wallet adapter, navigated the actual GUI and submitted a post. No debugger/formatter diagnostic wrapper was enabled. The actual application proof passed pre-submission validation and normal node verification, entered a canonical checkpoint, and matched the expected deposit nullifier, replacement/post notes, cooldown, public content and private/public fee debits. The author's public fee balance remained zero.

GUI post elapsed time was **54840 ms**, including setup/simulation/proving/submission; no isolated prover timing was measured. Browser SDK readiness was1284 ms and wallet setup3779 ms in that run. The aggregate320682 ms is not the browser proof latency. Report `performanceQualified:false` correctly remains in place.

`one-thread-hosting-041.json` passed in5947 ms with peak1237808 KiB. Its log records SDK navigation readiness1128 ms and actual async CRS initialization1265 ms including364 ms hashing. The decoded SDK was51979520 bytes, gzip28402261 bytes, with decoded hash matching the build. A fresh browser context does not imply cold OS caches or Internet delivery; these are local-host observations. Earlier011/013 Sync timings and failed034/036 proof attempts remain historical, not erased by041.

## Required handoff, not new blockers invented by this review

- Update the active disposition: `disposition-038.md` still states that no completed browser proof exists and U01 is blocked. Preserve it as historical, but add/link a current disposition rather than presenting those statements as current facts.
- Record the one-thread shipping configuration and current artifact/SDK manifests;041's result must not be projected onto changed bytes without relevant verification.
- Retain T04 work for genuine GUI private funding, collateral deposit/claim, moderation/screening, withdrawal/refund, reload/recovery at each stage, supported external wallet routes and the browser/device/network matrix. Native T02 success does not substitute for browser integration.
- Retain representative cold delivery, parse/readiness, actual proving and capacity measurements under declared budgets. Current desktop loopback measurements qualify a bounded workload, not fleet or mobile performance. Mobile public reading remains a separate T04 check.
- Preserve T03 review of RPC/asset/request timing and lazy loading privacy. Evaluating supported deferred providers and retaining bundled assets does not establish anonymity; source download size remains large despite deferred construction.
- Require final affected GUI/CLI checks and graph/evidence validation before closing U01. This review does not assert results for checks still running.
