# Billboard — Security and Privacy Requirements

The previous document described an older experimental revision and contained
claims contradicted by the production-readiness assessment. It is retained in git
history; it must not be treated as assurance for the production candidate.

The intended production behavior is specified in
[the production specification](execution/product-spec.md), including actors,
state transitions, fee privacy, exact cooldown/exit semantics, test IDs and
measurement budgets. [The requirement catalog](execution/requirements.md) and
[execution graph](execution/GRAPH.md) define release acceptance.

No application invariant is newly certified by this documentation change.
[The risk register](execution/risk-register.md) records open findings. Actual
verification will be tied to source and artifact hashes in execution/evidence/
and independently reviewed before production sign-off.
