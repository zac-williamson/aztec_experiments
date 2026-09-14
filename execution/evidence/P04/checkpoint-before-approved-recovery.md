Historical checkpoint before the user authorized Docker recovery; superseded by acceptance-status.md.

# P04 checkpoint — incomplete

The user confirmed a fresh deployment with no backward-compatibility requirement.
The current work removes old store factory aliases and database migration paths,
and defines one fresh board/service format. Current protocol compatibility and
recovery for newly created wallets remain required.

## Evidence available

- Contract and service interface specifications, independently reviewed; actual
  Noir packing/selectors and seven exact cross-language commitment vectors.
- Exact pre-portal configuration scope, canonical event cursors, receipt outcome
  semantics, private-field exclusions and model/policy identity handoffs.
- Matched Aztec5.2 / Noir beta25 dependency locks; all413 external source files
  compared with five official archives; standard HandshakeRegistry class/address
  recomputed and checked against locked Noir constants.
- Fully regenerated root build and isolated native build: all33 recorded outputs
  match without stripping metadata. Both final native guard runs pass110tests.
- Root interface/storage/baseline combined suite69, Noir62, moderation155 and
  graph29 checks passed at their recorded inputs. Final service/commitment suite
  passes33 and Solidity commitment suite7 in the isolated native copy.
- Actual fresh-store browser persistence/isolation and offline CLI SDK checks
  passed for the unchanged rebuilt SDK hash. The final CRS/browser check after
  manifest/client version corrections reached its120s evaluation timeout; it is
  not replaced by the earlier browser pass. Stage diagnosis completed the first adapter in114seconds, including109.6seconds
  inBN254initialization. The test is now qualifying each independent consumer in
  a fresh browser with its own unchanged120second budget; the first consumer again exceeded its budget during BN254 initialization.
  The second consumer and subsequent checks were not reached; no retry or pass
  was recorded. See browser-consumer-qualification.json. Only its test instrumentation changed after the latest build snapshot;
  it does not affect the33generated outputs.
- Linux fresh dependency/compiler installation and all7contract-stage outputs
  agree with root, including complete portal metadata and Noir verification keys.
  The remaining output comparison and post-build suites have not passed.

## Why completion is withheld

The Linux wrapper timed out after1200seconds while SDK bundling had no completion
output. Docker returned HTTP500; later inspection recovered, but removal and a
targeted command inside the owned container failed to stop it. Container
`billboard-p04-clean-7003ab9801` may remain running. The error is recorded in
clean-linux-run.json and cleanup/recovery evidence. Root has not restarted Docker
because that would interrupt all containers, including any unrelated user work.

P04-A01–A04 have design/fixture evidence, with actual implementation explicitly
assigned to downstream packages. P04-A05 remains open until the unresolved Linux
and final browser verification is completed. There is no P04 pass record and the
graph remains blocked rather than allowing dependent implementation to assume a
verified foundation. No production readiness, proof validity or deployment is
claimed.

## Resume

1. Obtain the user's Docker restart decision or confirmation they restarted it.
2. Verify the old owned container is gone/stopped; do not reuse uncertain runtime
   state or remove unrelated containers.
3. Complete the instrumented browser check with the same guards and bounded
   timeout; use its actual failing stage if further repair is needed.
4. Repeat the isolated Linux build serially with the final source. Compare all33
   outputs against root-clean-output-hashes.json and run its remaining suites.
5. Reconcile source hashes and reviews, record acceptance only if every criterion
   has evidence, then create the coherent local checkpoint and continue graph.next.

All26 compiler diagnostics and the exact-lock dependency advisories remain explicit
later proof/review and A02 requirements. X03 network release clearance, external
review and representative soak are additional production gates. Read-only W01
fee preparation is available but is not W01 implementation or acceptance.

The final checkpoint is source-candidate-003.json. Changes are preserved locally
and remain uncommitted because P04 acceptance is incomplete. No agent is running
further build or cleanup loops. A Docker restart was requested but not authorized.
