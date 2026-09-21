# Security verification scope

The application is a development candidate, not an audited production release.
Build success and passing tests do not establish complete security or anonymity.

The Ethereum portal holds collateral. Its accounting, message authentication,
withdrawal authorization and reentrancy behavior are covered by contract tests.
Aztec contracts enforce private posting rights, screening, rate limits and private
fee accounting. Application tests exercise transactions across these components.
See [TESTING.md](TESTING.md) for the supported test hierarchy.

[Finite transition models](fv/model-checks/README.md) explore bounded states and
include deliberately broken controls. They are not proofs of equivalence to the
implementation, compiler correctness or cryptographic soundness. The Lean and
Verity models in `fv/` are unsupported and provide no assurance for this version.

Privacy depends on more than hiding an address in a post. Funding amounts, timing,
RPC observations and browser state can expose information. Read
[the privacy limits](docs/privacy.md) and [recovery guidance](docs/recovery.md).
Independent review, representative moderation evaluation and target-network
compatibility checks remain necessary before a production release.
