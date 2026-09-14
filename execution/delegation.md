# Delegated execution

User explicitly requested substantial subagent delegation on 2026-09-11.
The earlier single-agent default is superseded. The dependency graph remains
the package scheduler; this ledger records bounded agent assignments within it.

| Package / lane | Agent | File ownership | Acceptance contribution | State |
|---|---|---|---|---|
| P02 integration | root | Existing build scripts, dependencies, source artifacts, graph/evidence | Clean builds and integration; final gate ownership | completed and integrated at b1e75fe |
| P02 build verification | build_verification | BUILDING.md, .github/workflows/build.yml, scripts/check-reproducibility.mjs | P02-A01/A02; clean build instructions and CI | completed and integrated at b1e75fe |
| P02 artifact regressions | artifact_regressions | scripts/test-artifacts.mjs, scripts/tests/ | P02-A03; discriminating stale artifact tests | completed and integrated at b1e75fe |
| P02 review | build_review | execution/evidence/P02/agent-review.md only; source read-only | Independent AI code review; root dispositions required | completed and integrated at b1e75fe |

Agents report changed files, executed checks, failures and unresolved assumptions.
Root reviews and integrates results, reruns affected acceptance checks, and hashes
evidence before changing a package to done. Agent completion alone cannot pass
a gate. AI review does not replace the external review required by X01/X02.

At each package boundary, assign ready implementation and testing work to agents
where ownership is separable, and reserve review capacity before integration.
Do not run a dependent package against an unverified assumption from its parent.

## P02 first handoff and follow-up

- `build_verification` delivered clean build documentation, pinned CI workflow and
  exact byte comparator. Root is validating a separate clean installation.
  Follow-up: lock transitive Noir dependency source bytes and verify them.
- `artifact_regressions` delivered 56 passing contract/SDK guard tests and a reusable
  SDK verifier, now integrated by root. Follow-up: update four CRS consumers to
  pinned V5 formats and verify runtime bytes.
- `build_review` independently reproduced the missing browser `Buffer` global;
  root fixed it and reran the real browser smoke test successfully. The review
  also identified stale SDK input checks, two old bundle paths and TXE target
  binding, now corrected. Follow-up: provision verified official V5 CRS assets.
- The review found the bundled Grumpkin CRS differs from V5's official version.
  Provisioning and consumer changes are being coordinated before P02 acceptance.

These handoffs are implementation evidence, not package completion. P02 remains
active until the integrated clean builds and affected tests pass.

## P02 final verification lanes

- `build_verification`: independent clean-directory build completed; all 33 outputs
  match root byte-for-byte. Now testing a disposable Linux container with empty
  dependency caches, fresh pinned tools, and no host home or wallet mounts.
- `artifact_regressions`: five offline CLI SDK cases passed. Fixed and tested
  test-runner cancellation and child shutdown; 12 lifecycle checks passed; final
  59-test Noir suite is running through that repaired runner.
- `build_review`: found and reviewed repair of the additional deployment adapter.
  All four generated apps include the common CRS client; actual browser tests
  exercise both shared and engine initialization. Current network research is
  recorded and P03 evidence mapping is being prepared read-only.
- Root: integrated all owned changes, checked exact build equality, owns graph
  transitions, final source/evidence binding and local commits.

X03 is blocked solely as an external production-release gate under the currently
inspected official notice. P04 includes the required current V5 compatibility
upgrade. Neither condition stops unrelated internal implementation.

## M01 assignments

| Lane | Agent | Write ownership |
|---|---|---|
| Signer command interface and daemon integration | build_verification | censor-daemon/daemon.mjs, new signer module(s), daemon integration tests |
| Verdict schema and adversarial boundary tests | artifact_regressions | censor-daemon/moderation.mjs, test_moderation.mjs, new signer/verdict regression tests |
| Model isolation and operator instructions | build_review | new model container/runtime files, model isolation tests, censor-daemon/README.md |
| Integration | root | graph/evidence, package/test entry points, final review and targeted fixes after ownership handoff |

All lanes coordinate explicit interfaces. Model output is bounded data; trusted
configuration fixes the executable, operation, wallet path and destination. The
model runtime must lack signer filesystem/environment access; simply separating
JavaScript modules does not satisfy this requirement. Runtime/model version and
quality acceptance remain additional M03 work.

## M01 integration checkpoint

Root integrated 155 parser/signer/daemon/wallet checks and five offline SDK smoke
cases, all passed. Wallet authority now excludes unrelated user wallets for censor
operations. Administrative policy engine initialization remains M02 work.
`artifact_regressions` independently reviews the wallet boundary;
`build_verification` independently reviews the model runtime implemented by
`build_review`. Actual Docker isolation uses disposable fixtures, no real wallets.
CI now invokes this profile separately; hosted CI execution remains unobserved.

M01 completed after all three implementation handoffs and two cross-reviews.
Actual isolation tests passed after cleanup, gateway and disconnect fixes; root
bound current source and all four criteria to evidence/M01.json. The next graph
package is P03; deployment readiness is still incomplete.

## P03 assignments (after M01 commit824bc33)

| Lane | Agent | Ownership |
|---|---|---|
| Actual portal bytecode/accounting and bad fixture | build_review | billboard/portal/test/, necessary test fixtures/config, P03 portal evidence |
| Actual Noir note-history boundary | build_verification | billboard Noir test module only, P03 Noir evidence |
| Actual wallet receipt regressions | artifact_regressions | shared wallet test seam if required, scripts/test-receipt-baseline.mjs, P03 receipt evidence |
| Integration and regression mapping | root | graph, B01-B12 matrix, historical inert shell construction fixture/tests, final checks/review |

These tests distinguish present failures from fixed controls; baseline defect
observations are not claims of production correctness. No real funds, existing
wallets or external attack targets are used. New extraction should preserve actual
behavior and avoid source slicing. Root coordinates any necessary source ownership
changes and tests affected generated assets before integrating them.

P03 history lane update: build_verification stopped with an automated content
flag before editing tests (recorded in history-lane-interruption.md). Root assumed
its test ownership and is running bounded local note-history controls. The portal
lane completed nine tests and now independently reviews the shell/receipt harness.
Receipt implementation continues in artifact_regressions. No article was removed.

P03 integration complete: portal9, shell/receipt14, Noir62, moderation155 and
build105 checks passed. Independent AI reviews cover root shell/history and
receipt code. Known-bad outcomes remain assigned to repair nodes. Root preserved
actual source/evidence hashes and prepares the local checkpoint; P04 compatibility
research is preparation only, not a completed migration.

## P04 assignments (after P03 commit 5432fc6)

| Lane | Agent | Ownership |
|---|---|---|
| Matched dependency/toolchain and Noir origin pins | build_verification | package manifests/locks, toolchain.json, Noir manifests/lock, provenance helpers as needed |
| SDK storage compatibility and consumer adaptation | artifact_regressions | shared SDK/storage adapters, affected CLI/browser consumers and adapter tests |
| Contract interface design and fixture review | build_review | execution/interface-spec.md, execution/evidence/P04/interface-design.md; source read-only |
| Integration | root | graph, service schema fixtures, build manifests, integrated verification and review |

Pinned version compatibility does not lift the X03 production deployment pause.
No protocol retarget, production transaction, existing wallet or paid service is
used. Note/receipt defects retain their later implementation gates; P04 freezes
interfaces and validates the supported tooling combination before those edits.

P04 user clarification: no deployed board versions; backward compatibility is
not required. All three agents were steered to fresh-deployment interfaces. The
storage lane removes legacy migration/compatibility paths while retaining scoped
new-store persistence. Historical fixtures remain diagnostic evidence only.

## P04 final integration and verification

- artifact_regressions completed fresh-store adaptation, real browser persistence,
  actual Noir packing/selectors and cross-language commitment fixtures. It fixed
  the pre-portal configuration API ordering issue and now reviews shared service
  semantics independently.
- build_verification completed matched5.2 locks, official source verification,
  diagnostic accounting and advisory inventory. It now runs an empty-cache Linux
  build with a disposable pinned container and no user wallet or home mounts.
- build_review completed contract design and independent fixture review. It now
  runs a fresh native macOS dependency/build lane; shared verified compiler caches
  are recorded explicitly.
- Root integrated shared protocol validators, Solidity fixtures, service handoff,
  CI checks and final root test suites. Application inputs are frozen while both
  clean builds compare33outputs against root-output-hashes.json.

These are separate actual agents and checks, not simulated roles. Their reviews
remain AI review; external cryptographic review and production evidence are later
mandatory gates. Dependency advisories are assigned to A02 and compiler diagnostic
qualifications to final proof/review gates, rather than being silently waived.

P04 blocked checkpoint: all three delegated lanes have returned. Native builds
match all 33 recorded outputs and pass 110 guards. Linux installed and compiled
fresh dependencies but stalled during SDK bundling; only seven contract outputs
are verified. Docker cannot confirm cleanup of the owned test container. Browser
diagnosis and a separately bounded consumer run preserve actual initialization
timeouts. Root retains P04 as blocked pending Docker recovery approval and renewed
verification. No pass record, commit, production claim or background retry is made.

## Authorized recovery and serial verification

The user approved restarting Docker and continuing. Root performed the restart
and verified both engine health and absence of the old test container.
Build_review owns one unchanged browser qualification retry; build_verification
prepares a fresh isolated Linux retry and waits for browser completion. Expensive
runs are serialized. Artifact_regressions prepares dependency advisory options
read-only for A02. Root integrates results, maintains gates and owns acceptance.

Current recovery checkpoint: browser retry failed at navigation before SDK evaluation; its failure is retained. Build_verification is executing the isolated no-mount Linux retry. Build_review completed the read-only CRS startup options and now reviews the navigation harness. Artifact_regressions completed A02 dependency preparation and now prepares the C01 implementation handoff read-only. These preparations do not bypass P04. Root confirmed removal of only the two obsolete task-owned build copies after preserving evidence and retry recipes.

P04 format experiment: build_review owns one600-second actual pinned5.2 WASM compressed/uncompressed comparison, writing only ignored derived data and evidence. Build_verification holds Linux retry2 before launch because build inputs may change. Artifact_regressions rechecks current official V5 clearance read-only. Root owns the adoption decision, source scope, integration and graph; no production CRS format has changed yet.

## P04 derived setup implementation

- build_verification owns build-crs, bounded derivation helper, schema2 manifest, build guards, app asset verification and exact-output comparator. No heavy build until integration.
- build_review owns runtime CRS selection/verification and consumer regressions; compressed fallback remains checked, and response shape is selected by authenticated format.
- artifact_regressions finishes current official V5 clearance recheck, then is available for independent cross-review.
- Root owns adoption, graph, integration, source/evidence renewal and serial actual browser/Linux qualification.

The experiment preserved every point and pin; observed Node timing motivates the change but does not prove browser performance. New full-output comparisons include derived data and invalidate any attempt to reuse the old33-file comparison as current acceptance.

Frozen candidate verification: build_verification is running Linux retry2 against147attested sourcefiles and34outputs. Build_review completed read-only SDK startup attribution; lazy-provider/code-splitting work is handed to U01/T04, without changing the candidate during verification. Artifact_regressions completed independent derived-CRS review and linked the171-test integrated pass. Root supervises evidence/cleanup and the outstanding browser qualification.

Latest checkpoint: retry2 stopped at portal-install EACCES and was cleaned up.
Build_verification reproduced and fixed archive ownership without relaxing
container restrictions; retry3 passed source, link, fresh-cache and40 writable
directory checks, both dependency installations and compiler bootstrap. It owns
the supervised full build,34-output comparison, remaining suites and cleanup.
Artifact_regressions completed C01 real-proof environment preparation and now
audits P04 criterion-to-evidence coverage read-only. Build_review is idle after
the SDK startup review. Root integrates the acceptance ledger and supervises the
remaining browser check; heavy runs remain serial and application inputs frozen.

Completed verification run: retry3's fresh Linux build passed and all34 full
outputs exactly match root. Its171 build and69 interface/baseline tests passed;
the additional Noir fixture stopped at its120-second deadline after10 of22 cases,
with later suites not reached. Build_verification extracted evidence, confirmed
unchanged147 source inputs/two links, and removed the owned container. Root
recorded post-cleanup9.3GiB swap/competing workloads, retained P04 as blocked,
and did not repeat heavy checks under unchanged conditions. Artifact_regressions
is completing the criterion/evidence audit; all independent preparations remain
preparations, not downstream acceptance. No heavy work is running in this task.

## Resume after user reboot —2026-09-14

The user explicitly resumed checks and graph execution after restarting the Mac.
Build_review owns one bounded actual browser qualification on current frozen inputs.
Build_verification prepares focused remaining contract checks and waits for root
to release the next heavy slot; the completed34-output clean build is retained.
Artifact_regressions independently reconciles source/evidence and prepares closure
coverage. Root owns status, integration, final acceptance and next-package selection.
No old process IDs are acted on and no large clean-build copies are recreated.

## P04 accepted —2026-09-14

Build_review completed both actualbrowser checks; build_verification completed
22Noir/7Solidity/9portal/5CLI/62Noir-TXE focused nativechecks withcleanup andunchanged
source/output hashes. Artifact_regressions independently verified the finalrecord,
all90pre-review artifacthashes andrawoutcomes; root boundthatreview asthe91startifact.
P04 isdone. AllP04heavy workended; A02read-onlyinventory preparation isready.

## A02 execution lanes —2026-09-14

- Build_review owns package.json/package-lock.json and narrowdependencyupdates,
  exactversion/advisory reports; allAztecpackages remain5.2.
- Build_verification owns toolchain.json,.nvmrc,CI runtimepin,BUILDING.md and an
  isolatedworkspace Node24.21 runtime; itprepares affectedbuild qualification.
- Artifact_regressions owns new focusednative dependencybehavior tests under scripts/
  and independent advisory applicability review, initiallywithout runningheavytests.
- Root owns graph, integration, serialverification and finaladvisorydisposition.

No successfulP04test isrelabelled asA02acceptance. Dependency/runtimechanges will
rebindaffectedbuild inputs andrequirecurrentconsumerchecks beforeclosingA02.

## A02 frozen candidate qualification

Build_verification owns serial native qualification on151 attested source files and
two links, with existing host caches recorded; Linux remains held for the native
output reference. Build_review independently reviews runtime pins, root parser
controls and the isolated Linux recipe. Artifact_regressions independently reviews
remaining advisory applicability and precise release treatment after completing
31 consumer controls. Root owns graph transitions, final disposition and integration.
No large duplicate native checkout is created. The Linux helper must require
evidence extraction and verified owned-container cleanup before reporting success.

## A02 accepted after bounded verification

Native qualification and clean Linux retry2 passed; root independently compared
all34 output hashes and raw stage/cleanup results. The first Linux build succeeded
but process cleanup failed. A tiny actual zombie-reaping diagnostic justified
Docker init for the retry; no test requirement was relaxed. All containers and
staging copies were removed. Independent source/applicability reviews and root
final integration are bound in A02 evidence. After the user's model-setting
change, only the verification lane was resumed; completed reviews were reused.

## W01 bounded implementation

Build_review owns a minimal Noir sponsor/delegated-operation fixture and its
constraint tests under billboard/fee-fixture, plus W01 evidence. Root owns the
disposable local network/client observation harness, graph and integration. Heavy
work is serialized; remaining agents stay idle until independent review is needed.
The fixture must establish API/constraint feasibility before production ABI or
issuer service implementation. No existing wallets or real funds are used.

The fixture and verified local lifecycle harness are committed as30c8099.
Build_review now owns scripts/fee-composition.mjs: fresh accounts, deployment,
root sponsor payment and explicit balance/replay observations. Root owns parent
supervision and worker integration, runs the composed check and reviews evidence.
Only this one delegated lane is active; heavy checks remain serial.
