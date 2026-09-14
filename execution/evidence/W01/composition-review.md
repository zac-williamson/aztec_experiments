# First local sponsor composition

The final two-ticket observation is
`network-composition-abbbd8bb-ffbd-4be1-bb54-e03ff5ee0dcb.json`.
Its input hashes bind the network harness and composition module, and the worker
records the loaded sponsor/target artifact hashes. Fixture-context.json binds
those artifacts to the compiled source and pinned dependency inventory.

On a fresh local chain, only the administrator and sponsor received synthetic
genesis funding. Both freshly generated author accounts remained at zero public
FeeJuice balance. Two direct private-root sponsor calls produced successful
application effects (counter3 then8). Each sponsor debit was positive, exactly
equal to its receipt fee and below the configured ticket cap. The administrator's
balance did not change during either author transaction.

A third attempt reused coupon0 but signed a different action with a fresh nonce.
It was rejected before submission. The test independently derived the expected
coupon nullifier from the owner's secret, the sponsor and the actual claims
storage layout. It matched the reported public nullifier collision exactly.
Secret and app-specific hiding keys were not recorded. Sponsor balance and the
application counter were unchanged by the rejected attempt.

The earlier two-ticket run failed only because its expected rejection wording
did not include "siloed"; that failure and its successful payments remain in
`network-composition-a36ee3d3-c08c-4a9a-96e9-5106b5fcda49.json`.
The corrected wording run passed before the stronger exact-nullifier check was
added and passed. No failed observation was rewritten.

Both child processes exited normally after wallet/node/subscription/proving
cleanup, and temporary data was removed. The root reviewed the delegated module,
verified the pinned wallet creation, deployment, gas, receipt and balance APIs,
and integrated the actual tests. The delegated agent independently identified
the coupon-nullifier derivation; root added the comparison and ran it.

This is a real local transaction-path observation with a mock L1 verifier and
private proof generation disabled. Receipts are proposed inclusions, not
production finality. It establishes neither cryptographic release assurance nor
production anonymity. Public-revert coupon consumption, inclusion-time expiry,
issuer and funding correlation, replenishment/outage controls and integration
with the production message-board ABI remain open. W01 is not complete.

Reproduce with the pinned Node runtime:
`node scripts/test-fee-network.mjs --compose --all-coupons`.
The fixture artifacts must match the source-bound context selected by the module.
