# A02 final dependency handoff — 2026-09-14

Package/lock/node_modules are frozen. Exact overrides: systeminformation5.31.7, ws8.21.0, undici6.28.1, tmp0.2.7, qs6.16.0, uuid11.1.1, plus Jaeger2.9.0 with its own nested core2.9.0. The engine floor is `>=24.21.0 <25`; `test:dependencies` runs `node --test scripts/test-dependency-*.mjs`. Every existing Aztec, Noir and OTelcore1.x lock entry remains unchanged. A02 acceptance still requires independently assigned consumer tests and integrated build/runtime qualification.

## Final advisory outcome

| Scope | Original | After six fixes | After Jaeger fix |
|---|---:|---:|---:|
| All package entries |84 (8 high)|49 (2 high)|48 (0 high)|
| Production entries |46 (7 high)|20 (2 high)|19 (0 high)|

Final all-scope counts are11 low/37 moderate/0 high/0 critical; production has19 moderate/0 high/0 critical. Both final advisory API calls returned valid JSON, exit1 for remaining findings. These are package-entry counts including inheritance, not distinct runtime exploits. The only direct advisory families remaining are core's W3C Baggage advisory and dev-only elliptic's risky implementation classification. No zero-vulnerability or execution-unreachability claim is made.

`jaeger-only/audit-{all,production}.json`, stderr and audit-context.json preserve the final raw sanitized results and exact Node24.21 commands. `jaeger-only/residual-inventory.json` contains every final affected path/version. Earlier audit reports remain unchanged, including the temporary tmp0.2.6 finding that led to the publisher-confirmed0.2.7 follow-up. The portal lock was not changed; its separate same-day zero-audit preparation was not rerun in this lane.

## Jaeger constraint exception and verified resolution

Root approved overriding SDK1.30.1's exact Jaeger1.30.1 pin to publisher2.9.0. The public TextMapPropagator/API interface and matching suppression Symbol.for key supported this narrow assessment; no globalcore override was made. The initial six-patch reasoning is preserved in `handoff-six-patches.md`; detailed primary-source/API/precondition analysis is in `../residual-advisory-disposition-draft.md`.

Scripts-disabled installation under Node24.21 exited0 in2s. Existing abitype/zod peer warnings remain recorded. Actual Node public-entry resolution proves SDK's core is1.30.1, Jaeger's nestedcore is2.9.0, and all contexts share API1.9.1. The only lock entries changed in this follow-up are Jaeger1.30.1→2.9.0 and its added nestedcore2.9.0. See `jaeger-only/{install-context,lock-delta,resolution}.json`. A first metadata probe incorrectly requested API's nonexported package.json subpath; resolution.json records that harness error and the corrected public-entry resolution. It was not a product/API failure.

The old complete lock, manifest and Jaeger1.30 source are preserved in `jaeger-only/`. Basic resolution is not behavioral qualification. The separate agent owns actual SDK1.30 parent registration, custom-header/baggage roundtrips, core1 suppression, malformed trace/baggage, preloaded-global/no-op and existing W3C/HostMetrics controls. No source edits beyond package.json/package-lock.json were made by this lane.

## Residual disposition and integration

Retained core1.30/1.28 moderate advisories require enforceable scope or a compatible bounded fix; new Jaeger's nestedcore2.9 does not repair those copies. Elliptic6.6.1 has no reported patched version and remains dev-only through ethers-v5 CLI signing code; real-key operator workflows cannot be waived merely because npm labels the package dev-only. The disposition draft distinguishes historical browser inventory, actual native/configuration routes and the limited TXE bundled-source observations. Independent acceptance and final source/build binding remain pending.

Source hashes:

- `package.json`: `d6d1aeda94123411327019e2e4b6caf1ff2a496bb9b0a2f1fcdf7b414bfafbfd`
- `package-lock.json`: `4d7cbef3eb1a06797a08b0458ca7c0df93566efd72979573416d95c546372c93`
