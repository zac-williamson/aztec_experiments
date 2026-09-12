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
