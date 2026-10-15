# V6 avatar-log feasibility experiment — RC17 / G03

This standalone package tests an authenticated onchain avatar event, canonical
8192-byte packing and reconstruction through the node's archived transaction
effect API. It does not alter the billboard workspace or application artifacts.
It is not the production username/avatar contract: a disposable operator is
publicly authenticated, and the contract accepts arbitrary bounded bytes. The
driver supplies validated 100x100 PNGs. Production still needs private username
ownership, safe general upload conversion/decoding, moderation and retention.

## Repeatable local preparation

Use the repository's pinned Node from `.nvmrc`, installed matching V6 dependencies
and verified compiler/native binaries from `BUILDING.md`. No credentials are read
by the experiment. From repository root:

```sh
node --test experiments/avatar/codec.test.mjs
node experiments/avatar/build.mjs
```

The committed PNG byte fixtures use **Node24.21.0 / zlib
1.3.2.1-motley-8002e91**. Compression bytes differ under the system Node25.8.1 /
zlib1.2.12 even when decoded pixels match. Generation enforces the repository
Node pin and this zlib version; the exact-byte fixture assertions remain required.
To regenerate deliberately with the pinned runtime:

```sh
node experiments/avatar/raster-fixture.mjs --write-fixtures
node --test experiments/avatar/codec.test.mjs
```

Both fixture sizes and the stress-image noise count are printed by generation.
Record and review any runtime/pin change before replacing reference PNGs.

Only the first command is a cheap unit check. The build compiles this package with
the pinned Nargo and processes its artifact with the existing `processArtifact`
helper, preserving dependency-origin checks. The lead must serialize that build
with other expensive jobs. Outputs are ignored under `experiments/avatar/target/`:
`avatar_log_probe-AvatarLogProbe.json` and its source-hashed `avatar-build.json`.
The measurement rejects stale inputs/artifact bytes. The package and build recipe
have not been compiled merely by running the codec tests.

## Existing supervised fixture integration

The lead adds one explicit scenario call at the point its existing local fixture
has an initialized wallet, registered genesis-funded disposable account and node:

```js
import {runAvatarLogExperiment} from '../experiments/avatar/measure.mjs';
const avatar = await runAvatarLogExperiment({
  node, wallet, owner: account.address, mineL1,
  outputDirectory: absoluteFreshExperimentDirectory,
  realProofs: false,
  mark,
});
```

The relative import above is for a caller directly under `scripts/`; adjust only
the import location for the actual harness. The function is the complete driver;
there is no second service supervisor or account lifecycle. Its caller must own
wallet/node shutdown, resource limits and the bounded existing fixture. It needs
a registered account already funded by the fixture's genesis allocation, not a
user wallet or a sponsored production transaction. It rejects non-31337 L1 and a
mismatch between the explicit `realProofs` argument and node configuration.

For initial measurements, configure the existing fixture with
`BOARD_TEST_PROOFS=disabled` and pass `realProofs:false`. Actual local deployment,
transactions, public execution, logs and reads are still required. Reports label
every measurement `proofs-disabled` and retain `realProofAcceptance: missing`.
For a later genuine proof run, configure the existing fixture with
`BOARD_TEST_PROOFS=real` and pass `realProofs:true`. No runtime setting is silently
changed by the driver. Nonempty development proof bytes are not cryptographic
evidence; the node must actually enforce genuine proofs for the real mode.

The driver performs exactly one deployment and two publications, sequentially.
Before each sole submission it saves the transaction hash with outcome unknown.
It refuses an existing output directory: a failed run's directory is a recovery
journal, never permission to resend. Reconcile recorded hashes/receipts before
authorizing another run. No retries of a paid action are built into this driver.
The parent retains the node/chain data needed for reconciliation.

The output contains `measurement.json`, PNGs reconstructed from actual logs and
serialized log fields. The report binds the revision, compiled sources/artifact,
driver files and execution environment. For each transaction it records preparation
time, public simulation DA/L2 gas, inclusion time, actual receipt fee, transaction
and effect bytes, blob fields, public writes and public-log fields. The two avatar
records additionally capture archived event bytes/fields, content digest, input
size and exact decoded-pixel equality. `prepareMs` includes the normal SDK request
and proof/witness preparation; it is not presented as isolated proving time.
`effectReadMs` measures one node archival-API lookup, not cold remote retention.

## Format and source-backed limits

Each byte array packs into exactly 265 fields, 31 bytes per field, big endian.
Length is in `[1,8192]`; unused bytes and all padding fields must be zero. Contract
and JavaScript reject noncanonical high bytes/padding. The contract computes a
domain-separated Poseidon2 digest over `[version,width,height,length,...data]` and
stores only its latest version and digest. Versions increment atomically; the
publicly authenticated operator is immutable. Event fields are:

`schema=1, version, width=100, height=100, length, digest, data[265], trailer=1`.

The nonzero trailer also protects against truncation of trailing zero bytes by
log consumers. The driver verifies the emitter's contract address, exact event
shape, version, digest, current state and byte-for-byte reconstruction. The event
hash is checked using the installed SDK `poseidon2HashWithSeparator`; SHA-256 in
the report additionally fingerprints ordinary output files.

Installed V6 `node_modules/@aztec-labs/constants/src/constants.gen.ts` defines:

- 63 public data writes per transaction.
- 4096 aggregate public-log payload fields; 4094 maximum individual log fields.
- 8475 maximum transaction blob-data fields.

The event's declared payload is 272 fields; its tag and protocol header add
overhead. These are format counts, not measured transaction sizes. The driver
records actual `PublicLog.sizeInFields()`, serialized bytes and complete transaction
effect blob fields against the installed limits. It does not claim that the entire
transaction costs only the event payload. The AVM supplies authenticated log
emission; `aztec/src/context/public_context.nr` and SDK `stdlib/src/logs/public_log.ts`
define the matching public-event/log representation.

## Raster quality and outstanding qualification

`fixtures/smile.png` is an actual locally generated lossless 100x100 RGB avatar.
`fixtures/stress.png` has deterministic noise to exercise the 265th field just
below the byte ceiling. Both contain exactly IHDR, IDAT and IEND chunks, without
ancillary metadata. `raster-fixture.mjs` reconstructs them reproducibly and checks
CRC, bounded inflate, dimensions, depth, format and exact original RGB pixels.
Its decoder deliberately accepts only this fixture's filter0 PNG subset; it must
not become the application's general-purpose image parser.

Open the smile at native 100x100 and 2x size to inspect recognizable edges, eyes,
mouth and color. Pixel equality establishes zero encoding loss for this artificial
fixture; it does not establish quality for photographs, transparency or every
user upload. The final pipeline still needs representative images, metadata
stripping, decompression limits, visual assessment and moderation checks. Boundary
codec tests at exactly8192 bytes use synthetic bytes, explicitly not valid PNGs.

No chain measurement is asserted until the driver actually succeeds. The early
experiment also does not qualify wrong-owner/cross-name authentication, concurrent
profile edits, finality/reorg handling, independent clean-archive rebuild, long-term
retention, mainnet suitability or cryptographic privacy. These remain downstream
acceptance requirements; proofs-disabled output must remain distinguishable from
genuine application-proof evidence.

Cleanup: after preserving needed evidence, remove only this experiment's generated
`target/` directory and the particular parent-owned fixture/output directory.
Do not clear shared caches, existing wallets, node data or service configuration.
