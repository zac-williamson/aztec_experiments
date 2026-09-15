# Adversarial bridge callbacks

`billboard/portal/test/PortalReentrancy.t.sol` adds six local EVM tests. Root runs the compiled tests; this note does not assert execution results.

- Inbox deposit and Outbox activation/withdrawal each attempt all three guarded entrypoints. Tests require the exact OpenZeppelin reentrancy error, rather than accepting incidental failures from missing receipts or disabled deposits.
- Dependency callbacks inspect current receipt/liability state: deposit accounting is already credited, and withdrawal receipt/liability is already cleared before Outbox interaction.
- Each dependency may reject after callbacks. Tests check atomic rollback of activation, receipt, nonce, ETH, liability and dependency state, then successful retry.
- Completed withdrawal cannot be repeated even though the fixture Outbox accepts arbitrary messages. This checks single-use receipt accounting, not forged-message resistance after a fresh redeposit.

The intentionally malicious bridge does not authenticate messages or proofs. An untrusted Outbox could authorize a false exit; the portal relies on the configured canonical bridge for authorization. Existing PortalV1 tests independently exercise canonical message/proof rejection and replay. Refund-recipient callbacks are also covered there. No administrator refund, replacement bridge, or live-right recovery path is introduced.
