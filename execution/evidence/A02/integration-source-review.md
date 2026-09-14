# A02 independent integration source review

2026-09-14. Reviewed the runtime/CI/model-image changes, root-owned parser tests and historical controls, and the prepared clean-Linux helper. This is independent of their implementation owners; it does **not** independently review my own package/lock remediation. No builds, browsers, containers, proofs or dependency test suites were run by this review. Python helper syntax parsed successfully; other observations are source/record checks.

## Actionable findings before Linux launch

1. **Launcher could report pass without evidence or cleanup.** In the reviewed `launch.py`, outcome is assigned from container exit before `docker cp` result extraction. The extraction command's nonzero exit does not throw or invalidate pass. Likewise cleanup's `docker rm -f` result is recorded but does not gate final outcome/exit. Require successful extraction with expected result files and completed owned-container cleanup/confirmed absence before pass. A zero application exit alone is insufficient reproducibility evidence.
2. **Ambiguous container creation can bypass cleanup.** The reviewed create call and early failure exit are outside try/finally. A timed-out create can have created the uniquely named container while the wrapper skips removal. Cover create failure/timeout with bounded cleanup of only the owned name, preserving unknown outcomes honestly.
3. **Minor documentation drift:** BUILDING's manual test block omits `npm run test:dependencies`, although CI and package script include it. Add it next to build tests.
4. **Helper provenance improvement:** source staging records run.sh but copies steps.py afterward without a dedicated helper hash in that inventory. The final archive SHA later binds all bytes, and preparation records helper hashes, so this is not a demonstrated source substitution. Bind both copied helpers consistently in the staged inventory for reviewable execution provenance.

These were sent to the verification owner and root before launch. Follow-up source review: findings1 and2 are resolved in launch.py. The launcher now requires successful evidence extraction and expected files, all19 successful stages and process-group cleanup, before/after source attestations, whole-output agreement with the native reference, successful removal and confirmed container absence. Ambiguous create failures now trigger bounded cleanup and absence inspection. Finding4 is resolved by explicit hashes for all five helpers. Finding3 remains a minor documentation correction at this inspection; no Linux pass is asserted.

## Runtime and CI checks

`.nvmrc`, toolchain, CI setup-node and both build/daemon documentation consistently select Node24.21.0. Aztec5.2/Noirbeta25/Foundry1.4.1/solc0.8.27 pins are unchanged by this lane's reviewed diff. CI adds the maintained dependency suite, retains artifact/browser/native tests, and performs two clean generated-output builds with complete comparator snapshots. That CI definition is not itself evidence it has run.

The runtime's proxy/probe image, daemon pull instructions and CI isolation step all use the same immutable official Node index digest6dac556d… . Independently hashing the saved **raw** index and Linux amd64/arm64 config files exactly matches the recorded index/config digests. Their configuration versions are24.21.0. The reviewed runtime diff changes only PROBE_IMAGE; container isolation options and cleanup logic are unchanged. Actual model-isolation regression under the new image remains required; no Debian package audit is implied.

The Node preflight records publisher SHA256 verification before extraction/execution, confined archive members, runtime24.21.0/embeddedUndici7.29.1 and a binary hash. That is coherent provenance evidence, not integrated compatibility proof. Its limits correctly distinguish HTTPS checksum authentication from detached-signature verification.

## Parser tests and known-bad controls

The maintained tests execute actual qs and uuid package interfaces. They cover qs bracket/plain comma-array limits with valid boundary controls; parsed non-callable constructor.isBuffer roundtrips with both parser options and a normal Buffer value; UUID v3/v5/v6 rejection before writes at short/end-overflow/negative offsets; valid offset writes preserving surrounding bytes; independent v3/v5 expected values; and actual gaxios/teeny-request CommonJS v4 resolution/calls.

The historical probe deliberately confirms four old unsafe behaviors on prior qs6.15.3/uuid9.0.1: bracket-array limit bypass, serializer TypeError, and partial v3/v5 writes. Those observations are correctly labeled known-bad, not repairs. UUIDv6 is tested only on the new package; the baseline does not pretend9.x exposed that method. Probe source SHA256 equals the recorded result. The source record describes old tarball integrity verification, scripts disabled and ancillary imports potentially resolving current root modules. Original tarballs are not retained in the inspected baseline directory, so this review cannot independently rehash their compressed bytes; it does not claim to have repeated that fetch verification.

The10-pass parser log is source-bound: current test and all listed qs/uuid implementation hashes match. Its whole-lock hash predates the isolated Jaeger change; this historical context must remain intact, and the ongoing integrated final-lock suite supplies current binding. These are dependency API/parent-import tests; they do not claim an application endpoint exploit, parent multipart end-to-end test, or external cryptographic audit. No blocking test-design issue found.

## Clean-Linux design and limits

The staging helper takes tracked/current untracked candidate inputs, excludes dependency/cache/generated output trees, wallets, legacy RPC configuration and execution history except interface vectors. Files are copied without dereferencing approved app-source symlinks; symlink targets must stay within app source. Packing separately rejects absolute/traversal/unconfined paths, verifies input hashes/links, preserves approved symlinks, normalizes owner/group/mtime and readable/executable modes, and refuses archive overwrite. Final source inventory must still be reviewed against the frozen candidate before launch; the staging recipe alone is not that comparison.

The uniquely named container uses a pinned image,3GiB/2CPU/512pid bounds, dropped capabilities, no-new-privileges, no mounts/volumes/socket/home or exposed ports. It gets one source archive via docker cp. Root UID inside this isolated build layer is intentional for tool provisioning; it is not presented as the production model runtime profile. Public dependency/tool downloads occur inside the fresh layer. Foundry archive bytes are pinned; npm ci disables scripts; Noir bootstrap enforces its compiler pin.

The steps verify fresh cache/output absence and before/after source hashes, then build, snapshot and run guarded suites. Each step has a separate process group, bounded wait and TERM/KILL/reap verification; failed group cleanup fails the step. The overall6600s budget is an infrastructure envelope, not a changed product assertion. The revised recipe captures snapshots before and after tests, compares them, and the launcher requires exact agreement of the final snapshot with the native reference, including schema and algorithm. All comparator outputs remain included. Container success alone is not cross-platform reproducibility. Browser and model-isolation qualification are separate native/CI gates, not secretly omitted Linux results.

## Reviewed hashes

- `.nvmrc`: `73fb1b615e2043a933be1c0895cde4358036acc28d785692509b822aa53c761f`
- `toolchain.json`: `d9242f804526ae88e6baaf9d59d363ddc3cd2e4341e3a4344f4efa367a9a654a`
- `.github/workflows/build.yml`: `91fc7c8940443e593064170c85db5768ff8b119adecc805c6ed4e84ba0e62b19`
- `BUILDING.md`: `eab87a3ae3282acaac1bb4c8219759d5a330aa9b25109877e91a2df41b3ff7d1`
- `censor-daemon/README.md`: `7e5f3cfdda8a6fd370b564e226c810a38493c410b16c2d975f90d0fe07e1a55d`
- `censor-daemon/model-runtime.mjs`: `c2ac8effbcf464debcff6b11dc485a2f1fbd678961f6dc6f2d188b573e6f69e0`
- `scripts/test-dependency-parsing.mjs`: `a144abc87e6c3fac250ff2ca97a1b0acfe923c9d3fbf3f603ca86df5595f85c1`
- `.build/A02-verification-tools/stage_source.py`: `7e3266c276749043398bc51fc0cb675243799ea8c2bea405d840bd925d637f14`
- `.build/A02-verification-tools/pack.py`: `afebdc867f8d5695e287765773f39d363acb12bf2376478f947d45af982e7f8b`
- `.build/A02-verification-tools/run.sh`: `81dc968a4a910f15144f70b44d5cdc0a1943717308d33864cb7ceb36ea284572`
- `.build/A02-verification-tools/steps.py`: `29725e00b6ac16b0be04b22d59098d9ec53b78bf99108dbbe51665c0180919e1`
- `.build/A02-verification-tools/launch.py`: `ffbb3dc44a04820157192f01c5992a5b182d6e69b699b3cfdbacbb8b477a70c2`
- `execution/evidence/A02/parsing-baseline-probe.cjs.txt`: `70fc1729136404d301455a6e01ee3ab11bf9abacfe927c8139e9fd908b6435e0`
- `execution/evidence/A02/parsing-baseline-inputs.json`: `0eea96cef6bd61d8e7c70691ab56b35d02adc1712b9a420b45ce4fa446634d93`
- `execution/evidence/A02/parsing-known-bad-results.json`: `23c04ccc6f34f6cd47d41cc571e2f1241dbf024b143e66e0ffb5068c9ad1983d`
- `execution/evidence/A02/parsing-regression-context.json`: `6eb5e521f2031887aae934d8909df10a010532f2c0962ea60abac474b5cb94f0`
- `execution/evidence/A02/node-runtime-preflight.json`: `1b1efcfe5225c1e38aed3574b55cfe974cc20379325c59ac2dbe8e2cbd6a6724`
- `execution/evidence/A02/node-container-registry.json`: `f9ed4897d0b9ea5708e1c25f5b1e46c48893948cdbeea6088617861202e267fe`

## Follow-up helper source binding

Verified revised source only; no helper/container execution by this reviewer. Original fingerprints above preserve the reviewed pre-fix state.

- `.build/A02-verification-tools/launch.py`: `ffbb3dc44a04820157192f01c5992a5b182d6e69b699b3cfdbacbb8b477a70c2`
- `.build/A02-verification-tools/steps.py`: `29725e00b6ac16b0be04b22d59098d9ec53b78bf99108dbbe51665c0180919e1`
- `.build/A02-verification-tools/stage_source.py`: `7e3266c276749043398bc51fc0cb675243799ea8c2bea405d840bd925d637f14`
- `.build/A02-verification-tools/pack.py`: `afebdc867f8d5695e287765773f39d363acb12bf2376478f947d45af982e7f8b`
- `.build/A02-verification-tools/run.sh`: `81dc968a4a910f15144f70b44d5cdc0a1943717308d33864cb7ceb36ea284572`
