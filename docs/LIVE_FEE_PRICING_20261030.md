# Live fee pricing — 30 October 2026

Status: candidate `82d3414c` is pushed and sealed on the application server;
clean CI passed, but publication is pending the installed real-testnet gate.

The signup blocker compared current minimum fees to a deployment-time configured
price and required a site update when that static price was lower. Fresh actions
now derive fee prices from the native node. Gas-unit limits remain separate from
prices. Existing approved budgets remain binding; a required increase produces a
new quote rather than silently spending more. SDK preparation, signup, top-ups,
worker metadata and registration checks were audited together.

The separately investigated gateway applies full private-state readiness inspection before
fee-only reads. Normal inspection reads node identity, chain tips, world-state
status, the L1 sync timestamp and canonical block anchors. An optimization is
retained on `codex/fee-gateway-fast-path-20261030`, but is **not included in this
application release**. Gateway source remains identical to the live baseline.
The measured gateway overhead was milliseconds; it did not explain the long
connection stalls below. This deployment changes neither contracts nor node
infrastructure.

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

The installed app preparation step now accepts an independently built SDK from
a root-owned revision directory, verifies every declared output, and checks all
source inputs against the candidate before sealing it. The rebuilt SDK has
2,115 input hashes and 71 outputs; only the two intended fee-pricing source
inputs differ from the live baseline. The three checked-in browser SDK consumers
were refreshed in `82d3414c` after CI correctly rejected their stale bytes.

Remaining: complete the installed release gate, including
fresh ETH and USDC signup and actual Aztec posting, before publishing. No gateway
or contract change is necessary for this pricing fix.

## Release execution

Full CI `41053416243` passed for `82d3414c`, including clean builds, byte-for-byte
reproducibility and the committed SDK consumer checks. The first installed
journey passed ETH signup, post, reply, paid like and reload, then timed out at
`bok-reply`. It did not reach USDC signup and did not promote the candidate.

The exact Bok error was `BB_OPERATOR_FEE_BALANCE_INSUFFICIENT`. Its public
FeeJuice balance was 13.2845318755286 FEE, below the SDK's full transaction
reservation at the then-current network price. This was not a depleted user
balance or the removed static signup-price gate. An operator-only top-up bridged
200 testnet FEE and claimed them using the existing `claim-fees` command:

- Sepolia deposit: `0x1c3bdaf951eb53200b234086de8b83acdf1c785597e44a03144b62f3723b9dbe`.
- Aztec claim: `0x0a75d98a1f71e71e26f8b449d0e72eb3746d12e170ce7716f923d84f66aebfad`, checkpointed.
- Observed operator balance afterward: 208.4361010830244 FEE.
- Bok completed the blocked reply and returned to ready with zero active work.

The empty repository allocation used by the disposable reply-only check was
released after confirming its remote branch remained at the original commit,
with no generated revisions. No GitHub content or application contracts changed.
Release workflow `41057436972`, attempt 2, is rerunning the genuine journey.

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

## Fresh browser and control-site investigation

On the unchanged deployment,12 independent browser contexts created fresh
connections successfully; fee reads took219.66–333.41ms. Another20 fresh contexts
were captured with Chromium's network log: all20 TCP connections succeeded on
their first attempt in110–128ms, including all four CDN addresses. There was no
hidden connection racing or retry masking a timeout in these samples. Fee reads
were217.28–359.21ms (mean235.86ms). Every response was valid. All owned browsers
and contexts were closed.

Interleaved raw TCP probes recorded2/20 timeouts for the main distribution,0/20
for stage, and3/20 for unrelated aws.amazon.com. The prior server-originated
comparison had0/16 timeouts against the main distribution's same four addresses.
This does not establish a faulty application distribution or permanently broken
CDN address. The exact network component dropping intermittent connections is
not identified.

The15/25-second waits belong to the Python diagnostic's per-connection timeout,
not a CloudFront response setting or the browser application's flow. Python's
sequential address attempts amplified failed connections into long diagnostic
wall times. Use actual browser request timings and preserve DNS/connect/TLS/TTFB
phases when diagnosing latency; do not report an untraced urllib wall time as
application execution latency. No endpoint, retry policy, node or infrastructure
configuration was changed based on the unproven CloudFront-fault hypothesis.

[Fresh-browser and control evidence](../execution/evidence/G21/stable6/live-fee-pricing/fresh-browser-and-control-trace.json).

## 2 November resumption

The second installed release attempt passed ETH signup, post, reply, paid like,
reload and Bok, then exhausted the shared nine-minute journey budget during USDC
signup (`RELEASE_JOURNEY_TIMEOUT`). The prior diagnostics did not record which
USDC substep was active. The candidate was not promoted; live remained `6e5f02ab`.
The next UI candidate includes these pricing fixes and adds sanitized signup
substep timings. Do not infer an on-chain payment failure from this watchdog.
