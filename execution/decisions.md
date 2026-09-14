# Decisions and defaults

## 2026-09-14 — W01 mechanism evidence and contract dependency

Local restricted sponsorship is feasible under pinned5.2: actual sponsor debit,
unfunded authors, exact coupon replay rejection, paid public-revert consumption,
and admission/queued-builder expiry passed. This is mock-proof mechanism evidence,
not W01 production acceptance. Root and the delegated source reviewer agree that
production W01 must follow C03: C01 changes deposit identity/layout, C02 binds
owner/ancestry, and C03 establishes stable post IDs and posting arguments.
The current caller-dependent, global-counter-dependent post ABI is not the
integration target. W01 returns to planned with C03 as an explicit prerequisite;
all its original criteria remain. C01 is active. C04–C06 changes still require
fee/composition/gas requalification, and T05 retains final-source verification.
This changes engineering order, not escrow, moderation, product admission policy
or any release gate. No new user authorization is needed for this dependency.

Recorded 2026-09-11 during setup. These are explicit engineering defaults derived
from the requested productionization, not claims that the user approved each
commercial or policy decision. P01 validates them and records material changes.

| ID | Engineering default | Decision boundary |
|---|---|---|
| D01 | Preserve ETH escrow and centrally administered moderation. | A new admission mechanism or trust model needs a concrete proposal and user decision. |
| D02 | Preserve meaningful flag penalties across withdrawal/redeposit; keep a usable exit. | P01 defines exact economics; if implementation requires a material custody/trust change, escalate that choice before dependent changes. |
| D03 | Shared sponsored or supported private fees; no reusable public user fee-payer identity. | W01 compares supported mechanisms locally. Production sponsor budget and owner must be supplied before operating it. |
| D04 | Describe anonymity against chain observers with explicit limits for content, timing, RPC and host observations. Minimize metadata and default telemetry. | Do not promise network anonymity or hide a new identity-bearing relay behind a privacy claim. |
| D05 | Keep public immutable content and existing onchain flag semantics initially. Provide clear policy and human review/support workflow; UI hiding is reversible. | Reversing an onchain penalty/flag or introducing an appeal authority is a product and protocol change requiring a decision. |
| D06 | Support current stable desktop Chrome, Firefox and Safari at the time of release testing. Public feed works without loading a private wallet. | Measure proving support first. Unsupported posting environments must be detected and explained; removing a promised browser requires a decision. Mobile read access is in scope; mobile proving is measured and explicitly disclosed, not silently promised. |
| D07 | Local development and test-only deployments use fresh disposable identities. | No existing user wallet, real funds, purchases, reviewer outreach or live production deployment without explicit authority. |
| D08 | Deliver a deployable release package and runbooks, then obtain authorization for actual production deployment. | “Production ready” cannot mean “already deployed,” and cannot be declared while required release evidence is missing. |
| D09 | Requested target remains Aztec V5 mainnet; verify current official guidance and exact version compatibility. | If the target is unsuitable, continue compatible local work and present the migration delta; do not silently substitute V6 or waive the network gate. |
| D10 | No unilateral administrator sweep or timeout refund that leaves valid L2 claims. | C06 designs recovery only where it preserves liabilities and invalidates/reconciles claims. Irrecoverable lost-key cases are documented honestly. |
| D11 | Independent Aztec/Noir and Solidity review, real-proof end-to-end validation, and 14 consecutive days of representative soak are mandatory. | A second AI pass or mocked test does not substitute. No automatic waiver. |

## Material inputs to collect without blocking independent engineering

- Named production owner, moderation operator and incident contact.
- Sponsorship spending limit and funding/replenishment authority.
- Final moderation policy and response/appeal process.
- Independent reviewer access/engagement (prepare the package before requesting it).
- Production infrastructure accounts and budget; replace/restrict previously exposed credentials.
- Target-network decision if V5 cannot meet the network release requirement.

Each new entry records: date, task ID, choice, alternatives, evidence, impact on
requirements and acceptance tests, and whether user input is required or received.
Do not reinterpret elapsed time or a missing reply as approval.

## 2026-09-11 — P02 discovery: baseline version versus production compatibility

The reproducible foundation preserves upstream 5.0.0 to establish trustworthy
baseline builds and tests. Current official guidance requires 5.1.0 changes for
contract developers and describes 5.2.0 as compatible maintenance. P04 now owns
the explicit supported-V5 upgrade and reruns before interface freeze. This remains
within the requested V5 target; a V6 retarget would require a separate assessment
and user decision. The live incident notice leaves X03 blocked for release while
internal engineering continues. Sources and exact unknowns are recorded in
`evidence/P02/current-network-inputs.md`.

## Fresh deployment scope (explicit user clarification)

The user confirmed there are no deployed message-board versions and backward
compatibility is not important. P04 and later packages target a fresh deployment:
no legacy board ABI support, old database migration or compatibility aliases are
required. Historical bad fixtures remain regression evidence, not supported runtime
versions. Current Aztec V5 protocol compatibility and backup/recovery for newly
created wallets remain requirements. Do not delete unrelated local data.

## Docker recovery authorization

The user replied “yes keep going” to the explicit request to restart Docker
Desktop, with notice that it interrupts all running containers. This authorizes
that restart and continued engineering. It does not authorize deleting unrelated
containers, data or images. Verification will run serially after recovery.

## Fresh-deployment recovery scope clarification

The user stated there are no deployed board versions and backward compatibility is unnecessary. C06 now explicitly covers recovery of the new deployment, with any supported deposit pause preserving claims/exits. It does not require a legacy or live-right migration facility. The P04 interface prohibition on refunds that leave active L2 rights remains mandatory; lost-secret and unavailable-protocol limitations remain explicit. This removes stale plan wording, not a collateral safety requirement.

## C01 coherent fresh-schema staging

Read-only preparation found that changing claims to the final 11-field DepositNote also changes existing post/withdraw/query constructors. C01 owns the minimum coherent V1 schema, field carry-forward, selector/query and affected ABI-consumer changes, plus the specified ceiling calculation for initial eligibility. There will be one fresh ABI and note layout. C02–C05 retain their actual authentication, contention, full-history and penalty acceptance; carrying fields does not satisfy those gates. C01 scope now explicitly includes affected app/shared consumers and test tooling. Exact initialization ABI/storage selection is recorded before its implementation.

C01 also requires a real authenticated Ready/deposit/claim/no-post-exit harness for its bridge criteria. Permissive mocks, inserted test messages or a locally installed Outbox root alone do not establish rollup proof acceptance. If that environment cannot be run, acceptance remains incomplete. D01 still owns the operator deployment workflow; C06 owns broader escrow/reentrancy/recovery qualification.

The read-only `evidence/C01/proof-environment-preparation.md` identifies the
installed convenience local-network helper's fake verifier and synthetic epoch
settlement. C01 will explicitly deploy/check the genuine verifier, configure real
server proving, and observe accepted proof publication through finalized L1 state
and canonical Outbox consumption. Wallet proving alone is insufficient. Disposable
test funding and a no-post exit do not create a dependency on completed W01/C06.
Published network-prover hardware guidance is not a measured local minimum;
capacity and runtime must be established by a bounded experiment when C01 begins.

## P04 derived setup adoption

The source-bound Node24.15/explicit5.2 WASM experiment initialized all1,179,648 BN254 points from the existing compressed setup in118.910s and the full derived representation in1.873s, in separate fresh processes. The output is75,497,472bytes with SHA-256 `2aefa0bc53704a61d887ff316d56b6f8bed968859b8b894c3677f11797779dac`. G2/Grumpkin and capacity are unchanged. This is one Node measurement, not browser or production performance evidence; measured process peak memory was higher for the uncompressed path.

P04 adopts build-derived G1 to address the observed initialization blocker. Schema2 keeps all three existing input pins and adds a required derived asset/provenance entry binding full input/G2/5.2 WASM content. Build and runtime must hash-check the complete derived bytes; the upstream uncompressed API's first-two-points check alone is insufficient. Runtime prefers the verified local derived asset and may fall back only to the existing verified compressed source. Format drives exact response validation (empty for uncompressed, full decompressed length for compressed). No point reduction, generic mutable cache trust, remote URL reinterpretation or relaxed cryptographic check is allowed.

Build output comparison includes the additional asset. Independent clean Linux derivation and both actual browser consumers must qualify before P04 completion. Prior native33-output matches remain historical evidence for their recorded inputs; the new candidate requires updated output/source binding. The64MiB remote-download limit remains; the72MiB fixed derived output has a separate bound.

## A02 patched dependency/runtime qualification —2026-09-14

Fresh exact-lock audits preserve the84total/46production package-entry inventory.
Root selects qualification of narrow publisher-patched dependency versions and
Node24.21.0, whose embeddedUndici7.29.1 cannot be patched through npm overrides.
TheAztec5.2/Noirbeta.25 stack stays matched. A02scope nowincludes exactruntimepins,
CI andbuilddocumentation; actualSDK/native transport/telemetry checks and
reproducibility must pass beforeacceptance. Majortransitive changes require explicit
parent-constraint/API review. Any asserted unreachability remains source/configuration
bound and independentlyreviewed; all external releasegates remain mandatory.

A02 also covers the Node-based model-isolation probe image because CI and
`censor-daemon/model-runtime.mjs` share that immutable dependency. Update their
verified image digest together and rerun the existing isolation/boundary checks;
this does not authorize weakening the sandbox or changing model behavior.

A02 qualifies Jaeger2.9.0 with its own nestedcore2.9, keeping the otherOTel1.30
components andAztec5.2 pins. Publisherpackage/source inspection confirms unchanged
TextMapPropagator/API1.x boundary and shared tracing-suppression contextkey.
This explicitly overrides the oldSDK exactJaeger1.30 parent constraint; actual
parent registration, valid/malformed propagation, suppression andglobal/noop
controls must pass. The knownbad preinstalledJaeger case remains baselineevidence;
a clean-start-only exclusion is not used to close this high-severity finding.

## A02 residual treatment and mandatory release controls

The final exact-lock inventory retains eight older OTel core paths and developer
elliptic, plus a separately recorded embedded-TXE scope limitation. A02 does not
assert these are all patched or universally unreachable. Its explicit treatment
is recorded in evidence/A02/residual-release-register.json. D01 now depends on
A02 and must implement and test supported startup/propagation and operator/tooling
boundaries under D01-A05. T05-A05 requires actual final package inventories, fresh
advisories, tested controls and independent dispositions bound into release
manifests. R01 carries the full inventory into external review. These are open
release requirements, not implemented controls or waived findings. Ordinary local
engineering with disposable test identities may continue while they remain open.

## C01 executable note limit correction — 2026-09-14

Full compilation failed at actual create_note and discovery: pinned V5 permits at most8 packed Fields. P04's11-field fixture tested packing/selectors but never instantiated note creation. The original assumption is withdrawn. Keep11 logical wallet values but pack receipt metadata96bits and sequence state192bits in typed one-field substructs, yielding8 physical Fields. Generated chain selector staysindex1; no protocol patch, field deletion, second note or relaxed bound. interface-spec now records exact storage order. C01-A05 adds actual lifecycle and upper-bit rejection criteria; P04/A02 historical baseline build evidence is not relabelled as verification of this correction.

## C01 local server witness adapter qualification

The matching upstream Noir release metadata exposes no standalone ACVM asset.
The installed standard server prover constructs a CLI-based NativeACVMSimulator,
while the matched WASM ACVM has already generated genuine witnesses accepted by
the pinned native prover. Prepare an explicitly named test-only WASM CLI adapter
for that exact simulator boundary and qualify the actual BBNativeRollupProver
small padding path. This is not native ACVM, a production replacement, or a
mocked proof. No dependency, circuit, verifier or foreign-call constraint is
patched; genuine proof and verification remain mandatory. The adapter accepts
only controlled fresh local files and rejects foreign calls. Broader circuit and
actual finalized bridge qualification remain open until observed.

## C01 local genuine epoch qualification

Use explicit local Ethereum1s/Aztec12s slots, epoch4, and proof submission64epochs
for the first genuine covering proof. Read these from the deployed contract. This
retains the actual protocol deadline while allowing local single-worker proving;
it is not a mainnet timing/performance claim. Wait for genuine committee eligibility
using observed chain state before transactions. Partial epoch proving through the
installed ProverNode.startProof API is acceptable only with actual verifier-backed
L1 acceptance and canonical finalized Outbox consumption. No proven-tip/root or
finality override is permitted. Prepare at most129 complete4MiB BN254 compressed
chunks, all pinned to the exact executable; remove temporary setup after testing.
