# Fast-click Reply — published 29 October 2026

Source `6e5f02ab60d59bec5ddbc27c40324696485c463e` is pushed to master and was promoted at **08:49:01.961 UTC**. Previous release: `03bb6b8d105927b64bdd3d08b3c8e09521161250`.

Clicking Reply after a post appears but before sender cleanup finishes now retains the selected parent/root/board, shows Opening reply, then opens the correct reply composer automatically. It does not submit a reply automatically. Closing the modal, replacing the account, or a failed/unknown preceding action cannot accidentally open or send the queued reply. Latest selected target wins.

## Evidence

- Fifteen actual-panel Chromium regression checks passed, including a direct fast click without the journey readiness waiter. The old implementation failed that regression. Independent review and the integration gate passed.
- [Full CI](https://github.com/zac-williamson/aztec_experiments/actions/runs/40829093129) passed for the exact source.
- [Release attempt 3](https://github.com/zac-williamson/aztec_experiments/actions/runs/40831905862/attempts/3) passed ETH signup, post, reply, paid like, reload, Bok request/reply, and gasless USDC signup using real testnet proofs and native evidence. These real-flow checks exercise the application; the deterministic UI regression specifically exercises the short timing race.
- Host state and the live symlink both identify `6e5f02ab`; public `/wallet-panel.mjs` returned HTTP 200, `Cache-Control: no-store`, and SHA256 `456b3ef2d62faecd29e33736072f1425e320fa5e7ff347915a9a9d050ecc8aa4`, identical to committed source.

Attempt 1 failed because Bok had exhausted its two repository slots. Three existing, unassigned private test repositories were verified, reset to their pinned empty genesis, and appended to the configured pool. Existing assignments and service journals were untouched. Bok subsequently completed real replies. Pool capacity remains finite.

Attempt 2 passed six flows but reached the shared test deadline during USDC signup. Its wallet had not spent its allocation. Relay terms/budget and pool quotes were healthy; a separate actual USDC browser signup completed in 50.352 seconds, then attempt 3 passed all seven flows. The exact cause of attempt 2 is not established; no timeout or application funding behavior was changed to make it pass.

No contract changes or data migration. Performance work remains paused. Browser checks used the test wallet adapter, not the MetaMask extension. Diagnostic browsers were closed. Core free disk after promotion was 5,419,483,136 bytes.

This post-release record is retained on a separate local documentation branch for the next intended source release. Avoid a documentation-only master push that would repeat funded deployment.
