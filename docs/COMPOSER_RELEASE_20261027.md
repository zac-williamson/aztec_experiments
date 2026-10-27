# Composer, credit and likes release — 27 October 2026

Status: core/Bok051a530c, UIa54874c3 and prover63e4c1d3 are published. All nine services are active; Bok reports ready. Real-network feature acceptance is in progress. The performance goal remains paused.

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

The correction passed64 focused Solidity checks and208 integrated activation, deployment-journal, runtime, browser-connection and monitor checks. Canonical contracts, SDK, PrivateBok and application builds succeeded. The Board artifact and class are unchanged. The earlier f419 contract deployment was never published and is superseded; the corrected coherent deployment is now live. Live feature acceptance results are recorded below.

## Actual activation and first browser result

Board `0x0a7f5a7759e057b620ddaa331f38db3e9a80ac2e57620f38504ded2ba0e8e351` bound portal `0xb3244958333e5c4eaa8a8de3ae1e9f04c748f266` in transaction `0x15fcddd64cc0946ee2d217190faaba8d3dbbfbc84b46b0e896eb7619fdd4ae35`, block8262. The canonical checkpoint was observed at2026-10-27T21:40:03+05:30; operator activation was observed at21:40:19:16seconds later. No epoch proof was requested. The single funding router is `0x0d19f70fe4d309b84907ef3b2d875f9ff3fc61df`.

Fresh browser signup exposed copied release fee-price ceilings: L2 cap2129014393943 was below observed network minimum9490854400000. This is a per-gas price mismatch, not excess signup gas or a contract activation failure. No payment was sent. Registration capture now rejects underpriced releases; the static publisher permits an exact wallet override changing only fee-price ceilings, with matching regenerated registration and manifest. All contracts, credential/provider fields and gas limits remain unchanged. The revised L2 ceiling18981708800000 is twice that observed minimum. It is a maximum reservation price, not the amount actually charged. Live quote validation and signup subsequently succeeded.30 publisher checks and194 composer checks pass.

Browser acceptance after fee publication: fresh signup Ethereum transaction `0x4773af8c11ac281ea1e98b0e9e93f6ea9cfd9880d9ec9721837ef072f1149b4c` succeeded in block12006571; automatic Aztec claim completed and main UI showed262.1831postingcredit. NameMiraAshford plus testavatar succeeded in one application operation, leaving228.3641credit. The real two-post thread exposed omitted `post_thread` in the remote prover allowlist. No Aztec transaction was submitted by the failed proof jobs. The correction admits that exact entrypoint and retains conditional Bok capability checks on decoded invocation fields. Fifteen actual-artifact policy boundary tests pass, including rejected foreign addresses/networks, missing fee/signature and disabled-Bok invocation. Source-only prover63e4c1d3 was published and the saved unsigned thread subsequently succeeded.

Cleanup removed705.9MB duplicate local transfer archives,352.9MB core and353.0MB Bok transfer archives plus inactive unpacked payloads. Active releases, credentials, receipts and the single retained build remain.

## Live acceptance receipts

All checks used the owned Sepolia EIP1193 test wallet, not the MetaMask extension. These are functional checks, not renewed performance acceptance.

| Flow | Observed result |
| --- | --- |
| Fresh signup | ETH payment succeeded at block12006571, automatic Aztec claim completed, main credit262.1831. |
| Name and avatar | Mira Ashford and its avatar created together; both displayed on subsequent posts. |
| Character meter |1000ASCII characters showed8over against the992-byte limit and disabled submission. |
| Atomic Post all | Two linked posts included in one actual Aztec transaction; composer closed. |
| Like and reload | First post showed1like and disabled Liked; persisted after reload. No Unlike. |
| ETH credit topup | ETH payment succeeded, automatic Aztec claim completed, credit197.0188→439.375. |
| Nested thread | Parent/reply indentation, avatars and collapse/expand rendered correctly. |

Atomic thread transaction: `0x136493529594e2bfd3f980ac5f1327e3b1bd48cd20d2d1ee52ef3ec22fa76a3c`, block8343. Public indexed positions give the same transaction hash for both posts, log indices0and1. Root4706074044134498835243779331962118481151346886062010469552496750725017506240; reply9272342111101647626799484328476159758780473693800502216612566437032555308516.

ETH posting-credit payment: `0xbde822da142e6c7feb2f27c2862ac497b3c4ca2971f60069edf8f091602453f0`, Sepolia block12006697, receiptstatus1. The visible balance includes the Aztec claim fee.

USDC default248.280751104-credit quote failed before signing: direct USDC/FeeJuice pool held only198.304983454435289231FeeJuice. The WETH/FeeJuice route was independently replenished; that did not replenish the direct USDC route. Existing direct-pool replenishment and actual USDC acceptance remain in progress. No claim of complete payment coverage yet.

Deployment lessons: qualify each advertised payment route with its actual default amount; rebuilding source cannot establish swap inventory. Keep the remote prover action policy in sync with the actual contract entrypoints. Coordinated deployment must publish the same receipt-qualified current-prover monitor record as source-only deployment and restore it on rollback. The monitor mismatch was corrected against actual activation receipts, with full file qualification, without weakening supervision.

Final health check: all9services active, Bokready/active0/lastFailure null. Old transfer versions under the completed051a campaign S3prefix are absent. Current-release Bok request and actual MetaMask prompts have not been rerun in this acceptance pass.

USDC payment transaction `0xab2f2b94cffbeaaa4f91b4a149fb35394e9a8ce19298c11aaa88be4a4c9b13c3` succeeded in Sepolia block12006752. The100-credit purchase used one EIP712 signature and a relay-paid Ethereum transaction; the owned wallet did not send an Ethereum transaction. Its Aztec claim completed, but the subsequent balance refresh failed with nested `BB_TRUSTED_NODE_UNAVAILABLE`. UI incorrectly promoted that read failure into a payment failure. Reload independently showed529.2636credit, up from439.375. A narrow completion-display correction is being prepared; do not report this run as uninterrupted UI success.
