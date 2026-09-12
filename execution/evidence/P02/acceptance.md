# P02 — completed reproducible baseline

All four P02 criteria have observed evidence. This is a baseline development gate; production acceptance remains incomplete.

## Implemented build behavior

Pinned Node 24.15.0, Aztec SDK/prover/TXE/node packages 5.0.0, Noir
1.0.0-beta.22 at the official commit, Foundry 1.4.1 and Solidity 0.8.27.
Root and portal npm lockfiles are tracked. Compiler archives have platform SHA-256
pins. Transitive Noir source content is locked; 413 files in six packages were
matched against fresh official GitHub commit archives.

The source SDK builds the actual upstream workers and runtime WASM. App builds
validate input and output hashes. The contract build forces fresh compilation and
verification keys, normalizes only diagnostic file paths, and synchronizes all
Noir and portal consumers. Build guards reject source drift, stale consumers,
missing verification keys and changed bytecode. Current Solidity bytecode has
the four-argument constructor from source.

Official V5 setup data replaces the old Grumpkin dataset. Provisioning and every
browser/CLI consumer validate sizes and SHA-256 before initialization. The build
works after deleting generated CRS outputs. Both browser initialization paths,
including the deployment engine adapter, use the common verified loader.

## Observed acceptance evidence

- P02-A01: Separate checkout directory with fresh root/portal npm installations,
  downloaded compiler and CRS, fresh VK generation, and all four apps built.
  A separate disposable Linux container then built with empty dependency caches,
  fresh npm/compiler/Git/solc/CRS inputs and no host home/cache mounts. It passed
  in 206 seconds. Both environments generated verification keys with --force.
- P02-A02: 33 full output files match byte-for-byte across the two directory
  builds and the empty-cache Linux build, including complete Noir artifacts/VKs, Solidity artifact/bytecode,
  SDK and workers, manifests, generated HTML and CRS bytes. No fields excluded
  by the comparator. Only diagnostic source paths normalized in the builder.
- P02-A03: 105 contract/SDK/dependency/CRS/process guard tests pass on macOS;
  the 93 build/data guards also pass in the clean Linux container. Real browser initializes
  both CRS paths, proving workers, SQLite and legacy Buffer. Five offline CLI
  compatibility cases pass without existing wallets or remote RPC calls.
- P02-A04: Matching TXE runner passes all 59 existing Noir tests. Existing
  moderation unit and orchestration tests pass. Runner cancellation handling
  passed 12 child-process lifecycle tests; the repaired runner passed all 59
  Noir tests again and its temporary server port was confirmed closed afterward.

## Limits

These checks establish a reproducible development baseline, not transaction proof
acceptance, application security, anonymity, censorship quality or production
readiness. The public-chain full journey, existing product defects, independent
review, operator acceptance and elapsed soak remain downstream gates. Hosted CI
has been authored and reviewed but has not been pushed or executed on GitHub.

## Evidence and reproduction

- Build/install commands and platform details: `BUILDING.md`, clean-build-result.json,
  docker-clean-result.json and their captured logs/input inventories.
- Exact byte comparison: build-comparison.log, docker-vs-macos-comparison.log and
  the three 33-output snapshots.
- Guard checks: final-guard-tests.log (105), clean-build-tests.log (93), docker-clean-build.log (93).
- Browser application adapters: browser-crs-adapters-smoke.json and stderr log.
- Actual offline CLI loader/generator paths: cli-sdk-smoke.json (5).
- Contract stateful tests and cleanup: noir-runner-final.log (59 + port closure).
- Existing moderation baseline: moderation-baseline.log.
- Dependency origins: noir-dependency-origins.json and noir-source-lock-check.json.
- Agent review: agent-review.md, final-agent-review.md; root disposition: review.md.

No runtime artifacts changed after the compared builds. Subsequent local changes
added runner cancellation handling and verification scripts, exercised by the final
macOS guard and Noir runs. CI includes those checks but hosted CI has not run.
The baseline 5.0.0 pin is deliberately not represented as production-compatible
with the currently advertised network. P04 owns the required supported-V5 upgrade.
X03 records the outstanding official deployment guidance.
