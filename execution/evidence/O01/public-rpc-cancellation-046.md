# Rejected public RPC responses release their bodies

The request-cancellation investigation found a separate production transport defect:
HTTP 503 and oversized Content-Length responses were rejected immediately, but
publicRpc cleared its timer without aborting the unread response body. Independent
instrumentation observed the original request socket still open after 350 ms with
a 150 ms configured timeout. This was not an idle replacement connection.

Root added controller.abort() to the existing finally block. There is no new
transport, retry or fallback. Actual HTTP regressions for both cases fail on the
old source (public-rpc-before-046.log), then pass on the repair. The original request
socket must close before fixture cleanup. Combined feed/RPC tests passed 25 checks
in 459 ms (public-rpc-after-046.log). The tests use the existing 1,000 ms closure bound.

scheduler_improvements reviewed the exact production and test change independently
and found no blocker. Applications and operator package were rebuilt. The packaged
moderator proof/recovery qualification045 predates this isolated read-only transport
fix; its transaction path is unchanged. The affected transport is qualified by the
actual HTTP regressions; final release verification must bind all checks to one candidate.
