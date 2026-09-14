# C02 history tests: second unapplied tranche

`history-tests-draft.patch` SHA-256 `ccaeb7a03f24e03006d4d917bc3920e9a549a892f3e5872d019fe30da351d553`. Apply **after** `tests-draft.patch` (`1f65722feb5bb8e4bc99ee5b915b31ebfefdad161be592d9efa17a04273897a3`). It changes only the proposed new `billboard/billboard_test/src/c02.nr`; its expected base content hash is `bbf6eeec3ea68e5bef9f36a545f5a5eab78892ede4fcd5ab34fed470b252a45c`. Neither patch is applied. Static diff hunk counts were checked; no Noir compilation, TXE, actual proof, or patch application was run.

Eight additional proposed tests, bringing both tranches to21:

| Tests | Actual fixture and expected outcome |
|---|---|
| Separate receipts, positive | Existing first claim/post, then a second correctly scoped TXE L1 message and actual `claim_deposit` under the same author but a different L1 depositor. Post on each distinct private chain; each own included hint advances only its selected right. Compare the other chain's entire eleven-field state before/after. |
| Separate receipts, two negatives | Both PostNotes are actually included and both owned by the same author. Swap their history in each direction; require exact `C02 wrong chain`. The second-chain attempt waits until that right is otherwise eligible, avoiding a cooldown failure masking the boundary. |
| Old cycle, positive | Actual first post, mature screening via dummy, wait actual nextAllowedTime, call actual private `withdraw`, require empty old logical view/discovery. Claim new nonce2 under the same L1 depositor and author, post new history and screen its own included note. Old right remains absent. |
| Old cycle, negative | Repeat the same fixture but pass the old PostNote into new-chain screening. Explicitly prove the old PostNote still exists in the actual note tree after its deposit right has been burned. Require exact `C02 wrong chain`, not membership absence. |
| Future child time | Insert an actual included PostNote with future anchorTimestamp, using the first tranche's fixture/discovery helper. Membership succeeds, then `Billboard.post` must reject `C02 future timestamp` before head consistency is considered. |
| Grandchild sequence/time, two negatives | Two real posts under a2x deposit preserve a legitimate unscreened child and head2. Create an actual included replacement grandchild with either sequence3 or timestamp before the child, retaining other content. Require exact `C02 grandchild sequence` or `C02 reversed timestamps`; root draft checks these before the fresh-randomness head mismatch. |

`claim_receipt` calls production `get_deposit_msg_hash`/`deposit_chain_id`, `env.send_l1_to_l2_message`, and the actual contract `claim_deposit`; it asserts receipt nonce, amount, depositor and empty initial history. It does not insert DepositNotes directly or copy the contract's authorization validator. Different depositors allow the two simultaneous L1 receipt identities without violating the portal's one-active-receipt-per-L1-depositor rule.

**Old-cycle limitation:** this is a real TXE private claim/post/screen/burn sequence using the current inherited cooldown/penalty semantics, followed by a correctly constructed new TXE message. It does not execute an L1 refund, genuine covering epoch proof or actual portal redeposit authorizing nonce2. Those cannot be inferred from `send_l1_to_l2_message`; full post/withdraw/redeposit bridge and penalty-survival qualification still requires the genuine flow and C05. The separate positive new-cycle case establishes that merely retaining old historical PostNotes does not prevent correct new-chain screening.

All metadata/time fabrications use the earlier explicitly test-only note-issuance context, actual discovery and actual membership check. They are not assertions that production exposes arbitrary minting. Expected application guards deliberately differ from setup/membership/clock errors. A compile/API or unexpected predicate failure must remain a failure for correction after source freeze, not be accepted by broadening the expected error.

No application sources, running scripts, generated artifacts or graph state changed. Remaining work includes compilation, positive/negative execution, source-bound results and genuine proof qualification;21 authored tests do not mean21 passing tests or completed C02.
