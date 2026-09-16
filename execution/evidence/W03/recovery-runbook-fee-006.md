# Recovering the fresh message board deployment

This runbook describes existing recovery routes, not a completed backup product. Use the verified deployment's portal, Aztec node, Ethereum RPC and private fee configuration. Never change network or create a replacement deposit merely because a request timed out.

## Preserve the existing identity and state

Keep the original Ethereum wallet and Aztec wallet, including its exact secret key and full account salt. The Ethereum depositor receives the refund; another address cannot redirect it.

Browser users should export an encrypted recovery file from Wallet Setup after each new collateral deposit. It contains the Aztec key, full salt and this account's random collateral claim secrets with their original network/board scopes. Restore it with its password before connecting an Ethereum wallet. Restore validates commitments and adds records atomically without overwriting conflicts. Claims for other networks retain their original scopes; importing does not redirect them. Keep the separate public private-fee funding recovery file too. A wallet-only backup made before a collateral deposit does not contain that deposit's independently random secret.

Browser custody uses IndexedDB `aztec-billboard-claim-secrets-v2`; its records are encrypted under the key and full account salt. The PXE's browser database is private execution state but is not encrypted by this application. Use a trusted browser profile/device and keep site data until recovery is checked. Keys are decrypted in memory while the page is open; browser encryption does not protect an unlocked malicious page. The old v1 test database is left untouched and is not automatically imported.

CLI users must preserve the exact wallet file plus `claim-secrets-v2/` beside it and the repository's `.pxe-cache-v2/`. Wallet files must be private regular files (mode0600); directories must be private (mode0700). Checkpoints are authenticated/encrypted to the full account/network/rollup identity. A stale lock is not silently removed: inspect its PID, confirm its owning process has stopped, and only then remove that specific lock to resume. Keep the same `--pxe-dir` prefix. Old plaintext `.pxe-cache/` and v1 claim-store files are preserved but not automatically loaded. Browser-to-CLI backup-format conversion is not supported.

Wallet creation uses a random Aztec key. Signature-derived keys and browser-generated Ethereum key files are no longer offered. Ethereum signing uses your browser wallet; CLI Ethereum keys remain explicit private local files. Changing the account or chain invalidates the page, and wallet operations for one account are locked across tabs. Reload to switch; reconcile any submitted transaction before retrying.

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

Without `--withdraw-tx`, discovery scans the full requested L2 history in50-block pages. Each lookup attempt is bounded to20seconds; incomplete history remains unknown. Persistent scan cursors remain unfinished, so a very large chain may require the saved transaction hash or an archival lookup. Never submit another withdrawal merely because discovery is incomplete.

The Ethereum claim action checks for the L2-to-L1 witness once and returns a pending outcome when settlement is not ready. Retry the claim later. Production settlement belongs to the network; no application process needs to wait ninety minutes. Local tests use the official settlement controls and their short test deadline; do not run a network prover for recovery.

## Limits and authority

Deposits are disabled before authenticated Ready activation. After activation, this portal has no pause, refund administrator, sweep, emergency timeout refund or migration function. Existing claims/exits cannot be disabled by an application pause authority because none exists. Forced ETH is uncredited surplus and has no withdrawal entitlement or sweep route.

Lost escrow claim secrets, lost wallet keys and permanent protocol unavailability can make recovery impossible. No administrator can refund collateral while leaving a live L2 posting right. A user who can restore the correct state follows the same screened, debt-paid exit as everyone else.

W02 provides the supported wallet/claim-secret backup and private-cache route. W03 still owns complete transaction-stage recovery, portable transaction provenance, resumable historical discovery and honest unknown-state handling. These gaps must be completed before presenting recovery as a production-ready product.


## Saved Aztec transaction recovery (W03 partial implementation)

The user browser and user CLI now save the exact proven Aztec transaction,
encrypted under the wallet key and full salt, before claim/post/withdraw submission.
The saved record is bound to account, chain, rollup/version, board and portal.
A failed storage write stops submission. The last record remains after confirmation.
This covers user L2 actions. Portal Ethereum deposits/refunds now have their own
intent records (below). Moderator actions also use the journal. Deployment consumers still need integration.

After a browser restart, restore the same wallet in the same browser profile,
select the same portal and use **Recover saved Aztec transaction** in Wallet Setup.
Recovery checks the saved hash and, if it is dropped but still valid, resubmits
identical bytes without making a new proof. It displays confirmed success and
confirmed revert differently. A successful recovery lookup lets the live page
start another action; restarting the page requires reconciliation again.

For the CLI, use the `recover` action with the usual explicit RPC, portal and wallet
arguments. The returned transaction hash can be passed as `--acknowledge-tx <hash>`
when intentionally starting another action. The CLI rechecks that receipt against
the canonical chain before accepting this acknowledgement. Pending, unknown or
reorganized outcomes do not authorize replacement. Invalid/stale dropped proofs
remain blocked pending the later logical-operation recovery work.

Keep `transaction-journal-v1/` alongside the Aztec wallet file. It contains encrypted
records, private directories/files, atomic replacement and fsync/read-back. A `.lock`
left by a crash during a file update must be inspected only after all users of the
wallet are stopped; preserve the record and temporary files before administrative
lock recovery. No automatic stale-lock takeover is implemented.

The browser record lives in IndexedDB `aztec-billboard-transaction-journal-v1`.
Do not clear this browser profile while a transaction outcome is unresolved.
Current password-encrypted recovery exports include authenticated Aztec/Ethereum
journals and saved withdrawal-search progress. Restore refuses to replace a newer
local record. Export again after transaction/recovery changes; an old file does not
contain later requests. All-stage integration remains unfinished. Canonical receipt
checks are current observations, not guarantees against a later chain reorg.


## Saved Ethereum deposit and refund recovery

Before asking the Ethereum signer to send a portal deposit or refund, the client
saves an encrypted intent containing the verified network/portal/depositor,
destination, calldata, ETH value, fixed Ethereum sender nonce, expected portal
receipt nonce/amount and deposit secret commitment where applicable. The claim
secret is committed separately before a deposit intent can be signed.

Use **Check saved Ethereum request** in Wallet Setup, or CLI `recover-eth` with
the same Aztec wallet, Ethereum wallet, portal and explicit RPC arguments.
The check does not send a transaction. It verifies the receipt's canonical block,
actual transaction fields and one matching `Deposited` or `Withdrawn` portal event.
Refund recovery works even after the active portal receipt is zero; zero balance
or Outbox consumption alone never means payment succeeded. A canonical reverted
or replacement transaction is displayed separately from successful payment.

If the hash was lost between signing and persistence, the client searches the
canonical Ethereum history for the original sender/nonce. It saves scan progress
in the encrypted record, uses bounded20-second lookup attempts and checks cursor
anchors for reorgs. Reorgs invalidate skipped history and restart scanning from
genesis. Repeated checks resume after completed pages; missing RPC bodies or gaps
remain unknown. An archival RPC may be needed for old records.

If checking cannot find a completed request, **Retry saved Ethereum request** or
`recover-eth --retry-ethereum` may ask the same Ethereum wallet to sign again.
The retry preserves sender nonce, destination, calldata and value. Ethereum can
execute at most one transaction with that sender nonce on its canonical chain;
the client never guesses a new nonce for an unresolved payment. Wallet rejection
also leaves the intent intact because a free-form wallet error cannot prove that
nothing was broadcast. Replacement gas pricing remains subject to the wallet/node;
an underpriced replacement leaves the outcome unresolved.

A new CLI payment after recovery uses `--acknowledge-ethereum-tx <hash>`.
The live browser remembers the acknowledgement only after recovery returns and
refreshes existing board state. A new session must reconcile again. The receipt
is checked again before replacing the saved intent. Normal recover and explicit
retry are distinct actions; neither erases unresolved records.

Ethereum records share the private `transaction-journal-v1/` directory / browser
IndexedDB adapter with the Aztec record but use separate cryptographic domains
and include the Ethereum depositor. These are local latest-intent records;
portable wallet backups now include both journals. This implementation
also covers the canonical fee-token approval and private FeeJuice bridge deposit.
The disposable Ethereum evidence uses the real portal/bridge contracts and
controlled test roots; it is not evidence of a new Aztec proof or network prover.


## Offline CLI recovery files

Use `node apps/src/billboard/user/recovery-cli.mjs export --wallet /private/wallet.json --file /private/recovery.json`.
The password is read without echo from the terminal (or from standard input for
automation), never a command argument. The output must not already exist.

Restore with `node apps/src/billboard/user/recovery-cli.mjs restore --wallet /private/restored/wallet.json --file /private/recovery.json`.
A missing wallet file is created privately from the decrypted backup. An existing
wallet must match exactly. The command restores collateral secrets and transaction
records alongside that wallet, with commitment/authentication checks before writes.
No node, PXE or Ethereum signer is started. CLI and browser use the same encrypted
recovery-file format. Keep the password separately. Do not clear the old profile or
folder until recovery from the exported file has been checked.

Each record is immutable on restore: identical records are accepted; conflicting
records are preserved and the restore fails. Interrupted multi-record restores can
be rerun. Recovery does not acknowledge successful transactions or authorize a new
payment: reconcile their canonical receipts through the application first.

Older development records without encrypted ownership metadata cannot be silently
included in a complete export. Such an export fails; preserve the original profile
and records, then reconcile them through the original scoped application route.
There is no automatic deletion or migration that discards unresolved transactions.
Backups cannot detect erased storage or recover requests made after the file was
exported. Storage ownership tags group local records without exposing their scope;
this does not protect an unlocked page or a compromised operating system.


## Moderator transaction recovery

The flag, policy-change and authority-transfer routes share the active moderator
wallet and its durable journal. A second wallet cannot silently supply signing
authority. The moderator screen offers **Recover saved moderator transaction**;
normal browser acknowledgement is retained only in the current live page.

The restricted daemon supplies `--reconcile-previous` itself. Before preparing a
new moderator payment, the CLI recovers the saved transaction, validates its current
canonical outcome and compares authenticated operation metadata. An identical
already successful operation returns the original receipt without another proof
or payment. A canonical revert is eligible for another attempt; unknown, pending,
invalid and reorganized results remain blocked. Model output cannot choose recovery
flags or supply acknowledgement hashes. The daemon's durable review queue and
historical policy retrieval remain later work; this does not complete moderation
operations or stale-proof replacement.

All browser wallet screens now use the same collateral-secret store for recovery
files, including when a moderator wallet was previously used as an author.


## Private fee funding recovery

The private-fee screen has separate recovery for its Ethereum request and its
Aztec claim transaction. Ethereum approval and bridge deposit now persist exact
sender nonce, destination, calldata, value and expected events before signing.
A lost response does not permit another deposit: use **Check saved Ethereum fee
request**. **Retry saved Ethereum fee request** deliberately reuses the original
nonce and payload. Canonical approval recovery permits continuing to the deposit;
canonical bridge recovery reconstructs the public funding record, even when the
transaction hash was never saved by the UI. Replaced or reverted requests are
reported distinctly. Select the original funding account or import its public
funding record to identify the sender; read recovery does not require that sender
to sign, while explicit retry does.

Use **Recover saved private fee transaction** after an interrupted Aztec claim.
It reads/replays the saved proven transaction without requesting another Ethereum
signature, importing the bridge claim file or starting a new proof. A revert is
reported as a failed claim. The recovery file exported by the wallet contains these
journal records; its public funding record can be reconstructed through recovery.
Funding remains publicly observable, while the resulting private credit is spent
through the ownerless FPC. No fee-service actor is introduced.
