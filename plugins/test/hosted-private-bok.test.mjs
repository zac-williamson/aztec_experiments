// Labelled controlled canonical-chain/provider ports; no external services or real proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runPrivateBokRequest,startEscrowService,reconcileHostedBilling,isHostedTerminalWithoutReply} from '../escrow-service.mjs';
import {validateVeniceBilling} from '../venice-metered.mjs';
import {validateDescriptor,API_VERSION,unpackText} from '../protocol.mjs';
import {publishAcceptedRevision,hostedRecoveryScanner,runHostedBillingReconciliation,acquireHostedLease,serializeHostedEscrow,hostedTerminalNode} from '../main.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
test('accepted publication with uncertain private mirror retains exact identity and omits operator URL',async()=>{
 const receipt=Object.freeze({acceptedRevision:'a'.repeat(40)}),calls=[],publicResult={latestUrl:'https://apps.example/latest/',latestSourceUrl:'https://apps.example/source.json'};
 const publication={publish:async input=>{assert.equal(input,receipt);calls.push('local');return publicResult;}};
 let unresolved=true;
 const mirror={sync:async input=>{assert.equal(input,receipt);calls.push('mirror');if(unresolved)throw Error('GITHUB_BROKER_UNRESOLVED');return {operatorUrl:'https://github.com/private/mirror'};}};
 await assert.rejects(publishAcceptedRevision({publication,mirror,receipt}),/UNRESOLVED/);
 unresolved=false;assert.equal(await publishAcceptedRevision({publication,mirror,receipt}),publicResult);
 assert.deepEqual(calls,['local','mirror','local','mirror']);
 assert.equal(await publishAcceptedRevision({publication,receipt}),publicResult);
 let mirrorCalls=0;
 await assert.rejects(publishAcceptedRevision({publication:{publish:async()=>{throw Error('disk');}},mirror:{sync:async()=>{mirrorCalls++;}},receipt}),/disk/);
 assert.equal(mirrorCalls,0);
});
const f=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(){
 const request={postId:f(1),requestId:f(2),target:f(3),pluginId:f(4),order:'1'};
 const current={...request,text:'@bok hello',usable:true,predecessorsClear:true,replied:false,mainVersion:1,localVersion:0};
 const row={state:2,sequence:0,invocation_hash:f(3),budget:1000n,available:1000n,reserved:0n,charged:0n,refunded:0n,receipt:f(0)};
 let saved={operations:{}};const ops=new Map(),events=[],control={};
 const store={read:()=>saved,write:async next=>{if(control.writeFailure?.(next))throw Error('disk');saved=structuredClone(next);}};
 const board={readRequest:async()=>({...current}),pending:async()=>({requests:[{...request,threadId:f(9)}],nextCursor:null})};
 const escrow={identity:{network:'eip155-31337:aztec-1:public',escrow:f(5)},request:async()=>({canonical:true,request:{...row},anchor:{number:7,hash:f(77)}}),assertUsable:async()=>{},inspectOperation:async id=>control.unknownReply&&ops.get(id)?.method==='publish_reply'?{status:'pending'}:ops.get(id)??{status:'absent'}};
 for(const method of ['reserve','settle','close_uncertain','reconcile','finish','publish_reply'])escrow[method]=async(...args)=>{
  const op=args.pop();events.push(method);assert(!ops.has(op.operationId),'No repeated mutator');
  if(method==='reserve'){row.available-=args[2];row.reserved=args[2];}
  if(method==='settle'||method==='reconcile'){row.charged+=args[2];if(method==='reconcile'){row.refunded+=row.reserved-args[2];row.state=4;}else row.available+=row.reserved-args[2];row.reserved=0n;row.sequence++;row.receipt=args[3];}
  if(method==='close_uncertain'){row.state=3;row.refunded+=row.available;row.available=0n;}
  if(method==='finish'){row.refunded+=row.available;row.available=0n;row.state=4;}
  if(method==='publish_reply'){assert.equal(saved.hostedPrivateBok.phase,'reply-intent');assert.equal(row.reserved,0n);current.replied=true;}
  ops.set(op.operationId,{status:'succeeded',canonical:true,method,argsDigest:op.argsDigest});
 };
 const quote={modelId:'fixture',inputBound:100,maxTokens:10,inputPrice:1000000000n,outputPrice:1000000000n,cachePrice:null,maximum:110n};
 const provider={quote:async()=>quote,execute:async()=>{
  events.push('paid');assert(Object.values(saved.privateBok.calls).some(c=>c.phase==='possibly-sent'));
  await control.hold?.();if(control.timeout)throw Error('PRIVATE_PROVIDER_ERROR');
  const billing=validateVeniceBilling({providerId:'synthetic-'+row.sequence,modelId:'fixture',promptTokens:4,completionTokens:2,cachedTokens:0,inputPrice:'1000000000',outputPrice:'1000000000',cachePrice:null,charge:'6'},quote);
  return {message:{role:'assistant',content:'public reply'},billing,charge:6n,receipt:billing.receipt};
 }};
 const runAgent=async({model,text})=>{assert.equal(text,current.text);const r=await model.complete({messages:[{role:'user',content:text}],maxTokens:10});return {replyText:r.message.content};};
 const args={request,board,escrow,store,provider,runAgent};return {args,current,row,events,store,control,ops,run:()=>runPrivateBokRequest(args)};
}
test('Rolling hosted composition reserves before paid call, settles, authenticates reply and releases remainder',async()=>{
 const x=fixture();assert.deepEqual(await x.run(),{status:'finished',replayed:false});assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
 assert.equal(x.row.charged,6n);assert.equal(x.row.refunded,994n);assert.equal(x.row.reserved,0n);
 await x.run();assert.equal(x.events.filter(v=>v==='paid').length,1);assert.equal(x.store.read().hostedPrivateBok.phase,'finished');
});
test('unknown provider call remains fenced across hosted restart without another invocation',async()=>{
 const x=fixture();x.control.timeout=true;await assert.rejects(x.run(),/unknown/);assert.equal(x.row.state,3);assert.equal(x.row.reserved,110n);
 x.control.timeout=false;await assert.rejects(x.run(),/unresolved/);assert.deepEqual(x.events,['reserve','paid','close_uncertain']);
 assert(!JSON.stringify(x.store.read()).includes('PRIVATE_PROVIDER_ERROR'));
});

async function unknownBillingFixture(){
 const x=fixture();x.control.timeout=true;await assert.rejects(x.run(),/unknown/);
 const saved=x.store.read(),call=saved.privateBok.calls[0];
 const billing=validateVeniceBilling({providerId:'original-receipt',modelId:'fixture',promptTokens:4,completionTokens:2,cachedTokens:0,inputPrice:'1000000000',outputPrice:'1000000000',cachePrice:null,charge:'6'}, {...call.quote,inputPrice:1000000000n,outputPrice:1000000000n,maximum:110n});
 const receipt={schemaVersion:1,binding:structuredClone(saved.hostedPrivateBok.binding),callId:0,inputDigest:call.inputDigest,billing,evidenceSha256:'ab'.repeat(32)};
 const lease={assertHeld:async()=>assert(!x.control.leaseLost)};
 return {...x,receipt,recover:value=>reconcileHostedBilling({receipt:value??receipt,escrow:x.args.escrow,store:x.store,lease})};
}
test('trusted original billing closes accounting without reply or another provider call',async()=>{
 const x=await unknownBillingFixture();assert.equal(x.row.reserved,110n);assert.equal(x.row.refunded,890n);
 const result=await x.recover();assert.equal(result.status,'accounted-without-reply');assert.equal(result.replyAvailable,false);assert.equal(result.charge,'6');
 assert.equal(x.row.refunded,994n);assert.equal(x.row.charged,6n);assert.equal(x.row.reserved,0n);assert.equal(x.row.state,4);
 assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);assert.equal(x.current.replied,false);
 assert.deepEqual(await x.recover(),result);assert.equal((await x.run()).status,'accounted-without-reply');
 assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);assert.equal(x.store.read().hostedPrivateBok.phase,'accounted-without-reply');
});
test('trusted billing rejects changed scope input cost receipt and original evidence before chain mutation',async()=>{
 for(const mutate of [r=>r.binding.target=f(99),r=>r.binding.postId=f(99),r=>r.callId=1,r=>r.inputDigest='cc'.repeat(32),r=>r.billing.charge='0',r=>r.billing.receipt=f(99),r=>r.billing.inputPrice='0',r=>r.evidenceSha256='invalid']){
  const x=await unknownBillingFixture(),r=structuredClone(x.receipt),before=structuredClone(x.store.read());mutate(r);
  await assert.rejects(x.recover(r));assert.deepEqual(x.store.read(),before);assert.deepEqual(x.events,['reserve','paid','close_uncertain']);assert.equal(x.row.reserved,110n);
 }
 const x=await unknownBillingFixture();await x.recover();const changed={...x.receipt,evidenceSha256:'cd'.repeat(32)};
 await assert.rejects(x.recover(changed),/recovery changed/);assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);
});
test('interrupted billing reconciliation resumes original chain operation and never republishes a reply',async()=>{
 const x=await unknownBillingFixture(),inspect=x.args.escrow.inspectOperation;let hidden=true;
 x.args.escrow.inspectOperation=async id=>{const result=await inspect(id);return hidden&&result.method==='reconcile'?{status:'pending'}:result;};
 await assert.rejects(x.recover(),/Chain operation unresolved/);assert.equal(x.store.read().hostedPrivateBok.phase,'accounting-recovery');
 assert.equal(x.store.read().privateBok.calls[0].phase,'received');assert.equal(x.current.replied,false);
 await assert.rejects(x.recover(),/Chain operation unresolved/);assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);
 hidden=false;assert.equal((await x.recover()).status,'accounted-without-reply');assert.equal(x.row.refunded,994n);
 assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);
});
test('earlier settled receipt and changed limits cannot trap the current two-call billing recovery',async()=>{
 const x=fixture();x.args.runAgent=async({model})=>{
  await model.complete({messages:[{role:'user',content:'first'}],maxTokens:10});
  x.control.timeout=true;await model.complete({messages:[{role:'user',content:'second'}],maxTokens:10});
 };
 await assert.rejects(x.run(),/unknown/);
 const saved=structuredClone(x.store.read()),lease={assertHeld:async()=>{}},first=saved.privateBok.calls[0],last=saved.privateBok.calls[1];
 const receipt={schemaVersion:1,binding:saved.hostedPrivateBok.binding,callId:0,inputDigest:first.inputDigest,billing:first.billing,evidenceSha256:'ab'.repeat(32)};
 const run=(value,limits)=>reconcileHostedBilling({receipt:value,escrow:x.args.escrow,store:x.store,lease,limits});
 await assert.rejects(run(receipt),/current unknown/);assert.deepEqual(x.store.read(),saved);
 const billing=validateVeniceBilling({...first.billing,providerId:'second-original',receipt:undefined},{...last.quote,inputPrice:1000000000n,outputPrice:1000000000n,maximum:110n});
 const correct={...receipt,callId:1,inputDigest:last.inputDigest,billing};
 await assert.rejects(run(correct,{maxCalls:7}),/limits mismatch/);assert.deepEqual(x.store.read(),saved);
 const sequence=x.row.sequence;x.row.sequence=9;await assert.rejects(run(correct),/sequence or accounting/);assert.deepEqual(x.store.read(),saved);x.row.sequence=sequence;
 assert.equal((await run(correct)).status,'accounted-without-reply');assert.equal(x.row.charged,12n);assert.equal(x.row.refunded,988n);
 assert.deepEqual(x.events,['reserve','paid','settle','reserve','paid','close_uncertain','reconcile']);
});
test('billing recovery retains original lease and never treats reply recovery as lost billing',async()=>{
 const x=await unknownBillingFixture();x.control.leaseLost=true;await assert.rejects(x.recover());assert.deepEqual(x.events,['reserve','paid','close_uncertain']);
 x.control.leaseLost=false;x.store.read().hostedPrivateBok.phase='reply-confirmed';await assert.rejects(x.recover(),/No unresolved/);assert.deepEqual(x.events,['reserve','paid','close_uncertain']);
});
test('one-shot billing owner refuses the active service lease before SDK or evidence access',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'billing-owner-'));
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),boardAddress:f(1),receiver:f(2)};
 const config={applicationProfile:'rolling',development:true,nodeUrl:'http://127.0.0.1:1/',ethereumUrl:'http://127.0.0.1:2/',operatorAddress:f(3),stateDirectory:directory,pluginId:f(4),descriptor:{applicationProfile:'rolling',protocol:API_VERSION,scope,funding:{protocol:'private-bok-usdc/v1',portalAddress:'0x'+'2'.repeat(40),tokenAddress:'0x'+'3'.repeat(40)}}};
 const lease=await acquireHostedLease(directory);
 try{await assert.rejects(runHostedBillingReconciliation({config,receiptFile:'/nonexistent/private-input',env:{}}),/preserve original receipt/);await lease.assertHeld();assert.equal((await fs.readdir(directory)).join(),'hosted.lock');}
 finally{await lease.close();}
 try{await assert.rejects(runHostedBillingReconciliation({config,receiptFile:'/nonexistent/private-input',env:{}}),/preserve original receipt/);assert.deepEqual(await fs.readdir(directory),[]);}
 finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('billing recovery persists original receipt in the actual file store across an interrupted owner',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{fileState}=await import('../operations.mjs');
 const x=await unknownBillingFixture(),directory=await fs.mkdtemp(path.join(os.tmpdir(),'billing-journal-')),file=path.join(directory,'request.json');const lease=await acquireHostedLease(directory);
 let hidden=true;const inspect=x.args.escrow.inspectOperation;x.args.escrow.inspectOperation=async id=>{const result=await inspect(id);return hidden&&result.method==='reconcile'?{status:'pending'}:result;};
 try{
  const store=await fileState(file);await store.write(x.store.read());
  const run=async()=>reconcileHostedBilling({receipt:x.receipt,escrow:x.args.escrow,store:await fileState(file),lease});
  await assert.rejects(run(),/unresolved/);const retained=(await fileState(file)).read();assert.equal(retained.hostedPrivateBok.phase,'accounting-recovery');assert.deepEqual(retained.hostedPrivateBok.billingRecovery.billing,x.receipt.billing);
  hidden=false;assert.equal((await run()).status,'accounted-without-reply');assert.equal((await fileState(file)).read().hostedPrivateBok.phase,'accounted-without-reply');
  await run();assert.deepEqual(x.events,['reserve','paid','close_uncertain','reconcile']);assert.equal(x.row.refunded,994n);assert.equal((await fs.stat(file)).mode&0o777,0o600);
 }finally{await lease.close();await fs.rm(directory,{recursive:true,force:true});}
});
test('reply receipt loss permits only inspection then finish, never provider or reply retransmission',async()=>{
 const x=fixture();x.control.unknownReply=true;await assert.rejects(x.run(),/Reply transaction unresolved/);assert.equal(x.store.read().hostedPrivateBok.phase,'reply-intent');
 x.control.unknownReply=false;await x.run();assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
});
test('pending hosted finish resumes only its canonical original operation without provider or reply replay',async()=>{
 const x=fixture();let original;
 x.args.escrow.finish=async(request,operation)=>{
  assert.equal(request,x.args.request.requestId);assert.equal(original,undefined,'No finish retransmission');
  original=structuredClone(operation);x.events.push('finish');
  x.ops.set(operation.operationId,{status:'pending',canonical:false,method:'finish',argsDigest:operation.argsDigest,txHash:f(91)});
 };
 await assert.rejects(x.run(),/Chain operation unresolved/);
 assert.equal(x.store.read().hostedPrivateBok.phase,'reply-confirmed');assert.equal(x.store.read().privateBok.finished,false);
 assert.equal(x.row.refunded,0n);assert.equal(x.row.available,994n);assert.equal(x.row.charged,6n);
 assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
 // Each run reconstructs the owner and metering from the same durable-store
 // double; an unresolved original finish permits inspection only.
 await assert.rejects(x.run(),/Chain operation unresolved/);assert.equal(x.row.refunded,0n);
 x.ops.set(original.operationId,{...x.ops.get(original.operationId),status:'succeeded',canonical:false});
 await assert.rejects(x.run(),/Chain operation unresolved/);assert.equal(x.row.refunded,0n);
 // Labelled canonical-chain transition, not a second call to the mutator.
 x.ops.set(original.operationId,{...x.ops.get(original.operationId),canonical:true,transactionFee:'7'});
 x.row.refunded=x.row.available;x.row.available=0n;x.row.state=4;
 assert.deepEqual(await x.run(),{status:'finished',replayed:false});assert.equal(x.store.read().privateBok.finished,true);
 assert.equal(x.row.refunded,994n);assert.equal(x.row.charged,6n);assert.equal(x.row.reserved,0n);
 assert.equal(x.ops.get(original.operationId).txHash,f(91));assert.equal(x.ops.get(original.operationId).argsDigest,original.argsDigest);
 await x.run();assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
 assert.equal(x.store.read().hostedPrivateBok.phase,'finished');
});
test('crash after durable agent intent cannot restart even before a paid call',async()=>{
 const x=fixture();x.args.runAgent=async()=>{throw Error('interrupted');};await assert.rejects(x.run());
 x.args.runAgent=()=>assert.fail('No rerun');await assert.rejects(x.run(),/unresolved/);assert.deepEqual(x.events,[]);
});
test('canonical invocation or journal identity changes reject before billing',async()=>{
 const x=fixture();x.current.target=f(99);await assert.rejects(x.run(),/invocation changed/);assert.deepEqual(x.events,[]);
 const y=fixture();await y.run();y.args.request={...y.args.request,target:f(99)};await assert.rejects(y.run(),/identity changed/);
 const z=fixture();z.current.usable=false;await assert.rejects(z.run(),/no longer usable/);assert.deepEqual(z.events,[]);
});
test('missing reply linkage cannot release credits as a successful authenticated reply',async()=>{
 const x=fixture(),publish=x.args.escrow.publish_reply;x.args.escrow.publish_reply=async(...args)=>{await publish(...args);x.current.replied=false;};
 await assert.rejects(x.run(),/Authenticated Rolling reply/);assert(!x.events.includes('finish'));
});
test('real HTTP hosted owner drains current request before closing its listener',async()=>{
 const x=fixture();let release,entered;const started=new Promise(r=>entered=r);x.control.hold=()=>{entered();return new Promise(r=>release=r);};
 const errors=[];const server=await startEscrowService({descriptor:{applicationProfile:'rolling'},profile:'rolling',concurrency:1,board:x.args.board,run:()=>x.run(),port:0,pollMs:20,onError:e=>errors.push(e)});
 try{
  await started;const health=await (await fetch(`http://127.0.0.1:${server.address.port}/health`)).json();assert.equal(health.active,1);
  let ended=false;const close=server.close().then(()=>ended=true);await new Promise(r=>setTimeout(r,10));assert.equal(ended,false);
  release();await close;assert.equal(errors.length,0);assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
 }finally{release?.();await server.close();}
});
test('explicit Rolling descriptor cannot select legacy account funding',()=>{
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'1'.repeat(40),boardAddress:f(1),receiver:f(2)};
 const d={protocol:API_VERSION,applicationProfile:'rolling',description:'Bok',scope,funding:{protocol:'private-bok-usdc/v1',portalAddress:'0x'+'2'.repeat(40),tokenAddress:'0x'+'3'.repeat(40)}};
 assert.equal(validateDescriptor(d,scope).applicationProfile,'rolling');assert.throws(()=>validateDescriptor({...d,funding:{...d.funding,protocol:'aztec-escrow-usdc/v1'}},scope));
});

test('hosted filesystem lease rejects second owner and preserves a replaced lock',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {acquireHostedLease}=await import('../main.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bok-lease-'));
 try{
  const lease=await acquireHostedLease(root);await lease.assertHeld();
  assert.equal((await fs.stat(path.join(root,'hosted.lock'))).mode&0o777,0o600);
  await assert.rejects(acquireHostedLease(root),{code:'EEXIST'});
  await fs.rename(path.join(root,'hosted.lock'),path.join(root,'original'));
  await fs.writeFile(path.join(root,'hosted.lock'),'replacement',{flag:'wx',mode:0o600});
  await assert.rejects(lease.assertHeld(),/changed/);await assert.rejects(lease.close(),/changed/);
  assert.equal(await fs.readFile(path.join(root,'hosted.lock'),'utf8'),'replacement');
  await fs.unlink(path.join(root,'hosted.lock'));
  const next=await acquireHostedLease(root);await next.close();await next.close();
  await assert.rejects(fs.stat(path.join(root,'hosted.lock')),{code:'ENOENT'});
  await assert.rejects(next.assertHeld(),/closed/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('actual SDK board projection gates canonical plugin, moderation, anchor and native proof mode',async()=>{
 const fs=await import('node:fs/promises');
 const {rollingBoardPort}=await import('../aztec.mjs');
 const {BarretenbergSync,BackendType}=await import('@aztec-foundation/bb.js');
 const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
 const {loadContractArtifact}=await import('@aztec-labs/stdlib/abi');
 const {getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract');
 const {deriveStorageSlotInMap}=await import('@aztec-labs/stdlib/hash');
 await BarretenbergSync.initSingleton({backend:BackendType.Wasm,skipSrsInit:true});
 try{
  const artifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
  const scope={chainId:'31337',rollupVersion:'3409706519',rollupAddress:'0x'+'1'.repeat(40),boardAddress:f(8),receiver:f(9)};
  const classId=String((await getContractClassFromArtifact(artifact)).id),pluginId=f(4);
  const pluginSlot=(await deriveStorageSlotInMap(artifact.storageLayout.plugins.slot,Fr.fromString(pluginId))).toBigInt();
  const flagged=(await deriveStorageSlotInMap(artifact.storageLayout.post_flagged.slot,new Fr(1n))).toBigInt();
  const storage=new Map([[pluginSlot,9n],[pluginSlot+1n,1n],[flagged,0n],[artifact.storageLayout.main_version.slot.toBigInt(),1n]]);
  const state={realProofs:false,anchor:f(99),currentClass:classId};
  const post={id:'1',text:'@bok hello',record:{subboard:'0',root:'1'},order:'1',position:{blockNumber:3},removal:null,invocation:{adapter:'9',pluginId:'4',requestId:'2',target:'3',reply:null}};
  const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:3409706519,realProofs:state.realProofs,l1ContractAddresses:{rollupAddress:scope.rollupAddress}}),
   getBlock:async tag=>({number:5,hash:tag==='checkpointed'?f(99):state.anchor}),getContract:async()=>({originalContractClassId:classId,currentContractClassId:state.currentClass}),
   getPublicStorageAt:async(anchor,address,slot)=>{assert.deepEqual(anchor,{number:5,hash:f(99)});assert.equal(String(address),scope.boardAddress);return new Fr(storage.get(slot.toBigInt()));}};
  const index={scanPendingPredecessors:()=>({rows:[],nextAfter:null,revision:'one'}),sync:async()=>{},status:()=>({state:'ready'}),query:()=>({post}),scanPosts:()=>({complete:true,posts:[post],nextAfter:null,checkpoint:{number:5,hash:f(99)}})};
  const port=await rollingBoardPort({node,index,scope,boardArtifact:artifact,pluginId,development:true});
  assert.equal((await port.pending(null)).requests[0].target,f(3));assert.equal((await port.readRequest(f(1))).usable,true);
  index.scanPendingPredecessors=id=>{assert.equal(id,'1');return {rows:[{postId:'7',threadId:'1',order:'0',requestId:'7',target:'8',pluginId:'4',adapter:'9'}],nextAfter:null,revision:'one'};};assert.equal((await port.readRequest(f(1))).usable,false);assert.equal((await port.pending(null)).requests.length,0);
  post.invocation.reply={postId:'2'};assert.equal((await port.readRequest(f(1))).usable,false,'replied recovery still respects an earlier unresolved invocation');index.scanPendingPredecessors=()=>({rows:[],nextAfter:null,revision:'one'});assert.equal((await port.readRequest(f(1))).usable,true);post.invocation.reply=null;
  const originalScan=index.scanPosts;let scans=0;
  index.scanPosts=({after,limit})=>{scans++;assert.equal(limit,64);if(after===null)return {complete:true,posts:[{...post,text:null}],nextAfter:'1',checkpoint:{number:5,hash:f(99)}};assert.equal(after,'1');return {complete:true,posts:[post],nextAfter:null,checkpoint:{number:5,hash:f(99)}};};
  node.getBlockData=async()=>({blockHash:f(99)});
  const rejected=await port.pending();assert.equal(rejected.requests.length,0);assert.equal(rejected.nextCursor.after,'1');
  assert.equal((await port.pending(rejected.nextCursor)).requests[0].postId,f(1));assert.equal(scans,2);
  node.getBlockData=async()=>({blockHash:f(88)});assert.equal((await port.pending(rejected.nextCursor)).requests.length,0);index.scanPosts=originalScan;
  post.text=null;assert.equal((await port.readRequest(f(1))).usable,false);post.text='visible';
  storage.set(flagged,1n);assert.equal((await port.readRequest(f(1))).usable,false);assert.equal((await port.readRequest(f(1))).predecessorsClear,true);storage.set(flagged,0n);
  storage.set(pluginSlot+1n,0n);assert.equal((await port.readRequest(f(1))).usable,false);assert.equal((await port.readRequest(f(1))).predecessorsClear,true);storage.set(pluginSlot+1n,1n);
  const subboard=(await deriveStorageSlotInMap(artifact.storageLayout.subboards.slot,new Fr(7n))).toBigInt();
  post.record.subboard='7';storage.set(subboard,1n);storage.set(subboard+4n,0n);
  assert.equal((await port.readRequest(f(1))).localVersion,1);assert.equal((await port.readRequest(f(1))).usable,true);
  storage.set(subboard+4n,1n);assert.equal((await port.readRequest(f(1))).usable,false);
  storage.set(subboard+4n,0n);storage.set(subboard,0n);assert.equal((await port.readRequest(f(1))).usable,false);post.record.subboard='0';
  state.currentClass=f(77);await assert.rejects(port.readRequest(f(1)));state.currentClass=classId;
  state.anchor=f(98);await assert.rejects(port.readRequest(f(1)),/anchor/);state.anchor=f(99);
  state.realProofs=true;await assert.rejects(port.readRequest(f(1)));
  await port.close();await assert.rejects(port.readRequest(f(1)),/admission closed/);await assert.rejects(port.pending(),/admission closed/);
 }finally{BarretenbergSync.destroySingleton();}
});

test('restarted confirmed reply must remain canonical and linked before releasing unused credits',async()=>{
 for(const invalidation of ['operation','link']){
  const x=fixture(),finish=x.args.escrow.finish;
  x.args.escrow.finish=async()=>{throw Error('controlled shutdown before finish');};
  await assert.rejects(x.run(),/Chain operation unresolved/);assert.equal(x.store.read().hostedPrivateBok.phase,'reply-confirmed');
  if(invalidation==='operation')x.control.unknownReply=true;else x.current.replied=false;
  x.args.escrow.finish=finish;await assert.rejects(x.run(),/Reply transaction unresolved|Authenticated Rolling reply/);
  assert.deepEqual(x.events,['reserve','paid','settle','publish_reply']);assert.equal(x.row.refunded,0n);
 }
});

test('moderation drift during reservation prevents the actual provider call and preserves its fence',async()=>{
 const x=fixture(),reserve=x.args.escrow.reserve;
 x.args.escrow.reserve=async(...args)=>{const result=await reserve(...args);x.current.usable=false;return result;};
 await assert.rejects(x.run(),/unknown/);
 assert.deepEqual(x.events,['reserve','close_uncertain']);assert.equal(x.row.reserved,110n);assert.equal(x.row.state,3);
 x.current.usable=true;await assert.rejects(x.run(),/unresolved/);assert(!x.events.includes('paid'));
});

test('private actor file and SDK decode failures cannot leak private sentinels',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {inspect}=await import('node:util'),{readHostedActor}=await import('../main.mjs');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bok-private-')),file=path.join(root,'actor.json'),sentinel='PRIVATE-ACTOR-SENTINEL';
 try{
  await fs.writeFile(file,'{"secret":"'+sentinel,{mode:0o600});
  for(const config of [{operatorFile:file},{operator:{secret:sentinel,salt:f(1),signingKey:f(2)}},{operator:{secret:'0x'+'f'.repeat(64),salt:f(1),signingKey:f(2)}}]){
   await assert.rejects(readHostedActor(config),error=>{assert.equal(error.message,'Invalid private operator configuration');assert(!inspect(error).includes(sentinel));assert.equal(error.cause,undefined);return true;});
  }
  const actor=await readHostedActor({operator:{secret:f(1),salt:f(2),signingKey:f(3)}});assert.equal(String(actor.secret),f(1));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('captured conversation guard runs after reservation and current policy before each paid call',async()=>{
 const x=fixture();let captures=0,guards=0;
 x.args.conversation={load:async()=>{captures++;return {assertCurrent:async()=>{guards++;assert(x.events.includes('reserve'));assert(x.row.reserved>0n);}};}};
 const run=x.args.runAgent;x.args.runAgent=async input=>{await input.conversation.load({postId:input.postId});return run(input);};
 await x.run();assert.equal(captures,1);assert.equal(guards,1);assert.equal(x.events.filter(x=>x==='paid').length,1);
 assert(!JSON.stringify(x.store.read()).includes('assertCurrent'));
});
test('history change during reservation fences provider without loading replacement context',async()=>{
 const x=fixture();let changed=false,captures=0;const reserve=x.args.escrow.reserve;
 x.args.escrow.reserve=async(...args)=>{await reserve(...args);changed=true;};
 x.args.conversation={load:async()=>{captures++;return {assertCurrent:async()=>assert(!changed,'Original history changed')};}};
 const run=x.args.runAgent;x.args.runAgent=async input=>{await input.conversation.load({postId:input.postId});return run(input);};
 await assert.rejects(x.run(),/unknown/);assert.equal(captures,1);assert(!x.events.includes('paid'));assert.equal(x.row.reserved,110n);
 await assert.rejects(x.run(),/unresolved/);assert.equal(captures,1);
});
test('conversation enabled request cannot execute provider without actual capture',async()=>{
 const x=fixture();x.args.conversation={load:()=>assert.fail('Must not silently load')};
 await assert.rejects(x.run(),/unknown/);assert(!x.events.includes('paid'));
});
test('production hosted projection selects finalized while development stays checkpointed',async()=>{
 const {hostedIndexNode}=await import('../main.mjs');const calls=[];
 const node={getBlockData:async n=>{calls.push(n);return n;},getNodeInfo(){assert.equal(this,node);return 'same';}};
 const production=hostedIndexNode(node,false),development=hostedIndexNode(node,true);
 await production.getBlockData('checkpointed');await production.getBlockData(12);await development.getBlockData('checkpointed');
 assert.deepEqual(calls,['finalized',12,'checkpointed']);assert.equal(production.getNodeInfo(),'same');
});
test('actual agent uses the same guarded metering for prior-history summary and current answer',async()=>{
 const {createAgent}=await import('../agent.mjs');const {bokRunner}=await import('../bok.mjs');
 const x=fixture(),inputs=[];let captured=0,guards=0,closed=0;
 const quote=x.args.provider.quote;x.args.provider.quote=async input=>{inputs.push(structuredClone(input));return quote(input);};
 x.args.conversation={load:async()=>{captured++;return {canonical:true,complete:true,threadId:f(9),
  messages:[{id:f(9),role:'user',text:'prior request'},{id:f(10),role:'assistant',text:'prior Bok result'},
   {id:x.args.request.postId,role:'user',text:x.current.text}],assertCurrent:async()=>{guards++;assert(x.row.reserved>0n);}};}};
 const toolbox={open:async()=>({definitions:[],close:async()=>{closed++;}})};
 x.args.runAgent=({model,conversation,...input})=>bokRunner({runner:createAgent({model,conversation,toolbox,summaryModelId:'cheap-summary',
  summaryTokens:10,maxTokens:10,maxCalls:3,instructions:'Test only'})}).run(input);
 await x.run();assert.equal(captured,1);assert.equal(guards,2);assert.equal(closed,1);
 assert.deepEqual(x.events,['reserve','paid','settle','reserve','paid','settle','publish_reply','finish']);
 assert.equal(inputs[0].modelId,'cheap-summary');assert(!inputs[0].messages.at(-1).content.includes(x.current.text));
 assert(inputs[1].messages.some(m=>m.content.includes('Prior conversation summary')));
 assert.equal(inputs[1].messages.at(-1).content,x.current.text);
 assert(!JSON.stringify(inputs).includes('assertCurrent'));assert.equal(x.row.charged,12n);
});

// Real retained filesystem; canonical board and chain effects remain labelled controls.
async function recoveryFixture(){
 const x=fixture(),scope={chainId:'31337',rollupVersion:'1',rollupAddress:'public',receiver:f(5)},directory=await fs.mkdtemp(path.join(os.tmpdir(),'bok-recovery-discovery-'));
 x.current.threadId=f(9);let held=true;
 const lease={assertHeld:async()=>assert(held,'Lost lease')};
 const id=createHash('sha256').update(JSON.stringify({scope,requestId:x.args.request.requestId,target:x.args.request.target})).digest('hex');
 const file=path.join(directory,id+'.json');
 const scan=hostedRecoveryScanner({directory,scope,pluginId:f(4),board:x.args.board,lease});
 const save=()=>fs.writeFile(file,JSON.stringify(x.store.read()),{mode:0o600});
 return {...x,directory,file,scan,save,loseLease:()=>{held=false;},close:async()=>{await scan.close();await fs.rm(directory,{recursive:true,force:true});}};
}
test('hosted recovery discovers replied pending finish outside the public pending feed',async()=>{
 const x=await recoveryFixture();let server;
 try{
  const finish=x.args.escrow.finish;let pending=true;
  x.args.escrow.finish=async(...args)=>{await finish(...args);};
  const inspect=x.args.escrow.inspectOperation;
  x.args.escrow.inspectOperation=async id=>{const result=await inspect(id);return pending&&result?.method==='finish'?{status:'pending'}:result;};
  await assert.rejects(x.run(),/unresolved/);assert.equal(x.current.replied,true);await x.save();
  x.args.board.pending=async()=>({requests:[],nextCursor:null});pending=false;
  let done;const completed=new Promise(resolve=>{done=resolve;});const errors=[];
  server=await startEscrowService({descriptor:{},profile:'rolling',board:x.args.board,recoverPending:x.scan,port:0,pollMs:20,onError:error=>errors.push(error),run:async request=>{assert.equal(request.threadId,f(9));await x.run();await x.save();done();}});
  await Promise.race([completed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Recovery not discovered')),2000);timer.unref();})]);
  assert.deepEqual(errors,[]);assert.equal(x.store.read().hostedPrivateBok.phase,'finished');assert.equal(x.row.charged,6n);assert.equal(x.row.refunded,994n);
  assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
 }finally{await server?.close();await x.close();}
});
test('hosted recovery skips finished and uncertain paid-call journals',async()=>{
 const x=await recoveryFixture();try{
  await x.run();await x.save();assert.deepEqual(await x.scan(),[]);
  x.store.read().hostedPrivateBok.phase='running';await x.save();assert.deepEqual(await x.scan(),[]);
 }finally{await x.close();}
});
test('hosted recovery rejects scope and canonical request drift before dispatch',async()=>{
 for(const invalid of ['scope','filename','canonical','lease']){
  const x=await recoveryFixture();try{
   await x.run();x.store.read().hostedPrivateBok.phase='reply-confirmed';
   if(invalid==='scope')x.store.read().hostedPrivateBok.binding.escrow=f(99);await x.save();
   if(invalid==='filename')await fs.rename(x.file,path.join(x.directory,'a'.repeat(64)+'.json'));
   if(invalid==='canonical')x.current.target=f(99);if(invalid==='lease')x.loseLease();
   await assert.rejects(x.scan());
  }finally{await x.close();}
 }
});
test('hosted recovery rejects symlink, FIFO and malformed journals without private parser output',async()=>{
 for(const invalid of ['symlink','fifo','json']){
  const x=await recoveryFixture();try{
   if(invalid==='symlink')await fs.symlink('/dev/null',x.file);else if(invalid==='fifo')execFileSync('mkfifo',[x.file]);else await fs.writeFile(x.file,'PRIVATE-STATE-SENTINEL');
   await assert.rejects(x.scan(),error=>error.message==='Invalid hosted recovery journal');
  }finally{await x.close();}
 }
});

// Controlled frozen-port shape matches createPrivateBokEscrow; no chain/provider calls.
test('hosted frozen escrow port preserves metadata and method receivers through the wallet lane',async()=>{
 const identity=Object.freeze({escrow:f(90)}),mode=Object.freeze({proofMode:'disabled'}),calls=[];
 const methods=['request','assertUsable','inspectOperation','reserve','settle','close_uncertain','reconcile','finish','publish_reply'];
 const raw=Object.freeze({identity,mode,...Object.fromEntries(methods.map(method=>[method,function(...args){assert.equal(this,raw);calls.push({method,args});return method;}]))});
 let queued=0;const port=serializeHostedEscrow(raw,async fn=>{queued++;return fn();});
 assert.equal(port.identity,identity);assert.equal(port.mode,mode);
 for(const method of methods){assert.equal(port[method],port[method]);assert.equal(await port[method](1,'public'),method);}
 assert.equal(queued,methods.length);assert.deepEqual(calls,methods.map(method=>({method,args:[1,'public']})));assert(Object.isFrozen(port));
});
test('hosted frozen escrow ports share serialization and preserve the first exact rejected operation',async()=>{
 let tail=Promise.resolve(),active=0,maximum=0;const failure=Error('controlled operation failure'),events=[];
 const lane=fn=>{const value=tail.then(fn);tail=value.catch(()=>{});return value;};
 const make=label=>serializeHostedEscrow(Object.freeze({request:async reject=>{active++;maximum=Math.max(maximum,active);events.push(label);try{await new Promise(resolve=>setImmediate(resolve));if(reject)throw failure;return label;}finally{active--;}}}),lane);
 const one=make('one'),two=make('two');const values=await Promise.allSettled([one.request(true),two.request(false),one.request(false)]);
 assert.equal(values[0].reason,failure);assert.equal(values[1].value,'two');assert.equal(values[2].value,'one');assert.equal(maximum,1);assert.equal(active,0);assert.deepEqual(events,['one','two','one']);
});
test('hosted request reaches existing reserve paid settle reply and finish through the frozen escrow wrapper',async()=>{
 const x=fixture();let queued=0;x.args.escrow=serializeHostedEscrow(Object.freeze(x.args.escrow),async fn=>{queued++;return fn();});
 const result=await x.run();assert.equal(result.status,'finished');assert(queued>0);assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);
});

test('operator-connected source and artifacts never enter static publication or default mirror',async()=>{
 const receipt={connection:{threadId:f(1)},acceptedRevision:'a'.repeat(40)},result={connected:true,url:'https://github.com/owner/existing/pull/1'};
 const publication={publish:async()=>assert.fail('Private source must not be published')},mirror={sync:async()=>assert.fail('Private source must not be mirrored as a new thread'),syncConnected:async input=>{assert.equal(input,receipt);return result;}};
 assert.equal(await publishAcceptedRevision({publication,mirror,receipt}),result);await assert.rejects(publishAcceptedRevision({publication,receipt}),/broker unavailable/);
});

import {createAgent} from '../agent.mjs';
import {bokRunner} from '../bok.mjs';
test('truncated paid completion publishes explicit failure and finishes genuine accounting without accepting an app',async()=>{
 const x=fixture(),execute=x.args.provider.execute;let tools=0,accepts=0,closed=0;
 x.args.provider.execute=async(...args)=>({...await execute(...args),finishReason:'length'});
 const toolbox={open:async()=>({definitions:[],call:async()=>{tools++;},accept:async()=>{accepts++;},close:async()=>{closed++;}})};
 x.args.runAgent=async({model,text})=>bokRunner({runner:createAgent({model,maxTokens:10,instructions:'Help',toolbox})}).run({text,id:'fixture',postId:x.args.request.postId});
 assert.deepEqual(await x.run(),{status:'finished',replayed:false});
 assert.deepEqual(x.events,['reserve','paid','settle','publish_reply','finish']);assert.deepEqual({tools,accepts,closed},{tools:0,accepts:0,closed:1});
 assert.equal(x.row.charged,6n);assert.equal(x.row.refunded,994n);assert.equal(x.row.reserved,0n);
 const saved=x.store.read();assert.match(unpackText(saved.hostedPrivateBok.args[2],saved.hostedPrivateBok.args[3]),/output limit.*incomplete/);assert.equal(saved.privateBok.calls[0].finishReason,'length');
 await x.run();assert.equal(x.events.filter(event=>event==='paid').length,1);
});

// Controlled actual billing protocol: terminal admission cannot mutate or call a provider.
test('terminal no-reply admission authenticates original limits and canonical settlement read-only',async()=>{
 const x=await unknownBillingFixture();await x.recover();const before=structuredClone(x.store.read()),events=[...x.events];let reads=0;
 const escrow={identity:x.args.escrow.identity,request:async id=>{reads++;return x.args.escrow.request(id);}};
 assert.equal(before.privateBok.limits.maxTokens,1500);
 assert.equal(await isHostedTerminalWithoutReply({request:x.args.request,store:x.store,escrow,anchor:{number:7,hash:f(77)}}),true);
 assert.equal(reads,1);assert.deepEqual(x.store.read(),before);assert.deepEqual(x.events,events);
});
for(const change of ['phase','finished','call','receipt','charge','budget','state','reserved','target','plugin','limits','sequence'])test('terminal no-reply admission refuses changed '+change,async()=>{
 const x=await unknownBillingFixture();await x.recover();const saved=x.store.read();
 if(change==='phase')saved.hostedPrivateBok.phase='running';
 if(change==='finished')saved.privateBok.finished=false;
 if(change==='call')saved.privateBok.calls[0].phase='fenced';
 if(change==='receipt')x.row.receipt=f(89);
 if(change==='charge'){x.row.charged++;x.row.refunded--;}
 if(change==='budget'){x.row.budget++;x.row.refunded++;}
 if(change==='state')x.row.state=3;
 if(change==='reserved'){x.row.reserved=1n;x.row.refunded--;}
 if(change==='target')saved.hostedPrivateBok.binding.target=f(99);
 if(change==='plugin')saved.hostedPrivateBok.binding.pluginId=f(99);
 if(change==='limits')saved.privateBok.limits.maxReservation='1';
 if(change==='sequence')x.row.sequence++;
 const events=[...x.events],before=structuredClone(saved),run=()=>isHostedTerminalWithoutReply({request:x.args.request,store:x.store,escrow:x.args.escrow,anchor:{number:7,hash:f(77)}});
 if(change==='phase')assert.equal(await run(),false);else await assert.rejects(run());
 assert.deepEqual(x.store.read(),before);assert.deepEqual(x.events,events);
});
test('bounded predecessor pages skip authenticated terminal history but stop at unknown barriers',async()=>{
 const {rollingPredecessorsClear}=await import('../aztec.mjs');
 const rows=Array.from({length:70},(_,i)=>({postId:String(i+1),threadId:'1',order:String(i),requestId:String(i+1),target:'8',pluginId:'4',adapter:'9'}));
 const request={postId:f(99),threadId:f(1),order:'100',pluginId:f(4),adapter:f(9)};let revision='one',calls=0,barrier=69;
 const index={scanPendingPredecessors(id,{after,limit}){assert.equal(id,'99');assert(limit<=64);const remaining=rows.filter(r=>after===null||BigInt(r.order)>BigInt(after));return {rows:remaining.slice(0,limit),nextAfter:remaining.length>limit?remaining[limit-1].order:null,revision};}};
 const isTerminal=async row=>{calls++;return Number(row.order)!==barrier;};
 assert.equal(await rollingPredecessorsClear({index,request,isTerminal}),false);assert.equal(calls,70);
 barrier=-1;calls=0;assert.equal(await rollingPredecessorsClear({index,request,isTerminal}),true);assert.equal(calls,70);
 await assert.rejects(rollingPredecessorsClear({index,request,isTerminal:async()=>{revision='changed';return true;}}),/publication changed/);
 revision='one';calls=0;await assert.rejects(rollingPredecessorsClear({index,request,timeoutMs:5,isTerminal:async()=>{calls++;await new Promise(r=>setTimeout(r,15));return true;}}),/unavailable: deadline/);
 await new Promise(r=>setTimeout(r,20));assert.equal(calls,1,'timed-out read cannot start further predecessor work');
 rows[0].pluginId='5';await assert.rejects(rollingPredecessorsClear({index,request,isTerminal}));
});

test('timed-out predecessor read retains sole ownership until it settles',async()=>{
 const {rollingPredecessorsClear}=await import('../aztec.mjs');let release,calls=0;const admission={};
 const row={postId:'1',threadId:'1',order:'0',requestId:'1',target:'8',pluginId:'4',adapter:'9'},request={postId:f(99),threadId:f(1),order:'100',pluginId:f(4),adapter:f(9)};
 const index={scanPendingPredecessors:()=>({rows:[row],nextAfter:null,revision:'one'})};
 const isTerminal=()=>{calls++;return new Promise(resolve=>{release=resolve;});};
 await assert.rejects(rollingPredecessorsClear({index,request,isTerminal,admission,timeoutMs:5}),/deadline/);
 for(let n=0;n<3;n++)await assert.rejects(rollingPredecessorsClear({index,request,isTerminal,admission,timeoutMs:5}),/prior read pending/);
 assert.equal(calls,1);release(true);await new Promise(r=>setImmediate(r));assert.equal(admission.pending,null);
 assert.equal(await rollingPredecessorsClear({index,request,isTerminal:async()=>true,admission}),true);
});

test('saved reply recovery remains dispatchable after moderation or plugin disable',async()=>{
 const x=fixture();x.control.unknownReply=true;await assert.rejects(x.run(),/unresolved/);
 assert.equal(x.store.read().hostedPrivateBok.phase,'reply-intent');x.control.unknownReply=false;x.current.usable=false;x.current.predecessorsClear=true;
 const events=[...x.events];x.args.board.pending=async()=>({requests:[],nextCursor:null});
 const server=await startEscrowService({descriptor:{},profile:'rolling',board:x.args.board,recoverPending:async()=>x.store.read().hostedPrivateBok.phase==='finished'?[]:[{...x.args.request,threadId:f(9)}],run:()=>x.run(),port:0,pollMs:5,onError:e=>assert.fail(e)});
 try{const end=Date.now()+300;while(x.store.read().hostedPrivateBok.phase!=='finished'&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.equal(x.store.read().hostedPrivateBok.phase,'finished');assert.deepEqual(x.events,[...events,'finish']);assert.equal(x.row.refunded,994n);}finally{await server.close();}
});
test('service shutdown drains timed-out owned predecessor reads before closing',async()=>{
 const {rollingPredecessorsClear}=await import('../aztec.mjs');const admission={};let release,failed=0,reads=0,closed=false;
 const row={postId:'1',threadId:'1',order:'0',requestId:'1',target:'8',pluginId:'4',adapter:'9'},request={postId:f(99),threadId:f(1),order:'100',pluginId:f(4),adapter:f(9)};
 const index={scanPendingPredecessors:()=>{reads++;return {rows:[row],nextAfter:null,revision:'one'};}};
 const board={pending:async()=>{await rollingPredecessorsClear({index,request,admission,timeoutMs:5,isTerminal:()=>new Promise(r=>release=r)});return {requests:[],nextCursor:null};},close:async()=>{await admission.pending?.catch(()=>{});}};
 const server=await startEscrowService({descriptor:{},profile:'rolling',board,run:async()=>assert.fail('No dispatch'),port:0,pollMs:50,onError:()=>failed++});
 while(!failed)await new Promise(r=>setTimeout(r,2));const closing=server.close().then(()=>closed=true);
 try{await new Promise(r=>setTimeout(r,10));assert.equal(closed,false,'Shutdown retains resources until owned read ends');}finally{release(true);await closing;}
 const count=reads;await new Promise(r=>setTimeout(r,10));assert.equal(reads,count);
});

for(const development of [true,false])test('terminal node pins '+(development?'checkpointed':'finalized')+' reads and retains original canonical rechecks',async()=>{
 const anchor={number:7,hash:f(77)},calls=[];let hash=anchor.hash;
 const node={getBlock:async function(selector){assert.equal(this,node);calls.push(selector);return {number:typeof selector==='number'?selector:9,hash:selector===7?hash:f(99)};},getNodeInfo(){assert.equal(this,node);return 'original';}};
 const port=hostedTerminalNode(node,anchor,development),selector=development?'checkpointed':'finalized';
 assert.equal((await port.getBlock(selector)).number,7);assert.equal((await port.getBlock(selector)).hash,f(77));
 assert.equal(port.getNodeInfo(),'original');assert.deepEqual(calls,[7,7],'newer tip never supplies a terminal exemption');
 hash=f(88);await assert.rejects(port.getBlock(selector),/checkpoint changed/);
 assert.equal((await port.getBlock(7)).hash,f(88),'numbered canonical recheck remains authoritative');
});
test('terminal accounting from a different checkpoint cannot exempt a predecessor',async()=>{
 const x=await unknownBillingFixture();await x.recover();const before=structuredClone(x.store.read());
 await assert.rejects(isHostedTerminalWithoutReply({request:x.args.request,store:x.store,escrow:x.args.escrow,anchor:{number:8,hash:f(88)}}),/checkpoint changed/);
 assert.deepEqual(x.store.read(),before);
});
