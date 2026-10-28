# Rolling Chat: start here

Current handover: 28 October 2026. The owner's current request takes precedence over historical task records. Credentials and private account material stay outside Git.

## Live work and next action

**Performance work remains paused by the owner.** Harry feedback wallet/account/payment UX and Home ranking are published. Images and the moderation-information item were dropped. MetaMask’s official hostname scanner returns BLOCK for the current CloudFront hostname; manual classification review is needed. See docs/METAMASK_ALERT_20261028.md. No external report has been sent. [Current release report](docs/HARRY_FEEDBACK_20261028.md).

28 October current publication: core application and static UI8e68ac4ae34fb214f9816cec0ffc75a4a3e60727; Bok051a530c; prover63e4c1d3. The new Board and optional Bok use one consolidated funding router. Atomic Post all, name+avatar, character ring, main posting-credit controls, ETH/USDC top-ups and one-like-per-account UI are published. PR9 branding and nested messaging remain integrated. Private paid tips are integrated as an unpublished20-FEE release candidate. Canonical contract/SDK builds, focused integration checks, repeated-like browser behavior, native tip transfers/spending and atomic Bok invocation checks passed. Real-proof acceptance and publication remain pending; see docs/PRIVATE_PAID_LIKES.md.

Portal activation **does not require an epoch proof**. The explicit immutable testnet deployment operator activates after checking the canonical checkpoint binding. Actual activation was observed16seconds after that checkpoint on27October. User withdrawals/refunds retain their ordinary protocol proofs.

Nine services checked active; Bokready/active0. First live acceptance found stale published Aztec L2 fee-price ceilings (2.129e12 below observed9.491e12). The static wallet update set the ceiling to18.9817e12 and regenerated matching registration/manifest. Registration capture now rejects stale fee prices. Published UI updates only those ceilings; unchanged contracts, gas limits, credentials, provider settings and running services. Live signup quote now succeeds (0.00100951ETH / approximately$2.37 testnet reference). Fresh signup, name+avatar, atomic two-post thread, Like/reload and ETH posting-credit topup succeeded. Both posts have actual native inclusion positions in one transaction; nested replies render and collapse. USDC swap inventory was replenished. The first100-credit claim exposed a transient balance refresh being misreported as payment failure; UI1e83d0df fixes that. A second30-credit USDC purchase completed uninterrupted with one signature, automatic claim and balance529.2636→550.7869. MetaMask-extension prompts and new-release Bok requests were not rerun.

Current browser test uses owned test EIP1193 wallet, not the MetaMask extension. One retained build: `/private/tmp/rolling-browser-proof-spans-build`. Reviewed application source8e68ac4a is pushed to master and both application branches. Prior performance reports are historical and do not establish current release timings. No optimization agent is active.

## Performance targets and evidence

- Every nonordinary transaction flow: at least50% end-to-end reduction against a comparable recorded baseline. This goal remains unachieved; live measurements are available above.
- Normal account opening: wallet selection→correctly priced enabled payment button within2s. Report immediate/cold and warm cases separately, with wallet approval dwell. The old1.729s warm explicit-new-account shortcut was NOT normal onboarding acceptance.
- Ordinary posting: click Post→visible feed text after actual native Aztec inclusion within15s. Historical74c cases228/600characters measured11.095/11.894s. Latest recorded a75 case was13.993s. These are observed cases, not guarantees about network inclusion.
- Do not replace actual usable completion with early DOM insertion, wallet acknowledgement or prover acknowledgement. Included is not checkpointed; background status must update automatically.

Latest precise warm funded opening before the two new warm-start batches was1.766840s on f20. The following fe8 cached observation was2.462485s with endpoint-only data; its complete3.071610s trace used a warm HTTP cache. Latest clean ETH-to-usable Bok observation was37.178030s on f20. Existing public-network and wallet-dwell differences remain explicit in the measurement documents. Measure the current code before claiming the new optimizations meet either target.

Detailed records: [transaction performance](docs/TRANSACTION_PERFORMANCE.md), [posting performance](docs/POSTING_PERFORMANCE.md), [onboarding measurements](docs/ONBOARDING_MEASUREMENTS.md), and `execution/evidence/G21/stable6/other-transaction-latency/`. Use the existing bounded performance snapshot to capture repeated oracle calls; `performance.getEntriesByType('measure')` alone loses repeated spans. Do not compare different releases, balances, payload sizes, wallet dwell or completion endpoints as matched runs.

## Scope constraints

All old test application data is disposable. No migration, old-account recovery or backward compatibility work. Keep credentials and security controls. Reuse healthy fixtures only when useful.

Follows, bookmarks and read state are off-chain; obsolete contract paths are removed. The public server has a persistent SQLite index, but ordinary reads still gate on fresh synchronization. The owner requested diagnosis only: do not change that request-gating architecture without a later instruction.

Signup funding, posting-credit top-ups and Bok top-ups now share one router; standalone BokCreditRouter paths are removed. Private paid tips are integrated as an unpublished20-FEE release candidate. Canonical contract/SDK builds, focused integration checks, repeated-like browser behavior, native tip transfers/spending and atomic Bok invocation checks passed. Real-proof acceptance and publication remain pending; see docs/PRIVATE_PAID_LIKES.md. Do not redeploy contracts for UI changes.

## Hosting and ownership

Read workspace `INFRASTRUCTURE_ACCESS.md` before credential or service work. AWS profile `message-board-deploy`, management via SSM. Core `i-0a9b5b9ba55815cda` (m7a.4xlarge); Bok `i-0a7d9957f2b3d7f19` (m8a.xlarge). Main CloudFront `E3BMCK3MOVYK1K`; generated-app CloudFront `E1M12FHGQ0S5ST` (`dy2q03rao3se7.cloudfront.net`). Keep services running. Monitoring must report availability failures, not stop healthy services.

Read-only public health endpoints: `/`, `/wallet/runtime.json`, `/prover/healthz`. Bok's `rolling-bok-testnet.service` exposes `/health` on8807; expect `status: ready` or `working`, not a generic boolean. Moderator health must come from its current PID and actual ingestion, with signing/manual-work counters assessed separately.

Bok uses private repository `zac-williamson/rolling-chat-bok-pool-20261015-03`, GitHub App5317701/installation171412624; selected test slot20261015-01 was also reset and made available. The unused20261025-01 repository has no added app access. Generated code receives no actor keys or AWS access and must pass isolated browser publication checks.

## Current deployment

Website: https://d30njln0kead8n.cloudfront.net
Repository: https://github.com/zac-williamson/aztec_experiments — default branch `master`. Integration branch `codex/rolling-chat-account-ux` and `codex/rolling-chat-draft3` receive the same reviewed changes.

Network: Aztec stable6.0.0, rollup `0x1f435a7f2da358caf887a470faeee7d5d5f4efba`, version679261766, Ethereum Sepolia11155111. No mainnet work.

| Component | Installed source |
| --- | --- |
| Browser UI | `/opt/rolling-ui/releases/1e83d0dfc1e019e3f1de853b29420e9cda0fca28` |
| Running application and moderator | `/opt/rolling-app/releases/051a530c16086f099365487adf2a46368d4fe8ac` |
| Configured next application source | `/opt/rolling-app/releases/ui-1e83d0dfc1e0` |
| Prover | `/opt/board-prover/releases/prover-gzip-63e4c1d3a11a5689c6400ce9e55fe13bff02d33a` |
| Bok | `/opt/rolling-bok/releases/051a530c16086f099365487adf2a46368d4fe8ac` |

| Contract | Current address |
| --- | --- |
| Board | `0x0a7f5a7759e057b620ddaa331f38db3e9a80ac2e57620f38504ded2ba0e8e351` |
| Private fee contract | `0x2fff4f1bed0f240982804499d6693530343bd3f9236fe82851fb7d46be990b3c` |
| Bok | `0x2064c2256f9fa155665a0c2dec7e3268092a4fc7117fd83876879e328712f813` |
| Posting deposit portal | `0xb3244958333e5c4eaa8a8de3ae1e9f04c748f266` |
| Single funding router | `0x0d19f70fe4d309b84907ef3b2d875f9ff3fc61df` |
| Bok portal | `0x5357586a6f902493c6b3193d7d2acd7cf813dfef` |

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
