# Coupon delivery harness review — 2026-09-15

Read-only AI review of the frozen harness before/during genuine run `genuine-coupon-delivery-001.log`. No processes or tests were launched by this reviewer. The run's result is separate evidence; this review does not claim a successful transaction or failure-path cleanup.

## Findings

No normal-path API blocker found. Installed Aztec 5.2 `Contract.at` is synchronous; the actual EmbeddedWallet/BaseWallet exposes `getChainInfo`, `registerContract` and `simulateTx` used by `readRegisteredSponsorBatch`. The provider returns canonical coupon strings accepted by `prepareSponsoredAction`. The bridge now passes `ready` and `rollupAddress`; claim, posting and exit retain their sponsored callbacks and actual proven fee-payer assertions. The registration promise has an immediate rejection handler and is awaited for its final disposition.

**Open timeout lifecycle gap:** `scripts/w01-coupon-delivery.mjs:48` supplies a callback that ignores the provider's abort signal. The provider races that callback against its 60-second deadline. If registration finishes after that deadline, acquisition promises have already settled, but their callbacks resume after `await registration` and start real registered-state reads. Awaiting only acquisition and registration therefore permits these reads to overlap the sponsor wallet's teardown. A normal-path success does not exercise or close this gap. Root acknowledged it and retained source freeze during the current run.

Evidence construction includes public batch/root/counters and request field names, not token or leaf values, blinds, encryption keys or account secrets. Account and action callback are non-enumerable on the sponsor observation. This is one disposable author with two separate encrypted stores and in-memory encryption keys. It does not qualify production scheduling, restart/key recovery, arbitrary concurrent client traffic or timeout cleanup.

## Minimal repair after the frozen run

1. Accept `{batchId, signal}` in the registered-state callback and retain every callback promise in an owned collection. Attach a rejection handler immediately, without replacing the promise whose final disposition is awaited.
2. Inside that owned promise, await registration, then check `signal.aborted` before beginning any state read. Check again after the read before returning it. Abort prevents new reads after a timeout; it does not imply cancellation of an already-started SDK read.
3. In `finally`, await registration's disposition and then `Promise.allSettled` of owned callbacks before allowing the caller to stop the wallet. Keep HTTP/SQLite cleanup independent so one cleanup error cannot skip the others. Do not claim that closing a socket cancels arbitrary asynchronous handler work.
4. Preserve the acquisition deadline and the parent process deadline. Do not silently extend proof deadlines or introduce unowned background retries.

## Focused regression strategy

Exercise a maintained callback/lifecycle helper through its actual API, with deferred promises and harmless injected state reads; do not source-slice the harness or launch a chain.

- Normal control: registration completes, one real helper call is delegated, result returned, then cleanup completes.
- Abort before registration completes: complete acquisition timeout, release registration, and assert no state read starts and cleanup waits for the callback's disposition.
- Abort during a started read: retain the deferred read, assert cleanup remains pending until it settles, then assert the aborted callback does not return a usable result.
- Registration rejection: no state read, no unhandled rejection, all owned callbacks settle and cleanup completes.
- Two simultaneous callbacks: allow one to finish and keep the other pending; cleanup must wait for both. Include read rejection to verify resource cleanup still runs.

Use a bounded test deadline and assert no remaining owned operation. The next required genuine replay/exit run can bind the repaired harness's normal integration; the focused regressions supply the failure-path evidence rather than repeating an otherwise identical successful chain run.

## Reviewed source hashes

| File | SHA-256 |
| --- | --- |
| `scripts/w01-coupon-delivery.mjs` | `9e6d41e1a7e159c70da2d8c4bfb1e44187a1449cea5bd5748cc4e1c5ea9ec2c1` |
| `scripts/w01-sponsor-flow.mjs` | `53103e52659dada0fac6ccc7063bbe133bb10769efcb2825c775bb87d38fc8e6` |
| `scripts/c01-bridge-flow.mjs` | `65826415026862cb1950d14d955100743ad0d1784ef4e08bf1a1498e67218d0e` |
| `shared/sponsor-coupon-provider.mjs` | `1cd0894cf08a6d3d4458453cf314778bf6b91b25183902a9574f7fee6da437a7` |
