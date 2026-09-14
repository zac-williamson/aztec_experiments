# A02 native qualification — 2026-09-14

**Passed** under the publisher-checksummed workspace Node 24.21.0 runtime with
the frozen final npm lock. Raw commands, elapsed times, source fingerprints,
output hashes and process cleanup are retained in `native-qualification/`,
`native-qualification-supervisor.log` and `native-qualification-report.json`.

The run verified the expected package SHA
`d6d1aeda94123411327019e2e4b6caf1ff2a496bb9b0a2f1fcdf7b414bfafbfd`
and lock SHA
`4d7cbef3eb1a06797a08b0458ca7c0df93566efd72979573416d95c546372c93`
before starting. All 151 source files and two internal links remained unchanged
through the native run. All 34 complete generated outputs matched before and
after the application checks, without excluding metadata or proof material.

| Check | Actual outcome |
| --- | --- |
| Rebuild after clearing generated contract/SDK/apps directories | Passed, 25.971 s |
| Artifact integrity | Passed |
| Dependency regressions | 41/41 |
| Build guards | 171/171 |
| Interface/storage/protocol guards | 69/69 |
| Moderation/signing/daemon/wallet authority | 155/155 |
| Actual IndexedDB browser storage | Passed |
| Actual SDK browser/CRS consumers | 2/2, 5.242 s |
| Noir interface fixture | 22/22 |
| Solidity interface fixture | 7/7 |
| Portal regressions | 9/9 |
| CLI SDK lanes | 5/5 |
| Full Noir/TXE suite | 62/62, 267.583 s |
| Actual Docker model isolation | 2/2, 2.539 s |

The pinned Node container image was pulled by immutable digest before the real
isolation checks. Those checks awaited cleanup of their disposable containers,
networks, host listener and temporary fixtures. Every supervised native process
group was absent and its parent reaped at completion; the outer supervisor sent
no cleanup signals and no stage reached its outer deadline. The full Noir suite
retained its 1,200-second test and 60-second readiness limits, covered by a
1,320-second infrastructure wrapper. CLI lanes retained 120 seconds each,
covered by a 660-second wrapper. No suite assertions or source deadlines changed.

This native run **reused installed dependencies and existing compiler, Nargo
source and content-pinned CRS caches**. It is not evidence of a fresh installation
or cold CRS derivation. The separately supervised Linux build is responsible for
that qualification. Compiler manual-constraint diagnostics remain in the build
log and retain their prior review qualifications. TXE and SDK initialization are
not full-proof chain transactions or production cryptographic assurance. No
existing user wallet, funds or production RPC was used.

The final native reference is `native-qualification/outputs-after-checks.json`,
SHA-256 `c49ea5ff5915322e3ce58a03cf11309be6c5f1280df69289957cd772938f32bc`.
After successful source attestation, root authorized one documentation-only edit:
adding the existing dependency-test command to `BUILDING.md`. Its exact before
and after hashes are in `post-native-documentation-delta.json`. The Linux staged
151-file set is identical to native except for that recorded edit; the application
and test inputs did not change.
