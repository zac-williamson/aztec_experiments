import {computeFeeJuiceMessageNullifier} from '@aztec-labs/stdlib/messaging';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {poseidon2Hash,poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {SiblingPath} from '@aztec-labs/foundation/trees';
import {DomainSeparator,PUBLIC_DATA_TREE_HEIGHT} from '@aztec-labs/constants';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {computePublicDataTreeLeafSlot,siloNullifier} from '@aztec-labs/stdlib/hash';
import {MerkleTreeId,PublicDataWitness,PublicDataTreeLeaf,PublicDataTreeLeafPreimage} from '@aztec-labs/stdlib/trees';
import {BlockHeader,CallContext,TxContext} from '@aztec-labs/stdlib/tx';
import {GasSettings} from '@aztec-labs/stdlib/gas';
import {PrivateContextInputs} from '@aztec-labs/stdlib/kernel';
import {loadContractArtifact,FunctionSelector} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,SerializableContractInstance,computeContractAddressFromInstance} from '@aztec-labs/stdlib/contract';
import {PublicKeys} from '@aztec-labs/stdlib/keys';
import {WASMSimulator,toACVMWitness} from '@aztec-labs/simulator/client';
import {PrivateExecutionOracle,buildACIRCallback} from '@aztec-labs/pxe/simulator';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {withCache} from '../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js';
import {ORDINARY_POST_GAS_PROFILE} from '../shared/ordinary-post-fees.mjs';
import {allToCompletion} from '@aztec-labs/foundation/promise';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {openTmpStore} from '@aztec-labs/kv-store/lmdb-v2';
import {FactStore,FactService,FactCollectionKey} from '../node_modules/@aztec-labs/pxe/dest/storage/fact_store/index.js';
import {StagedWriteCoordinator} from '../node_modules/@aztec-labs/pxe/dest/storage/staged_write_coordinator.js';
import {ContractSyncService} from '../node_modules/@aztec-labs/pxe/dest/contract/contract_sync_service.js';
import {ContractClassService} from '../node_modules/@aztec-labs/pxe/dest/contract/contract_class_service.js';
import {OperationQueue} from '../node_modules/@aztec-labs/pxe/dest/operation_queue.js';
import {validatedPxeProve} from './pxe-validated-prove.mjs';
import {restoreNativePxe} from './patch-pxe-operation-guards.mjs';
const transformed=validatedPxeProve(restoreNativePxe(fs.readFileSync(new URL('../node_modules/@aztec-labs/pxe/dest/pxe.js',import.meta.url),'utf8'),'dest/pxe.js'));
const methodStart=transformed.indexOf('    prefetchBoardClaimWitnesses(board) {');
const registeredMethod=transformed.slice(transformed.indexOf('    async #registeredSyncTarget('),transformed.indexOf('    async #syncOrdinaryPostTargets('));
const syncMethod=transformed.slice(transformed.indexOf('    async #syncOrdinaryPostTargets('),transformed.indexOf('    prepareOrdinaryPostState(',transformed.indexOf('    async #syncOrdinaryPostTargets(')));
const nativeMethod=transformed.slice(methodStart,transformed.indexOf('    prepareBoardActionState(',methodStart));
const resources=[];
after(async()=>{for(const {queue,db} of resources){await queue.stop();await db.close();}await BarretenbergSync.destroySingleton();});
const raw=JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')),artifact=loadContractArtifact(raw),circuit=raw.functions.find(fn=>fn.name==='claim_deposit');
const boardClass=(await getContractClassFromArtifact(artifact)).id;
const bokRaw=JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_BOK_ARTIFACT??new URL('../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url),'utf8')),bokArtifact=loadContractArtifact(bokRaw),bokClass=(await getContractClassFromArtifact(bokArtifact)).id;
const source=fs.readFileSync(new URL('../shared/board-claim-witnesses.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export async function','async function');
const pair=(a,b)=>poseidon2HashWithSeparator([a,b],DomainSeparator.PUBLIC_DATA_MERKLE);
async function fixture({bokClaim=false}={}){
 const owner=AztecAddress.fromFieldUnsafe(new Fr(8));
 const selectedArtifact=bokClaim?bokArtifact:artifact,selectedCircuit=bokClaim?bokRaw.functions.find(fn=>fn.name==='claim'):circuit,selectedClass=bokClaim?bokClass:boardClass;
 const instance=new SerializableContractInstance({version:2,salt:Fr.ONE,deployer:AztecAddress.ZERO,currentContractClassId:selectedClass,originalContractClassId:selectedClass,initializationHash:new Fr(77),immutablesHash:Fr.ZERO,publicKeys:PublicKeys.default()});
 const board={address:await computeContractAddressFromInstance(instance),currentContractClassId:instance.currentContractClassId};
 let header=BlockHeader.empty();header.globalVariables.blockNumber=3;header.globalVariables.chainId=Fr.ONE;header.globalVariables.version=Fr.ONE;header.globalVariables.timestamp=100n;
 const fields=[1,9,1,10,100,10,2,10,2,9].map(n=>new Fr(n)),values=new Map(fields.map((v,i)=>[String(i+3),v]));values.set('1',new Fr(7));
 const slots=bokClaim?[{slot:7n,length:1},{slot:9n,length:1},{slot:11n,length:1}]:[{slot:1n,length:1},{slot:3n,length:10}],entries=[];
 if(bokClaim){values.clear();values.set('7',new Fr(7));values.set('9',Fr.ONE);values.set('11',Fr.ONE);}
 for(const s of slots){const slot=await computePublicDataTreeLeafSlot(board.address,new Fr(s.slot+BigInt(s.length))),value=await poseidon2Hash(Array.from({length:s.length},(_,i)=>values.get(String(s.slot+BigInt(i)))));entries.push(new PublicDataTreeLeafPreimage(new PublicDataTreeLeaf(slot,value),Fr.ZERO,0n));}
 const hashes=await Promise.all(entries.map(e=>e.hash())),paths=entries.map(()=>[]);let level=hashes.slice(),height=0;
 while((level.length&(level.length-1))!==0)level.push(Fr.ZERO);
 let zero=Fr.ZERO;
 while(level.length>1){
  paths.forEach((path,i)=>path.push(level[(i>>height)^1]));
  const next=[];for(let i=0;i<level.length;i+=2)next.push(await pair(level[i],level[i+1]));level=next;zero=await pair(zero,zero);height++;
 }
 let root=level[0];for(let i=height;i<PUBLIC_DATA_TREE_HEIGHT;i++){paths.forEach(path=>path.push(zero));root=await pair(root,zero);zero=await pair(zero,zero);}
 header.state.partial.publicDataTree.root=root;
 const witnesses=entries.map((e,i)=>new PublicDataWitness(BigInt(i),e,new SiblingPath(PUBLIC_DATA_TREE_HEIGHT,paths[i].map(f=>f.toBuffer()))));
 const messageCalls=[],calls=[];let held=null,failure=null,exists=true,records=0;
 const read=async(type,fn)=>{calls.push(type);if(held)await held.promise;if(failure===type)throw Error('read unavailable');return fn();};
 const node={findLeavesIndexes:(anchor,tree,items)=>read('nullifier',()=>items.map(()=>exists?{data:1n,l2BlockNumber:header.globalVariables.blockNumber,l2BlockHash:anchor.hash}:undefined)),getPublicStorageAt:(anchor,address,slot)=>read('storage',()=>values.get(slot.toBigInt().toString())),getPublicDataWitness:(anchor,slot)=>read('witness',()=>witnesses.find(w=>w.leafPreimage.leaf.slot.equals(slot)))};
 const discovery=[],classReads=[],syncGates=[];let holdSync=false,failSync=false,badOwner=false;
 const originalNodeGetContract=async(address,anchor)=>{classReads.push({address,anchor});return {currentContractClassId:address.equals(owner)?Fr.fromString(badOwner?'0x01':ORDINARY_POST_GAS_PROFILE.accountClassId):selectedClass};};
 node.getContract=originalNodeGetContract;
 const cachedNode=withCache(node),store={getContractInstance:async()=>instance,getContractArtifact:async()=>selectedArtifact,getFunctionCall:async(name,args,to)=>({name,args,to,selector:FunctionSelector.fromString('0x418ef5da')})};
 const classService=new ContractClassService(cachedNode,store);
 const service=new ContractSyncService(cachedNode,store,classService,{getNotes:async()=>[]},{debug(){},warn(){}},{concurrentContractSyncEnabled:false});
 const utility=async(_sim,call,auth,scopes,anchor,changeSetId)=>{
  assert.equal(call.name,'sync_state');assert.equal(scopes.length,1);assert.ok(scopes[0].equals(owner));assert.equal(anchor,header);assert.ok(changeSetId!==undefined);assert.equal(auth.length,0);
  discovery.push(call.to.toString());if(holdSync)await new Promise((resolve,reject)=>syncGates.push({resolve,reject}));if(failSync&&call.to.equals(board.address))throw Error('discovery failed');
 };
 const db=await openTmpStore('board-claim-witnesses',true,8192),facts=new FactStore(db),writes=new StagedWriteCoordinator({kvStore:db,stagedStores:[facts]});
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{sync:()=>assert.fail('no extra global sync')},anchorBlockStore:{getBlockHeader:async()=>header},contributors:[service],stagedWriteCoordinator:writes,log:{debug(){},verbose(){},warn(){},error(){}}});queue.start();resources.push({queue,db});
 const Native=vm.runInNewContext('(class {#executeUtility=utility;#getSimulatorForTx=()=>({});'+registeredMethod+syncMethod+nativeMethod+'})',{computeContractAddressFromInstance,measureRollingProofPhase:(_name,work)=>work(),utility,SyncAddress:AztecAddress,SyncFr:Fr,SyncFactCollectionKey:FactCollectionKey,syncSha256ToField:sha256ToField,syncPublicDataLeaf:computePublicDataTreeLeafSlot,syncSiloNullifier:siloNullifier,syncPoseidon:poseidon2HashWithSeparator,SyncTreeId:MerkleTreeId,allToCompletion,Buffer});
 const pxe=new Native();Object.assign(pxe,{node:cachedNode,contractSyncService:service,getSyncedBlockHeader:async()=>header,operationQueue:queue,factStore:facts,contractClassService:classService,contractStore:store});const wallet={pxe};
 const factService=new FactService(facts,[]);
 const context=vm.createContext({getContractClassFromArtifact,Fr,poseidon2HashWithSeparator,computePublicDataTreeLeafSlot,siloNullifier,MerkleTreeId,ORDINARY_POST_GAS_PROFILE,isPrivatePXEForNode:(p,n)=>p===pxe&&n===node});vm.runInContext(source,context);
 const input={wallet,node,owner,...(bokClaim?{bok:board}:{board}),artifact:selectedArtifact};
 const run=async(expected=null)=>{
  const reached=Error('reached message after both immutable proofs');
  const execute=queue.runSynced(async ctx=>{
  const callContext=CallContext.empty();callContext.contractAddress=board.address;callContext.msgSender=AztecAddress.fromFieldUnsafe(new Fr(8));callContext.functionSelector=await FunctionSelector.fromNameAndParameters(selectedCircuit.name,selectedArtifact.functions.find(f=>f.name===selectedCircuit.name).parameters);
  const txContext=new TxContext(1,1,GasSettings.empty()),inputs=new PrivateContextInputs(callContext,header,txContext,1,new Fr(91));
  const oracle=new PrivateExecutionOracle({anchorBlockHeader:header,callContext,txContext,protocolNullifier:new Fr(91),scopes:[callContext.msgSender],aztecNode:pxe.node,anchoredContractData:{getContractInstance:async()=>instance},noteCache:{getNullifiers:()=>new Set(),isSideEffectCounterRevertible:()=>true},changeSetId:ctx.changeSetId,factService:{getFactCollection:(...args)=>factService.getFactCollection(...args),recordFact:(...args)=>{records++;return factService.recordFact(...args);}},l2TipsStore:{getL2Tips:async()=>({proposed:{block:{number:header.globalVariables.blockNumber}},checkpointed:{block:{number:header.globalVariables.blockNumber}},proven:{block:{number:header.globalVariables.blockNumber}},finalized:{block:{number:header.globalVariables.blockNumber}}})}});
  oracle.getL1ToL2MembershipWitnessV2=async(message,nullifier)=>{messageCalls.push({message,nullifier:nullifier.value});throw reached;};
  const seen=[],callback=buildACIRCallback(oracle);
  return new WASMSimulator({module:'claim-immutable-parity'}).executeUserCircuit(toACVMWitness(0,[...inputs.toFields(),...(bokClaim?[new Fr(10),new Fr(6),new Fr(5),new Fr(1)]:[new Fr(5),new Fr(10),new Fr(6),new Fr(1)])]),{...selectedCircuit,bytecode:Buffer.from(selectedCircuit.bytecode,'base64'),contractName:selectedArtifact.name},new Proxy(callback,{get(target,key){const fn=target[key];return typeof fn==='function'?async(...args)=>{seen.push(key);return fn(...args);}:fn;}}));
  });
  await assert.rejects(execute,e=>{if(expected){assert.ok(!e.message.includes(reached.message),'native validation must fail before the message oracle');assert.match(e.message,expected);return true;}if(e.cause===reached||e.message.includes(reached.message))return true;throw e;});
 };
 return {input,run,messageCalls,discovery,classReads,syncGates,holdSync:()=>holdSync=true,failSync:value=>failSync=value,badOwner:()=>badOwner=true,
 ensure:()=>queue.runSynced(async ctx=>{for(const contract of [owner,board.address])await service.ensureContractSynced({contract,utilityExecutor:(call,scopes)=>utility({},call,[],scopes,ctx.anchorBlockHeader,ctx.changeSetId),anchorBlockHeader:ctx.anchorBlockHeader,changeSetId:ctx.changeSetId,scopes:[owner],triggeredBy:undefined});}),
 warm:()=>bokClaim?context.prefetchBokClaimWitnesses(input):context.prefetchBoardClaimWitnesses(input),calls,get header(){return header;},advance:()=>{header=BlockHeader.fromBuffer(header.toBuffer());header.globalVariables.blockNumber++;service.wipe();},rewind:()=>{header=BlockHeader.fromBuffer(header.toBuffer());header.globalVariables.blockNumber--;},prune:()=>facts.rollbackToBlock(2),pxe,values,witnesses,get records(){return records;},seed:()=>queue.runSynced(async ctx=>{for(const s of slots){await facts.recordFact(new FactCollectionKey(board.address,{type:'public'},sha256ToField(Buffer.from('AZTEC_NR::PUBLIC_IMMUTABLE_CACHE_TYPE_ID')),new Fr(s.slot)),sha256ToField(Buffer.from('AZTEC_NR::PUBLIC_IMMUTABLE_VALUE_READ')),Array.from({length:s.length},(_,i)=>values.get(String(s.slot+BigInt(i)))),{blockNumber:header.getBlockNumber(),blockHash:await header.hash()},ctx.changeSetId);}}),hold:()=>held=Promise.withResolvers(),fail:type=>failure=type,absent:()=>exists=false};
}
test('current compiled Board class reaches message consumption independently of ordinary-post gas qualification',async()=>{
 const f=await fixture();await f.warm();assert.equal(f.records,0);assert.equal(f.calls.length,14);await f.run();assert.equal(f.records,2);assert.equal(f.calls.length,14);
});

test('native source pins qualify the initialization separator and packed immutable protocol',()=>{
 for(const [suffix,hash] of [['/public_immutable.nr','f2d67de7969db0a6e122df64970aea8b1607129ad9778cd2c566ebdafad7b176'],['/initialization_utils.nr','945322b1ce762831642c010b366ca6a450c8bcbda2febce8363470f25f3353b4']]){
  const files=Object.values(raw.file_map).filter(file=>file.path.endsWith(suffix));assert.equal(files.length,1);assert.equal(createHash('sha256').update(files[0].source).digest('hex'),hash);
 }
});
test('cold compiled claim performs the same two native immutable proofs',async()=>{
 const f=await fixture();await f.run();assert.equal(f.records,2);assert.equal(f.calls.length,15);
});
for(const defect of ['uninitialized','storage','root'])test('prefetch preserves compiled native rejection: '+defect,async()=>{
 const f=await fixture();if(defect==='uninitialized')f.absent();if(defect==='storage')f.values.set('3',new Fr(999));if(defect==='root')f.header.state.partial.publicDataTree.root=new Fr(888);
 await f.warm();await f.run(/Assertion failed/);assert.equal(f.records,defect==='uninitialized'?0:1,'native staged fact callback precedes circuit proof failure; no successful claim is produced');
});
test('same anchor reuses native cache, a new anchor requires new reads',async()=>{
 const f=await fixture();await f.warm();await f.warm();assert.equal(f.calls.length,14);
 f.advance();await f.warm();assert.equal(f.calls.length,28);await f.run();assert.equal(f.calls.length,28);
});
test('rejected native reads are evicted and siblings drain before failure',async()=>{
 const f=await fixture();f.fail('storage');await assert.rejects(f.warm(),/read unavailable/);assert.equal(f.calls.length,14);
 f.fail(null);await f.warm();assert.equal(f.calls.length,25,'only eleven failed storage reads retry');await f.run();assert.equal(f.calls.length,25);
});
for(const change of ['anchor','route'])test('held reads drain before '+change+' replacement rejects',async()=>{
 const f=await fixture(),gate=f.hold();let settled=false;const work=f.warm().finally(()=>settled=true),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 while(f.calls.length<14)await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
 if(change==='anchor')f.advance();else f.pxe.node={};gate.resolve();await rejected;
});
for(const invalid of ['class','layout','route'])test('invalid '+invalid+' makes no node reads',async()=>{
 const f=await fixture();if(invalid==='class')f.input.board.currentContractClassId=Fr.ONE;if(invalid==='layout')f.input.artifact={...artifact,storageLayout:{...artifact.storageLayout,config:{slot:4}}};if(invalid==='route')f.input.wallet.pxe={...f.pxe};
 await assert.rejects(f.warm(),{code:invalid==='route'?'ROLLING_CONTEXT_CHANGED':'ROLLING_ABI_MISMATCH'});assert.equal(f.calls.length,0);
});

test('a synchronous read failure still drains every started sibling',async()=>{
 const f=await fixture(),gate=Promise.withResolvers(),entered=Promise.withResolvers();let settled=false,started=0;
 const witness=f.input.node.getPublicDataWitness;
 f.input.node.getPublicDataWitness=async(...args)=>{if(++started===2)entered.resolve();await gate.promise;return witness(...args);};
 f.input.node.getPublicStorageAt=()=>{throw Error('synchronous storage failure');};
 const work=f.warm().finally(()=>settled=true),rejected=assert.rejects(work,/synchronous storage failure/);
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);gate.resolve();await rejected;
});

test('existing native immutable facts suppress eleven packed reads and initialization reads at a new anchor',async()=>{
 const f=await fixture();await f.seed();f.advance();await f.warm();assert.deepEqual(f.calls,['witness','witness']);await f.run();assert.equal(f.records,0);assert.equal(f.calls.length,2);
});
test('failed compiled claim does not publish staged native immutable facts',async()=>{
 const f=await fixture();await f.warm();await f.run();assert.equal(f.records,2);f.advance();await f.warm();assert.equal(f.calls.length,28,'aborted native facts cannot suppress fresh-anchor reads');
});

test('native reorg retraction restores only missing immutable prefetch work',async()=>{
 const f=await fixture();await f.seed();await f.prune();f.advance();await f.warm();assert.equal(f.calls.length,14);await f.run();assert.equal(f.calls.length,14);
});
test('native fact from a later block retains the required initialization lookup',async()=>{
 const f=await fixture();await f.seed();f.rewind();await f.warm();assert.deepEqual(f.calls,['nullifier','witness','witness']);await f.run();assert.equal(f.calls.length,3);assert.equal(f.records,0);
});
test('current deployed class is rechecked inside native preparation',async()=>{
 const f=await fixture();f.pxe.contractClassService.getCurrentClassId=async()=>Fr.ONE;await assert.rejects(f.warm(),/Invalid Board claim/);assert.equal(f.calls.length,0);
});


test('compiled Bok claim cold and prefetched paths verify all three exact native immutables',async()=>{
 const cold=await fixture({bokClaim:true});await cold.run();assert.equal(cold.records,3);assert.equal(cold.calls.length,9);
 const warm=await fixture({bokClaim:true});await warm.warm();assert.equal(warm.records,0);assert.equal(warm.calls.length,7);await warm.run();assert.equal(warm.records,3);assert.equal(warm.calls.length,7,'compiled claim performs no extra immutable RPC after the wave');
});
for(const defect of ['uninitialized','storage','root'])test('compiled Bok immutable prefetch retains native rejection: '+defect,async()=>{
 const f=await fixture({bokClaim:true});if(defect==='uninitialized')f.absent();if(defect==='storage')f.values.set('9',new Fr(999));if(defect==='root')f.header.state.partial.publicDataTree.root=new Fr(888);
 await f.warm();await f.run(/Assertion failed/);
});
test('Bok native facts retain only three anchored hash witnesses and reorg restores full wave',async()=>{
 const f=await fixture({bokClaim:true});await f.seed();f.advance();await f.warm();assert.deepEqual(f.calls,['witness','witness','witness']);await f.run();assert.equal(f.records,0);assert.equal(f.calls.length,3);
 await f.prune();f.advance();await f.warm();assert.equal(f.calls.length,10);await f.run();assert.equal(f.calls.length,10);
});
for(const change of ['anchor','route'])test('Bok held immutable wave drains and rejects '+change+' replacement',async()=>{
 const f=await fixture({bokClaim:true}),gate=f.hold();let settled=false;const work=f.warm().finally(()=>settled=true),rejected=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 while(f.calls.length<7)await new Promise(setImmediate);assert.equal(settled,false);if(change==='anchor')f.advance();else f.pxe.node={};gate.resolve();await rejected;
});
test('Bok deployed class and artifact layout qualification precede immutable reads',async()=>{
 const f=await fixture({bokClaim:true});f.pxe.contractClassService.getCurrentClassId=async()=>Fr.ONE;await assert.rejects(f.warm(),/Invalid Bok claim/);assert.equal(f.calls.length,0);
 const g=await fixture({bokClaim:true});g.input.artifact={...bokArtifact,storageLayout:{...bokArtifact.storageLayout,portal:{slot:8}}};await assert.rejects(g.warm(),{code:'ROLLING_ABI_MISMATCH'});assert.equal(g.calls.length,0);
});
test('Bok rejected immutable reads drain then retry only failed native cache entries',async()=>{
 const f=await fixture({bokClaim:true});f.fail('storage');await assert.rejects(f.warm(),/read unavailable/);assert.equal(f.calls.length,7);f.fail(null);await f.warm();assert.equal(f.calls.length,10);await f.run();assert.equal(f.calls.length,10);
});

test('Bok preparation shares native owner discovery with later execution at the exact anchor',async()=>{
 const f=await fixture({bokClaim:true});await f.warm();
 assert.deepEqual(new Set(f.discovery),new Set([f.input.owner.toString(),f.input.bok.address.toString()]));
 assert.equal(f.classReads.length,2,'class qualification and native discovery share exact-anchor node cache');
 await f.ensure();await f.run();assert.equal(f.discovery.length,2,'execution reuses native ContractSyncService; no repeated owner scan');
 f.advance();await f.warm();await f.ensure();assert.equal(f.discovery.length,4,'native anchor invalidation requires new discovery');
});
test('Bok preparation drains immutable reads while failed discovery discards native sync cache',async()=>{
 const f=await fixture({bokClaim:true}),gate=f.hold();f.failSync(true);let settled=false;
 const work=f.warm().finally(()=>settled=true),reject=assert.rejects(work,/discovery failed/);
 while(f.discovery.length<2)await new Promise(setImmediate);assert.equal(settled,false);gate.resolve();await reject;
 f.failSync(false);await f.warm();assert.equal(f.discovery.length,4,'discarded sync must retry rather than reuse partial discovery');
});
test('Bok preparation drains held discovery after an immutable read failure',async()=>{
 const f=await fixture({bokClaim:true});f.holdSync();f.fail('storage');let settled=false;
 const work=f.warm().finally(()=>settled=true),reject=assert.rejects(work,/read unavailable/);
 while(f.syncGates.length<2)await new Promise(setImmediate);assert.equal(settled,false);f.syncGates.forEach(g=>g.resolve());await reject;
});
test('Bok preparation rejects another account class before private discovery',async()=>{
 const f=await fixture({bokClaim:true});f.badOwner();await assert.rejects(f.warm(),/Invalid Bok claim/);assert.equal(f.discovery.length,0);assert.equal(f.calls.length,0);
});
test('Bok preparation rejects a missing or self owner before discovery',async()=>{
 const f=await fixture({bokClaim:true});delete f.input.owner;await assert.rejects(f.warm(),{code:'ROLLING_ABI_MISMATCH'});assert.equal(f.discovery.length,0);
 f.input.owner=f.input.bok.address;await assert.rejects(f.warm(),/Invalid Bok claim owner/);assert.equal(f.discovery.length,0);
});

test('compiled Bok single-secret message nullifier equals the native helper used by preparation',async()=>{
 const f=await fixture({bokClaim:true});await f.run();assert.equal(f.messageCalls.length,1);
 const {message,nullifier}=f.messageCalls[0];assert(nullifier.contractAddress.equals(f.input.bok.address));
 // fixture.run supplies the compiled claim's bridge_secret = 5 (salt = 6).
 const expected=await computeFeeJuiceMessageNullifier(message,new Fr(5));
 assert(nullifier.nullifier.equals(expected));
 assert((await siloNullifier(nullifier.contractAddress,nullifier.nullifier)).equals(await siloNullifier(f.input.bok.address,expected)));
});
