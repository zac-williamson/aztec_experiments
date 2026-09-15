// Pure production-policy boundaries. No TXE, fee debit, reservation storage,
// proof, clock warp or private inclusion-expiration claim is made by this suite.
use super::{SponsorConfig, Batch, TREE_DEPTH, COUPON_DOMAIN, validate_config, reserve_batch,
    window_bounds, coupon_leaf, validate_coupon, validate_gas};
use aztec::protocol::{address::AztecAddress, traits::{FromField, ToField},
    hash::poseidon2_hash_with_separator, merkle_tree::root::root_from_sibling_path,
    abis::{gas::Gas, gas_fees::GasFees, gas_settings::GasSettings}};

fn config() -> SponsorConfig {
    SponsorConfig { board: AztecAddress::from_field(10), window_duration: 60, window_budget: 3900,
        max_da_gas: 100, max_l2_gas: 200, max_teardown_da: 10, max_teardown_l2: 20,
        max_fee_da: 3, max_fee_l2: 5, max_priority_da: 1, max_priority_l2: 2,
        max_fee_per_ticket: 1300 }
}
fn gas() -> GasSettings { GasSettings::new(Gas::new(100,200), Gas::new(10,20), GasFees::new(3,5), GasFees::new(1,2)) }
fn batch(count: u32) -> Batch { Batch { root: 123, window: 2, ticket_count: count } }
fn membership() -> (Batch, [Field;TREE_DEPTH]) {
    let siblings = [17;TREE_DEPTH];
    let leaf = coupon_leaf(1,2,AztecAddress::from_field(11),2,7,1023,AztecAddress::from_field(12),13);
    (Batch { root: root_from_sibling_path(leaf,1023,siblings), window: 2, ticket_count: 1024 }, siblings)
}

#[test]
fn w01_policy_multiple_batches_fill_one_window_exactly() {
    let c = config(); validate_config(c);
    let first = reserve_batch(c, 1, batch(2), 0, 119); assert_eq(first,2600);
    let next = reserve_batch(c, 2, batch(1), first, 120); assert_eq(next,c.window_budget);
    // A different window uses its own zero reserved value supplied by public storage.
    let mut other = batch(3); other.window = 3;
    assert_eq(reserve_batch(c, 3, other, 0, 120), c.window_budget);
}
#[test(should_fail_with="Sponsor window budget exhausted")]
fn w01_policy_next_batch_cannot_reuse_reserved_budget() {
    let c = config();
    let reserved = reserve_batch(c, 1, batch(3), 0, 120);
    reserve_batch(c, 2, batch(1), reserved, 120);
}
#[test(should_fail_with="Sponsor invalid ticket count")]
fn w01_policy_zero_count_rejects_before_division() { reserve_batch(config(),1,batch(0),0,120); }
#[test(should_fail_with="Sponsor invalid ticket count")]
fn w01_policy_count_above_tree_capacity_rejects() { reserve_batch(config(),1,batch(1025),0,120); }
#[test(should_fail_with="Sponsor window budget exhausted")]
fn w01_policy_u128_reservation_cannot_wrap() {
    let mut c = config();
    c.window_budget = 0xffffffffffffffffffffffffffffffff;
    c.max_fee_per_ticket = c.window_budget / 1024;
    validate_config(c);
    let reserved = reserve_batch(c,1,batch(1024),0,120);
    assert_eq(c.window_budget-reserved,1023);
    // A naive multiplication/addition would wrap; division guard must reject.
    reserve_batch(c,2,batch(1),reserved,120);
}
#[test]
fn w01_policy_adjacent_windows_have_no_shared_inclusive_timestamp() {
    assert_eq(window_bounds(60,2),(120,179));
    let (next_start,next_end) = window_bounds(60,3);
    assert_eq(next_start,180); assert_eq(next_end,239);
    assert_eq(window_bounds(1,0),(0,0));
    assert_eq(window_bounds(86400,0),(0,86399));
    // Largest representable two-second window is valid, its neighbor is not.
    assert_eq(window_bounds(2,0x7fffffffffffffff),(0xfffffffffffffffe,0xffffffffffffffff));
    assert_eq(reserve_batch(config(),1,batch(1),0,179),1300);
}
#[test(should_fail_with="Sponsor window timestamp overflow")]
fn w01_policy_window_multiplication_overflow_rejects() { window_bounds(2,0x8000000000000000); }
#[test(should_fail_with="Sponsor expired registration window")]
fn w01_policy_registration_after_inclusive_end_rejects() { reserve_batch(config(),1,batch(1),0,180); }

#[test]
fn w01_policy_coupon_transcript_binds_every_scope_component() {
    let s=AztecAddress::from_field(11); let o=AztecAddress::from_field(12);
    let original=coupon_leaf(1,2,s,3,4,5,o,6);
    let changed=[coupon_leaf(9,2,s,3,4,5,o,6),coupon_leaf(1,9,s,3,4,5,o,6),
        coupon_leaf(1,2,AztecAddress::from_field(99),3,4,5,o,6),coupon_leaf(1,2,s,9,4,5,o,6),
        coupon_leaf(1,2,s,3,9,5,o,6),coupon_leaf(1,2,s,3,4,9,o,6),
        coupon_leaf(1,2,s,3,4,5,AztecAddress::from_field(99),6),coupon_leaf(1,2,s,3,4,5,o,9)];
    for i in 0..8 { assert(changed[i] != original); }
    assert_eq(COUPON_DOMAIN,0x42420104);
    assert(original != poseidon2_hash_with_separator([1,2,s.to_field(),3,4,5,o.to_field(),6],0x42420103));
}
#[test]
fn w01_policy_highest_coupon_index_and_exact_gas_limits_succeed() {
    let (b,siblings)=membership();
    validate_coupon(b,1,2,AztecAddress::from_field(11),7,1023,AztecAddress::from_field(12),13,siblings);
    let c=config(); validate_config(c); validate_gas(c,gas());
    // 100*3+200*5=1300 includes teardown. Adding teardown again would wrongly reject.
    assert_eq(c.max_fee_per_ticket,1300);
}
#[test(should_fail_with="Sponsor invalid coupon membership")]
fn w01_policy_valid_path_cannot_move_to_another_sponsor() {
    let (b,siblings)=membership();
    validate_coupon(b,1,2,AztecAddress::from_field(99),7,1023,AztecAddress::from_field(12),13,siblings);
}
#[test(should_fail_with="Sponsor coupon index outside batch")]
fn w01_policy_tree_valid_index_still_requires_registered_count() {
    let (mut b,siblings)=membership(); b.ticket_count=1023;
    validate_coupon(b,1,2,AztecAddress::from_field(11),7,1023,AztecAddress::from_field(12),13,siblings);
}
#[test(should_fail_with="Sponsor gas exceeds cap")]
fn w01_policy_actual_l2_gas_above_cap_rejects_even_with_budget_room() {
    let mut c=config(); c.max_fee_per_ticket=3900; validate_config(c);
    let mut g=gas(); g.gas_limits.l2_gas=201; validate_gas(c,g);
}
#[test(should_fail_with="Sponsor transaction exceeds ticket budget")]
fn w01_policy_valid_individual_gas_caps_still_obey_total_ticket_limit() {
    let mut c=config(); c.max_fee_per_ticket=1299; validate_config(c); validate_gas(c,gas());
}
#[test(should_fail_with="Sponsor teardown exceeds total")]
fn w01_policy_teardown_within_policy_cannot_exceed_actual_total() {
    let mut g=gas(); g.gas_limits.da_gas=9; validate_gas(config(),g);
}
#[test(should_fail_with="Sponsor unit fee cap too large")]
fn w01_policy_u128_price_cannot_bypass_proven_u64_product_bound() {
    let mut c=config(); c.max_fee_l2=0xffffffffffffffffffffffffffffffff; validate_config(c);
}
