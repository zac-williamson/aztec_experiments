# C01 test-only WASM witness CLI adapter

Prepared2026-09-14; not executed, syntax-checked or tested in this lane. No downloads, proofs, dependency modifications or production changes. New executable `scripts/c01-acvm-wasm-cli.mjs` SHA256 `aca8470c324e3d4ab8440d6e6243d05c0b550838c92273bcb122b9ee22231cb9`.

## Exact compatibility contract

Read from installed5.2 `simulator/src/private/acvm_native.ts:59–146,159–190`: the wrapper writes compressed artifact bytes to `bytecode`, input entries as `index = '0x<64 lowercase hex>'` lines to `input_witness.toml`, then spawns:

`execute --working-directory DIR --bytecode bytecode --input-witness input_witness.toml --print --output-witness output-witness`

The adapter accepts exactly those10 arguments, including their order and fixed filenames. Unknown/duplicate flags and alternate paths are rejected. It returns only `index = "0x<64 lowercase hex>"` lines on stdout and writes `DIR/output-witness.gz` using actual `compressWitness`. This deliberately matches the wrapper's double-quote-only stdout parser and its fixed output filename. Empty input TOML is valid for padding. Nonempty input requires the exact serializer grammar, newline termination, unique canonical decimalu32 indices, and canonical BN254 Fr values; no generic TOML features are accepted.

The work is performed by actual pinned `@aztec/noir-acvm_js.executeCircuit`, **not native ACVM**. Package version5.2.0, Node24.21.0, JS entrypoint path and SHA256, and WASM SHA256 are checked. All foreign calls throw; no simulation, oracle, constraint or proof result is patched. Normal WASM errors become fixed stage/code messages without error content or witness data. Pinned wasm-bindgen includes console diagnostic hooks; the adapter suppresses console diagnostics in its own process so circuit-provided text cannot reach stdout/stderr. This does not alter circuit execution or foreign-call rejection. Stdout is explicitly a witness IPC transport for the wrapper, never a log artifact.

## Scope and resource restrictions

`C01_ACVM_ROOT` is mandatory: an absolute, real, non-symlink final directory owned by the current user with no group/other permissions. Parent must create this fresh test directory. The working directory must be a strict descendant, with no symlink components beneath that root. Root itself cannot be `/`, this application repository or its workspace parent. Inputs are no-follow regular single-link files, size-bounded before reading, with size/mtime checks afterward. Output is exclusively created with no-follow and0600 permissions, never overwritten. Failed execution removes its owned incomplete output. Successful output is file-synced before witness lines are emitted.

Explicit compatibility limits: compressed bytecode32MiB, expanded bytecode128MiB, input TOML4MiB, solved witness at most4194304 entries, compressed witness128MiB, stdout400MiB. Output is streamed in approximately64KiB chunks with callback/backpressure handling. These are test-adapter bounds, not claims that all protocol circuits fit. They do not cap allocations inside WASM before return; the parent must retain300second/8GiB sampled process-group supervision and offline Seatbelt profile. This CLI is not a standalone sandbox, same-user adversary defense, production replacement or native-ACVM availability claim.

The shebang is `/usr/bin/env node`. Root must prepend the **pinned Node24.21 binary directory** to the clean child PATH and set C01_ACVM_ROOT for the generated wrapper subprocess. Existing `/usr/bin:/bin` alone will not locate pinned Node. The adapter independently rejects a different Node version. The parent should include this source hash and explicit witnessBackend=`test-only WASM CLI adapter` in its result; upstream wrapper log wording that says native ACVM does not change the actual backend.

## Required next qualification

Root owns execution. First use real `BBNativeRollupProver.getCheckpointPaddingRollupProof` configured with this adapter's path, fresh ACVM working directories under C01_ACVM_ROOT, and exact pinned native BB. This checks the actual upstream stdout/gzip conversion and server proof/verification wrapper. Pair with malformed/duplicate/out-of-range input, unsupported args, symlink/escape/output overwrite and foreign-call rejection controls in bounded local fixtures before broader use. Preserve failures as failures and keep the already passing direct padding/BaseParity evidence separate. A successful wrapper run establishes genuine WASM witness generation plus native BB proof interoperability; it does not establish standalone native ACVM or an accepted C01 epoch.
