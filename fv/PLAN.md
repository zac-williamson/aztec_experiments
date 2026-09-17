# Verification plan and retirement decision

The earlier DONE/master-privacy/master-safety progress report is retired. No
historical theorem count is a current acceptance result. See [README](README.md)
and [concrete disposition](notes/SECURITY_PROPERTIES_FORMAL.md).

T01 uses two separate evidence classes:

1. Actual pinned Noir/Solidity tests, including adversarial transitions and genuine
   application proofs where required. Controlled local bridge settlement is stated
   explicitly; no local network epoch prover is required.
2. Small executable finite transition models for bridge conservation and screening.
   Start from valid initial states; explore only defined reachable transitions;
   include rejection/rollback and intentional bad-model mutations that violate the
   checked invariant. Record exact bounds, runtime, source hashes and counterexamples.

The finite models do not certify Solidity/Noir correspondence. Independent review
must compare their transitions/assumptions against actual code and inspect omitted
state dimensions, fee observations, cryptographic boundaries and compiler warnings.
No privacy theorem is claimed from hiding fields in a hand-selected observer view.

A future Lean/Verity replacement would require a pinned toolchain and dependency
lock, reproducible checked build, non-vacuous propositions, consistent cryptographic
assumptions, explicit reachable-state predicates, actual message transcripts and
fee/observer model, and reviewed correspondence to the current source/artifacts.
It is not necessary to port obsolete models merely to inflate proof counts. No
Lean install or build is claimed in this work package.
