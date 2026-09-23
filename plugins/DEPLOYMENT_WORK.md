# AI plugin deployment work

## Active deployment execution

User authorized execution of all remaining deployment items after commit 4a7164a.
Root remains sole writer. Current lanes: public deployment/access/fresh accounts
(root), read-only latency architecture review (public_latency), and read-only
Venice cost-bound / treasury API investigation (provider_budget). Heavy tests remain
serialized. Do not reuse personal wallets or rent infrastructure. Public testnet
transactions and release integration are now in scope; local bot hosting retained.
Checkpoint (September 23): complete public user flow qualified on V5/Sepolia.
The new board, per-plugin Aztec escrow and Ethereum USDC portal are active.
HTTPS /plugins-preview/ and descriptor use the existing message-board-deploy profile;
the original website and remote prover are preserved. Bot and censor run locally.

Fresh real MetaMask funding, proof-enabled claim and composer post, paid Venice
inference, exact-content draft PR #7, visible unflagged reply, withdrawal and actual
Ethereum redemption all passed. Two Venice invoices match the 1468 micro-USDC
escrow debit. The user redeemed 998532 micro-USDC, ending with 1998532 token units.
Wrong-recipient and replay rejection passed. Each phase met its time/memory bounds
and completed owned-process cleanup. Funding's interrupted wallet window was
explicitly reconciled against its original transaction; no duplicate payment.

Native interruption qualification 979Irf passed: real proofs, actual wallet funding/
posting, no replay after service restart, and release of expired funds through the
UI. The local fixture waits for actual finalized checkpoints before advancing time.

Release artifacts now include both plugin contracts, the browser bundle and service
sources. All 24 published assets match local SHA-256 hashes. Complete Solidity
builds reproduce clean Linux artifacts. The pinned TXE missing-message lifecycle
repair passed seven focused checks and all 38 grouped bridge tests; it affects only
the test runtime. Compiler-discovered batches preserve every Noir test and each
batch's deadline. No production SDK or financial gate was weakened.

Independent reviews found no additional plugin blocker. The current full CI result
is recorded on [PR #6](https://github.com/zac-williamson/aztec_experiments/pull/6);
release requires those checks to pass. Detailed evidence is under `plugins/evidence`.
The operator is trusted to report usage, and Venice's conservative input bound
remains documented. This is a pinned V5/Sepolia candidate, not a mainnet deployment.

User scope: fix the September 22 deployment gaps; trusted operator cost reporting
is accepted. This worktree remains separate from the main application release graph.

- Implemented: on-chain request status, cancel/release UI, explicit stopped/uncertain
  states, measured-cost cleanup, provider readiness before reservation, service health.
- Implemented: deployment/activation/registration commands, exact-transaction journals,
  separate owner/operator earnings withdrawal, operator fee checks and fee-credit claim.
- Implemented: supervised read/write/operations scenarios. Live write checks exact
  draft PR content and the entire user financial lifecycle. All test modes are explicit.
- Small-balance research: a pinned Kimi-template byte bound was rejected in review
  because Venice does not bind its serializer to that template. The strict context
  ceiling remains; the service now reports the exact minimum balance in its reply.
  Reducing that requirement without weakening the spending bound remains unresolved.
- Public target found: main worktree `.build/aws-testnet/site-public-config-272.json`,
  V5 testnet / Sepolia. Endpoint identity verified. Observed checkpoint-to-finalized
  timestamp lag was 3384 seconds; this is one observation, not a latency SLA.
  This initial discovery predates the successful public fund/post phases above.
- First proof-enabled browser run: actual native proofs/setup completed, then live
  Venice lookup failed TLS validation before any inference. Preserved as a failed run.
- Connectivity repaired: Mac Wi-Fi used router DNS returning an unrelated address
  and IPv6 loopback for api.venice.ai. Changed Mac DNS to 1.1.1.1/1.0.0.1; standard TLS
  and authenticated Venice balance now pass. No TLS bypass or secret change.
- First operations run: real contract assertions passed including operator redemption,
  but worker did not exit after cleanup. Preserved as failed; worker exit fixed.
- Second proof-enabled live-write run: Venice performed real paid inference,
  created draft PR #3, and posted its reply. Exact GitHub file comparison failed
  because the generated file lacked the requested newline. This remains a failed
  qualification; the next prompt specifies the content as an exact JSON string.
- Operator fee onboarding fixture initially requested a nonstandard faucet mint
  amount; corrected to use the official portal's mint amount.
- Review fixes: reject wrong-actor deployment replay before changing saved state;
  pinned descriptor caching revalidates content and scope and tolerates unavailable
  browser storage. Cached descriptors allow balance actions during service downtime.
- Passed: `.build/plugin-operations-XviQRC`, native-proof operator deployment,
  zero-balance fee onboarding, registration and earnings redemption; user funds
  preserved. Successful cleanup and supervisor exit.
- Passed: `.build/plugin-browser-ULOndD`, native-proof real MetaMask composer flow,
  live Venice, exact-content draft PR #4, visible reply, 0.001444 USDC measured
  charge and 0.998556 USDC redeemed remainder. Successful cleanup and supervisor.
- Post-run fix: canonicalize GitHub branch IDs from full numeric invocation IDs;
  SDK decimal fields previously lost their first two digits. Toolbox API regression
  covers decimal and hexadecimal IDs. All 49 plugin tests pass.
- Passed: `.build/plugin-operations-EwLhcd`, final real-contract regression of
  wrong-actor deployment replay with unchanged saved state. This isolated regression
  disables proving and does not buy provider inference; cleanup/supervisor passed.

Independent read-only review: escrow_review; no reviewer source edits.
These initial local runs did not deploy to the existing public board or rent infrastructure.

September 23 checkpoint:
- Committed invocation-budget/concurrency work 4a995a3 and optional explicit
  operator signing-key CLI support 05cfec0. 43 focused CLI/deployment tests passed;
  one overbroad test glob also selected a guarded browser executable and was
  rejected before starting it. SDK/apps rebuilt from source normally.
- New public board 0x2374be31ee9d56c4734a532da5f3aa03e70587e67c46abfbfc3e77df12b0b8da;
  normal portal 0xb6815f47a27a31b3cad3fccd5ad1e44c65117592. Binding checkpointed;
  activation awaits real finality. Initial gas shortage resolved using Google's
  free faucet (0.05 Sepolia ETH), preserving the saved deployment transaction.
- Plugin escrow 0x268b076e85d9f80a647f0b5de6e8ca18cf62e57f8ea7245a7d2e9e06e8421371;
  portal 0xac6a96b63cd1299d2a167aaf565a6cef7b370790. Binding in progress.
- Operator setup now returns at checkpoint; public activate/redeem explicitly
  require finalized successful source receipts. Service reserves still finalize
  before provider spend. Independent review: public_latency. 64 plugin tests pass.
- Separate CCTP treasury command implemented/reviewed (provider_budget), with
  finalized destination mint/fee/nonce verification. Real Sepolia source burn
  0xdbb61c96376345d03693137548e673aad6c8dd5993ca38d58660ea10ae5229a2
  passed source verification; forwarding completion remains pending.
- Preparing a fresh browser author funded solely from the new faucet wallet.
  Public browser qualification, local service installation, HTTPS publishing and
  release integration remain open. No mainnet treasury transfer was made.

- Final current-source native-proof browser read regression passed (vpAbpx):
  paid Kimi/GitHub read, visible reply, 1458 micro-USDC billed and 998542 redeemed;
  389 seconds, peak 3.10 GiB, owned process tree absent. Public evidence saved.
- Persistent local LaunchAgent local.aztec.bok installed; authenticated repository
  readiness and service health passed. No additional remote instance.
- Public normal board portal activated. Fresh author received 2 test USDC,
  0.02 test ETH and claimed private fee credit with a native proof. Normal board
  collateral deposited via the existing user CLI; claim still pending.
- Public browser review (plugin_fit) found missing admission fixture and resumed
  journal acknowledgement; preparation now includes normal board admission,
  and reply/redeem reconcile the saved L2 transaction through the application API.
  Invoice assertions restored; qualification requires successful supervisor cleanup.
- HTTPS publication needs refreshed existing message-board AWS login. Active SSO
  compute role explicitly denies S3 upload; no policy bypass attempted. User was
  asked to run aws login --profile message-board. No site publication claimed.

- Real CCTP transfer finalized: 1 test USDC burned, 945250 micro-USDC received on
  Base Sepolia, 54750 forwarding fee. Public evidence committed in 3b882ec.
- Fresh author normal collateral claim passed with real proof; state postable.
- Public Inbox readiness distinction reproduced: inclusion checkpoint exists while
  membership witness is absent. Browser/fee preflight now checks the witness;
  reviewed by plugin_fit. Earlier premature moderator claims sent no transaction.
- Local moderator preparation: Docker started; ARM b11058 image and pinned 9B
  weights downloading. Same upstream release as the existing remote moderator.
  Operator private fee bridge sent; native claim pending, isolated from bot funds.

- Current source pushed as draft PR #6. Site preview preserves the existing root
  website, with independently reviewed equivalent CSP and new /plugins-preview/
  policies; staged public inventory now includes its board configuration.
- Local censor startup/isolated runtime passed. Fresh real public test post 0
  evaluated OK in 11816 ms; no queue errors or feed lag. This is one smoke example,
  not broad moderation quality qualification.
- All task-owned source changes committed; public qualification/merge remain open.

Credential correction: the Remote prover service task established the long-lived
Identity Center session and message-board-deploy / MessageBoardCompute2 profile.
The prior request to refresh the legacy message-board login was incorrect.
Verified current STS identity and successful Bok descriptor S3 upload using
message-board-deploy. No user authentication or permission change was required.
Continue publication through that profile, preserving the existing root site.

Publication correction completed: uploaded the reviewed /plugins-preview/ static
inventory and descriptor, published the CSP function with current ETag after
verifying the old live policy was unchanged, and invalidated preview paths.
HTTPS feed returns 200 with matching artifact bytes, COOP/COEP/CSP headers;
HTTPS descriptor bytes match the expected pinned document. Existing root-site
policies preserved. Plugin binding still awaits finality; public wallet phases
and release remain outstanding. AWS authentication is not a blocker.

Execution resumed for full AI-plugin release. Root owns public activation/register/
wallet qualification and release; plugin_fit independently reviews the real-contract
interruption scenario. That scenario reuses the existing browser supervisor and
real USDC/escrow, explicitly simulates a runner interruption, then verifies restart
suppression and expired-fund release through the ordinary UI. It does not claim
actual provider billing during the injected interruption. Heavy runs remain serial.

Public qualification diagnosed descriptor CORS failure; exact /plugins/bok.json
now serves Access-Control-Allow-Origin: *, preserving all root/preview policies.
Browser rejection assertion now requires the actual escrow insufficient-balance
reason. The previous generic error is not accepted as that qualification.
Repeated persistent-profile sessions restored duplicate application tabs/PXEs and
one run exceeded the 4 GiB supervisor limit. Evidence preserved; no payment moved.
Harness closes restored pages while preserving storage, then creates one app page.

Independent review identified real early-redemption and deposit-preflight traps:
failed gas estimates could persist intents for transactions never submitted.
Account client now preflights before recording intent, passes the measured gas
limit to submission, and waits for finalized successful public withdrawal receipts.
Three regressions added; all 67 plugin checks pass. Apps rebuilt; public wallet
qualification restarted with this candidate. No paid inference claimed yet.

Unfunded-error qualification is being strengthened at the actual SDK simulation
boundary; the application's existing fee wrapper and UI both intentionally redact
raw errors. Shared test observation records only a boolean and preserves results.
A second public run exceeded total RSS during setup despite restored-tab cleanup;
archived as failed with unchanged author/portal balances. Bounded next hypothesis:
V8 transient heaps trigger the 4 GiB total before GC. Public verifier heap now
384 MiB, browser heap 512 MiB; total supervisor limit remains unchanged. One run
under this hypothesis is active. No fund-phase payment has been made yet.

Memory investigation: heap limits and explicit native verifier crypto did not
resolve the total-RSS failure; neither is claimed as a fix. Browser target inspection
showed one application page. Refactored the public harness to sequential native
precheck, browser actions, native postcheck, matching existing application tests.
Verifier wallets/contracts/crypto are disposed before browser launch; browser closes
before independent checks reopen. Source reviewed by plugin_fit with no blocker.
The supervisor retains 4 GiB/nine-minute bounds. Fund run in progress.

Same-process verifier disposal still retained ~768 MiB. Replaced only that test
boundary with a bounded, short-lived read-only inspector process (no transaction
methods); it exits before Chromium and runs again after browser closure. Existing
Supervisor owns descendants and cleanup. Standalone inspector passed; independent
review approved. Parent during browser setup now ~244 MiB. Current fund run reached
actual insufficient-balance rejection (specific underlying escrow reason verified)
and real MetaMask deposit, with no inference charge before funding.

Short-lived native inspection fixed the overlapping-memory limit: fund run peaked
at 3536832 KiB. The specific unfunded escrow rejection passed. Actual MetaMask USDC
approval and 1-USDC deposit both landed (author1USDC, portal1USDC, allowance0).
MetaMask notification confirmation closed the application window before test
bookkeeping finished; this run remains failed, archived as failed-wallet-close.
No duplicate payment. Explicit recover-fund verifies the original saved intent
against sender/nonce/account/amount and successful receipt, then independent state.
Transaction confirmations now use the sidepanel path already qualified locally.
Both changes independently reviewed; reconciliation run active.

Fund reconciliation PASSED with clean process/supervisor cleanup. Original interrupted
run retained; no second deposit. First post-phase attempt exceeded memory during
setup before a claim; independent chain check confirmed zero credit/requests and
unchanged post count. Static test server now streams CRS and honors byte ranges
(exact range regression passed), and unlocked MetaMask UI closes when not needed.
Both changes reviewed. Current post phase reached real Aztec plugin-credit claim.

Release CI investigation: fork PR #6 build failed because the locked @aztec/bb.js
5.2.0 package's Linux x64 executable reports 5.2.0-nightly.20260807. Downloaded the
exact lockfile tarball, verified its SHA-512 integrity, and matched all four native
binaries against that package. Toolchain now pins each binary's exact SHA-256 and
reported version, checking hashes before execution including BB overrides. Two
regressions passed; independent review plugin_fit found no blocker. Rebuild/CI
qualification remains pending, serialized after the active native browser test.

Release artifact coverage repaired: the contract build manifest now hashes the
complete plugin adapter and portal artifacts; checks require the private claim
verification key and current Solidity provenance. Reproducibility includes both
contracts and the plugin browser bundle. Release inventory includes hosted service
sources and actual native-prover version. Rebuild and inventory write/check passed;
39 focused artifact/toolchain checks and 77 plugin/release/CI checks passed. The
canonical PluginPortal artifact will be tracked and plugin unit checks run in CI.

Native interruption e48GjW passed the memory cap (4041440 KiB), all user funding/
posting, reservation and restart suppression, but expiry release failed with
PRIVATE_FEE_PREPARATION_FAILED. Failure retained, complete cleanup confirmed.
Next bounded hypothesis follows the maintained wallet-absence fixture: keep the
sequencer paused across checkpoint retention and the simulated 24-hour jump.
Failed RPC method names are now captured without request/response payloads.
Public post finalized and bot became active; paid spending still waits for the
actual reservation's public finality.

Expiry diagnosis: utility observation reproduced the SDK invariant failure
"Highest aged index (5) must not exceed highest finalized index (1)". Pausing
the sequencer alone is insufficient: official markAsProven changes storage,
while the archiver reads that storage at finalized L1. Next bounded run mines
L1 and waits for the actual node finalized checkpoint to cover retention before
the 24-hour time jump. No production gate changes. Removed raw error observer.

Native interruption qualification 979Irf PASSED: 372228 ms, peak 3778064 KiB,
owned process tree absent. Real proof-enabled browser deposit/claim/post, reserve,
restart without paid replay, finalized-before-warp expiry and UI release passed.
Public Bok invocation completed and created draft PR #7; public reply/withdrawal
phase running. Bot restarted only after active=0 and is healthy with current code.
CI clean build exposed stale incremental Solidity AST/source IDs (bytecode unchanged).
Both release Forge builds now force a complete source compilation; rebuild and CI
verification pending. Artifact drift checks remain strict.

Public reply phase PASSED: 109062 ms, peak 4182544 KiB, complete cleanup. Exact
draft PR #7 and visible unflagged reply verified. Actual Venice invoices match
1468 micro-USDC debit; 998532 micro-USDC withdrawal checkpointed at 92533.
Redemption awaits real withdrawal finality. Finality gates unchanged.
Forced Solidity build passed, both portal artifacts exactly match clean Linux
outputs. 31 focused checks passed. Commit ac724d3 pushed; fresh CI active. Independent
final plugin review found no additional blocker, conditional on redemption/CI.

Release CI fixture updates: frontend provenance fixtures now include plugin
sources and bundle (16 focused checks;185 build checks passed). Remaining
application fixtures were stale relative to actual application.readFeed, wallet
factory signatures, proving policy and published-class queries. Updated only
test boundaries;131 application checks,85 affected deployment/fee checks and
131 protocol/receipt checks pass with all original assertions retained. Independent
review approved.41 dependency checks passed. Commit26e129c pushed; fresh CI
running. Public withdrawal advanced to proven; Ethereum redemption still waits
for finalized status.

FULL PUBLIC FLOW PASSED: Ethereum redemption transaction
0x315f0ab6a244f67efdec49dd1ccb8add73df9b2f255b7d4e0973aad05b2453e0
returned 998532 micro-USDC. Final author token balance1998532, exact invoice debit
1468, wrong-recipient/replay rejection passed. Redemption36979ms,peak3492784KiB,
owned tree absent. CI-only remaining defect: pinned SDK witness helper starts
a nullifier query then throws for missing message without awaiting it, allowing
TXE session disposal to close world state mid-read. Independent reviewer traced
the exact path. Narrow TXE import-hook repair joins both reads using the SDK's
allToCompletion before unchanged validation. Exact source hash guards patch drift;
no installed dependency or application bundle edits. Five focused tests pass,
including reproduction against original source. Bounded real TXE regression running.

Final local CI repair qualification: compiler-discovered c01 batches ran all 38
tests in 85721 ms, peak 1895104 KiB, owned tree absent. Seven lifecycle/batch unit checks
passed; independent review approved. Public redemption is complete. Superseded
monolithic CI runs were cancelled before the complete batched candidate was pushed.
