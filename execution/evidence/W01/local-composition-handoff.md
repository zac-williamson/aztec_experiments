# Local sponsor composition handoff

This is implementation preparation, not evidence of passing sponsorship.

The pinned EmbeddedWallet/BaseWallet supports a direct private root using
`NO_FROM`, which selects `DefaultEntrypoint`. That entrypoint accepts exactly one
private call. Invoke RestrictedSponsor.sponsor directly, with the owner's scope
and real auth witness for FeeTarget.delegated(owner, value, nonce), caller set to
the sponsor. Do not append the sponsor through an account fee-payment hook.

`ContractFunctionInteraction.request` accepts authWitnesses. BaseWallet.sendTx
uses completeFeeOptions with `forEstimation` unset and then PXE.proveTx. The
simulation helper uses stub account overrides and estimation gas limits, so its
result alone cannot establish real authwit acceptance or policy compatibility.
Pass explicit bounded final gas settings for the composed transaction.

Use generateSchnorrAccounts from the pinned accounts testing/lazy module for
fresh identities, never its fixed default test-account inventory. Initializerless
account registration is supported. Genesis prefunding for this disposable
mechanism fixture is explicitly synthetic funding and cannot establish the
production sponsor funding privacy criterion.

Deploy sponsor(admin), then target(sponsor), then configure the immutable policy.
Coupon leaves use poseidon2HashWithSeparator over
[chainId, version, sponsor, epoch, index, owner, blind] with separator 0x57463031.
The two-leaf root uses the protocol MERKLE_HASH separator 2982624097, not an
unseparated hash. These fixture domains are not a production protocol adoption.

The scoped Noir agent reproduced a TXE limitation: its top-level context starts
with minRevertibleSideEffectCounter=1 even for an absent sender, and root fee
election fails because setup has already ended. Keep those failures and source
evidence. Do not patch the oracle or weaken the sponsor to bypass that boundary.
Composition, fee debit, failed-application ticket consumption and replay must be
observed using the actual local node/PXE path.

The local startup profile deploys a mock L1 verifier, disables private proving and
disables synthetic epoch settlement. It cannot satisfy any real-proof gate.
