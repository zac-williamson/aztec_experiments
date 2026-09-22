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

## Deployment state before live qualification

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


## Live qualification completed (2026-09-21)

User explicitly authorized real end-to-end execution using the funded bot wallet. Root remains sole writer. Independent read-only review by plugin_fit identified and resolved the legacy x402 envelope mismatch, draft-mode enforcement, cleanup-before-evidence ordering and ledger attribution gaps. The emergency timeout limitation remains documented.

Actual first run succeeded: ETH on Base was swapped for exactly 5 USDC; Venice credited 5 USD and returned a paid Kimi answer. A separate complete board run created draft PR #1, posted its link in an authenticated board reply and flagged that reply through the censor, exiting 0. The final alternate-model full run also passed against PR #1. The evidence below supersedes earlier statements that live funding/inference and GitHub writes were untested.


Live testing found and fixed a PR-tool defect: raw GitHub PR responses embedded enough repository/user metadata to exhaust the agent's 16,000-character tool-result limit before the changed-files list. `read_pr` now returns selected metadata, files first, explicit truncation flags and a serialized-response budget. A real read-PR invocation now identifies `docs/bok-live-smoke.md`; the regression covers oversized metadata and JSON escaping.

One alternate-model full run received a Venice HTTP 400 after its first billed call. The same paid two-call invocation succeeded when isolated. Provider error details are now retained (bounded message only) for diagnosis; there is no automatic model-call retry. Failed-run evidence remains under `.build/plugin-e2e-7Ced6t` (tool truncation) and `.build/plugin-e2e-0Bvhpq` (provider rejection), both with successful cleanup.


Final evidence: [live-2026-09-21.json](evidence/live-2026-09-21.json). Both successful complete runs exited 0 with application proving disabled on the local devnet. The final run used `z-ai-glm-5-3-flash`, verified the exact changed file, matched all new Venice charge records to that selected model, posted its authenticated reply and successfully censored it. The final executable records successful cleanup. 28 plugin regressions pass, including private-key normalization, v2 authorization shape, draft publication and bounded PR response serialization. Read-only review found no blocking remaining issue.

Real Base settlement: 5 USDC paid to Venice in transaction `0xef8b9aaea5cea18822a2897e989bd6d0bc15ee752d102a5e2f4ffbb53800d54f`. Draft PR: https://github.com/zac-williamson/aztec_experiments/pull/1 (not merged). The operator's key remains only in the ignored local `.env`; the live test reads GitHub credentials from the existing keychain session into memory. No remote machine was rented or deployed. Test networks were shut down after the runs; these are execution results, not a claim of a persistent running deployment or browser-wallet qualification.

## Active browser qualification

Task: exercise the actual author webpage, Ethereum wallet approval, payment-gated live Venice/GitHub execution, and visible uncensored reply. Root writes; plugin_fit reviews read-only. Prior scripted integration is not browser end-to-end qualification. Current checkpoint: generic application boundary already connects composer to the plugin client; preview lacks private-fee configuration and browser submission transport. Add a posting-capable local fixture using actual private fees, then verify unpaid/rejected payment does not invoke Venice and an approved payment produces a canonical reply. No browser-path success claimed yet.

Browser checkpoint: fixed production hosting omission of plugins.js; actual-built author dependencies now have an allowlist regression. Added interactive browser devnet preparation with real private fee funding and an account restored with the browser's key derivation. First run reproduced a checkpoint race during fee funding; second run passed after sharing the bounded checkpoint-drain helper. Chrome loaded the actual author page and imported the funded account. MetaMask connected on a different network, so browser payment/inference remains unverified; awaiting a disposable wallet on local chain 31337. No browser post/payment or new Venice charge claimed. 32 plugin/hosting regression tests pass. Independent read-only review found no source blocker; completed browser post/reply checkpoints must be retained before leaving a proof-disabled preview running. Live process predates the final CSP-header addition and GitHub-write CLI option; these require verification on the final source before claiming full acceptance.

## Automated wallet harness — active

User authorized an isolated automated wallet harness on 2026-09-22. Root integrates; read-only review required before qualification. Reuse the pinned real MetaMask extension and existing UI helpers. The author UI must originate the post and fee; the harness observes and validates the wallet transaction before confirming. Rejection must leave one unpaid post and no new Venice charges; approval of the same saved post must produce a verified Ethereum receipt, live provider charges, GitHub output, and visible authenticated reply. Disposable local identities only. Production wallet approval behavior remains unchanged.

Automated harness checkpoint: real MetaMask launched successfully in the isolated profile using the fixture account, and reached onboarding. Operator Terms confirmation requested; no plugin payment or inference was executed. Added exact wallet-request validation, rejected-payment ledger/chain checks, same-post retry, visible canonical reply checks, cancellation, bounded browser lifetime, redacted failures and cleanup-qualified result recording. 33 plugin/hosting regressions pass; independent review found no remaining source blocker after cancellation fixes. Full real-wallet acceptance is still pending, and the active run loaded the earlier onboarding helper before its gate was moved ahead of the initial continuation.


Browser qualification checkpoint (2026-09-22): first resumed run `.build/plugin-browser-iLuOI9` completed real MetaMask rejection (no payment, reply or Venice charge), retry of the same published post, a successful 0.001 ETH plugin payment, live Kimi/GitHub execution and an unflagged canonical reply. The final raw `innerText.includes(reply)` assertion failed; overall result remains failed with cleanup successful. A bounded Chromium experiment reproduced that normal paragraph rendering collapses newlines whereas canonical post text retains them. Next: compare exact DOM text in the visible reply article and normalized rendered whitespace, preserve intermediate evidence before assertions, then rerun the full scenario. No application behavior is changed by this harness repair. Prior connection failure resolved after the user changed networks; verified HTTPS to Venice now succeeds.


### Real browser-wallet qualification passed (2026-09-22)

Fresh run `.build/plugin-browser-b0UFqR` passed and exited 0 after successful cleanup. Real author UI and MetaMask produced exactly one 0.001 local ETH plugin payment after rejecting the first attempt; rejection caused no payment/reply/Venice charge, and retry reused the original post. The payment-gated worker invoked real Kimi K2.5 and GitHub, returned the PR #1 URL and exact changed file, and posted an authenticated, unflagged reply visible in the actual author page. Both new Venice ledger charges identify `kimi-k2-5`, totalling $0.00140686. Exact DOM reply text and normalized visible text match canonical on-chain content.

Evidence: `evidence/wallet-2026-09-22.json` and `evidence/wallet-2026-09-22.png`. All 33 affected regression checks pass. Independent read-only plugin_fit review found no blocker. Shutdown logged a sequencer interruption while stopping; cleanup returned successfully and the executable exited 0. The fixture prepares collateral and private fee balances; initial-deposit UI is outside this scenario. Application proving was disabled as requested; this does not qualify this browser run with proving enabled or production finality. Real browser GitHub reading is qualified; prior separate native integration evidence covers PR creation. No new PR, remote instance, push, or deployment. The disposable network has been shut down; the screenshot records the actual page, not a persistent live board.
