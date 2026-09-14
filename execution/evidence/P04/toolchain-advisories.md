# P04 dependency advisory snapshot

The pinned Aztec 5.2.0 upgrade retains upstream dependency advisories. `npm audit --json` reported 84 affected packages (14 low, 62 moderate, 8 high); `npm audit --omit=dev --json` reported 46 (39 moderate, 7 high). These counts include propagated effects and are not counts of distinct vulnerabilities or confirmed exploits.

No audit fix, package override, or release-family downgrade was applied. Some automatic suggestions would replace Aztec 5.2.0 with 0.79.0; those suggestions are incompatible with this matched release migration. Root will carry residual review into release dependency work.

| High-severity affected package | In npm production tree | Example shortest runtime path |
| --- | --- | --- |
| @aztec/telemetry-client | yes | @aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client |
| @opentelemetry/host-metrics | yes | @aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/host-metrics |
| @opentelemetry/propagator-jaeger | yes | @aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/sdk-trace-node → @opentelemetry/propagator-jaeger |
| @opentelemetry/sdk-trace-node | yes | @aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/sdk-trace-node |
| systeminformation | yes | @aztec/pxe → @aztec/bb-prover → @aztec/telemetry-client → @opentelemetry/host-metrics → systeminformation |
| tmp | no | Development tooling only in this lock |
| undici | yes | @aztec/foundation → undici |
| ws | yes | @aztec/aztec.js → viem → ws |

The JSON classification records each advisory object, affected version range, exact installed node path/version, npm dev marker, and shortest paths from runtime and development direct dependencies. Runtime paths were resolved from package-lock dependency/optionalDependency edges; peer edges are not enumerated. A production-tree dependency is not necessarily bundled into browser code or reachable through an application operation. Actual exploitability, browser inclusion, and any safe backport still require assessment.

`npm explain` on the eight high-severity packages exhausted its default 4 GiB V8 heap; no output from that attempt was counted. The bounded lock traversal supplied the paths above. Both npm audit queries exited 1 because advisories exist, not because retrieval failed.

Sources are the fresh npm registry advisory responses saved in `toolchain-npm-audit.json` and `toolchain-npm-audit-production.json`.
