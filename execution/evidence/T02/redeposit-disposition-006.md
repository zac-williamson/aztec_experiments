# Genuine redeposit006

PASS application-b6698c24-7c15-4035-81cd-b3af28f32dc8.json:442386ms,1629568KiB sampled aggregate peak, full cleanup. Two genuine private-fee claim/exit cycles and actual L1 refunds on the same author/depositor completed. Fresh nonce incremented and chain differed. Consumed old claim rejected during witness generation; consumed old exit rejected with exact Outbox__AlreadyNullified. Fresh note, receipt, liability and portal balance remained unchanged. Both actual unconsumed exit witnesses rejected a changed sibling with MerkleLib__InvalidRoot before successful normal withdrawal.

The consumed-exit check establishes replay protection, not independent receipt-nonce binding: the pinned Outbox checks consumption before membership. All proofs/node verification normal; official test-controlled settlement only. No public-testnet/browser or external-review claim.
