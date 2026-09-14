# A02 dependency remediation handoff

Six exact overrides are installed: systeminformation **5.31.7**, ws **8.21.0**, undici **6.28.1**, tmp **0.2.7**, qs **6.16.0**, uuid **11.1.1**. Root engine floor is now `>=24.21.0 <25`. All Aztec and Noir package-lock entries are unchanged. Package/lock/node_modules are stable for integration tests; this lane does not claim A02 acceptance.

## Decisions and installation

`package-lock.before.json.gz` preserves the original complete lock (deterministic gzip); `package.before.json` preserves the original manifest. `pre-install-context.json` binds the actual consumer sources examined. Overrides intentionally constrain these named packages across the dependency tree without changing their owning Aztec versions.

Undici crosses foundation's `^5.28.5`; inspected code uses Agent/request POST and documented response body/header APIs. UUID crosses gaxios/teeny-request's 9.x ranges; both actual parents only use CommonJS `v4()` with no arguments, which remains available and passed a basic call/validation check. tmp crosses external-editor's `^0.0.33`; the caller uses `tmpNameSync(options)` then writes/reads/removes its file. qs crosses express's `~6.15.1` while remaining within co-body's `^6.5.2`. Systeminformation and ws override exact parent pins within the same major. These choices require the actual consumer behavior tests assigned to the other lanes; basic shape checks alone do not qualify compatibility.

Initial installation used pinned Node24.15/npm11.12.1 with scripts disabled, no audit/fund, credential-free configs and a public registry. It exited0 in2s. The expected engine warning reflects the newly raised engine floor before the runtime lane finished. The existing abitype0.8.11/zod4 peer warning is recorded, not silently fixed by an unrelated dependency change. Follow-up tmp installation also exited0. Both commands and complete sanitized stdout/stderr are preserved. No lifecycle scripts, force audit fix, broad package upgrade, or Aztec downgrade ran.

The first fresh post-install audit exposed GHSA-7c78-jf6q-g5cm, specific to tmp0.2.6 and therefore absent from the old0.0.33 inventory. The [publisher advisory](https://github.com/raszi/node-tmp/security/advisories/GHSA-7c78-jf6q-g5cm) identifies non-string path-option coercion bypasses and names0.2.7 as patched; the [0.2.7 release](https://github.com/raszi/node-tmp/releases/tag/v0.2.7) was verified. I applied that narrow follow-up and preserved the intermediate lock and first audit rather than rewriting history. Maintained regressions should include normal creation/read/cleanup and non-string prefix/postfix/template rejection within disposable directories.

## Exact final delta and checks

`final-lock-delta.json` records ten changed lock entries: root metadata; five package version updates; removal of nested ws8.18.3 in favor of existing root8.21.0; redundant nested qs6.16.0 removal; and obsolete @fastify/busboy/os-tmpdir removal. No other package-lock entry changed. `final-patched-installed-paths.json` verifies all six package names have exactly the expected installed and locked versions, with tarball integrity and source URL.

On the runtime lane's publisher-checksummed Node24.21.0 (embedded Undici7.29.1), `final-basic-api-shape.json` records successful UUID CommonJS v4 calls through both parents and presence of expected tmp, Undici, ws, qs and deep networkStats exports. No RPC/network/prover operation is involved in those shape checks. The npm override does not patch Node's embedded networking implementation; the separate runtime qualification remains necessary.

## Fresh final advisories and pending work

| Scope | Before | Final | Remaining severity counts |
|---|---:|---:|---|
| All dependencies |84|49|11 low,36 moderate,2 high,0 critical|
| Production (omit dev) |46|20|0 low,18 moderate,2 high,0 critical|

Final audits used Node24.21.0 and its bundled npm. Both returned valid JSON and exit1 for findings, not API/tool failure. `final-audit-context.json` records commands/times and unchanged manifest/lock hashes. All six overridden packages are absent from the final reports. Portal locks were unchanged; their same-day zero-audit preparation remains separately recorded and is not presented as a new portal run.

The two remaining high package entries are propagator-jaeger1.30.1 and its inherited sdk-trace-node1.30.1 entry. Core1.30.1 plus seven nested1.28.0 copies retain the moderate W3C Baggage advisory. These need the independently assigned OTel configuration/actual extraction tests and a compatible fix or explicit independently reviewed deployment exclusion. Do not blindly override the whole OTel major. A low elliptic6.6.1 advisory and inherited dev tooling entries remain; no patched elliptic version is reported, so tooling scope or a supported parent replacement requires explicit disposition. Every final affected node/version/parent constraint and via chain is retained in `residual-inventory.json`.

Further required integration checks: actual foundation transport including gzip/errors/timeout/cookies; ws transport behavior; HostMetrics deep import and enabled/disabled telemetry; external-editor safe temporary-file behavior; UUID parent multipart behavior; actual query parsing/serialization; patched Node native/browser SDK and build/lifecycle qualification; regenerated source/lock-bound reproducible artifacts. Installed @aztec/txe also contains bundled chunks: npm lock overrides alone do not certify embedded copies. The root/independent lanes must disposition supported runtime versus tooling/bundled scope. No reachable-high exclusion or production release clearance is asserted here.

Final source binding:

- `package.json` SHA-256 `981d1674b936fc2eeae1b0a110ed692089ea4bc394d43e4805af9d9421175f5c`
- `package-lock.json` SHA-256 `76ca167b648fb88a3fce3e0ebe799fbf9454fd07ac7cb292e267dba9f9a3e6b7`

The maintained `test:dependencies` command now runs `node --test scripts/test-dependency-*.mjs`. This script-only addition does not change the package lock; earlier audit contexts retain their original manifest hash and remain valid for that exact lock.
