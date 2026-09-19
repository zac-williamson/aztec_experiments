# Shared wallet and deployment failure handling

Remove the remaining generic retry functions and node proxies from the shared
browser wallet adapter and deployment engine. Simulation and registration now
make one call; failures propagate. Exact-transaction receipt reconciliation,
explicit Ethereum recovery and actual readiness polling are unchanged.

The shared UI time helper now uses only the pinned BlockResponse header timestamp
and requires an explicit node. It accepts zero and rejects invalid/non-safe time.
The two actual UI callers already pass their current node.

Before-fix regressions077 reproduce repeated simulation and wrong timestamp
selection. Receipt/scope/deployment-activation checks077:100/100 pass. Independent
reviewer webkit_failure_review approved source and tests; stale retry comments
were corrected. App build077 passed.

Additional deployment recovery checks077 exposed an old test fixture missing the
CREATE2 proxy runtime that production preflight already requires. Supply that
runtime separately; portal-corruption cases continue corrupting only the portal
so they reach their intended guard. No production validation changed. Independent
review approved the fixture correction; deployment recovery078 passes33/33.

This is component and build evidence, not a replacement for real transaction
qualification of the final release candidate.
