# Full GUI reaches refund; test driver heap exhaustion

The native coordinator emitted canonical verification milestones for claim
(211845ms), post (294027ms), screening (394237ms), and exit (454377ms). Official
local exit-message settlement completed; the browser reached refund at468659ms.
It then aborted with SIGABRT before writing its final browser report. Full refund
and final historical private-note/accounting verification remain unqualified.

The outer run ended471677ms, peak1397568KiB, below unchanged540s/2097152KiB limits;
all owned-tree and temporary-directory cleanup checks passed. The driver PID78704
matches the retained owned-process snapshot and its exact OS crash report. Triggered
stack frames include Node OOMErrorHandler and V8/Heap FatalProcessOutOfMemory.
Only fixed classification and a hash of the crash report are retained in
driver-oom-019.json; raw system crash data is not copied.

The driver had a64MiB old-space cap. Application observers retain small path/status
summaries; installed Playwright dispatchers retain request metadata/postData in
buckets up to10000. This supports a driver allocation correction to128MiB inside
the unchanged aggregate budget. It does not establish absence of future retention
pressure or production browser performance. Preserve network request restrictions
and diagnostics; do not bypass observation to get a pass.

The missing browser result also prevented native graceful failure reporting before
the parent stopped it. Persist validated public canonical stage records after each
stage, classify only fixed fatal stderr categories, and publish a fixed failed
browser result before bounded cleanup grace on abrupt exit. Retain the failure;
do not reconstruct missing refund evidence from successful earlier milestones.
