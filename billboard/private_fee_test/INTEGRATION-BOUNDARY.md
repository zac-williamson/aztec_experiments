# Fee setup phase verification boundary

The actual pinned Aztec v5.2 TXE privateCallNewFlow starts calls in the
revertible application phase: it hardcodes minRevertibleSideEffectCounter=1
and sets that on ExecutionNoteCache before executing the requested function.
CallPrivateOptions exposes scopes, utility authorization and gas settings,
not an override for this phase. PrivateFPC correctly rejects fee payer election
there. We do not patch this protocol test environment or weaken the contract.

Observed in execution/evidence/W01/private-fee-noir-tests-002.log: mint succeeds,
balance ownership succeeds, and the two positive payment calls stop with
`fee payer must be elected during the setup phase`. These are harness-boundary
failures, not passing positive payment tests. The duplicate-mint transaction
was rejected with `failed with duplicate nullifiers`; the initial expected
message was corrected to this actual transaction-level diagnostic.

The genuine application proof tests must cover both positive flows: bridge
claim plus mint_and_pay_fee in setup credits amount minus configured maximum
fee, and subsequent pay_fee reduces only the caller's private balance by that
maximum. A second owner's balance remains unchanged. Teardown gas must not
be added twice. The original intended positive TXE assertions are retained
below for review, but are deliberately not included as passing test coverage.

```noir
#[test]
unconstrained fn private_fee_payment_debits_configured_maximum_only() {
    let (env, fpc, user, other) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).pay_fee());
    // 100*3 + 200*5 = 1300. Teardown is already part of total gas limits.
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(user)), 3700);
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(other)), 0);
}

#[test]
unconstrained fn private_fee_cold_start_credits_only_fee_remainder() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).mint_and_pay_fee(5000, 123, 42));
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(user)), 3700);
}
```
