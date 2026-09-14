# A02 independent residual applicability and disposition review

Reviewed 2026-09-14 by `/root/artifact_regressions`, separately from package installation and root acceptance. This is internal AI review, not the external audit required for release. No new tests, services, package edits or application changes were performed in this review lane.

**The remaining moderate/tooling findings do not require a zero-advisory tree to complete bounded A02 remediation. They do require explicit retained-risk treatment and enforceable downstream acceptance.** The installed high Jaeger issue was actually fixed and behavior-tested. No broad clean-start-only exemption is needed for it. The remaining core and elliptic dispositions are appropriate for this work package with the concrete D01/T05 and audit handoffs now recorded by root and verified below. Their future controls are not implemented or release-qualified merely by writing a disposition.

## Current inventory and corrected chronology

The authoritative final reports are `dependency-remediation/jaeger-only/audit-{all,production}.json`, not the older files named `final-audit-*` in the parent directory. They report **48 package entries overall: 37 moderate, 11 low, zero high/critical; 19 production entries, all moderate**. Both audit commands returned exit 1 with valid finding reports. Counts include inherited dependency entries and are not counts of distinct application vulnerabilities.

All remaining direct advisory families are W3C Baggage in core and the elliptic implementation classification. The current lock hash is `4d7cbef3eb1a06797a08b0458ca7c0df93566efd72979573416d95c546372c93`. Final exact paths and package metadata agree with `jaeger-only/residual-inventory.json`.

The disposition draft correctly preserves its earlier Jaeger/no-install assessment as historical. Its annotation and the dependency handoff still say behavioral checks pending; that timing is superseded by `dependency-consumer-final-context.json` and the 31-pass log. Those prove exact SDK1.30/root-core1.30 versus Jaeger2.9/nested-core2.9 resolution, shared API, normal/custom propagation, malformed trace/baggage handling, old-core suppression and actual parent/preloaded-global registration. No package-wide compatibility inference replaces root's separate native/browser/build qualification.

## Core: exact affected copies and configuration limits

GHSA-8988-4f7v-96qf concerns **W3CBaggagePropagator.extract**, not TraceContext. The publisher identifies version 2.8.0 as patched and notes transport header limits reduce, but do not universally remove, the risk. [Publisher advisory](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf). The exact retained affected paths are:

| Installed path | Version | Current npm context |
| --- | --- | --- |
| `node_modules/@opentelemetry/core` | `1.30.1` | Production dependency |
| `node_modules/@opentelemetry/exporter-logs-otlp-http/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/exporter-metrics-otlp-http/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/exporter-trace-otlp-http/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/otlp-exporter-base/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/otlp-transformer/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/sdk-logs/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |
| `node_modules/@opentelemetry/sdk-trace-base/node_modules/@opentelemetry/core` | `1.28.0` | Production dependency |

Root core's actual inbound implementation joins/splits the header and creates baggage entries without the outbound byte/entry filtering; no size-exhaustion experiment was needed or performed. The additional Jaeger-owned core2.9 is patched but does not replace the eight paths above.

The successful actual Aztec startup tests establish a **specific current path**: enabled telemetry explicitly selects TraceContext and does not read a baggage carrier; clean no-op startup does not activate extraction. They deliberately set OTEL_PROPAGATORS to Jaeger/Baggage and verify actual global fields and behavior. This is stronger than a source-string assertion, but it cannot clear a different provider or prior global registration. Upstream no-op leaves earlier globals intact. Generic SDK instrumentation, custom carriers, enabled baggage or changed HTTP limits therefore remain contexts needing controls or a compatible fix. No production launch wrapper that enforces every such restriction was identified in the current application.

Disposition: retain this moderate family as documented work-package risk, not as absent or repaired. D01 must qualify every supported native process/entrypoint and enforce its actual propagation policy before handling untrusted work: TraceContext/Noop with incompatible prior registration rejected, or explicitly supported bounded Baggage extraction tested through each transport. A blanket environment-variable deletion or the word W3C is insufficient. O01 must use the same approved launch configuration in operator instructions; T05 must verify packaged startup controls and their negative cases on the final candidate. Enabling another instrumentation/collector profile, changing core/SDK resolution or changing header limits triggers renewed review.

## Elliptic: developer dependency with real cryptographic capability

`node_modules/elliptic` **6.6.1** remains dev-only in the exact lock via the ethers-v5 signing-key/wallet path used by Aztec CLI tooling. The retained GHSA-848j-6mx2-7j84 entry has no reported patched release. Its broad implementation classification does not establish a concrete application exploit in this review; no safe replacement version or external clearance is invented.

Actual `@ethersproject/signing-key/lib/index.js` constructs private-key pairs, signs digests and derives shared secrets through the elliptic wrapper. Thus dev-only membership cannot authorize using it with production keys. Current local qualifications use disposable identities and do not settle a real-key workflow's acceptability.

Disposition: retain low-severity tooling scope for engineering; D01/O01 must identify the exact supported deploy/recovery/signing path and exclude this affected ethers-v5 toolchain from real-key workflows unless replaced compatibly or explicitly dispositioned by the required external reviewer. T05 must inspect the actual release/runtime package and operator entrypoints rather than infer exclusion from npm omit-dev alone. A future need for this path with real secrets reopens that decision and its signing/format tests. This is a production support restriction to implement and test, not a claim that existing documentation already enforces it.

## Rebuilt browser and embedded TXE scope

The current rebuilt `.build/sdk/sdk-manifest.json` now has SHA-256 `984a5152e85656c5192a3e586209457856e54450dff6b9296ca1fa6c39c360ea`, binds the current `4d7c…` lock, and declares **1,361 inputs / eight outputs**. Independent read-only inspection found no input paths containing elliptic, @ethersproject, @opentelemetry/core or propagator-jaeger. This supersedes the draft's old-lock manifest observation for this new SDK. It supports this artifact's declared dependency boundary; it is not an inventory of every native tool, prebundled third-party asset or future release.

TXE retains minified publisher chunks whose internal code is not rewritten by npm overrides. Direct read-only inspection of `chunk-OFS2CI6U.js` finds qs source markers and an embedded parseArrayValue branch that splits comma strings before its subsequent limit check, plus a constructor.isBuffer helper that calls a truthy property without checking callability. These are precise static legacy-shaped code observations. No embedded package version was inferred, no source-sliced test was run, and no actual TXE RPC route reaching those operations was demonstrated here. Their presence must not be called patched solely because separately installed qs6.16 passed.

In the inspected `chunk-C2WBKKGS.js`, API Baggage vocabulary does not establish an embedded vulnerable core/Baggage propagator. Neither inspected chunk contains JaegerPropagator or W3CBaggagePropagator signatures. This bounded scan is not a complete bundled-software inventory or a proof of all code absence.

The current actual TXE bin explicitly calls its HTTP server with host127.0.0.1, and `scripts/test-noir.mjs` selects/probes a disposable loopback port and supervises teardown. That is an implemented local binding/lifecycle control. The runner still inherits process.env; it does not enforce a fully scrubbed telemetry/preload configuration. Do not describe it as a public production service or as globally environment-isolated. Keep TXE test-only with disposable identities. T05 must bind the complete included chunk/import inventory and fail packaging/support checks if TXE is exposed as a production endpoint or used with production key material without new qualification.

## Required acceptance handoff and release boundary

Root has now made these obligations explicit in `residual-release-register.json` and the graph. The current record does not claim their implementation. The acceptance linkage is:

- **D01-A05** owns a validated supported launch/entrypoint manifest and executable propagation/preload/configuration rejection (or the chosen bounded fix), plus the deploy/recovery tool selection that prevents accidental real-key elliptic/TXE usage.
- **O01** uses those exact supported paths in operator runbooks. New instrumentation or real-key tooling is a configuration change requiring renewed review, not an undocumented escape hatch.
- **T05-A05** owns final packaged dependency/bundle inventory and source hashes, exclusion/negative-launch controls, and a release manifest referencing every retained advisory, affected path, chosen treatment, owner and re-review trigger. It must reconcile current scanner/publisher evidence on the final candidate; naming a future manifest here does not create it.
- **X01/X02** receive this residual register, major-override compatibility evidence, complete relevant packaged sources and final delta. Required external review must disposition retained cryptographic/tooling risks and verify implemented scope. Internal AI review cannot replace that acceptance.
- **R04** remains blocked by the graph's incomplete production ancestors and must not treat A02 completion as production-release eligibility.

I verified that D01 now depends on A02; D01-A05 and T05-A05 exist and require actual launch/operator/package controls and final inventory/retest evidence. R01 actions require the exact residual register in the external review packet. The register hash matches its exact 48-entry advisory inventory, all eight core and the elliptic paths/versions match the final lock, and every criterion owner resolves. Required future release artifacts are expressly labeled uncreated. No dangling handoff, fabricated current control or weakened external gate was found. O01 already depends on D01 and must carry those supported configurations into runbooks.

A02 may finish its narrow remediation and explicit lower-severity treatment once its own current build/runtime/advisory criteria pass; the verified ownership handoff supplies the residual-treatment record without pretending the later controls exist. No additional broad OpenTelemetry major upgrade, removal of every moderate entry or speculative application rewrite is required solely by this review. Conversely, unsupported earlier Baggage globals, real-key elliptic tooling, or production exposure of TXE cannot be declared safe by a clean-start test or a future runbook promise. They remain release constraints until the assigned implementation, packaging tests and external disposition exist.

## Reviewed input hashes

The following hashes bind the review to actual inputs. Execution/graph handoff edits are owned by root and need their normal validation; this review does not mutate the graph.

| Input | SHA-256 |
| --- | --- |
| `execution/evidence/A02/residual-advisory-disposition-draft.md` | `aa427ffabe2848c649e5311851d077cf8998273105c92f6769a1756f4c98799f` |
| `execution/evidence/A02/dependency-remediation/handoff.md` | `17a2ad2d03520c8b3a82a6450ece3ca37aab491c8aa584772b81742530019284` |
| `execution/evidence/A02/dependency-remediation/jaeger-only/audit-production.json` | `64719bc48fb425b7fcc5cddca5226e3ae6c2557f6970aff121e5d3de6a1079ba` |
| `execution/evidence/A02/dependency-remediation/jaeger-only/audit-all.json` | `5e23cdeffb4a01e1eacc1804793e1bbc77137e0b5535ed091ba0055db26517d6` |
| `execution/evidence/A02/dependency-remediation/jaeger-only/residual-inventory.json` | `802aa742972ba22687211a65b3745ed2ce27bfa5afd6ab8e36fb5d1faf00671d` |
| `execution/evidence/A02/dependency-consumer-final-context.json` | `9639619bc81494c850767adabcec2e5a794a27ea6ee61c2a750ec53358d6f974` |
| `scripts/test-dependency-telemetry.mjs` | `54a5962e7f5ed7fe168a4af0b8daf5341242b5c4288bed68c73ebfdc2ffccd19` |
| `scripts/test-noir.mjs` | `28ca9bc10bfa1d02b25fee1f30a58ff950c1b13775b0a0bcdddd6d842141df45` |
| `node_modules/@opentelemetry/core/build/src/baggage/propagation/W3CBaggagePropagator.js` | `86a596cb73dc0fdaf53571c90cf80bd466b5d896002fa4122ce9ff25b4980c6d` |
| `node_modules/@ethersproject/signing-key/lib/index.js` | `c6125296029a3c7b0a5fe6b26c3ee023fcc6d704014a0d842c7e772aa836984b` |
| `node_modules/@aztec/txe/dest/bin/index.js` | `0f6a38a386a4328010b8dd0213c935ae6c2ba2fea92ee6ef361571ab8c5f03ef` |
| `node_modules/@aztec/txe/dest/chunk-OFS2CI6U.js` | `0b558a76ff71a43b33af2111cc951de01ebcf6a96fb1b4acac275e1992c1c7a5` |
| `node_modules/@aztec/txe/dest/chunk-C2WBKKGS.js` | `c78583eed5b369dff61b96038dff8ae40d309c7fa69293818c30bfe2c19b120a` |
| `.build/sdk/sdk-manifest.json` | `984a5152e85656c5192a3e586209457856e54450dff6b9296ca1fa6c39c360ea` |
| `execution/evidence/A02/residual-release-register.json` (review snapshot) | `c4eb9a5df183576c9d818f2cda103f9e8727685f21f7f69b47695793bae6abb9` |
| `execution/graph.json` (review snapshot) | `268f343b491a3dae1bfe41a09390ea2752e7aac123d7712aa1e9a6eb987ec382` |
