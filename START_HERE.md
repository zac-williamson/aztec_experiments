# Rolling Chat: start here

Current handover: 26 October 2026. The owner's current request takes precedence over historical task records. Credentials and private account material stay outside Git.

## Live work and next action

**Owner paused the performance goal on26October2026. Do not resume optimization automatically.** Funded functional verification is complete with explicit remaining limits in [the report](docs/FUNCTIONAL_CHECK_20261026.md). Fresh ETH and USDC signup, first post, funding/withdrawals, names/profile/avatar, boards/follows/bookmarks, quote/repost and real Bok generated-app creation/edit were exercised. Final fresh USDC signup→first included/rendered post succeeded without retry on UI f9d42ce4. Fixed the native-anchor cooldown readiness failure and completed relay-payment reconciliation. All required services running. Actual MetaMask extension, independent empty-browser restoration and live moderator/terminal edge paths remain unverified; native checks are labelled separately.

27 October: PR [#9](https://github.com/zac-williamson/aztec_experiments/pull/9) merged and published. Current UI `2305be593a7494f5f69085129fdeaba9e078f357`; baseline `/private/tmp/ui-2305be593a74/next-baseline.json`, SHA35629f4f96705383170ba1e187bf73935ee5eb088b583b984e95ee45d4e4a215. Configured next app source `/opt/rolling-app/releases/ui-2305be593a74`; running process remains `/opt/rolling-app/releases/ui-f9d42ce4616e`, PID311339. Proxy PID427800; all seven core services active. SDK, wallet, contracts and application process unchanged. New brand assets served by reviewed exact-path allowlist. Real reply and nested reply included in Aztec; final pointer folding, home navigation and desktop/mobile checks passed. See [UI release report](docs/UI_PR9_RELEASE_20261027.md). Performance remains paused.

UI baseline `/private/tmp/ui-99dcfe60fec9/next-baseline.json` SHA511a428c071d888b5a0bb87b421499cf34c811dd5b1381d5b2013e67040fc32e. Latest99 Like10.657020s (24.60% below comparable14.134775s baseline), Unlike11.604790s (no goal-start baseline). c993 funded warm opening2.166935s;58-byte bio16.215390s; name24.028000s. Targets remain unachieved and paused.


26October measurement update: browser access is restored without changing settings. On live e291, funded warm reopen measured2.255125s and1.914850s; name creation20.912730s;58-byte bio18.548505s; repeated like visible-count14.691035s. No application edits were made for these measurements. The fresh signup2s and all-flow50% targets remain open. Saved traces are under execution/evidence/G21/stable6/other-transaction-latency/*e291*.json. The historical browser-blocked notes below are superseded by this update.

Static `e291136f04155604e8414e0da0f3d97275a8ff67` is live and pushed. Standalone topups no longer queue a second full account scan; Bok receipt/workflow reads overlap, and fresh ETH qualification overlaps wallet nonce lookup.1199 affected checks across the final UI/aggregate/application suites passed; exact public worker/panel hashes verified. Generic profile/name/subboard fee metadata now overlaps synchronization; immediate moderation removes one duplicate review while retaining final fresh authority.863 affected checks and actual browser builds passed; public worker/SDK bytes verified. Fresh opening prepares its quote once under one funding lease; browser owner discovery skips writes only for an identical staged fact/origin set. Funded opening skips all unused signup pricing; Bok claim discovery overlaps immutable reads, and required message-nullifier reads are prefetched through the existing native anchored cache. New end-to-end timing is pending because CUA began denying access after restart. Early contract artifact preload and public JSON compression are deployed; CloudFront Brotli forwarding was corrected and exact decoded hashes verified. Same-invocation Bok claims reuse authenticated custody and Ethereum evidence while retaining native membership and nullifier authorization. Browser compiler metadata projection removes 7.71MB without changing contract identities. Cached funded opening measured **1.766840s**, but first changed-SDK opening measured **8.560355s**: cold opening remains outside the two-second target. Actual repeat ETH-to-usable Bok credit measured **37.178030s**, with 6 USDC visible; claim preparation was 1.882s. A prior f20 payment includes 15.628s test-handler dwell and is functional evidence only. The all-flow 50% target remains unachieved. Browser access worked for the recorded f20 measurements, but now CUA denies access after restart. No settings were changed or services restarted.

Bok runs the three-file `bff92b32` operator overlay with the existing bbf76 native dependencies. Public observations from different requests can proceed independently of the shared signing queue; same-request journal ordering and signing serialization remain. Moderator received the corresponding public-read overlap.235 integrated checks passed. BokPID96885 was ready/active0. Moderator now runs `a0c2c10c` on PID191841, with healthy current ingestion and zero manual-attention or unresolved-signing items. It corrects the false critical classification of two strictly unsigned canonical orphan posts. It preserves signed/uncertain work and requeues reobserved posts.158 affected checks passed.

Both operator publishers retain the existing dependencies, credentials, security settings and attestor/control bytes. Failed drains restore normal restart policy without force-killing or duplicating work. The reviewed implementation and20 failure subcases are in `deploy/updates/20261026-operator/`. Other app/node/query/prover/proxy services were unchanged. Temporary transfer versions, archives and completed source-only agent drafts are removed; keep one retained build at `/private/tmp/rolling-browser-proof-spans-build`.

**Next:** Await owner direction. Performance work is paused; no optimization agent remains active. Unintegrated drafts are not live.

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

The next contract deployment must merge signup funding and Bok top-ups into one router and remove standalone BokCreditRouter paths. The reviewed single-router draft and private paid-tip implementation remain separate and are not live. Do not redeploy contracts for UI changes.

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
| Browser UI | `/opt/rolling-ui/releases/f9d42ce4616e74094c165f846d54aed264a71f17` |
| Running application | `/opt/rolling-app/releases/ui-f9d42ce4616e` |
| Prover | `/opt/board-prover/releases/prover-gzip-636d0a581fe81108f09bfc04731e45c46ce35abf` |
| Bok | `/opt/rolling-bok/releases/operator-be6f9f724e69faef3f64802ccbe4782fb7dce082` |
| Moderator | `/opt/rolling-app/releases/operator-a0c2c10c199c3057b99da9b7941f54b2951f1cc1` |

| Contract | Current address |
| --- | --- |
| Board | `0x20283bc7ab7d5bd5dd325a5aab82d8f9b3c62b79328c2e8417e119b66e789028` |
| Private fee contract | `0x2fff4f1bed0f240982804499d6693530343bd3f9236fe82851fb7d46be990b3c` |
| Bok | `0x0319568b28b770c8ae772be9ba0f40eaaf21fdc9b5910d6284cce317ab000428` |
| Posting deposit portal | `0xa50c167ddd8f87f2e20a7f3206cf2077db0a4d0d` |
| Signup payment router | `0x5d51072ce94eb0eaba3e1f2c4516fc0ad8b33a68` |
| Bok portal | `0x5055956c605555c348cf4bdbd978bbed34eac95a` |
| Bok credit router | `0x97a013a22c4472a16d6a8693e3883ac09a6d1ffa` |

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
