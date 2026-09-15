// Actual journal/SQLite, contract instance and ABI/Tx codecs. Node, issuer and proof are explicit doubles.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {BarretenbergSync} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {loadContractArtifact,getAllFunctionAbis,encodeArguments,FunctionSelector} from '@aztec/stdlib/abi';
import {getContractInstanceFromInstantiationParams} from '@aztec/stdlib/contract';
import {Tx,HashedValues,TxHash} from '@aztec/stdlib/tx';
import {mockTx} from '@aztec/stdlib/testing';
import {openRegistrationJournal} from '../sponsor-service/registration-journal.mjs';
import {IssuerError} from '../sponsor-service/issuer.mjs';
import {createRegistrationWorker} from '../sponsor-service/registration-worker.mjs';
const sponsorArtifact=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/sponsor_artifact.json',import.meta.url)));
const artifact=loadContractArtifact(sponsorArtifact),owner=AztecAddress.fromNumberUnsafe(12),board=AztecAddress.fromNumberUnsafe(11);
const config={board,window_duration:60n,window_budget:3900n,max_da_gas:100n,max_l2_gas:200n,max_teardown_da:10n,max_teardown_l2:20n,max_fee_da:3n,max_fee_l2:5n,max_priority_da:1n,max_priority_l2:2n,max_fee_per_ticket:1300n};
const planned={batchId:'1',root:new Fr(77).toString(),window:'2',ticketCount:'2'};
let instance,scope,root,counter=0;const handles=[];
before(async()=>{
  root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'registration-worker-'));
  instance=await getContractInstanceFromInstantiationParams(artifact,{constructorArgs:[owner,config],constructorArtifact:'constructor',salt:new Fr(13),deployer:owner});
  scope={chainId:'31337',version:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:board.toString(),sponsorAddress:instance.address.toString(),sponsorClassId:instance.currentContractClassId.toString()};
});
after(()=>{for(const h of handles)h.close();BarretenbergSync.destroySingleton();fs.rmSync(root,{recursive:true,force:true});});
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code&&e.message===code);
async function fixture(){
  const options={dbPath:path.join(root,'case-'+(++counter),'journal.sqlite'),scope,sponsorArtifact};
  let journal=await openRegistrationJournal(options);handles.push(journal);
  const state={fence:true,preparations:0,sends:0,admin:owner,version:1,valid:true,revert:false,sendFailure:false,
    batch:{root:Fr.ZERO,window:0n,ticket_count:0n},receipt:null,canonical:new Fr(88)};
  const wallet={getChainInfo:async()=>({chainId:new Fr(31337),version:new Fr(state.version)}),registerContract:async()=>{},
    simulateTx:async payload=>{
      const call=payload.calls[0];assert(call.to.equals(instance.address));
      const value=call.name==='get_config'?config:call.name==='get_admin'?state.admin:state.batch;
      const fn=getAllFunctionAbis(artifact).find(f=>f.name===call.name);
      const values=encodeArguments({parameters:fn.returnTypes.map((type,i)=>({name:'r'+i,type}))},[value]);
      return {getPublicReturnValues:()=>[{values}],offchainEffects:[],publicInputs:{constants:{anchorBlockHeader:{globalVariables:{timestamp:120n}}}}};
    }};
  const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:state.wrongRollup?'0x'+'22'.repeat(20):scope.rollupAddress}}),getContract:async()=>instance,
    getBlock:async block=>block==='latest'?{header:{globalVariables:{timestamp:120n}}}:{hash:state.canonical},
    getTxReceipt:async hash=>{assert(hash instanceof TxHash);assert.equal(hash.toString(),state.receipt.txHash.toString());return state.receipt;},
    isValidTx:async()=>({result:state.valid?'valid':'invalid'}),simulatePublicCalls:async()=>({revertReason:state.revert?new Error('private-provider-detail'):undefined}),
    sendTx:async tx=>{
      assert.equal((await journal.get('1')).state,'submission-uncertain');
      assert((await journal.loadPrepared('1')).txBytes.equals(tx.toBuffer()));state.sends++;
      state.receipt={status:'pending',txHash:tx.getTxHash()};if(state.sendFailure)throw new Error('private transport detail');
    }};
  const prepareTransaction=async({interaction,owner:actual})=>{
    assert(actual.equals(owner));state.preparations++;
    const payload=await interaction.request();assert.equal(payload.calls.length,1);assert.equal(payload.calls[0].name,'register_batch');
    const abi=getAllFunctionAbis(artifact).find(f=>f.name==='register_batch'),selector=await FunctionSelector.fromNameAndParameters(abi.name,abi.parameters);
    const args=encodeArguments(abi,[1n,new Fr(77),2n,2n]);assert.deepEqual(payload.calls[0].args.map(x=>x.toString()),args.map(x=>x.toString()));
    const tx=await mockTx(900,{numberOfNonRevertiblePublicCallRequests:0,numberOfRevertiblePublicCallRequests:1,publicCalldataSize:5,feePayer:owner,chainId:new Fr(31337),version:new Fr(1)});
    const calldata=await HashedValues.fromCalldata([selector.toField(),...args]);
    const call=tx.data.forPublic.revertibleAccumulatedData.publicCallRequests[0];call.contractAddress=instance.address;call.msgSender=owner;call.isStaticCall=false;call.calldataHash=calldata.hash;
    return Tx.create({data:tx.data,chonkProof:tx.chonkProof,contractClassLogFields:[],publicFunctionCalldata:[calldata]});
  };
  const worker=()=>createRegistrationWorker({journal,node,wallet,owner,sponsorArtifact,scope,prepareTransaction,assertRecoveryFence:async()=>state.fence,
    issuer:{seal:async()=>{if(state.sealFailure)throw new IssuerError('ISSUER_NOT_SEALED');return {...planned,chainId:scope.chainId,version:scope.version,sponsorAddress:scope.sponsorAddress,status:'sealed'};}}});
  return {state,worker,journal:()=>journal,include(){state.batch={root:new Fr(77),window:2n,ticket_count:2n};state.receipt={...state.receipt,status:'checkpointed',executionResult:'success',blockNumber:17,blockHash:new Fr(88)};},
    async reopen(){journal.close();journal=await openRegistrationJournal(options);handles.push(journal);}};
}
test('one step persists exact prepared bytes before send, then reconciles actual ABI state after restart',async()=>{
  const f=await fixture();const sent=await f.worker().step({batchId:'1'});assert.equal(sent.submitted,true);assert.equal(f.state.preparations,1);
  await f.reopen();const pending=await f.worker().step({batchId:'1'});assert.equal(pending.state,'pending');assert.equal(f.state.sends,1);
  f.include();const included=await f.worker().reconcile({batchId:'1'});assert.equal(included.state,'included');assert(!included.claimed);
  assert.equal(f.state.preparations,1);assert.equal(f.state.sends,1);
});
test('ambiguous send is retained and never causes automatic reprepare or resend',async()=>{
  const f=await fixture();f.state.sendFailure=true;const sent=await f.worker().step({batchId:'1'});assert.equal(sent.submitted,'unknown');
  await f.reopen();f.include();assert.equal((await f.worker().step({batchId:'1'})).state,'included');assert.equal(f.state.sends,1);assert.equal(f.state.preparations,1);
});
test('missing recovery fence stops before journal allocation, signing or send',async()=>{
  const f=await fixture();f.state.fence=false;await rejects(f.worker().step({batchId:'1'}),'REGISTRATION_RECOVERY_FENCE_REQUIRED');
  assert.equal((await f.journal().list()).length,0);assert.equal(f.state.preparations,0);assert.equal(f.state.sends,0);
});
test('wrong operator or network fails before signing',async()=>{
  for(const which of ['admin','version']){const f=await fixture();if(which==='admin')f.state.admin=board;else f.state.version=2;
    await assert.rejects(f.worker().step({batchId:'1'}));assert.equal(f.state.preparations,0);assert.equal(f.state.sends,0);}
});
test('invalid proof validation or known public revert never reaches send',async()=>{
  for(const which of ['valid','revert']){const f=await fixture();if(which==='valid')f.state.valid=false;else f.state.revert=true;
    await rejects(f.worker().step({batchId:'1'}),which==='valid'?'REGISTRATION_TX_REJECTED':'REGISTRATION_PUBLIC_REVERT');assert.equal(f.state.sends,0);assert.equal((await f.journal().get('1')).state,'prepared');}
});
test('an unrecorded preparation after restart requires recovery instead of duplicate signing',async()=>{
  const f=await fixture();await f.journal().enqueue(planned);await f.journal().claim({batchId:'1',expectedRevision:1});await f.reopen();
  await rejects(f.worker().step({batchId:'1'}),'REGISTRATION_PREPARATION_RECOVERY_REQUIRED');assert.equal(f.state.preparations,0);
});
test('canonical mismatch fences all later work, rather than reporting inclusion',async()=>{
  const f=await fixture();await f.worker().step({batchId:'1'});f.include();await f.worker().reconcile({batchId:'1'});
  f.state.canonical=new Fr(99);const changed=await f.worker().reconcile({batchId:'1'});assert.equal(changed.state,'blocked');
  await rejects(f.journal().enqueue({...planned,batchId:'2'}),'REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED');
});
test('missing registered tuple after receipt success is a recovery stop',async()=>{
  const f=await fixture();await f.worker().step({batchId:'1'});f.include();f.state.batch.root=Fr.ZERO;
  assert.equal((await f.worker().reconcile({batchId:'1'})).state,'blocked');assert.equal(f.state.sends,1);
});

test('safe state and issuer failures retain actionable codes without provider details',async()=>{
  const wrong=await fixture();wrong.state.version=2;await rejects(wrong.worker().step({batchId:'1'}),'SPONSOR_STATE_CHAIN_MISMATCH');
  const unavailable=await fixture();unavailable.state.sealFailure=true;await rejects(unavailable.worker().step({batchId:'1'}),'ISSUER_NOT_SEALED');
  assert.equal(wrong.state.preparations+unavailable.state.preparations,0);
});

test('a different rollup fails before sealing, signing or sending',async()=>{
  const f=await fixture();f.state.wrongRollup=true;await rejects(f.worker().step({batchId:'1'}),'REGISTRATION_ROLLUP_MISMATCH');
  assert.equal((await f.journal().list()).length,0);assert.equal(f.state.preparations,0);assert.equal(f.state.sends,0);
});
