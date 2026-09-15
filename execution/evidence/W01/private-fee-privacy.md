# Private fee observations

This replaces an operated coupon service with a deterministic, ownerless private FeeJuice contract. There is no issuer API, registration worker, coupon database, admin key or operator replenishment requirement.

## What the passing local journey establishes

`application-e5037522-f109-4e35-87bd-c3fdcefe3b20.json` records a real Ethereum deposit from an independent disposable sender, production funding/recovery helper execution, a genuine cold-start board claim, and a subsequent genuine post. Both application transactions use the same canonical FPC as their public fee payer. The author's public FeeJuice balance remains zero. Private credit decreases by exactly the selected maximum fees; the public pool decreases by actual protocol fees. No network epoch proof was produced.

## Public observations

Ethereum exposes the funding sender, token amount, recipient FPC, secret hash and deposit timing. The cold-start FeeJuice claim publicly increases the FPC pool by that amount. An observer may correlate these funding events and the first transaction. Ordinary payments debit private notes without exposing the reusable author account as public fee payer. The public payer alone does not distinguish users of this canonical contract.

Transaction timing, paid protocol fees, the pooled balance, public board posts and other application public effects remain observable. A fresh deployment with few users provides no assumed anonymity set. The contract does not claim that bridging is anonymous.

## Client and service observations

Private balance calculation and proof generation occur in the user's PXE. The fee preparer checks node/wallet scope and canonical artifacts and never silently selects the author's public balance. Funding recovery stores public Ethereum transaction metadata; claim salt/secret are derived from the existing wallet key. Possession of that key and recovery metadata must be protected together.

There is no new fee-service operator collecting author identifiers or coupon requests. The configured RPC and frontend host can still correlate transport metadata, timings and page use. This implementation does not supply a network anonymity layer. Independent production privacy review and representative deployment traffic remain necessary before claiming broader unlinkability.

## Accounting limitation

The selected maximum fee is removed from private credit. Unused gas is not refunded; the difference remains in the ownerless pooled protocol balance. UI/configuration must make this charge explicit. Exact balance assertions in the local journey verify this behavior; they do not establish favorable production fee economics.
