import {createPendingWithdrawalSlot} from '../../shared/rolling/application.mjs';
// Negative custody boundaries: no SDK/network work may precede the account lock
// and the caller's current-account guard. These are synthetic unit checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingWalletSession,createRollingRefundSession,observeIncludedTransaction} from './wallet-session.mjs';
function options(){
 const accesses=[];return {accesses,input:{sdk:new Proxy({},{get(_target,key){accesses.push(key);throw Error('Unexpected SDK access');}}),
  routing:{},ethers:{},config:{network:{chainId:31337,rollupVersion:1,rollupAddress:'0x'+'1'.repeat(40)}},
  boardArtifact:{},privateFeeArtifact:{},account:{address:'0x'+'2'.repeat(64),secretKey:'0x'+'3'.repeat(64),salt:'0'},
  trustedQuery:{url:'http://127.0.0.1:1',allowLocalDev:true},contextGuard:()=>{},locks:{request:async(_name,_options,fn)=>fn({})}}};
}
for(const failure of [false,true])test('generic Board state preparation holds native account lease before action, failure='+failure,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();f.state.waitBoardState=gate.promise;f.state.failBoardState=failure;
 const session=await createRollingWalletSession(f.input),original=f.pxe.prepareBoardActionState;
 f.pxe.prepareBoardActionState=async targets=>{entered.resolve();return original(targets);};
 let done=false;const work=session.application.prepare({type:'name',first:'Fresh',last:'Willow'}).finally(()=>done=true),observed=failure?assert.rejects(work,/board state failed/):work;
 await entered.promise;assert.equal(done,false);assert.equal(f.state.active,true);assert.equal(f.state.boardStateMethod,'register_name');gate.resolve();await observed;assert.equal(f.state.active,false);await session.close();
});

test('predecessor anchor reuse is confined to the held discovery barrier',async()=>{
 const f=await sessionFixture();let accessor,reads=0,current=10;
 f.input.sdk.createL2Journal=async options=>{accessor=options.predecessorAnchor;return createL2Journal(options);};
 f.pxe.getSyncedBlockHeader=async()=>{assert(f.state.active);reads++;return {globalVariables:{blockNumber:current},hash:async()=>BlockHash.fromString(hex(55))};};
 const original=f.pxe.prepareBoardActionState;
 f.pxe.prepareBoardActionState=async targets=>{
  const before=reads;assert.equal((await accessor()).globalVariables.blockNumber,10);assert.equal(reads,before,'discovery must not queue a second header read');return original(targets);
 };
 const session=await createRollingWalletSession(f.input);
 try{
  await session.application.prepare({type:'name',first:'Fresh',last:'Willow'},{immediate:true});
  current=11;const before=reads;
  await f.input.locks.request('billboard-wallet:'+f.input.account.address,{ifAvailable:true},async()=>assert.equal((await accessor()).globalVariables.blockNumber,11));
  assert.equal(reads,before+1,'after the barrier the accessor must read the current native header');
 }finally{await session.close();}
});

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
test('query construction receives captured scope and rejects without fallback',async()=>{
 const {input}=options(),f=await deploymentFixture(),original=Object.assign(Error('Trusted service unavailable'),{code:'BB_TRUSTED_NODE_UNAVAILABLE'});let calls=0,privateReads=0,released=false;const diagnostics=[];
 Object.assign(input,f.options);input.onProgress=value=>diagnostics.push(value);
 input.locks={request:async(_name,_config,fn)=>{try{return await fn({});}finally{released=true;}}};
 input.sdk={...f.options.sdk,createTrustedPrivateNode:async value=>{calls++;const {onReady,...captured}=value;assert.equal(typeof onReady,'function');assert.deepEqual(captured,{url:'http://127.0.0.1:1',allowLocalDev:true,
  expectedNetworkScope:{chainId:'31337',version:'1',rollup:f.options.config.network.rollupAddress},proofsEnabled:true,readinessTier:'checkpointed'});throw original;},
  openPXEStore:async()=>{privateReads++;throw Error('Unexpected store access');},createPXE:async()=>{privateReads++;throw Error('Unexpected PXE access');}};
 await assert.rejects(createRollingWalletSession(input),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(calls,1);assert.equal(privateReads,0);assert.equal(released,true);
 assert(diagnostics.some(value=>value.state==='failed'&&value.deploymentStep==='node-readiness'&&value.code===original.code));
});

import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact,decodeFromAbi,getFunctionReturnType,EventSelector,decodeFunctionSignature} from '@aztec-labs/stdlib/abi';
import {poseidon2Hash,poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {nameRegistration,NAME_DOMAIN} from '../../shared/rolling/name-policy.mjs';
import {computeArtifactHash,getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {ordinaryPostFeeLimit} from '../../shared/ordinary-post-fees.mjs';
import {derivePrivateFeeInstance,normalizePrivateFeeGasSettings} from '../../shared/private-fee-client.mjs';
import {expectedPortalRuntime,verifyPortalRuntime} from '../../shared/portal-runtime.mjs';
import {encodeConfigCommitment} from '../../shared/protocol-commitments.mjs';
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const feeArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../src/billboard/private_fee_artifact.json',import.meta.url))));
const metadata=JSON.parse(fs.readFileSync(new URL('../../shared/portal-runtime.json',import.meta.url)));
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),eth=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');

async function deploymentFixture({chainId='31337'}={}){
 const deployer=AztecAddress.fromBigIntUnsafe(3n),rollup=eth(11),portal=eth(22);
 const board=await getContractInstanceFromInstantiationParams(artifact,{salt:new Fr(7),deployer,constructorArtifact:'init',constructorArgs:[Array(32).fill(0n),0,Number(chainId),rollup,1,100,200,60,2,120,3]});
 const fee=await derivePrivateFeeInstance(feeArtifact),state={destroyed:0,guards:0,reads:[],ethReads:[],inspection:0,enabled:true};
 const config={network:{chainId,rollupVersion:'1',rollupAddress:rollup,nodeUrl:'http://127.0.0.1:1',ethRpcUrl:'http://127.0.0.1:2'},
  board:{contractAddress:String(board.address),portalAddress:portal},privateFee:{contractAddress:String(fee.address),gasSettings:{gasLimits:{daGas:'1000',l2Gas:'1000'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
 const economics={minDeposit:'100',maxDeposit:'200',baseCooldown:'60',kMultiplier:'2',censorWindow:'120',maxSaveUp:'3'};
 const configHash=sha256ToField(Buffer.from(encodeConfigCommitment({l1ChainId:chainId,rollupVersion:'1',rollupAddress:rollup,boardAddress:String(board.address)},economics)));
 const immutables={MIN_DEPOSIT:100n,MAX_DEPOSIT:200n,L2_CONTRACT:BigInt(String(board.address)),ROLLUP:11n,INBOX:33n,OUTBOX:44n,VERSION:1n,L1_CHAIN_ID:BigInt(chainId),CONFIG_HASH:configHash.toBigInt()};
 const storage=new Map([[1n,22n],...[BigInt(chainId),11n,1n,100n,200n,60n,2n,120n,3n,3n].map((value,i)=>[3n+BigInt(i),value])]);
 const node={getCurrentMinFees:async()=>({feePerDaGas:1n,feePerL2Gas:1n}),getBlockData:async n=>({blockHash:Fr.fromString(hex(55)),header:{globalVariables:{blockNumber:10}}}),
  getContract:async(address,reference)=>{state.reads.push(['instance',reference]);return address.equals(board.address)?board:fee;},
  getPublicStorageAt:async(reference,address,slot)=>{state.reads.push(['storage',reference]);return new Fr(storage.get(slot.toBigInt()));},
  getL1ContractAddresses:async()=>({rollupAddress:rollup,inboxAddress:eth(33),outboxAddress:eth(44)})};
 const provider={getNetwork:async()=>({chainId:BigInt(chainId)}),getBlock:async n=>({number:20,hash:hex(66)}),getCode:async(address,n)=>{state.ethReads.push(n);return expectedPortalRuntime(metadata,immutables);},destroy:()=>{state.destroyed++;}};
 const ethers={Interface,JsonRpcProvider:class{constructor(){return provider;}},Contract:class{constructor(){return {...Object.fromEntries(Object.keys(immutables).map(name=>[name,async opts=>{state.ethReads.push(opts.blockTag);return immutables[name];}])),depositsEnabled:async opts=>{state.ethReads.push(opts.blockTag);return state.enabled;}};}}};
 const sdk={Fr,AztecAddress,getContractClassFromArtifact,computeContractAddressFromInstance,derivePrivateFeeInstance,normalizePrivateFeeGasSettings,ordinaryPostFeeLimit,sha256ToField,verifyPortalRuntime,portalRuntimeMetadata:metadata,
  isTrustedPrivateNode:n=>n===node,inspectTrustedNode:async(n,opts)=>{state.inspection++;assert.deepEqual(opts.expectedNetworkScope,{chainId,version:'1',rollup});assert.equal(opts.proofsEnabled,state.proofsEnabled??true);}};
 const options={sdk,node,ethers,config,boardArtifact:artifact,privateFeeArtifact:feeArtifact,contextGuard:async()=>{state.guards++;}};
 return {options,state,node,provider,board,fee,storage,immutables,configHash,economics};
}

import {deriveKeys,deriveMasterMessageSigningSecretKey as deriveSigningKey} from '@aztec-labs/stdlib/keys';
import {SchnorrInitializerlessAccountContract} from '@aztec-labs/accounts/schnorr';
import {AccountManager} from '@aztec-labs/aztec.js/wallet';
import {computePartialAddress} from '@aztec-labs/stdlib/contract';
import {Tx} from '@aztec-labs/stdlib/tx';
import {encodeArguments} from '@aztec-labs/stdlib/abi';
import {IDBFactory} from 'fake-indexeddb';
import {createBrowserJournalStorage} from '../../shared/journal-indexeddb.mjs';
import {createL2Journal,l2JournalScopeText} from '../../shared/l2-journal.mjs';
const ownedIdString=value=>hex(value.toBigInt());
async function sessionFixture({chainId='31337'}={}){
 const f=await deploymentFixture({chainId}),state={active:false,events:[],stops:0,closes:0,syncs:0,sends:0,registrations:0};
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
 const pxe={node:{getL1ToL2MessageMembershipWitness:async()=>{held('claim-membership');throw Error('fixture claim adapter must supply membership');}},registerAccount:async()=>{held('register-account');state.registrations++;if(state.failRegister)throw Error('registration failed');},registerContractClass:async()=>{held('register-class');},registerContract:async()=>{held('register-contract');},
  initializeSchnorrAccount:async(owner,key,{contextGuard})=>{held('signing-capsule');assert.equal(String(owner),account.address);assert.equal((await accountContract.getImmutablesHash()).toString(),(await poseidon2Hash([key.x,key.y])).toString());await contextGuard();},
  sync:async()=>{held('sync');state.syncs++;if(state.waitSync)await state.waitSync;if(state.failSync)throw Error('sync failed');},
  syncForAccountStatus:async board=>{assert.equal(String(board),f.options.config.board.contractAddress);await pxe.sync();},
  prepareBoardActionState:async targets=>{held('board-state');assert.deepEqual(Object.fromEntries(Object.entries(targets).map(([key,value])=>[key,['owner','board','privateFee'].includes(key)?String(value):value])),{owner:account.address,board:f.options.config.board.contractAddress,privateFee:f.options.config.privateFee.contractAddress,method:targets.method});state.boardStateMethod=targets.method;if(state.waitBoardState)await state.waitBoardState;if(state.failBoardState)throw Error('board state failed');},
  prepareOrdinaryPostState:async targets=>{held('ordinary-state');assert.deepEqual(targets,{owner:account.address,board:f.options.config.board.contractAddress,privateFee:f.options.config.privateFee.contractAddress});if(state.waitOrdinaryState)await state.waitOrdinaryState;if(state.failOrdinaryState)throw Error('ordinary state failed');},
  getSyncedBlockHeader:async()=>{held('preference-header');return {globalVariables:{blockNumber:10},hash:async()=>BlockHash.fromString(hex(55))};},
  getPrivateEvents:async()=>{held('preference-events');if(state.waitEvents)await state.waitEvents;if(state.failEvents)throw Error('PRIVATE_SENTINEL');return [];},
  stop:async()=>{held('stop');state.stops++;if(state.waitStop)await state.waitStop;if(state.failStop)throw Error('stop failed');await store.close();}};
 const privateStore=createBrowserJournalStorage(new IDBFactory());
 const wallet={aztecNode:f.node,pxe,getAccounts:async()=>[accountInstance.address],getChainInfo:async()=>({chainId:Number(chainId),version:1}),sendTx:async()=>{held('send');state.sends++;throw Error('unknown send');}};
 const routing={createAztecWallet:(_sdk,p,n,raw)=>{held('create-wallet');assert.equal(p,pxe);assert.equal(n,f.node);assert.equal(raw,f.node);return wallet;},
  isPrivateWalletForNode:(w,n)=>!state.wrongWallet&&w===wallet&&n===f.node};
 const sdk={...f.options.sdk,computeArtifactHash,poseidon2HashWithSeparator,deriveStorageSlotInMap,EventSelector,decodeFunctionSignature,Fr,deriveKeys,deriveSigningKey,SchnorrInitializerlessAccountContract,getContractInstanceFromInstantiationParams,computePartialAddress,Tx,encodeArguments,
  createTrustedPrivateNode:async options=>{held('trusted-node');state.trustedProofsEnabled=options.proofsEnabled;assert.equal(options.url,'http://127.0.0.1:3/v1/node');return f.node;},
  openPXEStore:async options=>{held('open-store');assert.equal(options.accountAddress,account.address);assert.equal(options.dataDirectory,'rolling-wallet-v1');return store;},
  createPXE:async(n,c,o)=>{held('create-pxe');state.pxeConfig=structuredClone(c);assert.equal(n,f.node);assert.equal(o.store,store);assert.deepEqual(o.remoteProver,{url:'http://127.0.0.1:3',board:String(f.board.address)});if(state.failCreatePXE)throw Error('pxe failed');return pxe;},
  isPrivatePXEForNode:(p,n)=>!state.wrongPXE&&p===pxe&&n===f.node,
  createBrowserJournalStorage:()=>privateStore,createL2Journal,
  AccountManager:{create:async()=>{held('account-manager');return {address:accountInstance.address,getInstance:()=>accountInstance};}},
  ContractFunctionInteraction:class{async simulate(){held('signing-capsule');}},
  Contract:{at:(address,selectedArtifact,selectedWallet)=>({methods:{balance_of:owner=>({simulate:async options=>{
   held('fee-balance');assert.equal(String(address),f.options.config.privateFee.contractAddress);assert.equal(selectedArtifact,f.options.privateFeeArtifact);assert.equal(selectedWallet,wallet);
   assert.equal(owner.toString(),account.address);assert.equal(options.from.toString(),account.address);state.feeBalanceReads=(state.feeBalanceReads??0)+1;
   await state.beforeFeeBalance?.();if(Object.hasOwn(state,'feeReadError'))throw state.feeReadError;
   return {result:state.feeCredit??100n};
  }}),get_screen_hints:(owner,deposit)=>({simulate:async options=>{held('screen-hints');assert.equal(owner.toString(),account.address);assert.equal(options.from.toString(),account.address);return {result:[null,null]};}}),preference_head:()=>({simulate:async()=>{held('preference-head');return {result:decodeFromAbi(getFunctionReturnType(artifact.functions.find(fn=>fn.name==='preference_head')),[Fr.ZERO,Fr.ONE,Fr.ZERO,Fr.ZERO])};}}),register_name:(...args)=>({args}),get_deposit_ids:()=>({simulate:async()=>({result:[9n,...Array(9).fill(0n)]})}),owned_name_records:()=>({simulate:async()=>({result:ownedRecords})})}})},
  prefetchOrdinaryPostWitnesses:async input=>{held('posting-witnesses');(state.witnessPrefetches??=[]).push(input);},
  preparePrivateFeePayment:async()=>({availableCredit:100n}),estimatePrivateFeeTransaction:async()=>({maximumFee:10n,payload:{},gasSettings:{}})};
 const locks={request:async(name,options,run)=>{
  if(name==='billboard-wallet:'+account.address+':funding'){
   assert.deepEqual(options,{mode:'exclusive'});assert.equal(state.active,true);
   const next=(state.fundingQueue??Promise.resolve()).then(()=>run({}));state.fundingQueue=next.catch(()=>{});return next;
  }
  assert.equal(name,'billboard-wallet:'+account.address);assert.deepEqual(options,{ifAvailable:true});
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
 for(const mode of ['failCreatePXE','failRegister','wrongPXE','wrongWallet']){
  const f=await sessionFixture();f.state[mode]=true;await assert.rejects(createRollingWalletSession(f.input));
  assert.equal(f.state.active,false);assert.equal(f.state.closes,1);assert.equal(f.state.stops,mode==='failCreatePXE'?0:1);
  assert.ok(f.state.events.indexOf('store-close')<f.state.events.lastIndexOf('unlock'));
  if(mode==='wrongPXE')assert.equal(f.state.registrations,0);
  if(mode==='wrongWallet')assert.ok(!f.state.events.includes('account-manager'));
 }
});
test('cleanup errors preserve original failure and close the store when PXE.stop fails',async()=>{
 const f=await sessionFixture();f.state.failRegister=true;f.state.failStop=true;f.state.failClose=true;
 await assert.rejects(createRollingWalletSession(f.input),error=>error instanceof AggregateError&&error.errors[0].message==='registration failed'&&error.errors[1] instanceof AggregateError);
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
   f.pxe.initializeSchnorrAccount=async()=>{forbidden++;};
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
 assert(rejected);if(['trusted-node','deployment'].includes(step))assert.equal(caught.code,'ROLLING_DEPLOYMENT_INVALID');else assert.equal(caught,original);
 assert.deepEqual(observed.at(-1),{stage:'session-initialization',step:['trusted-node','deployment'].includes(step)?'deployment':step,deploymentStep:step==='trusted-node'?'node-readiness':step==='deployment'?'final-readiness-and-context':null,state:'failed',code:'unknown'});
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
 await assert.rejects(createRollingWalletSession(g.input),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(reads,0);assert.equal(observed.at(-1).code,'unknown');
});

for(const mode of [undefined,true,false])test(`native PXE configuration follows captured proof mode ${mode}`,async()=>{
 const f=await sessionFixture();if(mode!==undefined)f.input.proofsEnabled=mode;f.deploymentState.proofsEnabled=mode??true;
 const session=await createRollingWalletSession(f.input);
 try{assert.equal(f.state.trustedProofsEnabled,mode??true);assert.deepEqual(f.state.pxeConfig,{proverEnabled:mode??true,autoSync:false,syncChainTip:'proposed'});assert.equal(f.state.syncs,0);assert.equal(f.state.registrations,1);}
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
 const expected=Error('Read-only wallet selection rejected');let captures=0;
 f.input.captureFundingWallet=async()=>{assert(f.state.active);captures++;throw expected;};
 return {...f,b,scope:s,expected,captures:()=>captures};
}
test('aggregate configured session retains direct receipt recovery with an empty private aggregate slot and no funding wallet',async()=>{
 const f=await aggregateSessionFixture();f.pxe.node={getL1ToL2MessageMembershipWitness:async()=>{throw Error('waiting claim must not read a membership witness');}};f.input.sdk.prepareFundingClaim=async input=>{assert.equal(input.aggregateIntent,undefined);assert.equal(typeof await input.ethProvider.getCode(eth(22),20),'string');return {status:'waiting'};};
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10},hash:async()=>hex(55),state:{l1ToL2MessageTree:{root:new Fr(1)}}});
 const session=await createRollingWalletSession(f.input);try{
  const receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:eth(33),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44)};
  await assert.rejects(session.application.prepare({type:'claim-deposit',receipt}),{code:'ROLLING_FUNDING_NOT_READY'});assert.equal(f.captures(),0);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
for(const defect of ['none','bok-portal','fee-portal','token-decimals'])test('aggregate canonical '+defect+' validation retains priority over overlapping wallet rejection',async()=>{
 const f=await aggregateSessionFixture();let custody=0;
 f.input.sdk.deriveBoardDepositSecret=async()=>{custody++;throw Error('Unexpected custody derivation');};
 if(defect==='bok-portal')f.b.values.set(String(BigInt(bokArtifact.storageLayout.portal.slot)),new Fr(999));
 if(defect==='fee-portal')f.node.getL1ContractAddresses=async()=>({rollupAddress:eth(11),inboxAddress:eth(33),outboxAddress:eth(44),feeJuicePortalAddress:eth(999)});
 if(defect==='token-decimals'){const original=f.provider.call;f.provider.call=async request=>request.to===f.scope.bokToken?'0x'+BigInt(18).toString(16).padStart(64,'0'):original(request);}
 const session=await createRollingWalletSession(f.input);try{
  await assert.rejects(session.funding.prepare({asset:'ETH',feeAmount:'2000',bokAmount:'1'}),defect==='none'?error=>error===f.expected:{code:'ROLLING_SESSION_CONFIG'});assert.equal(f.captures(),1);assert.equal(custody,0);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
test('USDC session exposes only explicitly pinned relay capability and retains authenticated custody ordering',async()=>{
 const f=await aggregateSessionFixture();Object.assign(f.scope,{usdcRelayAddress:eth(90),usdcCodeHash:hex(91),usdcImplementation:eth(92),usdcImplementationCodeHash:hex(93),usdcDomain:{name:'USDC',version:'2'}});
 f.input.claimStore={save:async()=>{throw Error('must not reach storage before captured wallet');},load:async()=>null};f.input.fundingRelay={terms:async()=>{throw Error('must not query terms before wallet capture');}};
 const session=await createRollingWalletSession(f.input);try{
  assert.equal(session.funding.usdcAvailable,true);f.input.config.aggregateFunding.usdcRelayAddress=eth(99);
  await assert.rejects(session.funding.prepare({asset:'USDC',collateralWei:'1',feeAmount:'2000',bokAmount:'3',collateralPoolFee:3000,feePoolFee:3000,slippageBps:100,privateFeeCap:'1000'}),error=>error===f.expected);assert.equal(f.captures(),1);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});

import {verifyRollingTopupScope} from './wallet-session.mjs';
function topupScopeFixture(kind,defect='none'){
 const network={chainId:'31337',version:'1',rollup:eth(1)},privateFee=hex(2),portal=eth(3),token=eth(4),recipient=hex(5);
 const addresses={rollupAddress:network.rollup,feeJuicePortalAddress:portal,feeJuiceAddress:token,inboxAddress:eth(6),outboxAddress:eth(7)};
 const abi=new Interface(['function ROLLUP() view returns(address)','function UNDERLYING() view returns(address)','function VERSION() view returns(uint256)','function L2_TOKEN_ADDRESS() view returns(bytes32)','function token() view returns(address)','function escrow() view returns(bytes32)','function version() view returns(uint256)','function chainId() view returns(uint256)','function inbox() view returns(address)','function outbox() view returns(address)','function active() view returns(bool)','function decimals() view returns(uint8)']);
 const node={getL1ContractAddresses:async()=>addresses,getBlockData:async()=>({header:{globalVariables:{blockNumber:10}},blockHash:hex(10)}),getPublicStorageAt:async()=>new Fr(BigInt(portal))};
 const provider={getBlock:async block=>({number:10,hash:block==='latest'||defect!=='canonical'?hex(10):hex(11)}),call:async({to,data,blockTag})=>{
  assert.equal(blockTag,10);const name=abi.parseTransaction({data}).name;const values={ROLLUP:network.rollup,UNDERLYING:token,VERSION:1,L2_TOKEN_ADDRESS:hex(9),token,escrow:recipient,version:1,chainId:31337,inbox:addresses.inboxAddress,outbox:addresses.outboxAddress,active:true,decimals:kind==='bok'?6:18};
  if(defect==='token'&&name==='decimals')values[name]=9;if(defect==='portal'&&['ROLLUP','escrow'].includes(name))values[name]=name==='ROLLUP'?eth(99):hex(99);return abi.encodeFunctionResult(name,[values[name]]);
 }};
 const input={sdk:{Fr,ProtocolContractAddress:{FeeJuice:hex(9)}},ethers:{Interface},node,provider,network,privateFee,bok:{address:recipient,artifact:{storageLayout:{portal:{slot:'1'}}}},kind,contextGuard:async()=>{}};
 return {input,abi,portal,token,recipient:kind==='bok'?recipient:privateFee};
}
for(const kind of ['private-fee','bok'])for(const defect of ['none','token','portal','canonical'])test(`direct ${kind} top-up scope checks ${defect} against canonical protocol bindings`,async()=>{
 const {input,portal,token,recipient}=topupScopeFixture(kind,defect);
 if(defect==='none')assert.deepEqual(await verifyRollingTopupScope(input),{portal,token,recipient});else await assert.rejects(verifyRollingTopupScope(input),{code:'ROLLING_SESSION_CONFIG'});
});

import {verifyRollingTopupClaim} from './wallet-session.mjs';
import {requireSuccessfulReceipt} from '../../shared/transaction-outcomes.mjs';
for(const defect of ['none','hash','status','execution','canonical','account'])test(`retained aggregate/top-up claim canonical check ${defect}`,async()=>{
 const hash='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32),receipt={txHash:hash,status:'checkpointed',executionResult:'success',blockNumber:3,blockHash};let reads=0;
 if(defect==='hash')receipt.txHash='0x'+'33'.repeat(32);if(defect==='status')receipt.status='pending';if(defect==='execution')receipt.executionResult='reverted';
 const input={sdk:{TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn(),requireSuccessfulReceipt},node:{getTxReceipt:async()=>{reads++;return receipt;},getBlock:async number=>{assert.equal(number,3);reads++;return {hash:defect==='canonical'?'0x'+'44'.repeat(32):blockHash};}},txHash:hash,contextGuard:()=>{if(defect==='account')throw Error('account changed');}};
 if(defect==='none'){await verifyRollingTopupClaim(input);assert.equal(reads,2);}else{await assert.rejects(verifyRollingTopupClaim(input));if(defect==='account')assert.equal(reads,0);}
});

import {createCollateralWithdrawal} from './wallet-session.mjs';
import {createEthereumJournal} from '../../shared/ethereum-journal.mjs';
import {computeL2ToL1MessageHash} from '@aztec-labs/stdlib/hash';
import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {TxHash,MinedTxReceipt} from '@aztec-labs/stdlib/tx';
import {hexlify,AbiCoder,getBytes,encodeBytes32String} from 'ethers';
import {encodeDepositExitCommitment} from '../../shared/protocol-commitments.mjs';
async function withdrawalFixture({chainId='31337',bok=false,cancellation=false,scopeOverride={}}={}){
 const scope={account:hex(3),chainId,version:'1',rollup:eth(11),board:hex(1),portal:eth(22),...scopeOverride},record={intentId:hex(8),action:{type:'withdraw',deposit:hex(9)},status:'confirmed',txHash:hex(77),withdrawal:{eligible:true,amount:'100',depositor:eth(33),depositId:hex(56)}};
 if(cancellation){assert.equal(bok,false);record.action={type:'cancel-deposit',receipt:{}};record.withdrawal.kind='cancelled-collateral';}
 if(bok){record.action={type:'withdraw-bok',amount:'100',recipient:eth(33)};record.withdrawal={...record.withdrawal,kind:'bok',nonce:hex(55),bokScope:{portal:scope.portal,token:eth(66),recipient:scope.board}};}
 const content=sha256ToField([bok?Buffer.from(getBytes(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256','address','bytes32','uint256','address','uint128','bytes32'],[encodeBytes32String('PLUGIN_EXIT_V1'),chainId,scope.portal,scope.board,1,eth(33),100,hex(55)]))):Buffer.from(encodeDepositExitCommitment(cancellation?'refund':'exit',{l1ChainId:scope.chainId,rollupAddress:scope.rollup,rollupVersion:scope.version,boardAddress:scope.board,portalAddress:scope.portal},{amount:'100',depositor:eth(33),depositId:hex(56)}))]);
 const leaf=computeL2ToL1MessageHash({l2Sender:new AztecAddress(new Fr(BigInt(scope.board))),l1Recipient:EthAddress.fromString(scope.portal),content,chainId:new Fr(BigInt(chainId)),rollupVersion:new Fr(1)});
 const state={sends:0,calls:0,guard:true,connected:eth(33),price:2n,settled:true,unknown:false,head:10,tx:null,receipt:null,fork:false};const values=new Map();
 const storage={read:async key=>values.get(key)??null,compareAndSwap:async(key,previous,next)=>{assert.equal(values.get(key)??null,previous);if(next===null)values.delete(key);else values.set(key,next);}};
 const provider={on:async(event,listener)=>{assert.equal(event,'finalized');state.finalityListener=listener;},off:async(event,listener)=>{assert.equal(event,'finalized');assert.equal(state.finalityListener,listener);state.finalityListener=null;},getNetwork:async()=>({chainId:BigInt(state.chainId??chainId)}),getBlockNumber:async()=>state.head,getBlock:async n=>n==='finalized'?(state.onFinalityRead?.(),{number:state.finalized??state.head,hash:hex(state.finalized??state.head)}):({number:n==='latest'?state.head:n,hash:state.fork?hex(999):hex(n==='latest'?state.head:n),parentHash:hex(Number(n==='latest'?state.head:n)-1),prefetchedTransactions:state.tx?[state.tx]:[]}),getTransactionCount:async(_address,tag)=>tag==='pending'&&state.pendingNonce!==undefined?state.pendingNonce:state.tx?1:0,getTransaction:async h=>state.tx?.hash===h?state.tx:null,getTransactionReceipt:async h=>state.receipt?.hash===h?state.receipt:null,waitForTransaction:async()=>state.receipt,estimateGas:async()=>100n,getFeeData:async()=>{state.onFees?.();return {gasPrice:state.price};},call:async()=>{state.calls++;if(!state.settled)throw Error('Outbox not settled');return '0x';}};
 const node={getTxReceipt:async()=>({txHash:record.txHash,status:state.l2Status??'proven',executionResult:'success',blockNumber:1,blockHash:hex(42)}),getTxEffect:async()=>({l2BlockNumber:1,l2BlockHash:hex(42),data:{l2ToL1Msgs:[leaf]}}),getBlockData:async()=>({header:{globalVariables:{blockNumber:1}},blockHash:state.l2Fork?hex(99):hex(42)}),getL2ToL1MembershipWitness:async()=>({epochNumber:1,numCheckpointsInEpoch:1,leafIndex:0n,siblingPath:{toBufferArray:()=>[]}})};
 const eventName=cancellation?'Refunded':'Withdrawn';
 const abi=new Interface([bok?'event Withdrawn(address indexed recipient,uint128 amount,bytes32 nonce)':cancellation?'event Refunded(address indexed depositor,bytes32 indexed depositId,uint128 amount)':'event Withdrawn(address indexed depositor,uint128 amount,bytes32 indexed depositId)']);
 const signer={getAddress:async()=>state.connected,sendTransaction:async request=>{state.sends++;state.head++;state.tx={...request,hash:hex(88)};state.receipt={hash:hex(88),from:eth(33),to:scope.portal,status:1,gasUsed:100n,gasPrice:2n,blockNumber:state.head,blockHash:hex(state.head),logs:[{address:scope.portal,...abi.encodeEventLog(abi.getEvent(eventName),cancellation?[eth(33),hex(56),100n]:[eth(33),100n,...(bok?[hex(55)]:[hex(56)])])}]};if(state.unknown)throw Error('lost response');return state.tx;}};
 const opts={sdk:{createEthereumJournal,Fr,AztecAddress,EthAddress,TxHash,computeL2ToL1MessageHash,sha256ToField,waitForTx:async()=>({status:'proven',executionResult:'success'}),boundedTransactionRead:fn=>fn()},ethers:{Interface,hexlify,AbiCoder,getBytes,encodeBytes32String},resolveBokScope:async()=>({portal:scope.portal,token:eth(66),recipient:scope.board}),provider,node,application:{readWithdrawal:async()=>record},scope,storage,walletSecret:hex(8),walletSalt:hex(9),contextGuard:async()=>{assert(state.guard);},captureWallet:async()=>({address:state.connected,chainId,name:'Development wallet',signer,guard:async()=>{assert(state.guard&&state.connected===eth(33));}})};
 const pendingSlot=await createPendingWithdrawalSlot({storage,walletSecret:opts.walletSecret,walletSalt:opts.walletSalt,scope});await pendingSlot.write(await pendingSlot.read(),{...record,paymentStatus:'pending'});
 return {state,record,opts,values,pendingSlot,saveRecord:async()=>pendingSlot.write(await pendingSlot.read(),{...record,paymentStatus:'pending'}),cap:createCollateralWithdrawal(opts),restart:()=>createCollateralWithdrawal(opts)};
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
  failAt=541;await assert.rejects(f.restart().recover(),{code:'BB_ETH_READ_FAILED'});
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
 await f.saveRecord();await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});
test('RC22 refund receipt reorg cannot unlock workflow or authorize another payment',async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});await f.cap.confirm();f.state.fork=true;
 await assert.rejects(f.restart().verify(f.record));assert.equal(f.state.sends,1);
});
test('RC22 pending transport failure retains operation ownership without a whole-flow deadline',async()=>{
 const f=await withdrawalFixture(),original=Error('provider transport failed');let release,started;const began=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
 f.opts.provider.getNetwork=async()=>{started();await held;throw original;};
 f.opts.sdk.boundedTransactionRead=()=>assert.fail('No whole-operation timeout wrapper');
 let settled=false;const result=assert.rejects(f.restart().prepare({maximumGasWei:'1000'}),error=>error===original).then(()=>{settled=true;});
 await began;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(f.state.sends,0);
 release();await result;assert.equal(settled,true);assert.equal(f.state.sends,0);
});
for(const method of ['prepare','prepareSaved'])test(`G21 ${method} rejects unproven exits without waiting or signing`,async()=>{
 const f=await withdrawalFixture({cancellation:true});
 if(method==='prepareSaved'){await f.cap.prepare();await f.cap.confirm();}
 const sends=f.state.sends,calls=f.state.calls;f.state.l2Status='checkpointed';
 f.opts.sdk.waitForTx=async()=>assert.fail('Explicit review cannot wait for native settlement');
 await assert.rejects(f.restart()[method](),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 assert.equal(f.state.calls,calls);assert.equal(f.state.sends,sends);
});
test('G21 cancelled collateral uses exact refund ID and owner and recovers without another send',async()=>{
 const f=await withdrawalFixture({cancellation:true});await f.cap.prepare();const result=await f.cap.confirm();
 assert.equal(result.status,'refunded');assert.equal(f.state.sends,1);
 const abi=new Interface(['function refund(address,bytes32,uint256,uint256,uint256,bytes32[])']);
 const tx=abi.parseTransaction({data:f.state.tx.data});assert.equal(tx.name,'refund');assert.equal(tx.args[0].toLowerCase(),eth(33));assert.equal(tx.args[1],hex(56));
 assert.equal(await f.restart().verify(f.record),true);assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
});
for(const mutation of ['action','depositId','effect'])test(`G21 cancelled collateral rejects changed ${mutation} before signing`,async()=>{
 const f=await withdrawalFixture({cancellation:true});
 if(mutation==='action')f.record.action.type='withdraw';
 if(mutation==='depositId')f.record.withdrawal.depositId=hex(57);
 await f.saveRecord();
 if(mutation==='effect')f.opts.node.getTxEffect=async()=>({l2BlockNumber:1,l2BlockHash:hex(42),data:{l2ToL1Msgs:[new Fr(123)]}});
 await assert.rejects(f.restart().prepare(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.sends,0);
});
for(const outcome of ['mined','reorg','context'])test(`RC22 testnet refund canonical mined receipt preserves original send: ${outcome}`,async()=>{
 const f=await withdrawalFixture({chainId:'11155111'});await f.cap.prepare({maximumGasWei:'1000'});f.state.finalized=0;
 f.opts.provider.on=async()=>assert.fail('No finality subscription');const get=f.opts.provider.getBlock;f.opts.provider.getBlock=async n=>{assert.notEqual(n,'finalized');return get(n);};
 assert.equal((await f.cap.confirm()).status,'refunded');assert.equal(f.state.sends,1);
 if(outcome==='reorg')f.state.fork=true;if(outcome==='context')f.state.guard=false;
 if(outcome==='mined')assert.equal((await f.restart().recover()).status,'refunded');else await assert.rejects(f.restart().recover());
 assert.equal(f.state.finalityListener,undefined);assert.equal(f.state.sends,1);
});

for(const phase of ['lock','context','pxe-sync','account-initialize','method'])test('refresh diagnostic preserves exact failure at '+phase,async()=>{
 const f=await sessionFixture(),rows=[],original=Object.assign(Error('PRIVATE_REFRESH_SENTINEL'),{code:'PRIVATE_FEE_CAP_TOO_LOW'});
 f.input.onProgress=row=>{rows.push(row);};const session=await createRollingWalletSession(f.input);rows.length=0;
 if(phase==='lock')f.input.locks.request=async()=>{throw original;};
 if(phase==='context')f.input.sdk.isPrivatePXEForNode=()=>{throw original;};
 if(phase==='pxe-sync')f.pxe.sync=async()=>{throw original;};
 if(phase==='account-initialize')f.pxe.initializeSchnorrAccount=async()=>{throw original;};
 if(phase==='method')f.state.feeReadError=original;
 // The production application captures SDK capabilities at construction.
 if(phase==='method'){
  await session.close();const again=await createRollingWalletSession(f.input);rows.length=0;
  await assert.rejects(again.application.readAccountStatus(),e=>e===original);await again.close();
 }else{await assert.rejects(session.application.readAccountStatus(),e=>e===original);if(phase==='lock')f.input.locks.request=async(_n,_o,fn)=>{f.state.active=true;try{return await fn({});}finally{f.state.active=false;}};await session.close();}
 const failed=rows.filter(r=>r.stage==='private-refresh'&&r.state==='failed');assert.equal(failed.length,1);assert.equal(failed[0].step,'account-status/'+phase);assert.equal(failed[0].code,'PRIVATE_FEE_CAP_TOO_LOW');assert(rows.every(r=>projectRollingInitialization(r)));assert(!JSON.stringify(rows).includes('PRIVATE_REFRESH_SENTINEL'));assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
});
for(const [method,label]of [['readAccountStatus','account-status'],['ownedIdentities','owned-names'],['readBokStatus','bok-status']])test('refresh diagnostic scopes actual method '+method,async()=>{
 const f=await sessionFixture(),rows=[];f.input.onProgress=r=>rows.push(r);const session=await createRollingWalletSession(f.input);f.pxe.sync=async()=>{throw false;};rows.length=0;
 let caught=true;try{await session.application[method]();}catch(error){caught=error;}assert.equal(caught,false);
 assert.deepEqual(rows.at(-1),{stage:'private-refresh',step:label+'/pxe-sync',deploymentStep:null,state:'failed',code:'unknown'});await session.close();
});
test('moderator refresh reads public storage without private synchronization and scopes read failures',async()=>{
 const f=await sessionFixture(),rows=[];f.input.onProgress=r=>rows.push(r);
 f.storage.set(BigInt(artifact.storageLayout.moderator.slot),3n);
 const session=await createRollingWalletSession(f.input),syncs=f.state.syncs;
 f.pxe.sync=async()=>{throw Error('Moderator lookup must not synchronize private state');};rows.length=0;
 try{
  assert.deepEqual(await session.application.readModeratorStatus(),{authorized:false});
  assert.equal(f.state.syncs,syncs);assert.equal(rows.at(-1).state,'complete');
  f.node.getPublicStorageAt=async()=>{throw false;};rows.length=0;
  let caught=true;try{await session.application.readModeratorStatus();}catch(error){caught=error;}assert.equal(caught,false);
  assert.deepEqual(rows.at(-1),{stage:'private-refresh',step:'moderator-status/method',deploymentStep:null,state:'failed',code:'unknown'});
 }finally{await session.close();}
});
test('refresh diagnostic observer failure cannot mask zero balance or inspect private exception getters',async()=>{
 const f=await sessionFixture(),rows=[];f.state.feeCredit=0n;f.input.sdk.preparePrivateFeePayment=async()=>assert.fail('Account status must not prepare a payment');
 f.input.onProgress=row=>{rows.push(row);if(row.state==='started')throw Error('OBSERVER');return Promise.reject(Error('OBSERVER'));};
 const session=await createRollingWalletSession(f.input);assert.deepEqual(await session.application.readAccountStatus(),{status:'fee-needed',depositIds:['0x'+9n.toString(16).padStart(64,'0')],pendingWithdrawal:null});assert.equal(rows.at(-1).state,'complete');assert.equal(f.state.feeBalanceReads,1);assert.equal(rows.filter(r=>r.stage==='private-refresh'&&r.step==='account-status/method'&&r.state==='started').length,1);
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
test('uniform Bok accounting binds every page to an exact public snapshot without private identifiers',async()=>{
 const calls=[],reader=createUniformBokAccountingReader({origin:'https://board.invalid',fetcher:async(url)=>{calls.push(url);return new Response(JSON.stringify({complete:true}));}});
 const snapshot={number:123,hash:hex(90)},cursor='a'.repeat(32)+':'+hex(12).slice(2)+':'+'b'.repeat(16);
 await reader({limit:50,cursor:null,snapshot});await reader({limit:50,cursor,snapshot});
 for(const input of calls){const url=new URL(input);assert.equal(url.searchParams.get('blockNumber'),'123');assert.equal(url.searchParams.get('blockHash'),snapshot.hash);assert.deepEqual([...url.searchParams.keys()].filter(key=>key!=='cursor').sort(),['blockHash','blockNumber','limit']);}
 for(const invalid of [null,{}, {number:123},{hash:hex(90)},{number:0,hash:hex(90)},{number:1.5,hash:hex(90)},{number:123,hash:'invalid'},{...snapshot,owner:'private'}])await assert.rejects(reader({limit:50,cursor:null,snapshot:invalid}));
 assert.equal(calls.length,2);
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
 await f.saveRecord();await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});
test('RC22 Bok refund completes on canonical mined receipt and still rejects reorg',async()=>{
 const f=await withdrawalFixture({bok:true,chainId:'11155111'});await f.cap.prepare({maximumGasWei:'1000'});f.state.finalized=0;
 f.opts.provider.on=async()=>assert.fail('No finality subscription');const get=f.opts.provider.getBlock;f.opts.provider.getBlock=async n=>{assert.notEqual(n,'finalized');return get(n);};
 assert.equal((await f.cap.confirm()).status,'refunded');assert.equal(await f.restart().verify(f.record),true);
 f.state.fork=true;await assert.rejects(f.restart().recover());assert.equal(f.state.sends,1);
});

test('RC22 expiry selection passes through existing session synchronization and refuses absent owned accounting before send',async()=>{
 const f=await aggregateSessionFixture(),session=await createRollingWalletSession(f.input);const before=f.state.syncs;
 await assert.rejects(session.application.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_BOK_ACCOUNTING_INCOMPLETE'});
 assert.equal(f.state.syncs,before+1);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
 await session.close();await assert.rejects(session.application.prepare({type:'expire-bok-request',requestId:hex(11)}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);
});

// Session wiring regression: canonical L2 outcome is a double; journal key
// derivation, authentication and retained workflow storage use real crypto.
test('included withdrawal status retains exact custody without opening Ethereum journal or holding unrelated actions',async()=>{
 const f=await sessionFixture(),id=hex(301),txHash=hex(302),calls=[];
 const scope={account:f.input.account.address,chainId:'31337',version:'1',rollup:f.input.config.network.rollupAddress,board:f.input.config.board.contractAddress,portal:f.input.config.board.portalAddress};
 const slot=await createPendingWithdrawalSlot({storage:f.privateStore,walletSecret:f.input.account.secretKey,walletSalt:f.input.account.salt,scope});
 const record={intentId:id,action:{type:'withdraw',deposit:hex(303)},status:'included',txHash,withdrawal:{eligible:true,amount:'100',depositor:eth(33),depositId:hex(56)},paymentStatus:'pending'};
 await slot.write(await slot.read(),record);
 f.input.sdk.createEthereumJournal=async()=>{calls.push(1);throw Error('Unrelated account reads must not inspect payment journal');};
 const session=await createRollingWalletSession(f.input);
 try{
  const result=await session.application.readAccountStatus();
  assert.equal(result.status,'fee-ready');assert.equal(result.pendingWithdrawal.txHash,txHash);assert.equal(result.intent,undefined);
  assert.equal(calls.length,0);assert.equal(session.busy,false);assert.equal(f.state.active,false);
  assert.deepEqual((await slot.read()).value,record);assert.equal(f.state.sends,0);
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

for(const bok of [false,true])test(`saved ${bok?'Bok':'collateral'} refund has an explicit exact-request review and continuation`,async()=>{
 const f=await withdrawalFixture({bok}),wallet=await f.opts.captureWallet(),send=wallet.signer.sendTransaction;let reject=true;
 wallet.signer.sendTransaction=async request=>{if(reject)throw Error('wallet transport unavailable');return send(request);};
 await f.cap.prepare({maximumGasWei:'1000'});await assert.rejects(f.cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});assert.equal(f.state.sends,0);
 const cap=f.restart();await assert.rejects(cap.prepare({maximumGasWei:'1000'}));
 const review=await cap.prepareSaved({maximumGasWei:'1000'});assert.equal(review.savedRequest,true);assert.equal(review.nonce,0);assert.equal(f.state.sends,0);
 reject=false;const result=await cap.confirm();assert.equal(result.status,'refunded');assert.equal(f.state.sends,1);assert.equal(f.state.tx.nonce,0);
 assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
});

async function unsentRefund(bok=false){
 const f=await withdrawalFixture({bok}),wallet=await f.opts.captureWallet(),send=wallet.signer.sendTransaction;
 wallet.signer.sendTransaction=async()=>{throw Error('wallet transport unavailable');};await f.cap.prepare({maximumGasWei:'1000'});await assert.rejects(f.cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});wallet.signer.sendTransaction=send;
 const scope={...f.opts.scope,depositor:f.record.withdrawal.depositor,...(bok?{token:f.record.withdrawal.bokScope.token}:{})};
 f.journal=()=>createEthereumJournal({...f.opts,scope,signer:wallet.signer});f.wallet=wallet;return f;
}
for(const bok of [false,true])for(const phase of ['review','confirm'])test(`saved ${bok?'Bok':'collateral'} refund canonical winner before ${phase} never sends again`,async()=>{
 const f=await unsentRefund(bok),cap=f.restart();if(phase==='confirm')await cap.prepareSaved({maximumGasWei:'1000'});
 const saved=await(await f.journal()).inspectRequest();await f.wallet.signer.sendTransaction({...saved,value:0n,chainId:BigInt(saved.chainId)});
 const result=await(phase==='review'?cap.prepareSaved({maximumGasWei:'1000'}):cap.confirm());assert.equal(result.status,'refunded');assert.equal(f.state.sends,1);
});
for(const bok of [false,true])for(const change of ['wallet','chain','membership','gas','settlement','context','cancel','amount','recipient','exit-nonce'])test(`saved ${bok?'Bok':'collateral'} refund refuses ${change} after review`,async()=>{
 const f=await unsentRefund(bok),cap=f.restart();await cap.prepareSaved({maximumGasWei:'1000'});
 if(change==='wallet')f.state.connected=eth(44);if(change==='chain')f.state.chainId='1';if(change==='membership')f.opts.node.getL2ToL1MembershipWitness=async()=>({epochNumber:2,numCheckpointsInEpoch:1,leafIndex:0n,siblingPath:{toBufferArray:()=>[]}});if(change==='gas')f.state.price=100n;if(change==='settlement')f.state.settled=false;if(change==='context')f.state.guard=false;if(change==='cancel')cap.cancel();if(change==='amount')f.record.withdrawal.amount='101';if(change==='recipient')f.record.withdrawal.depositor=eth(44);if(change==='exit-nonce'){if(bok)f.record.withdrawal.nonce=hex(99);else f.record.txHash=hex(99);}
 await f.saveRecord();await assert.rejects(cap.confirm());assert.equal(f.state.sends,0);
});
for(const timing of ['before-confirm','inside-signer'])test(`saved refund rejects authenticated journal replacement ${timing}`,async()=>{
 const f=await unsentRefund(),cap=f.restart();await cap.prepareSaved({maximumGasWei:'1000'});
 const saved=await(await f.journal()).inspectRequest(),alternate=new Map(),storage={read:async k=>alternate.get(k)??null,compareAndSwap:async(k,old,next)=>{assert.equal(alternate.get(k)??null,old);alternate.set(k,next);}};
 const other=await createEthereumJournal({...f.opts,storage,scope:{...f.opts.scope,depositor:f.record.withdrawal.depositor},provider:{...f.opts.provider,getTransactionCount:async()=>1},signer:{getAddress:async()=>f.record.withdrawal.depositor,sendTransaction:async()=>{throw Error('not sent');}}});
 await assert.rejects(other.send({data:saved.data,value:saved.value,expected:saved.expected}));
 const replace=()=>{f.values.clear();for(const [k,v]of alternate)f.values.set(k,v);};
 if(timing==='before-confirm')replace();else f.state.onFees=replace;
 await assert.rejects(cap.confirm());assert.equal(f.state.sends,0);
});
for(const mode of ['hidden-pending','interrupted-retry'])test(`saved refund ${mode} retains original nonce and uncertainty`,async()=>{
 const f=await unsentRefund(),cap=f.restart();const before=await(await f.journal()).inspectRequest();await cap.prepareSaved({maximumGasWei:'1000'});
 if(mode==='hidden-pending')f.state.pendingNonce=1;
 const send=f.wallet.signer.sendTransaction;let observed;
 f.wallet.signer.sendTransaction=async request=>{observed=request;if(mode==='interrupted-retry')throw Error('wallet transport interrupted');return send(request);};
 // An RPC-hidden pending original is deliberately not treated as absent: the
 // user's reviewed continuation always keeps the original nonce and calldata.
 if(mode==='interrupted-retry'){await assert.rejects(cap.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});const after=await(await f.journal()).inspectRequest();assert.equal(after.nonce,before.nonce);assert.equal(after.data,before.data);assert.equal(after.txHash,null);await assert.rejects(f.restart().prepare({maximumGasWei:'1000'}));}
 else assert.equal((await cap.confirm()).status,'refunded');
 assert.equal(observed.nonce,before.nonce);assert.equal(observed.data,before.data);assert.equal(observed.to,before.to);assert.equal(observed.value,0n);
});

import {createFundingContinuation} from './wallet-session.mjs';
import {waitForL1ToL2MessageReady,isL1ToL2MessageReady} from '@aztec-labs/aztec.js/messaging';
import {waitForTx} from '@aztec-labs/aztec.js/node';
function continuationFixture(){
 const calls=[],receipts={receipt:{messageKey:hex(71),blockNumber:7},feeReceipt:{messageKey:hex(72),blockNumber:7},bokReceipt:{messageKey:hex(73),blockNumber:7}};
 const prepared={intentId:hex(81),maximumFee:'10',status:'prepared'};let ready=false,busy=false,valid=true;
 const funding={inspect:async()=>({paymentSaved:true,privateFeeCap:'10',claim:null}),recover:async options=>{assert.equal(options.wait,true);return receipts;},checkpointClaim:async value=>calls.push(['checkpoint',value.attempted])};
 const application={readFundingState:async()=>({status:'ready'}),prepare:async()=>{calls.push(['prepare']);if(!ready)throw Object.assign(Error('not ready'),{code:'ROLLING_FUNDING_NOT_READY',reason:'l2-delivery'});return prepared;},submitPrepared:async()=>{calls.push(['submit']);return {...prepared,status:'confirmed'};}};
 const node={getL1ToL2MessageIndex:async key=>{calls.push(['message',key.toString()]);return 1n;},getBlockData:async tip=>{assert.equal(tip,'checkpointed');ready=true;return {header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:2}}}};}};
 const input={application,funding,node,sdk:{Fr,TxHash,waitForL1ToL2MessageReady,waitForTx},getProvider:async()=>{throw Error('not a finality wait');},contextGuard:async()=>{if(!valid)throw Error('account changed');},locked:async fn=>{assert.equal(busy,false);busy=true;try{return await fn();}finally{busy=false;}}};
 return {input,calls,receipts,prepared,get busy(){return busy;},invalidate(){valid=false;}};
}
test('funding continuation uses installed SDK readiness for every exact saved key at checkpointed tip',async()=>{
 const f=continuationFixture(),cap=createFundingContinuation(f.input);
 assert.equal((await cap.advanceClaim()).state,'complete');assert.equal(f.busy,false);
 assert.deepEqual(f.calls.filter(c=>c[0]==='message').map(c=>c[1]),Object.values(f.receipts).map(r=>r.messageKey));
 assert.deepEqual(f.calls.map(c=>c[0]),['message','message','message','prepare','checkpoint','checkpoint','submit']);
});
for(const action of ['pause','invalidate'])test('funding '+action+' drains concurrent SDK waits and fences submission',async()=>{
 const f=continuationFixture();let entered,release;const seen=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const original=f.input.node.getL1ToL2MessageIndex;f.input.node.getL1ToL2MessageIndex=async key=>{entered();await gate;return original(key);};
 const cap=createFundingContinuation(f.input),running=cap.advanceClaim();await seen;
 if(action==='pause')cap.pauseClaim();else f.invalidate();
 assert.equal(f.busy,true);await assert.rejects(cap.advanceClaim(),{code:'ROLLING_BUSY'});assert(!f.calls.some(c=>c[0]==='submit'));
 release();if(action==='pause')assert.deepEqual(await running,{state:'paused'});else await assert.rejects(running,/account changed/);
 assert.equal(f.busy,false);assert.equal(f.calls.filter(c=>c[0]==='message').length,3);assert(!f.calls.some(c=>c[0]==='submit'));
});
test('attempted funding claim waits for its exact hash with installed SDK and reconciles a revert without submitting',async()=>{
 const f=continuationFixture(),txHash=TxHash.fromString(hex(85));let reconciles=0;
 f.input.funding.inspect=async()=>({paymentSaved:true,privateFeeCap:'10',claim:{intentId:f.prepared.intentId,attempted:true}});
 f.input.application.reconcile=async()=>({...f.prepared,txHash:txHash.toString(),status:++reconciles===1?'unknown':'reverted'});
 f.input.node.getTxReceipt=async hash=>{assert(hash.equals(txHash));return MinedTxReceipt.from({txHash,status:'checkpointed',executionResult:'reverted',transactionFee:1n,blockHash:BlockHash.fromString(hex(86)),blockNumber:8,slotNumber:8,epochNumber:0,txIndexInBlock:0});};
 const cap=createFundingContinuation(f.input);assert.equal((await cap.advanceClaim()).state,'reverted');assert.equal(reconciles,2);assert(!f.calls.some(c=>c[0]==='submit'));
});
test('funding continuation recovers a lost private submit response by exact hash without resubmitting',async()=>{
 const f=continuationFixture(),txHash=TxHash.fromString(hex(87));let sends=0,reconciles=0;
 f.input.application.submitPrepared=async()=>{sends++;throw Error('lost private response');};
 f.input.application.reconcile=async()=>({...f.prepared,txHash:txHash.toString(),status:++reconciles===1?'unknown':'confirmed'});
 f.input.node.getTxReceipt=async hash=>{assert(hash.equals(txHash));return MinedTxReceipt.from({txHash,status:'checkpointed',executionResult:'success',transactionFee:1n,blockHash:BlockHash.fromString(hex(86)),blockNumber:8,slotNumber:8,epochNumber:0,txIndexInBlock:0});};
 assert.equal((await createFundingContinuation(f.input).advanceClaim()).state,'complete');assert.equal(sends,1);assert.equal(reconciles,2);
});

// Public-only recovery composition: real encrypted custody/journals and SDK
// membership hashing; canonical RPC/contract reads are bounded unit doubles.
async function publicRefundFixture(){
 const d=await deploymentFixture(),f=await withdrawalFixture({scopeOverride:{board:String(d.board.address)}}),methods=[];
 const scope=f.opts.scope,config={...d.options.config,publicRefundRpcUrl:'http://127.0.0.1:9900'};
 const sourceNode={...d.node,...f.opts.node,getBlockData:n=>n==='checkpointed'||n===10?d.node.getBlockData(n):f.opts.node.getBlockData(n)};
 const publicNode=Object.fromEntries(Object.entries(sourceNode).map(([name,fn])=>[name,(...args)=>{methods.push({name,args});return fn(...args);} ]));
 const getterAbi=new Interface(Object.keys(d.immutables).map(name=>'function '+name+'() view returns(uint256)'));
 const ordinaryCall=f.opts.provider.call;
 const provider={...f.opts.provider,getCode:d.provider.getCode,destroy:d.provider.destroy,call:async request=>{try{const parsed=getterAbi.parseTransaction({data:request.data});if(parsed)return getterAbi.encodeFunctionResult(parsed.name,[d.immutables[parsed.name]]);}catch{}return ordinaryCall(request);}};
 const slot=await createPendingWithdrawalSlot({storage:f.opts.storage,walletSecret:f.opts.walletSecret,walletSalt:f.opts.walletSalt,scope});
 const record={...f.record,paymentStatus:'pending'};await slot.write(await slot.read(),record);
 const sdk={...d.options.sdk,...f.opts.sdk,createBrowserJournalStorage:()=>f.opts.storage,createAztecNodeClient:()=>{f.state.clients=(f.state.clients??0)+1;return publicNode;},inspectTrustedNode:async(_node,opts)=>assert.deepEqual(opts,{expectedNetworkScope:{chainId:'31337',version:'1',rollup:scope.rollup},proofsEnabled:false})};
 const input={sdk,ethers:{...f.opts.ethers,JsonRpcProvider:class{constructor(){return provider;}}},config,boardArtifact:artifact,account:{address:scope.account,secretKey:f.opts.walletSecret,salt:f.opts.walletSalt},contextGuard:f.opts.contextGuard,captureFundingWallet:f.opts.captureWallet,locks:{request:async(_name,_options,fn)=>fn({})}};
 return {...f,input,slot,record,methods,d};
}
test('refund-only composition reopens encrypted confirmed exit without private SDK work and explicitly refunds once',async()=>{
 const f=await publicRefundFixture(),session=await createRollingRefundSession(f.input);
 assert.equal(session.mode,'refund-only');assert.equal((await session.application.readAccountStatus()).intent.txHash,f.record.txHash);
 assert.equal(f.state.sends,0);assert.equal((await session.withdrawal.prepare({maximumGasWei:'1000'})).amount,'100');
 assert.equal((await session.withdrawal.confirm()).status,'refunded');assert.equal(f.state.sends,1);
 assert.deepEqual(await session.application.readAccountStatus(),{status:'refunded',intent:null});
 assert.deepEqual((await f.slot.read()).value,{...f.record,paymentStatus:'refunded',ethereumTxHash:hex(88)},'Paid tombstone retains exact exit ownership');
 assert(f.methods.every(call=>!JSON.stringify(call.args).includes(f.input.account.secretKey)));
 assert(f.methods.every(call=>!JSON.stringify(call.args).includes(f.input.account.address)));
 await session.close();assert.equal(f.d.state.destroyed,1);
});
for(const status of ['prepared','submitted','unknown','reverted'])test('refund-only rejects '+status+' instead of manufacturing confirmation',async()=>{
 const f=await publicRefundFixture();await f.slot.write(await f.slot.read(),{...f.record,status});
 await assert.rejects(createRollingRefundSession(f.input),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.clients??0,0);assert.equal(f.state.sends,0);
});
test('refund-only retains unavailable membership and unsettled Outbox without sending or changing custody',async()=>{
 const f=await publicRefundFixture(),session=await createRollingRefundSession(f.input);f.state.l2Fork=true;await assert.rejects(session.withdrawal.observe(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 f.state.l2Fork=false;f.state.settled=false;
 await assert.rejects(session.withdrawal.prepare({maximumGasWei:'1000'}),/Outbox not settled/);assert.equal(f.state.sends,0);assert.deepEqual((await f.slot.read()).value,f.record);await session.close();
});
test('refund-only rejects concurrent custody, wrong account scope and wrong configured network before a refund',async()=>{
 const f=await publicRefundFixture();f.input.locks.request=async(_n,_o,fn)=>fn(null);
 await assert.rejects(createRollingRefundSession(f.input),{code:'ROLLING_OTHER_TAB'});assert.equal(f.state.clients??0,0);
 f.input.locks.request=async(_n,_o,fn)=>fn({});f.input.account.address=hex(999);
 await assert.rejects(createRollingRefundSession(f.input),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.clients??0,0);
});
test('refund-only reopened lost L1 reply reconciles original journal without a second send',async()=>{
 const f=await publicRefundFixture(),session=await createRollingRefundSession(f.input);
 await session.withdrawal.prepare({maximumGasWei:'1000'});f.state.unknown=true;
 await assert.rejects(session.withdrawal.confirm(),{code:'BB_ETH_SUBMISSION_UNKNOWN'});await session.close();
 const reopened=await createRollingRefundSession(f.input);assert.equal((await reopened.withdrawal.recover()).status,'refunded');assert.equal(f.state.sends,1);await reopened.close();
});
test('refund-only rejects wrong canonical portal runtime without changing the original exit',async()=>{
 const f=await publicRefundFixture();f.input.sdk.verifyPortalRuntime=()=>false;
 await assert.rejects(createRollingRefundSession(f.input),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.sends,0);assert.deepEqual((await f.slot.read()).value,f.record);
});

test('refund-only accepts native AztecAddress custody and rejects changed native address',async()=>{
 const f=await publicRefundFixture();f.input.account.address=new AztecAddress(Fr.fromHexString(f.input.account.address));
 const session=await createRollingRefundSession(f.input);assert.equal((await session.application.readAccountStatus()).intent.txHash,f.record.txHash);
 f.input.account.address=new AztecAddress(new Fr(999));
 await assert.rejects(session.withdrawal.prepare({maximumGasWei:'1000'}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(f.state.sends,0);await session.close();
});

// Full normal-session composition: actual encrypted journals/native membership
// hashing, explicit chain/provider doubles, no connected Ethereum signer needed.
for(const pending of [false,true])test(`normal private account observes mined refund with ${pending?'lagging':'current'} finalized head without subscribing or wallet connection`,async()=>{
 const f=await sessionFixture({chainId:'11155111'}),w=await withdrawalFixture({chainId:'11155111',scopeOverride:{account:f.input.account.address,board:String(f.board.address)}});
 f.input.config.network.ethRpcUrl='https://ethereum.invalid/';
 Object.assign(w.opts,{storage:f.privateStore,walletSecret:f.input.account.secretKey,walletSalt:f.input.account.salt});
 const pendingSlot=await createPendingWithdrawalSlot(w.opts);await pendingSlot.write(await pendingSlot.read(),{...w.record,paymentStatus:'pending'});
 const cap=w.restart();await cap.prepare({maximumGasWei:'1000'});await cap.confirm();assert.equal(w.state.sends,1);
 const id=w.record.intentId,workflow=await createEncryptedJournalSlot({storage:f.privateStore,walletSecret:f.input.account.secretKey,walletSalt:f.input.account.salt,scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(w.opts.scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
 await workflow.write(await workflow.read(),{...w.record,id});
 const originalBlock=f.node.getBlockData;Object.assign(f.node,{...w.opts.node,getBlockData:n=>n===1?w.opts.node.getBlockData(n):originalBlock(n)});
 Object.assign(f.input.sdk,w.opts.sdk,{createL2Journal:async()=>({inspectOutcome:async()=>({operation:'ROLLING_WORKFLOW_V1:'+id,txHash:w.record.txHash,outcome:'success',receipt:{txHash:w.record.txHash,transactionFee:1n,status:'proven',blockNumber:1,blockHash:hex(42)}}),confirmed:()=>{}})});
 const Original=f.input.ethers.JsonRpcProvider;let opened=0,subscriptions=0;
 const on=w.opts.provider.on;w.opts.provider.on=async(...args)=>{subscriptions++;assert(f.state.active);return on(...args);};w.opts.provider.destroy=()=>{};
 f.input.ethers={...f.input.ethers,...w.opts.ethers,JsonRpcProvider:class{constructor(url){return ++opened===1?new Original(url):w.opts.provider;}}};
 f.input.captureFundingWallet=undefined;
 if(pending)w.state.finalized=w.state.receipt.blockNumber-1;
 const session=await createRollingWalletSession(f.input);
 try{
  const status=await session.application.readAccountStatus();assert.equal(status.status,'fee-ready');
  assert.equal(subscriptions,0);assert.equal(w.state.finalityListener,undefined);assert.equal(w.state.sends,1);assert.equal((await workflow.read()).value.txHash,w.record.txHash);
 }
 finally{await session.close();}
});

import {verifyRollingAggregateScope} from './wallet-session.mjs';
for(const defect of ['none','native-reorg','l1-reorg','token-decimals','context'])test(`aggregate quote scope reuses immutable native anchor and rejects ${defect}`,async()=>{
 const scope={feePortal:eth(1),bokPortal:eth(2),feeToken:eth(3),bokToken:eth(4)},counts={native:0,storage:0,inspection:0,l1:0},abi=new Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)']);let changed=false;
 const node={getL1ContractAddresses:async()=>{counts.native++;return {feeJuicePortalAddress:scope.feePortal};},getBlockData:async()=>{counts.native++;return {header:{globalVariables:{blockNumber:10}},blockHash:changed&&defect==='native-reorg'?hex(99):hex(10)};},getPublicStorageAt:async()=>{counts.storage++;return new Fr(BigInt(scope.bokPortal));}};
 const provider={getBlock:async tag=>({number:20,hash:changed&&defect==='l1-reorg'&&tag===20?hex(99):hex(20)}),call:async request=>{counts.l1++;assert.equal(request.blockTag,20);const name=abi.parseTransaction(request).name;return abi.encodeFunctionResult(name,[name==='UNDERLYING'?scope.feeToken:name==='token'?scope.bokToken:request.to===scope.feeToken?18:changed&&defect==='token-decimals'?18:6]);}};
 const recheck=await verifyRollingAggregateScope({sdk:{Fr,inspectTrustedNode:async()=>{counts.inspection++;}},ethers:{Interface},node,provider,scope,bok:{address:hex(3)},bokArtifact:{storageLayout:{portal:{slot:1}}},network:{},proofsEnabled:false,contextGuard:async()=>{if(changed&&defect==='context')throw Error('Account changed');}});
 const before={...counts};changed=true;
 if(defect==='none'){await recheck();assert.equal(counts.native-before.native,1);assert.equal(counts.l1-before.l1,4);}else await assert.rejects(recheck());
 assert.equal(counts.inspection,1);assert.equal(counts.storage,1);
});

import {verifyRollingFundingCredit} from './wallet-session.mjs';
for(const [incoming,existing,eligible]of [['2000',0n,true],['2',2000n,true],['2',1999n,false],['2',0n,false]])test('new funding native maximum admission '+incoming+'/'+existing,async()=>{
 let reads=0,guards=0;const options={sdk:{normalizePrivateFeeGasSettings},node:{getCurrentMinFees:async()=>({feePerDaGas:1n,feePerL2Gas:1n})},gasSettings:{gasLimits:{daGas:'1000',l2Gas:'1000'},teardownGasLimits:{daGas:'100',l2Gas:'200'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}},incomingAmount:incoming,readExistingCredit:async()=>{reads++;return existing;},contextGuard:async()=>{guards++;}};
 if(eligible)assert.equal(await verifyRollingFundingCredit(options),undefined);
 else await assert.rejects(verifyRollingFundingCredit(options),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT',minimumFeeCredit:'2000'});
 assert.equal(reads,incoming==='2000'?0:1);assert(guards>=2);
});
test('funding admission propagates private credit and context failures instead of admitting payment',async()=>{
 const f=await deploymentFixture(),failure=Error('PRIVATE_SENTINEL');const options={sdk:f.options.sdk,node:f.node,gasSettings:f.options.config.privateFee.gasSettings,incomingAmount:'2',contextGuard:async()=>{},readExistingCredit:async()=>{throw failure;}};
 await assert.rejects(verifyRollingFundingCredit(options),e=>e===failure);
 options.readExistingCredit=async()=>2000n;options.contextGuard=async()=>{throw failure;};await assert.rejects(verifyRollingFundingCredit(options),e=>e===failure);
});
test('funding admission uses current rates instead of stale configured prices',async()=>{
 const f=await deploymentFixture();let reads=0;await assert.rejects(verifyRollingFundingCredit({sdk:f.options.sdk,node:{getCurrentMinFees:async()=>({feePerDaGas:2n,feePerL2Gas:1n})},gasSettings:f.options.config.privateFee.gasSettings,incomingAmount:'2000',contextGuard:async()=>{},readExistingCredit:async()=>{reads++;return 2000n;}}),{code:'ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT',minimumFeeCredit:'3000'});assert.equal(reads,1);
});
test('aggregate session checks funded small credit under its private account lock with native displayed cap',async()=>{
 const f=await aggregateSessionFixture();let calls=0;
 f.input.sdk.preparePrivateFeePayment=async options=>{calls++;assert(f.state.active);assert.equal(options.claim,undefined);assert.equal(options.privateFeeArtifact,f.input.privateFeeArtifact);assert.equal(options.privateFeeAddress,f.input.config.privateFee.contractAddress);return {availableCredit:2000n};};
 const session=await createRollingWalletSession(f.input);try{
  assert.equal(session.funding.defaultPrivateFeeCap,'2000');
  await assert.rejects(session.funding.prepare({asset:'ETH',feeAmount:'2',bokAmount:'0'}),e=>e===f.expected);
  assert.equal(calls,1);assert.equal(f.captures(),1);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});

// Price display is informational and must never block a valid funding quote.
import {fundingUsdEstimate} from './wallet-session.mjs';
import * as priceEthers from 'ethers';
function priceProvider({price=250012345678n,updated=900n,answered=7n}={}){
 const abi=new priceEthers.Interface(['function decimals() view returns (uint8)','function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)']);
 return {getBlock:async()=>({number:100,timestamp:1000}),call:async request=>{
  assert.equal(request.blockTag,100);assert.equal(request.to,'0x694AA1769357215DE4FAC081bf1f309aDC325306');
  const name=abi.parseTransaction(request).name;return abi.encodeFunctionResult(name,name==='decimals'?[8]:[7n,price,800n,updated,answered]);
 }};
}
test('ETH maximum total displays rounded USD using one authenticated block',async()=>{
 assert.equal(await fundingUsdEstimate({ethers:priceEthers,provider:priceProvider(),chainId:'11155111',wei:'1000000000000000'}),'2.50');
});
for(const values of [{price:0n},{price:-1n},{updated:1001n},{updated:0n},{answered:6n}])test('invalid oracle data omits USD rather than inventing a price '+JSON.stringify(values,(_,v)=>typeof v==='bigint'?String(v):v),async()=>{
 assert.equal(await fundingUsdEstimate({ethers:priceEthers,provider:priceProvider(values),chainId:'11155111',wei:'1000000000000000'}),null);
});
test('unavailable price feed does not fail payment preparation',async()=>{
 assert.equal(await fundingUsdEstimate({ethers:priceEthers,provider:{getBlock:async()=>{throw Error('offline');}},chainId:'11155111',wei:'1'}),null);
});

for(const depositId of [undefined,hex(0),'0x'+'ff'.repeat(32)])test('collateral withdrawal refuses missing or invalid deposit ID '+String(depositId),async()=>{
 const f=await withdrawalFixture();f.record.withdrawal.depositId=depositId;await f.saveRecord();
 await assert.rejects(f.cap.prepare({maximumGasWei:'1000'}));assert.equal(f.state.sends,0);
});
test('collateral withdrawal binds calldata and canonical receipt to the selected deposit',async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});await f.cap.confirm();
 const abi=new Interface(['function withdraw(bytes32 depositId,uint256,uint256,uint256,bytes32[])','event Withdrawn(address indexed depositor,uint128 amount,bytes32 indexed depositId)']);
 assert.equal(abi.decodeFunctionData('withdraw',f.state.tx.data).depositId,f.record.withdrawal.depositId);
 f.state.receipt.logs=[{address:f.opts.scope.portal,...abi.encodeEventLog(abi.getEvent('Withdrawn'),[eth(33),100n,hex(57)])}];
 await assert.rejects(f.restart().recover());assert.equal(f.state.sends,1);
});
test('changing the selected deposit after withdrawal review prevents signing',async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});f.record.withdrawal.depositId=hex(57);await f.saveRecord();
 await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});


test('configured Bok artifact and unavailable plugin are absent from core account reads',async()=>{
 const f=await aggregateSessionFixture();let artifacts=0,pluginReads=0;
 delete f.input.bokArtifact;f.input.getBokArtifact=async()=>{assert(f.state.active);artifacts++;return bokArtifact;};
 const get=f.node.getPublicStorageAt,blocked=Error('Optional plugin is unavailable');
 f.node.getPublicStorageAt=(reference,address,slot)=>{if(String(address)===f.b.input.config.contractAddress){pluginReads++;throw blocked;}return get(reference,address,slot);};
 const session=await createRollingWalletSession(f.input);
 try{
  assert.equal(session.bokConfigured,true);assert.equal(artifacts,0);assert.equal(pluginReads,0);
  assert.equal((await session.application.readAccountStatus()).status,'fee-ready');assert.equal(artifacts,0);assert.equal(pluginReads,0);
  await assert.rejects(session.application.readBokStatus(),error=>error===blocked);
  assert.equal(artifacts,1);assert.equal(pluginReads,4);assert.equal(f.state.sends,0);assert.equal(f.captures(),0);
  assert.equal((await session.application.readAccountStatus()).status,'fee-ready');assert.equal(pluginReads,4);
 }finally{await session.close();}
});
test('Bok topup registers the verified plugin once under the owning account lease',async()=>{
 const f=await aggregateSessionFixture();let artifacts=0,registered=0;
 delete f.input.bokArtifact;f.input.getBokArtifact=async()=>{assert(f.state.active);artifacts++;return bokArtifact;};
 const register=f.pxe.registerContract;f.pxe.registerContract=async instance=>{if(String(instance.address)===f.b.input.config.contractAddress)registered++;return register(instance);};
 const session=await createRollingWalletSession(f.input);
 try{
  assert.equal(artifacts,0);assert.equal(registered,0);assert(session.topup.bok);
  for(let i=0;i<2;i++)await assert.rejects(session.topup.bok.prepare({amount:'1',privateFeeCap:'1000'}),error=>error===f.expected);
  assert.equal(artifacts,1);assert.equal(registered,1);assert.equal(f.captures(),2);assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
for(const asset of ['ETH','USDC'])test('zero Bok '+asset+' scope avoids plugin reads while validating its payment token',async()=>{
 const scope={feePortal:eth(1),bokPortal:eth(2),feeToken:eth(3),bokToken:eth(4)},calls=[];
 const abi=new Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)']);
 const node={getL1ContractAddresses:async()=>({feeJuicePortalAddress:scope.feePortal}),getBlockData:()=>{throw Error('No plugin anchor');},getPublicStorageAt:()=>{throw Error('No plugin storage');}};
 const provider={getBlock:async()=>({number:20,hash:hex(20)}),call:async request=>{assert.equal(request.blockTag,20);assert.notEqual(request.to,scope.bokPortal);const name=abi.parseTransaction(request).name;calls.push([request.to,name]);return abi.encodeFunctionResult(name,[name==='UNDERLYING'?scope.feeToken:request.to===scope.feeToken?18:6]);}};
 const recheck=await verifyRollingAggregateScope({sdk:{Fr,inspectTrustedNode:async()=>{}},ethers:{Interface},node,provider,scope,network:{},proofsEnabled:false,contextGuard:async()=>{},includeBok:false,asset});
 await recheck();assert.equal(calls.length,asset==='USDC'?6:4);assert.equal(calls.some(([address])=>address===scope.bokToken),asset==='USDC');
});

test('all bridge legs start together and one delivered snapshot is invalidated',async()=>{
 const f=continuationFixture(),gates=Object.values(f.receipts).map(()=>Promise.withResolvers()),entered=Promise.withResolvers();let calls=0,invalidations=0;
 const original=f.input.sdk.waitForL1ToL2MessageReady;f.input.sdk={...f.input.sdk,waitForL1ToL2MessageReady:async(...args)=>{const index=calls++;if(calls===gates.length)entered.resolve();await gates[index].promise;return original(...args);}};
 f.input.invalidateSnapshot=()=>{invalidations++;};const cap=createFundingContinuation(f.input),pending=cap.advanceClaim();await entered.promise;assert.equal(calls,3);assert.equal(f.busy,true);assert(!f.calls.some(c=>c[0]==='submit'));
 for(const gate of gates)gate.resolve();assert.equal((await pending).state,'complete');assert.equal(invalidations,1);
});
test('opening a private session performs no discarded synchronization; first account read syncs once',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input);assert.equal(f.state.syncs,0);
 await session.application.readAccountStatus();assert.equal(f.state.syncs,1);await session.close();
});


test('direct action holds one account lock and synchronization through prepare and send',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),before=f.state.syncs,locks=f.state.events.filter(e=>e==='lock').length;
 const action={type:'name',first:'Fresh',last:'Willow'},captured=[];
 const execution=session.application.executeAction(action,{onPrepared:prepared=>{assert(f.state.active);captured.push(prepared);}});action.first='Changed';
 await assert.rejects(execution,/unknown send/);
 assert.equal(f.state.syncs-before,1);assert.equal(f.state.events.filter(e=>e==='lock').length-locks,1);assert.equal(f.state.sends,1);
 assert.equal(captured.length,1);assert.equal(captured[0].status,'unknown');assert.equal(captured[0].action.first,'Fresh');
 await assert.rejects(session.application.submitPrepared(captured[0].intentId),{code:'ROLLING_RECOVERY_REQUIRED'});assert.equal(f.state.sends,1);await session.close();
});

test('Bok capability launches all four same-anchor storage reads before any completes',{timeout:3000},async()=>{
 const f=await bokCapabilityFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let count=0,canonical=0;
 const read=f.input.node.getPublicStorageAt,block=f.input.node.getBlockData;
 f.input.node.getBlockData=async which=>{if(which!=='checkpointed'){canonical++;assert.equal(count,4);}return block(which);};
 f.input.node.getPublicStorageAt=async(reference,address,slot)=>{
  assert.deepEqual(reference,{hash:hex(55)});assert.equal(String(address),f.input.config.contractAddress);
  if(++count===4)entered.resolve();await gate.promise;return read(reference,address,slot);
 };
 const pending=verifyRollingBokCapability(f.input);await entered.promise;assert.equal(count,4);assert.equal(canonical,0);assert.equal(f.state.inspections,0);
 gate.resolve();await pending;assert.equal(canonical,1);assert.equal(f.state.reads.length,5);
});
for(const kind of ['throw','mismatch'])test(`Bok capability ${kind} drains all sibling field reads before failing`,{timeout:3000},async()=>{
 const f=await bokCapabilityFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('Exact storage failure');let count=0,finished=false,canonical=0;
 const read=f.input.node.getPublicStorageAt,block=f.input.node.getBlockData;
 f.input.node.getBlockData=async which=>{if(which!=='checkpointed')canonical++;return block(which);};
 f.input.node.getPublicStorageAt=(reference,address,slot)=>{
  count++;if(count===4)entered.resolve();
  if(count===1){if(kind==='throw')throw failure;return new Fr(999);}
  return gate.promise.then(()=>read(reference,address,slot));
 };
 const pending=verifyRollingBokCapability(f.input).finally(()=>{finished=true;});
 const rejection=assert.rejects(pending,kind==='throw'?error=>error===failure:{code:'ROLLING_DEPLOYMENT_INVALID'});
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(canonical,0);
 gate.resolve();await rejection;assert.equal(canonical,0);assert.equal(f.state.inspections,0);
});
test('Bok capability checks current context after all four reads drain',{timeout:3000},async()=>{
 const f=await bokCapabilityFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),failure=Error('Account invalidated after reads started');let count=0,invalid=false;
 const read=f.input.node.getPublicStorageAt;
 f.input.contextGuard=async()=>{if(invalid)throw failure;};
 f.input.node.getPublicStorageAt=async(...args)=>{if(++count===4)entered.resolve();await gate.promise;return read(...args);};
 const pending=verifyRollingBokCapability(f.input);const rejection=assert.rejects(pending,error=>error===failure);
 await entered.promise;invalid=true;gate.resolve();await rejection;assert.equal(f.state.inspections,0);
});


test('session registers the exact supported native account-manager instance without deriving it twice',async()=>{
 const f=await sessionFixture();let manager,immutables=0,managerCalls=0,privateKeys;
 f.input.sdk.getContractInstanceFromInstantiationParams=async()=>{throw Error('Duplicate account instance derivation');};
 f.input.sdk.SchnorrInitializerlessAccountContract=class extends SchnorrInitializerlessAccountContract{
  async getImmutablesHash(){immutables++;return super.getImmutablesHash();}
 };
 f.input.sdk.AccountManager={create:async(...args)=>{
  managerCalls++;assert.equal(args[0],f.wallet);assert.equal(f.state.registrations,0);
  manager=await AccountManager.create(...args);return manager;
 }};
 const registerAccount=f.pxe.registerAccount,registerContract=f.pxe.registerContract;let registeredInstance;
 f.pxe.registerAccount=async(keys,partial)=>{
  privateKeys=keys;assert.equal(String(partial),String(await computePartialAddress(manager.getInstance())));
  assert.deepEqual(keys.publicKeys.toBuffer(),manager.getPublicKeys().toBuffer());
  await registerAccount(keys,partial);
 };
 f.pxe.registerContract=async instance=>{
  if(!registeredInstance){registeredInstance=instance;assert.equal(instance,manager.getInstance());}
  return registerContract(instance);
 };
 const session=await createRollingWalletSession(f.input);
 assert.equal(managerCalls,1);assert.equal(immutables,1);assert(privateKeys);
 assert.equal(f.wallet._accountManager,manager);assert.equal(String(manager.address),f.input.account.address);
 assert.equal(f.state.syncs,0);assert.equal(f.state.sends,0);
 await session.application.ownedIdentities();assert.equal(f.state.syncs,1);
 assert.equal(f.state.events.filter(event=>event==='signing-capsule').length,1);
 await session.close();
});

for(const inconsistent of ['instance','manager'])test('inconsistent '+inconsistent+' address rejects before any account registration or journal access',async()=>{
 const f=await sessionFixture(),create=f.input.sdk.AccountManager.create;
 f.input.sdk.AccountManager.create=async(...args)=>{
  const manager=await create(...args),instance=manager.getInstance(),wrong=new AztecAddress(new Fr(999));
  return inconsistent==='instance'?{address:manager.address,getInstance:()=>({...instance,address:wrong})}:{address:wrong,getInstance:()=>instance};
 };
 for(const name of ['read','compareAndSwap'])f.privateStore[name]=async()=>{assert.fail('No journal access before account validation');};
 await assert.rejects(createRollingWalletSession(f.input),{code:'ROLLING_ACCOUNT_MISMATCH'});
 assert.equal(f.state.registrations,0);assert.equal(f.state.events.filter(event=>event==='register-class'||event==='register-contract').length,0);
 assert.equal(f.state.syncs,0);assert.equal(f.state.sends,0);assert.equal(f.state.stops,1);assert.equal(f.state.closes,1);assert.equal(f.state.active,false);
});

import {projectRollingTransactionProgress} from './wallet-session.mjs';
test('included transaction progress exposes only exact public identity and workflow intent',()=>{
 const details={txHash:hex(91),blockNumber:12,blockHash:hex(92),journalOperation:'ROLLING_WORKFLOW_V1:'+hex(93),secret:'PRIVATE_SENTINEL'};
 assert.deepEqual(projectRollingTransactionProgress('included',details),{stage:'included',intentId:hex(93),txHash:hex(91),blockNumber:12,blockHash:hex(92)});
 for(const patch of [{journalOperation:'other:'+hex(93)},{journalOperation:'ROLLING_WORKFLOW_V1:'},{txHash:'invalid'},{blockNumber:0},{blockNumber:1.5},{blockHash:'invalid'}])assert.equal(projectRollingTransactionProgress('included',{...details,...patch}),null);
 assert.equal(projectRollingTransactionProgress('included',{...details,get txHash(){assert.fail('Must not invoke an accessor');}}),null);
 assert.equal(projectRollingTransactionProgress('other',details),null);
 assert.deepEqual(projectRollingTransactionProgress('submitting',details),{stage:'submitting',intentId:hex(93),txHash:hex(91)});
 for(const bad of [undefined,{...details,txHash:'bad'},{...details,journalOperation:'other'},{...details,get txHash(){assert.fail('Accessor invoked');}}])assert.deepEqual(projectRollingTransactionProgress('submitting',bad),{stage:'submitting'});
});
test('wallet progress binding forwards included intent without extra private work and ignores rejected display callbacks',async()=>{
 const f=await sessionFixture(),create=f.input.routing.createAztecWallet,observed=[];let emit;
 f.input.routing.createAztecWallet=(...args)=>{emit=args[6].progress;return create(...args);};
 f.input.onProgress=value=>{if(value.stage==='included'){observed.push(value);return Promise.reject(Error('display'));}};
 const session=await createRollingWalletSession(f.input);try{
  const before=[f.state.sends,f.state.syncs,f.state.registrations];
  emit('included',{txHash:hex(91),blockNumber:12,blockHash:hex(92),journalOperation:'ROLLING_WORKFLOW_V1:'+hex(93)});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(observed,[{stage:'included',intentId:hex(93),txHash:hex(91),blockNumber:12,blockHash:hex(92)}]);
  assert.deepEqual([f.state.sends,f.state.syncs,f.state.registrations],before);
 }finally{await session.close();}
});

test('ordinary action starts public readiness while private synchronization remains held',async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),seen=Promise.withResolvers();let active=false,reads=0;
 const inspect=f.input.sdk.inspectTrustedNode;f.input.sdk.inspectTrustedNode=async(...args)=>{if(active){assert(f.state.active);reads++;seen.resolve();}return inspect(...args);};
 const session=await createRollingWalletSession(f.input);try{
  active=true;f.state.waitSync=gate.promise;let completed=false;
  const preparing=session.application.prepare({type:'name',first:'Fresh',last:'Willow'}).then(value=>{completed=true;return value;});
  await seen.promise;assert.equal(completed,false);assert.equal(f.state.active,true);assert.equal(f.state.sends,0);
  gate.resolve();const prepared=await preparing;assert.equal(prepared.status,'prepared');assert.equal(reads,1);
 }finally{gate.resolve();await session.close();}
});

for(const failure of ['prepare','proof'])test(`one-click history work cannot escape account lock on ${failure} failure`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const originalAt=f.input.sdk.Contract.at;f.input.sdk.Contract.at=(...args)=>{
  const board=originalAt(...args);return {...board,methods:{...board.methods,
   get_deposit_info:(owner,deposit)=>({simulate:async()=>({result:[1n,BigInt(deposit.toString()),100n,BigInt(eth(33)),0n,0n,0n,0n,0n,100n,56n]})}),post:(...args)=>({args}),get_screen_hints:()=>({simulate:async()=>({result:decodeFromAbi(getFunctionReturnType(artifact.functions.find(fn=>fn.name==='get_screen_hints')),Array.from({length:28},()=>Fr.ZERO))})})}};
 };
 const publicRead=f.node.getPublicStorageAt;f.node.getPublicStorageAt=async(reference,address,slot)=>slot.equals(artifact.storageLayout.main_version.slot)?Fr.ONE:publicRead(reference,address,slot);
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10,timestamp:100n},hash:async()=>BlockHash.fromString(hex(55))});
 f.input.sdk.ordinaryPostFeeBudget=()=>({maximumFee:100n});
 f.input.sdk.prefetchOrdinaryPostWitnesses=async()=>{assert(f.state.active);entered.resolve();await gate.promise;assert(f.state.active);throw Error('prefetch failed');};
 const session=await createRollingWalletSession(f.input);let settled=false;
 try{
  const error=Error('stop before proof');
  const run=session.application.executeAction({type:'post',deposit:'9',content:'Owned history read'},{onPrepared:()=>{if(failure==='prepare')throw error;}}).finally(()=>settled=true);
  const rejected=assert.rejects(run,failure==='prepare'?e=>e===error:/unknown send/);
  await entered.promise;await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.equal(f.state.active,true);
  await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});
  gate.resolve();await rejected;assert.equal(f.state.active,false);assert.equal(f.state.sends,failure==='prepare'?0:1);
 }finally{gate.resolve();await session.close();}
});

for(const failure of ['discovery','context'])test(`ordinary preparation holds account lease until shared contract discovery settles: ${failure}`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const session=await createRollingWalletSession(f.input),prepare=f.pxe.prepareOrdinaryPostState;
 f.pxe.prepareOrdinaryPostState=async targets=>{await prepare(targets);entered.resolve();await gate.promise;if(failure==='discovery')throw Error('discovery failed');};
 let settled=false;
 try{
  const run=session.application.executeAction({type:'post',deposit:'9',content:'Prepare both native contract states'}).finally(()=>settled=true);
  const rejected=assert.rejects(run,failure==='discovery'?/discovery failed/:{code:'ROLLING_PRIVATE_ROUTE'});
  await entered.promise;assert.equal(f.state.active,true);assert.equal(settled,false);assert.equal(f.state.sends,0);
  const events=f.state.events;assert(events.lastIndexOf('sync')<events.lastIndexOf('ordinary-state'));
  await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});
  if(failure==='context')f.state.wrongPXE=true;
  gate.resolve();await rejected;assert.equal(f.state.active,false);assert.equal(f.state.sends,0);
 }finally{gate.resolve();f.state.wrongPXE=false;await session.close();}
});

for(const outcome of ['success','discovery','context'])test(`background posting preparation owns one native lease and releases without a journal: ${outcome}`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let writes=0;
 f.input.sdk.createBrowserJournalStorage=()=>({...f.privateStore,compareAndSwap:(...args)=>{writes++;return f.privateStore.compareAndSwap(...args);}});
 const session=await createRollingWalletSession(f.input);
 const original=f.pxe.prepareOrdinaryPostState;f.pxe.prepareOrdinaryPostState=async targets=>{await original(targets);entered.resolve();await gate.promise;if(outcome==='discovery')throw Error('controlled discovery failure');};
 let settled=false;const run=session.preparePostingState('9').finally(()=>settled=true);
 const observed=outcome==='success'?run:assert.rejects(run,outcome==='discovery'?/controlled discovery failure/:{code:'ROLLING_PRIVATE_ROUTE'});
 try{
  await entered.promise;assert.equal(f.state.active,true);assert.equal(settled,false);assert.equal(f.state.sends,0);
  await assert.rejects(session.application.readAccountStatus(),{code:'ROLLING_BUSY'});
  if(outcome==='context')f.state.wrongPXE=true;gate.resolve();await observed;assert.equal(f.state.active,false);assert.equal(f.state.sends,0);assert.equal(writes,0);
  f.state.wrongPXE=false;const syncs=f.state.syncs;await session.application.ownedIdentities();assert.equal(f.state.syncs,syncs+1);
 }finally{gate.resolve();f.state.wrongPXE=false;await session.close();}
});

test('background posting preparation drains readiness failure with held native synchronization',async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let failing=false;
 const inspect=f.input.sdk.inspectTrustedNode;f.input.sdk.inspectTrustedNode=async(...args)=>{if(failing)throw Error('controlled readiness failure');return inspect(...args);};
 const session=await createRollingWalletSession(f.input);failing=true;
 const original=f.pxe.sync;f.pxe.sync=async()=>{entered.resolve();await gate.promise;return original();};
 let settled=false;
 const run=session.preparePostingState('9').finally(()=>settled=true),rejected=assert.rejects(run,/controlled readiness failure/);
 try{await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(f.state.active,true);gate.resolve();await rejected;assert.equal(f.state.active,false);assert(!f.state.events.includes('ordinary-state'));}
 finally{gate.resolve();await session.close();}
});

for(const mode of ['success','failure','account-change'])test(`background screening holds its lease and retains no result: ${mode}`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const original=f.input.sdk.Contract.at;let calls=0;
 f.input.sdk.Contract.at=(...args)=>{const board=original(...args);return {...board,methods:{...board.methods,get_screen_hints:(owner,deposit)=>({simulate:async options=>{
  assert(f.state.active);assert(f.state.events.includes('ordinary-state'));assert.equal(deposit.toBigInt(),9n);calls++;entered.resolve();await gate.promise;
  if(mode==='failure')throw Error('screen failure');return {result:[null,null]};
 }})}};};
 const session=await createRollingWalletSession(f.input);let settled=false;
 const run=session.preparePostingState('9').finally(()=>settled=true);
 const observed=mode==='success'?run:assert.rejects(run,mode==='failure'?/screen failure/:{code:'ROLLING_CONTEXT_CHANGED'});
 try{await entered.promise;assert.equal(settled,false);assert(f.state.active);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});
  if(mode==='account-change')f.state.wrongPXE=true;gate.resolve();assert.equal(await observed,undefined);assert.equal(f.state.active,false);assert.equal(f.state.sends,0);assert.equal(calls,1);
 }finally{gate.resolve();f.state.wrongPXE=false;await session.close();}
});
test('background screening uses the current native anchored cache for each selected deposit and does not retain hints',async()=>{
 const {withCache}=await import('../../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js');
 const f=await sessionFixture();let anchor={number:10,hash:BlockHash.fromString(hex(55))},requests=0,utilities=0;
 const node=withCache({findLeavesIndexes:async(reference,tree,values)=>{requests++;assert.equal(reference.hash.toString(),anchor.hash.toString());return values.map(()=>undefined);}});
 const original=f.input.sdk.Contract.at;
 f.input.sdk.Contract.at=(...args)=>{const board=original(...args);return {...board,methods:{...board.methods,get_screen_hints:(owner,deposit)=>({simulate:async()=>{
  utilities++;await node.findLeavesIndexes(anchor,1,[deposit]);return {result:[null,null]};
 }})}};};
 const session=await createRollingWalletSession(f.input);
 try{
  assert.equal(await session.preparePostingState('9'),undefined);await session.preparePostingState('9');assert.equal(utilities,2);assert.equal(requests,1);
  await session.preparePostingState('10');assert.equal(requests,2);
  anchor={number:11,hash:BlockHash.fromString(hex(56))};await session.preparePostingState('9');assert.equal(requests,3);
  anchor={number:10,hash:BlockHash.fromString(hex(57))};node.wipeCache();await session.preparePostingState('9');assert.equal(requests,4);
  assert.equal(f.state.syncs,5,'each warm still synchronizes natively');assert.equal(f.state.sends,0);
 }finally{await session.close();}
});
test('invalid background screening selection fails before acquiring an operation or native access',async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),before=f.state.events.length;
 try{for(const deposit of [undefined,null,9,{},'0',hex(0),'09','-1','0x9'])await assert.rejects(session.preparePostingState(deposit),{code:'ROLLING_INVALID_ACTION'});
  assert.equal(f.state.events.length,before);
 }finally{await session.close();}
});

test('Post reexecutes screening for its own deposit after background preparation',async()=>{
 const f=await sessionFixture(),seen=[],original=f.input.sdk.Contract.at;
 f.input.sdk.Contract.at=(...args)=>{const board=original(...args);return {...board,methods:{...board.methods,get_deposit_info:(owner,deposit)=>({simulate:async()=>({result:[1n,BigInt(deposit.toString()),100n,BigInt(eth(33)),0n,0n,0n,0n,0n,100n,56n]})}),post:(...args)=>({args}),get_screen_hints:(owner,deposit)=>({simulate:async()=>{
  seen.push(BigInt(deposit.toString()));return {result:decodeFromAbi(getFunctionReturnType(artifact.functions.find(fn=>fn.name==='get_screen_hints')),Array.from({length:28},()=>Fr.ZERO))};
 }})}};};
 const publicRead=f.node.getPublicStorageAt;f.node.getPublicStorageAt=async(reference,address,slot)=>slot.equals(artifact.storageLayout.main_version.slot)?Fr.ONE:publicRead(reference,address,slot);
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10,timestamp:100n},hash:async()=>BlockHash.fromString(hex(55))});
 f.input.sdk.ordinaryPostFeeBudget=()=>({maximumFee:100n});f.input.sdk.prefetchOrdinaryPostWitnesses=async()=>{};
 const session=await createRollingWalletSession(f.input),stop=Error('stop before proof');
 try{await session.preparePostingState('9');const syncs=f.state.syncs;
  await assert.rejects(session.application.executeAction({type:'post',deposit:'10',content:'Fresh authoritative selection'},{onPrepared:()=>{throw stop;}}),e=>e===stop);
  assert.deepEqual(seen,[9n,10n]);assert.equal(f.state.syncs,syncs+1);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
 }finally{await session.close();}
});

for(const outcome of ['success','failure','account-change'])test(`composer native witness preparation drains under its existing lease: ${outcome}`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let calls=0;
 f.input.sdk.prefetchOrdinaryPostWitnesses=async input=>{
  calls++;assert(f.state.active);assert.equal(input.owner.toString(),f.input.account.address);assert.equal(input.wallet,f.wallet);assert.equal(input.node,f.node);
  assert.equal(input.board.address.toString(),f.input.config.board.contractAddress);assert.equal(input.artifact.name,artifact.name);assert.equal(input.artifact.storageLayout.posts.slot.toString(),artifact.storageLayout.posts.slot.toString());assert.deepEqual(input.hints,[null,null]);
  entered.resolve();await gate.promise;assert(f.state.active);if(outcome==='failure')throw Error('required witness failed');
 };
 const session=await createRollingWalletSession(f.input);let done=false;
 const run=session.preparePostingState('9').finally(()=>{done=true;});const observed=outcome==='success'?run:assert.rejects(run,outcome==='failure'?/required witness failed/:{code:'ROLLING_CONTEXT_CHANGED'});
 try{await entered.promise;assert.equal(done,false);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_BUSY'});
  if(outcome==='account-change')f.state.wrongPXE=true;gate.resolve();await observed;
  assert.equal(calls,1);assert.equal(f.state.events.filter(x=>x==='screen-hints').length,1);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
 }finally{gate.resolve();f.state.wrongPXE=false;await session.close();}
});

for(const kind of ['collateral','bok','cancellation'])test(`${kind} withdrawal confirms one immutable proof and freshly fences receipt/header before send`,async()=>{
 const f=await withdrawalFixture({bok:kind==='bok',cancellation:kind==='cancellation'}),counts={};
 for(const name of ['getTxReceipt','getTxEffect','getL2ToL1MembershipWitness','getBlockData']){
  const original=f.opts.node[name];f.opts.node[name]=async(...args)=>{counts[name]=(counts[name]??0)+1;return original(...args);};
 }
 await f.cap.prepare({maximumGasWei:'1000'});for(const name of Object.keys(counts))counts[name]=0;
 assert.equal((await f.cap.confirm()).status,'refunded');assert.equal(f.state.sends,1);
 assert.deepEqual(counts,{getTxReceipt:2,getTxEffect:1,getL2ToL1MembershipWitness:1,getBlockData:2});
});
for(const changed of ['fork','receipt-block','receipt-revert','chain'])test(`withdrawal final authority catches ${changed} after immutable proof capture`,async()=>{
 const f=await withdrawalFixture();await f.cap.prepare({maximumGasWei:'1000'});
 f.state.onFees=()=>{
  if(changed==='fork')f.state.l2Fork=true;
  if(changed==='chain')f.state.chainId='1';
  if(changed.startsWith('receipt'))f.opts.node.getTxReceipt=async()=>({txHash:f.record.txHash,status:'checkpointed',executionResult:changed==='receipt-revert'?'app_logic_reverted':'success',blockNumber:2,blockHash:hex(43)});
 };
 await assert.rejects(f.cap.confirm());assert.equal(f.state.sends,0);
});
test('withdrawal final parallel authority check drains a held receipt when network read rejects',async()=>{
 const f=await withdrawalFixture(),held=Promise.withResolvers(),started=Promise.withResolvers();await f.cap.prepare({maximumGasWei:'1000'});
 const receipt=f.opts.node.getTxReceipt,network=f.opts.provider.getNetwork;let final=false,finished=false;
 f.state.onFees=()=>{final=true;};f.opts.node.getTxReceipt=async(...args)=>{if(final){started.resolve();await held.promise;}return receipt(...args);};
 // The provider adapter captures methods at creation, so reconstruct before preparing.
 f.opts.provider.getNetwork=async()=>{if(final)throw Error('Network unavailable');return network();};
 const cap=f.restart();await cap.prepare({maximumGasWei:'1000'});final=false;
 const run=cap.confirm().finally(()=>{finished=true;});const rejected=assert.rejects(run);
 await started.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 held.resolve();await rejected;assert.equal(f.state.sends,0);
});

test('deposit refund waits under its account lease then prepares immediate generic-fee cancellation without estimating',async()=>{
 const f=await sessionFixture(),entered=Promise.withResolvers(),release=Promise.withResolvers();let estimates=0;
 const receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44),depositId:hex(45)};
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10},hash:async()=>hex(55),state:{l1ToL2MessageTree:{root:new Fr(1)}}});
 f.input.sdk.waitForL1ToL2MessageReady=async(node,key,options)=>{assert.equal(node,f.node);assert.equal(String(key),receipt.messageKey);assert.deepEqual(options,{timeoutSeconds:0,chainTip:'proposed'});assert.equal(f.state.active,true);entered.resolve();await release.promise;};
 f.input.sdk.prepareFundingClaim=async input=>{assert.equal(f.state.active,true);assert.equal(input.kind,'collateral-cancel');assert.deepEqual(input.receipt,receipt);return {status:'claim-ready',claim:{contract:String(f.board.address),method:'cancel_deposit',args:[receipt.sender,receipt.amount,receipt.depositId,receipt.leafIndex]}};};
 f.input.sdk.estimatePrivateFeeTransaction=async()=>{estimates++;throw Error('No review estimate');};
 const original=f.input.sdk.Contract.at;f.input.sdk.Contract.at=(...args)=>{const c=original(...args);c.methods.cancel_deposit=(...values)=>({args:values});return c;};
 const session=await createRollingWalletSession(f.input),pending=session.depositRefunds.prepare(receipt);await entered.promise;
 assert.equal(f.state.active,true);assert.equal(estimates,0);assert.equal(f.state.sends,0);release.resolve();
 const prepared=await pending;assert.equal(prepared.status,'prepared');assert.equal(prepared.maximumFee,normalizePrivateFeeGasSettings(f.options.config.privateFee.gasSettings).maximumFee.toString());
 assert.equal(prepared.withdrawal.depositor,receipt.sender);assert.equal(prepared.withdrawal.depositId,receipt.depositId);assert.equal(estimates,0);assert.equal(f.state.active,false);await session.close();
});

test('display-only included observer uses actual NodeBlockProvider projection and keeps transient reads uncertain',async()=>{
 const {NodeBlockProvider}=await import(new URL('./modules/node_block_provider.js',import.meta.resolve('@aztec-labs/aztec-node')));
 const txHash=hex(90),blockHash=BlockHash.fromString(hex(91)),inclusion={blockNumber:12,blockHash:blockHash.toString()};
 let status='proposed',executionResult='success',canonical=blockHash,absent=false,guards=0;
 const header={globalVariables:{blockNumber:12},getBlockNumber:()=>12};
 const provider=new NodeBlockProvider({}, {getBlockData:async()=>absent?undefined:{header,blockHash:canonical,archive:{},checkpointNumber:1,indexWithinCheckpoint:0}});
 const sdk={TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn()},node={getTxReceipt:async hash=>({txHash:hash,status,executionResult,blockNumber:12,blockHash}),getBlock:(...args)=>provider.getBlock(...args)};
 const opts={sdk,node,contextGuard:async()=>guards++},input={txHash,inclusion};
 assert.equal(typeof (await node.getBlock(12)).hash,'object','native RPC returns projected hash data, not L2Block.hash()');
 assert.equal((await observeIncludedTransaction(opts,input)).status,'included');assert.equal(guards,4);
 for(const transient of ['pending','dropped']){status=transient;assert.equal((await observeIncludedTransaction(opts,input)).status,'unknown');absent=true;assert.equal((await observeIncludedTransaction(opts,input)).status,'unknown');absent=false;}
 status='checkpointed';assert.equal((await observeIncludedTransaction(opts,input)).status,'confirmed');
 status='proposed';absent=true;assert.equal((await observeIncludedTransaction(opts,input)).status,'unknown');absent=false;
 canonical=BlockHash.fromString(hex(92));assert.equal((await observeIncludedTransaction(opts,input)).status,'orphaned');
 status='pending';assert.equal((await observeIncludedTransaction(opts,input)).status,'orphaned');
 canonical=blockHash;status='proposed';executionResult='reverted';assert.equal((await observeIncludedTransaction(opts,input)).status,'reverted');
 node.getTxReceipt=async()=>({txHash:hex(99)});await assert.rejects(observeIncludedTransaction(opts,input),{code:'ROLLING_INVALID_RESPONSE'});
 await assert.rejects(observeIncludedTransaction(opts,{txHash}),{code:'ROLLING_INVALID_ACTION'});
});

test('included observer detaches saved anchor, rejects account change, and never treats an inconsistent receipt as a fork',async()=>{
 const txHash=hex(90),blockHash=hex(91),gate=Promise.withResolvers(),entered=Promise.withResolvers();let current=true;
 const input={txHash,inclusion:{blockNumber:12,blockHash}},heights=[];
 const sdk={TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn()},node={getTxReceipt:async()=>{entered.resolve();await gate.promise;return {txHash,status:'pending'};},getBlock:async number=>{heights.push(number);return {header:{globalVariables:{blockNumber:number}},hash:blockHash};}};
 const opts={sdk,node,contextGuard:async()=>{if(!current)throw Error('account changed');}};
 const pending=observeIncludedTransaction(opts,input);await entered.promise;input.inclusion.blockNumber=99;input.inclusion.blockHash=hex(99);gate.resolve();
 assert.equal((await pending).status,'unknown');assert.deepEqual(heights,[12]);
 node.getTxReceipt=async()=>({txHash,status:'proposed',executionResult:'success',blockNumber:12,blockHash:hex(92)});
 assert.equal((await observeIncludedTransaction(opts,{txHash,inclusion:{blockNumber:12,blockHash}})).status,'unknown','saved inclusion remains canonical despite inconsistent new receipt');
 node.getTxReceipt=async()=>{current=false;return {txHash,status:'pending'};};
 await assert.rejects(observeIncludedTransaction(opts,{txHash,inclusion:{blockNumber:12,blockHash}}),/account changed/);
});

test('included claim verification is explicit and rejects orphaned or failed proposed receipts',async()=>{
 const receipt={txHash:hex(91),status:'proposed',executionResult:'success',blockNumber:3,blockHash:hex(92)};let canonical=true;
 const input={sdk:{TxHash:{fromString:value=>value},boundedTransactionRead:fn=>fn(),requireSuccessfulReceipt},node:{getTxReceipt:async()=>receipt,getBlock:async()=>({hash:canonical?hex(92):hex(93)})},txHash:hex(91),contextGuard:async()=>{}};
 await assert.rejects(verifyRollingTopupClaim(input));await verifyRollingTopupClaim({...input,confirmationTier:'proposed'});canonical=false;await assert.rejects(verifyRollingTopupClaim({...input,confirmationTier:'proposed'}));canonical=true;receipt.executionResult='reverted';await assert.rejects(verifyRollingTopupClaim({...input,confirmationTier:'proposed'}));
});
test('proposed funding continuation releases at exact included claim without weakening incoming bridge readiness',async()=>{
 const f=continuationFixture(),txHash=TxHash.fromString(hex(87));let reconciles=0,records=0;
 f.input.confirmationTier='proposed';f.input.funding.inspect=async()=>({paymentSaved:true,privateFeeCap:'10',claim:{intentId:f.prepared.intentId,attempted:true}});
 f.input.application.reconcile=async()=>({...f.prepared,txHash:txHash.toString(),status:++reconciles===1?'unknown':'included'});
 f.input.funding.recordClaimCompletion=async value=>{assert.equal(value.status,'included');records++;};
 f.input.node.getTxReceipt=async hash=>{assert(hash.equals(txHash));return MinedTxReceipt.from({txHash,status:'proposed',executionResult:'success',transactionFee:1n,blockHash:BlockHash.fromString(hex(86)),blockNumber:8,slotNumber:8,epochNumber:0,txIndexInBlock:0});};
 assert.equal((await createFundingContinuation(f.input).advanceClaim()).state,'included');assert.equal(reconciles,2);assert.equal(records,1);assert.equal(f.busy,false);assert(!f.calls.some(c=>c[0]==='submit'));
});

for(const bok of [false,true])test(`final L1 ${bok?'Bok':'collateral'} gas and fee reads overlap in both review and confirmation`,async()=>{
 const f=await withdrawalFixture({bok});let wave=0,started=0,gate,entered;
 const arm=()=>{wave++;started=0;gate=Promise.withResolvers();entered=Promise.withResolvers();};
 const mark=()=>{if(++started===2)entered.resolve();};
 f.opts.provider.estimateGas=async()=>{mark();await gate.promise;return 100n;};f.opts.provider.getFeeData=async()=>{mark();await gate.promise;return {gasPrice:2n};};
 const cap=f.restart();arm();let done=false;const preparing=cap.prepare({maximumGasWei:'1000'}).then(x=>{done=true;return x;});await entered.promise;assert.equal(done,false);assert.equal(started,2);gate.resolve();await preparing;
 arm();done=false;const confirming=cap.confirm().then(x=>{done=true;return x;});await entered.promise;assert.equal(done,false);assert.equal(f.state.sends,0);gate.resolve();assert.equal((await confirming).status,'refunded');assert.equal(f.state.sends,1);assert.equal(wave,2);
});
for(const phase of ['prepare','confirm'])test(`final L1 ${phase} fee failure drains held estimate and never sends`,async()=>{
 const f=await withdrawalFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let failing=false,started=0,done=false;
 f.opts.provider.estimateGas=async()=>{if(failing){if(++started===2)entered.resolve();await gate.promise;}return 100n;};
 f.opts.provider.getFeeData=()=>{if(failing){if(++started===2)entered.resolve();throw Error('fees unavailable');}return {gasPrice:2n};};
 const cap=f.restart();if(phase==='confirm')await cap.prepare({maximumGasWei:'1000'});failing=true;
 const work=(phase==='prepare'?cap.prepare({maximumGasWei:'1000'}):cap.confirm()).then(()=>assert.fail('must reject'),()=>{done=true;});await entered.promise;assert.equal(done,false);assert.equal(f.state.sends,0);gate.resolve();await work;assert.equal(f.state.sends,0);
});

for(const kind of ['collateral','bok','cancellation'])test(`exit membership ${kind} starts four independent reads and fences canonical block after completion`,async()=>{
 const f=await withdrawalFixture({bok:kind==='bok',cancellation:kind==='cancellation'}),gate=Promise.withResolvers(),entered=Promise.withResolvers();let starts=0,blocks=0,done=false;
 const wrap=(target,name)=>{const original=target[name];target[name]=async(...args)=>{if(++starts===4)entered.resolve();await gate.promise;return original(...args);};};
 wrap(f.opts.provider,'getNetwork');for(const name of ['getTxReceipt','getTxEffect','getL2ToL1MembershipWitness'])wrap(f.opts.node,name);
 const block=f.opts.node.getBlockData;f.opts.node.getBlockData=async(...args)=>{blocks++;assert.equal(starts,4);return block(...args);};
 const work=f.restart().inspect().then(value=>{done=true;return value;});await entered.promise;assert.equal(done,false);assert.equal(blocks,0);gate.resolve();assert.equal((await work).txHash,f.record.txHash);assert.equal(blocks,1);assert.equal(f.state.sends,0);
});
for(const failed of ['getNetwork','getTxReceipt','getTxEffect','getL2ToL1MembershipWitness'])test(`exit membership ${failed} synchronous failure drains all siblings without a canonical query`,async()=>{
 const f=await withdrawalFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let starts=0,done=false,blocks=0;const failure=Error('read failed');
 const wrap=(target,name)=>{const original=target[name];target[name]=(...args)=>{if(++starts===4)entered.resolve();if(name===failed)throw failure;return gate.promise.then(()=>original(...args));};};
 wrap(f.opts.provider,'getNetwork');for(const name of ['getTxReceipt','getTxEffect','getL2ToL1MembershipWitness'])wrap(f.opts.node,name);
 f.opts.node.getBlockData=async()=>{blocks++;throw Error('must not start');};
 const work=assert.rejects(f.restart().inspect(),error=>error===failure).then(()=>done=true);await entered.promise;assert.equal(done,false);assert.equal(blocks,0);gate.resolve();await work;assert.equal(blocks,0);assert.equal(f.state.sends,0);
});
for(const changed of ['network','receipt','effect','witness','canonical'])test(`exit membership rejects changed ${changed} after the parallel wave`,async()=>{
 const f=await withdrawalFixture();
 if(changed==='network')f.state.chainId='1';
 if(changed==='receipt')f.opts.node.getTxReceipt=async()=>({txHash:f.record.txHash,status:'proposed',executionResult:'success',blockNumber:1,blockHash:hex(42)});
 if(changed==='effect'){const original=f.opts.node.getTxEffect;f.opts.node.getTxEffect=async()=>({...await original(),l2BlockHash:hex(43)});}
 if(changed==='witness')f.opts.node.getL2ToL1MembershipWitness=async()=>null;
 if(changed==='canonical')f.opts.node.getBlockData=async()=>({header:{globalVariables:{blockNumber:1}},blockHash:hex(43)});
 await assert.rejects(f.restart().prepare());assert.equal(f.state.sends,0);
});

for(const staleHint of [false,true])test(`withdrawal cooldown observes proposed maturity and rechecks native anchor, staleHint=${staleHint}`,async()=>{
 const f=await sessionFixture(),contractAt=f.input.sdk.Contract.at,block=f.node.getBlockData,sync=f.pxe.sync;let matured=false,polls=0,prepared=false,opened=false,waits=0;
 const header=()=>({globalVariables:{blockNumber:matured?11:10,timestamp:matured?200n:100n},hash:async()=>BlockHash.fromString(hex(55))});
 f.pxe.getSyncedBlockHeader=async()=>header();
 f.pxe.sync=async()=>{await sync();if(polls===2&&!staleHint)matured=true;};
 f.node.getBlockData=async number=>{
  if(!opened)return block(number);
  if(number==='proposed'){assert(f.state.active);polls++;return {blockHash:hex(55),header:{globalVariables:{blockNumber:11,timestamp:polls===1?199n:200n}}};}
  if(number==='checkpointed')throw Error('checkpoint timestamp must not delay proposed-native eligibility');
  const result=await block(number);return {...result,header:{globalVariables:{blockNumber:Number(number),timestamp:matured?200n:100n}}};
 };
 f.input.sdk.Contract.at=(...args)=>{const contract=contractAt(...args);return {...contract,methods:{...contract.methods,
  get_deposit_info:()=>({simulate:async()=>({result:[1n,9n,100n,BigInt(eth(33)),0n,1n,0n,1n,1n,200n,56n]})}),withdraw:()=>({name:'withdraw'})}};};
 f.input.sdk.retryUntil=async(callback,label,timeout)=>{if(++waits===2){assert(staleHint);throw stop;}assert.equal(label,'withdrawal availability');assert.equal(timeout,0);assert.equal(await callback(),false);assert.equal(await callback(),true);};
 const stop=Error('qualified native exit preparation');
 f.input.sdk.estimatePrivateFeeTransaction=async()=>{assert(matured);assert.equal(f.state.syncs,2);prepared=true;throw stop;};
 const session=await createRollingWalletSession(f.input);opened=true;
 await assert.rejects(session.application.executeWithdrawal('9'),error=>error===stop);assert.equal(prepared,!staleHint);assert.equal(waits,staleHint?2:1);assert.equal(polls,2);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);await session.close();
});

test('native message readiness recognizes actual proposed insertion before checkpoint without optimistic membership',async()=>{
 const key=new Fr(71);let index=5n,next=6n,blocks=0;
 const node={getL1ToL2MessageIndex:async received=>{assert(received.equals(key));return index;},getBlockData:async tier=>{blocks++;return {header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:tier==='proposed'?next:5n}}}};}};
 assert.equal(await isL1ToL2MessageReady(node,key,'proposed'),true);assert.equal(await isL1ToL2MessageReady(node,key,'checkpointed'),false);
 next=5n;assert.equal(await isL1ToL2MessageReady(node,key,'proposed'),false);
 next=4n;assert.equal(await isL1ToL2MessageReady(node,key,'proposed'),false);
 index=undefined;const before=blocks;assert.equal(await isL1ToL2MessageReady(node,key,'proposed'),false);assert.equal(blocks,before);
});
for(const reorg of [false,true])test(`explicit proposed bridge readiness still requires fresh claim preparation, reorg=${reorg}`,async()=>{
 const f=continuationFixture();f.input.bridgeChainTip='proposed';let preparations=0,heads=0;
 f.input.node.getBlockData=async tier=>{assert.equal(tier,'proposed');heads++;return {header:{state:{l1ToL2MessageTree:{nextAvailableLeafIndex:2}}}};};
 f.input.application.prepare=async()=>{f.calls.push(['prepare']);preparations++;if(reorg)throw Object.assign(Error('canonical membership changed'),{code:'ROLLING_FUNDING_REORG'});return f.prepared;};
 const work=createFundingContinuation(f.input).advanceClaim();
 if(reorg)await assert.rejects(work,{code:'ROLLING_FUNDING_REORG'});else assert.equal((await work).state,'complete');
 assert.equal(preparations,1);assert.equal(heads,3);assert.equal(f.calls.filter(c=>c[0]==='submit').length,reorg?0:1);assert.equal(f.busy,false);
});
test('bridge readiness tip requires explicit supported policy before starting any work',()=>{
 const f=continuationFixture();for(const bridgeChainTip of ['latest','pending',null,{}])assert.throws(()=>createFundingContinuation({...f.input,bridgeChainTip}),{code:'ROLLING_SESSION_CONFIG'});assert.equal(f.calls.length,0);
});

for(const phase of ['proposed','checkpointed','proven','dropped','reverted','fork'])test('pending exit observation is finite and read-only for '+phase,async()=>{
 const f=await withdrawalFixture(),before=[...f.values];f.state.l2Status=phase==='fork'?'proven':phase==='reverted'?'proposed':phase;
 if(phase==='reverted'){const get=f.opts.node.getTxReceipt;f.opts.node.getTxReceipt=async()=>({...await get(),executionResult:'app_logic_reverted'});}
 if(phase==='dropped')f.opts.node.getTxEffect=async()=>undefined;
 if(phase==='fork')f.state.l2Fork=true;
 f.opts.sdk.waitForTx=()=>assert.fail('Readiness must not poll');f.opts.captureWallet=()=>assert.fail('Readiness needs no connected Ethereum wallet');
 const cap=f.restart();
 if(phase==='fork')await assert.rejects(cap.observe(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});
 else assert.deepEqual(await cap.observe(),{status:phase==='proven'?'ready':['dropped','reverted'].includes(phase)?'unknown':'waiting',intentId:f.record.intentId,txHash:f.record.txHash});
 assert.equal(f.state.sends,0);assert.equal(f.state.calls,0);assert.deepEqual([...f.values],before);
});
test('pending exit readiness cannot authorize a refund after proof status regresses',async()=>{
 const f=await withdrawalFixture();assert.equal((await f.cap.observe()).status,'ready');f.state.l2Status='proposed';
 await assert.rejects(f.cap.prepare(),{code:'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED'});assert.equal(f.state.sends,0);assert.equal(f.state.calls,0);assert.equal((await f.pendingSlot.read()).value.paymentStatus,'pending');
});
test('pending exit payment commit failure retains exact Ethereum success for read-only reconciliation',async()=>{
 const f=await withdrawalFixture(),cas=f.opts.storage.compareAndSwap;await f.cap.prepare();
 // The encrypted slot key is intentionally opaque; capture its authenticated ciphertext instead.
 const original=(await f.pendingSlot.read()).encoded;
 f.opts.storage.compareAndSwap=async(key,previous,next)=>{if(previous===original)throw Error('pending write unavailable');return cas(key,previous,next);};
 await assert.rejects(f.cap.confirm(),{code:'BB_JOURNAL_INVALID'});assert.equal(f.state.sends,1);assert.equal((await f.pendingSlot.read()).value.paymentStatus,'pending');
 f.opts.storage.compareAndSwap=cas;assert.equal((await f.restart().recover()).status,'refunded');assert.equal(f.state.sends,1);
 assert.equal((await f.pendingSlot.read()).value.paymentStatus,'refunded');assert.equal((await f.cap.observe()).status,'none');
});
async function pendingExitSessionFixture(){
 const f=await sessionFixture(),w=await withdrawalFixture({scopeOverride:{account:f.input.account.address,board:String(f.board.address)}});
 Object.assign(w.opts,{storage:f.privateStore,walletSecret:f.input.account.secretKey,walletSalt:f.input.account.salt});
 const slot=await createPendingWithdrawalSlot(w.opts);await slot.write(await slot.read(),{...w.record,status:'included',paymentStatus:'pending'});
 const block=f.node.getBlockData;Object.assign(f.node,{...w.opts.node,getBlockData:n=>n===1?w.opts.node.getBlockData(n):block(n)});
 const Original=f.input.ethers.JsonRpcProvider;let opened=0;w.opts.provider.destroy=()=>{};
 f.input.ethers={...f.input.ethers,...w.opts.ethers,JsonRpcProvider:class{constructor(url){return ++opened===1?new Original(url):w.opts.provider;}}};
 Object.assign(f.input.sdk,{computeL2ToL1MessageHash,EthAddress,TxHash});
 // External account identity guards are also used by public-only receipt observers.
 // Native PXE methods above still require the actual account lease.
 const identity=f.input.account.address;f.input.contextGuard=async()=>assert.equal(f.input.account.address,identity);
 return {f,w,slot,session:await createRollingWalletSession(f.input)};
}
for(const close of [false,true])test('pending exit public readiness does not hold the native account lease, close='+close,async()=>{
 const {f,w,session}=await pendingExitSessionFixture();f.storage.set(BigInt(artifact.storageLayout.moderator.slot),3n);const gate=Promise.withResolvers(),started=Promise.withResolvers();
 const get=f.node.getL2ToL1MembershipWitness;f.node.getL2ToL1MembershipWitness=async(...args)=>{started.resolve();await gate.promise;return get(...args);};
 const observed=session.withdrawal.observe();observed.catch(()=>{});let closing;
 try{
  await Promise.race([started.promise,observed.then(()=>{throw Error('Expected held membership read');})]);
  assert.equal(session.busy,false);assert.equal(f.state.active,false);assert.equal(w.state.sends,0);
  if(close)closing=session.close();else{assert.deepEqual(await session.application.readModeratorStatus(),{authorized:false});assert.equal(f.state.active,false);}
  gate.resolve();if(close){await assert.rejects(observed);await closing;}else assert.equal((await observed).status,'ready');
  assert.equal(w.state.sends,0);
 }finally{gate.resolve();await observed.catch(()=>{});await (closing??session.close());}
});

test('Bok public exit observation cannot initialize optional native state or authorize payment',async()=>{
 const f=await withdrawalFixture({bok:true}),blocked=Error('Contract binding requires the owning private lease');
 f.opts.resolveBokScope=async()=>{throw blocked;};const cap=f.restart();assert.equal((await cap.observe()).status,'ready');
 await assert.rejects(cap.prepare(),error=>error===blocked);assert.equal(f.state.sends,0);assert.equal(f.state.calls,0);
});




import {waitForTx as nativeWaitForTx} from '@aztec-labs/aztec.js/node';
for(const change of ['ready','abort','account','reverted'])test('pending exit native proof waiter is public-only and stops exactly: '+change,async()=>{
 const {f,w,session}=await pendingExitSessionFixture(),gate=Promise.withResolvers(),started=Promise.withResolvers(),controller=new AbortController();
 const get=f.node.getTxReceipt;f.node.getTxReceipt=async(...args)=>{started.resolve();await gate.promise;return MinedTxReceipt.from({...await get(...args),txHash:TxHash.fromString(w.record.txHash),status:'proven',executionResult:change==='reverted'?'app_logic_reverted':'success',transactionFee:1n,blockHash:BlockHash.fromString(hex(42)),slotNumber:1,epochNumber:0,txIndexInBlock:0});};
 // Exact pinned native waiter, no simulated timer progression or alternate scheduler.
 f.input.sdk.waitForTx=nativeWaitForTx;
 const waiting=session.withdrawal.waitUntilReady({signal:controller.signal});waiting.catch(()=>{});
 try{
  await started.promise;assert.equal(session.busy,false);assert.equal(f.state.active,false);assert.equal(w.state.sends,0);
  if(change==='abort')controller.abort();if(change==='account')f.input.account.salt='99';gate.resolve();
  if(['abort','account'].includes(change))await assert.rejects(waiting);else assert.equal((await waiting).status,change==='reverted'?'unknown':'ready');
  assert.equal(w.state.sends,0);assert.equal(w.state.calls,0);
 }finally{gate.resolve();await waiting.catch(()=>{});f.input.account.salt=w.opts.walletSalt;await session.close();}
});

for(const kind of ['private-fee','bok'])for(const fail of [false,true])test(`top-up ${kind} binding wave drains independent reads before ${fail?'failure':'return'}`,async()=>{
 const {input,abi,portal,token,recipient}=topupScopeFixture(kind);const names=kind==='bok'?['token','escrow','version','chainId','active','inbox','outbox']:['ROLLUP','UNDERLYING','VERSION','L2_TOKEN_ADDRESS'];
 const gates=new Map(names.map(name=>[name,Promise.withResolvers()])),entered=Promise.withResolvers(),seen=[],call=input.provider.call,blocks=[],getBlock=input.provider.getBlock;
 input.provider.getBlock=async tag=>{blocks.push(tag);return getBlock(tag);};input.provider.call=async request=>{const name=abi.parseTransaction(request).name;seen.push(name);if(gates.has(name)){if(seen.length===names.length)entered.resolve();await gates.get(name).promise;}return call(request);};
 let done=false;const pending=verifyRollingTopupScope(input).finally(()=>done=true),failure=Error('labelled binding failure');const result=fail?assert.rejects(pending,error=>error===failure):pending;
 await entered.promise;assert.deepEqual(seen,names);assert.deepEqual(blocks,['latest']);if(fail)gates.get(names[0]).reject(failure);else gates.get(names[0]).resolve();
 await new Promise(setImmediate);assert.equal(done,false);assert(!seen.includes('decimals'));for(const name of names.slice(1))gates.get(name).resolve();
 const value=await result;if(!fail){assert.deepEqual(value,{portal,token,recipient});assert.deepEqual(seen,[...names,'decimals']);assert.deepEqual(blocks,['latest',10]);}else{assert.deepEqual(seen,names);assert.deepEqual(blocks,['latest']);}
});
for(const change of ['l1-anchor','context'])test(`top-up bindings reject ${change} changed while independent reads are pending`,async()=>{
 const {input,abi}=topupScopeFixture('bok'),held=Promise.withResolvers(),entered=Promise.withResolvers(),call=input.provider.call,getBlock=input.provider.getBlock;let changed=false;
 input.provider.call=async request=>{if(abi.parseTransaction(request).name==='outbox'){entered.resolve();await held.promise;}return call(request);};
 input.contextGuard=async()=>{if(changed&&change==='context')throw Error('labelled account changed');};input.provider.getBlock=async tag=>{const block=await getBlock(tag);return changed&&tag!=='latest'&&change==='l1-anchor'?{...block,hash:hex(11)}:block;};
 const result=assert.rejects(verifyRollingTopupScope(input),change==='l1-anchor'?{code:'ROLLING_SESSION_CONFIG'}:/account changed/);await entered.promise;changed=true;held.resolve();await result;
});


for(const phase of ['initial','recheck'])for(const mode of ['success','l2-failure','l1-failure','context',...(phase==='initial'?['inspection-failure']:[])])test('aggregate scope wave drains '+phase+' '+mode,{timeout:3000},async()=>{
 const scope={feePortal:eth(1),bokPortal:eth(2),feeToken:eth(3),bokToken:eth(4)},abi=new Interface(['function UNDERLYING() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)']);
 const gates=[Promise.withResolvers(),Promise.withResolvers(),Promise.withResolvers()],entered=Promise.withResolvers(),error=Error('scope failure');let active=phase==='initial',started=0,settled=false,changed=false,inspections=0,canonicalReads=0;const l1Tags=[];
 const wave=i=>{if(!active)return Promise.resolve();if(++started===(phase==='initial'?3:2))entered.resolve();if(mode===(i===0?'l2-failure':i===1?'l1-failure':'inspection-failure')){gates[i].resolve();throw error;}return gates[i].promise;};
 const node={getL1ContractAddresses:async()=>({feeJuicePortalAddress:scope.feePortal}),getBlockData:async tag=>{if(tag!== 'checkpointed'){canonicalReads++;await wave(0);}return {header:{globalVariables:{blockNumber:10}},blockHash:hex(10)};},getPublicStorageAt:async()=>new Fr(BigInt(scope.bokPortal))};
 const provider={getBlock:async tag=>{if(tag==='latest')await wave(1);return {number:20,hash:hex(20)};},call:async request=>{l1Tags.push(request.blockTag);const name=abi.parseTransaction(request).name;return abi.encodeFunctionResult(name,[name==='UNDERLYING'?scope.feeToken:name==='token'?scope.bokToken:request.to===scope.feeToken?18:6]);}};
 const options={sdk:{Fr,inspectTrustedNode:async()=>{inspections++;await wave(2);}},ethers:{Interface},node,provider,scope,bok:{address:hex(3)},bokArtifact:{storageLayout:{portal:{slot:1}}},network:{},proofsEnabled:false,contextGuard:async()=>{if(changed)throw error;}};
 let invoke=()=>verifyRollingAggregateScope(options);if(phase==='recheck'){invoke=await invoke();active=true;}
 const pending=invoke().finally(()=>settled=true),observed=mode==='success'?pending:assert.rejects(pending,e=>e===error);
 await entered.promise;assert.equal(started,phase==='initial'?3:2);if(mode==='context')changed=true;
 gates[mode==='l1-failure'?1:0].resolve();await new Promise(setImmediate);assert.equal(settled,false,'all other authorities must drain');
 gates.forEach(g=>g.resolve());await observed;assert.equal(inspections,1);assert.equal(canonicalReads,phase==='initial'?1:2);assert(l1Tags.every(tag=>tag===20));
});

async function revertedExitFixture(options){
 const f=await withdrawalFixture(options),capture=f.opts.captureWallet;
 f.opts.captureWallet=async()=>{const wallet=await capture(),send=wallet.signer.sendTransaction;return {...wallet,signer:{...wallet.signer,sendTransaction:async request=>{const result=await send(request);f.state.receipt.status=0;f.state.receipt.logs=[];return result;}}};};
 const cap=f.restart();await cap.prepare();await assert.rejects(cap.confirm(),{code:'BB_ETH_TRANSACTION_FAILED'});return f;
}
for(const options of [{},{bok:true},{cancellation:true}])test(`exit preparation reuse: saved reverted ${JSON.stringify(options)} authenticates receipt and membership once`,async()=>{
 const f=await revertedExitFixture(options),receipt=f.opts.provider.getTransactionReceipt,transaction=f.opts.provider.getTransaction,witness=f.opts.node.getL2ToL1MembershipWitness;let receipts=0,transactions=0,witnesses=0;
 f.opts.provider.getTransactionReceipt=async h=>{receipts++;return receipt(h);};f.opts.provider.getTransaction=async h=>{transactions++;return transaction(h);};f.opts.node.getL2ToL1MembershipWitness=async(...args)=>{witnesses++;return witness(...args);};
 const result=await f.restart().prepare();assert.equal(result.amount,'100');assert.equal(receipts,1);assert.equal(transactions,1);assert.equal(witnesses,1);assert.equal(f.state.sends,1);
});
for(const change of ['l1-fork','l2-fork','request','owner','paid'])test(`exit preparation reuse: ${change} cannot produce another refund quote`,async()=>{
 const f=await revertedExitFixture({});
 if(change==='l1-fork')f.state.fork=true;
 if(change==='l2-fork')f.state.l2Fork=true;
 if(change==='request')f.state.tx.nonce=99;
 if(change==='owner')f.state.guard=false;
 if(change==='paid'){f.state.receipt.status=1;const abi=new Interface(['event Withdrawn(address indexed depositor,uint128 amount,bytes32 indexed depositId)']);f.state.receipt.logs=[{address:f.opts.scope.portal,...abi.encodeEventLog('Withdrawn',[eth(33),100n,hex(56)])}];}
 await assert.rejects(f.restart().prepare());assert.equal(f.state.sends,1);
});
test('exit preparation reuse: saved receipt read completes before membership and quote',async()=>{
 const f=await revertedExitFixture({}),held=Promise.withResolvers(),entered=Promise.withResolvers(),receipt=f.opts.provider.getTransactionReceipt,witness=f.opts.node.getL2ToL1MembershipWitness;let witnesses=0,done=false;
 f.opts.provider.getTransactionReceipt=async h=>{entered.resolve();await held.promise;return receipt(h);};f.opts.node.getL2ToL1MembershipWitness=async(...args)=>{witnesses++;return witness(...args);};
 const work=f.restart().prepare().finally(()=>{done=true;});await entered.promise;assert.equal(witnesses,0);assert.equal(done,false);held.resolve();assert.equal((await work).amount,'100');assert.equal(witnesses,1);
});

for(const kind of ['private-fee','bok'])for(const failure of [null,'addresses','l1',...(kind==='bok'?['l2']:[])])test(`topup discovery wave: ${kind} ${failure??'success'} drains all initial reads`,async()=>{
 const {input}=topupScopeFixture(kind),names=['addresses','l1',...(kind==='bok'?['l2']:[])],held=Promise.withResolvers(),entered=Promise.withResolvers(),started=[],error=Error('discovery failed');
 const wrap=(name,fn)=>async(...args)=>{started.push(name);if(started.length===names.length)entered.resolve();if(name===failure)throw error;await held.promise;return fn(...args);};
 input.node.getL1ContractAddresses=wrap('addresses',input.node.getL1ContractAddresses);
 const getBlock=input.provider.getBlock;input.provider.getBlock=(tag,...args)=>tag==='latest'?wrap('l1',getBlock)(tag,...args):getBlock(tag,...args);
 const getData=input.node.getBlockData;input.node.getBlockData=(tag,...args)=>tag==='checkpointed'?wrap('l2',getData)(tag,...args):getData(tag,...args);
 let calls=0,done=false;const call=input.provider.call;input.provider.call=async(...args)=>{calls++;return call(...args);};
 const pending=verifyRollingTopupScope(input).finally(()=>done=true),result=failure?assert.rejects(pending,e=>e===error):pending;
 await entered.promise;assert.deepEqual(started,names);await new Promise(setImmediate);assert.equal(done,false);assert.equal(calls,0);held.resolve();await result;if(failure)assert.equal(calls,0);
});
for(const changed of ['context','l1','l2'])test(`topup discovery wave: ${changed} change before publication fails`,async()=>{
 const {input}=topupScopeFixture('bok'),held=Promise.withResolvers(),entered=Promise.withResolvers(),addresses=input.node.getL1ContractAddresses;let replace=false;
 input.node.getL1ContractAddresses=async()=>{entered.resolve();await held.promise;return addresses();};
 const block=input.provider.getBlock,data=input.node.getBlockData;
 input.contextGuard=async()=>{if(replace&&changed==='context')throw Error('owner changed');};
 input.provider.getBlock=async tag=>{const value=await block(tag);return replace&&changed==='l1'&&tag!=='latest'?{...value,hash:hex(99)}:value;};
 input.node.getBlockData=async tag=>{const value=await data(tag);return replace&&changed==='l2'&&tag!=='checkpointed'?{...value,blockHash:hex(99)}:value;};
 const result=assert.rejects(verifyRollingTopupScope(input));await entered.promise;replace=true;held.resolve();await result;
});

for(const mode of ['success','failure','account-change','anchor-change'])test(`composer fee display shares existing native preparation lease: ${mode}`,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let calls=0;
 const at=f.input.sdk.Contract.at;f.input.sdk.Contract.at=(...args)=>{const contract=at(...args);return {...contract,methods:{...contract.methods,balance_of:()=>({simulate:async()=>{assert(f.state.active);assert(f.state.events.includes('posting-witnesses'));calls++;entered.resolve();await gate.promise;if(mode==='failure')throw Error('fee display read failed');return {result:700n};}})}};};
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10,timestamp:100},hash:async()=>BlockHash.fromString(hex(55))});
 const session=await createRollingWalletSession(f.input);const syncs=f.state.syncs;let done=false;
 const run=session.preparePostingState('9',{refreshFeeCredit:true}).finally(()=>done=true);
 const observed=mode==='success'?run:assert.rejects(run,mode==='failure'?/fee display read failed/:mode==='account-change'?{code:'ROLLING_CONTEXT_CHANGED'}:{code:'ROLLING_CONTEXT_CHANGED'});
 try{await entered.promise;assert(!done);assert(f.state.active);assert.equal(f.state.syncs,syncs+1);await assert.rejects(session.close(),{code:'ROLLING_BUSY'});
  if(mode==='account-change')f.state.wrongPXE=true;if(mode==='anchor-change')f.node.getBlockData=async()=>({blockHash:Fr.fromString(hex(56)),header:{globalVariables:{blockNumber:10}}});gate.resolve();const result=await observed;
  if(mode==='success')assert.equal(result.availableCredit,'700');assert.equal(calls,1);assert.equal(f.state.syncs,syncs+1);assert.equal(f.state.sends,0);assert(!f.state.active);
 }finally{gate.resolve();f.state.wrongPXE=false;await session.close();}
});

for(const includeBok of [false,true])test(`funding waits for every recovered native message before its only full preparation, Bok=${includeBok}`,async()=>{
 const f=continuationFixture();if(!includeBok)delete f.receipts.bokReceipt;
 const count=Object.keys(f.receipts).length,release=[],entered=[];
 f.input.node.getL1ToL2MessageIndex=async key=>{entered.push(String(key));await new Promise(resolve=>release.push(resolve));return 1n;};
 const work=createFundingContinuation(f.input).advanceClaim();
 while(entered.length<count)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(entered,Object.values(f.receipts).map(row=>row.messageKey));assert(f.busy);
 assert(!f.calls.some(row=>['prepare','checkpoint','submit'].includes(row[0])));
 for(let i=0;i<count-1;i++){release[i]();await new Promise(resolve=>setImmediate(resolve));assert(!f.calls.some(row=>row[0]==='prepare'));}
 release.at(-1)();assert.equal((await work).state,'complete');assert.equal(f.calls.filter(row=>row[0]==='prepare').length,1);assert.equal(f.calls.filter(row=>row[0]==='submit').length,1);assert.equal(f.busy,false);
});
test('failed native bridge readiness drains all other incoming messages before releasing the account, without prepare or send',async()=>{
 const f=continuationFixture(),original=Error('native readiness unavailable');let release,entered=0;
 const held=new Promise(resolve=>release=resolve);
 f.input.node.getL1ToL2MessageIndex=async key=>{entered++;if(String(key)===f.receipts.receipt.messageKey)throw original;await held;return 1n;};
 let settled=false;const work=createFundingContinuation(f.input).advanceClaim().finally(()=>settled=true),rejected=assert.rejects(work,e=>e===original);
 while(entered<3)await new Promise(resolve=>setImmediate(resolve));
 assert(f.busy);assert.equal(settled,false);assert(!f.calls.some(row=>['prepare','checkpoint','submit'].includes(row[0])));
 release();await rejected;assert.equal(f.busy,false);assert(!f.calls.some(row=>['prepare','checkpoint','submit'].includes(row[0])));
});

for(const [method,label]of [['readAccountStatus','account.sync'],['readBokStatus','account.bok-sync']])test(`native refresh timing distinguishes ${method}`,async t=>{
 const prior=globalThis.performance,measures=[];globalThis.performance={now:()=>1,clearMeasures:()=>{},measure:name=>measures.push(name)};t.after(()=>{globalThis.performance=prior;});
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),failure=Error('held native sync');f.pxe.sync=async()=>{throw failure;};measures.length=0;
 try{await assert.rejects(session.application[method](),error=>error===failure);assert(measures.includes('rolling.'+label));assert(!measures.includes('rolling.'+(method==='readBokStatus'?'account.sync':'account.bok-sync')));}finally{await session.close();}
});

test('private session no longer exposes chain saved-item recovery',async()=>{const f=await sessionFixture(),session=await createRollingWalletSession(f.input);assert.equal(Object.hasOwn(session.application,'readPreferences'),false);assert.equal(Object.hasOwn(session.application,'readColdPreferences'),false);assert(!f.state.events.includes('preference-events'));await session.close();});

for(const rejectReady of [false,true])test(`opening local store precedes held prover readiness; rejection=${rejectReady}`,async()=>{
 const f=await sessionFixture(),ready=Promise.withResolvers(),storeOpened=Promise.withResolvers(),open=f.input.sdk.openPXEStore;
 f.input.proverReady=ready.promise;f.input.sdk.openPXEStore=async(...args)=>{const result=await open(...args);storeOpened.resolve();return result;};
 let done=false;const pending=createRollingWalletSession(f.input).then(value=>(done=true,value),error=>{done=true;throw error;});pending.catch(()=>{});
 await storeOpened.promise;await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.state.active,true);assert(!f.state.events.includes('create-pxe'));
 if(rejectReady){const original=Error('verifier failed');ready.reject(original);await assert.rejects(pending,error=>error===original);assert.equal(f.state.closes,1);assert(!f.state.events.includes('create-pxe'));}
 else{ready.resolve();const session=await pending;assert(f.state.events.includes('create-pxe'));await session.close();}
 assert.equal(f.state.active,false);
});

for(const changed of [false,true])test('opening status owns public Board sync through the actual session, changed='+changed,async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),entered=Promise.withResolvers(),held=Promise.withResolvers();let warmed=0,discovered=0;
 f.pxe.syncForAccountStatus=async(board,privateFee)=>{assert.equal(f.state.active,true);assert.equal(String(board),f.input.config.board.contractAddress);assert.equal(String(privateFee),f.input.config.privateFee.contractAddress);warmed++;entered.resolve();await held.promise;};
 f.pxe.prepareBoardActionState=async options=>{assert.equal(options.method,'get_deposit_ids');assert.equal(options.collateralOnly,undefined);discovered++;};
 const run=session.application.readAccountStatus({opening:true});const result=run.then(value=>({value}),error=>({error}));await entered.promise;
 assert.equal(session.busy,true);assert.equal(discovered,0);if(changed)f.state.wrongPXE=true;held.resolve();const outcome=await result;
 assert.equal(warmed,1);assert.equal(f.state.syncs,0,'opening invokes only the native owned sync capability');
 if(changed){assert.equal(outcome.error.code,'ROLLING_PRIVATE_ROUTE');assert.equal(discovered,0);f.state.wrongPXE=false;}else{assert.equal(outcome.error,undefined);assert.equal(discovered,1);}
 await session.close();
});

test('adopted funding reader uses only synchronized native scopes and preserves exact provider',async()=>{
 const f=await sessionFixture();let bound,receipts=0,blocks=0;
 const provider={getTransactionReceipt:async()=>{if(!f.state.earlyOnly)assert(f.state.active);receipts++;return {blockHash:hex(41)};},getBlock:async()=>{assert(f.state.active);blocks++;return {hash:hex(41)};}};
 f.input.config.aggregateFunding={};
 f.input.fundingContext={node:f.node,assertContext:async()=>{},registrationDeployment:async options=>({deployment:await (await import('../../shared/rolling/deployment.mjs')).verifyRollingDeployment(options)}),
  async bindPrivateContext(value){bound=value;assert.equal(typeof bound.readFunding,'function');
   // A worker's early funding read during native construction is not owned by
   // a synchronized operation and cannot inherit that initialization cache.
   await bound.readFunding(provider,'getTransactionReceipt',[hex(40)]);await bound.readFunding(provider,'getTransactionReceipt',[hex(40)]);
  },aggregate:{loadAggregate:async()=>null},prepareStarter:async()=>{},close(){throw Error('Externally owned funding context must not be closed');}};
 f.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:10},hash:async()=>hex(55),state:{l1ToL2MessageTree:{root:new Fr(1)}}});
 f.input.sdk.prepareFundingClaim=async()=>{
  await bound.readFunding(provider,'getTransactionReceipt',[hex(40)]);await bound.readFunding(provider,'getTransactionReceipt',[hex(40)]);
  await bound.readFunding(provider,'getBlock',[2]);await bound.readFunding(provider,'getBlock',[2]);return {status:'waiting'};
 };
 const session=await createRollingWalletSession(f.input);assert.equal(receipts,2);
 const receipt={txHash:hex(40),blockHash:hex(41),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:hex(43),secretHash:hex(44)};
 for(let i=0;i<2;i++){await assert.rejects(session.application.prepare({type:'claim-deposit',receipt}),{code:'ROLLING_FUNDING_NOT_READY'});assert.equal(receipts,3+i);assert.equal(blocks,2*(i+1));}
 assert.equal(f.state.sends,0);await session.close();
 // The worker owns this context. A discarded/closed native session cannot
 // hijack an otherwise independent early payment through its closed guard.
 f.state.earlyOnly=true;await bound.readFunding(provider,'getTransactionReceipt',[hex(40)]);assert.equal(receipts,5);
});


test('ordinary session binds source-plan warmup to exact account contracts before fresh discovery',async()=>{
 const f=await sessionFixture();let warms=0,discoveries=0;
 const publicRead=f.node.getPublicStorageAt;f.node.getPublicStorageAt=async(reference,address,slot)=>{if(slot.equals(artifact.storageLayout.main_version.slot)){assert.deepEqual(reference,{hash:hex(55)});assert(address.equals(f.board.address));return Fr.ONE;}return publicRead(reference,address,slot);};
 f.pxe.syncForOrdinaryPost=async(targets,read)=>{
  assert(f.state.active);warms++;
  assert.deepEqual(targets,{owner:f.input.account.address,board:f.input.config.board.contractAddress,privateFee:f.input.config.privateFee.contractAddress});
  const anchor={number:10,hash:BlockHash.fromString(hex(55))};
  return {anchor,value:await read(anchor)};
 };
 f.pxe.prepareOrdinaryPostState=async()=>{assert(f.state.active);assert.equal(warms,1);discoveries++;throw Error('stop after fresh discovery');};
 const session=await createRollingWalletSession(f.input),syncs=f.state.syncs;
 try{
  await assert.rejects(session.application.executeAction({type:'post',deposit:'9',content:'Paused composer uses current source plan'}),/stop after fresh discovery/);
  assert.equal(warms,1);assert.equal(discoveries,1);assert.equal(f.state.syncs,syncs);assert.equal(f.state.sends,0);assert.equal(f.state.active,false);
 }finally{await session.close();}
});

for(const phase of ['before','sync','discovery','witness'])test('composer supersession drains completed native boundary: '+phase,async()=>{
 const f=await sessionFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),controller=new AbortController();let discoveries=0,witnesses=0;
 f.input.sdk.prefetchOrdinaryPostWitnesses=async()=>{witnesses++;if(phase==='witness'){entered.resolve();await gate.promise;}};
 const session=await createRollingWalletSession(f.input),originalSync=f.pxe.sync,originalDiscovery=f.pxe.prepareOrdinaryPostState;
 f.pxe.sync=async()=>{if(phase==='sync'){entered.resolve();await gate.promise;}return originalSync();};
 f.pxe.prepareOrdinaryPostState=async targets=>{discoveries++;await originalDiscovery(targets);if(phase==='discovery'){entered.resolve();await gate.promise;}};
 if(phase==='before')controller.abort();let done=false;const work=session.preparePostingState('9',{signal:controller.signal}).finally(()=>done=true);
 try{
  if(phase!=='before'){await entered.promise;controller.abort();await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.state.active,true);await assert.rejects(session.application.ownedIdentities(),{code:'ROLLING_BUSY'});gate.resolve();}
  await work;assert.equal(f.state.active,false);assert.equal(f.state.sends,0);assert.equal(discoveries,['discovery','witness'].includes(phase)?1:0);assert.equal(witnesses,phase==='witness'?1:0);
 }finally{gate.resolve();await session.close();}
});

for(const changed of [false,true])test('owned names use exact Board public sync under the actual account lease, changed='+changed,async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),entered=Promise.withResolvers(),held=Promise.withResolvers();let warmed=0,discovered=0;
 const at=f.input.sdk.Contract.at;
 f.input.sdk.Contract.at=(...args)=>{const contract=at(...args),method=contract.methods.owned_name_records;contract.methods.owned_name_records=(...values)=>{discovered++;return method(...values);};return contract;};
 f.pxe.syncForAccountStatus=async(board,privateFee)=>{assert.equal(f.state.active,true);assert.equal(String(board),f.input.config.board.contractAddress);assert.equal(privateFee,undefined,'ownership-only refresh does not fetch FPC');warmed++;entered.resolve();await held.promise;};
 const run=session.application.ownedIdentities({cursor:0}),result=run.then(value=>({value}),error=>({error}));await entered.promise;
 assert.equal(session.busy,true);assert.equal(discovered,0);if(changed)f.state.wrongPXE=true;held.resolve();const out=await result;
 assert.equal(warmed,1);assert.equal(f.state.syncs,0,'only the existing native Board sync runs');
 if(changed){assert.equal(out.error.code,'ROLLING_PRIVATE_ROUTE');assert.equal(discovered,0);f.state.wrongPXE=false;}else{assert.equal(out.error,undefined);assert.equal(discovered,1);assert(Array.isArray(out.value.identities));}
 await session.close();
});

// Actual exit capability and Ethereum journal; only remote replies are doubles.
async function finalExitWave(options={}, {failure,change}={}){
 const f=await withdrawalFixture(options),gate=Promise.withResolvers(),entered=Promise.withResolvers(),started=[];
 let active=false;
 for(const [target,name]of [[f.opts.provider,'getNetwork'],[f.opts.node,'getTxReceipt'],[f.opts.node,'getBlockData']]){
  const original=target[name];target[name]=(...args)=>{
   if(!active)return original(...args);
   started.push(name);if(started.length===3)entered.resolve();
   if(name==='getTxReceipt')assert.equal(args[0].toString(),f.record.txHash);
   if(name==='getBlockData')assert.equal(args[0],1);
   if(failure===name)throw Error('final read failed');
   return gate.promise.then(async()=>{
    const value=await original(...args);
    if(change==='network'&&name==='getNetwork')return {chainId:1n};
    if(name==='getTxReceipt'){
     if(change==='tx')return {...value,txHash:hex(99)};
     if(change==='status')return {...value,status:'proposed'};
     if(change==='reverted')return {...value,executionResult:'reverted'};
     if(change==='receipt-number')return {...value,blockNumber:2};
     if(change==='receipt-hash')return {...value,blockHash:hex(99)};
    }
    if(name==='getBlockData'){
     if(change==='canonical-hash')return {...value,blockHash:hex(99)};
     if(change==='canonical-number')return {...value,header:{globalVariables:{blockNumber:2}}};
    }
    return value;
   });
  };
 }
 const cap=f.restart();await cap.prepare({maximumGasWei:'1000'});
 f.state.onFees=()=>{active=true;};
 return {...f,cap,gate,entered,started};
}
for(const kind of ['collateral','bok','cancellation'])test('exit final canonical wave overlaps exact proof queries for '+kind,{timeout:3000},async()=>{
 const f=await finalExitWave({bok:kind==='bok',cancellation:kind==='cancellation'});let done=false;
 const work=f.cap.confirm().finally(()=>done=true);
 await f.entered.promise;assert.equal(done,false);assert.equal(f.state.sends,0);assert.deepEqual([...f.started].sort(),['getBlockData','getNetwork','getTxReceipt']);
 f.gate.resolve();assert.equal((await work).status,'refunded');assert.equal(f.state.sends,1);
});
for(const failure of ['getNetwork','getTxReceipt','getBlockData'])test('exit final canonical wave drains synchronous '+failure+' failure',{timeout:3000},async()=>{
 const f=await finalExitWave({}, {failure});let done=false;const work=assert.rejects(f.cap.confirm()).finally(()=>done=true);
 await f.entered.promise;await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.state.sends,0);f.gate.resolve();await work;assert.equal(f.state.sends,0);
});
for(const change of ['network','tx','status','reverted','receipt-number','receipt-hash','canonical-hash','canonical-number','context'])test('exit final canonical wave rejects changed '+change,{timeout:3000},async()=>{
 const f=await finalExitWave({}, {change});const work=assert.rejects(f.cap.confirm());
 await f.entered.promise;if(change==='context')f.state.guard=false;assert.equal(f.state.sends,0);f.gate.resolve();await work;assert.equal(f.state.sends,0);
});

for(const failure of ['none','canonical','portal','both'])test(`Bok portal final read wave drains canonical and L1 metadata: ${failure}`,async()=>{
 const {input,abi,portal,token,recipient}=topupScopeFixture('bok'),hold=Promise.withResolvers(),entered=Promise.withResolvers(),started=new Set();
 const canonicalError=Error('canonical read failed'),portalError=Error('portal read failed'),block=input.node.getBlockData,call=input.provider.call;
 const mark=name=>{started.add(name);if(started.size===2)entered.resolve();};
 input.node.getBlockData=async tag=>{if(typeof tag==='number'){mark('canonical');if(['canonical','both'].includes(failure))throw canonicalError;await hold.promise;}return block(tag);};
 input.provider.call=async request=>{if(abi.parseTransaction({data:request.data}).name!=='decimals'){mark('portal');if(['portal','both'].includes(failure))throw portalError;await hold.promise;}return call(request);};
 let done=false;const pending=verifyRollingTopupScope(input).then(value=>({value}),error=>({error})).finally(()=>done=true);
 await entered.promise;await new Promise(setImmediate);assert.equal(done,failure==='both');hold.resolve();const result=await pending;
 if(failure==='none')assert.deepEqual(result.value,{portal,token,recipient});else assert.equal(result.error,['canonical','both'].includes(failure)?canonicalError:portalError);
});

for(const failure of [false,true])test('owned claim lifetime stays within session lease and closes on failure='+failure,async()=>{
 const f=continuationFixture();let active=false,entries=0;
 f.input.funding.withClaimContinuation=async work=>{assert(f.busy);assert(!active);active=true;entries++;try{return await work();}finally{assert(f.busy);active=false;}};
 const recover=f.input.funding.recover;f.input.funding.recover=async(...args)=>{assert(active);if(failure)throw Error('payment unavailable');return recover(...args);};
 const cap=createFundingContinuation(f.input);
 if(failure)await assert.rejects(cap.advanceClaim(),/payment unavailable/);else assert.equal((await cap.advanceClaim()).state,'complete');
 assert.equal(entries,1);assert(!active);assert(!f.busy);
});

for(const type of ['like','unlike'])for(const immediate of [false,true])test('wallet forwards Like snapshot option under the account lease: '+type+' immediate='+immediate,async()=>{
 const f=await sessionFixture(),session=await createRollingWalletSession(f.input),seen=[],failure=Error('stop at native sync boundary');
 f.pxe.sync=async options=>{assert.equal(f.state.active,true);seen.push(options);throw failure;};
 try{
  await assert.rejects(session.application.prepare({type,post:'5'},{immediate}),error=>error===failure);
  assert.deepEqual(seen,[immediate?{snapshotAncestry:true}:undefined]);assert.equal(f.state.active,false);assert.equal(f.state.sends,0);
  assert.equal(f.state.boardStateMethod,undefined,'failed native sync cannot begin contract discovery or transaction work');
 }finally{await session.close();}
});
