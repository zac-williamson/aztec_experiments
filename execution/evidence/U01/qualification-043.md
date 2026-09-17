# U01 implementation qualification

Current candidate uses the supported one-thread WasmWorker, local fully hash-verified CRS with524288 BN254 points, supported lazy PXE/kernel artifacts and sequential circuit accumulation. Same hiding-key generation, structured local proof verification, compression and normal node verification remain mandatory. No proof bypass, external proving service or resource-limit change. Source review039 did not promise memory savings; genuine041 establishes observed feasibility on this host.

Host: Mac16,8 / Apple M4 Pro /12 CPUs /24GiB RAM; pinned Node24.21.0/Aztec5.2.0, local headless Chromium, disposable HTTPS. This is a single-host engineering qualification, not device-matrix or p95 performance acceptance.

## Actual proof

Browser041 passed in320682ms whole-test time,1809728KiB sampled aggregate peak, all owned processes/temp data cleaned. Actual visible public-config import, encrypted disposable wallet restore, Ethereum wallet connection and GUI post used real RPC and private fees. GUI posting took54840ms including simulation/proving/submission; it is not isolated proof time. Local BB verification completed, node accepted proof, canonical included post/message/note/nullifier/cooldown/private debit/protocol fee were independently checked. No external HTTP, failed HTTP or CSP violations. Native disposable setup preseeded collateral/fees; this is not a genuine full browser deposit-to-refund test.

## Final affected checks

143 serial focused checks pass (integrated042); actual bundled CLI compatibility passes. Final bounded HTTPS browser checks: config5459ms/1415648KiB, keyboard4976ms/1186432KiB, journey7397ms/877104KiB, fee/deploy6081ms/1081056KiB. Cleanup passed all. Journey/fee-deploy engine results are explicitly fixtures; actual DOM, navigation, guards, errors, busy states, export/recovery and literal rendering are exercised. Native T02 full flagged/unflagged/redeposit journeys independently pass on unchanged contracts.

Hosting041 passes5947ms/1237808KiB with actual worker/OPFS/encrypted wallet, full CRS hashes, applied point count, cross-origin isolation, exact CSP, zero external requests. SDKready1128ms, CRS1265ms including364ms hashing. DeliveredSDK51979520bytes, gzip28402261bytes; allcircuitdata remains one bundle, no per-circuit request leakage introduced. No download-size improvement claimed.

Focused commands: node --test --test-concurrency=1 test-browser-chonk-stream, test-private-pxe-browser, test-engine-private-fee and listed U01 unit scripts in integrated042; CLI node scripts/test-cli-sdk.mjs. Browser commands use scripts/run-bounded-browser-check.mjs against config/keyboard/journey/fee-deploy scripts, hosting with --with-crs and application with --browser-post. All launched serially from repository root with pinned Node PATH. SDK/apps builds supervised via OwnedBuildTree180s/2GiB and pass with cleanup; build040 logs retained.

## Historical failures and remaining release work

Disposition038 and failed proof028/031/034/036 remain historical adverse evidence, superseded only for this successful one-thread configuration. Hosting040 failed a stale required auxiliary-worker request assertion after actual wallet setup;041 explicitly checks required main/SQLite workers and absence of auxiliary requests. No result was relabelled.

U01 acceptance is implementation readiness on the tested configuration. T04 still owns genuine browser full deposit/withdraw/recovery, supported device/browser matrix, representative workload and performance qualification. T03 still owns end-to-end privacy claims/correlation measurements. Automated moderation quality, compiler/protocol/privacy independent review, public-network clearance, audit and soak remain open gates. No production readiness or public deployment claim. See acceptance-review042.
