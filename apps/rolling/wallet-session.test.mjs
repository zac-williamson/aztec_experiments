// Negative custody boundaries: no SDK/network work may precede the account lock
// and the caller's current-account guard. These are synthetic unit checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingWalletSession} from './wallet-session.mjs';
function options(){
 const accesses=[];return {accesses,input:{sdk:new Proxy({},{get(_target,key){accesses.push(key);throw Error('Unexpected SDK access');}}),
  routing:{},ethers:{},config:{network:{chainId:31337,rollupVersion:1,rollupAddress:'0x'+'1'.repeat(40)}},
  boardArtifact:{},privateFeeArtifact:{},account:{address:'0x'+'2'.repeat(64),secretKey:'0x'+'3'.repeat(64),salt:'0'},
  trustedQuery:{url:'http://127.0.0.1:1',allowLocalDev:true},contextGuard:()=>{},locks:{request:async(_name,_options,fn)=>fn({})}}};
}
test('unsupported cross-tab custody fails before any SDK/network access',async()=>{
 const {input,accesses}=options();input.locks={};await assert.rejects(createRollingWalletSession(input),{code:'ROLLING_SESSION_CONFIG'});assert.deepEqual(accesses,[]);
});
test('another active tab rejects setup without reading or opening private stores',async()=>{
 const {input,accesses}=options();let requested;
 input.locks={request:async(name,config,fn)=>{requested={name,config};return fn(null);}};
 await assert.rejects(createRollingWalletSession(input),{code:'ROLLING_OTHER_TAB'});
 assert.deepEqual(requested,{name:'billboard-wallet:'+input.account.address,config:{ifAvailable:true}});assert.deepEqual(accesses,[]);
});
test('invalidated account rejects before trusted-node construction; lock callback settles',async()=>{
 const {input,accesses}=options(),original=Error('Account changed');let released=false;
 input.contextGuard=()=>{throw original;};input.locks={request:async(_name,_config,fn)=>{try{return await fn({});}finally{released=true;}}};
 await assert.rejects(createRollingWalletSession(input),error=>error===original);assert.equal(released,true);assert.deepEqual(accesses,[]);
});
test('query construction receives captured scope and preserves failure without fallback',async()=>{
 const {input}=options(),original=Error('Trusted service unavailable');let calls=0;
 input.sdk={createTrustedPrivateNode:async value=>{calls++;assert.deepEqual(value,{url:'http://127.0.0.1:1',allowLocalDev:true,
  expectedNetworkScope:{chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},proofsEnabled:true,readinessTier:'checkpointed'});throw original;}};
 await assert.rejects(createRollingWalletSession(input),error=>error===original);assert.equal(calls,1);
});

import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact,decodeFromAbi,getFunctionReturnType,EventSelector,decodeFunctionSignature} from '@aztec-labs/stdlib/abi';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
import {computeArtifactHash,getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {derivePrivateFeeInstance,normalizePrivateFeeGasSettings} from '../../shared/private-fee-client.mjs';
import {expectedPortalRuntime,verifyPortalRuntime} from '../../shared/portal-runtime.mjs';
import {encodeConfigCommitment} from '../../shared/protocol-commitments.mjs';
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const feeArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../src/billboard/private_fee_artifact.json',import.meta.url))));
const metadata=JSON.parse(fs.readFileSync(new URL('../../shared/portal-runtime.json',import.meta.url)));
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),eth=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');

async function deploymentFixture(){
 const deployer=AztecAddress.fromBigIntUnsafe(3n),rollup=eth(11),portal=eth(22);
 const board=await getContractInstanceFromInstantiationParams(artifact,{salt:new Fr(7),deployer,constructorArtifact:'init',constructorArgs:[Array(32).fill(0n),0,31337,rollup,1,100,200,60,2,120,3]});
 const fee=await derivePrivateFeeInstance(feeArtifact),state={destroyed:0,guards:0,reads:[],ethReads:[],inspection:0,enabled:true};
 const config={network:{chainId:'31337',rollupVersion:'1',rollupAddress:rollup,nodeUrl:'http://127.0.0.1:1',ethRpcUrl:'http://127.0.0.1:2'},
  board:{contractAddress:String(board.address),portalAddress:portal},privateFee:{contractAddress:String(fee.address),gasSettings:{gasLimits:{daGas:'1000',l2Gas:'1000'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
 const economics={minDeposit:'100',maxDeposit:'200',baseCooldown:'60',kMultiplier:'2',censorWindow:'120',maxSaveUp:'3'};
 const configHash=sha256ToField(Buffer.from(encodeConfigCommitment({l1ChainId:'31337',rollupVersion:'1',rollupAddress:rollup,boardAddress:String(board.address)},economics)));
 const immutables={MIN_DEPOSIT:100n,MAX_DEPOSIT:200n,L2_CONTRACT:BigInt(String(board.address)),ROLLUP:11n,INBOX:33n,OUTBOX:44n,VERSION:1n,L1_CHAIN_ID:31337n,CONFIG_HASH:configHash.toBigInt()};
 const storage=new Map([[1n,22n],...[31337n,11n,1n,100n,200n,60n,2n,120n,3n,3n].map((value,i)=>[3n+BigInt(i),value])]);
 const node={getBlockData:async n=>({blockHash:Fr.fromString(hex(55)),header:{globalVariables:{blockNumber:10}}}),
  getContract:async(address,reference)=>{state.reads.push(['instance',reference]);return address.equals(board.address)?board:fee;},
  getPublicStorageAt:async(reference,address,slot)=>{state.reads.push(['storage',reference]);return new Fr(storage.get(slot.toBigInt()));},
  getL1ContractAddresses:async()=>({rollupAddress:rollup,inboxAddress:eth(33),outboxAddress:eth(44)})};
 const provider={getNetwork:async()=>({chainId:31337n}),getBlock:async n=>({number:20,hash:hex(66)}),getCode:async(address,n)=>{state.ethReads.push(n);return expectedPortalRuntime(metadata,immutables);},destroy:()=>{state.destroyed++;}};
 const ethers={JsonRpcProvider:class{constructor(){return provider;}},Contract:class{constructor(){return {...Object.fromEntries(Object.keys(immutables).map(name=>[name,async opts=>{state.ethReads.push(opts.blockTag);return immutables[name];}])),depositsEnabled:async opts=>{state.ethReads.push(opts.blockTag);return state.enabled;}};}}};
 const sdk={Fr,AztecAddress,getContractClassFromArtifact,computeContractAddressFromInstance,derivePrivateFeeInstance,normalizePrivateFeeGasSettings,sha256ToField,verifyPortalRuntime,portalRuntimeMetadata:metadata,
  isTrustedPrivateNode:n=>n===node,inspectTrustedNode:async(n,opts)=>{state.inspection++;assert.deepEqual(opts.expectedNetworkScope,{chainId:'31337',version:'1',rollup});assert.equal(opts.proofsEnabled,state.proofsEnabled??true);}};
 const options={sdk,node,ethers,config,boardArtifact:artifact,privateFeeArtifact:feeArtifact,contextGuard:async()=>{state.guards++;}};
 return {options,state,node,provider,board,fee,storage,immutables,configHash,economics};
}

import {deriveKeys,deriveMasterMessageSigningSecretKey as deriveSigningKey} from '@aztec-labs/stdlib/keys';
import {SchnorrInitializerlessAccountContract} from '@aztec-labs/accounts/schnorr';
import {computePartialAddress} from '@aztec-labs/stdlib/contract';
import {Tx} from '@aztec-labs/stdlib/tx';
import {encodeArguments} from '@aztec-labs/stdlib/abi';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserJournalStorage} from '../../shared/journal-indexeddb.mjs';
import {createL2Journal,l2JournalScopeText} from '../../shared/l2-journal.mjs';
const ownedIdString=value=>hex(value.toBigInt());
async function sessionFixture(){
 const f=await deploymentFixture(),state={active:false,events:[],stops:0,closes:0,syncs:0,sends:0,registrations:0};
 const registered=nameRegistration('River','Stone'),ownedId=await poseidon2HashWithSeparator(registered.preimage.map(n=>new Fr(n)),NAME_DOMAIN);
 const available=nameRegistration('Fresh','Willow'),availableId=await poseidon2HashWithSeparator(available.preimage.map(n=>new Fr(n)),NAME_DOMAIN);
 const nameSlots=new Map();for(const [id,value]of [[ownedId,1n],[availableId,0n]])nameSlots.set((await deriveStorageSlotInMap(artifact.storageLayout.registered_names.slot,id)).toBigInt(),value);
 const storage=f.node.getPublicStorageAt;f.node.getPublicStorageAt=async(reference,address,slot)=>{
  if(nameSlots.has(slot.toBigInt())){assert(state.active);assert.deepEqual(reference,{hash:hex(55)});assert(address.equals(f.board.address));(state.nameReads??=[]).push(slot.toString());return new Fr(nameSlots.get(slot.toBigInt()));}
  return storage(reference,address,slot);
 };
 const ownedAbi=artifact.functions.find(fn=>fn.name==='owned_name_records');assert(ownedAbi,'Normal profile artifact required');
 const packed=bytes=>[new Fr(bytes.slice(0,31).reduce((n,b)=>(n<<8n)|BigInt(b),0n)),new Fr(BigInt(bytes[31])<<240n)];
 const ownedRecords=decodeFromAbi(getFunctionReturnType(ownedAbi),[ownedId,Fr.ONE,new Fr(5),...packed(registered.arguments[0]),new Fr(5),...packed(registered.arguments[2]),...Array.from({length:56},()=>Fr.ZERO)]);
 const secret=new Fr(8n),salt=Fr.ZERO,accountContract=new SchnorrInitializerlessAccountContract(deriveSigningKey(secret));
 const keys=await deriveKeys(secret),accountArtifact=await accountContract.getContractArtifact();
 const accountInstance=await getContractInstanceFromInstantiationParams(accountArtifact,{salt,publicKeys:keys.publicKeys,constructorArgs:undefined,constructorArtifact:undefined,immutablesHash:await accountContract.getImmutablesHash()});
 const account={secretKey:String(secret),salt:String(salt),address:String(accountInstance.address)};
 const held=event=>{assert.equal(state.active,true,event);state.events.push(event);};
 const store={close:async()=>{held('store-close');state.closes++;if(state.failClose)throw Error('close failed');}};
 const pxe={registerAccount:async()=>{held('register-account');state.registrations++;},registerContractClass:async()=>{held('register-class');},registerContract:async()=>{held('register-contract');},
  sync:async()=>{held('sync');state.syncs++;if(state.waitSync)await state.waitSync;if(state.failSync)throw Error('sync failed');},
  getSyncedBlockHeader:async()=>{held('preference-header');return {globalVariables:{blockNumber:10},hash:async()=>BlockHash.fromString(hex(55))};},
  getPrivateEvents:async()=>{held('preference-events');if(state.waitEvents)await state.waitEvents;if(state.failEvents)throw Error('PRIVATE_SENTINEL');return [];},
  stop:async()=>{held('stop');state.stops++;if(state.waitStop)await state.waitStop;if(state.failStop)throw Error('stop failed');await store.close();}};
 const privateStore=createBrowserJournalStorage(new IDBFactory());
 const wallet={aztecNode:f.node,pxe,getAccounts:async()=>[accountInstance.address],getChainInfo:async()=>({chainId:31337,version:1}),sendTx:async()=>{held('send');state.sends++;throw Error('unknown send');}};
 const routing={createAztecWallet:(_sdk,p,n,raw)=>{held('create-wallet');assert.equal(p,pxe);assert.equal(n,f.node);assert.equal(raw,f.node);return wallet;},
  isPrivateWalletForNode:(w,n)=>!state.wrongWallet&&w===wallet&&n===f.node};
 const sdk={...f.options.sdk,computeArtifactHash,poseidon2HashWithSeparator,deriveStorageSlotInMap,EventSelector,decodeFunctionSignature,Fr,deriveKeys,deriveSigningKey,SchnorrInitializerlessAccountContract,getContractInstanceFromInstantiationParams,computePartialAddress,Tx,encodeArguments,
  createTrustedPrivateNode:async options=>{held('trusted-node');state.trustedProofsEnabled=options.proofsEnabled;assert.equal(options.url,'http://127.0.0.1:3/v1/node');return f.node;},
  openPXEStore:async options=>{held('open-store');assert.equal(options.accountAddress,account.address);assert.equal(options.dataDirectory,'rolling-wallet-v1');return store;},
  createPXE:async(n,c,o)=>{held('create-pxe');state.pxeConfig=structuredClone(c);assert.equal(n,f.node);assert.equal(o.store,store);assert.deepEqual(o.remoteProver,{url:'http://127.0.0.1:3',board:String(f.board.address)});if(state.failCreatePXE)throw Error('pxe failed');return pxe;},
  isPrivatePXEForNode:(p,n)=>!state.wrongPXE&&p===pxe&&n===f.node,
  createBrowserJournalStorage:()=>privateStore,createL2Journal,
  AccountManager:{create:async()=>{held('account-manager');return {address:accountInstance.address};}},
  ContractFunctionInteraction:class{async simulate(){held('signing-capsule');}},
  Contract:{at:()=>({methods:{preference_head:()=>({simulate:async()=>{held('preference-head');return {result:decodeFromAbi(getFunctionReturnType(artifact.functions.find(fn=>fn.name==='preference_head')),[Fr.ZERO,Fr.ONE,Fr.ZERO,Fr.ZERO])};}}),register_name:(...args)=>({args}),get_deposit_ids:()=>({simulate:async()=>({result:[9n,...Array(9).fill(0n)]})}),owned_name_records:()=>({simulate:async()=>({result:ownedRecords})})}})},
  preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async()=>({maximumFee:10n,payload:{},gasSettings:{}})};
 const locks={request:async(name,options,run)=>{assert.equal(name,'billboard-wallet:'+account.address);assert.deepEqual(options,{ifAvailable:true});
  if(state.active||state.otherTab)return run(null);state.active=true;state.events.push('lock');try{return await run({});}finally{state.active=false;state.events.push('unlock');}}};
 return {...f,state,deploymentState:f.state,ownedId,privateStore,pxe,store,wallet,input:{...f.options,sdk,routing,account,locks,trustedQuery:{url:'http://127.0.0.1:3/v1/node',allowLocalDev:true},remoteProver:{url:'http://127.0.0.1:3',board:String(f.board.address)},contextGuard:async()=>{held('guard');}}};
}
test('funding reader opens lazily under account lease and closes with the session',async()=>{
 const f=await sessionFixture();let opened=0,destroyed=0,reads=0;
 const Original=f.input.ethers.JsonRpcProvider;
 f.input.ethers={...f.input.ethers,JsonRpcProvider:class{constructor(url){opened++;if(opened===1)return new Original(url);return {getNetwork:async()=>{assert(f.state.active);reads++;return {chainId:31337n};},destroy:()=>{destroyed++;}};}}};
 const receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44)};
 const claimStore={load:async()=>null};f.input.claimStore=claimStore;
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10},hash:async()=>hex(55),state:{l1ToL2MessageTree:{root:new Fr(1)}}});
 f.input.sdk.prepareFundingClaim=async input=>{assert.equal(input.claimStore,claimStore);assert.equal((await input.ethProvider.getNetwork()).chainId,31337n);return {status:'waiting'};};
 const session=await createRollingWalletSession(f.input);assert.equal(opened,1);
 await assert.rejects(session.application.prepare({type:'claim-deposit',receipt}),{code:'ROLLING_FUNDING_NOT_READY'});
 assert.equal(opened,2);assert.equal(reads,1);assert.equal(f.state.sends,0);
 await session.close();assert.equal(destroyed,1);
 await assert.rejects(session.application.prepare({type:'claim-deposit',receipt}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(reads,1);
});
test('constructs verified deployment/account, registers with one trusted PXE, and guards every application operation',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);
 assert.equal(f.state.registrations,1);assert.equal(f.state.events.filter(x=>x==='register-contract').length,3);
 const names=await session.application.ownedIdentities();assert.deepEqual(names.identities,[ownedIdString(f.ownedId)]);assert.deepEqual(names.records,[{id:ownedIdString(f.ownedId),first:'River',last:'Stone'}]);
 assert.equal((await session.application.readAccountStatus()).status,'fee-ready');
 const intent=await session.application.prepare({type:'name',first:'Fresh',last:'Willow'});assert.equal(intent.status,'prepared');assert.equal(f.state.nameReads.length,1);assert.deepEqual(intent.nameAvailability.anchor,{blockNumber:10,blockHash:hex(55)});
 assert.equal((await session.application.cancelPrepared(intent.intentId)).status,'cancelled');
 await session.close();await session.close();assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);assert.equal(f.state.active,false);
 await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_CONTEXT_CHANGED'});
});
test('replacement session preserves actual encrypted Rolling intent and unknown fence without a second send',async()=>{
 const f=await sessionFixture(),first=await createRollingWalletSession(f.input),intent=await first.application.prepare({type:'name',first:'Fresh',last:'Willow'});
 await assert.rejects(first.application.submitPrepared(intent.intentId),/unknown send/);await first.close();
 const second=await createRollingWalletSession(f.input);assert.equal((await second.application.reconcile(intent.intentId)).status,'unknown');
 await assert.rejects(second.application.submitPrepared(intent.intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);await second.close();
});
test('setup failures clean private resources while still holding the cross-tab lock',async()=>{
 for(const mode of ['failCreatePXE','failSync','wrongPXE','wrongWallet']){
  const f=await sessionFixture();f.state[mode]=true;await assert.rejects(createRollingWalletSession(f.input));
  assert.equal(f.state.active,false);assert.equal(f.state.closes,1);assert.equal(f.state.stops,mode==='failCreatePXE'?0:1);
  assert.ok(f.state.events.indexOf('store-close')<f.state.events.lastIndexOf('unlock'));
  if(mode==='wrongPXE')assert.equal(f.state.registrations,0);
  if(mode==='wrongWallet')assert.ok(!f.state.events.includes('account-manager'));
 }
});
test('cleanup errors preserve original failure and close the store when PXE.stop fails',async()=>{
 const f=await sessionFixture();f.state.failSync=true;f.state.failStop=true;f.state.failClose=true;
 await assert.rejects(createRollingWalletSession(f.input),error=>error instanceof AggregateError&&error.errors[0].message==='sync failed'&&error.errors[1] instanceof AggregateError);
 assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);assert.equal(f.state.active,false);
});
test('simultaneous close shares one cleanup; busy action prevents close or competing action',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);
 let release;f.state.waitSync=new Promise(resolve=>{release=resolve;});const action=session.application.ownedIdentities();await new Promise(r=>setTimeout(r,0));
 assert.equal(session.busy,true);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});
 release();await action;f.state.waitSync=null;
 let stop;f.state.waitStop=new Promise(resolve=>{stop=resolve;});const close1=session.close(),close2=session.close();assert.equal(close1,close2);stop();await Promise.all([close1,close2]);assert.equal(f.state.stops,1);
});
test('identity mutation inside asynchronous guard rejects before private setup or synchronization',async()=>{
 const f=await sessionFixture();f.input.contextGuard=async()=>{await Promise.resolve();f.input.account.salt='9';};
 await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_CONTEXT_CHANGED'});assert.ok(!f.state.events.includes('trusted-node'));
 const g=await sessionFixture(),session=await createRollingWalletSession(g.input);const before=g.state.syncs;g.input.account.secretKey=hex(99);
 await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(g.state.syncs,before);await session.close();
});

test('altered private routing is rejected before per-operation PXE synchronization',async()=>{
 for(const mutate of [f=>{f.state.wrongPXE=true;},f=>{f.state.wrongWallet=true;},f=>{f.wallet.aztecNode={};}]){
  const f=await sessionFixture(),session=await createRollingWalletSession(f.input),before=f.state.syncs;mutate(f);
  await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_PRIVATE_ROUTE'});assert.equal(f.state.syncs,before);await session.close();
 }
});
test('failed close leaves session unusable, preserves error, and permits explicit cleanup retry',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);f.state.failStop=true;
 await assert.rejects(session.close(),/stop failed/);assert.equal(f.state.closes,1);assert.equal(session.busy,false);
 await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_CONTEXT_CHANGED'});
 f.state.failStop=false;await session.close();assert.equal(f.state.stops,2);
 const g=await sessionFixture(),other=await createRollingWalletSession(g.input);g.state.otherTab=true;
 await assert.rejects(other.close(),{code:'ROLLING_OTHER_TAB'});assert.equal(g.state.stops,0);
 g.state.otherTab=false;await other.close();assert.equal(g.state.stops,1);
});

test('account mutation during each awaited initialization step blocks the next private operation',async()=>{
 for(const stage of ['partial-address','class-registration','last-registration','account-manager','signing-key']){
  const f=await sessionFixture();let forbidden=0;
  const change=()=>{f.input.account.salt='9';};
  if(stage==='partial-address'){
   const original=f.input.sdk.computePartialAddress;f.input.sdk.computePartialAddress=async(...args)=>{const result=await original(...args);change();return result;};
   f.pxe.registerAccount=async()=>{forbidden++;};
  }
  if(stage==='class-registration'){
   const original=f.pxe.registerContractClass;f.pxe.registerContractClass=async(...args)=>{await original(...args);change();};
   f.pxe.registerContract=async()=>{forbidden++;};
  }
  if(stage==='last-registration'){
   const original=f.pxe.registerContract;let calls=0;f.pxe.registerContract=async(...args)=>{await original(...args);if(++calls===3)change();};
   f.pxe.sync=async()=>{forbidden++;};
  }
  if(stage==='account-manager'){
   const original=f.input.sdk.AccountManager.create;f.input.sdk.AccountManager.create=async(...args)=>{const result=await original(...args);change();return result;};
   f.input.sdk.SchnorrInitializerlessAccountContract=class extends SchnorrInitializerlessAccountContract{async getSigningPublicKey(){if(f.input.account.salt==='9')forbidden++;return super.getSigningPublicKey();}};
  }
  if(stage==='signing-key'){
   f.input.sdk.SchnorrInitializerlessAccountContract=class extends SchnorrInitializerlessAccountContract{async getSigningPublicKey(){const result=await super.getSigningPublicKey();if(f.state.events.includes('account-manager'))change();return result;}};
   f.input.sdk.ContractFunctionInteraction=class{async simulate(){forbidden++;}};
  }
  if(stage==='signing-key'){
   const session=await createRollingWalletSession(f.input);
   assert(!f.state.events.includes('signing-capsule'));
   await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_CONTEXT_CHANGED'},stage);await session.close();
  }else await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_CONTEXT_CHANGED'},stage);
  assert.equal(forbidden,0,stage);assert.equal(f.state.stops,1,stage);assert.equal(f.state.closes,1,stage);
  assert.ok(f.state.events.indexOf('store-close')<f.state.events.lastIndexOf('unlock'),stage);
 }
});

test('account mutation while opening storage prevents PXE creation and closes only the acquired store',async()=>{
 const f=await sessionFixture(),original=f.input.sdk.openPXEStore;let creates=0;
 f.input.sdk.openPXEStore=async(...args)=>{const store=await original(...args);f.input.account.salt='9';return store;};
 f.input.sdk.createPXE=async()=>{creates++;throw Error('must not construct private PXE');};
 await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_CONTEXT_CHANGED'});
 assert.equal(creates,0);assert.equal(f.state.stops,0);assert.equal(f.state.closes,1);
 assert.ok(f.state.events.indexOf('store-close')<f.state.events.lastIndexOf('unlock'));
});

// Real session/application/AEAD/ABI; PXE and node above are explicitly synthetic.
async function waitForPreferenceEvents(f){
 const deadline=Date.now()+2000;
 while(!f.state.events.includes('preference-events')){assert(Date.now()<deadline,'Preference event read did not start');await new Promise(r=>setTimeout(r,1));}
}
test('preferences initialize lazily and read under the one existing lock with one synchronization',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);
 assert(!f.state.events.includes('preference-events'));const syncs=f.state.syncs,start=f.state.events.length;
 const result=await session.application.readPreferences();assert.equal(result.status,'complete');assert.deepEqual(result.preferences.bookmarks,[]);
 assert.equal(f.state.syncs,syncs+1);const events=f.state.events.slice(start);
 assert.equal(events.filter(v=>v==='lock').length,1);assert.equal(events.filter(v=>v==='unlock').length,1);
 assert(events.includes('preference-head'));assert(events.includes('preference-events'));assert.equal(f.state.sends,0);await session.close();
});
test('preference cancellation retains account lock until unabortable SDK read settles',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);let release;
 f.state.waitEvents=new Promise(r=>{release=r;});const controller=new AbortController();
 const pending=session.application.readPreferences({signal:controller.signal}),observed=assert.rejects(pending,{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});
 await waitForPreferenceEvents(f);controller.abort();
 assert(session.busy&&f.state.active);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});
 await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});assert.equal(f.state.stops,0);
 release();await observed;assert.equal(session.busy,false);assert.equal(f.state.active,false);assert.equal(f.state.sends,0);await session.close();
});
test('different active tab rejects preference read before synchronization or event lookup',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);const syncs=f.state.syncs;
 f.state.otherTab=true;await assert.rejects(session.application.readPreferences(),{code:'ROLLING_OTHER_TAB'});
 assert.equal(f.state.syncs,syncs);assert(!f.state.events.includes('preference-events'));f.state.otherTab=false;await session.close();
});
test('account change during private preference event read prevents publication without a send',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);let release;
 f.state.waitEvents=new Promise(r=>{release=r;});const pending=session.application.readPreferences(),observed=assert.rejects(pending,{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});
 await waitForPreferenceEvents(f);f.input.account.secretKey=hex(99);release();await observed;
 assert.equal(f.state.sends,0);assert.equal(f.state.active,false);await session.close();
});
test('failed preference read preserves session and existing prepared financial intent',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),intent=await session.application.prepare({type:'name',first:'Fresh',last:'Willow'});
 f.state.failEvents=true;await assert.rejects(session.application.readPreferences(),{code:'ROLLING_PREFERENCE_READER_UNAVAILABLE'});
 const restored=await session.application.readAccountStatus();assert.equal(restored.intent.intentId,intent.intentId);assert.equal(f.state.sends,0);
 f.state.failEvents=false;assert.equal((await session.application.readPreferences()).status,'complete');await session.close();
});

// Actual cold reader, AEAD, local artifact hash and session lease; explicitly
// synthetic PXE mailbox and chain anchor. Full-chain recovery is a separate gate.
function installColdMailbox(f){
 const receipt={schemaVersion:1,database:'ab'.repeat(32),epoch:'cd'.repeat(32),sequence:0,
  anchor:{blockNumber:10,blockHash:hex(55)},nextBlock:1,nextLog:0,records:[],head:null,complete:false};
 f.node.getBlockData=async height=>{assert(height===10||height==='checkpointed');return {blockHash:Fr.fromString(hex(55)),header:{globalVariables:{blockNumber:10},hash:async()=>Fr.fromString(hex(55))}};};
 f.pxe.processRollingPreferenceRecovery=async(config,{contextGuard})=>{
  assert(f.state.active);f.state.events.push('cold-mailbox');await contextGuard();
  assert.equal(config.expectedArtifactHash,(await computeArtifactHash(artifact)).toString());
  assert.equal(config.tier,'checkpointed');assert.equal(config.scope,f.input.account.address);
  assert.deepEqual(config.network,{chainId:31337,version:1,rollup:eth(11)});
  if(f.state.waitCold)await f.state.waitCold;
  return structuredClone(receipt);
 };
}
test('cold recovery starts under the account lease without signing capsule or ordinary event discovery',async()=>{
 const f=await sessionFixture();installColdMailbox(f);const session=await createRollingWalletSession(f.input);
 assert(!f.state.events.includes('signing-capsule'));
 f.pxe.getPrivateEvents=async()=>{throw Error('Unbounded event discovery forbidden');};
 const start=f.state.events.length,result=await session.application.readColdPreferences();
 assert.equal(result.status,'recovering');assert.equal(result.complete,false);assert.equal(result.progress.nextBlock,1);
 const events=f.state.events.slice(start);assert.equal(events.filter(x=>x==='lock').length,1);assert.equal(events.filter(x=>x==='unlock').length,1);
 assert(!events.includes('signing-capsule'));assert(!events.includes('preference-head'));assert.equal(f.state.sends,0);
 await session.application.ownedIdentities();assert.equal(f.state.events.filter(x=>x==='signing-capsule').length,1);
 await session.application.readAccountStatus();assert.equal(f.state.events.filter(x=>x==='signing-capsule').length,1);await session.close();
});
test('missing cold extension rejects without using the ordinary preference reader',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);
 await assert.rejects(session.application.readColdPreferences(),{code:'ROLLING_COLD_PREFERENCES_INVALID'});
 assert(!f.state.events.includes('signing-capsule'));assert(!f.state.events.includes('preference-events'));assert.equal(f.state.sends,0);await session.close();
});
test('cold cancellation or account change retains the lock until the original PXE operation settles',async()=>{
 for(const mode of ['abort','account']){
  const f=await sessionFixture();installColdMailbox(f);const session=await createRollingWalletSession(f.input);let release;
  f.state.waitCold=new Promise(resolve=>release=resolve);const controller=new AbortController();
  const pending=session.application.readColdPreferences({signal:controller.signal}),observed=assert.rejects(pending,{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
  const deadline=Date.now()+2000;while(!f.state.events.includes('cold-mailbox')){assert(Date.now()<deadline);await new Promise(r=>setTimeout(r,1));}
  if(mode==='abort')controller.abort();else f.input.account.secretKey=hex(99);
  assert(session.busy&&f.state.active);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});
  await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});
  release();await observed;assert(!session.busy&&!f.state.active);assert.equal(f.state.sends,0);await session.close();
 }
});

// Labelled SDK/node failures at every constructor boundary; no live chain.
import {ROLLING_SESSION_STAGES} from './wallet-session.mjs';
import {projectRollingInitialization} from './wallet-panel.mjs';
const diagnosticSessionFailures={
 'account-lock':(f,error)=>{f.input.locks.request=async()=>{throw error;};},
 'trusted-node':(f,error)=>{f.input.sdk.createTrustedPrivateNode=async()=>{throw error;};},
 deployment:(f,error)=>{f.input.sdk.inspectTrustedNode=async()=>{throw error;};},
 'account-derive':(f,error)=>{f.input.sdk.deriveKeys=async()=>{throw error;};},
 'store-open':(f,error)=>{f.input.sdk.openPXEStore=async()=>{throw error;};},
 'pxe-create':(f,error)=>{f.input.sdk.createPXE=async()=>{throw error;};},
 'account-register':(f,error)=>{f.input.sdk.computePartialAddress=async()=>{throw error;};},
 'contracts-register':(f,error)=>{f.pxe.registerContractClass=async()=>{throw error;};},
 'initial-sync':(f,error)=>{f.pxe.sync=async()=>{throw error;};},
 'journal-open':(f,error)=>{f.input.sdk.createBrowserJournalStorage=()=>{throw error;};},
 'wallet-bind':(f,error)=>{f.input.routing.createAztecWallet=()=>{throw error;};},
 'account-manager':(f,error)=>{f.input.sdk.AccountManager.create=async()=>{throw error;};},
 'application-bind':(f,error)=>{f.state.diagnosticFailure=error;},
};
for(const [step,inject]of Object.entries(diagnosticSessionFailures))test('labelled session diagnostic preserves failure and lease at '+step,async()=>{
 const f=await sessionFixture(),observed=[],original=Error('PRIVATE_SENTINEL'),guard=f.input.contextGuard;
 f.input.contextGuard=async()=>{if(f.state.diagnosticFailure)throw f.state.diagnosticFailure;return guard();};
 f.input.onProgress=record=>{observed.push(record);if(record.step===step&&record.deploymentStep===null&&record.state==='started')inject(f,original);};
 let rejected=false,caught;try{await createRollingWalletSession(f.input);}catch(error){rejected=true;caught=error;}
 assert(rejected);if(step==='deployment')assert.equal(caught.code,'ROLLING_DEPLOYMENT_INVALID');else assert.equal(caught,original);
 assert.deepEqual(observed.at(-1),{stage:'session-initialization',step,deploymentStep:step==='deployment'?'node-readiness':null,state:'failed',code:'unknown'});
 assert.equal(observed.filter(r=>r.state==='failed').length,1);assert(!JSON.stringify(observed).includes('PRIVATE_SENTINEL'));assert.equal(f.state.active,false);assert.equal(f.state.sends,0);
 if(['pxe-create','account-register','contracts-register','initial-sync','journal-open','wallet-bind','account-manager','application-bind'].includes(step))assert.equal(f.state.closes,1);
});
test('session diagnostic success is fixed and observer rejection cannot alter setup or cleanup',async()=>{
 const f=await sessionFixture(),observed=[];f.input.onProgress=record=>{observed.push(record);if(record.state==='started')throw Error('PRIVATE_SENTINEL');return Promise.reject(Error('PRIVATE_SENTINEL'));};
 const session=await createRollingWalletSession(f.input);
 assert.deepEqual(observed.filter(r=>r.deploymentStep===null&&r.state==='started').map(r=>r.step),ROLLING_SESSION_STAGES);
 assert.equal(observed.at(-1).step,'application-bind');assert.equal(observed.at(-1).state,'complete');assert(observed.every(Object.isFrozen));assert(observed.every(r=>projectRollingInitialization(r)!==null));await session.close();assert.equal(f.state.closes,1);
});
for(const reason of [undefined,null,false,0,''])test('session diagnostic preserves exact falsy rejection '+String(reason),async()=>{
 const f=await sessionFixture(),observed=[];f.input.sdk.createPXE=async()=>{throw reason;};f.input.onProgress=r=>{observed.push(r);return Promise.reject(Error('PRIVATE_SENTINEL'));};
 let failed=false,caught;try{await createRollingWalletSession(f.input);}catch(e){failed=true;caught=e;}
 assert(failed);assert.equal(caught,reason);assert.equal(observed.at(-1).step,'pxe-create');assert.equal(observed.at(-1).code,'unknown');assert.equal(f.state.closes,1);assert.equal(f.state.active,false);
});
test('session diagnostic does not hide account invalidation or invoke exception code accessors',async()=>{
 const f=await sessionFixture(),observed=[];f.input.onProgress=r=>{observed.push(r);if(r.step==='pxe-create'&&r.state==='started')f.input.account.salt='99';};
 await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(observed.at(-1).code,'ROLLING_CONTEXT_CHANGED');assert(!f.state.events.includes('create-pxe'));assert.equal(f.state.closes,1);
 const g=await sessionFixture();let reads=0;const original=Object.defineProperty(Error('PRIVATE_SENTINEL'),'code',{get(){reads++;throw Error('PRIVATE_SENTINEL');}});g.input.sdk.createTrustedPrivateNode=async()=>{throw original;};g.input.onProgress=r=>observed.push(r);
 await assert.rejects(createRollingWalletSession(g.input),e=>e===original);assert.equal(reads,0);assert.equal(observed.at(-1).code,'unknown');
});

for(const mode of [undefined,true,false])test(`native PXE configuration follows captured proof mode ${mode}`,async()=>{
 const f=await sessionFixture();if(mode!==undefined)f.input.proofsEnabled=mode;f.deploymentState.proofsEnabled=mode??true;
 const session=await createRollingWalletSession(f.input);
 try{assert.equal(f.state.trustedProofsEnabled,mode??true);assert.deepEqual(f.state.pxeConfig,{proverEnabled:mode??true,autoSync:false,syncChainTip:'checkpointed'});assert.equal(f.state.syncs,1);assert.equal(f.state.registrations,1);}
 finally{await session.close();}assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);
});
test('native PXE disabled configuration rejects nondevelopment networks before any SDK access',async()=>{
 for(const chainId of ['1','11155111','0',undefined]){const f=options();f.input.proofsEnabled=false;f.input.config.network.chainId=chainId;
  await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_SESSION_CONFIG'});assert.deepEqual(f.accesses,[]);}
});
test('native PXE configuration rejects nonboolean modes before any SDK access',async()=>{
 for(const mode of [null,'false','disabled',0,1,{},[]]){const f=options();f.input.proofsEnabled=mode;
  await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_SESSION_CONFIG'});assert.deepEqual(f.accesses,[]);}
});
test('native PXE configuration cannot change through caller mutation during initialization',async()=>{
 const f=await sessionFixture();f.input.proofsEnabled=false;f.deploymentState.proofsEnabled=false;
 const original=f.input.sdk.openPXEStore;f.input.sdk.openPXEStore=async(...args)=>{f.input.proofsEnabled=true;return original(...args);};
 const session=await createRollingWalletSession(f.input);try{assert.equal(f.state.pxeConfig.proverEnabled,false);assert.equal(f.state.trustedProofsEnabled,false);}finally{await session.close();}
});

import {verifyRollingBokCapability} from './wallet-session.mjs';
const bokArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url))));
async function bokCapabilityFixture(){
 const board=AztecAddress.fromBigIntUnsafe(4n),operator=AztecAddress.fromBigIntUnsafe(5n);
 const instance=await getContractInstanceFromInstantiationParams(bokArtifact,{salt:new Fr(6),deployer:operator,constructorArtifact:'init',constructorArgs:[board,operator,31337,1]});
 const config={contractAddress:String(instance.address),operatorAddress:String(operator),pluginId:hex(7)};
 const values=new Map(Object.entries({board:4n,operator:5n,l1_chain:31337n,version:1n}).map(([key,value])=>[String(BigInt(bokArtifact.storageLayout[key].slot)),new Fr(value)]));
 const state={reads:[],guards:0,inspections:0,instance,number:10,hash:hex(55)};
 const node={getBlockData:async which=>({blockHash:which==='checkpointed'?hex(55):state.hash,header:{globalVariables:{blockNumber:state.number}}}),
  getContract:async(_address,reference)=>{state.reads.push(reference);return state.instance;},
  getPublicStorageAt:async(reference,_address,slot)=>{state.reads.push(reference);return values.get(String(slot.toBigInt()));}};
 const input={sdk:{Fr,AztecAddress,getContractClassFromArtifact,computeContractAddressFromInstance,inspectTrustedNode:async(_node,options)=>{state.inspections++;assert.equal(options.proofsEnabled,false);}},
  node,config,artifact:bokArtifact,deployment:{board:{address:board},network:{chainId:'31337',version:'1',rollup:eth(1)},proofsEnabled:false},contextGuard:async()=>{state.guards++;}};
 return {state,values,input};
}
test('Bok capability uses original class and immutable public scope at one canonical checkpoint',async()=>{
 const f=await bokCapabilityFixture(),result=await verifyRollingBokCapability(f.input);
 assert.equal(String(result.address),f.input.config.contractAddress);assert.equal(String(result.operator),f.input.config.operatorAddress);assert.equal(result.artifact,bokArtifact);
 assert.equal(f.state.reads.length,5);assert(f.state.reads.every(row=>row.hash===hex(55)));assert.equal(f.state.inspections,1);assert(Object.isFrozen(result));
});
for(const field of ['board','operator','l1_chain','version'])test('Bok capability rejects mismatched '+field,async()=>{
 const f=await bokCapabilityFixture();f.values.set(String(BigInt(bokArtifact.storageLayout[field].slot)),new Fr(999));
 await assert.rejects(verifyRollingBokCapability(f.input),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
test('Bok capability rejects changed class, missing publication and canonical reorg',async()=>{
 for(const alter of [f=>f.state.instance={...f.state.instance,currentContractClassId:new Fr(99)},f=>f.state.instance=null,f=>f.state.hash=hex(56)]){
  const f=await bokCapabilityFixture();alter(f);await assert.rejects(verifyRollingBokCapability(f.input),{code:'ROLLING_DEPLOYMENT_INVALID'});
 }
});
test('Bok capability captures config before awaits and preserves account invalidation',async()=>{
 const f=await bokCapabilityFixture(),original=f.input.config.contractAddress;f.input.contextGuard=async()=>{f.input.config.contractAddress=hex(100);};
 assert.equal(String((await verifyRollingBokCapability(f.input)).address),original);
 const g=await bokCapabilityFixture(),failure=Error('account invalidated');g.input.contextGuard=async()=>{throw failure;};
 await assert.rejects(verifyRollingBokCapability(g.input),error=>error===failure);
});
test('Bok capability absent stays unavailable and rejects half configured scopes',async()=>{
 assert.equal(await verifyRollingBokCapability({}),undefined);
 await assert.rejects(verifyRollingBokCapability({artifact:bokArtifact}),{code:'ROLLING_SESSION_CONFIG'});
 const f=await bokCapabilityFixture();f.input.config={...f.input.config,token:'PRIVATE_SENTINEL'};
 await assert.rejects(verifyRollingBokCapability(f.input),{code:'ROLLING_SESSION_CONFIG'});assert.equal(f.state.reads.length,0);
});

import {createEncryptedJournalSlot} from '../../shared/journal-record.mjs';
import {Interface} from 'ethers';
async function aggregateSessionFixture(){
 const f=await sessionFixture(),b=await bokCapabilityFixture();
 b.values.set(String(BigInt(bokArtifact.storageLayout.board.slot)),Fr.fromString(String(f.board.address)));
 const getContract=f.node.getContract,getStorage=f.node.getPublicStorageAt;
 f.node.getContract=(address,...args)=>String(address)===b.input.config.contractAddress?b.state.instance:getContract(address,...args);
 f.node.getPublicStorageAt=(reference,address,slot)=>String(address)===b.input.config.contractAddress?b.values.get(String(slot.toBigInt())):getStorage(reference,address,slot);
 f.input.config.bok=b.input.config;f.input.bokArtifact=bokArtifact;f.input.sdk.createEncryptedJournalSlot=createEncryptedJournalSlot;
 const s=f.input.config.aggregateFunding={chainId:'31337',router:eth(80),routerCodeHash:hex(81),collateralPortal:f.input.config.board.portalAddress,feePortal:eth(82),bokPortal:eth(83),weth:eth(84),swapRouter:eth(85),feeToken:eth(86),bokToken:eth(87),privateFpc:f.input.config.privateFee.contractAddress,quoter:eth(88),quoterCodeHash:hex(89)};
 b.values.set(String(BigInt(bokArtifact.storageLayout.portal.slot)),new Fr(BigInt(s.bokPortal)));
 const prior=f.node.getL1ContractAddresses;f.node.getL1ContractAddresses=async()=>({...await prior(),feeJuicePortalAddress:s.feePortal});
 f.input.ethers={...f.input.ethers,Interface};const abi=new Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function active() view returns(bool)']);
 f.provider.call=async request=>{assert(f.state.active);const call=abi.parseTransaction(request),addresses=await f.node.getL1ContractAddresses();return abi.encodeFunctionResult(call.name,[{UNDERLYING:s.feeToken,token:s.bokToken,decimals:request.to===s.feeToken?18:6,escrow:b.input.config.contractAddress,version:1,chainId:31337,inbox:addresses.inboxAddress,outbox:addresses.outboxAddress,active:true}[call.name]]);};
 const expected=Error('Chosen wallet requested only after verified scope');let captures=0;
 f.input.captureFundingWallet=async()=>{assert(f.state.active);captures++;throw expected;};
 return {...f,b,scope:s,expected,captures:()=>captures};
}
test('aggregate configured session retains direct receipt recovery with an empty private aggregate slot and no funding wallet',async()=>{
 const f=await aggregateSessionFixture();f.input.sdk.prepareFundingClaim=async input=>{assert.equal(input.aggregateIntent,undefined);assert.equal(typeof await input.ethProvider.getCode(eth(22),20),'string');return {status:'waiting'};};
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10},hash:async()=>hex(55),state:{l1ToL2MessageTree:{root:new Fr(1)}}});
 const session=await createRollingWalletSession(f.input);try{
  const receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:eth(33),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44)};
  await assert.rejects(session.application.prepare({type:'claim-deposit',receipt}),{code:'ROLLING_FUNDING_NOT_READY'});assert.equal(f.captures(),0);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
for(const defect of ['none','bok-portal','fee-portal','token-decimals'])test('aggregate session validates canonical '+defect+' bindings before custody capture',async()=>{
 const f=await aggregateSessionFixture();
 if(defect==='bok-portal')f.b.values.set(String(BigInt(bokArtifact.storageLayout.portal.slot)),new Fr(999));
 if(defect==='fee-portal')f.node.getL1ContractAddresses=async()=>({rollupAddress:eth(11),inboxAddress:eth(33),outboxAddress:eth(44),feeJuicePortalAddress:eth(999)});
 if(defect==='token-decimals'){const original=f.provider.call;f.provider.call=async request=>request.to===f.scope.bokToken?'0x'+BigInt(18).toString(16).padStart(64,'0'):original(request);}
 const session=await createRollingWalletSession(f.input);try{
  await assert.rejects(session.funding.prepare({}),defect==='none'?error=>error===f.expected:{code:'ROLLING_SESSION_CONFIG'});assert.equal(f.captures(),defect==='none'?1:0);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
test('USDC session exposes only explicitly pinned relay capability and retains authenticated custody ordering',async()=>{
 const f=await aggregateSessionFixture();Object.assign(f.scope,{usdcRelayAddress:eth(90),usdcCodeHash:hex(91),usdcImplementation:eth(92),usdcImplementationCodeHash:hex(93),usdcDomain:{name:'USDC',version:'2'}});
 f.input.claimStore={save:async()=>{throw Error('must not reach storage before captured wallet');},load:async()=>null};f.input.fundingRelay={terms:async()=>{throw Error('must not query terms before wallet capture');}};
 const session=await createRollingWalletSession(f.input);try{
  assert.equal(session.funding.usdcAvailable,true);f.input.config.aggregateFunding.usdcRelayAddress=eth(99);
  await assert.rejects(session.funding.prepare({asset:'USDC',collateralWei:'1',feeAmount:'2',bokAmount:'3',collateralPoolFee:3000,feePoolFee:3000,slippageBps:100,privateFeeCap:'1000'}),error=>error===f.expected);assert.equal(f.captures(),1);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});

import {verifyRollingTopupScope} from './wallet-session.mjs';
for(const kind of ['private-fee','bok'])for(const defect of ['none','token','portal','canonical'])test(`direct ${kind} top-up scope checks ${defect} against canonical protocol bindings`,async()=>{
 const network={chainId:'31337',version:'1',rollup:eth(1)},privateFee=hex(2),portal=eth(3),token=eth(4),recipient=hex(5);
 const addresses={rollupAddress:network.rollup,feeJuicePortalAddress:portal,feeJuiceAddress:token,inboxAddress:eth(6),outboxAddress:eth(7)};
 const abi=new Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)','function token() view returns(address)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function active() view returns(bool)','function decimals() view returns(uint8)']);
 const node={getL1ContractAddresses:async()=>addresses,getBlockData:async()=>({header:{globalVariables:{blockNumber:10}},blockHash:hex(10)}),getPublicStorageAt:async()=>new Fr(BigInt(portal))};
 const provider={getBlock:async block=>({number:10,hash:block==='latest'||defect!=='canonical'?hex(10):hex(11)}),call:async({to,data,blockTag})=>{
  assert.equal(blockTag,10);const name=abi.parseTransaction({data}).name;const values={ROLLUP:network.rollup,UNDERLYING:token,VERSION:1,L2_TOKEN_ADDRESS:hex(9),token,escrow:recipient,version:1,chainId:31337,inbox:addresses.inboxAddress,outbox:addresses.outboxAddress,active:true,decimals:kind==='bok'?6:18};
  if(defect==='token'&&name==='decimals')values[name]=9;if(defect==='portal'&&['ROLLUP','escrow'].includes(name))values[name]=name==='ROLLUP'?eth(99):hex(99);return abi.encodeFunctionResult(name,[values[name]]);
 }};
 const input={sdk:{Fr,ProtocolContractAddress:{FeeJuice:hex(9)}},ethers:{Interface},node,provider,network,privateFee,bok:{address:recipient,artifact:{storageLayout:{portal:{slot:'1'}}}},kind,contextGuard:async()=>{}};
 if(defect==='none')assert.deepEqual(await verifyRollingTopupScope(input),{portal,token,recipient:kind==='bok'?recipient:privateFee});else await assert.rejects(verifyRollingTopupScope(input),{code:'ROLLING_SESSION_CONFIG'});
});

import {verifyRollingTopupClaim} from './wallet-session.mjs';
import {requireSuccessfulReceipt} from '../../shared/transaction-outcomes.mjs';
for(const defect of ['none','hash','status','execution','canonical','account'])test(`retained top-up claim canonical check ${defect}`,async()=>{
 const hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32),receipt={txHash:hash,status:'checkpointed',executionResult:'success',blockNumber:3,blockHash};let reads=0;
 if(defect==='hash')receipt.txHash='0x'+'33'.repeat(32);if(defect==='status')receipt.status='pending';if(defect==='execution')receipt.executionResult='reverted';
 const input={sdk:{TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn(),requireSuccessfulReceipt},node:{getTxReceipt:async()=>{reads++;return receipt;},getBlock:async number=>{assert.equal(number,3);reads++;return {hash:defect==='canonical'?'0x'+'44'.repeat(32):blockHash};}},txHash:hash,contextGuard:()=>{if(defect==='account')throw Error('account changed');}};
 if(defect==='none'){await verifyRollingTopupClaim(input);assert.equal(reads,2);}else{await assert.rejects(verifyRollingTopupClaim(input));if(defect==='account')assert.equal(reads,0);}
});

import {createCollateralWithdrawal} from './wallet-session.mjs';
import {createEthereumJournal} from '../../shared/ethereum-journal.mjs';
import {computeL2ToL1MessageHash} from '@aztec-labs/stdlib/hash';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {hexlify,AbiCoder,getBytes,encodeBytes32String} from 'ethers';
import {encodeEscrowCommitment} from '../../shared/protocol-commitments.mjs';
async function withdrawalFixture({chainId='31337',bok=false}={}){
 const scope={account:hex(3),chainId,version:'1',rollup:eth(11),board:hex(1),portal:eth(22)},record={intentId:hex(8),action:{type:'withdraw',deposit:hex(9)},status:'confirmed',txHash:hex(77),withdrawal:{eligible:true,amount:'100',depositor:eth(33)}};
 if(bok){record.action={type:'withdraw-bok',amount:'100',recipient:eth(33)};record.withdrawal={...record.withdrawal,kind:'bok',nonce:hex(55),bokScope:{portal:scope.portal,token:eth(66),recipient:scope.board}};}
 const content=sha256ToField([bok?Buffer.from(getBytes(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32','uint256','address','uint128','bytes32'],[encodeBytes32String('PLUGIN_EXIT_V1'),chainId,scope.portal,scope.board,1,eth(33),100,hex(55)]))):Buffer.from(encodeEscrowCommitment('exit',{l1ChainId:scope.chainId,rollupAddress:scope.rollup,rollupVersion:scope.version,boardAddress:scope.board,portalAddress:scope.portal},{amount:'100',depositor:eth(33)}))]);
 const leaf=computeL2ToL1MessageHash({l2Sender:new AztecAddress(new Fr(BigInt(scope.board))),l1Recipient:EthAddress.fromString(scope.portal),content,chainId:new Fr(BigInt(chainId)),rollupVersion:new Fr(1)});
 const state={sends:0,calls:0,guard:true,connected:eth(33),price:2n,settled:true,unknown:false,head:10,tx:null,receipt:null,fork:false};const values=new Map();
 const storage={read:async key=>values.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(values.get(key)??null,previous);if(next===null)values.delete(key);else values.set(key,next);}};
 const provider={getNetwork:async()=>({chainId:BigInt(chainId)}),getBlockNumber:async()=>state.head,getBlock:async n=>n==='finalized'?{number:state.finalized??state.head,hash:hex(state.finalized??state.head)}:({number:n==='latest'?state.head:n,hash:state.fork?hex(999):hex(n==='latest'?state.head:n),parentHash:hex(Number(n==='latest'?state.head:n)-1),prefetchedTransactions:state.tx?[state.tx]:[]}),getTransactionCount:async()=>state.tx?1:0,getTransaction:async h=>state.tx?.hash===h?state.tx:null,getTransactionReceipt:async h=>state.receipt?.hash===h?state.receipt:null,waitForTransaction:async()=>state.receipt,estimateGas:async()=>100n,getFeeData:async()=>({gasPrice:state.price}),call:async()=>{state.calls++;if(!state.settled)throw Error('Outbox not settled');return '0x';}};
 const node={getTxReceipt:async()=>({txHash:record.txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:hex(42)}),getTxEffect:async()=>({l2BlockNumber:1,l2BlockHash:hex(42),data:{l2ToL1Msgs:[leaf]}}),getBlockData:async()=>({header:{globalVariables:{blockNumber:1}},blockHash:state.l2Fork?hex(99):hex(42)}),getL2ToL1MembershipWitness:async()=>({epochNumber:1,numCheckpointsInEpoch:1,leafIndex:0n,siblingPath:{toBufferArray:()=>[]}})};
 const abi=new Interface([bok?'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)':'event Withdrawn(address indexed depositor,uint128 amount)']);
 const signer={getAddress:async()=>state.connected,sendTransaction:async request=>{state.sends++;state.head++;state.tx={...request,hash:hex(88)};state.receipt={hash:hex(88),from:eth(33),to:scope.portal,status:1,gasUsed:100n,gasPrice:2n,blockNumber:state.head,blockHash:hex(state.head),logs:[{address:scope.portal,...abi.encodeEventLog(abi.getEvent('Withdrawn'),[eth(33),100n,...(bok?[hex(55)]:[])])}]};if(state.unknown)throw Error('lost response');return state.tx;}};
 const opts={sdk:{createEthereumJournal,Fr,AztecAddress,EthAddress,TxHash,computeL2ToL1MessageHash,sha256ToField,boundedTransactionRead:fn=>fn()},ethers:{Interface,hexlify,AbiCoder,getBytes,encodeBytes32String},resolveBokScope:async()=>({portal:scope.portal,token:eth(66),recipient:scope.board}),provider,node,application:{readWithdrawal:async()=>record},scope,storage,walletSecret:hex(8),walletSalt:hex(9),contextGuard:async()=>{assert(state.guard);},captureWallet:async()=>({address:state.connected,chainId,name:'Development wallet',signer,guard:async()=>{assert(state.guard&&state.connected===eth(33));}})};
 return {state,record,opts,values,cap:createCollateralWithdrawal(opts),restart:()=>createCollateralWithdrawal(opts)};
}
test('RC22 collateral refund uses actual encrypted Ethereum journal, exact original depositor and one explicit send',async()=>{
 const f=await withdrawalFixture();const review=await f.cap.prepare({maximumGasWei:'1000'});assert.equal(review.amount,'100');assert.equal(review.estimatedGasWei,'400');assert.equal(f.state.sends,0);
 const result=await f.cap.confirm();assert.equal(result.status,'refunded');assert.equal(result.gasCostWei,'200');assert.equal(f.state.sends,1);assert.equal(f.state.tx.value,0n);
 assert.equal(await f.restart().verify(f.record),true);assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
 await assert.rejects(f.restart().prepare({maximumGasWei:'1000'}));assert.equal(f.state.sends,1);
 assert([...f.values.values()].every(v=>!v.includes(f.record.withdrawal.depositor)));
});
test('RC22 lost refund response recovers read-only across reopen without another send',async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});f.state.unknown=true;
 await assert.rejects(f.cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.equal(f.state.sends,1);
 assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
});
// W03 current Rolling consumer coverage. Ethereum/Aztec responses are doubles;
// the withdrawal capability and authenticated encrypted journal are production code.
// Unlike the short fixture, this history includes the transaction only at its
// canonical mined height. No caller supplies the lost Ethereum transaction hash.
for(const bok of [false,true])for(const mode of ['lost-response','interrupted','reorg'])test(`W03 ${bok?'Bok':'collateral'} refund recovers ${mode} beyond 500 blocks without a second send (doubles)`,async()=>{
 const f=await withdrawalFixture({bok}),reads=[],originalBlock=f.opts.provider.getBlock,capture=f.opts.captureWallet;
 let failAt=null,reorgAt=null;
 const blockHash=n=>hex(reorgAt!==null&&n>=reorgAt?10000+n:n);
 f.opts.provider.getBlock=async(n,full=false)=>{
  const number=n==='latest'?f.state.head:n;
  if(full){reads.push(number);if(number===failAt)throw Error('interrupted history read');}
  const block=await originalBlock(n);
  return {...block,hash:blockHash(block.number),parentHash:blockHash(block.number-1),
   prefetchedTransactions:f.state.tx&&f.state.receipt.blockNumber===block.number?[f.state.tx]:[]};
 };
 f.opts.captureWallet=async()=>{
  const wallet=await capture();return {...wallet,signer:{...wallet.signer,sendTransaction:async request=>{
   // The request is saved at block 10, then mined at 711 before its response is lost.
   f.state.head=710;return wallet.signer.sendTransaction(request);
  }}};
 };
 const names=['account','chainId','rollup','version','board','portal','depositor',...(bok?['token']:[])];
 const scope={...f.opts.scope,depositor:f.record.withdrawal.depositor,...(bok?{token:f.record.withdrawal.bokScope.token}:{})};
 const journal=await createEncryptedJournalSlot({storage:f.opts.storage,walletSecret:f.opts.walletSecret,walletSalt:f.opts.walletSalt,
  scopeText:JSON.stringify(['AZTEC_BB_ETH_JOURNAL_V1',...names.map(name=>scope[name])]),keyDomain:'AZTEC_BB_ETH_JOURNAL_KEY_V1'});
 const originalWorkflow=structuredClone(f.record),cap=f.restart();
 await cap.prepare({maximumGasWei:'1000'});f.state.unknown=true;
 await assert.rejects(cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
 const saved=(await journal.read()).value;
 assert.equal(saved.startBlock,10);assert.equal(saved.nextBlock,11);assert.equal(saved.txHash,null);assert.equal(f.state.sends,1);
 f.state.head=1110;
 if(mode!=='lost-response'){
  failAt=541;await assert.rejects(f.restart().recover(),{code:'BB_ETH_RECOVERY_REQUIRED'});
  assert.equal(reads[0],11);assert.equal(reads.at(-1),541);
  const interrupted=(await journal.read()).value;
  assert.equal(interrupted.nextBlock,541);assert.equal(interrupted.cursorHash,hex(540));assert.equal(interrupted.txHash,null);
  assert.equal(f.state.sends,1);reads.length=0;failAt=null;
  if(mode==='reorg'){
   // The already-sent transaction is included earlier in the replacement fork.
   // The old checkpoint must not skip that inclusion or trigger a new payment.
   reorgAt=501;f.state.receipt.blockNumber=520;f.state.receipt.blockHash=blockHash(520);
  }
 }
 const result=await f.restart().recover();
 assert.deepEqual(result,{status:'refunded',txHash:hex(88),amount:'100',gasCostWei:'200'});
 assert.equal(reads[0],mode==='reorg'?1:mode==='interrupted'?541:11);
 assert.equal(reads.at(-1),mode==='reorg'?520:711);
 assert.deepEqual(reads,Array.from({length:reads.at(-1)-reads[0]+1},(_,i)=>reads[0]+i));
 assert.equal((await journal.read()).value.txHash,hex(88));assert.equal(f.state.sends,1);
 assert.deepEqual(f.record,originalWorkflow);assert.equal(await f.restart().verify(f.record),true);
 await assert.rejects(f.restart().prepare({maximumGasWei:'1000'}),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 assert.equal(f.state.sends,1);
});
for(const change of ['wallet','chain-anchor','gas','settlement','cancel'])test(`RC22 refund ${change} change never reaches a send`,async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});
 if(change==='wallet')f.state.connected=eth(44);if(change==='chain-anchor')f.state.l2Fork=true;if(change==='gas')f.state.price=100n;if(change==='settlement')f.state.settled=false;if(change==='cancel')f.cap.cancel();
 await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});
test('RC22 refund receipt reorg cannot unlock workflow or authorize another payment',async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});await f.cap.confirm();f.state.fork=true;
 await assert.rejects(f.restart().verify(f.record));assert.equal(f.state.sends,1);
});
test('RC22 timeout retains ownership of the original provider read before returning failure',async()=>{
 const f=await withdrawalFixture(),original=Error('bounded read timeout');let release,started;const began=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
 f.opts.provider.getNetwork=async()=>{started();await held;return {chainId:31337n};};f.opts.sdk.boundedTransactionRead=async fn=>Promise.race([fn(),began.then(()=>{throw original;})]);
 let settled=false;const result=f.restart().prepare({maximumGasWei:'1000'}).catch(error=>{assert.equal(error,original);settled=true;});
 await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await result;assert.equal(settled,true);assert.equal(f.state.sends,0);
});
test('RC22 testnet refund waits for finalized Ethereum inclusion and resumes without another send',async()=>{
 const f=await withdrawalFixture({chainId:'11155111'});await f.cap.prepare({maximumGasWei:'1000'});f.state.finalized=9;
 await assert.rejects(f.cap.confirm(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);
 await assert.rejects(f.restart().verify(f.record),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 f.state.finalized=f.state.head;assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
});

for(const phase of ['lock','context','pxe-sync','account-initialize','method'])test('refresh diagnostic preserves exact failure at '+phase,async()=>{
 const f=await sessionFixture(),rows=[],original=Object.assign(Error('PRIVATE_REFRESH_SENTINEL'),{code:'PRIVATE_FEE_CAP_TOO_LOW'});
 f.input.onProgress=row=>{rows.push(row);};const session=await createRollingWalletSession(f.input);rows.length=0;
 if(phase==='lock')f.input.locks.request=async()=>{throw original;};
 if(phase==='context')f.input.sdk.isPrivatePXEForNode=()=>{throw original;};
 if(phase==='pxe-sync')f.pxe.sync=async()=>{throw original;};
 if(phase==='account-initialize')f.input.sdk.ContractFunctionInteraction=class{async simulate(){throw original;}};
 if(phase==='method')f.input.sdk.preparePrivateFeePayment=async()=>{throw original;};
 // The production application captures SDK capabilities at construction.
 if(phase==='method'){
  await session.close();const again=await createRollingWalletSession(f.input);rows.length=0;
  await assert.rejects(again.application.readAccountStatus(),e=>e===original);await again.close();
 }else{await assert.rejects(session.application.readAccountStatus(),e=>e===original);if(phase==='lock')f.input.locks.request=async(_n,_o,fn)=>{f.state.active=true;try{return await fn({});}finally{f.state.active=false;}};await session.close();}
 const failed=rows.filter(r=>r.stage==='private-refresh'&&r.state==='failed');assert.equal(failed.length,1);assert.equal(failed[0].step,'account-status/'+phase);assert.equal(failed[0].code,'PRIVATE_FEE_CAP_TOO_LOW');assert(rows.every(r=>projectRollingInitialization(r)));assert(!JSON.stringify(rows).includes('PRIVATE_REFRESH_SENTINEL'));assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
});
for(const [method,label]of [['readAccountStatus','account-status'],['ownedIdentities','owned-names'],['readModeratorStatus','moderator-status'],['readBokStatus','bok-status']])test('refresh diagnostic scopes actual method '+method,async()=>{
 const f=await sessionFixture(),rows=[];f.input.onProgress=r=>rows.push(r);const session=await createRollingWalletSession(f.input);f.pxe.sync=async()=>{throw false;};rows.length=0;
 let caught=true;try{await session.application[method]();}catch(error){caught=error;}assert.equal(caught,false);
 assert.deepEqual(rows.at(-1),{stage:'private-refresh',step:label+'/pxe-sync',deploymentStep:null,state:'failed',code:'unknown'});await session.close();
});
test('refresh diagnostic observer failure cannot mask zero balance or inspect private exception getters',async()=>{
 const f=await sessionFixture(),rows=[];f.input.sdk.preparePrivateFeePayment=async()=>{throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'PRIVATE_FEE_BALANCE_INSUFFICIENT'});};
 f.input.onProgress=row=>{rows.push(row);if(row.state==='started')throw Error('OBSERVER');return Promise.reject(Error('OBSERVER'));};
 const session=await createRollingWalletSession(f.input);assert.deepEqual(await session.application.readAccountStatus(),{status:'fee-needed'});assert.equal(rows.at(-1).state,'complete');assert.equal(rows.filter(r=>r.stage==='private-refresh'&&r.step==='account-status/method'&&r.state==='started').length,1);
 let accessed=0;const original=Object.defineProperty({},'code',{get(){accessed++;throw Error('PRIVATE_SENTINEL');}});f.pxe.sync=async()=>{throw original;};
 await assert.rejects(session.application.readAccountStatus(),e=>e===original);assert.equal(accessed,0);assert.equal(rows.at(-1).code,'unknown');assert(!JSON.stringify(rows).includes('PRIVATE_SENTINEL'));await session.close();
});
test('refresh diagnostic projection rejects unknown steps, private codes and accessor values',()=>{
 const row={stage:'private-refresh',step:'account-status/method',deploymentStep:null,state:'failed',code:'PRIVATE_FEE_PREPARATION_FAILED'};
 assert.deepEqual(projectRollingInitialization(row),row);assert.equal(projectRollingInitialization({...row,step:'PRIVATE_ADDRESS'}),null);assert.equal(projectRollingInitialization({...row,code:'PRIVATE_SENTINEL'}),null);assert.equal(projectRollingInitialization({...row,deploymentStep:'config'}),null);
 let read=false;const hostile={...row};Object.defineProperty(hostile,'code',{get(){read=true;throw Error('private');}});assert.equal(projectRollingInitialization(hostile),null);assert.equal(read,false);
});

test('claim progress session forwards existing funding callback under the account lock without payment or send',async()=>{
 const f=await aggregateSessionFixture(),rows=[];f.input.onProgress=row=>rows.push(row);const session=await createRollingWalletSession(f.input);rows.length=0;
 await assert.rejects(session.funding.advanceClaim(),{code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});
 assert.deepEqual(rows.at(-1),{stage:'funding-claim',step:'inspect',deploymentStep:null,state:'failed',code:'ROLLING_FUNDING_RECOVERY_REQUIRED'});assert(rows.every(r=>projectRollingInitialization(r)));assert.equal(f.state.sends,0);assert.equal(f.captures(),0);assert.equal(f.state.active,false);await session.close();
});
test('claim progress DOM projection accepts only closed step and error vocabulary with five own data fields',()=>{
 const row={stage:'funding-claim',step:'prepare',deploymentStep:null,state:'failed',code:'ROLLING_FUNDING_UNKNOWN'};assert.deepEqual(projectRollingInitialization(row),row);
 for(const patch of [{step:'PRIVATE_SENTINEL'},{code:'PRIVATE_SENTINEL'},{deploymentStep:'config'},{state:'private'},{extra:'PRIVATE_SENTINEL'}])assert.equal(projectRollingInitialization({...row,...patch}),null);
 const hostile={...row};Object.defineProperty(hostile,'code',{get(){throw Error('PRIVATE_SENTINEL');}});assert.equal(projectRollingInitialization(hostile),null);
 assert.equal(projectRollingInitialization({...row,state:'started',code:null}).code,null);
});
import {createUniformBokAccountingReader} from './wallet-session.mjs';
test('RC22 Bok accounting fetch uses only fixed same-origin uniform pages',async()=>{
 const calls=[],reader=createUniformBokAccountingReader({origin:'https://board.invalid',fetcher:async(...args)=>{calls.push(args);return new Response(JSON.stringify({complete:true}));}});
 assert.deepEqual(await reader({limit:50,cursor:null}),{complete:true});await reader({limit:50,cursor:'a'.repeat(32)+':'+hex(12).slice(2)+':'+'b'.repeat(16)});
 assert.deepEqual(calls.map(([url])=>url),['https://board.invalid/api/bok-accounting?limit=50','https://board.invalid/api/bok-accounting?limit=50&cursor='+encodeURIComponent('a'.repeat(32)+':'+hex(12).slice(2)+':'+'b'.repeat(16))]);
 for(const [,options]of calls){assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);}
 for(const cursor of ['https://evil.invalid','x&owner=secret',{},''])await assert.rejects(reader({limit:50,cursor}));await assert.rejects(reader({limit:100,cursor:null}));assert.equal(calls.length,2);
});
for(const mode of ['status','oversize','utf8','json','read-falsy'])test('RC22 Bok accounting rejects '+mode+' without publishing partial data',async()=>{
 let cancelled=0,released=0;
 const fetcher=async()=>mode==='read-falsy'?{ok:true,body:{getReader:()=>({read:async()=>{throw null;},cancel:async()=>{cancelled++;throw Error('cleanup');},releaseLock(){released++;}})}}:new Response(mode==='oversize'?new Uint8Array(1048577):mode==='utf8'?new Uint8Array([255]):'{',{status:mode==='status'?503:200});
 const read=createUniformBokAccountingReader({origin:'https://board.invalid',fetcher});
 if(mode==='read-falsy'){let caught=false;try{await read({limit:50,cursor:null});}catch(error){caught=true;assert.equal(error,null);}assert(caught);assert.equal(cancelled,1);assert.equal(released,1);}else await assert.rejects(read({limit:50,cursor:null}));
});
test('RC22 Bok refund authenticates actual PluginPortal leaf and encrypted token journal across reopen',async()=>{
 const f=await withdrawalFixture({bok:true});const review=await f.cap.prepare({maximumGasWei:'1000'});assert.equal(review.amount,'100');assert.equal(f.state.sends,0);
 const result=await f.cap.confirm();assert.equal(result.status,'refunded');assert.equal(f.state.sends,1);assert.equal(f.state.tx.value,0n);
 const decoded=new Interface(['function withdraw(address recipient,uint128 amount,bytes32 nonce,uint256 epoch,uint256 checkpoints,uint256 index,bytes32[] path)']).decodeFunctionData('withdraw',f.state.tx.data);
 assert.equal(decoded.recipient,eth(33));assert.equal(decoded.amount,100n);assert.equal(decoded.nonce,hex(55));
 assert.equal(await f.restart().verify(f.record),true);assert.equal((await f.restart().recover()).status,'refunded');await assert.rejects(f.restart().prepare({maximumGasWei:'1000'}));assert.equal(f.state.sends,1);
});
test('RC22 Bok refund unknown response is reconciled without another send',async()=>{
 const f=await withdrawalFixture({bok:true});await f.cap.prepare({maximumGasWei:'1000'});f.state.unknown=true;await assert.rejects(f.cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
});
for(const change of ['wallet','scope','kind','nonce','l2-fork','gas','settlement','cancel'])test('RC22 Bok refund rejects '+change+' before signing',async()=>{
 const f=await withdrawalFixture({bok:true});await f.cap.prepare({maximumGasWei:'1000'});
 if(change==='wallet')f.state.connected=eth(44);if(change==='scope')f.record.withdrawal.bokScope.token=eth(99);if(change==='kind')f.record.action.type='withdraw';if(change==='nonce')f.record.withdrawal.nonce=hex(0);if(change==='l2-fork')f.state.l2Fork=true;if(change==='gas')f.state.price=100n;if(change==='settlement')f.state.settled=false;if(change==='cancel')f.cap.cancel();
 await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});
test('RC22 Bok refund finalized receipt remains necessary after an explicit send',async()=>{
 const f=await withdrawalFixture({bok:true,chainId:'11155111'});await f.cap.prepare({maximumGasWei:'1000'});f.state.finalized=9;await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,1);
 f.state.finalized=f.state.head;assert.equal(await f.restart().verify(f.record),true);f.state.fork=true;await assert.rejects(f.restart().recover());assert.equal(f.state.sends,1);
});

test('RC22 expiry selection passes through existing session synchronization and refuses absent owned accounting before send',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);const before=f.state.syncs;
 await assert.rejects(session.application.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});
 assert.equal(f.state.syncs,before+1);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
 await session.close();await assert.rejects(session.application.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);
});

// Session wiring regression: canonical L2 outcome is a double; journal key
// derivation, authentication and retained workflow storage use real crypto.
test('confirmed withdrawal session opens the real refund journal with captured primitive credentials',async()=>{
 const f=await sessionFixture(),id=hex(301),txHash=hex(302),calls=[];
 const scope={account:f.input.account.address,chainId:'31337',version:'1',rollup:f.input.config.network.rollupAddress,board:f.input.config.board.contractAddress,portal:f.input.config.board.portalAddress};
 const workflow=await createEncryptedJournalSlot({storage:f.privateStore,walletSecret:f.input.account.secretKey,walletSalt:f.input.account.salt,
  scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
 const record={id,action:{type:'withdraw',deposit:hex(303)},status:'confirmed',txHash,maximumFee:'10',nonce:hex(304),withdrawal:{eligible:true,amount:'100',depositor:eth(33)}};
 await workflow.write(await workflow.read(),record);
 f.input.sdk.createL2Journal=async()=>({inspectOutcome:async()=>({operation:'ROLLING_WORKFLOW_V1:'+id,txHash,outcome:'success',receipt:{txHash,transactionFee:1n}}),confirmed:()=>{}});
 f.input.sdk.boundedTransactionRead=fn=>fn();
 f.input.sdk.createEthereumJournal=async options=>{calls.push(options);return createEthereumJournal(options);};
 const session=await createRollingWalletSession(f.input);
 try{
  const result=await session.application.readAccountStatus();
  assert.equal(result.status,'recovering');assert.equal(result.intent.txHash,txHash);
  assert.equal(calls.length,1);assert.equal(calls[0].walletSecret,f.input.account.secretKey);assert.equal(calls[0].walletSalt,f.input.account.salt);
  assert.equal((await workflow.read()).value.txHash,txHash);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});

// Compose the real custody adapter with the withdrawal capability. The node and
// EIP1193 replies remain explicit doubles; no real wallet transaction occurs.
import {captureRollingFundingWallet} from './wallet-runtime.mjs';
for(const bok of [false,true])test(`actual custody runtime prepares original ${bok?'Bok':'collateral'} refund and rejects chain changes`,async()=>{
 const f=await withdrawalFixture({bok}),captured=await f.opts.captureWallet();let chain='0x7a69';
 const state={ethSigner:captured.signer,ethProvider:{},ethTransport:{request:async({method})=>{assert.equal(method,'eth_chainId');return chain;}},ethAccount:captured.address,ethWalletName:'MetaMask'};
 f.opts.captureWallet=()=>captureRollingFundingWallet({getState:()=>state,contextGuard:f.opts.contextGuard,chainId:f.opts.scope.chainId});
 const cap=createCollateralWithdrawal(f.opts),quote=await cap.prepare({maximumGasWei:'1000'});
 assert.equal(quote.recipient,captured.address);assert.equal(quote.estimatedGasWei,'400');assert.equal(f.state.sends,0);
 chain='0x1';await assert.rejects(cap.confirm(),{code:'ROLLING_RUNTIME_UNAVAILABLE'});assert.equal(f.state.sends,0);
});

test('positive pre-proof lifecycle capability stays inside the account lease until original proof settles',async()=>{
 const f=await sessionFixture();let release,entered,created=0;
 const started=new Promise(resolve=>entered=resolve),proof=new Promise(resolve=>release=resolve);
 f.input.routing.createPreproofRecovery=(wallet,node,journal)=>{
  created++;assert(f.state.active);assert.equal(wallet,f.wallet);assert.equal(node,f.node);
  return Object.freeze({checkpoint:async()=>{assert(f.state.active);const saved=await journal.assertCanStart();return {encoded:saved.encoded};},send:async(_payload,_options,lifecycle)=>{
   assert(f.state.active);await lifecycle.guard('pre-proof');entered();await proof;assert(f.state.active);await lifecycle.guard('pre-proof');throw Error('controlled proof interruption');
  }});
 };
 const session=await createRollingWalletSession(f.input);assert.equal(created,1);
 const prepared=await session.application.prepare({type:'name',first:'Fresh',last:'Willow'});
 const pending=session.application.submitPrepared(prepared.intentId);await started;
 assert.equal(session.busy,true);assert.equal(f.state.active,true);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});
 await assert.rejects(session.application.prepareInterrupted(prepared.intentId),{code:'ROLLING_BUSY'});
 release();await assert.rejects(pending,/controlled proof interruption/);assert.equal(session.busy,false);assert.equal(f.state.active,false);
 assert.equal((await session.application.inspectRecovery(prepared.intentId)).status,'pre-proof-review');
 const review=await session.application.prepareInterrupted(prepared.intentId);assert.equal(review.status,'prepared');assert.equal(f.state.sends,0);await session.close();
});
test('positive pre-proof capability creation failure closes initialization without exposing an application',async()=>{
 const f=await sessionFixture();f.input.routing.createPreproofRecovery=()=>{throw Error('invalid built-in capability');};
 await assert.rejects(createRollingWalletSession(f.input),/invalid built-in capability/);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);assert.equal(f.state.stops,1);
});
