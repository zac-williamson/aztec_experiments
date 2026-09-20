# Incorrect local Ethereum receipt fees — reproduced and repaired

Wallet checks137–140 submitted actual deposit/refund transactions successfully,
then rejected gas-adjusted balance accounting. Canonical intent/events, escrow
clearing and Outbox consumption had passed. No application accounting defect was
established. Preserve all failed reports.

Anvil1.4.1 computes EIP-1559 receipt effectiveGasPrice as baseFee+priorityFee without
capping it at maxFeePerGas. Its actual execution charges the capped amount.
Official source: https://github.com/foundry-rs/foundry/blob/v1.4.1/crates/anvil/src/eth/backend/mem/mod.rs
(mined_transaction_receipt). Independent reviewer confirmed the same defect and
verified stable1.7.0 delegates to the correct transaction effective_gas_price API:
https://github.com/foundry-rs/foundry/blob/v1.7.0/crates/anvil/src/eth/backend/mem/mod.rs

Minimal reproduction141 uses one fresh zero-account local node and one transfer:
maxFee=priorityFee=baseFee=1gwei;21000gas. Actual debit21trillionwei, reported
receipt fee42trillionwei. No browser, bridge, application proof or network prover.

Fix the dependency, retain the exact equation. Project-local Anvil1.7.0 replaces
system Anvil for all six test callers using one strict resolver. Forge stays1.4.1.
The official asset reports version1.6.0-v1.7.0, commitf83bad912a9dba7bf0371def1e70bb1896048356;
the resolver verifies that identity. Evidence includes the executable hash.
Existing controlled-mining test now includes the capped-fee regression;142passes
both checks in7.4seconds. Independent structural review approved the migration.
No alternate receipt formula, fee bypass or relaxed balance check was introduced.
