# Attempt007: source-led diagnosis without another proof run

Inspected `application-80edaef6-e1f4-422f-a709-9fc89a3bb3f1.json`, current browser driver/bootstrap, actual user app/navigation, Ethereum journal and test RPC adapter. No source edits, browser/proof/model/build run or network request.

Established observations: strict handoff now passed. Browser loaded the real wallet/software, imported/restored its wallet and connected the Ethereum adapter. The parent reports stage `gui-deposit-claim` at166734ms, total end168970ms; browser total7577ms. No HTTP/CSP failures, no recorded proving start, cleanup successful. The previous descriptor mismatch is resolved. The failure occurs roughly2.2s into deposit/claim, not near the timeout or memory cap.

The driver then executes four operations: wait for visible page1; fill deposit amount; click navigation; wait for `depositStatus` either success text or `.error`. If `.error` appears, `finish()` deliberately asserts and rejects immediately. `shared/helpers.js` catches application navigation failures and places a fixed `.error` in that container. The existing final UI diagnostic reads setup/post/depositBalanceCheck only and does not inspect depositStatus. Its false error booleans therefore do not show that the deposit operation succeeded.

Source inspection found no second deterministic handoff/selector defect. Amount format is checked by producer and driver, actual template has the selected controls, connected state selects the actual deposit action, and Ethereum adapter supports sendTransaction plus its usual transaction/receipt reads. The application requires portal verification, durable secret save/readback, then Ethereum journal submission/verification before claim. Any of those steps may fail before proof start. Current retained evidence cannot identify which did. No application bug, loss of funds or insufficient funding is established by this report.

Minimum diagnostic change before an independently authorized next attempt:

- Capture a fixed driver substage (`wait-deposit-page`, `fill-amount`, `click-deposit`, `await-deposit-claim`, `claim-checkpoint`) and allowlisted exception constructor only. This distinguishes driver/DOM failure from explicit operation failure.
- Add `depositHasError` and fixed milestone booleans from depositStatus: `Making new L1 deposit`, `Claim secret saved locally`, `Deposit confirmed`, `Waiting for L2 to ingest deposit`, `Deposit claimed on L2`, plus fixed journal/protocol error categories already allowed by the public error formatter. Do not retain its raw text, addresses, transaction payloads, keys or witnesses.
- Preserve the existing semantic RPC observer snapshot on failed coordinator cleanup, rather than only in successful finishAfterSettlement. Method counts/fixed result classifications distinguish pre-send failure, a submitted deposit and claim waiting. No RPC request/response body required.
- Test these diagnostic extractors with synthetic secret-bearing text/errors and an injected DOM error before another genuine run. Keep this a diagnostic change; do not modify application custody/payment behavior without identifying the failing boundary.

No heavy retry recommended solely because a failure exists. The graph investigation must explicitly record the new diagnostic hypothesis and finite attempt budget first.

Implemented diagnostic scope after this read-only diagnosis: actual journey driver now tracks fixed substage and preserves only allowlisted exception class. A self-contained UI extractor adds deposit/withdraw/refund error flags and fixed progress booleans, tested with secret-bearing strings. Journey mode permits the existing formatter observer but returns before the CDP breakpoint path; observation scope states formatter-only/no breakpoint. Original formatter receiver, arguments and returned value remain untouched. Known Ethereum journal error codes are included in the existing fixed code allowlist. Root separately owns enabling diagnostic mode in parent; another reviewer owns failed native RPC summary.

Seven cheap helper tests pass (~0.65s), including no-secret diagnostic extraction and arbitrary error-name/substage rejection. Syntax checked. No heavy rerun.
