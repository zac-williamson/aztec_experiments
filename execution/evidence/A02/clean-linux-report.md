# A02 clean Linux qualification — incomplete

The single run used the verified Node 24.21.0 image, a 3 GiB / 2 CPU container,
fresh caches and the attested 151-file source set, with no host mounts. Both npm
installs, Foundry verification and Noir bootstrap passed. The complete build
command returned **0** within its unchanged 900-second deadline.

The stage supervisor then observed that the build process group still existed
after 8 seconds following SIGTERM and 3 seconds following SIGKILL. Its parent had
been reaped. The required `groupAbsent` check failed, so later tests and output
snapshots did not run. This was neither a build-command failure nor a timeout/OOM;
the qualification is **incomplete**, and Linux output equality is unverified.

The original process states were not captured. Running descendants versus orphan
zombies cannot be distinguished from this evidence alone. A small diagnostic
fixture may investigate the supervisor, but cannot retroactively prove the cause.
No full retry was performed.

All available logs were extracted successfully. Container
`billboard-a02-clean-55cbce9c3a` was removed and its absence confirmed. Only this
run's source staging directory and 57,538,560-byte archive were then deleted;
input hashes and reviewed helper recipes remain archived in the evidence.

`clean-linux-report.json` contains stage outcomes and evidence hashes;
`clean-linux-run.json` contains exact extraction/removal outcomes. Source hashes
and both internal links match the staged candidate after failure. The native
34-output reference still matches the workspace; its separate full native
qualification remains valid. See `clean-linux-final-attestation.json` and
`clean-linux-staging-cleanup.json`.
