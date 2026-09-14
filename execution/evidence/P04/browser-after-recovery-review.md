# P04 browser qualification after approved Docker recovery

Root confirmed Docker server 28.1.1 responds and the old stalled container is absent, as recorded in `docker-restart-check.json`. Root held new Linux build work during this single authorized browser retry. No test or production source, CRS bytes, point counts or timeouts were changed. The exact command and recovery-evidence hash are in `browser-after-recovery-context.json`.

**FAIL: navigation timeout before evaluation.** The process completed with exit 1. The first shared-library consumer launched its disposable Chromium process in approximately 21.1 seconds, began navigation at global elapsed 48.854 seconds, and exceeded Playwright's existing 30000 ms page navigation limit waiting for the local test page's load event. Browser disconnection was recorded at elapsed 81.985 seconds during cleanup. No page or HTTP faults were recorded.

Neither the separate 120000 ms evaluation budget nor actual SRS initialization began: `evaluationMs` is null and `deadlineExceeded` is false. The second engine-adapter consumer was not run because the harness stops at the first failure. No Poseidon, asynchronous worker, SQLite or CRS result is claimed from this run. All six observed source hashes exactly match the prior separate-consumer qualification. The test SHA-256 remains `057b86fb66d71a642fcd6143d9cc369cf4eab9b119221d89cdd4509ff560af01`.

This does not establish why the local page did not finish loading. Docker recovery and this timing observation alone are insufficient to attribute the result to Docker, host resource pressure, Chrome, application code or another cause. The earlier 109.642-second completed BN254 initialization remains a historical observation, not a newly repeated result. U01 and T04 still need representative cold/warm measurements and an acceptable production interaction budget.

The read-only preparation record identifies that the application verifies and submits compressed BN254 data to the browser's synchronous WASM backend. The pinned SDK supports this format and its standard cache path can retain decompressed output; the current application adapter discards that output. Generic SDK default point counts do not prove sufficient application circuit capacity, so no reduction or cache substitution was made.

Session 5848 was polled to process completion. The harness awaited browser and local HTTP-server cleanup, and recorded browser disconnection. No owned execution session remains active, and no further browser retry was started. This is not an OS-wide orphan-process audit. P04 browser qualification remains unresolved; the failure must remain visible in acceptance evidence.

## Evidence hashes

- `browser-after-recovery.json`: SHA-256 `95a3342bd9a761add13121a40a3101f07bcecce9d2fec178864b0dbde7ada131`.
- `browser-after-recovery.stderr`: SHA-256 `8e70ceeaac198d91ef793db7c105ec28a41cbc9ec9e7161df49e3b85077f298f`.
- `browser-after-recovery-context.json`: SHA-256 `3e3d6f05f5850c025cbeee8e82777eeba5d962f8da20015c7c576e8884b2a84d`.
- `browser-recovery-preparation.json`: SHA-256 `3240089d8285dca35ed2438b50929f74c9757da8e51f3081de03fd6fcc499914`.
