# Monitor failover drill implementation checkpoint

Implemented, syntax checked only; not built or live-qualified.

Files:
- `billboard/portal/test/MonitorRootPublisher.sol`: test-only subclass of the existing controlled root publisher; adds the version getter needed by the unmodified monitor. Canonical Inbox/Outbox are inherited; rollup proof verification is not provided.
- `scripts/o01-monitor-drill-transport.mjs`: read-method allowlist, bounded loopback HTTP forwarding, explicit 503 endpoint, tracked sockets/controllers and cleanup.
- `scripts/test-o01-monitor-failover-anvil.mjs`: prebuilt-package source identity checks, pinned normal-clock Anvil, real portal runtime/immutables, actual Ready activation and nonzero deposit, three actual packaged commands, independent canonical accounting and unchanged block/nonce checks. Fixed output classifications and stage names; no raw failures/secrets. Package is retained; owned fixture resources are cleaned.

Root integration sequence after the running browser job:
1. Build the new test fixture with the existing offline regression Foundry profile. Expected artifact: `.build/portal-tests/out/MonitorRootPublisher.sol/MonitorRootPublisher.json`. Keep release portal artifacts unchanged.
2. Build a fresh actual operator package outside the live drill budget using the pinned Node runtime and existing `packageOperator` flow. The drill requires exact current source hashes for the monitor, launcher and runtime-verification/configuration files, plus the packaged runtime's manifest hash.
3. Invoke pinned Node with `scripts/test-o01-monitor-failover-anvil.mjs <absolute-existing-package-root> <new-evidence-json>`. The command refuses an existing evidence output. It uses installed pinned `anvil` from PATH.
4. Inspect actual command exit/status, canonical accounting and cleanup. A source/syntax checkpoint is not a pass.

Proposed bounds implemented: 60-second fixture deadline, 15-second shared packaged-observation deadline, 3-second forwarded-request timeout, 64-KiB request / 1-MiB response caps, 16-KiB combined subprocess output cap. No browser, Aztec execution or proving is started. Root should supervise the first actual run under the normal resource discipline and retain measured timings.

Scope: real deployed portal accounting, unchanged freshness policy, real packaged command handling of unavailable transport and alternate transport to the same chain. This is controlled-root bridge setup, not genuine L2 activation qualification or independent-provider consensus. Separate journey evidence qualifies the genuine application lifecycle.
