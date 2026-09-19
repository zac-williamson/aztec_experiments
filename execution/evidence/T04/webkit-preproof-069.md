# WebKit pre-proof failure diagnosis

Run068 (`application-daf4a2ea-a39a-4f84-bc28-93ef605aab0c.json`) failed in169242ms,
peak673136KiB, with owned processes absent and temporary directory removed.
Normal persistent storage, wallet restoration and connection succeeded. The Post
action reported an application error after1071ms, before the proving log or any
observed prover entry. No failed HTTP status or CSP violation was recorded.
This does not establish a prover performance problem.

The existing test formatter observer was disabled for this run. Its stack parser
also assumed V8 format and would omit Safari/Firefox frames. Extract the same
observer into one page-compatible function and install it for every initial
browser page. Keep existing CDP diagnostics Chromium-only. Export fixed categories,
allowlisted codes and same-origin approved source file coordinates only; raw
messages, stack symbols, query strings and wallet/provider values remain in-page.
Add post-only fixed progress markers to distinguish preparation stages.

Independent read-only structural review: webkit_failure_review. Actual source
review found no blocking issues. No new runner, lifecycle, retry or fallback.
Observer checks plus existing browser journey checks:10/10 pass in728ms, recorded
in error-observer-checks-069.log. Recovery reopening a new page does not reinstall
this observer; no post-restart diagnostic coverage is claimed.

One follow-up application run069 is authorized by this new diagnostic hypothesis,
with unchanged540s/2GiB limits. Its source is frozen while it runs. Record its
outcome before any further real application run.

## Run069 outcome and correction

`application-1ceb56b1-8711-45c9-be6c-70cfb6155292.json` failed in192589ms,
peak1884896KiB, cleanup complete. Post-only progress reached posting but not
cooldown completion. The captured original error points to user.html:42199,
exactly the validation of `block.timestamp` in getL2Timestamp.

The pinned node API returns `BlockResponseSchema`, not `L2Block`. The former is a
schema-decoded object containing `header.globalVariables.timestamp` and has no
L2Block timestamp getter. Use that one canonical API path. The independent
reviewer's earlier L2Block conclusion was corrected against aztec-node.js and
block_response.js. No alternate shape fallback was added.

A regression roundtrips a block through the pinned RPC jsonStringify,
jsonParseWithSchema and BlockResponseSchema, asserts the top-level timestamp is
absent, and exercises actual application posting dispatch. The initial test
fixture incorrectly passed class objects directly into the wire schema; failed
log070 preserves that error. Corrected checks071 pass116/116.

Independent application review also found the automatic-withdraw loop waited at
most60seconds then attempted screening without rechecking chain cooldown. Add a
continue after that wait, returning to its existing state/time check. Controlled
advancing and stalled clocks reproduce premature action before the fix and pass
afterward. This is readiness polling; no failed transaction is retried by the fix.
The state-conflict-specific recovery rules remain unchanged.

application_change_review approved actual fixes and tests. App build071 passed.
One source-bound WebKit072 run now tests the repaired pre-proof path and actual
proof under the original limits; success is not asserted before its result.

## Run072 resource stop

`application-8c21eaf7-bd0d-478e-b4fe-1bc674f0130d.json` stopped at24607ms on
aggregate RSS2125264KiB, during native board-deployment proof and before browser
launch. Owned-process and temporary-directory cleanup passed. This does not
qualify or refute the timestamp fix. Source comparison found only rebuilt app
outputs changed since069; those pages are not executed during board deployment.

The existing supervisor discarded per-process RSS after summing it. Preserve one
peak snapshot containing only role, PID, parent PID and RSS, using the same samples
and limits. Independent structural reviewer application_change_review approved;
8 supervisor checks passed (memory-observation-checks-073.log). One existing
included-board scenario isolates that stage with its existing120s/2GiB bound.
No heap change, larger resource allowance or unchanged WebKit repeat was made.


## Run074 qualification

User authorized raising the shared aggregate cap to4GiB; deadlines unchanged.
Memory-default checks074 pass8/8 and independent structural review approved.
`application-7a2ce119-828a-47d5-b066-54d08bf36237.json` passes in268196ms,
peak2171472KiB under4194304KiB. GUI post73901ms; actual WebKit26.6 proof,
submission and canonical node effects verified. All post preparation milestones
completed, no formatter errors, failed HTTP or CSP events. Owned browser/server/
processes and temporary directory cleanup passed. This qualifies one preseeded
private-fee post, not a full WebKit lifecycle or general hardware performance.

Isolated fixture073 also passed51441ms/2031920KiB under the historical2GiB cap
(C01/application-eea73a60-5e70-4ee5-bc9d-ecd7fa8966cb.json). Its peak shows
1041376KiB in the fixture Node process; no speculative heap tuning was added.
