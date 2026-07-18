# Billboard — Anonymous Message Board on Aztec

An anonymous billboard on Aztec v5 mainnet. Users deposit ETH on L1, post messages anonymously on L2, and withdraw their ETH back to L1. Posts are fully anonymous — no sender address appears in public call data, and there is no link to the L1 deposit.

## Architecture

```
L1 (Ethereum)                     L2 (Aztec)
┌──────────────────┐              ┌──────────────────────┐
│ BillboardPortal  │              │ Billboard            │
│                  │              │                      │
│ deposit(ETH)     │──msg──▶      │ claim_deposit()      │
│  records deposit │              │  consumes L1→L2 msg  │
│  sends L1→L2 msg │              │  creates DepositNote │
│                  │              │                      │
│ withdraw(ETH)    │◀──msg──      │ post()               │
│  consumes Outbox │              │  consumes note       │
│  sends ETH       │              │  stores message      │
│                  │              │  creates new note    │
│                  │              │                      │
│                  │              │ withdraw()           │
│                  │              │  consumes note       │
│                  │              │  sends L2→L1 msg     │
└──────────────────┘              └──────────────────────┘
```

### Privacy model

- **Deposits**: L1 deposit is public (EOA + amount visible on Ethereum)
- **Posts**: Fully anonymous — no sender address in public call data, no link to L1 deposit
- **Withdrawals**: Reveals depositor's L1 address (inherent — ETH must go somewhere)
- **Anonymity set**: All depositors who haven't withdrawn yet

### Rate-limit invariant

Posts are rate-limited by a time-lock stored in a private note. The cooldown is inversely proportional to the deposit amount:

```
cooldown = 3600 * 0.001 ETH / amount
```

- 0.001 ETH → 3600s cooldown (1 post/hour)
- 0.005 ETH → 720s cooldown (5 posts/hour)
- 0.01 ETH → 360s cooldown (10 posts/hour)

Each `post()` advances `min_usable_time` by one cooldown. Posting multiple times in quick succession is possible if enough time has elapsed since the deposit — the lock accumulates, it doesn't reset per post. The deposit→withdraw loop does not help: re-depositing creates a new note with a fresh claim-time lock, identical to simply waiting.

See [SECURITY_PROPERTIES.md](SECURITY_PROPERTIES.md) for the full security analysis with line-by-line code references.

## The three apps

### 1. Fee Juice (`fee-juice`)

Before interacting with L2, you need Fee Juice to pay transaction fees. This app handles the full flow:

1. **Swap ETH→AZTEC** (optional) — If you don't already have AZTEC tokens, the app swaps ETH for AZTEC via Uniswap V3 on L1.
2. **Deposit to L2** — Approves the FeeJuicePortal and deposits AZTEC tokens, sending an L1→L2 message.
3. **Scan / Recover** — Scans L1 `DepositToAztecPublic` events backwards to find your deposit, derives the claim secret from your ETH wallet signature, and checks nullifier consumption + checkpoint status.
4. **Claim on L2** — Consumes the L1→L2 message to mint Fee Juice on L2.

Also supports an `auto` action that runs deposit → wait → claim in one go.

### 2. Deploy (`billboard/deploy`)

Deploys and links the billboard contracts. The deployment has a circular dependency (L1 portal needs L2 address, L2 contract needs L1 portal address), broken by making the L2 constructor take no arguments and setting the portal later.

1. **Deploy L2** — Deploys the Noir Billboard contract using universal deploy (address depends only on salt + artifact, not deployer wallet).
2. **Deploy L1 Portal** — Deploys the Solidity portal via CREATE2 (deterministic from L2 address + rollup + version).
3. **Link Portal** — Calls `update_portal()` on L2 to store the L1 portal address.
4. **Cross-Check** — Verifies L1→L2 and L2→L1 references match.

### 3. User (`billboard/user`)

The main user-facing app. Full flow: deposit → claim → post → withdraw → claim on L1.

1. **Deposit ETH** — Deposits ETH into the L1 portal (sends an L1→L2 message).
2. **Claim on L2** — Consumes the L1→L2 message to create a private DepositNote.
3. **Post** — Posts an anonymous message. Each post extends the time lock by one cooldown. The billboard feed auto-refreshes every 5 seconds.
4. **Withdraw** — Consumes the DepositNote and sends an L2→L1 message.
5. **Claim on L1** — After the epoch proof (~40 min on mainnet), consumes the Outbox message to claim ETH on L1.

The `auto` action runs the full flow end-to-end autonomously.

## Directory structure

```
aztec/
├── README.md                        ← this file
├── SECURITY_PROPERTIES.md           ← security analysis with code references
├── wallet.json                      ← Aztec wallet (secret key + salt)
├── eth_wallet.json                  ← ETH wallet (private key)
├── package.json                     ← ethers + fake-indexeddb (for CLIs)
│
├── billboard/                       ← Contracts
│   ├── Nargo.toml                   ← Noir workspace
│   ├── billboard_contract/          ← L2 contract (Noir)
│   │   ├── Nargo.toml
│   │   └── src/
│   │       ├── main.nr              ← Billboard contract
│   │       └── lib.nr               ← Helpers: msg hashes, cooldown computation
│   ├── portal/                      ← L1 contract (Solidity / Foundry)
│   │   ├── foundry.toml
│   │   └── src/
│   │       └── BillboardPortal.sol
│   └── target/                      ← Compiled Noir artifacts (gitignored)
│
├── shared/                          ← Shared modules (used by all apps)
│   ├── styles.css                   ← Dark theme CSS
│   ├── helpers.js                   ← UI helpers: logging, pagination, extractors
│   ├── wallet-buttons.js            ← Common wallet loading/generation UI module
│   ├── app-env.js                   ← Common browser env builders (buildEnv, buildConfig, makeCallEngine)
│   ├── aztec-lib.js                 ← PXE/CRS/wallet infrastructure + Fee Juice constants
│   ├── aztec_bundle.js              ← Aztec PXE bundle (WASM, ~58MB)
│   ├── ethers.min.js                ← ethers v6 (for L1 interactions)
│   ├── poseidon2.js                 ← Pure-JS Poseidon2 (verified against bb.js)
│   └── rpc-config.json              ← Aztec node URL + API key
│
├── apps/                            ← Web apps + CLIs
│   ├── build.mjs                    ← Build script (combines modules → single-file HTML)
│   ├── serve.py                     ← Dev server with COOP/COEP headers for multi-threaded WASM
│   ├── src/
│   │   ├── fee-juice/               ← Fee Juice app
│   │   │   ├── template.html
│   │   │   ├── app.js               ← Thin wrapper (UI → engine)
│   │   │   ├── engine.js            ← Fee Juice flow logic (swap, deposit, scan, claim)
│   │   │   ├── cli.mjs              ← CLI tool (same engine, Node.js)
│   │   │   └── pxe-cache.cjs        ← IndexedDB dump/restore for CLI PXE caching
│   │   └── billboard/
│   │       ├── billboard_artifact.json   ← Compiled L2 contract artifact
│   │       ├── portal_bytecode.txt       ← Compiled L1 portal bytecode
│   │       ├── build_artifact.mjs        ← Artifact build script (VKs, bytecode)
│   │       ├── build_vks.sh              ← VK computation helper
│   │       ├── deploy/                   ← Deploy app
│   │       │   ├── template.html
│   │       │   ├── app.js               ← Thin wrapper
│   │       │   ├── engine.js            ← Deploy flow (L2 + L1 + link + cross-check)
│   │       │   ├── cli.mjs              ← CLI tool
│   │       │   ├── gen_eth_wallet.mjs   ← ETH wallet generator
│   │       │   ├── serve.py             ← Local dev server (legacy, use apps/serve.py)
│   │       │   ├── billboard_artifact.json
│   │       │   └── portal_bytecode.txt
│   │       └── user/                     ← User app
│   │           ├── template.html
│   │           ├── app.js               ← Thin wrapper (UI → engine, live feed)
│   │           ├── engine.js            ← User flow (deposit, claim, post, withdraw, claim-l1)
│   │           ├── cli.mjs              ← CLI tool
│   │           └── pxe-cache.cjs        ← IndexedDB dump/restore for CLI PXE caching
│   ├── dist/                        ← Built single-file apps
│   │   ├── fee-juice.html
│   │   ├── deploy.html
│   │   ├── user.html
│   │   ├── aztec_bundle.js          ← Copy of the PXE bundle
│   │   └── crs/                     ← CRS files for proving
│
├── .pxe-cache/                     ← CLI PXE cache (IndexedDB dumps, gitignored)
│
└── node_modules/                    ← ethers, fake-indexeddb
```

## Architecture: shared engine pattern

Each app follows the same pattern:

- **`engine.js`** — All business logic. Takes an `env` object (`{ aztec, ethers, log, initCRS, createStore, getEthSigner, portalBytecode, artifact }`) and a `config` object. Returns `{ ok, state, handles }` where `handles` gives the web UI access to live PXE/contract objects for polling.
- **`app.js`** — Thin UI wrapper. Builds `env`/`config` from UI state, calls the engine with the appropriate action, routes `log` callbacks to page-specific status divs.
- **`cli.mjs`** — CLI tool. Same engine, Node.js environment. Polyfills IndexedDB with `fake-indexeddb`, loads the bundle, runs the engine.

Both the web UI and CLI share the same engine, so any flow that is autonomous in the CLI is also autonomous in the web UI.

### Engine actions

**Fee Juice**: `status`, `scan`, `deposit`, `claim`, `auto`

**User**: `status`, `deposit`, `claim`, `post`, `list`, `withdraw`, `claim-l1`, `auto`

**Deploy**: `status`, `deploy`

The `auto` action runs the full flow end-to-end: deposit → wait for L2 ingest → claim → post (if message provided) → withdraw → claim-l1.

## Building

```bash
# 1. Compile L2 contract (aztec compile transpiles public ACIR → AVM bytecode + adds VKs)
cd billboard && aztec compile

# 2. Build the artifact (computes VKs with chonkComputeVk, packages bytecode)
cd apps/src/billboard && node build_artifact.mjs
cp billboard_artifact.json deploy/billboard_artifact.json

# 3. Compile L1 portal (if portal_bytecode.txt needs updating)
cd billboard/portal && forge build --use 0.8.33

# 4. Build all dapps (combines modules into single-file HTML)
cd apps && node build.mjs
```

### Important: aztec-nr version must match the bundle

The L2 contract's `Nargo.toml` must depend on `aztec-nr` tag `v5.0.0` — the same version the `aztec_bundle.js` was built from. Version mismatches cause standard contract addresses (HandshakeRegistry, AuthRegistry, etc.) baked into the ACIR to differ from those registered in PXE, causing "contract is not registered" errors.

Each recompilation changes the contract class ID (public bytecode commitment), so always use a salt that was never used before when deploying.

## CLI usage

```bash
# Fee Juice (swap ETH→AZTEC, deposit, claim — all in one)
node apps/src/fee-juice/cli.mjs --gen-all                          # Generate new wallets
node apps/src/fee-juice/cli.mjs --status --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/fee-juice/cli.mjs --scan --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/fee-juice/cli.mjs --eth-for-swap 0.005 --aztec-wallet wallet.json --eth-wallet eth_wallet.json

# Billboard user (deposit → claim → post → withdraw → claim-l1)
node apps/src/billboard/user/cli.mjs status   --contract-salt 1006 --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/billboard/user/cli.mjs deposit  --contract-salt 1006 --amount 0.005 --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/billboard/user/cli.mjs post     --contract-salt 1006 --msg "hello world" --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/billboard/user/cli.mjs list     --contract-salt 1006 --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/billboard/user/cli.mjs withdraw --contract-salt 1006 --aztec-wallet wallet.json --eth-wallet eth_wallet.json
node apps/src/billboard/user/cli.mjs auto     --contract-salt 1006 --amount 0.005 --msg "hello" --aztec-wallet wallet.json --eth-wallet eth_wallet.json
```

### Serving web apps with multi-threaded WASM

```bash
python3 apps/serve.py [port]  # default: 8000
```

Sets COOP/COEP headers for `SharedArrayBuffer` (multi-threaded WASM) and serves from `apps/dist/`. Local CRS files in `apps/dist/crs/` are loaded automatically.

## Key design decisions

### Universal deploy (deterministic L2 address)

The L2 contract is deployed with `universalDeploy: true` and `publicKeys: deriveKeys(Fr.ZERO).publicKeys`, so the contract address depends only on the salt + artifact — not the deployer's wallet. This means the deploy and user apps always compute the same address.

### SchnorrInitializerlessAccountContract

The v5 bundle uses the initializerless Schnorr account contract for self-deployment. The regular SchnorrAccountContract stores its signing key in a private note created by the constructor, but during self-deployment (deploy + claim fee juice in one tx), the entrypoint runs before the constructor, so `get_note()` fails. The initializerless variant stores the signing key in a PXE capsule and verifies against `immutables_hash`.

### In-browser PXE (no server, no workers)

The web apps run the full PXE stack entirely in the browser:
- **IndexedDB store** for PXE state (data directory includes wallet address for isolation)
- **CRS files** loaded from local files first, falling back to CDN
- **Proving** via `bb.js` WASM (multi-threaded when COOP/COEP headers are set)
- **No backend server** — all RPC goes directly to the Aztec node

### CLI PXE cache

Both CLIs dump/restore the in-memory IndexedDB state to `~/.pxe-cache/` between runs, saving ~2-4s on PXE sync. Cache files are keyed by account address.

### Wallet loading

The shared `wallet-buttons.js` module provides a common wallet UI across all three apps with:
- **ETH wallet**: Load from JSON, Generate random, or connect browser wallet
- **Aztec wallet**: Load from JSON, Generate random, or derive from ETH wallet (sign a message, use signature as secret key)
- Color-coded button states and auto-advancement when all wallets are loaded

## Prerequisites

- **nargo** / **aztec** CLI (must match the v5 bundle version)
- **forge** (Foundry, for compiling the Solidity portal)
- **Node.js** ≥ 24
- A browser wallet for L1 transactions (in the web UI)

## TODO

- [ ] **Formally verify the security properties** — The security analysis in [SECURITY_PROPERTIES.md](SECURITY_PROPERTIES.md) is currently a manual review artifact with code references. Formally verify the properties (e.g. with a theorem prover or formal specification) to gain stronger guarantees.
- [ ] **Replace in-app JSON Ethereum wallet with [OpenLV](http://openlv.sh/)** — The current "Load from JSON" ETH wallet option requires users to manually export and load a private key JSON file. Replace this with OpenLV integration for a more secure, user-friendly wallet connection.

## AI-recommended TODOs

### Security & verification

- [ ] **Add access control guard to `update_portal()`** — Currently anyone can call it first with a bogus address, bricking the contract (griefing DoS, not theft). Should be deployer-only or called in the same L2 tx batch as deploy. See [SECURITY_PROPERTIES.md](SECURITY_PROPERTIES.md) §5.
- [ ] **Fix `post_count` / `post_data` key type from u32 to u64/Field** — Theoretically wraps after ~134M posts, overwriting post 0. Economically unreachable today but should be fixed for correctness.
- [ ] **Fix `totalDeposited` accounting drift** — Over-counts across deposit/withdraw cycles (never decremented). Not security-relevant (withdrawals read `deposits[msg.sender]`, not the total) but cosmetically wrong.

### UX & functionality

- [ ] **Surface L1 withdrawal claim in the web UI** — The `claim-l1` action exists in the engine/CLI but the web UI doesn't expose it as a distinct page with Outbox proof input.
- [ ] **Add "view on explorer" links** for confirmed L2 transactions (e.g. aztecscan.com).
- [ ] **Show estimated wait time** for epoch proofs in the UI during claim-l1 (~40 min on mainnet).
- [ ] **Suppress verbose PXE/bundle console output** in the browser — Partially done, but pino logger output still leaks through to the console.

### Testing & robustness

- [ ] **End-to-end browser test of refactored web apps** — User app (sequential claim checks + yields) and fee-juice app (scan + auto-claim) need full re-testing after the refactoring.
- [ ] **Add transient RPC retry logic to web apps** — The CLI has this via a `TRANSIENT_RE` regex; the web apps may not.
- [ ] **Handle multiple deposits to different Aztec addresses from the same ETH wallet** — Fee-juice scan filters by `to` address, but the UX could be clearer about which deposit is being claimed.

### Misc

- [ ] **Withdraw the current 0.005 ETH deposit on salt 1006** — 5 posts made, deposit still in `postable` state, ready to withdraw when desired.
