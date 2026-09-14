# Genuine local network qualification

The fresh local chain uses chain31337 and newly generated disposable identities.
No existing wallet, external RPC, paid service or production transaction is used.
The parent limits total owned process-group RSS to8GiB (sampled, not allocation
limit), total runtime to300seconds, and nonlocal IP networking through Seatbelt.
Every retained run records cleanup and source hashes. Anvil and compiler/prover
children share the supervised process group. Temporary chain/build/setup data
are removed after termination.

The first sandbox profile failed before starting a worker: macOS requires
`localhost` instead of a numeric host in this sandbox filter. The next deployment
failed because isolated HOME caused Forge to request a Solidity compiler download.
The harness now selects the existing0.8.30 compiler explicitly and checks its
SHA256. Neither failure is an application vulnerability.

Direct deployment with realVerifier:true passed in real-network-d662b45d.
Source review found that default local Foundry settings still select mock BlobLib.
That result is therefore limited to genuine verifier identity and bridge wiring.

The production launcher forces a clean build with the production profile in the
SDK's own temporary source copy, then broadcasts that build locally. The SDK
otherwise overrides FOUNDRY_PROFILE for31337. No SDK/protocol source is patched.
A production rebuild changes Solidity metadata, so the harness requires identical
verifier executable bytes against the pinned artifact, then exact complete deployed
runtime equality against the source-checked rebuild including its new metadata.
An additional checksum compares the original pinned artifact after execution.
Failed over-strict metadata comparisons are preserved as diagnostic evidence.

Production BlobLib is inlined into RollupOperationsExtLib. The checker follows
actual Rollup link slots to the deployed library and verifies its complete runtime
against source-bound production artifacts, with only the validated Solidity
library self-address prefix patched. Rollup's three constructor immutable slots
are explicitly recorded/excluded from this code-selection check; their semantics
and other linked libraries remain separate qualification work.

real-network-43c93915 passed production deployment and code selection.
real-network-84839e10 additionally passed actual proof-verifying node, genuine
prover subsystem and ordinary sequencer construction, plus normal shutdown,
in17.936seconds with peak sampled group RSS904416KiB. The sequencer was not
started and no transaction was submitted. An intermediate startup check failed
because the admin configuration API omits static startup flags; the corrected
check inspects actual constructed service configuration and subsystem identities.

Next: prove the actual board deployment with a fresh genesis-funded account,
require real node transaction validation, then ordinary sequencing and genuine
epoch proof acceptance for Ready/deposit/claim/no-post exit. These milestones do
not yet establish the complete bridge journey or production readiness.

real-network-b6a32850 additionally passed the actual board deployment's genuine
native client proof and normal node admission validation. The proof took19.651s;
the entire run40.939s, peak sampled RSS1469760KiB. The board initializer is public:
this proof authenticates its private account/transaction path, not execution of
the public constructor. No send/inclusion was claimed by that report.

The first ordinary inclusion attempt (6172e4a7) timed out after169.341s with
BlockNotFoundError while assembling a checkpoint. The sequencer had built/stored
blocks but could not retrieve block1 at checkpoint assembly. Source review points
to accelerated local timing (12 protocolseconds per wallsecond) crossing archiver
pruning deadlines; earlier prune logs were not retained, so the cause remains a
hypothesis. New runs use L1slot1s/L2slot12s and2s block duration, all explicit local
configuration, with normal pruning/signature rules. These timings do not measure
mainnet throughput. Failure evidence and complete cleanup are retained.

The inclusion stage constructs an idle broker/prover agent but does not start the
ProverNode epoch scheduler. It cannot settle an epoch or insert a proven Outbox
root. This is an intentional intermediate observation, not proof acceptance.

The coherent-clock retry(e1f16c78) had no missing-block error; it spent nearly the
whole inclusion window waiting for validator activation. An explicit preparation
step now advances ordinary local block timestamps and observes actual committee
membership before proving. Anvil's configured timestamp interval meant an initial
evm_increaseTime attempt did not produce the required observed epochs; explicit
next-block timestamps did. No validator, attestation, root or storage override was
used. The passing1bb4b84e run observed genuine committee membership at epoch3 and
successful checkpointed board deployment, with nonzero transaction fee.

497f7da7 additionally passed the actual update_portal client proof, normal node
verification and successful checkpoint inclusion, and matched the exact emitted
Ready leaf in canonical transaction effects. The portal remains disabled awaiting
finalized proof-backed activation. Entire run109.245s, sampled peak1643888KiB.

The outer proof preparation pins129complete4MiB compressed chunks to the exact
native executable. This516MiB prefix covers a2^24 domain plus extra points; it is
not a measured RAM/runtime requirement. The genuine epoch experiment has a900s
parent deadline and8GiB sampled group RSS limit. Generated local CRS expansions
must preserve verified original prefixes, while the full trusted compressed
input stays unchanged. No unverified global cache or proof download is used.

Full epoch attempt cbdddf35 failed before proof publication: PUBLIC_VM jobs for
epochs3 and4 report "AVM is not supported in this build. Use the bb-avm binary
with full AVM support." Lightweight bb can qualify client/padding/parity proofs
but cannot complete this board's public-execution proof. Jobs disappeared from
getJobs after their subtrees failed; native sibling work continued temporarily,
so future supervision needs explicit subtree/fatal capability diagnostics. Root
terminated the stalled parent after506927ms once native work was idle. Peak
5057344KiB; process group absent and temporary directory removed. No proof event
or portal activation. RPC errors after SIGTERM are shutdown consequences.
Official release metadata lists one full AVM asset, amd64 Linux, SHA256
e573e15e0d808a751df001893e1fa87d4cbde0dafd3bd74e4f6c9ee8af1eb05d.
