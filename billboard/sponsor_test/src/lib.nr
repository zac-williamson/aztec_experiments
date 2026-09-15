// Actual TXE public deployment/storage/authorization. No sponsor private root,
// fee payment or genuine transaction proof is qualified by these tests.
use aztec::{protocol::{address::AztecAddress, traits::FromField}, test::helpers::test_environment::TestEnvironment};
use sponsor_common::{SponsorConfig, window_bounds};
use sponsor_contract::BillboardSponsor;

fn config() -> SponsorConfig {
    SponsorConfig { board: AztecAddress::from_field(0x574f01), window_duration: 60, window_budget: 3900,
        max_da_gas: 100, max_l2_gas: 200, max_teardown_da: 10, max_teardown_l2: 20,
        max_fee_da: 3, max_fee_l2: 5, max_priority_da: 1, max_priority_l2: 2, max_fee_per_ticket: 1300 }
}
unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, u64) {
    let mut env=TestEnvironment::new(); let admin=env.create_light_account();
    // The target address is inert: public policy registration never calls it.
    let sponsor=env.deploy("@sponsor_contract/BillboardSponsor").with_public_initializer(admin,BillboardSponsor::interface().constructor(admin,config()));
    let window=env.last_block_timestamp()/60+2;
    (env,sponsor,admin,window)
}
#[test]
unconstrained fn w01_public_constructor_preserves_fixed_configuration() {
    let (env,sponsor,admin,_window)=setup();
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_config()),config());
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_admin()),admin);
}
#[test]
unconstrained fn w01_public_multiple_batches_reserve_current_window_atomically() {
    let (env,sponsor,admin,window)=setup();
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),0);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,2));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),2600);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(2,102,window,1));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),3900);
    let a=env.view_public(BillboardSponsor::at(sponsor).get_batch(1));
    let b=env.view_public(BillboardSponsor::at(sponsor).get_batch(2));
    assert_eq(a.root,101); assert_eq(a.window,window); assert_eq(a.ticket_count,2);
    assert_eq(b.root,102); assert_eq(b.window,window); assert_eq(b.ticket_count,1);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(3,103,window+1,3));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window+1)),3900);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),3900);
}
#[test(should_fail_with="Sponsor window budget exhausted")]
unconstrained fn w01_public_new_batch_cannot_spend_full_window_again() {
    let (env,sponsor,admin,window)=setup();
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,2));
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(2,102,window,1));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),3900);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(3,103,window,1));
}
#[test(should_fail_with="Sponsor batch id already registered")]
unconstrained fn w01_public_batch_id_cannot_be_reassigned_to_later_window() {
    let (env,sponsor,admin,window)=setup();
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,1));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_batch(1)).root,101);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window+1)),0);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,202,window+1,1));
}
#[test(should_fail_with="Sponsor only admin")]
unconstrained fn w01_public_registration_rejects_unauthorized_account() {
    let (mut env,sponsor,_admin,window)=setup(); let outsider=env.create_light_account();
    env.call_public(outsider,BillboardSponsor::at(sponsor).register_batch(1,101,window,1));
}
#[test(should_fail_with="Sponsor only admin")]
unconstrained fn w01_public_rotation_rejects_unauthorized_account() {
    let (mut env,sponsor,_admin,_window)=setup(); let outsider=env.create_light_account();
    env.call_public(outsider,BillboardSponsor::at(sponsor).rotate_admin(outsider));
}
#[test]
unconstrained fn w01_public_rotation_preserves_batches_and_allows_new_admin() {
    let (mut env,sponsor,admin,window)=setup(); let next=env.create_light_account();
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,2));
    let before=env.view_public(BillboardSponsor::at(sponsor).get_batch(1));
    env.call_public(admin,BillboardSponsor::at(sponsor).rotate_admin(next));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_admin()),next);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_config()),config());
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_batch(1)),before);
    env.call_public(next,BillboardSponsor::at(sponsor).register_batch(2,102,window,1));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),3900);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_batch(1)),before);
}
#[test(should_fail_with="Sponsor only admin")]
unconstrained fn w01_public_previous_admin_loses_future_registration_authority() {
    let (mut env,sponsor,admin,window)=setup(); let next=env.create_light_account();
    env.call_public(admin,BillboardSponsor::at(sponsor).rotate_admin(next));
    env.call_public(next,BillboardSponsor::at(sponsor).register_batch(1,101,window,1));
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),1300);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(2,102,window,1));
}
#[test(should_fail_with="Sponsor expired registration window")]
unconstrained fn w01_public_registration_uses_actual_current_timestamp() {
    let (mut env,sponsor,admin,window)=setup(); let (_,end)=window_bounds(60,window);
    env.mine_block_at(end+1);
    assert(env.last_block_timestamp()>end);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,1));
}

#[test]
unconstrained fn w01_public_absent_batch_lookup_does_not_initialize_or_reserve() {
    let (env,sponsor,admin,window)=setup();
    let absent=env.view_public(BillboardSponsor::at(sponsor).get_batch(1));
    assert_eq(absent.root,0); assert_eq(absent.window,0); assert_eq(absent.ticket_count,0);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),0);
    env.call_public(admin,BillboardSponsor::at(sponsor).register_batch(1,101,window,2));
    let present=env.view_public(BillboardSponsor::at(sponsor).get_batch(1));
    assert_eq(present.root,101); assert_eq(present.window,window); assert_eq(present.ticket_count,2);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_reserved(window)),2600);
    assert_eq(env.view_public(BillboardSponsor::at(sponsor).get_batch(2)).root,0);
}
