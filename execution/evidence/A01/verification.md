# A01 verification

Integrated against source-001.json on macOS arm64 with pinned Node 24.21.0,
Aztec 5.2.0, Noir beta.25 and Foundry 1.4.1. Exact tool identities, observed
executable hashes, 1604 build inputs and 36 output files are in the aggregate
release/artifact-manifest.json. This is content provenance, not a publisher
attestation, independent audit or deployed-address runtime certificate.

## Observations

- Current canonical contract copies and browser/CLI init, policy and history APIs
  agree. Consumer review found a real daemon failure: its restricted signer did
  not forward mandatory private-fee configuration. Fixed configuration is now
  validated once at startup and cannot be replaced by model input. The censor
  must already have claimed private credit; no coupon actor was introduced.
- 76 signer, 21 daemon and 2 historical shell regression checks pass. The original
  daemon test failure was a macOS real-path fixture mismatch, fixed with the
  original failure log retained.
- 108 integrated checks pass (integrated-final.log): aggregate binary/metadata
  validation, canonical frontend source/output binding, actual workflow Git drift
  guards, contract/SDK artifact controls, current private-fee/moderation/history
  consumers, and historical shell interpretation control. New orphan HTML tests
  reject stale pages left after removing a template and nested unexpected pages;
  confined symlinks and cycles are checked. No files are silently deleted.
- The workflow drift block passed on the actual checkout. Four regression tests
  execute that same block in disposable Git repositories, including 17 individual
  generated-output mutations, staged/deleted/new output, and unrelated evidence.
  This verifies guard behavior locally; remote Ubuntu CI has not been run here.
- Two final serial `node apps/build.mjs` runs succeeded. Exact snapshots compare
  36 files byte-for-byte. This is frontend regeneration with current validated
  contract/SDK/CRS assets; it is not a new full clean native/Linux build. Current
  contract runtime was rebuilt and qualified in C06 and is unchanged here.
- Aggregate write and check both pass. The frontend build invalidates old
  provenance before beginning and only certifies a full default-public-config
  build whose inputs remain unchanged. Partial/custom RPC builds remain usable
  but do not receive canonical certification. The inventory validates subordinate
  source hashes, every SDK worker/WASM and CRS byte hash, per-function bytecode/VK,
  Solidity compiler metadata and creation/runtime-template byte hashes.
- A01-A02 is covered by current unchanged generated portal runtime deployed in
  C06: 37 passing Forge checks include non-default minimum enforcement and
  successful withdrawal liability decrement. See C06 forge-final.log and runtime
  comparison. No contract changed in A01; repeating application proofs would not
  exercise the build/daemon-configuration change.

## Commands and limitations

Repository root is the working directory. Node path is the pinned .build/A02-node
runtime; Foundry is /Users/zac/.foundry/bin. Small checks used node --test with the
12 files listed by integrated-final.log; duration 1.2 seconds, 108/108 pass.
Signer/daemon commands are their test_*.mjs entrypoints, 99 checks with shell.
Reproducibility uses scripts/check-reproducibility.mjs snapshot/compare. Aggregate
uses scripts/release-artifact-manifest.mjs write/check. All final commands exit 0.
No native proving, network epoch prover, public deployment or real funds used.

Root reviewed source/output boundaries and JSON round-trip integrity; delegated
consumer and provenance reviews are linked. Observed executable fingerprints do
not authenticate their publisher, and Solidity runtime templates require actual
constructor-specific verification during deployment rehearsal. Final T05 must
refresh this engineering inventory after subsequent application changes and
qualify the full candidate. Independent audit/network/soak gates remain open.
