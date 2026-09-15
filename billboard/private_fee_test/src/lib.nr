// TXE application checks. Protocol claim nullifiers are explicitly seeded below:
// these tests do not claim to prove an L1 bridge or a real fee-paying transaction.
use private_fee_contract::PrivateFPC;
use aztec::{
    protocol::{address::AztecAddress, constants::FEE_JUICE_ADDRESS,
        abis::{gas::Gas, gas_fees::GasFees, gas_settings::GasSettings}},
    test::helpers::test_environment::{TestEnvironment, CallPrivateOptions},
};

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let user = env.create_light_account();
    let other = env.create_light_account();
    let fpc = env.deploy("@private_fee_contract/PrivateFPC").without_initializer();
    (env, fpc, user, other)
}

unconstrained fn seed_claim(env: TestEnvironment, fpc: AztecAddress, user: AztecAddress, amount: u128, salt: Field) {
    let (chain_id, version) = env.utility_context(|context| (context.chain_id(), context.version()));
    let nullifier = PrivateFPC::compute_feejuice_claim_nullifier(fpc, amount, salt, user, 42, chain_id, version);
    env.private_context_at(FEE_JUICE_ADDRESS, |context| { context.push_nullifier_unsafe(nullifier); });
}

fn gas() -> GasSettings {
    GasSettings {
        gas_limits: Gas { da_gas: 100, l2_gas: 200 },
        teardown_gas_limits: Gas { da_gas: 10, l2_gas: 20 },
        max_fees_per_gas: GasFees { fee_per_da_gas: 3, fee_per_l2_gas: 5 },
        max_priority_fees_per_gas: GasFees { fee_per_da_gas: 0, fee_per_l2_gas: 0 },
    }
}

#[test]
unconstrained fn private_fee_mint_credits_only_bound_owner() {
    let (env, fpc, user, other) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(user)), 5000);
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(other)), 0);
}

#[test(should_fail_with = "failed with duplicate nullifiers")]
unconstrained fn private_fee_claim_cannot_mint_twice() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    assert_eq(env.execute_utility(PrivateFPC::at(fpc).balance_of(user)), 5000);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
}

#[test(should_fail)]
unconstrained fn private_fee_wrong_owner_cannot_mint_known_salt() {
    let (env, fpc, user, other) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(other, PrivateFPC::at(fpc).mint(5000, 123, 42));
}

#[test(should_fail)]
unconstrained fn private_fee_wrong_amount_cannot_inflate_credit() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5001, 123, 42));
}

#[test(should_fail)]
unconstrained fn private_fee_unclaimed_bridge_cannot_mint() {
    let (env, fpc, user, _) = setup();
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
}

#[test(should_fail_with = "Balance too low")]
unconstrained fn private_fee_unfunded_owner_cannot_pay() {
    let (env, fpc, user, _) = setup();
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).pay_fee());
}

#[test(should_fail_with = "Amount too low to cover gas cost")]
unconstrained fn private_fee_cold_start_rejects_insufficient_bridge() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 1299, 123);
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).mint_and_pay_fee(1299, 123, 42));
}

#[test(should_fail)]
unconstrained fn private_fee_outsider_cannot_call_balance_recursion() {
    let (env, fpc, user, other) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    env.call_private(other, PrivateFPC::at(fpc).recurse_subtract_balance_internal(user, 1));
}
