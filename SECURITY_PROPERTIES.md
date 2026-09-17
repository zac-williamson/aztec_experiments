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

The historical Lean/Verity files under [fv](fv/README.md) are explicitly retired.
Their vacuous propositions, inconsistent hash assumption, unpinned external build
and obsolete state/message models provide no current assurance. In particular,
the old master unlinkability claim is withdrawn: equal hand-selected observer
projections of arbitrary states do not prove anonymity of reachable transactions.
Private-fee funding, timing and host/RPC observations remain relevant.

T01 adds bounded executable transition models alongside actual contract tests.
These are finite checks with recorded assumptions and deliberately broken controls,
not machine-checked proofs or a proof of compiler/implementation equivalence.
Only source-bound executed results recorded in T01 evidence count as completed
verification; independent review and remaining release gates are unchanged.
