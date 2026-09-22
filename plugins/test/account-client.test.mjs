import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {pluginAccountAction} from '../account-client.mjs';
const portal='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),recipient='0x'+'33'.repeat(20),receiver='0x'+'44'.repeat(32);
const abi=new Interface(['function token() view returns(address)','function escrow() view returns(bytes32)','function active() view returns(bool)','function decimals() view returns(uint8)']);
function fixture(initial={}){
 let state=initial;
 const values={token,escrow:receiver,active:true,decimals:6};
 const escrow={methods:{withdraw:()=>({kind:'withdraw'}),balance:()=>({simulate:async()=>({result:123n})})}};
 const sdk={Contract:{at:async()=>escrow},AztecAddress:{fromStringUnsafe:x=>x},loadContractArtifact:x=>x,EthAddress:{fromString:x=>x},TxHash:{fromString:x=>x},Fr:{random:()=>({toString:()=> 'nonce'}),fromString:x=>x}};
 return {state:()=>state,args:{action:'withdraw',input:{amount:'1'},descriptor:{scope:{chainId:'31337',receiver},funding:{portalAddress:portal,tokenAddress:token}},sdk,handles:{wallet:{registerContract:async()=>{}},address:'account',aztecNode:{getContract:async()=>({}),getTxReceipt:async()=>({executionResult:'success',status:'checkpointed'})}},signer:{provider:{getNetwork:async()=>({chainId:31337n})},getAddress:async()=>recipient,call:async tx=>{const fn=abi.parseTransaction(tx).name;return abi.encodeFunctionResult(fn,[values[fn]]);}},store:{read:()=>state,write:x=>state=x}}};
}
test('withdrawal claim is saved before a debit can be broadcast',async()=>{
 const f=fixture();f.args.send=async(_,beforeSubmit)=>{await beforeSubmit('hash');assert.equal(f.state().withdrawal.txHash,'hash');throw Error('lost response');};
 await assert.rejects(pluginAccountAction(f.args),/lost response/);
 assert.deepEqual(f.state().withdrawal,{amount:'1000000',recipient,nonce:'nonce',txHash:'hash'});
});
test('confirmed claim reconciles a lost response without claiming twice',async()=>{
 const f=fixture({deposit:{leafIndex:'1',claimTxHash:'hash'}});f.args.action='claim';f.args.send=async()=>{throw Error('Must not claim twice');};
 assert.equal((await pluginAccountAction(f.args)).balance,'0.000123');assert.equal(f.state().deposit,null);
});
test('reverted withdrawal clears its intent so available funds can be withdrawn again',async()=>{
 const f=fixture({withdrawal:{txHash:'hash'}});f.args.action='redeem';f.args.handles.aztecNode.getTxReceipt=async()=>({executionResult:'reverted'});
 await assert.rejects(pluginAccountAction(f.args),/Withdrawal reverted/);assert.equal(f.state().withdrawal,null);
});
test('confirmed Ethereum redemption reconciles a lost response without withdrawing twice',async()=>{
 const f=fixture({withdrawal:{txHash:'l2',redemption:{txHash:'l1'}}});f.args.action='redeem';
 f.args.signer.provider.getTransactionReceipt=async()=>({status:1,hash:'l1'});
 assert.equal((await pluginAccountAction(f.args)).transactionHash,'l1');assert.equal(f.state().withdrawal,null);
});

test('proposed claim does not discard its deposit metadata',async()=>{
 const f=fixture({deposit:{leafIndex:'1',claimTxHash:'hash'}});f.args.action='claim';
 f.args.handles.aztecNode.getTxReceipt=async()=>({executionResult:'success',status:'proposed'});
 await assert.rejects(pluginAccountAction(f.args),/pending/);assert(f.state().deposit);
});

test('request IDs are canonical fields usable by cancellation; results filter other accounts',async()=>{
 const f=fixture();f.args.action='requests';f.args.input={};
 let cancelled;
 const values={request_count:2,request_at:1n,invocation:['account',2,0,0n,7n,1000]};
 f.args.sdk.Contract.at=async()=>({methods:{
  request_count:()=>({simulate:async()=>({result:2})}),request_at:i=>({simulate:async()=>({result:BigInt(i+1)})}),
  invocation:post=>({simulate:async()=>({result:[post===1n?'someone-else':'account',2,0,0n,7n,1000]})}),
  cancel:post=>{cancelled=post;return {};},balance:()=>({simulate:async()=>({result:100n})})
 }});
 f.args.handles.aztecNode.getBlockNumber=async()=>1;
 f.args.handles.aztecNode.getBlock=async()=>({header:{globalVariables:{timestamp:100}}});
 const result=await pluginAccountAction(f.args);assert.equal(result.requests.length,1);assert.match(result.requests[0].postId,/^0x[0-9a-f]{64}$/);assert.equal(result.requests[0].canCancel,true);
 f.args.action='cancel';f.args.input={postId:result.requests[0].postId};f.args.send=async()=>{};
 await pluginAccountAction(f.args);assert.equal(cancelled,result.requests[0].postId);
});
