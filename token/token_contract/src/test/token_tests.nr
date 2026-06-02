use aztec::context::UtilityContext;
use aztec::protocol::address::AztecAddress;
use aztec::protocol::traits::FromField;
use aztec::test::helpers::test_environment::TestEnvironment;
use aztec::protocol::storage::map::derive_storage_slot_in_map;

use crate::TokenContract;

unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let admin = env.create_light_account();
    let init = TokenContract::interface().constructor(1000000, admin);
    let contract_address = env
        .deploy("TokenContract")
        .with_public_initializer(admin, init);
    (env, contract_address, admin)
}

#[test]
unconstrained fn test_constructor_sets_total_supply() {
    let (env, contract_address, _) = setup();

    env.utility_context_at(contract_address, |context: UtilityContext| {
        let supply = context.storage_read::<u128>(TokenContract::storage_layout().total_supply.slot);
        assert_eq(supply, 1000000);
    });
}

#[test]
unconstrained fn test_constructor_mints_to_owner() {
    let (env, contract_address, admin) = setup();

    env.utility_context_at(contract_address, |context: UtilityContext| {
        let map_slot = TokenContract::storage_layout().public_balances.slot;
        let balance_slot = derive_storage_slot_in_map(map_slot, admin);
        let balance = context.storage_read::<u128>(balance_slot);
        assert_eq(balance, 1000000);
    });
}

#[test]
unconstrained fn test_public_transfer() {
    let (env, contract_address, admin) = setup();
    let recipient = AztecAddress::from_field(42);

    env.call_public(
        admin,
        TokenContract::at(contract_address).transfer_public_to_public(admin, recipient, 100),
    );

    env.utility_context_at(contract_address, |context: UtilityContext| {
        let map_slot = TokenContract::storage_layout().public_balances.slot;
        let balance_slot = derive_storage_slot_in_map(map_slot, recipient);
        let bal = context.storage_read::<u128>(balance_slot);
        assert_eq(bal, 100);
    });
}

#[test]
unconstrained fn test_public_transfer_preserves_supply() {
    let (env, contract_address, admin) = setup();
    let recipient = AztecAddress::from_field(99);

    env.call_public(
        admin,
        TokenContract::at(contract_address).transfer_public_to_public(admin, recipient, 500),
    );

    env.utility_context_at(contract_address, |context: UtilityContext| {
        let supply = context.storage_read::<u128>(TokenContract::storage_layout().total_supply.slot);
        assert_eq(supply, 1000000);
    });
}

#[test]
unconstrained fn test_mint_to_public() {
    let (env, contract_address, admin) = setup();
    let recipient = AztecAddress::from_field(77);

    env.call_public(
        admin,
        TokenContract::at(contract_address).mint_to_public(recipient, 5000),
    );

    env.utility_context_at(contract_address, |context: UtilityContext| {
        let supply = context.storage_read::<u128>(TokenContract::storage_layout().total_supply.slot);
        assert_eq(supply, 1005000);
    });
}
