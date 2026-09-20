# Incremental public feed storage — reviewed design, not implemented

The current cache validates, projects, copies and serializes its entire event history
for each appended range. Bounded page reads do not establish incremental sync cost.
Independent review: application_change_review, September20. Root remains sole writer.

Use immutable range records and one constant-size head committed with storage CAS.
Both file and IndexedDB adapters must implement the same contract. On reopening,
validate and replay reachable records once; on append, validate only new events and
update indexed posts/policies. Ascending post order permits bounded reverse page slices.
Keep per-range undo for touched posts/policies so reorg work follows removed history.
Commit persistence before exposing the new head/projection. Failed commits retain the
previous visible state. New cache schema/key; no legacy fallback or indexing service.

Checks: one-event append after10000events must not serialize/read old payloads;
failed/competing head commits cannot lose history; three-block rollback restores
flags/policies/posts; malformed restart data is rejected; page reads stay bounded.
Initial replay remains linear. The API's complete policy-list response needs explicit
accounting rather than claiming constant-size output.

Do not edit these application inputs during a live proof measurement. Application
source changes require fresh affected acceptance evidence; campaign results retain
their existing source binding.

## Implemented and checked147–149

Review identified two shortcomings in the initial design: orphaned immutable records
and returning all historical policies for every page. The final implementation uses
one atomic transaction to add/delete ranges and compare/update the head. IndexedDB
serves browsers; Node24's built-in SQLite (WAL, synchronous FULL) serves the CLI.
Snapshot loads read the head and reachable ranges consistently. There is no orphan
cleanup service. v2 cache is rebuilt from canonical public history; no legacy path.

Projection staging retains only touched posts/policies and the current policy;
rollback restores those entries. Pages return policies referenced by their selected
posts plus the current policy. CLI accumulates versions across pages and rejects
conflicting definitions. Initial opening still validates/replays reachable history.

39 targeted regressions pass. One-event append after10000posts performs one atomic
commit of less than4000serializedbytes and no persisted-history reload. Tests cover
failed commits, competing writers, nativeSQLite and IndexedDB-double snapshots,
three-block rollback, duplicateidentity corruption and boundedpolicyoutput.

Actual built-page check149 passes nativeChromium two-range IndexedDB reopen,
mobileviewport/pagination/safe rendering and actualSQLiteCLI reading without wallet
or proving downloads.1216ms check; see report for exact resource/time values.
Independent application and harness reviewers approved the final architecture.

## Bounded RPC work and performance155

Three independent event-tag streams now run concurrently, retaining the shared page/event/deadline budgets and ordered pagination within each stream. A failure stops further sibling pagination. Canonical occupied-block checks run in groups of at most eight; independent contract/head reads overlap. Validation and final canonical checks remain mandatory. Barrier regressions verify concurrency limits and failure behavior.

Run151 failed the cold-reader target and remains preserved. Diagnostic152 measured storage at only 1.6ms load and 1.1ms commit; 153 measured the unchanged UI at 2.05s, so the earlier variation is not fully attributed. After the RPC change, normal 30-sample run155 passes: cold-reader p95 1629.31ms against 3000ms, warm 100-post page p95 0.20ms against 2000ms, and initial 10000-post hydration 2631.20ms. This is the recorded host/browser/throttled-network workload, not universal device qualification.
