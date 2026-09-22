# AI plugin deployment work

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
