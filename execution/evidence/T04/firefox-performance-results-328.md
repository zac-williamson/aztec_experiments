# Firefox proving performance — completed sample

All 30 predeclared runs passed, each with a cold and warm post, canonical messages, exact private-fee accounting and complete cleanup. Pilots were excluded.

| Measurement | Median | 95th percentile | Maximum |
|---|---:|---:|---:|
| Cold initialization plus proof | 29.90s | 30.21s | 30.64s |
| Warm proof | 27.79s | 27.96s | 27.97s |
| Cold proof only | 28.69s | 28.94s | 29.38s |
| SDK readiness | 0.83s | 0.92s | 0.94s |
| Cold button-to-result time | 40.97s | 45.93s | 46.01s |
| Warm button-to-result time | 39.62s | 39.80s | 39.87s |

The predeclared 95th-percentile limits are 180 seconds cold and 90 seconds warm; both passed. The longest complete run took 272.26 seconds; peak aggregate memory was 3.30 GiB, within the 540-second/4-GiB limits.

Firefox155.0 on Apple M4 Pro with24GiB; fresh browser/profile per run, same wallet for warm post. Local asset server; OS/asset caches not flushed. No claim about other browsers/devices or production-network latency.

All 115 input hashes, browser version, hardware and fixed fee settings matched the manifest. The 95th percentile is the 29th ordered observation of 30; median averages the central two. Raw observations are retained in firefox-performance-summary-328.json and its referenced reports. Independent review by application_change_review recomputed all eight distributions and checked every raw report, predefined log and manifest binding; approved.
