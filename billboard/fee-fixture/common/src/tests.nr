use super::{Policy, coupon_leaf, validate_policy, validate_coupon, validate_gas_and_time};
use aztec::protocol::{address::AztecAddress, traits::FromField, abis::{gas::Gas, gas_fees::GasFees, gas_settings::GasSettings}, merkle_tree::root::compute_tree_root};

fn policy() -> Policy {
    Policy { root: 1, target: AztecAddress::from_field(10), epoch: 7, valid_from: 100, valid_until: 200,
        max_da_gas: 100, max_l2_gas: 200, max_teardown_da: 10, max_teardown_l2: 20,
        max_fee_da: 3, max_fee_l2: 5, max_priority_da: 1, max_priority_l2: 2,
        max_fee_per_ticket: 1300, epoch_budget: 2600 }
}
fn gas() -> GasSettings {
    GasSettings::new(Gas::new(100,200),Gas::new(10,20),GasFees::new(3,5),GasFees::new(1,2))
}
fn coupon_policy() -> (Policy, Field, Field) {
    let sponsor = AztecAddress::from_field(11);
    let leaf0 = coupon_leaf(1,2,sponsor,7,0,AztecAddress::from_field(12),13);
    let leaf1 = coupon_leaf(1,2,sponsor,7,1,AztecAddress::from_field(14),15);
    let mut p = policy(); p.root = compute_tree_root([leaf0,leaf1]);
    (p,leaf0,leaf1)
}
#[test]
fn valid_both_coupons() {
    let (p,a,b) = coupon_policy(); validate_policy(p);
    validate_coupon(p,1,2,AztecAddress::from_field(11),0,AztecAddress::from_field(12),13,b);
    validate_coupon(p,1,2,AztecAddress::from_field(11),1,AztecAddress::from_field(14),15,a);
}
#[test]
fn valid_exact_gas_budget_and_time_boundaries() {
    let p = policy(); validate_policy(p);
    validate_gas_and_time(p,gas(),100); validate_gas_and_time(p,gas(),200);
}

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_owner() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(11),0,AztecAddress::from_field(14),13,b); }

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_sibling() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(11),0,AztecAddress::from_field(12),13,b+1); }

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_blind() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(11),0,AztecAddress::from_field(12),14,b); }

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_chain() { let (p,_a,b)=coupon_policy(); validate_coupon(p,9,2,AztecAddress::from_field(11),0,AztecAddress::from_field(12),13,b); }

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_version() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,9,AztecAddress::from_field(11),0,AztecAddress::from_field(12),13,b); }

#[test(should_fail_with = "invalid coupon membership")]
fn reject_wrong_sponsor() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(99),0,AztecAddress::from_field(12),13,b); }

#[test(should_fail_with = "coupon index outside fixed batch")]
fn reject_out_of_batch() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(11),2,AztecAddress::from_field(12),13,b); }

#[test(should_fail_with = "zero coupon owner")]
fn reject_zero_owner() { let (p,_a,b)=coupon_policy(); validate_coupon(p,1,2,AztecAddress::from_field(11),0,AztecAddress::zero(),13,b); }

#[test(should_fail_with = "gas exceeds policy")]
fn reject_da_gas() { let mut p=policy(); let mut g=gas(); g.gas_limits.da_gas=101; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "gas exceeds policy")]
fn reject_l2_gas() { let mut p=policy(); let mut g=gas(); g.gas_limits.l2_gas=201; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "teardown exceeds policy")]
fn reject_teardown_da() { let mut p=policy(); let mut g=gas(); g.teardown_gas_limits.da_gas=11; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "teardown exceeds policy")]
fn reject_teardown_l2() { let mut p=policy(); let mut g=gas(); g.teardown_gas_limits.l2_gas=21; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "teardown exceeds total")]
fn reject_teardown_total() { let mut p=policy(); let mut g=gas(); g.gas_limits.da_gas=9; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "unit fee exceeds policy")]
fn reject_da_price() { let mut p=policy(); let mut g=gas(); g.max_fees_per_gas.fee_per_da_gas=4; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "unit fee exceeds policy")]
fn reject_l2_price() { let mut p=policy(); let mut g=gas(); g.max_fees_per_gas.fee_per_l2_gas=6; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "priority exceeds policy")]
fn reject_da_priority() { let mut p=policy(); let mut g=gas(); g.max_priority_fees_per_gas.fee_per_da_gas=2; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "priority exceeds policy")]
fn reject_l2_priority() { let mut p=policy(); let mut g=gas(); g.max_priority_fees_per_gas.fee_per_l2_gas=3; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "priority exceeds fee")]
fn reject_priority_total() { let mut p=policy(); let mut g=gas(); g.max_fees_per_gas.fee_per_l2_gas=1; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "transaction exceeds ticket budget")]
fn reject_ticket_total() { let mut p=policy(); let mut g=gas(); p.max_fee_per_ticket=1299; validate_gas_and_time(p,g,150); }

#[test(should_fail_with = "coupon not active")]
fn reject_early() { validate_gas_and_time(policy(),gas(),99); }

#[test(should_fail_with = "coupon expired at anchor")]
fn reject_expired() { validate_gas_and_time(policy(),gas(),201); }

#[test(should_fail_with = "two tickets exceed epoch budget")]
fn reject_policy_budget() { let mut p=policy(); p.epoch_budget=2599; validate_policy(p); }

#[test(should_fail_with = "unit price exceeds fixture bound")]
fn reject_policy_oversized_price() { let mut p=policy(); p.max_fee_da=0x10000000000000000; validate_policy(p); }

#[test(should_fail_with = "empty validity interval")]
fn reject_policy_empty_window() { let mut p=policy(); p.valid_until=100; validate_policy(p); }
