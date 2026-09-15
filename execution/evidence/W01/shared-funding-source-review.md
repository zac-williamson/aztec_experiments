# W01 shared FeeJuice funding: pinned 5.2 source review

Read-only investigation, then bounded test-helper implementation; no network,
transaction, proof or heavy test executed in this lane. Installed SDK imports and
helper syntax passed under pinned Node 24.21.0. Runtime acceptance is pending the
parent's genuine local-chain harness.

## Actual deployment and mint authority

`node_modules/@aztec/l1-artifacts/l1-contracts/script/deploy/DeployAztecL1Contracts.s.sol`
lines 121–145 deploy a fresh `TestERC20("FeeJuice", "FEE", deployer)`, initially
mint 1e18 to deployer, and deploy a FeeAssetHandler with fixed `mintAmount=1000e18`
whenever `existingTokenAddress()==address(0)`. The handler is added as a token
minter. `DeploymentConfiguration.sol:72` defaults EXISTING_TOKEN_ADDRESS to zero.
The repository `scripts/c01-application-deployment.mjs` does not pass an existing
token; its initial validators also preclude that SDK option. The deployed fixture
therefore supplies a fee handler; assert the actual nonzero returned/node address.

`src/mock/FeeAssetHandler.sol:24` exposes permissionless `mint(address recipient)`
for its fixed amount. Only `setMintAmount(uint256)` is owner restricted. This is a
local test faucet, not a production-token acquisition facility.

Fallback direct token ABI is `TestERC20Abi` from
`@aztec/l1-artifacts/TestERC20Abi`: `mint(address,uint256)` requires
`minters[msg.sender]`. Constructor marks deployer as minter. Handover transfers
ownership to CoinIssuer but does not remove the deployer's minter mapping entry.
The exported L1 `FeeJuiceContract` from `@aztec/ethereum/contracts` implements
`mint(to,amount)` and waits for a successful L1 receipt. This fallback is not
needed for the actual default fixture; do not confuse token ownership with mint
membership or use unrestricted mint against arbitrary deployed tokens.

## Exact bridge / claim APIs

- `L1FeeJuicePortalManager` from `@aztec/aztec.js/ethereum`:
  `await L1FeeJuicePortalManager.new(node,deployment.l1Client,logger)`.
  `getTokenManager().getMintAmount()` and `.mint(l1Client.account.address)` mint
  the handler amount and wait for its L1 transaction. Manager constructor needs
  an extended wallet/public viem client, supplied by deployAztecL1Contracts.
- `bridgeTokensPublic(sponsorAddress, amount, false)` approves the actual portal,
  deposits, waits for L1 receipt and extracts the exact matching recipient/amount/
  secret-hash event. Return fields are `claimAmount`, `claimSecret`,
  `claimSecretHash`, `messageHash` (hex), and `messageLeafIndex` (bigint).
  Alternatively `(sponsorAddress,undefined,true)` mints and bridges the fixed
  handler amount in one helper call. `mint=true` rejects custom amounts unequal
  to the faucet amount. Supplying an amount with `mint=false` needs no handler.
- L2 `FeeJuiceContract` from `@aztec/aztec.js/protocol` uses
  `FeeJuiceContract.at(wallet)` (no address parameter), then
  `.methods.claim(sponsorAddress,claimAmount,claimSecret,new Fr(messageLeafIndex))`.
  Root's `proveApplicationAction({wallet,owner:operatorAddress,interaction})`
  constructs and proves an ordinary operator-paid transaction, asserts its actual
  fee payer, and returns the exact transaction for node validation and submission.
- `FeeJuicePaymentMethodWithClaim` is unsuitable for this separate operator-paid
  replenishment: its payload fixes both recipient and fee payer to its sender,
  using `claim_and_end_setup`. The ordinary `claim` function is explicitly intended
  to pre-fund another address for future fees. It binds destination and amount in
  the message content, consumes the message with its secret/index and nullifies
  replay; the private function queues the public recipient balance increase.
  Amount is u128, so validate that range before proving.

## Ordinary Inbox inclusion

`@aztec/aztec.js/messaging` exports `waitForL1ToL2MessageReady(node,hash,
{timeoutSeconds,chainTip})`. It compares the message checkpoint with the selected
chain-tip checkpoint; default `latest` may be ahead of a checkpointed/proven PXE.
Do not use a latest-only readiness check for a different PXE anchor.

The implemented helper follows existing C01 inclusion logic instead: temporarily
set actual ordinary sequencer `minTxsPerBlock:0,buildCheckpointIfEmpty:true`, sync
PXE, obtain its exact header, and request the message membership witness at that
header's block. Check its leaf index/tree height, recompute the Poseidon Merkle
root and verify the canonical block hash. Restore the original sequencer settings
before expensive proof work and in finally. Wait at most 120 seconds for membership
and 120 seconds for ordinary successful checkpoint inclusion; parent owns the
540-second process bound and existing background L1 miner. No injected Inbox tree,
storage writes, instant automine transaction path or fake inclusion is used.

## Implemented helper and checks

`scripts/w01-shared-funding.mjs` exports
`fundW01Sponsor({node,wallet,operator,sponsorAddress,l1Client,mineL1,mark,amount})`.
`operator` is an AztecAddress, matching root's caller. It requires local L1 chain
31337, an initially unfunded distinct sponsor, and a fee-funded operator. The
optional amount is positive bigint u128 no greater than one faucet mint; omitted
means the fixed faucet amount. It asserts exact L1 mint/deposit balance deltas,
Inbox membership, canonical anchor, genuine proof, actual operator fee payer,
real node acceptance, successful canonical inclusion, full sponsor balance credit
and operator fee debit. It returns plain sanitized observation fields only.

Claim secrets and signing material remain local variables. The bridge logger is
silent (including `getBindings`), exceptions expose only a fixed stage label,
and restoration errors are sanitized. No executed transaction result is claimed
by source inspection or an import/syntax check. The harness must verify the
actual local deployment and preserve its outcome before W01 acceptance.
