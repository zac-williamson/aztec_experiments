# P04 browser qualification after reboot — 2026-09-14

**PASS: both actual derived-CRS consumer paths completed.** This is one current-source qualification following the user's reported reboot and freed memory. No source changes, retries, point-count reductions or timeout changes were made. Earlier failed attempts remain unchanged in their original evidence files.

## Source and execution binding

Twenty relevant source/generated-file hashes matched `source-derived-crs-candidate.json` before the run and remained identical afterward. This is scoped browser-input verification, not a claim that this lane rechecked every candidate file. Candidate fingerprint: `750cb4c1df4c99b7140e252bf987b66ac39ced85ee48632d8c1f6e74e4b103cc`.

The existing SDK manifest checker also passed against 1,361 inputs and eight outputs for Aztec5.2.0. The smoke source SHA-256 is `ae0a5de7e8ab542e9f37e46b4cee5670f2c083b4552c8925ccb1daeb34c6e0e3`; runtime client SHA-256 is `d2f05e23a00be052861eab920d8e1673767028256fceb825d1c7ee70b91e193a`. The exact command, asset hashes and candidate mapping are recorded in the context JSON.

Pinned Node24.15.0 launched local Chrome152.0.7977.84 with a fresh browser process/disposable profile for each consumer, sequentially. Navigation retained `waitUntil: load` and30000ms; evaluation retained120000ms per consumer. An outer600-second supervisor bounded the entire run. No other project heavy run was active in this slot.

## Observed outcomes

| Check | Shared-library consumer | Engine-adapter consumer |
|---|---:|---:|
| Navigation |515ms|471ms|
| Full evaluation |1032ms|973ms|
| Actual BN254 initialization |396ms|395ms|
| Actual Grumpkin initialization |16ms|17ms|
| Actual BN254 input bytes |75,497,472|75,497,472|
| Actual BN254 points |1,179,648|1,179,648|
| Buffer compatibility,70exports, origin isolation |pass|pass|
| Poseidon, asynchronous workers, SQLite write/read/close |pass|pass|

Both actual adapter paths verified the local derived G1/G2/Grumpkin bytes, initialized the real WASM API and satisfied format-specific response checks. The independent actual-call input assertion prevents silent compressed fallback from being counted as a derived-path pass. Both returned the same Poseidon value and SQLite `value`; workers were initialized and destroyed. No page/HTTP faults or deadlines were reported.

The supervised run took5.838seconds and exited0, with no outer timeout. Browser-disconnected events were recorded for both fresh processes; the harness awaited browser and local HTTP-server closure. Tool session44685 was polled to completion. No owned browser/tool session remains active. This is lifecycle completion evidence, not an OS-wide orphan-process audit. Root and the waiting verification lane were notified that the heavy slot was clear.

## Limits

This is a successful local browser smoke qualification, not a generated transaction proof, representative performance campaign, external audit or production-release clearance. No wallet, network RPC, funds or transaction was used. The result does not by itself establish the cause of earlier timeouts or universal supported-device latency; U01/T04 still need representative cold/warm and resource measurements. Root owns integration of this evidence with the remaining P04 gates.

## Evidence hashes

- `browser-after-reboot-2026-09-14.json`: SHA-256 `96664fe6909d3274cd6713e76c34210166b397072c4a50017a89588f62db659e`.
- `browser-after-reboot-2026-09-14.stderr`: SHA-256 `f457fbf586a709af9099029629f2cd31cedad88380ef797a25f8c22b9c306ee5`.
- `browser-after-reboot-2026-09-14.context.json`: SHA-256 `3bd58cfcf7b414aeb8f9afe7e897d57624d3c4dedb52ce2e023fda66d175dd59`.
- `browser-after-reboot-2026-09-14.supervision.json`: SHA-256 `30eddfb983a22b952957602f1b7c4fc6faccab8b95bc00d0943ea01632654da7`.
