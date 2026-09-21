# Independent review preparation

Prepared 2026-09-18. This is an early scope and evidence index, not a frozen
candidate, audit report, final dependency disposition or production approval.
Application engineering remains on Aztec 5.2.0; V6 migration needs its own exact
compatibility assessment. No reviewer has been contacted.

## Review boundaries and concrete questions

| Boundary | Implementation | Required review |
|---|---|---|
| Ethereum collateral and Aztec claim/exit | billboard/portal/src/; billboard/billboard_contract/src/; shared/protocol-commitments.mjs | Intended sender/recipient/version, amount and nonce binding; authentic message membership; one-time consumption; escrow conservation, forced ETH, reentrancy and refund identity. |
| Private note history and economics | billboard/billboard_contract/src/ | Owner/contract/slot/deposit ancestry, authentic predecessor, no fixed retrieval cutoff, independent post identity, screening deadlines and penalties, overflow and exit liveness. |
| User-funded private fees | billboard/private_fee_contract/src/; shared/private-fee-client.mjs; shared/private-fee-payment.mjs; shared/private-fee-funding.mjs | Authentic bridge credit, replay protection, private ownership/debit, shared public payer, maximum-fee charge, exhaustion and no public fallback. Public funding and cold-start correlation remain explicit limits. |
| Keys and recovery | shared/wallet-backup.js; shared/l2-journal.mjs; shared/ethereum-journal.mjs; shared/journal-backup.mjs; shared/application-nullifier.mjs; apps/src/ | Encryption/key handling; exact logical-operation and note binding; lost responses, dropped/replaced proofs, duplicate submission and unknown outcomes; RPC/configuration changes. |
| Browser proving and hosting | shared/private-pxe.mjs; shared/browser-chonk-stream.mjs; shared/crs-client.js; deploy/hosting-config.mjs | Pinned SDK equivalence, worker/cache lifetime, full CRS integrity, local/node verification, CSP and origin isolation, metadata leakage and unsupported environments. |
| Moderation and operator authority | censor-daemon/; scripts/operator-launch.sh; shared/deployment-manifest.mjs; shared/portal-runtime.mjs | Model output remains inert data; signer authorization, durable jobs and recovery, policy identity/window and irreversible flags, actual deployment/runtime identity. Model quality has not passed. |
| Public reader | shared/public-feed.mjs; shared/public-feed-source.mjs; shared/public-feed-rpc.mjs | Wallet-free reading, canonical rollback/replay, bounded incremental work, untrusted-content rendering and source/configuration identity. |

## Existing evidence to reproduce selectively

Read BUILDING.md and TESTING.md first. Use pinned tools and disposable test users.
Application transactions are genuinely proven; official accelerated local settlement
controls are the protocol boundary. Do not provision a network epoch prover.
Each expensive run is serialized, limited to 540 seconds and sampled 4 GiB.

- execution/evidence/T01/acceptance-012.md: contract suites, executable bounded
  invariant models with mutation controls, genuine screening and ten-author run.
- execution/evidence/T02/: three successful native full lifecycles, wrong-origin,
  replay and bad Outbox membership checks. Failed claim-boundary013 is retained;
  diagnosis014 identifies test-induced PXE witness-cache contamination. Its repair
  passed genuine positive-control run015 in384341ms; qualification-016.md records
  the cache restoration and exact valid application journey.
- execution/evidence/U01/qualification-043.md: actual browser proof/inclusion and
  private-fee effects on one measured host. Fixture-driven UI checks are separately
  labelled. This does not qualify a full browser deposit-to-refund lifecycle.
- execution/evidence/T04/application-f8db2d4c-9d49-4199-a943-85db9fdb3bd0.json:
  complete current Chromium deposit-to-refund lifecycle448614ms, canonical
  application effects and cleanup. Browser matrix and interruption coverage remain.
- execution/evidence/O01.json: packaged moderator handover, policy change,
  restart reconciliation, monitoring and encrypted recovery acceptance.
- execution/evidence/W03.json: durable recovery scope and exact linked artifacts.
- execution/evidence/D01.json: deployment/runtime verification and operator package.
- execution/evidence/A02/residual-release-register.json: exact historical residual
  advisory obligations, not current clearance. Refresh actual packaged reachability.

## Compiler and dependency obligations

Keep execution/evidence/P04/compiler-diagnostic-review.md,
execution/evidence/T02/compiler-reconciliation-008.json and
execution/diagnostic-coverage.json together. There are 26 original diagnostic
occurrences at 12 sites and 57 fresh occurrences at 18 sites; none is closed by
agent assertion. Separate observable application regression checks from independent
assessment of protocol/compiler assumptions. Review the exact installed/embedded
protocol artifacts and verification keys with caller/site correspondence before
freezing the packet. A source-language warning alone is not an application exploit.

Carry the exact-lock residual inventory into review, including browser/native and
embedded-tool reachability. Do not infer security from npm package labels or
exclude a component merely because its direct dependency is marked development.

## What prevents final packet completion

1. Reconcile final test sources with the completed claim-boundary positive control.
2. Reconcile the completed T03 privacy traces and disclosed RPC/funding limits against the final candidate.
3. Complete the supported browser, recovery and workload qualification, including
   remaining genuine lifecycle and interruption cases.
4. Qualify the deployed Qwen3.5-9B against independently reviewed held-out labels
   and representative capacity. Its 48 provisional cases passed classification,
   but measured response p95 exceeds the recorded target and one real flag is
   not a capacity qualification.
5. Reconcile completed internal operations evidence with final sources and collect
   external operator ownership/configuration acceptance.
6. Freeze source, distributable/build-input manifest, protocol/VK inventory and
   current diagnostic/dependency mapping. Historical passes are not a final snapshot.

No external review engagement or fee is authorized by this document. When the
packet is concrete, present scope and revision for reviewer engagement. Independent
review, remediation/closure, fresh network suitability, operator ownership and
sustained operational evidence remain release gates.

## Evidence identity and cost

Keep the current broad source snapshot for historical traceability. At final
candidate preparation, distinguish actual deployable/build-input identity from
supporting test/documentation identity using the release manifest and an explicit
change-impact assessment. Do not silently change the fingerprint algorithm or
reuse historical evidence as a current pass. Unchanged behavior can be reconciled;
changed behavior requires affected tests. Changes affecting assurance require
reviewer disposition even if deployed bytes are unchanged.

## Installed inventory checkpoint

`execution/evidence/R01/protocol-inventory-002.json` records 81 installed
protocol/circuit JSON artifacts, including serialized VK digests where present.
All 80 protocol-package inputs in the existing browser SDK manifest match the
installed bytes; 53 of the inventoried artifact JSON files are embedded inputs.
This is byte correspondence, not proof of soundness or a complete diagnostic
caller map. Extra installed server/simulated artifacts are explicitly not assumed
to execute in the browser. The candidate is still changing.


## September 21 engineering checkpoint

These newer records supplement the historical index above; they do not freeze a
release or replace the independent review requirement.

- `execution/evidence/T04/metamask-cold-qualification-284.json`: actual MetaMask
  private-fee funding and paid claim/post, with exact Ethereum transaction guards.
- `execution/evidence/T04/browser-performance-pilots-20260921.json`: one cold and
  one warm proof each in installed Chrome and the tested Firefox and WebKit builds. These are pilots,
  not statistical qualification; WebKit is not installed Safari.
- `execution/evidence/T04/chrome-performance-results-322.md`: 30 cold and 30 warm
  Chrome proofs, all verified and independently reviewed. Cold initialization plus
  proof p95 37.90s; warm proof p95 35.78s. Local conditions and recorded hardware
  limit the claim. Firefox328 and WebKit cohorts remain incomplete.
- `execution/evidence/T04/safari-public-reader-327.json`: installed Safari26.5
  directory, direct reading and refresh. Wallet/proving remains unverified.
- `execution/evidence/M03/live-timing-20260921.json`: deployed model detected and
  removed one synthetic threat through an actual Aztec transaction.
- `execution/evidence/M03/deployed-qualification-20260921.md`: model results and
  remaining label, latency and capacity limitations.
- `execution/evidence/T04/aws-backup-recovery-20260921.json`: private S3 backup,
  downloaded-file checks, offline encrypted-state authentication and failure cleanup.
- `execution/evidence/T04/aws-reboot-recovery-20260921.json`: existing EC2 recovered
  automatically in 134 seconds. Replacement-host recovery was not tested.
- `execution/evidence/T04/aws-health-monitor-20260921.json`: native timer publishes
  aggregate health to CloudWatch; no notification recipient is configured.

Moderation review must distinguish retrospective removal under current rules from
penalties, which retain their publication-policy and deadline restrictions. See
`docs/moderation-review.md`. The public reader hides flagged text; chain history
cannot be erased by this application.
