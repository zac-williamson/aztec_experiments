// TXE application checks. Protocol claim nullifiers are explicitly seeded below:
// these tests do not claim to prove an L1 bridge or a real fee-paying transaction.
use private_fee_contract::PrivateFPC;
use aztec::{
    protocol::{address::AztecAddress, constants::FEE_JUICE_ADDRESS, traits::Deserialize,
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
unconstrained fn private_fee_mint_emits_one_backed_credit_note() {
    let (env, fpc, user, other) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    let effects = aztec::test::helpers::txe_oracles::get_last_tx_effects();
    assert_eq(effects.note_hashes.len(), 1);
}

#[test(should_fail_with = "failed with duplicate nullifiers")]
unconstrained fn private_fee_claim_cannot_mint_twice() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
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

#[test(should_fail_with = "Fee inputs required")]
unconstrained fn private_fee_unfunded_owner_cannot_pay() {
    let (env, fpc, user, _) = setup();
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).pay_fee(1300));
}

#[test(should_fail_with = "Amount too low to cover gas cost")]
unconstrained fn private_fee_cold_start_rejects_insufficient_bridge() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 1299, 123);
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).mint_and_pay_fee(1299, 123, 42, 1300));
}

#[test(should_fail_with = "Function _complete_refund can only be called by the same contract")]
unconstrained fn private_fee_outsider_cannot_complete_refund() {
    let (env, fpc, user, _) = setup();
    env.call_public(user, PrivateFPC::at(fpc)._complete_refund(0, 0, 0, 0));
}

// Even self-calls require the private setup validity commitment.
#[test(should_fail_with = "Invalid refund commitment")]
unconstrained fn private_fee_refund_requires_setup_commitment() {
    let (env, fpc, _, _) = setup();
    env.call_public(fpc, PrivateFPC::at(fpc)._complete_refund(0, 0, 0, 0));
}

#[test(should_fail_with = "Fee reservation below transaction maximum")]
unconstrained fn private_fee_existing_credit_rejects_underreservation() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private(user, PrivateFPC::at(fpc).mint(5000, 123, 42));
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).pay_fee(1299));
}

#[test(should_fail_with = "Fee reservation below transaction maximum")]
unconstrained fn private_fee_cold_start_rejects_underreservation() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).mint_and_pay_fee(5000, 123, 42, 1299));
}

#[test(should_fail_with = "Fee reservation must be positive")]
unconstrained fn private_fee_existing_credit_rejects_zero_reservation() {
    let (env, fpc, user, _) = setup();
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).pay_fee(0));
}

#[test(should_fail_with = "Fee reservation must be positive")]
unconstrained fn private_fee_cold_start_rejects_zero_reservation() {
    let (env, fpc, user, _) = setup();
    seed_claim(env, fpc, user, 5000, 123);
    env.call_private_opts(user, CallPrivateOptions::new().with_gas_settings(gas()), PrivateFPC::at(fpc).mint_and_pay_fee(5000, 123, 42, 0));
}

use private_credit::{PAID_LIKE_VALUE, post_secret, spending_key, spending_scalar, create_tip,
    commitment, tip_blinding, tip_key_hash, validate_key};
use aztec::protocol::point::EmbeddedCurvePoint;
use std::embedded_curve_ops::multi_scalar_mul;

#[test]
fn paid_like_value_and_ecdh_recipient_commitment_agree() {
    assert_eq(PAID_LIKE_VALUE, 20 * 1000000000000000000);
    let fpc = AztecAddress::from_field(91);
    let secret = post_secret(123, 1, 6, AztecAddress::from_field(42), 777);
    let recipient = spending_key(secret);
    let (ephemeral, sent) = create_tip(recipient, 456, fpc);
    let received = multi_scalar_mul([ephemeral], [spending_scalar(secret)]);
    assert_eq(sent, commitment(recipient, tip_blinding(received, fpc)));
    assert(sent != commitment(recipient, tip_blinding(received, AztecAddress::from_field(92))));
}

#[test]
fn post_tip_keys_separate_post_owner_chain_version_and_board() {
    let board = AztecAddress::from_field(42);
    let secret = post_secret(123, 1, 6, board, 777);
    for changed in [post_secret(124, 1, 6, board, 777), post_secret(123, 2, 6, board, 777),
        post_secret(123, 1, 7, board, 777), post_secret(123, 1, 6, AztecAddress::from_field(43), 777),
        post_secret(123, 1, 6, board, 778)] {
        assert(secret != changed);
        assert(tip_key_hash(spending_key(secret)) != tip_key_hash(spending_key(changed)));
    }
}

#[test(should_fail_with="Invalid tip curve point")]
fn invalid_tip_point_is_rejected() { validate_key(EmbeddedCurvePoint { x: 1, y: 1 }); }

#[test(should_fail_with="Zero ephemeral scalar")]
fn zero_ephemeral_does_not_create_a_tip() {
    let _ = create_tip(spending_key(123), 0, AztecAddress::from_field(91));
}
