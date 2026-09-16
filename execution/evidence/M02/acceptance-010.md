# Durable moderation acceptance

Working directory: Anonymous Message Board/aztec_experiments. Node24.21.0,
pinned Aztec5.2 build inputs, macOS local host. All checks use disposable state;
no user wallet, production transaction or downloaded LLM was used. Heavy builds
and browser checks ran sequentially.

Implemented a local SQLite WAL queue, atomic feed ingestion, deadline-ordered
leases, bounded retries, historical policies and durable model identity. This
adds no remote service or fee actor. Fixed trusted signer requests return bounded
structured receipt metadata; read-only exact-journal inspection recovers lost
responses without loading PXE/proving or broadcasting. Confirmation requires a
current canonical block, finalized successful receipt and exact public flag event.

Commands and observations:
- `node scripts/build-sdk.mjs` and `node apps/build.mjs`: exit0, pinned SDK and
  generated clients built; public reader23586bytes. Logs sdk-005/apps-005.
- `node --test --test-concurrency=1` over moderation-journal-status, public-feed,
  public-feed-source, public-feed-review, w03-journal, w03-proof-replacement,
  engine-private-fee, artifacts and frontend-provenance:208pass,0fail,13.2seconds.
  Log integrated-007. Later changes are confined to daemon queue/worker/docs.
- `node scripts/test-public-feed-browser.mjs`: exit0, actual built Chromium and
  child CLI,55posts over paginated feed, reload without log rescan, public-only
  database, no wallet/proving requests. Controlled RPC fixture; public-browser-008.
- `node scripts/test-w02-browser.mjs`: exit0, actual built browser,4fresh profiles,
  max2concurrent, actual portable journal restore, wrong-password rejection,
  restored identity, cross-tab exclusion and reload recovery. wallet-browser-008.
- Final `bash censor-daemon/run_tests.sh`:344pass (76moderation,129signer,
  24child daemon,115queue/worker/identity/receipt/wallet),0fail. Final artifact
  and frontend tests:39pass,0fail. Logs daemon-final-011/artifacts-final-011.
  Release manifest inventory succeeded with39files and1638inputs; exact prompt
  bytes are included. Source binding is recorded in M02.json. Earlier core/model/worker attempts are retained as diagnostics; an
  initial model-vector fixture padding error and dropped-state transition failure
  were corrected rather than counted as passes.

A01: finalized reverts clear signing intent for bounded retry. Unknown/pending
outcomes stay reconciled, never complete merely because the child exits. Atomic
snapshot ingestion creates every job before cursor progress, and restarts retain
completed decisions and pending receipts. Lost replacement responses recover the
newer authenticated journal hash, including after deadline, without another flag.

A02: real SQLite transactions and separate-process lease tests enforce one local
signing owner. Lease expiry, revoked ownership, interruption before/after intent,
reorged inputs, model rollover and replacement lineage have focused regressions.
Actual child CLI inspection is read-only and skips PXE/fee/proving preparation.
Model output cannot select executable, wallet, destination or operation.

A03: validated feed retains exact versioned policy content. Older posts use their
captured policy, while an empty board still validates current policy/window.
Missing/inconsistent policy fails closed. Six-word model transcript matches an
independently calculated fixture and changes with exact identity inputs.

A04: strict deadline boundaries, earliest-deadline order, retry exhaustion,
uncertain signing fences, backlog warnings and explicit permanent attention
states are exercised. Healthy included receipts waiting for finality do not burn
the uncertainty budget. Logs are local diagnostics; external monitoring delivery
and real workload/model capacity are later work.

Limitations: controlled RPC/model outcomes do not prove real model quality or
cryptography. Genuine proof recovery evidence remains the separately scoped W03
historical runs. The latest-only wallet journal limits unattended recovery of an
older reorged transaction once a newer action has replaced it; this becomes
explicit manual attention. Actual platform image/asset verification and >=300-case
real model evaluation remain M03. No external audit or production-readiness claim.
