> For current Rolling / PrivateBok installation use the
> [Rolling operator runbook](../docs/rolling-deployment.md) and the current section below.
> The [V6 testnet handover](../deploy/V6-TESTNET.md) and legacy sections are historical
> deployment evidence, not current Rolling defaults. Preserve each older deployment
> and its recovery configuration while it still holds liabilities.

# Deploying a plugin

## Current Rolling / PrivateBok operator

Select `applicationProfile: "rolling"` in the private operator config. The example
requires verified current network, board and token identities. Development is
restricted to chain31337 with native proofs disabled; testnet uses Sepolia and
real proofs. Keep the existing constructor state file, its salt and signed records.
The optional `lifecycle: {tokenAddress, pluginId}` is separately bound; adding it
does not change the original constructor campaign identity. Changing either
lifecycle value after any lifecycle intent is refused.

Use the same public deployment actor throughout. It must own PrivateBok and be
the current Rolling moderator for registration. The configured public Bok service
operator may be another Aztec account; it is never the private human caller.
Fund the deployment actor's public Fee Juice and the L1 signer's gas balance.
No deposit or provider treasury payment is performed by these commands.
`PLUGIN_QUERY_API_KEY` and `PLUGIN_ETHEREUM_PRIVATE_KEY` are runtime-only local
capabilities, absent from config identity and public results.

Run these existing operator commands in order with the same CONFIG and STATE:

```
npm run plugin:operator -- deploy-escrow CONFIG STATE
npm run plugin:operator -- deploy-portal CONFIG STATE
npm run plugin:operator -- bind CONFIG STATE
npm run plugin:operator -- activate CONFIG STATE
npm run plugin:operator -- register CONFIG STATE
npm run plugin:operator -- status CONFIG STATE
```

`deploy-portal` uses the normal build's exact PluginPortal creation bytecode and
constructor (rollup, PrivateBok, version, token). It verifies complete runtime and
all public immutables at canonical L1 blocks. `bind` uses PrivateBok `set_portal`
and verifies its exact Ready message. `activate` waits for the real membership
witness; production never injects settlement. `register` uses Rolling's three
arguments `configure_plugin(pluginId, adapter, true)` and verifies canonical map
storage. No legacy descriptor ABI is used.

Each command persists intent before signing/proving and exact signed bytes before
its single broadcast. Retained preparing, dropped, lost-response and unknown
records only reconcile; even the same signed bytes are never retransmitted.
An unresolved result is not permission to delete state or make another campaign.
A pending command can be invoked later to observe the original transaction.
Production requires finalized successful L2 receipts/effects and finalized L1
inclusion; disposable development may observe checkpointed L2 / canonical latest
L1. Reorgs, mismatched effects and unavailable reads remain unresolved. L1 HTTP
redirects/throttling cannot trigger hidden transaction retries.

The `status` result distinguishes canonical portal activation and current plugin
registration. `hostedServiceReady` stays false: provider funding, hosted service,
request accounting, reply delivery and complete board/application readiness are
separate checks. Earnings withdrawal commands remain legacy-only in this slice.
Back up the private0600 journal in its private0700 directory; never publish its
signed records. No runtime credentials are copied to artifacts or generated code.

## Current private user accounting and exits

Use the application's **Balances and withdrawals** view and the
[RC22 operator procedure](../docs/rolling-deployment.md#private-balances-and-withdrawals-rc22).
Public operator earnings are a separate asset; the legacy `withdraw-earnings`
command below is not the private user's Bok withdrawal command.

The public accounting endpoint accepts only `limit` and its opaque `cursor`.
It publishes complete canonical request snapshots for one checkpoint/revision;
wallets consume every page and intersect private `owned_requests` IDs locally.
Never add an account, owned-ID list or personalized subscription to this route.
A full eight-ID private ownership page is not exhaustion. The matching deployed
PrivateBok class must contain the ownership utility; preserving cancelled ownership
in a new class does not reconstruct notes already removed by an older class.
Keep old adapter/token/portal bindings and exit records available during rotation.

Free private Bok credit excludes amounts allocated to requests. Reserved work must
resolve before release; charged and refunded are historical accounting fields.
Refunded credit is already returned to the free balance and must not be added
again. The wallet can review release of an unreserved waiting/active request,
then withdraw free credit using the existing private `withdraw(amount, recipient,
nonce)` and settled PluginPortal message. Private transaction fees and Ethereum
refund gas are separate confirmations. Operator registration, HTTP health or a
public snapshot alone proves none of these user outcomes.

## Historical legacy operator

The following commands and descriptors document the older board profile. They
are not a current Rolling deployment recipe.

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
needs no reverse proxy or public inbound access to the operator. When the descriptor
is hosted on a different origin from the board page, serve that public JSON with
`Access-Control-Allow-Origin: *` (no credentials). CSP permission alone does not
permit cross-origin fetching. Verify the fetch in a browser before registering. Add that HTTPS
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

## Generated static execution (G11)

`createIsolatedExecution` in `isolated-execution.mjs` is a **trusted host
capability**, not an arbitrary shell tool. Construct it with real, owned
`workspaceRoot` and `outputRoot` directories. Call
`execute({sourceDirectory, revision})` while the repository's invocation lease is
held. Call read-only `assertAvailable()` during hosted startup before accepting
paid execution work: it checks the reachable Docker daemon's exact cached image
identity/platform without creating a container. It reports the pinned expected
Node v24.21.0; each execution verifies that version before generated commands.
`revision` is the exact 40-character source commit; the caller must bind it
to that materialized directory before accepting its compare-and-swap update.
The executor additionally captures a SHA-256 manifest of actual bytes and checks
that the public source has not changed before returning success.

The capability uses the already-installed Docker runtime and exact cached public
image `sha256:44479404b67dde931cf8f202a3ce34703876e709ce124924251da8435d5d8651`.
It never pulls images, installs dependencies, or passes host Docker/configuration
access to generated code. Source comes from a public invocation tree, not the
operator's checkout or home. Root `.git` metadata is omitted without being read;
ordinary dotfiles such as `.gitignore` remain part of the byte manifest. Links,
`.github`, credential configuration, environment files, and `node_modules` are
rejected. Credential-free, pinned dependencies may be designed separately later;
there is no host install fallback.

Both `node --test` and `node --run build` must succeed; captured test files are
passed explicitly, and the test runner must report a positive test count with
zero failures, cancellations, skips or todos. A real Node test file and
a package build script are required. The build must produce `dist/`. Generated
code runs as UID/GID 1000 with zero permitted/effective/ambient capabilities,
no new privileges, no
network or published ports, no host mounts, a read-only image, and private PID,
IPC and cgroup namespaces. Writable storage is bounded tmpfs: 64 MiB work,
16 MiB temporary files, and 1 MiB shared memory. Limits are one CPU, 256 MiB RAM
and equal memory/swap bound, 64 processes, 256 file descriptors, 8 MiB per written
file, 64 KiB combined program output, and at most 45 seconds for both commands.
The trusted PID1 driver uses UID0/GID1000 with only SETUID, SETGID and KILL
capabilities, to launch the unprivileged child and drain it. Its inspector signal
is disabled; the child cannot signal or access driver process files. Shared-group
private tmpfs avoids adding filesystem override or ownership capabilities.
The host reserves cleanup time within a 60-second envelope. Trusted callers may
reduce the work deadline; they cannot increase it or supply commands, environment,
mounts, images or network settings.

The host records an exclusive intent before create, verifies container settings
before start, and removes only the exact owned container ID. An ambiguous create
is reconciled by its fresh name and ownership label, never repeated. A failed
cleanup rejects the call and poisons that capability until operator reconciliation.
An uncertain cleanup-record write also poisons it. Startup and each new execution
reject retained output directories without positive cleanup records, preventing
a restart from silently bypassing the unresolved state. Records remain private. Never turn that into an automatic retry. A hard host crash requires
operator reconciliation of that retained name; this is not a remote service or
an independent cloud shutdown mechanism.

Successful output includes `passed`, exact `revision`, `sourceDigest`, captured
source manifest, actual container Node version, test/build outcomes, artifact
manifest, and digests of `source-snapshot.json` and `artifacts.json`. These JSON
archives contain exact base64 bytes, not executable extraction instructions.
Regular bounded artifacts are also written under the new private `dist/` output
folder after path, size, duplicate and link checks; the captured public source is
written under `source/`. Returned logs are bounded **untrusted generated text**.
Do not interpret their contents as operator instructions or independent test
attestation. Source and generated tests can intentionally be wrong even when the
commands exit successfully.

This capability does not publish, deploy a server, access a wallet, prove a
transaction, merge a PR, or activate cloud infrastructure. Generated HTML/JS is
untrusted active browser content and must later use a separate origin with no
board/operator credentials. That publication gate is independent of static
build success.

On failure, `error.code` is a fixed `STATIC_FAILED`, `STATIC_CLEANUP_REQUIRED`,
or `STATIC_RECORD_FAILED` category. `error.result` provides `passed:false`, the
validated revision, optional captured `sourceDigest`, finite phase/outcome, and
a bounded `log` for the model's repair loop. Logs are untrusted generated output;
no raw host exception, path, Docker diagnostic or host environment is included.
Startup or pre-execution unavailability throws `STATIC_UNAVAILABLE`. The guest
work deadline is bound to the host start timestamp, including runtime startup;
VM clock drift or exhausted startup time fails closed within the same host cap. A successful checked
Git tree may be reused by the repository owner only after validating its exact
parent/tree/revision binding; plain chat requires no build or checkout.

## Local static publication

`createStaticPublication({directory, artifactRoot, origin, boardOrigin,
development})` provides the local post-acceptance publisher and `handle(req,res)`.
Both directories must be canonical private owned directories. `artifactRoot` is
the isolated executor's output root; `directory` is a separate publication store.
Use a dedicated credential-free HTTP origin, distinct from the board origin;
production configuration requires HTTPS. TLS, routing and actual public service
activation remain separate operator work. The handler does not trust forwarded
host headers and has no publication/moderation HTTP endpoints.

The root repository manager calls `publish({repositoryId, threadId, invocationId,
readRevision, acceptedRevision, validation})` **after** durable accepted-ref CAS.
`validation` is the exact successful isolated-execution receipt. Publication
verifies its source/artifact archives, byte manifests, revision and positive
container cleanup. It copies only those bounded public bytes into an immutable
private revision directory, syncs them, then uses the existing durable `fileState`
primitive to advance the catalog. A new revision must name the prior published
revision; an exact retry is idempotent and cannot move latest backward. The
manager retains its pending local-publication intent; recovery never reruns the
paid model or generated build.

The returned `latestUrl` is stable for the thread. `artifactUrl` and `sourceUrl`
identify the exact accepted revision. Only the **current latest revision** is
public: after advancement the old artifact and source URLs return 404, while
internal history remains for reconciliation and backup. `sourceUrl` downloads
an exact JSON/base64 source snapshot with its revision and file manifest. It is
not a Git credential, repository administration endpoint or executable archive.
Neither private publication metadata nor executor logs are served.

The handler accepts GET/HEAD only, rejects credentials/cookies, ambiguous paths,
unknown assets and wrong Host, rechecks the catalog after filesystem reads, and
serves no-cache responses with exact content types and nosniff. CSP runs generated
HTML/JS in a sandbox without same-origin storage, workers, plugins, forms or
operator credentials. Public HTTPS API access is allowed; generated content
remains untrusted. `setDisabled({repositoryId,threadId,disabled})` is a trusted
host-only moderation capability; it hides both current artifacts and source,
persists across restarts and revision changes, and also fences in-flight reads.

Default retention bounds are 128 threads, 20 revisions per thread, 256 MiB of
source/archive/artifact content, 8,192 stored content files and an 8 MiB catalog.
Eight simultaneous HTTP reads are admitted. Metadata and filesystem allocation
add overhead within the bounded entry counts; there is no promise that logical
content bytes equal disk allocation. Capacity exhaustion rejects the update and
preserves latest. No automatic history deletion, quota increase or paid storage
provisioning occurs.

Back up the stopped publisher's whole private store together with the repository
manager's accepted-ref and pending-publication journals. Verify archive and
manifest hashes and match catalog latest to accepted state before restoring
service. Do not reconstruct latest from filenames or restore just a pointer.
An incomplete staging directory, corrupt catalog, or uncertain persistence stops
publication until explicit operator reconciliation. Preserve the original files
and inspect the corresponding accepted receipt before removing incomplete owned
staging or applying any retention cleanup. Retained immutable revision directories
from a completed rename can be verified and reused by the exact pending receipt.
Do not prune history or alter recorded quotas while the publisher is running.

Publication recovery blocks unrelated writes while a renamed immutable revision is
absent from the catalog. Only its exact accepted receipt may reconcile it; multiple
unaccounted revisions require operator reconciliation. They are never treated as
free retention capacity.

Browser isolation provides no board/operator credentials and denies document
cookies/storage. It does not force generated cross-origin fetches to omit ambient
cookies belonging to third-party HTTPS sites. The public API browser check uses
explicit `credentials: omit` in an empty context; it is not a credentialless-browser
guarantee. Never provision credentials on the artifact origin.

Container absence uses exact `container inspect` of the fresh invocation name or
owned immutable ID. The pinned Docker28 daemon's exact no-such-container response
is required; collision, timeout, changed spelling or unknown daemon error fails
closed. Global `docker ps` inventory is not needed: a measured local inventory
stall returned no bytes for5seconds while the same exact-name inspect completed
in142ms. Execution/resource/cleanup deadlines remain unchanged. Raw Docker
stderr stays internal and is never part of model-visible failure logs.

### Scoped personal-account GitHub App source mirror

For the configured personal installation, set `creationTemplate` explicitly to
`{repositoryId:1419258557, fullName:"zac-williamson/rolling-chat-bok-bootstrap",
commit:"b3e8ef46bb26002a02c949438f5d43d05422e9ff"}`. This selects only
`POST /repos/{template_owner}/{template_repo}/generate`; it never falls back to
`POST /user/repos`. Before generation, the broker verifies the exact numeric
repository and User owner, private/nonfork/nonarchived template status, disabled
Actions, pinned default-branch commit, and a single regular README.md (at most
4096 bytes) with a verified Git tree hash. Generation copies only the default
branch into a private repository. No generated code runs during bootstrap.

Template validation uses a token selecting only the template ID. Generation uses
Administration write plus Contents read over the selected installation, without
`repository_ids` that could exclude the repository being created. Before issuing
the generation request, the broker enumerates every selected repository (at most
129 over two pages) and rejects anything except the pinned private template and
private mirrors already owned by its durable journal. It rejects `all` selection,
unknown IDs, changed owners/markers, duplicates and incomplete pagination. This
is not an all-repositories installation or a permission expansion. After creation,
a separate Administration-only token selects the new mirror ID
for identity and Actions checks; source writes use its Contents-only token.
An uncertain generation response may mint the existing selected-installation
Administration-only token solely to read back the exact intended name and marker,
then either reconcile or remain blocked. It never repeats generation.
The 14 October live template attempt returned422 after creating the exact private
repository metadata, but left it empty and outside the selected installation.
Operator selection, disabling Actions, and one pinned README initialization were
required before the original journal could reconcile. This is assisted recovery,
not automatic-creation acceptance. Never treat a failed HTTP response as proof
that no resource was created. Verify with the trusted owner when an App-scoped404
could conceal it.

GitHub's commit API may omit the terminal newline in its displayed message.
The broker permits only that single LF difference while still requiring the
exact locally computed Git object SHA, tree and parent. An uncertain commit is
read back by that same expected SHA, never reposted.

Template configuration is journal-bound. Transition from a definitively denied
legacy creation requires explicit operator reconciliation and a new journal
directory; preserve the failed journal. Do not reset or change its intent.


`createGitHubAppBroker({enabled:false, directory, artifactRoot, owner, ownerId,
appId, installationId, privateKeyFile})` is a trusted host capability. The
personal-account adapter targets `zac-williamson` (User1476668) through
`POST /user/repos`. GitHub writes stay disabled until its selected-repository App
installation is explicitly configured and verified. Do not grant unrelated
repositories or organizations; the existing application repository is not a
per-thread mirror. No organization creation, broad installation, PAT, ambient
`gh` credential or generated-code GitHub authority is required.

Use repository Administration write, Contents write and implicit Metadata read;
no Actions, Workflows, organization, user OAuth permissions or event subscription.
Select only the intended per-thread private repositories. GitHub automatically
adds App-created repositories to that App's selected installation. Never fall back
to all repositories or select an unrelated repository as a setup seed.
The broker disables Actions on each dedicated mirror through a durable settings
intent and verifies the disabled state before any source publication. A lost
response is reconciled by readback without replay; later re-enabling blocks
publication. Connected repositories retain their existing settings. Source
capture additionally rejects `.github` paths.
The concrete installation and actual personal-account creation permission are
external setup gates, not facts established by controlled tests.
A live 14 October 2026 check verified App5317701 / installation171412624 on
User1476668 with selected repository access, then received HTTP403 from
`POST /user/repos` using its Administration-only installation token. The owner
credential independently returned404 for the intended mirror. This does not
qualify creation or mirroring, and availability alone is not that evidence.
The original durable creation intent remains incomplete; do not delete it or
repeat the creation request. Diagnose the platform response before an operator
chooses a recovery action. Current GitHub documentation lists Administration
write or Repository creation write as alternatives; no permission expansion is
inferred from a403.

`getGitHubBrokerDiagnostic(error)` returns a detached, closed projection for an
actual HTTP rejection: numeric status, a validated GitHub request ID, recognized
permission tokens, and numeric Retry-After when present. The broker cancels the
upstream error body without retaining it. Failed mutation intents store the same
projection before returning the generic error. This is diagnostic evidence only:
403, Retry-After, and missing responses never enable automatic write replay.
The token used for creation requests Administration write. This permission is
broader than repository creation; it is not a create-only capability. It stays in
the trusted broker. Subsequent content access requests Contents only and the
single checked repository ID. No PAT or
ambient `gh` login is used. The App RSA key is a no-follow regular private0600
file in a canonical0700 host directory, outside source/artifact trees; its bytes
and short-lived JWT/installation tokens remain in trusted host memory.

The host config pins the numeric owner, App and installation IDs plus the
exact lowercase personal owner login. `assertAvailable()` only reads installation
identity, suspension, permission and selected-repository mode; it does not
enumerate every selected repository or prove the operator selected only Bok
repositories. That selection remains an explicit operator setup responsibility.
The check does not mint an installation token or create a repository. Before paid work the host must
check availability. Live setup and API behavior are still separate acceptance
checks; controlled protocol tests do not qualify an installed GitHub service.

After durable local accepted-ref CAS, call `sync` with the same trusted accepted
receipt used by publication. It validates the successful test/build receipt,
positive container cleanup and exact public source snapshot. A deterministic
`bok-<64hex>` repository name is bound to repository/thread IDs. Creation has a
durable random ownership marker; existing names without that intent are never
adopted. GitHub requires a nonempty repository before ref operations, so the
initial repository uses `auto_init:true`. The subsequent full Git tree has no
base tree and contains only the captured regular files, including binary bytes;
the bootstrap README is not inherited into accepted source.

`acceptedRevision` remains the local source authority. `remoteCommit`,
`remoteTree`, `remoteParent`, `sourceDigest` and `remoteRepositoryId` record its
explicit remote mapping; the SHA identities are intentionally distinct. The
remote commit message binds original revision, digest, repository, thread and
invocation. It has the captured previous remote commit as parent. The host
rechecks the predecessor then performs only a non-forced ref update: concurrent
incompatible head changes fail, never force-overwrite. The dedicated repository
must have a sole mirror writer; this is not a general multi-writer Git merge
service. Results include an operator-only private GitHub URL (`operatorUrl`), never a token.
Do not append it as a reader-facing source link. Private GitHub history stays
internal; the publication service alone exposes the current public source and app.

Every repository/blob/tree/commit/ref mutation gets a durable intent before its
single network call. Lost responses reconcile by exact ownership marker or
precomputed Git object identity and read back the final ref. An absent/unknown
result stays `GITHUB_BROKER_UNRESOLVED`; rerunning does not retransmit that write.
Read-only reconciliation can later finish the original sequence. Do not delete
or hand-edit the journal to force retries. A persistence failure poisons the
capability until restart and original-intent reconciliation. Back up this private
journal together with the local accepted Git repository and source snapshots.

One owner operates the broker; calls are serialized. Per call bounds:120seconds,
540 requests,8seconds each,2MiB response; no redirects/retries/provider fallback.
Source limits remain512 regular files,1MiB/file,8MiB total. State is capped at
128 repositories,64 accepted revisions each,8MiB serialized journal. Bounds fail
closed; no automatic quota increase, cleanup or paid capacity. API errors are
fixed sanitized codes with no upstream body, private pathname or credential.

Official setup references: [App manifest registration](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
[App JWT authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[installation token scoping](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
[personal repository creation](https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user),
[Git trees](https://docs.github.com/en/rest/git/trees#create-a-tree),
[Git commits](https://docs.github.com/en/rest/git/commits#create-a-commit), and
[reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference).
The implementation pins API version2026-03-10. No registration or GitHub mutation
is performed by the installation preparation packet.

### Rolling hosted configuration and launch

`rolling-hosted-config.example.json` is a **preparation-only** shape for
`runRollingHostedService`. Its placeholders deliberately fail validation; copying
it does not deploy or activate anything. It uses the private Rolling descriptor,
not the legacy `SERVICE.json` account-linked escrow. Replace every placeholder
from independently verified public deployment receipts and operator inputs.
`deployment.blockNumber`, owner/App/installation IDs must be JSON integers;
chain and rollup versions remain decimal strings. `pluginId` is the registered
nonzero32-byte field; descriptor receiver is the PrivateBok address. Board and
artifact origins must be different HTTPS origins. The state directory is an
absolute canonical private0700 directory owned by this service. `operatorFile`
is a separate private JSON file with `secret`, `salt` and `signingKey` (canonical
32-byte hex), optionally public `address`; it never belongs in the public config.

The reference `repository` authorizes read-only PR lookup for that repository;
new thread projects start empty and their accepted local Git state is separate.
The GitHub App mirrors accepted source to private per-thread repositories in the
configured personal `zac-williamson` account. Private `operatorUrl` values are retained in
broker state and never substituted for public latest-source links. Production
startup requires `githubApp.enabled: true` and a valid, available installation.
Leaving it disabled is supported only for disposable development; the example
intentionally cannot start a production service unchanged.

Provide `VENICE_WALLET_PRIVATE_KEY` and production `PLUGIN_QUERY_API_KEY` through
the trusted service environment, plus `VENICE_MODEL` if overriding the provider
model. `summaryModelId` (or `VENICE_SUMMARY_MODEL`) must select a cheaper model;
the metered provider verifies actual prices. History summaries retain their
1,200-token cap and explicitly disable reasoning through Venice's
`reasoning: {enabled: false}` request flag. Admission requires the live catalog
to declare a nonreasoning model, or a reasoning model supporting `none` effort;
unknown/always-reasoning capabilities fail before reservation. The primary model
keeps its configured output cap and reasoning behavior. Truncated summaries stay
incomplete after genuine usage is settled; they never retry or start primary
work. See [Venice reasoning controls](https://docs.venice.ai/guides/features/reasoning-models).
Prefund provider credits separately:
Rolling rejects `VENICE_AUTO_TOP_UP=true`. `GITHUB_TOKEN` is optional for authorized
reference-repository reads and is not the mirror credential. No secret belongs
in a model prompt, source snapshot or generated subprocess environment.

After actual deployment/registration and all prerequisite checks, use pinned Node
from the trusted service supervisor with those private environment values:

```
node plugins/main.mjs /absolute/private/path/rolling-hosted.json
```

The service acquires a no-stale-takeover lock, validates the network, loads the
operator wallet, verifies isolated execution and App availability, then starts
its two loopback listeners. The artifact reverse proxy must preserve its configured
Host and security headers and never attach authentication/cookies. Public health
is operational status, not qualification. Shutdown drains requests before closing
artifact listeners, wallet, index and lease. On failure reconcile lock/process
ownership and journals before restart; never erase them to obtain a clean start.

For development only, use chain31337 with `development: true`, native node
`realProofs: false`, native PXE `proverEnabled: false`, loopback endpoints and
separate loopback artifact/board origins. No application cryptographic code is
changed. A complete independently operated service, real model billing and real
proof testnet campaign remain acceptance work.

### Original provider billing recovery (local operator only)

A lost provider response is not a zero-cost call. Stop the hosted service and
verify that its requests, wallet and original lease have closed before using:

```
node plugins/main.mjs --reconcile-billing /absolute/private/rolling-hosted.json /absolute/private/original-billing.json
```

Use the same deployment config, operator, state directory and request journal.
The command refuses an existing lease; it never steals a lock or starts a second
owner. It opens only the normal node/operator wallet and canonical escrow port.
It needs operator transaction fees and the production query capability where
applicable, but no provider credential, GitHub access, Docker runtime or public
listener. Development remains native proof-disabled; testnet retains real proofs.

The receipt file is a private JSON object with exactly `schemaVersion: 1`,
`binding`, `callId`, `inputDigest`, `billing`, `evidenceFile` and `evidenceSha256`.
Copy the original six-field `hostedPrivateBok.binding` from that private journal
(`network`, `escrow`, `requestId`, `target`, `postId`, `pluginId`), its integer call
ID and original input digest. Obtain the billing facts for that original provider
call: `providerId`, `modelId`, `promptTokens`, `completionTokens`, `cachedTokens`,
`inputPrice`, `outputPrice`, `cachePrice`, `charge`, and the normalized `receipt`
when recorded. The prices and charge use the existing decimal-string units;
token counts are integers. The command checks these facts against the original
frozen quote, cost arithmetic, reservation and receipt digest. It rejects a
changed saved receipt or evidence digest on continuation.

`evidenceFile` is an absolute path to the original independently obtained provider
record, with its exact SHA-256 in `evidenceSha256`. Both files must be owned by
the operator, regular, non-symlink, single-link files with mode0600. Receipt JSON
is bounded to64KiB; the evidence file to1MiB. Keep this evidence private. These
checks authenticate local file continuity and arithmetic, **not independent
provider attestation**. The trusted operator remains responsible for obtaining
the genuine original record; do not invent usage or substitute zero for an
unknown charge. Without that record, retain the reservation as unresolved.

The original billing/evidence is saved before reconciliation. Repeating this
command inspects the original chain operation and never repeats a provider call
or an already journaled chain mutation. Pending, unavailable, mismatched or
reorged receipts remain unresolved. Reconciliation charges only validated usage
and returns the unused reservation through the existing contract; outstanding
liabilities cannot be treated as free credit. The successful result is explicitly
`accounted-without-reply`: no answer is synthesized and no new paid call, bot post,
Git revision or publication is created. Normal service discovery does not turn
this terminal accounting record into another agent run. Preserve the private
receipt, request journal and operator config across restart. Local component
checks do not qualify actual provider billing or testnet settlement.

### Connecting an existing repository to a thread

`connectedRepositories` is an optional array in the trusted hosted configuration;
its default is empty. A board message, model tool or generated program cannot add
or edit it. Stop the normal service before configuring a mapping. Select only the
intended repository in the personal GitHub App installation and authorize this
thread's participants to work on its source through the configured model provider.
Do not use the reference-repository setting or `GITHUB_TOKEN` as a substitute.

Each entry has exactly these fields (replace all example identifiers):

```json
{
  "threadId": "0x<CANONICAL_THREAD_ID_64_HEX>",
  "repositoryId": 123,
  "ownerId": 1476668,
  "fullName": "zac-williamson/explicitly-authorized-project",
  "baseBranch": "main",
  "baseCommit": "<EXACT_40_HEX_BASE_COMMIT>",
  "workBranch": "bok/explicitly-authorized-thread"
}
```

The base and work branches must differ. The work branch must start with `bok/`
and be absent before its first use; the broker never adopts a pre-existing branch
or PR. Repository IDs and work branches cannot be shared by conflicting thread
mappings. The same thread resumes its accepted local source across participants;
unmapped threads keep the existing empty-workspace behavior. A changed mapping,
base branch head, remotely changed work branch, closed/merged or ready-for-review PR, or ambiguous
mutation requires operator reconciliation. Do not delete journals to resolve it.

For this optional feature add repository Pull requests write to the existing App
permissions. The trusted broker requests **only Contents write and Pull requests
write for the one numeric repository ID** when reading or updating a connected
repository. Administration is used only by the separate new-mirror capability,
never by connected repository operations. No workflow permission, merge endpoint,
base-ref update, protection/rules change, ambient token or credentialed clone is
used. Existing branch protections, approval policies and CI configuration remain
in place. The operator must review the repository's existing CI and secret access
policies before allowing untrusted thread contributions; this feature does not
change those policies. Draft PRs require the repository's normal review/merge flow. Marking a PR ready for
review stops further automated branch updates; open/draft status, both repository
IDs, base/work refs and the expected parent are checked before remote mutations
and again after publication.

The original base tree is verified by its Git hash. The local generated workspace
contains only bounded regular source files; `.github`, secret/control paths,
symlinks and submodules are excluded. These entries remain unchanged in the remote
base tree. Each update patches only the supported files; deletions apply only to
previously included source. Existing executable modes are preserved remotely.
Supported source is at most 512 files, 100,000 bytes per original file, 8 MiB in
total and 2,048 original tree entries, with the existing isolated build/test
requirements. Oversize or unsupported source fails closed rather than silently
truncating the project. The isolated runtime still has no dependency installation
or network; repositories requiring them need a separately approved execution
capability and are not qualified by this feature.

Connected source snapshots and generated artifacts remain in private host storage;
they are never sent to the public static publisher or new-mirror path. Because a
model response could quote private source, the board receives only a fixed host
message and the checked PR link (or a fixed no-PR message), not model-authored text.
A GitHub link does not grant repository access. Ordinary empty-thread applications
retain their public static/source publication behavior.

Every external write is journaled before dispatch. On lost acknowledgement the
broker reads the original exact object/ref/PR and never retransmits an unresolved
mutation. It does not repeat provider work to recover publication. Successful
controlled protocol and local Git tests are source/component evidence only: actual
personal App installation, existing-repository permission checks, live PR behavior
and representative model-generated project acceptance remain separate gates.

### Explicit Sepolia seed cancellation successor

A missing transaction/receipt is an unresolved outcome, not permission to replay
signed bytes or repeat a completed seed stage. Preserve the original plan, seed
journal, first cancellation resolution and cancellation journal. First reconcile
all known hashes and the current canonical sender nonce. If a known transaction
has finalized successfully, use the remaining-only continuation; its allowance
checks distinguish an original approval from a self-cancellation.

When the trusted lead explicitly chooses one fresh same-nonce cancellation, the
existing operator supports `successor-seed-testnet-cancellation`. It accepts a
separate private mode 0600 successor JSON with exactly these fields:

- `schemaVersion`: `1`.
- `originalPlanSha256` and `originalTransactionHash`: the unchanged first
  cancellation resolution's bindings.
- `cancellationTransactionHash`: the retained first cancellation's signed hash.
- `cancellationIdentitySha256`: SHA256 of that record's exact `identity` UTF-8
  string; the operator independently reconstructs and validates this identity.
- `expiresAt`: explicit Unix seconds, future and no more than 24 hours away when
  the new journal is initialized and when the operation is admitted.
- `maxFeePerGas` and `maxPriorityFeePerGas`: decimal wei strings selected from
  fresh network/provider evidence. Both must exceed the first cancellation's
  caps; the maximum fee must remain below 5 gwei and cover the priority fee.

The sender, chain 11155111, nonce, self-recipient, zero value, empty calldata and
21000 gas limit are reconstructed from the immutable original signed approval;
none is configurable in the successor input. This is one fixed successor slot,
not a fee-escalation loop. The first cancellation must have retained signed bytes;
a preparing-without-hash record cannot be replaced through this path.

```sh
node plugins/operator.mjs successor-seed-testnet-cancellation ORIGINAL_PLAN ORIGINAL_STATE \
  --resolution FIRST_RESOLUTION --successor SUCCESSOR --key-file PRIVATE_KEY_REFERENCE
```

The existing strict sender lock, private journal writer, canonical code/nonce/
balance/allowance checks, bounded transport and safe broadcast diagnostics apply.
The separate `ORIGINAL_STATE.successor-cancel-approve-usdc.json` and its initialized
marker are immutable in identity. Preparing state is durable before signing and
signed bytes are durable before the single transport. Re-entry only reconciles;
unknown/preparing outcomes never sign or send again. Do not change fees/deadlines,
remove markers, rename state, or transmit earlier bytes to obtain another attempt.

Original approval, first cancellation and successor are reconciled before and
after submission. A raced original approval must have its real finalized allowance
and is reported as the original winner. Failed receipts, changed canonical blocks,
nonfinal receipts, wrong effects and conflicting winners do not unlock funding.
After a successful finalized winner, use the existing remaining-only command with
the unchanged successor appended:

```sh
node plugins/operator.mjs continue-seed-testnet-liquidity ORIGINAL_PLAN ORIGINAL_STATE \
  --resolution FIRST_RESOLUTION --remaining-plan FRESH_REMAINING_PLAN \
  --stage FIRST_UNFINISHED_STAGE --key-file PRIVATE_KEY_REFERENCE --successor SUCCESSOR
```

This preserves completed inventory/FEE approval and skips USDC approval only when
the original approval won. Either cancellation winner requires the remaining USDC
approval at the next nonce. The successor never modifies the original/first
cancellation journals or silently extends the expired funding plan. Controlled
real-signature tests establish these recovery semantics; an actual finalized
Sepolia winner and real-proof application acceptance remain separate evidence.
