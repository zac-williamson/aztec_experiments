# Browser diagnosis and independent review

WebKit056 failed in 5,997 ms at actual product readiness. Secure context,
cross-origin isolation, worker and WASM checks passed. The bounded operation
observer recorded getDirectory called then rejected with UnknownError; no file
creation was reached. Owned processes and temporary directory were removed.
Temporary prototype observation has now been removed from the hosting test.

Read-only agent webkit_storage_cause traced upstream expectations:
- https://github.com/microsoft/playwright/issues/18235
- https://github.com/microsoft/playwright/pull/41984
- https://github.com/microsoft/playwright/blob/v1.63.0/tests/library/capabilities.spec.ts
- https://github.com/microsoft/playwright/blob/v1.63.0/tests/library/defaultbrowsercontext-2.spec.ts

Normal-profile qualification should use one fresh owned persistent context and
Playwright1.63.0 (WebKit2359). Private contexts remain unsupported by this storage
capability; product readiness must reject them. This is a deterministic harness
profile correction, not a retry or alternate application backend. Upgrade and
runtime verification remain pending while Firefox057 runs against frozen inputs.

Independent structural review browser_harness_review approved the portable
fixed-name proof observer. Its initial inference that Firefox053 already used it
was corrected by reconstructing the exact recorded worker hash: 053 had a
Chromium-only guard. Current source removes that guard (and matches HEAD).
Firefox057 adds observation, not a larger time/resource budget.

History test extraction and integration use actual SDK NoteStore/NoteService,
actual application IndexedDB opener and close/reopen, with synthetic 1,100-note
history. Review required exact CSP-safe aliases and assertion of collected CSP
violations; integrated. Browser runtime qualification remains pending. This does
not claim 1,100 authenticated published transactions or constant-time scanning.
