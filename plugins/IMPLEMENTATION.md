# Implementation checkpoint

Base: `bf764af3f42690ac5a41c8b1b8627117e934bced`; branch `codex/board-plugins`.

Implemented: generic board registration/invocation/reply APIs; reference operator adapter; Ethereum ETH payments; immutable pinned descriptors; wallet posting coordinator; worker ports; Venice transport; GitHub PR tools; local service composition; local proof toggle; public feed metadata and authenticated bot labels. The board does not import the reference adapter, hosted service, payment client, model or repository implementation.

## Verification

- Noir workspace compilation, board/adapter processing and verification keys succeed. All 165 board and eight private-fee contract tests pass across split runs. The initial whole-workspace run reached its 540-second harness limit after 155 passes; the remaining groups passed separately, with no assertion failures.
- Four Solidity payment regressions pass: duplicates, wrong-hash isolation, minimum payment and owner withdrawal.
- 137 application, plugin and public-feed checks pass, including the real public-feed browser test. An additional authenticated-plugin projection/rollback test passes (12 plugin tests total).
- 110 private-fee/transaction regressions pass, including the plugin method selection and unchanged dummy-post path.
- The worker checks against its declared TypeScript interfaces.
- SDK and all browser applications build; canonical artifacts pass validation.
- Local chain E2E passes with application proving disabled and enabled: deploy board/adapter/payment receiver, activate actual portal using official local settlement, deposit ETH, claim via Inbox, publish a private request, pay on Ethereum, run the separate hosted worker, publish the authorized reply, remove that reply through the existing censor.

The E2E uses a deterministic injected model and genesis FeeJuice-funded accounts. The application's private fee routing is covered separately by the routing regressions; a complete browser-wallet/private-FPC/Venice session has not been run. Real application proofs were verified; the disposable local rollup still uses official test epoch/Outbox settlement controls, not production epoch-proof finality.

One repeat devnet run hit epoch-clock instability and timed out. Subsequent fresh-chain execution passed the full scenario. Shutdown qualification found the SDK's synchronous native crypto singleton and process-global polling timers needed explicit cleanup/termination. Owned entrypoints close both crypto singletons and all local services before exiting. The final proof-disabled end-to-end executable completes with exit code 0.

## Deployment state

No remote instance, public PR, push or real-fund transaction was created. Venice is selected and `plugins/.env` is local and ignored. A live model run awaits a locally configured wallet funded with Base USDC. GitHub tools target `zac-williamson/aztec_experiments`; publication needs an appropriately scoped token and `PLUGIN_GITHUB_WRITES=true`. The PR API sequence is tested with an injected transport, without creating a public PR.

The service has no conversation database or execution recovery. SQLite stores dispatch claims only. A failed/crashed claimed run is abandoned; the payment contract does not promise refunds. Fees are upfront allowances, with provider cost checked after calls. Production operators remain responsible for provider credit, operator transaction fees, key custody and availability.

Independent read-only reviews led to fixes for payment poisoning, unpinned descriptor destinations, checkout/base mismatch, owned-resource cleanup, and paid requests expiring while awaiting Aztec finality. Finality waiting now has its own state and regression test.

## Active provider replacement

Task: replace the model transport with Venice wallet-authenticated inference and Base USDC funding. Lane: encapsulated hosted-service provider adapter; board/payment/reply APIs stay intact. Checkpoint: implemented and verified. No real funds used.


### Venice replacement evidence (2026-09-21)

- Removed the former provider transport and environment settings; the composition root now selects `veniceModel` behind the unchanged ModelPort. The ignored local environment template was migrated without populating a secret.
- Added pinned `venice-x402-client@0.2.0` for SIWE/EIP-3009 signing only. HTTP, quote validation, top-up limits and failure policy stay in our adapter; the SDK auto-retry/auto-funding client is not used.
- 41 dependency regressions pass after the signer dependency addition.
- 22 plugin tests pass, including cryptographic recovery of real wallet and payment signatures, Base USDC quote restrictions, capped funding, uncertain-payment stop, funding-to-tool-call transport flow, cost accounting, existing GitHub tools and board boundaries.
- A fresh unfunded wallet successfully authenticated against the live Venice balance endpoint. The live top-up endpoint returned HTTP 402, x402 v2, Base USDC amount 5000000 and a 300-second authorization lifetime. These are read-only/payment-quote checks, not settlement or inference success.
- The live catalog identifies `kimi-k2-5` as function-call capable, with input/output prices of $0.56/$3.50 per million tokens at verification time; the adapter fetches current prices for each call.
- `bot:venice` provides address, balance status, explicit top-up and one-call live smoke commands. Paid live inference and settlement remain untested until the operator configures and funds a dedicated Base wallet. No account, real payment, PR or remote deployment was created.
- Board revenue remains ETH. No automatic swap/bridge or withdrawal was added; automatic Venice credit purchases draw only from the dedicated Base USDC wallet. Existing chain E2E proof-on/off evidence above predates this provider-only replacement and does not imply a live funded Venice E2E.


### Per-request model selection (2026-09-21)

Added a Bok Runner decorator that parses `@bok --model=MODEL_ID` within the hosted service. The generic agent carries an optional opaque model ID through ModelPort for every tool turn; the Venice adapter validates and prices that exact model. Kimi K2.5 remains the default. Model selection does not mutate shared state. No UI, board, descriptor, payment or censor changes.

Verification: 27 plugin regressions pass, including concurrent default/alternate requests through parser, agent loop, tool execution and Venice transport; alternate pricing; invalid/unsupported selections without provider spending; unrelated errors remaining visible. Composition entrypoint syntax check passes. These tests inject provider responses; no user funds were spent and no paid live inference is claimed for this change.
