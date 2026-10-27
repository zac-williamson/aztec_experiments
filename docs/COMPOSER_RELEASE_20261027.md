# Composer, credit and likes release — 27 October 2026

Status: source051a530c is published across UI, core, prover and Bok. All nine services are active; Bok reports ready. Real-network feature acceptance is in progress. The performance goal remains paused.

## Changes

- The composer has a filling budget ring and an exact whole-character overflow count. Its existing 992-byte UTF-8 contract limit is respected for emoji and combining characters.
- Add post creates another editor and carries overflow into it. Post all submits one atomic `post_thread` transaction: up to four ordinary posts, or three posts with one Bok request. It updates the deposit once and preserves per-post moderation/cooldown accounting.
- Posting credit and Add credit appear beside the posting-name selector. ETH and USDC purchases use the same funding router as signup; USDC uses the existing relay. There is no standalone BokCreditRouter or Pause checks button.
- A name can include an optional avatar in one ordered transaction.
- Likes are explicitly one per account per post. Liked is disabled; Unlike is removed. Duplicate checks run before payment. Inclusion appears immediately, and checkpoint status updates independently.
- Like hydration fetches public, paginated post tags from the persistent server index and matches them locally. No wallet address, secret-derived tag or storage slot is sent in these requests. Hydration does not hold the wallet operation queue. Feed changes invalidate caches; receipt-backed state wins over older reads.

## Verification so far

- Native thread contract built and 22 focused native contract cases passed, including four-post admission/history and invalid later-item rejection. Failed transaction rollback was not separately observed in a live chain yet.
- Native thread/name-avatar ABI and application checks passed.
- Funding component checks:406 aggregate wallet/recovery,30 relay,42 Solidity and9 wallet-config checks passed.
- Integrated model, thread, like helper, worker and composer:224 tests passed; the final composer race patch passed all194 composer tests.
- Six focused browser checks passed for the character meter, thread composer, name/avatar and visible ETH/USDC posting-credit controls.
- Public like endpoint:15 focused checks plus4 budget/endpoint checks passed. Local indexed reads, exact-publication pagination and reorganization invalidation exercised.
- Independent reviews rejected the original personalized RPC lookup design and identified the stale hydration race; both were corrected before integration.

Final Board class is `0x03c9bf685f78a9b8731b010884f7728f552cd3c59fe169c2e3e7ee302cc17088`. The final processed artifact SHA256 is `4de9f9202ff4952eb99a0767cae17c8ad41e5d36e045e620d4b3a0190c5b8b28`. Rebuilding without an unused retired source changed JSON metadata from the earlier65d4982c artifact, not the contract class. Ordinary/like gas qualification remains bound to that class.

## Privacy limits

The public LikeChanged event exposes the post, a per-post secret-derived tag, active state and count. Repeated reactions on the same post are linkable; different posts use different tags. There is no direct Ethereum address or common account identifier in this event. Timing and network/provider metadata can still correlate activity. This is not a claim of complete untraceability.

## Remaining acceptance

The coherent Board/Bok/portal/router and browser/backend release is published. Exercise the owned test fixture: fresh posting setup, ETH and USDC credit top-ups, name+avatar, atomic thread and Like/repeat/reload. Record actual receipts, rendered results and service health. Local test results are not substituted for these checks.

## Deployment activation correction

The earlier portal unnecessarily required an epoch-proven Ready message. On this testnet release, the immutable deployment operator activates the portal after verifying the Board binding at a canonical checkpoint. The Solidity entrypoint is `activate()`; it has no epoch or membership-path arguments. Activation is restricted to the original chain and Sepolia/local test networks. User withdrawals and refunds still require their normal Outbox proofs.

The correction passed64 focused Solidity checks and208 integrated activation, deployment-journal, runtime, browser-connection and monitor checks. Canonical contracts, SDK, PrivateBok and application builds succeeded. The Board artifact and class are unchanged. The earlier f419 contract deployment was never published and is superseded; the corrected coherent deployment is now live. Live feature acceptance remains in progress.

## Actual activation and first browser result

Board `0x0a7f5a7759e057b620ddaa331f38db3e9a80ac2e57620f38504ded2ba0e8e351` bound portal `0xb3244958333e5c4eaa8a8de3ae1e9f04c748f266` in transaction `0x15fcddd64cc0946ee2d217190faaba8d3dbbfbc84b46b0e896eb7619fdd4ae35`, block8262. The canonical checkpoint was observed at2026-10-27T21:40:03+05:30; operator activation was observed at21:40:19:16seconds later. No epoch proof was requested. The single funding router is `0x0d19f70fe4d309b84907ef3b2d875f9ff3fc61df`.

Fresh browser signup exposed copied release fee-price ceilings: L2 cap2129014393943 was below observed network minimum9490854400000. This is a per-gas price mismatch, not excess signup gas or a contract activation failure. No payment was sent. Registration capture now rejects underpriced releases; the static publisher permits an exact wallet override changing only fee-price ceilings, with matching regenerated registration and manifest. All contracts, credential/provider fields and gas limits remain unchanged. The revised L2 ceiling18981708800000 is twice that observed minimum. It is a maximum reservation price, not the amount actually charged. Live quote validation is still pending this narrow publication.30 publisher checks and194 composer checks pass.
