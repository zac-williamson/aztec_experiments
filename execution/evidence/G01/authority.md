# Draft 3 authority and scope

The 11 October 2026 direct implementation mandate supersedes older restrictions on architecture replacement, isolated worker implementation, development pushes/integration and paid infrastructure within cumulative USD300. Existing release gates and platform permissions remain. Root owns this integration checkout; workers use separate branches/checkouts and declared nonoverlapping paths. Only root changes task ownership or advances integration.

Read all 11 PDF pages, including tables and final defaults, both extracted text and rendered pages. Source hash is in graph.json. Eight-week schedule and USD15000 commercial target are context, not hiring/spending authority. Proposed defaults are reversible design choices, not waived mandatory requirements. USDC route impossibility/target-wallet limits require concrete owner disposition; audit/network/soak gates cannot be self-certified.

Existing workflow .github/workflows/build.yml runs builds/tests with read-only contents permission; no release/deploy job found. Use codex/rolling-chat-draft3 integration branch while checking remote branch protections before any push or PR. Starting checkout clean at 458724c. Preserve other listed worktrees.
