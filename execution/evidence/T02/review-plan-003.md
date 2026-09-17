# T02 independent harness review and redeposit plan

Read-only source review, 2026-09-17. This note records inspected integration and proposed work; it is not execution evidence. No application or harness edits, builds, or proving runs were performed for this review.

## Current journey integration

Reviewed `scripts/test-c01-application.mjs`, `c01-real-node.mjs`, `c01-bridge-flow.mjs`, `t02-screening-journey.mjs`, `prove-application-action.mjs`, `c01-deposit-flow.mjs`, `c01-exit-flow.mjs`, `c01-withdraw-l1.mjs`, `w01-private-fee-flow.mjs`, and the portal/installed Outbox source.

No concrete branch, profile, fingerprint, or resource-budget defect was identified in the current integration:

- Strict flagged/unflagged flags imply private fees, bridge, settlement and genuine application proving. They do not select the posting-only or screening-only early-return branches. The bridge rejects contradictory journey combinations.
- The new screening helper is fingerprinted. The existing 540-second aggregate deadline, 2 GiB memory bound and one-thread application profile remain unchanged.
- The author is the fresh W01 private-fee account; the authorized moderator is the distinct genesis-funded deployment account. The moderator intentionally pays its own public fee. Author cold-start credit is claimed with collateral claiming; no extra standalone fee proof is selected.
- `proveApplicationAction` checks the actual proven fee payer for author post/screen and moderator flag transactions. Final fee reconciliation includes claim, post, screen and exit fees, excluding moderator public fees. Maximum private credit allocation and actual protocol fee accounting remain distinct.
- The explicit latest-note exit state avoids treating a posted deposit as an original unposted claim. Original collateral receipt fields are preserved.
- Negative withdrawal probes compensate unsubmitted private fee allocation and require the expected rejection plus unchanged note state. Their defensible description is constraint execution rejection with no completed proof or submission, not a guarantee that no proving-related computation began.

Submit the moderator flag before expensive adverse probes: its inclusion must precede the actual public post deadline, which is based on public publication time. Keep all workload serial and retain existing bounds. Any timing prediction remains a planning estimate until measured.

## Minimal redeposit integration

1. In `withdrawC01L1`, retain a nonenumerable test-only replay descriptor containing copied withdrawal arguments `[epoch, checkpointCount, leafIndex, siblingPath]`, portal address, depositor, original receipt nonce/amount and expected exit leaf. Do not serialize secrets or this descriptor into evidence.
2. After first exit settlement and refund, enter a second `withC01ClientMining` scope. Reuse the same author/private-fee closure and original board activation inputs. Call `depositAndClaimC01` again; assert the same portal, depositor and amount, nonce exactly previous nonce plus one, and a distinct private deposit chain and claim transaction.
3. Add an optional prior-claim test input to the deposit helper. After the fresh claim is synced, construct a fresh account execution request for the original claim arguments. Retain the original Inbox index nonenumerably, or recover it from original message membership. Verify original Inbox leaf persistence and original message nullifier membership, then require the exact consumed-message rejection. Check that the fresh logical/physical note, transaction attribution and nullifier remain unchanged and the old chain remains inactive. Reuse the existing plain-account replay request pattern rather than allocating a new private fee action.
4. With a fresh active L1 receipt, simulate the original withdrawal arguments from the same depositor against the same portal. Require the precise decoded `Outbox__AlreadyNullified` error and unchanged receipt, total escrow and portal balance.
5. Prove/include a fresh no-post exit using the fresh claim. Do not carry the first journey's `exitState` into this call. Leave client mining before controlled settlement, then perform a genuine second L1 withdrawal. This verifies the new receipt remains usable after the rejected old operations.
6. Reconcile private fees across both claims/exits and any first-journey author post/screen transactions. Reuse the same funding lifecycle and close it once. If additional genuine proofs do not fit the existing bound, use a separate bounded redeposit profile rather than increasing the deadline or memory allowance.

## Important limit of old-exit replay evidence

The pinned installed `node_modules/@aztec/l1-artifacts/l1-contracts/src/core/messagebridge/Outbox.sol` checks whether the leaf identifier is already consumed at line 161, before computing/verifying message membership at lines 163–165. Therefore, replaying the already withdrawn exit against a fresh receipt should fail with `Outbox__AlreadyNullified`. This proves a consumed old exit cannot withdraw the fresh receipt; it does **not** independently prove nonce/content binding, because membership is never reached.

A separate cheap adverse probe can mutate one sibling of the genuine, still-unconsumed witness before the first valid withdrawal. Require the decoded `MerkleLib__InvalidRoot` error and unchanged escrow, then use the untouched witness for the valid withdrawal. Include the installed Outbox error ABI when decoding bubbled custom errors; do not accept arbitrary revert/fetch failures.

## Other narrow adverse probes and limits

- Wrong deposit-chain withdrawal: require the exact missing-note error and unchanged valid note. This tests note selection, not arbitrary forged-note acceptance.
- Wrong claim receipt amount/nonce/secret: an expected missing-message failure tests message lookup rejection. It is not equivalent to a forged authenticated membership proof.
- Wrong portal is not an argument to `claim_deposit`; the board's portal binding is fixed. Changing a JavaScript scope/hash helper alone cannot establish actual wrong-portal claim rejection. A genuine cross-portal case requires an actual differently scoped message/setup, or must remain explicitly labelled commitment-unit evidence.
- Existing consumed-claim replay already checks a genuine original Inbox leaf and nullifier. Extend it across receipt generations rather than duplicating an identical immediate replay check.
