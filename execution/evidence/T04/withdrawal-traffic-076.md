# Withdrawal across another author's publication

Source-bound application-636b16db-874b-4e56-9e61-3b294c0c72b1.json:
PASS315649ms, peak2160752KiB under4GiB, all process/directory cleanup passed.

Two distinct application authors use private fees and separate disposable L1
collateral accounts. Both fee bridges precede cold claims; their shared-pool
starting baseline is checked. A creates a genuine withdrawal proof, B publishes
an actual post, and A submits the original transaction with unchanged proof and
transaction hashes. Inclusion order is asserted. A's exact deposit nullifier
and expected exit message are checked, with no replacement active deposit.
B then publishes again from its exact previous state.

Both private credits reconcile against their own maximum-fee allocations.
Each pool assertion includes the other author's explicit net funding/fee change;
an independent aggregate assertion reconciles all five transaction fees. No pool
check is skipped. Both wallets are closed by their existing helper owner.

Independent reviewer application_change_review caught the portal's one-active-
collateral-deposit-per-L1-account rule before execution; root replaced the planned
shared collateral account with two disposable accounts. Final source and explicit
fee-accounting extension approved; harness tier076 passed.

Scope: sequential proofs with an intervening publication, not simultaneous
proving, L1 refund settlement, public funding unlinkability or1,000-post load.
The canonical L2 exit message is verified; L1 refund already has separate journey
coverage and is not claimed by this scenario.
