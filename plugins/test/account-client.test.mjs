import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {fundingFixture,fundingIdentity as funding} from './funding-fixture.mjs';
import {pluginAccountAction} from '../account-client.mjs';
const portal='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),recipient='0x'+'33'.repeat(20),receiver='0x'+'44'.repeat(32);
const abi=new Interface(['function token() view returns(address)','function inbox() view returns(address)','function escrow() view returns(bytes32)','function active() view returns(bool)','function decimals() view returns(uint8)']);
function fixture(initial={}){
 let state=initial;
 const values={token,inbox:funding.inbox,escrow:receiver,active:true,decimals:6};
 const escrow={methods:{withdraw:()=>({kind:'withdraw'}),balance:()=>({simulate:async()=>({result:123n})})}};
 const sdk={Contract:{at:async()=>escrow},AztecAddress:{fromStringUnsafe:x=>x},loadContractArtifact:x=>x,EthAddress:{fromString:x=>x},TxHash:{fromString:x=>x},Fr:{random:()=>({toString:()=> 'nonce'}),fromString:x=>x}};
 return {state:()=>state,args:{action:'withdraw',input:{amount:'1'},descriptor:{scope:{chainId:'31337',rollupVersion:'42',receiver},funding:{portalAddress:portal,tokenAddress:token}},sdk,handles:{wallet:{registerContract:async()=>{}},address:'account',aztecNode:{getContract:async()=>({}),getTxReceipt:async hash=>({txHash:hash,executionResult:'success',status:'checkpointed',blockNumber:1,blockHash:'block'}),getBlock:async()=>({hash:'block'})}},signer:{provider:{getNetwork:async()=>({chainId:31337n})},getAddress:async()=>recipient,call:async tx=>{const fn=abi.parseTransaction(tx).name;return abi.encodeFunctionResult(fn,[values[fn]]);}},store:{read:()=>state,write:x=>state=x}}};
}
test('withdrawal claim is saved before a debit can be broadcast',async()=>{
 const f=fixture();f.args.send=async(_,beforeSubmit)=>{await beforeSubmit('hash');assert.equal(f.state().withdrawal.txHash,'hash');throw Error('lost response');};
 await assert.rejects(pluginAccountAction(f.args),/lost response/);
 assert.deepEqual(f.state().withdrawal,{amount:'1000000',recipient,nonce:'nonce',txHash:'hash'});
});
test('confirmed claim reconciles a lost response without claiming twice',async()=>{
 const f=fixture({deposit:{leafIndex:'1',claimTxHash:'hash'}});f.args.action='claim';f.args.send=async()=>{throw Error('Must not claim twice');};
 const result=await pluginAccountAction(f.args);assert.equal(result.balance,'0.000123');assert.equal(result.lastL2TxHash,'hash');assert.equal(f.state().deposit,null);
});
test('reverted withdrawal clears its intent so available funds can be withdrawn again',async()=>{
 const f=fixture({withdrawal:{txHash:'hash'}});f.args.action='redeem';f.args.handles.aztecNode.getTxReceipt=async()=>({executionResult:'reverted'});
 await assert.rejects(pluginAccountAction(f.args),/Withdrawal reverted/);assert.equal(f.state().withdrawal,null);
});
test('confirmed Ethereum redemption reconciles a lost response without withdrawing twice',async()=>{
 const f=fixture({withdrawal:{txHash:'l2',recipient,amount:'1000000',nonce:funding.nonce,redemption:{sender:recipient,nonce:7,txHash:funding.hash}}});f.args.action='redeem';
 Object.assign(f.args.signer.provider,fundingFixture('withdraw').provider);
 f.args.signer.sendTransaction=async()=>assert.fail('Must not redeem twice');
 assert.equal((await pluginAccountAction(f.args)).transactionHash,funding.hash);assert.equal(f.state().withdrawal,null);
});

test('proposed claim does not discard its deposit metadata',async()=>{
 const f=fixture({deposit:{leafIndex:'1',claimTxHash:'hash'}});f.args.action='claim';
 f.args.handles.aztecNode.getTxReceipt=async()=>({txHash:'hash',executionResult:'success',status:'proposed'});
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

test('public redemption waits for finality without creating a submission intent',async()=>{
 const f=fixture({withdrawal:{txHash:'l2'}});f.args.action='redeem';
 f.args.descriptor.scope.chainId='11155111';f.args.signer.provider.getNetwork=async()=>({chainId:11155111n});
 f.args.handles.aztecNode.getTxEffect=async()=>{throw Error('Must not request proof before finality');};
 await assert.rejects(pluginAccountAction(f.args),/awaits network finality/);
 assert.deepEqual(f.state(),{withdrawal:{txHash:'l2'}});
});

test('failed redemption gas preflight does not poison the saved withdrawal',async()=>{
 const withdrawal={txHash:'l2',recipient,amount:'123',nonce:'0x'+'55'.repeat(32)},f=fixture({withdrawal});f.args.action='redeem';
 f.args.handles.aztecNode.getTxReceipt=async()=>({status:'finalized',executionResult:'success'});
 f.args.handles.aztecNode.getTxEffect=async()=>({data:{l2ToL1Msgs:[{isZero:()=>false}]}});
 f.args.handles.aztecNode.getL2ToL1MembershipWitness=async()=>({epochNumber:1,numCheckpointsInEpoch:1,leafIndex:0n,siblingPath:{toBufferArray:()=>[]}});
 let estimates=0;f.args.signer.estimateGas=async()=>{estimates++;throw Error('Outbox is not yet usable');};
 for(let attempt=0;attempt<2;attempt++){
  await assert.rejects(pluginAccountAction(f.args),/Outbox is not yet usable/);
  assert.deepEqual(f.state(),{withdrawal});assert.equal(f.state().withdrawal.redemption,undefined);
 }
 assert.equal(estimates,2);
});

test('failed deposit gas preflight leaves funding retryable after approval',async()=>{
 const f=fixture();f.args.action='deposit';f.args.handles.address=receiver;
 f.args.sdk.Fr.ONE='1';f.args.sdk.computeSecretHash=async()=>receiver;
 let approvals=0,estimates=0;f.args.signer.provider.getTransactionReceipt=async()=>({status:1,logs:[]});
 f.args.signer.sendTransaction=async()=>{approvals++;return {hash:'approval',wait:async()=>({status:1})};};
 f.args.signer.estimateGas=async()=>{estimates++;throw Error('Insufficient token balance');};
 for(let attempt=0;attempt<2;attempt++){
  await assert.rejects(pluginAccountAction(f.args),/Insufficient token balance/);
  assert.deepEqual(f.state(),{});
 }
 assert.equal(approvals,2);assert.equal(estimates,2);
});

test('V6 plugin deposit allows changing Inbox gas while retaining its saved nonce',async()=>{
 const f=fixture();f.args.action='deposit';f.args.handles.address=receiver;
 f.args.sdk.Fr.ONE='1';f.args.sdk.computeSecretHash=async()=>receiver;
 f.args.signer.getNonce=async()=>7;f.args.signer.provider.getBlockNumber=async()=>42;
 const calls=[];
 f.args.sdk.computeSecretHash=async()=>funding.secretHash;
 Object.assign(f.args.signer.provider,fundingFixture().provider);
 let estimate;f.args.signer.estimateGas=async tx=>{estimate=tx;return 100000n;};
 f.args.signer.sendTransaction=async tx=>{
  calls.push(tx);if(tx.to.toLowerCase()===portal){assert.equal(tx.gasLimit,200000n);assert.equal(tx.data,estimate.data);assert.equal(tx.nonce,7);assert.equal(f.state().deposit.nonce,7);}
  else assert.equal(tx.gasLimit,undefined);
  return {hash:'0x'+'66'.repeat(32),wait:async()=>({status:1})};
 };
 assert.deepEqual(await pluginAccountAction(f.args),{deposited:'1'});assert.equal(calls.length,2);assert.equal(f.state().deposit.leafIndex,'3');
});

function recoveredPayment(kind,mutation={}){
 const record=kind==='deposit'?{amount:'1000000',secret:'1',sender:recipient,nonce:7,startBlock:42}:{txHash:'l2',recipient,amount:'1000000',nonce:funding.nonce,redemption:{sender:recipient,nonce:7,startBlock:42,data:'0xdead'}};
 const f=fixture({[kind==='deposit'?'deposit':'withdrawal']:record});f.args.action=kind==='deposit'?'claim':'redeem';f.args.handles.address=receiver;
 Object.assign(f.args.signer.provider,fundingFixture(kind,mutation).provider);
 const block=f.args.signer.provider.getBlock;f.args.signer.provider.getBlockNumber=async()=>45;f.args.signer.provider.getBlock=async number=>{assert.equal(number,42,'Stop scanning after the verified payment');return block(number);};
 f.args.signer.sendTransaction=async()=>assert.fail('Recovery must not send another Ethereum payment');
 f.args.sdk.computeSecretHash=async()=>funding.secretHash;
 f.args.sdk.Fr=class {constructor(value){this.value=value;}static fromString(value){return value;}};
 f.args.sdk.Contract.at=async()=>({methods:{claim:()=>({kind:'claim'}),balance:()=>({simulate:async()=>({result:1000000n})})}});
 return f;
}
test('lost wrapped deposit response recovers the V6 message and only claims once on Aztec',async()=>{
 const f=recoveredPayment('deposit');let sends=0;
 f.args.send=async(call,beforeSubmit)=>{sends++;assert.equal(call.kind,'claim');assert.equal(f.state().deposit.key,funding.key);assert.equal(f.state().deposit.leafIndex,'3');await beforeSubmit('claim');};
 assert.equal((await pluginAccountAction(f.args)).balance,'1.0');assert.equal(sends,1);assert.equal(f.state().deposit,null);
});
test('lost wrapped redemption response clears only after exact canonical withdrawal effects',async()=>{
 const f=recoveredPayment('withdraw');assert.equal((await pluginAccountAction(f.args)).transactionHash,funding.hash);assert.equal(f.state().withdrawal,null);
});
test('wrong effects retain cached deposit and redemption intents and never send',async()=>{
 for(const kind of ['deposit','withdraw']){
  const mutation=kind==='deposit'?{message:{secretHash:funding.key}}:{receipt:{logs:[]}},f=recoveredPayment(kind,mutation);
  if(kind==='deposit')Object.assign(f.state().deposit,{txHash:funding.hash,leafIndex:'3'});else f.state().withdrawal.redemption.txHash=funding.hash;
  const before=structuredClone(f.state());f.args.send=async()=>assert.fail('Must not claim wrong funding');
  await assert.rejects(pluginAccountAction(f.args),{code:'BB_RECOVERY_REQUIRED'});assert.deepEqual(f.state(),before);
 }
});
test('a canonical reverted deposit clears only that payment and does not send again',async()=>{
 const f=recoveredPayment('deposit',{receipt:{status:0,logs:[]}});f.args.send=async()=>assert.fail('Must not claim reverted funding');
 await assert.rejects(pluginAccountAction(f.args),/Deposit reverted/);assert.equal(f.state().deposit,null);
});
