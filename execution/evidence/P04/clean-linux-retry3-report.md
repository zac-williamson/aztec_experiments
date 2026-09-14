# P04 Linux retry3 — reproducible build passed; remaining Linux tests incomplete

**The fresh Linux build passed and all 34 complete output files match the native reference.** This is not a complete Linux test-suite pass: the Noir interface fixture hit its existing120-second deadline after10 of 22tests reported success. No assertion failure was reported before the timeout. The subsequent suites were not run. No timeout or acceptance check was relaxed to obtain these results.

`clean-linux-retry3-comparison.json` and `.log` retain the successful exact comparison against `derived-crs-root-output-hashes.json` (SHA-256 `f0f24b0338535d0e20c7b290155fad29f6bf7ccfa0222380b85350039e3cfb30`). All artifact fields are included, including Noir bytecode/VKs, Solidity metadata, SDK/worker bytes, HTML and all four CRS assets. The Linux snapshot was captured immediately after the build and artifact guard, before subsequent test suites.

## Source and environment binding

All 147 candidate source file hashes and both intended internal symlinks matched the isolated copy before launch, matched inside the container before execution and after the fixture failure, and still matched the root candidate at final attestation. No application inputs changed during this run. See `clean-linux-retry3-final-attestation.json`, which includes the exact inventory. The manifest/reference are unchanged from the approved candidate.

The container used the pinned official Node 24.15.0 image `docker.io/library/node@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940`, actual Linux/aarch64, 3 GiB memory, two CPUs, 512 PIDs, `GOMAXPROCS=2`, all capabilities dropped and no-new-privileges. There were zero host mounts and no exposed ports. Host home, wallet data, the legacy RPC credential, npm/Noir/Solidity/CRS caches, generated artifacts and the Docker socket were excluded.

The source was copied using a confined allowlist archive with UID/GID 0, owner-writable directories/files and preserved internal symlinks. Initial dependency/compiler/CRS caches and outputs were absent. Before installing anything, the run verified effective UID/GID, all source hashes and write/unlink access across 40 root/nested source/compiler/CRS/portal directories. All probe-created directories and files were removed. This directly verifies the fix for retry2's copied UID 501/GID 20 permission failure without adding capabilities or mounts.

## Actual results

| Stage | Result | Elapsed |
|---|---|---:|
| Fresh environment and source permissions | Passed | 0.24s + 0.37s |
| Fresh checksum/version-pinned Foundry 1.4.1 | Passed | 24.86s |
| Root locked npm installation, scripts disabled, timing enabled | Passed | 330.44s |
| Portal locked npm installation, scripts disabled | Passed | 28.81s |
| Pinned Noir beta.25 bootstrap | Passed | 8.42s |
| Full documented build | Passed | 479.81s |
| Artifact guard | Passed | 2.35s |
| Whole 34-output snapshot/comparison | Passed | Snapshot 1.64s; comparison retained separately |
| Build guard suite | **171/171 passed**,0 failed/skipped/cancelled | 10.34s wrapper |
| Shell/receipt/storage/schema/commitment JavaScript suite | **69/69 passed**,0 failed/skipped/cancelled | 10.70s wrapper |
| Noir interface fixture | **Incomplete:**22 announced, 10 unique reported passes; existing inner 120s timeout/SIGKILL | 120.40s |
| Solidity interface fixture | Not run | — |
| Portal regression suite | Not run | — |
| CLI SDK smoke | Not run | — |
| Full Noir/TXE suite | Not run | — |

The full build resolved official Noir dependencies into a fresh cache, retained source-content checks and regenerated all four private VKs. It completed contract/SDK/CRS/app assembly inside the unchanged900-second build bound. All three original CRS sources were downloaded and verified. With the derived cache and target initially absent, the production worker independently generated the complete 75,497,472-byte uncompressed G1 asset on Linux; its SHA-256 was `2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac`, matching the independently produced native asset. No experimental or host-derived file was supplied to the container.

The 26 manual-constraint compiler diagnostics remain present and subject to `compiler-diagnostic-review.md` and the downstream external-review/proof gates. They were not suppressed or declared harmless because the build exited successfully. The fixture checked the locked dependency trees before its test command; its own post-test dependency check was not reached after the timeout. The final147-file source attestation does not pretend to replace that unreached external dependency check.

The run kept the approved900-second root-install allowance and2,400-second outer limit, plus every existing build/test deadline. The 180-second outer fixture stage did not expire: the unchanged fixture runner's inner120-second deadline terminated Nargo with SIGKILL and caused exit 1. Its error log repeats captured stdout in two representations; the reported10 passes are deduplicated by test name, not double-counted. The timeout does not establish which of the remaining 12 tests would pass or fail, or whether resource pressure was its cause.

## Cleanup, scope and retained evidence

Owned container `billboard-p04-retry3-c0230f6b75` exited1, `Running=false`, `OOMKilled=false`. Evidence extraction completed before container removal. Extraction and removal both returned 0. The wrapper duration was 1,022.07 seconds; its 2,400-second ceiling was not reached. A later bounded progress read received “No such container”, consistent with completed removal. No retry3 container, test or child remains active in this lane; no unrelated resource was changed and no automatic rerun occurred.

Primary evidence: `clean-linux-retry3-result.json` (all commands/counts/deadlines/exits), `clean-linux-retry3-comparison.json`, `clean-linux-retry3-final-attestation.json`, `clean-linux-retry3-container-evidence/` (raw logs and npm timing), `clean-linux-retry3-container-inspect.json`, `clean-linux-retry3-run.json`, `clean-linux-retry3-archive.json` and `clean-linux-retry3-launch-attestation.json`. The reviewed helper source is preserved in `clean-linux-retry3-copy-fix-final.json`. All prior failed attempts remain separate evidence.

No browser/model-isolation test ran in this container, and no actual transaction proof, live-network acceptance, wallet or funds operation occurred. The reproducible-build result is a useful completed qualification; the browser gate and incomplete additional Linux suites remain unresolved. A later supervised test run must retain the actual assertions/deadlines and report its own source/runtime/resource conditions rather than converting these unrun tests into passes.
