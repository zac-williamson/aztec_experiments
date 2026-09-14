# P04 matched dependency migration

This lane changes the fresh-deployment baseline to Aztec 5.2.0 and Noir 1.0.0-beta.25. Node remains exactly 24.15.0 and Foundry remains 1.4.1. It does not preserve an older deployed board format or qualify a production network.

## Performed

- Updated all direct root Aztec dependencies, the portal L1-artifact dependency, and their npm locks together. Ran `npm install --ignore-scripts` in both directories. Root install exited 0 (5 added, 6 removed, 57 changed); portal install exited 0 (1 changed). All 50 installed Aztec packages in the root lock are 5.2.0. Lifecycle scripts were not executed. Clean `npm ci` acceptance belongs to the central isolated build after source freeze; this lane did not replace modules during the SDK agent's work.
- Updated both local Aztec Noir tags to v5.2.0. Retained existing exact Keccak and recursive hashing-library tags; every resolved source file remains content-locked.
- Ran the existing checksum-verifying compiler bootstrap with Node 24.15.0. The downloaded Darwin ARM64 archive matches `63ed453d09a65bfc78eef63252423126959d41c85de0da0cf54289c5e266ceb5`; the executable identifies beta.25 commit `75061fab15986eedee4e7d9104ff87dd9fa4ca10`. Native BB identifies 5.2.0. The other three bootstrap platform hashes come from publisher metadata verified during preparation; their archives were not downloaded in this lane.
- Copied only the local Noir workspace to `.build/P04-source-lock`, compiled there using `../toolchain/nargo compile --workspace --force --silence-warnings`, and prepared an explicit candidate lock with `scripts/prepare-noir-lock.py`. Shared canonical artifacts were not updated by this lane. Source resolution fetched fresh v5.2 Aztec repositories; the three unchanged Noir hashing libraries were already cached and are independently compared to fresh archives before lock acceptance.
- Candidate inventory: six recursive external packages, 413 package manifest/source files, 121 embedded compiler source entries, and three local manifests. Compared with the prior content lock, 40 Aztec-NR files and three protocol-type files changed. The serde and three hashing package file inventories are unchanged. Full changed-file list is `toolchain-noir-lock-diff.json`.
- Existing dependency guard tests pass 6/6. The new candidate generator was syntax-checked and exercised on actual compiler output; it does not authenticate its generated inventory. The read-only origin verifier accepts an explicit candidate `--lock` path so a candidate can be checked before activation.

## Compiler diagnostics and limitations

The isolated compile exited 0 and emitted a 33-function artifact, but emitted 26 constraint-coverage diagnostics at 12 source locations in Aztec-NR. No constraint checker was disabled and no diagnostic was treated as resolved because the command succeeded. Full output is `toolchain-inventory-compile.log`; normalized locations/call stacks are `toolchain-compiler-diagnostics.json`. Beta.25's saved `compile --help` has no `--enable-brillig-constraints-check-lookback` option, so no unsupported lookback flag was used. Root owns their separate disposition and the integrated build/tests.

The npm advisory snapshot is retained and classified in `toolchain-advisories.md` and its linked JSON. It is a residual dependency-review input, not an application exploitability claim. No audit-fix changes or package overrides were applied.

No live RPC, real wallet, funds, transactions, public deployment, or proof-generation acceptance was used in this lane. Official dependency origin equality is not an independent security audit. The source-lock verification outcome is recorded separately in `toolchain-noir-origins.json`; final activation must require that report to pass and match the candidate lock hash.

## Activated source lock

All five fresh official commit archives passed comparison for all 413 files. The report lock hash equals the activated `noir-dependencies.json` SHA-256 `2ecbc7e0e2bb14ac890f554ef38a7713b1a27e16e0dee0324bd600aff3db50ba`. The monorepo commit is `49a592109ec4f18d79212b43d621891aaf36f7b6`; Aztec-NR is `22e152679f69a2307fdb1b17f60fd4f51a3fd4f5`. Exact resolution URLs, commit archive URLs, downloaded archive hashes/byte sizes, and every compared file hash are in `toolchain-noir-origins.json`.

After activation, the unchanged `check-noir-dependencies.mjs` passed on the isolated artifact with diagnostic paths normalized: six packages, 413 tree files, and 121 embedded source entries. This check is in `toolchain-source-lock-check.log`. The integration owner was notified that package, compiler, Nargo manifests and the verified source lock are frozen for the central build.
