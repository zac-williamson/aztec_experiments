# P04 closure review after reboot — pending qualification

Read-only delegated review on 2026-09-14 by `/root/artifact_regressions`. This review rechecked local source and evidence identity; it did not launch a build, browser, compiler, container, proof, transaction or network request. Root owns final acceptance. The separate browser lane has since completed successfully; the focused native fixture/serial contract lane remains pending.

## Source continuity

The current complete application inventory has **268 entries** and fingerprint `750cb4c1df4c99b7140e252bf987b66ac39ced85ee48632d8c1f6e74e4b103cc`, exactly matching `source-derived-crs-candidate.json`. There are no changed, added or removed inventory entries. The existing intentional deletion markers remain part of that same fingerprint. Current git revision is `5432fc66da048e87cc9d7050c92d75d6d7ae0c19`; this review does not create a commit.

All **147** inputs in `clean-linux-retry3-final-attestation.json` still match, as do both internal censor engine/cache symlinks. Recorded source maps in `storage-source-hashes.json`, `cli-sdk-smoke.json` and `handshake-consistency.json` have no drift. The reboot does not invalidate those content-bound observations or require another reproducibility build by itself. Source continuity does not turn an incomplete runtime check into a pass.

Read-only graph validation reported **35 packages, 138 criteria valid**. Ready-work selection still reported no ready internal work, consistent with the unresolved P04 gate at observation. These command results are not P04 acceptance.

## Frozen specification and fixture binding

All four current source files match the copies and hashes in `frozen-interface-inputs.json` byte for byte. The application fingerprint excludes `execution/`, so the final record must explicitly include the inventory and actual copied files. Hashes are:

| Frozen evidence path under `execution/evidence/P04/` | SHA-256 |
| --- | --- |
| `frozen-interfaces/interface-spec.md` | `e3ed67c6cba40ba481fa40e691b0b79c8c3462fdc4c50ff03173d665e334be57` |
| `frozen-interfaces/service-interface-spec.md` | `d99518d53ca78e508ce041f054f7be9f065275ccbf8ee99857e5dca9583e2897` |
| `frozen-interfaces/interface-fixtures/service-v1.json` | `227e07da682a7fac808d9d5e509eca5654b2870a77a453458d9a8a30407de77a` |
| `frozen-interfaces/interface-fixtures/commitments-v1.json` | `e988b16a0bc12fc2ab6423b429cd7485f1b5174fc4ed09915314b6e6ce1f9b92` |

The old service-fixture hash in `config-scope-check.json` is a historical observation. Retain it unchanged; `post-freeze-cursor-delta.json`, `final-input-delta.json`, the integrated 69-case log and the frozen current fixture supply the final binding. This is already explained with both complete hashes in `closure-evidence-audit.md`.

## Prepared criterion/artifact handoff

`closure-after-reboot-draft.json` contains **53 existing artifacts with actual current SHA-256 hashes**, criterion-specific path lists and proposed precise summaries. Its top-level outcome and every criterion result are **pending**. It is deliberately not `execution/evidence/P04.json` and must not be renamed into a pass record without the missing observations and root review. The draft also preserves the full read-only source comparison results.

| Criterion | Evidence scope for final summary |
| --- | --- |
| A01 | Frozen wire types, domains, input order, proposed note layout/selectors and authorization bindings; JS/Noir/Solidity codec checks. No authenticated membership or real bridge execution claim. |
| A02 | Independent post identity/public order and per-deposit history are frozen design requirements with typed selector/schema controls. Real concurrent posting and authenticated history remain C02/C03/C04. |
| A03 | Shared versioned service fixtures and failure/retry semantics, actual SDK cursor/receipt distinctions and config-before-portal ordering. Runtime journals/services remain downstream. |
| A04 | Frozen unique exit, rights burn/refund and penalty/recovery constraints plus domain-separated transcripts. Actual debt/refund/rollback/proof execution remains C01/C05/C06 and later tests. |
| A05 | Matched pinned stack, source origins, selectors/canonical local checks and source-applicable builds/baselines. Genuine Linux 34-output match and 171 + 69 passed checks stand. Actual derived-CRS browser now passed; the complete focused native fixture/serial check disposition remains pending. |

## Observed passes versus remaining checks

The September12 Linux retry3 build independently regenerated all **34 whole outputs** from absent caches and matched the native reference exactly. Its guard stages passed **171/171** and **69/69**. The subsequent Noir interface fixture hit its existing 120-second inner deadline after **10 of 22 unique cases reported success**, with no assertion failure reported. Later Solidity/portal/CLI/full Noir stages were not run. Evidence extraction and owned-container cleanup succeeded. That is a successful reproducible build and an incomplete additional Linux test run.

The new `browser-after-reboot-2026-09-14` result, context, supervision and review were independently read and checked here. Both actual consumers passed with exactly 75,497,472 input bytes and 1,179,648 points, cross-origin isolation, workers and SQLite controls. Evaluations took 1,032 ms and 973 ms; the supervisor exited 0 in 5.838 seconds without a timeout. All 20 context hashes, all six result source hashes and every raw-file hash quoted in the browser review match current bytes. The unchanged harness records the actual SRS input call and asserts the provisioned representation; no compressed fallback is counted as a derived-path pass. Budgets remain 30 seconds navigation and 120 seconds evaluation. This closes this browser qualification, while retaining the earlier failed navigation as historical evidence. The contract lane must still report its complete focused fixture and serial check results. A successful native control may explain platform-specific limits but cannot rewrite the prior Linux attempt as passed. No blanket repeat of unaffected checks or additional interface implementation is identified here.

The post-reboot host observation is resource context only; it does not demonstrate a timeout cause or successful qualification. Current official compatibility guidance in the artifact list is the prior recorded primary-source assessment, not a fresh September14 network-clearance check. Package compatibility remains distinct from the X03 deployment-clearance gate.

Root's final assembly must add the remaining native check logs and review, reconcile the ledger/source hash, and refresh hashes for any artifact changed while these lanes run. The new `source-verified-2026-09-14.json` has the same complete file list/fingerprint as the frozen candidate and is now the draft's source inventory. The browser logs and review are already included with current hashes. If application inputs change, identify and rerun affected checks. Only then can root decide whether all P04 criteria support closure and create the actual acceptance record. The 26 compiler diagnostics, advisory remediation, real-proof journeys, external review and soak retain their assigned later gates.
