# Board plugins

Each plugin owns its Aztec escrow and user balances. The board calls only
`on_invocation(account, post_id)` on the registered receiver in its posting
transaction. No separate payment/signature when posting. The authenticated account
comes from the private posting caller; this version intentionally exposes it.
Replies use the existing board/censor API. Provider and repository logic stay in
the hosted service. See [the specification](ESCROW_SPEC.md).

The reference receiver implements `aztec-escrow-usdc/v1`. Fund it by approving and
depositing USDC into its Ethereum portal, then claiming the Inbox message on Aztec.
The user page's Plugin balance panel performs those operations. Withdraw available
funds on Aztec, then claim USDC on Ethereum after network settlement. Separate
plugins have separate deposits. The portal has no administrator sweep function.

The operator claims an invocation once and reserves its available account balance
on Aztec. After that reservation finalizes, all model calls share this budget; each
call is capped by the remaining amount. Measured usage settles atomically with the
reply, and unused funds return to the account. Independent accounts run concurrently;
new deposits can fund overlapping work for an account with an existing reservation. Other invocations and withdrawals cannot spend reserved funds. A
24-hour invocation deadline allows anyone to release abandoned funds; no automatic execution
recovery or paid retries. Operator failure to settle before expiry is operator risk.
A timed-out paid call is marked stopped and retains the entire invocation reservation
until expiry, including any earlier unsettled calls. There is no paid retry. Provider
credit replenishment is serialized; model inference remains concurrent.

Model prices use integer arithmetic and charges round up to one micro-USDC. The
reference adapter uses the model's published context limit as a conservative
input-token ceiling, covering hidden formatting without claiming an exact local
tokenizer. This can require more available balance than the eventual charge.
Reasoning/output is explicitly capped; premium search/scraping and fallback models
are disabled. Unsupported price tiers are refused. Provider failures or billing
beyond the quoted bound cannot increase the user's reserved liability.

Set `VENICE_WALLET_PRIVATE_KEY` only in ignored `plugins/.env`, and fund that wallet
with Base USDC. `VENICE_AUTO_TOP_UP=true` replenishes operator Venice credits;
`VENICE_MAX_TOP_UP_USD` caps each purchase. User escrow and provider treasury remain
separate. The standalone treasury command moves redeemed earnings to Base using
Circle CCTP forwarding; see DEPLOYMENT.md. Default model:
`kimi-k2-5`. A post may use `@bok --model=MODEL_ID`; only the service parses this.
GitHub uses `GITHUB_TOKEN` and `PLUGIN_REPOSITORY`; writes require
`PLUGIN_GITHUB_WRITES=true`. Draft PRs are default; merge/deploy/shell execution are
not tools. Keep deployment credentials scoped to the configured repository.

`npm run bot:serve -- /path/service.json` runs the hosted service. The descriptor
pins the escrow, board, rollup, portal and token. Public deployments require HTTPS
and finalized chain state. The frontend must allow the descriptor origin in CSP.

`npm run dev:plugins:browser` creates a local funded board test identity and serves
the real application. `PLUGIN_PROOFS=true npm run test:plugins:wallet` tests real MetaMask funding,
Aztec claim/post, live Venice/GitHub reply, measured accounting and withdrawal.
The fixture mints local USDC and prepares board collateral/private transaction fees;
it does not pre-fund the plugin account. Venice uses real credits. Test wallet
material stays in ignored `.build`. Explicit MetaMask Terms consent is required;
the per-run `accept-wallet-terms` marker records consent already given by the user.
`PLUGIN_PROOFS=true npm run test:plugins:write` also creates and verifies a real
draft PR. `PLUGIN_PROOFS=true npm run test:plugins:operations` verifies deployment,
fresh operator fee-credit onboarding, and earnings redemption. These commands run
under the maintained test supervisor and require successful cleanup. Set
`PLUGIN_PROOFS=false` explicitly for faster local iteration; public networks keep
proving enabled. Run expensive qualification scenarios one at a time.
`PLUGIN_PROOFS=true node --env-file=plugins/.env plugins/devnet/qualify.mjs interruption`
exercises a real funded request with an explicitly interrupted runner, service restart,
no replay, expiry and release through the normal UI. It makes no paid inference;
the separate read/write scenarios qualify actual Venice billing.

See [deployment and operator commands](DEPLOYMENT.md) for independent plugin setup.

Use pinned Node 24.21.x and toolchains. Historical fixed-fee evidence under
`evidence/` does not qualify the replacement; current status is in IMPLEMENTATION.md.
