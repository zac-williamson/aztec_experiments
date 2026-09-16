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

## C01 measured full-prover time budget

The first full-AVM settlement run (f0e76cb8) reached the600-second helper deadline
with no reported checkpoint failure, no accepted L1 proof, and peak sampled
descendant RSS5520176KiB. Native work was observed CPU-active. Original failure
and cleanup evidence remain unchanged. Next local experiment permits1200seconds
for settlement and1500seconds overall, with the same single proof agent, one
native thread and8GiB limit. This is a new run, not a retrospective extension.
Temporary authenticated CRS bytes may be reused only after the existing full-file
and129-chunk checks; no trust in unverified cached inputs is introduced.

## C01 full bridge qualification budget and serialization

Ready settlement962b9b9d passed with actual proof receipts, finalized membership
and portal activation in18.5minutes, peak8172880KiB below the8GiB bound. The next
fresh full journey permits60minutes overall,20minutes Ready settlement and30minutes
exit settlement. Client proofs run while the sole server agent is idle and stopped
through its actual lifecycle; resume polling for genuine exit proofs. No proof,
message-consumption or finality constraints are overridden. Reuse authenticated
epoch setup only after full-byte and all129-chunk verification.

## C01 claim inclusion retry: ordinary continuous L1 mining

The full bridge attempt c40e5544 passed real Ready activation, L1 deposit, private
claim proving and normal node validation, then timed out on checkpoint inclusion.
Logs record previous-L1-block timeout, failed slot107 publication and parent prune.
Exact EVM failure was not retained, so this is not an established application flaw.
The test paused its manual mining during wallet/proof work while the SDK clock
continued advancing. Use one ordinary loopback L1 mining loop through client work,
including inclusion; helpers await that loop instead of mining twice. Stop and
await it before server settlement. Do not change slot expiry, proof constraints,
finality or resource bounds. Runtime tests verify mining during work and cessation
on normal/error exits, including RPC failure. The full retry must establish
whether this resolves inclusion; safe timing/receipt diagnostics are retained.

The reviewed replay control checks the actually consumed message nullifier and
rejects a fresh account request specifically for that consumed message. Two TXE
controls change the depositor and an in-range amount independently. These are
additional acceptance tests; their mere implementation does not close C01.

## C01 local broker retention must cover the proof window

Retry8a92f555 advanced through real claim inclusion, exact note/replay checks and
no-post exit inclusion before aggregation stalled. Source/progress show pending
epoch26 subtrees while only epoch27/28 broker jobs remained. The pinned broker's
default retention is1; cleanup deletes pending as well as settled jobs below
highestEnqueuedEpoch minus retention. Enqueueing28 therefore discards26. Root
stopped the stalled run explicitly with SIGTERM after preserving progress; no
refund or whole-run pass is claimed. All owned descendants and temporary data
were confirmed removed.

Set local proverBrokerMaxEpochsToKeepResultsFor to64, matching this test's actual
64-epoch proof submission window, and assert the constructed broker value at
startup and settlement. This changes local work retention only, not proof,
message, expiry or finality validation. Add an actual in-memory broker scheduling
regression contrasting1 and64; no simulated proof result counts as cryptographic
evidence. Future runtime configuration must assess retention versus proof lag.

## C01 measured complete-exit budget

Run879494b1 produced all four genuine exit epoch proofs, with successful
canonical L2ProofVerified receipt covering checkpoint11. Its30-minute exit
deadline fired during the actual finalized-tag wait, before refund. The50.3-minute
whole run stayed below8GiB and cleaned all owned processes/setup. Preserve it as
a failed run. Following budget-contingency-review.md, the next fresh experiment
allows45minutes exit and75minutes overall, with Ready20minutes unchanged. No
proof, finality, protocol window, memory or thread constraint changes. Ephemeral
chain state was cleaned, so repeat the complete journey using reverified setup.

## C01 activation timing variance

Run ae52b32c reached the unchanged20-minute Ready limit with the first real
epoch accepted and the second checkpoint root still processing; no proof failure
was reported. Peak6679232KiB and complete owned cleanup were recorded. A read-only
CPU snapshot showed the worker using a full core; no exact cause of timing
variation is established. Preserve this timeout. The next fresh run permits
40minutes Ready,45minutes exit,100minutes overall (50minutes for Ready-only mode).
These stage budgets remain below the local64-epoch proof window of3072seconds;
the actual protocol still enforces expiry. Memory8GiB, one agent/thread, genuine
proofs and finality checks remain unchanged. No deadline was extended live.

## User correction: application test boundary

The user explicitly directs testing application transactions with genuine proofs
and official accelerated local epoch/Outbox settlement controls. This supersedes
the earlier agent-imposed C01 requirement to generate network epoch proofs locally.
Test the actual portal, message contents, membership consumption, nullifiers and
accounting; trust the protocol settlement test fixture at that boundary. Label
controlled settlement honestly. No server prover/native AVM build/epoch CRS is
required. Application integration has a hard deadline below10minutes. Release
network verification and independent application audit remain separate gates.

## 2026-09-15 — production target reaffirmed

The user reaffirmed production readiness, explicitly rejecting a reduced tech-demo
engineering standard. Current V5 suitability is deferred and must not block
application work. V6 compatibility and target-network clearance will be assessed
before production release; no speculative dependency upgrade is made now. Audit,
security, reliability and release checks remain. C02 scope includes application
proof-test scripts and regenerated artifacts.


## 2026-09-15 — replace the operated coupon architecture

The user challenged the assumption that private V5 fees require an operated sponsor.
Protocol/source review confirms an ownerless fully private FPC can maintain user-funded
private balances and elect itself as protocol fee payer. No HTTP issuer, registration
operator, sponsor funding actor or batch scheduler is inherent to that design.

Sources checked: official https://docs.aztec.network/developers/docs/aztec-js/how_to_use_private_fee_juice;
reference https://github.com/alejoamiras/ecosystem-tooling at9c71d5d9d84910ad76721a38cf1e07d7f49a4c1c,
packages/private-fee-juice (package and Noir dependencies pinned5.0.1);
local pinned5.2 FeeJuice contract claim_helper and PrivateContext.set_as_fee_payer.
The reference verifies FeeJuice claim nullifiers, prevents repeated credit minting,
keeps user credit in private notes and deducts fees during nonrevertible setup.
It supports initial bridge claim plus private mint/payment within one transaction.

The earlier inference from public native FeeJuice balances and deprecated
PrivateFeePaymentMethod to needing an operated coupon system was unjustified.
Deprecation concerns an older public-token-call FPC, not all private fee designs.
Stop new coupon-service work. Next qualify and integrate the ownerless user-funded
route, then remove mandatory coupon routing and service-only production gates.
Preserve historical evidence without treating sunk work as architecture justification.

The reference is5.0.1 while this application pins5.2.0: its artifact/address cannot
be reused unchecked. Reference pay_fee charges the maximum gas budget without
refunding the difference, which must be reflected in fee estimation and UX.
The shared contract address/public aggregate balance remain observable; individual
fee balances/spending are private. L1 funding/cold-start timing still needs an
accurate privacy description. No replacement integration or production security
qualification was performed in this read-only protocol investigation.


### User-funded private fees (2026-09-15)

User explicitly requested removal of coupons. Replace the operated sponsor with an ownerless private FPC and user-funded protocol FeeJuice bridge. No issuer, coupon storage/registration, admin or operator replenishment is part of this fee path. Canonical artifacts are rebuilt for pinned 5.2. Private balances are charged the configured maximum fee, with no unused-gas refund. Pooled balances, funding amounts and cold-start timing remain observable and must be assessed; fully private spending does not imply invisible L1 funding. Historical sponsor evidence is retained only for its original source.


### C04 history retrieval and test scope

Use pinned note-property selectors for deposit identity and predecessor link before a two-result oracle limit; the second result detects ambiguity. This bounds the Noir response, not the pinned PXE backend's owner/slot scan cost. Measure that backend explicitly. Extend scope to supporting test/build scripts and generated consumers. Long-history verification combines real17/33-post lifecycle executions, actual persisted PXE records beyond1000, and an explicitly seeded long-history contract fixture with authenticated continuation/exit; do not describe seeded notes as1000executed/proven transactions. Avoid a repetitive1001-transaction run that the33-post benchmark indicates would exceed the nine-minute budget.

## C05 checked economics and moderation inclusion

The fresh ABI uses seven-field, length-delimited moderation reasons and requires
the post's captured policy version. Policy identity follows the P01 content hash;
public inclusion starts the full censor window. CLI policy reads are atomic.
Private admission conservatively reserves a timely recovery schedule within the
supported timestamp and sequence domains; no backlog count is made public.
The existing unconditional withdrawal debt check remains authoritative.

C05 passes171 distinct contract checks,66 integrated checks and genuine screening
and private-fee claim/post journeys. Automatic historical-policy retrieval remains
M02; current daemon behavior is explicit failure before model/signing for a
mismatched version. This is not production completion or an audit waiver.

## W03 moderator recovery scope

Extend W03 to censor-daemon/ because enforcing durable moderator journals requires its trusted signer to reconcile previous requests between jobs and after restart. Model output cannot select recovery/acknowledgement flags. Persist exact moderator operation metadata with the transaction; a recovered successful identical operation is returned without another proof. Failed or unknown results must not complete a job.

## W03 stale post proof replacement

A fresh proof must preserve the logical operation. Persist the real post's nonce,
message and deposit-chain identity in the same encrypted record as its proven
transaction. Replacements retain up to eight exact predecessor proofs and may be
prepared only after every saved attempt is freshly reported dropped and invalid
for the pinned state-conflict reasons. Recheck immediately before saving a new
proof; unknown/live attempts and concurrent record changes fail closed. The board's
independent post ID remains unchanged and an already visible ID blocks new proving.

This route initially applies to real posts, whose public identity is enforced by
the contract. Dummy screening has no equivalent independent ID and must not inherit
real-post metadata or silently take this path. Other operations keep their specific
recovery routes while their stale-state behavior is qualified. Missing local notes
must not be treated as evidence of a prior successful withdrawal; review that path
in the remaining all-stage qualification. No criterion is closed by this decision.

The new local proof-recovery qualification makes the original post proof actually
invalid by spending its private fee note in a separate genuine transaction. It then
restores the encrypted journal and regenerates the same post. This avoids invented
node-validation results or a network epoch prover. The existing540-second parent
budget and serialized native-job limit apply.

## W03 stale screening and withdrawal identity

Persist the selected deposit chain and complete decoded source note for screening
and withdrawal requests. A replacement must reconcile every previous proof and
see exactly that same source note before proving. Any changed or missing note
blocks regeneration; recovery must not advance another screening step or switch
to a different deposit. Claim recovery will additionally preserve its exact claim
arguments and authenticate the corresponding receipt.

## W03 final-proof spend binding

A pre-proof note read alone races with wallet state changes. Screening/withdrawal
records therefore bind the attributed board-call nullifier and require it in every
replacement final proof. They also preserve selected chain and source sequence.
A different fee-note nullifier cannot satisfy this condition. Genuine attribution
qualification is in progress; the first run failed closed and is not evidence of
completion. Claim replacement instead preserves the complete original receipt and
message identity, validated against custody and the scoped beneficiary. The
contract consumes that exact L1 message. A note's presence is not confirmation of
an unresolved saved transaction. Claim actions make one submission attempt.

Extend W03 documentation scope to TESTING.md to document the actual bounded recovery profiles and tightened resource limit. No change to contract scope or release gates.
