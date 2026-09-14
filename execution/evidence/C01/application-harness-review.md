# C01 application harness source review

Read-only review during the first application-profile run; no execution or source edits by this reviewer. Runtime outcome remains pending. This is an AI integration review, not an external audit.

## Scope and verified behavior

- The local protocol fixture explicitly uses `realVerifier:false`; this is the L1 epoch verifier fixture. Independently, the node requires `realProofs:true`, has no ProverNode and uses the ordinary sequencer. Existing board/Ready/claim/exit helpers still create genuine application proofs and call normal node validation.
- The new settlement helper imports the installed official `settleEpochOutbox` and `RollupCheatCodes`. It consumes actual checkpointed block effects, writes the official computed Outbox root and marks the local proven tip through test controls. It does not construct or assert an epoch proof receipt. `testControlled:true`, `proofReceipts:[]`, and `finalized:false` make this distinction explicit.
- SequencerClient.pause() drains current sequencer work without closing the validator DB; start() is the supported restart. Settlement runs outside the awaited client-mining scope. The helper rechecks canonical successful transaction, block and exact message effect before and after settlement, and uses the actual node membership resolver plus actual Outbox root.
- Ready activation and final withdrawal are real portal contract calls using membership paths. Refund independently recomputes scoped exit content/leaf, requires the emitted effect and controlled coverage, then checks canonical success, receipt removal, total escrow and balance deltas, depositor gas reconciliation and an actual repeat-withdrawal simulation rejecting No active deposit.
- Parent declares 540000 ms and an 8 GiB sampled descendant-tree cap, minimal fresh environment, localhost-only networking, setup/binary/source hashes and cleanup before acceptance. It does not stage epoch CRS or invoke the native AVM/server proof fleet.

## Findings communicated to root

1. Evidence wording only: `c01-settle-ready.mjs` final scope still says "finalized Ready membership" although this profile establishes controlled settlement and actual consumption. Remove that finality wording after the frozen run.
2. Evidence wording only: `test-c01-application.mjs` worker initializes a "real-verifier local deployment; no board or epoch proof" profile, inconsistent with the L1 mock verifier fixture and genuine board proof mode. Report the selected application scope and distinguish L1 fixture verifier from application proof verification.
3. The bridge top comment still says serialized client/server proving and retains an unused pause helper; these are stale source comments/code, not observed server execution.

## Limits

No protocol finality, genuine epoch-proof acceptance or production Rollup BlobLib qualification is claimed by this profile. The actual portal consumption/accounting and proof-generation assertions must still pass in the active run; source inspection alone is not a passing execution. On helper deadline the owned environment must be torn down by its parent rather than racing a restart against an unfinished pause/RPC.

## Source binding

- `scripts/test-c01-application.mjs`: `9141ae40b277abd48fd127a2f0ac20ca568344265b6b23909cf85b9a65fbc7b4`
- `scripts/c01-application-deployment.mjs`: `a81fe20b22967ce6e3d6c1f751ee93ed6c9fef5e8553cf4037534780dec11fa2`
- `scripts/c01-real-node.mjs`: `a79b86e5da14fcca34ad47511ad1bf4c6ae11fe99bbf5dbbfae4fc0259969690`
- `scripts/c01-settle-application-message.mjs`: `7399875d97f5dfd82a3787d8c39390fd9fc6673c8ce06d5bc41464515c3fef4b`
- `scripts/c01-settle-ready.mjs`: `e66ebc9efef9fe4e2b2cd8a76f71d9e851e0a60ab1c4788f1ee5e4a7f6dfce90`
- `scripts/c01-bridge-flow.mjs`: `03771a90d1e5a84a774c6e17b2b19552877f6edfdab504702ce467ab3723ff77`
- `scripts/c01-withdraw-l1.mjs`: `efc31d321d566b47fe18a17f23e4923b8258e6c42af43350130ff94ae5d62baa`

## Completed application run and final scope disposition

Independently inspected `application-c2a64fc6-366e-4460-aad3-dc8424ddf3af.json` (SHA-256 `616a149b559b64a689b2985b024dfb6982ab7e09a763feb6cb1da0e828c6aed1`). Overall pass: **264255 ms (4m24s)**; peak sampled descendant RSS **1643648 KiB**; descendant tree absent, temporary directory removed, node/Anvil/wallet/singleton cleanup recorded. Both Ready and exit settlement used official test controls, with empty proof receipt lists and finalized=false. No server prover was created.

Actual assertions passed: canonical successful board and Ready inclusion; portal disabled before actual Ready consumption and enabled afterward; real deposit and Inbox membership; genuine claim proof with normal node validation and inclusion; exact eight physical/eleven logical note; fresh-request consumed-message replay rejection with original note unchanged and no second note; genuine no-post exit proof/admission/inclusion, exact nullifier and active/logical note absence; actual Outbox-based L1 refund; exact 1000000000000000 wei escrow reduction, gas-adjusted depositor balance, cleared nonce receipt and repeat-refund rejection.

### Post-run source equivalence

Four post-run edits were independently reversed in memory and rehashed against report.sourceHashes: `test-c01-application.mjs` worker profile, `c01-settle-ready.mjs` final scope, and `c01-ready-flow.mjs`/`c01-exit-flow.mjs` nextRequired strings. All four reconstructed SHA-256 values match the actually executed sources exactly. These edits change reporting strings only, with no application behavior or assertion changes. The old `c01-settle-message.mjs` is now a two-line re-export of the new helper; the passing runner and bridge/Ready helpers import the new file directly, so retiring the unused scheduler does not change the executed path.

The raw passing report deliberately retains its original stale profile/finality wording; this addendum explains it instead of rewriting history. Further stale board/deposit nextRequired and non-board runner mode labels were reported to root for the same wording-only correction.

### C01 closure coverage under the explicitly revised application-test boundary

| Criterion | Coverage and remaining condition |
| --- | --- |
| A01 | Passed exact collateral-to-rights amount/identity/note and initial eligibility controls; complete real application claim now confirms delivery. Full post-rate/economic semantics remain C02–C05, not this collateral-authentication criterion. |
| A02 | Existing 103 Noir negatives plus four binding controls cover scope, portal/actor, chain/version, amounts/nonce/secrets and uninitialized binding; canonical portal tests cover envelope/proof/disabled/constructor negatives. The currently running consolidated107/portal29 rerun must finish before root records final current counts. |
| A03 | Complete application run now supplies the previously missing actual L1 withdrawal and repeat-withdrawal rejection; genuine claim replay controls prevent duplicate rights, exit burns exact note, scoped L1/L2 identities agree. Canonical portal rollback/reentrancy/fresh-nonce controls complement this normal journey. |
| A04 | Complete application journey passes genuine transaction proving, normal node verification, actual Inbox claim consumption and actual portal Outbox consumption. Only protocol epoch settlement uses the user-requested official test controls. No network-prover requirement remains under current work item8. |
| A05 | Existing canonical packing/overflow/selector and TXE lifecycle controls plus this complete actual creation, delivery, exact8/11 retrieval and nullification cover the corrected unmodified V5 note limit. |

No additional concrete C01 implementation gap was found within this scope. Final closure remains root-owned: record the consolidated unit/portal outcome, refresh acceptance-current.md and link current source/evidence. Historical full-network proof timeouts remain failures, not converted to passing protocol assurance. Current V5 deployment clearance, external audit, later screening/posting/economics and wallet/operations gates remain separate.

- Reviewed post-run `scripts/test-c01-application.mjs`: `0995107b4bfc2f50011120e0cfd5d5c01d1c9fe1c77d2acd24f6cbb4ba0b6a37`
- Reviewed post-run `scripts/c01-settle-ready.mjs`: `cf0a0e4a531e938b601f4fdf13ce336a9d453435f3df70e2be38f6d2e2d93d1c`
- Reviewed post-run `scripts/c01-ready-flow.mjs`: `91f74ca457f7954e84b7cb0d1297ce2e90b1e039254341aeda2f9bf35d838134`
- Reviewed post-run `scripts/c01-exit-flow.mjs`: `af54d917db2106c7274f7ebb9edcaf71f430df9d34868dc069bc68771d86b956`
- Reviewed post-run `scripts/c01-settle-message.mjs`: `4e9bc2eeb7dad873311045c49f89b0b53c5ccd4f34d0516924e47338773ed132`

### Final wording freeze

Root subsequently corrected the remaining board/deposit nextRequired strings and non-board runner profile branches. Reversing only those reporting strings (plus the already reviewed worker profile) reconstructs the executed report hashes exactly for all three files; all checks below passed. No behavioral rerun is warranted for these isolated labels. Removed AVM/epoch caches are not referenced by the application runner, which hashes/stages the installed native client BB and ordinary client CRS. Their removal does not change this passing application qualification.

- `scripts/c01-board-flow.mjs` final SHA-256 `a41652d198407a850385720b1e019b739ca4e25f220ac09bc0f685f59811f8b5`; string-only reconstruction matches executed source.
- `scripts/c01-deposit-flow.mjs` final SHA-256 `f7a5c2fbcc71bdddd9b681caab8e1f27f5905ce98e56222f197300cc44c5f167`; string-only reconstruction matches executed source.
- `scripts/test-c01-application.mjs` final SHA-256 `0995107b4bfc2f50011120e0cfd5d5c01d1c9fe1c77d2acd24f6cbb4ba0b6a37`; string-only reconstruction matches executed source.
