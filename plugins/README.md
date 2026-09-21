# Board plugins

The board knows only a handle, an authorized reply receiver, an immutable descriptor URL and an enabled flag. It does not import the reference adapter or understand Ethereum payments, Venice, GitHub or a particular hosting platform. There are no secret keys in either contract.

## Interfaces

- **Board:** `configure_plugin(handle, receiver, descriptor[8], length, enabled)` is deployer-only. Receiver and descriptor are immutable once registered; disable and register a new handle to change them. `post_with_plugin` uses the existing private deposit/admission path and records the selected receiver. `publish_plugin_reply(parent, message[32], length)` accepts exactly one reply from that receiver. Both publications emit the ordinary post event and use existing censor removal. A removed bot reply does not penalize the human's deposit.
- **Descriptor:** `billboard-plugin/v1` JSON declares the full chain/rollup/board/receiver scope and `ethereum-eth/v1` payment contract and upfront allowance. The board stores `https://host/v1/descriptor#sha256=0x…`, pinning the exact UTF-8 JSON bytes. HTTP is accepted only for chain 31337. Fetching a descriptor cannot supply wallet calldata or executable client code.
- **Ethereum:** `protocolVersion()`, `scope()`, `minimumAmount()`, `payments(postId,messageHash)`, `pay(postId,messageHash)` and `PluginPaid`. The reference contract holds native ETH for its deployer. Wrong hashes occupy separate records; dust below the declared allowance is rejected. Full-price sponsorship is allowed. No bridge, refund or escrow is implied.
- **Worker ports:** payment source (`verify`, `events`, `verifyEvent`); board (`readRequest`, `reply`); dispatch (`claim`); runner (`run`). `worker.mjs` imports only the portable protocol. `main.mjs` is the composition root selecting concrete implementations.
- **Model/tool ports:** model `complete({messages,tools,maxTokens})` returns `{message,cost}`; toolbox `open()` returns tool definitions, `call`, `summary`, `close`. GitHub is one implementation; the board never receives repository tokens or tool output.

Another deployer may implement the same descriptor/payment APIs and receiver contract with an entirely different service. The reference worker is optional. A future protocol version can add different payment or authorization schemes without importing service internals into the board.

## Posting and trust

The composer resolves a registered `@handle`, posts through the normal Aztec admission path, then requests the ETH transfer. An interrupted wallet payment preserves only public intent locally so clicking Post again does not publish twice. Ordinary mentions of unregistered names remain ordinary posts. One paid plugin may be selected per post. The two chain transactions are not atomic: declining payment leaves an ordinary public request with no bot execution. Censoring or disabling the plugin after payment does not automatically refund it.

The service observes confirmed payment plus the matching public request, starts a fresh agent and sends the reply through its registered adapter. The operator is trusted to perform the work and respect the budget. Keys and provider credits belong to the operator. The upfront allowance is experimental: actual provider cost is reported after each call, and any call exceeding its reservation is operator-funded. This is not an onchain guarantee of compute delivery.

There is no conversation database or execution recovery. A small SQLite claim prevents duplicate dispatch on restart; a crash after claiming abandons that invocation. Explicit references to PRs supply context in subsequent requests. Ethereum payer and public post linkage are deliberately visible in this version.

GitHub tools read/write an isolated checkout and can create a new branch and PR in one configured repository. They cannot merge, deploy or run arbitrary shell commands. The current MVP does not execute repository tests on behalf of the model; PR validation must use the repository's CI. Use a repository-scoped GitHub App token in deployment.

## Local configuration

Use Node 24.21.x and the repository's pinned Aztec/Noir/Foundry toolchain. Copy `.env.example` to `.env` in this directory and set `VENICE_WALLET_PRIVATE_KEY` locally. `PLUGIN_REPOSITORY` defaults to the user's fork, `zac-williamson/aztec_experiments`. Set `GITHUB_TOKEN` and `PLUGIN_GITHUB_WRITES=true` to enable PR creation. Never put any key in a descriptor, app config or contract.

The separate development network uses ordinary Ethereum/Inbox/Aztec transactions and the ordinary sequencer, with node `realProofs:false` and PXE `proverEnabled:false`. The proof policy permits this only when the node reports Ethereum chain 31337 and proofs disabled. All public-network defaults remain proving enabled. Local epoch/Outbox settlement uses official SDK test controls and provides no production finality assurance.

The disposable example uses a 0.001 test-ETH allowance; `bootstrapPluginDevnet({allowanceWei})` can choose another allowance. Budget conversion and call limits are operator policy, not additional board protocol fields.

Run `npm run dev:plugins` to create a fresh disposable local network and start the live Venice service, after configuring its dedicated wallet. The service binds the LAN interface; `PLUGIN_PUBLIC_HOST` selects the address pinned in its descriptor. `PLUGIN_PROOFS=true` selects real application proofs without changing contract calls or payment/reply APIs. The same end-to-end scenario passes with this toggle enabled and disabled. Set `CRS_PATH="$PWD/apps/dist/crs"` when using the repository’s downloaded CRS for native proving.

`npm run test:plugins` exercises the portable boundaries. `npm run test:plugins:e2e` uses a deterministic injected model on real local chains, and does not call Venice or create a public PR. The service can run independently with `npm run bot:serve -- /absolute/path/service.json`.

Validation status and remaining work are recorded in `IMPLEMENTATION.md`. Live provider calls require your local key; no public PR has been created during verification.


## Venice crypto-funded inference

No provider API key is used. Set `VENICE_WALLET_PRIVATE_KEY` in `plugins/.env` to a dedicated operator wallet, and fund that address with **USDC on Base** (and ETH on Base for gas if needed). This wallet is separate from the Aztec reply identity. Never use a user wallet. `npm run bot:venice -- address` prints only the public funding address; `status` checks the live credit balance without spending.

`VENICE_AUTO_TOP_UP=true` lets the service purchase the quoted USDC amount when Venice reports no spendable credits. `VENICE_MAX_TOP_UP_USD=5` caps each purchase; it is not a daily cap. The service uses the live x402 quote, accepts only Base USDC, and never retries an uncertain payment or a model request. After an uncertain payment, inspect the Venice wallet balance and transaction history before restarting. One service should exclusively use this wallet.

`npm run bot:venice -- top-up` explicitly purchases credits. `npm run bot:venice -- smoke` makes one real inference request and can automatically top up. These commands and `dev:plugins` use **real provider funds**, even when the board runs on a proof-disabled devnet. Local test ETH cannot buy Venice credits. `test:plugins` and the deterministic `test:plugins:e2e` do not spend real funds.

The selected model is `kimi-k2-5`; change `VENICE_MODEL` to another Venice model supporting function calls. Each call checks the model catalog and calculates an allowance cost from reported input/output tokens at published USD-per-million prices. Cached-input discounts are deliberately not credited to the allowance. This is conservative accounting, not the provider's final billed debit. Missing usage stops the action.

Board payments still use the existing ETH payment contract. Provider spending now uses Base USDC; this change does not add an ETH-to-USDC swap, bridge, or automatic withdrawal of board revenue. For the MVP the operator funds the dedicated Base wallet, after which credit replenishment is automatic. The board, UI, GitHub toolbox, censor and reply APIs have no Venice dependency.

Provider references: [wallet auth and x402](https://docs.venice.ai/guides/integrations/x402-venice-api), [official signer SDK](https://github.com/veniceai/x402-client).


## Per-post model selection

`@bok explain PR 17` uses Kimi K2.5 (`kimi-k2-5`) by default. Operators may change that default with `VENICE_MODEL`.

`@bok --model=DESIREDMODEL explain PR 17` selects an exact Venice model ID for that request, including every tool-call continuation. Put the option immediately after `@bok`; model IDs are case-sensitive. The service checks the current Venice catalog for availability, prices and function-call support. Invalid syntax or an unavailable model produces a normal bot reply through the existing censor path, with no inference purchase. Board posting/plugin fees still apply.

Only the hosted service interprets this option. The original post remains unchanged on the board; the service removes the option from the model prompt. Different posts never change one another's model or the operator's default. The frontend, descriptor, payment contract and board contract have no model-selection logic.
