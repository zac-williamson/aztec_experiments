# Recovering the fresh message board deployment

This runbook describes existing recovery routes, not a completed backup product. Use the verified deployment's portal, Aztec node, Ethereum RPC and private fee configuration. Never change network or create a replacement deposit merely because a request timed out.

## Preserve the existing identity and state

Keep the original Ethereum wallet and Aztec wallet, including its secret key and account salt. The Ethereum depositor receives the refund; another address cannot redirect it. For CLI users, preserve the `claim-secrets-v1/` directory beside the Aztec wallet file: its encrypted records require that wallet's matching secret key. Preserve the repository's `.pxe-cache/` privately as well; its account-prefix JSON files contain private PXE state and are not an encrypted backup format. Keep the same `--pxe-dir` prefix if one was specified.

Browser claim secrets live in IndexedDB database `aztec-billboard-claim-secrets-v1` at the original site origin; the PXE also uses browser storage. Keep the original browser profile/site data and wallet. Loading the wallet file alone does not recreate an independently random escrow claim secret. There is no implemented browser export/import workflow for these escrow secrets, and browser-to-CLI secret-store migration is not documented as supported. Do not clear the old profile while testing recovery.

Record the deployment/network identity, L1 deposit transaction hash and L2 withdrawal transaction hash. Keep transaction metadata private where it joins the two identities. Private fee funding has its own public recovery record and wallet-derived claim; it is separate from the escrow's random claim secret.

## Use the ordinary claim and exit routes

Run the pinned Node/toolchain from the repository root. The CLI is `apps/src/billboard/user/cli.mjs`. Each invocation uses:

```text
node apps/src/billboard/user/cli.mjs ACTION --portal-address PORTAL --node-url AZTEC_RPC --eth-rpc ETH_RPC --aztec-wallet AZTEC_WALLET_FILE --eth-wallet ETH_WALLET_FILE --private-fee-config PRIVATE_FEE_CONFIG_FILE
```

Replace capitalized placeholders; append the action-specific options below. Wallet files contain secrets: do not paste their contents into commands, logs or support messages. An existing private fee balance is needed for L2 actions. First-use fee claiming additionally supports `--private-fee-claim-file FILE` with private file permissions; this is not an escrow recovery secret.

| Actual state | Action and additional options |
|---|---|
| L1 deposit confirmed; no L2 claim yet | `claim --reuse-tx L1_DEPOSIT_TX_HASH`. This authenticates the event against the active nonce/amount and loads the matching saved claim secret. The secret is never taken from the public event. |
| L2 posting right already exists | `status`, then `post --dummy` as needed to screen mature real posts. Wait for the resulting cooldown/penalty debt. The standalone `withdraw` action requires eligibility; only `auto` has the existing bounded dummy-screening loop. |
| All real posts screened and debt expired | `withdraw`. Save its L2 transaction hash. The right is consumed before the withdrawal message can authorize an L1 refund. |
| L2 withdrawal confirmed; ETH still escrowed | `claim-l1 --withdraw-tx L2_WITHDRAWAL_TX_HASH`. The CLI obtains the exact message witness and submits `portal.withdraw` from the original Ethereum depositor. |

When necessary, the implemented `--deposit-chain-id FIELD` selects a particular private deposit chain. This identifier is private metadata; do not publish it. The `deposit --reuse --reuse-tx HASH` action only recovers receipt information; `claim` performs the L2 claim. Avoid `auto` while diagnosing ambiguous state.

The browser has existing deposit, dummy-post, withdrawal and L1-claim actions, but its automatic routing is not reliable evidence that an old transaction is absent. The CLI's explicit transaction hashes are the available recovery route for bounded-history discovery failures.

## Verify results, especially after interruption

Check the exact transaction receipt on the correct chain. After an L1 refund, verify its successful receipt and `Withdrawn` event, and that `getDeposit(originalDepositor)` has nonce and amount zero. A status label, timeout, or message containing “already consumed” is not proof of payment. A reverted ETH transfer rolls back both the receipt change and Outbox consumption, so the same legitimate refund can be retried after the recipient can accept ETH.

Without `--withdraw-tx`, discovery only scans the latest 500 L2 blocks. A withdrawal older than that can still be claimed using its transaction hash. If the hash is missing, recover it from retained transaction records or an appropriate archival source; the current UI cannot guarantee automatic discovery. Do not submit another L2 withdrawal just because the scan says “Withdraw on L2 first.”

The CLI currently waits in 30-second intervals for an L2-to-L1 witness, up to 90 minutes. This is a network-settlement wait, not application proof generation; its printed “40 minutes” estimate is not a guarantee. Production settlement belongs to the network. Local application tests use the official settlement controls and their separate short test deadline; do not run a network prover for this recovery procedure.

## Limits and authority

Deposits are disabled before authenticated Ready activation. After activation, this portal has no pause, refund administrator, sweep, emergency timeout refund or migration function. Existing claims/exits cannot be disabled by an application pause authority because none exists. Forced ETH is uncredited surplus and has no withdrawal entitlement or sweep route.

Lost escrow claim secrets, lost wallet keys and permanent protocol unavailability can make recovery impossible. No administrator can refund collateral while leaving a live L2 posting right. A user who can restore the correct state follows the same screened, debt-paid exit as everyone else.

W02 still owns reviewed backup/export/restore UX and private-cache handling. W03 still owns durable submission journals, reliable historical discovery and honest unknown-state handling. These gaps must be completed before presenting recovery as a production-ready product.
