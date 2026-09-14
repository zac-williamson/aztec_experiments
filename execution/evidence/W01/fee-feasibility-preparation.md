# W01 fee feasibility preparation

Read-only review, 2026-09-12. This prepares the next experiment while P04 is in verification; it does **not** implement W01 or satisfy its acceptance criteria. No chain was started, container image pulled, wallet opened, proof generated, or transaction submitted in this lane.

## Recommendation

Use the installed 5.2.0 `SponsoredFeePaymentMethod` and disposable local SponsoredFPC as a **mechanism and observability control**. Two newly generated accounts should demonstrably share one public fee payer without funding either account's public Fee Juice balance. Then qualify a production fee design with enforceable spending authorization and a funding privacy assessment. The unconditional testing contract cannot establish W01's budget/abuse requirements.

Do not substitute the installed `PrivateFeePaymentMethod`: its source explicitly marks it unsupported on mainnet. Current official documentation agrees, and says the built-in SponsoredFPC is available on local network/devnet/testnet but not mainnet. These are deployment availability claims, not a prohibition on designing a different FPC. [Official fee guide](https://docs.aztec.network/developers/docs/aztec-js/how_to_pay_fees).

## Installed mechanisms

All paths below are relative to `/Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments` unless absolute. They refer to actual installed 5.2.0 code, not inferred compatibility from older documentation.

| Mechanism | Actual payer and API | Assessment |
| --- | --- | --- |
| `SponsoredFeePaymentMethod(fpcAddress)` | `getFeePayer()` and execution payload return the FPC address. One private `sponsor_unconditionally()` call, no arguments or authorization witnesses. | Suitable local shared-payer control. No enforceable admission/budget policy. |
| `PrivateFeePaymentMethod(fpc,sender,wallet,gasSettings)` | FPC pays; user authorizes the accepted token's `transfer_to_public` through an authwit, then invokes the reference FPC private fee entrypoint. | Deprecated. Its reference token-payment flow does not establish default public-network setup compatibility. |
| `FeeJuicePaymentMethodWithClaim(sender,claim)` | `claim_and_end_setup((Field),u128,Field,Field)` on protocol FeeJuice; payload payer is **sender**. | Bootstrap/negative control; reusing this account retains a public payer identifier. |
| Default account Fee Juice | Account's public Fee Juice balance pays. | Negative privacy control, not the required ordinary posting route. |

Exact SDK sources:

- `node_modules/@aztec/aztec.js/dest/fee/sponsored_fee_payment.js`
- `node_modules/@aztec/aztec.js/dest/fee/private_fee_payment_method.js`
- `node_modules/@aztec/aztec.js/dest/fee/fee_juice_payment_method_with_claim.js`

Actual pinned contract source: `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/noir-contracts/contracts/fees/sponsored_fpc_contract/src/main.nr`. It labels itself testing-only and its entire sponsorship body sets itself as fee payer and ends setup. It has no authorization, expiry, quota, or application restriction. [Pinned upstream contract](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/noir-projects/noir-contracts/contracts/fees/sponsored_fpc_contract/src/main.nr).

**Inference from that contract:** an off-chain rate limiter cannot prevent a caller using the contract directly. Paying for arbitrary calls also exposes a sponsor to application reverts and costly transactions. A production sponsor needs enforcement inside the validated transaction path, such as a carefully specified authorization capability; choosing its design remains W01 work. Do not add reusable public author identifiers to solve admission control.

## Private alternative to qualify

The official private-fee guide describes community package `@alejoamiras/private-fee-juice`: a fully private FPC with per-user private credit backed by its public Fee Juice balance. Its documented methods are `FPCFeePaymentMethod(fpcAddress)` and cold-start `PrivateMintAndPayFeePaymentMethod(fpcAddress,amount,bridgeSecret,bridgeSalt,leafIndex)`. Funding bridges to the FPC, then claim/mint establishes credit. Cold-start bundles claim and mint/payment; separating funding from application use can reduce timing correlation. Payment consumes the maximum gas charge without refund. Artifact and salt determine the address, so version mismatches matter. The guide describes avoiding custom public token calls in setup. [Official private Fee Juice guide](https://docs.aztec.network/developers/docs/aztec-js/how_to_use_private_fee_juice).

This is a candidate, not an adopted dependency. Its community source/README could not be retrieved by the web tool during this review (cache-miss responses); it was not installed or independently audited here. Verify exact source revision, artifact/compiler compatibility, scopes and gas options, credit backing, replay/double-mint prevention, recovery, and actual funding observability before selection. [Referenced implementation](https://github.com/alejoamiras/ecosystem-tooling/tree/main/packages/private-fee-juice).

## Disposable local setup

Installed entry points are `node_modules/@aztec/aztec/dest/bin/index.js`, `dest/cli/aztec_start_options.js`, `dest/cli/aztec_start_action.js`, and `dest/local-network/local-network.js`. The supported convenience command is `aztec start --local-network`; its installed shell wrapper starts Anvil, configures local polling, and starts the node. [Official local-network guide](https://docs.aztec.network/developers/getting_started_on_local_network).

For a supervised experiment, invoke the already installed pinned executables directly, avoiding a global wrapper that can select another version. The following argument lists are verified against source but **not executed** here:

```text
/Users/zac/.foundry/bin/anvil --host 127.0.0.1 --port 18545 --chain-id 31337 --silent

/Users/zac/.nvm/versions/node/v24.15.0/bin/node node_modules/@aztec/aztec/dest/bin/index.js start --local-network --l1-rpc-urls http://127.0.0.1:18545 --port 18080 --admin-port 18880
```

The experiment harness should choose unused ports; use a clean environment, a fresh temporary working/data directory, and enforce loopback-only access to all services. Do not inherit existing RPC/network, wallet, or data-directory settings. The CLI local-network branch only forwards L1 mnemonic/RPC and test-account options to `createLocalNetwork`, so do not assume a generic CLI `--data-directory` reaches that branch. Environment-derived configuration is read by `createLocalNetwork`; verify isolation explicitly or call it programmatically with the intended temporary configuration. Keep raw startup output private because the CLI can print an admin key. Persist only allowlisted observation fields. Bound startup and transactions; always terminate, kill on timeout, and reap both processes using the established lifecycle helper.

Actual local API:

```js
// Illustrative API sequence, not a completed experiment.
const node = createAztecNodeClient('http://127.0.0.1:18080');
await waitForNode(node);
const wallet = await EmbeddedWallet.create(node, { ephemeral: true });
const fpcAddress = await registerDeployedSponsoredFPCInWalletAndGetAddress(wallet);
const paymentMethod = new SponsoredFeePaymentMethod(fpcAddress);
// After creating/registering fresh accounts and the disposable test contract:
await contract.methods.operation(...args).send({
  from: freshAccountAddress,
  fee: { paymentMethod },
});
```

Imports: node client/wait helper from `@aztec/aztec.js/node`; `EmbeddedWallet` from `@aztec/wallets/embedded`; registration helper from `@aztec/aztec`; payment method from `@aztec/aztec.js/fee`. `node_modules/@aztec/aztec/dest/local-network/sponsored_fpc.js` derives the installed artifact with `SPONSORED_FPC_SALT` and calls `wallet.registerContract(instance, SponsoredFPCContract.artifact)`. `EmbeddedWallet.create` and `createSchnorrInitializerlessAccount(secret,salt,signingKey,alias)` are installed APIs. Generate fresh secrets/signing keys for A and B in memory; account registration/deployment prerequisites must be exercised rather than assumed. Default deterministic local accounts may bootstrap this disposable network but are not the privacy subjects.

**Critical local limitations:** `local-network.js` automatically extends the setup allowlist for token fees, deploys L1 with `realVerifier:false`, defaults `realProofs:false`, and enables automine synthetic epoch settlement. A token FPC succeeding here does not show it works under the target network's default setup allowlist. Enabling wallet proofs alone does not turn this network into evidence of L1 verifier acceptance. The default local sponsor is genesis-funded when initial test accounts are enabled; that bypasses the production replenishment path. A later stage must exercise actual funding and target-equivalent rules. No large image download is needed merely to attempt this installed local path, but successful native startup is not established yet.

## What to measure

The actual serialized private-kernel tail inputs include `feePayer`: `node_modules/@aztec/stdlib/dest/kernel/private_kernel_tail_circuit_public_inputs.js`. A submitted `Tx` exposes it at `tx.data.feePayer`. The actual node interface in `node_modules/@aztec/stdlib/dest/interfaces/aztec-node.js` supports `getTxByHash`, `getPendingTxs`, `getTxEffect`, and `getTxReceipt`. Capture full submitted transaction observables before submission or while pending; do not assume indefinite RPC retention after mining.

`node_modules/@aztec/stdlib/dest/tx/tx_effect.js` contains `transactionFee`, `publicDataWrites`, nullifiers, note hashes, and logs; it has **no direct `feePayer` property**. Derive the public balance footprint using `computeFeePayerBalanceStorageSlot` and `computeFeePayerBalanceLeafSlot` from `@aztec/protocol-contracts/fee-juice`, defined in `node_modules/@aztec/protocol-contracts/dest/fee-juice/index.js`. For private-only transactions, `node_modules/@aztec/simulator/dest/public/public_processor/public_processor.js` explicitly debits that FeeJuice public balance and emits a public-data write. Public-call transactions use the AVM payment path instead.

Maintain separate, minimal views for chain observer, RPC operator, funding observer, and sponsor operator. Capture payer/balance slot, gas/fee, execution result, finality, public calls/effects and timing; separately assess IP/authentication and L1 deposit sender/amount/recipient/timing. Shared sponsorship removes an individual fee-account tag; it does not by itself establish network anonymity or hide the application's public activity. Do not publish local identity secrets or collect persistent production author identifiers as metrics.

## Experiment controls and remaining decisions

1. Fresh A, B, A private calls through one sponsor: verify identical public payer, unchanged zero author Fee Juice balances, actual sponsor debits, execution success and receipt finality. Include a default-payer control to show the observation distinguishes A from B when expected.
2. Zero sponsor balance, wrong/unregistered sponsor and unsupported configuration: explicit failure, no fallback to account fees. Preserve uncertain submissions for receipt reconciliation instead of blindly funding/retrying.
3. Public application revert: measure fees charged despite execution failure; compare private simulation/proof rejection before submission. The receipt's inclusion status alone is not success.
4. Direct use bypassing the proposed sponsor service: show the unconditional test contract lacks admission enforcement. A future restricted sponsor must reject unauthorized, expired, replayed and over-budget requests within the transaction validation path.
5. Independently test shared sponsor replenishment and any user-funded private-credit bootstrap. Compare ordinary, cold-start and delayed funding traces. Genesis prefunding is not funding-privacy evidence.
6. Rerun the chosen route with target-equivalent setup restrictions and a clearly identified proof-verification configuration; then integrate actual board posting after the contract lane is ready.

Unknowns remain: target-network permission/availability (X03), production funding source and limits, sponsor policy, private-FPC exact compatible artifact/review status, RPC threat model, actual privacy-set size, native local startup/proving performance, and quantitative fees. W01 acceptance requires measured results and an adopted design; this preparation establishes neither.

## Source fingerprints

SHA-256 of the inspected local bytes (documentation URLs are current, mutable pages):

- `node_modules/@aztec/aztec.js/dest/fee/sponsored_fee_payment.js`: `4853de63d2ed70010fde36f716d94b176ee04c50dce0b49643a343cbea8a3534`
- `node_modules/@aztec/aztec.js/dest/fee/private_fee_payment_method.js`: `6938a6f33da96edd3fac4981fc394794d7ba219e9176a68b2eb4d262895933ee`
- `node_modules/@aztec/aztec.js/dest/fee/fee_juice_payment_method_with_claim.js`: `573af74001503cc1955dddcf0ca0e86febae0a4c3078eb28f1cefcd5b490ea98`
- `node_modules/@aztec/aztec/dest/local-network/local-network.js`: `3b6270748a6c06b56fe6124fae6ae0adc1f9386f2dc151f366eb36d3973d9590`
- `node_modules/@aztec/simulator/dest/public/public_processor/public_processor.js`: `16aa714931c3d990ba4a716340cee06b0c42862cc98bf5fe54575c2e2b98574e`
- `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/noir-projects/noir-contracts/contracts/fees/sponsored_fpc_contract/src/main.nr`: `2c3780b249da3a7984a65e63929aaaafaefd7a40a382e0596548b8b2013a5326`
