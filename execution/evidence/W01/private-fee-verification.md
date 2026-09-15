# Ownerless private fee verification

Working directory: repository root. Pinned Node24.21.0, Aztec5.2.0 and Foundry toolchain. All heavy jobs ran serially. Fresh disposable local identities only; no public deployment or real funds.

| Check | Observed result |
|---|---|
| Contract build and official dependency origins | PrivateFPC and restored ordinary board entrypoints compile; canonical artifacts synchronized. Five official Noir source archives verified. |
| Component and generated-consumer checks |134 passed in4.04seconds: payment/funding/recovery, wallet registration, engine/configuration, proof routing, generated pages, artifacts, SDK manifest and dependency-lock checks. |
| Genuine cold-start board claim and private-balance post |Passed in259.744seconds; peak process-tree RSS1,281,248KiB. Claim proof about15seconds, post proof about13seconds. |
| Genuine standalone funding, board claim, exit and L1 refund |Passed in290.068seconds; peak process-tree RSS1,072,576KiB. Standalone proof11.263seconds; other application proofs about10–12seconds. |
| Full Noir/TXE regression suite |145 passed:137 board and8 private fee checks, within the nine-minute bound. |
| Built CLI smoke |Pass: actual built SDK account/hash operations through user/deploy CLI adapters; no main() or transaction invoked. |
| Cold browser SDK/CRS smoke |Pass: fresh browser processes for shared-library and engine-adapter, actual workers, CRS initialization, hashing and SQLite; about4.2seconds total. Not a browser-generated transaction proof. |

Genuine evidence files: `application-e5037522-f109-4e35-87bd-c3fdcefe3b20.json` and `application-0543b83b-7ca8-406c-890d-074c5ff17299.json`. Both assert canonical shared fee payer, zero author public FeeJuice balance, exact private maximum-fee debit and actual protocol pool debit. Funding uses the production helper and recovery reconstructed from a persisted public record, with an independent Ethereum sender and one deposit. All owned process trees and temporary directories were removed. Official local settlement controls handled the real emitted messages; no network epoch proofs or economic-finality claims.

Retained failures: artifact preflight initially rejected a compiler-generated dispatcher; corrected to distinguish source public entrypoints. Initial TXE positive setup calls were inapplicable to pinned TXE's hardcoded application phase; equivalent positive accounting assertions pass in genuine transactions. One integration run encountered source drift while tests were edited; artifacts rebuilt before rerunning. Another used a redacted node config instead of the supplied local RPC endpoint; the fixture now receives its explicit endpoint. The production funding attempt then exposed stale Ethers nonce caching; a small real-Anvil reproduction and regression established the fix. These failures remain in the earlier numbered logs/reports.

Internal review findings, dispositions and remaining boundaries are in `private-fee-review.md`; public funding and RPC/host correlation limits are in `private-fee-privacy.md`. Historical coupon evidence does not qualify this implementation.
