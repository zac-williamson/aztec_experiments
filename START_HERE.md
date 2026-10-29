# Rolling Chat: start here

Current handover: 29 October 2026. The owner's current request takes precedence over historical task records. Credentials and private account material stay outside Git.

## Live work and next action

Fast-click Reply is fixed and published: `6e5f02ab`, promoted 29 October at 08:49 UTC, all seven real release flows passed. [Exact evidence and limits](docs/FAST_REPLY_20261029.md). This supersedes the earlier operations handover statement that the defect remained unchanged. Performance work remains paused.

Compact deployment background: compact Board gas optimization is **published and real-proof browser acceptance passed** on 29 October. Fresh Board `0x269bd57c385f1df1d652a0d0bb849cc7584b9a04083f0da4c65723c4a2a7ffd5`, matching SDK/readers/prover/moderator/Bok, one funding router, refund 40,000/512. Source 48c2750f is pushed to master. Fresh signup, a 29-byte post, two 20-FEE self-tips with count 2 and exact fee accounting, and a 44-byte post passed. The 29-byte post used 998,470 L2 gas and paid 2.760553580939 FEE at its inclusion-block price. Old test posts/accounts were not migrated. [Deployment and boundaries](docs/COMPACT_DEPLOYMENT_20261029.md). Operations acceptance is complete: J `03bb6b8d` passed all seven real flows and explicit rollback/return. Automatic release is enabled. Use the installed GitHub CI route for compatible app updates, not legacy manual replacement. See [operations handover](docs/LAUNCH_OPERATIONS.md). Performance remains paused.

**Performance work remains paused by the owner.** Harry feedback wallet/account/payment UX and Home ranking are published. Images and the moderation-information item were dropped. MetaMask’s official hostname scanner returns BLOCK for the current CloudFront hostname; manual classification review is needed. See docs/METAMASK_ALERT_20261028.md. No external report has been sent. [Current release report](docs/HARRY_FEEDBACK_20261028.md).

Historical predecessor: private paid-like release `86be52150de16ad6fe628000404e44e3592705bb`, now replaced by the compact deployment above. Each Like transfers 20 FEE to the author, plus actual network fees; repeated paid likes are supported. Atomic threads, name and avatar updates, Home ranking and the consolidated funding router remain integrated. **Real-proof browser acceptance passed:** fresh signup, a post, two paid likes with count 2 and exact self-tip fee accounting, then another post. See the recorded boundaries in the acceptance evidence; this is not a production security audit. See [private paid likes](docs/PRIVATE_PAID_LIKES.md).

An uninterrupted fresh signup paid ETH successfully, then failed before proof submission with `ROLLING_ABI_MISMATCH`. Board claim preparation still required the old ordinary-post gas-profile class. Commit `83f3cb7c54699914a5f57cf95f15c5fd2e8fbc06` instead verifies the deployed Board against its authenticated artifact, preserving layout and anchor checks. Its static wallet publication completed without restarting the application, prover or proxy. Fresh signup completed with one Ethereum payment and one Aztec claim. Follow-up commit `24f707f6` removed an old class-specific sync heuristic from the generic posting path and corrected the ordinary-post witness helper. The real post → two paid likes → post check then passed. These browser fixes change no contracts.

Portal activation **does not require an epoch proof**. The explicit immutable testnet deployment operator activates after checking the canonical checkpoint binding. Actual activation was observed16seconds after that checkpoint on27October. User withdrawals/refunds retain their ordinary protocol proofs.

Earlier signup, thread, name/avatar and ETH/USDC top-up successes were on the previous Board. They are historical evidence, not acceptance for the paid-tip deployment. The published fee ceiling is 18,981,708,800,000 base units per L2 gas; the read-only observation at 12:48 UTC on 28 October found a minimum of 1,250,000,200,000, so stale pricing did not explain the new signup failure.

Browser acceptance uses the owned test EIP1193 adapter, not the MetaMask extension. Reuse `/private/tmp/rolling-browser-proof-spans-build`. The sealed deployed campaign is `/private/tmp/rolling-tips-20261028-r1`; source and deployment records are retained there without copying actor credentials. Do not repeat payments or treat an interrupted test as a successful claim.

## Performance targets and evidence

Historical paid-like release measured post cost: a 29-byte post paid **3.5070118111218 FEE**, and a 44-byte post paid **3.5784680725548 FEE**. Both appeared after native Aztec inclusion. Each paid like transferred 20 FEE and paid an additional **2.1318353410936 FEE** in network fees. These are actual receipts, not the configured maximum. [Browser acceptance evidence](execution/evidence/G21/stable6/private-paid-likes/browser-acceptance.json).

Historical cost observation: a 22-byte ordinary post on release `8e68ac4a` paid **2.5016104002576 FEE**, with a configured ceiling of **124.140375552 FEE**. The real-proof transaction was checkpointed successfully. This is one measurement on the previous Board, not a quote or benchmark for the new paid-tip contracts. [Exact receipt evidence](execution/evidence/G21/stable6/private-paid-likes/basic-post-actual-cost.json).

- Every nonordinary transaction flow: at least50% end-to-end reduction against a comparable recorded baseline. This goal remains unachieved; live measurements are available above.
- Normal account opening: wallet selection→correctly priced enabled payment button within2s. Report immediate/cold and warm cases separately, with wallet approval dwell. The old1.729s warm explicit-new-account shortcut was NOT normal onboarding acceptance.
- Ordinary posting: click Post→visible feed text after actual native Aztec inclusion within15s. Historical74c cases228/600characters measured11.095/11.894s. Latest recorded a75 case was13.993s. These are observed cases, not guarantees about network inclusion.
- Do not replace actual usable completion with early DOM insertion, wallet acknowledgement or prover acknowledgement. Included is not checkpointed; background status must update automatically.

Latest precise warm funded opening before the two new warm-start batches was1.766840s on f20. The following fe8 cached observation was2.462485s with endpoint-only data; its complete3.071610s trace used a warm HTTP cache. Latest clean ETH-to-usable Bok observation was37.178030s on f20. Existing public-network and wallet-dwell differences remain explicit in the measurement documents. Measure the current code before claiming the new optimizations meet either target.

Detailed records: [transaction performance](docs/TRANSACTION_PERFORMANCE.md), [posting performance](docs/POSTING_PERFORMANCE.md), [onboarding measurements](docs/ONBOARDING_MEASUREMENTS.md), and `execution/evidence/G21/stable6/other-transaction-latency/`. Use the existing bounded performance snapshot to capture repeated oracle calls; `performance.getEntriesByType('measure')` alone loses repeated spans. Do not compare different releases, balances, payload sizes, wallet dwell or completion endpoints as matched runs.

## Scope constraints

All old test application data is disposable. No migration, old-account recovery or backward compatibility work. Keep credentials and security controls. Reuse healthy fixtures only when useful.

Follows, bookmarks and read state are off-chain; obsolete contract paths are removed. The public server has a persistent SQLite index, but ordinary reads still gate on fresh synchronization. The owner requested diagnosis only: do not change that request-gating architecture without a later instruction.

Signup funding, posting-credit top-ups and Bok top-ups share one router; standalone BokCreditRouter paths are removed. The 20-FEE paid-like contracts are deployed, with real-proof browser acceptance recorded. See [private paid likes](docs/PRIVATE_PAID_LIKES.md). Do not redeploy contracts for UI changes.

## Hosting and ownership

Read workspace `INFRASTRUCTURE_ACCESS.md` before credential or service work. AWS profile `message-board-deploy`, management via SSM. Core `i-0a9b5b9ba55815cda` (m7a.4xlarge); Bok `i-0a7d9957f2b3d7f19` (m8a.xlarge). Main CloudFront `E3BMCK3MOVYK1K`; generated-app CloudFront `E1M12FHGQ0S5ST` (`dy2q03rao3se7.cloudfront.net`). Keep services running. Monitoring must report availability failures, not stop healthy services.

Read-only public health endpoints: `/`, `/wallet/runtime.json`, `/prover/healthz`. Bok's `rolling-bok-testnet.service` exposes `/health` on8807; expect `status: ready` or `working`, not a generic boolean. Moderator health must come from its current PID and actual ingestion, with signing/manual-work counters assessed separately.

Bok uses private repository `zac-williamson/rolling-chat-bok-pool-20261015-03`, GitHub App5317701/installation171412624; selected test slot20261015-01 was also reset and made available. The unused20261025-01 repository has no added app access. Generated code receives no actor keys or AWS access and must pass isolated browser publication checks.

## Current deployment

Website: https://d30njln0kead8n.cloudfront.net
Repository: https://github.com/zac-williamson/aztec_experiments — default branch `master`. Integration branch `codex/rolling-chat-account-ux` and `codex/rolling-chat-draft3` receive the same reviewed changes.

Network: Aztec stable6.0.0, rollup `0x1f435a7f2da358caf887a470faeee7d5d5f4efba`, version679261766, Ethereum Sepolia11155111. No mainnet work.

| Component | Current deployment reference |
| --- | --- |
| Live application/UI | `/opt/rolling-release-live/current` (`6e5f02ab`, fast-click Reply fix) |
| Stage | `/opt/rolling-stage/current` |
| Releases / retained rollback | `/opt/rolling-releases`; J `03bb6b8d` is the previous release |
| Shared dependencies — retain | `/opt/rolling-app/releases/86be52150de16ad6fe628000404e44e3592705bb/node_modules` |
| Private runtime configuration — retain | `/var/lib/rolling-bootstrap-private/rolling-tips-48c2750f617b/config` |
| Prover, moderator and Bok | Coherent compact-deployment services; see [deployment record](docs/COMPACT_DEPLOYMENT_20261029.md) |

| Contract | Current address |
| --- | --- |
| Board | `0x269bd57c385f1df1d652a0d0bb849cc7584b9a04083f0da4c65723c4a2a7ffd5` |
| Private fee contract | `0x2d71392cfb41aa25a62c5ecc510400167dda9f3669676d2b539413a4fa0bcbb7` |
| Bok | `0x18eb9f9de94df31b450930e8b97c7f661cd69af7a992f1e076ec6c0d852208f7` |
| Posting deposit portal | `0xb1b393e696c1ceb744ad47325dd18e5c96f5c073` |
| Single funding router | `0x4036f93a035433b704fc60d52fdba4aa813ab2b3` |
| Bok portal | `0x487dc0ac4984ef830307044bad577713bee62392` |

Canonical Bok plugin ID is `0x0000000000000000000000000000000000000000000000000000000000626f6b`. This fresh contract scope has replaced the old test board; previous performance results are historical until repeated on the current scope.

Owner-only discovery is deployed: unconstrained AES256-GCM delivery with native note authorization/nullification and zero extra notes or logs. The rejected counter-note journal must never ship. Empty-store restoration and partial-refund behavior have focused native checks. The signature-derived account root remains quantum-vulnerable as previously disclosed; this change does not claim post-quantum confidentiality.

Accounts derive from the Ethereum wallet signature, with no password/backup import. Your account → Start new test account allows a fresh test account using the same Ethereum owner. Bok remains optional. Ordinary actions now release their operation at exact native Aztec inclusion, with fresh predecessor/anchor checks before the next operation. Incoming claims and bridge readiness use the native proposed tier. Checkpoint observation updates the UI separately; included transactions are never labeled settled.

**All old test application data is disposable.** Do not preserve, migrate, recover or maintain compatibility with accounts, posts, balances, databases or incomplete flows from old releases. Keep credentials and security controls.

## Operations and cost

Owner authorizes **USD 1,500/month ongoing hosting**. The current forecast is **USD 1,444.05 for 31 days including allowances**, following the same-instance worker change to m8a.xlarge. This saves approximatelyUSD18.89/month; no new resource was created. These are estimates, not billed spend. Reconcile [infrastructure ledger](execution/infrastructure-ledger.json) before changing resources. No additional hosts were created for this upgrade.

Obsolete expiry timers are masked and cloud termination schedules removed. Services must remain running. Monitoring reports availability problems; it must not stop healthy services after an observation failure. Systemd owns failed-process restart and cgroup cleanup. Existing security groups, private origins, scoped credentials, traffic shaping and generated-code isolation remain. Owner stopped scheduled agent work; do not create recurring agent automation or promise its alerts.

Use actual service state and narrow logs before intervening. Public checks are `/`, `/wallet/runtime.json` and `/prover/healthz`; authenticated node access uses existing private configuration. An old journal error may belong to an earlier PID. Wait for actual transaction/bridge state through native SDK waiters; a missing response is not grounds to resubmit a payment. Keep the current flow's signed transaction identity until its actual outcome is known.

## Development and evidence

Read `AGENTS.md`, [Aztec skill](skills/aztec-app-development/SKILL.md), [BUILDING.md](BUILDING.md) and [TESTING.md](TESTING.md). For continue/resume, validate the graph and select ready work, but current owner scope takes priority over historical campaigns. Native local development uses `realProofs: false` and `proverEnabled: false`; real proofs belong to the affected testnet acceptance boundary. Do not repeat complete onboarding to test a small UI change.

The historical graph is not evidence of the current network or an instruction to restart stopped campaigns. Broader production audit/network clearance gates remain separate from this owner-authorized testnet deployment. Source, public hashes and selected observations belong in Git. Secrets, signed URLs, raw account state, private service configs and raw signing/provider journals do not.

## Generated-app hosting checks — 23 October

Bok now uses one hosting policy for generation guidance, public headers and mandatory browser validation. Every new published revision needs desktop/mobile interaction and reload scenarios; runtime/policy failures return to Bok for repair. Receipts bind the exact artifact bytes, captured scenario plan and current policy. The browser remains sandboxed in the existing credential-free executor. Nineteen focused browser checks passed; the actual server executor accepted a working app and rejected both startup and click-only storage failures despite passing Node tests/builds. All nine services are running and the existing Daily Three app remains served. See [gate evidence](execution/evidence/G21/stable6/bok-browser-gate.json) and [operator documentation](deploy/BOK_BROWSER_VALIDATION.md). Checks cover exercised workflows and discovered controls, not all possible code paths or browser engines.
