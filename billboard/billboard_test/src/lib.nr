mod c01;
mod compact_note;
mod c02;
mod c03;
mod w01;

// ============================================================
// Billboard — Noir unit tests (run with `aztec test`)
// ============================================================
// Fast, in-process tests using TestEnvironment. Covers:
//   - Pure functions (compute_cooldown, message hashes)
//   - init() deployment + view getters
//   - init() parameter validation
//   - transfer_censor() access control + happy path
//   - declare_immoral() access control
//   - set_moderation_policy() access control + lifecycle
//   - Full flow: claim_deposit → post → screening → flag → post
//   - Screening mechanism: child/grandchild proofs
//   - Censor window: posts too young can't be screened
//   - Save-up rule: limits bursting after dormancy
//   - Dummy posts: for withdrawal screening
//   - Withdrawal: requires all real posts screened
// ============================================================

use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::protocol::traits::{ToField, FromField};
use aztec::test::helpers::test_environment::TestEnvironment;
use billboard_contract::Billboard;
use billboard_contract::lib::{compute_cooldown, get_deposit_msg_hash, get_withdraw_msg_hash, deposit_chain_id};

// ============================================================
// Test constants
// ============================================================
global MIN_DEPOSIT: u128 = 1_000_000_000_000_000; // 0.001 ETH
global MAX_DEPOSIT: u128 = 100_000_000_000_000_000_000;
global BASE_COOLDOWN: u64 = 3600;
global K: u64 = 4;
global CENSOR_WINDOW: u64 = 3600; // 1 hour
global MAX_SAVE_UP: u64 = 16;
global MSG_FIELDS: u32 = 32;
global POLICY_FIELDS: u32 = 48;

global TEST_SECRET: Field = 0xdeadbeef;
global TEST_PORTAL: Field = 0xaabbccdd;
global DEPOSITOR_ADDR: Field = 0x12345678;

/// Valid one-byte V1 policy used by default in tests.
fn default_policy() -> [Field; POLICY_FIELDS] {
    policy_with_byte(65).0
}

/// Build a policy with a single ASCII byte in the first field (for round-trip tests).
fn policy_with_byte(b: u8) -> ([Field; POLICY_FIELDS], u32) {
    let mut p = [0; POLICY_FIELDS];
    p[0] = (b as Field) * 0x1000000000000000000000000000000000000000000000000000000000000;
    (p, 1)
}

fn empty_msg() -> [Field; MSG_FIELDS] {
    [0; MSG_FIELDS]
}

fn msg_with(value: Field) -> [Field; MSG_FIELDS] {
    let mut m = [0; MSG_FIELDS];
    // Four printable hexadecimal bytes preserve distinct fixture values.
    let value = value as u32;
    let mut packed: Field = 0;
    for i in 0..4 {
        let nibble = (value >> ((3 - i) * 4)) & 15;
        let byte = if nibble < 10 { 48 + nibble } else { 87 + nibble };
        packed = packed * 256 + byte as Field;
    }
    m[0] = packed * 0x1000000000000000000000000000000000000000000000000000000;
    m
}

unconstrained fn fresh_post_nonce() -> Field {
    let nonce = aztec::oracle::random::random();
    assert(nonce != 0, "Test nonce must be nonzero");
    nonce
}

// ============================================================
// Setup helpers

pub fn test_chain(board: AztecAddress, owner: AztecAddress, amount: u128) -> Field {
    let content = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), board, 1,
        EthAddress::from_field(DEPOSITOR_ADDR), 1, amount);
    deposit_chain_id(board, owner, content, TEST_SECRET)
}
// ============================================================
pub unconstrained fn setup_with_censor(censor: AztecAddress) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    (env, contract_address, deployer, censor)
}

pub unconstrained fn setup() -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    (env, contract_address, deployer, censor)
}

/// Helper: deploy + send L1→L2 message + claim deposit.
/// Returns (env, contract_address, owner, censor, deposit_timestamp).
pub unconstrained fn setup_with_deposit(amount: u128) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, u64) {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let owner = env.create_light_account();
    let deployer = env.create_light_account();

    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);

    let portal = EthAddress::from_field(TEST_PORTAL);
    env.call_private(deployer, Billboard::at(contract_address).update_portal(portal));
    let depositor = EthAddress::from_field(DEPOSITOR_ADDR);
    let content = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), contract_address, 1, depositor, 1, amount);
    let leaf_index = env.send_l1_to_l2_message(content, TEST_SECRET, portal, contract_address);

    let deposit_time = env.last_block_timestamp();
    env.call_private(
        owner,
        Billboard::at(contract_address).claim_deposit(depositor, amount, 1, TEST_SECRET, leaf_index),
    );

    (env, contract_address, owner, censor, deposit_time)
}

/// Like setup_with_deposit but also sets the portal address (via deployer) so withdraw works.
pub unconstrained fn setup_with_deposit_and_portal(amount: u128) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress, u64) {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let owner = env.create_light_account();
    let deployer = env.create_light_account();

    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);

    let portal = EthAddress::from_field(TEST_PORTAL);
    // Set portal address via deployer (update_portal is private, deployer-only)
    env.call_private(deployer, Billboard::at(contract_address).update_portal(portal));

    let depositor = EthAddress::from_field(DEPOSITOR_ADDR);
    let content = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), contract_address, 1, depositor, 1, amount);
    let leaf_index = env.send_l1_to_l2_message(content, TEST_SECRET, portal, contract_address);

    let deposit_time = env.last_block_timestamp();
    env.call_private(
        owner,
        Billboard::at(contract_address).claim_deposit(depositor, amount, 1, TEST_SECRET, leaf_index),
    );

    (env, contract_address, owner, censor, deposit_time)
}

// ============================================================
// Pure function tests: compute_cooldown
// ============================================================

#[test]
unconstrained fn test_cooldown_at_min_deposit() {
    let cd = compute_cooldown(MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    assert(cd == BASE_COOLDOWN, f"Expected {BASE_COOLDOWN}, got {cd}");
}

#[test]
unconstrained fn test_cooldown_halves_when_deposit_doubles() {
    let cd = compute_cooldown(2 * MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    let expected = BASE_COOLDOWN / 2;
    assert(cd == expected, f"Expected {expected}, got {cd}");
}

#[test]
unconstrained fn test_cooldown_10x_deposit() {
    let cd = compute_cooldown(10 * MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    assert(cd == 360, f"Expected 360, got {cd}");
}

#[test]
unconstrained fn test_cooldown_100x_deposit() {
    let cd = compute_cooldown(100 * MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    assert(cd == 36, f"Expected 36, got {cd}");
}

#[test]
unconstrained fn test_cooldown_minimum_one_second() {
    let cd = compute_cooldown(10_000 * MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    assert(cd == 1, f"Expected 1 (minimum clamp), got {cd}");
}

#[test]
unconstrained fn test_cooldown_truncation() {
    let cd = compute_cooldown(3 * MIN_DEPOSIT, BASE_COOLDOWN, MIN_DEPOSIT);
    assert(cd == 1200, f"Expected 1200, got {cd}");
}

#[test]
unconstrained fn test_cooldown_no_overflow_at_large_values() {
    let cd = compute_cooldown(MIN_DEPOSIT, 1_000_000, MIN_DEPOSIT);
    assert(cd == 1_000_000, f"Expected 1000000, got {cd}");
}

// ============================================================
// Pure function tests: message hashes
// ============================================================

#[test]
unconstrained fn test_deposit_msg_hash_deterministic() {
    let h1 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    let h2 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    assert(h1 == h2, "Same inputs must produce same hash");
}

#[test]
unconstrained fn test_deposit_msg_hash_differs_by_amount() {
    let h1 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    let h2 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 2_000);
    assert(h1 != h2, "Different amounts must produce different hashes");
}

#[test]
unconstrained fn test_deposit_msg_hash_differs_by_depositor() {
    let h1 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    let h2 = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x5678), 1, 1_000);
    assert(h1 != h2, "Different depositors must produce different hashes");
}

#[test]
unconstrained fn test_withdraw_msg_hash_deterministic() {
    let h1 = get_withdraw_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    let h2 = get_withdraw_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    assert(h1 == h2, "Same inputs must produce same hash");
}

#[test]
unconstrained fn test_withdraw_msg_hash_differs_from_deposit_hash() {
    let wh = get_withdraw_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    let dh = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), AztecAddress::from_field(2), 2, EthAddress::from_field(0x1234), 1, 1_000);
    assert(wh != dh, "Deposit and withdraw hashes must differ");
}

// ============================================================
// init() deployment + view getters
// ============================================================

#[test]
unconstrained fn test_init_sets_all_parameters() {
    let (env, contract_address, deployer, censor) = setup();

    let min_dep = env.view_public(Billboard::at(contract_address).get_min_deposit());
    assert(min_dep == MIN_DEPOSIT, f"Expected min_deposit={MIN_DEPOSIT}, got {min_dep}");

    let bc = env.view_public(Billboard::at(contract_address).get_base_cooldown());
    assert(bc == BASE_COOLDOWN, f"Expected base_cooldown={BASE_COOLDOWN}, got {bc}");

    let k = env.view_public(Billboard::at(contract_address).get_k_multiplier());
    assert(k == K, f"Expected k={K}, got {k}");

    let cw = env.view_public(Billboard::at(contract_address).get_censor_window());
    assert(cw == CENSOR_WINDOW, f"Expected censor_window={CENSOR_WINDOW}, got {cw}");

    let msu = env.view_public(Billboard::at(contract_address).get_max_save_up());
    assert(msu == MAX_SAVE_UP, f"Expected max_save_up={MAX_SAVE_UP}, got {msu}");

    let stored_censor = env.view_public(Billboard::at(contract_address).get_censor());
    assert(stored_censor.to_field() == censor.to_field(), "Censor address mismatch");

    let stored_deployer = env.view_public(Billboard::at(contract_address).get_deployer());
    assert(stored_deployer.to_field() == deployer.to_field(), "Deployer address mismatch");

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 0, f"Expected post_count=0, got {count}");

    let portal_set = env.view_public(Billboard::at(contract_address).is_portal_set());
    assert(!portal_set, "Portal should not be set after init");
}

#[test]
unconstrained fn test_init_default_flag_state() {
    let (env, contract_address, _deployer, _censor) = setup();
    let exists = env.view_public(Billboard::at(contract_address).get_post_exists(0));
    assert(!exists, "Zero is not a real post identity");
}

// ============================================================
// init() parameter validation
// ============================================================

#[test(should_fail_with = "Min deposit must be > 0")]
unconstrained fn test_init_rejects_zero_min_deposit() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, 0, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

#[test(should_fail_with = "Base cooldown must be > 0")]
unconstrained fn test_init_rejects_zero_base_cooldown() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (0) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

#[test(should_fail_with = "K must be > 0")]
unconstrained fn test_init_rejects_zero_k() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (0) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

#[test(should_fail_with = "Censor window must be > 0")]
unconstrained fn test_init_rejects_zero_censor_window() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (0) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

#[test(should_fail_with = "Max save up must be > 0")]
unconstrained fn test_init_rejects_zero_max_save_up() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (0) as u16, default_policy(), 1,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

// ============================================================
// transfer_censor() access control + happy path
// ============================================================

#[test]
unconstrained fn test_transfer_censor_success() {
    let (mut env, contract_address, _deployer, censor) = setup();
    let new_censor = env.create_light_account();
    env.call_public(censor, Billboard::at(contract_address).transfer_censor(new_censor));
    let stored = env.view_public(Billboard::at(contract_address).get_censor());
    assert(stored.to_field() == new_censor.to_field(), "Censor should be updated");
}

#[test(should_fail_with = "Only censor can transfer rights")]
unconstrained fn test_transfer_censor_rejects_non_censor() {
    let (mut env, contract_address, _deployer, _censor) = setup();
    let attacker = env.create_light_account();
    let new_censor = env.create_light_account();
    env.call_public(attacker, Billboard::at(contract_address).transfer_censor(new_censor));
}

#[test(should_fail_with = "Cannot transfer to zero address")]
unconstrained fn test_transfer_censor_rejects_zero_address() {
    let (mut env, contract_address, _deployer, censor) = setup();
    env.call_public(censor, Billboard::at(contract_address).transfer_censor(AztecAddress::zero()));
}

#[test(should_fail_with = "Zero censor")]
unconstrained fn test_transfer_censor_fails_when_no_censor() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, AztecAddress::zero(), (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    let someone = env.create_light_account();
    env.call_public(someone, Billboard::at(contract_address).transfer_censor(someone));
}

#[test(should_fail_with = "Only censor can transfer rights")]
unconstrained fn test_transfer_censor_old_censor_loses_rights() {
    let (mut env, contract_address, _deployer, censor1) = setup();
    let censor2 = env.create_light_account();
    let censor3 = env.create_light_account();
    env.call_public(censor1, Billboard::at(contract_address).transfer_censor(censor2));
    env.call_public(censor1, Billboard::at(contract_address).transfer_censor(censor3));
}

// ============================================================
// declare_immoral() access control
// ============================================================

#[test(should_fail_with = "Only censor can declare immoral")]
unconstrained fn test_declare_immoral_rejects_non_censor() {
    let (mut env, contract_address, _deployer, _censor) = setup();
    let attacker = env.create_light_account();
    env.call_public(attacker, Billboard::at(contract_address).declare_immoral(0, empty_msg()));
}

#[test(should_fail_with = "Zero censor")]
unconstrained fn test_declare_immoral_fails_when_no_censor() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, AztecAddress::zero(), (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    let someone = env.create_light_account();
    env.call_public(someone, Billboard::at(contract_address).declare_immoral(0, empty_msg()));
}

#[test(should_fail_with = "Invalid post id")]
unconstrained fn test_declare_immoral_censor_passes_auth() {
    let (mut env, contract_address, _deployer, censor) = setup();
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(0, empty_msg()));
}

// ============================================================
// get_post() validation
// ============================================================

#[test(should_fail_with = "Invalid post id")]
unconstrained fn test_get_post_rejects_invalid_id() {
    let (env, contract_address, _deployer, _censor) = setup();
    let _ = env.view_public(Billboard::at(contract_address).get_post(0));
}

// ============================================================
// Moderation policy tests
// ============================================================

#[test]
unconstrained fn test_init_sets_default_policy() {
    let (env, contract_address, _deployer, _censor) = setup();
    let (_policy, len) = env.view_public(Billboard::at(contract_address).get_moderation_policy());
    assert(len == 1, f"Expected policy_len=1, got {len}");
}

#[test]
unconstrained fn test_init_sets_nondefault_policy() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let (policy, policy_len) = policy_with_byte(65); // 'A'
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, policy, policy_len,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    let (stored_policy, stored_len) = env.view_public(Billboard::at(contract_address).get_moderation_policy());
    assert(stored_len == 1, f"Expected policy_len=1, got {stored_len}");
    let p0 = stored_policy[0];
    assert(p0 == policy_with_byte(65).0[0], f"Expected policy[0]=65, got {p0}");
}

#[test]
unconstrained fn test_set_moderation_policy_by_censor() {
    let (mut env, contract_address, _deployer, censor) = setup();
    let (new_policy, new_len) = policy_with_byte(66); // 'B'
    env.call_public(censor, Billboard::at(contract_address).set_moderation_policy(new_policy, new_len));
    let (stored_policy, stored_len) = env.view_public(Billboard::at(contract_address).get_moderation_policy());
    assert(stored_len == 1, f"Expected policy_len=1, got {stored_len}");
    let p0 = stored_policy[0];
    assert(p0 == policy_with_byte(66).0[0], f"Expected policy[0]=66, got {p0}");
}

#[test(should_fail_with = "Only censor can set policy")]
unconstrained fn test_set_moderation_policy_rejects_non_censor() {
    let (mut env, contract_address, _deployer, _censor) = setup();
    let attacker = env.create_light_account();
    let (new_policy, new_len) = policy_with_byte(66);
    env.call_public(attacker, Billboard::at(contract_address).set_moderation_policy(new_policy, new_len));
}

#[test(should_fail_with = "Zero censor")]
unconstrained fn test_set_moderation_policy_fails_when_no_censor() {
    let mut env = TestEnvironment::new();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, AztecAddress::zero(), (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    let someone = env.create_light_account();
    let (new_policy, new_len) = policy_with_byte(66);
    env.call_public(someone, Billboard::at(contract_address).set_moderation_policy(new_policy, new_len));
}

#[test(should_fail_with = "Policy too long")]
unconstrained fn test_init_rejects_policy_too_long() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1489,
    );
    env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
}

#[test(should_fail_with = "Policy too long")]
unconstrained fn test_set_moderation_policy_rejects_too_long() {
    let (mut env, contract_address, _deployer, censor) = setup();
    env.call_public(censor, Billboard::at(contract_address).set_moderation_policy(default_policy(), 1489));
}

// ============================================================
// Full-flow integration tests (TestEnvironment with L1→L2 messaging)
// ============================================================
// Timing: mine_block_at(T) makes the next private call see now=T.
// Private functions read now from the anchor block header.
// Public functions write with context.timestamp() of the mined block.
// ============================================================

#[test]
unconstrained fn test_full_flow_first_post() {
    // Claim deposit → wait cooldown → first post (no screening needed)
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post_time);

    // First post: no prior posts, so no screening hints needed
    let (child, grandchild) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child.is_none(), "No child expected for first post");
    assert(grandchild.is_none(), "No grandchild expected for first post");

    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(42), 4, false, child, grandchild),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 1, f"Expected post_count=1, got {count}");

    let stored_msg = env.view_public(Billboard::at(contract_address).get_post(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    let m0 = stored_msg[0];
    assert(m0 == msg_with(42)[0], f"Expected msg[0]=42, got {m0}");

    let post_time_stored = env.view_public(Billboard::at(contract_address).get_post_time(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    assert(post_time_stored == post_time, f"Expected post_time={post_time}, got {post_time_stored}");
}

#[test(should_fail_with = "Too early to post -- time lock not yet expired")]
unconstrained fn test_full_flow_post_too_early() {
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    env.mine_block_at(deposit_time + 100);
    let (child, grandchild) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(42), 4, false, child, grandchild),
    );
}

#[test(should_fail_with = "Deposit below minimum")]
unconstrained fn test_full_flow_deposit_below_minimum() {
    let mut env = TestEnvironment::new();
    let censor = env.create_light_account();
    let owner = env.create_light_account();
    let deployer = env.create_light_account();
    let initializer = Billboard::interface().init(
        1, EthAddress::from_field(0x1111), 1, MIN_DEPOSIT, MAX_DEPOSIT, (BASE_COOLDOWN) as u32, censor, (K) as u16, (CENSOR_WINDOW) as u32, (MAX_SAVE_UP) as u16, default_policy(), 1,
    );
    let contract_address =
        env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer, initializer);
    let portal = EthAddress::from_field(TEST_PORTAL);
    let depositor = EthAddress::from_field(DEPOSITOR_ADDR);
    env.call_private(deployer, Billboard::at(contract_address).update_portal(portal));
    let small_amount: u128 = MIN_DEPOSIT / 2;
    let content = get_deposit_msg_hash(1, EthAddress::from_field(TEST_PORTAL), contract_address, 1, depositor, 1, small_amount);
    let leaf_index = env.send_l1_to_l2_message(content, TEST_SECRET, portal, contract_address);
    env.call_private(
        owner,
        Billboard::at(contract_address).claim_deposit(depositor, small_amount, 1, TEST_SECRET, leaf_index),
    );
}

#[test]
unconstrained fn test_full_flow_second_post_screens_first() {
    // Post 1 → wait censor_window + cooldown → post 2 (screens post 1)
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2: need to wait cooldown AND censor_window so post 1 can be screened
    // earliest = post1_time + BASE_COOLDOWN (no flags)
    // For screening: post1.timestamp <= now - censor_window
    //   => now >= post1_time + censor_window
    // So we need now >= max(post1_time + BASE_COOLDOWN, post1_time + CENSOR_WINDOW) + 1
    // Both are 3600, so:
    let post2_time = post1_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);

    // Get screening hints — should find child (post 0) but no grandchild
    // (child is the head, since only 1 post exists)
    let (child2, grandchild2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child2.is_some(), "Child expected for second post");
    // child is the head, so no grandchild
    assert(grandchild2.is_none(), "No grandchild expected when child is head");

    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, grandchild2),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 2, f"Expected count=2, got {count}");

    let stored_msg = env.view_public(Billboard::at(contract_address).get_post(env.view_public(Billboard::at(contract_address).get_post_id((1) as u64))));
    let m0 = stored_msg[0];
    assert(m0 == msg_with(200)[0], f"Expected msg[0]=200, got {m0}");
}

#[test]
unconstrained fn test_full_flow_declare_immoral_after_post() {
    // Post → censor flags it → verify flag state
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post_time);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child, gc),
    );

    // Censor flags post 0
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));

    let flagged = env.view_public(Billboard::at(contract_address).is_post_flagged(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    assert(flagged, "Post should be flagged");

    let flagger = env.view_public(Billboard::at(contract_address).get_post_flagged_by(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    assert(flagger.to_field() == censor.to_field(), "Flagger should be censor");

    let stored_response = env.view_public(Billboard::at(contract_address).get_censor_response(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    let r0 = stored_response[0];
    assert(r0 == msg_with(999)[0], f"Expected response[0]=999, got {r0}");
}

#[test(should_fail_with = "Already flagged")]
unconstrained fn test_full_flow_double_flag_fails() {
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    env.mine_block_at(deposit_time + BASE_COOLDOWN + 1);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child, gc),
    );
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(1)));
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(2)));
}

#[test]
unconstrained fn test_full_flow_second_post_with_flag() {
    // Post1 → flag post0 → post2 (cooldown extended by K because flag found during screening)
    // Key: the flag must be set BEFORE post2 screens post0.
    // Screening happens at post2 time. Post0 is screened if post0.timestamp <= now - censor_window.
    // So we need to wait censor_window after post1, then flag, then wait cooldown.
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Flag post 0 (can be done any time after post 0 exists)
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));

    // Post 2: screening will find post0 flagged → flag_count=1
    // The check for post2 is: now >= effective_old = old_next_allowed = post1_time + cooldown
    // For screening: post0.timestamp <= now - censor_window
    //   post0.timestamp = post1_time = deposit_time + cooldown + 1
    //   need now >= post1_time + censor_window = deposit_time + 2*cooldown + 1
    // Both conditions met at deposit_time + 2*cooldown + 1
    let post2_time = deposit_time + 2 * BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);

    let (child2, grandchild2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child2.is_some(), "Child expected");
    // child is the head (only 1 prior post), so no grandchild
    assert(grandchild2.is_none(), "No grandchild expected");

    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, grandchild2),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 2, f"Expected count=2, got {count}");
}

#[test(should_fail_with = "Too early to post -- time lock not yet expired")]
unconstrained fn test_full_flow_flag_penalty_post3_too_early() {
    // Post1 → flag post0 → post2 (screens, finds flag) → post3 too early → fail
    // The flag penalty from screening during post2 extends post3's time lock.
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));

    // Post 2 (screens post0, finds flag)
    let post2_time = deposit_time + 2 * BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // Post 3 too early — flag penalty extended next_allowed.
    // After post2: new_next_allowed = effective_old + cooldown*(1 + (K-1)*1)
    //   effective_old = deposit_time + 2*cooldown (old_next_allowed from post1)
    //   new_next_allowed = deposit_time + 2*cooldown + cooldown*(1 + 3) = deposit_time + 6*cooldown
    // Try at deposit_time + 6*cooldown - 1 (just 1 second too early)
    let too_early = deposit_time + 6 * BASE_COOLDOWN - 1;
    env.mine_block_at(too_early);
    let (child3, gc3) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(300), 4, false, child3, gc3),
    );
}

/// Verify the flag penalty is exactly K*cooldown (equivalent to K-1 dummy posts),
/// not (K+1)*cooldown. After post2 screens 1 flagged post:
///   new_next_allowed = effective_old + cooldown * (1 + (K-1)*1) = effective_old + K*cooldown
/// We verify by reading get_deposit_info after post2.
#[test]
unconstrained fn test_flag_penalty_exact_value() {
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 (index 0)
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Flag post 0
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));

    // Post 2 (screens post 0, finds flag)
    let post2_time = deposit_time + 2 * BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // After post2: effective_old = deposit_time + 2*cooldown (old_next_allowed)
    // new_next_allowed = effective_old + cooldown * (1 + (K-1)*1) = deposit_time + 2*cooldown + K*cooldown
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let next_allowed = info[10] as u64;
    let expected = deposit_time + 2 * BASE_COOLDOWN + K * BASE_COOLDOWN;
    assert(next_allowed == expected, f"Expected next_allowed={expected} (2+K)*cd, got {next_allowed}");
}

/// Verify: screening a flagged post is equivalent to making (K-1) dummy posts.
/// Verify flag penalty + save-up interaction: when dormant, the save-up floor
/// absorbs part of the penalty, exactly as if dummy posts were made at that time.
#[test]
unconstrained fn test_flag_penalty_with_save_up() {
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 (index 0)
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Flag post 0
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));

    // Go dormant for a long time, then post (screens flagged post0)
    let dormant_time = post1_time + 100_000;
    env.mine_block_at(dormant_time);

    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // save_up_floor = dormant_time - cooldown * max_save_up = dormant_time - 57600
    // effective_old = max(post1_time + cooldown, dormant_time - 57600)
    //   = max(deposit_time + 2*cooldown + 1, dormant_time - 57600)
    // dormant_time = post1_time + 100000 = deposit_time + cooldown + 1 + 100000 = deposit_time + 103601
    // dormant_time - 57600 = deposit_time + 46001
    // post1_time + cooldown = deposit_time + 2*cooldown + 1 = deposit_time + 7201
    // So effective_old = deposit_time + 46001 (save_up floor dominates)
    // new_next_allowed = effective_old + cooldown * (1 + (K-1)*1) = effective_old + K*cooldown
    //   = deposit_time + 46001 + 4*3600 = deposit_time + 46001 + 14400 = deposit_time + 60401
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let next_allowed = info[10] as u64;
    let save_up_floor = dormant_time - BASE_COOLDOWN * MAX_SAVE_UP;
    let expected = save_up_floor + K * BASE_COOLDOWN;
    assert(next_allowed == expected, f"Expected next_allowed={expected}, got {next_allowed}");

    // The save-up floor absorbed part of the penalty, but the equivalence holds:
    // making K posts at dormant_time would also give next = save_up_floor + K*cooldown.
}

/// Verify: two flagged posts screened at once → penalty = (1 + 2*(K-1)) cooldowns
#[test]
unconstrained fn test_flag_penalty_two_flags() {
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 (index 0)
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2 (index 1) — post0 too young to screen
    let post2_time = deposit_time + 2 * BASE_COOLDOWN;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // Flag both posts
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((1) as u64)), msg_with(998)));

    // Post 3 — screens both post0 (child) and post1 (grandchild), finds 2 flags
    // Need both posts old enough: now >= post2_time + censor_window = deposit_time + 3*cooldown
    // After post2 (no screening): next_allowed = deposit_time + 3*cooldown
    let post3_time = deposit_time + 3 * BASE_COOLDOWN + 1;
    env.mine_block_at(post3_time);
    let (child3, gc3) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child3.is_some(), "Child expected");
    assert(gc3.is_some(), "Grandchild expected");
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(300), 4, false, child3, gc3),
    );

    // effective_old = deposit_time + 3*cooldown (old_next_allowed)
    // flag_count = 2, penalty_multiplier = 1 + (K-1)*2 = 1 + 6 = 7
    // new_next_allowed = deposit_time + 3*cooldown + 7*cooldown = deposit_time + 10*cooldown
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let next_allowed = info[10] as u64;
    let expected = deposit_time + 3 * BASE_COOLDOWN + (1 + 2 * (K - 1)) * BASE_COOLDOWN;
    assert(next_allowed == expected, f"Expected next_allowed={expected}, got {next_allowed}");
}

#[test]
unconstrained fn test_full_flow_second_post_without_flag() {
    // No flag → second post only needs base_cooldown after post1
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // earliest = post1_time + 3600 (no flags)
    let post2_time = post1_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);

    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 2, f"Expected count=2, got {count}");
}

#[test]
unconstrained fn test_full_flow_get_deposit_info() {
    // After claiming, get_deposit_info should return deposit details
    let (env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));

    // [amount, l1_depositor, post_chain_head, last_screened_link,
    //  last_screened_index, last_real_post_index, next_allowed_time]
    let amt = info[3];
    assert(amt == MIN_DEPOSIT as Field, f"Expected amount={MIN_DEPOSIT}, got {amt}");
    let expected_next = (deposit_time + BASE_COOLDOWN) as Field;
    let next_allowed = info[10];
    assert(next_allowed == expected_next, f"Expected next_allowed_time={expected_next}, got {next_allowed}");
    // post_chain_head = SENTINEL = 0
    let chain_head = info[5];
    assert(chain_head == 0, f"Expected post_chain_head=0 (SENTINEL), got {chain_head}");
    // last_screened_link = SENTINEL = 0
    let last_scr = info[7];
    assert(last_scr == 0, f"Expected last_screened_link=0 (SENTINEL), got {last_scr}");
}

#[test]
unconstrained fn test_full_flow_multiple_posts() {
    // Post 3 times without flags — each post screens the previous one
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let mut current_time = deposit_time + BASE_COOLDOWN + 1;

    for i in 0..3 {
        env.mine_block_at(current_time);
        let (child, gc) =
            env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
        env.call_private(
            owner,
            Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with((i + 1) as Field), 4, false, child, gc),
        );

        let count = env.view_public(Billboard::at(contract_address).get_post_count());
        let expected_count = i + 1;
        assert(count == expected_count, f"After post {i}, expected count={expected_count}, got {count}");

        current_time = current_time + BASE_COOLDOWN + 1;
    }

    for i in 0..3 {
        let stored = env.view_public(Billboard::at(contract_address).get_post(env.view_public(Billboard::at(contract_address).get_post_id((i) as u64))));
        let s0 = stored[0];
        let expected = msg_with((i + 1) as Field)[0];
        assert(s0 == expected, f"Post {i}: expected msg[0]={expected}, got {s0}");
    }
}

// ============================================================
// Censor window tests
// ============================================================

#[test]
unconstrained fn test_censor_window_post_too_young_to_screen() {
    // Post1 → post2 quickly (post1 too young to screen) →
    // post3 later (screens both post1 and post2 via child+grandchild)
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2 at the exact time-lock boundary.
    // After post1: next_allowed = deposit_time + 2*cooldown (effective_old + cooldown)
    // Set post2_time = deposit_time + 2*cooldown (exactly at boundary)
    // screen_threshold = post2_time - censor_window = deposit_time + 2*cooldown - cooldown = deposit_time + cooldown
    // child.timestamp = post1_time = deposit_time + cooldown + 1 > deposit_time + cooldown → child NOT screenable
    let post2_time = deposit_time + 2 * BASE_COOLDOWN;
    env.mine_block_at(post2_time);

    let (child2, grandchild2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    // child = post1, but post1.timestamp = post1_time > post2_time - censor_window
    // So child is too young — screening is skipped
    // The post still succeeds (screening is best-effort, not required)
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, grandchild2),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 2, f"Expected count=2, got {count}");

    // Verify deposit info shows last_screened hasn't advanced
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    // last_screened_link should still be SENTINEL (0) — nothing screened
    let last_scr = info[7];
    assert(last_scr == 0, f"Expected last_screened_link=0 (nothing screened), got {last_scr}");
}

#[test]
unconstrained fn test_censor_window_grandchild_screening() {
    // Post1 → post2 (post1 too young) → wait → post3 (screens post1=child + post2=grandchild)
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2 at the exact time-lock boundary (post1 too young to screen)
    let post2_time = deposit_time + 2 * BASE_COOLDOWN;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // Post 3 — wait long enough for both post1 and post2 to be screenable.
    // After post2 (no screening): next_allowed = deposit_time + 3*cooldown
    // screen_threshold = post3_time - censor_window
    // Need post1_time <= screen_threshold AND post2_time <= screen_threshold
    // post3_time >= post2_time + censor_window = (deposit_time + 2*cooldown) + cooldown = deposit_time + 3*cooldown
    let post3_time = deposit_time + 3 * BASE_COOLDOWN + 1;
    env.mine_block_at(post3_time);

    let (child3, grandchild3) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    // child = post1 (prev_link == SENTINEL == last_screened)
    assert(child3.is_some(), "Child expected");
    // grandchild = post2 (prev_link == child_link)
    assert(grandchild3.is_some(), "Grandchild expected — 2 unscreened posts");

    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(300), 4, false, child3, grandchild3),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 3, f"Expected count=3, got {count}");

    // Verify last_screened has advanced to post2 (index 1)
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_screened_idx = info[8] as u32;
    assert(last_screened_idx == 2, f"Expected last_screened_index=1, got {last_screened_idx}");
}

/// Verify the hard invariant: when a post goes onchain, the censor has at least
/// censor_window to flag it before it can be screened. We verify by:
/// 1. Post at time T
/// 2. Flag it at time T + censor_window/2 (within the window)
/// 3. Make a post at time T + censor_window/2 + cooldown (post too young to screen)
///    → screening skipped, flag is NOT yet counted
/// 4. Make a post at time T + censor_window + cooldown (now old enough to screen)
///    → screening happens, flag IS counted, penalty applies
#[test]
unconstrained fn test_censor_window_hard_invariant() {
    let (mut env, contract_address, owner, censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 at time T
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Flag post 0 well within the censor window (at T + 1)
    env.call_public(censor, Billboard::at(contract_address).declare_immoral(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64)), msg_with(999)));
    let flagged = env.view_public(Billboard::at(contract_address).is_post_flagged(env.view_public(Billboard::at(contract_address).get_post_id((0) as u64))));
    assert(flagged, "Post should be flagged");

    // Post 2 at T + cooldown (post0 is still too young to screen: age < censor_window)
    // post0.timestamp = post1_time. screen_threshold = post2_time - censor_window
    // post2_time = deposit_time + 2*cooldown. screen_threshold = deposit_time + cooldown.
    // post0.timestamp = deposit_time + cooldown + 1 > deposit_time + cooldown → not screenable
    let post2_time = deposit_time + 2 * BASE_COOLDOWN;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(200), 4, false, child2, gc2),
    );

    // Verify post0 was NOT screened (too young)
    let info2 = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_scr2 = info2[8] as u32;
    assert(last_scr2 == 0, f"Post0 should not be screened yet, got last_screened={last_scr2}");
    // next_allowed should be just effective_old + cooldown (no flag penalty)
    let next2 = info2[10] as u64;
    let expected_next2 = deposit_time + 3 * BASE_COOLDOWN; // effective_old=2*cd + cd
    assert(next2 == expected_next2, f"Expected next={expected_next2} (no penalty), got {next2}");

    // Post 3 at T + 2*cooldown + censor_window (now post0 is old enough: age = censor_window + 1)
    // post3_time = deposit_time + 3*cooldown + 1
    // screen_threshold = post3_time - censor_window = deposit_time + 2*cooldown + 1
    // post0.timestamp = deposit_time + cooldown + 1 <= deposit_time + 2*cooldown + 1 → screenable!
    // post1.timestamp = deposit_time + 2*cooldown <= deposit_time + 2*cooldown + 1 → screenable!
    // Both screened, post0 is flagged → flag_count=1 (post1 not flagged)
    // Penalty: effective_old + cooldown*(1+(K-1)*1) = effective_old + K*cooldown
    let post3_time = deposit_time + 3 * BASE_COOLDOWN + 1;
    env.mine_block_at(post3_time);
    let (child3, gc3) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child3.is_some(), "Child expected");
    assert(gc3.is_some(), "Grandchild expected");
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(300), 4, false, child3, gc3),
    );

    // Now post0 WAS screened (flag counted). Verify penalty applied.
    let info3 = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_scr3 = info3[8] as u32;
    assert(last_scr3 == 2, f"Both posts screened, last_screened should be 1, got {last_scr3}");
    // effective_old = deposit_time + 3*cooldown (old_next_allowed)
    // new_next = effective_old + K*cooldown = deposit_time + (3+K)*cooldown
    let next3 = info3[10] as u64;
    let expected_next3 = deposit_time + (3 + K) * BASE_COOLDOWN;
    assert(next3 == expected_next3, f"Expected next={expected_next3} (with penalty), got {next3}");
}

// ============================================================
// Dummy post tests
// ============================================================

#[test]
unconstrained fn test_dummy_post_does_not_store_content() {
    // Dummy post does not create a public post or allocate an order index.
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post_time);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));

    // Post a dummy
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, 0, [0; 32], 0, true, child, gc),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert_eq(count, 0, "Dummy must not allocate public order");
    assert(!env.view_public(Billboard::at(contract_address).get_post_exists(0)));
    let (dummy, _) = env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert_eq(dummy.unwrap_unchecked().note.post_id, 0);

    // last_real_post_index should still be NO_REAL_POST
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_real = info[9] as u32;
    assert(last_real == 0, f"Expected last_real_post_index=NO_REAL_POST, got {last_real}");
}

#[test]
unconstrained fn test_dummy_post_advances_screening() {
    // Post1 (real) → dummy posts to advance screening → withdraw
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 (real)
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2 (dummy) — screens post 1
    let post2_time = post1_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, 0, [0; 32], 0, true, child2, gc2),
    );

    // Verify screening advanced
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_screened = info[8] as u32;
    assert(last_screened == 1, f"Expected last_screened_index=0, got {last_screened}");
    let last_real = info[9] as u32;
    assert(last_real == 1, f"Expected last_real_post_index=0, got {last_real}");
}

// ============================================================
// Withdrawal tests
// ============================================================

#[test(should_fail_with = "Too early to withdraw -- time lock not expired")]
unconstrained fn test_withdraw_no_posts_too_early() {
    // Claim deposit → try to withdraw before initial lock → fail
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Try to withdraw before cooldown
    env.mine_block_at(deposit_time + 100);

    let portal = EthAddress::from_field(TEST_PORTAL);
    env.call_private(owner, Billboard::at(contract_address).withdraw(chain));
}

#[test(should_fail_with = "Too early to withdraw -- not all posts screened")]
unconstrained fn test_withdraw_unscreened_real_posts() {
    // Post1 (real) → try to withdraw before screening catches up → fail
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child, gc),
    );

    // Try to withdraw — post 0 hasn't been screened yet
    let portal = EthAddress::from_field(TEST_PORTAL);
    env.call_private(owner, Billboard::at(contract_address).withdraw(chain));
}

/// Verify: withdraw succeeds after making a dummy post to screen the last real post.
/// Flow: post (real) → dummy post (screens real) → withdraw succeeds
#[test]
unconstrained fn test_withdraw_succeeds_after_dummy_post() {
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit_and_portal(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1 (real, index 0)
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child1, gc1) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(100), 4, false, child1, gc1),
    );

    // Post 2 (dummy) — screens post 0
    let post2_time = post1_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post2_time);
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, 0, [0; 32], 0, true, child2, gc2),
    );

    // Verify last_screened >= last_real_post (withdrawal eligibility)
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let last_screened = info[8] as u32;
    let last_real = info[9] as u32;
    assert(last_screened == 1, f"Expected last_screened=0, got {last_screened}");
    assert(last_real == 1, f"Expected last_real=0, got {last_real}");
    assert(last_screened >= last_real, "Should be eligible to withdraw");

    // Screening does not waive the remaining cooldown debt.
    env.mine_block_at(info[10] as u64);
    // Withdraw should succeed
    let portal = EthAddress::from_field(TEST_PORTAL);
    env.call_private(owner, Billboard::at(contract_address).withdraw(chain));

    // Verify deposit note is consumed
    let info2 = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    let amt = info2[3];
    assert(amt == 0, "Deposit note should be consumed after withdraw");
}

// ============================================================
// Save-up rule tests
// ============================================================

#[test]
unconstrained fn test_save_up_allows_burst_after_dormancy() {
    // After dormancy, user can make ~max_save_up+1 posts in quick succession
    // because the save-up floor resets the timer.
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(1), 4, false, child, gc),
    );

    // Go dormant for a very long time
    let dormant_time = post1_time + 100_000;
    env.mine_block_at(dormant_time);

    // Post 2 — save-up floor should reset the timer
    // save_up_floor = dormant_time - cooldown * max_save_up = dormant_time - 57600
    // effective_old = max(post1_time + 3600, dormant_time - 57600) = dormant_time - 57600
    // earliest = (dormant_time - 57600) + 3600 = dormant_time - 54000
    // dormant_time > earliest, so post succeeds
    let (child2, gc2) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(2), 4, false, child2, gc2),
    );

    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == 2, f"Expected count=2, got {count}");

    // Post 3 immediately after (same timestamp + 1)
    // Now old_next_allowed = dormant_time - 54000
    // save_up_floor = (dormant_time + 1) - 57600 = dormant_time - 57599
    // effective_old = max(dormant_time - 54000, dormant_time - 57599) = dormant_time - 54000
    // earliest = dormant_time - 54000 + 3600 = dormant_time - 50400
    // dormant_time + 1 > earliest, so post succeeds
    env.mine_block_at(dormant_time + 1);
    let (child3, gc3) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(3), 4, false, child3, gc3),
    );

    let count2 = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count2 == 3, f"Expected count=3, got {count2}");
}

#[test(should_fail_with = "Too early to post -- time lock not yet expired")]
unconstrained fn test_save_up_prevents_excessive_burst() {
    // After dormancy, user can make max_save_up+1 posts quickly, but not more.
    // Each post sets next_allowed = effective_old + cooldown.
    // After max_save_up+1 posts, the save-up floor no longer helps.
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);

    // Post 1
    let post1_time = deposit_time + BASE_COOLDOWN + 1;
    env.mine_block_at(post1_time);
    let (child, gc) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(1), 4, false, child, gc),
    );

    // Go dormant
    let dormant_time = post1_time + 100_000;
    env.mine_block_at(dormant_time);

    // Make max_save_up + 1 posts in quick succession (should all succeed)
    for i in 0..MAX_SAVE_UP + 1 {
        let t = dormant_time + i;
        env.mine_block_at(t);
        let (child_i, gc_i) =
            env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
        env.call_private(
            owner,
            Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with((i + 2) as Field), 4, false, child_i, gc_i),
        );
    }

    // The next post should fail — save-up budget exhausted
    let t_fail = dormant_time + MAX_SAVE_UP + 1;
    env.mine_block_at(t_fail);
    let (child_f, gc_f) =
        env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(
        owner,
        Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(999), 4, false, child_f, gc_f),
    );
}

// P03: real note-history boundary controls. These are local TXE executions,
// not a claim about full PXE ordering or production proof generation.
pub unconstrained fn setup_regular_history(length: u32) -> (TestEnvironment, AztecAddress, AztecAddress, u64) {
    let (mut env, contract_address, owner, _censor, deposit_time) = setup_with_deposit(MIN_DEPOSIT);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    for i in 0..length {
        env.mine_block_at(deposit_time + (i as u64 + 1) * (BASE_COOLDOWN + CENSOR_WINDOW + 1));
        let (child, grandchild) = env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
        env.call_private(owner, Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(i as Field + 1), 4, false, child, grandchild));
    }
    let count = env.view_public(Billboard::at(contract_address).get_post_count());
    assert(count == length as u64, f"History setup expected {length}, got {count}");
    (env, contract_address, owner, deposit_time)
}

#[test]
unconstrained fn test_history_first_page_control() {
    let (mut env, contract_address, owner, _deposit_time) = setup_regular_history(16);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    let (child, _grandchild) = env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child.is_some(), "Last note in first page must be discoverable");
    let hinted = child.unwrap_unchecked();
    let index = hinted.note.post_id;
    assert(index == env.view_public(Billboard::at(contract_address).get_post_id(15)), f"Expected first-page last child15, got {index}");
}

#[test]
unconstrained fn test_history_known_bad_missing_child_after_first_page() {
    let (mut env, contract_address, owner, _deposit_time) = setup_regular_history(17);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    let notes = env.execute_utility(Billboard::at(contract_address).get_post_notes(owner));
    for i in 0..16 {
        assert(notes[i].is_some(), "First history page must be full");
        let note = notes[i].unwrap_unchecked();
        let index = note.note.post_id;
        assert(index == env.view_public(Billboard::at(contract_address).get_post_id(i as u64)), f"Measured TXE first-page index expected {i}, got {index}");
    }
    let info = env.execute_utility(Billboard::at(contract_address).get_deposit_info(owner, chain));
    assert(info[8] == 16, "Previous child must actually have been screened");
    assert(info[9] == 17, "The seventeenth real post must exist");
    let (child, grandchild) = env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    assert(child.is_none(), "Known-bad control: next required child is omitted by first page");
    assert(grandchild.is_none(), "No grandchild expected without child");
}

#[test(should_fail_with = "Child note required for screening")]
unconstrained fn test_history_known_bad_next_post_cannot_progress() {
    let (mut env, contract_address, owner, deposit_time) = setup_regular_history(17);
    let chain = test_chain(contract_address, owner, MIN_DEPOSIT);
    env.mine_block_at(deposit_time + 18 * (BASE_COOLDOWN + CENSOR_WINDOW + 1));
    let (child, grandchild) = env.execute_utility(Billboard::at(contract_address).get_screen_hints(owner, chain));
    env.call_private(owner, Billboard::at(contract_address).post(chain, crate::fresh_post_nonce(), msg_with(18), 4, false, child, grandchild));
}
