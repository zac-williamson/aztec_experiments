# Browser lifecycle048 privacy observations

Source: T04/application-f8db2d4c-9d49-4199-a943-85db9fdb3bd0.json.
The complete real-proof GUI claim/post/screen/withdraw/refund journey passed in
448614ms, with1084208KiB peak owned RSS and complete process/temp cleanup.
Native setup supplies warm private fee credit; this is not browser cold funding.

1339 dispatched RPC observations, zero unknown methods, zero observation-count
losses. Eighteen observations have truncated argument classification:4sendTx and
14simulatePublicCalls. Five getContract requests contain the exact author address.
No other retained RPC row reports an author match; truncated arguments prevent
complete absence claims. These are request classifications, not packet captures.

All four actual Tx/TxEffect classifications identify the shared fee payer and no
exact author match in the inspected categories. Actual private deposit-note chain,
consumed nullifiers, post content and screening window were checked. Author public
FeeJuice remained zero; private debit8498037493564800 and actual protocol fees
45627262200000 were reconciled. Single author/single post cannot establish
cross-author unlinkability.

Browser observed zero external requests, failed HTTP responses or CSP violations.
SDK readiness1298ms and wallet setup3478ms are this local instrumented run's
observations; performanceQualified is false. They do not qualify cold production
delivery or supported-browser performance. Fixture funder/coinbase alias and
same-origin host/RPC limits remain. No privacy criterion is waived.
