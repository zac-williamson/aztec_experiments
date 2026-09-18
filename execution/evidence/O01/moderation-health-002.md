# Structured moderation health

Extended existing SQLite status with aggregate operational health and atomic last-successful-ingestion time. Added pure allowlisted summaries to daemon cycle success/failure output; sanitized worker exception-code and manual error-code logging, and daemon raw exception-message/fatal logging. No lease, authority, signing, replacement, retry or model-selection behavior changed.

Validation: pinned Node24, health, health integration, existing job-store and worker suites: 79 tests pass (lightweight real temporary SQLite plus injected signer/model/node responses and actual daemon invalid-argument subprocess). No model runtime, proving, browser, live-network or build jobs.

Tests cover secret-bearing signer messages/codes, structured output omission of content/identities, restart retention, unresolved signing and reconciliation-exhaustion fence, failed feed retaining ingestion timestamp, stale ingestion, expired obligations, benign already-flagged work, deadline boundary and actual daemon fatal-output sanitization.

No chain head poll is added: ingestion age is not feed block lag. External alert delivery/acknowledgement, private-fee error aggregation, actual operator rotation/recovery rehearsal and exposed-credential inventory remain incomplete. O01 stays active.

Independent-review corrections: added `retryableErrors` aggregate and fixed `RETRYABLE_WORK_FAILED` warning so successful fresh ingestion cannot hide a failed model/context evaluation. Real SQLite/worker regression proves fresh ordinary queued work stays healthy while injected evaluation failure warns without exposing secrets. Removed trailing daemon whitespace.

Escrow transport correction: replaced ethers HTTP ownership with explicitly tracked AbortControllers. Per-request timers and final disposal abort active fetch/body reads; byte cap is 1 MiB per response. A real local hanging HTTP server test starts two requests, times out the observation, disposes transport, waits for both actual sockets to close and the listener to close, and rejects use after disposal. No inert-Promise-only claim of transport cleanup.

Combined corrected monitor, health, health-integration, existing store and worker suites: 87 tests pass, approximately 0.33 seconds.

Daemon integration compatibility review: six earlier failures were observability assertions affected by the new log format. Restored meaningful diagnostics with an exact allowlist (`INVALID_VERDICT`, `POLICY_UNAVAILABLE`, `POLICY_INVALID`, `ISOLATED_RUNTIME_REQUIRED`) and fixed aggregate state counts. Updated tests to assert exact `manual-review:1` / `confirmed-flag:1` counts and the fixed policy/isolation codes; retained all model-call, signing, success/finality and runtime-isolation assertions. Arbitrary exception content still maps to `MODERATION_FAILED`, never logs verbatim.

Corrected daemon integration suite passes 24/24 using injected model/signer infrastructure. Combined monitor/health/store/worker suite passes 88/88. No production model runtime or real proving ran.
