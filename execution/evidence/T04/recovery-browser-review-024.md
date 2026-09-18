# Recovery browser integration review

Read-only source review, 2026-09-18. Reviewed `scripts/u01-browser-post.mjs`, `scripts/t04-browser-post-recovery.mjs`, the response-hold hook, parent verification, and production recovery/backup paths. No expensive tests or application edits. Lifecycle022 success does not qualify this new recovery scenario.

## Finding

Timeout cleanup has a late-launch race. Restart checks the abort signal before `await openContext()`, but browser launch is not cancelled by the surrounding Promise.race. If the deadline fires while launch is pending, final cleanup can observe only the old closed browser/context and remove the profile; launch may subsequently resolve and assign a new live browser/context after cleanup. Check cancellation immediately after acquiring each new context, close it on cancellation before returning, and prevent later restart navigation after cancellation. This is a resource-lifecycle hazard on timeout, not evidence of a successful recovery false-pass. Sent to root for correction.

Disposition: resolved by source review of root's follow-up. Both launch branches retain the acquired resource in a local variable until checking cancellation; a late launch closes itself and throws instead of assigning a live resource after cleanup. Persistent-context configuration also checks cancellation before and after configuration. The normal-browser branch assigns the browser before awaiting newContext, so outer cleanup owns that browser during context creation. No additional blocking finding from this correction. No delayed-launch execution test was run by this reviewer; actual cleanup remains part of the genuine run's qualification.

## Checks that agree with the intended scenario

- Persistent contexts use the same owned profile directory and HTTPS origin. The old context is closed and its Browser reports disconnected before relaunch. Public configuration is compared after relaunch rather than rewritten over stored state.
- Actual accepted send response remains unresolved. Acceptance timestamp/hash comes from the native hook after the original node submission/capture succeeds. Closure must occur within15seconds of server request start, ahead of the application's20second submission timeout; a slow restart/closure fails rather than qualifying ordinary in-process reconciliation as recovery.
- Schema-v1 backup cannot import journals. Production wallet restore writes only supplied claims/journals and activates the identity; it does not erase the existing profile's encrypted transaction journal. The helper permits immutable claim records, so describe this as no journal import, not necessarily an empty-claims backup.
- Restart uses the visible recovery control without connecting Ethereum, avoiding automatic navigation away from that control. Production recovery then checks the saved transaction and refreshes status; its successful postable branch displays page2. The helper waits for the exact accepted hash and that page, with a shared deadline and safe failure text.
- Acceptance/result artifacts contain fixed fields and public transaction hash/timings. Config comparison and decrypted backup remain in memory. The persistent profile is sensitive temporary state and is removed on ordinary cleanup. No raw provider errors, backup plaintext or journal contents are added to the result.
- Parent checks the accepted-send count and canonical effects/private debit. A successful UI alone is not sufficient. Capture counts submissions, not discarded or unsubmitted proofs; current scope states this limitation.

No impossible happy-path UI wait or additional journal-overwrite issue was identified. Real restart qualification remains pending the bounded genuine run and successful cleanup; source review does not establish it.
