# Project status

Application test refactor complete. The authenticated deposit/claim/exit/refund
package is verified and complete. Full genuine-transaction-proof integration
passed in4m24s, with1.6GiB peak memory and no network prover. Official SDK controls
advance local epochs and settle actual Outbox messages. All107 Noir,29 Solidity
and53 client tests passed; owned processes and temporary data were cleaned.

The retired network-proving entrypoint cannot run. About676MB of unused custom
AVM/epoch setup caches were removed. TESTING.md defines the application test commands.

Next: screening authentication (C02), with reviewed production and21 test drafts
ready to apply. Those drafts are not yet compiled/tested. Production readiness
still requires remaining application work, independent review, soak and network
release checks. No production deployment has occurred.
