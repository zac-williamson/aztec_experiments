# Feed request cancellation test repair

The current alert suite failed its hanging-HTTP test in operations-checks-045.log.
Independent read-only instrumentation found three request-bearing sockets closed
within 159–160 ms after the configured 150 ms timeout. Node fetch then opened one
idle replacement socket carrying zero requests. The old assertion waited for the
whole server to close, conflating idle pool connections with uncancelled requests.

The test now records close promises when actual requests arrive, requires all
three requests to close within the unchanged 1,000 ms bound, and still requires
FEED_LAG_UNKNOWN with no zero-lag claim. Its awaited cleanup closes every remaining
server-owned connection. Production transport was unchanged by this repair.

All 21 current escrow/health/feed checks passed in 755 ms in
operations-checks-046.log. scheduler_improvements independently reviewed the final
test and confirmed that actual cancellation assertions and cleanup remain intact.
