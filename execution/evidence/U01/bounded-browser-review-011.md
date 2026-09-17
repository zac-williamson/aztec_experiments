# Bounded browser supervisor review 011

Read-only review of `scripts/run-bounded-browser-check.mjs`, `scripts/owned-test-process-tree.mjs` and the two allowed browser leaves. No test run or running-file edits. This is a source review, not resource qualification or fault-injection evidence.

## Substantive findings

1. **Forced cleanup does not yet own all Playwright temporary data.** The child receives `BILLBOARD_TEST_TMPDIR`, and the hosting leaf places its server directory there, but Playwright creates both its artifacts/download directory and Chromium profile beneath `os.tmpdir()` (`node_modules/playwright-core/lib/server/browserType.js:157,164`). Neither leaf supplies a profile directory. On normal exit Playwright cleans these; forced process-tree termination can bypass that cleanup. Set child `TMPDIR` to the supervisor-owned directory (optionally also `TMP`/`TEMP`) before the leaf starts. Otherwise `temporaryDirectoryRemoved: true` refers only to the explicit directory and must not imply all browser scratch data was removed.

2. **Failed-spawn error ordering can bypass reliable evidence.** The supervisor constructs `OwnedBuildTree(child.pid)` before registering the child `error` listener. A failed spawn may have no PID, so the constructor assertion occurs before a listener exists; the later `error` event may become uncaught. Register spawn/error completion handling first, and handle missing PID without constructing a tree. This is an exceptional launch failure, not a demonstrated failure of the running qualification.

3. **Keep interruption handling through final cleanup.** SIGINT/SIGTERM listeners are removed before the asynchronous tree cleanup, directory removal and evidence write. A second signal during that phase can terminate the supervisor and skip those steps. Retain listeners until cleanup/evidence completion; record interruption rather than abandoning cleanup. SIGKILL cannot be handled and no such guarantee should be made.

## Positive properties and limits

- Only two explicit leaf scripts are accepted; report output is constrained to U01 and created exclusively.
- Fresh detached child process, remembered descendant/group tracking, no process-name or broad PID killing.
- Sampling errors fail the run; SIGTERM escalates to SIGKILL after the grace interval; successful evidence additionally requires final empty owned tree and owned directory removal.
- RSS is correctly described as sampled descendant-tree RSS, not an OS allocation cap. It can miss subsecond peaks, and summed RSS can count shared pages more than once. Sampling time plus cleanup can extend elapsed time beyond the trigger deadline.
- Current threshold uses `>` rather than `>=`; use `>=` for consistency with the application harness's exact threshold semantics.
- Sample evidence records time and aggregate RSS but not member identities; cleanup is verified by the shared tracker. This is adequate for an aggregate sampled-resource statement, not a forensic reconstruction of every process.
- Source manifests are hashed, but this supervisor does not itself verify every built asset against those manifests. Current build/provenance checks remain a separate prerequisite.

After fixes, a normal run demonstrates only its actual observed resource/cleanup behavior. Signal, forced timeout and launch-failure paths require dedicated lightweight child fixtures if those behaviors are to be claimed as tested.
