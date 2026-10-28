// Application/status unit fixture: current SDK private-credit reader is an explicit
// double. Native credit reconstruction is covered by private-credit.test.mjs;
// class/discovery enforcement remains covered by pxe-validated-prove.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {createRollingApplication} from './application.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const boardArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const feeArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../billboard/target/private_fee_contract-PrivateFPC.json',import.meta.url))));

function fixture({synchronized=true}={}){
 const owner=AztecAddress.fromBigIntUnsafe(3n),node={},scope={synchronized};
 const state={scope,credit:77n,ids:[9n,...Array(9).fill(0n)],reads:[],discoveries:0,networkChecks:0,payments:0,sends:0};
 const wallet={aztecNode:node,getAccounts:async()=>[owner],getChainInfo:async()=>({chainId:31337,version:state.wrongNetwork?2:1}),sendTx:async()=>{state.sends++;assert.fail('No transaction in a status read');}};
 const pxe={node,prepareBoardActionState:async input=>{
  state.discoveries++;assert.equal(input.method,'get_deposit_ids');assert.equal(input.owner.toString(),hex(3));assert.equal(input.board.toString(),hex(1));assert.equal(input.privateFee.toString(),hex(2));assert.equal(input.collateralOnly,undefined);
  await state.beforeDiscovery?.();if(state.classError)throw state.classError;
 }};
 wallet.pxe=pxe;
 const sdk={Fr,AztecAddress,isTrustedPrivateNode:n=>n===node,isPrivateWalletForNode:(w,n)=>w===wallet&&n===node,isPrivatePXEForNode:(p,n)=>p===wallet.pxe&&n===node,
  inspectTrustedNode:async()=>{state.networkChecks++;if(state.networkError)throw state.networkError;},
  preparePrivateFeePayment:async()=>{state.payments++;assert.fail('Status must not prepare a transaction');},
  readPrivateFeeCredit:async input=>{
   assert.equal(input.wallet,wallet);assert.equal(input.node,node);assert.equal(input.owner,owner);
   assert.equal(String(input.fpc),hex(2));assert.equal(input.fpcArtifact,feeArtifact);
   assert.equal(String(input.board),hex(1));assert.equal(input.boardArtifact,boardArtifact);
   assert.equal(input.chainId,'31337');assert.equal(input.version,'1');assert.equal(typeof input.cache,'function');
   state.reads.push('readPrivateFeeCredit');await state.beforeBalance?.();if(state.balanceError)throw state.balanceError;return state.credit;
  },
  Contract:{at:async(address,artifact,selectedWallet)=>{
   assert.equal(selectedWallet,wallet);assert.equal(String(address),hex(1));assert.equal(artifact,boardArtifact);
   return {methods:new Proxy({},{get:(_,name)=>(...args)=>({simulate:async options=>{
    assert.equal(options.from,owner);assert.equal(args[0],owner);assert.equal(name,'get_deposit_ids');
    state.reads.push(name);
    await state.beforeIds?.();if(state.idsError)throw state.idsError;return {result:state.ids};
   }})})};
  }},
 };
 const deployment={board:{address:hex(1),artifact:boardArtifact},privateFee:{address:hex(2),artifact:feeArtifact,gasSettings:{}},network:{chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20)},portal:'0x'+'22'.repeat(20)};
 const accountSession={owner,wallet,node,journal:{inspectOutcome:async()=>null},walletSecret:hex(8),walletSalt:'0',operationScope:()=>state.scope};
 const privateStore={read:async()=>{await state.beforeStorageRead?.();return null;},compareAndSwap:async()=>assert.fail('Status writes no application journal')};
 const app=createRollingApplication({sdk,deployment,accountSession,privateStore,contextGuard:async()=>{}});
 return {state,app,accountSession,pxe,wallet,sdk};
}

for(const synchronized of [true,false])test('native account balance replaces payment preparation; synchronized='+synchronized,async()=>{
 const f=fixture({synchronized}),result=await f.app.readAccountStatus({opening:true});
 assert.equal(result.status,'fee-ready');assert.equal(result.privateFeeCredit,'77');assert.deepEqual(result.depositIds,[hex(9)]);
 assert.equal(f.state.discoveries,1);assert.equal(f.state.payments,0);assert.equal(f.state.networkChecks,1);assert.deepEqual(f.state.reads,['get_deposit_ids','readPrivateFeeCredit']);assert.equal(f.state.sends,0);
});

for(const empty of [false,true])for(const credit of [0n,77n])test('zero and positive native credit keep opening classification; empty='+empty+' credit='+credit,async()=>{
 const f=fixture();f.state.credit=credit;if(empty)f.state.ids=Array(10).fill(0n);
 const result=await f.app.readAccountStatus({opening:true});
 assert.equal(result.status,empty?'collateral-pending':credit===0n?'fee-needed':'fee-ready');
 if(empty)assert.deepEqual(result,{status:'collateral-pending',depositIds:[],pendingWithdrawal:null,postEligibility:'requires-action-simulation'});
 else if(credit>0n)assert.equal(result.privateFeeCredit,'77');
 assert.equal(f.state.payments,0);assert.equal(f.state.sends,0);
});

for(const failure of ['class','network','chain'])test('account status retains '+failure+' failure instead of returning an empty balance',async()=>{
 const f=fixture(),error=Object.assign(Error('controlled failure'),{code:failure==='class'?'PRIVATE_FEE_CLASS_MISMATCH':'PRIVATE_FEE_CHAIN_MISMATCH'});
 if(failure==='class')f.state.classError=error;else if(failure==='network')f.state.networkError=error;else f.state.wrongNetwork=true;
 await assert.rejects(f.app.readAccountStatus({opening:true}),failure==='chain'?{code:'ROLLING_CONTEXT_CHANGED'}:value=>value===error);
 assert.deepEqual(f.state.reads,[]);assert.equal(f.state.payments,0);assert.equal(f.state.sends,0);
});

for(const value of [null,undefined,-1n,1n<<128n,{},'not-a-number'])test('malformed native credit is never treated as empty: '+String(value),async()=>{
 const f=fixture();f.state.ids=Array(10).fill(0n);f.state.credit=value;
 await assert.rejects(f.app.readAccountStatus({opening:true}));assert.equal(f.state.payments,0);assert.equal(f.state.sends,0);
});

test('status waits for one class-qualified discovery before either native read',async()=>{
 const f=fixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();f.state.beforeDiscovery=async()=>{entered.resolve();await gate.promise;};
 const work=f.app.readAccountStatus({opening:true});await entered.promise;assert.deepEqual(f.state.reads,[]);
 await assert.rejects(f.app.readAccountStatus(),{code:'ROLLING_BUSY'});gate.resolve();await work;assert.equal(f.state.discoveries,1);
});

for(const failed of ['ids','balance'])test('native status '+failed+' failure drains the other read before releasing its lease',async()=>{
 const f=fixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers(),error=Error(failed+' failed');
 if(failed==='ids'){f.state.idsError=error;f.state.beforeBalance=async()=>{entered.resolve();await gate.promise;};}
 else{f.state.balanceError=error;f.state.beforeIds=async()=>{entered.resolve();await gate.promise;};}
 let finished=false;const work=f.app.readAccountStatus({opening:true}).finally(()=>finished=true),rejected=assert.rejects(work,value=>value===error);
 await entered.promise;await new Promise(setImmediate);assert.equal(finished,false);await assert.rejects(f.app.readAccountStatus(),{code:'ROLLING_BUSY'});
 gate.resolve();await rejected;assert.equal(f.state.sends,0);assert.equal((await f.app.readFundingState()).status,'ready');
});

for(const change of ['scope','wallet','pxe','owner'])test('late '+change+' change invalidates native account balance',async()=>{
 const f=fixture(),entered=Promise.withResolvers(),gate=Promise.withResolvers();f.state.beforeBalance=async()=>{entered.resolve();await gate.promise;};
 const work=f.app.readAccountStatus({opening:true}),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;
 if(change==='scope')f.state.scope={synchronized:true};if(change==='wallet')f.accountSession.wallet={...f.wallet};
 if(change==='pxe')f.wallet.pxe={...f.pxe};if(change==='owner')f.accountSession.owner=AztecAddress.fromBigIntUnsafe(99n);
 gate.resolve();await rejected;assert.equal(f.state.sends,0);
});
