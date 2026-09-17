# Finite model and historical claim review

Independent AI lane deployment_gap_review inspected the bounded transition
checker against current Solidity/Noir source and executed it. No concrete mismatch
was found within the declared domain. Posting guard now>=due is equivalent to
now>=max(due,max(0,now-1)) in its positive-cooldown domain. Two-successor maturity,
flag accounting and withdrawal debt guard match the inspected application.
Mutants change transitions and yield reachable traces; failures are not hardcoded.
Breadth-first first visitation is minimum depth, so deduplication does not remove
a shallower trace. Root added PortalMessages.sol and Python runtime to emitted
provenance, then reran:482 bridge states/1193 edges and4593 screening states/5384
edges, all three bad variants detected.

Scope remains finite, hand-written and separately modeled: no arbitrary-depth
proof, implementation equivalence, bridge/screening composition, cryptographic
proof, runtime soundness or privacy theorem. Source hashes document the reviewed
candidate, not equivalence. Historical Lean statements are explicitly retired,
including constant-hash/injectivity contradiction, True conclusions, unreachable
privacy witnesses, absent fee observations and obsolete portal state. No Lean
execution or formal proof pin is claimed. CPython version and standard-library
execution are recorded by the maintained replacement checker.

Compiler diagnostic reconciliation is separate and does not acquire assurance
from these models. The external Aztec/Solidity audit remains required.
