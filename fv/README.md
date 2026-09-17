# Verification scope

The Lean and Verity files in this directory are **retired historical models**.
They do not establish security, privacy or production readiness of the current
application. Warning headers mark every retained `.lean` file. Old proof bodies
remain available for inspection; their comments and theorem names are not current
claims. No Lean/Verity build was run as part of this retirement.

The repository does not contain a pinned, self-contained Lake project/toolchain
for these historical imports (`Contracts.Common` and the external Verity tree).
Previous statements that everything compiled, was DONE, or had zero `sorry`s
are withdrawn as present-day evidence. Absence of `sorry` would not cure vacuous
propositions, inconsistent assumptions or mismatch with the implementation.

[The disposition](notes/SECURITY_PROPERTIES_FORMAL.md) identifies concrete defects.
[The plan](PLAN.md) specifies the replacement boundary. Maintained executable
finite models live under `model-checks/`; their source, explored bounds, reachable
transitions and intentional bad-model controls must be recorded in T01 evidence.
They are bounded executable checks, **not machine-checked mathematical proofs**,
cryptographic proofs or compiler-equivalence proofs. Their mere presence is not
an executed pass.

Authoritative implementation: `billboard/billboard_contract/src/{main,lib}.nr`,
`billboard/portal/src/{BillboardPortal,PortalMessages}.sol` and the current private
fee contract/client path. Contract suites and genuine application transaction
checks remain separate evidence. Independent review and release gates remain.
