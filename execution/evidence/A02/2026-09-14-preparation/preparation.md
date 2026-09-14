# A02 exact-lock preparation — 2026-09-14

Read-only input to A02, prepared while P04 closes. This does not activate or complete A02, establish production safety, or replace independent review. No installation, automatic fix, dependency/source edit, build, wallet use, or remote exploit check occurred.

## Fresh results and evidence

| Scope | npm exit | Low | Moderate | High | Critical | Package entries |
|---|---:|---:|---:|---:|---:|---:|
| Root, all | 1 | 14 | 62 | 8 | 0 | 84 |
| Root, omit dev | 1 | 0 | 39 | 7 | 0 | 46 |
| Portal, all | 0 | 0 | 0 | 0 | 0 | 0 |
| Portal, omit dev | 0 | 0 | 0 | 0 | 0 | 0 |

All four registry calls returned valid advisory JSON. Root exit 1 means advisories were reported, not an API/tool failure. Stderr contains only an npm update notice; no update was applied. Counts include inherited vulnerable-parent entries and are not counts of distinct exploitable defects.

`inventory-context.json` records exact commands, Node 24.15.0/npm 11.12.1, timestamps, outcomes, unchanged hashes of both manifests and locks, empty credential-free npm configuration, and sanitation. `root-{all,production}.json` and `portal-{all,production}.json` retain the reports with local path sanitation only. Requests used the existing locks, public registry, no lifecycle scripts, no retries, and bounded timeouts. `.build/A02-audit-cache` holds only npm audit metadata/cache; no dependency installation.

`affected-lock-paths.json` maps every reported package to each exact lock node, version, immediate parent constraint, and freshly derived shortest dependency path. Runtime-root dependency membership is not proof that vulnerable functions execute. `advisory-patch-metadata.json` records successful public GitHub metadata responses for all 27 distinct advisory IDs, including affected ranges and first patch versions. An absent patch is preserved as null. Publisher pages are cited below for remediation judgments.

## Delta from the P04 audit

The same package names, affected nodes, severities, ranges and direct advisory payloads remain. The reports are not identical: normalized comparison finds 28 changed inherited `via`/`effects` fields in all-dependency scope and 6 in production scope, plus 20 and 5 changed fix suggestions respectively. Many inherited edges no longer propagate through `@aztec/viem`; these changes do not establish execution reachability or a repaired lock. Full before/after data is in `p04-inventory-delta.json`.

In particular, npm now marks `ws` as automatically fixable. Undici still produces an incompatible Aztec 0.79.0 downgrade suggestion (the suggested parent changed from cli-wallet to txe). Do not run `npm audit fix --force`. Publisher September updates also require considering Undici 6.28.1 and Node 24.21.0 even though the exact current npm advisory set is unchanged.

## High-priority exact nodes and candidate changes

| Actual affected node and installed version | Relevant dependency path/constraint | Candidate and required acceptance work |
|---|---|---|
| `node_modules/systeminformation` 5.23.8 | `@aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/host-metrics`; host-metrics 0.36.2 pins 5.23.8 | Assess a targeted 5.31.7 override or compatible parent patch. Exercise the actual `systeminformation/lib/network` deep import and `networkStats()` through HostMetrics, including enabled and disabled telemetry and error handling. |
| `node_modules/viem/node_modules/ws` 8.18.3 | `@aztec/aztec.js → viem → ws`; viem 2.38.2 pins 8.18.3 | Assess 8.21.0. Root `node_modules/ws` is already 8.21.0. Test actual native WebSocket and package-fallback transport resolution, normal request/subscription/disconnect behavior and bounded malformed-input handling before claiming the nested copy is unused. |
| `node_modules/undici` 5.29.0 | `@aztec/foundation → undici`, declared `^5.28.5` | Assess 6.28.1, a major-range override requiring real JSON-RPC Agent/client tests: POST, timeout/abort, error response, gzip and optional cookies against controlled local fixtures. Do not assume all Undici advisories share the same reachable API. |
| `node_modules/@opentelemetry/propagator-jaeger` 1.30.1 | telemetry → sdk-trace-node 1.30.1 → propagator-jaeger, with 1.30.1 core coupling | Publisher patch is 2.9.0. Do not mix OTel major versions blindly. Assess coordinated compatible remediation or a bounded source patch; alternatively prove and independently approve exclusion of Jaeger from every supported deployment configuration. Test the actual telemetry initialization and propagator behavior, not just a source-string assertion. |
| `node_modules/tmp` 0.0.33 | dev path cli-wallet → inquirer → prompts → editor → external-editor 3.1.0; caller declares `^0.0.33` | Candidate 0.2.6 crosses the declared 0.x range. Test external-editor's actual temporary-file API and cleanup with dummy content; assess packaging exclusion for production tooling separately. |

Systeminformation's five high advisory patch floors are 5.27.14, **5.31.0**, 5.30.8, 5.31.6 and 5.31.7. The 5.31.0 floor comes from publisher/database metadata despite its affected range ending at 5.30.7; do not infer that 5.30.8 fixes that advisory. Latest relevant [publisher release 5.31.7](https://github.com/sebhildebrandt/systeminformation/releases/tag/v5.31.7) was rechecked today. The two ws floors are 8.20.1 and [8.21.0](https://github.com/websockets/ws/releases/tag/8.21.0), whose release adds fragment/chunk bounds. The two tmp floors are 0.2.4 and [0.2.6](https://github.com/raszi/node-tmp/releases/tag/v0.2.6).

The actual pinned Node executable embeds Undici **7.24.4**. An npm override cannot replace that runtime copy. The independently refreshed [Node 24.21.0 release](https://nodejs.org/en/blog/release/v24.21.0), dated September 8, updates embedded Undici to 7.29.1; the [Undici 6.28.1 publisher release](https://github.com/nodejs/undici/releases/tag/v6.28.1) remains the npm 6.x candidate. Both are assessment inputs, not installed or verified replacements. Any Node pin change must update all owned runtime/container/toolchain provenance and rerun the graph's required build, browser, lifecycle and platform checks.

The [Jaeger publisher advisory](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-45rx-2jwx-cxfr), rechecked today, applies to opt-in Jaeger propagation and names 2.9.0 as the patch. Default W3C propagation is unaffected by that specific advisory. This supports a configuration-sensitive reachability investigation, not blanket clearance of telemetry or its other advisories.

## Lower-severity inventory still needs treatment

- `node_modules/qs` 6.15.3: two moderate advisories; candidate **6.16.0**. The [publisher advisory](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g) confirms that patch. Test actual query parser/serializer options and controlled malformed values through the owning service; do not infer safety from normal JSON-only message content.
- `node_modules/uuid` 9.0.1: moderate buffer-bound advisory; **11.1.1** is the earliest listed patch in a later major. Publisher also names patched 12.0.1 and 13.0.1 branches in its [advisory](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Determine which versioned methods and optional buffer/offset forms are actually used before selecting a compatible parent upgrade or reviewed bounded patch.
- `@opentelemetry/core`: root 1.30.1 plus seven nested 1.28.0 nodes; every exact path is in `affected-lock-paths.json`. The [publisher W3C Baggage advisory](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf) names **2.8.0**. W3C TraceContext and W3C Baggage are different propagators. Test actual selection and bounded baggage extraction if supported; coordinate any OTel major change with Jaeger and exporters.
- `node_modules/elliptic` 6.6.1: low, dev-only in this lock; GitHub advisory metadata gives **no patched version** for GHSA-848j-6mx2-7j84. Retain an explicit tooling scope/disposition and investigate a compatible parent replacement. Do not manufacture a safe elliptic version from the existing latest number.

## Current reachability observations and limits

`reachability-inputs.json` binds the observations to source hashes and the generated SDK manifest. Today the actual Node resolver from `isows` selects root ws 8.21.0, and native `WebSocket` exists. The browser manifest contains native isows inputs and no inputs from ws, npm undici, systeminformation, host-metrics, Jaeger or telemetry-client. This describes this specific built browser's declared source inputs; it does not clear native CLIs, server modes or future bundles.

Read source shows telemetry starts as Noop and loads its OTel implementation when a collector is configured; OTel explicitly constructs W3C TraceContext. Enabled HostMetrics deep-imports systeminformation's network module and calls `networkStats()` with no argument. Aztec's npm Undici adapter uses Agent/request POST, explicit gzip processing and optional application-owned cookie storage; inspection did not find WebSocket/retry-interceptor invocation in that adapter. These are test hypotheses, not vulnerability reproductions or verified exclusions. User-controlled posts have not been shown to reach system command options, telemetry headers, or temporary-file options in this lane.

A02 should first bind runtime/deployment scope, then make narrow version/parent/patch decisions with real consumer controls, rerun exact-lock audits and compatibility/provenance checks, and obtain independent dispositions for anything retained. The graph's production gate and X03 network-release restriction remain separate; this preparation changes neither.
