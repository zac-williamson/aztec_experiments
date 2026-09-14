# A02 acceptance coverage ledger — independent evidence review

Checkpoint 2026-09-14. No A02 completion record is supplied by this ledger. This is a read-only review of actual source, records and logs; no heavy test, build, browser, container or application/graph mutation was performed in this lane. Root owns final acceptance and will supply its final draft for artifact/criterion binding review.

**Native qualification is complete in its raw result: all 20 stages passed. Independent clean Linux reproduction and its final source/output/extraction/cleanup evidence remain pending.** Root may continue assembling evidence, but A02-A03 and overall A02 acceptance stay open until those results exist. The rows below distinguish supported observations from package completion.

## Criterion coverage

| Criterion | Checkpoint result | Evidence and exact scope |
| --- | --- | --- |
| **A02-A01: fresh exact-lock advisory inventory, paths/context/reachability** | **Pass supported** | Same-day preparation retains original root/portal reports, context and affected paths. Authoritative current reports are `dependency-remediation/jaeger-only/audit-{all,production}.json`, with final lock hash4d7c… and actual inventory/context. They contain48 all/19 production package entries, zero high/critical, retaining all eight old core paths and dev elliptic. Runtime provenance separately binds Node24.21/embeddedUndici7.29.1 and the pinned official image; this does not claim an OS-image package audit. Current native SDK inventory and actual consumer evidence distinguish deployed bundle inputs, native configuration, developer tools and embedded TXE limits. |
| **A02-A02: verified fixes for known reachable high/critical; reviewed exclusions** | **Pass supported for scoped remediation** | Actual final package paths/pins are recorded by the dependency lane. The combined final-lock native dependency suite passed41 checks:31 consumer plus10 parser/UUID. Jaeger2.9 is an actual fix across the preserved SDK/core1 parent boundary, including malformed trace/baggage, prior-global and environment-selected SDK behavior; no high Jaeger exemption relies on clean startup. tmp0.2.7 supersedes the provisional0.2.6 bypass; Undici/npm and embedded Node fixes are distinct. There is no zero-vulnerability, all-code-unreachable or external-assurance claim. Overall integration remains tied to A03. |
| **A02-A03: Aztec compatibility, reproducible outputs and affected tests** | **Pending independent Linux qualification** | Native final raw record passes20 stages under Node24.21, including full rebuild,41dependency,171build,69interface,155moderation, storage/browser,22Noirfixture,7Solidity,9portal,5CLI,62Noir/TXE and2actual model-isolation checks. Native34-output snapshots are identical before/after those tests. Existing Aztec5.2/Noirbeta25 pins remain coordinated. This native result does not stand in for the assigned clean Linux build and exact34-output comparison/extraction/cleanup. Final source reconciliation and owner report are still needed. |
| **A02-A04: explicit lower-severity/tooling treatment and release references** | **Pass supported as documented treatment, future controls open** | `residual-release-register.json` hashes the exact48-entry inventory, all8core/elliptic paths, embeddedTXE scope, owners and reopening triggers. `residual-independent-review.md` verifies current SDK manifest observations and the actual limits of current startup/tooling. D01 now depends on A02; D01-A05/T05-A05 require executable launch/real-key/packaging controls and final dependency/disposition files; R01 carries the register into external review. Future release manifest/inventory files are explicitly uncreated. A02 does not claim these production controls implemented or release eligible. |

Paths in this ledger are relative to `execution/evidence/A02/` unless a repository path is given. A supported criterion observation does not authorize marking the whole package done while another remains pending.

## Native raw result independently checked

`native-qualification/result.json` reports `pass` for20 stages. Each recorded stage has exit0, parent reaped and process group absent. The following observed counts were reconciled against raw logs rather than inferred from command names:

- `dependency-tests.log`:41pass,0fail/skip; `build-tests.log`:171pass,0fail/skip; `interfaces.log`:69pass,0fail/skip.
- `moderation.log`:75moderation +53signer +17daemon integration +10wallet-authority =155 passing cases. Mock daemon infrastructure is not a production-network acceptance claim.
- `noir-interface.log`:22; `solidity-interface.log`:7; `portal-regressions.log`:9; `full-noir.log`:62 plus zero tests in the contract package. Full Noir took267.583seconds and records normal TXE termination.
- `cli-sdk.log`:five actual extracted-function SDK lanes, outcome pass under24.21, with source hashes matching current CLI/shared inputs. It does not execute live commands/main functions or existing wallets.
- `sdk-browser.log`:both actual consumers pass with75,497,472 bytes/1,179,648 points, unchanged Buffer/Poseidon/SQLite/worker/isolation controls; evaluation durations1,170ms and1,025ms. Recorded source hashes match. `storage-browser.log` separately reports successful actual fresh-store persistence/isolation.
- `docker-isolation.log`:2/2 pass; actual container uses UID/GID65532, no effective capabilities/default route, read-only root/model, writable temporary area, and cannot read dummy host signer material/environment or reach a controlled host service that the positive control reaches. This is the maintained local isolation test with the new image, not broad production model/network assurance.

Native build clearing is explicit in `cleared-generated-paths.json`: target/out/cache, SDK/contract manifests and apps/dist were removed. Installed pinned dependencies/tools and content-addressed CRS cache remained available; this is not a fresh dependency installation. The clean Linux lane must independently establish its own absent caches and input provenance.

All151 hashes in `source-before.json` match `source-after.json` and the current workspace at this checkpoint; the two approved symlinks also match. The native34-file maps in `outputs-after-build.json` and `outputs-after-checks.json` are exactly equal, SHA-256 `c49ea5ff5915322e3ce58a03cf11309be6c5f1280df69289957cd772938f32bc`. Against the retained historical34-file reference,31 outputs are unchanged; only the contracts provenance manifest and two SDK manifest copies changed. No fields or outputs were omitted. This is a native before/after result, not the still-pending cross-platform comparison.

## Source review, history and final reconciliation

The integrated tracked diff changes Node pins/CI/image references, dependency overrides and test integration, build documentation and generated provenance. New maintained dependency tests are additional untracked-at-review source files that the final inventory must include. Current package changes preserve existing Aztec and OTelcore1.x entries, while adding Jaeger's own core2.9. The source review records the major-override and image/runtime limits; raw checks qualify the affected API boundaries.

The independent integration-source review found Linux launcher extraction/cleanup and ambiguous-create handling issues before launch; it records their source-level corrections and consistent helper hashes. That review supplies no Linux run result. Its noted manual dependency-test documentation addition must be reconciled when root/verification finalizes staging. At this checkpoint native BUILDING.md is bound to eab87a3ae3282acaac1bb4c8219759d5a330aa9b25109877e91a2df41b3ff7d1; if the small command-list addition happens afterward, preserve native source-before unchanged, record the documentation-only delta and use current bytes in Linux staging/final source. Do not silently rewrite a past attestation.

Historical temporary-file/sandbox/Jaeger observations and older audits remain valid records of their own stages. The authoritative current-lock audits live under jaeger-only; filenames such as final-audit in the parent directory are not a reason to adopt superseded counts. The final31consumer suite replaces intentionally known-bad Jaeger assertions and retains the pre-fix source/logs. Current native41-case integration supplies final-lock binding for parser and consumer behavior.

Still required before final A02 record review:

1. Independent Linux owner result with exact staged/current input and helper attestation, absent dependency/cache/output context, bounded stage outcomes, all34 whole-output comparison against the native reference, extracted expected logs/results and successful owned-container cleanup/confirmed absence. Any failed or unrun stage must stay distinct.
2. Owner's final native report/source reconciliation, including any documentation-only delta and confirmation of recorded cleanup. Do not infer new outcomes from a live stage or a wrapper exit alone.
3. Final current application source inventory/fingerprint and generated SDK manifest binding, plus exact artifact hashes and all four criterion references in root's draft A02 record. Reconcile historical source-specific reviews rather than treating their old whole-lock hashes as current.
4. Root graph/evidence validation and independent final binding review. External release audit, current network clearance, genuine proof journeys, representative soak and all downstream production controls remain unwaived.

## Checkpoint evidence hashes

These bind completed evidence inspected here; mutable live-run/final-record files will require fresh binding at final review.

| Input | SHA-256 |
| --- | --- |
| `native-qualification/result.json` | `1eb5af30131c5ec6b07a2a74fad01714c9583e60b52102f2e80b8c488aac49df` |
| `native-qualification/steps.json` | `03dc23a7f6a58f72ad32832a0403985276f74c25049df5b4246f1a3529428775` |
| `native-qualification/source-before.json` | `d570e6e3dceb9c133e543a98d1bc0e12dc7bbe02d3d713f60ede3f8affd3a61b` |
| `native-qualification/source-after.json` | `8702360e90c5a07a901828ec9bfafd5d208c9a40ce3016207aaaae1e3c6dcae9` |
| `native-qualification/outputs-after-build.json` | `c49ea5ff5915322e3ce58a03cf11309be6c5f1280df69289957cd772938f32bc` |
| `native-qualification/outputs-after-checks.json` | `c49ea5ff5915322e3ce58a03cf11309be6c5f1280df69289957cd772938f32bc` |
| `native-qualification/dependency-tests.log` | `6822b69ac0a5f6af6a413640ce0ab7d5403a2b4f11a913e9b52e457bc217670a` |
| `native-qualification/sdk-browser.log` | `7c9d0ec37f8961068facd333ff8d8b3c6ccf29b1bedc7ed3a32ab1093d87761b` |
| `native-qualification/full-noir.log` | `9f34a4d2979bf82b561fd716f71d22811893a2a09547c588c81a1e79e24c40b9` |
| `native-qualification/docker-isolation.log` | `f6c165a96bc31301d28f7a1a767e4edea229bc2878495e6885d3fa94e61f4812` |
| `dependency-remediation/jaeger-only/audit-context.json` | `627251175853d73448f1be3c4f37426367933cd3cd4a7cca7075d72a6ed33db7` |
| `dependency-remediation/jaeger-only/residual-inventory.json` | `802aa742972ba22687211a65b3745ed2ce27bfa5afd6ab8e36fb5d1faf00671d` |
| `residual-release-register.json` | `c4eb9a5df183576c9d818f2cda103f9e8727685f21f7f69b47695793bae6abb9` |
| `residual-independent-review.md` | `d2995342f93649f5ae4afabd74877e9e4905e87ed82adc42f9abdaff8f75d552` |
| `integration-source-review.md` | `4e9427afa15d6dfd5dffcf772c2857f60bee1fbbf356c7068c1f4040ed27661a` |
