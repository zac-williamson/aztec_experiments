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

Activation requires actual Outbox settlement; if it is not yet available, rerun
`activate` later. No development root injection exists in this command. A dropped
or reverted transaction is not treated as success. Reverted operations require
inspection and a new operation state; never delete pending financial records.

The generated service config points to the operator's private file. Keep it local.
Start `npm run bot:serve -- /absolute/path/SERVICE.json`. Publish its descriptor
behind an existing HTTPS reverse proxy, and add that exact HTTPS origin to the
application hosting CSP using the ordinary hosting configuration generator.
The service binds loopback by default; only descriptor and health routes are public.
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
limit. Replenish that wallet from earned revenue through your usual bridge; no
bridge or swap is silently performed by the bot. Operator fees are not charged as
LLM token usage. Monitor Fee Juice, provider credits, and stopped requests.

## User failures

The Plugin balance panel lists the account's requests directly from Aztec, 50
scanned requests per page. It distinguishes replies, cancellation, expiry, known
failure and uncertain provider calls. Cancellation is available only with no
outstanding reservation. Expired reservations can be released by anyone.
No retry of an uncertain paid request occurs. A crashed execution is not resumed.
