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

## C01 bounded implementation — 2026-09-14

Root owns Noir contract/helpers, affected ABI consumers, integration and graph.
Build_review owns portal source/tests and C01 portal evidence; exact constructor
and receipt handoff is recorded in evidence/C01/implementation-checkpoint.md.
Only this delegated lane is resumed. Heavy checks are coordinated serially.
Neither permissive mocks nor canonical bridge tests alone close real-proof gates.

C01 continuation: earlier portal/client ownership is released. Root owns all
contract and consumer integration. The sole reused agent owns only
`scripts/test-c01-native-proof.mjs` and its harness review, preparing a bounded
local proof plumbing experiment without running it. All other agents remain idle.

C01 checkpoint da5caf0: all101 Noir,29 portal,41 client/artifact checks, app build,
offline CLI and genuine native padding proof controls pass. Root owns bounded
33-chunk setup preparation. Build_review owns only the new BaseParity harness
and review. No concurrent proof runs; setup is temporary and must be removed
after qualification. The passing padding harness remains frozen.

BaseParity scalar-corruption and supervisor corrections are root-owned. The
single agent now owns only an explicit test-only WASM ACVM CLI adapter and its
review, for later actual server-wrapper qualification. No agent proof runs.

Root verified BaseParity, actual server padding and all ten adapter scenarios
serially. The reused agent's implementation ownership is released; its last
bounded lane reviews the server harness and identifies the next real-verifier
integration boundary. No other agent or heavy test runs concurrently.

Root owns new C01 real-network supervision and startup. Build_review owns only
scripts/c01-real-deployment.mjs plus its review, preparing direct local deployment
and runtime verifier identity checks without launching processes.

Real deployment/checker agent ownership released; root integrated passing checks.
Build_review now owns only scripts/c01-board-flow.mjs and review: prepare fresh
account and genuine board deployment proof without execution. Root owns genesis,
node and bounded proof supervision. All heavy runs remain serial.

Board/Ready/settlement helper ownership released after source review. Root runs
one genuine settlement experiment under the900s/8GiB supervisor. The reused
build_review agent owns only the application deployment activation API fix,
its focused behavioral test and review. No generated bundles or frozen proof
harness inputs may be edited during that run; no second heavy process is allowed.

Activation fix integrated and committed0d82197. Root owns source authentication
and next native runtime qualification. The sole build_review lane owns only
build-c01-avm.mjs and its review, preparing the bounded native build supervisor;
no agent build execution.

Root owns paused cache inventory, documentation and later serial runtime checks.
The reused build_review agent owns only build-c01-avm.mjs and c01-avm-runtime.mjs
for minimal provenance-bound incremental continuation. No agent heavy runs.

Native builder and loader frozen for root continuation. build_review now owns
only new c01-deposit-flow.mjs and its review, preparing real deposit/claim without
execution. Root owns integrated build/proof runs; no concurrent heavy work.

Ready settlement passed. Root owns full-journey parent/node integration and the
sole heavy run. Reused build_review owns only bridge-orchestration-review.md,
reviewing Ready wrapper and agent lifecycle against actual pinned SDK source.

Claim-inclusion diagnosis, pending negative controls and client-mining integration
reviews are complete. Root integrated changes and passed103 Noir/53 client checks
plus the actual zero-account mining lifecycle test. The reused build_review lane
is idle; root alone supervises the genuine full bridge retry. No agent or second
heavy process runs alongside the prover.

The reused review lane completed Noir-auth review, binding negatives and actual
broker retention regression preparation. Root ran2/2 broker,4/4 new binding,
29/29 portal and53/53 client checks, integrated retention64 and committed9faee45.
Review lane is idle. Root alone supervises full bridge session26546.

Root continues sole heavy C01 bridge run session26546. build_review is assigned
read-only C02 preparation with ownership only execution/evidence/C02/preparation.md;
no downstream implementation or application source edits during the active run.

build_review completed C02 read-only preparation and C01 closure coverage review.
No additional C01 defect was identified; genuine covering exit proof/refund and
final cleanup/source checks remain required. Agent idle; root supervises sole run.

Fresh C01 run: session15403, q4COio, source97a15c8. Root drafts C02 production
patch under execution/evidence/C02/; build_review owns tests-draft.patch and
notes only. Both remain unapplied until C01 closes; no parallel heavy checks.

C02 draft preparation complete: root production-draft.patch; build_review first
13 tests, second8 history tests, metadata/API review; all unapplied and unverified.
Agent idle. Root continues sole C01 genuine run and will apply only after closure.

2026-09-15 C02: root owns contract/test patch integration and TXE checks; build_review
owns scripts/c02-screening-flow.mjs and its notes only. Heavy checks remain bounded
and serial. No network prover.

C03: root owns all tests, clients, harness and integration; /root/build_review owns billboard/billboard_contract/src/main.nr and lib.nr only for independent post identity/public ordering. No concurrent heavy runs.

C03 core delivered to root. /root/build_review now owns only user/engine.js and censor/engine.js for posting/list/moderation ABI migration. Root owns Noir compile fixes, tests, proof harness and remaining consumers.

C03 current: root owns integration and batch-author claims/runtime; /root/build_review has delivered contention helper and reviewed batch claims, now read-only client retry review. No agent-heavy runs.

C03 instrumented rerun: root supervises sole genuine ten-author run with unchanged540s deadline. build_review delivered receipt progress capture and repaired two dummy retry propagation seams;174 integrated client/signer checks pass. Timing diagnosis is read-only and explicitly inconclusive pending receipt observations. Source frozen for run.

C03 closed: root verified genuine10-author run476849ms, integrated137Noir/174client/daemon/clock checks; build_review independently checked final runtime/source binding. All owned processes removed. Graph selected W01 fee integration next; C04 remains ready.

W01 resumed after C03: root owns sponsor/board/client architecture and integration; build_review gets bounded read-only owner/authwit/coupon interface review. No heavy processes running.

W01 continuation: root applied and corrected the 12 delegated-board tests, owns serial build/full-suite verification. The reused build_review lane separately reviewed immutable batch/window budgeting and now owns only an unapplied sponsor-contract/common-policy patch. Root owns source integration and final evidence; no concurrent heavy test jobs.

W01 next lane: root saved delegated and sponsor-contract milestones in243c2f9/8f5a517, owns browser/CLI wiring and the observed RPC credential-boundary repair. Reused build_review owns only shared/sponsor-client.mjs and scripts/test-sponsor-client.mjs: fixed routes, pre-signature class/scope/coupon/gas checks, and explicit no self-payer fallback. No genuine sponsor transaction result is claimed yet.

Continuation: build_review owns mandatory engine sponsor routing/CLI configuration and focused tests (preserving root RPC wrapper); build_verification inspects exact local shared FeeJuice funding APIs read-only. Root owns artifact integration and genuine proof harness. Heavy checks remain serialized.

Current W01 lanes: root integrates genuine funding/claim/exit/post, generated browsers and operator/CLI boundary. build_review implements encrypted local coupon provider/store; build_verification implements read-only registered-batch SDK helper after completing issuer core/HTTP transport. Earlier issuer findings independently reviewed and closed; heavy proof/browser checks remain serial.

W01 delivery integration: root owns SDK/engine callback and integrated checks. build_verification owns new sponsor-service/coupon-store.mjs and CLI durable-store tests; build_review owns read-only transport/state review. No concurrent heavy jobs.

Current: root owns genuine shared-batch HTTP/SQLite delivery integration and sole bounded proof run. artifact_regressions reviews harness read-only; build_review owns NEW registration-journal.mjs/test/evidence only after design. build_verification delivered CLI store16tests and is idle.

Continuation checkpoint: CLI/static-provider and registration-journal lanes delivered. Latest artifact_regressions review could not start because its usage quota was exhausted; no final independent disposition is claimed for the new anchor placement. Root inspected the narrow ordering change and supervises verification locally.

Root integration checkpoint: registration journal lane integrated with fixed operator worker and actual genuine101s restart qualification. Root found/fixed absent PublicImmutable lookup mismatch, verified54 component/10 contract/89 artifact-client controls serially, and rebuilt clients. Latest delegated review remains quota-unavailable; no independent signoff is claimed. No heavy test processes remain.

Private fee replacement: private_fee_contract owns newNoircontract/tests/workspace; private_fee_client owns newsharedfeeclient/paymentmethod/tests; private_fee_ui owns application/CLI/engine integration. Root owns oldcoupondeletion/buildscripts/artifactintegration/genuineproofharness. Heavy verification runs serially under existing bounds.

Private fee integration: contract lane delivered eight TXE checks and documented TXE setup-phase limitation; client lane delivered35 component checks plus actual production-helper funding/recovery harness; UI lane delivered17 focused checks including moderator routing. Root runs all heavy jobs serially. Independent client/contract reviews found and corrected the shared test funding identity and clarified public cold-start observations.

C04: history_contract owns exact-link utility implementation; history_tests owns TXE lifecycle/negative tests; history_pxe owns actual persistent PXE store selector/reload qualification. Root owns safe client integration, serial build/testing, genuine screening and evidence integration.

## C05 active lanes
- Contract lane: main.nr moderation metadata, deadline authentication and integration of checked economics.
- Economics lane: lib.nr checked transition helper and independent boundary vectors.
- Test lane: Noir application regressions and ABI adaptation.
- Root: shared/browser/service consumers, graph, integration and serial verification. No concurrent heavy builds/tests.

C05 lanes completed and root-integrated: contract/economics/test implementation,
independent consumer and arithmetic review, and actual-source browser feed tests.
Root ran all native verification serially, recorded C05 evidence, and retained
historical-policy recovery for M02. C06 preparation identified existing escrow
protection plus missing adversarial bridge/conservation tests and recovery runbook.

## C06 active lanes
- history_contract: new PortalReentrancy.t.sol adversarial Inbox/Outbox callback tests.
- history_tests: new PortalConservation.t.sol generated conservation sequences.
- history_pxe: recovery runbook from actual CLI/wallet code.
- Root: integration, serial Forge verification, source/artifact comparison and evidence.

## A01 active lanes
- history_contract: read-only current consumer ABI/artifact audit.
- history_tests: CI drift protection and associated tests, disjoint from root manifest.
- history_pxe: read-only provenance coverage audit.
- Root: aggregate release manifest implementation and serial integrated checks.

A01 lanes completed: consumer fee-route repair, CI/provenance implementation and independent bounded final review integrated. Root verified 108 checks, daemon/signer checks, two frontend rebuilds and aggregate; native jobs remained serial/unused.

## W02 active lanes
- history_contract: read-only wallet/key/recovery audit and recommended narrow supported route.
- history_pxe: CLI private cache/network context inspection and bounded design; no edits until root allocates.
- history_tests: browser claim-secret storage/export/restore inspection and bounded design; no edits until root allocates.
- Root: shared wallet UI/context design, integration and serial verification.

W02 integration: three implementation lanes delivered focused tests. Root completed actual two-profile browser recovery; genuine restored-author private-fee/post run is active under540s. Final additional reviewer turns hit account usage limits; root owns remaining inspection and does not claim delegated final signoff on subsequent changes. No concurrent native jobs.

W02 closed by root: actual browser restore/tab exclusion, genuine restored signing authority, integrated tests and artifact checks passed. Final code review self-performed after delegated quota exhaustion; no external review claim. No heavy jobs remain.

## W03 receipt/history milestone
Root implemented and self-reviewed receipt classification, historical withdrawal lookup and settlement outcomes. Prior final delegated turns exhausted available quota; no additional independent signoff is claimed. Integrated checks, built-browser recovery and CLI SDK checks passed. Durable transaction journal remains next.

## W03 encrypted L2 recovery milestone (2026-09-16)
Root implemented browser/CLI encrypted pre-broadcast storage, exact-byte recovery,
canonical acknowledgement and active-engine integration. Existing errored agents
still report usage exhaustion; no replacement agents were spawned to evade it.
Root added independent storage, process-death, actual browser reload and engine
ordering tests, then performed diff review. This remains self-review; production
independent review is not claimed. Ethereum and other remaining W03 lanes are open.

## W03 Ethereum recovery milestone (2026-09-16)
Root implemented encrypted Ethereum intents and canonical transaction/event
verification, integrated browser/CLI recovery, and extracted shared encrypted-slot
storage. Existing delegated quota failures remain; no independent signoff claimed.
Root tested storage/nonce/event/reorg/cursor boundaries, real local Ethereum portal
deposit/refund after lost responses, and actual built-browser reload. Root reviewed
signer-call ordering, exact-nonce retry and canonical acknowledgement separately
from implementation. Remaining W03 work is recorded in the graph checkpoint.

## Resumed recovery review

- recovery_review: read-only review of withdrawal absence handling and regression scope; no heavy jobs. Root implements remaining stale-action recovery. AI review does not replace external audit.

Recovery reviewer delivered application-nullifier helper and25 fixture tests, native attribution helper, and read-only claim/note/journal reviews. Root integrated expected-note selection, addressed receipt scope/timeouts and step-guard lifetime, and ran the genuine qualification. No external audit signoff is implied.

## Remaining W03 consumers

- recovery_review: owns apps/src/fee-juice/engine.js and scripts/test-private-fee-funding-engine.mjs for exact funding-claim recovery, plus only necessary related new focused tests. No shared journal/SDK/build edits or heavy jobs.
- Root: deploy engine/tests and integration; later moderator recovery.

## F01 public feed

- recovery_review implemented the lightweight event adapter/build metadata and actual SDK serialization tests; then added independent index/configuration probes and reviews.
- Root owns durable index, public RPC/configuration, browser/CLI integration, build provenance and integrated qualification. Heavy checks run serially. No external audit signoff implied.

## M02 durable moderation

- Earlier queue and signer lanes implemented durable jobs and structured read-only recovery.
- moderation_queue_review owns queue rollover regression and fix only.
- moderation_integration_review independently reviews worker, signer, daemon and receipt integration without editing.
- Root integrates, verifies serially, documents and commits. AI review is not external audit.
