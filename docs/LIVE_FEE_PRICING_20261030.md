# Live fee pricing — 30 October 2026

Status: source implemented and independently reviewed; not yet published.

The signup blocker compared current minimum fees to a deployment-time configured
price and required a site update when that static price was lower. Fresh actions
now derive fee prices from the native node. Gas-unit limits remain separate from
prices. Existing approved budgets remain binding; a required increase produces a
new quote rather than silently spending more. SDK preparation, signup, top-ups,
worker metadata and registration checks were audited together.

The gateway mistakenly applied full private-state readiness inspection before
fee-only reads. Normal inspection reads node identity, chain tips, world-state
status, the L1 sync timestamp and canonical block anchors. Fee-only requests now
read the native fee cache directly using a separate SDK batching queue. Required
chain/version/rollup headers on that same response preserve network identity.
Mixed/state/send requests retain their prior policy. No extra fee cache, poller,
fixed price or clock-based readiness policy was added.

## Observations, not an end-to-end performance claim

Before publication, native node 6.0.0 on the current core host returned an83-byte
fee response in16.83ms on first observation, then0.49/0.42ms. Each other native
inspection RPC measured0.41–1.06ms in these three samples. The OLD local gateway
returned fees in23.77ms initially, then6.83/6.13/5.36/6.01ms. Six fresh public HTTPS
connections measured622.674/464.047/453.964/447.971/468.327/457.860ms. Connection
setup accounts for much of those public times. These observations do not explain
the earlier15.46s outlier, which has not been reproduced. Do not claim removing
inspection alone fixes that outlier or guarantees the0.5s target.

## Checks and remaining publication work

Focused integrated checks:1188 passed,1 skipped,0 failed (private query, fee
pricing, application, aggregate funding, opening and worker/UI boundaries).
The network-pricing SDK boundary tests also passed. The pinned SDK rebuild
succeeded after applying the repository's existing dependency bootstrap.
Independent fast_reply_review approved the current diff; flow_scope_efficiency
reviewed the fee path and found the shared SDK batching-queue coupling.

Remaining: publish the qualified prover source overlay, publish the rebuilt SDK
and app through the installed release route, run affected real flows, and measure
warm browser fee acquisition. The installed app prepare step currently copies
the baseline SDK and does not rebuild changed SDK source; its existing release
policy also requires separately qualifying prover changes. Resolve these actual
publication dependencies without weakening source/provenance checks or changing
contracts. No runtime or infrastructure mutation was made during this diagnosis.

## Follow-up: reproduced long stalls traced before HTTP

An instrumented Python urllib probe separates DNS, individual socket connections,
TLS, HTTP response waiting and body reading. Two of30 fresh requests took25.455
and25.558seconds: each spent25seconds timing out on a TCP connection before
trying another address successfully. No HTTP request was sent during that wait.

With a15-second connection timeout, a subsequent30.474-second request spent
15.001seconds connecting to3.175.81.187, another15.001seconds to3.175.81.28, then
connected to3.175.81.172 in112.9ms. TLS took116.8ms and HTTP response waiting
222.2ms. Independent raw TCP probes reproduced timeouts on the first two
addresses. This proves the reproduced stalls occurred before application handling,
not during gas-price computation or readiness inspection. It does not locate the
network fault within the client, intervening network or CDN edge.

The original untraced15.463-second observation is consistent with one15-second
connection timeout plus the normal request time; it cannot be definitively
attributed retrospectively. Earlier assertions that readiness caused it were
unsubstantiated and are withdrawn.

Thirty browser requests all succeeded over an existing HTTP/2 connection to
3.175.81.74: minimum215.850ms, average276.253ms, maximum523.915ms.29/30 were
below500ms. This is not a guarantee of the strict500ms target and does not
measure fresh-browser connection establishment. The owned browser was closed.

[Sanitized phase evidence](../execution/evidence/G21/stable6/live-fee-pricing/connection-trace.json).
Read-only independent review confirmed the phase attribution and these limits.
No application/server changes were deployed during this diagnosis.

The same four CDN addresses accepted16/16 direct TCP probes from the core server
in91.994–92.447ms. This comparison suggests a path-dependent failure; it does
not establish which network component dropped the client connection attempts.
