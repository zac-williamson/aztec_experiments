# Public testnet qualification

These scripts exercise the built author page against a real V5/Sepolia board.
They do not advance blocks, modify contract storage, inject a wallet provider, or
replace the provider, chain, or GitHub APIs. Use only fresh test identities and
faucet assets. Run from the repository root with the pinned Node runtime.

Prerequisites are the deployed/activated board and plugin portals, registered
plugin, reachable HTTPS descriptor, running hosted service, and matching public
site configuration. The site configuration must validate against this checkout's
`shared/public-app-config.js`; do not copy additional fields from another version.

`prepare.mjs SERVICE_CONFIG AUTHOR_DIRECTORY FAUCET_WALLET` creates a new author
and MetaMask wallet, encrypted application backup, and journaled transfers of
0.02 Sepolia ETH and 2 test USDC. Never reuse a personal wallet or delete its
journals to repeat a payment. `fees.mjs` has explicit `publish`, `mint`, `bridge`,
`recover-bridge`, and `claim` phases; publish the canonical FPC once, then fund and
claim the fresh author's private transaction fees. Its generated public fee
configuration belongs in the test site's configuration.

Before plugin qualification, use the existing author CLI's `deposit` and `claim`
actions to establish normal board collateral for that same fresh author, using
its `application-wallet.json`, `ethereum.json`, and `private-fee-config.json`.
Record the deposit transaction and pass it as `--reuse-tx` to claim. This is fixture
preparation, exactly as in the local test: plugin credit is not board admission
collateral. The browser checks a positive claimed board deposit before testing
an unfunded plugin request.

Run each phase with:

```
node --env-file=plugins/.env plugins/public/qualify.mjs PHASE AUTHOR_DIRECTORY SERVICE_CONFIG SITE_CONFIG
```

The ordered phases are:

1. `fund`: restore the fresh author in real MetaMask, reject a zero-plugin-balance
   post without publishing or buying inference, approve and deposit 1 test USDC.
2. `post`: once the actual Inbox message is available, claim through the page and
   send the ordinary `@bok` message through the composer. Verify no ETH payment.
3. `reply`: once Bok's on-chain reply exists, verify the visible unflagged reply,
   exact draft PR file, Kimi invoices, settled charge and unreserved remainder;
   withdraw that remainder through the page.
4. `redeem`: after actual finality, redeem through MetaMask and check the exact
   final token balance, wrong-recipient rejection and replay rejection.

Each phase is supervised below nine minutes and 4 GiB. Read-only readiness checks
return `awaiting` without opening the wallet; rerun that same phase after network
progress. Completed phases are never repeated. A saved `running` marker after an
interruption requires inspection and normal application transaction recovery;
never clear it blindly. Reply/redemption reconnects reconcile the saved Aztec
transaction through the existing application API before another send.

The flow file records assertions; `qualification-PHASE.json` additionally requires
successful process exit and cleanup. A flow is qualified only with all four clean
phase reports. Private wallet, profile, journals and funding receipts stay in the
ignored author directory. Export only reviewed public transaction evidence.

`recover-fund` is an explicit read-only reconciliation of an interrupted `fund`
phase; it never approves or deposits again. It requires the original browser
funding intent and verifies the successful Ethereum event against its sender,
nonce, recipient and amount, then checks the independent chain baselines. The
fund report records `reconciled: true`; preserve its original failed report too.
This is distinct from rerunning `fund` and does not silently retry a payment.

Native verification runs in short-lived read-only processes before and after the
browser. This releases native runtime memory instead of retaining a second PXE
alongside the actual browser prover. All descendants remain under the same
supervisor; the nine-minute and 4 GiB limits apply to the complete phase.
