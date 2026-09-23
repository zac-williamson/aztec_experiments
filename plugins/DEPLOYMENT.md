# Deploying a plugin

Use the built plugin-enabled board and escrow artifacts from the same commit.
The existing pre-plugin board cannot be upgraded by merely registering this
adapter: deploy a compatible board using the application's board deployment flow.
No server or blockchain infrastructure is provisioned by these commands.

Copy `operator-config.example.json` outside the source tree. Verify the network,
board and six-decimal USDC contract against your deployment. The example endpoints
are the existing project's V5/Sepolia configuration, not mainnet defaults.
Create a fresh operator with `node plugins/create-actor.mjs /absolute/private/path/operator.json`. This writes keys only to a new mode-0600 file and prints only its address.
The operator and board owner may be different Aztec accounts. Their private JSON
files have `address`, `secret`, `salt`, `signingKey` and must have mode 0600.
Use `npm run plugin:operator -- fees CONFIG.json STATE.json` to check the selected actor.
The operator pays its own public Aztec transaction fees; fund its public Fee Juice
balance using the network's ordinary fee bridge before starting the service.
Save its private receipt (`claimAmount`, `claimSecret`, `messageLeafIndex`) and run
`npm run plugin:operator -- claim-fees CONFIG.json STATE.json --claim RECEIPT.json`.
This claims the credit and pays that transaction from the same credit, so a fresh
operator does not need an already-funded Aztec fee balance.
The user continues using the application's private fee account for user actions.
Do not include operator keys in a public descriptor or web bundle.

## Deployment

Set `PLUGIN_ACTOR_FILE` to the board owner's private account file and
`PLUGIN_ETHEREUM_PRIVATE_KEY` locally to the deployment wallet. Use the same
private state file throughout. Each command persists an exact transaction before
broadcast. Repeating an interrupted command uses the same signed transaction;
it does not generate another deployment or debit.

```
npm run plugin:operator -- deploy-escrow CONFIG.json STATE.json
npm run plugin:operator -- deploy-portal CONFIG.json STATE.json
npm run plugin:operator -- bind CONFIG.json STATE.json
npm run plugin:operator -- activate CONFIG.json STATE.json
npm run plugin:operator -- config CONFIG.json STATE.json > SERVICE.json
```

Setup sends return after checkpoint inclusion. Public activation/redemption require
a successful finalized Aztec receipt and actual Outbox settlement. If it is not yet available, rerun
`activate` later. No development root injection exists in this command. A dropped
or reverted transaction is not treated as success. Reverted operations require
inspection and a new operation state; never delete pending financial records.

The generated service config points to the operator's private file. Keep it local.
Start `npm run bot:serve -- /absolute/path/SERVICE.json`. Publish the `descriptor`
object from SERVICE.json as a static JSON file on an existing HTTPS site. This
needs no reverse proxy or public inbound access to the operator. Add that HTTPS
origin to the application CSP when it differs from the frontend origin. The local
service binds loopback; `/health` reports active jobs and the latest outcome.
Then register its pinned descriptor with the board:

```
npm run plugin:operator -- register CONFIG.json STATE.json
```

Public configurations cannot select development confirmation rules. Both node
identity and plugin scope are checked before the service starts. Application
proofs are enabled outside the explicitly disposable local network.

## Earnings and provider treasury

Set `PLUGIN_ACTOR_FILE` to the configured operator, keeping the same deployment
state. Use an Ethereum wallet able to pay redemption gas; the recipient is explicit.

```
npm run plugin:operator -- earnings CONFIG.json STATE.json
npm run plugin:operator -- withdraw-earnings CONFIG.json STATE.json --amount 1 --recipient 0xYOUR_ADDRESS
npm run plugin:operator -- redeem-earnings CONFIG.json STATE.json
```

The second command debits only operator earnings; the third waits for the ordinary
Outbox path and returns USDC on Ethereum. It cannot spend user balances. Preserve
STATE.json until redemption completes. It contains signed transactions and must
remain private. It is operational recovery data, not a service billing database.

Venice is paid separately from the operator's Base USDC wallet configured in
`plugins/.env`. `VENICE_AUTO_TOP_UP=true` buys credits within the configured per-top-up
limit. Replenish that wallet from redeemed earnings with the CCTP command below; no
bridge or swap is silently performed by the bot. Operator fees are not charged as
LLM token usage. Monitor Fee Juice, provider credits, and stopped requests.

## User failures

The Plugin balance panel lists the account's requests directly from Aztec, 50
scanned requests per page. It distinguishes replies, cancellation, expiry, known
failure and uncertain provider calls. Cancellation is available only with no
outstanding reservation. Expired reservations can be released by anyone.
No retry of an uncertain paid request occurs. A crashed execution is not resumed.

## Operator earnings to Base

`node plugins/treasury.mjs CONFIG TRANSFER_JOURNAL` moves an explicit batch of
operator-owned native USDC from Ethereum to Base through Circle CCTP v2 forwarding.
This command does not access the escrow, user balances, or request execution.
Redeem operator earnings first; the Ethereum wallet pays source gas. Circle pays
destination gas from the bounded USDC forwarding fee. No additional service runs.

Configuration contains `network` (`testnet` for Sepolia/Base Sepolia, or `mainnet`
for Ethereum/Base), `ethereumUrl`, `baseUrl`, `ethereumWalletFile` (private JSON
containing `privateKey`), `recipient`, `amountUSDC`, and `maxFeeUSDC`. For live Venice,
recipient is the public address of `VENICE_WALLET_PRIVATE_KEY`. Testnet USDC cannot
fund mainnet Venice credits. The two RPC chain IDs are checked before signing.

Use one new journal path per intended transfer. Resume the same path while the
command reports `awaiting-*`; it reuses the exact signed source transactions.
Never delete the journal to retry a transfer. Run one transaction command at a
time per Ethereum wallet. A fresh forwarding quote is bounded by `maxFeeUSDC`
before signing the burn; a signed burn is never changed automatically.

Completion requires the source burn to match the configured route and amount,
the destination nonce/body to match Circle's attested message, exact native-USDC
mint and fee events, and destination finality. Unknown future standard-transfer
fee schedules and ambiguous batched receipts are rejected. The current reference
uses standard transfers; it does not trade assets or choose an alternative bridge.

Protocol references: [Circle forwarding](https://developers.circle.com/cctp/concepts/forwarding-service),
[contract registry](https://developers.circle.com/cctp/references/contract-addresses),
[message encoding](https://github.com/circlefin/evm-cctp-contracts/blob/a92a2b4e7e6ef99bf0b05dca71780f5ec190e729/src/messages/v2/MessageV2.sol).

## Local persistent operator installed for this deployment

The macOS LaunchAgent `local.aztec.bok` runs pinned Node with the private `.env`
file, this checkout's `plugins/main.mjs`, and `.build/public-plugin/service.json`.
Its plist is at `~/Library/LaunchAgents/local.aztec.bok.plist`; it contains paths,
not credentials. It starts at login and restarts after an unexpected exit. Logs
are in the private `.build/public-plugin/service*.log` files. No remote instance
was provisioned. The machine must remain online for the operator to process work.

Check `http://127.0.0.1:8787/health` and `launchctl print gui/$(id -u)/local.aztec.bok`.
Before a planned stop, wait for `active: 0`, then run
`launchctl bootout gui/$(id -u)/local.aztec.bok`. Start again with
`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.aztec.bok.plist`.
Interrupted invocations follow the documented on-chain expiry rules; the service
never repeats an uncertain provider call on restart.

The separate `local.aztec.bok-moderator` LaunchAgent runs the existing censor
service for this board. It uses its own claimed private Fee Juice balance and
persistent moderation queue. The bot's public Fee Juice balance is not a substitute.
The installed local model is Qwen3.5-9B-Q4_K_M, SHA-256
`03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8`,
in the native ARM llama.cpp b11058 image
`ghcr.io/ggml-org/llama.cpp@sha256:3a6c3e3b22dca42ae12dbdfb5cb53531ca1f7ea8fd4348e9ef2503b2bc8629a6`.
It uses four threads, context 4096 and an 8192 MiB container limit. Docker Desktop
must be running. The service does not automatically restart after a runtime error;
inspect `.build/public-plugin/moderator*.log` and the durable queue before restarting.
Health must show successful feed ingestion and no pending error, not merely a live
process. A clean moderation decision is distinct from contract screening.

These are testnet installation records. Preserve the private deployment directory,
wallets and queue; they are not disposable test output. The public browser sequence
is documented in [public/README.md](public/README.md).
