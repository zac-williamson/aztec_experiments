// Actual AES-GCM journal slots, Poseidon and normally processed SDK event ABI;
// labelled PXE/node/chain fixtures below do NOT qualify network/cold recovery.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {BlockHash,BlockParameterSchema} from '@aztec-labs/stdlib/block';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {EventSelector,decodeFunctionSignature,loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {createPreferenceEventDecoder} from './preference-events.mjs';
import {createRollingPreferenceReader} from './preference-reader.mjs';
const nodeEntry=import.meta.resolve('@aztec-labs/aztec-node');
const {normalizeBlockParameter}=await import(new URL('./modules/block_parameter.js',nodeEntry));
const {UnseenBlockHoldOff}=await import(new URL('./modules/unseen_block_hold_off.js',nodeEntry));
after(()=>BarretenbergSync.destroySingleton());
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const address=n=>new AztecAddress(new Fr(n));
const changed=(block,kind=1,target='2',value=true,read_block=0,read_hash='0')=>({block,kind,target,value,read_block,read_hash});
const invalid=p=>assert.rejects(p,e=>['ROLLING_PREFERENCE_READER_UNAVAILABLE','ROLLING_PREFERENCE_READER_INVALID'].includes(e.code)&&!e.cause&&!String(e).includes('PRIVATE_SENTINEL'));
async function fixture(changes=[changed(2),changed(40,3,'8')],height=64){
 const owner=address(3),board=address(99),classId=new Fr(10),walletSecret=h(8),walletSalt='0';
 const values=new Map(),calls=[],state={height,guard:true,route:true,failCAS:false,hook:null,hashOverrides:new Map(),rows:[],head:null};
 const run=async(name,fn)=>{calls.push(name);const result=await fn();if(state.hook)await state.hook(name);return result;};
 const blockHash=block=>state.hashOverrides.get(block)??h(block+100);
 const getHeader=()=>({globalVariables:{blockNumber:state.height},hash:async()=>BlockHash.fromString(blockHash(state.height))});
 const node={getBlockData:block=>run('block:'+block,()=>({header:{globalVariables:{blockNumber:block}},blockHash:BlockHash.fromString(blockHash(block))})),
  getContract:(_,ref)=>run('class',()=>{assert(BlockHash.isBlockHash(ref.hash));return{address:board,currentContractClassId:classId,originalContractClassId:classId};})};
 const pxe={sync:()=>run('sync',()=>{}),getSyncedBlockHeader:()=>run('header',getHeader),
  getPrivateEvents:(selector,filter)=>run('events',()=>{
   state.lastFilter=filter;assert.equal(filter.contractAddress.toString(),board.toString());assert.deepEqual(filter.scopes.map(x=>x.toString()),[owner.toString()]);
   assert.equal(selector.toString(),state.selector.toString());assert(filter.toBlock<=state.height+1);
   return state.rows.filter(row=>row.l2BlockNumber>=filter.fromBlock&&row.l2BlockNumber<filter.toBlock);
  })};
 const privateStore={read:key=>run('store-read',()=>values.get(key)??null),compareAndSwap:(key,old,next)=>run('CAS',()=>{
  if(state.failCAS||old!==(values.get(key)??null))throw Error('PRIVATE_SENTINEL');values.set(key,next);
 })};
 const sdk={Fr,AztecAddress,EventSelector,decodeFunctionSignature,poseidon2HashWithSeparator:(...args)=>run('hash',()=>poseidon2HashWithSeparator(...args)),
  isTrustedPrivateNode:n=>state.route&&n===node,isPrivatePXEForNode:(p,n)=>state.route&&p===pxe&&n===node,
  inspectTrustedNode:async(n,opts)=>run('inspect',()=>{assert.equal(n,node);assert.equal(opts.expectedNetworkScope.chainId,'31337');})};
 const deployment={board:{address:board,artifact,instance:{currentContractClassId:classId,originalContractClassId:classId}},network:{chainId:'31337',version:'1',rollup:'0x'+'11'.repeat(20)},proofsEnabled:true,checkpoint:{number:55,hash:h(155)}};
 const input={sdk,pxe,node,owner,deployment,privateStore,walletSecret,walletSalt,
  readHead:()=>run('head',()=>({...state.head})),contextGuard:async()=>{calls.push('guard');assert(state.guard);}};
 const decoder=await createPreferenceEventDecoder({sdk,artifact});state.selector=decoder.selector;
 async function replace(newChanges){let digest=0n;state.rows=[];
  for(let i=0;i<newChanges.length;i++){
   const e=newChanges[i],fields=[1n,BigInt(i+1),BigInt(e.kind),BigInt(e.target),e.value?1n:0n,BigInt(e.read_block),BigInt(e.read_hash),digest];
   digest=(await poseidon2HashWithSeparator([31337n,1n,99n,...fields],0x52435031)).toBigInt();
   state.rows.push({packedEvent:fields.map(n=>new Fr(n)),eventSelector:decoder.selector,l2BlockNumber:e.block,l2BlockHash:BlockHash.fromString(blockHash(e.block)),txHash:TxHash.fromString(h(1000+e.block))});
  }
  state.head={initialized:newChanges.length>0,schema:1,revision:String(newChanges.length),digest:String(digest)};
 }
 await replace(changes);
 const slot=()=>createEncryptedJournalSlot({storage:privateStore,walletSecret,walletSalt,keyDomain:'ROLLING_PREFERENCES_V1',scopeText:JSON.stringify(['ROLLING_PREFERENCES_V1','31337','1',deployment.network.rollup,board.toString(),classId.toString(),owner.toString(),1])});
 return {input,state,values,calls,replace,slot,reader:createRollingPreferenceReader(input),restart:()=>createRollingPreferenceReader(input),blockHash};
}
test('two bounded steps and actual encrypted prefix restart equal the expected complete result',async()=>{
 const f=await fixture();const first=await f.reader.read();assert.equal(first.status,'recovering');assert.equal(first.complete,false);assert(!('preferences'in first));
 assert.equal(first.progress.scannedThrough,32);assert.equal(first.progress.processedRevision,'1');
 assert.equal(f.state.lastFilter.fromBlock,1); // validation-time deployment checkpoint55 is NOT creation.
 const ciphertext=[...f.values.values()][0];assert(!ciphertext.includes('bookmarks'));assert(!ciphertext.includes(f.input.owner.toString()));
 const second=await f.restart().read();assert.equal(second.status,'complete');assert.deepEqual(second.preferences.bookmarks,['2']);assert.deepEqual(second.preferences.followedNames,['8']);
 assert.equal(f.state.lastFilter.fromBlock,33);assert.equal(second.anchor.blockNumber,64);assert(Object.isFrozen(second.preferences));
});
test('absent head still scans canonical history; unavailable head never becomes empty',async()=>{
 const f=await fixture([],2);assert.deepEqual((await f.reader.read()).preferences.bookmarks,[]);
 f.input.readHead=async()=>{throw Error('PRIVATE_SENTINEL');};await invalid(f.restart().read());
});
test('head advancement continues canonical prefix and includes multiple events in one transaction',async()=>{
 const f=await fixture([changed(2)],2);await f.reader.read();
 await f.replace([changed(2),changed(3,2,'0'),changed(3,5,'0',false)]);f.state.height=3;
 const result=await f.restart().read();assert.equal(result.preferences.replyNotifications,false);assert.deepEqual(result.preferences.followedBoards,['0']);
 assert.equal(f.state.lastFilter.fromBlock,3);assert.equal(result.preferences.head.revision,'3');
});
test('canonical reorg discards orphaned prefix under a new epoch and rebuilds, not merges',async()=>{
 const f=await fixture([changed(2)],2);await f.reader.read();f.state.hashOverrides.set(2,h(999));await f.replace([changed(2,3,'8')]);
 const result=await f.restart().read();assert.equal(result.progress.epoch,1);assert.deepEqual(result.preferences.bookmarks,[]);assert.deepEqual(result.preferences.followedNames,['8']);
});
test('actual AEAD mutation and CAS conflict preserve existing bytes and never publish partial preferences',async()=>{
 const f=await fixture();await f.reader.read();const key=[...f.values.keys()][0],saved=f.values.get(key);
 const corrupt=JSON.parse(saved);corrupt.data=(corrupt.data[0]==='0'?'1':'0')+corrupt.data.slice(1);const bad=JSON.stringify(corrupt);f.values.set(key,bad);
 await invalid(f.restart().read());assert.equal(f.values.get(key),bad);
 f.values.set(key,saved);f.state.failCAS=true;await invalid(f.restart().read());assert.equal(f.values.get(key),saved);
});
test('foreign class/account/domain ciphertext cannot be replayed into the scoped slot',async()=>{
 const f=await fixture();await f.reader.read();const saved=[...f.values.values()][0];
 const g=await fixture();g.input.walletSecret=h(9);g.input.privateStore.read=async()=>saved;
 await invalid(g.restart().read());assert.equal(g.values.size,0);
 const slot=await f.slot(),prior=await slot.read();const malformed=structuredClone(prior.value);malformed.scope[5]=h(44);await slot.write(prior,malformed);
 const bytes=[...f.values.values()][0];await invalid(f.restart().read());assert.equal([...f.values.values()][0],bytes);
});
for(const change of ['head','anchor','class','range','missing','duplicate','order','block-hash','selector'])test(`reject ${change} mismatch before CAS publication`,async()=>{
 const f=await fixture([changed(2),changed(3,3,'8')],4);
 if(change==='head'||change==='anchor')f.state.hook=async name=>{if(name==='events'){if(change==='head')f.state.head={...f.state.head,digest:'1'};else f.state.height=5;}};
 if(change==='class')f.input.node.getContract=async()=>({address:f.input.deployment.board.address,currentContractClassId:new Fr(11),originalContractClassId:new Fr(10)});
 if(change==='range')f.input.pxe.getPrivateEvents=async()=>[{...f.state.rows[0],l2BlockNumber:40}];
 if(change==='missing')f.state.rows.pop();
 if(change==='duplicate')f.state.rows[1]=f.state.rows[0];
 if(change==='order')f.state.rows.reverse();
 if(change==='block-hash')f.state.rows[0].l2BlockHash=BlockHash.fromString(h(999));
 if(change==='selector')f.state.rows[0].eventSelector=new EventSelector(1);
 await invalid(f.restart().read());assert.equal(f.values.size,0);
});
for(const point of ['inspect','store-read','sync','header','block:4','head','class','events','hash'])test(`logout after awaited ${point} stops the next personal operation and prevents publication`,async()=>{
 const f=await fixture([changed(2)],4);let seen=false;
 f.state.hook=async name=>{if(name===point){seen=true;f.state.guard=false;}};
 await invalid(f.reader.read());assert(seen);assert.equal(f.values.size,0);assert(!f.calls.includes('CAS'));
});
test('captured node/PXE/storage capabilities cannot be replaced through retained options during an await',async()=>{
 const f=await fixture([changed(2)],4);let bad=0;
 f.state.hook=async name=>{if(name==='sync'){
  f.input.node={getBlockData:async()=>{bad++;throw Error('PRIVATE_SENTINEL');}};
  f.input.pxe.getPrivateEvents=async()=>{bad++;throw Error('PRIVATE_SENTINEL');};
  f.input.contextGuard=async()=>{bad++;throw Error('PRIVATE_SENTINEL');};
  f.input.privateStore.compareAndSwap=async()=>{bad++;throw Error('PRIVATE_SENTINEL');};
 }};
 assert.equal((await f.reader.read()).status,'complete');assert.equal(bad,0);
});
test('unabortable sync remains busy until it settles; abort suppresses publication without detached work',async()=>{
 const f=await fixture([changed(2)],4);let enter,release;const started=new Promise(r=>{enter=r;}),pending=new Promise(r=>{release=r;});
 f.input.pxe.sync=async()=>{enter();await pending;};const reader=f.restart(),controller=new AbortController();
 const call=reader.read({signal:controller.signal}),observed=invalid(call);await started;controller.abort();
 await assert.rejects(reader.read(),{code:'ROLLING_PREFERENCE_READER_BUSY'});assert.equal(f.values.size,0);
 release();await observed;f.input.pxe.sync=async()=>{};assert.equal((await f.restart().read()).status,'complete');
});
test('deadline expiry after a pending operation waits for settlement and never commits',async()=>{
 const f=await fixture([changed(2)],4);let enter,release;const started=new Promise(r=>{enter=r;}),pending=new Promise(r=>{release=r;});
 f.input.pxe.sync=async()=>{enter();await pending;};const reader=f.restart();const operation=reader.read({deadlineAt:Date.now()+100}),observed=invalid(operation);
 await started;await new Promise(r=>setTimeout(r,120));await assert.rejects(reader.read(),{code:'ROLLING_PREFERENCE_READER_BUSY'});release();await observed;assert.equal(f.values.size,0);
});
test('read marker validation resumes across steps and orphaned hashes cannot suppress notifications',async()=>{
 const changes=Array.from({length:34},(_,i)=>changed(40,6,String(i+1),true,i+1,String(i+101)));
 changes[0].read_hash='999';const f=await fixture(changes,40);
 assert.equal((await f.reader.read()).status,'recovering');
 const validation=await f.restart().read();assert.equal(validation.status,'recovering');assert.equal(validation.progress.markersChecked,32);assert(!('preferences'in validation));
 const result=await f.restart().read();assert.equal(result.status,'complete');assert.equal(result.preferences.readMarkers.length,33);assert.equal(result.orphanedReadMarkers.length,1);
 assert.equal(result.orphanedReadMarkers[0].thread,'1');
});
test('unknown marker canonical header is a failure, never an orphan/empty success',async()=>{
 const f=await fixture([changed(2,6,'4',true,1,'101')],4);const original=f.input.node.getBlockData;
 f.input.node.getBlockData=height=>height===1?Promise.resolve(undefined):original(height);
 await invalid(f.restart().read());assert.equal(f.values.size,0);
});
test('oversized returned page and forged authenticated prefix are rejected without checkpoint advancement',async()=>{
 const f=await fixture([changed(2)],4);f.input.pxe.getPrivateEvents=async()=>Array(513).fill(f.state.rows[0]);await invalid(f.restart().read());assert.equal(f.values.size,0);
 const g=await fixture();await g.reader.read();const slot=await g.slot(),prior=await slot.read();const bad=structuredClone(prior.value);bad.prefix.head.revision='999';await slot.write(prior,bad);
 const saved=[...g.values.values()][0];await invalid(g.restart().read());assert.equal([...g.values.values()][0],saved);
});
test('invalid options and throwing getters produce fixed diagnostics before private operations',async()=>{
 const f=await fixture();const malicious={};Object.defineProperty(malicious,'deadlineAt',{enumerable:true,get(){throw Error('PRIVATE_SENTINEL');}});
 await invalid(f.reader.read(malicious));await invalid(f.reader.read({secret:'PRIVATE_SENTINEL'}));assert.equal(f.calls.length,0);
});

test('canonical change during CAS suppresses publication; retained ciphertext is checked on explicit restart',async()=>{
 const f=await fixture([changed(2)],4);let once=false;
 f.state.hook=async name=>{if(name==='CAS'&&!once){once=true;f.state.hashOverrides.set(4,h(999));}};
 await invalid(f.reader.read());assert.equal(f.values.size,1); // committed recovery record is preserved, never erased.
 f.state.hook=null;const result=await f.restart().read();assert.equal(result.status,'complete');assert.equal(result.progress.epoch,1);
});
test('failed tail verification preserves the prior authenticated checkpoint',async()=>{
 const f=await fixture();await f.reader.read();const saved=[...f.values.values()][0];f.state.rows.pop();
 await invalid(f.restart().read());assert.equal([...f.values.values()][0],saved);
});
test('unknown checkpoint block does not get classified as a canonical reorg or silently reset',async()=>{
 const f=await fixture();await f.reader.read();const saved=[...f.values.values()][0],original=f.input.node.getBlockData;
 f.input.node.getBlockData=height=>height===32?Promise.resolve(undefined):original(height);
 await invalid(f.restart().read());assert.equal([...f.values.values()][0],saved);
});
test('trusted route replacement during an awaited operation prevents the next private query',async()=>{
 const f=await fixture([changed(2)],4);f.state.hook=async name=>{if(name==='sync')f.state.route=false;};
 await invalid(f.reader.read());assert(!f.calls.includes('events'));assert.equal(f.values.size,0);
});
test('logout during CAS/readback returns no preference result and preserves committed recovery bytes',async()=>{
 const f=await fixture([changed(2)],4);f.state.hook=async name=>{if(name==='CAS')f.state.guard=false;};
 await invalid(f.reader.read());assert.equal(f.values.size,1);f.state.hook=null;f.state.guard=true;
 assert.equal((await f.restart().read()).status,'complete');
});
test('marker continuation metadata is strictly bound and cannot skip beyond the authenticated prefix',async()=>{
 const f=await fixture([changed(2,6,'4',true,1,'101')],4);await f.reader.read();
 const slot=await f.slot(),saved=await slot.read(),bad=structuredClone(saved.value);bad.markers={nextIndex:2,canonical:[true,true]};
 await slot.write(saved,bad);const bytes=[...f.values.values()][0];await invalid(f.restart().read());assert.equal([...f.values.values()][0],bytes);
});

// Installed native hold-off and RPC schema; the backing block source alone is a labelled fixture.
test('native class lookup retains the exact SDK BlockHash while RPC parsing and persisted anchors stay compatible',async()=>{
 const f=await fixture([changed(2)],4),typed=BlockHash.fromString(f.blockHash(4));
 const silent={verbose(){}};
 const source={getBlockData:async query=>query.hash?.equals(typed)?{blockHash:typed}:undefined,
  getGenesisBlockHash:()=>BlockHash.fromString(h(0))};
 const holdoff=new UnseenBlockHoldOff(source,{byHashWaitMs:0,byNumberWaitMs:0},silent);
 // Native normalization does not perform the RPC schema's string-to-BlockHash conversion.
 const missingSource={...source,getBlockData:async()=>undefined};
 const nativeMiss=new UnseenBlockHoldOff(missingSource,{byHashWaitMs:0,byNumberWaitMs:0},silent);
 await assert.rejects(nativeMiss.getBlockData(normalizeBlockParameter({hash:typed.toString()})),TypeError);
 const parsed=BlockParameterSchema.parse({hash:typed.toString()});assert(BlockHash.isBlockHash(parsed.hash));
 assert.equal(await nativeMiss.getBlockData(normalizeBlockParameter(parsed)),undefined);
 f.input.pxe.getSyncedBlockHeader=async()=>({globalVariables:{blockNumber:4},hash:async()=>typed});
 let calls=0;
 f.input.node.getContract=async(_,ref)=>{
  calls++;assert.equal(ref.hash,typed);assert.equal((await holdoff.getBlockData(normalizeBlockParameter(ref))).blockHash,typed);
  return {address:f.input.deployment.board.address,...f.input.deployment.board.instance};
 };
 const result=await f.restart().read();assert.equal(result.status,'complete');assert(calls>=3);
 assert.deepEqual(result.anchor,{blockNumber:4,blockHash:typed.toString()});
 const cache=(await (await f.slot()).read()).value;
 assert.deepEqual(cache.checkpoint,{blockNumber:4,blockHash:typed.toString()});
 assert.equal(typeof cache.checkpoint.blockHash,'string');
});
