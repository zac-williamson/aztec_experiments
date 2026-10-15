# Rolling Chat Draft 3 component boundaries

Design-stage contract, not acceptance evidence. Root owns this interface. Existing V6 admission, private fees, encrypted transaction journals and refunds are reusable; legacy public-account plugin escrow is not acceptable for anonymous invocations. Original prior source remains recoverable in Git; fresh contract deployment is permitted.

## Chain authority

One curated board binds protocol domain (Ethereum chain ID, Aztec rollup address/version, board contract). Public event IDs use domain plus canonical transaction hash and log ordinal. Index ingestion authenticates emitting contract and canonical block, records finalized/checkpointed status, and persists raw public logs with chain anchors. A client-provided JSON relationship is never an authenticated event.

Core records: subboard creation/slug/display metadata/local rules, main policy versions, moderator rejection/reason/post removal, immutable post content and canonical parent/root/quote/repost refs, registered-name canonical hash/display form, profile bio/current avatar hash/version/bytes, per-post like counts, and encrypted user preference records. Neither backend nor Bok is sole source of any core relationship. Names/likes/posts must authenticate private ownership without emitting the human account or a reusable anonymous author tag.

Public post shape: id, boardId, subboardId, parentId|null, rootId, kind(post|quote|repost|botReply), referencedPostId|null, identity(Anonymous|nameId|registeredBotId), contentUtf8, publishedAt, order, policyVersion, removal|null. Anonymous is the literal display label. A removed parent retains its ID/root/policy decision while ordinary reads omit content. Bot replies retain authenticated registeredBotId and invocation parent; public bot identity is explicitly allowed.

Storage constraints require measured design: current board writes32 message fields plus metadata per post; V6 allows63 public writes. Avatar data belongs in bounded authenticated public logs (8192bytes =>265packed31-byte fields plus metadata), with state only hash/current version. One log cannot contain arbitrary input; validate size/decoder/image metadata client-side before spending and constrain byte packing/hash in protocol. Current log aggregate4096fields and blob8475fields are structural ceilings, not gas or latency evidence.

## Public index API

GET /v1/scope identifies network/board/schema and observed finality. GET /v1/feed?cursor=&limit=, /v1/posts/:id, /v1/threads/:root?cursor=, /v1/subboards?query=&cursor=, /v1/profiles/:nameId?cursor= return public data plus canonical anchor, reproducible rank version and next opaque cursor. Limits <=100rows and bounded search length. Query parameters never include private account, list of owned names, bookmarks/follows, recovery secrets or proof witnesses.

No per-user server subscription in first release: download shared public event ranges, filter followed names/boards, derive notifications locally and decrypt preferences locally. Public profile/thread queries still reveal interest to backend; batched general feed retrieval avoids sending relationships but does not promise protection against arbitrary IP/timing correlation. Document and test exact traces. A cache hit cannot turn unknown chain status into final success. Reorg discards/replays affected suffix from authenticated retained archive.

## Wallet application port

readAccountStatus() returns local private readiness; ownedIdentities() never calls the cache API with the name list. prepare(action) validates size, policy, chain, funds and capability before intent persistence; submitPrepared(intentId) uses exact journalled action; reconcile(intentId) reads canonical effects and never treats missing receipt as absence. Actions cover funding, identity/profile, subboard, posts/social, encrypted preferences and withdrawals. Signing/proof generation stays in trusted wallet context; remote prover receives private witnesses under declared trust. No public-fee fallback.

Aggregate funding has collateral, private transaction-fee and private Bok-credit allocations. Ethereum funding can be atomic only for its own contracts; subsequent claims remain asynchronous. ETH-origin conversion and USDC-only gas require measured named-wallet capability before funds. A route that cannot meet the requirement is an owner decision with evidence, not a silently disabled feature. G14 privately funded one-use invocation budget must be established before G04 accepts the route.

## Bok port

Core emits authenticated request/post/thread linkage and private-budget authorization, not human account identity. Plugin decides provider/model, summaries, quotas and workspace strategy. Public plugin identity can sign replies. Hosted execution reads full canonical thread context and records invocation read/produced repository revisions; same-thread writes serialize, independent thread workspaces isolate. Model code receives no developer credentials or general signing/hosting/repository-admin capabilities.

External model calls cannot be atomic with chain settlement. Journal intent before paid call; unknown charged outcome fences replay until explicit reconciliation/expiry. Reserve liability before inference, then charge measured costs and privately return unused budget. Funding uses a fresh recipient commitment in public portal data. Waiting request escrow cannot pay the operator until authenticated board activation. Expiry releases unreserved credit while an unresolved reservation remains fenced until receipt reconciliation; it never treats unknown spending as free. Dedicated GitHub App broker provisions repositories outside model tools; source/artifacts/summaries backed up separately. Static publication swaps complete revision manifests at a stable separate-origin latest URL; download binds to that same deployed revision.

## Acceptance boundary

Fixture prototype verifies design and accessible navigation only. G08 requires real contract+wallet vertical flow; G13 reconciles all requirements with real proofs, traces, clean rebuilds and exact accounting. Production audit, elapsed14-day soak and current network clearance remain separate. No assumed protocol guarantee is accepted because this document describes it.
