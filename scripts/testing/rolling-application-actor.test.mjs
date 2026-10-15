// Labelled SDK/PXE doubles for lifecycle boundaries. Uses actual processed board
// ABI, argument encoding, production application, encrypted journal and file CAS.
// No service, proof, real signature, funding or chain acceptance is claimed.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact,encodeArguments,EventSelector,decodeFunctionSignature} from '@aztec-labs/stdlib/abi';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {createPreferenceEventDecoder} from '../../shared/rolling/preference-events.mjs';
after(()=>BarretenbergSync.destroySingleton());
import {computeArtifactHash} from '@aztec-labs/stdlib/contract';
import {Tx,TxHash} from '@aztec-labs/stdlib/tx';
import {PrivateKernelTailCircuitPublicInputs} from '@aztec-labs/stdlib/kernel';
import {ChonkProof} from '@aztec-labs/stdlib/proofs';
import {Gas,GasFees,GasSettings} from '@aztec-labs/stdlib/gas';
import vm from 'node:vm';
import * as outcomes from '../../shared/transaction-outcomes.mjs';
import {SchnorrInitializerlessAccountContract} from '@aztec-labs/accounts/schnorr';
import {createL2Journal} from '../../shared/l2-journal.mjs';
import {createRollingApplicationActor,bindRollingRootSubmission} from './rolling-application-actor.mjs';
import {createRollingPrivateRecoveryMetrics} from './rolling-private-recovery-metrics.mjs';
const artifact=loadContractArtifact(JSON.parse(await fs.readFile(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),address=n=>AztecAddress.fromBigIntUnsafe(BigInt(n));
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-actor-unit-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const owner=address(options.owner??4),node={},state={calls:[],stops:0,closes:0,proofJobs:0,transportSends:0,fail:null,contract:null};
 const step=async label=>{state.calls.push(label);if(state.hook)await state.hook(label);if(state.fail===label)throw state.error;};
 const store={async close(){state.closes++;await step('close-store');}};
 const pxe={async registerAccount(){await step('register-account');},async registerContractClass(){await step('register-class');},async registerContract(){await step('register-contract');},async sync(){await step('sync');},async stop(){state.stops++;await step('stop');await store.close();}};
 const accountArtifact={functions:[]},account={address:owner,secret:new Fr(7),salt:Fr.ZERO,signingKey:new Fr(8)};
 class SyntheticAccountContract{
  constructor(){state.contract=this;this.provider={createAuthWit(...args){assert.equal(this,state.contract.provider);state.authArgs=args;if(state.authError)throw state.authError;return state.authResult;}};}
  getAuthWitnessProvider(...args){assert.equal(this,state.contract);state.providerArgs=args;return this.provider;}
  async getContractArtifact(){return accountArtifact;}async getImmutablesHash(){return undefined;}
  async getSigningPublicKey(){await step('signing-key');return {x:Fr.ONE,y:Fr.ONE};}
 }
 const wallet={pxe,aztecNode:node,async getAccounts(){return [owner];},async getChainInfo(){return {chainId:31337,version:1};},
  sendTx(...args){assert.equal(this,wallet);state.sendArgs=args;if(state.sendError)throw state.sendError;return state.sendResult;}};
 const routing={createAztecWallet(_sdk,p,n,raw,_log,secret,opts){assert.equal(p,pxe);assert.equal(n,node);assert.equal(raw,node);wallet._transactionJournal=opts.transactionJournal;return wallet;},isPrivateWalletForNode:(w,n)=>!state.wrongWallet&&w===wallet&&n===node};
 const sdk={Fr,AztecAddress,Tx,encodeArguments,createL2Journal,SchnorrInitializerlessAccountContract:SyntheticAccountContract,
  isTrustedPrivateNode:n=>!state.wrongNode&&n===node,isPrivatePXEForNode:(p,n)=>!state.wrongPXE&&p===pxe&&n===node,
  async inspectTrustedNode(n,c){assert.equal(n,node);assert.equal(c.proofsEnabled,options.proofsEnabled??true);await step('inspect');},
  async openPXEStore(config){state.storeConfig=config;await step('open-store');return store;},
  async createPXE(n,c,o){assert.equal(n,node);assert.equal(o.store,store);assert.deepEqual(c,{proverEnabled:options.proofsEnabled??true,autoSync:false,syncChainTip:'checkpointed'});state.remote=o.remoteProver;await step('create-pxe');return pxe;},
  deriveKeys:async()=>({publicKeys:{}}),getContractInstanceFromInstantiationParams:async()=>({address:owner}),computePartialAddress:async()=>Fr.ONE,
  AccountManager:{async create(w,secret,contract){assert.equal(w,wallet);assert.equal(contract,state.contract);await step('account-manager');return {address:owner};}},
  Contract:{at:()=>({methods:{register_name:(...args)=>({args}),get_deposit_ids:()=>({simulate:async()=>({result:options.collateral?[1n,...Array(9).fill(0n)]:Array(10).fill(0n)})})}})},
  preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async()=>({maximumFee:10n,payload:{},gasSettings:{}})};
 const input={sdk,routing,node,endpoint:'http://127.0.0.1:12345',network:{chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},proofsEnabled:options.proofsEnabled??true,
  board:{instance:{address:address(2)},artifact},fees:{authorAccount:account,browserFixture:{instance:{address:address(3)},artifact:{functions:[]},gas:{}}},
  portal:'0x'+'2'.repeat(40),storageDirectory:path.join(directory,'journals'),dataDirectory:directory,
  externalActivity:()=>({proofJobs:state.proofJobs,transportSends:state.transportSends})};
 return {input,state,account,wallet,pxe,store,directory};
}
test('installed account shape supplies synchronous provider shared by account and entrypoint',()=>{
 const contract=new SchnorrInitializerlessAccountContract(new Fr(8));
 const provider=contract.getAuthWitnessProvider(address(4));assert.equal(typeof provider.createAuthWit,'function');
 const account=contract.getAccount({address:address(4)});assert.equal(account.authWitnessProvider,account.entrypoint.auth);
});
test('separate actors use separate stores and actual application status without inventing collateral',async t=>{
 const a=await fixture(t,{collateral:true}),b=await fixture(t,{owner:5,proofsEnabled:false});let x,y;
 try{x=await createRollingApplicationActor(a.input);y=await createRollingApplicationActor(b.input);
  assert.notEqual(x.pxe,y.pxe);assert.notEqual(x.journal,y.journal);
  assert.equal((await x.application.readAccountStatus()).status,'fee-ready');assert.equal((await y.application.readAccountStatus()).status,'collateral-pending');
  assert.equal(a.state.storeConfig.accountAddress,String(x.owner));assert.equal(b.state.storeConfig.accountAddress,String(y.owner));
  assert.throws(()=>JSON.stringify(x));await x.close();assert.equal(b.state.stops,0);
  assert.equal((await y.application.readAccountStatus()).privateFeeCredit,'100');
 }finally{await x?.close();await y?.close();}assert.equal(a.state.stops,1);assert.equal(b.state.stops,1);
});
test('auth and wallet counters preserve receiver, arguments, promise identity and original errors',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);try{
  f.state.authResult=Promise.resolve('synthetic witness');f.state.sendResult=Promise.resolve('synthetic submission');
  const provider=f.state.contract.getAuthWitnessProvider('address');assert.equal(f.state.contract.getAuthWitnessProvider('again'),provider);
  assert.equal(provider.createAuthWit('hash'),f.state.authResult);assert.deepEqual(f.state.authArgs,['hash']);
  assert.equal(actor.wallet.sendTx('payload','options'),f.state.sendResult);assert.deepEqual(f.state.sendArgs,['payload','options']);
  const original=Error('synthetic failure');f.state.authError=original;f.state.sendError=original;
  assert.throws(()=>provider.createAuthWit('hash'),e=>e===original);assert.throws(()=>actor.wallet.sendTx('payload'),e=>e===original);
  f.state.proofJobs=3;f.state.transportSends=2;assert.deepEqual(actor.activity(),{authWitnesses:2,proofJobs:3,walletSubmissions:2,transportSends:2});
 }finally{await actor.close();}
});
test('actual encrypted workflow survives journal reopen without proof or resend and wallet journal follows replacement',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);try{
  const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'}),before=actor.activity(),old=actor.journal;
  const bytes=(await Promise.all((await fs.readdir(f.input.storageDirectory)).map(n=>fs.readFile(path.join(f.input.storageDirectory,n),'utf8')))).join('');assert(!bytes.includes('River'));
  const syncs=f.state.calls.filter(c=>c==='sync').length;await actor.reopenJournal();assert.notEqual(actor.journal,old);assert.equal(actor.wallet._transactionJournal,actor.journal);
  assert.equal(f.state.calls.filter(c=>c==='sync').length,syncs);assert.deepEqual(actor.activity(),before);
  assert.deepEqual(await actor.application.reconcile(intent.intentId),intent);await actor.application.cancelPrepared(intent.intentId);
 }finally{await actor.close();}
});
for(const failure of ['create-pxe','register-account','register-class','register-contract','sync','account-manager','signing-key'])test('partial initialization cleans only owned resources: '+failure,async t=>{
 const f=await fixture(t);f.state.fail=failure;f.state.error=Error('original');await assert.rejects(createRollingApplicationActor(f.input),e=>e===f.state.error);
 assert.equal(f.state.stops,failure==='create-pxe'?0:1);assert.equal(f.state.closes,1);
 f.state.fail=null;const actor=await createRollingApplicationActor(f.input);await actor.close();
});
test('initialization preserves original failure and cleanup failure',async t=>{
 const f=await fixture(t),original=Error('init'),cleanup=Error('cleanup');f.state.hook=label=>{if(label==='register-account')throw original;if(label==='stop')throw cleanup;};
 await assert.rejects(createRollingApplicationActor(f.input),e=>e instanceof AggregateError&&e.errors[0]===original&&e.errors[1]===cleanup);assert.equal(f.state.closes,1);
});
test('account replacement during store acquisition prevents PXE creation and closes store',async t=>{
 const f=await fixture(t);f.state.hook=label=>{if(label==='open-store')f.account.secret=new Fr(99);};await assert.rejects(createRollingApplicationActor(f.input),{code:'ROLLING_ACTOR_CONTEXT'});
 assert(!f.state.calls.includes('create-pxe'));assert.equal(f.state.closes,1);
});
test('duplicate store ownership fails before a second private allocation',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);try{const n=f.state.calls.length;await assert.rejects(createRollingApplicationActor(f.input));assert.equal(f.state.calls.length,n);}finally{await actor.close();}
});
test('close immediately locks context, waits active sync and closes resources exactly once',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 f.state.hook=async label=>{if(label==='sync'){entered();await wait;}};
 const reading=actor.application.readAccountStatus();await started;const closing=actor.close();assert.equal(actor.close(),closing);assert.throws(actor.contextGuard);
 release();await assert.rejects(reading,{code:'ROLLING_ACTOR_CONTEXT'});await closing;assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);
 await assert.rejects(actor.application.readAccountStatus(),{code:'ROLLING_ACTOR_CONTEXT'});await assert.rejects(actor.reopenJournal(),{code:'ROLLING_ACTOR_CONTEXT'});
});
test('external activity rejects unsafe or decreasing counters',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);try{f.state.proofJobs=2;actor.activity();f.state.proofJobs=1;assert.throws(actor.activity);f.state.proofJobs=Number.MAX_SAFE_INTEGER+1;assert.throws(actor.activity);}finally{await actor.close();}
});
for(const fault of ['wrongNode','wrongPXE','wrongWallet'])test('rejects untrusted actor routing: '+fault,async t=>{
 const f=await fixture(t);f.state[fault]=true;await assert.rejects(createRollingApplicationActor(f.input));
 if(fault==='wrongNode')assert.equal(f.state.calls.length,0);else{assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);}
});
test('closed actor cannot sign or submit through retained raw handle',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input),provider=f.state.contract.getAuthWitnessProvider();await actor.close();
 assert.throws(()=>provider.createAuthWit('hash'),{code:'ROLLING_ACTOR_CONTEXT'});assert.throws(()=>actor.wallet.sendTx('payload'),{code:'ROLLING_ACTOR_CONTEXT'});
 assert.deepEqual(actor.activity(),{authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0});
});


for(const deadline of [0,-1,NaN,Infinity,'123',Number.MAX_SAFE_INTEGER])test('optional deadline rejects invalid input before acquiring storage: '+String(deadline),async t=>{
 const f=await fixture(t);await assert.rejects(createRollingApplicationActor({...f.input,confirmationDeadlineAt:deadline}));assert.equal(f.state.calls.length,0);
 const actor=await createRollingApplicationActor(f.input);await actor.close();
});
test('optional bound preserves caller options and uses lazy post-proof timeout with unchanged5s interval',async t=>{
 const f=await fixture(t),deadline=Date.now()+10000;let journalOptions;
 const create=f.input.sdk.createL2Journal;f.input.sdk.createL2Journal=options=>{journalOptions=options;return create(options);};
 const actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:deadline});try{
  const payload={},opts={from:actor.owner,fee:{exact:true},journalOperation:'fixture'};f.state.sendResult=Promise.resolve();
  const result=actor.wallet.sendTx(payload,opts);assert.equal(result,f.state.sendResult);await result;
  const passed=f.state.sendArgs[1];assert.equal(f.state.sendArgs[0],payload);assert.notEqual(passed,opts);for(const key of Object.keys(opts))assert.equal(passed[key],opts[key]);assert(!Object.hasOwn(opts,'wait'));assert(!Object.hasOwn(opts,'beforeSubmit'));
  assert.equal(passed.wait.interval,5);assert.equal(typeof Object.getOwnPropertyDescriptor(passed.wait,'timeout').get,'function');
  const time=passed.wait.timeout;assert(time>0&&time<=10);assert.equal(journalOptions.waitOptions.readTimeoutMs,3000);assert.equal(journalOptions.waitOptions.intervalMs,5000);assert(journalOptions.waitOptions.timeoutMs<=10000);
  await actor.reopenJournal();assert.equal(journalOptions.waitOptions.readTimeoutMs,3000);assert(journalOptions.waitOptions.timeoutMs<=time*1000);
 }finally{await actor.close();}
});
for(const name of ['wait','beforeSubmit'])test('bounded submission refuses an existing '+name+' even undefined without calling wallet',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:Date.now()+10000});try{
  const opts={from:actor.owner,[name]:undefined};assert.throws(()=>actor.wallet.sendTx({},opts),/cannot be replaced/);assert.equal(f.state.sendArgs,undefined);assert.equal(actor.activity().walletSubmissions,0);
 }finally{await actor.close();}
});
test('unbounded actor retains default journal wait configuration and all exact arguments',async t=>{
 const f=await fixture(t);let options;const create=f.input.sdk.createL2Journal;f.input.sdk.createL2Journal=value=>{options=value;return create(value);};
 const actor=await createRollingApplicationActor(f.input);try{assert(!Object.hasOwn(options,'waitOptions'));const args=[{}, {wait:{timeout:123},beforeSubmit:()=>{}},'extra'];actor.wallet.sendTx(...args);assert.deepEqual(f.state.sendArgs,args);assert.equal(f.state.sendArgs[1],args[1]);}finally{await actor.close();}
});

// Actual engine send lifecycle + real waitForSuccessfulReceipt + encrypted L2
// journal. Only account/PXE proving and node pending responses are labelled doubles.
async function confirmationFixture(t){
 const f=await fixture(t),events=[];
 const engine=vm.createContext({URL,Date,performance,Buffer,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});
 vm.runInContext(await fs.readFile(new URL('../../shared/moderation-policy.js',import.meta.url),'utf8'),engine);
 vm.runInContext(await fs.readFile(new URL('../../apps/src/billboard/user/engine.js',import.meta.url),'utf8'),engine);
 const settings=new GasSettings(new Gas(100,200),new Gas(1,2),new GasFees(3n,4n),new GasFees(0n,0n));
 class BaseWallet{
  constructor(pxe,node){this.pxe=pxe;this.aztecNode=node;}
  async getChainInfo(){return {chainId:31337,version:1};}
  async completeFeeOptions(opts){return {gasSettings:opts.gasSettings};}
  async simulateViaEntrypoint(){return {publicInputs:{forPublic:{}},publicOutput:{txEffect:{revertCode:{isOK:()=>true}}},gasUsed:{totalGas:new Gas(90,190),teardownGas:new Gas(0,1)}};}
  async createTxExecutionRequestFromPayloadAndFee(){return {};}
  scopesFrom(){return [];}
  senderForTagsFrom(){return undefined;}
 }
 const tx=new Tx(TxHash.fromBigInt(9n),PrivateKernelTailCircuitPublicInputs.empty(),ChonkProof.empty(),[],[]);
 f.pxe.proveTx=async()=>{events.push('proof');if(f.state.proofWait)await f.state.proofWait;return {toTx:async()=>tx};};
 f.input.node.sendTx=async()=>{events.push('send');f.state.transportSends++;};
 f.input.node.getTxReceipt=async()=>{events.push('receipt');f.state.onReceipt?.();if(f.state.readWait)await f.state.readWait;return {txHash:tx.getTxHash(),status:'pending'};};
 f.input.node.getBlock=async()=>assert.fail('Pending receipt must not read a block');
 Object.assign(f.input.sdk,outcomes,{BaseWallet,GasSettings});
 f.input.sdk.waitForSuccessfulReceipt=async(...args)=>{try{return await outcomes.waitForSuccessfulReceipt(...args);}finally{events.push('confirmation-settled');}};
 f.input.sdk.estimatePrivateFeeTransaction=async()=>({maximumFee:settings.getFeeLimit().toBigInt(),payload:{},gasSettings:settings});
 f.input.routing=engine.BillboardPrivateFeeRouting;
 f.input.sdk.AccountManager={async create(wallet,secret,contract){assert.equal(wallet.pxe,f.pxe);assert.equal(contract,f.state.contract);return {address:f.account.address};}};
 f.state.hook=async label=>{if(label==='stop')events.push('stop');if(label==='close-store')events.push('close-store');};
 return {...f,tx,events};
}
test('real engine confirmation wait settles underlying application before actor.close disposes; no late writer',async t=>{
 const f=await confirmationFixture(t),deadline=Date.now()+400,actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:deadline});
 const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'});let receiptSeen;const seen=new Promise(r=>receiptSeen=r);f.state.onReceipt=receiptSeen;
 const submitting=actor.application.submitPrepared(intent.intentId);const settled=submitting.then(()=>assert.fail('Pending cannot succeed'),error=>{f.events.push('application-settled');return error;});
 await seen;const closing=actor.close();assert.equal(f.state.stops,0);assert.throws(actor.contextGuard,{code:'ROLLING_ACTOR_CONTEXT'});
 const error=await settled;assert.equal(error.code,'BB_SUBMISSION_UNKNOWN');await closing;
 assert(Date.now()<deadline+1500);assert.equal(f.events.filter(x=>x==='send').length,1);assert(f.events.indexOf('confirmation-settled')>=0);assert(f.events.indexOf('confirmation-settled')<f.events.indexOf('stop'));assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);
 const saved=await actor.journal.inspect();assert.equal(saved.operation,'ROLLING_WORKFLOW_V1:'+intent.intentId);assert.equal(saved.txHash,txHash(f.tx));
 await assert.rejects(actor.application.submitPrepared(intent.intentId),{code:'ROLLING_ACTOR_CONTEXT'});assert.equal(f.events.filter(x=>x==='send').length,1);
});
const txHash=tx=>tx.getTxHash().toString();
test('deadline expiring during real engine proof prevents node submission and preserves proved journal',async t=>{
 const f=await confirmationFixture(t),deadline=Date.now()+200,actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:deadline});let release;
 f.state.proofWait=new Promise(r=>release=r);
 try{
  const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'});
  const pending=actor.application.submitPrepared(intent.intentId),failed=assert.rejects(pending,{code:'ROLLING_ACTOR_CONFIRMATION_EXPIRED'});
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,deadline-Date.now())+10));release();await failed;
  assert(f.events.includes('proof'));assert(!f.events.includes('send'));assert(!f.events.includes('receipt'));
  assert.equal((await actor.journal.inspect()).txHash,txHash(f.tx));assert.equal(actor.activity().transportSends,0);
 }finally{release();await actor.close();}
});
test('stalled receipt RPC uses remaining confirmation budget and cannot hold actor disposal until540s',async t=>{
 const f=await confirmationFixture(t),deadline=Date.now()+250,actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:deadline});let release,entered;
 f.state.readWait=new Promise(r=>release=r);const seen=new Promise(r=>entered=r);f.state.onReceipt=entered;
 const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'}),pending=actor.application.submitPrepared(intent.intentId);
 const failure=pending.then(()=>assert.fail(),error=>{f.events.push('application-settled');return error;});
 await seen;const closing=actor.close();assert.equal((await failure).code,'BB_SUBMISSION_UNKNOWN');await closing;const after=[...f.events],files=await fs.readdir(f.input.storageDirectory),saved=await Promise.all(files.map(name=>fs.readFile(path.join(f.input.storageDirectory,name))));
 release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,after);assert.deepEqual(await Promise.all(files.map(name=>fs.readFile(path.join(f.input.storageDirectory,name)))),saved);assert(Date.now()<deadline+1500);assert.equal(f.state.stops,1);
});

// Genuine production reader + actual processed event ABI/Poseidon/file AEAD;
// only SDK/PXE/node behavior is doubled. No chain delivery/recovery claim.
async function preferenceFixture(t){
 const f=await fixture(t),classId=new Fr(10),board=f.input.board.instance.address;
 const state=f.state;state.height=4;state.rows=[];
 Object.assign(f.input.board.instance,{currentContractClassId:classId,originalContractClassId:classId});
 const step=async name=>{state.calls.push(name);if(state.hook)await state.hook(name);};
 const blockHash=n=>BlockHash.fromString(hex(n+100));
 Object.assign(f.input.sdk,{EventSelector,decodeFunctionSignature,poseidon2HashWithSeparator});
 const decoder=await createPreferenceEventDecoder({sdk:f.input.sdk,artifact});
 Object.assign(f.input.node,{
  getBlockData:async n=>{await step('preference-block');return {header:{globalVariables:{blockNumber:n}},blockHash:blockHash(n)};},
  getContract:async(_,ref)=>{await step('preference-class');assert(BlockHash.isBlockHash(ref.hash));return {address:board,currentContractClassId:state.badClass?new Fr(11):classId,originalContractClassId:classId};},
 });
 Object.assign(f.pxe,{
  getSyncedBlockHeader:async()=>{await step('preference-header');return {globalVariables:{blockNumber:state.height},hash:async()=>blockHash(state.height)};},
  getPrivateEvents:async(selector,filter)=>{await step('preference-events');assert.equal(selector.toString(),decoder.selector.toString());assert.equal(filter.contractAddress.toString(),board.toString());assert.deepEqual(filter.scopes.map(String),[String(f.input.fees.authorAccount.address)]);state.ranges??=[];state.ranges.push([filter.fromBlock,filter.toBlock]);return state.rows.filter(r=>r.l2BlockNumber>=filter.fromBlock&&r.l2BlockNumber<filter.toBlock);},
 });
 const oldAt=f.input.sdk.Contract.at;
 f.input.sdk.Contract.at=(...args)=>{const result=oldAt(...args);result.methods.preference_head=owner=>({simulate:async opts=>{assert.equal(String(owner),String(f.input.fees.authorAccount.address));assert.equal(String(opts.from),String(owner));await step('preference-head');return {result:state.head};}});return result;};
 async function replace(changes){
  let digest=0n;state.rows=[];
  for(let i=0;i<changes.length;i++){
   const {block,kind=1,target=2n,value=true}=changes[i],fields=[1n,BigInt(i+1),BigInt(kind),BigInt(target),value?1n:0n,0n,0n,digest];
   digest=(await poseidon2HashWithSeparator([31337n,1n,board.toBigInt(),...fields],0x52435031)).toBigInt();
   state.rows.push({packedEvent:fields.map(x=>new Fr(x)),eventSelector:decoder.selector,l2BlockNumber:block,l2BlockHash:blockHash(block),txHash:TxHash.fromString(hex(block+1000))});
  }
  state.head={initialized:changes.length>0,schema:1n,revision:BigInt(changes.length),digest};
 }
 await replace([{block:2}]);return {...f,replace};
}
test('actor preference API is lazy, reads raw guarded head without nested sync, and stores only actual ciphertext',async t=>{
 const f=await preferenceFixture(t),actor=await createRollingApplicationActor(f.input);
 try{
  assert(!f.state.calls.some(x=>x.startsWith('preference-')));const before=f.state.calls.filter(x=>x==='sync').length;
  const result=await actor.application.readPreferences();assert.equal(result.status,'complete');assert.deepEqual(result.preferences.bookmarks,['2']);
  assert.equal(f.state.calls.filter(x=>x==='sync').length-before,1);assert.deepEqual(actor.activity(),{authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0});
  const files=(await fs.readdir(f.input.storageDirectory)).filter(x=>x.endsWith('.json'));assert.equal(files.length,1);
  const text=await fs.readFile(path.join(f.input.storageDirectory,files[0]),'utf8');const envelope=JSON.parse(text);assert.equal(envelope.version,1);assert(envelope.recovery);assert(!text.includes('bookmarks'));assert(!text.includes('ROLLING_PREFERENCES_V1'));
 }finally{await actor.close();}
});
test('reopen rebuilds reader against new raw app and reauthenticates genuine AEAD prefix before next page',async t=>{
 const f=await preferenceFixture(t);f.state.height=40;await f.replace([{block:2},{block:38,kind:3,target:9n}]);
 const actor=await createRollingApplicationActor(f.input);
 try{
  const first=await actor.application.readPreferences();assert.equal(first.status,'recovering');assert(!('preferences' in first));assert.deepEqual(f.state.ranges,[[1,33]]);
  await actor.reopenJournal();const second=await actor.application.readPreferences();assert.equal(second.status,'complete');assert.deepEqual(second.preferences.followedNames,['9']);assert.deepEqual(f.state.ranges,[[1,33],[33,41]]);
  const file=path.join(f.input.storageDirectory,(await fs.readdir(f.input.storageDirectory)).find(x=>x.endsWith('.json'))),prior=JSON.parse(await fs.readFile(file,'utf8'));
  prior.data=(prior.data[0]==='0'?'1':'0')+prior.data.slice(1);await fs.writeFile(file,JSON.stringify(prior),{mode:0o600});
  await actor.reopenJournal();await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});
 }finally{await actor.close();}
});
test('preference read excludes concurrent read/action/reopen and retains lease while unabortable sync is pending',async t=>{
 const f=await preferenceFixture(t),actor=await createRollingApplicationActor(f.input);let enter,release;const seen=new Promise(r=>enter=r),wait=new Promise(r=>release=r);
 f.state.hook=async name=>{if(name==='sync'){enter();await wait;}};
 const reading=actor.application.readPreferences();await seen;
 for(const work of [()=>actor.application.readPreferences(),()=>actor.application.readPreferenceHead(),()=>actor.application.prepare({type:'name',first:'River',last:'Stone'}),()=>actor.reopenJournal()])await assert.rejects(work(),{code:'ROLLING_ACTOR_CONTEXT'});
 release();assert.equal((await reading).status,'complete');await actor.close();assert.equal(f.state.stops,1);
});
test('in-flight preference close drains work and prevents ciphertext publication or a later private call',async t=>{
 const f=await preferenceFixture(t),actor=await createRollingApplicationActor(f.input);let enter,release;const seen=new Promise(r=>enter=r),wait=new Promise(r=>release=r);
 f.state.hook=async name=>{if(name==='preference-events'){enter();await wait;}};
 const reading=actor.application.readPreferences(),failure=assert.rejects(reading,{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});await seen;
 const closing=actor.close();assert.equal(f.state.stops,0);await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_ACTOR_CONTEXT'});
 release();await failure;await closing;assert.equal(f.state.stops,1);assert.deepEqual(await fs.readdir(f.input.storageDirectory),[]);
 const after=[...f.state.calls];await new Promise(r=>setImmediate(r));assert.deepEqual(f.state.calls,after);
});
for(const stage of ['preference-header','preference-head','preference-class','preference-events'])test('account change during '+stage+' rejects preference read without checkpoint publication',async t=>{
 const f=await preferenceFixture(t),actor=await createRollingApplicationActor(f.input);
 try{f.state.hook=name=>{if(name===stage)f.account.secret=new Fr(99);};await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});assert.deepEqual(await fs.readdir(f.input.storageDirectory),[]);}finally{await actor.close();}
});
test('wrong canonical board class fails before event query, without a fallback store',async t=>{
 const f=await preferenceFixture(t),actor=await createRollingApplicationActor(f.input);f.state.badClass=true;
 try{await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});assert(!f.state.calls.includes('preference-events'));assert.deepEqual(await fs.readdir(f.input.storageDirectory),[]);}finally{await actor.close();}
});
test('separate replacement namespace and empty encrypted store rebuilds from labelled SDK events, not prior cache',async t=>{
 const first=await preferenceFixture(t),a=await createRollingApplicationActor(first.input);const prior=await a.application.readPreferences();await a.close();
 const second=await preferenceFixture(t);assert.notEqual(second.input.storageDirectory,first.input.storageDirectory);assert.notEqual(second.input.dataDirectory,first.input.dataDirectory);
 const b=await createRollingApplicationActor(second.input);
 try{assert.deepEqual(await fs.readdir(second.input.storageDirectory),[]);const result=await b.application.readPreferences();assert.deepEqual(result.preferences,prior.preferences);assert.deepEqual(second.state.ranges,[[1,5]]);assert.deepEqual(b.activity(),{authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0});}finally{await b.close();}
});


// Optional observation integration: labelled SDK/PXE/node doubles only. The
// production reader, processed ABI, Poseidon and file AEAD remain real; these
// cases do not qualify chain recovery, native discovery or transport coverage.
test('metrics captures construction and owned calls before reader binding without changing node or PXE identity',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),originalCreate=f.input.sdk.createPXE;
 let constructionCalls=0;
 f.input.sdk.createPXE=function(...args){assert.equal(this,f.input.sdk);constructionCalls++;return Reflect.apply(originalCreate,this,args);};
 const actor=await createRollingApplicationActor({...f.input,metrics});
 try{
  assert.equal(constructionCalls,1);assert.equal(actor.pxe,f.pxe);assert.equal(actor.wallet.pxe,f.pxe);assert.equal(actor.wallet.aztecNode,f.input.node);
  let report=metrics.snapshot();assert.equal(report.phases['pxe-construct'].calls,1);assert.equal(report.phases['block-sync'].calls,1);assert.equal(report.phases.events.calls,0);assert.equal(report.phases['head-utility'].calls,0);
  assert.equal((await actor.application.readPreferences()).status,'complete');
  report=metrics.snapshot();assert.equal(report.phases['block-sync'].calls,2);assert.equal(report.phases.events.calls,1);assert(report.phases['head-utility'].calls>=2);assert.equal(report.counters.eventRows,1);
  for(const phase of ['discovery','fold']){assert.equal(report.phases[phase].calls,0);assert(report.unobservedPhases.includes(phase));}
  assert.equal(report.transportBytesObserved,false);assert.equal(report.endToEndWorkBoundQualified,false);assert.equal(report.encryptedRecoveryQualified,false);
  assert.deepEqual(actor.activity(),{authWitnesses:0,proofJobs:0,walletSubmissions:0,transportSends:0});
 }finally{await actor.close();}
});
test('metrics preserves original instance receivers, exact arguments and Promise/error identities',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics();let lastSync,lastEvents,answer,thrown;
 f.pxe.sync=function(...args){assert.equal(this,f.pxe);lastSync=args;if(thrown)throw thrown;return answer??Promise.resolve();};
 f.pxe.getPrivateEvents=function(...args){assert.equal(this,f.pxe);lastEvents=args;if(thrown)throw thrown;return answer;};
 const actor=await createRollingApplicationActor({...f.input,metrics});
 try{
  const a={},b={};answer=Promise.resolve([]);assert.equal(actor.pxe.sync(a,b),answer);assert.equal(lastSync[0],a);assert.equal(lastSync[1],b);
  assert.equal(actor.pxe.getPrivateEvents(a,b),answer);assert.equal(lastEvents[0],a);assert.equal(lastEvents[1],b);await answer;
  thrown=Error('PRIVATE_SENTINEL');assert.throws(()=>actor.pxe.sync(a),e=>e===thrown);assert.throws(()=>actor.pxe.getPrivateEvents(b),e=>e===thrown);thrown=undefined;
  const rejection=Error('PRIVATE_SENTINEL');answer=Promise.reject(rejection);const result=actor.pxe.getPrivateEvents(a,b);assert.equal(result,answer);await assert.rejects(result,e=>e===rejection);
  assert(!JSON.stringify(metrics.snapshot()).includes('PRIVATE_SENTINEL'));
 }finally{await actor.close();}
});
test('metrics rebuild observes the new raw head callback without nested sync or double instance wrapping',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),captured=[];
 const observer={wrapCall(phase,fn){assert.equal(this,observer);captured.push({phase,fn});return metrics.wrapCall(phase,fn);}};
 const actor=await createRollingApplicationActor({...f.input,metrics:observer});
 try{
  await actor.application.readPreferences();const first=metrics.snapshot(),firstHead=captured.find(x=>x.phase==='head-utility').fn;
  await actor.reopenJournal();const reopened=metrics.snapshot();assert.equal(reopened.phases['block-sync'].calls,first.phases['block-sync'].calls);
  await actor.application.readPreferences();const last=metrics.snapshot(),heads=captured.filter(x=>x.phase==='head-utility');
  assert.equal(heads.length,2);assert.notEqual(heads[1].fn,firstHead);assert.equal(last.phases['block-sync'].calls-first.phases['block-sync'].calls,1);
  for(const phase of ['pxe-construct','block-sync','events'])assert.equal(captured.filter(x=>x.phase===phase).length,1);
  assert.equal(last.phases['head-utility'].calls-first.phases['head-utility'].calls,f.state.calls.filter(x=>x==='preference-head').length-first.phases['head-utility'].calls);
 }finally{await actor.close();}
});
test('metrics capability is captured before awaits; changing observer property never changes later wrapping',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),observer={wrapCall:metrics.wrapCall};
 f.state.hook=label=>{if(label==='open-store')observer.wrapCall=()=>{throw Error('PRIVATE_SENTINEL');};};
 const actor=await createRollingApplicationActor({...f.input,metrics:observer});
 try{assert.equal((await actor.application.readPreferences()).status,'complete');assert(metrics.snapshot().phases['head-utility'].calls>0);}finally{await actor.close();}
});
for(const invalid of [null,{}, {wrapCall:1},Object.defineProperty({},'wrapCall',{get(){throw Error('PRIVATE_SENTINEL');}})])test('metrics rejects invalid observer before allocating resources',async t=>{
 const f=await fixture(t);await assert.rejects(createRollingApplicationActor({...f.input,metrics:invalid}),/Invalid actor metrics/);assert.equal(f.state.calls.length,0);
 const actor=await createRollingApplicationActor(f.input);await actor.close();
});
test('metrics disabled leaves original owned method identities and default behavior unchanged',async t=>{
 const f=await preferenceFixture(t),sync=f.pxe.sync,events=f.pxe.getPrivateEvents,actor=await createRollingApplicationActor(f.input);
 try{assert.equal(actor.pxe.sync,sync);assert.equal(actor.pxe.getPrivateEvents,events);assert.equal((await actor.application.readPreferences()).status,'complete');}finally{await actor.close();}
});
for(const phase of ['create-pxe','sync','preference-head','preference-events'])test('metrics counts failed '+phase+' without replay, lost cleanup or sensitive diagnostics',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),error=Error('PRIVATE_SENTINEL');let attempts=0;
 f.state.hook=label=>{if(label===phase){attempts++;throw error;}};
 if(['create-pxe','sync'].includes(phase)){
  await assert.rejects(createRollingApplicationActor({...f.input,metrics}),e=>e===error);assert.equal(f.state.stops,phase==='create-pxe'?0:1);assert.equal(f.state.closes,1);
 }else{
  const actor=await createRollingApplicationActor({...f.input,metrics});try{await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});}finally{await actor.close();}
  assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);
 }
 assert.equal(attempts,1);const report=metrics.snapshot();const label={'create-pxe':'pxe-construct',sync:'block-sync','preference-head':'head-utility','preference-events':'events'}[phase];
 assert.equal(report.phases[label].rejected,1);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));assert.equal(report.counters.pending,0);
});
test('metrics preserves close draining an unfinished event call and prevents later private writes',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),actor=await createRollingApplicationActor({...f.input,metrics});
 let release,enter;const entered=new Promise(r=>enter=r),pending=new Promise(r=>release=r);
 f.state.hook=async label=>{if(label==='preference-events'){enter();await pending;}};
 const reading=actor.application.readPreferences(),failure=assert.rejects(reading,{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});await entered;
 assert.equal(metrics.snapshot().phases.events.pending,1);const closing=actor.close();assert.equal(f.state.stops,0);
 release();await failure;await closing;assert.equal(metrics.snapshot().phases.events.pending,0);assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);assert.deepEqual(await fs.readdir(f.input.storageDirectory),[]);
});
test('metrics observer attachment failure cannot replace an owned Promise',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),actor=await createRollingApplicationActor({...f.input,metrics});
 try{
  const original=Promise.resolve([]);Object.defineProperty(original,'constructor',{get(){throw Error('PRIVATE_SENTINEL');}});
  // The original fixture method is replaced BEFORE a second actor is built,
  // exercising the real instance installation rather than a private SDK hook.
  await actor.close();f.pxe.getPrivateEvents=()=>original;f.pxe.sync=async()=>{};
  const replacement=await createRollingApplicationActor({...f.input,metrics});
  try{assert.equal(replacement.pxe.getPrivateEvents(),original);const report=metrics.snapshot();assert(report.counters.observerErrors>0);assert.equal(report.phases.events.unobserved,1);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));}finally{await replacement.close();}
 }finally{await actor.close();}
});

test('metrics cannot wrap a PXE that fails provenance validation',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),sync=f.pxe.sync,events=f.pxe.getPrivateEvents;f.state.wrongPXE=true;
 await assert.rejects(createRollingApplicationActor({...f.input,metrics}),{code:'ROLLING_ACTOR_CONTEXT'});
 assert.equal(f.pxe.sync,sync);assert.equal(f.pxe.getPrivateEvents,events);assert.equal(metrics.snapshot().phases['block-sync'].calls,0);assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);
});
test('metrics retains account-change fencing after awaited head read',async t=>{
 const f=await preferenceFixture(t),metrics=createRollingPrivateRecoveryMetrics(),actor=await createRollingApplicationActor({...f.input,metrics});
 f.state.hook=label=>{if(label==='preference-head')f.account.secret=new Fr(99);};
 try{await assert.rejects(actor.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});assert.equal(metrics.snapshot().phases.events.calls,0);assert.deepEqual(await fs.readdir(f.input.storageDirectory),[]);}finally{await actor.close();}
});

test('explicit cold actor defers account signing and never falls back when extension is unavailable',async t=>{
 const f=await fixture(t);let hashes=0;f.input.sdk.computeArtifactHash=async artifact=>{hashes++;return computeArtifactHash(artifact);};
 const actor=await createRollingApplicationActor({...f.input,coldPreferences:true});
 try{
  assert(!f.state.calls.includes('signing-key'));await assert.rejects(actor.application.readColdPreferences(),{code:'ROLLING_COLD_PREFERENCES_INVALID'});assert.equal(hashes,1);
  assert(!f.state.calls.includes('signing-key'));assert.equal(actor.activity().walletSubmissions,0);
  await actor.application.readAccountStatus();assert.equal(f.state.calls.filter(x=>x==='signing-key').length,1);
  await actor.application.readAccountStatus();assert.equal(f.state.calls.filter(x=>x==='signing-key').length,1);
 }finally{await actor.close();}
});
test('ordinary actor rejects an unselected cold capability',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor(f.input);
 try{await assert.rejects(actor.application.readColdPreferences(),/not selected/);assert.equal(actor.activity().walletSubmissions,0);}finally{await actor.close();}
});


// Labelled engine/journal adapters. The genuine engine calls exactly these
// existing methods; no generated proof, chain or funding acceptance here.
function rootHookFixture(){
 const operation='ROLLING_WORKFLOW_V1:private',txHash=hex(88),bytes=Buffer.from('PRIVATE_BYTES'),events=[];
 const state={live:true,prepared:false,observed:null,before:null,prepareResult:{saved:true}};
 const tx={toBuffer:()=>Buffer.from(bytes),getTxHash:()=>txHash};
 const journal={
  setOperation(value){assert.equal(this,journal);assert.equal(value,operation);events.push('set');},
  assertCanStart(){assert.equal(this,journal);events.push('previous');return state.previous;},
  async prepare(...args){assert.equal(this,journal);state.prepareArgs=args;events.push('prepare');if(state.prepareWait)await state.prepareWait;state.prepared=true;return state.prepareResult;},
  inspect(){assert.equal(this,journal);assert(state.prepared);events.push('inspect');return {operation,txHash};},
  confirmed(value){assert.equal(this,journal);state.receipt=value;events.push('confirmed');},
 };
 const hook={journalPrepared(value){assert.equal(this,hook);assert(state.prepared);events.push('observed');state.observed=value;},async beforeSubmit(value){assert.equal(this,hook);events.push('hook');state.before=value;if(state.hookWait)await state.hookWait;}};
 const capability={select(value){assert.equal(this,capability);assert.equal(value,operation);return hook;}};
 const opts={transactionJournal:journal,journalOperation:operation,from:'private',fee:{}};
 return {state,events,tx,bytes,txHash,operation,journal,hook,capability,args:[{},opts],guard:()=>assert(state.live)};
}
test('root adapter observes real journal completion and preserves receivers, arguments and result',async()=>{
 const f=rootHookFixture(),selected=await bindRollingRootSubmission(f.args,f.capability,f.guard),j=selected[1].transactionJournal;
 assert.equal(selected[0],f.args[0]);assert.equal(f.args[1].transactionJournal,f.journal);assert(!('beforeSubmit'in f.args[1]));
 j.setOperation(f.operation);assert.equal(j.assertCanStart(),undefined);
 const previous={encoded:'private'},options={};assert.equal(await j.prepare(f.tx,previous,options),f.state.prepareResult);
 assert.deepEqual(f.state.prepareArgs,[f.tx,previous,options]);assert.deepEqual(f.state.observed,{operation:f.operation,txHash:f.txHash,bytes:f.bytes});
 f.state.observed.bytes.fill(0);assert.equal(f.tx.toBuffer().toString(),'PRIVATE_BYTES');
 await selected[1].beforeSubmit(f.txHash);assert.deepEqual(f.state.before,{operation:f.operation,txHash:f.txHash});
 const receipt={};j.confirmed(receipt);assert.equal(f.state.receipt,receipt);assert.deepEqual(f.events,['set','previous','prepare','inspect','observed','hook','confirmed']);
});
for(const fault of ['hook-collision','wait-collision','unprepared','wrong-hash','context-after-hook','mutated-tx'])test('root adapter rejects '+fault+' without replacing engine safeguards',async()=>{
 const f=rootHookFixture();if(fault==='hook-collision')f.args[1].beforeSubmit=()=>{};if(fault==='wait-collision')f.args[1].wait={};
 if(fault.endsWith('collision')){await assert.rejects(bindRollingRootSubmission(f.args,f.capability,f.guard));return;}
 const selected=await bindRollingRootSubmission(f.args,f.capability,f.guard);
 if(fault==='unprepared'){await assert.rejects(selected[1].beforeSubmit(f.txHash));return;}
 if(fault==='mutated-tx')f.journal.prepare=async()=>{f.state.prepared=true;f.tx.toBuffer=()=>Buffer.from('MUTATED');};
 if(fault==='mutated-tx'){await assert.rejects(selected[1].transactionJournal.prepare(f.tx));assert.equal(f.state.observed,null);return;}
 await selected[1].transactionJournal.prepare(f.tx);
 if(fault==='context-after-hook')f.hook.beforeSubmit=()=>{}; // Captured callback, not mutable authority.
 if(fault==='context-after-hook'){let release;f.state.hookWait=new Promise(r=>{release=r;});const work=selected[1].beforeSubmit(f.txHash);f.state.live=false;release();await assert.rejects(work);}
 else await assert.rejects(selected[1].beforeSubmit(hex(89)));
});
for(const error of [undefined,null,false,0,Error('PRIVATE_ERROR')])test('root adapter preserves journal rejection before any observer '+String(error),async()=>{
 const f=rootHookFixture();f.journal.prepare=function(){assert.equal(this,f.journal);return Promise.reject(error);};
 const selected=await bindRollingRootSubmission(f.args,f.capability,f.guard),result=await selected[1].transactionJournal.prepare(f.tx).then(()=>({resolved:true}),reason=>({reason}));
 assert(!result.resolved);assert.equal(result.reason,error);assert.equal(f.state.observed,null);
});
test('root adapter drains malformed asynchronous selector and journal observer',async()=>{
 const f=rootHookFixture(),error=Error('PRIVATE_CALLBACK');let selectSettled=false;
 f.capability.select=async()=>{await Promise.resolve();selectSettled=true;throw error;};
 await assert.rejects(bindRollingRootSubmission(f.args,f.capability,f.guard),e=>e===error);assert(selectSettled);
 const g=rootHookFixture();let observed=false;g.hook.journalPrepared=async()=>{await Promise.resolve();observed=true;throw error;};
 const selected=await bindRollingRootSubmission(g.args,g.capability,g.guard);await assert.rejects(selected[1].transactionJournal.prepare(g.tx),e=>e===error);assert(observed);
});
test('unselected root adapter preserves existing replacement hook and original option object',async()=>{
 const f=rootHookFixture();f.args[1].beforeSubmit=()=>{};f.capability.select=()=>undefined;
 assert.equal(await bindRollingRootSubmission(f.args,f.capability,f.guard),f.args);
});
test('actor rejects malformed root capability before mutable store construction',async t=>{
 const f=await fixture(t);let accessed=0;
 await assert.rejects(createRollingApplicationActor({...f.input,rootSubmissionGate:{get select(){accessed++;return ()=>{};}}}));
 assert.equal(accessed,0);assert(!f.state.calls.includes('open-store'));
 await assert.rejects(createRollingApplicationActor({...f.input,confirmationDeadlineAt:Date.now()+1000,rootSubmissionGate:{select:()=>undefined}}));assert(!f.state.calls.includes('open-store'));
});
test('root adapter drains an own-data thenable without invoking accessor results',async()=>{
 const f=rootHookFixture();let drained=false;f.capability.select=()=>({then(resolve){queueMicrotask(()=>{drained=true;resolve({});});}});
 await assert.rejects(bindRollingRootSubmission(f.args,f.capability,f.guard));assert(drained);
 let accessed=0;f.capability.select=()=>({get then(){accessed++;return ()=>{};}});
 await assert.rejects(bindRollingRootSubmission(f.args,f.capability,f.guard));assert.equal(accessed,0);
});

test('actual engine and AEAD journal invoke root gate after saved bytes and before one ordinary submission',async t=>{
 const f=await confirmationFixture(t);let prepared,entered=false;
 const hook={journalPrepared(value){prepared=value;},async beforeSubmit(value){assert.equal(value.txHash,prepared.txHash);entered=true;assert(!f.events.includes('send'));}};
 f.input.node.getTxReceipt=async()=>({txHash:f.tx.getTxHash(),status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:hex(3),transactionFee:1n});
 f.input.node.getBlock=async()=>({hash:hex(3)});
 const actor=await createRollingApplicationActor({...f.input,rootSubmissionGate:{select:()=>hook}});
 try{
  const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'});
  const result=await actor.application.submitPrepared(intent.intentId);assert.equal(result.status,'confirmed');assert(entered);
  assert.equal(prepared.operation,'ROLLING_WORKFLOW_V1:'+intent.intentId);assert.equal(prepared.txHash,txHash(f.tx));assert(prepared.bytes.equals(f.tx.toBuffer()));
  assert.equal(f.events.filter(x=>x==='proof').length,1);assert.equal(f.events.filter(x=>x==='send').length,1);
  assert.equal((await actor.journal.inspect()).txHash,prepared.txHash);
 }finally{await actor.close();}
});
test('actual engine held root hook retains actor lease through close and cannot send after lock',async t=>{
 const f=await confirmationFixture(t);let release,entered,prepared;
 const held=new Promise(r=>release=r),seen=new Promise(r=>entered=r);
 const hook={journalPrepared(value){prepared=value;},async beforeSubmit(){entered();await held;f.events.push('hook-settled');}};
 const actor=await createRollingApplicationActor({...f.input,rootSubmissionGate:{select:()=>hook}});
 let pending;
 try{
  const intent=await actor.application.prepare({type:'name',first:'River',last:'Stone'});
  pending=actor.application.submitPrepared(intent.intentId);const rejected=assert.rejects(pending,{code:'ROLLING_ACTOR_CONTEXT'});await seen;
  assert.equal((await actor.journal.inspect()).txHash,prepared.txHash);assert(prepared.bytes.equals(f.tx.toBuffer()));
  const closing=actor.close();assert.equal(f.state.stops,0);assert(!f.events.includes('send'));
  release();await rejected;await closing;assert.equal(f.state.stops,1);assert(f.events.indexOf('hook-settled')<f.events.indexOf('stop'));assert(!f.events.includes('send'));
 }finally{release();if(pending)await pending.catch(()=>{});await actor.close();}
});

test('bounded actor composes original beforeSubmit receiver and falsy failure without bypassing deadline',async t=>{
 const f=await fixture(t),actor=await createRollingApplicationActor({...f.input,confirmationDeadlineAt:Date.now()+10000});
 try{const receiver={},args=['saved-hash'],calls=[];actor.wallet.sendTx({}, {beforeSubmit:async function(...values){assert.equal(this,receiver);calls.push(values);}});
 await Reflect.apply(f.state.sendArgs[1].beforeSubmit,receiver,args);assert.deepEqual(calls,[args]);
 for(const value of [undefined,null,0,false]){actor.wallet.sendTx({}, {beforeSubmit:async()=>{throw value;}});let caught=false;try{await f.state.sendArgs[1].beforeSubmit();}catch(error){caught=true;assert.equal(error,value);}assert(caught);}
 actor.wallet.sendTx({}, {beforeSubmit:async()=>actor.close()});await assert.rejects(f.state.sendArgs[1].beforeSubmit(),{code:'ROLLING_ACTOR_CONTEXT'});
 }finally{await actor.close();}
});

test('optional Bok actor verifies original public capability and registers actual artifact before application use',async t=>{
 const f=await fixture(t,{proofsEnabled:false});const bokArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url),'utf8')));
 const config={contractAddress:String(address(9)),operatorAddress:String(address(10)),pluginId:String(new Fr(1))};const id=new Fr(12),hash=String(new Fr(13));
 f.input.sdk.getContractClassFromArtifact=async value=>{assert.equal(value,bokArtifact);return {id};};
 f.input.sdk.computeContractAddressFromInstance=async value=>value.address;
 f.input.node.getBlockData=async()=>({blockHash:hash,header:{globalVariables:{blockNumber:1}}});
 f.input.node.getContract=async(value,ref)=>{assert.equal(String(value),config.contractAddress);assert.deepEqual(ref,{hash});return {address:value,currentContractClassId:id,originalContractClassId:id};};
 const expected={board:2n,operator:10n,l1_chain:31337n,version:1n};let reads=0;
 f.input.node.getPublicStorageAt=async(ref,where,slot)=>{assert.deepEqual(ref,{hash});assert.equal(String(where),config.contractAddress);const key=Object.keys(expected).find(key=>BigInt(bokArtifact.storageLayout[key].slot)===slot.toBigInt());assert(key);reads++;return new Fr(expected[key]);};
 const actor=await createRollingApplicationActor({...f.input,bok:{config,artifact:bokArtifact}});
 try{assert.equal(reads,4);assert.equal(f.state.calls.filter(x=>x==='register-contract').length,4);assert.equal(actor.activity().walletSubmissions,0);}finally{await actor.close();}
});
test('optional Bok actor rejects malformed capability before acquiring its private store',async t=>{
 const f=await fixture(t);await assert.rejects(createRollingApplicationActor({...f.input,bok:{config:{contractAddress:'wrong'},artifact:{name:'PrivateBok'}}}));
 assert(!f.state.calls.includes('open-store'));assert.equal(f.state.closes,0);
 const actor=await createRollingApplicationActor(f.input);await actor.close();
});
