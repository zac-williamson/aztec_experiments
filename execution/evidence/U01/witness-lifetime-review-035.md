# Witness lifetime review 035

Read-only inspection after parent-reported run 034 stopped during its third Chonk accumulation at a sampled 2,131,808 KiB. No source edits or heavy jobs.

**Do not consume or replace execution-step entries unconditionally in the current prover hook.** Normal transaction proving has a narrower downstream need, but the public hook carries no ownership-transfer/discard permission or profile-mode parameter.

- `@aztec/pxe/src/private_kernel/private_kernel_execution_prover.ts:116` owns the local executionSteps array. At lines 294–309 it passes that same array to `proofCreator.createChonkProof`, validates proof public inputs, then returns executionSteps as part of its result.
- Normal `PXE.proveTx` (`pxe.ts:1040–1071`) subsequently uses step names/timings for stats rather than their bytecodes/witnesses. Replacing entries with metadata and empty buffers would preserve this particular use if every metadata field is retained.
- Counterexample: `PXE.profileTx` (`pxe.ts:1141–1178`) uses the same proof creator and returns the steps in `TxProfileResult`. `profileMode` can be `execution-steps` or `full`; actual proof generation depends on the caller's skipProofGeneration option. Those consumers are entitled to real trace inputs, not silently emptied ones. `stdlib/src/tx/profiling.ts:106–117` exposes them in the public serialized result.
- `stdlib/src/kernel/private_kernel_prover_output.ts:12–39,60–70` specifies each step's bytecode, witness, VK and timings, and `serializePrivateExecutionSteps` explicitly serializes the bytecode/witness/VK. Retaining only metadata breaks that contract.
- There is an existing deliberate clearing operation at kernel execution prover lines 279–285, but it is controlled by explicit `profileMode === 'gates'`; it is not a general license for custom provers to consume all input traces.
- `stdlib/src/interfaces/private_kernel_prover.ts:194–199` defines only `createChonkProof(executionSteps)`. Neither the signature nor its documentation grants ownership transfer or provides profile mode. A global browser-only subclass still services all relevant PXE methods.

## What would actually become collectible

Application steps are inserted by `consumeNextApp` at lines 365–376 with `bytecode: next.acir` and `witness: next.partialWitness`. Those references alias the original private execution tree. `PXE.proveTx` retains that tree and returns it in `TxProvingResult` (`stdlib/src/tx/proven_tx.ts:18–24`); the tree is also used for transaction logs, public calldata, offchain effects and tagging persistence. Replacing the step entry would not free these application maps while that tree remains live. Clearing a shared Map would instead mutate the original execution result and its serialized API response.

Kernel steps hold outputWitness references (e.g. inner reset at lines 144–149, hiding output at 260–268). Some older kernel maps might become collectible when their step references are removed, but current/last kernel outputs remain in local variables and private inputs can reference earlier data. This source review does not establish exact retained sizes or GC timing. No guaranteed reduction follows from array-entry replacement.

## Safe scope for any follow-up

A selective normal-prove-only consumption mode would need an explicit, reviewed ownership boundary from the caller, excluding profiling/debug/trace serialization and preserving original application Maps. That requires a supported upstream option or a separately reviewed wrapper/lifecycle contract, not a silent change inside the existing generic hook. Preserve the current non-mutating streaming helper until such a boundary is established. Continue to retain the hiding circuit bytecode through its actual VK computation and do not weaken local proof verification, public-input matching or failed-backend quarantine.
