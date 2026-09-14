// C01 regressions execute production helpers and the matched TXE contract entrypoints.
// TXE-created messages and oracle rejections are not genuine rollup-proof assurance.
use aztec::protocol::traits::FromField;
use aztec::protocol::address::{AztecAddress, EthAddress};
use aztec::test::helpers::test_environment::TestEnvironment;
use billboard_contract::Billboard;
use billboard_contract::lib::{get_config_hash, get_ready_msg_hash, get_deposit_msg_hash,
    get_withdraw_msg_hash, deposit_chain_id, compute_cooldown, checked_time_add, validate_policy};
use crate::{setup, setup_with_deposit, test_chain};

global MINIMUM: u128 = 1_000_000_000_000_000;
global MAXIMUM: u128 = 100_000_000_000_000_000_000;
global PORTAL: Field = 0xaabbccdd;
global DEPOSITOR: Field = 0x12345678;
global SECRET: Field = 0xdeadbeef;

// Padding-only test builder: validation itself always calls production code.
fn policy_bytes<let N: u32>(input: [u8; N]) -> [Field; 48] {
    let mut policy = [0;48];
    for i in 0..48 {
        let mut value: Field = 0;
        for j in 0..31 {
            value *= 256;
            if i*31+j < N { value += input[i*31+j] as Field; }
        }
        policy[i] = value;
    }
    policy
}

#[test]
fn c01_cooldown_ceiling_and_maximum_boundaries() {
    assert_eq(compute_cooldown(3,10,1),4);
    assert_eq(compute_cooldown(10,10,1),1);
    assert_eq(compute_cooldown(11,10,1),1);
    assert_eq(compute_cooldown(0xffffffffffffffffffffffff,0xffffffff,0xffffffffffffffffffffffff),0xffffffff);
    assert_eq(checked_time_add(0x7ffffffffffffffe,1),0x7fffffffffffffff);
}
#[test(should_fail_with="Invalid deposit amount")]
fn c01_cooldown_rejects_zero_amount() { let _ = compute_cooldown(0,10,1); }
#[test(should_fail_with="Invalid deposit amount")]
fn c01_cooldown_rejects_above_u96() { let _ = compute_cooldown(0x1000000000000000000000000,10,1); }
#[test(should_fail_with="Invalid base cooldown")]
fn c01_cooldown_rejects_above_u32() { let _ = compute_cooldown(1,0x100000000,1); }
#[test(should_fail_with="Eligibility timestamp overflow")]
fn c01_time_rejects_horizon_crossing() { let _ = checked_time_add(0x7fffffffffffffff,1); }
#[test(should_fail_with="Timestamp out of range")]
fn c01_time_rejects_out_of_range_anchor() { let _ = checked_time_add(0x8000000000000000,0); }

#[test]
fn c01_utf8_valid_scalar_and_field_crossing_controls() {
    validate_policy(policy_bytes([0x41,0xc3,0xa9,0xf0,0x9f,0x98,0x80]),7);
    let mut crossing: [u8;32]=[0x41;32]; crossing[30]=0xc3; crossing[31]=0xa9;
    validate_policy(policy_bytes(crossing),32);
    validate_policy(policy_bytes([0xf4,0x8f,0xbf,0xbf]),4);
}
#[test(should_fail_with="Invalid policy UTF-8 lead")]
fn c01_utf8_rejects_overlong_lead() { validate_policy(policy_bytes([0xc0,0xaf]),2); }
#[test(should_fail_with="Invalid policy UTF-8 continuation")]
fn c01_utf8_rejects_surrogate() { validate_policy(policy_bytes([0xed,0xa0,0x80]),3); }
#[test(should_fail_with="Invalid policy UTF-8 continuation")]
fn c01_utf8_rejects_scalar_above_unicode_maximum() { validate_policy(policy_bytes([0xf4,0x90,0x80,0x80]),4); }
#[test(should_fail_with="Truncated policy UTF-8")]
fn c01_utf8_rejects_truncation() { validate_policy(policy_bytes([0xe2,0x82]),2); }
#[test(should_fail_with="Policy contains NUL")]
fn c01_utf8_rejects_nul() { validate_policy(policy_bytes([0x41,0x00]),2); }
#[test(should_fail_with="Nonzero policy padding")]
fn c01_utf8_rejects_hidden_suffix() { validate_policy(policy_bytes([0x41,0x42]),1); }
#[test(should_fail_with="Policy field exceeds 31 bytes")]
fn c01_utf8_rejects_noncanonical_field() {
    let mut policy=[0;48]; policy[0]=0x100000000000000000000000000000000000000000000000000000000000000;
    validate_policy(policy,1);
}

unconstrained fn bound_setup() -> (TestEnvironment,AztecAddress,AztecAddress) {
    let (mut env,board,deployer,_censor)=setup();
    let owner=env.create_light_account();
    env.call_private(deployer,Billboard::at(board).update_portal(EthAddress::from_field(PORTAL)));
    (env,board,owner)
}

// C01 binding authority regressions. Existing bound_setup/valid claim is the normal control.
#[test(should_fail_with="Only deployer can set portal")]
unconstrained fn c01_binding_rejects_unauthorized_private_caller() {
    let (mut env,board,deployer,_censor)=setup();
    let attacker=env.create_light_account();
    assert(attacker != deployer);
    assert(!env.view_public(Billboard::at(board).is_portal_set()));
    env.call_private(attacker,Billboard::at(board).update_portal(EthAddress::from_field(PORTAL)));
}

#[test(should_fail_with="Function _set_portal_public can only be called by the same contract")]
unconstrained fn c01_binding_rejects_direct_nonself_public_call() {
    let (mut env,board,deployer,_censor)=setup();
    assert(deployer != board);
    assert(!env.view_public(Billboard::at(board).is_portal_set()));
    // Even the authorized deployer cannot bypass the private-to-self binding path.
    env.call_public(deployer,Billboard::at(board)._set_portal_public(EthAddress::from_field(PORTAL)));
}

#[test(should_fail_with="Zero portal")]
unconstrained fn c01_binding_rejects_zero_portal() {
    let (mut env,board,deployer,_censor)=setup();
    assert(!env.view_public(Billboard::at(board).is_portal_set()));
    env.call_private(deployer,Billboard::at(board).update_portal(EthAddress::from_field(0)));
}

#[test(should_fail_with="Portal address already set -- immutable")]
unconstrained fn c01_binding_rejects_second_binding() {
    let (mut env,board,deployer,_censor)=setup();
    env.call_private(deployer,Billboard::at(board).update_portal(EthAddress::from_field(PORTAL)));
    assert(env.view_public(Billboard::at(board).is_portal_set()));
    assert_eq(env.view_public(Billboard::at(board).get_portal()),EthAddress::from_field(PORTAL));
    env.call_private(deployer,Billboard::at(board).update_portal(EthAddress::from_field(PORTAL+1)));
}

#[test]
unconstrained fn c01_claim_delivers_exact_v1_receipt_and_initial_eligibility() {
    let (mut env,board,owner,_censor,anchor_time)=setup_with_deposit(MINIMUM);
    let chain=test_chain(board,owner,MINIMUM);
    let actual=env.execute_utility(Billboard::at(board).get_deposit_info(owner,chain));
    assert_eq(actual,[1,chain,1,MINIMUM as Field,DEPOSITOR,0,0,0,0,0,(anchor_time+3600) as Field]);
    let absent=env.execute_utility(Billboard::at(board).get_deposit_info(owner,chain+1));
    assert_eq(absent,[0;11]);
}

#[test(should_fail_with="Trying to read from uninitialized PublicImmutable")]
unconstrained fn c01_claim_rejects_unbound_portal() {
    let (mut env,board,owner,_censor)=setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET,leaf));
}

#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_wrong_portal_origin() {
    let (mut env,board,owner)=bound_setup();
    // Content is correct for the configured portal, but the actual envelope origin is different.
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL+1),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET,leaf));
}
#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_wrong_recipient_envelope() {
    let (mut env,board,owner)=bound_setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),owner);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET,leaf));
}
#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_wrong_nonzero_secret() {
    let (mut env,board,owner)=bound_setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET+1,leaf));
}
#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_changed_receipt_nonce() {
    let (mut env,board,owner)=bound_setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,2,SECRET,leaf));
}
#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_changed_nonzero_depositor() {
    let (mut env,board,owner)=bound_setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR+1),MINIMUM,1,SECRET,leaf));
}
#[test(should_fail_with="No L1 to L2 message found")]
unconstrained fn c01_claim_rejects_changed_in_range_amount() {
    let (mut env,board,owner)=bound_setup();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    assert(MINIMUM+1 <= MAXIMUM);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM+1,1,SECRET,leaf));
}
#[test(should_fail_with="Deposit above maximum")]
unconstrained fn c01_claim_rejects_amount_above_configuration() {
    let (mut env,board,owner)=bound_setup();
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MAXIMUM+1,1,SECRET,0));
}
#[test(should_fail_with="Zero claim secret")]
unconstrained fn c01_claim_rejects_zero_secret() {
    let (mut env,board,owner)=bound_setup();
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,0,0));
}
#[test(should_fail_with="No non-nullified L1 to L2 message found")]
unconstrained fn c01_claim_replay_cannot_mint_right_for_second_owner() {
    let (mut env,board,owner)=bound_setup();
    let second_owner=env.create_light_account();
    let content=get_deposit_msg_hash(1,EthAddress::from_field(PORTAL),board,1,EthAddress::from_field(DEPOSITOR),1,MINIMUM);
    let leaf=env.send_l1_to_l2_message(content,SECRET,EthAddress::from_field(PORTAL),board);
    env.call_private(owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET,leaf));
    let chain=deposit_chain_id(board,owner,content,SECRET);
    let first=env.execute_utility(Billboard::at(board).get_deposit_info(owner,chain));
    assert_eq(first[0],1); assert_eq(first[2],1); assert_eq(first[3],MINIMUM as Field);
    env.call_private(second_owner,Billboard::at(board).claim_deposit(EthAddress::from_field(DEPOSITOR),MINIMUM,1,SECRET,leaf));
}

#[test]
fn c01_frozen_config_vector() {
    assert_eq(get_config_hash(31337, EthAddress::from_field(0x1111111111111111111111111111111111111111), AztecAddress::from_field(0x0000000000000000000000000000000000000000000000000000000000000002), 1, 1000000000000000, 100000000000000000000, 3600, 4, 3600, 16), 0x00c9a412349577d749aecf752562248db07ad55545d9577ba40a30c3d971e25a);
}

#[test]
fn c01_frozen_ready_vector() {
    assert_eq(get_ready_msg_hash(31337, EthAddress::from_field(0x3333333333333333333333333333333333333333), AztecAddress::from_field(0x0000000000000000000000000000000000000000000000000000000000000002), 1, 0x00c9a412349577d749aecf752562248db07ad55545d9577ba40a30c3d971e25a), 0x00d6cfd172a01a0ed7a6f92dff58cab33c66ec70c2a669954e992f262dc09f4b);
}

#[test]
fn c01_frozen_claim_vector() {
    assert_eq(get_deposit_msg_hash(31337, EthAddress::from_field(0x3333333333333333333333333333333333333333), AztecAddress::from_field(0x0000000000000000000000000000000000000000000000000000000000000002), 1, EthAddress::from_field(0x0000000000000000000000000000000000000004), 1, 1000000000000000), 0x00ac37db55ed41d39ec52c9bb0fe284a571f1a265b3b2d711e90d77f0fac0216);
}

#[test]
fn c01_frozen_exit_vector() {
    assert_eq(get_withdraw_msg_hash(31337, EthAddress::from_field(0x3333333333333333333333333333333333333333), AztecAddress::from_field(0x0000000000000000000000000000000000000000000000000000000000000002), 1, EthAddress::from_field(0x0000000000000000000000000000000000000004), 1, 1000000000000000), 0x00b0d405fbace9e4a27eefada3a695414599bbd52db63038c787f438184a755b);
}

#[test]
fn c01_frozen_claim_boundary_vector() {
    assert_eq(get_deposit_msg_hash(31337, EthAddress::from_field(0x3333333333333333333333333333333333333333), AztecAddress::from_field(0x0000000000000000000000000000000000000000000000000000000000000002), 1, EthAddress::from_field(0x0000000000000000000000000000000000000004), 18446744073709551615, 79228162514264337593543950335), 0x0051330adffea13f8863144b4802b56b659fcc82d3fb3936d02e6be96bfa950f);
}

// The corrected TXE service uses actual chain/version 1/1 on both sides.
// The normal claim test above is the matching control; production scope checks remain active.
#[test(should_fail_with="Wrong rollup version")]
unconstrained fn c01_init_rejects_wrong_configured_rollup_version() {
    let mut env=TestEnvironment::new();
    let deployer=env.create_light_account(); let censor=env.create_light_account();
    let init=Billboard::interface().init(1,EthAddress::from_field(0x1111),2,MINIMUM,MAXIMUM,3600,censor,4,3600,16,policy_bytes([65]),1);
    let _board=env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer,init);
}
#[test(should_fail_with="Wrong chain")]
unconstrained fn c01_init_rejects_wrong_configured_chain() {
    let mut env=TestEnvironment::new();
    let deployer=env.create_light_account(); let censor=env.create_light_account();
    let init=Billboard::interface().init(2,EthAddress::from_field(0x1111),1,MINIMUM,MAXIMUM,3600,censor,4,3600,16,policy_bytes([65]),1);
    let _board=env.deploy("@billboard_contract/Billboard").with_public_initializer(deployer,init);
}
