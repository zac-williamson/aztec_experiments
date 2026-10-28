# Compact post deployment — 29 October 2026

**Published and browser acceptance passed.** The app, SDK, prover, moderator and Bok now use the same fresh compact Board deployment. Source is pushed to `master` and the application integration branch.

Source: `48c2750f617b7e8b7c3ed1dbe73fb4263517daca`, integrating the compact-state optimization with current operations changes. Target remains Aztec 6.0.0 on Ethereum Sepolia 11155111, rollup version 679261766, rollup `0x1f435a7f2da358caf887a470faeee7d5d5f4efba`. No mainnet transactions were made.

| Component | Address |
| --- | --- |
| RollingBoard | `0x269bd57c385f1df1d652a0d0bb849cc7584b9a04083f0da4c65723c4a2a7ffd5` |
| PrivateFPC, reused unchanged | `0x2d71392cfb41aa25a62c5ecc510400167dda9f3669676d2b539413a4fa0bcbb7` |
| PrivateBok | `0x18eb9f9de94df31b450930e8b97c7f661cd69af7a992f1e076ec6c0d852208f7` |
| Posting deposit portal | `0xb1b393e696c1ceb744ad47325dd18e5c96f5c073` |
| Bok portal | `0x487dc0ac4984ef830307044bad577713bee62392` |
| Single funding router | `0x4036f93a035433b704fc60d52fdba4aa813ab2b3` |

Board class: `0x129f10e1a9e290654415f97ca5f082f143504ff1bc80bd26ed441f6bb738701f`.
Bok class: `0x0c59d24f902ce86319f91e15513e514e23b78b0b1685ca63812974df862f509e`.

Board deployment was included in block 9713, transaction `0x184e91da71a353d202883586b75eb490b9e306c621b6d6065663ad8f47558059`. Bok deployment was included in block 9716; Board registration in block 9721. Deployment scope was checked against canonical checkpoint 9723. The collateral portal report is active. Deployment activation uses the existing explicit testnet operator path, without waiting for an epoch proof.

The immutable Board/portal bindings require fresh Board, Bok, collateral portal, Bok portal and funding-router instances. The unchanged canonical FPC is reused. Fresh Board-scoped index, relay, moderator and Bok state replaces disposable old test state; no account/post migration is required. Infrastructure credentials and security controls remain retained.

Ordinary root-post storage writes fall from 10 to 2. Full messages and presentation records are authenticated events; message text is not written to contract storage. The private witness reader, moderator and withdrawal reader consume the new packed metadata; Bok and public feeds use event records. Browser SDK, registration, artifacts, prover scope and service configuration were published together.

Two native-development transactions measured **1,020,245 billed L2 gas / 4,064 DA gas** for a 29-byte post. Public posting execution was 211,720 L2 / 1,888 DA. These are development measurements, not receipts from this new live deployment. The published wallet configuration now reserves **40,000 L2 / 512 DA** for refund processing, versus the previous 817,500 L2 allowance. The maximum measured successful refund branch is 30,336 L2 / 320 DA under the pinned artifact/gas schedule; structural and native lifecycle qualification is documented in `docs/REFUND_GAS_BOUND_20261029.md`.

## Live browser acceptance

The fresh account completed one Ethereum payment and one combined Aztec claim. A 29-byte post, two 20-FEE self-tips and a 44-byte post then succeeded with native inclusion. The first post displayed 2 likes, and its author’s self-tip balance fell by exactly the two actual network fees. The following are real Sepolia/Aztec receipts:

| Action | Billed L2 gas | Actual FEE paid |
|---|---:|---:|
| signup-payment | 885,873 | 1.7545787557203 |
| first-post | 998,470 | 2.760553580939 |
| self-tip-1 | 891,942 | 2.4660267029454 |
| self-tip-2 | 891,942 | 2.4660267029454 |
| second-post | 1,051,045 | 2.9059120839665 |

Gas is derived exactly from each native receipt fee and its inclusion-block L2 price; DA and priority prices were zero. Receipts do not expose separate billed DA gas. The 29-byte post used 998,470 L2 gas, versus 2,805,609 in the earlier live baseline (64.41% lower). These are different account states and network conditions, not a matched-state benchmark.

Click-to-included-render was 84.668 seconds for the first post, including a native posting-readiness wait, and 15.231 seconds for the second. No latency-goal completion is claimed. Browser process-tree peak was 1.31 GiB.

## Operations handoff

The new runtime is accepted. Operations owns fresh sealing and stage/public-verifier rebinding before future automatic releases are enabled. Root does not restart the paused latency campaign.

Completed deployment checks:

- Matching prover, application, moderator and Bok activated; actual source/readiness checks passed.
- Public runtime exposes the new Board and 40,000/512 refund allowance; matching SDK/artifact checks passed.
- The bounded real-proof browser signup/post/tip/tip/post flow passed, including count 2 and exact self-tip balance conservation.
- Live actual gas/fees are recorded separately above.

Operations still must reseal the baseline before enabling subsequent source-only releases, so an old sealed configuration cannot restore the previous Board.

The completed smoke used an owned EIP1193 test adapter, not MetaMask-extension UI. It does not certify a distinct recipient's tip discovery or every application flow. The earlier latency campaign remains paused.

Public campaign evidence: `/private/tmp/rolling-compact-20261029/observations/deployment-scope.json`, `scope-observation.json`, and `wallet-public-fields.json`. Only selected public fields belong in committed evidence; private provider/configuration files do not.

## Testnet funding repair

Before any signup payment, the first attempt correctly refused an unaffordable quote: the existing WETH/FEE pool held only 265.3 FEE, almost exhausted by the default purchase. The existing canonical test faucet supplied 1,000 FEE; 100 owned test FEE were swapped for 0.019372783966660081 Sepolia ETH, and 800 FEE added as one-sided pool liquidity. No real funds or new token/router were used. The actual browser signup maximum became 0.046050597580844015 ETH. All maintenance receipts and the initial no-payment failure are recorded separately.

Evidence: `execution/evidence/G21/stable6/compact-post-deployment/{deployment,browser-acceptance,test-liquidity}.json`. Full exact-source CI run 40753383089 passed. Earlier projection-fixture failures remain documented separately; this does not claim every historical test passed.

Deployment-helper corrections: host role is selected from the observed service set, not an inherited inventory filename. Periodic monitor/snapshot jobs are checked by their unchanged service/timer definitions, while long-lived services retain exact process checks. A hash-verified delta transfer reduced the uploaded source package from 326 MB to 97 MB; unchanged files were reconstructed from the existing qualified release and fully verified before activation.
