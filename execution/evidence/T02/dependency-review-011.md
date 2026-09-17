# Compiler diagnostic ownership and graph dependency review

Read-only graph/task review, 2026-09-17. This is a proposed ownership correction, not a waiver, graph mutation, new test result or independent security disposition.

## Dependency defect

Requiring completed independent compiler/security disposition before closing T02 or T03 creates an implicit scheduling cycle:

`T02 → T03 → R01 → X01 → independent disposition required by T02/T03`.

R01 also contains the same generic Work item4 wording. Requiring the independent review while preparing its own audit packet is circular even without T02/T03. X01 explicitly says an unavailable reviewer is an external dependency and unaffected internal work should continue. Its acceptance requires an actual qualified reviewer/report; an agent cannot satisfy it.

The correct split is **internal evidence and explicit unresolved obligations before review; authentic independent disposition at X01, remediation and final closure at R02/X02**. Internal completion must not be advertised as closure of compiler warnings or production readiness. The release dependency on X01/X02 remains intact.

## Concrete ownership proposal

| Owner | Required result |
|---|---|
| T02 | Source-bound genuine bridge/private-fee journeys and application adverse cases in A01–A03; precise public-testnet blocked disposition under A04; application-artifact/diagnostic reconciliation; each uncovered protocol/privacy case retained with owner and expected evidence. Do not require an external report as an input. |
| T03 | Measured author/fee/funding/RPC/frontend footprint, real recovery/exhaustion/fallback privacy behavior, delivery/tagging/randomness assumptions and relevant executable privacy regressions. Distinguish observed leak prevention from cryptographic privacy assumptions. Carry cross-circuit soundness items to X01 explicitly. |
| T04 | Real browser/device journeys, lifecycle interruption and note discovery/recovery, concurrency/load, fee exhaustion and availability failures. Preserve malicious/missing note-discovery concerns; do not relabel failed mandatory tests as external uncertainty. |
| R01 | Freeze and reconcile exact application plus installed/embedded protocol artifact inventory, diagnostic occurrence/site/caller map, internal results and explicit remaining uncertainties. Prepare a concrete reviewer test/scope matrix. Independent disposition is requested here, not claimed complete. No unexplained failing mandatory internal test is acceptable. |
| X01 | Qualified independent Aztec/Noir and Solidity assessment of every original/fresh diagnostic family, emitted protocol/kernel correspondence, request discharge, authorization and privacy assumptions. Actual identity, revision, methods and findings required. Reviewer-required hostile cases become explicit remediation work. |
| R02 / X02 | Implement/test findings and obtain authentic independent final-source/artifact closure. Unresolved critical/high defects or undispositioned residuals cannot be removed by an internal status change. |
| T05 | Refresh final emitted source/artifact/diagnostic correspondence and all internal acceptance evidence against the current candidate; verify external report applicability and linked closure without substituting self-review. Preserve current release gates. |

Suggested internal Work item4 wording: “Reconcile the original and fresh compiler diagnostic inventories against this package's source-bound application/artifact evidence; execute relevant in-scope adverse/privacy checks, and retain each uncovered obligation with an explicit later internal or independent-review owner. Preserve all 26 original occurrences at 12 sites and all 57 fresh occurrences at 18 sites. Independent disposition is obtained at X01 and final closure at X02; this package must not suppress diagnostics or claim they are resolved.”

R01's wording should instead require the complete unresolved inventory and concrete reviewer instructions. X01/T05 wording should keep their actual independent/final-candidate obligations. Change graph work descriptions and regenerate task documents; do not silently reinterpret identical text differently across packages.

## Remaining internal T02 checks versus external obligations

The completed flagged004 and redeposit006 profiles establish genuine private-fee lifecycle composition, actual refunds, state/accounting checks and precise replay/bad-Outbox-membership rejection. The unflagged/wrong-origin/absent-chain profile must have its finished passing report, exact positive control, source hashes and cleanup reviewed before its cases count. Source presence alone is insufficient.

After that success, **no additional failure of an explicit T02 A01–A03 criterion was identified**. A04 expressly permits a documented suitable-environment blocker. A full public deployment cannot be claimed, but lack of one need not block the next internal privacy work package under that criterion.

There are still concrete internal application-boundary diagnostic probes not covered by these journeys:

- An authentic L1 claim with supplied wrong index/content/secret; wrong sender and consumed-message lookup tests are different cases. Existing TXE cases must remain labelled TXE if reused in the coverage map.
- A malicious L1-to-L2 sibling/index/root witness at the constrained application boundary. Corrupted L2-to-L1 Outbox membership is not this test. Reuse a safe test-only oracle seam and a legitimate control if available; otherwise record the absent seam and exact missing evidence, not a pass.
- Any outstanding application-specific note membership mutations must be reconciled with T01's real authenticated-note probes before creating duplicates. T02 absent-chain selection does not establish rejection of invented authenticated notes.

These must not disappear into a generic “audit later” sentence. Assign each a stable coverage-register entry. If root regards these as mandatory T02 internal cases under the broad Work item4, implement them before T02 completion; alternatively explicitly scope a later internal diagnostic test package with a prerequisite into R01. Moving an unexecuted, specifically enumerated probe to a named internal package is transparent scheduling; moving a failed mandatory test or falsely recording coverage is not acceptable.

The following are legitimately broader protocol/independent-review obligations, with internal evidence support rather than claims of self-proven soundness: private-call return hashes/end counters/static mode, pending-versus-settled request routing and final discharge, initialization/class identity authorization across actual kernel artifacts, oracle key/instance preimages, emitted protocol source-to-artifact/verification-key identity and cryptographic entropy/privacy assumptions. X01 should specify targeted validation and findings; avoid building a network epoch prover as a surrogate.

Privacy-facing delivery behavior is **not exclusively external**: wrong/default tag sender, missing/duplicate/extreme indices, restart discovery, private-fee note ownership and fallback behavior belong in T03/T04's observable application tests. Independent review of entropy/AES/tagging assumptions remains additional to those tests.

## Guardrails for an acyclic completion decision

1. Preserve the original26 and fresh57 full inventories, call stacks, counts and hashes; zero warnings are closed by changing ownership.
2. Record the decision and exact remaining coverage rows/owners in graph evidence. A bare “X01 handles it” is insufficient.
3. Keep T03/T04 required internal failures blocking their package, and R01's no-unexplained-failure acceptance unchanged.
4. Keep X01/X02 incomplete until authentic independent reports exist, and retain public-network compatibility/clearance gates separately.
5. T02 may unlock internal work after its actual application acceptance passes and explicit ownership correction, without claiming that the release or compiler privacy review is complete.
