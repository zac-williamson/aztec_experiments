# Prepared transaction expiry at admission

Passing observation:
`network-composition-4db24fd4-6de6-46b0-88be-24ef79e9053c.json`.
The test first spent coupon0 successfully, then prepared a genuine private-root
coupon1 transaction using the normal private execution/request path. It captured
the contract's expiration in transaction data and required ordinary node
validation to pass before changing the clock.

Only the disposable L1 clock/block and the node's same injected TestDateProvider
were advanced. The transaction bytes/hash did not change, its earlier anchor
remained canonical and the latest L2 header stayed unchanged. Admission validation
then failed solely with `Invalid expiration timestamp`; actual submission was
rejected with the same reason. The receipt was dropped/unmined and all checked
balances and the application counter remained unchanged.

The successful test records the actual admission timestamp, not an assumption
about wall-clock time. V5.2 maps the next L1 slot into an L2 slot-start timestamp.
At deadline+1 that value can still equal the deadline, which the strict less-than
expiry check permits. The retained `90d832fc` attempt demonstrates that boundary.
The final test advances an additional actual L2 slot and explicitly requires
the admission timestamp to exceed the deadline. It does not weaken the rejection
check. The earlier `9ca6a3d0` attempt failed on a default read-simulation fee
estimate; read simulations now use the explicit fixed gas settings too.

The helper does not rebuild the transaction after expiry, delete its state,
change protocol storage, waive validation or insert a fake proof result. It uses
the existing mock-proof local profile and records that limitation. This is
admission evidence, not yet a queued transaction's rejection during block
construction or genuine rollup-proof acceptance. All managed processes exited
normally and temporary data was removed.

Run with pinned Node:
`node scripts/test-fee-network.mjs --compose --expiry`.
W01 remains active; production integration and its other acceptance criteria
are incomplete.
