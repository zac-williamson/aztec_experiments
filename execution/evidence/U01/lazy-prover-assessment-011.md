# Lazy PXE/prover and code-splitting assessment

Read-only inspection of installed Aztec 5.2.0 sources, current build script,
manifest and generated bundle. No build, browser/prover run or implementation
change was performed. These are byte counts and API findings, not latency,
memory, throughput or usability measurements.

## Present delivery and attribution

Observed actual candidate `apps/dist/aztec_bundle.js` and
`.build/sdk/aztec_bundle.js`: both **50,400,004 bytes**, SHA-256
`98f586f62129f07e11ec8684e682ea484fd2248f6346e0a0484a052876c54309`.
The initial inspection accidentally measured legacy `shared/aztec_bundle.js`
(54,978,603 bytes; SHA-256
`4418ca4e73b3d09df35134897094e7de77623f05fe953edd7b52cf5469ec6347`).
That file is **not the current delivered candidate**; its attribution is replaced
below. Current SDK manifest SHA-256:
`8902630202adb88393625648ef5b5a1cb3f8d1ded053f5e8d24ff0900bfdc221`;
current apps manifest SHA-256:
`87fbf8638a9f2e8fac41da5959c1ff39ea11da20e403a0b2c1da9a2dbbc06c9e`.
The current build requests esbuild metadata but persists only input/output hashes
in sdk-manifest.json; it discards retained-byte/import graphs. No retained full
SDK metafile was found. Therefore the following are **approximate generated
section spans**, measured between `  // source-path` comments, not esbuild
`bytesInOutput`, compressed transfer sizes or guaranteed removable bytes:

| Package section group | Bytes |
|---|---:|
| noir-protocol-circuits-types | 28,889,849 |
| bb.js | 8,399,677 |
| standard-contracts | 4,602,569 |
| accounts | 2,613,925 |
| protocol-contracts | 2,399,594 |

60 JSON-labelled sections total approximately 38,410,783 bytes (76.2%). These are serialized artifacts, not merely formatting. Aggregate package spans
include executable code as well.
Earlier P04 counts describe an earlier 50,130,889-byte artifact; they must not be
substituted for this observed build. Root may rebuild after this assessment;
use the recorded hash to distinguish snapshots.

## Supported paths confirmed in installed code

`shared/private-pxe.mjs` currently imports `@aztec/pxe/client/bundle`. The
installed `@aztec/pxe/client/lazy` export has a genuine alternative createPXE:
BBLazyPrivateKernelProver, LazyProtocolContractsProvider, and lazy standard
preloads. It accepts `options.proverOrOptions` (either a prover instance or
options), `simulator`, `store`, and `preloadedContractsProvider`. Existing
private log suppression can remain in the wrapper.

LazyArtifactProvider calls the installed client_artifacts_helper.js, which has
explicit per-circuit dynamic JSON imports for actual/simulated kernel artifacts
and corresponding verification keys. Lazy protocol provider dispatches canonical
instance/class registries and FeeJuice; standard preloads Promise.all the auth,
handshake/current historical registries and multicall. PXE registers these at
startup, so “lazy” does not mean every standard contract remains deferred until
posting. Do not remove historical registries without protocol justification.

Current build uses bundle:true + IIFE/globalName __aztec and no splitting.
Consequently changing only the PXE import cannot produce separately requested
chunks. Account and other explicit SDK exports also retain static artifact
imports. Current browser consumers expect window.__aztec and CLI consumers read
and execute this bundle. A genuine ESM split requires coordinated loading,
readiness, CLI compatibility, worker URL and artifact-manifest changes.

The installed bb fetchCode(multithreaded, wasmPath) supports an external WASM URL,
with `-threads` filename rewriting and gzip detection; otherwise dynamic imports
select embedded single/shared-memory data URLs. Those dynamic imports still end
up inside the present IIFE. A wasmPath setting alone cannot remove fallback data
from initial JS. ACVM/ABI/SQLite runtime assets and CRS remain separate concerns;
code splitting does not reduce curve initialization or actual proof work.

## Privacy-aware minimal candidate

A useful first change is to persist the real esbuild metafile for each canonical
build. Then evaluate **one deliberate private-journey group**, loaded on explicit
wallet initialization: account/board/private-fee plus all supported private
kernel/reset variants and runtime assets required across claim/post/screen/exit.
Keep the existing small wallet-free public feed as the public entry point.
A lightweight landing/config shell can avoid fetching this group until requested;
this is a concrete initial-delivery opportunity, not an estimated speedup.

An ESM/private bootstrap should load a fixed manifest-defined group independent
of the chosen operation and await completion before presenting ready-to-prove.
Load/prefetch identical resources and ordering for all private actions, including
moderation/fee funding if they share the same anonymity goal. Per-circuit demand
loading exposes circuit choice, complexity, first use and operation timing to the
frontend host. Uniform grouping reduces operation-specific path distinctions but
still exposes wallet initialization time, cache state, bytes, IP and repeated
visits; it is not an anonymity theorem. Standard HTTP prefetch is discretionary,
so don't rely on hints alone to erase later request differences.

Preserve a separately built legacy CLI entry initially or explicitly migrate
CLI import semantics with parity tests; don't silently break the existing IIFE
loader. Hash every emitted chunk, keep same-origin immutable URLs, test cold and
warm worker/CRS loads, and update SDK manifest path validation before adopting
nested chunk directories. Do not drop protocol variants based on names.

## Acceptance decision

Supported lazy providers are real and worth evaluating with deliberate grouping,
but no measured benefit is established here. The narrowest safe near-term
optimization is lightweight shell + fixed private group, rather than
operation-specific fetches. Current cold-load/proof measurements must determine
whether initialization meets usability limits. If they fail, that is a U01
performance failure requiring implementation/measurement; this assessment is not
permission to defer an unusable experience. Any candidate must retain actual
proof correctness, bounded resources, uniform request-footprint evidence and
explicit error/retry readiness before adoption.

## Inspected source SHA-256

- `scripts/build-sdk.mjs`: `8b7f84a925b80dd521243a31afd19994c2523e3165104b3c9a3fa941858fe196`
- `shared/private-pxe.mjs`: `b47bb4cf2739ff15a3c273fe32692cb975f5b28ca71910f11e236e0715845918`
- `shared/sdk-entry.mjs`: `dce04410b0a22f148cfab35de6602af0e65b4f4fdf373efe16ed515611721620`
- `node_modules/@aztec/pxe/dest/entrypoints/client/lazy/utils.js`: `009b3381266a94fd135f385bc578d449f969cdf76d80cf58b15334ad51e45794`
- `node_modules/@aztec/noir-protocol-circuits-types/dest/artifacts/client/lazy.js`: `58a85d37d5df41083ffda2b1ee1b82ed8d4f5113338201ec8a19b06d30b1b599`
- `node_modules/@aztec/noir-protocol-circuits-types/dest/client_artifacts_helper.js`: `116e837814f742228b5547a166c55ba6a7a0417ed382422d774ab964d5b62f48`
- `node_modules/@aztec/protocol-contracts/dest/provider/lazy.js`: `053980dccc93dd9e29bffce8c0fca8ebbf6c0a4c840e890095afff636390b5a7`
- `node_modules/@aztec/standard-contracts/dest/preloaded/lazy.js`: `f000ed4e699cb661846bcde5ac31eb55453d22a0c862d161c5a71c81b23aa8ce`
- `node_modules/@aztec/pxe/dest/pxe.js`: `e93807fc9202a13235669b823fe07fdccfef2cebe70834da7c19644d2f3ed669`
- `node_modules/@aztec/bb.js/dest/browser/barretenberg_wasm/fetch_code/browser/index.js`: `6caf7fa714f3463712876307194ceff8ada826e3369b26b32e5a05aa7b787c27`
- `execution/product-spec.md`: `c1094a19a2156d5c2d6bb4552d488283fbe4afd9a8228b52c38da82a8f2158ce`
