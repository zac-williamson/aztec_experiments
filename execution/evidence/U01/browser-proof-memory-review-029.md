# Browser proof memory review 029

Read-only inspection of pinned Aztec 5.2.0 TypeScript sources after parent-reported run 028 sampled 2,379,664 KiB at 221,875 ms and stopped. Prefix-only setup previously passed at 1,112,752 KiB. No builds, browser sessions, proving, dependency patches or source changes in this review. Timing alone does not locate the failed allocation within application simulation, kernel execution or Chonk proving.

## No supported low-memory mode found

`@aztec/bb.js/src/bb_backends/index.ts` exposes threads, memory initial/maximum, SRS size/path, WASM/backend selection and legacyMsm. It exposes no lowMemory setting. Searching pinned BB, BB prover and PXE sources found no alternate low-memory switch.

`barretenberg_wasm_main/index.ts:38–56,94–104` starts linear memory at 37 × 64 KiB (about 2.3 MiB), with a maximum of 65,536 pages (4 GiB), or 16,384 pages on iOS. The maximum is a ceiling, not evidence that four GiB is resident from startup. Lowering it can convert memory growth into an allocation failure; it is not an implementation that performs the same proof with less memory. The already-used shared memory is one memory shared with auxiliary BB workers; disabling sharing is not an established remedy. One requested thread is supported and could reduce thread-specific overhead, but its effect and slower proof completion require measurement under the unchanged deadline.

`legacyMsm:false` selects another supported MSM implementation, but installed option documentation does not promise lower memory. Do not select it on an invented memory-saving claim.

## Eager residency and proof working set are distinct

The current wrapper imports `@aztec/pxe/client/bundle`. Its `BBBundlePrivateKernelProver` constructs a `BundleArtifactProvider` which statically imports the full set of real/simulated kernel variants. `artifacts/vks/client.ts` eagerly calls `abiToVKData` for the client VK table. This creates baseline object/string/VK residency before a particular proof chooses its actual steps.

The supported alternate `@aztec/pxe/client/lazy` entry point selects `BBLazyPrivateKernelProver`, `LazyProtocolContractsProvider` and lazy standard-preloaded contracts. Its `LazyArtifactProvider` obtains circuit JSON via dynamic imports and constructs VK data on demand. That is a concrete supported candidate for reducing baseline artifact residency. It must be assessed against the complete bundled dependency graph: other eager imports can keep the same artifacts live, and bundling dynamic imports into one IIFE can retain all source payload even when evaluation is deferred. Switching this entry point alone is not evidence of a smaller download or working set. Actual generated import/evaluation behavior and built output provenance must be checked; release artifact identity must remain unchanged.

Both lazy and bundle prover subclasses use the **same** `BBPrivateKernelProver.createChonkProof` (`bb_private_kernel_prover.ts:379–398`). It eagerly ungzips every execution-step bytecode, serializes and ungzips every witness, and passes arrays to `AztecClientBackend`, while the original execution steps remain available. This can overlap compressed artifacts, witness maps, serialization buffers and decompressed inputs. Lazy artifact loading does not alter this proof-stage algorithm.

`@aztec/bb.js/src/barretenberg/backend.ts:319–359` calls `chonkStart`, then queues each `chonkLoad` and `chonkAccumulate` without awaiting each return, finally awaits `chonkProve`. This API path can have multiple queued payloads in flight as well as WASM proof state. Its proof path then computes the hiding-kernel VK, verifies the actual proof and optionally compresses it. Preserving those verification/compression steps is necessary.

Serializing/decompressing one step at a time and awaiting each load/accumulate is a plausible upstream implementation improvement, **not an existing low-memory option**. Adopting it would require a separately reviewed prover implementation/dependency change and real equivalence/verification tests. Do not label it a harmless configuration toggle or bypass existing custom-prover restrictions to hide that scope.

## Prefetch is not evidence of whole-artifact conversion

PXE `private_kernel_execution_prover.ts:380–394` prefetches updated-class-ID hints for unique contract addresses present in the actual execution tree. This is bounded by the transaction's participating contracts, not a prefetch of every protocol circuit. Disabling it is not presently justified as the cause of the large memory increase.

The synchronous hashing/signing heap and async proving heap remain separate. Full Sync SRS duplication has already been removed. Destroying the Sync singleton during a live wallet operation is not a documented memory-profile option; it would require proving no remaining simulation/hash operation uses it and guarding concurrent use. Do not conflate that lifecycle change with the existing safe post-run cleanup.

## Recommended next bounded experiment

Use the supported lazy PXE entry point only if inspection of the built graph confirms it actually removes/defer-evaluates the eager artifact/VK providers; preserve the current two-thread/verified-prefix/skip-auto-SRS policy and normal proof/verification path. Record the difference in initial and proof-stage residency without claiming success in advance.

Before any larger implementation change, add bounded **public stage markers only** around simulation/kernel completion and actual Chonk entry, without debugger attachment, witness payloads or raw circuit data. Associate resource samples with those stages. If the excess arises during Chonk accumulation/proving rather than baseline artifact loading, lazy providers may be insufficient; a reviewed sequential-payload upstream improvement may be the relevant work instead. Keep the same 2-GiB sampled bound and 540-second deadline. No source evidence here establishes that the current genuine proof can complete below that bound.
