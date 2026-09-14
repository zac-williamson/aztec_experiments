# Ready settlement helper: source review, execution pending

Owned source: `scripts/c01-settle-ready.mjs`, SHA256 `ad672ca50616eec52b305e9ba494b0830ac77af377cde633c4726a97042fb67c`.

Export `settleC01Ready({node,config,dateProvider,ready,readyInclusion,l1Client,directory,rollupAddress})`. Inputs are the existing fresh local run's actual objects; the signing client is never serialized. Returns sanitized observations with `passed`; failure carries `settlementObservation`. Progress is atomically replaced at `directory/settlement-progress.json` on substantive stage/job changes. No proof, witness arrays, inputs, or keys are written there.

The helper requires real proofs, publishing enabled, one prover agent, one pending job, chain 31337, a loopback configured RPC, and the explicitly local 64-epoch proof window. It reads the successful Ready receipt and canonical checkpoint headers, enumerates every unproven predecessor through Ready, and groups by actual header slot / on-chain epoch duration. It starts the constructed prover once, waits for its canonical checkpoint store, and requests successive genuine partial proofs using `startProof`, reusing an already active automatic session for that epoch. A job status alone cannot pass: actual L1 proven checkpoint advancement is required before moving on.

The next checks require successful, canonical `L2ProofVerified` transaction receipts, including coverage through Ready; an actual RPC `finalized` tag covering that proof receipt; historical Rollup proven state at that finalized L1 block; and the node's finalized L2 tip covering Ready. It then requests the actual node membership witness for the emitted Ready leaf and submits the portal's real `activate(epoch,checkpointCount,leafIndex,path)` transaction. Only its successful receipt and `depositsEnabled == true` complete the helper. Actual local Anvil finalization is explicitly separate from Ethereum economic finality.

Pinned source API checks:

- `@aztec/aztec-node/src/aztec-node/server.ts`: `getChainTips` (not `getL2Tips`), `getCheckpoints`, `getBlock`, and `getL2ToL1MembershipWitness`.
- `@aztec/stdlib/src/interfaces/checkpoint_response.ts`: checkpoint number, canonical header slot and block bounds. `epoch-helpers/index.ts:getEpochAtSlot` confirms integer slot / epoch duration.
- `@aztec/prover-node/src/prover-node.ts`: `start`, `getCheckpointStore`, `getJobs`, `startProof`; `session-manager.ts:startProof` creates a genuine partial epoch session and deduplicates a matching session.
- `@aztec/ethereum/src/contracts/rollup.ts`: actual current/historical proven checkpoint reads and epoch/proof-window getters. `RollupAbi` supplies the exact indexed proof event.
- `@aztec/stdlib/src/messaging/l2_to_l1_membership.ts`: witness epoch, checkpoint count, leaf index, sibling path. `billboard/portal/src/BillboardPortal.sol:activate` performs ordinary Outbox consumption.

No execution, proof generation, network access, or downloads performed in this lane. Parent must syntax-check and qualify the actual integrated run. The helper has a 600-second watchdog and bounded polling; the parent retains ownership of node/prover stop and hard process/resource limits, including cancellation of an SDK call already in progress when the deadline fires. It does not claim that Promise rejection alone kills native proof workers. Ordinary disposable L1 mining continues during polling; no root, proof-state, timestamp-jump, or finalized-tag overrides are used. Unexpected finality support, API failures, proof capacity failures, and failed/timed-out jobs remain failures with stage/job observations. Parent's 900-second/8-GiB supervision and verified setup provisioning are prerequisites, not implemented or independently requalified by this module.
