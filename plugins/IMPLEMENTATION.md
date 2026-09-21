# Implementation checkpoint

Base: `bf764af3f42690ac5a41c8b1b8627117e934bced`; branch `codex/board-plugins`.

Implemented: generic board registration/invocation/reply APIs; reference operator adapter; Ethereum ETH payments; immutable pinned descriptors; wallet posting coordinator; worker ports; OpenRouter transport; GitHub PR tools; local service composition; local proof toggle; public feed metadata and authenticated bot labels. The board does not import the reference adapter, hosted service, payment client, model or repository implementation.

## Verification

- Noir workspace compilation, board/adapter processing and verification keys succeed. All 165 board and eight private-fee contract tests pass across split runs. The initial whole-workspace run reached its 540-second harness limit after 155 passes; the remaining groups passed separately, with no assertion failures.
- Four Solidity payment regressions pass: duplicates, wrong-hash isolation, minimum payment and owner withdrawal.
- 137 application, plugin and public-feed checks pass, including the real public-feed browser test. An additional authenticated-plugin projection/rollback test passes (12 plugin tests total).
- 110 private-fee/transaction regressions pass, including the plugin method selection and unchanged dummy-post path.
- The worker checks against its declared TypeScript interfaces.
- SDK and all browser applications build; canonical artifacts pass validation.
- Local chain E2E passes with application proving disabled and enabled: deploy board/adapter/payment receiver, activate actual portal using official local settlement, deposit ETH, claim via Inbox, publish a private request, pay on Ethereum, run the separate hosted worker, publish the authorized reply, remove that reply through the existing censor.

The E2E uses a deterministic injected model and genesis FeeJuice-funded accounts. The application's private fee routing is covered separately by the routing regressions; a complete browser-wallet/private-FPC/OpenRouter session has not been run. Real application proofs were verified; the disposable local rollup still uses official test epoch/Outbox settlement controls, not production epoch-proof finality.

One repeat devnet run hit epoch-clock instability and timed out. Subsequent fresh-chain execution passed the full scenario. Shutdown qualification found the SDK's synchronous native crypto singleton and process-global polling timers needed explicit cleanup/termination. Owned entrypoints close both crypto singletons and all local services before exiting. The final proof-disabled end-to-end executable completes with exit code 0.

## Deployment state

No remote instance, public PR, push or real-fund transaction was created. OpenRouter is selected and `plugins/.env` is local and ignored. A live model run awaits the user's locally configured key. GitHub tools target `zac-williamson/aztec_experiments`; publication needs an appropriately scoped token and `PLUGIN_GITHUB_WRITES=true`. The PR API sequence is tested with an injected transport, without creating a public PR.

The service has no conversation database or execution recovery. SQLite stores dispatch claims only. A failed/crashed claimed run is abandoned; the payment contract does not promise refunds. Fees are upfront allowances, with provider cost checked after calls. Production operators remain responsible for provider credit, operator transaction fees, key custody and availability.

Independent read-only reviews led to fixes for payment poisoning, unpinned descriptor destinations, checkout/base mismatch, owned-resource cleanup, and paid requests expiring while awaiting Aztec finality. Finality waiting now has its own state and regression test.
