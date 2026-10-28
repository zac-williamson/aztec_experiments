# Compact post state and complete transaction gas — 29 October 2026

Implemented on the integration branch; **not deployed to the website**. This changes Board storage and private circuits. The Board, client, SDK, prover registrations and runtime must be released together. Old test state requires no migration. The paused latency campaign remains paused.

## Complete transaction measurement

Two actual transactions on the pinned native development network, with proving disabled, each posted the 29-byte text used in the earlier live baseline. One spent a tip note; the other spent ordinary private credit. Both passed native admission and inclusion. Their fees exactly matched the measured billed gas multiplied by their respective inclusion-block prices.

| Component | Billed L2 gas | Billed DA gas |
|---|---:|---:|
| Fixed public-transaction protocol overhead | 540,000 | 96 |
| Three private note hashes | 57,825 | 96 |
| Four nullifiers, including the protocol nullifier | 123,200 | 128 |
| Three private logs, 42 serialized fields | 7,500 | 1,344 |
| Public posting-call startup | 20,000 | 0 |
| Public posting execution | 211,720 | 1,888 |
| Refund-call startup | 20,000 | 0 |
| Reserved refund allocation | 40,000 | 512 |
| **Total billed** | **1,020,245** | **4,064** |

The setup phase creates fee-credit change and nullifies the input credit, transaction identity and refund authorization. The application creates the updated deposit and post-history notes and nullifies the old deposit. The three private logs carry their corresponding completion/discovery data. The refund note and its public log belong to the refund execution row, not these private counts.

Private work is charged through the protocol's fixed overhead and surviving effects; this table is not a CPU-time or proving-time breakdown. The diagnostic helper independently sums the pinned metering constants against the actual kernel outputs, including transient-note squashing, before submission.

The native public simulator reports `publicGas` as 242,056 L2 / 2,208 DA, **including** the refund's actual 30,336 / 320 execution. Subtracting the latter gives the 211,720 / 1,888 posting row above. Actual total execution is 1,010,581 L2 / 3,872 DA. Billing replaces actual refund use with its allowance, adding 9,664 L2 / 192 DA. Do not add either startup or refund gas twice.

At the earlier live baseline's price of 1,250,000,200,000 base units per L2 gas and zero DA price, the measured gas would cost **1.275306454049 FEE**. This conversion is not a new Sepolia receipt. Actual local test fees were 0.0589202710195 and 0.015641580144 FEE because the local block prices differed.

The earlier live transaction used 2,805,609 L2 gas. The new observation is 63.64% lower, but it is not a matched-state live comparison: the old transaction had two private output notes/logs, while these new transactions have three. A coherent new testnet deployment and included receipt remain outstanding.

## State removed

Post text has always been in `PostPublished`, not contract storage. Its hash and the complete presentation record now also remain only in that authenticated event. The public index already reconstructs ordering and the full record from canonical events.

| Stored fact | New representation |
|---|---|
| Existence, timestamp, publication policy | One field: 64-bit policy identity above a 64-bit timestamp. Nonzero main policy makes zero an unambiguous absence marker, including timestamp zero. |
| Moderation deadline | Derived from timestamp plus immutable censor window; overflow rejected on publication. |
| Count and post ordering | Removed from the contract; indexed from authenticated events. |
| Parent, kind, name, quote reference, content hash | Event only. |
| Subboard and canonical thread root | Two optional fields. Zero means main board / this post's own ID. |
| Tipping-key commitment | One field, retained to authenticate paid tips. |

An ordinary main-board root therefore writes **two fields**, rather than ten. A named subboard reply/quote writes four rather than fourteen. Historical admission authenticates one packed metadata leaf instead of three separate existence/time/deadline leaves. Every moderation, parent, policy, name and tip-authorization check remains. Paid likes also stop writing an unused `active` flag; count and transfer authorization remain.

| Public execution case | Previous candidate L2 | Compact L2 | Previous DA | Compact DA |
|---|---:|---:|---:|---:|
| Anonymous root | 482,531 | **211,720** | 2,400 | **1,888** |
| Named subboard reply and quote | 648,091 | **303,623** | 2,656 | **2,016** |

Measurements cover 22/29-byte ASCII and maximal 992-byte ASCII/UTF-8. Current public costs are identical across those lengths because the public continuation no longer repeats private text validation and the event has fixed capacity. The two root storage instructions have 66,280 L2 base gas; that is an opcode floor, not a complete attribution of slot hashing/control. The native profiler exposes total instructions, not a per-opcode gas trace.

## Refund bound and verification

[Refund audit](REFUND_GAS_BOUND_20261029.md): all three current FPC payment constructors install the same fixed-size continuation. It has no variable loop or external call, performs two fixed nullifier lookups, emits at most one note and always emits one fixed log. Every successful branch uses at most **30,336 L2 / 320 DA** under the pinned artifact and native gas schedule. **40,000 / 512 suffices for supported valid application compositions**, including application reverts and exhausted application gas. This is not a guarantee that arbitrary transactions succeed or exceed no protocol capacity limits.

The full native payment lifecycle passed with exactly that allowance: mint; repeated 20-FEE tips; tip-funded and ordinary-credit posts; mixed inputs; reverted tip returning principal while charging fees; competing-spend rejection; fresh-reader balance discovery. Exact source and artifact bindings are retained alongside the report.

Focused checks cover full event messages/record fields, empty reposts, linked thread parents and atomic rollback, plugin replies, timestamp-zero existence, absent IDs, overflow, foreign callers, duplicate IDs, policy/subboard/parent changes, paid likes and removed targets. Private history/thread/moderation checks and owner-note restoration also passed. No remote prover or website deployment is claimed by these native checks.

Evidence: `execution/evidence/G21/stable6/gas-optimization/compact-native-lifecycle.json`, `compact-public-measurements.json`, and `compact-source-binding.json`. Diagnostic code: `scripts/testing/private-tail-gas.mjs`. Gas regressions run against freshly built artifacts in CI.
