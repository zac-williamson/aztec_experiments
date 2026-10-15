# Rolling Chat clickable prototype

A Draft 3 design-stage deliverable, intentionally disconnected from wallets and
production services. It is not the delivered chain application. All fixtures and
local actions are labelled in the interface; refresh resets local changes.

## Run

From a fresh repository checkout with Node installed (repository target Node 24):

```sh
node apps/rolling/serve.mjs
```

Open http://127.0.0.1:4317. To isolate another instance:

```sh
ROLLING_PREVIEW_PORT=4318 node apps/rolling/serve.mjs
```

No install, build, external fonts, third-party images or backend credentials are
needed. Stop the process with Ctrl-C. The server binds to loopback, serves only its
six public assets, and blocks browser connections with a content security policy.
No mutable files or data need cleanup.

## Verification

```sh
node --check apps/rolling/app.mjs
node --test apps/rolling/model.test.mjs apps/rolling/navigation.test.mjs
```

Browser acceptance procedure for the lead/reviewer:

1. At desktop width, browse Home without connecting a wallet. Scroll to append more
   fixture posts, open a thread, follow its individual reply links, then use Back.
   Check the previous feed position and previously loaded content are retained.
2. Search all subboards for `building`; open the result. Inspect effective rules.
   Search `no-rules`, inspect the rejection and open balances from its tombstone.
3. Like/unlike, repost, save a post, and inspect Bookmarks. Quote and reply to a
   particular post; inspect the local-only preview and its canonical reference.
4. Compose 248 `🙂` characters (992 UTF-8 bytes), then add one more. Submission must
   disable and text must remain intact. Preview `[bad](javascript:alert(1))` and
   `<script>alert(1)</script>`; neither becomes executable content.
5. Visit every sidebar link and each profile. Public profiles show one identity
   only; the private Names/composer previews list example owned names. Compose
   as Ellis Moss and follow the resulting author link: its individual public
   profile must open without showing any other name owned by the account.
6. Open onboarding, review ETH/USDC choices and three steps. Completion must say
   no account was funded. Inspect withdrawal and recovery previews; no sensitive
   input or real connection should be requested.
7. On a fresh Home load, press Tab then Enter: the skip link must focus main
   content without changing the URL or rendering an unavailable-page view. In a
   fresh tab load `/#/thread/first-tools/r3`: the Bok reply must receive focus and
   scroll into view without first clicking another route. Repeat with a reload.
   Use Tab/Shift-Tab and Escape in a modal. Focus stays inside until dismissal and
   returns to its opener. At 390px, open/close the navigation menu by keyboard.
8. Exercise loading, empty, pending and failure options in Design review. Retry
   restores the fixture feed. Open Quiet map thread to inspect a removed parent.
9. Inspect at desktop and 390px, including focus rings, line lengths, action
   wrapping and contrast. Record screenshots and source revision separately.

The independent browser review is not claimed by the model and navigation unit checks.
Production acceptance still needs real wallet/proof/social-chain integration,
private-state recovery, trace analysis, measured performance and specialist review.

## Integration boundaries

`fixtures.mjs`: disposable public fixture data. `model.mjs`: pure allowance,
ranking, directory search and safe-link helpers. `app.mjs`: DOM-based rendering,
hash navigation and local state. `style.css`: tokens and responsive UI.

All user content is inserted through text nodes. Rich text supports safe http(s)
links; arbitrary HTML remains text. No author edit/hide controls exist. Authenticated
bot appearance is fixture-labelled; the preview does not assert cryptographic
verification. Future adapters must provide real authenticated state and explicit
pending/failure statuses; they must not convert fixture success into real success.

## Connected public reader (development)

`live.html` and `reader.mjs` are the public chain reader. Start its single-origin
server with the pinned Node runtime and a local public deployment configuration:

```sh
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node apps/rolling/start.mjs /absolute/path/rolling-public.json
```

The configuration has exactly six keys: `nodeUrl`, `artifactPath`, `scope`,
`deployment`, `cacheDirectory`, and `port`. Use an HTTPS public Aztec RPC or a
loopback development RPC; URLs with credentials, queries or fragments are refused.
`artifactPath` points to the normally built RollingBoard artifact.
`scope` contains decimal strings `chainId`, `rollupVersion`, and the canonical
`rollupAddress`, `boardAddress`, `classId`. `deployment` contains the actual
`blockNumber` (integer), `blockHash`, and `txHash` of board deployment. These must
come from the deployment receipt, not invented defaults. `cacheDirectory` is a
separate mutable local directory per deployment; `port: 0` selects an available
loopback port and prints the URL. No credentials or wallet keys belong here.

The server authenticates cached events again against canonical public blocks
before displaying them. An unavailable or incomplete index shows an explicit
unavailable state. It serves only the fixed reader assets and public GET API;
no private-query proxy or arbitrary repository-file route is exposed. Wallet assets are unavailable unless the separate public wallet configuration below is supplied.
Stop with Ctrl-C; the server joins the bounded active sync before closing. To
rebuild a cache, stop first and remove only that deployment's cache directory.

This interface currently supports public conversations, linked replies, profiles,
subboard discovery and pagination. The account panel connects to the production private wallet session when configured. Receipt-backed funding recovery and Bok composition are implemented; initial aggregate funding and real-wallet testnet acceptance remain incomplete. The
separate `index.html` preview still uses labelled fixtures. Synthetic browser
checks qualify rendering and navigation only; full chain, wallet, privacy and
production acceptance remain separate requirements.

```sh
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node --test apps/rolling/start.test.mjs apps/rolling/reader-client.test.mjs apps/rolling/reader.browser.test.mjs
```


## Private account composition (development)

After the repository's pinned dependency, contract, CRS, SDK and app builds (see
`TESTING.md`), build the wallet entry and its source-bound asset manifest:

```sh
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node scripts/rolling-wallet-assets.mjs
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node apps/rolling/start.mjs /absolute/path/rolling-public.json /absolute/path/rolling-wallet-public.json
```

The optional wallet file has exactly `config`, `trustedQuery`, `remoteProver`, and
`proofsEnabled`. `config` contains `network` (`chainId`, `rollupVersion`,
`rollupAddress`, `ethRpcUrl`), `board` (`contractAddress`, `portalAddress`), and
`privateFee` (`contractAddress`, `gasSettings`). Integers are decimal strings;
addresses are canonical lowercase hex. Gas settings contain `gasLimits` and
`teardownGasLimits` (`daGas`, `l2Gas`), plus `maxFeesPerGas` and
`maxPriorityFeesPerGas` (`feePerDaGas`, `feePerL2Gas`). Use measured deployment
settings, not invented values. Reader and wallet network/board must match.

`trustedQuery` is `{url, allowLocalDev}` for the explicitly trusted private-node
boundary. `remoteProver` is either null (local proving) or
`{url, board, chainId, rollupVersion, proofsEnabled}` bound to that same deployment.
Real proofs are required outside disposable chain31337. No credentials, headers,
wallet keys, token-bearing URLs, ordinary private-query fallback or extra fields
are accepted. A matching network is not proof of who operates the trusted node;
operator trust and the required privacy analysis remain separate gates.

Public reading and opening the account panel load no SDK. Explicit Unlock loads
only the pinned wallet assets; private account creation exports encrypted recovery.
The real deployment is verified before private PXE use. Account actions use the
existing encrypted journals, show the maximum fee before confirmation, and offer
reconciliation for uncertain outcomes. An unavailable node preserves recovery and
never fabricates a completed action. The panel supports names, subboards, posts, replies, quotes, reposts, likes,
receipt-backed claims, private Bok authorization/posting and authenticated moderator
actions. Initial aggregate funding, complete live Bok deployment and final recovery
qualification remain open. See [independent deployment](../../docs/rolling-deployment.md)
for current setup and concrete gaps.

The wallet-enabled server adds cross-origin isolation and the SDK's required WASM,
worker and data-URI permissions. Connections are restricted to the exact configured
Ethereum/private-node/prover origins. Source, SDK, CRS and artifact hashes are
checked before startup and served asset bytes are checked again before response.
There is no public access to operator configuration or private storage.

```sh
.build/A02-node/node-v24.21.0-darwin-arm64/bin/node --test --test-concurrency=1 apps/rolling/start.test.mjs scripts/rolling-wallet-assets.test.mjs apps/rolling/wallet-runtime.browser.test.mjs
```

The last test uses the real browser SDK and custody/backup code with a synthetic
public feed and deliberately unavailable private endpoint. It proves encrypted
account creation and failure handling; it does not prove funding or chain actions.
Browser test identities live only in disposable Chromium contexts. Normal wallet
recovery remains in the user's browser and must be exported before storage cleanup.

### Start the current local app

For a new current native devnet, use the retained Rolling profile documented in
[the deployment guide](../../docs/rolling-deployment.md#retained-local-rolling-development):

```sh
NODE_BACKEND=js .build/A02-node/node-v24.21.0-darwin-arm64/bin/node \
  plugins/devnet/start.mjs --profile rolling --directory /absolute/private/rolling-devnet
```

After the normal pinned builds, this composes the existing current deployment CLI,
canonical public index and private wallet at `http://127.0.0.1:8080`. It uses separate
loopback RPC ports18080/18545 and requires no provider key for core app startup.
It does not replace the fixture preview on4317 or reuse unrelated older devnets.
Local proofs are disabled through the native node/PXE configuration. Readiness
reports distinguish the usable core and canonically registered PrivateBok portal
from user funding and hosted replies. Prepare pinned official Circle and Uniswap
artifacts before startup with `node plugins/devnet/liquidity.mjs --prepare-artifacts`
(after installing the locked dependencies). Startup uses the real Circle
FiatTokenV2_2 proxy, a separate private proxy administrator, and explicit local
issuance of 1,000,000 USDC to the deployment actor. Existing signed-once journals
own each deployment, initialization and pool-seeding transaction. Three real
Uniswap V3 pools connect WETH, USDC and the local FEE token; canonical QuoterV2
reads establish route availability. This inventory is development issuance, not a
user swap, credit or subsidy. Only canonical Bok lifecycle status exposes
`config.bok`; only verified router/pool identity and quotes expose aggregate
funding configuration. Actual user funding and hosted provider credentials remain
separate requirements. No app user receives deployment keys or mint authority.
Keep the selected private state directory and wait for clean shutdown
before reopening it. Wallet recovery remains separately encrypted in the browser.

### Persistent local checkpoint ownership

The persistent Rolling profile uses the installed SDK's native local-network
AutomineSequencer with `realProofs:false`, `useAutomineSequencer:true` and
`automineEnableProveEpoch:true`. A fresh local rollup has committee size zero;
startup checks that actual on-chain setting. Older committee-one campaigns are
incompatible and remain retained for reconciliation, never reset or silently
converted. A distinct new local campaign uses a distinct state directory and
new identities; no transaction from the old campaign is replayed.

The SDK serial queue owns both block production and synthetic local epoch/Outbox
settlement. Idle clock advancement uses that same queue. Bootstrap Ready handling
checks the original effect and canonical Outbox witness, and the existing finality
gate still applies. Clean shutdown pauses new work, drains and settles every
checkpoint before saving the original-chain snapshot. A failed settlement does
not produce a clean restart record. This is development-only synthetic settlement,
not real testnet proof acceptance; the legacy disposable profile is unchanged.

The relay initialization marker lives beside `relay-state`, not inside it. Once
that marker exists, loss of its original directory or `funding-budget.json` is a
recovery failure before any relay funding stage. Never delete the marker or
recreate a ledger to clear an unresolved plan.
