# C06 recovery source review

Read-only review; no recovery transactions or new tests were run in this lane. `execution/recovery-runbook.md` describes current routes and limitations.

Sources inspected:

- `apps/src/billboard/user/cli.mjs`: implemented `--reuse-tx`, `--withdraw-tx`, `--deposit-chain-id`, `--aztec-wallet`, `--eth-wallet`, `--private-fee-config`, `--private-fee-claim-file`, `--node-url`, `--eth-rpc`, `--pxe-dir`; claim-secret directory beside the wallet and account-prefix PXE JSON cache.
- `apps/src/billboard/user/engine.js`: durable secret save/read-back before escrow deposit; exact active receipt/event recovery; screening/debt/withdraw path; explicit withdrawal-hash witness lookup and latest-500-block fallback.
- `apps/src/billboard/user/claim-secret-store.mjs`, `app.js`, `pxe-cache.cjs`: encrypted CLI/browser escrow secrets, wallet-bound decryption, browser IndexedDB storage, raw CLI private PXE cache. Wallet file alone does not reconstruct a random escrow secret.
- `billboard/portal/src/BillboardPortal.sol`: authenticated one-time activation, no later pause/admin refund/sweep/migration, original-depositor refund, rollback on failed payment, separate forced surplus.
- `scripts/test-c01-client.mjs` and `scripts/test-c01-user.mjs`: existing store isolation/reload/tamper and scoped receipt-recovery tests; cited as existing tests, not freshly executed evidence.

Concrete unfinished recovery behavior for W02/W03:

1. `engine.js` status resolution catches withdrawal-discovery errors and categorizes an active L1 receipt as not yet claimed on L2. RPC failure does not establish that state.
2. `doClaimL1` scans only the latest 500 L2 blocks without an explicit hash, then advises “Withdraw on L2 first.” An older completed withdrawal is a counterexample. Explicit `--withdraw-tx` bypasses the scan.
3. The L1 refund catch recognizes arbitrary error text containing `already` or `consumed` as already-paid success without verifying receipt clearing/payment. Treat that log as unverified; check actual receipt/event and portal state.
4. CLI PXE cache JSON contains private state; current dump/restore is not a reviewed encrypted backup mechanism. Browser escrow-secret export/import and browser-to-CLI recovery UX are not implemented.
5. Current witness polling allows 90 minutes and prints an unsupported fixed settlement estimate. It is a live-network wait, not a reason to exceed local application test limits.

No new administrator or pause mechanism is needed to document the supported contract recovery model. C06 contract guarantees do not establish W02/W03 application recovery completion. The runbook explicitly preserves this distinction.
