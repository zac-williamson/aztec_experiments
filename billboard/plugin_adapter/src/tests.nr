use crate::{PluginAdapter,words};
use aztec::{test::helpers::test_environment::TestEnvironment,protocol::{address::{AztecAddress,EthAddress},traits::ToField,hash::sha256_to_field}};
unconstrained fn setup() -> (TestEnvironment,AztecAddress,AztecAddress,AztecAddress,AztecAddress) {
 let mut env=TestEnvironment::new();let user=env.create_light_account();let operator=env.create_light_account();let board=env.create_light_account();
 let address=env.deploy("@plugin_adapter/PluginAdapter").with_public_initializer(user,PluginAdapter::interface().init(board,operator,1,1));
 let portal=EthAddress::from_field(123);env.call_public(user,PluginAdapter::at(address).set_portal(portal));
 let content=sha256_to_field(words("PLUGIN_CREDIT_V1",[1,123,address.to_field(),1,user.to_field(),1000000]));
 let leaf=env.send_l1_to_l2_message(content,42,portal,address);env.call_private(user,PluginAdapter::at(address).claim(1000000,42,leaf));
 env.call_public(board,PluginAdapter::at(address).on_invocation(user,10));env.call_public(operator,PluginAdapter::at(address).start(10));
 (env,address,user,operator,board)
}
#[test]
unconstrained fn escrow_conserves_and_releases() {
 let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,400000));
 assert_eq(env.view_public(PluginAdapter::at(a).balance(user)),600000);
 env.call_public(op,PluginAdapter::at(a).settle(10,0,120000,99));
 assert_eq(env.view_public(PluginAdapter::at(a).balance(user)),880000);
 assert_eq(env.view_public(PluginAdapter::at(a).earned(op)),120000);
}
#[test(should_fail_with="Insufficient balance")]
unconstrained fn escrow_concurrent_reservations_cannot_overspend() {
 let (env,a,user,op,board)=setup();env.call_public(board,PluginAdapter::at(a).on_invocation(user,11));env.call_public(op,PluginAdapter::at(a).start(11));
 env.call_public(op,PluginAdapter::at(a).reserve(10,0,700000));env.call_public(op,PluginAdapter::at(a).reserve(11,0,400000));
}
#[test(should_fail_with="Only operator")]
unconstrained fn escrow_other_operator_cannot_reserve() {let (env,a,user,_,_)=setup();env.call_public(user,PluginAdapter::at(a).reserve(10,0,100));}
#[test(should_fail_with="Only reserving operator")]
unconstrained fn escrow_other_operator_cannot_settle() {let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));env.call_public(user,PluginAdapter::at(a).settle(10,0,1,99));}
#[test(should_fail_with="Only board")]
unconstrained fn escrow_fake_post_cannot_authorize() {let (env,a,user,_,_)=setup();env.call_public(user,PluginAdapter::at(a).on_invocation(user,11));}
#[test(should_fail_with="Wrong call number")]
unconstrained fn escrow_duplicate_settlement_rejected() {let (env,a,_,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));env.call_public(op,PluginAdapter::at(a).settle(10,0,1,99));env.call_public(op,PluginAdapter::at(a).settle(10,0,1,99));}
#[test(should_fail_with="Invalid settlement")]
unconstrained fn escrow_overcharge_rejected() {let (env,a,_,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));env.call_public(op,PluginAdapter::at(a).settle(10,0,101,99));}
#[test(should_fail_with="Insufficient balance")]
unconstrained fn escrow_reserved_funds_cannot_withdraw() {let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,900000));env.call_public(user,PluginAdapter::at(a).withdraw(100001,EthAddress::from_field(100),false,50));}
#[test(should_fail_with="Insufficient earnings")]
unconstrained fn escrow_user_deposits_are_not_operator_earnings() {let (env,a,_,op,_)=setup();env.call_public(op,PluginAdapter::at(a).withdraw(1,EthAddress::from_field(100),true,50));}
#[test]
unconstrained fn escrow_expiry_returns_reserve() {
 let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,900000));
 env.mine_block_at(env.last_block_timestamp()+86401);env.call_public(user,PluginAdapter::at(a).release_expired(10));
 assert_eq(env.view_public(PluginAdapter::at(a).balance(user)),1000000);
 assert_eq(env.view_public(PluginAdapter::at(a).earned(op)),0);
}
#[test(should_fail_with="Expired invocation")]
unconstrained fn escrow_late_settlement_rejected() {
 let (env,a,_,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));
 env.mine_block_at(env.last_block_timestamp()+86401);env.call_public(op,PluginAdapter::at(a).settle(10,0,1,99));
}
#[test(should_fail_with="Duplicate invocation")]
unconstrained fn escrow_invocation_replay_rejected() {let (env,a,user,_,board)=setup();env.call_public(board,PluginAdapter::at(a).on_invocation(user,10));}
#[test(should_fail_with="Only operator")]
unconstrained fn escrow_other_plugin_operator_isolated() {
 let (mut env,a,user,_,board)=setup();let other=env.create_light_account();
 let b=env.deploy("@plugin_adapter/PluginAdapter").with_public_initializer(user,PluginAdapter::interface().init(board,other,1,1));
 assert_eq(env.view_public(PluginAdapter::at(b).balance(user)),0);
 env.call_public(other,PluginAdapter::at(a).reserve(10,0,1));
}
#[test(should_fail_with="Fund plugin account first")]
unconstrained fn escrow_unfunded_account_cannot_authorize() {
 let (mut env,a,_,_,board)=setup();let unfunded=env.create_light_account();
 env.call_public(board,PluginAdapter::at(a).on_invocation(unfunded,11));
}
#[test]
unconstrained fn escrow_uncertain_failure_retains_reserve_until_expiry() {
 let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));
 env.call_public(op,PluginAdapter::at(a).close(10));
 let (_,state,_,reserved,_,_)=env.view_public(PluginAdapter::at(a).invocation(10));assert_eq(state,7);assert_eq(reserved,100);
 env.mine_block_at(env.last_block_timestamp()+86401);env.call_public(user,PluginAdapter::at(a).release_expired(10));
 assert_eq(env.view_public(PluginAdapter::at(a).balance(user)),1000000);
}
#[test]
unconstrained fn escrow_known_failure_closes_without_locking_balance() {
 let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).close(10));
 let (_,state,_,reserved,_,_)=env.view_public(PluginAdapter::at(a).invocation(10));assert_eq(state,6);assert_eq(reserved,0);
 assert_eq(env.view_public(PluginAdapter::at(a).balance(user)),1000000);
}
#[test(should_fail_with="Invocation not active")]
unconstrained fn escrow_cancel_prevents_reservation() {
 let (env,a,user,op,_)=setup();env.call_public(user,PluginAdapter::at(a).cancel(10));env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));
}
#[test(should_fail_with="Call still reserved")]
unconstrained fn escrow_reserve_prevents_cancel() {
 let (env,a,user,op,_)=setup();env.call_public(op,PluginAdapter::at(a).reserve(10,0,100));env.call_public(user,PluginAdapter::at(a).cancel(10));
}
