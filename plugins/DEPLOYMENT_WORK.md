# AI plugin deployment work

## Active deployment execution

User authorized execution of all remaining deployment items after commit 4a7164a.
Root remains sole writer. Current lanes: public deployment/access/fresh accounts
(root), read-only latency architecture review (public_latency), and read-only
Venice cost-bound / treasury API investigation (provider_budget). Heavy tests remain
serialized. Do not reuse personal wallets or rent infrastructure. Public testnet
transactions and release integration are now in scope; local bot hosting retained.
Checkpoint: one reservation per invocation and concurrent independent users implemented.
Native-proof live browser qualification passed (.build/plugin-browser-8Bdsjj): PR #5,
three paid Venice calls, 1667 micro-USDC charged, 998333 redeemed. 57 unit tests pass.
Independent review public_latency found no remaining escrow-budget blocker; its
concurrent Venice top-up finding was fixed with serialized readiness and a regression.
Fresh public operator fee claim checkpointed; waiting for network finality. Fresh
Ethereum account received faucet Sepolia ETH and 20 test USDC. Existing AWS SSO
access and static HTTPS hosting confirmed. Next: compatible public board deployment,
CCTP treasury transfer, local service installation, and public qualification.

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
  No real public-network plugin transaction has been qualified yet.
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
No deployment/push to the existing public board, or new rented infrastructure.

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
