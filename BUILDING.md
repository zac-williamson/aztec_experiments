# Build and baseline verification

Run these commands from the repository root. This builds a development candidate;
passing the checks below does not establish production readiness. See [SECURITY_PROPERTIES.md](SECURITY_PROPERTIES.md) for verification limits.

## Install the pinned tools

Use Node **24.21.0**, Git, Python 3, and a POSIX shell on macOS or Linux. Native
compiler and prover binaries are selected for arm64 or x64. Windows requires a
compatible Linux environment. Install Node with your normal version manager; for
an existing nvm installation, `nvm install && nvm use` reads `.nvmrc`. The build
rejects another Node version, including Node 25. This runtime includes Undici
**7.29.1**; updating npm dependencies alone does not update Node’s embedded HTTP
client. The [official Node release](https://nodejs.org/en/blog/release/v24.21.0)
links platform archives and publisher checksums. For a workspace-only installation,
download the matching archive and `SHASUMS256.txt` from that release, verify its
SHA-256 before extraction or execution, and put the extracted `bin` directory first
in `PATH`. No global Node installation needs to change.

The moderation transport proxy and Docker isolation fixture use the same immutable
official `node:24.21.0-bookworm` image in CI and `censor-daemon/model-runtime.mjs`.
The image digest is pinned in the runtime configuration. Node version checks
do not constitute an audit of all Debian packages in the image.

Install Foundry **1.4.1** from the [official release](https://github.com/foundry-rs/foundry/releases/tag/v1.4.1).
With an existing official `foundryup` installation, run `foundryup --install v1.4.1`.
Confirm `forge --version` reports `1.4.1`. Foundry downloads Solidity **0.8.27** on
the first build. CI installs the same Foundry version with a pinned action commit.

Then install the repository dependencies and compiler:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix billboard/portal --ignore-scripts --no-audit --no-fund
npm run bootstrap:noir
```

Both npm lockfiles are required. Do not substitute `npm install` in release or CI
builds. The compiler bootstrap verifies the archive's SHA-256 and the executable's
version and commit before use. `toolchain.json` records the pins and official
download sources. The native Aztec **5.2.0** prover and test service come from the
locked npm dependencies; a globally installed Aztec CLI is unnecessary. An initial
build needs network access for npm, official compiler downloads, Noir Git
dependencies, the Solidity compiler, and content-pinned CRS assets. A preexisting developer cache is not a
prerequisite, although compilers may populate and reuse their own caches.

`noir-dependencies.json` pins the actual bytes behind Noir's dependency tags. It
records all six external package manifests and source trees, including macro
sources absent from the generated artifact, plus the artifact's embedded external
sources. The checks reject changed, missing, and additional source files or changed
dependency manifests. Updating a tag or compiler may require an intentional,
reviewed inventory update; never regenerate the lock simply to suppress a failure.
On a first build the compiler resolves missing Git dependencies before the
post-resolution content check, so this check gates accepted outputs rather than
sandboxing execution of compiler macros.

The original lock is compared with freshly downloaded official GitHub archives
by the separate origin verifier. It resolves each tag to a full commit, downloads
that commit's archive, compares every locked file, and records exact source URLs,
archive hashes, and per-file results. Run it with network access when reviewing
dependency origins or a proposed lock change:

```sh
python3 scripts/verify-noir-origins.py --output .build/noir-dependency-origins.json
```

Origin consistency does not establish dependency code safety or substitute for
independent review. The verifier never changes the lock.

Optional `NARGO`, `BB`, and `FORGE` environment variables select alternative
executable locations; the build still checks their versions. Leave these unset
for the documented default build. A different path is not permission to change
the pinned toolchain.

## Build and test

```sh
npm run build
npm run check:artifacts
npm run test:build
npm run test:dependencies
npm run test:noir
npm run test:moderation
node --test scripts/test-shell-baseline.mjs scripts/test-receipt-baseline.mjs
node --test scripts/test-sdk-storage.mjs scripts/test-protocol-schema.mjs scripts/test-protocol-commitments.mjs
npx --no-install playwright install chromium
node scripts/test-sdk-storage-browser.mjs
node scripts/fixtures/noir-interface-v1/run.mjs
node scripts/fixtures/solidity-interface-v1/run.mjs
(cd billboard/portal && FOUNDRY_PROFILE=regression forge test --offline -vv)
npm run test:sdk-browser
npm run test:cli-sdk
```

The receipt, history and historical portal regressions preserve observed baseline
defects beside normal controls. Passing an explicit known-bad observation does
not mean the defect is repaired. The EVM tests mock bridge
calls only for accounting and use separate `.build/portal-tests` outputs.

On Linux, `npx --no-install playwright install --with-deps chromium` also installs
browser system dependencies and may require system package permissions. For an
already installed compatible Chrome, set `CHROME_PATH` to its absolute executable
path instead of downloading Chromium. These tests create local temporary services
and require permission to bind loopback ports. They do not require a user wallet,
funding, a remote RPC, or a Docker daemon.

The build compiles Noir, transpiles its artifact, generates all private-function
verification keys, compiles the Solidity portal, synchronizes consumer artifacts,
builds the browser SDK and its actual worker entry points, provisions checksum-verified
CRS data from official URLs, derives a pinned uncompressed BN254 asset, and assembles the apps
in `apps/dist`. Dependency, artifact, and SDK manifests detect stale inputs or
consumer copies. Noir diagnostic source paths are normalized during artifact
generation so machine-specific checkout/cache locations do not affect the output;
bytecode, verification keys, source contents, and debug IDs remain intact.

The default browser RPC configuration is `shared/rpc-config.example.json`, pointing
to a local development endpoint. To build for a specific environment, set
`BILLBOARD_RPC_CONFIG` to the intended configuration file. Every value embedded in
a browser build is public; never put a private credential there. Use identical
configuration for reproducibility comparisons. The default does not deploy or
start a local chain.

## Compare clean builds

After the first successful build, capture its output inventory:

```sh
node scripts/check-reproducibility.mjs snapshot .build/first.json
```

Remove generated compiler, bundle, app, and CRS outputs, leaving the installed
toolchain and checksum-verified download cache available:

```sh
node -e "const fs = require('node:fs'); for (const p of ['billboard/target', 'billboard/portal/out', 'billboard/portal/cache', '.build/sdk', '.build/contracts-manifest.json']) fs.rmSync(p, {recursive:true, force:true}); fs.rmSync('apps/dist', {recursive:true, force:true});"
npm run build
node scripts/check-reproducibility.mjs snapshot .build/second.json
node scripts/check-reproducibility.mjs compare .build/first.json .build/second.json
```

The comparison hashes complete canonical and consumer Noir artifacts, Solidity
portal artifact and bytecode, SDK/runtime files, build manifests, generated HTML,
and CRS files plus their manifest. It rejects missing, extra, or changed recorded outputs and does
not strip fields to make differences disappear. This checks clean regeneration
on one host. Separate fresh-checkout and platform runs are needed to substantiate
claims about installation or cross-platform reproducibility. The checked-in CI
workflow performs a fresh dependency installation followed by two clean builds
on Ubuntu; its presence is not evidence that a hosted run has passed.

## What these checks establish

| Check | Scope | What it does not establish |
|---|---|---|
| Artifact checks and `test:build` | Build provenance, required verification keys, and stale artifact rejection | Contract safety or end-to-end transaction validity |
| `test:noir` | Noir tests using the matching local TXE oracle service | A full local chain, real proof generation, settlement, or mainnet compatibility |
| `test:moderation` | Parsing and daemon behavior with mock model/CLI services | Actual model quality or production moderation effectiveness |
| `test:sdk-browser` | Browser hashing, proving-worker initialization, SQLite worker round trip, verified CRS initialization | A generated proof, persistent recovery, or supported-browser acceptance |
| Output comparison | Exact equality of recorded generated outputs, manifests, and provisioned CRS files | Independent security review or proof validity |

`crs-manifest.json` pins official URLs, ranges, byte counts, point counts, and
SHA-256 values. Its derived G1 entry also binds the compressed input, G2 and the
exact pinned 5.2 WASM used to derive the full uncompressed representation.
`npm run build:crs` restores the three downloaded assets from verified cached
bytes or bounded official downloads, then restores or derives the additional
72 MiB `g1_uncompressed.dat`. The 64 MiB download cap remains separate from this
fixed derived-output size. A cold build performs the derivation; repeat builds
may reuse only complete, hash-verified output. To independently reproduce the
derivation, remove both the generated derived file and its content-addressed
entry in `.build/crs-cache` before rebuilding.

The app build and output comparison include the entire derived file. The runtime
prefers that locally served file after verifying its complete size and SHA-256.
If it is missing or corrupt, the runtime can use only the existing verified
compressed local/CDN data. The two formats preserve the same 1,179,648 points;
neither substitutes the prover's first-two-points check for full-content hashing.
The actual prover response must match the selected input format. G2 and Grumpkin
remain unchanged. The additional file increases distribution size; browser time,
memory and actual proof capacity still need representative product qualification.

The default browser smoke test initializes the provisioned data in
the actual WASM prover. This establishes format and initialization compatibility,
not proof validity or sufficient capacity for every production workload. The CRS
hashes are recorded content pins verified against official downloads, not a
separate publisher checksum attestation.

Record actual command results and unresolved failures in task evidence; never
infer a pass from these instructions or a green compile alone. Real-proof
journeys, network compatibility, browser coverage, independent review, and the
14-day soak remain separate mandatory production gates.

## Release artifact inventory

After a complete canonical build, run:

```sh
node scripts/release-artifact-manifest.mjs write .build/release-artifact-manifest.json
node scripts/release-artifact-manifest.mjs check .build/release-artifact-manifest.json
```

The inventory links validated contract, frontend, SDK and CRS manifests, names
per-function verification keys, fingerprints the actual local compiler/prover
executables, and records source/output hashes. It is platform-specific content
provenance, not publisher authentication or release approval. Solidity runtime is
labeled a compiler template: constructor immutables still need verification
against a particular deployed address. Canonical inventory uses the public RPC
example, not a local `BILLBOARD_RPC_CONFIG` override.

CI compares freshly built generated consumers with their committed copies before
a second rebuild, then checks the aggregate inventory on that runner. Changing
frontend source without rebuilding its pages must fail provenance validation.

Wallet recovery uses random embedded Aztec keys and password-encrypted browser
recovery files. Keep the password separately and export an updated file after
each new collateral deposit. Ethereum signing uses a browser wallet; no Ethereum
key generation or signature-derived Aztec keys are offered in the UI. See
`docs/recovery.md` for scoped custody, CLI file permissions and lock
recovery. The application SDK build fixes internal diagnostic logging to `silent`;
application progress and validated public transaction identifiers remain visible.
This does not encrypt the browser PXE database or protect an unlocked malicious
page. Use a trusted device/profile and preserve backups.

### Local Ethereum test node

Tests require the project-local Anvil from Foundry release **v1.7.0**, separately
from Forge1.4.1. Anvil1.4.1 overstates EIP-1559 receipt fees when the transaction
fee cap binds. No system-Anvil fallback is used. Install the official archive's
`anvil` executable at `.build/anvil-1.7.0/anvil`.

For macOS ARM64, use
https://github.com/foundry-rs/foundry/releases/download/v1.7.0/foundry_v1.7.0_darwin_arm64.tar.gz
and verify SHA-256 `5883d247ea14d2fff8f70393aef68762bc79e608604c48a3940d8e33ef4daab6`
before extracting. The release executable identifies itself as
`1.6.0-v1.7.0`, commit `f83bad912a9dba7bf0371def1e70bb1896048356`;
the resolver checks both. Other platforms must use the matching official asset
and its published checksum. Test evidence records the actual executable hash.
