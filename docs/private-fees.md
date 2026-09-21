# Private posting fees

Users fund a private FeeJuice balance in the shared fee contract. Before a
transaction executes, the contract reserves its maximum fee from that balance.
At the end of execution it returns the reservation minus the protocol transaction
fee as a private note belonging to the same user. The net debit is the transaction
fee, not the reservation. There is no fee-service operator or markup.

The browser and application command-line client simulate the transaction, adds 10% gas headroom, and caps those limits
at the configured ceiling. They then validate the final settings once before
proving, because changing the reservation can change which private notes are
spent. A failed validation stops the transaction; it does not retry with a
different payment method. The initial simulation still requires enough credit
for the configured ceiling. That is a temporary balance requirement, not a charge.

Aztec V5 charges the full reserved teardown allowance as part of the protocol
fee. Tightening that allowance matters even with refunds. The refund amount and
shared payer are public; the refund recipient and balance are private. This does
not hide funding on Ethereum or network connection metadata.

## Publishing the fee contract

Refund completion is a public contract function restricted to calls from the
contract itself. Consequently, its class and canonical instance must be published
before users fund it. `createPrivateFeeDeployment(wallet, artifact)` prepares the
universal deployment with zero salt and no initializer. The deployer sends this
using their own funded FeeJuice account; it cannot bootstrap through the unpublished
fee contract. Normal client preparation rejects an unpublished instance.

This changes the contract class and canonical address. Existing credit remains
at the old address; changing application configuration does not migrate it.
Do not point existing users' credit records at the new address.

## Build and release requirements

The refund contract requires matching generated contract artifacts, browser
bundle, and deployed configuration. Publish the rebuilt contract and configure
its new address with a nonzero teardown allowance before using it.

Before release, check successful and reverted transactions, zero refunds,
unauthorized refund calls, private balance conservation against receipt fees,
and cold-start bridge claims. Those checks must use the rebuilt contract; tests
against the old generated artifact do not qualify this change.
