# F01 public feed qualification

Implemented a separate wallet-free browser reader and shared public event index.
The user/moderator panels and CLI listing use it; moderation queue operation is
M02. Runtime contains only local public-read modules. Build-time pinned SDK APIs
compute event tags/class metadata; the browser never imports that SDK or prover.

Commands from repository root with pinned Node24.21.0:
- node apps/build.mjs: apps-build-010.log passes; public bundle23441bytes and
  standalone page13KB. Build metafile rejects all node_modules/private/proving
  dependencies in the public runtime. Frontend provenance includes its metadata.
- node --test --test-concurrency=1 with public-feed, source, review, rendering,
  frontend-provenance, private-fee engine/funding, W03 journal/backup/replacement/
  history/deployment, artifact/SDK/CRS/CLI-input test files: integrated-011.log
  reports380 passing checks, zero failures,21.1seconds. This is the final affected
  source run. Earlier broader integrated-009.log reported501 passing checks;
  it predates the policy restoration/cache-bound refinements and is not substituted
  for the final affected checks.
- node scripts/test-public-feed-browser.mjs: browser-012.log passes using actual
  Chromium and a child CLI process.55 posts,50+5 pagination, restart without another
  log scan, escaped hostile markup, only public IndexedDB, no private/proving
  requests. RPC data is controlled, not a live-network qualification.
- bash censor-daemon/run_tests.sh: moderation-012.log passes.
- node scripts/test-w02-browser.mjs: wallet-browser-012.log passes actual wallet,
  custody/journal restore and cross-tab locks across4 fresh profiles, max2 concurrent.
  These browser jobs ran serially and cleaned up owned browsers.

Source tests use actual pinned SDK ABI encoding and RPC schemas. Independent AI
review tests cover missing/duplicate publication order, missing policy, same-height
reorganisation, orphaned flags, canonical persistence, configuration/class mismatch,
policy A→B→A restoration, read deadline and unexpected cache fields. Earlier
browser-007 failed because its fixture gave the head a different hash than the
same numbered block; fixing the fixture produced008 and final012 passes. No
application check was bypassed to accept that failure.

Pagination fixes an upper publication order, follows stable IDs and invalidates
cursors on rollback. Occupied blocks and range/head checkpoints are rechecked
before atomic persistence. Unavailable RPCs preserve the previous cache and report
staleness. Reads scale with new block ranges and matching events, not all previous
posts per poll. Local projection still walks cached history and CLI moderation
input is bounded to10000 posts; this is not an unlimited index service.

Retention and privacy limits are documented in public-feed-runbook-013.md: only
public event/configuration fields, bounded cache, explicit quota/capacity/backfill,
no automatic pruning, RPC visibility, checkpointed reorg exposure. Cache records
are not an authority to sign. M02/M03, candidate T05, external audit, soak and target
clearance remain outstanding. This package does not declare production readiness.
