# Private FeeJuice attribution and changes

Adapted from `alejoamiras/ecosystem-tooling`, commit
`9c71d5d9d84910ad76721a38cf1e07d7f49a4c1c`, package
`packages/private-fee-juice/src/nr/private_contract` and the gas helper in
`packages/private-fee-juice/src/nr/fpc_lib/src/lib.nr`.
The upstream MIT license is preserved in LICENSE.

The reference is linked by the Aztec private FeeJuice documentation. This is
not a claim of protocol-maintainer audit or endorsement of this deployment.

Adaptations: pin dependencies to the application's Aztec v5.2.0 packages,
rename the local package, inline the gas helper as a module, use a separate
application test package, and clarify that secrecy depends on the random
salt (an account address itself is not secret). Contract entrypoints and
bridge/nullifier/balance accounting follow the reference implementation.

The contract has no administrator, initializer, public entrypoint, coupon,
issuer, allowance registry or replenishment service. Users bridge their own
FeeJuice to its shared address and receive private balance notes. Payment
consumes the configured maximum transaction fee, not the actual final fee;
unused fee headroom stays in the contract's public backing and is not
refunded or withdrawable by an administrator. Client gas limits and fee
headroom must therefore be bounded and disclosed.

The upstream commented-out mint/payment tests are not copied as evidence.
Local TXE tests exercise contract behavior with explicitly seeded protocol
state; genuine FeeJuice bridge/payment integration remains a separate gate.
