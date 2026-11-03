// Development-only injected ports. No service, chain proof or paid provider acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateBokMetering,bokReceiptClaims} from './private-bok-metering.mjs';
import {validateVeniceBilling,veniceMeteredProvider} from './venice-metered.mjs';
import {fileState} from './operations.mjs';
import {veniceDiagnosticError,getVeniceDiagnostic} from './venice-diagnostics.mjs';
const f=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const identity={network:'development:1',escrow:f(1),requestId:f(2),target:f(3)};
const input={messages:[{role:'user',content:'PRIVATE_SENTINEL'}],maxTokens:10};
const quote={modelId:'fixture-model',inputBound:100,maxTokens:10,inputPrice:1000000000n,outputPrice:1000000000n,cachePrice:null,maximum:110n};
const bill=(overrides={})=>validateVeniceBilling({providerId:'fixture-response-1',modelId:quote.modelId,promptTokens:4,completionTokens:2,cachedTokens:0,inputPrice:String(quote.inputPrice),outputPrice:String(quote.outputPrice),cachePrice:null,charge:'6',...overrides},quote);
function fixture({store:externalStore}={}){
 let value={operations:{}};
 const store=externalStore??{read:()=>value,write:async next=>{value=structuredClone(next);}};
 const r={state:2,sequence:0,invocation_hash:identity.target,budget:1000n,available:1000n,reserved:0n,charged:0n,refunded:0n,receipt:f(0)};
 const ops=new Map(),counts={execute:0,quote:0,reserve:0,settle:0,close_uncertain:0,reconcile:0,finish:0};
 const controls={};
 const apply={
  reserve:([id,seq,max])=>{assert.equal(id,identity.requestId);assert.equal(seq,r.sequence);assert.equal(r.reserved,0n);r.available-=max;r.reserved=max;},
  settle:([id,seq,actual,receipt])=>{assert.equal(id,identity.requestId);assert.equal(seq,r.sequence);assert.equal(r.state,2);r.available+=r.reserved-actual;r.reserved=0n;r.charged+=actual;r.sequence++;r.receipt=receipt;},
  close_uncertain:()=>{r.state=3;r.refunded+=r.available;r.available=0n;},
  reconcile:([id,seq,actual,receipt])=>{assert.equal(id,identity.requestId);assert.equal(seq,r.sequence);assert.equal(r.state,3);r.refunded+=r.reserved-actual;r.reserved=0n;r.charged+=actual;r.sequence++;r.receipt=receipt;r.state=4;},
  finish:()=>{r.state=4;r.refunded+=r.available;r.available=0n;},
 };
 const escrow={identity:{network:identity.network,escrow:identity.escrow},
  request:async()=>({canonical:controls.canonical!==false,request:{...r}}),
  assertUsable:async()=>{if(controls.unusable)throw Error('Reservation near deadline');return {canonical:controls.canonical!==false,request:{...r}};},
  inspectOperation:async id=>{
   const op=ops.get(id);if(controls.inspectUnknown&&op)return {status:'pending'};
   return op??{status:'absent'};
  },
 };
 for(const method of Object.keys(apply))escrow[method]=async(...args)=>{
  const envelope=args.pop();counts[method]++;
  if(controls.failBefore===method){ops.set(envelope.operationId,{status:'pending'});throw Error('PRIVATE_SENTINEL');}
  apply[method](args);ops.set(envelope.operationId,{status:'succeeded',canonical:true,method,argsDigest:envelope.argsDigest});
  if(controls.after)await controls.after(method);
  if(controls.failAfter===method)throw Error('PRIVATE_SENTINEL');
 };
 const provider={quote:async()=>{counts.quote++;if(controls.quoteError)throw Error('quote failed');return controls.quote??quote;},execute:async()=>{
  counts.execute++;if(controls.execute) return controls.execute();
  const billing=bill({providerId:'fixture-response-'+counts.execute});return {message:{role:'assistant',content:'UNTRUSTED_REPLY'},charge:BigInt(billing.charge),receipt:billing.receipt,billing};
 }};
 const create=(options={})=>privateBokMetering({identity,provider,escrow,store,...options});
 return {store,r,ops,counts,controls,escrow,provider,create};
}

test('normal per-call accounting, duplicate complete and finish; bounded private reply retained without prompt or raw error',async()=>{
 const h=fixture(),runner=h.create();const result=await runner.complete(0,input);
 assert.equal(result.replyAvailable,true);assert.equal(result.billing.charge,'6');assert.equal(h.r.available,994n);assert.equal(h.r.charged,6n);
 const repeated=await h.create().complete(0,input);assert.equal(repeated.replyAvailable,false);assert.equal(h.counts.execute,1);
 await h.create().finish();assert.equal(h.r.refunded,994n);assert.equal(h.r.state,4);
 await h.create().finish();assert.equal(h.counts.finish,1);
 assert.doesNotMatch(JSON.stringify(h.store.read()),/PRIVATE_SENTINEL|messages|human|account/);
});
test('original billing reconciliation resumes received and settled records without duplicate chain or provider calls',async()=>{
 const h=fixture();h.controls.execute=()=>{throw Error('lost response');};await assert.rejects(h.create().complete(0,input),/unknown/);
 h.controls.after=method=>{if(method==='reconcile')h.controls.inspectUnknown=true;};
 await assert.rejects(h.create().reconcile(0,bill()),/Chain operation unresolved/);assert.equal(h.store.read().privateBok.calls[0].phase,'received');
 assert.equal(h.counts.reconcile,1);assert.equal(h.counts.execute,1);
 h.controls.inspectUnknown=false;delete h.controls.after;
 const result=await h.create().reconcile(0,bill());assert.equal(result.replyAvailable,false);assert.equal(result.billing.charge,'6');
 assert.equal(h.store.read().privateBok.calls[0].phase,'settled');assert.equal(h.r.refunded,994n);
 assert.deepEqual(await h.create().reconcile(0,bill()),result);
 await assert.rejects(h.create().reconcile(0,bill({providerId:'another-response'})),/Original provider billing changed/);
 await h.create().finish();assert.deepEqual(h.counts,{execute:1,quote:1,reserve:1,settle:0,close_uncertain:1,reconcile:1,finish:0});
});
test('multiple explicit calls are bounded and previous input immutable',async()=>{
 const h=fixture(),runner=h.create({limits:{maxCalls:2}});
 await runner.complete(0,input);await runner.complete(1,input);
 assert.equal(h.r.charged,12n);assert.equal(h.counts.execute,2);
 await assert.rejects(runner.complete(2,input),/call limit/);
 await assert.rejects(runner.complete(0,{...input,maxTokens:9}),/input changed/);
 await assert.rejects(h.create().resume(0),/limits mismatch/);
});
test('quote failure precedes every reserve and paid call',async()=>{
 const h=fixture();h.controls.quoteError=true;await assert.rejects(h.create().complete(0,input));
 assert.equal(h.counts.reserve,0);assert.equal(h.counts.execute,0);
});
for(const [label,override] of [['negative price',{inputPrice:-1n}],['wrong maximum',{maximum:1n}],['over budget',{maximum:2000n}],['oversized model',{modelId:'X'.repeat(129)}],['too many tokens',{maxTokens:11}],['cache bound',{cachePrice:2000000000n}]])test('invalid quote: '+label,async()=>{
 const h=fixture();h.controls.quote={...quote,...override};await assert.rejects(h.create().complete(0,input));assert.equal(h.counts.reserve,0);assert.equal(h.counts.execute,0);
});
test('request identity, conservation and canonical status fail closed',async()=>{
 for(const mutate of [h=>h.r.invocation_hash=f(9),h=>h.r.available=999n,h=>h.controls.canonical=false]){
  const h=fixture();mutate(h);await assert.rejects(h.create().complete(0,input));assert.equal(h.counts.execute,0);
 }
 assert.throws(()=>{const h=fixture();delete h.escrow.inspectOperation;h.create();},/Canonical chain port/);
});
test('input/token/storage bounds before any call',async()=>{
 const h=fixture();await assert.rejects(h.create().complete(0,{...input,maxTokens:1501}),/output limit/);
 await assert.rejects(h.create().complete(0,{...input,messages:['x'.repeat(65537)]}),/input limit/);
 assert.equal(h.counts.quote,0);
});
test('unknown reserve send never resubmits or invokes provider',async()=>{
 const h=fixture();h.controls.failBefore='reserve';await assert.rejects(h.create().complete(0,input),/operation unresolved/);
 h.controls.failBefore=null;await assert.rejects(h.create().complete(0,input),/operation unresolved/);
 assert.equal(h.counts.reserve,1);assert.equal(h.counts.execute,0);
});
test('crash after durable reserve intent before submission never infers absent means retry',async()=>{
 const h=fixture(),write=h.store.write;let failed=false;
 h.store.write=async next=>{await write(next);if(!failed&&Object.values(next.privateBok.operations).some(x=>x.method==='reserve')){failed=true;throw Error('crash');}};
 await assert.rejects(h.create().complete(0,input));assert.equal(h.counts.reserve,0);
 await assert.rejects(h.create().complete(0,input),/operation unresolved/);assert.equal(h.counts.reserve,0);assert.equal(h.counts.execute,0);
});
test('broadcast exception with canonical reserve receipt proceeds exactly once',async()=>{
 const h=fixture();h.controls.failAfter='reserve';await h.create().complete(0,input);assert.equal(h.counts.reserve,1);assert.equal(h.counts.execute,1);
});
test('confirmed reservation recovered before provider call; deadline rechecked',async()=>{
 const h=fixture();h.controls.unusable=true;await assert.rejects(h.create().complete(0,input),/deadline/);
 assert.equal(h.counts.execute,0);assert.equal((await h.create().resume(0)).readyForComplete,true);
 h.controls.unusable=false;await h.create().complete(0,input);assert.equal(h.counts.reserve,1);assert.equal(h.counts.execute,1);
});
test('crash after possibly-sent fence, before model: conservative no replay',async()=>{
 const h=fixture(),write=h.store.write;let failed=false;
 h.store.write=async next=>{await write(next);if(!failed&&next.privateBok.calls[0]?.phase==='possibly-sent'){failed=true;throw Error('crash');}};
 await assert.rejects(h.create().complete(0,input));assert.equal(h.counts.execute,0);
 await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.r.state,3);assert.equal(h.r.reserved,110n);assert.equal(h.counts.execute,0);
});
test('provider timeout fences funds; restart never repeats; original receipt reconciles',async()=>{
 const h=fixture();h.controls.execute=async()=>{throw Error('PRIVATE_SENTINEL');};
 await assert.rejects(h.create().complete(0,input),/outcome unknown/);
 assert.equal(h.r.state,3);assert.equal(h.r.refunded,890n);assert.equal(h.r.reserved,110n);
 await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.counts.execute,1);
 await h.create().reconcile(0,bill());assert.equal(h.r.state,4);assert.equal(h.r.refunded,994n);assert.equal(h.r.charged,6n);assert.equal(h.counts.execute,1);
});
test('receipt persistence failure conservatively fences and never replays',async()=>{
 const h=fixture(),write=h.store.write;h.store.write=async next=>{if(next.privateBok.calls[0]?.phase==='received')throw Error('disk full');await write(next);};
 await assert.rejects(h.create().complete(0,input),/outcome unknown/);assert.equal(h.r.state,3);
 await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.counts.execute,1);
});
test('durable response survives restart before settlement without model call',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bok-accounting-'));try{
  const path=join(dir,'journal.json'),store=await fileState(path),h=fixture({store});
  const read=h.escrow.request;let crash=true;
  h.escrow.request=async()=>{if(crash&&store.read().privateBok?.calls[0]?.phase==='received')throw Error('process exit');return read();};
  await assert.rejects(h.create().complete(0,input));assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,0);
  crash=false;const restarted=h.create({store:await fileState(path)});const result=await restarted.resume(0);
  assert.equal(result.replyAvailable,true);assert.equal(result.message.content,'UNTRUSTED_REPLY');assert.equal(h.counts.execute,1);assert.equal(h.r.charged,6n);assert.equal((await restarted.resume(0)).replyAvailable,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('settlement send unknown does not repeat; later canonical receipt repairs journal',async()=>{
 const h=fixture();h.controls.after=method=>{if(method==='settle')h.controls.inspectUnknown=true;};
 await assert.rejects(h.create().complete(0,input),/operation unresolved/);assert.equal(h.r.charged,6n);
 await assert.rejects(h.create().resume(0),/operation unresolved/);assert.equal(h.counts.settle,1);assert.equal(h.counts.execute,1);
 h.controls.inspectUnknown=false;await h.create().resume(0);assert.equal(h.counts.settle,1);
});
test('unmined settlement stays blocked without repeating model or mutator',async()=>{
 const h=fixture();h.controls.failBefore='settle';await assert.rejects(h.create().complete(0,input),/operation unresolved/);
 await assert.rejects(h.create().resume(0),/operation unresolved/);assert.equal(h.counts.settle,1);assert.equal(h.counts.execute,1);
});
test('external expiry with retained response uses reconcile rather than new provider call',async()=>{
 const h=fixture();const read=h.escrow.request;let once=true;
 h.escrow.request=async()=>{if(once&&h.store.read().privateBok?.calls[0]?.phase==='received'){once=false;h.r.state=3;h.r.refunded=h.r.available;h.r.available=0n;}return read();};
 await h.create().complete(0,input);assert.equal(h.counts.reconcile,1);assert.equal(h.counts.settle,0);assert.equal(h.r.state,4);
});
for(const [label,mutate] of [['receipt',b=>({...b,receipt:f(9)})],['charge',b=>({...b,charge:'7'})],['prices',b=>({...b,inputPrice:'2'})],['tokens',b=>({...b,completionTokens:11})]])test('inconsistent provider '+label+' fences rather than charges',async()=>{
 const h=fixture();h.controls.execute=async()=>{const billing=mutate(bill());return {billing,charge:BigInt(billing.charge),receipt:billing.receipt};};
 await assert.rejects(h.create().complete(0,input),/outcome unknown/);assert.equal(h.r.charged,0n);assert.equal(h.r.reserved,110n);
});
test('chain success must bind method, arguments and canonical receipt',async()=>{
 for(const bad of [{method:'settle'},{argsDigest:'wrong'},{canonical:false}]){
  const h=fixture();h.controls.after=()=>{for(const [id,op]of h.ops)h.ops.set(id,{...op,...bad});};
  await assert.rejects(h.create().complete(0,input),/operation unresolved/);assert.equal(h.counts.execute,0);
 }
});
test('settlement canonical state receipt mismatch rejected',async()=>{
 const h=fixture();h.controls.after=method=>{if(method==='settle')h.r.receipt=f(9);};
 await assert.rejects(h.create().complete(0,input),/accounting mismatch/);assert.equal(h.store.read().privateBok.calls[0].phase,'received');
 await assert.rejects(h.create().resume(0),/state mismatch/);assert.equal(h.counts.settle,1);
});
test('finish waits for unresolved model outcome and is conserved',async()=>{
 const h=fixture();h.controls.execute=async()=>{throw Error('unknown');};await assert.rejects(h.create().complete(0,input));
 await assert.rejects(h.create().finish(),/Unresolved provider/);assert.equal(h.counts.finish,0);
});
test('unknown billing metadata/getters never reaches journal; allowed getters read once',()=>{
 let reads=0;const b=bill();const value={...b,get providerId(){reads++;return reads===1?b.providerId:'PRIVATE_SENTINEL';},get secret(){throw Error('PRIVATE_SENTINEL');}};
 const result=validateVeniceBilling(value,quote);assert.equal(reads,1);assert.deepEqual(result,b);assert.doesNotMatch(JSON.stringify(result),/SENTINEL/);
});
test('Venice adapter exposes bounded billing while retaining legacy return fields',async()=>{
 const client={json:async(path,options)=>{assert.equal(path,'/api/v1/chat/completions');assert.equal(options.body.max_completion_tokens,10);return {id:'real-shape-fixture',choices:[{message:{role:'assistant',content:'hello'}}],usage:{prompt_tokens:4,completion_tokens:2,untrusted:'PRIVATE_SENTINEL'},raw:'PRIVATE_SENTINEL'};}};
 const result=await veniceMeteredProvider({client}).execute(input,quote);
 assert.equal(result.message.content,'hello');assert.equal(result.charge,6n);assert.equal(result.receipt,result.billing.receipt);assert.doesNotMatch(JSON.stringify(result.billing),/SENTINEL/);
});
test('write acknowledgement lost after durable response preserves automatic settlement recovery',async()=>{
 const h=fixture(),write=h.store.write;let fail=true;
 h.store.write=async next=>{await write(next);if(fail&&next.privateBok.calls[0]?.phase==='received'){fail=false;throw Error('lost acknowledgement');}};
 await assert.rejects(h.create().complete(0,input),/Response retained/);
 await h.create().resume(0);assert.equal(h.counts.execute,1);assert.equal(h.r.charged,6n);assert.equal(h.counts.close_uncertain,0);
});
test('unknown settlement followed by expiry waits for original receipt before reconcile',async()=>{
 const h=fixture();h.controls.failBefore='settle';await assert.rejects(h.create().complete(0,input));
 h.r.state=3;h.r.refunded=h.r.available;h.r.available=0n;
 await assert.rejects(h.create().resume(0),/Original settlement unresolved/);assert.equal(h.counts.reconcile,0);
 for(const [id,op]of h.ops){if(op.status==='pending'){
  const saved=h.store.read().privateBok.operations[id];h.ops.set(id,{...saved,canonical:true,status:'failed'});
 }}
 await h.create().resume(0);assert.equal(h.counts.reconcile,1);assert.equal(h.counts.execute,1);
});
test('provider response ID reuse across explicit calls never charges twice',async()=>{
 const h=fixture();h.controls.execute=async()=>{const billing=bill();return {billing,charge:6n,receipt:billing.receipt};};
 await h.create().complete(0,input);await assert.rejects(h.create().complete(1,input),/outcome unknown/);
 assert.equal(h.r.charged,6n);assert.equal(h.counts.settle,1);assert.equal(h.r.state,3);
});
test('same instance rejects concurrent writer before second paid call',async()=>{
 const h=fixture();let release,entered;const started=new Promise(r=>entered=r);
 h.controls.execute=async()=>{entered();await new Promise(r=>release=r);const billing=bill();return {billing,charge:6n,receipt:billing.receipt};};
 const runner=h.create(),first=runner.complete(0,input);await started;
 await assert.rejects(runner.complete(0,input),/already running/);release();await first;assert.equal(h.counts.execute,1);
});
test('unknown fencing and finish receipts do not become success or replay after state changes',async()=>{
 for(const method of ['close_uncertain','finish']){
  const h=fixture();if(method==='close_uncertain')h.controls.execute=async()=>{throw Error('unknown');};
  else await h.create().complete(0,input);
  h.controls.after=called=>{if(called===method)h.controls.inspectUnknown=true;};
  const run=()=>method==='close_uncertain'?h.create().complete(0,input):h.create().finish();
  await assert.rejects(run(),/operation unresolved/);await assert.rejects(run(),/operation unresolved/);
  assert.equal(h.counts[method],1);
  h.controls.inspectUnknown=false;
  if(method==='close_uncertain')await assert.rejects(run(),/outcome unknown/);else await run();
  assert.equal(h.counts[method],1);
 }
});

// Real filesystem writes with narrow syscall-boundary injection; no durability stubs.
function observePersistence(t,onEvent){
 const open=fs.open.bind(fs),rename=fs.rename.bind(fs);
 let fence=false;
 t.mock.method(fs,'open',async(path,flags,mode)=>{
  const handle=await open(path,flags,mode),kind=flags==='wx'?'file':'directory';
  return {
   async writeFile(data){fence=JSON.parse(data).privateBok?.calls[0]?.phase==='possibly-sent';await onEvent('write:before',fence);await handle.writeFile(data);await onEvent('write:after',fence);},
   async sync(){await onEvent(kind+'-sync:before',fence);await handle.sync();await onEvent(kind+'-sync:after',fence);},
   close:()=>handle.close(),
  };
 });
 t.mock.method(fs,'rename',async(...args)=>{await onEvent('rename:before',fence);await rename(...args);await onEvent('rename:after',fence);});
}
test('fileState acknowledges only after file sync, rename, directory sync; ordinary reopen recovers',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-durable-'));try{
  const path=join(directory,'state.json'),store=await fileState(path),events=[];
  observePersistence(t,async event=>events.push(event));
  await store.write({operations:{saved:1}});events.push('acknowledged');
  assert.deepEqual(events,['write:before','write:after','file-sync:before','file-sync:after','rename:before','rename:after','directory-sync:before','directory-sync:after','acknowledged']);
  assert.deepEqual((await fileState(path)).read(),{operations:{saved:1}});
  assert.equal((await fs.stat(path)).mode&0o777,0o600);
 }finally{t.mock.restoreAll();await rm(directory,{recursive:true,force:true});}
});
test('new journal directory entries also sync through their existing parent',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-new-directory-'));try{
  const path=join(directory,'new','nested','state.json'),store=await fileState(path),events=[];
  observePersistence(t,async event=>events.push(event));await store.write({operations:{}});
  assert.equal(events.filter(x=>x==='directory-sync:after').length,3);
  assert.deepEqual((await fileState(path)).read(),{operations:{}});
 }finally{t.mock.restoreAll();await rm(directory,{recursive:true,force:true});}
});
for(const boundary of ['write:before','write:after','file-sync:before','file-sync:after','rename:before','rename:after','directory-sync:before','directory-sync:after'])test('uncertain persistence at '+boundary+' preserves memory and blocks another write',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-write-fault-'));try{
  const path=join(directory,'state.json'),store=await fileState(path);await store.write({operations:{old:1}});
  observePersistence(t,async event=>{if(event===boundary)throw Error('injected private filesystem detail');});
  await assert.rejects(store.write({operations:{new:2}}),{code:'STATE_PERSISTENCE_UNCERTAIN'});
  assert.deepEqual(store.read(),{operations:{old:1}});
  await assert.rejects(store.write({operations:{third:3}}),{code:'STATE_PERSISTENCE_UNCERTAIN'});
  t.mock.restoreAll();const recovered=(await fileState(path)).read();
  assert.deepEqual(recovered,boundary.startsWith('directory')||boundary==='rename:after'?{operations:{new:2}}:{operations:{old:1}});
 }finally{t.mock.restoreAll();await rm(directory,{recursive:true,force:true});}
});
for(const boundary of ['file-sync:before','file-sync:after','rename:before','rename:after','directory-sync:before','directory-sync:after'])test('paid call forbidden when send-fence persistence fails at '+boundary,async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-fence-fault-'));try{
  const store=await fileState(join(directory,'state.json')),h=fixture({store});
  observePersistence(t,async(event,fence)=>{if(fence&&event===boundary)throw Error('injected failure');});
  await assert.rejects(h.create().complete(0,input),{code:'STATE_PERSISTENCE_UNCERTAIN'});
  assert.equal(h.counts.execute,0);assert.equal(store.read().privateBok.calls[0].phase,'reserved');
  await assert.rejects(h.create().complete(0,input),{code:'STATE_PERSISTENCE_UNCERTAIN'});assert.equal(h.counts.execute,0);
 }finally{t.mock.restoreAll();await rm(directory,{recursive:true,force:true});}
});
test('provider waits for durable fence acknowledgement, then rechecks canonical usability',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-sync-delay-'));let release;try{
  const store=await fileState(join(directory,'state.json')),h=fixture({store});let entered;
  const blocked=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve),events=[];
  observePersistence(t,async(event,fence)=>{if(fence){events.push(event);if(event==='directory-sync:before'){entered();await hold;}}});
  h.controls.execute=async()=>{events.push('provider');const billing=bill();return {billing,charge:6n,receipt:billing.receipt};};
  const completion=h.create().complete(0,input);await blocked;assert.equal(h.counts.execute,0);
  release();await completion;
  assert.ok(events.indexOf('provider')>events.indexOf('directory-sync:after'));
 }finally{release?.();t.mock.restoreAll();await rm(directory,{recursive:true,force:true});}
});
test('disk delay or suspension crossing reservation start margin forbids paid call',async()=>{
 const h=fixture(),write=h.store.write;
 h.store.write=async next=>{await write(next);if(next.privateBok.calls[0]?.phase==='possibly-sent')h.controls.unusable=true;};
 await assert.rejects(h.create().complete(0,input),/deadline/);assert.equal(h.counts.execute,0);
 assert.equal(h.store.read().privateBok.calls[0].phase,'possibly-sent');
 h.controls.unusable=false;await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.counts.execute,0);
});
test('canonical reservation changed during durable fence write forbids paid call',async()=>{
 const h=fixture(),write=h.store.write;
 h.store.write=async next=>{await write(next);if(next.privateBok.calls[0]?.phase==='possibly-sent'){h.r.refunded=h.r.available;h.r.available=0n;h.r.state=3;}};
 await assert.rejects(h.create().complete(0,input),/changed after fence/);assert.equal(h.counts.execute,0);
});


test('closed provider diagnostic survives durable restart while original call remains fenced',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'bok-provider-diagnostic-'));try{
  const path=join(directory,'state.json'),store=await fileState(path),h=fixture({store});
  const error=veniceDiagnosticError('http-rejection',{httpStatus:400,body:{error:{code:'INVALID_REQUEST',param:'max_completion_tokens',message:'PRIVATE_RESPONSE_SENTINEL'},headers:{authorization:'PRIVATE_KEY_SENTINEL'}}});
  h.controls.execute=async()=>{throw error;};await assert.rejects(h.create().complete(0,input),/Provider outcome unknown/);
  const reopened=await fileState(path),call=reopened.read().privateBok.calls[0];assert.equal(call.phase,'fenced');assert.deepEqual(call.providerDiagnostic,getVeniceDiagnostic(error));assert.equal(call.billing,undefined);
  assert.doesNotMatch(await fs.readFile(path,'utf8'),/PRIVATE_|headers|authorization|stack|message/);
  await assert.rejects(h.create({store:reopened}).resume(0),/outcome unknown/);await assert.rejects(h.create({store:reopened}).complete(0,input),/outcome unknown/);
  assert.equal(h.counts.execute,1);assert.equal(h.counts.close_uncertain,1);assert.equal(h.counts.settle,0);assert.equal(h.r.charged,0n);assert.equal(h.r.reserved,110n);assert.equal(h.r.refunded,890n);
  await h.create({store:reopened}).reconcile(0,bill());assert.equal(h.r.charged,6n);assert.equal(h.counts.execute,1);assert.deepEqual(reopened.read().privateBok.calls[0].providerDiagnostic,getVeniceDiagnostic(error));
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('forged and accessor provider diagnostics are never read or journaled',async()=>{
 let reads=0;const fake={get providerDiagnostic(){reads++;throw Error('PRIVATE_SENTINEL');},get message(){reads++;throw Error('PRIVATE_SENTINEL');},category:'http-rejection',httpStatus:400};
 for(const error of [fake,new Error('PRIVATE_SENTINEL'),null,undefined,'PRIVATE_SENTINEL']){const h=fixture();h.controls.execute=async()=>{throw error;};await assert.rejects(h.create().complete(0,input),/outcome unknown/);assert.equal(h.store.read().privateBok.calls[0].providerDiagnostic,undefined);assert.equal(h.store.read().privateBok.calls[0].phase,'fenced');await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.counts.execute,1);assert.doesNotMatch(JSON.stringify(h.store.read()),/PRIVATE_SENTINEL/);}
 assert.equal(reads,0);
});

test('diagnostic write failure still fences the original call and never repeats provider execution',async()=>{
 const h=fixture(),write=h.store.write,failure=Error('synthetic diagnostic persistence failure');let failed=false;
 h.store.write=async next=>{if(!failed&&next.privateBok?.calls[0]?.providerDiagnostic){failed=true;throw failure;}await write(next);};
 h.controls.execute=async()=>{throw veniceDiagnosticError('billing-validation',{httpStatus:200,billingStage:'cap'});};
 await assert.rejects(h.create().complete(0,input),e=>e===failure);assert.equal(h.counts.close_uncertain,1);assert.equal(h.store.read().privateBok.calls[0].phase,'fenced');assert.equal(h.r.reserved,110n);assert.equal(h.r.charged,0n);await assert.rejects(h.create().resume(0),/outcome unknown/);assert.equal(h.counts.execute,1);
});

test('safe diagnostic remains available when original uncertainty chain operation is unresolved',async()=>{
 const h=fixture(),error=veniceDiagnosticError('billing-validation',{httpStatus:200,billingStage:'cap'});h.controls.execute=async()=>{throw error;};h.controls.failBefore='close_uncertain';
 await assert.rejects(h.create().complete(0,input),/operation unresolved/);assert.deepEqual(h.store.read().privateBok.calls[0].providerDiagnostic,getVeniceDiagnostic(error));assert.equal(h.store.read().privateBok.calls[0].phase,'possibly-sent');await assert.rejects(h.create().resume(0),/operation unresolved/);assert.equal(h.counts.close_uncertain,1);assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,0);
});

import {createAgent} from './agent.mjs';
import {bokRunner} from './bok.mjs';
for(const reason of ['length','PRIVATE_SENTINEL',null])test('paid incomplete response '+String(reason)+' settles once, stops agent and refunds unused budget',async()=>{
 const h=fixture(),metering=h.create();let tools=0,accepts=0,closed=0;
 h.controls.execute=()=>{const billing=bill();return {message:{role:'assistant',content:'PRIVATE_SENTINEL',tool_calls:[{id:'1',type:'function',function:{name:'write_file',arguments:'{"path":'}}]},finishReason:reason,charge:6n,receipt:billing.receipt,billing};};
 const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;},accept:async()=>{accepts++;},close:async()=>{closed++;}})};
 const runner=bokRunner({runner:createAgent({maxTokens:10,instructions:'Help',model:{complete:request=>metering.complete(0,request)},toolbox})});
 const result=await runner.run({text:'@bok build',id:'request',postId:'post'});
 assert.match(result.replyText,/incomplete/);assert.equal(result.revision,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SENTINEL/);
 assert.deepEqual({tools,accepts,closed},{tools:0,accepts:0,closed:1});assert.equal(h.r.charged,6n);assert.equal(h.counts.settle,1);
 const saved=h.store.read().privateBok.calls[0];assert.equal(saved.phase,'settled');assert.equal(saved.finishReason,reason==='length'?'length':'invalid');
 assert.equal(saved.responseDelivered,true);assert.equal(saved.response.content,'PRIVATE_SENTINEL');
 assert.equal((await h.create().resume(0)).replyAvailable,false);assert.equal(h.counts.execute,1);
 await metering.finish();assert.deepEqual(h.store.read().privateBok.calls[0],saved);assert.equal((await h.create().resume(0)).replyAvailable,false);assert.equal(h.r.refunded,994n);assert.equal(h.r.charged,6n);assert.equal(h.counts.close_uncertain,0);assert.equal(h.counts.finish,1);
});

test('first quoted call resumes exact never-submitted reserve without requoting or repeating provider work',async()=>{
 const h=fixture();h.controls.failBefore='reserve';await assert.rejects(h.create().complete(0,input));
 const [id,op]=Object.entries(h.store.read().privateBok.operations)[0];
 h.ops.set(id,{status:'not-submitted',method:op.method,argsDigest:op.argsDigest,canonical:false});
 delete h.controls.failBefore;
 const result=await h.create().complete(0,input);assert.equal(result.replyAvailable,true);
 assert.equal(h.counts.quote,1);assert.equal(h.counts.reserve,2);assert.equal(h.counts.execute,1);
 await h.create().complete(0,input);assert.equal(h.counts.execute,1);
});


test('native settlement observer retains the received response and never repeats provider or settlement',async()=>{
 const h=fixture();let waited=0;
 h.controls.after=method=>{if(method==='settle')h.controls.inspectUnknown=true;};
 h.escrow.waitForOperation=async id=>{waited++;assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,1);assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');h.controls.inspectUnknown=false;return h.ops.get(id);};
 const result=await h.create().complete(0,input);assert.equal(waited,1);assert.equal(result.message.content,'UNTRUSTED_REPLY');assert.equal(result.replyAvailable,true);assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');assert.equal(h.store.read().privateBok.calls[0].responseDelivered,true);
 await h.create().complete(0,input);assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,1);
});
test('retained response digest rejects changed payload before agent handoff',async()=>{
 const h=fixture(),read=h.escrow.request;let interrupted=true;
 h.escrow.request=async()=>{if(interrupted&&h.store.read().privateBok?.calls[0]?.phase==='received')throw Error('Read interrupted');return read();};
 await assert.rejects(h.create().complete(0,input));h.store.read().privateBok.calls[0].response.content='changed';interrupted=false;
 await assert.rejects(h.create().resume(0),/response changed/);assert.equal(h.counts.execute,1);assert.equal(h.store.read().privateBok.calls[0].responseDelivered,undefined);
});
test('oversized provider output settles actual billing but never exposes or retains the payload',async()=>{
 const h=fixture();h.controls.execute=()=>{const billing=bill();return {message:{role:'assistant',content:'x'.repeat(1048577)},billing,charge:6n,receipt:billing.receipt};};
 const result=await h.create().complete(0,input);assert.equal(result.finishReason,'invalid');assert.equal(result.message.content,null);assert.equal(h.r.charged,6n);assert(JSON.stringify(h.store.read()).length<10000);
});

test('settled response not yet handed off rechecks canonical settlement before delivery',async()=>{
 const h=fixture(),write=h.store.write;let rejectHandoff=true;
 h.store.write=async next=>{if(rejectHandoff&&next.privateBok?.calls[0]?.responseDelivered)throw Error('handoff disk failure');await write(next);};
 await assert.rejects(h.create().complete(0,input),/handoff disk failure/);assert.equal(h.store.read().privateBok.calls[0].phase,'settled');assert(h.store.read().privateBok.calls[0].response);
 rejectHandoff=false;h.controls.inspectUnknown=true;await assert.rejects(h.create().resume(0),/operation unresolved/);assert.equal(h.counts.settle,1);
 h.controls.inspectUnknown=false;assert.equal((await h.create().resume(0)).message.content,'UNTRUSTED_REPLY');assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,1);
});


test('delivered response survives consumer interruption without another handoff and remains bounded after checkpointed finish without another delivery',async()=>{
 const h=fixture();await h.create().complete(0,input);
 const restarted=h.create();assert.equal((await restarted.resume(0)).replyAvailable,false);
 assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');assert.equal(h.counts.execute,1);
 h.controls.failBefore='finish';await assert.rejects(restarted.finish(),/unresolved/);
 assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');
 // Reconcile the already-recorded original finish, never send a second one.
 const [id,op]=Object.entries(h.store.read().privateBok.operations).find(([,op])=>op.method==='finish');
 h.r.refunded=h.r.available;h.r.available=0n;h.r.state=4;h.ops.set(id,{status:'succeeded',canonical:true,method:'finish',argsDigest:op.argsDigest});
 await h.create().finish();assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');
 assert.equal((await h.create().resume(0)).replyAvailable,false);await assert.rejects(h.create().complete(1,input),/sequence/);
 h.controls.inspectUnknown=true;await assert.rejects(h.create().finish(),/unresolved/);assert.equal(h.store.read().privateBok.calls[0].response.content,'UNTRUSTED_REPLY');
 assert.equal(h.store.read().privateBok.calls[0].responseDelivered,true);assert.equal(h.counts.finish,1);assert.equal(h.counts.execute,1);
});
test('retained response budget rejects a new call before quote reserve or provider entry',async()=>{
 const h=fixture();h.controls.execute=()=>{const billing=bill({providerId:'response-'+h.counts.execute});return {message:{role:'assistant',content:'x'.repeat(900000)},billing,charge:6n,receipt:billing.receipt};};
 for(let id=0;id<4;id++)await h.create().complete(id,input);
 const before=structuredClone(h.counts),saved=structuredClone(h.store.read());
 await assert.rejects(h.create().complete(4,input),/Retained response capacity/);
 assert.deepEqual(h.counts,before);assert.deepEqual(h.store.read(),saved);
 await h.create().finish();assert.deepEqual(h.store.read().privateBok.calls,saved.privateBok.calls);assert(Buffer.byteLength(JSON.stringify(h.store.read()))<8388608);for(let id=0;id<4;id++)assert.equal((await h.create().resume(id)).replyAvailable,false);
});

test('completed accounting retains an undelivered response without authorizing a late tool handoff',async()=>{
 const h=fixture(),write=h.store.write;let fail=true;
 h.store.write=async next=>{if(fail&&next.privateBok?.calls[0]?.responseDelivered)throw Error('handoff interrupted');return write(next);};
 await assert.rejects(h.create().complete(0,input),/handoff interrupted/);fail=false;
 const call=structuredClone(h.store.read().privateBok.calls[0]);assert.equal(call.responseDelivered,undefined);assert(call.response);
 await h.create().finish();assert.deepEqual(h.store.read().privateBok.calls[0],call);
 assert.equal((await h.create().resume(0)).replyAvailable,false);assert.equal((await h.create().complete(0,input)).replyAvailable,false);
 assert.equal(h.counts.execute,1);assert.equal(h.counts.settle,1);assert.equal(h.counts.finish,1);
});


function activatedFixture(){const h=fixture();h.r.available=0n;h.r.reserved=h.r.budget;return h;}
function invocation(h,options={}){return h.create({accountingMode:'invocation-v1',claimReceipt:bokReceiptClaims({readJournals:async()=>[h.store.read()]}),...options});}
test('invocation accounting adopts the posting reservation without a transaction and and aggregates measured calls before finish',async()=>{
 const h=activatedFixture(),m=invocation(h);
 for(let i=0;i<3;i++){assert.equal((await m.complete(i,input)).replyAvailable,true);assert.equal(h.r.sequence,0);assert.equal(h.counts.settle,0);}
 assert.equal(h.counts.reserve,0);assert.equal(h.r.reserved,1000n);assert.equal(h.r.charged,0n);
 assert.equal(h.store.read().privateBok.accountingMode,'invocation-v1');assert(Object.values(h.store.read().privateBok.calls).every(c=>c.phase==='received'&&c.responseDelivered));
 const result=await m.settle();assert.equal(result.charge,'18');assert.equal(h.r.sequence,1);assert.equal(h.counts.settle,1);assert.equal(h.r.reserved,0n);
 await m.finish();assert.equal(h.r.refunded,982n);assert.equal(h.r.charged,18n);
 await invocation(h).finish();assert.equal(h.counts.settle,1);assert.equal(h.counts.finish,1);assert.equal((await invocation(h).resume(2)).replyAvailable,false);
 assert(Object.values(h.store.read().privateBok.calls).every(c=>c.response));
});
test('invocation accounting bounds each paid quote against remaining allowance',async()=>{
 const h=activatedFixture(),m=invocation(h,{limits:{maxReservation:115n}});await m.complete(0,input);
 await assert.rejects(m.complete(1,input),/quote maximum/);assert.equal(h.counts.execute,1);assert.equal(h.r.reserved,1000n);
 await m.finish();assert.equal(h.r.refunded,994n);assert.equal(h.counts.reserve,0);
});
test('invocation accounting unknown later provider fences whole allowance and reconciles exact cumulative billing',async()=>{
 const h=activatedFixture(),m=invocation(h);await m.complete(0,input);h.controls.execute=()=>{throw Error('lost');};
 await assert.rejects(m.complete(1,input),/outcome unknown/);assert.equal(h.r.state,3);assert.equal(h.r.reserved,1000n);
 await assert.rejects(invocation(h).complete(2,input),/sequence/);await assert.rejects(invocation(h).resume(1),/outcome unknown/);assert.equal(h.counts.execute,2);
 const b=bill({providerId:'fixture-response-2'});await invocation(h).reconcile(1,b);assert.equal(h.r.charged,12n);assert.equal(h.r.refunded,988n);assert.equal(h.counts.reconcile,1);assert.equal(h.counts.settle,0);assert.equal(h.counts.execute,2);
 await invocation(h).finish();assert.equal(h.r.state,4);
});
test('invocation accounting retains aggregate intent through unresolved settlement without provider or transaction replay',async()=>{
 const h=activatedFixture(),m=invocation(h);await m.complete(0,input);h.controls.failBefore='settle';await assert.rejects(m.settle(),/unresolved/);
 const snapshot=structuredClone(h.store.read().privateBok.aggregate);delete h.controls.failBefore;
 await assert.rejects(invocation(h).settle(),/unresolved/);assert.equal(h.counts.settle,1);assert.equal(h.counts.execute,1);assert.deepEqual(h.store.read().privateBok.aggregate,snapshot);
});
test('invocation accounting recovers acknowledged settlement from its exact receipt only',async()=>{
 const h=activatedFixture(),m=invocation(h);await m.complete(0,input);h.controls.after=method=>{if(method==='settle')h.controls.inspectUnknown=true;};
 await assert.rejects(m.settle(),/unresolved/);assert.equal(h.r.sequence,1);delete h.controls.after;h.controls.inspectUnknown=false;
 await invocation(h).settle();assert.equal(h.counts.settle,1);assert.equal(h.counts.execute,1);
 h.r.receipt=f(444);await assert.rejects(invocation(h).settle(),/mismatch/);assert.equal(h.counts.settle,1);
});
test('invocation accounting rejects reorg reservation before another paid send',async()=>{
 const h=activatedFixture(),m=invocation(h);await m.complete(0,input);h.r.sequence=1;await assert.rejects(m.complete(1,input),/Reservation changed/);assert.equal(h.counts.execute,1);
});
test('invocation accounting rejects mismatched historical mode without paid work',async()=>{
 const h=fixture();await h.create().complete(0,input);const before=structuredClone(h.store.read());
 assert.throws(()=>invocation(h),/accounting mode mismatch/);assert.deepEqual(h.store.read(),before);assert.equal(h.counts.execute,1);
});
test('invocation accounting shared receipt claims serialize across requests and retain historical ownership',async()=>{
 const states=[],guard=bokReceiptClaims({readJournals:async()=>states});let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);const billing=bill();
 const first=guard({identity,callId:0,billing},async()=>{entered();await gate;states.push({privateBok:{identity,calls:{0:{id:0,billing}}}});});
 await started;let secondEntered=false;const second=guard({identity:{...identity,requestId:f(9)},callId:0,billing},async()=>{secondEntered=true;});
 release();await first;await assert.rejects(second,/already owned/);assert.equal(secondEntered,false);
 await guard({identity,callId:0,billing},async()=>{});
 await assert.rejects(guard({identity,callId:1,billing},async()=>assert.fail('duplicate')),/already owned/);
});
test('invocation accounting requires shared receipt ownership and keeps fresh coding default separate from old limits',()=>{
 const h=activatedFixture();assert.throws(()=>h.create({accountingMode:'invocation-v1'}),/Serialized receipt/);
});


test('invocation checks reservation and provider preflight before its durable dispatch boundary',async()=>{
 const h=activatedFixture(),m=invocation(h),request=h.escrow.request,usable=h.escrow.assertUsable;
 let reads=0,guards=0,preflights=0;
 h.escrow.request=async(...args)=>{reads++;return request(...args);};
 h.escrow.assertUsable=async(...args)=>{guards++;assert.equal(h.store.read().privateBok.calls[guards-1].phase,'quoted');return usable(...args);};
 h.provider.beforeDispatch=async(originalQuote,available)=>{assert.deepEqual(originalQuote,quote);assert.equal(available,1000n-BigInt(preflights)*6n);preflights++;assert.equal(preflights,guards);assert.equal(h.store.read().privateBok.calls[preflights-1].phase,'quoted');};
 const execute=h.provider.execute;h.provider.execute=async(...args)=>{assert.equal(h.store.read().privateBok.calls[h.counts.execute].phase,'possibly-sent');return execute(...args);};
 for(let id=0;id<3;id++)await m.complete(id,input);
 assert.equal(reads,1,'Only initial budget sizing needs a separate request read');
 assert.equal(guards,3,'One authoritative mutable guard per paid call');assert.equal(preflights,3);assert.equal(h.counts.execute,3);
});
test('invocation preflight rejection leaves an unsent quote and permits its original input once',async()=>{
 for(const stage of ['reservation','provider']){
  const h=activatedFixture();let rejected=true;
  if(stage==='reservation')h.escrow.assertUsable=async()=>{if(rejected)throw Error('known preflight rejection');return {canonical:true,request:{...h.r}};};
  else h.provider.beforeDispatch=async()=>{if(rejected)throw Error('known preflight rejection');};
  await assert.rejects(invocation(h).complete(0,input),/known preflight rejection/);
  assert.equal(h.store.read().privateBok.calls[0].phase,'quoted');assert.equal(h.counts.execute,0);assert.equal(h.counts.close_uncertain,0);
  assert.equal((await invocation(h).resume(0)).readyForComplete,true);
  await assert.rejects(invocation(h).complete(0,{...input,maxTokens:9}),/Call input changed/);
  rejected=false;assert.equal((await invocation(h).complete(0,input)).replyAvailable,true);
  assert.equal(h.counts.quote,1);assert.equal(h.counts.execute,1);
  await invocation(h).complete(0,input);assert.equal(h.counts.execute,1);
 }
});
test('invocation write failure at the dispatch boundary remains conservative without paid replay',async()=>{
 const h=activatedFixture(),write=h.store.write;
 h.store.write=async next=>{await write(next);if(next.privateBok.calls[0]?.phase==='possibly-sent')throw Error('durable write interrupted');};
 await assert.rejects(invocation(h).complete(0,input),/durable write interrupted/);assert.equal(h.counts.execute,0);
 h.store.write=write;await assert.rejects(invocation(h).resume(0),/outcome unknown/);assert.equal(h.counts.execute,0);
});
test('invocation retained response resume still validates current reservation before tool delivery',async()=>{
 const h=activatedFixture(),write=h.store.write;let interrupt=true;
 h.store.write=async next=>{if(interrupt&&next.privateBok?.calls[0]?.responseDelivered)throw Error('handoff interrupted');return write(next);};
 await assert.rejects(invocation(h).complete(0,input),/handoff interrupted/);interrupt=false;h.controls.unusable=true;
 await assert.rejects(invocation(h).resume(0),/near deadline/);assert.equal(h.counts.execute,1);assert.equal(h.store.read().privateBok.calls[0].responseDelivered,undefined);
 h.controls.unusable=false;assert.equal((await invocation(h).resume(0)).replyAvailable,true);assert.equal(h.counts.execute,1);
});

test('activation reservation rejects unreserved, partial, charged, refunded, wrong-sequence and wrong-receipt state before paid work',async()=>{
 for(const patch of [{available:1000n,reserved:0n},{available:1n,reserved:999n},{sequence:1},{reserved:999n,charged:1n},{reserved:999n,refunded:1n},{receipt:f(99)}]){
  const h=activatedFixture();Object.assign(h.r,patch);await assert.rejects(invocation(h).complete(0,input),/activated reservation/);
  assert.equal(h.counts.quote,0);assert.equal(h.counts.execute,0);assert.equal(h.counts.reserve,0);
 }
});
test('activated invocation with no provider calls refunds its full budget using a zero-charge receipt',async()=>{
 const h=activatedFixture();await invocation(h).finish();assert.equal(h.r.state,4);assert.equal(h.r.refunded,1000n);assert.equal(h.r.charged,0n);assert.equal(h.counts.execute,0);assert.equal(h.counts.reserve,0);assert.equal(h.counts.settle,1);
});

test('activation accounting never requires a reserve capability',async()=>{
 const h=activatedFixture();delete h.escrow.reserve;await invocation(h).complete(0,input);assert.equal(h.counts.execute,1);assert.equal(h.counts.reserve,0);
});

for(const budget of [9000000n,50000000n])test(`invocation accepts ${budget} USDC base units within default cap`,async()=>{
 const h=activatedFixture();h.r.budget=h.r.reserved=budget;
 await invocation(h).complete(0,input);assert.equal(h.counts.execute,1);
 assert.equal(h.store.read().privateBok.reservation.maximum,String(budget));
});
test('invocation rejects more than 50 USDC before provider work',async()=>{
 const h=activatedFixture();h.r.budget=h.r.reserved=50000001n;
 await assert.rejects(invocation(h).complete(0,input),/budget failure/);
 assert.equal(h.counts.quote,0);assert.equal(h.counts.execute,0);
});
