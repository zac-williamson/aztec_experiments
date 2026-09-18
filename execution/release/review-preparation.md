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
Each expensive run is serialized, limited to 540 seconds and sampled 2 GiB.

- execution/evidence/T01/acceptance-012.md: contract suites, executable bounded
  invariant models with mutation controls, genuine screening and ten-author run.
- execution/evidence/T02/: three successful native full lifecycles, wrong-origin,
  replay and bad Outbox membership checks. Failed claim-boundary013 is retained;
  diagnosis014 identifies test-induced PXE witness-cache contamination. Its repair
  still requires the genuine positive-control run015 outcome.
- execution/evidence/U01/qualification-043.md: actual browser proof/inclusion and
  private-fee effects on one measured host. Fixture-driven UI checks are separately
  labelled. This does not qualify a full browser deposit-to-refund lifecycle.
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

1. Finish the claim-boundary positive control and reconcile final test sources.
2. Complete public transaction/RPC/funding privacy traces and truthful user claims.
3. Complete the supported browser, recovery and workload qualification, including
   remaining genuine lifecycle and interruption cases.
4. Qualify an actual moderation model against suitable independently reviewed
   held-out labels; the two current candidates failed.
5. Complete operational monitoring and reproducible failure/rotation drills.
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
