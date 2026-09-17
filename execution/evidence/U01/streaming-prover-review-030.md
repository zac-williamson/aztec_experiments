# Streaming browser prover review 030

Read-only review of the pinned installed SDK and current proposed integration. No cryptographic proof, browser or heavy job was run. This is source-level correspondence, not a memory/performance or production qualification.

## Normal-path correspondence

- BrowserPrivateKernelProver subclasses the existing BBBundlePrivateKernelProver, whose constructor uses BundleArtifactProvider. The same simulator is supplied both to PXE and prover. PXE's documented-in-code isPrivateKernelProver branch accepts this instance. Non-browser createPXE selection is unchanged.
- Both paths decompress each execution step's bytecode with pako ungzip and witness with ungzip(serializeWitness(step.witness)). Helper retains original compressed executionSteps and consumes one expanded pair at a time; it does not claim to shrink BB's internal proving state.
- chonkStart receives the exact step count. Each chonkLoad receives the original per-step verification key, with the same empty-array fallback and circuit naming as AztecClientBackend.prove. Witnesses go to matching chonkAccumulate calls in original order.
- Final chonkComputeVk uses the final hiding circuit's exact decompressed bytecode, the same name fallback and useZkFlavor:true. No alternate VK or proof flavour is introduced.
- flattenChonkProofFields is the upstream export. chonkVerify receives the original structured proof and computed final VK, just as verifyNative. Invalid verification fails before compression/return.
- chonkCompressProof receives that same structured proof. The subclass constructs ChonkProofWithPublicInputs.fromBufferArray and attaches Buffer.from(compressedProof), matching upstream createChonkProof. Removing the unused msgpack proof copy and unused returned VK does not change the downstream proof object.
- Helper is stricter about empty execution steps and missing/empty compressed output. These cases fail closed; they are not valid reduced-proof paths.

## Ordering, errors and concurrency

Upstream queues start/load/accumulate calls without awaiting them, then awaits prove. The helper awaits each generated async API call; these promises reject on ErrorResponse or wrong response variant. This changes input lifetime and catches earlier failures without skipping any stage. Its WeakSet prevents overlapping helper Chonk jobs for the same singleton, but does not lock unrelated SDK users of that singleton. Application operation serialization remains necessary.

**Open recovery concern at reviewed snapshot:** finally removes the active marker after any failure. The next call can therefore reuse a partially failed backend. Installed JS proves neither that chonkStart fully resets every failed WASM state nor that an allocation/trap failure is recoverable. The unit test's repeated failed start proves JavaScript lock release only. Recommended fail-closed remedy is to quarantine this singleton after a proving failure and require page reload/new backend, unless real supported reset semantics are established. Reported promptly to root and helper owner. This does not invalidate the normal clean-backend proof sequence, but retry safety must not be claimed from those unit tests.

## Evidence and privacy limits

The focused helper tests inspect call order, original VK identity, final VK flavour, local rejection, compression, bounded input expansion and redaction using fake BB responses. They cannot establish cryptographic equivalence, genuine WASM error recovery or fitting the aggregate 2 GiB cap. The next actual browser run must still include canonical node acceptance and independent exact application effects/fee checks. Generic helper failure discards raw backend errors; no witness, private input, secret or unrestricted stack is added to logs.

## Reviewed hashes

- `shared/private-pxe.mjs`: `117239e0a804bf296a17fc872f59c1318f7cfb54bfa0f02396ba30022d77c410`
- `shared/browser-chonk-stream.mjs`: `018f47bfcdac5af9bc0a393e2009b6913de96c4789d9536d6f700f38644614d5`
- `scripts/test-browser-chonk-stream.mjs`: `7780ea3e3516b5d419af88380d8df0b4e3b7faa02af9cdd1ff6b6e7d36d95465`
- `node_modules/@aztec/bb-prover/dest/prover/client/bb_private_kernel_prover.js`: `35f9512ba9bc336ceb0d0720bf6c2ddce953fecb8e9da59db1293cb52554a129`
- `node_modules/@aztec/bb-prover/dest/prover/client/bundle.js`: `dd8846d141f06159245ad4884d5a7183cc9081d503606d08aad711949fe3f619`
- `node_modules/@aztec/bb.js/dest/browser/barretenberg/backend.js`: `738038493c388a6da01f98cd7366156c073cb4db93d9629e122c17094cf3e87b`
- `node_modules/@aztec/bb.js/dest/browser/cbind/generated/async.js`: `f54ee017745f4c48b018770956f1530f69f12eb1e59119cc380b1976f3d33abb`
- `node_modules/@aztec/pxe/dest/entrypoints/client/bundle/utils.js`: `83b19a86314bfb580586b9f44fd044d5ee614e8fd6d58e997c37aa4711b82d72`

## Follow-up: failed-backend concern resolved for this helper

Re-reviewed after quarantine was added, before interpreting genuine run 031. A separate failedBackends WeakSet now records any failure after starting the job; entry checks reject that same backend before another chonkStart. The finally block clears only active membership, so it cannot erase quarantine. Overlap rejection occurs before the try/catch and therefore does not poison the legitimate active job. Invalid empty input likewise does not poison an unused backend. A fresh singleton is separately eligible. Updated focused tests explicitly assert a failed singleton receives only one start across two attempts, while an independent fresh instance completes.

This resolves the identified unsafe helper retry path without asserting WASM recovery. Quarantine is helper-local, not a global lock on every SDK caller; existing application serialization remains necessary. Source review only: root reports the focused tests passed; this reviewer did not rerun them during the frozen real-proof run. No genuine proof or memory-cap outcome is inferred.

Re-reviewed hashes:

- `shared/browser-chonk-stream.mjs`: `e3995c69787ea0a2fc15cb1a75f583e21ae01cfb055264351f63663a77a86c50`
- `scripts/test-browser-chonk-stream.mjs`: `e17204c1a5700d9280f99b6fc8572a30e84918a76fad9bf30c894bb9e7980596`
