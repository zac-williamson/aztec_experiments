# A02 residual advisory disposition — draft for independent review

Update after the assessment below: root approved and installed the narrow Jaeger2.9/nestedcore2.9 fix. Final public-entry resolution passed and final exact-lock audits report48 all/19 production entries, **zero high/critical**, with only core and elliptic direct advisory families remaining. Actual behavioral tests are independently assigned and pending at this annotation. See `dependency-remediation/jaeger-only/` and the current handoff. The following pre-decision assessment and its source fingerprints are preserved as historical rationale; its no-install statements refer to that assessment stage, not current package state.

2026-09-14, read-only source and primary-source review. No new behavioral tests or dependencies were run/installed for this draft. The final six-patch lock audit reports49 all-dependency entries and20 production entries, including two high entries caused by the same Jaeger advisory. This document proposes treatment; it is not an approved exclusion or a claim of zero vulnerabilities. Actual tests belong to the separate dependency-test lane.

## Jaeger: prefer a bounded fix over a clean-start-only exclusion

Current exact node `node_modules/@opentelemetry/propagator-jaeger`1.30.1 is high, with inherited high `node_modules/@opentelemetry/sdk-trace-node`1.30.1. The [publisher advisory](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-45rx-2jwx-cxfr) names malformed URI-encoded Jaeger headers, active Jaeger propagation and an uncaught decoder exception as the relevant conditions; patch2.9.0 catches malformed trace/baggage decoding. Composite handling reduces process-termination impact but is not a patch.

Installed Aztec `getCustomClientFactory` explicitly registers W3CTraceContextPropagator. BasicTracerProvider1.30 only reads OTEL_PROPAGATORS when no explicit propagator is supplied. However, no-op initialization leaves existing globals untouched, and global registration may refuse a second registration. A clean-start test does not prove safety with earlier instrumentation. Removing env strings alone also does not stop explicit earlier Jaeger registration.

A narrowly targeted Jaeger2.9 override with **its own nested core2.9**, leaving existing SDK/core1.30 and core1.28 copies intact, is reasonable to qualify:

- The official [Jaeger2.9 manifest](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/v2.9.0/packages/opentelemetry-propagator-jaeger/package.json) retains CommonJS `build/src/index.js`, peers on API>=1.0<1.10, and depends exactly on core2.9. Actual installed API is1.9.1. Its Node range includes24.21.
- The [core2.9 manifest](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/v2.9.0/packages/opentelemetry-core/package.json) peers on the same API range and adds only semantic-conventions^1.29; existing root1.43 satisfies that range. This does not justify replacing core1 globally: the current SDK uses older internal exports such as getEnv.
- The [new Jaeger implementation](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/v2.9.0/packages/opentelemetry-propagator-jaeger/src/JaegerPropagator.ts) implements the public TextMapPropagator interface. The current parent constructs it without arguments and uses its public methods; there is no observed inheritance or dependence on its core internals. Custom header/prefix constructor forms remain present.
- Its only runtime core import is isTracingSuppressed. The [core2 suppression implementation](https://raw.githubusercontent.com/open-telemetry/opentelemetry-js/v2.9.0/packages/opentelemetry-core/src/trace/suppress-tracing.ts) uses the same context-key description as installed core1. Installed API's createContextKey uses Symbol.for, so the two versions should share that suppression key. This is source-based compatibility evidence pending actual cross-version execution.

The risk is explicit: this overrides SDK1.30's exact Jaeger1.30 dependency pin across a major. Before acceptance, assert exact dependency resolution (SDK1.30; Jaeger2.9; Jaeger's core2.9; SDK's core1.30; shared API1.9.1), then exercise actual SDK parent registration with Jaeger selected, normal/custom-header trace and baggage inject/extract, malformed trace and baggage independently, core1 suppression respected by new Jaeger injection, and preloaded-global/no-op conditions. Run independent review and fresh audits afterward. No installation was performed for this assessment. If those checks pass, prefer the fixed installed implementation over an exclusion based solely on startup assumptions.

## Core: W3C Baggage is distinct from TraceContext

The moderate GHSA-8988-4f7v-96qf remains in root core1.30.1 and seven nested1.28.0 nodes; `dependency-remediation/residual-inventory.json` lists every exact path. [Publisher guidance](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf) identifies inbound W3CBaggagePropagator extraction without its own byte/entry limits and patch2.8.0. Normal Node HTTP header limits bound one transport but do not cover custom carriers, changed limits, or direct extract calls.

Installed core source confirms outbound inject filters/slices data while inbound extract joins/splits the received header and constructs entries without corresponding limits. Aztec's explicitly selected TraceContext does not read baggage; that is a testable scope restriction. No-op startup with earlier Baggage/global instrumentation remains an uncovered route unless rejected or constrained.

Proposed disposition: retain only with an enforced supported launch/configuration contract that fixes propagation to TraceContext or Noop, prevents earlier arbitrary instrumentation/globals, and tests the actual entrypoints. If Baggage is supported, require a compatible bounded extraction fix or supported SDK upgrade, plus actual size/entry/error controls through each supported transport; an operator note alone is insufficient. The proposed nested core2.9 for Jaeger does not repair other core copies. Any global core replacement must separately qualify SDK/exporter APIs.

## Elliptic: dev-only dependency membership does not mean safe for real keys

The low GHSA-848j-6mx2-7j84 entry is `node_modules/elliptic`6.6.1 via `@aztec/cli → @ethersproject/wallet → @ethersproject/signing-key`. Its immediate parent pins6.6.1; the audit has no patched version. The current report's broad risky-cryptographic-implementation classification does not supply one concrete remote precondition that this review has reproduced. Do not invent a new exploitable path or a nonexistent safe patch from that classification.

Actual installed ethers-v5 signing-key code imports elliptic, creates secp256k1 key pairs, signs digests, derives shared secrets and recovers/encodes public keys. Therefore the tooling can handle secret material; it cannot be cleared merely because npm labels it dev-only. The upstream [elliptic repository](https://github.com/indutny/elliptic) documents these cryptographic operations, but offers no independently verified security clearance here.

Proposed treatment: exclude the affected v5 CLI/wallet path from the deployed application runtime and from any real-key operator workflow, enforce the package/entrypoint boundary in release packaging and command guidance, and use only fresh disposable identities for retained test tooling. If deployment/recovery tooling needs that path with real secrets, obtain a supported parent replacement and actual signing/format compatibility tests or explicit independent risk disposition. A new audit/refreshed publisher check is required before release; no cryptographic audit is claimed.

## Browser, native services and TXE scope

The SDK manifest inspected here is still bound to the old P04 lock3394619…, not the new A02 lock. Its inputs contain none of elliptic, ethers-v5 signing-key, OTelcore or Jaeger. This is **historical build evidence only** until root rebuilds and binds the new manifest; do not label the old bundle a current A02 exclusion.

Native services import installed modules and can load OTel via configured collectors. Their actual config/global state matters; npm production membership alone neither proves nor disproves vulnerable execution. Each claimed release exclusion needs a test of the supported launch path and a constraint that release packaging/startup actually enforces.

TXE ships bundled chunks as well as external module imports. In the inspected2,153,363-byte `chunk-C2WBKKGS.js`, source markers identify47 OTel API module occurrences, but none for core or Jaeger; searches also found no JaegerPropagator, W3CBaggagePropagator, suppression-key or URI-decoding marker there. The word Baggage appears in API code and does not establish the vulnerable core implementation is embedded. This bounded observation corrects any inference that all installed advisories are embedded in that chunk. It is not a complete bundle inventory or reachability proof, and npm overrides cannot patch arbitrary prebundled copies. Final tooling review must bind exact chunks/imports and isolate TXE as a test-only local service using disposable identities, rather than expose it as a public production endpoint.

## Review acceptance still pending

1. Decide and qualify the narrow Jaeger-only fix before relying on high-advisory exclusions.
2. Bind actual telemetry tests to all supported launch configurations, including prior globals and custom carriers, with real normal controls.
3. Give core and elliptic explicit implemented scope/patch decisions and independent disposition; keep inherited entries traceable.
4. Rebuild under the final lock/runtime, bind browser/native/tooling inventories, and preserve raw advisory findings. Release gates remain open where controls or external review are missing.

## Read-source fingerprints

- `package.json`: `981d1674b936fc2eeae1b0a110ed692089ea4bc394d43e4805af9d9421175f5c`
- `package-lock.json`: `76ca167b648fb88a3fce3e0ebe799fbf9454fd07ac7cb292e267dba9f9a3e6b7`
- `node_modules/@aztec/telemetry-client/dest/start.js`: `816125d852576427ce9704b6f62afc44fc66588d8fe248387d616a8ef5bc1a5a`
- `node_modules/@aztec/telemetry-client/dest/otel.js`: `0592ace09ed6a6ef000d3a895ddc7395502aac2587e9e877504fcf06f6951387`
- `node_modules/@opentelemetry/sdk-trace-node/build/src/NodeTracerProvider.js`: `12ec94c695a3d456bc04a207b153f0119d01e45f2f35955adbd43ccde9f0492a`
- `node_modules/@opentelemetry/sdk-trace-base/build/src/BasicTracerProvider.js`: `abb2878453688c3dcc86895963c859924deddb392b70d4811871a2fbceedf789`
- `node_modules/@opentelemetry/core/build/src/baggage/propagation/W3CBaggagePropagator.js`: `86a596cb73dc0fdaf53571c90cf80bd466b5d896002fa4122ce9ff25b4980c6d`
- `node_modules/@opentelemetry/core/build/src/trace/suppress-tracing.js`: `d7ad89ce85f3c0b36dbdf0ccfa523ce51611349780ff5e7c4f6f2e9a6765ab4d`
- `node_modules/@opentelemetry/api/build/src/context/context.js`: `eabb015f18d03ba371959f0990ae55a564134ed33004093e3f3455339f86ec48`
- `node_modules/@ethersproject/signing-key/lib/index.js`: `c6125296029a3c7b0a5fe6b26c3ee023fcc6d704014a0d842c7e772aa836984b`
- `node_modules/@ethersproject/signing-key/lib/elliptic.js`: `6f1f90d9e9d4b7a51c1097604a3a1801b099eae5b6d83f5361c1963b013ffca9`
- `node_modules/@aztec/txe/dest/chunk-C2WBKKGS.js`: `c78583eed5b369dff61b96038dff8ae40d309c7fa69293818c30bfe2c19b120a`
- `.build/sdk/sdk-manifest.json`: `646a5c21a95e74e7a1cae46858752db8f4eb976530f895bed0961e151e6631d6`
