# P01 acceptance

Documentation validation only; no product behavior is claimed fixed.

- All twelve requirements have actor/invariant, failure behavior, planned test IDs and graph owners in product-spec.md.
- State transitions cover configuration through actual L1 payout, with explicit receipt/reorg state.
- Economic default uses checked ceiling cooldown, at most M saved posts, and expired debt for all exits; protocol implementation remains C05.
- Chain/RPC/host/sponsor threat boundaries and honest anonymity limits are explicit.
- Measurable workload, browser, recovery, model quality, service availability and 336-hour soak budgets are recorded before candidate measurements.
- Operator/budget/policy/reviewer/target inputs are explicitly assigned external gates; no current input blocks P02.

Validation: standard-library assertions checked REQ01–REQ12 and planned scenario families, workload and soak references. Passed. Actual implementation tests will be created and run in downstream packages.
