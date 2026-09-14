use aztec::protocol::{
    address::AztecAddress,
    abis::gas_settings::GasSettings,
    hash::poseidon2_hash_with_separator,
    merkle_tree::root::root_from_sibling_path,
    traits::{Deserialize, Packable, Serialize, ToField},
};

// Fixture-only domain. No existing board protocol or production coupon schema is changed.
global COUPON_DOMAIN: u32 = 0x57463031;

#[derive(Deserialize, Eq, Packable, Serialize)]
pub struct Policy {
    pub root: Field,
    pub target: AztecAddress,
    pub epoch: Field,
    pub valid_from: u64,
    pub valid_until: u64,
    pub max_da_gas: u32,
    pub max_l2_gas: u32,
    pub max_teardown_da: u32,
    pub max_teardown_l2: u32,
    pub max_fee_da: u128,
    pub max_fee_l2: u128,
    pub max_priority_da: u128,
    pub max_priority_l2: u128,
    pub max_fee_per_ticket: u128,
    pub epoch_budget: u128,
}

pub fn validate_policy(p: Policy) {
    assert(p.root != 0, "zero coupon root");
    assert(p.target.to_field() != 0, "zero target");
    assert(p.valid_from < p.valid_until, "empty validity interval");
    assert(p.max_da_gas > 0 & p.max_l2_gas > 0, "zero gas cap");
    assert(p.max_teardown_da <= p.max_da_gas & p.max_teardown_l2 <= p.max_l2_gas, "invalid teardown cap");
    // This bounded fixture limits unit prices to u64, so two u32*u64 products cannot overflow u128.
    assert(p.max_fee_da <= 0xffffffffffffffff & p.max_fee_l2 <= 0xffffffffffffffff, "unit price exceeds fixture bound");
    assert(p.max_priority_da <= p.max_fee_da & p.max_priority_l2 <= p.max_fee_l2, "invalid priority cap");
    assert(p.max_fee_per_ticket > 0, "zero ticket budget");
    assert(p.max_fee_per_ticket <= p.epoch_budget / 2, "two tickets exceed epoch budget");
}

pub fn coupon_leaf(chain_id: Field, version: Field, sponsor: AztecAddress, epoch: Field, index: u32, owner: AztecAddress, blind: Field) -> Field {
    poseidon2_hash_with_separator([chain_id, version, sponsor.to_field(), epoch, index as Field, owner.to_field(), blind], COUPON_DOMAIN)
}

pub fn validate_coupon(p: Policy, chain_id: Field, version: Field, sponsor: AztecAddress, index: u32, owner: AztecAddress, blind: Field, sibling: Field) {
    assert(index < 2, "coupon index outside fixed batch");
    assert(owner.to_field() != 0, "zero coupon owner");
    let leaf = coupon_leaf(chain_id, version, sponsor, p.epoch, index, owner, blind);
    assert(root_from_sibling_path(leaf, index as Field, [sibling]) == p.root, "invalid coupon membership");
}

pub fn validate_gas_and_time(p: Policy, gas: GasSettings, anchor_time: u64) {
    assert(anchor_time >= p.valid_from, "coupon not active");
    assert(anchor_time <= p.valid_until, "coupon expired at anchor");
    assert(gas.gas_limits.da_gas <= p.max_da_gas & gas.gas_limits.l2_gas <= p.max_l2_gas, "gas exceeds policy");
    assert(gas.teardown_gas_limits.da_gas <= p.max_teardown_da & gas.teardown_gas_limits.l2_gas <= p.max_teardown_l2, "teardown exceeds policy");
    assert(gas.teardown_gas_limits.da_gas <= gas.gas_limits.da_gas & gas.teardown_gas_limits.l2_gas <= gas.gas_limits.l2_gas, "teardown exceeds total");
    assert(gas.max_fees_per_gas.fee_per_da_gas <= p.max_fee_da & gas.max_fees_per_gas.fee_per_l2_gas <= p.max_fee_l2, "unit fee exceeds policy");
    assert(gas.max_priority_fees_per_gas.fee_per_da_gas <= p.max_priority_da & gas.max_priority_fees_per_gas.fee_per_l2_gas <= p.max_priority_l2, "priority exceeds policy");
    assert(gas.max_priority_fees_per_gas.fee_per_da_gas <= gas.max_fees_per_gas.fee_per_da_gas & gas.max_priority_fees_per_gas.fee_per_l2_gas <= gas.max_fees_per_gas.fee_per_l2_gas, "priority exceeds fee");
    // V5.2 gas_limits already includes the reserved teardown allowance.
    let max_fee = (gas.gas_limits.da_gas as u128) * gas.max_fees_per_gas.fee_per_da_gas
        + (gas.gas_limits.l2_gas as u128) * gas.max_fees_per_gas.fee_per_l2_gas;
    assert(max_fee <= p.max_fee_per_ticket, "transaction exceeds ticket budget");
}

mod tests;
