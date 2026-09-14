# P04 integration review

Root integrates three actual delegated lanes recorded in delegation.md. This is
AI implementation and review, not the external Aztec/Noir/Solidity review required
for release. The current package freezes a fresh-deployment design and verifies
the matched toolchain; C01–C06, W01–W03 and U01, F01 and M02 still implement its production
behavior.

## Findings resolved during integration

- The current SDK removed the old IndexedDB factory. The shared adapter now uses
  the actual 5.2 store API, complete account/network identity and the upstream PXE
  schema. User clarification removed legacy migration and alias requirements.
  Disposable actual-browser persistence and isolation tests supplement Node tests.
- Contract note packing was checked in the actual compiler. Unsigned unpacking
  truncates, and EthAddress needs explicit validation. The interface distinguishes
  raw canonical packing checks from typed constrained note authentication; it
  does not invent a raw-note oracle API. Real hostile proofs remain later work.
- The standard HandshakeRegistry class was independently recomputed from its
  installed 5.2 artifact and verification keys without reusing its cached artifact
  hash. Its recomputed instance address agrees with SDK precomputed data and the
  content-locked Noir standard-address constant. handshake-consistency.json binds
  the inputs and result. This is local cross-layer consistency, not evidence that
  the correct registry or protocol state exists on the target live network.
- Configuration commitment construction initially required the not-yet-deployed
  portal address. The exact four-field pre-portal scope now matches deployment
  order; Ready and escrow messages still require the actual complete scope.
  Three added tests cover this distinction without accepting an old API shape.
- Feed positions initially lacked the SDK's transaction index. The wire now uses
  txIndexWithinBlock and logIndexWithinTx with actual SDK cursor tests and no
  ambiguous logIndex alias. Clean copies record this explicit input delta.
- A model version label was underspecified. The service handoff now defines one
  exact full-SHA-256 transcript, assigned to M02's shared codec and M03's runtime
  content verification. Historical policy identity is separately bound.
- Receipt inclusion and execution result are separate. The classifier tests
  actual SDK classes. Its optional lower confirmation threshold is diagnostic
  only; W03 production completion requires finalized success and transaction-hash
  binding. Existing wallet regressions still reproduce the old bad behavior and
  do not count as a wallet repair.
- Future deadline wire values remain u64. C05 explicitly tests that newly created
  obligations remain reachable within the supported execution-time domain so
  checked arithmetic does not mask loss of finite exit.
- Clean build verification caught CRS metadata still naming 5.0. Root's earlier
  integrated-crs-build.log also records this failure; the existence of app output
  did not establish a complete build. The actual 5.2 downloader source hash is
  identical to the prior pin, and its formats/URLs/ranges agree. Only release
  metadata changed. Fresh downloads and actual browser initialization are required
  again; historical browser passes used the earlier manifest.
- Updating the manifest exposed the browser CRS client's retained 5.0 check.
  The check now requires 5.2 and retains strict content/format checks. A negative
  release-mismatch case was added; no guard was bypassed.
- The first native/root output comparison disagreed on Solidity source-map IDs
  while bytecode and 32 other files matched. Root had reused compilation cache.
  All root compiler/generated output caches were cleared for a complete rebuild;
  comparison retains every metadata field rather than stripping differences.
- Concurrent build load exposed a process-test startup race: the timeout could
  fire before its fixture installed a SIGTERM handler. The review lane owns an
  explicit readiness handshake while preserving forced-kill assertions. Final
  evidence must include that corrected fixture and passing affected checks.

## Explicit qualifications

The 26 compiler constraint-coverage diagnostics are retained and accounted for
in compiler-diagnostic-review.md, without declaring them proven false positives.
Final adversarial proof/privacy tests and independent review must reconcile all
locations against final application/protocol artifacts. No compiler pass was
disabled. Build completion is not a cryptographic assurance claim.

The exact-lock advisory inventory is assigned to A02. Reachable high/critical
issues cannot be silently accepted; fixes or justified exclusions require
evidence and later review. No unreviewed automatic dependency overrides were used.

The selected 5.2 application toolchain follows official V5 compatibility guidance,
but does not lift the separate X03 network release gate. No public deployment,
existing wallet, real funds, production transaction or paid service is involved.
Real proof journeys, complete consumer wiring, supported browsers, operational
readiness, independent review and the required soak are still outstanding.

Final test exits, clean-copy input hashes, exact output comparisons and source
fingerprint are bound by the package acceptance record only after completion.
This review text by itself does not mark P04 or the application complete.

## Derived G1 integration follow-up

Repeated source-bound browser runs reached the BN254 setup stage after full input hashes passed and exceeded the evaluation budget. A separate pinned5.2 WASM experiment used full compressed input and a fresh uncompressed instance; output identity and observed timings are recorded in crs-experiment-review.md. Root adopted a build-derived asset with a full immutable content pin, explicit format-specific response checks and the existing verified compressed fallback. The Node timing motivates the implementation; browser and representative memory/performance acceptance are separate.

Root's build review requested exact Grumpkin format/byte/count and G2 count validation to keep the build and runtime schema consistent; the build lane added rejecting cases. Independent review identified streaming error-response cancellation as an additional cleanup fix. The browser test now observes the actual BN254 input byte/count tuple and requires the provisioned representation, so a compressed fallback cannot masquerade as qualification of the derived path. Existing navigation/evaluation budgets and later worker/SQLite checks remain.

The previous33-output native comparison is retained for its recorded inputs. The new comparator includes all bytes of the additional derived asset and must produce a fresh34-output match. New build workers, manifest and runtime changes require source binding and affected checks; no old pass is treated as their acceptance.
