# Board plugins

The board knows only a handle, an authorized reply receiver, an immutable descriptor URL and an enabled flag. It does not import the reference adapter or understand Ethereum payments, OpenRouter, GitHub or a particular hosting platform. There are no secret keys in either contract.

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

Use Node 24.21.x and the repository's pinned Aztec/Noir/Foundry toolchain. Copy `.env.example` to `.env` in this directory and set `OPENROUTER_API_KEY` locally. `PLUGIN_REPOSITORY` defaults to the user's fork, `zac-williamson/aztec_experiments`. Set `GITHUB_TOKEN` and `PLUGIN_GITHUB_WRITES=true` to enable PR creation. Never put any key in a descriptor, app config or contract.

The separate development network uses ordinary Ethereum/Inbox/Aztec transactions and the ordinary sequencer, with node `realProofs:false` and PXE `proverEnabled:false`. The proof policy permits this only when the node reports Ethereum chain 31337 and proofs disabled. All public-network defaults remain proving enabled. Local epoch/Outbox settlement uses official SDK test controls and provides no production finality assurance.

The disposable example uses a 0.001 test-ETH allowance; `bootstrapPluginDevnet({allowanceWei})` can choose another allowance. Budget conversion and call limits are operator policy, not additional board protocol fields.

Run `npm run dev:plugins` to create a fresh disposable local network and start the live OpenRouter service, after configuring its key. The service binds the LAN interface; `PLUGIN_PUBLIC_HOST` selects the address pinned in its descriptor. `PLUGIN_PROOFS=true` selects real application proofs without changing contract calls or payment/reply APIs. The same end-to-end scenario passes with this toggle enabled and disabled. Set `CRS_PATH="$PWD/apps/dist/crs"` when using the repository’s downloaded CRS for native proving.

`npm run test:plugins` exercises the portable boundaries. `npm run test:plugins:e2e` uses a deterministic injected model on real local chains, and does not call OpenRouter or create a public PR. The service can run independently with `npm run bot:serve -- /absolute/path/service.json`.

Validation status and remaining work are recorded in `IMPLEMENTATION.md`. Live provider calls require your local key; no public PR has been created during verification.
