# Paid public revert consumes the coupon

Observation: `network-composition-d0e8905b-17e1-497b-bebc-cc5caeec6bdd.json`.
Fixture v2 adds only a public counter-update guard rejecting value0, plus its
focused test. The delegated private function and sponsor are unchanged. Root
independently checked all v2 source/artifact hashes after the agent's compile,
processing and two focused contract checks. Original v1 evidence is preserved.

On the disposable local network, coupon0 produced a successful counter update
to3. Coupon1 authorized value0 with a real owner authwit. Public simulation
observed the exact controlled rejection. The test then used the existing
BaseWallet transaction path directly, after PXE synchronization, with fixed gas
and dontThrowOnRevert. This omits EmbeddedWallet's public UX preflight only;
private execution, transaction construction, node validation and fee enforcement
remain. No skip-validation or skip-fee flag is used.

The second transaction was actually included with executionResult=reverted and
a nonzero fee. The sponsor debit exactly matched that fee and remained below its
ticket limit. The counter stayed3, both author balances stayed0 and the
administrator's balance did not change. The receipt does not provide revert
text; the separate controlled simulation supplies that observation, not an
invented receipt reason.

Reusing coupon1 with a fresh nonzero action and nonce failed on the exact
independently derived coupon nullifier. No further sponsor debit or counter
change occurred. This demonstrates coupon persistence across the paid public
revert in this local transaction path. Wallet and node stopped normally, both
managed children closed and temporary data was removed.

Run: `node scripts/test-fee-network.mjs --compose --public-revert` with pinned
Node24.21 and current source-bound fixture v2 artifacts. This uses mock proofs
and proposed inclusion. Real proofs, production finality, expiry and complete
production funding/issuer behavior remain open; W01 is not complete.
