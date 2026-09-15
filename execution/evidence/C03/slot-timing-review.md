# Slot mismatch diagnosis — bounded source review

First contention run application-800a4756 records expectedN/gotN+1 pre-proposal failures (including42→43 through50→51) and all ten proofs submitted around480.9s, then the540s deadline. It does not establish a proving or gas failure. The old sanitized log omits the numeric original clock snapshot and publisher check timestamp, so no exact setup duration can be recovered.

Pinned sequencer takes `epochCache.getEpochAndSlotInNextL1Slot()` once in `getSlotContextInNextL1Slot`, then adds the pipelining offset1. It performs asynchronous proposer/escape-hatch/sync/publisher-construction/simulation-plan work before calling `publisher.canProposeAt`. The publisher uses the same EpochCache L1 constants and injected dateProvider, recomputes next-L1-slot time, then adds configured Aztec slot duration12s. Crossing a boundary between those snapshots explains the mechanical N+1 result; it does **not** establish at least12s elapsed, since a short delay near a boundary suffices. The available record does not identify which stage crosses it or whether local clock adjustment contributes.

The mining helper performs one ordinary evm_mine then waits1s; its tick only waits for the background loop. It uses TestDateProvider (wall time plus offset), moving forward only when latest mined timestamp is ahead. No extra tick-triggered mining or forced roots occur there. This source behavior alone is not evidence of observed coherent clocks throughout the timed-out run.

Smallest next read-only instrumentation, if another run is needed: subscribe on `node.getSequencer().getSequencer()` to actual installed `state-changed`, `preparing-checkpoint` and `proposer-rollup-check-failed` events. Record bounded enum states, numeric targetSlot/checkpointNumber/failure slot, event monotonic elapsed time, dateProvider.nowInSeconds and current epoch-cache slot; optionally correlate existing mining lastTimestamp/maxObservedClockLeadSeconds. The state event supplies oldState/newState/secondsIntoBuildFrame/targetSlot; preparing event supplies targetSlot/checkpointNumber (omit archive or unneeded state data); failed event supplies reason/slot. PROPOSER_CHECK→preparing separates publisher/simulation setup, and preparing→failure covers the canPropose check. Earlier proposer/sync time is not individually exposed by these events: use bounded original log timing fields or a forwarding timing wrapper only if those measurements show it necessary. Do not replace return values or bypass the equality check.

No code changes, test runs or timing-setting changes by this lane. Cause remains unverified; the currently running instrumented attempt retains its approved deadline. Existing new durable contention receipts will separately distinguish failed execution from missing inclusion.

## Subsequent causal observation

Root reports the active cap1 run measured node clock1789440144 versus L1 timestamp1789440139 and repeated PROPOSER_CHECK around6.05s into the build frame, followed by initialization/checkpoint-empty without CREATING_BLOCK. The temporary progress file had already been removed when this lane attempted a compact read, so these numeric observations are root-reported pending the preserved report binding.

This is materially stronger than the earlier N+1 warning. With the existing1s initialization and2s subslots, actual deadlines are frame+3,+5,+7s; minBlockDuration1s makes frame+6 the latest viable start. Entry at6.05 necessarily fails selectNextSubslot. checkSync gates against the archiver's L1-derived synced slot before entering PROPOSER_CHECK, making a positive clock lead a direct mechanism for late entry.

Current miner sleeps1000ms after evm_mine/getBlock work and only adjusts TestDateProvider when L1 is ahead. If L1 timestamps advance at a fixed1s per block, RPC/work overhead causes the wall-clock-backed provider to accumulate positive lead. The reported5s lead matches this mechanism; the origin of the fixed Anvil interval itself was not independently established by this bounded source read. Setting TestDateProvider to each observed mined timestamp removes cumulative lead in the local fixture. This is not production clock handling and must not alter block timestamps, protocol checks, proof outputs or the parent's monotonic540s limit.

The proposed deterministic regression should include delayed iterations under fixed per-block timestamps and assert post-alignment lead is bounded rather than cumulative, plus existing normal/error mining cleanup controls. An actual successful follow-up application run remains necessary before claiming the repair resolves inclusion. No source edits or runtime by this lane.

## Applied clock repair review

Verified root's source change: the actual mining loop calls exported synchronizeC01MinedClock after each successful latest-block read; it records pre-sync lead then resets the injected TestDateProvider to the observed timestamp in either direction. The loop still mines one ordinary block, waits1000ms and supports its existing normal/error cleanup. No protocol or proof code is altered, and parent supervision uses monotonic elapsed time separately.

The maintained regression imports the actual SDK TestDateProvider and actual used synchronization function. Under mocked Date progression,300 fixed1s block advances with25ms overhead reproduce7s drift in the previous forward-only algorithm while every repaired sample is aligned to the block; a forward-warp control remains valid. This meaningfully tests the diagnosed mechanism rather than asserting a copied fixed implementation. Read recorded mining-clock-tests.log: one pass, zero failure/skip. I did not execute the test.

No correctness blocker found in this bounded test-harness delta. The final ten-author application run is still pending; the deterministic regression alone does not qualify inclusion or throughput. These new source hashes supersede the earlier source-bounded-blocks snapshot for this explicit timing delta, without retroactively rebinding previous failed runs:

- `scripts/c01-client-mining.mjs`: `a10abf9d1798fac6ddae89a0f62ce2b3e30b9ddd69a77512d5f83f8dc33ff332`
- `scripts/test-c01-mining-clock.mjs`: `3c26b160afd86ad1cce564fac86deb3bd768fd5c827c224da3169fc980641e71`
