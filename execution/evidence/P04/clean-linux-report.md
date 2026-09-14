# P04 clean Linux attempt — incomplete

**This is not a Linux build pass.** The original disposable run reached SDK assembly without an observed completion. Its 1,200-second wrapper expired; a separate 300-second recovery observer also expired. Docker could inspect the container again, but could not confirm stopping it.

The task-owned container is **`billboard-p04-clean-7003ab9801`**. Last observed state was running, not paused, with `OOMKilled=false`; that does not establish its current state or exclude other resource problems. Two removal attempts reported that Docker could not kill the container because no exit event arrived. A narrower attempt to terminate only esbuild inside it timed out. **Cleanup remains unconfirmed.** No global Docker restart, unrelated cleanup or new build was attempted. Root requested no further retries pending Docker recovery.

## Verified checkpoint

- Runtime: official pinned Node 24.15.0 digest `sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940`, verified Linux/aarch64.
- Initial npm/Noir/Solidity caches, installed project dependencies and generated application outputs were absent. The sole host mount was this task's isolated source directory. No home, wallet, Docker socket or host dependency cache was mounted; no ports were published. Actual limits were 6 GiB, four CPUs and 512 PIDs, with all capabilities dropped and no-new-privileges.
- Fresh checksum-verified Foundry 1.4.1, both locked npm installs with scripts disabled, and checksum/version/commit-verified Noir beta.25 completed. The Linux ARM64 compiler archive hash is recorded in `clean-linux-result.json`.
- Fresh Noir source resolution/content checks, contract compilation, forced regeneration of four private verification keys, and Solidity portal compilation completed. All 26 compiler diagnostics remain qualified by the separate source review; no security checker was disabled.
- **Seven complete contract-stage outputs match the clean native reference exactly**, including full Solidity JSON metadata and complete Noir/VK artifacts. See `clean-linux-contract-comparison.json`, bound to `root-clean-output-hashes.json` SHA-256 `3a7e401052453cf271f84defd528ad0a42e7f9cfa5365429fef61b52f35e3cd7`.

## Not verified

SDK assembly did not report completion. CRS provisioning, app assembly, the complete 33-output comparison, build guards, shell/receipt/storage/schema/commitment tests, language interface fixtures, portal regressions, CLI SDK smoke and the full Linux Noir/TXE suite were not reached. Their commands are a rerun recipe, not passing tests. Browser and model-container checks were never planned inside this build container. No actual proof generation/verification, live network, wallet or funds acceptance occurred.

The stalled SDK service consumed CPU without producing further output. Resource contention, host-bind I/O or Docker runtime state are possibilities; this attempt did not isolate the root cause or demonstrate an application defect.

## Inputs, interruptions and rerun recipe

`clean-linux-inputs.json` records the initial 145-file source inventory, exclusions, two preserved internal symlinks and full shell recipe. All seven distinct root-authorized post-freeze paths were synchronized before their affected build/test stages, with separate old/new hash records; the lifecycle test had two authorized revisions. `clean-linux-final-inputs.json` records the final copy inventory. Its last root comparison detects one later root-only change to `scripts/test-sdk-browser.mjs` from ongoing browser diagnosis. That script was not run in this Linux attempt; do not claim the entire copy equals the latest root tree.

An initial copy rejected the repository's existing internal source links; its premature launch exited before any build. A later Foundry extraction failed because the restricted container could not restore archive owners. Both failures were retained. The corrected recipe sets GNU `TAR_OPTIONS=--no-same-owner`, preserving archive bytes and executable modes while retaining capability restrictions. It then reached the checkpoint above. A temporary pause during npm installation allowed the final CRS manifest correction; later pause/state requests failed during host contention.

After Docker recovery and confirmed removal of the owned stale container, prepare a **new** isolated source copy from the newly frozen candidate and rerun the full saved recipe serially. Capture new source hashes, exact runtime/image identity, all command results and complete output hashes. Compare against a newly reconciled clean native reference, without excluding Solidity metadata or any other artifact fields. If changing the output mount strategy, first diagnose the I/O hypothesis and record that environmental change; do not silently reuse this incomplete result.

Raw evidence: `clean-linux-build.log`, `clean-linux-recovered-full.log`, original timeout in `clean-linux-run.json`, second observer in `clean-linux-recovered-result.json`, cleanup in `clean-linux-requested-stop.json`, child-stop attempt in `clean-linux-child-stop.json`, and consolidated status in `clean-linux-result.json`. No further stop/retry loop is active in this lane.
