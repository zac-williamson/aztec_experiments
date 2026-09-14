# C01 native padding harness: source handoff

Prepared 2026-09-14; **not executed, syntax-checked, or qualified in this lane**. No downloads, network calls, proofs, tests or dependency changes. Only the harness and this note were written. Source SHA-256: `640e53eddfe9858032f0fcf0318215f783afbcffadefc2bb22a0cf85ea215596`.

Run only after root review and release of the heavy slot, with pinned Node24.21.0: `node scripts/test-c01-native-proof.mjs`. It emits one unique `execution/evidence/C01/native-padding-<uuid>.json`; failures remain failures. No package script or graph acceptance change is made here.

The harness generates one actual **CheckpointPaddingRollupArtifact** proof through installed 5.2 `BBJsInstance` (explicit native Unix socket backend, one thread), verifies it, changes the final proof field without changing its width/count, requires native verification to return false, and verifies the original again. An exception/crash is not accepted as the corruption control. Witness generation uses installed `WASMSimulator` and `compressWitness`, avoiding a fabricated witness or the absent native ACVM executable. The installed padding output converter must yield the empty output, and actual native circuit statistics must report domain4096. This is proof plumbing only: padding has empty inputs/outputs. It cannot satisfy board, meaningful recursive composition, epoch or L1 verifier acceptance.

## Local setup and bounds

The source manifest's exact SHA-256, artifact SHA-256, native arm64-macOS BB SHA-256 and installed ACVM WASM SHA-256 are frozen in the harness. It hashes **whole** local compressed and derived BN254, G2 and Grumpkin assets against the manifest before staging. It also checks the pinned derivation WASM file and input relation. No home cache is read. The full verified derived prefix (1,179,648 points) is staged as native `bn254_g1.dat`; G2 as `bn254_g2.dat`; all65,537 verified V2 Grumpkin points as `grumpkin_g1_v2.flat.dat`. Staged data is rehashed before/after the run. Files and directories are disposable, under a short private temporary path to respect macOS Unix-socket name limits.

Actual cached 5.2 native source:

- `srs/factories/native_crs_factory.hpp`: requested CRS degree is passed to `get_bn254_g1_data`; verified uncompressed prefixes are read by requested degree. `get_bn254_crs.cpp:208–225` uses64-byte points; cached reads do not independently hash them, making the harness whole-content checks necessary.
- Padding artifact's encoded log domain12 is domain4096, not12 gates. `bbapi_ultra_honk.cpp` uses the actual circuit-generated prover instance and supplied VK. The harness separately checks native reported domain before proving.
- `constants.hpp:32` pins `CONST_ECCVM_LOG_N=15`, and `commitment_schemes/ipa/ipa.hpp:86–104` defaults to that32768-point polynomial length. `get_grumpkin_crs.cpp` reads64-byte V2 points. The staged65537-point verified asset exceeds that prefix; this is source-based sizing, not an observed request trace or a full server preload claim.
- CLI initialization (`bb/cli.cpp:841–843`) installs network-backed factories. Therefore JavaScript fetch prohibition alone would be insufficient. The entire worker and native descendants run under macOS Seatbelt denying outbound/inbound IP networking and writes to the CRS directory except its lock. The worker must first observe EPERM/EACCES from a local TCP attempt; ECONNREFUSED/timeout does not pass. Unix sockets remain needed for BB IPC. Unsupported platform, rejected profile, missing asset, wrong content or incompatible API fails closed. The new profile itself is untested: qualify it rather than bypassing it if it fails.

Parent supervision bounds the worker to300seconds, with bounded process-group TERM/KILL cleanup and a310second supervisor fallback. Both timers are cleared on completion. An empty/minimal child environment avoids inheriting wallet/config secrets. Native logs are not captured, witness/proof content is not serialized to evidence, and only controlled stages/error classes are retained. Native proof bytes are represented by count/hash. `/usr/bin/time -l -o` records raw OS resource data; Node's own resourceUsage is separately labeled, without treating it as native peak RSS. Source fingerprints and setup hashes are rechecked; all owned descendants must be absent, temporary directory removed, native API controls passed and child exit0 before success. OS resource figures and Seatbelt enforcement remain unmeasured until the first actual run.

## Review limits and next action

The standard production server wrapper still requires verified native ACVM; this isolated WASM-witness route does not change it. No protocol binary/source is patched. The harness is intentionally macOS arm64 only and has no fallback backend, timeout increase, auto-download, generic cache or retry. Root should first review/syntax-check the source, then release one bounded run; retain any actual setup/sandbox/API failure and correct its cause. A successful empty-padding run only enables a subsequent nontrivial capacity experiment such as BaseParity, followed by real C01 application/epoch qualification.

Root review: syntax check passed. The native statistics API returns the dyadic
size as used by the harness; WASMSimulator returns the witness map consumed by
compressWitness. The minimal child environment additionally selects the installed
bcrypto JavaScript backend (`NODE_BACKEND=js`), as in the qualified local test
profile; this does not replace native proof generation. Failures now retain a
code and three stack-location lines for diagnosis, without error messages or
witness/proof contents. These root edits supersede the handoff source hash;
execution evidence fingerprints the actual source. Run remains pending the
serial Noir suite.
