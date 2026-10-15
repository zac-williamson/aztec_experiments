import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollingColdPreferenceReader} from './cold-preference-reader.mjs';
import {PREFERENCE_DOMAIN} from './preferences.mjs';
// Explicit presentation/transport fixtures. AEAD/CAS and production fold/decoder
// run for real; SDK provenance, chain, field and hash here are labelled doubles.
// These tests do not qualify actual encrypted-log discovery or the SDK cursor.
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
class Field{constructor(n){this.n=BigInt(n);}toString(){return hex(this.n);}toBigInt(){return this.n;}static fromString(s){return new Field(s);}}
const types=[{kind:'integer',sign:'unsigned',width:32},{kind:'integer',sign:'unsigned',width:64},{kind:'integer',sign:'unsigned',width:8},{kind:'field'},{kind:'boolean'},{kind:'integer',sign:'unsigned',width:32},{kind:'field'},{kind:'field'}];
const names=['schema','revision','kind','target','value','read_block','read_hash','previous_digest'];
const artifact={name:'RollingBoard',outputs:{structs:{events:[{path:'RollingBoard::PreferenceChanged',kind:'struct',fields:names.map((name,i)=>({name,type:types[i]}))}]}}};
const selector='0x00001234';
const hash=fields=>fields.reduce((a,b,i)=>a+b*BigInt(i+1),BigInt(PREFERENCE_DOMAIN));
function fixture({marker=false}={}){
 const state={valid:true,canonical:true,syncs:0,steps:0,status:0,restarts:0,hashes:0,failReply:false,failCAS:false,afterCAS:null,pending:null,requests:[],transport:[],mutate:null};
 const db=new Map();const originalRead=async key=>db.get(key)??null;
 const privateStore={read:originalRead,compareAndSwap:async(key,old,next)=>{if(state.failCAS){state.failCAS=false;throw Error('private sentinel');}assert.equal(db.get(key)??null,old);db.set(key,next);state.afterCAS?.();}};
 const node={getBlockData:async number=>({header:{globalVariables:{blockNumber:number},hash:async()=>new Field(state.canonical?10+number:999)},blockHash:new Field(state.canonical?10+number:999)})};
 const owner={toString:()=>hex(3)};
 const deployment={board:{address:hex(2),instance:{currentContractClassId:new Field(4),originalContractClassId:new Field(4)},artifact},network:{chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},proofsEnabled:false};
 let digest=0n;const events=[];
 for(const [kind,target,value,readBlock,readHash]of [[1,77,true,0,0],marker?[6,77,true,1,11]:[2,0,true,0,0]]){
  const values=[1n,BigInt(events.length+1),BigInt(kind),BigInt(target),value?1n:0n,BigInt(readBlock),BigInt(readHash),digest];
  digest=hash([31337n,1n,2n,...values]);events.push({packedEvent:values.map(hex),eventSelector:selector,l2BlockNumber:1,l2BlockHash:hex(11),txHash:hex(100+events.length)});
 }
 const empty={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:1,blockHash:hex(11)},nextBlock:1,nextLog:0,records:[],head:null,complete:false};
 let current=structuredClone(empty);
 const pxe={sync:async()=>{state.syncs++;},processRollingPreferenceRecovery:async(p)=>{
  state.requests.push(structuredClone(p));if(state.pending)await state.pending;
  if(p.restart){state.restarts++;current={...structuredClone(empty),epoch:(current.epoch==='b'.repeat(64)?'c':'b').repeat(64),database:current.database};}
  if(p.expected&&p.expected.epoch===current.epoch&&p.expected.sequence===current.sequence-1)return structuredClone(current); // Original SDK durable mailbox replay.
  if(p.expected){state.steps++;assert.equal(p.expected.epoch,current.epoch);assert.equal(p.expected.sequence,current.sequence);current={...current,sequence:current.sequence+1};
   if(current.sequence<=2){current.records=[structuredClone(events[current.sequence-1])];current.nextLog=current.sequence;current.nextBlock=current.sequence===2?2:1;}
   else{current.nextLog=0;current.nextBlock=2;current.records=[];current.head={initialized:true,schema:1,revision:'2',digest:String(digest)};current.complete=true;}
   state.mutate?.(current);
   if(state.failReply){state.failReply=false;throw Error('private dropped response');}
  }else state.status++;
  return structuredClone(current);
 }};
 const sdk={Fr:Field,EventSelector:{fromSignature:async()=>({toString:()=>selector})},decodeFunctionSignature:()=> 'labelled ABI signature',
  isTrustedPrivateNode:x=>x===node&&state.valid,isPrivatePXEForNode:(p,n)=>p===pxe&&n===node&&state.valid,
  inspectTrustedNode:async(_node,options)=>{assert(state.valid);assert.equal(options.readinessTier,'checkpointed');},poseidon2HashWithSeparator:async fields=>{state.hashes++;return new Field(hash(fields));}};
 const compact={read:async p=>{state.transport.push({...p});return {schemaVersion:1,number:p.number,hash:p.hash,fields:Array(7).fill(hex(0)),headerFields:Array(23).fill(hex(0))};}};
 const config={sdk,pxe,node,owner,deployment,expectedArtifactHash:hex(5),tier:'checkpointed',compact,contextGuard:async()=>{assert(state.valid);},privateStore,walletSecret:hex(6),walletSalt:'7'};
 return {state,db,config,privateStore,events,current:()=>current,alter:f=>f(current),reader:()=>createRollingColdPreferenceReader(config)};
}
async function readAll(reader){let result;for(let i=0;i<8;i++){result=await reader.read();if(result.complete)return result;assert.equal(result.status,'recovering');assert.equal(result.preferences,undefined);}assert.fail('fixture did not finish');}
test('labelled SDK delivery: real AEAD/fold complete only after dense events and key-gated terminal head',async()=>{
 const f=fixture(),reader=f.reader();const first=await reader.read();assert.equal(first.complete,false);assert.equal(f.state.steps,0);
 const result=await readAll(reader);assert.deepEqual(result.preferences.bookmarks,['77']);assert.deepEqual(result.preferences.followedBoards,['0']);assert.equal(result.preferences.head.revision,'2');assert.equal(f.state.syncs,1);assert.equal(f.state.steps,3);
 assert(f.db.size===1);for(const encrypted of f.db.values())assert(!encrypted.includes('bookmarks')&&!encrypted.includes('packedEvent'));
 assert(f.state.transport.every(x=>Object.keys(x).sort().join(',')==='hash,number'));
});
test('stable encrypted cursor advances with one queued step and the original final mailbox fence',async()=>{
 const f=fixture(),r=f.reader();await r.read();const before=f.state.requests.length;
 const result=await r.read();assert.equal(result.progress.processedRevision,'1');assert.equal(f.state.steps,1);
 const calls=f.state.requests.slice(before);assert.equal(calls.length,2);assert.equal(calls[0].optimistic,true);assert.equal(calls[0].expected.sequence,0);assert.equal(calls[1].expected,null);
});
for(const mode of ['changed','missing'])test('orphaned cached anchor '+mode+' fails once then the next explicit read reaches the authoritative reset',async()=>{
 const f=fixture();let orphaned=false,reset=false;
 f.config.node.getBlockData=async number=>orphaned&&!reset&&mode==='missing'?null:({header:{globalVariables:{blockNumber:number},hash:async()=>new Field(orphaned?99:11)},blockHash:new Field(orphaned?99:11)});
 // The SDK can reset an orphaned generation only when the ordinary mailbox
 // operation is reached. No speculative input may itself relabel the prefix.
 const original=f.config.pxe.processRollingPreferenceRecovery;
 f.config.pxe.processRollingPreferenceRecovery=async p=>{
  if(orphaned&&p.expected===null&&f.current().anchor.blockHash===hex(11)){reset=true;Object.assign(f.current(),{epoch:'e'.repeat(64),sequence:0,anchor:{blockNumber:1,blockHash:hex(99)},nextBlock:1,nextLog:0,records:[],head:null,complete:false});}
  return original(p);
 };
 const r=f.reader();await r.read();const before=f.state.requests.length,encrypted=[...f.db];orphaned=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
 assert.equal(f.state.requests.length,before);assert.deepEqual([...f.db],encrypted);
 const resumed=await r.read();assert.equal(resumed.complete,false);assert.equal(resumed.progress.nextBlock,1);assert.equal(resumed.progress.processedRevision,'0');
 assert.equal(f.state.requests[before].expected,null);assert.equal(f.state.steps,0);assert.equal(f.current().epoch,'e'.repeat(64));
});
test('failed speculative transport stays failed; the next explicit read resumes the mailbox',async()=>{
 const f=fixture(),read=f.config.compact.read;let fail=false;
 f.config.compact.read=async p=>{if(fail){fail=false;throw Error('labelled transport failure');}return read(p);};
 const r=f.reader();await r.read();f.state.failCAS=true;await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
 const requests=f.state.requests.length,encrypted=[...f.db];fail=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
 assert.equal(f.state.requests.length,requests,'No alternate mailbox operation hides the failed transport');assert.deepEqual([...f.db],encrypted);assert.equal(f.state.steps,1);
 const resumed=await r.read();assert.equal(resumed.progress.processedRevision,'1');assert.equal(f.state.requests[requests].expected,null);assert.equal(f.state.steps,1,'The committed SDK delivery is replayed, not ingested twice');
});
for(const mode of ['reply','CAS'])test('labelled '+mode+' loss replays durable delivery without a second SDK page',async()=>{
 const f=fixture(),r=f.reader();await r.read();if(mode==='reply')f.state.failReply=true;else f.state.failCAS=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.steps,1);
 const repaired=await r.read();assert.equal(repaired.complete,false);assert.equal(f.state.steps,1);
 assert.equal((await readAll(r)).preferences.head.revision,'2');assert.equal(f.state.steps,3);
});
test('labelled same-store reader reconstruction consumes authenticated encrypted prefix',async()=>{
 const f=fixture(),r=f.reader();await r.read();await r.read();const restarts=f.state.restarts;
 const result=await readAll(f.reader());assert.equal(f.state.restarts,restarts);assert.deepEqual(result.preferences.bookmarks,['77']);
});
test('lost encrypted cache restarts scope instead of treating last delivery as complete history',async()=>{
 const f=fixture(),r=f.reader();await r.read();await r.read();f.db.clear();const restart=await f.reader().read();assert.equal(restart.progress.processedRevision,'0');assert.equal(restart.complete,false);assert.equal(f.state.restarts,2);
});
test('new SDK database cannot authenticate an old prefix',async()=>{
 const f=fixture(),r=f.reader();await r.read();await r.read();f.alter(x=>{x.database='d'.repeat(64);});const v=await r.read();assert.equal(v.progress.processedRevision,'0');assert.equal(v.complete,false);
});
for(const [name,mutate] of [
 ['missing revision',x=>{x.records[0].packedEvent[1]=hex(2);}],
 ['wrong previous digest',x=>{x.records[0].packedEvent[7]=hex(99);}],
 ['foreign selector',x=>{x.records[0].eventSelector='0x12345678';}],
 ['wrong canonical metadata',x=>{x.records[0].l2BlockHash=hex(999);}],
 ['duplicate event',x=>{x.records.push(structuredClone(x.records[0]));}],
])test('labelled authenticated-record mutation rejects '+name+' without partial publication',async()=>{
 const f=fixture(),r=f.reader();await r.read();f.state.mutate=mutate;await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.steps,1);
});
test('terminal full-head mismatch never publishes a digest-valid prefix as complete',async()=>{
 const f=fixture(),r=f.reader();await r.read();await r.read();await r.read();f.state.mutate=x=>{x.head.digest='99';};await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
});
test('post-CAS canonical change suppresses result; existing encrypted record is retained',async()=>{
 const f=fixture(),r=f.reader();f.state.afterCAS=()=>{f.state.canonical=false;};await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.db.size,1);
});
test('pending SDK operation keeps busy after abort until actual await settles',async()=>{
 const f=fixture(),r=f.reader();let release,entered;const reached=new Promise(resolve=>{entered=resolve;});f.state.pending=new Promise(resolve=>{release=resolve;});
 const original=f.config.pxe.processRollingPreferenceRecovery;f.config.pxe.processRollingPreferenceRecovery=async(...args)=>{entered();return original(...args);};const reader=f.reader();const abort=new AbortController(),pending=reader.read({signal:abort.signal});await reached;abort.abort();
 await assert.rejects(reader.read(),{code:'ROLLING_COLD_PREFERENCES_BUSY'});release();await assert.rejects(pending,{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.db.size,0);
});
for(const fault of ['canonical','mailbox'])test('post-CAS '+fault+' failure drains its held peer before releasing reader',async()=>{
 const f=fixture();let armed=false,release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 const block=f.config.node.getBlockData,process=f.config.pxe.processRollingPreferenceRecovery;
 f.config.node.getBlockData=async n=>{if(armed){if(fault==='canonical')throw Error('labelled canonical failure');entered();await held;}return block(n);};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(armed&&p.expected===null){if(fault==='mailbox')throw Error('labelled mailbox failure');entered();await held;}return process(p);};
 const r=f.reader();await r.read();f.state.afterCAS=()=>{armed=true;};let finished=false;const work=r.read().then(()=>({success:true}),error=>({error})).finally(()=>{finished=true;});
 try{await started;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_BUSY'});release();assert.equal((await work).error?.code,'ROLLING_COLD_PREFERENCES_UNAVAILABLE');assert.equal(f.state.steps,1);assert.equal(f.db.size,1);}finally{release();await work;}
});
test('account invalidation suppresses publication and performs no page after validation fails',async()=>{
 const f=fixture(),r=f.reader();await r.read();f.state.valid=false;await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.steps,0);
});
test('canonical read markers alone suppress notifications',async()=>{
 const f=fixture({marker:true});const result=await readAll(f.reader());assert.equal(result.preferences.readMarkers.length,1);assert.equal(result.orphanedReadMarkers.length,0);
});
test('foreign/extra mailbox fields do not become authority',async()=>{
 const f=fixture(),r=f.reader();await r.read();f.alter(x=>{x.owner='private sentinel';});await assert.rejects(r.read(),e=>e.code==='ROLLING_COLD_PREFERENCES_UNAVAILABLE'&&!e.message.includes('sentinel'));
});

// Labelled monotonic SDK transport; real reader AEAD/CAS/fold remain unchanged.
// Original SDK/ACIR promotion semantics are tested in test-pxe-preference-page.
function extensionFixture(options){
 const f=fixture(options),original=f.config.pxe.processRollingPreferenceRecovery;
 let advancing=false,promoted=false,prior,nextHead,event;
 f.state.promotions=0;f.state.failPromotionReply=false;
 f.extend=()=>{
  prior=structuredClone(f.current());assert(prior.complete);
  const values=[1n,3n,1n,88n,1n,0n,0n,BigInt(prior.head.digest)];
  const digest=hash([31337n,1n,2n,...values]);nextHead={initialized:true,schema:1,revision:'3',digest:String(digest)};
  event={packedEvent:values.map(hex),eventSelector:selector,l2BlockNumber:2,l2BlockHash:hex(12),txHash:hex(103)};
  advancing=true;
 };
 f.config.pxe.processRollingPreferenceRecovery=async p=>{
  if(p.restart){advancing=false;promoted=false;return original(p);}
  if(!advancing&&!promoted)return original(p);
  f.state.requests.push(structuredClone(p));const current=f.current();
  if(advancing){
   if(!p.expected||p.optimistic)return {...structuredClone(current),advance:{anchor:{blockNumber:2,blockHash:hex(12)},headPage:{blockNumber:1,blockHash:hex(11),txHash:hex(101),txIndex:0,firstLog:0,logCount:2}}};
   assert.deepEqual(p.expected,{epoch:prior.epoch,sequence:prior.sequence});assert.equal(p.block.blockNumber,1);f.state.promotions++;
   const previous={database:prior.database,epoch:prior.epoch,sequence:prior.sequence,anchor:prior.anchor,head:prior.head};
   Object.assign(current,{epoch:'e'.repeat(64),sequence:0,anchor:{blockNumber:2,blockHash:hex(12)},nextBlock:2,nextLog:0,records:[],head:null,complete:false,previous});advancing=false;promoted=true;
   f.state.mutatePromotion?.(current);
   if(f.state.failPromotionReply){f.state.failPromotionReply=false;throw Error('labelled lost promotion reply');}
  }else if(p.expected){
   assert.deepEqual(p.expected,{epoch:current.epoch,sequence:current.sequence});f.state.steps++;
   if(current.sequence===0){assert.equal(p.block.blockNumber,2);Object.assign(current,{sequence:1,nextBlock:3,records:[event]});}
   else{assert.equal(p.block,null);Object.assign(current,{sequence:2,records:[],head:nextHead,complete:true});}
  }
  return structuredClone(current);
 };
 return f;
}
// Labelled SDK continuation receipt; real encrypted prefix and mailbox folding.
function incompleteExtensionFixture(){
 const f=fixture(),original=f.config.pxe.processRollingPreferenceRecovery;let advancing=false,promoted=false,prior,baseSequence;
 f.state.promotions=0;
 f.extend=()=>{prior=structuredClone(f.current());assert(!prior.complete);baseSequence=prior.sequence;advancing=true;};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{
  if(p.restart){advancing=false;promoted=false;return original(p);}
  if(!advancing&&!promoted)return original(p);
  const current=f.current();
  if(advancing){
   if(!p.expected||p.optimistic)return {...structuredClone(current),advance:{anchor:{blockNumber:2,blockHash:hex(12)},headPage:null}};
   assert.deepEqual(p.expected,{epoch:prior.epoch,sequence:prior.sequence});assert.equal(p.block,null);f.state.promotions++;
   const resumed=Object.fromEntries(['database','epoch','sequence','anchor','nextBlock','nextLog'].map(k=>[k,structuredClone(prior[k])]));
   Object.assign(current,{epoch:'e'.repeat(64),sequence:0,anchor:{blockNumber:2,blockHash:hex(12)},records:[],resumed});advancing=false;promoted=true;f.state.mutatePromotion?.(current);
   if(f.state.failPromotionReply){f.state.failPromotionReply=false;throw Error('labelled lost incomplete promotion reply');}
   return structuredClone(current);
  }
  if(!p.expected)return structuredClone(current);
  // Translate fixture counters only; production SDK cursor tests run separately.
  const sequence=current.sequence;current.sequence+=baseSequence;
  const result=await original({...p,expected:{...p.expected,sequence:sequence+baseSequence}});
  f.alter(x=>{x.sequence-=baseSequence;if(x.complete)x.nextBlock=3;});result.sequence-=baseSequence;if(result.complete)result.nextBlock=3;return result;
 };
 return f;
}
test('incomplete canonical continuation preserves exact encrypted prefix and partial-log position',async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();await r.read();f.extend();const before=f.state.transport.length;
 const resumed=await f.reader().read();assert.equal(resumed.complete,false);assert.equal(resumed.progress.processedRevision,'1');assert.equal(resumed.progress.nextBlock,1);assert.equal(f.current().nextLog,1);assert.equal(f.state.promotions,1);assert.equal(f.state.transport.length,before);
 const done=await readAll(f.reader());assert.deepEqual(done.preferences.bookmarks,['77']);assert.deepEqual(done.preferences.followedBoards,['0']);assert.equal(f.state.steps,3);
});
for(const mode of ['reply','CAS'])test('incomplete promotion '+mode+' loss preserves authenticated predecessor',async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();await r.read();f.extend();if(mode==='reply')f.state.failPromotionReply=true;else f.state.failCAS=true;
 await assert.rejects(r.read());const resumed=await f.reader().read();assert.equal(resumed.progress.processedRevision,'1');assert.equal(f.state.promotions,1);assert.equal((await readAll(f.reader())).preferences.head.revision,'2');
});
test('chain advance drains an unacknowledged mailbox before promoting its prefix',async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();f.state.failReply=true;await assert.rejects(r.read());f.extend();
 const drained=await f.reader().read();assert.equal(drained.progress.processedRevision,'1');assert.equal(drained.progress.anchorBlock,1);assert.equal(f.state.promotions,0);assert.equal(f.state.steps,1);
 const resumed=await f.reader().read();assert.equal(resumed.progress.processedRevision,'1');assert.equal(resumed.progress.anchorBlock,2);assert.equal(f.state.promotions,1);assert.equal((await readAll(f.reader())).preferences.head.revision,'2');
});
for(const key of ['epoch','sequence','nextBlock','nextLog'])test('incomplete promotion mismatched predecessor fails closed: '+key,async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();await r.read();f.extend();f.state.mutatePromotion=x=>{if(key==='epoch')x.resumed.epoch='f'.repeat(64);else x.resumed[key]++;};await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
});
test('incomplete promotion without encrypted predecessor restarts full enumeration',async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();await r.read();f.extend();f.state.failPromotionReply=true;await assert.rejects(r.read());f.db.clear();const result=await f.reader().read();assert.equal(result.progress.processedRevision,'0');assert.equal(result.progress.nextBlock,1);
});
test('authenticated completed prefix extends with only former-head block and new suffix; choices preserved',async()=>{
 const f=extensionFixture(),r=f.reader();await readAll(r);const before=f.state.transport.length,restarts=f.state.restarts;
 f.extend();const promotion=await r.read();assert.equal(promotion.complete,false);assert.equal(promotion.progress.processedRevision,'2');assert.equal(promotion.progress.nextBlock,2);assert.equal(f.state.promotions,1);
 const result=await readAll(r);assert.deepEqual(result.preferences.bookmarks,['77','88']);assert.deepEqual(result.preferences.followedBoards,['0']);assert.equal(result.preferences.head.revision,'3');assert.equal(f.state.restarts,restarts);assert.deepEqual(f.state.transport.slice(before).map(x=>x.number),[1,2]);
});
for(const mode of ['reply','CAS'])test('lost promotion '+mode+' resumes exact encrypted predecessor without replaying original logs',async()=>{
 const f=extensionFixture(),r=f.reader();await readAll(r);f.extend();if(mode==='reply')f.state.failPromotionReply=true;else f.state.failCAS=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.promotions,1);
 const resumed=await f.reader().read();assert.equal(resumed.complete,false);assert.equal(resumed.progress.processedRevision,'2');assert.equal(f.state.promotions,1);
 const result=await readAll(f.reader());assert.deepEqual(result.preferences.bookmarks,['77','88']);assert.equal(f.state.promotions,1);
});
test('lost terminal mailbox drains without publishing completion at a known older anchor',async()=>{
 const f=extensionFixture(),r=f.reader();await r.read();await r.read();await r.read();f.state.failReply=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.current().complete,true);f.extend();
 const drained=await f.reader().read();assert.equal(drained.complete,false);assert.equal(drained.status,'recovering');assert.equal(drained.preferences,undefined);assert.equal(drained.progress.processedRevision,'2');assert.equal(f.state.promotions,0);
 const promoted=await f.reader().read();assert.equal(promoted.complete,false);assert.equal(f.state.promotions,1);
 const complete=await readAll(f.reader());assert.equal(complete.anchor.blockNumber,2);assert.equal(complete.preferences.head.revision,'3');assert.deepEqual(complete.preferences.bookmarks,['77','88']);
});
for(const terminal of [false,true])test('canonical advance during final CAS confirmation retains '+(terminal?'terminal':'incomplete')+' mailbox without stale publication',async()=>{
 const f=terminal?extensionFixture():incompleteExtensionFixture(),r=f.reader();await r.read();if(terminal){await r.read();await r.read();}
 f.state.afterCAS=()=>{f.state.afterCAS=null;f.extend();};
 const drained=await r.read();assert.equal(drained.complete,false);assert.equal(drained.status,'recovering');assert.equal(drained.preferences,undefined);assert.equal(drained.progress.processedRevision,terminal?'2':'1');assert.equal(f.state.promotions,0);const steps=f.state.steps;
 const resumed=await f.reader().read();assert.equal(resumed.complete,false);assert.equal(resumed.progress.anchorBlock,2);assert.equal(f.state.promotions,1);assert.equal(f.state.steps,steps,'Promotion does not replay the committed page');
 const done=await readAll(f.reader());assert.equal(done.anchor.blockNumber,2);assert.equal(done.preferences.head.revision,terminal?'3':'2');
});
test('new final-confirmation advance cannot hide a changed prior mailbox',async()=>{
 const f=incompleteExtensionFixture(),r=f.reader();await r.read();f.state.afterCAS=()=>{f.state.afterCAS=null;f.extend();f.alter(x=>{x.nextLog++;});};
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.promotions,0);assert.equal(f.db.size,1);
});
test('new final-confirmation advance requires its new canonical anchor',async()=>{
 const f=incompleteExtensionFixture(),get=f.config.node.getBlockData;f.config.node.getBlockData=async n=>{const value=await get(n);if(n===2){value.blockHash=new Field(999);value.header.hash=async()=>new Field(999);}return value;};
 const r=f.reader();await r.read();f.state.afterCAS=()=>{f.state.afterCAS=null;f.extend();};await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.promotions,0);assert.equal(f.db.size,1);
});
test('lost predecessor encrypted cache cannot resume promoted suffix',async()=>{
 const f=extensionFixture(),r=f.reader();await readAll(r);f.extend();f.state.failPromotionReply=true;await assert.rejects(r.read());f.db.clear();const before=f.state.restarts;
 const result=await f.reader().read();assert.equal(result.complete,false);assert.equal(result.progress.processedRevision,'0');assert.equal(result.progress.nextBlock,1);assert.equal(f.state.restarts,before+1);
});
for(const field of ['epoch','sequence','head','anchor'])test('promotion predecessor mismatch fails closed: '+field,async()=>{
 const f=extensionFixture(),r=f.reader();await readAll(r);f.extend();f.state.mutatePromotion=x=>{if(field==='epoch')x.previous.epoch='f'.repeat(64);if(field==='sequence')x.previous.sequence++;if(field==='head')x.previous.head.digest='999';if(field==='anchor')x.previous.anchor.blockHash=hex(999);};
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});
});
test('promotion post-CAS canonical change suppresses stale preferences and retains encrypted recovery state',async()=>{
 const f=extensionFixture(),r=f.reader();await readAll(r);f.extend();f.state.afterCAS=()=>{f.state.canonical=false;};await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.db.size,1);
});
test('new anchor resets marker classification and rechecks canonical marker before publishing',async()=>{
 const f=extensionFixture({marker:true}),r=f.reader();await readAll(r);f.extend();let reads=0;const get=f.config.node.getBlockData;f.config.node.getBlockData=async n=>{if(n===1)reads++;return get(n);};
 // New reader captures the instrumented canonical capability; no existing bound capability is replaced.
 const result=await readAll(f.reader());assert.equal(result.preferences.readMarkers.length,1);assert.equal(result.orphanedReadMarkers.length,0);assert(reads>=3);
});
test('bounded empty physical history batches preserve encrypted CAS and reduce 64 cursor commits to two',async()=>{
 const f=fixture();let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:64,blockHash:hex(74)},nextBlock:1,nextLog:0,records:[],head:null,complete:false},advances=0,batches=[];
 f.config.compact.readMany=async selectors=>{batches.push(selectors.length);return Promise.all(selectors.map(p=>f.config.compact.read(p)));};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{
  if(p.expected){assert.equal(p.expected.sequence,current.sequence);assert.equal(p.expected.epoch,current.epoch);advances++;
   if(p.block!==null){assert(Array.isArray(p.block));assert.equal(p.block.length,32);assert.equal(p.block[0].blockNumber,current.nextBlock);current={...current,sequence:current.sequence+1,nextBlock:current.nextBlock+p.block.length};}
   else current={...current,sequence:current.sequence+1,complete:true,head:{initialized:false,schema:1,revision:'0',digest:'0'}};
  }return structuredClone(current);
 };
 const reader=f.reader();await reader.read();const first=await reader.read();assert.equal(first.progress.nextBlock,33);assert.equal(first.preferences,undefined);const second=await reader.read();assert.equal(second.progress.nextBlock,65);assert.equal(second.preferences,undefined);const complete=await reader.read();assert.equal(complete.complete,true);assert.deepEqual(complete.preferences.bookmarks,[]);assert.equal(complete.progress.processedRevision,'0');assert.equal(advances,3);assert.deepEqual(batches,Array(16).fill(4));assert.equal(f.db.size,1);
});
for(const boundary of [1,2,7])test('history reader stops transport lookahead at nonempty block '+boundary+' and preserves SDK authority',async()=>{
 const f=fixture(),calls=[],canonical=[],originalCanonical=f.config.node.getBlockData;let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:64,blockHash:hex(74)},nextBlock:1,nextLog:0,records:[],head:null,complete:false},submitted;
 f.config.node.getBlockData=async n=>{canonical.push(n);return originalCanonical(n);};
 const originalRead=f.config.compact.read;
 f.config.compact.read=async p=>{calls.push(p.number);assert(p.number<=boundary,'unused future body must not be fetched');const wire=await originalRead(p);if(p.number===boundary)wire.fields=Array(19).fill(hex(0));return wire;};
 f.config.compact.readMany=async(selectors,options)=>{assert.equal(options.emptyPrefix,true);const wires=[];for(const p of selectors){const wire=await f.config.compact.read(p);wires.push(wire);if(wire.fields.length!==7)break;}return wires;};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.expected){submitted=p.block;const size=Array.isArray(p.block)?p.block.length:1;current={...current,sequence:current.sequence+1,nextBlock:current.nextBlock+size};}return structuredClone(current);};
 const reader=f.reader();await reader.read();const result=await reader.read();assert.deepEqual(calls,Array.from({length:boundary},(_,i)=>i+1));assert.equal(result.preferences,undefined);assert.equal(result.progress.nextBlock,1+Math.max(1,boundary-1));assert.equal(result.progress.processedRevision,'0');
 if(boundary===1){assert(!Array.isArray(submitted));assert.equal(submitted.fields.length,19);}else if(boundary===2){assert(!Array.isArray(submitted));assert.equal(submitted.fields.length,7);}else{assert(Array.isArray(submitted));assert.equal(submitted.length,boundary-1);assert(submitted.every(b=>b.fields.length===7));}
 assert(canonical.filter(n=>n!==64).every(n=>n<=Math.ceil(boundary/4)*4));assert.equal(f.db.size,1);
});
test('short empty transport prefix fails before any SDK advance or encrypted CAS',async()=>{
 const f=fixture(),process=f.config.pxe.processRollingPreferenceRecovery;f.config.pxe.processRollingPreferenceRecovery=async p=>{const value=await process(p);value.anchor={blockNumber:64,blockHash:hex(74)};return value;};
 f.config.compact.readMany=async selectors=>[await f.config.compact.read(selectors[0])];
 const reader=f.reader();await reader.read();const persisted=[...f.db.entries()];await assert.rejects(reader.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.steps,0);assert.deepEqual([...f.db.entries()],persisted);
});

test('transaction-only physical history batches without treating transport hint as authentication',async()=>{
 const f=fixture();let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:32,blockHash:hex(42)},nextBlock:1,nextLog:0,records:[],head:null,complete:false},submitted;
 const originalRead=f.config.compact.read;
 f.config.compact.read=async p=>({...await originalRead(p),fields:[hex((2624615704n<<184n)|4n),hex(1),hex(0),hex(2),hex((3951939007n<<112n)|1n),...Array(6).fill(hex(0))]});
 f.config.compact.readMany=async selectors=>Promise.all(selectors.map(p=>f.config.compact.read(p)));
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.expected){submitted=p.block;assert(Array.isArray(submitted)&&submitted.length===32);current={...current,sequence:1,nextBlock:33};}return structuredClone(current);};
 const reader=f.reader();await reader.read();const result=await reader.read();assert.equal(result.progress.nextBlock,33);assert.equal(result.complete,false);assert.equal(result.preferences,undefined);assert(submitted.every(b=>b.fields.length>7));
});

test('mixed transport prefix stops at first private-log block within the unchanged eight-log budget',async()=>{
 const f=fixture();let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:32,blockHash:hex(42)},nextBlock:1,nextLog:0,records:[],head:null,complete:false},submitted;const calls=[];
 const originalRead=f.config.compact.read;
 f.config.compact.read=async p=>{calls.push(p.number);return {...await originalRead(p),fields:[hex((2624615704n<<184n)|(1n<<104n)|(1n<<88n)|4n),hex(1),hex(0),hex(2),hex((3951939007n<<112n)|1n),...Array(6).fill(hex(0))]};};
 f.config.compact.readMany=async(selectors,options)=>{const out=[];for(const p of selectors){out.push(await f.config.compact.read(p));if(options.emptyPrefix||out.length===options.privateLogBudget)break;}return out;};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.expected){submitted=p.block;assert(!Array.isArray(submitted)&&submitted.blockNumber===1);current={...current,sequence:1,nextBlock:2};}return structuredClone(current);};
 const reader=f.reader();await reader.read();const result=await reader.read();assert.equal(result.progress.nextBlock,2);assert.equal(result.complete,false);assert.deepEqual(calls,[1]);
});

test('bounded read checkpoints useful progress with labelled remote metadata latency inside unchanged ten seconds',async t=>{
 const f=fixture(),inspect=f.config.sdk.inspectTrustedNode,get=f.config.node.getBlockData,process=f.config.pxe.processRollingPreferenceRecovery,fetch=f.config.compact.read;
 let clock=1000,metered=false,inspections=0; t.mock.method(Date,'now',()=>clock);
 f.config.sdk.inspectTrustedNode=async(...args)=>{if(metered){clock+=2400;inspections++;}return inspect(...args);};
 f.config.node.getBlockData=async(...args)=>{if(metered)clock+=180;return get(...args);};
 f.config.pxe.processRollingPreferenceRecovery=async(...args)=>{if(metered)clock+=200;return process(...args);};
 f.config.compact.read=async(...args)=>{if(metered)clock+=200;return fetch(...args);};
 const r=f.reader();await r.read();metered=true;const before=clock;
 const result=await r.read();assert.equal(result.progress.processedRevision,'1');assert.equal(result.complete,false);assert.equal(f.state.steps,1);
 assert(clock-before<10000,'Normal authenticated progress must fit the unchanged default deadline');assert.equal(inspections,2,'Full readiness is checked at entry and final publication; anchor checks remain separate');
 assert.equal((await readAll(r)).preferences.head.revision,'2');
});
test('entry readiness rejection performs no SDK page or encrypted write',async()=>{
 const f=fixture(),inspect=f.config.sdk.inspectTrustedNode;let reject=false;
 f.config.sdk.inspectTrustedNode=async(...args)=>{if(reject)throw Error('labelled readiness rejection');return inspect(...args);};
 const r=f.reader();await r.read();reject=true;const steps=f.state.steps,records=[...f.db];
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.state.steps,steps);assert.deepEqual([...f.db],records);
});
for(const terminal of [false,true])for(const code of ['BB_TRUSTED_NODE_IDENTITY','BB_BROWSER_PROVER_CONFIGURATION','BB_TRUSTED_NODE_STALE','BB_TRUSTED_NODE_UNSYNCED'])test('final '+code+' veto after durable '+(terminal?'complete':'recovering')+' mailbox publishes no result',async()=>{
 const f=fixture(),inspect=f.config.sdk.inspectTrustedNode;let checks=0,reject=false;
 f.config.sdk.inspectTrustedNode=async(...args)=>{checks++;if(reject&&checks===2){assert.equal(f.current().complete,terminal);assert.notDeepEqual([...f.db],records,'Final readiness follows the encrypted CAS');assert.equal(f.state.requests.at(-1).expected,null,'Final readiness follows the SDK mailbox check');throw Object.assign(Error('labelled late readiness rejection'),{code});}return inspect(...args);};
 const r=f.reader();await r.read();if(terminal){await r.read();await r.read();}const records=[...f.db],steps=f.state.steps;checks=0;reject=true;
 await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(checks,2);assert.equal(f.state.steps,steps+1);
 // Durable progress remains recoverable; failure does not fabricate success or
 // discard an SDK page already committed before the final readiness changed.
 checks=0;reject=false;assert.equal((await readAll(r)).preferences.head.revision,'2');
});

test('mixed transaction latency checkpoints a bounded prefix within the unchanged default deadline',async t=>{
 const f=fixture();let clock=1000,metered=false;
 t.mock.method(Date,'now',()=>clock);
 let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:32,blockHash:hex(42)},nextBlock:1,nextLog:0,records:[],head:null,complete:false};
 const get=f.config.node.getBlockData,inspect=f.config.sdk.inspectTrustedNode;let submitted;
 f.config.node.getBlockData=async(...args)=>{if(metered)clock+=130;return get(...args);};
 f.config.sdk.inspectTrustedNode=async(...args)=>{if(metered)clock+=400;return inspect(...args);};
 const read=f.config.compact.read;
 f.config.compact.read=async p=>{if(metered)clock+=150;return {...await read(p),fields:[hex((2624615704n<<184n)|(1n<<104n)|(1n<<88n)|4n),hex(1),hex(0),hex(2),hex((3951939007n<<112n)|1n),...Array(6).fill(hex(0))]};};
 f.config.compact.readMany=async(selectors,options)=>{const out=[];for(const p of selectors){out.push(await f.config.compact.read(p));if(options.emptyPrefix||out.length===options.privateLogBudget)break;}return out;};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{
  if(p.expected){submitted=Array.isArray(p.block)?p.block:[p.block];clock+=submitted.length*1200;current={...current,sequence:current.sequence+1,nextBlock:current.nextBlock+submitted.length};}
  return structuredClone(current);
 };
 const reader=f.reader();await reader.read();metered=true;const start=clock;
 const result=await reader.read();assert.equal(result.complete,false);assert.equal(result.preferences,undefined);
 assert.equal(result.progress.nextBlock,2,'A mixed block is authenticated and committed without greedily ingesting further transaction utilities');
 assert.equal(submitted.length,1);assert(clock-start<10000);assert.equal(f.db.size,1);
});

test('anchored page: pinned SDK archive authentication replaces per-height discovery, not final canonical fences',async()=>{
 const f=anchoredFixture(),r=f.reader();await r.read();const result=await r.read();assert.equal(result.progress.nextBlock,33);assert.deepEqual(f.pages,[{from:1,count:32,anchor:{number:64,hash:hex(74)}}]);assert(f.reads.length>0);assert(f.reads.every(n=>n===64),'Only pinned-anchor canonical reads; SDK remains authentication authority');
});

function anchoredFixture(){
 const f=fixture(),reads=[],pages=[];let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:64,blockHash:hex(74)},nextBlock:1,nextLog:0,records:[],head:null,complete:false};
 const get=f.config.node.getBlockData;f.config.node.getBlockData=async n=>{reads.push(n);return get(n);};
 f.config.compact.readPage=async p=>{pages.push(p);return Array.from({length:p.count},(_,i)=>({schemaVersion:1,number:p.from+i,hash:hex(p.from+i+10),headerFields:Array(23).fill(hex(0)),fields:Array(7).fill(hex(0))}));};
 f.config.compact.read=async()=>{throw Error('No scalar retry');};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.expected){const blocks=Array.isArray(p.block)?p.block:[p.block];assert.equal(blocks[0].blockNumber,current.nextBlock);current={...current,sequence:current.sequence+1,nextBlock:current.nextBlock+blocks.length};}return structuredClone(current);};
 return Object.assign(f,{reads,pages,delivery:()=>current});
}
test('anchored page: remote latency commits32 blocks within unchanged10s without per-block discovery',async t=>{
 const f=anchoredFixture();let clock=1000,metered=false;const get=f.config.node.getBlockData,page=f.config.compact.readPage,inspect=f.config.sdk.inspectTrustedNode,process=f.config.pxe.processRollingPreferenceRecovery;
 t.mock.method(Date,'now',()=>clock);
 f.config.node.getBlockData=async n=>{if(metered)clock+=130;return get(n);};
 f.config.compact.readPage=async p=>{if(metered)clock+=130;return page(p);};
 f.config.sdk.inspectTrustedNode=async(...args)=>{if(metered)clock+=400;return inspect(...args);};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(metered&&p.expected)clock+=8*130;return process(p);}; // Existing four-wide SDK witness waves; labelled latency, not live SDK timing.
 const r=f.reader();await r.read();metered=true;const start=clock;const result=await r.read();assert.equal(result.progress.nextBlock,33);assert(clock-start<10000);assert.equal(f.pages.length,1);assert(f.reads.every(n=>n===64));
});
for(const mode of ['fetch','sdk','final-canonical','final-readiness'])test('anchored page: '+mode+' failure publishes nothing and never falls back',async()=>{
 const f=anchoredFixture(),page=f.config.compact.readPage,process=f.config.pxe.processRollingPreferenceRecovery,inspect=f.config.sdk.inspectTrustedNode;let readyCalls=0,armed=false;
 f.config.compact.readPage=async p=>{const blocks=await page(p);if(mode==='fetch')throw Error('PRIVATE');return blocks;};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(mode==='sdk'&&p.expected)throw Error('SDK rejected untrusted archive/body');return process(p);};
 f.config.sdk.inspectTrustedNode=async(...args)=>{readyCalls++;if(armed&&mode==='final-readiness'&&readyCalls===2)throw Error('late readiness');return inspect(...args);};
 const r=f.reader();await r.read();readyCalls=0;armed=true;if(mode==='final-canonical')f.state.afterCAS=()=>{f.state.canonical=false;};const before=[...f.db];await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.equal(f.pages.length,1);
 if(mode==='fetch'||mode==='sdk')assert.deepEqual([...f.db],before);else assert.notDeepEqual([...f.db],before,'Authenticated durable cursor remains preserved after publication veto');
});
test('anchored page: truncated byte-bound prefix commits only returned contiguous blocks',async()=>{
 const f=anchoredFixture(),page=f.config.compact.readPage;f.config.compact.readPage=async p=>(await page(p)).slice(0,17);const r=f.reader();await r.read();const result=await r.read();assert.equal(result.progress.nextBlock,18);assert.equal(f.pages.length,1);
});
test('anchored page: pending page retains operation ownership until abort drains',async()=>{
 const f=anchoredFixture(),page=f.config.compact.readPage;let enter,release;const entered=new Promise(r=>{enter=r;}),held=new Promise(r=>{release=r;});f.config.compact.readPage=async p=>{enter();await held;return page(p);};
 const r=f.reader();await r.read();const before=[...f.db],c=new AbortController(),run=r.read({signal:c.signal});await entered;c.abort();await assert.rejects(r.read(),{code:'ROLLING_COLD_PREFERENCES_BUSY'});release();await assert.rejects(run,{code:'ROLLING_COLD_PREFERENCES_UNAVAILABLE'});assert.deepEqual([...f.db],before);
});

test('witnessed public prefix enlarges only after acknowledged SDK progress including log pages',async()=>{
 const f=fixture(),counts=[];let current={schemaVersion:1,database:'a'.repeat(64),epoch:'b'.repeat(64),sequence:0,anchor:{blockNumber:600,blockHash:hex(610)},nextBlock:1,nextLog:0,records:[],head:null,complete:false},reject=true,dense=false;
 f.config.compact.readWitnessPage=async p=>{counts.push(p.count);const size=dense?1:p.count;return Array.from({length:size},(_,i)=>({number:p.from+i,hash:hex(p.from+i+10),headerFields:Array(23).fill(hex(0)),fields:dense?[hex((2624615704n<<184n)|(1n<<104n)|(1n<<88n)|4n),hex(1),hex(0),hex(2),hex((3951939007n<<112n)|1n),...Array(6).fill(hex(0))]:Array(7).fill(hex(0)),archiveWitness:{leafIndex:String(p.from+i),siblingPath:Array(30).fill(hex(0))}}));};
 f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.expected){if(reject)throw Error('Labelled SDK authentication failure');const blocks=Array.isArray(p.block)?p.block:[p.block];for(const b of blocks){assert.equal(b.archiveWitness.anchorNumber,600);assert.equal(b.archiveWitness.anchorHash,hex(610));}current={...current,sequence:current.sequence+1,nextBlock:current.nextBlock+blocks.length};}return structuredClone(current);};
 const r=f.reader();await r.read();await assert.rejects(r.read());reject=false;
 await r.read();await r.read();dense=true;await r.read();dense=false;await r.read();assert.deepEqual(counts,[32,32,256,256,256]);
});

for(const invalid of [false,true])test('witnessed reader checks cumulative mixed logs before SDK admission '+invalid,async()=>{
 const f=anchoredFixture();let calls=0;
 f.config.compact.readWitnessPage=async p=>Array.from({length:p.count},(_,i)=>({number:p.from+i,hash:hex(p.from+i+10),headerFields:Array(23).fill(hex(0)),fields:[1,9,17,25].includes(i)?[hex((2624615704n<<184n)|(BigInt(invalid&&i===25?3:2)<<104n)|(BigInt(invalid&&i===25?3:2)<<88n)|4n),hex(1),hex(0),hex(2),hex((3951939007n<<112n)|1n),...Array(6).fill(hex(0))]:Array(7).fill(hex(0)),archiveWitness:{leafIndex:String(p.from+i),siblingPath:Array(30).fill(hex(0))}}));
 const process=f.config.pxe.processRollingPreferenceRecovery;f.config.pxe.processRollingPreferenceRecovery=async p=>{if(p.block)calls++;return process(p);};
 const r=f.reader();await r.read();
 if(invalid){await assert.rejects(r.read());assert.equal(calls,0);}else{assert.equal((await r.read()).progress.nextBlock,33);assert.equal(calls,1);}
});
