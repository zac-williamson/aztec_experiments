// DEVELOPMENT UNIT FIXTURES. No actual chain/proof/browser acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertRollingSocialWireProofJobs,settleRollingRootOverlap,rollingTrustedProofThreads,countRollingColdPhysicalPages,createRollingColdPhysicalPageOracle,runRollingPublicRecoveryChecks,persistRollingRecoveryObservation,observeRollingColdRead,assertRollingBrowserCompactAcceptance,createRollingEvidenceDirectory,classifyRollingApplicationFootprint,recordRollingFundingFailure,assertRollingApplicationViews,assertRollingPublicFootprint,closeRollingResources,loadRollingFixtureSDK,observeRollingReadiness} from './rolling-application-fixture.mjs';
import {createRollingProjection} from '../../shared/rolling/public-projection.mjs';
import {createFileJournalStorage} from '../../apps/src/billboard/user/transaction-journal-store.mjs';
import {createEncryptedJournalSlot} from '../../shared/journal-record.mjs';
const ids={nameId:'2',subboardId:'3',rootId:'4',replyId:'5'};
const fields=(s,n)=>{const bytes=Buffer.from(s);return Array.from({length:n},(_,i)=>{const part=Buffer.alloc(31);bytes.subarray(i*31,(i+1)*31).copy(part);return BigInt('0x'+part.toString('hex')).toString();});};
function projectionFixture(change=()=>{}) {
  const events=[
    ['MainPolicyPublished',{version:'1',rules:fields('No threats.',32),length:'11'}],
    ['NameRegistered',{name_id:'2',first:fields('River',2),first_length:'5',last:fields('Stone',2),last_length:'5'}],
    ['SubboardCreated',{subboard_id:'3',main_policy_version:'1',slug:fields('application-test',2),slug_length:'16',name:fields('Application test',3),name_length:'16',description:fields('Real application acceptance',16),description_length:'27',rules:fields('Be helpful.',32),rules_length:'11'}],
    ['PostPublished',{id:'4',record:{name_id:'2',subboard:'3',parent:'0',root:'4',kind:'1',reference:'0'},main_policy_version:'1',local_policy_version:'1',message:fields('A real application root',32),length:'23',timestamp:'1'}],
    ['PostPublished',{id:'5',record:{name_id:'2',subboard:'3',parent:'4',root:'4',kind:'1',reference:'0'},main_policy_version:'1',local_policy_version:'1',message:fields('A real application reply',32),length:'24',timestamp:'2'}],
    ['LikeChanged',{post:'5',tag:'6',active:true,count:'1'}],
  ].map(([type,payload],i)=>({type,payload,scope:{unitFixture:true},position:{blockNumber:String(i+1),blockHash:'mock-'+i,txHash:'mock-'+i,txIndexWithinBlock:'0',logIndexWithinTx:'0'}}));
  change(events);
  // Deliberately NOT the SDK authenticated decoder: pure projection fixture.
  const projection=createRollingProjection({isValidatedEvent:e=>events.includes(e)});
  for(const event of events)projection.stage([event]).apply();
  return projection;
}
test('labelled projection fixture checks all five resulting views and bounded pages',()=>{
  const actual=assertRollingApplicationViews(projectionFixture(),ids);assert.equal(actual.thread.posts.length,2);assert.equal(actual.feed.posts[0].id,'5');
});
test('actual pure projection refuses wrong thread root before view acceptance',()=>{
  assert.throws(()=>projectionFixture(events=>events[4].payload.record.root='9'));
});
test('view acceptance rejects changed content, name, like total and bot impersonation',()=>{
  assert.throws(()=>assertRollingApplicationViews(projectionFixture(events=>events[4].payload.message=fields('X real application reply',32)),ids));
  assert.throws(()=>assertRollingApplicationViews(projectionFixture(),{...ids,nameId:'77'}));
  assert.throws(()=>projectionFixture(events=>events[5].payload.count='2'));
  assert.throws(()=>projectionFixture(events=>{events[4].payload.record.kind='4';events[4].payload.record.name_id='0';}));
});
function footprint(){return {sharedFeePayer:true,counts:{publicDataWrites:63},rolePresence:Object.fromEntries(['feePayer','publicCallSenders','publicCallTargets','publicCallCalldata','publicWriteSlots','publicWriteValues','publicLogContracts','publicLogFields'].map(k=>[k,{author:false}]))};}
test('public acceptance rejects each human-address category and excess writes',()=>{
  assertRollingPublicFootprint(footprint());
  for(const key of Object.keys(footprint().rolePresence)){const f=footprint();f.rolePresence[key].author=true;assert.throws(()=>assertRollingPublicFootprint(f));}
  const f=footprint();f.counts.publicDataWrites=64;assert.throws(()=>assertRollingPublicFootprint(f));
  f.counts.publicDataWrites=1;f.sharedFeePayer=false;assert.throws(()=>assertRollingPublicFootprint(f));
});
test('cleanup attempts every owner even after prior failure and preserves failure identity',async()=>{
  const seen=[],state={},error=new Error('labelled fixture failure');
  await assert.rejects(closeRollingResources([['pxe',async()=>{seen.push('pxe');throw error;}],['service',async()=>seen.push('service')],['rpc',async()=>seen.push('rpc')]],state),e=>e instanceof AggregateError&&e.errors[0]===error);
  assert.deepEqual(seen,['pxe','service','rpc']);assert.deepEqual(state,{pxe:false,service:true,rpc:true});
});
test('real file storage encrypts prepared operation, reopens and rejects ciphertext tampering',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-journal-unit-'));
  try{
    const options={walletSecret:'0x'+'0'.repeat(63)+'1',walletSalt:'2',scopeText:'labelled unit private workflow',keyDomain:'ROLLING_WORKFLOW_V1'};
    const first=await createEncryptedJournalSlot({...options,storage:createFileJournalStorage(directory)});
    const value={status:'prepared',privateMarker:'UNIT_PRIVATE_INTENT',nonce:'7'};
    await first.write(await first.read(),value);
    const storage=createFileJournalStorage(directory),keys=await storage.keys();assert.equal(keys.length,1);
    const ciphertext=await storage.read(keys[0]);assert(!ciphertext.includes(value.privateMarker));assert(!ciphertext.includes(options.walletSecret));
    const reopened=await createEncryptedJournalSlot({...options,storage});assert.deepEqual((await reopened.read()).value,value);
    const wrong=await createEncryptedJournalSlot({...options,walletSalt:'3',storage});await assert.rejects(wrong.read(),{code:'BB_JOURNAL_INVALID'});
    const data=JSON.parse(ciphertext);data.data=(data.data[0]==='0'?'1':'0')+data.data.slice(1);await storage.compareAndSwap(keys[0],ciphertext,JSON.stringify(data));
    await assert.rejects(reopened.read(),{code:'BB_JOURNAL_INVALID'});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('native fixture facade imports genuine shared factories and rejects unconstructed wallet/PXE brands',async()=>{
  const sdk=await loadRollingFixtureSDK(),privatePXE=await import('../../shared/private-pxe.mjs'),trusted=await import('../../shared/trusted-private-node.mjs');
  assert.equal(sdk.createPXE,privatePXE.createPXE);assert.equal(sdk.isPrivatePXEForNode,privatePXE.isPrivatePXEForNode);
  assert.equal(sdk.createTrustedPrivateNode,trusted.createTrustedPrivateNode);assert.equal(sdk.isTrustedPrivateNode({}),false);
  assert.equal(sdk.isPrivatePXEForNode({node:{}},{}),false);
  await import('../../apps/src/billboard/user/engine.js');assert.equal(globalThis.BillboardPrivateFeeRouting.isPrivateWalletForNode({aztecNode:{}},{}),false);
});
test('fixture uses sole real journal send path, five actions and canonical decoder rebuild',async()=>{
  const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
  assert.equal((source.match(/await withC01ClientMining\(/g)||[]).length,4); // Separate awaited recovery scopes after the original miner stops.
  assert(source.includes('assert(report.applicationMining.clientMining.stopped&&report.applicationMining.clientMining.passed&&report.applicationMining.clientMining.autominingRestored)'));
  assert(source.includes('if(recovery){await completeTrustedRecovery();'));
  assert(source.indexOf('report.setupMining.clientMining.stopped,true')<source.indexOf("await mark('real-wall-clock-readiness')"));
  assert(source.indexOf("await mark('real-wall-clock-readiness')")<source.indexOf('observation:report.applicationMining'));
  assert.equal((source.match(/await prepareW01PrivateFees\(/g)||[]).length,2);
  assert(source.includes("if(multi){fundingRole='b';feesB=await prepareW01PrivateFees"));
  assert(source.includes("assert(!feesB.authorAccount.address.equals(owner))"));
  for(const type of ['name','subboard','post','reply','like'])assert(source.includes(`await action({type:'${type}'`));
  assert(source.includes('app.submitPrepared(prepared.intentId)'));assert(source.includes('actor.application.reconcile(actorIntents.get(actor))'));
  assert(source.includes('for(const hash of hashes)rebuilt.stage(await decoder.decodeTransaction(ctx.node,hash)).apply()'));
  assert(!source.includes('setTime('));assert(!source.includes('nowSeconds:'));assert(!source.includes('runPrivateBokFixture('));
  assert(source.includes('proofsEnabled:real,allowLocalDev:true'));
  assert(source.includes("observation:report.applicationMining,mode:'real-wall',deadlineAt:ctx.applicationDeadlineAt"));
  for(const phase of ['node-rpc-startup','trusted-service-startup','trusted-client-construction','application-pxe'])assert(source.includes("mark('"+phase+"')"));
  assert(source.includes('assert.equal(info.l1ChainId,31337);assert.equal(info.realProofs,real)'));
  assert(source.includes("proofs:real?'real':'disabled'"));
  assert(!source.includes('allowLocalDev:!real'));
  assert(source.includes('proverJobs.completed,5'));assert(source.includes('rollingApplicationObservation=report'));
});

// These injected nodes/inspectors are diagnostic-only unit fixtures, not SDK acceptance.
test('public readiness observations retain actual wall/lag and fixed reason, omit arbitrary error fields',async()=>{
  const secret='UNIT_SECRET_NOT_FOR_EVIDENCE',node={getSyncedL1Timestamp:async()=>BigInt(Math.floor(Date.now()/1000)+5)};
  const before=Math.floor(Date.now()/1000);let seen;
  const row=await observeRollingReadiness({node,network:{chainId:'31337'},proofsEnabled:true},async(n,options)=>{assert.equal(n,node);seen=options;throw Object.assign(Error(secret),{code:'BB_TRUSTED_NODE_STALE',cause:secret});});
  assert(row.wallSeconds>=before);assert(row.lagSeconds<0);assert.equal(row.inspectorCode,'BB_TRUSTED_NODE_STALE');
  assert.equal(seen.nowSeconds,undefined);assert.equal(seen.maxLagSeconds,undefined);assert.equal(seen.proofsEnabled,true);
  assert(!JSON.stringify(row).includes(secret));
  const absent=await observeRollingReadiness({node:{getSyncedL1Timestamp:async()=>{throw Error(secret);}},network:{}},async()=>{throw Object.assign(Error(secret),{code:secret});});
  assert.equal(absent.timestampAvailable,false);assert.equal(absent.inspectorCode,'UNCLASSIFIED');assert(!JSON.stringify(absent).includes(secret));
});
test('readiness diagnostics do not project arbitrary inspector outputs or accept nonlocal health URLs',async()=>{
  const row=await observeRollingReadiness({node:{getSyncedL1Timestamp:async()=>1n},network:{},endpoint:'https://example.invalid'},async()=>({private:'UNIT_SECRET'}));
  assert.equal(row.inspectorCode,'READY');assert.equal(row.healthUnavailable,true);assert(!JSON.stringify(row).includes('UNIT_SECRET'));
});

test('labelled local HTTP health fixture projects only public flags and bounds response size',async()=>{
  const secret='UNIT_PRIVATE_NEVER_PERSIST';let oversized=false;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(oversized?{extra:secret.repeat(2000)}:{ready:true,proofs:'real',query:{enabled:true,ready:false,reason:'unavailable',secret},private:secret}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const input={node:{getSyncedL1Timestamp:async()=>1n},network:{},endpoint:`http://127.0.0.1:${server.address().port}`};
    const row=await observeRollingReadiness(input,async()=>{});
    assert.deepEqual(row.health,{status:200,ready:true,proofs:'real',queryEnabled:true,queryReady:false,queryReason:'unavailable'});
    assert(!JSON.stringify(row).includes(secret));oversized=true;
    const bounded=await observeRollingReadiness(input,async()=>{});assert.equal(bounded.healthUnavailable,true);assert(!JSON.stringify(bounded).includes(secret));
  }finally{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
});

test('native loader cleanup remains after PXE and prover owners, including their failures',async()=>{
  const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
  assert(source.indexOf('nativeArtifacts=installRollingNativeArtifacts()')<source.indexOf('const sdkModule=await loadRollingFixtureSDK()'));
  assert(source.includes("'scripts/testing/rolling-native-artifacts.mjs'"));
  assert(source.indexOf("['applicationActorA'")<source.indexOf("['nativeArtifactLoader'"));
  assert(source.indexOf("['proverAndQuery'")<source.indexOf("['nativeArtifactLoader'"));
  assert(source.includes('nativeArtifacts.verify();report.nativeArtifacts=nativeArtifacts.observation()'));
  const {installRollingNativeArtifacts}=await import('./rolling-native-artifacts.mjs'),adapter=installRollingNativeArtifacts();
  const sentinel=Error('labelled PXE cleanup failure'),observation={};
  await assert.rejects(closeRollingResources([['pxe',async()=>{throw sentinel;}],['nativeArtifacts',()=>adapter.close()]],observation),e=>e.errors[0]===sentinel);
  assert.equal(adapter.observation().closed,true);assert.equal(observation.nativeArtifacts,true);
});

// Fault-injected public funding evidence; no actual payment in this unit test.
test('second actor paid setup failure retains first funding history and all cleanup attempts',async()=>{
 const paidA={funding:{l1TxHash:'synthetic-paid-a'},passed:true},paidB={funding:{l1TxHash:'synthetic-paid-b'},walletCleanup:'closed',passed:false};
 const report={privateFees:paidA,cleanup:{}};recordRollingFundingFailure(report,'b',paidB);
 assert.equal(report.privateFees,paidA);assert.equal(report.secondPrivateFees,paidB);assert.equal(report.fundingFailure.observation,paidB);
 const seen=[];await closeRollingResources([['fundingWallet',async()=>seen.push('a')],['remainingService',async()=>seen.push('service')]],report.cleanup);
 assert.deepEqual(seen,['a','service']);assert.deepEqual(report.cleanup,{fundingWallet:true,remainingService:true});
 const later={passed:false};recordRollingFundingFailure(report,undefined,later);assert.equal(report.privateFees,paidA);assert.equal(report.secondPrivateFees,paidB);
});

test('actual SDK footprint composition uses both supported human roles',async()=>{
 const {Tx,TxEffect,HashedValues}=await import('@aztec-labs/stdlib/tx');
 const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
 const tx=Tx.random(),effect=TxEffect.empty(),owner=AztecAddress.fromBigIntUnsafe(101n),otherOwner=AztecAddress.fromBigIntUnsafe(102n),payer=AztecAddress.fromBigIntUnsafe(202n),board=AztecAddress.fromBigIntUnsafe(303n);
 effect.txHash=tx.getTxHash();tx.data.feePayer=payer;
 tx.publicFunctionCalldata.push(new HashedValues([owner.toField(),otherOwner.toField()],new Fr(600)));
 const result=classifyRollingApplicationFootprint({tx,effect,owner,otherOwner,payer,board});
 assert.equal(result.sharedFeePayer,true);assert.equal(result.rolePresence.publicCallCalldata.author,true);assert.equal(result.rolePresence.publicCallCalldata.otherAuthor,true);
 for(const key of ['author','otherAuthor'])assert.equal(result.rolePresence.feePayer[key],false);
});

import {rollingClockDeadline} from './rolling-application-fixture.mjs';
test('measured fixture catchup covers the observed 111-second lead without changing the campaign limit',()=>{
 const now=1791761013786,target=1791761124n,end=now+350000;
 assert.equal(rollingClockDeadline({now,chainSeconds:target,campaignDeadlineAt:end}),1791761126000);
 assert(rollingClockDeadline({now,chainSeconds:target,campaignDeadlineAt:end})<=end-180000);
 assert.equal(rollingClockDeadline({now,chainSeconds:BigInt(Math.floor(now/1000)-1),campaignDeadlineAt:end}),now+2000);
 assert.throws(()=>rollingClockDeadline({now,chainSeconds:target,campaignDeadlineAt:now+290000}),/Insufficient campaign budget/);
 assert.throws(()=>rollingClockDeadline({now,chainSeconds:2n**100n,campaignDeadlineAt:end}));
});

test('actual loopback upstream fault seam rejects before forwarding and restores the same listener',async()=>{
  const {startNodeRpc}=await import('./rolling-application-fixture.mjs');
  let calls=0;const node={getBlockNumber:async()=>{calls++;return 7;},getContract:async()=>{calls++;return undefined;}};
  const rpc=await startNodeRpc(node,()=>{throw Error('Unexpected transaction');},{faults:true});
  const request=async(method,params=[])=>{const r=await fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'aztec_'+method,params})});return {status:r.status,text:await r.text()};};
  try{
    assert.equal(JSON.parse((await request('getBlockNumber')).text).result,7);assert.equal(calls,1);
    rpc.setFault('unavailable');assert.equal((await request('getBlockNumber')).status,503);assert.equal(calls,1);
    assert.equal(rpc.snapshot().unavailableRequests,1);assert.equal(rpc.snapshot().forwarded.getBlockNumber,1);
    rpc.setFault('healthy');assert.equal(JSON.parse((await request('getBlockNumber')).text).result,7);assert.equal(calls,2);
    rpc.setFault('personalized-once');const address='0x'+'1'.padStart(64,'0');
    const denied=await request('getContract',[address]);assert.equal(denied.status,400);assert(JSON.parse(denied.text).error);assert.equal(calls,2);
    assert.equal(rpc.snapshot().personalizedDenied,1);assert.equal(rpc.snapshot().forwarded.getContract,undefined);
    assert.equal(JSON.parse((await request('getContract',[address])).text).result,null);assert.equal(calls,3);
    assert.equal(rpc.snapshot().forwarded.getContract,1);assert.throws(()=>rpc.setFault('fallback'));
  }finally{await rpc.close();}
  await assert.rejects(()=>fetch(rpc.url));
});

test('upstream fault control is absent from ordinary fixture listeners',async()=>{
  const {startNodeRpc}=await import('./rolling-application-fixture.mjs');const rpc=await startNodeRpc({});
  try{assert.equal(rpc.setFault,undefined);assert.equal(rpc.snapshot,undefined);}finally{await rpc.close();}
});

function recoveryWireFixture(){
  const labels=['trusted-query','trusted-proof','trusted-upstream','ordinary-node','public-reader'];
  const rows=labels.map(label=>({label,count:1,outcome:'resolved',status:200,phase:'setup',roles:label==='trusted-query'?['a','b']:[]}));
  rows.push({label:'trusted-query',count:2,outcome:'resolved',status:503,phase:'outage',roles:[]});
  for(const label of ['trusted-query','trusted-upstream'])rows.push({label,count:1,outcome:'resolved',status:200,phase:'personalized-denial',roles:['a'],methods:['aztec_getContract']});
  return {requests:9,completed:9,pending:0,unknown:0,unsupported:0,truncated:0,observerErrors:0,privacyAcceptance:'not-evaluated',rows,
    receiver:{errors:0,requests:Object.fromEntries(labels.map(label=>[label,label==='trusted-query'?4:label==='trusted-upstream'?2:1]))}};
}
test('labelled recovery observation accepts only explicit outage503 with complete receiver accounting',async()=>{
 const {assertRollingRecoveryWire}=await import('./rolling-application-fixture.mjs');assert.equal(assertRollingRecoveryWire(recoveryWireFixture(),recoverySemanticFixture()).intentionalRejections,2);
});
for(const mutation of ['ordinary-failure','wrong-phase','missing-receiver','hidden-error','pending','human-public','missing-role','absent-fault','bad-status','rejected-transport'])test('recovery observer refuses '+mutation,async()=>{
 const {assertRollingRecoveryWire}=await import('./rolling-application-fixture.mjs');const value=recoveryWireFixture();
 const bad=value.rows.at(-3);
 if(mutation==='ordinary-failure')bad.label='ordinary-node';
 if(mutation==='wrong-phase')bad.phase='setup';
 if(mutation==='missing-receiver')value.receiver.requests['trusted-query']--;
 if(mutation==='hidden-error')value.observerErrors=1;
 if(mutation==='pending')value.pending=1;
 if(mutation==='human-public')value.rows[3].roles=['a'];
 if(mutation==='missing-role')value.rows[0].roles=['a'];
 if(mutation==='absent-fault')bad.status=200;
 if(mutation==='bad-status')bad.status=500;
 if(mutation==='rejected-transport')bad.outcome='rejected';
 assert.throws(()=>assertRollingRecoveryWire(value,recoverySemanticFixture()));
});

for(const mutation of ['method','phase','count','duplicate','missing'])test('personalized denial accounting refuses '+mutation,async()=>{
 const {assertRollingRecoveryWire}=await import('./rolling-application-fixture.mjs');const value=recoveryWireFixture(),row=value.rows.at(-1);
 if(mutation==='method')row.methods=['aztec_getNotes'];
 if(mutation==='phase')row.phase='setup';
 if(mutation==='count'){row.count=2;value.receiver.requests['trusted-upstream']++;value.requests++;value.completed++;}
 if(mutation==='duplicate'){value.rows.push({...row});value.receiver.requests['trusted-upstream']++;value.requests++;value.completed++;}
 if(mutation==='missing'){value.rows.pop();value.receiver.requests['trusted-upstream']--;value.requests--;value.completed--;}
 assert.throws(()=>assertRollingRecoveryWire(value,recoverySemanticFixture()));
});

function recoverySemanticFixture(){return {passed:true,personalizedDenial:{denied:1,forwarded:0,readiness:{getNodeInfo:1,getSyncedL1Timestamp:1}},afterReadiness:[{kind:'personalized',code:'BB_TRUSTED_NODE_UNAVAILABLE',checks:{failedClosed:true,ciphertextPreserved:true,noProofOrSubmission:true,noPublicFallback:true}}]};}
for(const mutation of ['missing','denied','forwarded','readiness','code','not-failed-closed','duplicate-error','http400','wrong-role','missing-query','duplicate-query'])test('SDK batch denial conjunction refuses '+mutation,async()=>{
 const {assertRollingRecoveryWire}=await import('./rolling-application-fixture.mjs');const wire=recoveryWireFixture(),semantic=recoverySemanticFixture();
 if(mutation==='missing')delete semantic.personalizedDenial;
 if(mutation==='denied')semantic.personalizedDenial.denied=0;
 if(mutation==='forwarded')semantic.personalizedDenial.forwarded=1;
 if(mutation==='readiness')semantic.personalizedDenial.readiness.getSyncedL1Timestamp=0;
 if(mutation==='code')semantic.afterReadiness[0].code='BB_TRUSTED_NODE_STALE';
 if(mutation==='not-failed-closed')semantic.afterReadiness[0].checks.failedClosed=false;
 if(mutation==='duplicate-error')semantic.afterReadiness.push(semantic.afterReadiness[0]);
 if(mutation==='http400')wire.rows.at(-1).status=400;
 if(mutation==='wrong-role')wire.rows.at(-1).roles=['b'];
 if(mutation==='missing-query'){wire.rows.splice(-2,1);wire.receiver.requests['trusted-query']--;wire.requests--;wire.completed--;}
 if(mutation==='duplicate-query'){wire.rows.push({...wire.rows.at(-2)});wire.receiver.requests['trusted-query']++;wire.requests++;wire.completed++;}
 assert.throws(()=>assertRollingRecoveryWire(wire,semantic));
});

test('installed SDK singleton batch rejects personalized RPC error with HTTP200 and zero forwarding',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs');
 const {createSafeJsonRpcClient}=await import('@aztec-labs/foundation/json-rpc/client');
 const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
 const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
 let forwarded=0,status,batchLength;const rpc=await startNodeRpc({getContract:async()=>{forwarded++;return undefined;}},()=>{throw Error('Unexpected transaction');},{faults:true});
 try{
  const client=createSafeJsonRpcClient(rpc.url,AztecNodeApiSchema,{namespaceMethods:'aztec',fetch:async(host,body)=>{
   assert(Array.isArray(body));batchLength=body.length;
   const response=await fetch(host,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});status=response.status;
   return {response:await response.json(),headers:response.headers};
  }});
  rpc.setFault('personalized-once');await assert.rejects(()=>client.getContract(AztecAddress.fromBigIntUnsafe(1n)));
  assert.equal(status,200);assert.equal(batchLength,1);assert.equal(rpc.snapshot().personalizedDenied,1);assert.equal(rpc.snapshot().forwarded.getContract,undefined);assert.equal(forwarded,0);
  await client.getContract(AztecAddress.fromBigIntUnsafe(1n));assert.equal(forwarded,1);
 }finally{await rpc.close();}
});

test('partial race barrier failure preserves started actors canonical fees before rethrowing original failure',async()=>{
 const {collectRollingRaceOutcomes}=await import('./rolling-application-fixture.mjs');
 const barrier=Error('B preparation failed'),saved=[];
 await assert.rejects(collectRollingRaceOutcomes({count:1,priorErrors:[barrier],collect:async i=>{saved.push({actor:i,fee:'12',effect:'canonical'});return saved[0];}}),error=>error instanceof AggregateError&&error.errors[0]===barrier);
 assert.deepEqual(saved,[{actor:0,fee:'12',effect:'canonical'}]);
 const firstRead=Error('A receipt unavailable'),calls=[];
 await assert.rejects(collectRollingRaceOutcomes({count:2,priorErrors:[barrier],collect:async i=>{calls.push(i);if(i===0)throw firstRead;return {fee:'15'};}}),error=>error.errors[0]===barrier&&error.errors[1]===firstRead);
 assert.deepEqual(calls,[0,1]);
 assert.deepEqual(await collectRollingRaceOutcomes({count:2,collect:async i=>({fee:String(i+1)})}),[{fee:'1'},{fee:'2'}]);
});
test('terminal collision acceptance rejects late observer errors, conflicts, pending work or changed canonical match',async()=>{
 const {assertClosedCollisionObserver}=await import('./rolling-application-fixture.mjs');
 const clean={closed:true,restored:true,pending:0,errors:0,truncated:0,conflicts:0,ownershipLost:0,calls:2,observations:2,classified:1,metadataEnabled:2,metadataRestored:2,reasonAbsent:0,reasonNotSimulationError:0,classifierRejected:0};
 assertClosedCollisionObserver(clean,true);
 for(const key of ['pending','errors','truncated','conflicts','ownershipLost'])assert.throws(()=>assertClosedCollisionObserver({...clean,[key]:1},true));
 for(const key of ['closed','restored'])assert.throws(()=>assertClosedCollisionObserver({...clean,[key]:false},true));
 for(const key of ['calls','observations','classified'])assert.throws(()=>assertClosedCollisionObserver({...clean,[key]:0},true));
 for(const key of ['metadataEnabled','metadataRestored','reasonAbsent','reasonNotSimulationError','classifierRejected'])assert.throws(()=>assertClosedCollisionObserver({...clean,[key]:1},true));
 assert.throws(()=>assertClosedCollisionObserver(clean,false));
});

// Labelled orchestration doubles; original writer lifetimes and the production
// read deadline primitive are exercised, without a chain or a proof job.
test('resume failure and partial barrier still await every original writer before collection and close',async()=>{
 const {settleRollingRaceWriters,collectRollingRaceOutcomes}=await import('./rolling-application-fixture.mjs');
 const barrier=Error('partial barrier'),restart=Error('resume failed'),writer=Error('writer failed');
 let releaseA,releaseB;const calls=[];
 const a=new Promise(resolve=>{releaseA=()=>{calls.push('a-settled');resolve();};});
 const b=new Promise((_,reject)=>{releaseB=()=>{calls.push('b-settled');reject(writer);};});
 const work=(async()=>{
   const errors=await settleRollingRaceWriters({submissions:[a,b],priorErrors:[barrier],resume:async()=>{calls.push('resume');throw restart;}});
   try{await collectRollingRaceOutcomes({count:2,priorErrors:errors,collect:async i=>{calls.push('collect-'+i);return {fee:String(i+1)};}});}
   finally{calls.push('close');}
 })();
 const rejected=assert.rejects(work,error=>error instanceof AggregateError&&error.errors.length===3&&error.errors[0]===barrier&&error.errors[1]===restart&&error.errors[2]===writer);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['resume']);
 releaseB();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['resume','b-settled']);
 releaseA();await rejected;assert.deepEqual(calls,['resume','b-settled','a-settled','collect-0','collect-1','close']);
});
test('successfully resumed race settles all writers without resubmission',async()=>{
 const {settleRollingRaceWriters}=await import('./rolling-application-fixture.mjs');
 let release,resumes=0;const submission=new Promise(resolve=>{release=resolve;});
 assert.deepEqual(await settleRollingRaceWriters({submissions:[submission],resume:async()=>{resumes++;release();}}),[]);
 assert.equal(resumes,1);
 assert.deepEqual(await settleRollingRaceWriters({submissions:[],resume:async()=>{resumes++;}}),[]);assert.equal(resumes,2);
});
for(const stalled of ['receipt','effect'])test('bounded '+stalled+' read retains other actor fees and has no late evidence writer',async()=>{
 const {collectRollingRaceOutcomes}=await import('./rolling-application-fixture.mjs');
 const {boundedTransactionRead}=await import('../../shared/transaction-outcomes.mjs');
 let release;const stalledRead=new Promise(resolve=>{release=resolve;});const reads=[],rows=[{},{}],fees=[];
 await assert.rejects(collectRollingRaceOutcomes({count:2,collect:async i=>{
   const row=rows[i];row.receipt='unknown';row.effect='unknown';
   const receipt=await boundedTransactionRead(()=>{reads.push('receipt-'+i);return i===0&&stalled==='receipt'?stalledRead:{fee:String(i+1)};},20);
   row.receipt='canonical';fees.push(receipt.fee);
   const effect=await boundedTransactionRead(()=>{reads.push('effect-'+i);return i===0&&stalled==='effect'?stalledRead:{id:i};},20);
   row.effect='available';return effect;
 }}),error=>error instanceof AggregateError&&error.errors.length===1&&error.errors[0].code==='BB_SUBMISSION_UNKNOWN');
 assert.deepEqual(fees,stalled==='receipt'?['2']:['1','2']);assert.equal(rows[1].effect,'available');
 assert(reads.includes('receipt-1')&&reads.includes('effect-1'));
 const frozen=JSON.stringify({rows,fees,reads});release({fee:'late',id:9});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(JSON.stringify({rows,fees,reads}),frozen);
});
test('race proof admission allows 90 seconds before cutoff and preserves the separate 90-second cleanup reserve',async()=>{
 const {requireRollingRaceProofBudget}=await import('./rolling-application-fixture.mjs');
 const now=1000000,end=now+180000,confirmation=end-90000;
 requireRollingRaceProofBudget(confirmation,now);
 assert.throws(()=>requireRollingRaceProofBudget(confirmation,now+1),/Insufficient remaining race proof budget/);
 let submissions=0;assert.throws(()=>{requireRollingRaceProofBudget(confirmation,now+1);submissions++;});assert.equal(submissions,0);
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes('...(race?{confirmationDeadlineAt:ctx.applicationDeadlineAt-90000}:{})'));
 const race=source.slice(source.indexOf('      }else if(race){'),source.indexOf('      }else if(names){'));
 assert(race.includes('requireRollingRaceProofBudget(confirmationDeadlineAt)'));
 assert(race.indexOf('requireRollingRaceProofBudget(confirmationDeadlineAt)')<race.indexOf('submissions.push('));
 assert(!race.includes('Promise.race'));assert(race.includes('settleRollingRaceWriters({submissions'));
 assert(race.includes('Date.now()<confirmationDeadlineAt'));
 assert(race.includes('sdk.boundedTransactionRead(()=>actor.journal.inspectOutcome(),3000)'));
 assert(race.includes('sdk.boundedTransactionRead(()=>ctx.node.getTxEffect(TxHash.fromString(outcome.txHash)),3000)'));
});

test('measured second race start is admitted without changing proof timeout or pre-send expiry protection',async()=>{
 const {requireRollingRaceProofBudget}=await import('./rolling-application-fixture.mjs');
 // Inputs from independent name-race-timing-604-review.json. No runtime replay.
 const applicationDeadline=525000,firstStart=297984,secondStart=321341,cutoff=applicationDeadline-90000;
 assert.equal(secondStart-firstStart,23357);assert.equal(cutoff-secondStart,113659);
 assert(cutoff-secondStart<120000,'Historical120s admission rejected this measured start');
 requireRollingRaceProofBudget(cutoff,firstStart);requireRollingRaceProofBudget(cutoff,secondStart);
 assert.throws(()=>requireRollingRaceProofBudget(cutoff,cutoff-89999));
 const actor=await fs.readFile(new URL('./rolling-application-actor.mjs',import.meta.url),'utf8');
 assert(actor.includes('timeoutMs:120000,pollMs:100'),'Real remote timeout remains120s');
 assert(actor.includes('beforeSubmit:{value:hook?async function(...values){contextGuard();if(remaining()<=0)throw expired();await Reflect.apply(hook.value,this,values);contextGuard();if(remaining()<=0)throw expired();}'));
 assert(actor.includes(':()=>{contextGuard();if(remaining()<=0)throw expired();},enumerable:true}'));
 // The companion actor suite executes this guard through the actual engine
 // with a late-resolving proof, zero node sends and retained encrypted journal.
});


test('preference campaigns keep real proof limits, actual decoder and fresh empty-store recovery',async()=>{
 const {getScenario}=await import('./scenarios.mjs');
 for(const name of ['rolling-preference-relationships','rolling-preference-notifications']){const s=getScenario(name);assert.equal(s.deadlineMs,540000);assert.equal(s.fixtureHeapMiB,768);assert.equal(s.boardProfile,'rolling');assert.equal(s.evidenceTask,'G07');assert.equal(s.browser,'none');}
 const browser=getScenario('rolling-preference-browser');assert.equal(browser.deadlineMs,540000);assert.equal(browser.fixtureHeapMiB,768);assert.equal(browser.boardProfile,'rolling');assert.equal(browser.evidenceTask,'G07');assert.equal(browser.browser,'rolling-preferences');assert.equal(browser.browserEngine,'chromium');assert.equal(browser.applicationThreads,2);
 const sdk=await loadRollingFixtureSDK(),abi=await import('@aztec-labs/stdlib/abi');assert.equal(sdk.decodeFunctionSignature,abi.decodeFunctionSignature);assert.equal(sdk.EventSelector,abi.EventSelector);
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const cold=source.slice(source.indexOf("await mark('preference-keys-only-recovery')"),source.indexOf("await mark('canonical-projection-rebuild')"));
 const closed=cold.indexOf('await old.close()'),constructed=cold.indexOf('await makeActor(fees,role,dataDirectory,metrics,boundedCold)');
 assert(closed>=0&&constructed>closed,'Original actor must close before the fresh observed actor is constructed');
 assert(cold.includes('assert.deepEqual(await fs.readdir(freshPath),[])'));assert(cold.includes('indexedDB.databases()'));
 assert(cold.includes('actorIntents.delete(old)'));assert(!cold.includes('copyFile'));assert(!cold.includes('submitPrepared'));
 assert(source.indexOf("await mark('encrypted-journal-reopen')")<source.indexOf("await mark('preference-keys-only-recovery')"));
});

test('saved preference scenario retains genuine two-proof limits and exact-byte recovery path',async()=>{
 const {getScenario}=await import('./scenarios.mjs');const s=getScenario('rolling-preference-saved');
 assert.equal(s.deadlineMs,540000);assert.equal(s.fixtureHeapMiB,768);assert.equal(s.boardProfile,'rolling');assert.equal(s.evidenceTask,'G07');assert.equal(s.applicationThreads,1);assert.equal(s.browser,'none');
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const part=source.slice(source.indexOf('if(preferenceSaved){\n'),source.indexOf('}else if(preferenceReorg){'));
 assert(part.includes('exerciseRollingSavedPreference'));assert(part.includes('actorA.application.resumeSaved(id,options)'));
 assert(part.includes("await makeActor(fees,'a',dataDirectory)"));assert(part.includes('namesBefore'));
 assert(part.includes('ctx.node.isValidTx(rpc.deniedTransaction())'));assert(part.includes('await fees.verify(feeTotal)'));
 assert(part.indexOf('accountFee(outcome.txHash,receipt.transactionFee)')<part.indexOf('assert.equal(outcome.txHash,expectedHash)'));
 assert(part.includes('deniedBytes'));assert(part.includes('saved.tx.toBuffer()'));assert(part.includes('forwardedBytes'));
 assert(!part.includes('prepareReplacement'));assert(!part.includes('deleteTx'));assert(!part.includes('keys-only'));
 assert(source.includes('if(preferences&&!preferenceBrowser&&!preferenceReorg&&!preferenceSaved&&!notificationBrowser)'));
 assert(source.includes('else if(preferenceSaved){assert.equal(report.proverJobs.completed,2);assert.equal(report.proverJobs.submitted,2);}'));
});
test('actual SDK serialized Tx is persistently denied before forward, then forwarded unchanged exactly once',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs');const {Tx}=await import('@aztec-labs/stdlib/tx');
 const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');const tx=Tx.random(),calls=[],observed=[];await tx.recomputeHash(); // Tx.random intentionally assigns an unrelated hash; RPC schema authenticates the real hash.
 const rpc=await startNodeRpc({sendTx:async value=>{calls.push(value);}},value=>observed.push(value),{faults:true});
 const send=async()=>{const response=await fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify({jsonrpc:'2.0',id:1,method:'aztec_sendTx',params:[tx]})});return {status:response.status,body:await response.json()};};
 try{rpc.setFault('send-before-forward');for(let i=0;i<2;i++){const result=await send();assert(result.body.error);assert.equal(calls.length,0);assert.equal(observed.length,0);}
  assert.equal(rpc.snapshot().sendDenied,2);assert.equal(rpc.snapshot().forwarded.sendTx,undefined);assert(Buffer.from(rpc.deniedTransaction().toBuffer()).equals(tx.toBuffer()));
  rpc.setFault('healthy');assert.equal((await send()).status,200);assert.equal(calls.length,1);assert.equal(observed.length,1);assert(Buffer.from(calls[0].toBuffer()).equals(tx.toBuffer()));assert.equal(String(observed[0].getTxHash()),String(tx.getTxHash()));
 }finally{await rpc.close();}
 await assert.rejects(fetch(rpc.url));
});

// Execute the actual checked-in dispatch fragments, not a duplicated model of
// their flags. Continuations are labelled test doubles; this is not chain work.
test('actual saved-versus-reorg dispatch selects job counts and only initialized continuations',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const modes=source.match(/  const notificationBrowser=.*\n  const preferenceSaved=.*\n  const preferences=.*\n  const rejectedWithdrawal=.*\n/);assert(modes);
 const start=source.indexOf('      assert.equal(report.proverJobs.failed,0);');
 const end=source.indexOf('      assert.equal(report.proverJobs.running,false);',start);assert(start>0&&end>start);
 const jobs=source.slice(start,end)+'assert.equal(report.proverJobs.running,false);';
 const terminal=source.match(/if\(preferenceReorg\)await pausePreferenceBoundary\(\);report\.passed=.*?await mark\(preferenceReorg\?[^\n]+?\);/);assert(terminal);
 const completion=source.match(/    if\(preferenceReorg\)\{await completePreferenceReorg\(\);[^\n]+\}/);assert(completion);
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const run=new AsyncFunction('real','scenario','assert','report','pausePreferenceBoundary','completePreferenceReorg','mark','sourceBinding','nativeArtifacts',modes[0]+jobs+terminal[0]+completion[0]+'return {preferences,preferenceSaved,preferenceReorg,markerReorg};');
 for(const [scenario,count,reorg]of [['preference-saved',2,false],['preference-reorg-initial',2,true],['preference-reorg-marker',3,true],['notification-browser',4,false]]){
  const calls=[],report={proverJobs:{failed:0,completed:count,submitted:count,running:false},sourceHashes:{}};
  const flags=await run(true,scenario,assert,report,reorg?async()=>calls.push('pause'):undefined,reorg?async()=>calls.push('complete'):undefined,async stage=>calls.push(stage),async()=>({}),{verify:()=>calls.push('verify')});
  assert.equal(flags.preferences,true);assert.equal(flags.preferenceSaved,scenario==='preference-saved');assert.equal(flags.preferenceReorg,reorg);assert.equal(flags.markerReorg,scenario==='preference-reorg-marker');
  assert.equal(report.passed,true);assert.deepEqual(calls,reorg?['pause','preference-reorg-prepared','complete','verify','complete']:['complete']);
  report.proverJobs.completed=count+1;await assert.rejects(run(true,scenario,assert,report,async()=>{},async()=>{},async()=>{},async()=>({}),{verify(){}}));
 }
 for(const scenario of ['preference-relationships','preference-notifications'])for(const real of [false,true]){
  const count=real?5:0,report={proverJobs:{failed:0,completed:count,submitted:count,running:false},sourceHashes:{}};
  const invoke=()=>run(real,scenario,assert,report,undefined,undefined,async()=>{},async()=>({}),{verify(){}});
  await invoke();assert.equal(report.passed,true);
  for(const [field,value]of [['completed',count+1],['submitted',count+1],['failed',1],['running',true]]){
   const before=report.proverJobs[field];report.proverJobs[field]=value;await assert.rejects(invoke());report.proverJobs[field]=before;
  }
 }
});

// Labelled pure server-boundary controls: not encrypted-discovery qualification.
test('recovery observation forwards exact receiver args and Promise without extra calls',async()=>{
 const {forwardRecoveryObservedNodeCall}=await import('./rolling-application-fixture.mjs');
 const {createRollingPrivateRecoveryMetrics}=await import('./rolling-private-recovery-metrics.mjs');
 const metrics=createRollingPrivateRecoveryMetrics(),argument={tags:['PRIVATE_SENTINEL']};let calls=0;
 const result=Promise.resolve([[]]);const node={getPrivateLogsByTags(arg){assert.equal(this,node);assert.equal(arg,argument);calls++;return result;}};
 assert.equal(forwardRecoveryObservedNodeCall(node,'getPrivateLogsByTags',[argument],metrics),result);
 await result;const snapshot=metrics.snapshot();assert.equal(calls,1);assert.equal(snapshot.methods.getPrivateLogsByTags.calls,1);
 assert.equal(snapshot.methods.getPrivateLogsByTags.requestedTags,1);assert.equal(snapshot.methods.getPrivateLogsByTags.pageResponses,1);
 assert.equal(snapshot.transportBytesObserved,false);assert(!JSON.stringify(snapshot).includes('PRIVATE_SENTINEL'));
});
test('recovery observation keeps rejected and synchronous errors and unobserved methods unchanged',async()=>{
 const {forwardRecoveryObservedNodeCall}=await import('./rolling-application-fixture.mjs');
 const {createRollingPrivateRecoveryMetrics}=await import('./rolling-private-recovery-metrics.mjs');
 const metrics=createRollingPrivateRecoveryMetrics(),error=new Error('PRIVATE_SENTINEL'),rejection=Promise.reject(error);let calls=0;
 const node={getBlock(){calls++;return rejection;},getBlockData(){calls++;throw error;},sendTx(value){calls++;assert.equal(this,node);return value;}};
 assert.equal(forwardRecoveryObservedNodeCall(node,'getBlock',[],metrics),rejection);await assert.rejects(rejection,e=>e===error);
 assert.throws(()=>forwardRecoveryObservedNodeCall(node,'getBlockData',[],metrics),e=>e===error);
 const value={};assert.equal(forwardRecoveryObservedNodeCall(node,'sendTx',[value],metrics),value);
 assert.equal(forwardRecoveryObservedNodeCall(node,'sendTx',[value],undefined),value);assert.equal(calls,4);
 const snapshot=metrics.snapshot();assert.equal(snapshot.methods.getBlock.rejected,1);assert.equal(snapshot.methods.getBlockData.rejected,1);
 assert(!JSON.stringify(snapshot).includes('PRIVATE_SENTINEL'));assert.equal(snapshot.counters.pending,0);
});

// Regression for genuine5925: a fee-only B must consume its bridge claim before
// the production wallet reads private credit; readiness assertions stay strict.
test('notification B claims real fee credit without collateral and includes setup debit',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const funding=source.slice(source.indexOf("if(multi){fundingRole='b'"),source.indexOf("fundingRole=undefined;const setupWallet"));
 assert(funding.includes('standalone:!socialWire&&!notificationBrowser,'));
 const claimed=source.indexOf('report.collateral=claim;accountFee');
 const deferred=source.indexOf('await claimRollingDeferredPrivateFees({funding:feesB');
 const eligibility=source.indexOf("await mark('collateral-eligibility')");
 assert(claimed>0&&deferred>claimed&&eligibility>deferred);
 assert(source.slice(deferred,eligibility).includes('privateFeeAction:feesB.privateFeeAction'));
 assert(source.includes("'scripts/private-fee-evidence.mjs','scripts/w01-private-fee-standalone.mjs'"));
 const readiness=source.slice(source.indexOf("actorB=await makeActor(feesB,'b');const state="),source.indexOf('const decoder=await createRollingEventDecoder'));
 assert(readiness.indexOf('await save()')<readiness.indexOf('assert.equal(state.status'));
 assert(readiness.includes("assert.equal(state.status,socialWire?'fee-ready':'collateral-pending')"));
 assert(readiness.includes('assert(BigInt(state.privateFeeCredit)>0n)'));
 const settlement=source.slice(source.indexOf('await settleNotificationEvidence({'),source.indexOf('assert(browser?.passed&&subscription&&reply&&marker)'));
 assert(settlement.includes('feesB.browserFixture.fundedAmount-BigInt(feesB.standalone?.transactionFee??0)-feeTotalB'));
 assert(settlement.includes('feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal)'));
 assert(source.includes('assert.equal(report.proverJobs.completed,4);assert.equal(report.proverJobs.submitted,4)'));
});

import {claimRollingDeferredPrivateFees} from './rolling-application-fixture.mjs';
const standaloneReceipt=()=>({passed:true,canonicalCheckpoint:true,applicationProof:true,networkProof:false,executionResult:'success',nodeValidation:'valid',txHash:'0x'+'11'.repeat(32),payer:'0x'+'12'.repeat(32),transactionFee:'13',status:'checkpointed',proofMilliseconds:17});
test('deferred fee claim persists intent and real receipt exactly once',async()=>{
 const funding={},order=[];let calls=0;
 const claim=async()=>{calls++;order.push('claim');assert.equal(funding.standalone.attempted,true);return standaloneReceipt();};
 await claimRollingDeferredPrivateFees({funding,claim,persist:async()=>order.push(funding.standalone.passed?'receipt':'intent')});
 assert.deepEqual(order,['intent','claim','receipt']);assert.equal(funding.standalone.transactionFee,'13');assert.equal(funding.standalone.proofMilliseconds,17);
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim,persist:async()=>{}}));assert.equal(calls,1);
});
test('deferred fee claim never sends after failed intent persistence',async()=>{
 const funding={},failure=new Error('disk');let sends=0;
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim:async()=>{sends++;},persist:async()=>{throw failure;}}),e=>e===failure);
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim:async()=>{sends++;},persist:async()=>{}}));assert.equal(sends,0);
});
test('deferred fee claim preserves paid partial receipt and original error without retry',async()=>{
 const funding={},failure=Object.assign(new Error('canonical read failed'),{privateFeeStandaloneObservation:{...standaloneReceipt(),passed:false,secret:'must not escape'}});let calls=0;const saved=[];
 const claim=async()=>{calls++;throw failure;};
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim,persist:async()=>saved.push(JSON.parse(JSON.stringify(funding)))}),e=>e===failure);
 assert.equal(saved.length,2);assert.equal(funding.standalone.txHash,standaloneReceipt().txHash);assert.equal(funding.standalone.transactionFee,'13');assert.equal(funding.standalone.passed,false);assert(!JSON.stringify(saved).includes('must not escape'));
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim,persist:async()=>{}}));assert.equal(calls,1);
});
test('deferred fee claim preserves action and later evidence errors together',async()=>{
 const funding={},action=new Error('action'),disk=new Error('disk');let saves=0;
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim:async()=>{throw action;},persist:async()=>{if(++saves===2)throw disk;}}),e=>e instanceof AggregateError&&e.errors[0]===action&&e.errors[1]===disk);
});
test('deferred fee claim refuses malformed success and retains its one-shot fence',async()=>{
 const funding={};let calls=0;
 const claim=async()=>{calls++;return {...standaloneReceipt(),transactionFee:'0',secret:'not evidence'};};
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim,persist:async()=>{}}));
 assert.equal(funding.standalone.passed,false);assert(!Object.hasOwn(funding.standalone,'secret'));
 await assert.rejects(()=>claimRollingDeferredPrivateFees({funding,claim,persist:async()=>{}}));assert.equal(calls,1);
});

test('deferred fee claim propagates falsy failures and never reports success',async()=>{
 for(const failure of [undefined,null,false,0]){
  const funding={};let caught=false;
  try{await claimRollingDeferredPrivateFees({funding,claim:async()=>{throw failure;},persist:async()=>{}});}catch(error){caught=true;assert.equal(error,failure);}
  assert(caught);assert.equal(funding.standalone.passed,false);
 }
});

test('deferred fee evidence never invokes an optional timing getter',async()=>{
 for(const throwing of [false,true]){
  const observed=standaloneReceipt(),funding={};let reads=0;
  Object.defineProperty(observed,'proofMilliseconds',{get(){reads++;if(throwing)throw Error('private');return reads<3?17:'private sentinel';}});
  await claimRollingDeferredPrivateFees({funding,claim:async()=>observed,persist:async()=>{}});
  assert.equal(reads,0);assert.equal(funding.standalone.passed,true);assert(!Object.hasOwn(funding.standalone,'proofMilliseconds'));
 }
});
test('deferred fee evidence copies only a captured nonnegative safe timing integer',async()=>{
 for(const value of [-1,1.5,Infinity,NaN,'17',17n,{},Number.MAX_SAFE_INTEGER+1]){
  const funding={};await claimRollingDeferredPrivateFees({funding,claim:async()=>({...standaloneReceipt(),proofMilliseconds:value}),persist:async()=>{}});
  assert.equal(funding.standalone.passed,true);assert(!Object.hasOwn(funding.standalone,'proofMilliseconds'));
 }
});

// Actual callback body with labelled receipt/balance doubles. No chain acceptance.
test('paid pre-handoff root failure still verifies both balances; unknown pending charge admits neither',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const body=source.split('          collectBeforeBrowser:async()=>{')[1]?.split('\n          },\n          collectAfterBrowser:')[0];assert(body);
 const {assertNotificationAccountingQuiescent,settleNotificationEvidence}=await import('./rolling-notification-fixture.mjs');
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const run=new AsyncFunction('report','forwardedSaved','service','accounted','settleNotificationEvidence','assertNotificationAccountingQuiescent','save','collect','fees','feesB','feeTotal','feeTotalB',body);
 for(const pending of [false,true]){
  const calls=[],report={notificationBrowser:{}},accounted=new Set(),semantic=Error('root semantic failure');
  const fees={browserFixture:{fundedAmount:100n},verify:async(...values)=>{calls.push(['a',...values]);throw Error('A unavailable');}};
  const feesB={browserFixture:{fundedAmount:200n},standalone:{transactionFee:3n},verify:async(...values)=>calls.push(['b',...values])};
  await assert.rejects(run(report,[{getTxHash:()=> 'root'}],{stats:()=>({running:false,submitted:1,completed:1,failed:0})},accounted,
   settleNotificationEvidence,assertNotificationAccountingQuiescent,async()=>{},async()=>{calls.push('root');if(!pending)accounted.add('root');throw semantic;},fees,feesB,9n,7n));
  assert.deepEqual(calls,pending?['root']:['root',['a',9n,190n],['b',7n,91n]]);
  assert.equal(report.notificationBrowser.browserOutcome,'not-launched');assert.equal(report.notificationBrowser.accountingVerified,false);
  assert.deepEqual(report.notificationBrowser.outcomes.balances.map(x=>x.passed),pending?[false,false]:[false,true]);
 }
 // Existing post-handoff path must still wait for browser termination before
 // balance snapshots; pre-handoff repair cannot remove the write-race fence.
 const after=source.split('          collectAfterBrowser:async(browser,l1,readPublicPage)=>{')[1];assert(after);
 const afterBody=after.split('            assert(browser?.passed')[0];
 const runAfter=new AsyncFunction('browser','report','forwardedSaved','save','settleNotificationEvidence','assert','fees','feesB','feeTotal','feeTotalB',afterBody);
 const lateCalls=[],lateReport={notificationBrowser:{}};
 await assert.rejects(runAfter(undefined,lateReport,[],async()=>{},settleNotificationEvidence,assert,
  {verify:async()=>lateCalls.push('a')},{verify:async()=>lateCalls.push('b')},0n,0n));
 assert.deepEqual(lateCalls,[]);assert.equal(lateReport.notificationBrowser.accountingVerified,false);
});

// Reproduces the fresh-worktree parent-directory omission without starting a chain.
test('fresh checkout creates private unique evidence directories and preserves prior evidence',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-fresh-evidence-'));
  try {
    const first=await createRollingEvidenceDirectory(root);
    assert.equal(path.dirname(first),path.join(root,'execution/evidence/G06'));
    assert.equal((await fs.stat(first)).mode&0o777,0o700);
    await fs.writeFile(path.join(first,'retained.json'),'retained',{flag:'wx'});
    const second=await createRollingEvidenceDirectory(root);
    assert.notEqual(first,second);assert.deepEqual(await fs.readdir(second),[]);
    assert.equal((await fs.stat(second)).mode&0o777,0o700);
    assert.equal(await fs.readFile(path.join(first,'retained.json'),'utf8'),'retained');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('evidence setup rejects an obstructing parent file',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-evidence-file-'));
  try {
    await fs.mkdir(path.join(root,'execution/evidence'),{recursive:true});
    await fs.writeFile(path.join(root,'execution/evidence/G06'),'retained');
    await assert.rejects(createRollingEvidenceDirectory(root),error=>error.code==='EEXIST');
    assert.equal(await fs.readFile(path.join(root,'execution/evidence/G06'),'utf8'),'retained');
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('evidence setup rejects a child collision without replacing existing data',async(t)=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-evidence-collision-'));
  const mkdir=fs.mkdir.bind(fs);let collided;
  const injected=t.mock.method(fs,'mkdir',async(directory,options)=>{
    if(path.basename(directory).startsWith('application-port-')){
      collided=directory;await mkdir(directory,{mode:0o700});
      await fs.writeFile(path.join(directory,'retained.json'),'retained');
    }
    return mkdir(directory,options);
  });
  try {
    await assert.rejects(createRollingEvidenceDirectory(root),error=>error.code==='EEXIST');
    assert.equal(await fs.readFile(path.join(collided,'retained.json'),'utf8'),'retained');
  } finally {injected.mock.restore();await fs.rm(root,{recursive:true,force:true});}
});

test('compact fixture route is explicit and does not pass through JSON-RPC body decoding',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs');
 const node=Object.fromEntries(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp','getBlockData','getBlock'].map(k=>[k,async()=>{throw Error('Invalid request must not reach node');}]));
 const config={expectedNetworkScope:{chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},proofsEnabled:true,tier:'checkpointed'};
 const ordinary=await startNodeRpc(node),enabled=await startNodeRpc(node,()=>{throw Error('No send');},{compactBlocks:config});
 try{
  for(const [rpc,status]of [[ordinary,403],[enabled,400]]){
   const response=await fetch(new URL('/rolling/compact-block-v1',rpc.url),{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,status);await response.text();
  }
  assert.equal(enabled.compactSnapshot().requests,1);assert.equal(enabled.compactSnapshot().accepted,0);
 }finally{await ordinary.close();await enabled.close();}
});
test('closing compact fixture retains ownership until the admitted native read settles',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs');let enter,release;
 const entered=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);
 const node=Object.fromEntries(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getSyncedL1Timestamp','getBlockData','getBlock'].map(k=>[k,async()=>({})]));
 node.getNodeInfo=async()=>{enter();await held;return {};};
 const rpc=await startNodeRpc(node,()=>{throw Error('No send');},{compactBlocks:{expectedNetworkScope:{chainId:'31337',version:'1',rollup:'0x'+'1'.repeat(40)},proofsEnabled:true,tier:'checkpointed'}});
 const request=fetch(new URL('/rolling/compact-block-v1',rpc.url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,number:1,hash:'0x'+'1'.padStart(64,'0'),tier:'checkpointed'})}).then(r=>r.text(),()=>null);
 let closed=false,closing;
 try{
  await entered;assert.equal(rpc.compactSnapshot().pending,1);closing=rpc.close().then(()=>{closed=true;});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(closed,false);assert.equal(rpc.compactSnapshot().pending,1);
 }finally{release();await request;await(closing??rpc.close());}
 assert.equal(closed,true);assert.equal(rpc.compactSnapshot().pending,0);
});

// Labelled observer/receiver seam: no real network acceptance here.
const compactPair=windows=>({browser:{passed:true,coldRecovery:{windows,compactRequests:windows===4?7:3,tagDiscoveryRequests:0},traffic:{compactRequests:windows===4?8:3}},native:{requests:windows===4?8:3,accepted:windows===4?8:3,failures:0,pending:0}});
for(const windows of [1,4])test('cold browser receiver joins actual-used finite counters for '+windows+' windows',()=>{
 const {browser,native}=compactPair(windows);assert.equal(assertRollingBrowserCompactAcceptance(browser,native,windows).nativeAccepted,native.accepted);
});
for(const [name,change]of [
 ['observer-only delivery',p=>{p.native.requests--;p.native.accepted--;}],
 ['unobserved receiver request',p=>{p.native.requests++;p.native.accepted++;}],
 ['receiver failure',p=>{p.native.failures=1;}],
 ['pending response',p=>{p.native.pending=1;}],
 ['cold public or private tag discovery',p=>{p.browser.coldRecovery.tagDiscoveryRequests=1;}],
 ['missing fresh import delivery',p=>{p.browser.coldRecovery.compactRequests=1;}],
 ['incomplete cold windows',p=>{p.browser.coldRecovery.windows=3;}],
 ['forged cold subset',p=>{p.browser.coldRecovery.compactRequests=9;}],
 ['missing observer field',p=>{delete p.browser.traffic.compactRequests;}],
 ['nonfinite receiver',p=>{p.native.accepted=NaN;}],
 ['failed browser',p=>{p.browser.passed=false;}],
])test('cold browser receiver rejects '+name,()=>{const p=compactPair(4);change(p);assert.throws(()=>assertRollingBrowserCompactAcceptance(p.browser,p.native,4),/Cold browser transport acceptance failed/);});

test('cold read observer awaits original work and projects only bounded numeric progress',async()=>{
  let resolve,calls=0;const options={deadlineAt:123};
  const value={complete:false,progress:{nextBlock:2,anchorBlock:5,markersChecked:0,markersTotal:null,privateChoice:'SECRET',processedRevision:'123'},preferences:{private:'SECRET'}};
  const observer=observeRollingColdRead(async input=>{calls++;assert.equal(input,options);return new Promise(r=>resolve=r);});
  const pending=observer.read(options);assert.equal(calls,1);assert.equal(observer.snapshot().pending,1);
  resolve(value);assert.equal(await pending,value);
  const snapshot=observer.snapshot();assert.equal(snapshot.pending,0);assert.equal(snapshot.calls,1);assert.equal(snapshot.completed,1);assert.equal(snapshot.failed,0);
  assert.deepEqual(snapshot.lastStep.progress,{nextBlock:2,anchorBlock:5,markersChecked:0,markersTotal:null});
  assert.equal(JSON.stringify(snapshot).includes('SECRET'),false);snapshot.lastStep.progress.nextBlock=99;assert.equal(observer.snapshot().lastStep.progress.nextBlock,2);
});
test('cold read observer preserves failure identity without leaking error text or extra calls',async()=>{
  const failure=Error('SECRET'),observer=observeRollingColdRead(async()=>{throw failure;});
  await assert.rejects(observer.read({}),error=>error===failure);
  const s=observer.snapshot();assert.equal(s.calls,1);assert.equal(s.failed,1);assert.equal(s.completed,0);assert.equal(s.pending,0);assert.equal(s.lastStep.returned,false);assert.equal(s.lastStep.progress,null);
  assert(Number.isSafeInteger(s.lastStep.elapsedMs)&&s.lastStep.elapsedMs>=0);assert.equal(JSON.stringify(s).includes('SECRET'),false);
});
test('cold observation ignores invalid and accessor progress without invoking getters',async()=>{
  const progress={nextBlock:NaN,anchorBlock:-1,markersChecked:Infinity,markersTotal:'SECRET'};
  Object.defineProperty(progress,'nextBlock',{get(){throw Error('accessor');}});
  const value={complete:false,progress},observer=observeRollingColdRead(async()=>value);
  assert.equal(await observer.read({}),value);assert.deepEqual(observer.snapshot().lastStep.progress,{});
});

test('actual cold persistence helper retains falsy recovery failure alongside save failure',async()=>{
  for(const original of [undefined,null,false,0,'',Error('original')]){
    const saveFailure=Error('write failure');let calls=0;
    await assert.rejects(persistRollingRecoveryObservation(async()=>{calls++;throw saveFailure;},true,original),e=>e instanceof AggregateError&&e.errors.length===2&&e.errors[0]===original&&e.errors[1]===saveFailure);
    assert.equal(calls,1);
  }
});
test('cold persistence helper propagates sole save failure and does not invent retry',async()=>{
  const failure=Error('save');await assert.rejects(persistRollingRecoveryObservation(async()=>{throw failure;},false,undefined),e=>e===failure);
  let calls=0;await persistRollingRecoveryObservation(async()=>{calls++;},true,undefined);assert.equal(calls,1);
});

// Labelled scheduling doubles: these test the actual ordering helper, not chain
// acceptance or shorter runtime. All real callbacks remain mandatory in fixture.
for(const boundedCold of [true,false])test(`public/private acceptance is sequential and once only (boundedCold=${boundedCold})`,async()=>{
 const order=boundedCold?['public','private']:['private','public'],calls=[];let release,active=0,peak=0;
 const held=new Promise(resolve=>{release=resolve;});
 const phase=name=>async()=>{calls.push(name);active++;peak=Math.max(peak,active);if(name===order[0])await held;active--;};
 const running=runRollingPublicRecoveryChecks({boundedCold,recoverPrivate:phase('private'),verifyPublic:phase('public')});
 assert.deepEqual(calls,[order[0]]);release();await running;
 assert.deepEqual(calls,order);assert.equal(active,0);assert.equal(peak,1);
});
for(const boundedCold of [true,false])for(const failing of [0,1])test(`public/private acceptance preserves phase ${failing} failure with no later work (boundedCold=${boundedCold})`,async()=>{
 const order=boundedCold?['public','private']:['private','public'],calls=[],error=Error('Labelled exact failure');
 const phase=name=>async()=>{calls.push(name);if(name===order[failing])throw error;};
 await assert.rejects(runRollingPublicRecoveryChecks({boundedCold,recoverPrivate:phase('private'),verifyPublic:phase('public')}),actual=>actual===error);
 assert.deepEqual(calls,order.slice(0,failing+1));
});
test('invalid public/private ordering inputs cannot start either callback',async()=>{
 let calls=0;const callback=async()=>{calls++;};
 for(const change of [{boundedCold:1},{boundedCold:undefined},{recoverPrivate:null},{verifyPublic:null}])await assert.rejects(runRollingPublicRecoveryChecks({boundedCold:false,recoverPrivate:callback,verifyPublic:callback,...change}));
 assert.equal(calls,0);
});
test('actual fixture binds unchanged public and private gates before final accounting',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const coldStart=source.indexOf('const recoverPrivatePreferences=async()=>{'),publicStart=source.indexOf('const verifyCanonicalPublic=async()=>{');
 const dispatch=source.indexOf('await runRollingPublicRecoveryChecks({boundedCold,recoverPrivate:recoverPrivatePreferences,verifyPublic:verifyCanonicalPublic});');
 assert(coldStart>0&&publicStart>coldStart&&dispatch>publicStart);
 const cold=source.slice(coldStart,publicStart),publicChecks=source.slice(publicStart,dispatch);
 assert.equal((cold.match(/await mark\('preference-keys-only-recovery'\)/g)||[]).length,1);
 assert(cold.includes("if(boundedCold)wire?.setPhase('recovery-a')"));
 assert(cold.includes('compareRecoveredColdRollingPreferences'));assert(cold.includes('assert.equal(String(replacement.owner),String(old.owner))'));
 assert(cold.includes('coldRecoveryMetrics=metrics'));assert(cold.includes('coldRecoveryMetrics=undefined'));
 assert(cold.includes('persistRollingRecoveryObservation(save,recoveryFailed,recoveryError)'));
 assert.equal((publicChecks.match(/await verifyRollingPublicReader\(/g)||[]).length,1);
 assert(publicChecks.includes('decoder.decodeTransaction(ctx.node,hash)'));assert(publicChecks.includes('deadlineAt:ctx.applicationDeadlineAt'));
 assert(!publicChecks.includes('actorA.'));assert(!publicChecks.includes('actorB.'));
 assert(source.indexOf('let verifyRollingPublicReader;')<coldStart);assert(publicChecks.includes("({verifyRollingPublicReader}=await import('./rolling-public-acceptance.mjs'));"));
 assert(source.indexOf('await verifyRollingPublicReader({',dispatch)>dispatch,'Later stale-readiness check retains the outer import binding');
 const browser=source.indexOf('if(preferenceBrowser){',dispatch),accounting=source.indexOf('report.actualHumanFees=String(feeTotal+feeTotalB)',dispatch);
 assert(browser>dispatch&&accounting>browser);assert(source.slice(browser,accounting).includes('await fees.verify(feeTotal)'));
});

// Labelled native-body shapes verify the workload oracle only. The real parent
// passes actual canonical SDK block bodies, not these synthetic rows.
test('cold physical page count includes empty blocks, unrelated logs and transaction boundaries',()=>{
 const body=(...lengths)=>({body:{txEffects:lengths.map(n=>({privateLogs:Array(n).fill({})}))}});
 assert.equal(countRollingColdPhysicalPages(body()),1);
 assert.equal(countRollingColdPhysicalPages(body(0,0)),1);
 assert.equal(countRollingColdPhysicalPages(body(1,1)),2);
 assert.equal(countRollingColdPhysicalPages(body(8,9,64)),11);
 assert.throws(()=>countRollingColdPhysicalPages(body(65)));
 assert.throws(()=>countRollingColdPhysicalPages({body:{txEffects:Array(6144).fill({privateLogs:[]})}}));
});
test('actual cold reorg dispatch enables only the existing two reorg lanes in addition to previous cold lanes',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const declaration=source.match(/  const boundedCold=([^;]+);/);assert(declaration);
 const enabled=new Function('scenario','return '+declaration[1]);
 for(const scenario of ['preference-relationships','preference-browser','notification-browser','preference-reorg-initial','preference-reorg-marker'])assert.equal(enabled(scenario),true);
 for(const scenario of ['preference-saved','preference-notifications','name-race','conversation'])assert.equal(enabled(scenario),false);
 const reorgStart='        }else if(preferenceReorg){',browserStart='        }else if(preferenceBrowser){';
 const reorgBranch=text=>{
  const start=text.indexOf(reorgStart),end=text.indexOf(browserStart,start);
  assert(start>=0&&end>start,'Explicit reorg and following browser branches must exist in order');
  const selected=text.slice(start,end);assert(!selected.includes('actorA.application.readPreferences('));return selected;
 };
 const branch=reorgBranch(source);
 // Boundary control: the real browser may use its ordinary private read, but
 // injecting that same call inside the actual reorg branch must still fail.
 assert.throws(()=>reorgBranch(source.replace(reorgStart,reorgStart+'\n await actorA.application.readPreferences({});')));
 const browser=source.slice(source.indexOf(browserStart,source.indexOf(reorgStart)),source.indexOf('        }else{\n        const result=await exerciseRollingPreferences'));
 assert(browser.includes('actorA.application.readPreferences('));
 const coldSetup=source.slice(source.indexOf("coldActor=await makeActor(fees,'a-cold'"),source.indexOf('const publishRoot=async()=>'));
 assert(coldSetup.includes('coldActor.application.readColdPreferences(options)'));
 assert(coldSetup.includes('activity:()=>coldActor.activity()'));
 assert(branch.includes('sameObserverStoreColdReopen'));
 assert(!branch.includes('actorA.application.readPreferences('));
 for(const phase of ['retained','orphaned','restored','replacement-height','replacement'])assert(branch.includes("privateSnapshot('"+phase+"')"));
 assert(branch.includes("makeActor(fees,'a',undefined,undefined,true)"));
 assert(branch.includes('expectedJobs=markerReorg?4:3'));
 for(const invariant of ['sameHeightMarkerReviewed','orphanFeeExcludedAfterCanonicalBalanceCheck','historicalInclusionsRetained','exactPriorSignedBytesRetained','actualArchiverAndWorldstateUnwind'])assert(branch.includes(invariant));
 assert(branch.indexOf('forkBudget.remainingMs>=COLD_REORG_BUDGET.forkReserveMs')<branch.indexOf('await replaceRollingL1Suffix'));
 assert(coldSetup.includes('physicalPages:createRollingColdPhysicalPageOracle({node:ctx.node,contextGuard:()=>coldActor.contextGuard()})'));
 const oracle=source.slice(source.indexOf('export function createRollingColdPhysicalPageOracle'),source.indexOf('// Harness-only observation of actual outbound serialized requests.'));
 assert(oracle.includes('pages+=countRollingColdPhysicalPages(block)'));
 assert(oracle.includes('assert.equal(String((await node.getBlockData(anchor.blockNumber))?.blockHash),anchor.blockHash)'));
});

test('selected browser profile matches the actual trusted worker without changing bounds',async()=>{
 const {getScenario}=await import('./scenarios.mjs');
 for(const scenario of ['preference-browser','notification-browser','preference-relationships','preference-notifications','preference-saved']){
  const selected=getScenario('rolling-'+scenario);assert.equal(selected.applicationThreads,rollingTrustedProofThreads(scenario));
  assert.equal(selected.deadlineMs,540000);assert.equal(selected.fixtureHeapMiB,768);
 }
 assert.equal(rollingTrustedProofThreads('preference-browser'),2);
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes('const trustedProofThreads=rollingTrustedProofThreads(scenario)'));
 assert(source.includes('threads:trustedProofThreads'));
 assert(source.includes("if(preferenceBrowser)assert.equal(process.env.C01_APPLICATION_BB_THREADS,'2'"));
 assert(source.includes('runRollingPreferenceBrowserFixture')); // Same parent, no alternate browser lifecycle.
});

test('root overlap lanes select two actual worker threads and retain all existing budget and proof assertions',async()=>{
 const {getScenario}=await import('./scenarios.mjs');
 for(const scenario of ['preference-reorg-initial','preference-reorg-marker']){
  const selected=getScenario('rolling-'+scenario);assert.equal(selected.applicationThreads,2);assert.equal(rollingTrustedProofThreads(scenario),2);
  assert.equal(selected.deadlineMs,scenario==='preference-reorg-initial'?585000:540000);
  assert(selected.deadlineMs<600000);assert.equal(selected.fixtureHeapMiB,768);assert.equal(selected.browser,'none');
 }
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes("if(preferenceReorg)assert.equal(process.env.C01_APPLICATION_BB_THREADS,'2'"));
 assert(source.includes('service.stats().completed===1&&service.stats().failed===0'));
 assert(source.includes('expectedJobs=markerReorg?4:3'));
 assert(source.includes('rootOverlap.arm(\'ROLLING_WORKFLOW_V1:\'+prepared.intentId)'));
 assert(source.includes("coldActor=await makeActor(fees,'a-cold',undefined,undefined,true)"));
 assert(source.includes('sameObserverStoreColdReopen=true'));
 assert(source.includes("...(coldActor?[['coldRecoveryActor',()=>coldActor.close()]]:[])"));
});
test('actual SDK serialized transaction invokes the synchronous request-local fence before onSend and native forward',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs'),{Tx}=await import('@aztec-labs/stdlib/tx');
 const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');const tx=Tx.random();await tx.recomputeHash();
 const events=[];let reject=true,live;
 const node={sendTx(value){assert.equal(this,node);assert(Buffer.from(value.toBuffer()).equals(tx.toBuffer()));events.push('native');}};
 const rpc=await startNodeRpc(node,()=>events.push('onSend'),{beforeForward(value,requestLive){live=requestLive;assert.equal(live(),true);assert.equal(String(value.getTxHash()),String(tx.getTxHash()));events.push('fence');if(reject)throw Error('Controlled rejection');}});
 const send=async()=>{const response=await fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify({jsonrpc:'2.0',id:1,method:'aztec_sendTx',params:[tx]})});return response.json();};
 try{assert((await send()).error);assert.deepEqual(events,['fence']);assert.equal(live(),false);reject=false;
  assert(!((await send()).error));assert.deepEqual(events,['fence','fence','onSend','native']);assert.equal(live(),false);
 }finally{await rpc.close();}
});
test('request-local cancellation remains isolated and a malformed async fence never forwards later',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs'),{Tx}=await import('@aztec-labs/stdlib/tx');
 const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');const tx=Tx.random();await tx.recomputeHash();
 let entered,release,firstLive,first=true,forwarded=0,finished;
 const started=new Promise(r=>entered=r),hold=new Promise(r=>release=r),settled=new Promise(r=>finished=r),abort=new AbortController();
 const rpc=await startNodeRpc({sendTx(){forwarded++;}},()=>{},{beforeForward(_tx,live){
  assert(live());if(first){first=false;firstLive=live;entered();return hold.then(()=>{assert.equal(live(),false);finished();});}
  assert.equal(firstLive(),false);return undefined;
 }});
 const send=signal=>fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify({jsonrpc:'2.0',id:1,method:'aztec_sendTx',params:[tx]}),signal});
 const pending=send(abort.signal).then(response=>response.json(),error=>error);
 try{await started;abort.abort();await pending;
  const deadline=Date.now()+1000;while(firstLive()){assert(Date.now()<deadline);await new Promise(r=>setImmediate(r));}
  const response=await send();assert(!((await response.json()).error));assert.equal(forwarded,1);
  release();await settled;await new Promise(r=>setImmediate(r));assert.equal(forwarded,1);
 }finally{abort.abort();release();await pending;await rpc.close();}
});
test('root-fenced RPC close drains an original native send even after its HTTP caller disconnects',async()=>{
 const {startNodeRpc}=await import('./rolling-application-fixture.mjs'),{Tx}=await import('@aztec-labs/stdlib/tx');
 const {jsonStringify}=await import('@aztec-labs/foundation/json-rpc');const tx=Tx.random();await tx.recomputeHash();
 let entered,release,closed=false;const seen=new Promise(r=>entered=r),held=new Promise(r=>release=r),abort=new AbortController();
 const rpc=await startNodeRpc({async sendTx(){entered();await held;}},()=>{},{beforeForward(_tx,live){assert(live());}});
 const sent=fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:jsonStringify({jsonrpc:'2.0',id:1,method:'aztec_sendTx',params:[tx]}),signal:abort.signal}).then(r=>r.text(),e=>e);
 let closing;
 try{await seen;abort.abort();await sent;closing=rpc.close().then(()=>{closed=true;});await new Promise(r=>setImmediate(r));assert(!closed);
  release();await closing;assert(closed);assert.deepEqual(await rpc.drainSends(),{pending:0});
 }finally{abort.abort();release();await sent;if(closing)await closing;else await rpc.close();}
});

// Labelled outcome/cleanup fixtures exercise the exact parent-used finalizer.
for(const original of [undefined,null,false,0,'',Error('PRIVATE_ORIGINAL')])
 for(const fault of ['none','drain','pending','snapshot','persist'])test('overlap finalizer retains original rejection '+String(original)+' with '+fault,async()=>{
  const cleanup=Error('PRIVATE_CLEANUP'),calls=[],observation={};
  const result=await settleRollingRootOverlap({observation,
   run:async()=>{calls.push('run');throw original;},
   drain:async()=>{calls.push('drain');if(fault==='drain')throw cleanup;return {pending:fault==='pending'?1:0};},
   snapshot:()=>{calls.push('snapshot');if(fault==='snapshot')throw cleanup;return {state:'failed'};},
   persist:async()=>{calls.push('persist');if(fault==='persist')throw cleanup;},
  }).then(()=>({resolved:true}),reason=>({reason}));
  assert(!result.resolved);assert(result.reason instanceof AggregateError);assert.equal(result.reason.errors[0],original);
  assert.equal(result.reason.errors.length,fault==='none'?1:2);
  if(!['none','pending'].includes(fault))assert.equal(result.reason.errors[1],cleanup);
  assert.deepEqual(calls,['run','drain','snapshot','persist']);assert.equal(observation.passed,false);
  assert(!JSON.stringify(observation).includes('PRIVATE'));
 });
test('overlap finalizer retains all cleanup failures after a successful operation',async()=>{
 const errors=[undefined,false,Error('PRIVATE_PERSIST')],observation={},calls=[];
 await assert.rejects(settleRollingRootOverlap({observation,run:async()=>{calls.push('run');return 'included';},
  drain:async()=>{calls.push('drain');throw errors[0];},snapshot:()=>{calls.push('snapshot');throw errors[1];},
  persist:async()=>{calls.push('persist');throw errors[2];}}),e=>e instanceof AggregateError&&e.errors.length===3&&e.errors.every((v,i)=>v===errors[i]));
 assert.deepEqual(calls,['run','drain','snapshot','persist']);assert.equal(observation.passed,false);
});
test('overlap finalizer returns the original success only after drain and diagnostics settle',async()=>{
 const result={},observation={},calls=[];
 assert.equal(await settleRollingRootOverlap({observation,run:async()=>{calls.push('run');return result;},
  drain:async()=>{calls.push('drain');return {pending:0};},snapshot:()=>{calls.push('snapshot');return {state:'done'};},persist:async()=>{calls.push('persist');assert(observation.passed);}}),result);
 assert.deepEqual(calls,['run','drain','snapshot','persist']);assert.equal(observation.passed,true);
});

import {rollingBrowserFollowingAdmission} from './rolling-application-fixture.mjs';
test('browser following-first admission retains150s and conservative124s allowance before first proof',()=>{
 const now=100000,deadlineAt=374000;
 const plan=rollingBrowserFollowingAdmission({now,deadlineAt,nextAllowedTime:100n});
 assert(plan.admitted);assert.equal(plan.requiredBeforeBrowserMs,124000);assert.equal(plan.browserReserveMs,150000);
 assert.equal(rollingBrowserFollowingAdmission({now:now+1,deadlineAt,nextAllowedTime:100n}).admitted,false);
 assert.equal(rollingBrowserFollowingAdmission({now,deadlineAt:now-1,nextAllowedTime:100n}).admitted,false);
 assert(!JSON.stringify(plan).includes('nextAllowedTime'));
});
test('browser admission overlaps only actual pending eligibility with following and its first read',()=>{
 const now=100000,deadlineAt=400000;
 assert.equal(rollingBrowserFollowingAdmission({now,deadlineAt,nextAllowedTime:138n}).extraEligibilityMs,0);
 const plan=rollingBrowserFollowingAdmission({now,deadlineAt,nextAllowedTime:150n});
 assert.equal(plan.postingDelayMs,50000);assert.equal(plan.extraEligibilityMs,12000);assert.equal(plan.requiredBeforeBrowserMs,136000);
 assert.equal(rollingBrowserFollowingAdmission({now,deadlineAt:385999,nextAllowedTime:150n}).admitted,false);
});
for(const nextAllowedTime of ['100',-1n,BigInt(Number.MAX_SAFE_INTEGER),undefined])test('browser admission rejects malformed private time '+String(nextAllowedTime),()=>{
 assert.throws(()=>rollingBrowserFollowingAdmission({now:100000,deadlineAt:400000,nextAllowedTime}));
});
test('following-first is confined to preference-browser and retains the actual posting gate and three-proof final assertion',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes('if(preferenceBrowser){\n        // Capture the real pre-eligibility anchor'));
 assert(source.includes("}else{\n      await mark('collateral-eligibility')"));
 assert(source.includes('if(!preferenceBrowser)await waitPostAdmission();'));
 assert(source.includes('rootEvent=notificationBrowser||preferenceBrowser?undefined:await publishRoot()'));
 const start=source.indexOf('}else if(preferenceBrowser){\n          report.browserFollowing.admission'),end=source.indexOf('const expectedNames=',start),branch=source.slice(start,end);
 assert(start>0&&end>start);assert(branch.indexOf('admission.admitted')<branch.indexOf('exerciseRollingBrowserPreferences'));
 assert(branch.includes('await waitPostAdmission();report.browserFollowing.postingEligibility'));
 assert(branch.includes('return publishRoot();'));
 assert(branch.includes('exerciseRollingPreferences({mode,root:ids.rootId,name:ids.nameId,rootBlock:Number(rootPosition.blockNumber),rootHash:rootPosition.blockHash'));
 assert(source.includes('preferenceBrowser){assert.equal(report.proverJobs.completed,3);assert.equal(report.proverJobs.submitted,3)'));
 assert(source.includes('runRollingPreferenceBrowserFixture'));assert(source.includes('actualBok.currentContractClassId'));
});

test('exact fixture dispatch disables Bok only for preference browser and both reorg lanes',async()=>{
 // Execute the actual scoped branch with labelled control doubles, no chain.
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const modes=source.match(/  const preferenceSaved=[^\n]+;/);assert(modes);
 const scope=source.match(/  const bokEnabled=[^\n]+;/);assert(scope);
 const classify=new Function('scenario',modes[0]+scope[0]+'return bokEnabled;');
 const begin=source.indexOf("      if(bokEnabled){\n      await mark('deploy-unused-bok-scope');"),end=source.indexOf('      if(preferenceBrowser){',begin);
 assert(begin>0&&end>begin);const branch=source.slice(begin,end),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('bokEnabled','report','mark','save',branch);
 for(const scenario of ['preference-browser','preference-reorg-initial','preference-reorg-marker']){
  assert.equal(classify(scenario),false);const report={},stages=[];
  await run(false,report,async stage=>stages.push(stage),async()=>{});
  assert.deepEqual(report.bok,{enabled:false,deployed:false,used:false});assert.deepEqual(stages,['bok-capability-disabled']);
  assert(!Object.hasOwn(report.bok,'address'));assert(!Object.hasOwn(report.bok,'txHash'));
 }
 for(const scenario of ['preference-relationships','preference-notifications','notification-browser','preference-saved','anonymous-thread','subboard-policy','composer','bok-post'])assert.equal(classify(scenario),true);
 const stopped=Error('LABELLED_DEPLOYMENT_ENTRY');await assert.rejects(run(true,{},async stage=>{assert.equal(stage,'deploy-unused-bok-scope');throw stopped;},async()=>{}),error=>error===stopped);
 assert(branch.includes('await proveApplicationAction('));assert(branch.includes('await ctx.node.sendTx(bokTx)'));assert(branch.includes('actualBok.currentContractClassId'));
 const config=source.match(/\.\.\.\(bokEnabled\?\{privateBokAddress:String\(bokInstance.address\)\}:\{bokEnabled:false\}\)/);assert(config);
 const serviceScope=new Function('bokEnabled','bokInstance','return {'+config[0]+'};');
 assert.deepEqual(serviceScope(false,undefined),{bokEnabled:false});assert.deepEqual(serviceScope(true,{address:'REAL_SCOPE'}),{privateBokAddress:'REAL_SCOPE'});
 assert(source.includes('await fees.verify(feeTotal)'));assert(source.includes('assert.equal(report.proverJobs.completed,3)'));
});
test('actual-used setup clock projection records only public block/time measurements',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 const begin=source.indexOf('  const recordSetupClock=async stage=>{'),end=source.indexOf('  const mark=async stage=>',begin);assert(begin>0&&end>begin);
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('ctx','report','assert',source.slice(begin,end)+"await recordSetupClock('unit-stage');");
 const report={};let calls=0;await run({l1Client:{getBlock:async options=>{calls++;assert.deepEqual(options,{blockTag:'latest'});return {number:123n,timestamp:1n,ignored:'PRIVATE_SENTINEL'};}}},report,assert);
 assert.equal(calls,1);assert.deepEqual(Object.keys(report.setupClock[0]),['stage','wallSeconds','l1Block','l1Timestamp','leadSeconds']);
 assert.equal(report.setupClock[0].l1Block,'123');assert.equal(report.setupClock[0].l1Timestamp,'1');assert.equal(report.setupClock[0].leadSeconds,1-report.setupClock[0].wallSeconds);assert(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
 const failed={};await assert.rejects(run({l1Client:{getBlock:async()=>({number:1n,timestamp:-1n})}},failed,assert));assert.equal(failed.setupClock,undefined);
});

// Attributed transport controls use real serialized HTTP requests and original
// gateway/native schema code. Their node/inspector data are explicitly doubles.
import {installRollingColdTransportObserver,rollingColdAttributedSnapshot,rollingColdTransportEvidence,startNodeRpc} from './rolling-application-fixture.mjs';
const coldTestCall=(method,params=[])=>({jsonrpc:'2.0',id:1,method,params});
const coldTestTick=()=>new Promise(resolve=>setImmediate(resolve));
const emptyColdNative=()=>({requests:0,accepted:0,failures:0,pending:0,privateTags:0,publicTags:0});
function coldObserverDouble(fetchImpl){
 const previous=globalThis.fetch;globalThis.fetch=fetchImpl;
 let observer;
 try{observer=installRollingColdTransportObserver({mainEndpoint:'http://127.0.0.1:31001',coldEndpoint:'http://127.0.0.1:31002'});}catch(error){globalThis.fetch=previous;throw error;}
 return {observer,async close(){try{await observer.close();}finally{globalThis.fetch=previous;}}};
}
test('cold observer preserves exact original receiver arguments promise and private-free additive projection',async()=>{
 const result=Promise.resolve({status:200}),receiver={},calls=[];
 const f=coldObserverDouble(function(...args){calls.push({receiver:this,args});return result;});
 const input={method:'POST',headers:{authorization:'PRIVATE_HEADER'},body:JSON.stringify([coldTestCall('aztec_getPrivateLogsByTags',['PRIVATE_ARGUMENT']),coldTestCall('node_getPublicLogsByTags',['PRIVATE_ARGUMENT']),coldTestCall('node_sendTx',['PRIVATE_BYTES'])])};
 try{assert.equal(globalThis.fetch.call(receiver,'http://127.0.0.1:31001/v1/node',input),result);await result;await coldTestTick();
  assert.equal(calls[0].receiver,receiver);assert.equal(calls[0].args[1],input);
  const snapshot=f.observer.snapshot();assert.equal(snapshot.main.privateTags,1);assert.equal(snapshot.main.publicTags,1);assert.equal(snapshot.main.sends,1);
  assert.equal(snapshot.cold.requests,0);assert.deepEqual(snapshot.total,snapshot.main);assert(!JSON.stringify(snapshot).includes('PRIVATE'));
  snapshot.main.privateTags=999;assert.equal(f.observer.snapshot().main.privateTags,1);
 }finally{await f.close();}
});
for(const method of ['aztec_getPrivateLogsByTags','node_getPrivateLogsByTags','aztec_getPublicLogsByTags','node_getPublicLogsByTags','aztec_sendTx','node_sendTx'])test('cold observer counts every rejected batch item including '+method,async()=>{
 const f=coldObserverDouble(()=>Promise.resolve({status:400})),field=method.endsWith('sendTx')?'sends':method.includes('Private')?'privateTags':'publicTags';
 try{await fetch('http://127.0.0.1:31002/v1/node',{method:'POST',body:JSON.stringify([null,...Array.from({length:9},()=>coldTestCall(method,['PRIVATE_SENTINEL']))])});await coldTestTick();
  const row=f.observer.snapshot().cold;assert.equal(row[field],9);assert.equal(row.errors,2);assert.equal(row.rejected,1);assert.equal(row.pending,0);
  assert.throws(()=>rollingColdAttributedSnapshot(f.observer,{coldSnapshot:emptyColdNative,pendingReads:()=>0},0));assert(!JSON.stringify(row).includes('PRIVATE'));
 }finally{await f.close();}
});
for(const failure of [undefined,null,false,0,'',Error('PRIVATE_FAILURE')])test('cold observer preserves original synchronous and asynchronous rejection '+String(failure),async()=>{
 let async=false;const rejection=Promise.reject(failure);rejection.catch(()=>{});
 const f=coldObserverDouble(()=>{if(async)return rejection;throw failure;});
 const args=['http://127.0.0.1:31002/v1/node',{method:'POST',body:JSON.stringify(coldTestCall('aztec_getBlockNumber'))}];
 try{let caught=false;try{fetch(...args);}catch(error){caught=true;assert.equal(error,failure);}assert(caught);
  async=true;assert.equal(fetch(...args),rejection);const outcome=await rejection.then(()=>({ok:true}),reason=>({reason}));assert.equal(outcome.reason,failure);await coldTestTick();
  assert.equal(f.observer.snapshot().cold.rejected,2);assert.equal(f.observer.snapshot().cold.pending,0);
 }finally{await f.close();}
});
test('cold observer owns the original pending fetch until settlement even when caller stops waiting',async()=>{
 let release;const original=new Promise(resolve=>release=resolve);const f=coldObserverDouble(()=>original);let closed=false;
 fetch('http://127.0.0.1:31002/v1/node',{method:'POST',body:JSON.stringify(coldTestCall('aztec_getBlockNumber'))});
 const closing=f.observer.close().then(()=>{closed=true;});
 try{await coldTestTick();assert(!closed);assert.equal(f.observer.snapshot().cold.pending,1);
  assert.throws(()=>rollingColdAttributedSnapshot(f.observer,{coldSnapshot:emptyColdNative,pendingReads:()=>0},0));
  release({status:200});await closing;assert(closed);assert.equal(f.observer.snapshot().cold.pending,0);
 }finally{release({status:200});await closing;await f.close();}
});
test('cold observer rejects ambiguous endpoint ownership before replacing fetch',()=>{
 const before=globalThis.fetch;
 for(const coldEndpoint of ['http://127.0.0.1:31001','http://example.com:31002','http://127.0.0.1:31002/path','http://127.0.0.1:31002?account=PRIVATE'])
  assert.throws(()=>installRollingColdTransportObserver({mainEndpoint:'http://127.0.0.1:31001',coldEndpoint}));
 assert.equal(globalThis.fetch,before);
});
async function attributedHTTPFixture({node={getBlockNumber:async()=>7,getPrivateLogsByTags:async()=>[[]],getPublicLogsByTags:async()=>[[]]},beforeForward}={}){
 const {createPrivateQueryWithInspector}=await import('../../prover/private-query.mjs'),{createProverServer}=await import('../../prover/server.mjs');
 const resources=[],state={ready:true,onSend:0,denied:0};let observer;
 try{
  const main=await startNodeRpc(node);resources.push(()=>main.close());
  const cold=await startNodeRpc(node,()=>{state.onSend++;},{beforeForward:tx=>{state.denied++;if(beforeForward)beforeForward(tx);throw Error('Cold send forbidden');}});resources.push(()=>cold.close());
  async function gateway(native){
   const privateQuery=createPrivateQueryWithInspector({queryNode:{url:native.url,rollupAddress:'0x'+'12'.repeat(20)},chainId:'31337',rollupVersion:'1',proofsEnabled:true},async()=>{if(!state.ready)throw Error('Labelled unavailable node');return {ready:true};});
   const server=createProverServer({serviceMode:'query-only',privateQuery,proofsEnabled:true,origins:[]});resources.push(()=>server.closeAndDrain());
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return 'http://127.0.0.1:'+server.address().port;
  }
  const mainEndpoint=await gateway(main),coldEndpoint=await gateway(cold);
  observer=installRollingColdTransportObserver({mainEndpoint,coldEndpoint});
  const post=async(lane,body)=>{const response=await fetch((lane==='main'?mainEndpoint:coldEndpoint)+'/v1/node',{method:'POST',headers:{'content-type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
  return {main,cold,observer,state,post,coldEndpoint,async close(){try{await closeRollingResources(resources.reverse().map((close,i)=>['owner'+i,close]),{});}finally{await observer.close();}}};
 }catch(error){try{await closeRollingResources(resources.reverse().map((close,i)=>['owner'+i,close]),{});}finally{if(observer)await observer.close();}throw error;}
}
const coldTestTag='0x'+'01'.padStart(64,'0');
test('actual separate HTTP lanes retain concurrent writer tag totals while accepting a tag-free cold reader',async()=>{
 let entered,release;const seen=new Promise(r=>entered=r),held=new Promise(r=>release=r);
 const f=await attributedHTTPFixture({node:{getBlockNumber:async()=>7,async getPrivateLogsByTags(){entered();await held;return [[]];},getPublicLogsByTags:async()=>[[]]}});
 let writer;
 try{writer=f.post('main',[coldTestCall('aztec_getPrivateLogsByTags',[{tags:[coldTestTag]}]),{...coldTestCall('aztec_getPublicLogsByTags',[{contractAddress:coldTestTag,tags:[coldTestTag]}]),id:2}]);
  await seen;const read=await f.post('cold',coldTestCall('aztec_getBlockNumber'));assert.equal(read.body.result,7);
  assert.equal(rollingColdAttributedSnapshot(f.observer,f.cold,0).privateTags,0);
  assert.equal(f.observer.snapshot().main.pending,1);assert.equal(f.observer.snapshot().cold.pending,0);
  release();assert.equal((await writer).status,200);await coldTestTick();
  const evidence=rollingColdTransportEvidence(f.observer,f.main,f.cold,0);
  assert.equal(evidence.attempted.main.privateTags,1);assert.equal(evidence.attempted.main.publicTags,1);assert.equal(evidence.totalNative.privateTags,1);assert.equal(evidence.totalNative.publicTags,1);
  assert.equal(evidence.coldNative.privateTags,0);assert.equal(evidence.coldNative.publicTags,0);assert.equal(evidence.attempted.total.privateTags,1);
 }finally{release();if(writer)await writer;await f.close();}
});
for(const fault of ['schema','readiness'])test('actual cold gateway '+fault+' rejection still records both tag attempts before native acceptance',async()=>{
 const f=await attributedHTTPFixture();try{
  if(fault==='readiness')f.state.ready=false;
  const params=fault==='schema'?[]:[{tags:[coldTestTag]}],publicParams=fault==='schema'?[]:[{contractAddress:coldTestTag,tags:[coldTestTag]}];
  const response=await f.post('cold',[coldTestCall('aztec_getPrivateLogsByTags',params),{...coldTestCall('node_getPublicLogsByTags',publicParams),id:2}]);
  assert.equal(response.status,fault==='schema'?400:503);await coldTestTick();
  assert.equal(f.cold.coldSnapshot().privateTags,0);assert.equal(f.cold.coldSnapshot().publicTags,0);
  assert.equal(f.observer.snapshot().cold.privateTags,1);assert.equal(f.observer.snapshot().cold.publicTags,1);assert.equal(f.observer.snapshot().cold.rejected,1);
  assert.throws(()=>rollingColdAttributedSnapshot(f.observer,f.cold,0));
 }finally{await f.close();}
});
test('actual query-only cold HTTP rejects a serialized SDK send before onSend/native and retains attempted denial',async()=>{
 const {Tx}=await import('@aztec-labs/stdlib/tx'),{jsonStringify}=await import('@aztec-labs/foundation/json-rpc');const tx=Tx.random();await tx.recomputeHash();let forwarded=0;
 const f=await attributedHTTPFixture({node:{sendTx(){forwarded++;}}});
 try{const response=await f.post('cold',jsonStringify(coldTestCall('aztec_sendTx',[tx])));assert(response.body.error);assert.equal(f.state.denied,1);assert.equal(f.state.onSend,0);assert.equal(forwarded,0);
  assert.equal(f.observer.snapshot().cold.sends,1);assert.throws(()=>rollingColdAttributedSnapshot(f.observer,f.cold,f.state.denied));
 }finally{await f.close();}
});
test('actual query-only cold HTTP rejects proof submission with no proof queue and retains attempted denial',async()=>{
 const f=await attributedHTTPFixture();try{const response=await fetch(f.coldEndpoint+'/v1/jobs',{method:'POST',body:'PRIVATE_NOT_A_PROOF'});assert.equal(response.status,404);await response.text();await coldTestTick();
  assert.equal(f.observer.snapshot().cold.proofRequests,1);assert.equal(f.observer.snapshot().cold.rejected,1);assert.throws(()=>rollingColdAttributedSnapshot(f.observer,f.cold,0));
 }finally{await f.close();}
});
test('native read close drains original SDK work after a disconnected HTTP caller',async()=>{
 let entered,release,closed=false;const seen=new Promise(r=>entered=r),held=new Promise(r=>release=r),abort=new AbortController();
 const rpc=await startNodeRpc({async getBlockNumber(){entered();await held;return 7;}});
 const sent=fetch(rpc.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(coldTestCall('aztec_getBlockNumber')),signal:abort.signal}).then(r=>r.text(),e=>e);
 let closing;try{await seen;abort.abort();await sent;assert.equal(rpc.pendingReads(),1);closing=rpc.close().then(()=>{closed=true;});await coldTestTick();assert(!closed);
  release();await closing;assert(closed);assert.equal(rpc.pendingReads(),0);
 }finally{abort.abort();release();await sent;if(closing)await closing;else await rpc.close();}
});
test('reorg fixture fixes a distinct cold route for initial actor and same-store reopen, with explicit query-only ownership',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes("node:role==='a-cold'?coldNode:node,endpoint:role==='a-cold'?coldEndpoint:endpoint"));
 const actor=await fs.readFile(new URL('./rolling-application-actor.mjs',import.meta.url),'utf8');assert(actor.includes('remoteProver:{url:endpoint,board:scope.board'));
 assert(source.includes("serviceMode:'query-only',host:'127.0.0.1',port:0,chainId:'31337',rollupVersion:String(info.rollupVersion)"));
 assert(source.includes("coldNode=await sdk.createTrustedPrivateNode({url:coldEndpoint+'/v1/node'"));
 assert.equal((source.match(/coldActor=await makeActor\(fees,'a-cold',undefined,undefined,true\)/g)||[]).length,2);
 assert(source.includes("serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false"));
 assert(source.includes("beforeForward:()=>{coldRejectedSends++;throw Error('Cold native send forbidden');}"));
 assert(source.includes('return rollingColdAttributedSnapshot(coldWire,coldRpc,coldRejectedSends)'));
 for(const owner of ['coldRecoveryActor','coldQuery','coldRPC','coldTransportCapture'])assert(source.includes("['"+owner+"'"));
 assert(source.indexOf("['coldQuery'")<source.indexOf("['coldRPC'"));assert(source.indexOf("['coldRPC'")<source.indexOf("['coldTransportCapture'"));
 assert(source.includes('if(report.passed)rollingColdAttributedSnapshot(coldWire,coldRpc,coldRejectedSends)'));
});

// Actual pinned rc3 NodeBlockProvider and response projection, with labelled
// finite public chain shapes behind its normal hold-off interface. No node,
// proof, private validator or genuine-chain acceptance is claimed here.
async function physicalOracleFixture() {
 const entry=import.meta.resolve('@aztec-labs/aztec-node');
 for(const [relative,hash] of [
  ['./modules/node_block_provider.js','ecb672ccf26aa1111cfc4954ec18fa8b6095ff9a3c6749650b61fd36ed582506'],
  ['./aztec-node/block_response_helpers.js','7f6eec7374600248005db7b9a75cf01dbe7bd513f1b8732c63e4570c3b457f77'],
  ['./modules/block_parameter.js','e0e2efb9d2ec4ba52b2a003ea46ce5bf2e635651d004857d6b9f90f8a49029cc']
 ])assert.equal(createHash('sha256').update(await fs.readFile(new URL(relative,entry))).digest('hex'),hash);
 const {NodeBlockProvider}=await import(new URL('./modules/node_block_provider.js',entry).href);
 const hash='0x'+'11'.repeat(32),calls=[],state={guards:0,metadata:0,change:()=>{}};
 const blocks=new Map([[],[1,9]].map((lengths,i)=>{const number=i+1;return [number,{number,header:{getBlockNumber:()=>number},archive:{},checkpointNumber:1,indexWithinCheckpoint:i,body:{txEffects:lengths.map(length=>({privateLogs:Array.from({length},()=>({}))}))},hash:async()=>hash}];}));
 const holdOff={
  async getBlock(query){assert.equal(this,holdOff);calls.push(['full',query.number]);return blocks.get(query.number);},
  async getBlockData(query){assert.equal(this,holdOff);calls.push(['metadata',query.number]);state.metadata++;const block=blocks.get(query.number);const result=block&&{...block,blockHash:hash};state.change(result,state.metadata);return result;}
 };
 const provider=new NodeBlockProvider({},holdOff);
 const node={
  getBlock(number,options){assert.equal(this,node);calls.push(['request',number,options]);return provider.getBlock(number,options);},
  getBlockData(number){assert.equal(this,node);return provider.getBlockData(number);}
 };
 const contextGuard=()=>{state.guards++;if(state.failGuard===state.guards)throw state.guardError;};
 return {provider,node,blocks,state,calls,read:createRollingColdPhysicalPageOracle({node,contextGuard}),request:{fromBlock:1,anchor:{blockNumber:2,blockHash:hash},deadlineAt:Date.now()+10000}};
}
test('actual rc3 default block metadata reproduces the physical oracle failure; explicit transactions supplies the body',async()=>{
 const f=await physicalOracleFixture(),metadata=await f.provider.getBlock(1);
 assert.equal(Object.hasOwn(metadata,'body'),false);assert.throws(()=>countRollingColdPhysicalPages(metadata));
 const full=await f.provider.getBlock(1,{includeTransactions:true});assert.equal(full.body,f.blocks.get(1).body);assert.equal(countRollingColdPhysicalPages(full),1);
});
test('actual-used physical oracle requests complete bodies in order between canonical and context checks',async()=>{
 const f=await physicalOracleFixture();assert.equal(await f.read(f.request),4);assert.equal(f.state.guards,2);
 assert.deepEqual(f.calls,[['metadata',2],['request',1,{includeTransactions:true}],['full',1],['request',2,{includeTransactions:true}],['full',2],['metadata',2]]);
});
for(const kind of ['missing-block','missing-body','wrong-header','missing-header','oversized-logs','oversized-effects'])test(`actual-used physical oracle rejects ${kind} through pinned rc3 full response`,async()=>{
 const f=await physicalOracleFixture(),block=f.blocks.get(1);
 if(kind==='missing-block')f.blocks.delete(1);
 if(kind==='missing-body')delete block.body;
 if(kind==='wrong-header')block.header.getBlockNumber=()=>77;
 if(kind==='missing-header')delete block.header;
 if(kind==='oversized-logs')block.body.txEffects=[{privateLogs:Array(65).fill({})}];
 if(kind==='oversized-effects')block.body.txEffects=Array(6144).fill({privateLogs:[]});
 await assert.rejects(f.read(f.request));assert.equal(f.state.guards,1);assert.equal(f.state.metadata,1);
 assert.deepEqual(f.calls.filter(x=>x[0]==='request'),[['request',1,{includeTransactions:true}]]);
});
for(const when of ['before','after'])test(`actual-used physical oracle rejects ${when} canonical anchor change`,async()=>{
 const f=await physicalOracleFixture();f.state.change=(result,n)=>{if(n===(when==='before'?1:2))result.blockHash='0x'+'22'.repeat(32);};
 await assert.rejects(f.read(f.request));assert.equal(f.state.guards,1);
 assert.equal(f.calls.filter(x=>x[0]==='full').length,when==='before'?0:2);
});
test('actual-used physical oracle retains deadline before any body request',async()=>{
 const f=await physicalOracleFixture();f.request.deadlineAt=0;await assert.rejects(f.read(f.request));assert.deepEqual(f.calls,[['metadata',2]]);assert.equal(f.state.guards,1);
});
for(const guard of [1,2])test(`actual-used physical oracle preserves falsy context failure at guard ${guard}`,async()=>{
 const f=await physicalOracleFixture();f.state.failGuard=guard;f.state.guardError=0;let failed=false;
 try{await f.read(f.request);}catch(error){failed=true;assert.equal(error,0);}assert(failed);assert.equal(f.state.guards,guard);assert.equal(f.state.metadata,guard===1?0:2);
});
test('actual-used physical oracle preserves original node rejection without a retry or partial count',async()=>{
 const f=await physicalOracleFixture(),failure=Error('labelled public fixture failure');let calls=0;
 f.node.getBlock=function(number,options){assert.equal(this,f.node);assert.equal(number,1);assert.deepEqual(options,{includeTransactions:true});calls++;return Promise.reject(failure);};
 await assert.rejects(f.read(f.request),error=>error===failure);assert.equal(calls,1);assert.equal(f.state.metadata,1);assert.equal(f.state.guards,1);
});

// Actual-used accounting only; no real chain or cryptographic proof is claimed.
for(const proofsEnabled of [false,true])test(`social-wire proof accounting preserves exact mode ${proofsEnabled}`,()=>{
 const expected=proofsEnabled?6:0,jobs={submitted:expected,completed:expected,failed:0,running:false};
 assertRollingSocialWireProofJobs(jobs,proofsEnabled);
 for(const key of ['submitted','completed'])for(const value of [expected+1,expected-1])assert.throws(()=>assertRollingSocialWireProofJobs({...jobs,[key]:value},proofsEnabled));
 assert.throws(()=>assertRollingSocialWireProofJobs({...jobs,failed:1},proofsEnabled));
 assert.throws(()=>assertRollingSocialWireProofJobs({...jobs,running:true},proofsEnabled));
});
test('social-wire proof accounting rejects nonboolean configuration',()=>{
 for(const mode of [undefined,null,0,1,'disabled','real',{},[]])assert.throws(()=>assertRollingSocialWireProofJobs({submitted:0,completed:0,failed:0,running:false},mode));
});
test('social-wire actual wiring scopes disabled accounting and preserves transaction and fee acceptance',async()=>{
 const source=await fs.readFile(new URL('./rolling-application-fixture.mjs',import.meta.url),'utf8');
 assert(source.includes('if(socialWire)socialWireProofsEnabled=real;'));
 assert(source.includes('if(socialWire)assertRollingSocialWireProofJobs(report.proverJobs,socialWireProofsEnabled);'));
 assert(source.includes('assertRollingWireCampaign(report.wire,{proofsEnabled:socialWire?socialWireProofsEnabled:true})'));
 assert(source.includes("else if(social){const expectedJobs=subboards?2:scenario==='anonymous-thread'?3:multi?6:4;"));
 assert(source.includes('await fees.verify(feeTotal,feesB.browserFixture.fundedAmount-bStandalone-feeTotalB)'));
 assert(source.includes('await feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal)'));
 const social=await fs.readFile(new URL('./rolling-social-wire.mjs',import.meta.url),'utf8');
 assert(social.includes('privateTransactions:6,registeredNames:2'));
 assert(social.includes('expectedHTTP:httpViews(projection,posts,posts.slice(0,2),[a,b])'));
});

// Existing real miner mode selection, no chain/network in these controls.
test('Bok application consumer selects real-wall mining with the original absolute deadline only',async()=>{
 const {privateBokMiningOptions}=await import('./private-bok-fixture.mjs');
 const deadlineAt=Date.now()+10000,ctx={scenario:{name:'rolling-bok-post'},applicationDeadlineAt:deadlineAt};
 assert.deepEqual(privateBokMiningOptions(ctx,()=>{}),{mode:'real-wall',deadlineAt});
 assert.deepEqual(privateBokMiningOptions({},undefined),{mode:'warped'});
 for(const bad of [{...ctx,scenario:{name:'private-bok-uncertain'}},{...ctx,applicationDeadlineAt:0},{...ctx,applicationDeadlineAt:NaN}])assert.throws(()=>privateBokMiningOptions(bad,()=>{}));
 assert.throws(()=>privateBokMiningOptions(ctx,true));
});
test('Bok application port rejects proofs and nonlocal scope before resource acquisition',async()=>{
 const {createRollingBokApplicationPort}=await import('./rolling-application-fixture.mjs');
 await assert.rejects(createRollingBokApplicationPort({proofsEnabled:true,network:{chainId:'31337'}}));
 await assert.rejects(createRollingBokApplicationPort({proofsEnabled:false,network:{chainId:'1'}}));
});
