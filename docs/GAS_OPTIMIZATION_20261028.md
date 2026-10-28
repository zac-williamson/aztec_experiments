# Posting gas: measured reductions, 28 October 2026

The changes are implemented and native-VM tested on the integration branch. They are **not yet active on the website**. Operations owns the current live acceptance window. The refund setting can be published without changing contracts; the public execution changes require deployment of the newly compiled Board and coherent runtime/prover registration. Do not label calculated fees as new live receipts.

## Exact baseline and result

The baseline is transaction `0x2df477ea40f8cf26a37c24ed8880c62d9e8841177389ee715bb59590595e8024`, block 9466. Its message is **29 bytes**, not the 27 bytes stated earlier. The later message is 44 bytes, not 42. Those prose mistakes do not change the receipt fees or gas calculation.

The block charged 0.0000012500002 FEE per L2 gas unit, zero priority fee and zero separately priced DA gas. The FPC adds no surcharge. L1 data costs contribute to the network's L2 unit price even though the separate DA dimension is priced at zero.

| Component | Existing gas | Optimized gas | Existing FEE | Calculated optimized FEE |
| --- | ---: | ---: | ---: | ---: |
| Private execution and protocol overhead | 746,750 | 746,750 | 0.9334376493500 | 0.9334376493500 |
| Public execution | 1,241,359 | 482,531 | 1.5516989982718 | 0.6031638465062 |
| Charged refund allocation | 817,500 | 40,000 | 1.0218751635000 | 0.0500000080000 |
| Total | 2,805,609 | 1,269,281 | 3.5070118111218 | 1.5866015038562 |

This is a **54.76% calculated total reduction** at the same network price and private execution cost. The public measurements come from actual compiled native AVM execution. All14 private circuit bytecodes and verification keys are byte-identical, so work was not shifted into new private code. A new included end-to-end transaction is still required to establish the full live result; account state and network prices can vary.

## Why it was expensive

1. **Refund over-allocation:** the paid-tip FPC release used the configured SDK default instead of qualifying its new refund function. 817,500 is 6,540,000 / 8. Aztec bills this allocation in full. Current `_complete_refund` actually uses 30,336 L2 gas/320 DA for positive refunds, or 9,345/288 for zero refunds. 40,000 L2/512 DA leaves 31.9% / 60% headroom over the observed maxima, reducing the billed refund component 95.1%. No FPC contract change is needed.
2. **Duplicated validation:** private posting already constrains the exact draft, including UTF-8, length and zero padding. Its authenticated `only_self` public continuation repeated those checks across 992 bytes of capacity. Removing that repetition saves 626,784 gas on this message. All three enqueue paths validate privately; mutable policy, parent/reference, name and subboard checks remain public.
3. **Unnecessary initial storage writes:** the anonymous root post wrote zero into four fresh fields. Fresh slots already read as zero. The helper now writes nonzero fields using the same typed packed layout. Both publication paths require an unused post ID; neither records nor the existence flag can be cleared. This saves 132,044 net gas and 256 DA gas on the example. A fully populated named subboard reply/quote adds 687 gas of branch overhead, while retaining the larger validation saving.
4. **Required storage and protocol work:** the old public path had 14 application storage writes, whose SSTORE base cost alone is463,960 gas. The optimized root path has 10, costing331,400 before slot hashing/control. Its remaining 151,131 public gas covers reads, hashes, dispatch, logs and control. These storage figures are source-derived opcode costs, not a per-op trace. Within the private/protocol row, 540,000 gas is the protocol's public-transaction overhead and 206,750 is additional private metering.

The implemented changes make a roughly 55% total saving feasible. Another 90% cut cannot be obtained by trimming validation or refund code: the fixed public-transaction overhead alone costs 0.675000108 FEE at this block's price. Further material reductions would require reducing stored state or amortizing overhead across multiple actions, with their functional consequences assessed explicitly.

## Scope and verification

- Native FPC test: nine valid branches and five rejection cases, including ordinary/mint refunds, successful/reverted tip principal, exact-fee zero refunds, numeric boundaries, authorization, under-reservation and insufficient gas. Exact refund log, unique note hash and value conservation checked. The function has bounded work, no loops/external calls, and at most one output note. Whole transaction rollback remains covered by the separate native paid-like integration evidence.
- Native Board test: 29-byte and 22-byte messages, 992-byte ASCII and UTF-8, anonymous roots and fully populated named subboard reply/quotes. All seven record fields read back correctly. Foreign calls, duplicate IDs, changed policy and missing/removed parent or missing/rejected subboard are rejected. Plugin reply record readback also passes.
- Public gas: 29-byte root 1,241,359→482,531 (61.1% less); 992-byte UTF-8 root 1,862,050→482,531 (74.1% less). Fully populated named reply/quote 1,283,929→648,091 (49.5% less).
- Private circuitry/VKs unchanged; public ABI/storage layout unchanged. Normalized compiled source verified against every embedded source. Existing SDK reused and verified. Canonical application build passes. Independent source reviewers approved both contract changes and the refund bound.
- No UI changes, transaction replays, new payments or live service changes were made for this investigation. The older latency campaign remains paused.

Evidence: `execution/evidence/G21/stable6/gas-optimization/`. Regressions: `scripts/private-credit-refund-gas.test.mjs` and `scripts/rolling-post-gas.test.mjs`, run by CI after rebuilding artifacts. The intended canonical runtime allocation is recorded in `billboard/private_fee_contract/refund-gas.json`; that file alone does not alter the live runtime.
