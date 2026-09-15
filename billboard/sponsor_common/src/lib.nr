use aztec::protocol::{address::AztecAddress, abis::gas_settings::GasSettings,
    hash::poseidon2_hash_with_separator, merkle_tree::root::root_from_sibling_path,
    traits::{Deserialize, Packable, Serialize, ToField}};

pub global TREE_DEPTH: u32 = 10;
pub global MAX_TICKETS: u32 = 1024;
pub global COUPON_DOMAIN: u32 = 0x42420104;
// Shared windows are bounded; every transaction still obeys the protocol's shorter remaining lifetime.
pub global MAX_WINDOW_DURATION: u64 = 86400;
global MAX_U64: u64 = 0xffffffffffffffff;

#[derive(Deserialize, Eq, Packable, Serialize)]
pub struct SponsorConfig {
    pub board: AztecAddress,
    pub window_duration: u64,
    pub window_budget: u128,
    pub max_da_gas: u32,
    pub max_l2_gas: u32,
    pub max_teardown_da: u32,
    pub max_teardown_l2: u32,
    pub max_fee_da: u128,
    pub max_fee_l2: u128,
    pub max_priority_da: u128,
    pub max_priority_l2: u128,
    pub max_fee_per_ticket: u128,
}
#[derive(Deserialize, Eq, Packable, Serialize)]
pub struct Batch {
    pub root: Field,
    pub window: u64,
    pub ticket_count: u32,
}

pub fn validate_config(c: SponsorConfig) {
    assert(c.board.to_field() != 0, "Sponsor zero board");
    assert(c.window_duration > 0 & c.window_duration <= MAX_WINDOW_DURATION, "Sponsor invalid window duration");
    assert(c.window_budget > 0, "Sponsor zero window budget");
    assert(c.max_fee_per_ticket > 0 & c.max_fee_per_ticket <= c.window_budget, "Sponsor invalid ticket budget");
    assert(c.max_da_gas > 0 & c.max_l2_gas > 0, "Sponsor zero gas cap");
    assert(c.max_teardown_da <= c.max_da_gas & c.max_teardown_l2 <= c.max_l2_gas, "Sponsor invalid teardown cap");
    assert(c.max_fee_da > 0 & c.max_fee_l2 > 0, "Sponsor zero unit fee cap");
    assert(c.max_fee_da <= MAX_U64 as u128 & c.max_fee_l2 <= MAX_U64 as u128, "Sponsor unit fee cap too large");
    assert(c.max_priority_da <= c.max_fee_da & c.max_priority_l2 <= c.max_fee_l2, "Sponsor invalid priority cap");
}

// Fixed Unix-epoch-aligned windows [start,end], with no shared endpoint.
// All arithmetic is checked before computing a potentially overflowing product/sum.
pub fn window_bounds(duration: u64, window: u64) -> (u64, u64) {
    assert(duration > 0 & duration <= MAX_WINDOW_DURATION, "Sponsor invalid window duration");
    let span = duration - 1;
    assert(window <= (MAX_U64 - span) / duration, "Sponsor window timestamp overflow");
    let start = window * duration;
    (start, start + span)
}

pub fn reserve_batch(c: SponsorConfig, batch_id: u64, batch: Batch, reserved: u128, now: u64) -> u128 {
    assert(batch_id > 0, "Sponsor zero batch id");
    assert(batch.root != 0, "Sponsor zero coupon root");
    assert(batch.ticket_count > 0 & batch.ticket_count <= MAX_TICKETS, "Sponsor invalid ticket count");
    let (_, end) = window_bounds(c.window_duration, batch.window);
    assert(now <= end, "Sponsor expired registration window");
    assert(reserved <= c.window_budget, "Sponsor invalid reserved balance");
    let remaining = c.window_budget - reserved;
    // This also establishes that the following multiplication/addition fit u128.
    assert(c.max_fee_per_ticket <= remaining / batch.ticket_count as u128, "Sponsor window budget exhausted");
    reserved + c.max_fee_per_ticket * batch.ticket_count as u128
}

pub fn coupon_leaf(chain_id: Field, version: Field, sponsor: AztecAddress, window: u64,
    batch_id: u64, index: u32, owner: AztecAddress, blind: Field) -> Field {
    poseidon2_hash_with_separator([chain_id, version, sponsor.to_field(), window as Field,
        batch_id as Field, index as Field, owner.to_field(), blind], COUPON_DOMAIN)
}
pub fn validate_coupon(batch: Batch, chain_id: Field, version: Field, sponsor: AztecAddress,
    batch_id: u64, index: u32, owner: AztecAddress, blind: Field, siblings: [Field; TREE_DEPTH]) {
    assert(batch_id > 0, "Sponsor zero batch id");
    assert(batch.ticket_count > 0 & batch.ticket_count <= MAX_TICKETS, "Sponsor invalid ticket count");
    assert(index < batch.ticket_count, "Sponsor coupon index outside batch");
    assert(owner.to_field() != 0, "Sponsor zero coupon owner");
    assert(blind != 0, "Sponsor zero coupon blind");
    let leaf = coupon_leaf(chain_id, version, sponsor, batch.window, batch_id, index, owner, blind);
    assert(root_from_sibling_path(leaf, index as Field, siblings) == batch.root, "Sponsor invalid coupon membership");
}

pub fn validate_gas(c: SponsorConfig, gas: GasSettings) {
    assert(gas.gas_limits.da_gas <= c.max_da_gas & gas.gas_limits.l2_gas <= c.max_l2_gas, "Sponsor gas exceeds cap");
    assert(gas.teardown_gas_limits.da_gas <= c.max_teardown_da & gas.teardown_gas_limits.l2_gas <= c.max_teardown_l2, "Sponsor teardown exceeds cap");
    assert(gas.teardown_gas_limits.da_gas <= gas.gas_limits.da_gas & gas.teardown_gas_limits.l2_gas <= gas.gas_limits.l2_gas, "Sponsor teardown exceeds total");
    assert(gas.max_fees_per_gas.fee_per_da_gas <= c.max_fee_da & gas.max_fees_per_gas.fee_per_l2_gas <= c.max_fee_l2, "Sponsor unit fee exceeds cap");
    assert(gas.max_priority_fees_per_gas.fee_per_da_gas <= c.max_priority_da & gas.max_priority_fees_per_gas.fee_per_l2_gas <= c.max_priority_l2, "Sponsor priority exceeds cap");
    assert(gas.max_priority_fees_per_gas.fee_per_da_gas <= gas.max_fees_per_gas.fee_per_da_gas & gas.max_priority_fees_per_gas.fee_per_l2_gas <= gas.max_fees_per_gas.fee_per_l2_gas, "Sponsor priority exceeds fee");
    // Immutable configuration caps prices to u64: two u32*u64 products fit u128.
    // V5.2 total gas includes teardown; do not add the reserve a second time.
    let maximum_fee = gas.gas_limits.da_gas as u128 * gas.max_fees_per_gas.fee_per_da_gas
        + gas.gas_limits.l2_gas as u128 * gas.max_fees_per_gas.fee_per_l2_gas;
    assert(maximum_fee <= c.max_fee_per_ticket, "Sponsor transaction exceeds ticket budget");
}

mod tests;
