# C01 proof-enabled environment preparation

Read-only preparation on 2026-09-12 (clock observation: 09:52:08 UTC). C01 has not started or passed in this lane. No chain, container, prover, dependency installation, transaction, or paid service was launched. Only this report was written.

## Conclusion and evidence levels

The minimum credible C01 environment needs a real 5.2 L1 verifier, genuine server-side epoch proving, and actual canonical Inbox/Outbox contracts in addition to a proving-enabled wallet. The standard `createLocalNetwork` convenience path is insufficient: installed 5.2 source unconditionally deploys `realVerifier: false`, defaults `useAutomineSequencer: true` and `automineEnableProveEpoch: true`, and explicitly describes synthetic epoch settlement. Setting `realProofs: true` there does not override the L1 verifier choice.

Keep three distinct results:

| Layer | What a passing check establishes | What it does not establish |
| --- | --- | --- |
| Application proof | Actual wallet/PXE executes the board's private logic, builds its client proof, and a real client-proof verifier accepts it. | That the state transition was included in a genuine accepted epoch proof. |
| Canonical Outbox verification | The actual `Outbox.consume` checks the message envelope, membership against its stored root, and replay bitmap. | That a stored root came from genuine proof acceptance if a test installed it using impersonation/storage writes or a fake verifier. |
| Genuine rollup proof acceptance | The deployed pinned Honk verifier accepts `submitEpochRootProof`; the real Rollup advances its proven checkpoint and inserts the corresponding Outbox root. | Ethereum economic finality when the L1 is Anvil, or current mainnet suitability. |

Installed `EpochProofLib.sol::submitEpochRootProof` validates the epoch/attestations, calls the configured `epochProofVerifier.verify`, advances the proven checkpoint, inserts a nonempty out-hash through the actual Outbox, and emits `L2ProofVerified`. These operations, their L1 receipts, and the actual deployed verifier identity are the required evidence chain. An event or `proven` label alone is insufficient if the environment permits shortcuts.

## Smallest maintainable topology to qualify

The proposed minimum is **one disposable L1 plus the necessary Aztec roles**, rather than a mandatory fleet size. A local programmatic harness can combine roles; installed `createProverNode` creates an in-process broker when none is supplied, and the prover configuration supports one local agent. One agent is the lowest useful proving-worker count, not a demonstrated resource or throughput guarantee.

1. **Disposable Anvil L1**, with functioning blob/KZG support and controlled mining. Use fresh test-only deployer, sequencer and prover-publisher identities, and local test ETH. Record actual chain ID, genesis, mining/finality behavior and all protocol addresses. Do not connect the local harness to existing user wallets or an existing production rollup.
2. **Direct protocol deployment** through installed `@aztec/ethereum/deploy-aztec-l1-contracts::deployAztecL1Contracts`, explicitly setting `realVerifier: true` and supplying matching genesis root, VK tree root, protocol-contract hash and timing/configuration. Its environment builder propagates `REAL_VERIFIER`; bundled `DeployRollupLib::_deployVerifier` selects `HonkVerifier` only when that value is true. Use this reviewed direct API rather than a helper that overwrites the option.
3. **Aztec node/world-state/archiver and ordinary sequencer**, through installed `createAztecNodeService`, following that deployment. Explicitly disable the automine sequencer and synthetic proving path. One local committee/validator configuration may be used if accepted by the real contracts; it is a local test configuration, not production decentralization evidence. Peer requirements, genesis funding and timing must be coherent with that configuration. Do not disable invalid-state checks to obtain a pass.
4. **Real prover node, broker and at least one agent**, matching 5.2 artifacts and native binaries. Configure `enableProverNode: true`, `realProofs: true`, publishing enabled, a fresh funded prover signer, access to full transaction/blob data, and a real broker/agent. Installed `buildServerCircuitProver` selects `BBNativeRollupProver` when true and `TestCircuitProver` otherwise. Set and inspect the actual node/agent configurations, not just an environment variable. Bound concurrent jobs for the first experiment, then measure; do not infer a RAM requirement from the concurrency setting.
5. **Fresh proving-enabled wallet/PXE**, registered board/account artifacts, and the minimal C01 board/portal application. The `proverEnabled` wallet setting is separate from server-side `realProofs` and from the deployed L1 verifier. Use real application proofs from the beginning of measured board setup; any deliberately supplied genesis allocations are recorded as genesis, not represented as proven transactions.

The installed CLI also provides `start --node --sequencer --prover-node --prover-broker` roles and a separate `start --prover-agent`. `start_node.ts` requires a registry and compatible genesis/protocol constants; `start_prover_agent.ts` requires a broker URL and real ACVM/BB configuration. These are entry points, not a complete tested launch command for this repository. C01 must implement an explicit, isolated config/teardown harness rather than assume `aztec start --local-network` plus a proving flag is enough.

## Mandatory environment controls

Before sending board transactions, read `Rollup.getEpochProofVerifier()` and compare its actual deployed runtime bytecode/code hash with the pinned deployment artifact, accounting only for documented linking/immutable fields. Confirm it is the expected Honk verifier and is not `MockVerifier`. Check Rollup, Inbox, Outbox and verifier code/address relationships, rollup version, VK/protocol constants and genesis agreement. A nonzero verifier address is not a sufficient check. Preserve sanitized configuration and bytecode identities in evidence.

For the measured flow, forbid `markAsProven`, direct Outbox root insertion, impersonating Rollup, arbitrary protocol storage writes, replacement verifier bytecode, and synthetic automine epoch settlement. Controlled L1 mining/time movement may end an epoch or advance the local finality model, but cannot create a proof/root or advance the proven tip directly. Record every test-time adjustment, ensure it does not outrun the real proof-submission deadline, and keep timing controls distinct from target-network performance qualification.

The installed archiver's `l1_synchronizer.ts::updateFinalizedCheckpoint` reads the Rollup's proven checkpoint **at the finalized L1 block**. Accordingly, record the proof-publication transaction/block and wait until the L1 finalized view includes it, then require the covering L2 checkpoint/transaction to be finalized. For Anvil, this qualifies the real verifier under a documented local finality model; genuine Ethereum consensus/economic finality still requires the later live testnet environment. Do not manually overwrite the finalized/proven tips to imitate that result.

## Minimal Ready → deposit → claim → no-post exit

The frozen interface already removes the deployment-address cycle: deploy the board; compute `configHash` without a portal address; deploy the disabled portal using that board/configuration; bind the actual portal on L2 and emit Ready. The Ready transcript binds the actual portal. No extra administrative activation acknowledgement is needed.

1. Prove and include deployment/binding/Ready. Wait for a genuine accepted covering epoch proof and its finalized L1 observation. Obtain `getL2ToL1MembershipWitness(txHash, messageHash, messageIndexInTx?)`; this API selects a covering partial-proof root, so persist epoch, checkpoint count, leaf index, path and the root identity. Call the portal's real `activate` path; deposit-before-activation and altered Ready envelope/path must fail.
2. Deposit local test collateral through the actual portal/Inbox. Persist the receipt/nonce and actual L1-to-L2 message identity. Use `waitForL1ToL2MessageReady` and the real membership witness; never substitute a caller-chosen portal or manually populate the message tree.
3. Prove the claim and verify the exact single permitted private right with the intended deposit identity. A retry/repeated claim must not create a second right. Wrong portal, actor, chain/version, amount, secret and unwired configuration need discriminating negative controls. Record whether each rejection occurs in proving, node admission or an included reverted transaction; those are different observations.
4. With **no posts**, prove the burn/exit and obtain a genuine covering accepted/finalized epoch proof. Consume the authentic exit through the actual Outbox and portal. Check full collateral release, cleared active liability, burned L2 right, and replay rejection. This avoids requiring C02–C05 posting/history/moderation semantics while preserving real bridge authentication.

Ready must settle before the portal accepts the first deposit, so the whole flow cannot be collapsed into one epoch. At least the Ready and later exit require separate covering accepted proofs; additional deployment/message-availability/claim epochs depend on actual sequencing. No fixed completion-time estimate is justified yet.

## Current official hardware/support guidance

The current, undated [prover overview](https://docs.aztec.network/operate/operators/prover/overview), retrieved September 12, states the following operator requirements:

| Component | Published CPU / RAM / storage |
| --- | --- |
| Prover node | 16 cores / 32 vCPU; 16 GB; 1 TB NVMe |
| Broker | 8 cores / 16 vCPU; 16 GB; 10 GB SSD |
| Each prover agent | 32 cores / 64 vCPU; 128 GB; 10 GB SSD |

These are network-operator guidance, including a Skylake-or-newer CPU floor, not a measured minimum for this tiny local workload. They do not establish that the user's 24 GiB host cannot run one carefully bounded proof experiment. This lane measured no application/rollup proof memory or duration and makes no such host-capacity finding.

The current [operator prerequisites](https://docs.aztec.network/operate/operators/prerequisites) include Linux and macOS ARM/Intel, describe the Docker/Compose operating route, and require execution/consensus L1 endpoints for live operation. The [local-network guide](https://docs.aztec.network/developers/getting_started_on_local_network) requires Node 24 and describes optional transaction proving; it does not establish genuine local epoch-proof settlement. These living pages provide retrieval dates rather than publication dates.

Actual installed server-side CRS preloading (`aztec/src/cli/util.ts`) requests BN254 `2 ** 25` points and Grumpkin `2 ** 18`, substantially different from the board's client-side CRS. Client SRS initialization success and its memory observations cannot qualify the server prover or cover its downloads. Native ACVM/BB availability, platform compatibility, server CRS/artifacts, disk space, blob data and proof deadlines must be checked before the bounded first run. No download or host-capacity test occurred here.

The cached upstream full-prover test comments allow 45 minutes for real-proof suites and mention 10+ minutes per epoch. That is upstream test budgeting, not a promised C01 duration or a hardware estimate. The current [prover verification guide](https://docs.aztec.network/operate/operators/prover/verification) documents broker/job/agent health checks; completing jobs is useful diagnostic evidence, but C01 additionally needs successful L1 verifier acceptance and message consumption.

## Prerequisites, alternatives and remaining uncertainty

C01 depends on P04 and can own this minimal harness within its existing scope. There is no required dependency on final W01 privacy-preserving fee selection: disposable genesis/test fee funding can support this narrow functional test if explicitly scoped, without claiming fee privacy. There is no dependency on the full C06 recovery suite or D01 rehearsal merely to implement an authentic no-post exit. Requiring either complete downstream package before building this harness would introduce an artificial cycle. Their broader acceptance criteria remain unwaived.

If measured local server proving or the real verifier deployment cannot run, record the exact failure, peak/resource observations and the smallest missing prerequisite. An existing suitably provisioned authorized host could supply the same isolated roles; this is a resource contingency, not a recommendation to purchase service. Alternatively, live V5 testnet supplies sequencer/prover infrastructure but needs fresh test identities, free L1/L2 test funds, execution/consensus observations and current configuration verification, and is a separately scoped test run. The [testnet guide](https://docs.aztec.network/developers/getting_started_on_testnet) currently says 5.2.0 while the [network table](https://docs.aztec.network/networks) still lists 5.1.0; explicit 5.2 interoperability guidance does not replace checking the actual target. No public transaction or target decision was made. X03 mainnet clearance remains independent.

## Cached fixture caveat and source binding

The local source cache under `/Users/zac/nargo/github.com/AztecProtocol/aztec-packages/v5.2.0/` contains `yarn-project/end-to-end/src/fixtures/setup.ts` with a trailing `realVerifier: false` **after** `opts.l1ContractsArgs`; its `FullProverTest` caller passes `realVerifier: true` but also invokes `markAsProven` for setup. These are reasons to inspect actual deployed state rather than reuse a test's name/comment as assurance. They are not characterized as upstream vulnerabilities. They may be intentional test-helper shortcuts, and are not part of this repository's installed runtime API.

Fresh retrieval of [setup.ts](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/yarn-project/end-to-end/src/fixtures/setup.ts) and [e2e_prover_test.ts](https://github.com/AztecProtocol/aztec-packages/blob/v5.2.0/yarn-project/end-to-end/src/fixtures/e2e_prover_test.ts) failed through the web tool (cache miss) and bounded direct HTTPS (DNS unavailable). Therefore these observations are explicitly about the cached bytes below, not freshly reconfirmed publisher contents. The installed `createLocalNetwork` hardcoded fake-verifier behavior and direct deployment API were independently read from installed 5.2 packages.

| Inspected source | SHA-256 |
| --- | --- |
| `node_modules/@aztec/aztec/src/local-network/local-network.ts` | `25e80565d781f6b69ee161474f42d28f1395b33f78f8771b89a8270fd952219a` |
| `node_modules/@aztec/ethereum/src/deploy_aztec_l1_contracts.ts` | `55f732ec6468b55e59fb7140053a909b1762780fe6986d76c293a140ce60293a` |
| `node_modules/@aztec/prover-client/src/prover-client/prover-client.ts` | `a069f6c3c916ee74be3d08bc56d3c887d5aa5965b07fdaeb2c610a872f7528be` |
| `node_modules/@aztec/prover-node/src/factory.ts` | `27447a44dd40555abed64830ca090e300443fa40f6557b3dd878b0b0541c8028` |
| `node_modules/@aztec/archiver/src/modules/l1_synchronizer.ts` | `0b210e54505fc97bfad6057e9ed1471bbc5295e1cb02db46120c1b745f4d2027` |
| `node_modules/@aztec/aztec/src/cli/util.ts` | `9b2def36cd1db7f499cb10622e0903f5a9f2469a26a54fc08df49f38df359f6e` |
| Bundled L1 `src/core/libraries/rollup/EpochProofLib.sol` | `9045a8a96b1465a3db2d3389f49492e964e2cb732a4932e8305378fffb12abe7` |
| Bundled L1 `src/core/messagebridge/Outbox.sol` | `de268cae33268c6ce8538d687b3612b090d37052a270846e233717520f9df212` |
| Bundled L1 `script/deploy/DeployRollupLib.sol` | `09b356e2f823ab74aa8430e1b11a17918a7d4082f3e5cc1354cb802b13ef8616` |
| Cached `yarn-project/end-to-end/src/fixtures/setup.ts` | `003ac75ec6bb34a064dd61eb391998ba09f85cd91df0969a0f66d00f6378367a` |
| Cached `yarn-project/end-to-end/src/fixtures/e2e_prover_test.ts` | `92d0bff1d5d981e29fcf7632feeb8a57990121dacbf8fa30b22888cf594e01c8` |
| Cached `yarn-project/end-to-end/src/single-node/prover/server/full.test.ts` | `46bd38392f336912d7c74820a0f817e90fa5c07223c3c311cde8e356ab278666` |

Bundled L1 paths are relative to `billboard/portal/node_modules/@aztec/l1-artifacts/l1-contracts/`. C01 implementation must verify its final executable/configuration and deployed-bytecode identities rather than rely on this preparatory inventory alone.
