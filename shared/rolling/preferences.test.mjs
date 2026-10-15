import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {FIELD_MODULUS} from './invocation.mjs';
import {replayPreferenceEvents,PREFERENCE_DOMAIN,PREFERENCE_KINDS,createPreferenceFold,resumePreferenceFold,PREFERENCE_FOLD_BATCH_LIMIT} from './preferences.mjs';

after(async()=>{await BarretenbergSync.destroySingleton();});
// Synthetic history with actual pinned Poseidon. This is a pure replay check,
// not encrypted-log retrieval, canonical authentication or privacy acceptance.
const scope={chainId:'31337',version:'1',board:'99'};
const hash=async(fields,domain)=>(await poseidon2HashWithSeparator(fields,domain)).toBigInt();
const empty=()=>({scope:{...scope},head:{initialized:false,schema:1,revision:'0',digest:'0'},events:[],hash});
const change=(kind,target,value=true,read_block=0,read_hash='0')=>({kind,target,value,read_block,read_hash});
async function history(changes,network=scope){
 let previous=0n;const events=[];
 for(let i=0;i<changes.length;i++){
  const c=changes[i],event={schema:1,revision:String(i+1),...c,previous_digest:String(previous)};
  // Independent transcription of preferences.nr and PreferenceChanged fields.
  previous=(await poseidon2HashWithSeparator([BigInt(network.chainId),BigInt(network.version),BigInt(network.board),
   1n,BigInt(i+1),BigInt(c.kind),BigInt(c.target),c.value?1n:0n,BigInt(c.read_block),BigInt(c.read_hash),previous],0x52435031)).toBigInt();
  events.push(event);
 }
 return {scope:{...network},head:{initialized:events.length>0,schema:1,revision:String(events.length),digest:String(previous)},events,hash};
}
const rejected=promise=>assert.rejects(promise,e=>e.code==='ROLLING_PREFERENCES_INVALID'&&e.message==='Private preference history is invalid or unavailable.'&&!e.cause);

test('schema/domain and event order match actual checked-in Noir source',()=>{
 const pure=fs.readFileSync(new URL('../../billboard/rolling_contract/src/preferences.nr',import.meta.url),'utf8');
 const contract=fs.readFileSync(new URL('../../billboard/rolling_contract/src/main.nr',import.meta.url),'utf8');
 assert.match(pure,/PREFERENCE_DOMAIN: u32 = 0x52435031/);assert.equal(PREFERENCE_DOMAIN,0x52435031);
 assert.deepEqual(Object.values(PREFERENCE_KINDS),[1,2,3,4,5,6]);
 assert.match(pure,/chain, version, board.to_field\(\), event\[0\], event\[1\], event\[2\], event\[3\],\s*event\[4\], event\[5\], event\[6\], event\[7\]/);
 const fields=contract.match(/pub struct PreferenceChanged \{([^}]+)\}/)[1].match(/pub [a-z_]+:/g).map(s=>s.slice(4,-1));
 assert.deepEqual(fields,['schema','revision','kind','target','value','read_block','read_hash','previous_digest']);
});
test('absent head returns detached frozen empty preferences and explicit default',async()=>{
 const input=empty(),out=await replayPreferenceEvents(input);input.scope.board='100';input.head.digest='1';
 assert.deepEqual(out,{scope,head:{initialized:false,schema:1,revision:'0',digest:'0'},bookmarks:[],followedBoards:[],followedNames:[],subscriptions:[],replyNotifications:true,readMarkers:[]});
 assert(Object.isFrozen(out));assert(Object.isFrozen(out.scope));assert(Object.isFrozen(out.bookmarks));
});
test('actual hash replay derives all six kinds with toggle removals and stable numeric ordering',async()=>{
 const input=await history([change(1,'10'),change(1,'2'),change(1,'10',false),change(1,'3'),
  change(2,'0'),change(2,'13'),change(3,'21'),change(4,'22'),change(4,'22',false),
  change(5,'0',false),change(6,'42',true,100,'123'),change(6,'42',true,40,'124'),change(6,'2',true,0,'125')]);
 const out=await replayPreferenceEvents(input);
 assert.deepEqual(out.bookmarks,['2','3']);assert.deepEqual(out.followedBoards,['0','13']);
 assert.deepEqual(out.followedNames,['21']);assert.deepEqual(out.subscriptions,[]);assert.equal(out.replyNotifications,false);
 assert.deepEqual(out.readMarkers,[{thread:'2',throughBlock:0,blockHash:'125'},{thread:'42',throughBlock:40,blockHash:'124'}]);
 assert(Object.isFrozen(out.readMarkers[0]));assert.deepEqual(out.head,input.head);
});
test('complete replacement history on reorg removes orphaned preferences without mutating earlier result',async()=>{
 const before=await replayPreferenceEvents(await history([change(1,'2'),change(3,'8'),change(6,'42',true,4,'9')]));
 const after=await replayPreferenceEvents(await history([change(1,'2'),change(2,'0'),change(5,'0',false)]));
 assert.deepEqual(before.followedNames,['8']);assert.deepEqual(after.followedNames,[]);assert.deepEqual(after.readMarkers,[]);
 assert.notEqual(after.head.digest,before.head.digest);assert.deepEqual(after.followedBoards,['0']);
});
test('snapshot survives input mutation while first asynchronous hash awaits',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]);let release,entered;
 const gate=new Promise(r=>{release=r;});const active=new Promise(r=>{entered=r;});let calls=0;
 input.hash=async(fields,domain)=>{calls++;if(calls===1){entered();await gate;}assert(Object.isFrozen(fields));return hash(fields,domain);};
 const pending=replayPreferenceEvents(input);await active;
 input.scope.board='100';input.events[1].target='77';input.events.pop();input.head.digest='123';input.hash=()=>{throw Error('mutated');};release();
 const out=await pending;assert.equal(calls,2);assert.deepEqual(out.followedNames,['8']);assert.equal(out.scope.board,'99');
});
for(const key of ['chainId','version','board'])test(`actual hash rejects wrong ${key} scope`,async()=>{
 const input=await history([change(1,'2')]);input.scope[key]=String(BigInt(input.scope[key])+1n);await rejected(replayPreferenceEvents(input));
});
for(const [name,mutate] of [
 ['missing',x=>{x.events.pop();}],['reordered',x=>{x.events.reverse();}],['duplicate',x=>{x.events[1]={...x.events[0]};}],
 ['skipped revision',x=>{x.events[1].revision='3';}],['forged predecessor',x=>{x.events[1].previous_digest='1';}],
 ['forged value',x=>{x.events[1].value=false;}],['forged target',x=>{x.events[1].target='4';}],
 ['forged kind',x=>{x.events[1].kind=3;}],['wrong terminal digest',x=>{x.head.digest='1';}],
 ['shorter head',x=>{x.head.revision='1';}],['longer head',x=>{x.head.revision='3';}],
 ['absent head with events',x=>{x.head={initialized:false,schema:1,revision:'0',digest:'0'};}],
 ['unknown event field',x=>{x.events[0].owner='PRIVATE_SENTINEL';}],['unknown head field',x=>{x.head.secret='PRIVATE_SENTINEL';}],
 ['unknown scope field',x=>{x.scope.owner='PRIVATE_SENTINEL';}],['unknown options field',x=>{x.extra='PRIVATE_SENTINEL';}],
])test(`rejects ${name}`,async()=>{const input=await history([change(1,'2'),change(2,'0')]);mutate(input);await rejected(replayPreferenceEvents(input));});
for(const [name,patch] of [
 ['schema',{schema:2}],['zero revision',{revision:'0'}],['overflow revision',{revision:String(1n<<64n)}],
 ['negative revision',{revision:'-1'}],['noncanonical revision',{revision:'01'}],['numeric revision',{revision:1}],
 ['zero kind',{kind:0}],['unknown kind',{kind:7}],['fractional kind',{kind:1.1}],['string kind',{kind:'1'}],
 ['numeric bool',{value:1}],['null bool',{value:null}],['noncanonical target',{target:'02'}],['hex target',{target:'0x2'}],
 ['field overflow',{target:String(FIELD_MODULUS)}],['negative target',{target:'-1'}],['zero bookmark',{target:'0'}],
 ['zero name',{kind:3,target:'0'}],['zero subscription',{kind:4,target:'0'}],['global target',{kind:5,target:'2'}],
 ['toggle marker block',{read_block:1}],['toggle marker hash',{read_hash:'1'}],['negative zero block',{read_block:-0}],
 ['marker disabled',{kind:6,value:false,read_hash:'3'}],['marker zero hash',{kind:6}],['marker zero thread',{kind:6,target:'0',read_hash:'3'}],
 ['marker block overflow',{kind:6,read_block:0x100000000,read_hash:'3'}],['marker negative block',{kind:6,read_block:-1,read_hash:'3'}],
 ['marker fraction',{kind:6,read_block:.1,read_hash:'3'}],['marker string block',{kind:6,read_block:'1',read_hash:'3'}],
 ['previous digest overflow',{previous_digest:String(FIELD_MODULUS)}],
])test(`strict event shape rejects ${name} before hash`,async()=>{
 const input=await history([change(1,'2')]);Object.assign(input.events[0],patch);let calls=0;input.hash=()=>{calls++;throw Error('must not hash');};
 await rejected(replayPreferenceEvents(input));assert.equal(calls,0);
});
for(const patch of [{schema:0},{initialized:0},{initialized:true},{revision:'1'},{digest:'1'},{revision:'00'},{digest:'0x0'}])test(`strict absent head ${JSON.stringify(patch)}`,async()=>{
 const input=empty();Object.assign(input.head,patch);await rejected(replayPreferenceEvents(input));
});
test('unknown or sparse array entries and symbol fields fail without invoking accessors',async()=>{
 const cases=[x=>{delete x.events[0];},x=>{x.events.extra=1;},x=>{x.events[Symbol('hidden')]=1;},x=>{x.events[0][Symbol('owner')]='PRIVATE_SENTINEL';}];
 for(const mutate of cases){const input=await history([change(1,'2')]);mutate(input);await rejected(replayPreferenceEvents(input));}
 let read=0;const input=await history([change(1,'2')]);
 Object.defineProperty(input.events[0],'target',{enumerable:true,get(){read++;throw Error('PRIVATE_SENTINEL');}});
 await rejected(replayPreferenceEvents(input));assert.equal(read,0);
});
test('hash accessor, changing getters and proxy exceptions cannot leak causes or perform partial replay',async()=>{
 let reads=0;const input=empty();Object.defineProperty(input,'hash',{enumerable:true,get(){reads++;return ()=>{throw Error('PRIVATE_SENTINEL');};}});
 await rejected(replayPreferenceEvents(input));assert.equal(reads,0);
 await rejected(replayPreferenceEvents(new Proxy({}, {getPrototypeOf(){throw Error('PRIVATE_SENTINEL');}})));
});
for(const value of [0n,-1n,FIELD_MODULUS,'1',{},null])test(`invalid hash return ${typeof value}:${String(value)}`,async()=>{
 const input=await history([change(1,'2')]);input.hash=async()=>value;await rejected(replayPreferenceEvents(input));
});
test('hash failure is sanitized and never retried',async()=>{
 const input=await history([change(1,'2')]);let calls=0;input.hash=async()=>{calls++;throw Object.assign(Error('PRIVATE_SENTINEL'),{secret:'PRIVATE_SENTINEL'});};
 await rejected(replayPreferenceEvents(input));assert.equal(calls,1);
});
test('repeated same-value events remain ordered records, and removal of an absent target is valid',async()=>{
 const input=await history([change(1,'2'),change(1,'2'),change(1,'3',false),change(5,'0',false),change(5,'0',true)]);
 const out=await replayPreferenceEvents(input);assert.deepEqual(out.bookmarks,['2']);assert.equal(out.head.revision,'5');assert.equal(out.replyNotifications,true);
});
for(const [key,value] of [['chainId','0'],['version','0'],['board','0'],['chainId','031337'],['version',1],['board','0x63'],['chainId',String(FIELD_MODULUS)]])test(`strict scope rejects ${key}:${String(value)}`,async()=>{
 const input=empty();input.scope[key]=value;await rejected(replayPreferenceEvents(input));
});
test('invalid later record is detected before any hash dependency receives private data',async()=>{
 const input=await history([change(1,'2'),change(2,'0')]);input.events[1].read_hash='9';let calls=0;
 input.hash=()=>{calls++;throw Error('unexpected');};await rejected(replayPreferenceEvents(input));assert.equal(calls,0);
});
test('all four relationship kinds support explicit removal independently',async()=>{
 const input=await history([change(1,'8'),change(2,'8'),change(3,'8'),change(4,'8'),
  change(1,'8',false),change(2,'8',false),change(3,'8',false),change(4,'8',false)]);
 const out=await replayPreferenceEvents(input);
 for(const key of ['bookmarks','followedBoards','followedNames','subscriptions'])assert.deepEqual(out[key],[]);
});

// Streaming/prefix fixtures below use actual Poseidon. The AEAD fixture models
// only a trusted verifier boundary; it is NOT the future reader, canonical node
// validation, encrypted-store integration or genuine recovery acceptance.
const options = input => ({scope:input.scope,head:input.head,hash:input.hash});
const safeError = e=>e.code==='ROLLING_PREFERENCES_INVALID'&&e.message==='Private preference history is invalid or unavailable.'&&!e.cause;
const badSync = operation => assert.throws(operation,safeError);
const copy = input => structuredClone(input);
async function prefixOf(input,count) {
 const fold=createPreferenceFold(options(input)); await fold.append(input.events.slice(0,count)); return fold.checkpoint();
}
function authenticatedFixture(prefix) {
 const key=randomBytes(32),iv=randomBytes(12),aad=Buffer.from('SYNTHETIC account/class/domain/checkpoint fixture');
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(prefix)),cipher.final()]),tag=cipher.getAuthTag();
 let canonical=true,calls=0;
 return {orphan(){canonical=false;},calls:()=>calls,verify:async candidate=>{
  calls++;const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad);decipher.setAuthTag(tag);
  const decoded=JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8'));
  try{assert.deepEqual(candidate,decoded);return canonical;}catch{return false;}
 }};
}
async function resume(input,prefix,verifyAuthenticatedPrefix) {
 return resumePreferenceFold({...options(input),prefix,verifyAuthenticatedPrefix});
}
test('fold derives exactly full replay across one-event and mixed-size batches; snapshots are detached',async()=>{
 const input=await history([change(1,'10'),change(1,'2'),change(1,'10',false),change(2,'0'),change(3,'5'),
  change(4,'8'),change(5,'0',false),change(6,'8',true,5,'6'),change(6,'8',true,2,'7')]);
 const expected=await replayPreferenceEvents(input);
 for(const width of [1,2,4,9]){
  const fold=createPreferenceFold(options(input));
  for(let start=0;start<input.events.length;start+=width){
   const events=copy(input.events.slice(start,start+width));const ack=await fold.append(events);
   assert.deepEqual(Object.keys(ack),['revision','digest']);assert(Object.isFrozen(ack));
   events[0].target='999';
  }
  const checkpoint=fold.checkpoint();assert.equal(checkpoint.format,'ROLLING_PREFERENCE_PREFIX_V1');
  assert(Object.isFrozen(checkpoint));assert(Object.isFrozen(checkpoint.readMarkers[0]));
  assert.equal(checkpoint.head.revision,input.head.revision);
  assert.deepEqual(fold.finish(),expected);
  badSync(()=>fold.checkpoint()); await rejected(fold.append([]));badSync(()=>fold.finish());
 }
});
test('absent head, empty pages and zero prefix retain empty/default semantics',async()=>{
 const input=empty(),fold=createPreferenceFold(options(input));
 assert.deepEqual(await fold.append([]),{revision:'0',digest:'0'});
 const prefix=fold.checkpoint(),auth=authenticatedFixture(prefix);
 assert.deepEqual(fold.finish(),await replayPreferenceEvents(input));
 const restored=await resume(input,prefix,auth.verify);assert.deepEqual(restored.finish(),await replayPreferenceEvents(input));
});
test('batch cap is per append; history can exceed it without retaining event arrays',async()=>{
 assert.equal(PREFERENCE_FOLD_BATCH_LIMIT,512);
 const input=await history(Array.from({length:1025},()=>change(1,'2'))),fold=createPreferenceFold(options(input));
 for(let start=0;start<input.events.length;start+=512)await fold.append(input.events.slice(start,start+512));
 const prefix=fold.checkpoint();assert.deepEqual(prefix.bookmarks,['2']);assert(!('events' in prefix));
 assert.equal(prefix.head.revision,'1025');assert.deepEqual(fold.finish(),await replayPreferenceEvents(input));
});
test('authenticated prefix resume hashes ONLY new tail, preserving toggles and latest earlier read marker',async()=>{
 const input=await history([change(1,'2'),change(3,'8'),change(6,'8',true,12,'9'),change(1,'2',false),change(5,'0',false),change(6,'8',true,3,'10')]);
 const prefix=await prefixOf(input,3),auth=authenticatedFixture(prefix);let hashCalls=0;
 const fold=await resume({...input,hash:async(...args)=>{hashCalls++;return hash(...args);}},prefix,auth.verify);
 assert.equal(auth.calls(),1);assert.equal(hashCalls,0);
 await fold.append(input.events.slice(3));assert.equal(hashCalls,3);assert.deepEqual(fold.finish(),await replayPreferenceEvents(input));
});
test('a plaintext/digest-matching forged derived set is not resume authority',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]),prefix=await prefixOf(input,1),auth=authenticatedFixture(prefix);
 const forged=copy(prefix);forged.bookmarks=['99'];assert.equal(forged.head.digest,prefix.head.digest);
 await rejected(resume(input,forged,auth.verify));assert.equal(auth.calls(),1);
 for(const patch of [{}, {verifyAuthenticatedPrefix:true},{verifyAuthenticatedPrefix:async()=>undefined},{verifyAuthenticatedPrefix:async()=>({verified:true})}]){
  await rejected(resumePreferenceFold({...options(input),prefix,...patch}));
 }
 auth.orphan();await rejected(resume(input,prefix,auth.verify));
});
test('canonical replacement after reorg needs a fresh fold or externally verified ancestor, not retargeting',async()=>{
 const before=await history([change(1,'2'),change(3,'8')]),after=await history([change(1,'2'),change(2,'0')]);
 const orphan=await prefixOf(before,2);await rejected(resume(after,orphan,async()=>true));
 const ancestor=await prefixOf(before,1),auth=authenticatedFixture(ancestor),fold=await resume(after,ancestor,auth.verify);
 await fold.append(after.events.slice(1));assert.deepEqual(fold.finish(),await replayPreferenceEvents(after));
 const fresh=createPreferenceFold(options(after));await fresh.append(after.events);assert.deepEqual(fresh.finish(),await replayPreferenceEvents(after));
});
test('fold snapshots options and entire batch before the first asynchronous hash',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]);let release,entered;
 const gate=new Promise(r=>{release=r;}),active=new Promise(r=>{entered=r;});let calls=0;
 input.hash=async(...args)=>{if(++calls===1){entered();await gate;}return hash(...args);};
 const fold=createPreferenceFold(options(input)),pending=fold.append(input.events);await active;
 input.scope.board='100';input.head.digest='1';input.events[1].target='99';input.events.pop();input.hash=async()=>1n;
 release();await pending;assert.deepEqual(fold.finish().followedNames,['8']);assert.equal(calls,2);
});
test('resume captures prefix, target and verifier capability before awaiting external authentication',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]),prefix=copy(await prefixOf(input,1)),auth=authenticatedFixture(prefix);
 let release,entered;const gate=new Promise(r=>{release=r;}),active=new Promise(r=>{entered=r;});
 const request={...options(input),prefix,verifyAuthenticatedPrefix:async frozen=>{entered();await gate;assert(Object.isFrozen(frozen.bookmarks));return auth.verify(frozen);}};
 const pending=resumePreferenceFold(request);await active;
 prefix.bookmarks[0]='999';request.scope.board='999';request.head.digest='1';request.verifyAuthenticatedPrefix=async()=>{throw Error('PRIVATE_SENTINEL');};request.hash=async()=>1n;
 release();const fold=await pending;await fold.append(input.events.slice(1));
 assert.deepEqual(fold.finish().bookmarks,['2']);assert.equal(auth.calls(),1);
});
for(const overlap of ['append','checkpoint','finish'])test(`concurrent ${overlap} poisons in-flight append and never publishes partial state`,async()=>{
 const input=await history([change(1,'2')]);let release,entered;const gate=new Promise(r=>{release=r;}),active=new Promise(r=>{entered=r;});let calls=0;
 const fold=createPreferenceFold({...options(input),hash:async(...args)=>{calls++;entered();await gate;return hash(...args);}});
 const pending=fold.append(input.events),failure=rejected(pending);await active;
 if(overlap==='append')await rejected(fold.append([]));else badSync(()=>fold[overlap]());
 release();await failure;assert.equal(calls,1);badSync(()=>fold.checkpoint());await rejected(fold.append([]));
});
test('hash failure after earlier work poisons the instance with no partial checkpoint and no retry',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]);let calls=0;
 const fold=createPreferenceFold({...options(input),hash:async(...args)=>{if(++calls===2)throw Error('PRIVATE_SENTINEL');return hash(...args);}});
 await rejected(fold.append(input.events));assert.equal(calls,2);badSync(()=>fold.finish());badSync(()=>fold.checkpoint());
 await rejected(fold.append(input.events));assert.equal(calls,2);
});
for(const [label,mutate] of [
 ['overlarge batch',x=>{x.events=Array(513).fill(x.events[0]);}],['sparse',x=>{delete x.events[0];}],
 ['reordered',x=>{x.events.reverse();}],['duplicate',x=>{x.events[1]=x.events[0];}],['revision gap',x=>{x.events[1].revision='3';}],
 ['revision overflow',x=>{x.events[1].revision=String(1n<<64n);}],['previous digest',x=>{x.events[0].previous_digest='9';}],
 ['bad later field',x=>{x.events[1].kind=9;}],['additional array field',x=>{x.events.secret='PRIVATE_SENTINEL';}],
 ['absent head',x=>{x.head=empty().head;}],
])test(`fold rejects ${label}, remains poisoned, and does not advance to a publishable result`,async()=>{
 const input=await history([change(1,'2'),change(2,'0')]);mutate(input);let calls=0;
 const fold=createPreferenceFold({...options(input),hash:async(...args)=>{calls++;return hash(...args);}});
 await rejected(fold.append(input.events));assert.equal(calls,0);badSync(()=>fold.checkpoint());badSync(()=>fold.finish());
});
test('unknown event getters are rejected without evaluating them',async()=>{
 const input=await history([change(1,'2')]);let reads=0;
 Object.defineProperty(input.events[0],'target',{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 const fold=createPreferenceFold(options(input));await rejected(fold.append(input.events));assert.equal(reads,0);
});
test('missing tail, forged event value and wrong final head never publish a complete snapshot',async()=>{
 const input=await history([change(1,'2'),change(3,'8')]);
 const incomplete=createPreferenceFold(options(input));await incomplete.append(input.events.slice(0,1));badSync(()=>incomplete.finish());
 for(const mutate of [x=>{x.events[1].value=false;},x=>{x.head.digest='1';}]){
  const altered={...options(input),scope:copy(input.scope),head:copy(input.head),events:copy(input.events)};mutate(altered);
  const fold=createPreferenceFold(options(altered));await rejected(fold.append(altered.events));badSync(()=>fold.finish());
 }
});
for(const [label,mutate] of [
 ['format',p=>{p.format='other';}],['extra',p=>{p.owner='PRIVATE_SENTINEL';}],['scope',p=>{p.scope.board='100';}],
 ['scope extra',p=>{p.scope.owner='PRIVATE_SENTINEL';}],['head schema',p=>{p.head.schema=2;}],['overflow',p=>{p.head.revision=String(1n<<64n);}],
 ['beyond target',p=>{p.head.revision='99';}],['zero digest',p=>{p.head.digest='0';}],['noncanonical digest',p=>{p.head.digest='01';}],
 ['unsorted sets',p=>{p.bookmarks=['10','2'];}],['duplicate sets',p=>{p.bookmarks=['2','2'];}],['zero name',p=>{p.followedNames=['0'];}],
 ['hex id',p=>{p.bookmarks=['0x2'];}],['count beyond revision',p=>{p.bookmarks=['1','2','3','4','5','6','7','8','9','10'];}],
 ['string boolean',p=>{p.replyNotifications='true';}],['marker duplicate',p=>{p.readMarkers=[p.readMarkers[0],p.readMarkers[0]];}],
 ['marker zero',p=>{p.readMarkers[0].thread='0';}],['marker overflow',p=>{p.readMarkers[0].throughBlock=0x100000000;}],
 ['marker hash',p=>{p.readMarkers[0].blockHash='0';}],['marker extra',p=>{p.readMarkers[0].secret='PRIVATE_SENTINEL';}],
 ['sparse set',p=>{delete p.bookmarks[0];}],['array extra',p=>{p.bookmarks.extra='PRIVATE_SENTINEL';}],
])test(`strict portable prefix rejects ${label} BEFORE invoking authentication`,async()=>{
 const input=await history([change(1,'2'),change(6,'2',true,4,'9'),change(3,'8')]),prefix=copy(await prefixOf(input,2));mutate(prefix);let calls=0;
 await rejected(resume(input,prefix,async()=>{calls++;return true;}));assert.equal(calls,0);
});
test('zero prefix cannot smuggle relationships or notification choices',async()=>{
 const input=await history([change(1,'2')]),prefix=createPreferenceFold(options(input)).checkpoint();
 for(const mutate of [p=>{p.bookmarks=['2'];},p=>{p.followedBoards=['0'];},p=>{p.replyNotifications=false;}]){
  const altered=copy(prefix);mutate(altered);await rejected(resume(input,altered,async()=>true));
 }
});
test('prefix accessor and verifier accessor are never evaluated; arbitrary verifier failures sanitized',async()=>{
 const input=await history([change(1,'2')]),prefix=copy(await prefixOf(input,1));let reads=0;
 Object.defineProperty(prefix,'bookmarks',{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 await rejected(resume(input,prefix,async()=>true));assert.equal(reads,0);
 const request={...options(input),prefix:await prefixOf(input,1),verifyAuthenticatedPrefix:async()=>true};
 Object.defineProperty(request,'verifyAuthenticatedPrefix',{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});
 await rejected(resumePreferenceFold(request));assert.equal(reads,0);
 await rejected(resume(input,await prefixOf(input,1),async()=>{throw Error('PRIVATE_SENTINEL');}));
});
test('u64 maximum revision prefix can complete but cannot append an overflow event',async()=>{
 // Synthetic trusted-prefix boundary fixture: not a claim of replaying 2^64 events.
 const head={initialized:true,schema:1,revision:String((1n<<64n)-1n),digest:'8'};
 const prefix={...createPreferenceFold(options(empty())).checkpoint(),head};
 const auth=authenticatedFixture(prefix),fold=await resume({...empty(),head},prefix,auth.verify);
 assert.equal(fold.finish().head.revision,head.revision);
 const second=await resume({...empty(),head},prefix,auth.verify);
 await rejected(second.append([{schema:1,revision:String(1n<<64n),...change(1,'2'),previous_digest:'8'}]));badSync(()=>second.checkpoint());
});

test('more than one batch of distinct current preferences has no arbitrary total feature cap',async()=>{
 const input=await history(Array.from({length:513},(_,i)=>change(1,String(i+1)))),fold=createPreferenceFold(options(input));
 await fold.append(input.events.slice(0,512));await fold.append(input.events.slice(512));
 const prefix=fold.checkpoint(),auth=authenticatedFixture(prefix);
 assert.equal(prefix.bookmarks.length,513);
 const resumed=await resume(input,prefix,auth.verify);assert.deepEqual(resumed.finish(),fold.finish());
});
test('invalid append after a valid checkpoint cannot change the detached earlier snapshot',async()=>{
 const input=await history([change(1,'2'),change(1,'2',false)]),fold=createPreferenceFold(options(input));
 await fold.append(input.events.slice(0,1));const earlier=fold.checkpoint();
 const altered=copy(input.events.slice(1));altered[0].previous_digest='1';await rejected(fold.append(altered));
 assert.deepEqual(earlier.bookmarks,['2']);assert.equal(earlier.head.revision,'1');badSync(()=>fold.checkpoint());
});
