# A02 advisory remediation preparation

Read-only preparation on 2026-09-12 against the installed Aztec 5.2.0 dependency tree and current publisher/GitHub advisories. No dependencies, lockfiles, application sources, or runtime pins were changed; no upgrades installed or vulnerability demonstrations run. Proposed versions below are candidates for A02 compatibility testing, not verified replacements or acceptance evidence.

## Scope and conclusion

`execution/evidence/P04/toolchain-audit-classification.json` records 8 high package entries overall, 7 reachable through npm production dependencies. The seven production entries reduce to four advisory-bearing packages: **systeminformation, propagator-jaeger, undici, and the nested ws copy**. `@aztec/telemetry-client`, `@opentelemetry/host-metrics`, and `@opentelemetry/sdk-trace-node` inherit dependency findings; they are not three additional demonstrated application vulnerabilities. The eighth high, `tmp`, is development-only in this lock.

The smallest changes to test first are targeted replacements for systeminformation and nested ws. Undici requires crossing Foundation's major-version range. Jaeger's published fix crosses the installed OpenTelemetry major version, while the inspected Aztec initialization explicitly chooses W3C propagation. Use an evidence-backed configuration disposition while determining whether a narrow Jaeger update or reviewed upstream backport is compatible. Do not run `npm audit fix --force`: the suggested Aztec 0.79.0 downgrade conflicts with the coordinated 5.2.0 protocol/toolchain.

## Exact paths, versions and proposed action

Paths are repository-relative; repository root is `/Users/zac/Documents/ChatGPT/Anonymous Message Board/aztec_experiments`.

| Finding and installed path | Production path / constraint | Smallest candidate and qualification |
| --- | --- | --- |
| `systeminformation` 5.23.8 at `node_modules/systeminformation` | `@aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/host-metrics → systeminformation`; host-metrics 0.36.2 pins **5.23.8 exactly** | **5.31.7** addresses all five recorded high advisories. Scoped override or compatible upstream parent update is needed; ordinary semver update cannot move this exact pin. Verify host-metrics' deep `systeminformation/lib/network` import, result shape, platform behavior and failure handling. |
| `ws` 8.18.3 at `node_modules/viem/node_modules/ws` | `@aztec/aztec.js → viem → ws`; viem 2.38.2 pins **8.18.3 exactly**. Root `node_modules/ws` is already 8.21.0. | **8.21.0** fixes the high fragment/chunk exhaustion finding and supersedes the 8.20.1 memory-disclosure fix. Target the remaining old copy, then verify real resolver paths, WebSocket reconnect/subscriptions, close/errors and new fragment limits. |
| `undici` 5.29.0 at `node_modules/undici` | `@aztec/foundation → undici`; Foundation 5.2.0 declares **^5.28.5** | **6.28.0** clears the recorded advisory version floors, but **6.28.1** is the current minimum candidate identified here because a September security release adds fixes. This crosses the parent range; test a scoped override against actual Agent/request consumers, body handling, headers, TLS, timeout/abort and connection cleanup. |
| `@opentelemetry/propagator-jaeger` 1.30.1 | `@aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/sdk-trace-node → propagator-jaeger`; sdk-trace-node 1.30.1 pins propagator and core **1.30.1 exactly** | Published patch **2.9.0**, which itself requires core **2.9.0**. This is not a drop-in patch claim. Prefer preserving enforced W3C-only propagation while qualifying a narrow update/backport; do not upgrade all OpenTelemetry components blindly. |
| `tmp` 0.0.33 at `node_modules/tmp` (development-only) | `@aztec/cli-wallet → inquirer → @inquirer/prompts → @inquirer/editor → external-editor → tmp`; external-editor 3.1.0 declares **^0.0.33** | **0.2.6** fixes the high traversal advisory and supersedes the low symlink fix. This crosses the 0.x range; verify the caller's `tmpNameSync(fileOptions)` path and cleanup/editor behavior, or remove an unused development consumer with evidence. |

No candidate has been installed or passed tests. A02 should refresh advisories before pinning because the saved npm response already omits a newer publisher advisory.

## Publisher patch evidence

### systeminformation

- Windows `fsSize()` drive input: fixed **5.27.14**; requires Windows and relevant untrusted input. [Publisher GHSA-wphj-fx3q-84ch](https://github.com/sebhildebrandt/systeminformation/security/advisories/GHSA-wphj-fx3q-84ch).
- Linux `versions()` parsing of locate output: publisher lists fixed **5.31.0**, despite the audit's affected range ending at 5.30.7. Do not infer a 5.30.8 fix for this item. [Publisher GHSA-5vv4-hvf7-2h46](https://github.com/sebhildebrandt/systeminformation/security/advisories/GHSA-5vv4-hvf7-2h46).
- `wifiNetworks()` retry input: fixed **5.30.8**. [Publisher GHSA-9c88-49p5-5ggf](https://github.com/sebhildebrandt/systeminformation/security/advisories/GHSA-9c88-49p5-5ggf).
- Linux NetworkManager profile-name handling in `networkInterfaces()`: fixed **5.31.6**, requires control over relevant local profile state. [Publisher GHSA-hvx9-hwr7-wjj9](https://github.com/sebhildebrandt/systeminformation/security/advisories/GHSA-hvx9-hwr7-wjj9).
- Linux interfaces source-directive handling: fixed **5.31.7**, requires influence over the local configuration/source chain. [Reviewed GHSA-5xpp-75jx-m839](https://github.com/advisories/GHSA-5xpp-75jx-m839), [publisher release](https://github.com/sebhildebrandt/systeminformation/releases/tag/v5.31.7).

### ws and tmp

The ws publisher identifies **8.21.0** as the 8.x fragment-exhaustion fix and adds `maxBufferedChunks`/`maxFragments`; prior payload-size limits alone do not eliminate that issue. [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p), [8.21.0 release](https://github.com/websockets/ws/releases/tag/8.21.0).

The tmp advisory's structured patched-version field is **0.2.6**, confirmed by its publisher release. Its long description retains stale text saying no patch exists; use the explicit patched metadata and release, then verify actual updated bytes. The input condition is untrusted prefix/postfix/directory options, not arbitrary message text merely existing in the application. [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65), [0.2.6 release](https://github.com/raszi/node-tmp/releases/tag/v0.2.6).

### Undici and Node runtime

Recorded WebSocket compression/validation fixes start **6.24.0**; fragment-count fixes start **6.27.0**. Publisher pages classify the two older compression findings as moderate while the saved audit/GitHub database calls them high. Preserve that disagreement; do not rewrite severity or infer reachability from it. [Compression advisory](https://github.com/nodejs/undici/security/advisories/GHSA-vrm6-8vpv-qv8q), [validation advisory](https://github.com/nodejs/undici/security/advisories/GHSA-v9p9-hfj2-hcw8), [fragment advisory](https://github.com/advisories/GHSA-vxpw-j846-p89q).

The recorded later retry/body/cookie fixes require **6.28.0**; the retry issue requires a retry interceptor plus downstream forwarding, which is not the inspected Foundation transport's behavior. [Publisher retry advisory](https://github.com/nodejs/undici/security/advisories/GHSA-8xcm-r25x-g524). The **2026-09-04** publisher release **6.28.1** adds a high WebSocket handshake fix plus decompression/retry corrections. The high item begins at 6.7.0, so upgrading the 5.x package to 6.28.0 would introduce a version inside that newer advisory's range. Select 6.28.1 for qualification. [6.28.1 release](https://github.com/nodejs/undici/releases/tag/v6.28.1), [GHSA-rfgv-xxqx-mfg5](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5).

A separate read-only runtime check returned **Node v24.15.0, built-in Undici 7.24.4, native WebSocket available**. npm overrides do not patch Node's embedded library. Official Node **24.18.1** updates it to 7.29.0; the newer **24.21.0**, released September 8, updates it to **7.29.1**, covering the identified September floor while remaining on Node 24. This is the current runtime candidate to qualify, not authorization to change P04 pins during verification. Rebind runtime hashes and rerun native SDK/database/prover/CLI/lifecycle checks if adopted. [Node 24.18.1](https://nodejs.org/en/blog/release/v24.18.1), [Node 24.21.0](https://nodejs.org/en/blog/release/v24.21.0).

### Jaeger

The **2.9.0** fix handles malformed incoming encoded headers. The publisher limits the process-termination case to active Jaeger-only propagation; default W3C propagation is unaffected, and composite propagation catches the exception. This is not evidence that all installed telemetry is exploitable. [GHSA-45rx-2jwx-cxfr](https://github.com/advisories/GHSA-45rx-2jwx-cxfr). The patched package's manifest requires core 2.9.0; mixing it into the 1.30.1 SDK needs compatibility tests or a reviewed backport, not a broad semver override. [Patched manifest](https://github.com/open-telemetry/opentelemetry-js/blob/v2.9.0/packages/opentelemetry-propagator-jaeger/package.json).

## Installed reachability evidence and limits

1. **Browser bundle:** the inspected `.build/sdk/sdk-manifest.json` input inventory contains no systeminformation, undici, Jaeger, host-metrics, telemetry-client, or ws package inputs; it includes `isows/_esm/native.js`. This supports absence from this built browser artifact, not absence from all future builds or native processes. Bind/recheck the final manifest after changes.
2. **Telemetry:** `node_modules/@aztec/telemetry-client/dest/start.js` begins with a no-op client and lazy-loads `otel.js` when a collector is configured. `otel.js` explicitly registers `new W3CTraceContextPropagator()` in its custom client factory and starts HostMetrics. This supports a scoped Jaeger configuration disposition; it does not verify every service startup or ambient instrumentation. A02 should test the actual enabled and disabled initialization paths and reject unauthorized propagator/config changes.
3. **Host metrics:** `node_modules/@opentelemetry/host-metrics/build/src/stats/si.js` imports `systeminformation/lib/network` and calls `networkStats()` with no argument. The installed implementation selects a default interface; wildcard input invokes `networkInterfaces()`, and a Windows stats branch also calls it. I did not find `fsSize`, `versions` or Wi-Fi calls in that metrics adapter. Therefore the audit path does not demonstrate the specific Linux configuration-sensitive sinks execute on the app's normal metrics path. No hostile host state, privilege escalation or application input flow was demonstrated. Patch the stale library nevertheless, with the claim scoped to removing the affected dependency.
4. **Foundation networking:** `node_modules/@aztec/foundation/dest/json-rpc/client/undici.js` imports `Agent`, calls `client.request`, and manually handles a single gzip encoding. It does not instantiate Undici WebSocket or retry interceptors. The installed 5.29.0 WebSocket source says permessage-deflate is not enabled; a broad advisory range alone is insufficient to assert those newer compression paths exist here. This is not clearance for all HTTP findings or other native SDK consumers.
5. **Viem resolution:** `node_modules/viem/_esm/utils/rpc/webSocket.js` dynamically imports `isows`; hoisted `node_modules/isows/_esm/index.js` statically imports ws but prefers the native WebSocket constructor. A built-in resolver check from that actual isows file resolves **root ws 8.21.0**, not viem's nested 8.18.3. The stale nested package still exists and should be removed/upgraded, but its use by that examined path was not established. Node's native WebSocket is a distinct runtime surface.
6. **Development editor:** `node_modules/external-editor/main/index.js` passes caller file options into `tmpNameSync`; no ordinary public-post route to those options was established. Development-only does not mean irrelevant to build trust, but do not label this a deployed message-board traversal.

## A02 execution and acceptance preparation

Start with a fresh audit and preserve the exact old lock/advisory response. Make narrow changes one at a time, retaining Aztec 5.2.0 package coordination. Prefer provider-supported compatible updates; where an exact transitive override is needed, document the overridden parent constraint and tested API. Do not silently use a fork or local untracked node_modules patch.

Required meaningful checks include actual native JSON-RPC round trips and cleanup; enabled/disabled telemetry startup and active propagator behavior; benign malformed-header handling; actual ws/isows/native resolution; bounded normal and error WebSocket handling; temporary-file containment/cleanup; browser SDK input inventory; and affected existing integrated tests. Network cases use disposable loopback fixtures, not remote targets or resource-exhausting demonstrations. Rebuild/rebind SDK provenance when its lock changes even if browser output bytes remain identical. Refresh all/omit-dev audits and record remaining moderate/low items separately rather than claiming zero advisories from resolving the high set.

Any final applicability exception must name the exact advisory, installed artifact, disabled call/configuration, enforcing test, owner and expiry/review condition. The current source inspection is preparation for such a disposition, not an accepted waiver. These findings concern dependency maintenance and deployment configuration; no application exploit was reproduced here.

## Inspected source fingerprints

SHA-256, captured at this review checkpoint; external advisories are mutable and must be refreshed at implementation.

- `execution/evidence/P04/toolchain-audit-classification.json`: `c9436ad0120269f22b45b69cda6ba60351104e91a36e6399bc6e746a34570c49`
- `package-lock.json`: `339461947185a2bf4a2ef7d0dc3ff56b771f56822b5b04905eead26b6643bf0e`
- `.build/sdk/sdk-manifest.json`: `646a5c21a95e74e7a1cae46858752db8f4eb976530f895bed0961e151e6631d6`
- `node_modules/@aztec/telemetry-client/dest/start.js`: `816125d852576427ce9704b6f62afc44fc66588d8fe248387d616a8ef5bc1a5a`
- `node_modules/@aztec/telemetry-client/dest/otel.js`: `0592ace09ed6a6ef000d3a895ddc7395502aac2587e9e877504fcf06f6951387`
- `node_modules/@aztec/foundation/dest/json-rpc/client/undici.js`: `109061b38f04b17a0fd668542e916ab6c2fec2a48c4316107a7df24a06d19f96`
- `node_modules/@opentelemetry/host-metrics/build/src/stats/si.js`: `67d55065fbf5dba95cc61be73ac892a7e9a1193ec10f57fe2bcdf27619526548`
- `node_modules/systeminformation/lib/network.js`: `eb3badfa7628e07ee0bb1794e23e574274e3e5b173db0623465cc6eb64166c74`
- `node_modules/viem/_esm/utils/rpc/webSocket.js`: `b1f94c6ec8b03a3ff22ff8556f87697b026a17b99536e32a59ea1cfaa38b6304`
- `node_modules/isows/_esm/index.js`: `26fd1c10b92dcc6ab13d5b8bea349a9ddd435d2e63f199a3f699b4a5b182eb3e`
- `node_modules/undici/lib/websocket/connection.js`: `2a710f5a9f18b65bd47815675c64dd5c6bd903acf369610346a58680a01e78a2`
