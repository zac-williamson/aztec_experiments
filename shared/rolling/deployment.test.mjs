import {inspectTrustedNode as actualInspect,getTrustedNodeCanonicalBlock,getTrustedNodeSnapshotInfo} from '../trusted-private-node.mjs';
// Labelled RPC doubles: real processed artifacts/class/instance hashes, SDK
// commitment hash and complete compiler portal runtime. No chain or wallet call.
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance,SerializableContractInstance} from '@aztec-labs/stdlib/contract';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {derivePrivateFeeInstance,normalizePrivateFeeGasSettings} from '../private-fee-client.mjs';
import {expectedPortalRuntime,verifyPortalRuntime} from '../portal-runtime.mjs';
import {encodeConfigCommitment} from '../protocol-commitments.mjs';
import {verifyRollingDeployment,createRollingDeploymentPreparation,prepareRollingDeployment,assertRollingDeploymentPreparation,consumeRollingDeploymentPreparation,readRollingDeploymentRegistration,exportRollingDeploymentRegistration} from './deployment.mjs';
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const feeArtifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../apps/src/billboard/private_fee_artifact.json',import.meta.url))));
const metadata=JSON.parse(fs.readFileSync(new URL('../portal-runtime.json',import.meta.url)));
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),eth=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
async function fixture(){
 const deployer=AztecAddress.fromBigIntUnsafe(3n),rollup=eth(11),portal=eth(22);
 const board=await getContractInstanceFromInstantiationParams(artifact,{salt:new Fr(7),deployer,constructorArtifact:'init',constructorArgs:[Array(32).fill(0n),0,31337,rollup,1,100,200,60,2,120,3]});
 const fee=await derivePrivateFeeInstance(feeArtifact),state={destroyed:0,guards:0,reads:[],ethReads:[],inspection:0,enabled:true};
 const config={network:{chainId:'31337',rollupVersion:'1',rollupAddress:rollup,nodeUrl:'http://127.0.0.1:1',ethRpcUrl:'http://127.0.0.1:2'},
  board:{contractAddress:String(board.address),portalAddress:portal},privateFee:{contractAddress:String(fee.address),gasSettings:{gasLimits:{daGas:'1000',l2Gas:'1000'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
 const economics={minDeposit:'100',maxDeposit:'200',baseCooldown:'60',kMultiplier:'2',censorWindow:'120',maxSaveUp:'3'};
 const configHash=sha256ToField(Buffer.from(encodeConfigCommitment({l1ChainId:'31337',rollupVersion:'1',rollupAddress:rollup,boardAddress:String(board.address)},economics)));
 const immutables={MIN_DEPOSIT:100n,MAX_DEPOSIT:200n,L2_CONTRACT:BigInt(String(board.address)),ROLLUP:11n,INBOX:33n,OUTBOX:44n,VERSION:1n,L1_CHAIN_ID:31337n,CONFIG_HASH:configHash.toBigInt(),DEPLOYMENT_OPERATOR:55n};
 const storage=new Map([[1n,22n],...[31337n,11n,1n,100n,200n,60n,2n,120n,3n,3n].map((value,i)=>[3n+BigInt(i),value])]);
 const node={getBlockData:async n=>({blockHash:Fr.fromString(hex(55)),header:{globalVariables:{blockNumber:10}}}),
  getContract:async(address,reference)=>{state.reads.push(['instance',reference]);return address.equals(board.address)?board:fee;},
  getPublicStorageAt:async(reference,address,slot)=>{state.reads.push(['storage',reference]);return new Fr(storage.get(slot.toBigInt()));},
  getL1ContractAddresses:async()=>({rollupAddress:rollup,inboxAddress:eth(33),outboxAddress:eth(44)})};
 const provider={getNetwork:async()=>({chainId:31337n}),getBlock:async n=>({number:20,hash:hex(66)}),getCode:async(address,n)=>{state.ethReads.push(n);return expectedPortalRuntime(metadata,immutables);},destroy:()=>{state.destroyed++;}};
 const ethers={JsonRpcProvider:class{constructor(){return provider;}},Contract:class{constructor(){return {...Object.fromEntries(Object.keys(immutables).map(name=>[name,async opts=>{state.ethReads.push(opts.blockTag);return immutables[name];}])),depositsEnabled:async opts=>{state.ethReads.push(opts.blockTag);return state.enabled;}};}}};
 const sdk={Fr,AztecAddress,SerializableContractInstance,getContractClassFromArtifact,computeContractAddressFromInstance,derivePrivateFeeInstance,normalizePrivateFeeGasSettings,sha256ToField,verifyPortalRuntime,portalRuntimeMetadata:metadata,
  isTrustedPrivateNode:n=>n===node,inspectTrustedNode:async(n,opts)=>{state.inspection++;assert.deepEqual(opts.expectedNetworkScope,{chainId:'31337',version:'1',rollup});assert.equal(opts.proofsEnabled,true);}};
 const options={sdk,node,ethers,config,boardArtifact:artifact,privateFeeArtifact:feeArtifact,contextGuard:async()=>{state.guards++;}};
 return {options,state,node,provider,board,fee,storage,immutables,configHash,economics};
}
test('actual artifact layout/hash/runtime yields detached deployment values, stable artifacts and canonical instances',async()=>{
 const f=await fixture(),out=await verifyRollingDeployment(f.options);
 assert.deepEqual(out.economics,f.economics);assert.equal(out.configHash,String(f.configHash));assert.equal(String(out.board.instance.address),String(f.board.address));
 assert.equal(String(await computeContractAddressFromInstance(out.board.instance)),String(f.board.address));
 assert.equal(String(await computeContractAddressFromInstance(out.privateFee.instance)),String(f.fee.address));
 assert.ok(Object.isFrozen(out)&&Object.isFrozen(out.privateFee.gasSettings));assert.equal(out.board.artifact,artifact);
 assert.equal(out.privateFee.artifact,feeArtifact);assert.notEqual(out.board.instance,f.board);assert.notEqual(out.privateFee.instance,f.fee);
 assert.equal(f.state.destroyed,1);assert.equal(f.state.guards,2);assert.equal(f.state.inspection,2);
 assert.ok(f.state.reads.every(([,ref])=>ref.hash===hex(55)));assert.ok(f.state.ethReads.every(number=>number===20));
});
test('changed board class/address/storage/portal/config hash and FPC publication fail closed',async()=>{
 const mutations=[f=>{f.board.currentContractClassId=new Fr(99);},f=>{f.board.originalContractClassId=new Fr(99);},f=>{f.board.salt=new Fr(99);},
  f=>f.storage.set(1n,23n),f=>f.storage.set(3n,1n),f=>f.storage.set(4n,12n),f=>f.storage.set(5n,2n),f=>f.storage.set(12n,4n),
  f=>{f.immutables.CONFIG_HASH++;},f=>{f.immutables.MIN_DEPOSIT++;},f=>{f.immutables.DEPLOYMENT_OPERATOR=0n;},f=>{f.fee.currentContractClassId=new Fr(99);},f=>{f.fee.salt=new Fr(99);},
  f=>{f.node.getContract=async(address)=>address.equals(f.board.address)?f.board:undefined;}];
 for(const mutate of mutations){const f=await fixture();mutate(f);await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.ok(f.state.destroyed<=1);}
});
test('wrong runtime, Ethereum identity and reorg anchors are rejected with provider disposed',async()=>{
 for(const mutate of [f=>{f.provider.getCode=async()=>expectedPortalRuntime(metadata,f.immutables)+'00';},
  f=>{f.provider.getNetwork=async()=>({chainId:1n});},f=>{f.provider.getBlock=async n=>({number:20,hash:n==='latest'?hex(66):hex(67)});},
  f=>{f.node.getBlockData=async n=>({blockHash:Fr.fromString(n==='checkpointed'?hex(55):hex(56)),header:{globalVariables:{blockNumber:10}}});}]){
  const f=await fixture();mutate(f);await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(f.state.destroyed,1);
 }
});
test('untrusted/stale node, missing guard and secret-bearing URL fail without funding or ordinary node fallback',async()=>{
 const cases=[
  {mutate:f=>{f.options.sdk.isTrustedPrivateNode=()=>false;},destroyed:0},
  {mutate:f=>{f.options.sdk.inspectTrustedNode=async()=>{throw Error('PRIVATE_SENTINEL');};},destroyed:1},
  {mutate:f=>{f.options.contextGuard=undefined;},destroyed:0},
  {mutate:f=>{f.options.config.network.ethRpcUrl='https://secret@example.com';},destroyed:0},
  {mutate:f=>{f.options.boardArtifact={...artifact,storageLayout:{...artifact.storageLayout,config:{slot:new Fr(4)}}};},destroyed:0},
 ];
 for(const {mutate,destroyed} of cases){
  const f=await fixture();mutate(f);await assert.rejects(verifyRollingDeployment(f.options),error=>error.code==='ROLLING_DEPLOYMENT_INVALID'&&!error.message.includes('PRIVATE_SENTINEL'));assert.equal(f.state.destroyed,destroyed);
 }
});
test('context changes dispose the provider; pending guard waits for explicit caller cancellation without a deadline',async t=>{
 const f=await fixture();f.options.contextGuard=async()=>{if(++f.state.guards===2)throw Error('account replaced');};
 await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(f.state.destroyed,1);
 const stalled=await fixture(),controller=new AbortController();let entered,settled=false;
 const guardEntered=new Promise(resolve=>{entered=resolve;});
 stalled.options.contextGuard=()=>new Promise((_resolve,reject)=>{
  controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});entered();
 });
 t.mock.timers.enable({apis:['Date','setTimeout']});
 const pending=verifyRollingDeployment(stalled.options);
 pending.then(()=>{settled=true;},()=>{settled=true;});
 const rejected=assert.rejects(pending,{code:'ROLLING_DEPLOYMENT_INVALID'});
 await guardEntered;t.mock.timers.tick(60*60*1000);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false);assert.equal(stalled.state.inspection,0);assert.equal(stalled.state.destroyed,0);
 controller.abort(Error('Account opening cancelled'));await rejected;
 assert.equal(settled,true);assert.equal(stalled.state.inspection,0);assert.equal(stalled.state.destroyed,0);
 assert.deepEqual(stalled.state.reads,[]);assert.deepEqual(stalled.state.ethReads,[]);
});

test('unactivated canonical portal cannot authorize funding, and activation must remain canonically anchored',async()=>{
 for(const enabled of [false,undefined,1,'true']){
  const f=await fixture();f.state.enabled=enabled;
  await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
  assert.equal(f.state.destroyed,1);assert.ok(f.state.ethReads.every(number=>number===20));
 }
 const f=await fixture();let rereads=0;
 f.provider.getBlock=async tag=>{if(tag==='latest')return {number:20,hash:hex(66)};rereads++;f.state.enabled=false;return {number:20,hash:hex(67)};};
 await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
 assert.equal(rereads,1);assert.equal(f.state.destroyed,1);
});

// Labelled failure injection; original cryptographic artifact work and verifier
// remain in place. Diagnostics are observations, never validation substitutes.
import {ROLLING_DEPLOYMENT_STAGES,rollingSetupErrorCode} from './deployment.mjs';
const diagnosticDeploymentFailures={
 config:f=>{f.options.config.network=null;},
 'node-readiness':(f,error)=>{f.options.sdk.inspectTrustedNode=async()=>{throw error;};},
 'artifact-layout':f=>{f.options.boardArtifact.name='Wrong';},
 'board-class':(f,error)=>{f.options.sdk.getContractClassFromArtifact=async()=>{throw error;};},
 checkpoint:(f,error)=>{f.node.getBlockData=async()=>{throw error;};},
 'board-instance':(f,error)=>{const original=f.node.getContract;f.node.getContract=async(address,...args)=>{if(String(address)===f.options.config.board.contractAddress)throw error;return original(address,...args);};},
 'public-config':(f,error)=>{f.node.getPublicStorageAt=async()=>{throw error;};},
 'config-commitment':(f,error)=>{f.options.sdk.sha256ToField=()=>{throw error;};},
 'fee-instance':(f,error)=>{f.options.sdk.derivePrivateFeeInstance=async()=>{throw error;};},
 'l1-context':(f,error)=>{f.options.ethers.JsonRpcProvider=class{constructor(){throw error;}};},
 'portal-code-and-immutables':(f,error)=>{f.provider.getCode=async()=>{throw error;};},
 'canonical-recheck':(f,error)=>{f.node.getBlockData=async()=>{throw error;};},
 'final-readiness-and-context':(f,error)=>{f.options.sdk.inspectTrustedNode=async()=>{throw error;};},
};
for(const [step,inject]of Object.entries(diagnosticDeploymentFailures))test('labelled deployment diagnostic preserves sanitizer at '+step,async()=>{
 const f=await fixture(),observed=[];f.options.boardArtifact={...artifact};let getterCalls=0;
 const original=Object.defineProperty(Error('PRIVATE_SENTINEL'),'code',{get(){getterCalls++;throw Error('PRIVATE_SENTINEL');}});
 f.options.onProgress=record=>{observed.push(record);if(record.step===step&&record.state==='started')inject(f,original);};
 await assert.rejects(verifyRollingDeployment(f.options),e=>e.code==='ROLLING_DEPLOYMENT_INVALID'&&!e.message.includes('PRIVATE_SENTINEL'));
 assert.deepEqual(observed.at(-1),{stage:'deployment-initialization',step,state:'failed',code:['config','artifact-layout'].includes(step)?'ROLLING_DEPLOYMENT_INVALID':'unknown'});
 assert.equal(observed.filter(r=>r.state==='failed').length,1);assert.equal(getterCalls,0);assert(!JSON.stringify(observed).includes('PRIVATE_SENTINEL'));
 assert.equal(f.state.destroyed,['config','artifact-layout','l1-context'].includes(step)?0:1);
});
test('deployment diagnostic success visits fixed stages and throwing observers cannot change result',async()=>{
 const f=await fixture(),observed=[];f.options.onProgress=record=>{observed.push(record);if(record.state==='started')throw Error('PRIVATE_SENTINEL');return Promise.reject(Error('PRIVATE_SENTINEL'));};
 const result=await verifyRollingDeployment(f.options);assert.equal(result.configHash,String(f.configHash));assert.equal(f.state.destroyed,1);
 const stages=ROLLING_DEPLOYMENT_STAGES.filter(step=>!['prepared-refresh','prepared-registration'].includes(step));
 assert.deepEqual(observed.filter(r=>r.state==='started').map(r=>r.step).sort(),[...stages].sort());
 assert.deepEqual(observed.filter(r=>r.state==='complete').map(r=>r.step).sort(),[...stages].sort());
 for(const step of stages)assert(observed.findIndex(r=>r.step===step&&r.state==='started')<observed.findIndex(r=>r.step===step&&r.state==='complete'));
 assert(observed.every(Object.isFrozen));
});
test('diagnostic codes are own fixed data only, including falsy failures and hostile thenable observers',async()=>{
 let calls=0;const getter=Object.defineProperty({},'code',{get(){calls++;throw Error('PRIVATE_SENTINEL');}});
 for(const value of [null,undefined,false,0,'PRIVATE_SENTINEL',getter,Object.create({code:'BB_TRUSTED_NODE_STALE'}),{code:'PRIVATE_SENTINEL'}])assert.equal(rollingSetupErrorCode(value),'unknown');
 assert.equal(calls,0);assert.equal(rollingSetupErrorCode({code:'BB_TRUSTED_NODE_STALE'}),'BB_TRUSTED_NODE_STALE');
 const f=await fixture();f.options.sdk.inspectTrustedNode=async()=>{throw null;};f.options.onProgress=()=>({get then(){throw Error('PRIVATE_SENTINEL');}});
 await assert.rejects(verifyRollingDeployment(f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
});


// Labelled factory/RPC doubles retain the real pinned artifact/class/address,
// commitment and runtime checks above. These checks measure call counts, not time.
async function preparedFixture(){
 const f=await fixture(),counts={factory:0,classes:0,fee:0};
 const {sdk}=f.options,classRead=sdk.getContractClassFromArtifact,feeRead=sdk.derivePrivateFeeInstance;
 sdk.getContractClassFromArtifact=async(...args)=>{counts.classes++;return classRead(...args);};
 sdk.derivePrivateFeeInstance=async(...args)=>{counts.fee++;return feeRead(...args);};
 sdk.createTrustedPrivateNode=async options=>{counts.factory++;assert.equal(options.readinessTier,'checkpointed');await sdk.inspectTrustedNode(f.node,options);return f.node;};
 const preparation=createRollingDeploymentPreparation({...f.options,trustedQuery:{url:'http://127.0.0.1:1'}});
 return {...f,counts,preparation};
}
test('prepared deployment creates one attested client, reuses immutable reads, and refreshes mutable authority',async()=>{
 const f=await preparedFixture();
 const first=await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 const second=await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 assert.equal(first.node,f.node);assert.equal(second.deployment,first.deployment);assert.equal(first.preparation,f.preparation);
 assert.deepEqual(f.counts,{factory:1,classes:1,fee:1});assert.equal(f.state.inspection,2);
 const storageReads=f.state.reads.filter(([kind])=>kind==='storage').length,ethReads=f.state.ethReads.length;
 const consumed=await consumeRollingDeploymentPreparation(f.preparation,f.options);
 assert.equal(consumed.node,f.node);assert.equal(consumed.deployment.configHash,first.deployment.configHash);
 assert.deepEqual(f.counts,{factory:1,classes:1,fee:1});assert.equal(f.state.inspection,3);
 assert.equal(f.state.reads.filter(([kind])=>kind==='storage').length,storageReads);
 assert.equal(f.state.reads.filter(([kind])=>kind==='instance').length,4);
 assert.equal(f.state.ethReads.length,ethReads+1);assert.equal(f.state.destroyed,2);
});
test('prepared capability rejects fake handles and mismatched node, artifacts, SDK, config and proof mode',async()=>{
 const f=await preparedFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 assert.throws(()=>assertRollingDeploymentPreparation({},f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
 for(const change of [{node:{...f.node}},{boardArtifact:{...artifact}},{privateFeeArtifact:{...feeArtifact}},{sdk:{...f.options.sdk}},{config:{...f.options.config,board:{...f.options.config.board,portalAddress:eth(23)}}},{proofsEnabled:false}]){
  await assert.rejects(consumeRollingDeploymentPreparation(f.preparation,{...f.options,...change}),{code:'ROLLING_DEPLOYMENT_INVALID'});
 }
 assert.equal(f.state.destroyed,1);assert.equal(f.state.inspection,2);
});
test('prepared refresh rejects changed class, disabled admission and reorged cached observations',async()=>{
 for(const mutate of [f=>{f.board.currentContractClassId=new Fr(99);},f=>{f.state.enabled=false;},f=>{f.provider.getBlock=async n=>({number:20,hash:n==='latest'?hex(66):hex(67)});},f=>{f.node.getBlockData=async n=>({blockHash:Fr.fromString(n==='checkpointed'?hex(55):hex(56)),header:{globalVariables:{blockNumber:10}}});}]){
  const f=await preparedFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});mutate(f);
  await assert.rejects(consumeRollingDeploymentPreparation(f.preparation,f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(f.state.destroyed,2);
 }
});


test('registration snapshot reuses verified initialization without RPC or artifact recomputation',async()=>{
 const f=await preparedFixture(),first=await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 const before={reads:f.state.reads.length,ethReads:f.state.ethReads.length,inspection:f.state.inspection,destroyed:f.state.destroyed,counts:{...f.counts}};
 for(const name of ['getBlockData','getContract','getPublicStorageAt','getL1ContractAddresses'])f.node[name]=()=>assert.fail('Registration cannot issue node RPC');
 for(const name of ['getBlock','getCode','getNetwork'])f.provider[name]=()=>assert.fail('Registration cannot issue Ethereum RPC');
 f.options.sdk.inspectTrustedNode=()=>assert.fail('Registration is not current readiness');
 const out=await readRollingDeploymentRegistration(f.preparation,f.options);
 assert.equal(out.node,first.node);assert.notEqual(out.deployment,first.deployment);assert.notEqual(out.deployment.board.instance,first.deployment.board.instance);
 assert.equal(out.deployment.board.artifact,artifact);assert.equal(out.deployment.configHash,first.deployment.configHash);
 assert.throws(()=>{out.deployment.board.instance.currentContractClassId=new Fr(99);},TypeError);
 assert.notEqual(out.deployment.board.instance.currentContractClassId,first.deployment.board.instance.currentContractClassId);
 const second=await readRollingDeploymentRegistration(f.preparation,f.options);assert.equal(second.deployment.board.instance.currentContractClassId.toString(),first.deployment.board.instance.currentContractClassId.toString());
 assert.deepEqual({reads:f.state.reads.length,ethReads:f.state.ethReads.length,inspection:f.state.inspection,destroyed:f.state.destroyed,counts:f.counts},before);
});
test('registration snapshot rejects foreign handles and exact initialization identity changes',async()=>{
 const f=await preparedFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 await assert.rejects(readRollingDeploymentRegistration({},f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
 for(const change of [{node:{...f.node}},{boardArtifact:{...artifact}},{privateFeeArtifact:{...feeArtifact}},{sdk:{...f.options.sdk}},{ethers:{...f.options.ethers}},{config:{...f.options.config,board:{...f.options.config.board,portalAddress:eth(23)}}},{proofsEnabled:false}])
  await assert.rejects(readRollingDeploymentRegistration(f.preparation,{...f.options,...change}),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
test('registration snapshot rechecks identity after held guard and propagates account cancellation',async()=>{
 const f=await preparedFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 const gate=Promise.withResolvers(),entered=Promise.withResolvers(),options={...f.options,contextGuard:async()=>{entered.resolve();await gate.promise;}};
 const work=readRollingDeploymentRegistration(f.preparation,options),rejection=assert.rejects(work,{code:'ROLLING_DEPLOYMENT_INVALID'});
 await entered.promise;options.node={...f.node};gate.resolve();await rejection;
 const cancelled=Object.assign(Error('account replaced'),{code:'ROLLING_CONTEXT_CHANGED'});
 await assert.rejects(readRollingDeploymentRegistration(f.preparation,{...f.options,contextGuard:async()=>{throw cancelled;}}),error=>error===cancelled);
});
import {Interface} from 'ethers';
import {verifyRollingAggregateScope} from './funding-session.mjs';
for(const defect of ['stale-node','l1-reorg','portal-binding'])test('financial scope still rejects after registration-only handoff '+defect,async()=>{
 const f=await preparedFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 const registration=await readRollingDeploymentRegistration(f.preparation,f.options),scope={feePortal:eth(31),feeToken:eth(32)};
 const iface=new Interface(['function UNDERLYING() view returns(address)','function decimals() view returns(uint8)']);let inspections=0,reads=0;
 f.node.getL1ContractAddresses=async()=>({feeJuicePortalAddress:scope.feePortal});
 f.options.sdk.inspectTrustedNode=async(node,options)=>{inspections++;assert.equal(node,registration.node);assert.deepEqual(options.expectedNetworkScope,registration.deployment.network);if(defect==='stale-node')throw Object.assign(Error('stale'),{code:'BB_TRUSTED_NODE_STALE'});};
 const provider={getBlock:async tag=>{reads++;return {number:20,hash:defect==='l1-reorg'&&tag===20?hex(67):hex(66)};},call:async request=>{reads++;const name=iface.parseTransaction(request).name;return iface.encodeFunctionResult(name,[name==='UNDERLYING'?defect==='portal-binding'?eth(99):scope.feeToken:18]);}};
 await assert.rejects(verifyRollingAggregateScope({sdk:f.options.sdk,ethers:{Interface},node:registration.node,provider,scope,network:registration.deployment.network,proofsEnabled:true,contextGuard:async()=>{},includeBok:false,asset:'ETH'}),{code:defect==='stale-node'?'BB_TRUSTED_NODE_STALE':defect==='l1-reorg'?'ROLLING_CONTEXT_CHANGED':'ROLLING_SESSION_CONFIG'});
 assert.equal(inspections,1);assert(reads>=3,'fresh actual funding boundary still performs its independent L1 checks');
});

async function snapshotFixture(){
 const f=await preparedFixture(),id={number:10,hash:hex(55)},calls=[];
 Object.assign(f.node,{getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,realProofs:true,l1ContractAddresses:{rollupAddress:f.options.config.network.rollupAddress}}),getChainTips:async()=>({proposed:id,checkpointed:{block:id},proven:{block:id},finalized:{block:id}}),getWorldStateSyncStatus:async()=>({latestBlockNumber:10,latestBlockHash:hex(55),finalizedBlockNumber:10,oldestHistoricBlockNumber:0,treesAreSynched:true}),getSyncedL1Timestamp:async()=>BigInt(Math.floor(Date.now()/1000))});
 const read=f.node.getBlockData;f.node.getBlockData=async number=>{calls.push(number);return read(number);};
 const sdk=f.options.sdk;let initial;
 sdk.inspectTrustedNode=actualInspect;sdk.getTrustedNodeCanonicalBlock=getTrustedNodeCanonicalBlock;
 sdk.createTrustedPrivateNode=async options=>{initial=await actualInspect(f.node,options);await options.onReady?.(initial);return f.node;};
 return {...f,calls,initial:()=>initial};
}
test('snapshot handoff reuses initial canonical checkpoint and returns final exact-node inspection',async()=>{
 const f=await snapshotFixture(),out=await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 assert.equal(f.calls.includes('checkpointed'),false);assert.equal(f.calls.filter(x=>x===10).length,3,'initial canonical, final explicit canonical, final readiness canonical');
 assert.notEqual(out.nodeSnapshot,f.initial());assert.equal(getTrustedNodeSnapshotInfo(out.nodeSnapshot,f.node).l1ChainId,31337);
 const registration=await readRollingDeploymentRegistration(f.preparation,{...f.options,node:f.node});assert.equal(registration.nodeSnapshot,out.nodeSnapshot);
});
test('snapshot handoff preserves fresh canonical rejection after authenticated initial checkpoint',async()=>{
 const f=await snapshotFixture(),read=f.node.getBlockData;let count=0;
 f.node.getBlockData=async number=>{const value=await read(number);return ++count===1?value:{...value,blockHash:Fr.fromString(hex(56))};};
 await assert.rejects(prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard}),{code:'ROLLING_DEPLOYMENT_INVALID'});assert.equal(f.calls.includes('checkpointed'),false);assert.equal(f.state.destroyed,1);
});
test('deployment instance fetch overlaps held Board and FPC derivation at the same captured anchor',async()=>{
 const f=await fixture(),boardGate=Promise.withResolvers(),feeGate=Promise.withResolvers(),fetched=Promise.withResolvers();
 const board=f.options.sdk.getContractClassFromArtifact,fee=f.options.sdk.derivePrivateFeeInstance,read=f.node.getContract;let reads=0;
 f.options.sdk.getContractClassFromArtifact=async(...args)=>{const value=await board(...args);await boardGate.promise;return value;};f.options.sdk.derivePrivateFeeInstance=async(...args)=>{const value=await fee(...args);await feeGate.promise;return value;};
 f.node.getContract=async(...args)=>{assert.deepEqual(args[1],{hash:hex(55)});const value=await read(...args);if(++reads===2)fetched.resolve();return value;};
 let done=false;const pending=verifyRollingDeployment(f.options).then(value=>(done=true,value));await fetched.promise;assert.equal(done,false);boardGate.resolve();feeGate.resolve();await pending;assert.equal(f.state.destroyed,1);
});
test('deployment instance fetch drains a held read when independent class derivation fails',async()=>{
 const f=await fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),read=f.node.getContract;
 f.options.sdk.getContractClassFromArtifact=async()=>{throw Error('class failed');};
 f.node.getContract=async(...args)=>{if(args[0].equals(f.board.address)){entered.resolve();await gate.promise;}return read(...args);};
 let done=false;const pending=verifyRollingDeployment(f.options).catch(error=>{done=true;return error;});await entered.promise;await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.state.destroyed,0);gate.resolve();assert.equal((await pending).code,'ROLLING_DEPLOYMENT_INVALID');assert.equal(f.state.destroyed,1);
});


const registrationHashes={board:createHash('sha256').update(fs.readFileSync(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))).digest('hex'),privateFee:createHash('sha256').update(fs.readFileSync(new URL('../../apps/src/billboard/private_fee_artifact.json',import.meta.url))).digest('hex')};
async function registrationFixture(){
 const f=await snapshotFixture();await prepareRollingDeployment(f.preparation,{contextGuard:f.options.contextGuard});
 const registration=exportRollingDeploymentRegistration(f.preparation,registrationHashes);
 const options={...f.options,trustedQuery:{url:'http://127.0.0.1:1'},registration,artifactHashes:registrationHashes};
 return {...f,registration,registrationOptions:options};
}
test('published registration uses native instance roundtrip and a fresh actual node snapshot without immutable RPC replay',async()=>{
 const f=await registrationFixture();f.state.reads=[];f.state.ethReads=[];const before=f.calls.length;
 f.node.getContract=()=>assert.fail('No deployment instance RPC');f.node.getPublicStorageAt=()=>assert.fail('No immutable storage RPC');f.provider.getCode=()=>assert.fail('No portal RPC');
 const handle=createRollingDeploymentPreparation(f.registrationOptions),result=await prepareRollingDeployment(handle,{contextGuard:f.options.contextGuard});
 assert.equal(f.calls.length,before+1);assert.equal(result.nodeSnapshot,f.initial());assert.equal(result.node,f.node);assert(getTrustedNodeSnapshotInfo(result.nodeSnapshot,f.node));
 assert.equal(result.deployment.board.instance.address.toString(),f.board.address.toString());assert.equal(result.deployment.privateFee.instance.address.toString(),f.fee.address.toString());
 assert.deepEqual(result.deployment.economics,f.economics);assert.equal(f.state.ethReads.length,0);assert.equal(f.state.reads.length,0);
 assert.equal((await readRollingDeploymentRegistration(handle,f.options)).deployment.board.artifact,artifact);
 await assert.rejects(consumeRollingDeploymentPreparation(handle,f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
 assert.throws(()=>exportRollingDeploymentRegistration(handle,registrationHashes),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
for(const mutation of ['config','artifact','network','proofs','class','address','instance','extra'])test(`published registration rejects ${mutation} mismatch`,async()=>{
 const f=await registrationFixture(),r=f.registration;
 if(mutation==='config')r.config.board.portalAddress=eth(99);
 if(mutation==='artifact')r.artifactHashes.board='f'.repeat(64);
 if(mutation==='network')r.config.network.chainId='1';
 if(mutation==='proofs')r.proofsEnabled=false;
 if(mutation==='class')r.instances.board.classId=hex(99);
 if(mutation==='address')r.instances.board.address=hex(99);
 if(mutation==='instance')r.instances.board.bytes+='00';
 if(mutation==='extra')r.authorizedToPay=true;
 await assert.rejects(async()=>prepareRollingDeployment(createRollingDeploymentPreparation(f.registrationOptions),{contextGuard:f.options.contextGuard}));
});
test('published registration still rejects real node network mismatch and stale canonical readiness',async()=>{
 for(const mutation of ['network','fork']){
  const f=await registrationFixture();
  if(mutation==='network'){const read=f.node.getNodeInfo;f.node.getNodeInfo=async()=>({...await read(),l1ChainId:1});}
  else {const read=f.node.getBlockData;f.node.getBlockData=async ref=>{const block=await read(ref);return {...block,blockHash:Fr.fromString(hex(999))};};}
  await assert.rejects(prepareRollingDeployment(createRollingDeploymentPreparation(f.registrationOptions),{contextGuard:f.options.contextGuard}),{code:'ROLLING_DEPLOYMENT_INVALID'});
 }
});
test('published registration drains native initialization before changed account context can publish metadata',async()=>{
 const f=await registrationFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers(),create=f.options.sdk.createTrustedPrivateNode;let valid=true,settled=false;
 f.options.sdk.createTrustedPrivateNode=async options=>{entered.resolve();await gate.promise;return create(options);};
 const work=prepareRollingDeployment(createRollingDeploymentPreparation(f.registrationOptions),{contextGuard:async()=>{if(!valid)throw Error('changed account');}}).finally(()=>settled=true),rejected=assert.rejects(work);
 await entered.promise;valid=false;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);gate.resolve();await rejected;
});

for(const defect of ['stale-node','l1-reorg','portal-binding'])test(`published registration does not replace fresh financial authority: ${defect}`,async()=>{
 const f=await registrationFixture(),handle=createRollingDeploymentPreparation(f.registrationOptions);
 const {deployment,node}=await prepareRollingDeployment(handle,{contextGuard:f.options.contextGuard});
 const scope={feePortal:eth(31),feeToken:eth(32)},iface=new Interface(['function UNDERLYING() view returns(address)','function decimals() view returns(uint8)']);let reads=0;
 node.getL1ContractAddresses=async()=>({feeJuicePortalAddress:scope.feePortal});
 if(defect==='stale-node')node.getSyncedL1Timestamp=async()=>0n;
 const provider={getBlock:async tag=>{reads++;return {number:20,hash:defect==='l1-reorg'&&tag===20?hex(67):hex(66)};},call:async request=>{reads++;const name=iface.parseTransaction(request).name;return iface.encodeFunctionResult(name,[name==='UNDERLYING'?defect==='portal-binding'?eth(99):scope.feeToken:18]);}};
 await assert.rejects(verifyRollingAggregateScope({sdk:f.options.sdk,ethers:{Interface},node,provider,scope,network:deployment.network,proofsEnabled:true,contextGuard:async()=>{},includeBok:false,asset:'ETH'}));
 assert(reads>=3,'current financial reads still run and drain after registration');
});

for(const failing of ['none','assets','node','both'])test('published startup overlaps authenticated assets and actual node inspection, draining '+failing,async()=>{
 const f=await registrationFixture(),nodeGate=Promise.withResolvers(),assetGate=Promise.withResolvers(),entered=Promise.withResolvers();
 const factory=f.options.sdk.createTrustedPrivateNode;let nodeCalls=0,assetCalls=0,settled=false;
 const started=()=>{if(nodeCalls===1&&assetCalls===1)entered.resolve();};
 f.options.sdk.createTrustedPrivateNode=async options=>{nodeCalls++;started();await nodeGate.promise;if(failing==='node'||failing==='both')throw Error('node rejected');return factory(options);};
 const {boardArtifact,privateFeeArtifact,registration,artifactHashes,...fixed}=f.registrationOptions;
 const handle=createRollingDeploymentPreparation({...fixed,loadRegistrationArtifacts:async()=>{assetCalls++;started();await assetGate.promise;if(failing==='assets'||failing==='both')throw Error('asset rejected');return {boardArtifact,privateFeeArtifact,registration,artifactHashes};}});
 const work=prepareRollingDeployment(handle,{contextGuard:f.options.contextGuard});work.then(()=>settled=true,()=>settled=true);
 const outcome=failing==='none'?work:assert.rejects(work,{code:'ROLLING_DEPLOYMENT_INVALID'});
 await entered.promise;
 if(failing==='assets')assetGate.resolve();else nodeGate.resolve();
 await new Promise(setImmediate);assert.equal(settled,false,'initialization retains its owner until both independent branches drain');
 assetGate.resolve();nodeGate.resolve();const result=await outcome;
 assert.equal(nodeCalls,1);assert.equal(assetCalls,1);
 if(failing==='none'){
  assert.equal(result.node,f.node);assert.equal(result.nodeSnapshot,f.initial());assert(getTrustedNodeSnapshotInfo(result.nodeSnapshot,f.node));
  assertRollingDeploymentPreparation(handle,{...f.options,node:f.node});
  assert.equal((await readRollingDeploymentRegistration(handle,f.options)).deployment.board.artifact,boardArtifact);
  await prepareRollingDeployment(handle,{contextGuard:f.options.contextGuard});assert.equal(nodeCalls,1);assert.equal(assetCalls,1);
  await assert.rejects(consumeRollingDeploymentPreparation(handle,f.options),{code:'ROLLING_DEPLOYMENT_INVALID'});
  assert.throws(()=>exportRollingDeploymentRegistration(handle,artifactHashes),{code:'ROLLING_DEPLOYMENT_INVALID'});
 }else assert.throws(()=>assertRollingDeploymentPreparation(handle,{...f.options,node:f.node}),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
for(const change of ['context','descriptor'])test('published startup rejects held '+change+' change before metadata publication',async()=>{
 const f=await registrationFixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let valid=true;
 const {boardArtifact,privateFeeArtifact,registration,artifactHashes,...fixed}=f.registrationOptions;
 const handle=createRollingDeploymentPreparation({...fixed,loadRegistrationArtifacts:async()=>{entered.resolve();await gate.promise;return {boardArtifact,privateFeeArtifact,registration,artifactHashes};}});
 const work=prepareRollingDeployment(handle,{contextGuard:async()=>{assert(valid);}}),rejected=assert.rejects(work,{code:'ROLLING_DEPLOYMENT_INVALID'});
 await entered.promise;if(change==='context')valid=false;else registration.config.network.rollupVersion='999';gate.resolve();await rejected;
 assert.throws(()=>assertRollingDeploymentPreparation(handle,{...f.options,node:f.node}),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
