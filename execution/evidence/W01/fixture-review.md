# Restricted sponsor fixture — bounded feasibility handoff

2026-09-14. W01 remains incomplete. This is an implementation/constraint experiment and AI integration evidence, not an external cryptographic audit or production-fee qualification.

## What exists

`billboard/fee-fixture/` is an independent, pinned Aztec5.2 / Noir1.0.0-beta.25 workspace. It leaves the production board ABI unchanged. `RestrictedSponsor` checks a fixed height-one Merkle membership proof, binds each of two positions to one private owner, consumes an owner-bound `SingleUseClaim`, checks actual transaction gas/fee fields and anchor time, sets inclusion expiration, elects itself fee payer, ends setup, and calls exactly `FeeTarget.delegated(owner,value,nonce)`. The target restricts its caller and verifies a real account authwit before enqueuing its own counter update. No arbitrary application-call list, public setup budget counter, or alternate fee-election entrypoint is present. `NestedCaller` is explicitly adversarial/test-only.

The policy administrator may initialize the policy once after both contract addresses are known; Aztec `PublicImmutable` initialization nullifier prevents replacement. This avoids a sponsor-address/coupon-root circular deployment dependency. Maximum unit fees are restricted to u64 even though the protocol ABI is u128, so the u32 gas×price sum fits u128. Teardown is contained within total gas. Each of two tickets costs at most `max_fee_per_ticket`, and configuration requires that cap <= `epoch_budget / 2`. There is no batch rotation/replenishment implementation yet.

## Actual verification

Use the publisher-verified Node executable `.build/A02-node/node-v24.21.0-darwin-arm64/bin/node` with these arguments:

- `billboard/fee-fixture/run.mjs compile`: final compile exited0; raw Brillig constraint-analysis diagnostics from pinned framework calls are retained in `fixture-compile-final-corrected.log`. They are not suppressed with compiler skip flags and are not treated as external soundness clearance.
- `billboard/fee-fixture/run.mjs process`: final processing exited0. All three artifacts are transpiled and every private function has its actual generated VK. Every embedded external source matches the existing full pinned dependency inventory; every embedded fixture source matches the compile snapshot. `fixture-processing-final-corrected.log` records results.
- `billboard/fee-fixture/run.mjs pure`: **26/26 passed**, including both leaves; exact fee/time boundaries; changed owner/sibling/blind/chain/version/sponsor; index overflow; both gas, teardown, price and priority dimensions; total fee; early/expired anchor; policy arithmetic bounds. These execute the same helpers called by the sponsor. `fixture-pure-attempt1.log`.
- `billboard/fee-fixture/run.mjs txe`: first focused run **13 passed,1 failed**. Reinitialization correctly reverted, but its expected text was wrong. The only subsequent test-source delta changed that expected text to the actual `EMITNULLIFIER: Attempted to emit duplicate nullifier`. `fixture-txe-focused-attempt1.log` preserves the failure.
- `billboard/fee-fixture/run.mjs txe reject_policy_reinitialization`: **1/1 passed** after rebuilding/reprocessing the snapshot; `fixture-txe-reinitialization-corrected.log`. There was no fresh all14 run. Unchanged cases include a real nested target call with owner authwit and counter effect, missing/changed-value/changed-nonce authwits, wrong caller, policy round-trip, pre-election membership/gas/expiry/root/nesting/configuration checks, and one explicitly named framework-limit observation.

Compile/processing children have600s bounds; pure tests180s; TXE readiness60s, tests600s, then bounded terminate/kill/reap. Managed runner exited0 after the corrected test. `fixture-context.json` records exact source/artifact/log hashes, compiler identity, and absence checks for recorded TXE/test PIDs. No owned process remains.

## Reproduced framework limit and remaining work

The attempted valid full sponsor call failed with **`fee payer must be elected during the setup phase`**. This is not a successful sponsorship test. Installed `node_modules/@aztec/txe/src/oracle/txe_oracle_top_level_context.ts:481–485` unconditionally sets `minRevertibleSideEffectCounter=1`, including no-sender calls. Thus TXE marks all side effects revertible before the fixture executes. We did not patch that dependency, change sponsor phase rules, or invent an oracle that bypasses them. `fixture-txe-valid-attempt2.log` and `fixture-initial-composition-tests.nr.txt` preserve the attempted scenario. The maintained `observed_txe_root_starts_after_setup` case explicitly observes this limitation.

A genuine local PXE root transaction must still establish full sponsor→target composition, sponsor debit with nonzero actual fees, finite two-ticket exhaustion, replay with fresh action authwit, private owner key validation, inclusion expiration, consumption on public application revert, setup allowlist compatibility and finality/proof behavior. Fee-payer/RPC/issuer/funding observations and arbitrary extra-call attempts need capture and assessment. This fixture does not establish production anonymity, real-proof acceptance, operator funding, issuer policy, outage behavior or release/network clearance. Its actual target-authwit tests are a separate necessary control, not proof of sponsored composition.

## Integration details

Load the actual ignored output artifacts with SDK `loadContractArtifact`. Paths and final hashes are in `fixture-context.json`:

- `billboard/fee-fixture/target/fee_sponsor-RestrictedSponsor.json`
- `billboard/fee-fixture/target/fee_target-FeeTarget.json`

Deployment: sponsor constructor(admin), target constructor(sponsor), then sponsor.configure(Policy). Scope actual chainId/rollupVersion and deployed sponsor address. Leaf = `poseidon2HashWithSeparator([chainId,rollupVersion,sponsor,epoch,index,owner,blind],0x57463031)`; root = `poseidon2HashWithSeparator([leaf0,leaf1],DomainSeparator.MERKLE_HASH)` with exact V5.2 separator2982624097. Owner authorization action is `target.delegated(owner,value,nonce)` with caller=sponsor. The transaction root is `sponsor.sponsor(owner,index,blind,sibling,value,nonce)` with no account wrapper; attach matching authwit, owner PXE scope and final gas settings inside policy bounds. All Policy field names/types are in `common/src/lib.nr` and compiled ABI.

Nargo selects the outer Billboard workspace even when invoked from the nested fixture directory. The runner therefore stages only fixture Nargo/Noir files in `.build/W01-fee-fixture`, outside that ancestor, and copies generated artifacts to the delivery paths. Initial cache-permission, package-selection and runner/compiler corrections are retained as distinct attempts. An incidental parent-workspace compile was reported immediately; root owns restoration of the ignored production target. No tracked production artifacts were changed by this lane.
