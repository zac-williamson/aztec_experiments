# T03 remaining observations

Read-only evidence review, 2026-09-18. Application and harness inputs remain frozen during lifecycle attempt014. This note does not assert that attempt014 passed, close T03, or waive an acceptance criterion.

## Distinguish the two linkage questions

T03-A01 requires “No reusable public author fee-payer or funding linkage remains in the supported anonymous posting flow.” A stable author/funder identifier in public posting fields would directly undermine the intended shared-payer protection. Current exact-role classifiers inspect named public fields; they do not establish absence of derived reusable identifiers or cross-transaction linkability.

Separately, Ethereum funding and collateral disclose sender, amount and timing. A cold-start FeeJuice claim increases the public pooled balance and may correlate funding with the first action. Existing evidence explicitly admits this. If A01 is interpreted literally as forbidding every funding correlation, that requirement is not established and is incompatible with these observed public bookends. Final review must address the precise limitation; this note does not redefine A01 or silently mark it satisfied.

## Smallest additional genuine observation

After the full lifecycle result is assessed, extend a bounded existing posting profile to observe two ordinary posts by author A and one by author B against the same canonical FPC. Reuse setup where possible; split serial profiles if the unchanged resource/time budget requires it. Use an Ethereum funding identity distinct from the sequencer coinbase, avoiding the alias in browser044.

Compare actual public transaction/effect fields across the three posts in memory: canonical payer, exact known-role occurrences, non-padding nullifiers and delivery tags. Retain only fixed comparison classifications/counts, not raw private data. Confirm distinct posts and owners from independently verified private state. A repeated public value requires semantic attribution: shared contracts and protocol constants are expected; exact author/funder identities or an unexplained recurring author-specific tag require investigation. Absence of exact matches remains a limited observation, not a cryptographic unlinkability proof.

Attempt014 can separately qualify current neutral public-read routing and claim/post/screen/withdraw RPC/public footprints, if successful. It has one author/post and warm private fee credit; it cannot replace the repeated/cross-author comparison or cold-start browser recovery. Retain account-class author lookup and traversal truncation limitations in any summary.

## Reuse genuine funding evidence

- `execution/evidence/W01/application-e5037522-f109-4e35-87bd-c3fdcefe3b20.json`: genuine Ethereum funding through production funding/recovery helpers, cold-start board claim and subsequent post; canonical shared payer, zero author public FeeJuice balance and reconciled private/public fees.
- `execution/evidence/W01/application-0543b83b-7ca8-406c-890d-074c5ff17299.json`: genuine standalone funding, board claim, exit and L1 refund, with accounting checks.
- `execution/evidence/W01/private-fee-verification.md` and `execution/evidence/W01/private-fee-privacy.md`: source-bound historical scope, single deposit and public recovery observations, and explicit cold-start funding correlation limits.
- `execution/evidence/U01/application-ca483aad-49a1-49a3-99e8-4031d7415f71.json` and `execution/evidence/T03/observation-004.md`: historical genuine browser post, actual-state insufficient-credit rejection without submission, RPC observations and their known truncation/coinbase-alias limits.

These records support their recorded implementation and scenarios. Do not infer an unrecorded complete funding timeline, current-browser cold-start recovery, or cross-author privacy from them. Existing exhaustion observations plus current application-routing regressions avoid an additional successful proof solely to repeat the no-fallback check. Map the final privacy statement to these measured limits and retain independent cryptographic review obligations.
