# P04 final acceptance review — 2026-09-14

**No blocking finding for P04 closure in its documented foundation/interface-freeze scope.** This is a separate internal AI evidence review by `/root/artifact_regressions`, not external security assurance. Root retains responsibility for final artifact binding, graph validation, state transition and commit. No application, graph, test or build inputs were changed in this lane; no heavy command, service, proof or transaction was launched.

## Record integrity and source binding

At review, `execution/evidence/P04.json` contains 90 unique hashed artifacts and exactly P04-A01 through P04-A05 once each. Every artifact exists inside the evidence boundary and its SHA-256 matches. All criterion, review and source-inventory references resolve to hashed artifacts. The actual graph evidence verifier was invoked directly for P04 and passed without changing task state.

The complete current 268-entry application inventory exactly matches `source-verified-2026-09-14.json` and fingerprint `750cb4c1df4c99b7140e252bf987b66ac39ced85ee48632d8c1f6e74e4b103cc`. The separate four frozen specification/fixture files remain byte-identical to current sources and are explicitly hashed in the acceptance record. Their exclusion from the application fingerprint therefore leaves no missing binding.

The earlier source reconciliation and new native source/output comparison agree: all 147 attested inputs and both internal symlinks match; all four before/after whole-output inventories equal the 34-output reference. Reboot and the scoped native rerun did not change this candidate.

## Behavior evidence reconciled

| Evidence | Independently checked outcome and boundary |
| --- | --- |
| Clean Linux build | The full 34-output byte comparison and 171 build / 69 interface checks passed. Its later 120-second Noir fixture timeout remains incomplete at 10/22 observed passes; later Linux stages were unrun. |
| Current browser | Both actual consumer call records use 75,497,472 bytes and 1,179,648 points. All recorded source/context/raw-review hashes match; Buffer, Poseidon, worker, SQLite and isolation controls passed. The supervisor exited 0 in 5.838 seconds with original budgets. This is local browser initialization qualification, not a proof or representative device benchmark. |
| Native Noir fixture | Raw successful log reports 22/22; selected successful stage exited 0. It resolves the current fixture behavior check without reclassifying the Linux attempt. |
| Native Solidity / portal | Raw logs report 7/7 and 9/9 with zero failed/skipped; both stages exited 0 in the first native attempt. |
| Offline CLI SDK | Parsed raw result reports five successful lanes; its stage exited 0. Named functions are exercised with disposable in-memory outputs, not live CLI transactions or existing wallets. |
| Native Noir / TXE | Raw log reports 62/62 and normal TXE SIGTERM teardown; the successful stage exited 0 in 263.476 seconds. Contract execution and adverse-case baselines are tested, not actual application/rollup proof settlement. |

The first native aggregate is correctly `fail_or_incomplete`: Noir cache-lock and loopback permission failures have exit 1, while Solidity/portal/CLI passed. Only the two blocked stages were rerun, and their scoped-permission aggregate passes. Both aggregates record parent reaping and process-group absence for every owned step. This review checks those recorded lifecycle observations; it is not an OS-wide orphan-process audit.

The full Noir run completed naturally under its inherited 300-second outer supervisor without a timeout. Its maintained inner 1,200-second test budget was not weakened. The native report correctly notes that future supervision should cover readiness plus the maintained test budget and cleanup; this does not negate a naturally completed run or require another run now.

## Criterion and claim review

A01 defines and tests the exact serialized design and codecs. A02 freezes independent post identity/public ordering and per-deposit history; it does not claim the current contract's concurrency/history bugs fixed. A03 freezes versioned consumer handoff, receipt/execution distinctions, retries and pre-portal configuration ordering; operational consumers remain downstream. A04 freezes rights/refund/penalty invariants with domain-separated transcript controls; actual authenticated bridge, economic execution and rollback remain C01/C05/C06. The final summaries preserve these limits rather than turning design acceptance into runtime assurance.

A05 is supported by the recorded compatible pinned stack/source-origin/canonical-local checks, source-bound fresh Linux reproduction, successful actual browser consumers, and completed affected native baselines. The compiler diagnostics and known adverse-case expectations are not relabeled as harmless or repaired. Historical config-scope fixture bytes are preserved and linked to the later cursor fixture record; the older interim closure reviews are superseded in remaining-status conclusions by the final dated acceptance and successful runs.

Current graph entries still retain C01–C06, A02, X01/X02, T05/T06, O02 and R04 work, with X03 blocked. The final acceptance and root review explicitly preserve dependency advisory remediation, compiler diagnostic qualification, real-proof journeys, current target-network clearance, external review, operator acceptance and 14 days of representative soak. No production-ready, mainnet-clearance or external-audit claim is supported or made by this P04 review.

## Nonblocking cleanup and final binding

The reviewed P04-A05 artifact references contained two repeated browser paths. They resolve to the same correctly hashed files and do not undermine evidence; root deduplicated them during final assembly. The updated lists and all 90 existing artifact hashes were rechecked successfully. Adding this review to the record and removing repeated references do not change the observed acceptance claims. Root must refresh the final record's artifact list and run graph validation after binding this review and before marking P04 done.

Reviewed supporting file hashes:

| Path under `execution/evidence/P04/` | SHA-256 |
| --- | --- |
| `acceptance-2026-09-14.md` | `e8a8107ef1a2fb391ca9ea7111587e769b090bf440dc2e47aabae4d958cbdf0b` |
| `review-2026-09-14.md` | `eb8d0c6edc836aeae3c4f87d6ac1297edbe5bcf2282af079b5b2ae899811ffc1` |
| `post-reboot-contract-report-20260914.md` | `450eded5390da49d572d56609f4aabd66a802d162c05369c2f9093c7686fb77f` |
| `post-reboot-contract-results-20260914.json` | `edfee107af8d8a00d8c51a4c89e7a3301b6e8c878d7489c5c5401d5754bf25d7` |
| `post-reboot-contract-comparison-20260914.json` | `351547d7ae0b689f150428dcbb64f07df6ddaade7abe0a3bd478a455c210787c` |
| `source-verified-2026-09-14.json` | `7b51eb07c4597b48072c0295d46930d766dd569b2626e8aea86b278e954bd24d` |

This review is source-bound internal acceptance reconciliation only; it provides no new test execution, deployment or cryptographic assurance.
