# Checkpoint

- Completed: P01, P02, M01, P03, P04 and A02.
- A02 accepted with213 hashed evidence artifacts. Native and clean Linux qualification passed; all34 generated outputs match exactly. All test containers and temporary staging copies were removed.
- Node24.21 and seven dependency overrides are qualified; all57 protected Aztec/Noir lock entries are unchanged.
- Final npm scans report zero high/critical entries; lower-severity findings and embedded-tooling limits remain explicitly recorded. D01-A05 and T05-A05 require tested release controls.
- Verified candidate: `688484e2afcbd2536a95baeb5e37e0fb68ceb9c4b6c17ccbc1cbcd0ba2054824`.
- A02 committed locally as `6d9a655`. Active: C01 fresh authenticated deposit/bridge implementation. W01 production integration now depends on C03; all W01 criteria remain incomplete and unwaived.
- W01 fixture compiles;26 pure constraint checks pass. Focused contract checks exercise admission/configuration and real delegated authorization; TXE cannot cover root fee election; subsequent actual-node mock-proof checks cover sponsorship, replay, paid revert and both expiry paths.
- Local node startup and graceful cleanup pass: isolated chain31337, disabled peer networking and no extra public setup functions. The pinned publisher discarded a slasher watcher unsubscribe; the local harness now retains and invokes it, drains its polling work and exits normally. Failed diagnostics remain recorded. Actual PXE composition now includes successful sponsored effects and nonzero receipt-matched debit with both authors unfunded; both-ticket/replay run passed. Exact coupon-nullifier matching passed. V2 paid public-revert consumption also passed: sponsor debit persisted, counter unchanged, spent ticket rejected exactly. Prepared-transaction admission expiry passed with unchanged canonical state and no debit. Queued expiry at block construction also passed; production issuer/funding integration remains open.
- X03 remains blocked for production release. Real proofs, external audit, operator acceptance and14-day soak remain mandatory. The application is not production-ready.
- No publishing, paid services, production wallets or real funds used.

W01 mechanism evidence is committed through `db1e55c`: real local transaction
effects/debits, exact spent-coupon rejection, paid public-revert consumption,
admission expiry and actual queued-expiry builder filtering pass under the
explicit mock-proof profile. C01–C03 establish the fresh note/ownership/post-ID
interfaces that the production fee route must bind. No reverse dependency is
introduced; C01 can use disposable test funding without claiming fee privacy.

C01 checkpoint: authenticated V1 escrow, compact eight-field notes and affected ABI consumers are implemented. Full Noir101/101, portal29/29 and client/artifact41/41 checks pass; apps build and offline CLI checks pass. Note delivery, pagination, exact selection between two receipts and independent consumption are covered. The generated caller's offset-name collision was corrected without dependency changes.

C01 implementation committed da5caf0: Noir101/101, portal29/29, client/artifact41/41, builds pass. Genuine nontrivial BaseParity proof passed (~70s,3.1GB maxRSS), altered public root and scalar corruption rejected. Actual BBNativeRollupProver padding through explicit test-only WASM CLI adapter passed, independently reverified and corruption rejected; ten adapter cases pass. All proof processes/temp setup cleaned. Next: genuine-verifier local protocol topology and finalized Ready/deposit/claim/no-post-exit integration; C01 real bridge criteria remain incomplete.

Heavy checks remain serial with one bounded review agent. Padding and BaseParity qualify proof plumbing/capacity only, not application or finalized epoch acceptance. No mainnet transactions or release gates were waived.

Continuing: first qualify direct real-verifier deployment on a fresh disposable
chain, then ordinary node/prover startup. Root owns the bounded supervisor; one
agent owns the deployment/identity module. No user decision is required.

Real Honk verifier and production BlobLib deployment/code checks now pass.
Real proof-verifying node and prover subsystem startup/cleanup also pass
(real-network-84839e10). Next is a genuine board deployment proof with fresh local
funding; no board transaction or epoch proof acceptance has yet been observed.

Ordinary board deployment inclusion passes (1bb4b84e), and real portal binding
proof/inclusion emits the exact expected Ready leaf (497f7da7). Deposits remain
disabled. Next is genuine covering epoch proof and finalized Outbox activation.
A temporary516MiB verified setup prefix prepares the outer circuit; all download
chunks are bound to the pinned native binary. Local proof deadline will be64epochs
for capacity qualification, with resource supervision retained. No mainnet claim.

Latest: genuine epoch run cbdddf35 failed at PUBLIC_VM: the pinned lightweight
bb binary explicitly requires full bb-avm. No epoch proof was accepted. Root
stopped the now-idle attempt after507s; peak sampled group RSS5057344KiB, below
8GiB. All owned processes, temporary chain and516MiB setup download removed.
The later RPC shutdown errors are cleanup consequences, not the initial cause.
Next qualify AVM-capable runtime before any repeat. Official5.2.0 publishes an
amd64-Linux AVM artifact; native build feasibility is under source review.

The application Ready activation now uses the actual getChainTips API and checks
successful canonical inclusion again after witness resolution. Integrated53
client/artifact tests pass; deployment page rebuilt. New16-case regression suite
uses actual SDK BlockResponse schema and is included in test:c01-clients.
