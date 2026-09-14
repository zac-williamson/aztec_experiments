# P04 checkpoint — acceptance incomplete

The user confirmed a fresh deployment with no backward-compatibility requirement.
One new board/service format is specified. Current protocol compatibility and
recovery of newly created wallets remain required. C01–C06 and the downstream
wallet/feed/moderation/UI packages still implement the production behavior;
interface fixtures do not claim those defects are fixed.

## Completed implementation and observed checks

- Matched Aztec5.2 / Noir beta25 locks,413 external source-file origin checks,
  note packing/selectors, cross-language commitments, scoped fresh PXE storage,
  and reviewed contract/service interface specifications.
- Root and independent native builds previously matched all33 outputs exactly.
  Their recorded source predates the derived-G1 change below and remains historical.
- Earlier recorded root checks:69 interface/storage/baseline,62 Noir,155 moderation,
  real fresh-store browser persistence, offline SDK cases and29 graph tests.
- Repeated browser diagnostics verified the compressed CRS bytes but timed out
  during BN254 initialization. Another run failed before evaluation at navigation.
  All failed logs remain available; none is converted into a pass.
- The actual pinned5.2 WASM experiment derived all1,179,648 points from the complete
  verified compressed setup. Fresh Node initialization measured118.910s compressed
  versus1.873s uncompressed. This is one Node observation, not browser performance.
- The implemented build pipeline independently generated the complete75,497,472-byte
  derived file with SHA-256
  `2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac`.
  Root preflight confirmed both its target and content-addressed cache were absent.
  The new worker verifies full input/G2/WASM/output content, runs under a parent
  deadline, and atomically promotes verified bytes. The64MiB remote-download cap
  remains separate from the fixed72MiB derived output.
- Runtime prefers the fully verified derived asset, retaining only verified
  compressed fallback. Exact response checks differ by format. Independent AI
  review found a streaming HTTP-error cleanup issue, which was fixed and tested.
- The final integrated build-guard run passed171/171 with no skips, including33
  build and58 runtime cases. Actual apps were reassembled. The new34-file output
  reference includes the entire derived asset;28 outputs remain identical to the
  preceding root reference, while the CRS manifest/four HTML files changed and
  the derived asset was added.

## Current verification limits

The actual browser test now records the real BN254 input bytes/count and requires
both consumers to exercise the provisioned derived representation. Its latest
run failed the30-second navigation deadline before evaluation began; it therefore
does not qualify the new runtime path. No HTTP/page error was recorded. Logs
separate successful SDK delivery from later readiness, but do not prove the cause
of the timeout. Host observations show substantial competing work and memory/swap
pressure. The user was asked to free competing workloads; no unrelated app or
process was stopped. Navigation and evaluation limits remain unchanged.

Docker restart was authorized and succeeded. The old stuck container is absent.
A subsequent no-mount retry hit its300-second npm installation allowance before
compilation; evidence extraction and owned-container cleanup succeeded. Its failed
report remains intact. Retry2 passed its root dependency installation but failed
the portal installation with EACCES: copied nested directories retained host
ownership and were not writable in the restricted container. The reproduced
staging defect was fixed using deterministic root-owned archive metadata, without
adding capabilities or host mounts. A disposable probe verified147 source hashes,
two links and40 writable directories, then removed its temporary writes/container.
Retry3 used those same147 attested source files and the new34-output reference.
Both dependency installations and the compiler bootstrap passed. The full clean
build passed in479.81seconds; all34 outputs match the root reference byte for byte,
including independent derivation of the entire cryptographic setup. Artifact
checks,171 build guards and69 interface/storage/baseline cases passed.

The additional Linux Noir fixture run then reached its existing120-second inner
deadline and was killed:22 tests announced,10 unique cases reported passing, no
reported assertion failure. This run is incomplete, not a22-test pass. Later
Solidity/portal/CLI/Noir suites were not reached. Prior successful native fixture
and unaffected baseline evidence remains source-specific and is reconciled in
`closure-evidence-audit.md`; it does not change this attempt's outcome. Logs and
source attestations were extracted and the owned container was removed successfully.
Root npm's infrastructure allowance was900seconds and the outer ceiling2400;
actual build/test bounds were unchanged. All dependency/CRS caches began absent
and no host mounts were used.

After cleanup, a new host observation recorded9,527.62MiB of used swap and load17.50,
with the previously noted apps and other builds still active. This is context,
not proof of the exact timeout cause. No new browser retry was launched under
these unchanged or worse conditions. The request to free competing workloads is
still unanswered; no unrelated process was stopped.

## Evidence and next action

- `crs-experiment-review.md`: actual full-size API experiment and its limits.
- `derived-crs-root-preflight.json`, `derived-crs-root-build.log`: cold production derivation.
- `derived-crs-integrated-build-tests.log`, `derived-crs-independent-review.md`: integrated guards and AI review.
- `derived-crs-root-output-hashes.json`, `derived-crs-output-delta.json`: full34-output reference and historical delta.
- `derived-crs-browser.json` / `.stderr`: latest failed browser attempt.
- `clean-linux-retry-report.md`, `clean-linux-retry2-result.json`: retained failed attempts.
- `clean-linux-fixed-copy-probe-v2.json`, `clean-linux-retry3-copy-fix-final.json`: reproduced staging fix and current fresh run preparation.
- `clean-linux-retry3-container-evidence/steps.json` and its logs: actual passed build/guards and incomplete Noir fixture.
- `clean-linux-retry3-comparison.json`, `clean-linux-retry3-final-attestation.json`:34 exact outputs and unchanged147 source inputs/two links.
- `host-resource-after-linux-retry3.json`: observed host pressure after container cleanup.
- `closure-evidence-audit.md`, `frozen-interface-inputs.json`, `frozen-interfaces/`: criterion coverage and exact current design/fixture bytes.
- `source-derived-crs-candidate.json`: candidate source fingerprint
  `750cb4c1df4c99b7140e252bf987b66ac39ced85ee48632d8c1f6e74e4b103cc`.

The Linux run has ended and been cleaned up. Resolve browser qualification on
these actual inputs in a usable execution environment, and disposition the
additional fixture timeout through a focused complete run when conditions permit.
Then reconcile source/review hashes.
Only after all P04 criteria have evidence may the graph mark it complete and
permit dependent implementation. No P04 pass record has been created.

P04-A01–A04 currently have design/fixture evidence; P04-A05 remains open. The26
compiler diagnostics and exact-lock dependency advisories retain later proof/review
and A02 requirements. Current official-guidance recheck found no explicit lifting
of the V5 deployment pause; X03 remains a release gate. Real-proof journeys,
independent external review, operator acceptance and14 days of representative
soak remain mandatory. The application is not production-ready.
