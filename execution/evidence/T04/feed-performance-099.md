# Public reader qualification

The initial page query rebuilt and sorted all cached events. A restored-history getter regression failed with32historical payload reads across two pages. Projection is now cached after validation and successful persistence, and contiguous publication order permits direct page slicing. Reorg invalidation, snapshot cursors, failed-save atomicity and defensive copies remain intact. Sync still validates/projects/serializes complete cached history; this does not establish incremental sync CPU/storage complexity.

Run098 failed before measuring because the synthetic fixture allocated duplicate zero-padding strings past its128MB heap. Matching macOS crash report identified V8OOM; sharing immutable canonical zero fields reduced the10000-record fixture to41.8MB measured heap. No limit/history/threshold change.

Run099 passed in71881ms, peak873472KiB, with full cleanup. Actual built Chromium 153.0.8010.12, Apple M4 Pro, 25769803776bytes host RAM. Controlled synthetic RPC data, actual public source/index/IndexedDB.

- Thirty100-post API pages from10000posts: p50 0.100ms, p95 0.200ms, max 0.300ms. Full normal-RPC hydration took5463.1ms and is excluded from query timing; DOM is excluded.
- Thirtyfresh browser contexts,55-post history and50rendered posts,20Mbps/100ms Chromium network emulation: p50 2102.4ms, p95 2119.7ms, max 2119.8ms. Navigation/configuration/connect/render included; history fully synchronized. Not a10000-post cold-load claim.
- No wallet/proving assets or external requests. Normal mobile/escaped-content/CLI checks also passed.

69final affected component/artifact checks passed; application and harness-methodology reviews approved. Full samples and source hashes: feed-performance-099.json. This is Chromium bundled-engine qualification, not installed stable-browser coverage or application-proof performance.
