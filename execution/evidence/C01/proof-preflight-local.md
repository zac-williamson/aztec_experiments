# C01 local genuine-proof preflight

Read-only inspection, 2026-09-14. No binary execution, proof, test, chain, download, dependency change or network request. This is a local source inventory, not renewed publisher verification. Historical `proof-environment-preparation.md` remains the genuine epoch/bridge acceptance plan.

## Available components and missing prerequisite

The installed `@aztec/bb.js` 5.2.0 contains `build/arm64-macos/bb`: executable Mach-O arm64, 20,906,368 bytes, SHA-256 `208cc0d9046603f31a8dc6c5ed0de529ccc63155a22078d409262ec6e4122031`. Other packaged platform binaries exist. This inspection did not run its version command. `~/.bb/bb` is a different 48,765,536-byte executable (SHA-256 `512c6d8f6f36ba877368f5503dcfffa6e218520ff25c90923638f9155cb90a0a`); do not implicitly substitute it.

No `acvm` was found in PATH, `~/.nargo/bin`, `~/.aztec/bin`, or the project `.build/toolchain` directory. `BB_BINARY_PATH`, `ACVM_BINARY_PATH` and `CRS_PATH` are unset in the inspected shell. This is a bounded inventory, not a whole-machine absence claim. `BBNativeRollupProver.new` explicitly requires both BB and native ACVM; its witness generation always constructs `NativeACVMSimulator` (`bb_prover.ts:125–132,445–463`). Installed WASM witness execution does not automatically repair this server-wrapper prerequisite.

## CRS inventory and required ranges

`~/.bb-crs` contains:

| File | Actual bytes | Capacity/qualification |
|---|---:|---|
| bn254_g1.dat | 1,073,741,824 | 16,777,216 uncompressed points (2^24); integrity not verified here |
| bn254_g2.dat | 128 | Size compatible; integrity not verified here |
| grumpkin_g1_v2.flat.dat | 4,194,304 | 65,536 V2 points (2^16); integrity not verified here |
| grumpkin_g1.dat, grumpkin_g1.flat.dat | 4,194,368 each | Older names; not evidence that V2 server data is available |

No `bn254_g1_compressed.dat` was present in that directory. Avoid calling the cached 1GiB file “1GiB compressed”: it is the uncompressed filename and would cover half the complete server preload's points.

Installed `aztec/src/cli/util.ts:295–304` preloads **all** server circuits with BN254 2^25 and Grumpkin 2^18 points. Source URLs use `https://crs.aztec-cdn.foundation` (fallback `https://crs.aztec-labs.com`): BN254 `g1_compressed.dat` range **0–1,073,741,823**, 1,073,741,824 compressed bytes, or 2,147,483,648 uncompressed bytes; G2 `g2.dat` 128 bytes; Grumpkin `grumpkin_g1_v2.dat` range **0–16,777,215**, 16,777,216 bytes. These are source-derived requirements, not downloads observed today. Full preload exceeds both home-cache capacities. It is not the minimum requirement of every individual circuit.

Project `apps/dist/crs` contains the client-sized 37,748,736-byte compressed BN254 / 75,497,472-byte derived BN254 (1,179,648 points), 128-byte G2, and 4,194,368-byte Grumpkin (65,537 points), with schema2 manifest. That manifest has content/provenance pins; this inventory checked sizes, not a fresh rehash of these large assets. Client success does not qualify server capacity. Pinned bb.js cache detection itself checks lengths, not these application content pins (`src/crs/node/index.ts:29–68,130–147`); use an explicitly scoped verified setup directory for any future experiment.

## Smallest bounded experiment

The smallest installed server artifact by encoded domain among the inspected server circuit list is **CheckpointPaddingRollupArtifact** (`artifacts/rollup_checkpoint_padding.json`, 32,677 bytes, SHA-256 `8e9b00531edf18405e516cbb443ec3c59e205e329a18e0e9fbcdd55cef1cd900`). Its first VK field is **12**, the C++ serialized **log circuit size** (2^12 domain), not 12 gates; the JS `circuitSize` getter name must not obscure that (`flavor/flavor.hpp:221`, `honk/utils/honk_key_gen.hpp:72–81`). It takes an empty struct and returns empty checkpoint public inputs, genuinely used as the second child for a one-checkpoint epoch. Therefore it is a useful native proof/verification plumbing test, **not application security or representative epoch capacity evidence**.

A concrete single-job route, without launching a network or fleet:

1. Select the exact installed padding artifact and matching `ServerCircuitVks.CheckpointPaddingRollupArtifact`; construct `new CheckpointPaddingRollupPrivateInputs()` and the installed `convertCheckpointPaddingRollupPrivateInputsToWitnessMap`.
2. Preferred standard wrapper after obtaining a verified compatible native ACVM: `BBNativeRollupProver.new(config).getCheckpointPaddingRollupProof(inputs)`. This executes native witness generation, actual UltraRollupHonk proof generation, and actual verification before return (`bb_prover.ts:359–370,410–432`). Explicitly supply binary paths and disposable working directories.
3. Smaller experiment possible with **already installed** public APIs: `WASMSimulator.executeProtocolCircuit` (installed simulator), `compressWitness` from `@aztec/noir-acvm_js`, decompress its returned gzip witness and artifact bytecode as the standard wrapper does; `BBJsInstance.create(exactBBPath, boundedLogger, 1)`, then `generateProof(...,'ultra_rollup_honk')` and `verifyProof(...)`, requiring `verified === true`, finally `destroy()`. These are genuine native proof APIs exported by `@aztec/bb-prover`; using WASM to compute the witness is not a mocked proof. This route must be implemented/qualified, not reported as already working or substituted into production server code silently.
4. Run exactly one job under a parent deadline (proposed 300s), explicit one native thread, scoped temporary HOME/CRS_PATH, no automatic retries, peak RSS/time and child cleanup recording. Prepare and verify required setup prefixes first; constrain network access so native auto-download cannot turn the experiment into an unbounded fetch. Do not mutate or trust the user's global cache. An existing verified prefix can suffice only after exact native circuit/SRS initialization requirements are checked; full 2^25 preload is not needed merely by assumption.

The next **nontrivial** independent server proof should be `getBaseParityProof`: 256 input messages plus VK root/prover ID, no recursive proof inputs. Actual installed `parity_base.json` SHA-256 `429ce3ba64ebb4a1c1c0674cff23cc2a0bb3896e56cab37d215ed03289f4394e`, 3,287,817 artifact bytes, encoded log domain22 (2^22), flavor UltraHonk. Matching outputs/verification plus meaningful input changes would qualify this larger step. It is not the smallest domain, and neither it nor padding establishes a genuine accepted C01 epoch. No duration/RAM claim or 128GB minimum is justified from this inspection.

## TXE JSON loader review

Current `scripts/txe-c01-service.mjs` adds the Node JSON import attribute only to `.json` URLs under the exact normalized `file:` directories `node_modules/@aztec/accounts/artifacts/`, `protocol-contracts/artifacts/`, and `standard-contracts/artifacts/`. Trailing-slash roots prevent a sibling-prefix match. All other URLs delegate unchanged; bytes and exports are loaded by the original loader. This is a narrowly scoped loader adaptation, not a replacement artifact or cryptographic validation bypass. It is not a symlink security boundary; installed package integrity remains the build's responsibility. The separate public-version correction still asserts original1/2 and private1/1 before returning public1/1; genuine proof qualification must not use this synthetic test profile.

## PublicImmutable Brillig warning

The compiler warning at `PublicImmutable.read` is on the synthetic-environment diagnostic `unsafe { check_nullifier_exists(nullifier) }`. It should remain visible; successful compilation does not establish proof assurance. The actual source immediately constructs a scoped existence request and calls `context.assert_nullifier_exists`, which pushes a counted, scoped kernel nullifier read request (`public_immutable.nr:318–337`; `private_context.nr:722–732`). The private-kernel reset output validator supplies the anchor's nullifier-tree root to `ReadRequestValidator` (`components/reset_output_validator.nr:252–261`). Settled-read validation checks matching leaf preimage and actual Merkle membership (`reset/read_request/validate_settled_read_requests.nr:50–85`), and request propagation ensures unresolved reads remain carried forward. The tail validator requires zero outstanding nullifier read requests (`components/previous_kernel_for_tail_validator.nr:57–61`). `WithHash::historical_public_storage_read` follows the existence request to bind the immutable value to the anchor's storage state.

This is concrete source evidence of a separate constrained kernel path, so the oracle warning alone is not evidence of missing initialization-existence constraints. It is not a proof execution, malicious-witness test, compiler-correctness audit, or permission to suppress the warning. These cached Noir/C++ sources are under `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/`; no upstream refresh was performed.

## Source fingerprints (read-only current bytes)

| File | SHA-256 |
|---|---|
| `scripts/txe-c01-service.mjs` | `d47cefd5688c1be2d6477bc02744c2016f2d7c5caf76908b5cff921c662e57d8` |
| `node_modules/@aztec/bb-prover/src/prover/server/bb_prover.ts` | `ba31660eedaa1aa66f3de92eb170628faf1df25936981274b59ff3931f3dc87c` |
| `node_modules/@aztec/bb-prover/src/bb/bb_js_backend.ts` | `379e9635bc8737524347bcd8791192ba19c12c97997eafc74d69f96028f308b7` |
| `node_modules/@aztec/bb.js/src/crs/node/index.ts` | `056281aaf76dd09aeb647605d9ad4763b58161e1e72a9cd87df8bc1f1959b71b` |
| `node_modules/@aztec/bb.js/src/crs/net_crs.ts` | `6c89e28caa3aaca2d2cc5d65c18d2ea60245254716898c26d68aef553fe4f271` |
| `node_modules/@aztec/simulator/src/private/acvm_wasm.ts` | `fdd1d06bcb6a2eaf12126b33c0668477ec6d0aa4011d2fa9e6137d37b1a8b7cf` |
