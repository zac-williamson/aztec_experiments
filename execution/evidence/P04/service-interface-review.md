# Service interface review

Bounded delegated read-only review of `shared/protocol-schema.mjs` and
`execution/service-interface-spec.md` against the V1 contract specification
and actual installed Aztec stdlib 5.2.0 receipt/log APIs. No unresolved blocking
wire-interface finding remains after the integrating agent's dispositions.
This is internal engineering review, not an independent external audit.

## Findings and disposition

1. **Resolved: public event position omitted transaction order.** The original
   envelope had block identity, transaction hash and an ambiguous `logIndex`,
   which could not reconstruct the documented canonical transaction/log order.
   Actual SDK `LogCursor` identifies `(blockNumber, txIndexWithinBlock,
   logIndexWithinTx)`. The final schema includes both named indexes as canonical
   u32 strings and rejects the old ambiguous field. The service specification
   orders by this numeric tuple. Added tests use an actual SDK cursor and reject
   missing, extra and out-of-range positions. Actual F01 cursor persistence,
   canonical decode and reorg replay remain implementation work.

2. **Resolved by explicit caller policy: lower receipt thresholds.** The
   classifier correctly treats inclusion and execution as separate values.
   Default finalized success becomes `confirmed-success`; finalized revert is
   failure, dropped receipts require reconciliation, and missing/unknown results
   cannot become success. These match the installed SDK receipt classes and
   their `success`/`reverted` execution result enum. Because the helper permits
   a lower threshold, the service specification now expressly restricts that
   option to diagnostics/progress and requires finalized completion in W03.
   W03 must also match the receipt hash to its persisted submitted transaction.
   Classification alone does not authenticate a receipt, canonical inclusion,
   remote node or cross-chain consumption.

3. **Clarified design: deadline width.** Observed runtime timestamps are bounded
   below 2^63; future deadlines remain checked u64 sums with the positive u32
   censor window. This is now explicit, so the schema's u64 deadline is not an
   accidental discrepancy. C05 must still test the supported-time horizon: a
   transition must not create mandatory screening or next-allowed obligations
   beyond the supported executable time and thereby defeat finite exit. This
   is downstream arithmetic/transition acceptance, not proof that a current
   deployed system is vulnerable or a request to truncate deadline data.

## Consistency checks

Public feed and moderation shapes are exact and omit private owner, account,
deposit-chain, deposit nonce, linking note and wallet material. The public
scope's L1 chain ID is appropriately distinct from private deposit identity.
The public censor actor belongs only to the authenticated flag projection.
Raw packed events and decoded service payloads are explicitly distinguished:
policy window comes from immutable verified configuration, and inclusion times
come from the actual event. Text length, Unicode and identity shape checks do
not substitute for event-origin validation or safe rendering.

Journal and moderation instructions preserve uncertain submissions, require
durable identity before sending, reconcile before replacement, and use leases.
Dropped/timeout/model-error outcomes do not become success or an automatic OK
verdict. Finalized flag receipt plus its canonical flag event is required for
completion. Record validators intentionally check shape rather than implement
these state transitions; restart, concurrent-worker and lease tests remain
W03/M02. Policy identity is the historical publication policy, while immutable
model identity distinguishes evaluations. The final six-word model transcript
clearly uses full SHA-256 digests of exact reviewed inputs rather than Fields
or mutable labels; M02 owns its codec/vectors and M03 verifies runtime assets.

Deployment order agrees with the corrected configuration encoder: a deployed
board and verified rollup suffice for configHash before portal construction.
Full application scope and Ready commitment require the actual portal, and
deposits remain disabled until the authenticated Ready sequence. There is no
implicit administrator shortcut or timeout refund leaving live posting rights.
This review relies on the separately tested encoder; I previously implemented
that small encoder correction and do not present its review as independent.

Fee preparation keeps the SDK object local, binds scope/intent/ceiling, and
retains uncertain reservations without silently reverting to a public author
fee payer. Its privacy and restart guarantees remain W01 verification, not
consequences of an opaque reservation identifier or schema definition.

The integrating agent's `integrated-interface-tests.log` records **69/69
passing tests** after the cursor changes. I inspected that log and the added
actual-SDK cases without launching a duplicate suite. No chain, RPC, wallet,
proof, deployed service or transaction was exercised by this review.

## Final source binding

| Input | SHA-256 |
| --- | --- |
| `shared/protocol-schema.mjs` | `996ad92705b563cea6a4972d475f4600a8acb5ab92801671f50fda6c4cdfe4b2` |
| `shared/protocol-commitments.mjs` | `2a6e2221f769bff7aa98e61600d40e03faeca8d191aaa361aa473789096f2c66` |
| `shared/sdk-store.mjs` | `083710db7c2911bf3f6a5008d0618f49317a1cd93d686d483fe089e2c433e01f` |
| `execution/service-interface-spec.md` | `c6670d6f264ba3c06e8d66440140ded770828987228aa9c15c86dbe9cf1b0e57` |
| `execution/interface-spec.md` | `e3ed67c6cba40ba481fa40e691b0b79c8c3462fdc4c50ff03173d665e334be57` |
| `scripts/test-protocol-schema.mjs` | `e270d3f326330daea5be267b822c1dcded6b02f14ab01e20962bddd5f50817d4` |
| `@aztec/stdlib/dest/tx/tx_receipt.js` | `f44199937291997dca096d7aa2f974b955aa0249165ff97ef2529884f911c2e4` |
| `@aztec/stdlib/dest/logs/log_cursor.js` | `a1ab43004fb500d5c03ff63571a1dc00bdfbe00ad7ea6883a24cfa2f63d11e3c` |

## Reference-only correction, 2026-09-12

The service specification introduction now correctly assigns its handoff to
W01–W03 and U01, replacing the nonexistent W04 reference. I checked every task
identifier in the current specification against `execution/graph.json`, including
expanding C01–C06, T01–T05 and W01–W03: all 20 distinct referenced IDs exist.
Their assigned roles agree with the handoff. U01 owns user flows and hosting;
T04 owns the browser, recovery, concurrency and load matrix. No other dangling
task handoff was found.

This correction changes ownership references only. It does not change wire
schemas, application behavior or the scope and limitations of the review above;
no application edits or test reruns were needed. The current source binding for
`execution/service-interface-spec.md` supersedes its earlier table entry:
`d99518d53ca78e508ce041f054f7be9f065275ccbf8ee99857e5dca9583e2897`.
