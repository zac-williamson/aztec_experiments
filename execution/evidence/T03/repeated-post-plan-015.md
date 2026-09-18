# Minimal repeated/cross-author posting observation

Read-only plan, 2026-09-18. No implementation, network calls or heavy tests. Lifecycle022 establishes four canonical application transactions for one author/one post; it does not supply repeated-post or cross-author comparisons.

## Exact reuse and seams

Use the existing explicit `private-fee-post` scenario as the baseline. Add one named scenario to `scripts/testing/scenarios.mjs` and its flow to `scenario-flows.mjs`, reusing `withActivatedBoard`, private fee preparation and genuine collateral claims. Call a sequential post helper after each claim and finish before exit/refund; do not add a branch to the retired monolithic runner. Collateral activation is genuinely necessary for real deposits here; no network epoch proving is necessary. Retain existing controlled application-message settlement only where the current Ready fixture requires it.

Do not call `proveAndIncludeC03Contention` repeatedly unchanged: it requires a fresh unposted board (`get_post_count()==0`), exact initial claim logical fields, and one or ten distinct authors. It is a concurrency fixture, not a sequential post driver. Reuse its actual prove/include/check primitives in a narrow helper whose explicit inputs include the expected current public count and actual current private deposit note. Alternatively use the note-chain/eligibility helpers in `t02-screening-journey.mjs` without its flag/screen/exit scenario. Do not relax the old concurrency assertions globally.

Retain actual Tx/TxEffect objects at inclusion and call `classifyT03PublicFootprint` with author, otherAuthor, sharedPayer, board, moderator and distinct funder roles. Its current classifier returns exact-role equality only; add a bounded in-memory pair comparison for non-padding delivery tags, note commitments and nullifiers, retaining only fixed equality counts/categories. Do not serialize private notes, raw request bodies or unconstrained blobs. Existing RPC observer can remain optional: native posting transport evidence is not browser RPC qualification.

## Smallest genuine sequence

1. A claims real collateral using A's production private-fee flow, then posts A1.
2. Wait only for A's actual nextAllowedTime at a canonical wallet anchor using the ordinary empty-checkpoint configuration scope; restore configuration afterward. Read A's current note/nullifier and prove/include A2. Verify the new note chain and unique public post identity/content, not just transaction count.
3. Prepare B with `prepareW01PrivateFees` in a separate owner directory; this intentionally generates a fresh application-compatible account and owner-bound funding/payment closure. Claim B's real collateral and include B1 on the same board and same deterministic FPC. Do not reuse A's closure for B.

The existing `c01-deposit-flow.mjs` uses `l1Client.account` as depositor and requires no existing receipt. Supply separate disposable L1 clients for A and B, each funded by the existing local operator, rather than the default sequencer/operator client. Construct these clients against the already owned Anvil with the pinned viem APIs. Assert A depositor, B depositor and sequencer coinbase identities are distinct. `bridgePrivateFeeCredit` already generates an independent fee-funding sender internally; its current observation records only independent-sender boolean. If fee-funder role attribution is required, expose that disposable address as a nonenumerable in-memory return field and prove it differs from coinbase; do not guess it from operator identity. Public fee funding remains observable even with this separation.

Use each owner's normal maximum-fee accounting, zero public author FeeJuice balance and shared payer verification. Close wallets serially where possible. Keep a single canonical board and FPC for the cross-author comparison; different fixture runs cannot establish that same-board comparison merely because the FPC derivation is deterministic.

## Budget strategy

The dedicated sequence needs two collateral claims and three ordinary posts, plus the existing minimal setup; it omits lifecycle screening, exit/refund and browser restarts. Run under unchanged540second/2GiB supervision, serial proof generation and owned cleanup. Do not append these actions to lifecycle022, which already used483244ms. Before live execution, inspect actual producer/consumer structures with cheap tests and bind source hashes.

If the combined profile cannot fit, first qualify A1/A2 in a smaller bounded profile to advance repeated-author evidence. A separate A1/B1 profile can qualify same-board cross-author evidence. Each profile must contain its own directly compared pair; comparing report summaries across separately deployed boards is weaker and must not silently replace the requested test. No retained cross-run private fixture or additional service is needed.

## Claims and remaining limits

Require canonical inclusion, exactly the intended posts, correct private note consumption, exact per-owner debit and shared payer. Compare known-role public fields and repeated non-padding fields with explicit semantic interpretation: shared contract addresses/protocol constants are expected; an unexplained author-specific recurring identifier is a finding, not automatically an anonymity break. Nullifiers should not recur in accepted transactions. Delivery-tag comparisons are observations, not proofs about derived-tag security.

This can close the missing measured repeated/cross-author scenario while leaving cryptographic unlinkability to independent review. It cannot eliminate public collateral/fee funding sender, amount or timing correlation, content identity, small anonymity sets, RPC account lookup, network metadata or global observer correlation. T03-A01 is not waived or redefined: literal absence of all funding correlation remains incompatible with these admitted public bookends. Preserve `remaining-observations-013.md` and `lifecycle-observations-014.md` limits and reuse historical genuine W01 funding evidence only for its recorded scope.
