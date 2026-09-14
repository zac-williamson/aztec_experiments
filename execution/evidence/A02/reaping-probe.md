# Container supervisor diagnostic

The tiny paired fixture reproduced the observed cleanup pattern without running
a build. Both containers used the pinned Node 24.21.0 image, no network or mounts,
dropped capabilities, and bounded resources. Exact code, commands, Docker inspect
records and process states are in `reaping-probe.json`.

- **Without `--init`:** the Python supervisor was PID 1. After the worker parent
  exited, its orphan child remained in actual `/proc` state `Z`, parent PID 1,
  process group 7. SIGTERM and SIGKILL did not remove the zombie. `groupAbsent`
  remained false even though the worker parent was reaped.
- **With `--init`:** the supervisor was PID 7, the orphan was reaped, and the
  process group was already absent before cleanup. No cleanup signal was needed.

Both uniquely named containers were removed and their absence confirmed. This
demonstrates a supervisor failure mode and a corresponding fixture fix; it does
**not** prove that the original build failure contained zombies, since that run
did not retain process-state snapshots.

Proposed next recipe change: add `--init` and capture process-group `/proc` states
before and after cleanup, retaining the mandatory `groupAbsent` acceptance check.
No full build retry was launched by this diagnostic.
