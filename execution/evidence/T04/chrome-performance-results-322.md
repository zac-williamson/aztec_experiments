# Chrome proving performance — completed sample

All 30 predeclared runs passed: one cold and one warm post per run, with both messages and private fees verified. Every run cleaned up its processes and temporary files. No failed or missing samples were replaced, and pilots were excluded.

| Measurement | Median | 95th percentile | Maximum |
|---|---:|---:|---:|
| Cold initialization plus proof | 37.73s | 37.90s | 37.93s |
| Warm proof | 35.60s | 35.78s | 35.90s |
| Cold proof only | 36.20s | 36.38s | 36.38s |
| SDK readiness | 0.75s | 0.82s | 0.83s |
| Cold button-to-result time | 51.31s | 54.01s | 54.04s |
| Warm button-to-result time | 52.79s | 53.02s | 53.18s |

The predeclared limits were 180 seconds cold and 90 seconds warm at the 95th percentile. Both passed. The longest complete run took 308.66 seconds; peak aggregate memory was 3.13 GiB, within the 540-second/4-GiB supervisor limits.

Scope: installed Chrome153.0.8010.52 on Apple M4 Pro with24GiB memory. Each cold observation used a new browser process/profile; the warm observation reused that wallet. Assets were local and OS caches were not flushed. These results do not measure public-network latency, prove other browsers/devices, or complete production readiness.

All 115 recorded input hashes, browser version, hardware and fixed fee settings matched the predeclared manifest. Percentiles use the 29th ordered sample of30; median averages the central two. Raw observations remain in chrome-performance-summary-322.json and its30 referenced reports. Independent review by application_change_review recomputed all eight distributions and verified every report, slot log and manifest binding; approved.
