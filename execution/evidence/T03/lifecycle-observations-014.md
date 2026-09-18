# Genuine lifecycle022 privacy observations

Analysis of `execution/evidence/T04/application-8383f642-aaba-4477-a8f5-c8276c917259.json`, specifically `worker.node.bridge.browserJourney`. Counts below sum each retained RPC row's `count`; they are requests/observations, not distinct users. No new tests or source edits. This is not a T03 pass.

## RPC observations

The report retains1495 dispatched observations:930 Aztec and565 Ethereum, all classified successful. Unknown methods0; observation-count drops0. Argument traversal was truncated for18 observations: all4 `sendTx` and14 `simulatePublicCalls`. Therefore absence conclusions for these large arguments remain incomplete.

| Channel/method | Exact known roles observed together | Count |
|---|---|---:|
| Aztec getContract | author |5|
| Aztec getContract | board |38|
| Aztec getContract | payer |8|
| Aztec getPublicLogsByTags | board |42|
| Aztec getPublicStorageAt | board |117|
| Aztec sendTx | board, funder, payer |1|
| Aztec sendTx | funder, payer |3|
| Aztec simulatePublicCalls | funder |13|
| Aztec simulatePublicCalls | funder, payer |1|
| Ethereum eth_call | funder |5|
| Ethereum eth_estimateGas | funder |2|
| Ethereum eth_getTransactionCount | funder |2|
| Ethereum eth_sendTransaction | funder |2|

The remaining observations had no detected exact known-role match. No author match was detected in the14 public simulations, unlike historical browser044's pre-neutral-read trace. This qualifies the integrated change in this scenario, subject to traversal limits; the5 explicit author contract lookups remain a measured RPC disclosure. Ethereum funder occurrences are consistent with the public deposit/refund wallet boundary, not anonymous bridging.

The fixture aliases funder and sequencer coinbase. Aztec funder matches cannot independently establish author-specific funding linkage: transaction/simulation objects include public anchor context, and the trace does not retain semantic field paths. Classification stores no raw bodies, secrets, provider errors or response contents; pre-dispatch rejections are excluded. Scalar argument-size buckets are not network packet sizes.

## Canonical public transaction fields

Final private-chain verification passed. All four transactions have the shared FPC as public payer and no exact author match in any inspected named public field. Only the following positive role classifications occurred:

| Transaction | Positive matches | Public calls / logs | Note commitments / nullifiers | Private delivery logs / emitted fields |
|---|---|---|---|---|
| claim | sharedPayer in feePayer |0 /0|3 /5|4 /64|
| post | sharedPayer in feePayer; board in publicCallSenders, publicCallTargets, publicLogContracts |1 /1|3 /5|3 /48|
| screen | sharedPayer in feePayer |0 /0|3 /5|3 /48|
| exit | sharedPayer in feePayer |0 /0|1 /3|1 /16|

The post has35 public calldata fields and40 public writes; the other transactions each have1 public write. Exit has1 L2-to-L1 message hash; the others have0. All have0 contract-class logs. These counts describe actual public representations, not plaintext disclosure of private delivery contents.

Only author/sharedPayer/board were supplied to this public classifier. OtherAuthor/moderator/funder entries are null, meaning untested, not absent. Exact equality does not inspect derived identifiers, proof bytes, protocol constants or cross-transaction linkability. The verified physical note chain and consumed nullifiers establish application correctness, not a population anonymity set.

Verified private debit is9259055332924800 and actual pooled protocol fee debit45627262200000; author public FeeJuice balance remained zero. Browser requests recorded zero external requests and no CSP violations; observed paths include local UI/bundle/worker/WASM/CRS assets and both RPC routes. This same-origin fixture does not separate host and RPC operator knowledge or conceal network origin/timing.

## Remaining qualification

This advances current-source lifecycle/RPC qualification beyond browser044. It still has one author, one ordinary post and native warm fee credit. The minimal repeated-post/cross-author comparison, distinct funder/coinbase fixture identities, historical W01 reuse and A01 funding-correlation limitation remain exactly as recorded in `remaining-observations-013.md`. No criterion is waived. It does not establish cold-start browser funding/recovery, timing-analysis resistance, complete traversal of RPC arguments, or cryptographic unlinkability. Independent review obligations remain open.
