# A02 clean Linux retry2 — passed

The approved retry completed all **19 stages in 421.8 seconds** using the same
151 application/source files, two internal links and native output reference.
The only changes from the first Linux recipe were Docker `--init`, verified in
container inspection, and actual process-state capture. No acceptance check or
deadline was relaxed.

Fresh root and portal installs took 30.95 and 1.47 seconds. Compiler bootstrap
passed, the complete build took 104.30 seconds, and CRS assets were provisioned
and derived inside the container without host caches. The full Noir suite took
238.21 seconds. All stages passed:

| Check | Passed |
| --- | ---: |
| Dependency regressions | 41 |
| Build guards | 171 |
| Interface guards | 69 |
| Noir interface fixture | 22 |
| Solidity interface fixture | 7 |
| Portal regressions | 9 |
| CLI SDK lanes | 5 |
| Full Noir/TXE cases | 62 |

All **34 complete output hashes match the native build**, with no metadata,
bytecode or VK exclusions. Before/after source attestations are unchanged. The
source set differs from native qualification only by the separately approved
`BUILDING.md` command-list addition. Every process group was absent after its
stage, every parent was reaped, and all captured post-cleanup process lists were
empty. No cleanup signal or timeout occurred.

Evidence extraction and required-file checks passed. The owned container
`billboard-a02-clean-retry2-9385264777` was removed and its absence confirmed.
The source staging directory and archive were removed afterward; hashes, recipes,
logs and results remain in the evidence. No test/build process remains active.

Key records: `clean-linux-retry2-report.json`, `clean-linux-retry2-comparison.json`,
`clean-linux-retry2-final-attestation.json`, `clean-linux-retry2-run.json`,
`clean-linux-retry2-staging-cleanup.json` and `clean-linux-retry2-container-evidence/`.
The original incomplete attempt and paired reaping diagnostic remain preserved.

This establishes the recorded clean Linux arm64 build and test results, alongside
the separate native browser and model-isolation passes. It does not establish
full-proof chain validity, production-host readiness, compiler soundness or an
independent security audit. Existing compiler-diagnostic and dependency-advisory
review requirements remain explicit downstream qualifications.
