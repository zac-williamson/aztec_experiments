# P03 baseline finding matrix

This matrix supersedes preparation.md's pre-M01 current-state descriptions.
It distinguishes actual local regression evidence from source observations and
experiments still required. A passing known-bad observation test is evidence of a
reproduced defect, not a pass of the future repair criterion.

| Finding | Current evidence and limitation | Required downstream acceptance |
|---|---|---|
| B01 fee identity | Source evidence in baseline/evidence/app-fee-funding.txt and aztec-v5-public-fee-payer.txt establishes identity-bearing default route. No actual observer experiment or private-fee alternative has been run in P03. | W01-A01–A04: actual supported shared/private payment, public observation controls and sponsor exhaustion without silent fallback. |
| B02 stale portal | P02 rebuilt/synchronized actual artifacts. P03 portal tests compare generated deployment copies and source behavior against pinned historical bad bytecode; bridge is mocked only for accounting. | A01-A02/A04 and C06-A01/A04: deployment artifact equality and liability accounting; real bridge tests remain necessary. |
| B03 arbitrary portal | Current claim_deposit source accepts caller-supplied portal for message consumption. Wrong-sender collateral creation has not yet been reproduced with real message authentication. | C01-A01–A04: intended/wrong sender, uninitialized configuration, message-field mismatch and replay controls, with actual consumer check. |
| B04 shell reason | M01 repaired actual process boundary. P03 retains hash-pinned historical constructor with mandatory injected capture, confirms unescaped substitutions in constructed string, and compares current fixed signer argv. No shell/payload execution; model-induced exploit reliability unmeasured. | M01-A01–A04 passed for boundary/isolation; M03 still measures real-model quality and injection corpus. |
| B05 substituted notes | Missing origin/owner/slot/deposit-chain constraints and generic inclusion semantics remain source-confirmed. No valid foreign-note adversarial proof has been generated. | C02-A01–A04: actual foreign-contract/wrong-owner/wrong-slot and deposit-chain fixtures beside valid controls. P04 defines binding. |
| B06 global counter | Historical global counter read/live equality remains source-confirmed. Real two-author same-anchor throughput and reproof behavior unmeasured. | C03-A01–A04: initial two-author discrimination then ten concurrent authors at one anchor, including screening/exit traffic. |
| B07 fixed history page | Three actual TXE tests pass: first 16 notes provide child 15; after 17 successful posts the first page retains 0–15, required child 16 is absent, and post 18 rejects. 32/1000-history, redeposit and production PXE ordering remain unrun. | C04-A01–A04: 16/32/1000-history, multiple-deposit, missing/duplicate/stale links under supported real PXE; do not infer full PXE semantics from TXE. |
| B08 penalty-reset exit | Current withdraw checks eligibility only without real posts, contrary to chosen P01 semantics. Full flagged/screened withdrawal/redeposit cycle unrun. | C05-A01–A04: penalty-constrained exit, eligible/expired controls, checked arithmetic and later L1 roundtrip. |
| B09 reverted receipt | P03 executes actual wallet through complete shared module with controlled SDK/node/prover. Use V5 receipt executionResult alongside inclusion status, not solely obsolete status-shaped fixtures. A stubbed receipt is not a live transaction. | W03-A01–A04 and M02-A01: explicit successful execution, reconcile pending/dropped/unknown/reverted outcomes, restart safety; never acknowledge failed flag. |
| B10 stale censor ABI | P02 canonical/censor artifact equality and discriminating stale-copy guards repaired the old four-argument init copy. Dedicated censor app runtime not yet accepted. | A01-A01/A04: current ABI/all consumers plus actual dedicated censor initialization. |
| B11 deployment wiring | P02 repaired pinned build/runtime/proving-asset inputs. Predicted CREATE2 fallback address and soft final checks still need behavior reproduction; no local full deployment accepted here. | D01-A01–A04 and A01-A03: missing proxy/direct address result and failed cross-checks must refuse or use verified actual target; then disposable local deployment. |
| B12 lost moderation work | M01 serial polling and in-memory failed-work retention are tested; restart persistence, receipt semantics and current policy are still missing. Administrative policy action also omitted from needsPXE. | M02-A01–A04: persistent jobs/leases, submit-receipt-checkpoint crash cases, competing workers, current policy on empty board, deadline alerts and retry budgets. |

Source evidence is frozen under execution/baseline and can explain the starting
findings. Reproduction logs in this directory describe the current tested snapshot.
No mock proof, inclusion stub, static pagination model or source inspection substitutes
for the real protocol/proof/observer tests assigned downstream. P03 does not change
external audit, 14-day soak or official target-network release requirements.
