// TEST ONLY. Parent owns C01/node/L1 and the 540s/4GiB supervisor. This consumer
// owns sequential setup/application scopes of the existing miner (never overlapping),
// two HTTP adapters and its private wallet state.
// No fake node, proof, freshness, receipt, event or production factory is injected.
import assert from 'node:assert/strict';
import {capturePublicFeeStandalone} from '../private-fee-evidence.mjs';
import {createRollingPrivateRecoveryMetrics,RECOVERY_METRIC_METHODS} from './rolling-private-recovery-metrics.mjs';
import {classifyT03PublicFootprint} from '../t03-public-footprint.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createConnection} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n';
// Public history/cache checks do not consume the actor's private store. Run
// those unchanged bounded checks first only for the bounded cold-reader lane;
// its private recovery retains the same checkpoint, deadline and final accounting.
export async function runRollingPublicRecoveryChecks({boundedCold,recoverPrivate,verifyPublic}){
  assert.equal(typeof boundedCold,'boolean');
  assert.equal(typeof recoverPrivate,'function');assert.equal(typeof verifyPublic,'function');
  if(boundedCold){await verifyPublic();await recoverPrivate();}
  else{await recoverPrivate();await verifyPublic();}
}
export const rollingTrustedProofThreads=scenario=>['notification-browser','preference-browser','preference-reorg-initial','preference-reorg-marker'].includes(scenario)?2:1;
// Reversible admission allowances, rounded above the measured a189 two-thread
// actions (30.048s / 39.612s / 28.869s), reads and handoff. Not time guarantees.
// The separate actual 150s browser admission gate remains authoritative.
export function rollingBrowserFollowingAdmission({now,deadlineAt,nextAllowedTime}) {
  assert(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(deadlineAt));
  assert(typeof nextAllowedTime==='bigint'&&nextAllowedTime>=0n&&nextAllowedTime<=BigInt(Math.floor(Number.MAX_SAFE_INTEGER/1000)));
  const allowances={followMs:35000,initialReadMs:3000,rootMs:45000,bookmarkMs:35000,incrementalReadMs:3000,handoffMs:3000};
  const postingDelayMs=Math.max(0,Number(nextAllowedTime)*1000-now);
  const extraEligibilityMs=Math.max(0,postingDelayMs-allowances.followMs-allowances.initialReadMs);
  const requiredBeforeBrowserMs=Object.values(allowances).reduce((a,b)=>a+b,0)+extraEligibilityMs;
  const remainingMs=deadlineAt-now,browserReserveMs=150000;
  return {admitted:remainingMs>=requiredBeforeBrowserMs+browserReserveMs,remainingMs,postingDelayMs,extraEligibilityMs,requiredBeforeBrowserMs,browserReserveMs,allowances};
}
const discard=()=>{};
const silent=Object.assign(discard,Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k=>[k,discard])),
  {level:'silent',isLevelEnabled:()=>false,getBindings:()=>({}),createChild:()=>silent});
const PERSONAL=['feePayer','publicCallSenders','publicCallTargets','publicCallCalldata','publicWriteSlots','publicWriteValues','publicLogContracts','publicLogFields'];
const SOURCES=['shared/rolling/cold-preference-reader.mjs','shared/rolling/compact-client.mjs','shared/rolling/compact-block.mjs','prover/compact-block-native.mjs','scripts/patch-pxe-preference-page.mjs','scripts/private-fee-evidence.mjs','scripts/w01-private-fee-standalone.mjs','scripts/testing/rolling-private-recovery-metrics.mjs','scripts/testing/rolling-notification-fixture.mjs','scripts/testing/rolling-notification-browser.mjs','scripts/testing/rolling-notification-acceptance.mjs','scripts/testing/rolling-preference-saved.mjs','scripts/testing/rolling-preference-reorg.mjs','scripts/testing/rolling-preference-browser-fixture.mjs','scripts/testing/rolling-preference-browser.mjs','scripts/testing/rolling-preference-recovery.mjs','shared/rolling/preference-reader.mjs','shared/rolling/preference-events.mjs','shared/rolling/preferences.mjs','scripts/testing/rolling-rejected-withdrawal.mjs','scripts/application-post.mjs','scripts/c01-settle-application-message.mjs','scripts/c01-withdraw-l1.mjs','scripts/t04-browser-journey-verify.mjs','scripts/testing/rolling-subboard-acceptance.mjs','scripts/testing/rolling-name-collision.mjs','scripts/testing/rolling-collision-observer.mjs','scripts/testing/rolling-trusted-recovery.mjs','scripts/testing/rolling-social-wire.mjs','scripts/testing/rolling-wire-campaign.mjs','scripts/testing/rolling-wire-trace.mjs','scripts/testing/rolling-owned-names.mjs','scripts/t03-public-footprint.mjs','scripts/testing/rolling-removed-like.mjs','scripts/testing/rolling-application-actor.mjs','scripts/testing/rolling-account-reactions.mjs','scripts/testing/rolling-social-acceptance.mjs','scripts/testing/rolling-profile-acceptance.mjs','experiments/avatar/raster-fixture.mjs','scripts/prove-application-action.mjs','scripts/testing/rolling-native-artifacts.mjs','scripts/testing/rolling-application-fixture.mjs','scripts/testing/scenarios.mjs','scripts/testing/scenario-flows.mjs',
  'scripts/c01-real-node.mjs','scripts/c01-board-flow.mjs','scripts/c01-deposit-flow.mjs','scripts/c01-client-mining.mjs',
  'scripts/w01-private-fee-flow.mjs','scripts/testing/private-fee-verification.mjs','scripts/w01-unfunded-wallet.mjs','scripts/w01-private-funding.mjs',
  'shared/sdk-entry.mjs','shared/private-pxe.mjs','shared/trusted-private-node.mjs','shared/routed-kernel-prover.mjs','shared/remote-prover-client.mjs',
  'shared/rolling/application.mjs','shared/rolling/synchronized-application.mjs','shared/rolling/public-events.mjs','shared/rolling/public-projection.mjs',
  'shared/private-fee-client.mjs','shared/private-fee-estimation.mjs','shared/private-fee-simulation.mjs','shared/l2-journal.mjs','shared/journal-record.mjs',
  'shared/sdk-store.mjs','shared/transaction-outcomes.mjs','apps/src/billboard/user/engine.js','apps/src/billboard/user/transaction-journal-store.mjs',
  'prover/process-worker.mjs','prover/worker.mjs','prover/worker-native-profile.mjs','prover/service.mjs','prover/server.mjs','prover/private-query.mjs','prover/catalog.mjs','prover/rolling-artifacts.mjs','prover/rolling-artifacts.json',
  'apps/src/billboard/private_fee_artifact.json',
  'scripts/testing/rolling-public-acceptance.mjs','shared/rolling/public-index.mjs','shared/public-feed-file-storage.mjs','shared/public-feed-storage.mjs',
  'scripts/rolling-public-server.mjs','apps/rolling/start.mjs','apps/rolling/reader-client.mjs',
  'toolchain.json','package-lock.json'];

// Small pure acceptance seams; unit fixtures are explicitly development-only.
export function classifyRollingApplicationFootprint({tx,effect,owner,otherOwner,payer,board}){
  return classifyT03PublicFootprint({tx,effect,roles:{author:owner,...(otherOwner?{otherAuthor:otherOwner}:{}),sharedPayer:payer,board}});
}
// Test-only bounded summary, never private choices, headers, keys or errors.
// Await the original read exactly once; observation does not drive recovery.
export function observeRollingColdRead(read) {
  assert.equal(typeof read,'function');
  const state={calls:0,pending:0,completed:0,failed:0,lastStep:null};
  return Object.freeze({snapshot:()=>structuredClone(state),async read(options){
    const call=++state.calls,started=performance.now();state.pending++;
    const step={call,elapsedMs:0,returned:false,complete:null,progress:null};
    try{
      const value=await read(options);step.returned=true;
      const descriptors=value&&typeof value==='object'?Object.getOwnPropertyDescriptors(value):{};
      step.complete=typeof descriptors.complete?.value==='boolean'?descriptors.complete.value:null;
      const p=descriptors.progress?.value;
      if(p&&typeof p==='object'){
        const progress={};
        for(const key of ['nextBlock','anchorBlock','markersChecked','markersTotal']){
          const d=Object.getOwnPropertyDescriptor(p,key);
          if(d&&'value'in d&&(d.value===null||Number.isSafeInteger(d.value)&&d.value>=0))progress[key]=d.value;
        }
        step.progress=progress;
      }
      state.completed++;return value;
    }catch(error){state.failed++;throw error;}
    finally{state.pending--;step.elapsedMs=Math.round(performance.now()-started);state.lastStep=step;}
  }});
}
export async function persistRollingRecoveryObservation(persist,recoveryFailed,recoveryError) {
  try{await persist();}catch(error){
    if(recoveryFailed)throw new AggregateError([recoveryError,error],'Recovery and measurement persistence failed');
    throw error;
  }
}
// Keep every failure in RAM, including falsy thrown values. A truthy aggregate
// also prevents legacy lifecycle catch blocks from mistaking false for success.
// Mandatory native drain and fixed diagnostics each run once; none can hide the
// original financial outcome or trigger a second send.
export async function settleRollingRootOverlap({run,drain,snapshot,observation,persist}) {
  const errors=[];let result;
  observation.passed=false;
  try{result=await run();}catch(error){errors.push(error);}
  try{observation.native=await drain();assert.equal(observation.native.pending,0);observation.nativeDrained=true;}
  catch(error){observation.nativeDrained=false;errors.push(error);}
  try{Object.assign(observation,snapshot());observation.snapshotCaptured=true;}
  catch(error){observation.snapshotCaptured=false;errors.push(error);}
  observation.passed=errors.length===0;
  try{await persist();}catch(error){observation.passed=false;errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'Root overlap or owned cleanup failed');
  return result;
}
export function recordRollingFundingFailure(report,role,observation){
  assert(role===undefined||role==='a'||role==='b');
  assert(observation&&typeof observation==='object');
  const key=role==='a'?'privateFees':role==='b'?'secondPrivateFees':null;
  if(key&&!Object.hasOwn(report,key))report[key]=observation;
  // Never replace completed public funding history when a later role fails.
  report.fundingFailure={role:role??'unattributed',observation};
}
// One-shot setup action: save intent before invoking the real claim and keep any
// paid partial result on failure. No retry, new wallet, or alternate funding path.
export async function claimRollingDeferredPrivateFees({funding,claim,persist}) {
  assert(funding&&typeof funding==='object'&&!Object.hasOwn(funding,'standalone'));
  assert.equal(typeof claim,'function');assert.equal(typeof persist,'function');
  funding.standalone={passed:false,outcome:'unverified',attempted:true};
  await persist(); // A failed write must prevent the financial operation.
  let failed=false,failure;
  try {
    const observed=await claim();
    const captured=capturePublicFeeStandalone(observed);
    const proofMilliseconds=captured?Object.getOwnPropertyDescriptor(observed,'proofMilliseconds')?.value:undefined;
    if(captured)funding.standalone={...captured,attempted:true,
      ...(Number.isSafeInteger(proofMilliseconds)&&proofMilliseconds>=0?{proofMilliseconds}:{})};
    assert.equal(funding.standalone.passed,true);
  }catch(error){
    failed=true;failure=error;
    const partial=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'privateFeeStandaloneObservation')?.value:undefined;
    const captured=capturePublicFeeStandalone(partial);
    if(captured)funding.standalone={...captured,attempted:true};
  }
  try{await persist();}catch(error){if(failed)throw new AggregateError([failure,error],'Standalone claim and evidence persistence failed');throw error;}
  if(failed)throw failure;
}
export function assertRollingApplicationViews(projection,{nameId,subboardId,rootId,replyId}) {
  const root=projection.post(rootId),reply=projection.post(replyId);
  assert.equal(projection.postCount,2);
  assert(root&&reply);assert.equal(root.text,'A real application root');assert.equal(reply.text,'A real application reply');
  assert.equal(root.record.name_id,nameId);assert.equal(reply.record.name_id,nameId);
  assert.equal(root.record.subboard,subboardId);assert.equal(reply.record.subboard,subboardId);
  assert.equal(root.record.kind,'1');assert.equal(reply.record.kind,'1');
  assert.equal(root.record.parent,'0');assert.equal(root.record.root,rootId);
  assert.equal(reply.record.parent,rootId);assert.equal(reply.record.root,rootId);
  assert.equal(root.bot,null);assert.equal(reply.bot,null);assert.equal(reply.likes,'1');
  const thread=projection.thread(rootId,{limit:100}),profile=projection.profile(nameId,{limit:100}),directory=projection.directory({limit:100});
  assert.deepEqual(thread.posts.map(p=>p.id),[rootId,replyId]);assert.equal(thread.nextCursor,null);
  assert.deepEqual(profile.posts.map(p=>p.id),[replyId,rootId]);assert.deepEqual(profile.identity,{id:nameId,first:'River',last:'Stone',profile:{bio:{version:'0',digest:'0',length:'0',text:''},avatar:{version:'0',digest:'0',width:'0',height:'0',length:'0',encoding:'base64',data:'',removal:null}}});
  assert.equal(directory.boards.length,1);assert.equal(directory.boards[0].id,subboardId);
  assert.equal(directory.boards[0].slug,'application-test');assert.equal(directory.boards[0].rejected,false);
  assert.equal(directory.boards[0].mainRules,'No threats.');assert.equal(directory.boards[0].rules,'Be helpful.');
  return {feed:projection.feed({limit:100}),thread,profile,directory};
}
export function assertRollingPublicFootprint(row) {
  assert.equal(row.sharedFeePayer,true);
  for(const category of PERSONAL)assert.equal(row.rolePresence[category].author,false,category);
  assert(row.counts.publicDataWrites<=63);
}
export async function closeRollingResources(steps,observation) {
  const errors=[];
  for(const [name,close] of steps)try{await close();observation[name]=true;}catch(error){observation[name]=false;errors.push(error);}
  if(errors.length)throw new AggregateError(errors,'Rolling fixture cleanup failed');
}
// Public, bounded diagnostic only. It never supplies a clock override, accepts a
// failed readiness gate, or serializes an SDK error/response into evidence.
// Preserve financial evidence on a partial pending-barrier failure as well as
// the happy path. collect is a read-only, bounded canonical read for one started
// actor; a failed read must not suppress the other actor's collection attempt.
export async function collectRollingRaceOutcomes({count,collect,priorErrors=[]}){
 assert(Number.isSafeInteger(count)&&count>=0&&count<=2);assert.equal(typeof collect,'function');
 const observed=[],errors=[...priorErrors];
 for(let i=0;i<count;i++)try{observed[i]=await collect(i);}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,'Race failed; retain every available canonical outcome');
 return observed;
}
// No timeout races around writers: actor-owned confirmation/proof deadlines
// settle the original operation before any outcome collection or actor disposal.
export async function settleRollingRaceWriters({submissions,resume,priorErrors=[]}){
 assert(Array.isArray(submissions)&&submissions.length<=2);assert.equal(typeof resume,'function');
 const errors=[...priorErrors];
 // Attach to every writer before resuming, including an unexpected rejection.
 const settlement=Promise.allSettled(submissions);
 try{await resume();}catch(error){errors.push(error);}
 for(const result of await settlement)if(result.status==='rejected')errors.push(result.reason);
 return errors;
}
export function requireRollingRaceProofBudget(confirmationDeadlineAt,now=Date.now()){
 assert(Number.isSafeInteger(confirmationDeadlineAt)&&Number.isSafeInteger(now));
 // Admission allowance only, not a proof deadline or a cancellation promise.
 // The actual prover retains120s; a proof finishing after the cutoff is blocked
 // by the actor's beforeSubmit guard, with its proved journal kept for recovery.
 assert(confirmationDeadlineAt-now>=90000,'Insufficient remaining race proof budget');
}
export function assertClosedCollisionObserver(observation,matched){
 assert.equal(observation.closed,true);assert.equal(observation.restored,true);
 for(const key of ['pending','errors','truncated','conflicts','ownershipLost'])assert.equal(observation[key],0,key);
 assert(observation.calls>=2&&observation.observations>=2&&observation.classified>=1);
 assert.equal(observation.metadataEnabled,observation.calls);assert.equal(observation.metadataRestored,observation.calls);
 assert.equal(observation.reasonAbsent,0);assert.equal(observation.reasonNotSimulationError,0);assert.equal(observation.classifierRejected,0);
 assert.equal(matched,true,'Canonical loser no longer matches the closed observer');
}
export function rollingClockDeadline({now,chainSeconds,campaignDeadlineAt}) {
  assert(Number.isSafeInteger(now)&&Number.isSafeInteger(campaignDeadlineAt)&&campaignDeadlineAt>now);
  assert(typeof chainSeconds==='bigint'&&chainSeconds>=0n&&chainSeconds<=BigInt(Math.floor(Number.MAX_SAFE_INTEGER/1000)));
  // Controlled settlement can lead wall time by more than a fixed 110 seconds.
  // Wait for the measured prerequisite, keeping the absolute campaign limit and
  // 180 seconds of application headroom. Never alter node clocks or freshness.
  const deadline=Math.max(now,Number(chainSeconds)*1000)+2000;
  assert(deadline<=campaignDeadlineAt-180000,'Insufficient campaign budget for natural clock catchup and application');
  return deadline;
}
export async function observeRollingReadiness({node,network,proofsEnabled,endpoint},inspect) {
  const row={wallSeconds:Math.floor(Date.now()/1000),timestampAvailable:false,inspectorCode:'UNOBSERVED'};
  try{
    const stamp=await node.getSyncedL1Timestamp();
    if(typeof stamp==='bigint'&&stamp>=0n&&stamp<=BigInt(Number.MAX_SAFE_INTEGER)){
      row.syncedL1Timestamp=String(stamp);row.wallSeconds=Math.floor(Date.now()/1000);
      row.lagSeconds=row.wallSeconds-Number(stamp);row.timestampAvailable=true;
    }
  }catch{}
  try{await inspect(node,{expectedNetworkScope:network,proofsEnabled});row.inspectorCode='READY';}
  catch(error){const code=error?.code;row.inspectorCode=['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE'].includes(code)?code:'UNCLASSIFIED';}
  if(endpoint)try{
    const url=new URL(endpoint);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.protocol,'http:');assert(!url.username&&!url.password);
    const response=await fetch(new URL('/healthz',url),{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(3000)});
    row.health={status:response.status};
    const reader=response.body.getReader();let length=0;const chunks=[];
    try{for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16384)throw Error('Bounded health');chunks.push(value);}}
    finally{await reader.cancel();}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(typeof value.ready==='boolean')row.health.ready=value.ready;
    if(['real','disabled'].includes(value.proofs))row.health.proofs=value.proofs;
    if(typeof value.query?.enabled==='boolean')row.health.queryEnabled=value.query.enabled;
    if(typeof value.query?.ready==='boolean')row.health.queryReady=value.query.ready;
    if(['busy','unavailable'].includes(value.query?.reason))row.health.queryReason=value.query.reason;
  }catch{row.healthUnavailable=true;}
  return row;
}
async function closedPort(port) {
  await new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Listener cleanup unknown'));});
    socket.once('connect',()=>{socket.destroy();reject(Error('Listener still open'));});
    socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(Error('Listener cleanup unknown')));
  });
}
// Failure-campaign acceptance keeps intentional rejection separate from missing
// or failed observations. No rows are discarded to reuse a positive-only gate.
export function assertRollingRecoveryWire(observation,recovery){
  assert.equal(recovery?.passed,true);
  const denial=recovery.personalizedDenial;
  assert.equal(denial?.denied,1);assert.equal(denial.forwarded,0);
  for(const key of ['getNodeInfo','getSyncedL1Timestamp'])assert(Number.isSafeInteger(denial.readiness[key])&&denial.readiness[key]>0);
  assert.equal(recovery.afterReadiness.length,1);
  const failed=recovery.afterReadiness[0];assert.equal(failed.kind,'personalized');assert.equal(failed.code,'BB_TRUSTED_NODE_UNAVAILABLE');
  for(const key of ['failedClosed','ciphertextPreserved','noProofOrSubmission','noPublicFallback'])assert.equal(failed.checks[key],true);
  for(const key of ['pending','unknown','unsupported','truncated','observerErrors'])assert.equal(observation[key],0,key);
  assert.equal(observation.receiver.errors,0);assert(observation.requests>0);assert.equal(observation.requests,observation.completed);
  let intentionalRejections=0;const personalizedRequests={'trusted-query':0,'trusted-upstream':0};
  for(const label of ['trusted-query','trusted-proof','trusted-upstream','ordinary-node','public-reader']){
    const rows=observation.rows.filter(row=>row.label===label),sent=rows.reduce((n,row)=>n+row.count,0);
    assert(sent>0);assert.equal(observation.receiver.requests[label],sent);
    for(const row of rows){
      assert.equal(row.outcome,'resolved');
      if(row.status===503){assert.equal(row.phase,'outage');assert(['trusted-query','trusted-upstream'].includes(label));intentionalRejections+=row.count;}
      else assert(row.status>=200&&row.status<300);
      // The installed SDK sends a singleton batch. Its per-call JSON-RPC error
      // travels with HTTP 200: semantic denial comes from the parent's actual
      // one-shot fault/readiness/no-forward counters and captured client error.
      if(row.phase==='personalized-denial'&&row.methods?.includes('aztec_getContract')){
        assert(Object.hasOwn(personalizedRequests,label));assert.deepEqual(row.methods,['aztec_getContract']);
        assert.equal(row.status,200);assert.equal(row.count,1);assert.deepEqual(row.roles,['a']);personalizedRequests[label]+=row.count;
      }
      if(['ordinary-node','public-reader'].includes(label))assert.deepEqual(row.roles,[]);
    }
  }
  assert(intentionalRejections>=2);assert.deepEqual(personalizedRequests,{'trusted-query':1,'trusted-upstream':1});
  for(const role of ['a','b'])assert(observation.rows.some(row=>row.label==='trusted-query'&&row.roles.includes(role)));
  assert.equal(observation.privacyAcceptance,'not-evaluated');
  return {passed:true,intentionalRejections,personalizedRejections:denial.denied,personalizedRequests,scope:'Explicit unavailable/stale transport failures and semantic personalized rejection plus bounded request/receiver reconciliation. Not complete transport or deployed privacy qualification.'};
}

// Observes forwarded public methods at the existing server boundary only. The
// window can include service-readiness reads; this is not unique actor traffic.
// No serialization or private SDK state is inspected and no request is added.
export function forwardRecoveryObservedNodeCall(node,name,args,metrics){
  const original=node[name];
  const call=metrics&&RECOVERY_METRIC_METHODS.includes(name)?metrics.wrapNode(name,original):original;
  return Reflect.apply(call,node,args);
}
// Count complete physical log pages, not matched private preferences. Native
// TxEffect rejects empty/padded logs; each transaction is paged separately by8.
export function countRollingColdPhysicalPages(block) {
  const effects=block?.body?.txEffects;assert(Array.isArray(effects)&&effects.length<=6143);
  let pages=0;for(const effect of effects){assert(Array.isArray(effect.privateLogs)&&effect.privateLogs.length<=64);pages+=Math.ceil(effect.privateLogs.length/8);}
  return Math.max(1,pages);
}
// The pinned node defaults to metadata-only responses. Request the real body
// explicitly; this independent workload oracle is not private-event authority.
export function createRollingColdPhysicalPageOracle({node,contextGuard}) {
  return async({fromBlock,anchor,deadlineAt})=>{
    contextGuard();
    const before=await node.getBlockData(anchor.blockNumber);assert.equal(String(before?.blockHash),anchor.blockHash);
    let pages=0;
    for(let number=fromBlock;number<=anchor.blockNumber;number++){
      assert(Date.now()<deadlineAt);
      const block=await node.getBlock(number,{includeTransactions:true});assert(block);assert.equal(block.header.getBlockNumber(),number);
      pages+=countRollingColdPhysicalPages(block);
    }
    assert.equal(String((await node.getBlockData(anchor.blockNumber))?.blockHash),anchor.blockHash);contextGuard();return pages;
  };
}
// Harness-only observation of actual outbound serialized requests. Two fixed
// gateway origins separate batchers; no caller role, header or private argument
// is used for attribution. Like the existing wire campaign, restore only our
// own fetch wrapper after its original promises have settled.
export function installRollingColdTransportObserver({mainEndpoint,coldEndpoint}) {
  const origin=value=>{assert.equal(typeof value,'string');const u=new URL(value);assert.equal(u.origin,value);assert.equal(u.protocol,'http:');assert.equal(u.hostname,'127.0.0.1');assert(u.port);return u.origin;};
  const endpoints=new Map([[origin(mainEndpoint),'main'],[origin(coldEndpoint),'cold']]);assert.equal(endpoints.size,2);
  const empty=()=>({requests:0,nodeRequests:0,compactRequests:0,proofRequests:0,privateTags:0,publicTags:0,sends:0,errors:0,rejected:0,pending:0});
  const counts={main:empty(),cold:empty()},original=globalThis.fetch,pending=new Set();let closed=false;
  const add=(row,key)=>{assert(row[key]<Number.MAX_SAFE_INTEGER);row[key]++;};
  function inspect(input,init){
    const address=typeof input==='string'?input:input instanceof URL?input.href:input instanceof Request?input.url:null;
    if(address===null)return;
    const url=new URL(address),lane=endpoints.get(url.origin);if(!lane)return;
    const row=counts[lane];add(row,'requests');
    try{
      assert(typeof input==='string'&&!url.search&&!url.hash&&!url.username&&!url.password);
      const method=init?.method??'GET';
      if(url.pathname==='/v1/node'&&method==='POST'){
        add(row,'nodeRequests');assert(typeof init.body==='string'&&Buffer.byteLength(init.body)<=8*1024*1024);
        const parsed=JSON.parse(init.body),batch=Array.isArray(parsed)?parsed:[parsed];assert(batch.length>0);if(batch.length>8)add(row,'errors');
        for(const item of batch){if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.method!=='string'){add(row,'errors');continue;}
          if(['aztec_getPrivateLogsByTags','node_getPrivateLogsByTags'].includes(item.method))add(row,'privateTags');
          if(['aztec_getPublicLogsByTags','node_getPublicLogsByTags'].includes(item.method))add(row,'publicTags');
          if(['aztec_sendTx','node_sendTx'].includes(item.method))add(row,'sends');
        }
      }else if(url.pathname==='/v1/compact-block'&&method==='POST')add(row,'compactRequests');
      else if(url.pathname==='/v1/jobs'&&method==='POST')add(row,'proofRequests');
      else assert(method==='GET'&&(url.pathname==='/healthz'||/^\/v1\/jobs\/[a-f0-9]{64}$/.test(url.pathname)));
    }catch{add(row,'errors');}
    return row;
  }
  function wrapped(...args){
    let row;try{row=inspect(...args);}catch{add(counts.cold,'errors');}
    let result;try{result=Reflect.apply(original,this,args);}catch(error){if(row)add(row,'rejected');throw error;}
    if(row){add(row,'pending');const work=Promise.resolve(result);pending.add(work);
      const done=()=>{row.pending--;pending.delete(work);};
      work.then(response=>{try{if(response.status>=400)add(row,'rejected');}catch{add(row,'errors');}finally{done();}},()=>{try{add(row,'rejected');}finally{done();}}).catch(()=>{});
    }
    return result;
  }
  globalThis.fetch=wrapped;
  return Object.freeze({snapshot(){const main={...counts.main},cold={...counts.cold},total={};for(const key of Object.keys(main)){total[key]=main[key]+cold[key];assert(Number.isSafeInteger(total[key]));}return {main,cold,total};},
    async close(){if(closed)return;await Promise.allSettled([...pending]);await Promise.resolve();assert.equal(pending.size,0);assert.equal(globalThis.fetch,wrapped,'Fetch owner changed');globalThis.fetch=original;closed=true;},
  });
}
export function rollingColdTransportEvidence(observer,main,cold,rejectedSends) {
  const mainNative=main.coldSnapshot(),coldNative=cold.coldSnapshot(),totalNative={};
  for(const key of Object.keys(mainNative)){totalNative[key]=mainNative[key]+coldNative[key];assert(Number.isSafeInteger(totalNative[key]));}
  return {attempted:observer.snapshot(),mainNative,coldNative,totalNative,coldRejectedSends:rejectedSends};
}
export function rollingColdAttributedSnapshot(observer,native,rejectedSends) {
  const attempted=observer.snapshot().cold,accepted=native.coldSnapshot();
  for(const key of ['privateTags','publicTags','sends','proofRequests','errors','rejected','pending'])assert.equal(attempted[key],0,'Forbidden cold request or unsettled transport');
  assert.equal(rejectedSends,0);assert.equal(accepted.privateTags,0);assert.equal(accepted.publicTags,0);
  assert.equal(native.pendingReads(),0);
  return {...accepted,privateTags:attempted.privateTags,publicTags:attempted.publicTags};
}
export async function startNodeRpc(node,onSend=()=>{},{faults=false,recoveryMetrics=()=>undefined,compactBlocks,beforeForward}={}) {
  assert(beforeForward===undefined||typeof beforeForward==='function');const requestScope=new AsyncLocalStorage(),pendingSends=new Set(),pendingReads=new Set();
  const ownSend=value=>{const work=Promise.resolve(value);pendingSends.add(work);work.then(()=>pendingSends.delete(work),()=>pendingSends.delete(work));return value;};
  const drainSends=async()=>{await Promise.allSettled([...pendingSends]);return {pending:pendingSends.size};};
  const ownRead=value=>{const work=Promise.resolve(value);pendingReads.add(work);work.then(()=>pendingReads.delete(work),()=>pendingReads.delete(work));return value;};
  let fault='healthy',deniedTransaction,closing=false;const diagnostic={unavailableRequests:0,personalizedDenied:0,sendDenied:0,forwarded:{}};
  const setFault=value=>{assert(faults&&['healthy','unavailable','personalized-once','send-before-forward'].includes(value));fault=value;};
  const {createNamespacedSafeJsonRpcServer}=await import('@aztec-labs/foundation/json-rpc/server');
  const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
  const api=Object.fromEntries(Object.keys(AztecNodeApiSchema).map(name=>[name,(...args)=>{
    if(closing)throw Error('Native RPC closing');
    if(fault==='personalized-once'&&name==='getContract'){fault='healthy';diagnostic.personalizedDenied++;throw Error('Controlled upstream unavailable');}
    // Keep this fault armed until explicit recovery. An HTTP client's retry must
    // never accidentally turn an intentionally unsent signed transaction into
    // a submitted one. Preserve the real decoded SDK transaction for evidence.
    if(fault==='send-before-forward'&&name==='sendTx'){diagnostic.sendDenied++;deniedTransaction=args[0];throw Error('Controlled upstream unavailable');}
    if(name==='sendTx'&&beforeForward){
      const result=beforeForward(args[0],requestScope.getStore());
      // A malformed asynchronous fence cannot forward or leave an unhandled
      // rejection. Retain the RPC operation until its returned work settles.
      if(result!==undefined)return ownSend(Promise.resolve(result).then(()=>{throw Error('Forward fence must be synchronous');}));
    }
    diagnostic.forwarded[name]=(diagnostic.forwarded[name]??0)+1;if(name==='sendTx')onSend(args[0]);
    const result=forwardRecoveryObservedNodeCall(node,name,args,recoveryMetrics());return name==='sendTx'&&beforeForward?ownSend(result):name!=='sendTx'?ownRead(result):result;
  } ]));
  const rpc=createNamespacedSafeJsonRpcServer({aztec:[api,AztecNodeApiSchema]},
    {maxBatchSize:8,maxBodySizeBytes:8*1024*1024,corsAllowedOrigins:[],log:silent});
  let compact;const pendingCompact=new Set();const compactDiagnostic={requests:0,accepted:0,failures:0};
  if(compactBlocks!==undefined){
    assert.deepEqual(Object.keys(compactBlocks).sort(),['expectedNetworkScope','proofsEnabled','tier']);
    const {createCompactBlockNativeAdapter}=await import('../../prover/compact-block-native.mjs');
    compact=createCompactBlockNativeAdapter({node,...compactBlocks});
  }
  const callback=rpc.getApp().callback();
  const server=http.createServer((req,res)=>{
    if(closing){req.destroy();return;}
    if(compact&&req.url==='/rolling/compact-block-v1'){
      if(fault==='unavailable'){diagnostic.unavailableRequests++;res.writeHead(503);res.end();return;}
      compactDiagnostic.requests++;
      res.once('finish',()=>{if(res.statusCode===200)compactDiagnostic.accepted++;else compactDiagnostic.failures++;});
      const work=compact.handle(req,res);pendingCompact.add(work);
      work.then(()=>pendingCompact.delete(work),()=>{pendingCompact.delete(work);compactDiagnostic.failures++;res.destroy();});return;
    }
    if(req.method!=='POST'||req.url!=='/'||req.headers.origin!==undefined||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){res.writeHead(403);res.end();return;}
    if(fault==='unavailable'){diagnostic.unavailableRequests++;res.writeHead(503);res.end();return;}
    requestScope.run(()=>req.complete&&!req.aborted&&!res.destroyed&&!res.writableEnded&&!req.socket.destroyed,()=>callback(req,res));
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
  catch(error){server.close();server.closeAllConnections();throw error;}
  const port=server.address().port;
  return {url:`http://127.0.0.1:${port}/`,drainSends,pendingReads:()=>pendingReads.size,coldSnapshot:()=>({...compactDiagnostic,pending:pendingCompact.size,privateTags:diagnostic.forwarded.getPrivateLogsByTags??0,publicTags:diagnostic.forwarded.getPublicLogsByTags??0}),compactSnapshot:()=>({...compactDiagnostic,pending:pendingCompact.size}),...(faults?{setFault,snapshot:()=>structuredClone(diagnostic),deniedTransaction:()=>deniedTransaction}:{}),close:async()=>{
    closing=true;const compact=[...pendingCompact],reads=[...pendingReads];
    const settled=await Promise.allSettled([new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();}),...compact,...reads]);
    await drainSends();assert.equal(pendingReads.size,0);await closedPort(port);
    const errors=settled.slice(0,1+compact.length).filter(row=>row.status==='rejected').map(row=>row.reason);if(errors.length)throw new AggregateError(errors,'Native RPC cleanup failed');
  }};
}

// Native ESM cannot import the browser aggregate's initSync WASM re-exports.
// Compose only real pinned exports; all provenance is still owned by the actual
// production factories, not by this fixture facade.
export async function loadRollingFixtureSDK() {
  const modules=await Promise.all([
    import('@aztec-labs/aztec.js/contracts'),import('@aztec-labs/aztec.js/fields'),
    import('@aztec-labs/aztec.js/addresses'),import('@aztec-labs/aztec.js/abi'),
    import('@aztec-labs/aztec.js/wallet'),import('@aztec-labs/wallet-sdk/base-wallet'),
    import('@aztec-labs/accounts/schnorr'),import('@aztec-labs/stdlib/keys'),
    import('@aztec-labs/foundation/crypto/poseidon'),
    import('@aztec-labs/stdlib/contract'),import('@aztec-labs/stdlib/tx'),import('@aztec-labs/stdlib/gas'),
    import('../../shared/private-pxe.mjs'),import('../../shared/trusted-private-node.mjs'),
    import('../../shared/sdk-store.mjs'),import('../../shared/private-fee-client.mjs'),
    import('../../shared/private-fee-estimation.mjs'),import('../../shared/l2-journal.mjs'),
    import('../../shared/transaction-outcomes.mjs'),import('@aztec-labs/stdlib/abi'),
  ]);
  return Object.assign({},...modules);
}

// Reuse the production-branded actor for the two existing Bok user operations.
// Parent owns real chain/miner/funding and keeps this nonserializable handle in RAM.
export async function createRollingBokApplicationPort({node,network,board,bok,fees,portal,directory,deadlineAt,proofsEnabled,observation}) {
  assert.equal(proofsEnabled,false,'This development journey must disable native proofs');assert.equal(String(network.chainId),'31337');
  let adapter,rpc,service,actor,restoreIndexedDB,closed;const cleanup={};
  const close=()=>closed??=(async()=>{await closeRollingResources([
    ['actor',()=>actor?.close()],['service',()=>service?.close()],['rpc',()=>rpc?.close()],
    ['indexedDB',()=>restoreIndexedDB?.()],['artifacts',()=>{if(adapter){try{adapter.verify();}finally{adapter.close();}}}]],cleanup);})();
  try {
    const {installRollingNativeArtifacts}=await import('./rolling-native-artifacts.mjs');adapter=installRollingNativeArtifacts();
    const sdk=await loadRollingFixtureSDK();await import('../../apps/src/billboard/user/engine.js');const routing=globalThis.BillboardPrivateFeeRouting;
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    const {startProverService}=await import('../../prover/service.mjs');
    let sends=0;rpc=await startNodeRpc(node,()=>{sends++;},{beforeForward:()=>{}});
    service=await startProverService({host:'127.0.0.1',port:0,chainId:network.chainId,rollupVersion:network.version,
      applicationProfile:'rolling',board:String(board.instance.address),privateBokAddress:bok.config.contractAddress,
      privateFeeAddress:String(fees.browserFixture.instance.address),proofs:'disabled',origins:[],threads:1,
      queueDirectory:directory,queryNode:{url:rpc.url,rollupAddress:network.rollup,maxLagSeconds:120}});
    const endpoint=`http://127.0.0.1:${service.address.port}`;
    const trusted=await sdk.createTrustedPrivateNode({url:endpoint+'/v1/node',expectedNetworkScope:network,proofsEnabled,allowLocalDev:true});
    const idb=await import('fake-indexeddb'),keys=Object.keys(idb).filter(k=>k.startsWith('IDB')||k==='indexedDB');
    const previous=keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
    restoreIndexedDB=()=>{for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];};
    for(const key of keys)Object.defineProperty(globalThis,key,{value:key==='indexedDB'?new idb.IDBFactory():idb[key],writable:true,configurable:true});
    const {createRollingApplicationActor}=await import('./rolling-application-actor.mjs');const storageDirectory=path.join(directory,'application-journal');
    actor=await createRollingApplicationActor({sdk,routing,node:trusted,endpoint,network,proofsEnabled,board,bok,fees,portal,
      storageDirectory,dataDirectory:path.join(directory,'application-pxe'),confirmationDeadlineAt:deadlineAt,
      externalActivity:()=>({proofJobs:service.stats().submitted,transportSends:sends})});
    const {createEncryptedJournalSlot}=await import('../../shared/journal-record.mjs');
    const {createFileJournalStorage}=await import('../../apps/src/billboard/user/transaction-journal-store.mjs');
    const scope={account:String(actor.owner),...network,board:String(board.instance.address),portal:portal.toLowerCase()};
    const slot=await createEncryptedJournalSlot({storage:createFileJournalStorage(storageDirectory),walletSecret:String(fees.authorAccount.secret),walletSalt:String(fees.authorAccount.salt),
      scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',sdk.l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
    return Object.freeze({actor,close,async readWorkflow(){actor.contextGuard();const saved=await slot.read();actor.contextGuard();assert(saved.value?.bok);return saved.value;},
      observe(){const stats=service.stats();assert.deepEqual(stats,{jobs:0,bytes:0,running:false,submitted:0,completed:0,failed:0});Object.assign(observation,{applicationActor:true,proofsEnabled:false,proofJobs:stats.submitted,transportSends:sends,cleanup});},
      toJSON(){throw Error('Private Bok application handle cannot be serialized');}});
  }catch(error){try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Bok application setup and cleanup failed');}throw error;}
}

export async function createRollingEvidenceDirectory(root) {
  const parent=path.join(root,'execution/evidence/G06');
  await fs.mkdir(parent,{recursive:true,mode:0o700});
  const directory=path.join(parent,'application-port-'+randomUUID());
  await fs.mkdir(directory,{mode:0o700});
  return directory;
}

// Join the browser observer to the independent native receiver. Public counters
// only; a browser PASS alone cannot establish compact delivery or cold privacy.
export function assertRollingBrowserCompactAcceptance(browser,native,windows){
  const check=value=>{if(!value)throw Error('Cold browser transport acceptance failed');};
  check(browser?.passed===true&&[1,4].includes(windows));
  const cold=browser.coldRecovery,traffic=browser.traffic;
  check(cold&&traffic&&native);
  for(const value of [cold.windows,cold.compactRequests,cold.tagDiscoveryRequests,traffic.compactRequests,native.requests,native.accepted,native.failures,native.pending])check(Number.isSafeInteger(value)&&value>=0);
  check(cold.windows===windows&&cold.tagDiscoveryRequests===0);
  check(cold.compactRequests>=(windows===4?2:1)&&cold.compactRequests<=traffic.compactRequests);
  check(native.failures===0&&native.pending===0&&native.requests===native.accepted&&native.accepted===traffic.compactRequests);
  return {passed:true,windows,coldCompactRequests:cold.compactRequests,compactRequests:traffic.compactRequests,nativeAccepted:native.accepted,tagDiscoveryRequests:0};
}

// Actual-used accounting for the explicitly configured social-wire scenario.
// Disabling proving never changes transaction, fee or public-effect acceptance.
export function assertRollingSocialWireProofJobs(jobs,proofsEnabled) {
  assert.equal(typeof proofsEnabled,'boolean');
  const expected=proofsEnabled?6:0;
  assert.equal(jobs.submitted,expected);assert.equal(jobs.completed,expected);
  assert.equal(jobs.failed,0);assert.equal(jobs.running,false);
}

export async function runRollingApplicationFixture(ctx,scenario='conversation') {
  assert(['conversation','profiles','anonymous-thread','repost-reactions','account-reactions','owned-names','owned-names-wire','composer','social-wire','reaction-wire','trusted-recovery','name-race','subboard-policy','rejected-subboard-withdrawal','preference-relationships','preference-notifications','preference-browser','preference-reorg-initial','preference-reorg-marker','preference-saved','notification-browser'].includes(scenario));
  const boundedCold=['preference-relationships','preference-browser','notification-browser','preference-reorg-initial','preference-reorg-marker'].includes(scenario);
  const notificationBrowser=scenario==='notification-browser';
  const preferenceSaved=scenario==='preference-saved',preferenceBrowser=scenario==='preference-browser',preferenceReorg=['preference-reorg-initial','preference-reorg-marker'].includes(scenario),markerReorg=scenario==='preference-reorg-marker';
  const preferences=['preference-relationships','preference-notifications','preference-browser','preference-reorg-initial','preference-reorg-marker','preference-saved','notification-browser'].includes(scenario);
  const rejectedWithdrawal=scenario==='rejected-subboard-withdrawal',subboards=scenario==='subboard-policy',race=scenario==='name-race',recovery=scenario==='trusted-recovery',composer=scenario==='composer',socialWire=scenario==='social-wire',reactionWire=scenario==='reaction-wire',wireSocial=socialWire||reactionWire,captureWire=scenario==='owned-names-wire'||wireSocial||recovery,names=['owned-names','owned-names-wire','composer'].includes(scenario),multi=notificationBrowser||scenario==='account-reactions'||names||wireSocial||recovery||race||subboards,social=['anonymous-thread','repost-reactions','account-reactions'].includes(scenario)||wireSocial||subboards||rejectedWithdrawal;
  const bokEnabled=!(preferenceBrowser||preferenceReorg);
  const {ROOT,assertNodeVersion,assertAztecPackages}=await import('../toolchain.mjs');
  const directory=await createRollingEvidenceDirectory(ROOT);
  const report={schemaVersion:1,scenario,passed:false,stage:'preflight',transactions:[],cleanup:{},
    scope:race?'Actual simultaneous normalized-name registration with canonical winner/revert, private ownership rollback and both paid fees':names?'Actual separate private accounts registering and recovering readable owned names without publishing owner groups':social?'Actual anonymous social transactions and canonical removal/repost/reaction reconstruction':scenario==='profiles'?'Actual private profile updates and public moderator removal; fixed test moderation decision, no image-model acceptance':'Actual funded application port and authenticated public projection; human threaded reply, no composite Bok action',
    networkProofs:false,controlledPortalSettlement:true,privacyAcceptance:'Public-field equality checks only; independent privacy qualification remains',
    storage:{pxe:'Actual SDK store with CLI in-memory IndexedDB adaptation; no browser persistence claim',journal:'Real authenticated encrypted file journals; reopen measured'},
    sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()};
  const save=()=>fs.writeFile(path.join(directory,'observation.json'),json(report),{mode:0o600});
  const recordSetupClock=async stage=>{
    const block=await ctx.l1Client.getBlock({blockTag:'latest'}),wallSeconds=Math.floor(Date.now()/1000);
    assert(typeof block.number==='bigint'&&typeof block.timestamp==='bigint'&&block.number>=0n&&block.timestamp>=0n&&block.timestamp<=BigInt(Number.MAX_SAFE_INTEGER));
    (report.setupClock??=[]).push({stage,wallSeconds,l1Block:String(block.number),l1Timestamp:String(block.timestamp),leadSeconds:Number(block.timestamp)-wallSeconds});
  };
  const mark=async stage=>{if(ctx.applicationDeadlineAt!==undefined)assert(Date.now()<ctx.applicationDeadlineAt,'Parent campaign budget exhausted');report.stage=stage;ctx.mark?.('rolling-application:'+stage);
    if(!bokEnabled&&['private-fee-funding','collateral-claim','bok-capability-disabled','real-wall-clock-readiness'].includes(stage))await recordSetupClock(stage);
    await save();};
  const sourceBinding=async()=>Object.fromEntries(await Promise.all(SOURCES.map(async name=>[name,sha(await fs.readFile(path.join(ROOT,name)))])));
  let fees,feesB,actorA,actorB,coldActor,coldRpc,coldService,coldNode,coldEndpoint,coldWire,coldRejectedSends=0,rootOverlap,activeActor,pxe,rpc,service,failure,restoreIndexedDB,nativeArtifacts,owner,appWallet,journal;
  let coldRecoveryMetrics,socialWireProofsEnabled;
  let wire,ordinaryRpc,completeTrustedRecovery,collisionObserver,withdrawalCompletion,completePreferenceReorg,pausePreferenceBoundary;
  let transportSends=0,feeTotalB=0n,fundingRole,collateralRole;
  let feeTotal=0n;const accounted=new Set();
  const accountFee=(hash,fee,other=false)=>{if(!accounted.has(hash)){assert(BigInt(fee)>0n);if(other)feeTotalB+=BigInt(fee);else feeTotal+=BigInt(fee);accounted.add(hash);}report.actualHumanFees=String(feeTotal+feeTotalB);};
  try {
    assertNodeVersion();assertAztecPackages();assert.equal(ctx.preparation.boardProfile,'rolling');
    assert(ctx.settlement.passed&&ctx.settlement.activation.depositsEnabled);
    assert(path.isAbsolute(ctx.directory));
    assert(Number.isSafeInteger(ctx.applicationDeadlineAt)&&ctx.applicationDeadlineAt>Date.now(),'Explicit remaining parent campaign deadline required');
    const {applicationProofsEnabled}=await import('./proof-policy.mjs');
    const real=applicationProofsEnabled();report.applicationProofs=real;report.proofMode=real?'real':'proofs-disabled';if(socialWire)socialWireProofsEnabled=real;
    const info=await ctx.node.getNodeInfo();assert.equal(info.l1ChainId,31337);assert.equal(info.realProofs,real);
    const network={chainId:'31337',version:String(info.rollupVersion),rollup:String(ctx.rollupAddress).toLowerCase()};
    assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),network.rollup);report.network=network;
    report.sourceHashes=await sourceBinding();
    const {checkedC01BoardArtifact}=await import('../c01-board-flow.mjs');
    const checked=await checkedC01BoardArtifact('rolling');report.artifactHashes=checked.artifactHashes;
    const {ARTIFACT,MANIFEST,buildInputs}=await import('../../experiments/private-bok/build.mjs');
    const bokBytes=await fs.readFile(ARTIFACT),manifest=JSON.parse(await fs.readFile(MANIFEST));
    assert.deepEqual(manifest.inputs,buildInputs());assert.equal(sha(bokBytes),manifest.artifactSha256);
    report.bokArtifactSha256=manifest.artifactSha256;report.bokBuildInputs=manifest.inputs;
    const {installRollingNativeArtifacts}=await import('./rolling-native-artifacts.mjs');
    nativeArtifacts=installRollingNativeArtifacts();report.nativeArtifacts=nativeArtifacts.observation();await save();
    const sdkModule=await loadRollingFixtureSDK();
    await import('../../apps/src/billboard/user/engine.js');
    const routing=globalThis.BillboardPrivateFeeRouting;
    const sdk={...sdkModule,isPrivateWalletForNode:routing.isPrivateWalletForNode};
    const savedCalls={estimates:0,payments:0};
    if(preferenceSaved)for(const [method,key]of [['estimatePrivateFeeTransaction','estimates'],['preparePrivateFeePayment','payments']]){const original=sdk[method];assert.equal(typeof original,'function');sdk[method]=function(...args){savedCalls[key]++;return original.apply(this,args);};}
    const {Fr,Contract,TxHash,loadContractArtifact}=sdk;
    const {TxStatus}=await import('@aztec-labs/stdlib/tx');
    const bokRaw=JSON.parse(bokBytes);assert.equal(bokRaw.name,'PrivateBok');assert.equal(bokRaw.transpiled,true);
    assert(bokRaw.functions.filter(fn=>fn.custom_attributes?.includes('abi_private')).every(fn=>fn.verification_key));
    const {prepareW01PrivateFees}=await import('../w01-private-fee-flow.mjs');
    const {depositAndClaimC01}=await import('../c01-deposit-flow.mjs');
    const {withC01ClientMining}=await import('../c01-client-mining.mjs');
    const {drainT04Checkpoints,createT04CheckpointScope}=await import('../u01-browser-flow.mjs');
    const {proveApplicationAction}=await import('../prove-application-action.mjs');
    const {startProverService}=await import('../../prover/service.mjs');
    const {createRollingEventDecoder,isRollingEvent}=await import('../../shared/rolling/public-events.mjs');
    const {createRollingProjection}=await import('../../shared/rolling/public-projection.mjs');
    let claim,claimB,bokInstance;report.setupMining={};
    await withC01ClientMining({rpcUrl:ctx.config.l1RpcUrls[0],dateProvider:ctx.dateProvider,observation:report.setupMining},async mineL1=>{
      await mark('private-fee-funding');
      fundingRole='a';fees=await prepareW01PrivateFees({...ctx,rpcUrl:ctx.config.l1RpcUrls[0],mineL1,standalone:!multi,
        fundingDirectory:path.join(ctx.directory,'rolling-app-funding'),reportStage:ctx.mark});
      report.privateFees=fees;owner=fees.authorAccount.address;
      if(multi){fundingRole='b';feesB=await prepareW01PrivateFees({...ctx,rpcUrl:ctx.config.l1RpcUrls[0],mineL1,standalone:!socialWire&&!notificationBrowser,fundingDirectory:path.join(ctx.directory,'rolling-app-funding-b'),reportStage:ctx.mark});report.secondPrivateFees=feesB;assert(!feesB.authorAccount.address.equals(owner));assert(feesB.browserFixture.instance.address.equals(fees.browserFixture.instance.address));}
      fundingRole=undefined;const setupWallet=fees.browserFixture.wallet;
      await mark('collateral-claim');
      collateralRole='a';claim=await depositAndClaimC01({...ctx,node:setupWallet.aztecNode,rpcUrl:ctx.config.l1RpcUrls[0],mineL1,reportStage:ctx.mark,
        authorAccount:fees.authorAccount,claimWallet:setupWallet,payerMode:'private',privateFeeAction:fees.privateFeeAction});
      report.collateral=claim;accountFee(claim.claimTxHash,claim.fee);await save();assert(claim.passed);
      collateralRole=undefined;
      if(notificationBrowser){
        // Both bridge preparations already captured the same initial pool. Start
        // A's collateral cooldown before B's genuine fee-only claim, so useful
        // sequential proving can overlap eligibility without changing clocks.
        await mark('second-private-fee-claim');
        const {proveAndIncludePrivateFeeStandalone}=await import('../w01-private-fee-standalone.mjs');
        await claimRollingDeferredPrivateFees({funding:feesB,persist:save,
          claim:()=>proveAndIncludePrivateFeeStandalone({wallet:feesB.browserFixture.wallet,owner:feesB.authorAccount.address,
            privateFeeAction:feesB.privateFeeAction,node:feesB.browserFixture.wallet.aztecNode,mineL1,mark:ctx.mark})});
      }
      if(socialWire){
        await mark('second-collateral-claim');collateralRole='b';
        const {createWalletClient,http,publicActions}=await import('viem'),{generatePrivateKey,privateKeyToAccount}=await import('viem/accounts');
        const account=privateKeyToAccount(generatePrivateKey());
        assert.notEqual(account.address.toLowerCase(),ctx.l1Client.account.address.toLowerCase());
        // Fresh local-only depositor; never reuse A's occupied portal deposit.
        const value=10n**18n;report.secondDepositorFunding={value:String(value),submission:'outcome unknown'};await save();
        const hash=await ctx.l1Client.sendTransaction({to:account.address,value});report.secondDepositorFunding.txHash=hash;await save();
        const receipt=await ctx.l1Client.waitForTransactionReceipt({hash,timeout:60000});
        Object.assign(report.secondDepositorFunding,{status:receipt.status,gasUsed:String(receipt.gasUsed),effectiveGasPrice:String(receipt.effectiveGasPrice)});await save();assert.equal(receipt.status,'success');
        const depositor=createWalletClient({account,chain:ctx.l1Client.chain,transport:http(ctx.config.l1RpcUrls[0],{retryCount:0})}).extend(publicActions),wallet=feesB.browserFixture.wallet;
        claimB=await depositAndClaimC01({...ctx,l1Client:depositor,node:wallet.aztecNode,rpcUrl:ctx.config.l1RpcUrls[0],mineL1,reportStage:ctx.mark,
          authorAccount:feesB.authorAccount,claimWallet:wallet,payerMode:'private',privateFeeAction:feesB.privateFeeAction});
        report.secondCollateral=claimB;accountFee(claimB.claimTxHash,claimB.fee,true);await save();assert(claimB.passed);
        assert.notEqual(claim.claim.depositor,claimB.claim.depositor);assert.notEqual(String(claim.claim.depositChainId),String(claimB.claim.depositChainId));collateralRole=undefined;
      }

      if(bokEnabled){
      await mark('deploy-unused-bok-scope');
      const operator=ctx.preparation.account.address;
      const deployment=Contract.deploy(setupWallet,loadContractArtifact(bokRaw),[ctx.instance.address,operator,new Fr(31337n),new Fr(BigInt(info.rollupVersion))],
        'init',{salt:Fr.random(),deployer:operator});
      bokInstance=await deployment.getInstance();
      const {tx:bokTx}=await proveApplicationAction({wallet:setupWallet,owner:operator,interaction:deployment,payerMode:'genesis'});
      const bokHash=bokTx.getTxHash();
      const intent=await fs.open(path.join(directory,'bok-deployment-intent.json'),'wx',0o600);
      try{await intent.writeFile(json({txHash:String(bokHash),purpose:'Actual constructor-only prover allowlist scope; unused by five actions'}));await intent.sync();}finally{await intent.close();}
      await ctx.node.sendTx(bokTx);
      let receipt;const includeDeadline=Math.min(Date.now()+60000,ctx.applicationDeadlineAt);
      do{receipt=await ctx.node.getTxReceipt(bokHash);assert.notEqual(receipt.status,TxStatus.DROPPED);
        if(['checkpointed','proven','finalized'].includes(receipt.status))break;await mineL1();}while(Date.now()<includeDeadline);
      assert(['checkpointed','proven','finalized'].includes(receipt.status));assert.equal(receipt.executionResult,'success');
      assert.equal(String((await ctx.node.getBlockData(receipt.blockNumber)).blockHash),String(receipt.blockHash));
      const actualBok=await ctx.node.getContract(bokInstance.address);assert(actualBok);
      assert.equal(String(actualBok.currentContractClassId),String(bokInstance.currentContractClassId));
      report.bok={enabled:true,deployed:true,address:String(bokInstance.address),txHash:String(bokHash),used:false};await save();
      }else{
        report.bok={enabled:false,deployed:false,used:false};
        await mark('bok-capability-disabled');
      }
      if(preferenceBrowser){
        // Capture the real pre-eligibility anchor; do not drive the setup clock
        // to a posting-only deadline before a fee-only preference can execute.
        const header=await setupWallet.pxe.getSyncedBlockHeader(),blockNumber=Number(header.globalVariables.blockNumber),blockHash=String(await header.hash());
        assert.equal(String((await ctx.node.getBlockData(blockNumber)).blockHash),blockHash);
        report.browserFollowing={preEligibilityAnchor:{blockNumber,blockHash,timestamp:String(header.globalVariables.timestamp)},
          setupPostingDelaySeconds:String(claim.claim.nextAllowedTime>header.globalVariables.timestamp?claim.claim.nextAllowedTime-header.globalVariables.timestamp:0n),eligibilityDeferred:true};
        await save();
      }else{
      await mark('collateral-eligibility');
      const checkpoints=createT04CheckpointScope(ctx.node.getSequencer()),eligibilityDeadline=Math.min(Date.now()+90000,ctx.applicationDeadlineAt);
      try{checkpoints.enable();
        while((await setupWallet.pxe.getSyncedBlockHeader()).globalVariables.timestamp<claim.claim.nextAllowedTime){
          assert(Date.now()<eligibilityDeadline);await mineL1();await setupWallet.pxe.sync();
        }
        report.eligibility=await drainT04Checkpoints({node:ctx.node,l1Client:ctx.l1Client,rollupAddress:network.rollup,checkpoints,deadline:eligibilityDeadline});
      }finally{checkpoints.restore();}
      }
    });
    assert.equal(report.setupMining.clientMining.stopped,true);assert.equal(report.setupMining.clientMining.passed,true);
    // Catch up AFTER controlled READY and funding setup; the setup miner has stopped. There is no mining loop
    // during this wait and no change to production clocks or maxLagSeconds.
    await mark('real-wall-clock-readiness');
    const clockStart=Date.now();let clockDeadline;
    report.clock={initialWallSeconds:Math.floor(clockStart/1000)};
    await ctx.node.getSequencer().pause();
    try {
      report.clock.initialSyncedL1Timestamp=String(await ctx.node.getSyncedL1Timestamp());
      clockDeadline=rollingClockDeadline({now:Date.now(),chainSeconds:BigInt(report.clock.initialSyncedL1Timestamp),campaignDeadlineAt:ctx.applicationDeadlineAt});
      report.clock.deadlineAt=clockDeadline;report.clock.applicationReserveMs=180000;await save();
      while(BigInt(Math.floor(Date.now()/1000))<await ctx.node.getSyncedL1Timestamp()) {
        assert(Date.now()<clockDeadline,'Fixture clock catchup exceeded remaining bounded budget');await sleep(250);
      }
      report.clock.ready=await sdk.inspectTrustedNode(ctx.node,{expectedNetworkScope:network,proofsEnabled:real});
      report.clock.elapsedMs=Date.now()-clockStart;
      if(!bokEnabled)await recordSetupClock('real-wall-ready');
      if(preferenceBrowser)report.browserFollowing.readiness={readyAt:Date.now(),wallSeconds:Math.floor(Date.now()/1000),syncedL1Timestamp:String(await ctx.node.getSyncedL1Timestamp()),catchupMs:report.clock.elapsedMs};
      await save();
    }finally{await ctx.node.getSequencer().start();}
    report.applicationMining={};
    await withC01ClientMining({rpcUrl:ctx.config.l1RpcUrls[0],dateProvider:ctx.dateProvider,observation:report.applicationMining,mode:'real-wall',deadlineAt:ctx.applicationDeadlineAt},async mineL1=>{
      report.readiness=[];
      let endpoint;
      const observe=async phase=>{report.readiness.push({phase,...await observeRollingReadiness({node:ctx.node,network,proofsEnabled:real,endpoint},sdk.inspectTrustedNode)});await save();};
      try{
      await observe('after-first-wall-mine');
      await mark('node-rpc-startup');
      const forwardedSaved=[];
      if(preferenceReorg){
        const {createRollingRootProofOverlap}=await import('./rolling-preference-recovery.mjs');
        rootOverlap=createRollingRootProofOverlap({stats:()=>service.stats(),contextGuard:()=>actorA.contextGuard()});
      }
      rpc=await startNodeRpc(ctx.node,tx=>{assert(transportSends<Number.MAX_SAFE_INTEGER);transportSends++;if(preferenceSaved||notificationBrowser){assert(forwardedSaved.length<(notificationBrowser?4:3));forwardedSaved.push(tx);};},{...(preferenceReorg?{beforeForward:(tx,live)=>rootOverlap.beforeForward(tx,live)}:{}),faults:recovery||preferenceSaved,recoveryMetrics:()=>coldRecoveryMetrics,...(boundedCold?{compactBlocks:{expectedNetworkScope:network,proofsEnabled:real,tier:'checkpointed'}}:{})});
      await mark('trusted-service-startup');
      const trustedProofThreads=rollingTrustedProofThreads(scenario);
      if(preferenceBrowser)assert.equal(process.env.C01_APPLICATION_BB_THREADS,'2','Browser application profile must match trusted worker');
      if(preferenceReorg)assert.equal(process.env.C01_APPLICATION_BB_THREADS,'2','Reorg application profile must match trusted worker');report.trustedProofThreads=trustedProofThreads;
      service=await startProverService({host:'127.0.0.1',port:0,board:String(ctx.instance.address),chainId:31337,rollupVersion:info.rollupVersion,
        ...(boundedCold?{compactBlocks:{tier:'checkpointed'}}:{}),applicationProfile:'rolling',...(bokEnabled?{privateBokAddress:String(bokInstance.address)}:{bokEnabled:false}),privateFeeAddress:String(fees.browserFixture.instance.address),
        proofs:real?'real':'disabled',origins:(composer||preferenceBrowser||notificationBrowser)?[ctx.browserControl.origin]:[],threads:trustedProofThreads,queueDirectory:ctx.directory,crsPath:process.env.CRS_PATH,
        queryNode:{url:rpc.url,rollupAddress:network.rollup,maxLagSeconds:120}});
      endpoint=`http://127.0.0.1:${service.address.port}`;
      if(preferenceReorg){
        coldRpc=await startNodeRpc(ctx.node,()=>{throw Error('Cold native send forbidden');},{
          compactBlocks:{expectedNetworkScope:network,proofsEnabled:real,tier:'checkpointed'},
          beforeForward:()=>{coldRejectedSends++;throw Error('Cold native send forbidden');}});
        coldService=await startProverService({serviceMode:'query-only',host:'127.0.0.1',port:0,chainId:'31337',rollupVersion:String(info.rollupVersion),
          proofs:'real',origins:[],compactBlocks:{tier:'checkpointed'},queryNode:{url:coldRpc.url,rollupAddress:network.rollup,maxLagSeconds:120}});
        assert.deepEqual(coldService.stats(),{serviceMode:'query-only',proofJobsEnabled:false,queueAllocated:false,workerAllocated:false});
        coldEndpoint=`http://127.0.0.1:${coldService.address.port}`;
        coldWire=installRollingColdTransportObserver({mainEndpoint:endpoint,coldEndpoint});
        coldNode=await sdk.createTrustedPrivateNode({url:coldEndpoint+'/v1/node',expectedNetworkScope:network,proofsEnabled:real,allowLocalDev:true});
      }
      if(captureWire){
        ordinaryRpc=await startNodeRpc(ctx.node);
        const {installRollingWireCampaign}=await import('./rolling-wire-campaign.mjs');
        wire=installRollingWireCampaign({roles:{a:String(owner),b:String(feesB.authorAccount.address)}});
        for(const [label,url]of [['trusted-query',endpoint],['trusted-proof',endpoint],['trusted-upstream',rpc.url],['ordinary-node',ordinaryRpc.url],['public-l1',ctx.config.l1RpcUrls[0]]])wire.registerEndpoint(label,url);
      }
      await observe('adapters-started');
      await mark('trusted-client-construction');
      // HTTP is authorized only for this asserted chain31337 loopback fixture;
      // transport permission is independent of the actual real-proof policy.
      const node=await sdk.createTrustedPrivateNode({url:endpoint+'/v1/node',expectedNetworkScope:network,proofsEnabled:real,allowLocalDev:true});
      await observe('trusted-client-created');
      await mark('application-pxe');
      // Existing CLI storage adaptation: account keys remain in memory. This is
      // not a browser persistence/recovery qualification or a fake chain adapter.
      const idb=await import('fake-indexeddb');
      const keys=Object.keys(idb).filter(k=>k.startsWith('IDB')||k==='indexedDB');
      const previous=keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]);
      restoreIndexedDB=()=>{for(const [key,descriptor] of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];};
      for(const k of keys)Object.defineProperty(globalThis,k,{value:k==='indexedDB'?new idb.IDBFactory():idb[k],writable:true,configurable:true});
      const {createRollingApplicationActor}=await import('./rolling-application-actor.mjs');
      const makeActor=(funding,role,dataDirectory='rolling-application-test-'+role,metrics,coldPreferences=false)=>createRollingApplicationActor({sdk,routing,node:role==='a-cold'?coldNode:node,endpoint:role==='a-cold'?coldEndpoint:endpoint,network,proofsEnabled:real,coldPreferences,...(metrics?{metrics}:{}),...(preferenceReorg&&role==='a'?{rootSubmissionGate:rootOverlap.capability}:{}),
        board:{instance:ctx.instance,artifact:checked.artifact},fees:funding,portal:ctx.ready.portalAddress,
        storageDirectory:path.join(ctx.directory,'rolling-application-journals-'+role),dataDirectory,
        ...(race?{confirmationDeadlineAt:ctx.applicationDeadlineAt-90000}:{}),
        log:discard,externalActivity:()=>({proofJobs:service.stats().submitted,transportSends})});
      actorA=await makeActor(fees,'a',undefined,undefined,preferenceReorg);activeActor=actorA;
      pxe=actorA.pxe;appWallet=actorA.wallet;journal=actorA.journal;let app=actorA.application;
      assert.equal((await app.readAccountStatus()).status,'fee-ready');
      if(multi){
        actorB=await makeActor(feesB,'b');const state=await actorB.application.readAccountStatus();
        // Persist only fixed readiness and numeric fee data before assertions so
        // a failed setup is diagnosable without leaking keys or account linkage.
        report.secondAccountReadiness={status:['fee-needed','collateral-pending','fee-ready'].includes(state.status)?state.status:'unexpected',
          privateFeeCredit:typeof state.privateFeeCredit==='string'&&/^[0-9]{1,78}$/.test(state.privateFeeCredit)?state.privateFeeCredit:null};await save();
        assert.equal(state.status,socialWire?'fee-ready':'collateral-pending');assert(BigInt(state.privateFeeCredit)>0n);
      }
      const decoder=await createRollingEventDecoder({artifact:checked.artifact,scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,
        boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)}});
      const projection=createRollingProjection({isValidatedEvent:isRollingEvent});
      const hashes=[ctx.inclusion.txHash];
      const initialEvents=await decoder.decodeTransaction(ctx.node,hashes[0]);
      assert.equal(initialEvents.length,1);assert.equal(initialEvents[0].type,'MainPolicyPublished');
      report.initialPublicAnchor=initialEvents[0].position;projection.stage(initialEvents).apply();
      const ids={},publicNameIds=[];const actorIntents=new Map(),withdrawalCaptures=new Map();
      async function action(input,type,selected=actorA) {
        activeActor=selected;const app=selected.application,journal=selected.journal;
        await mark(type);
        const row={action:type,startedAt:Date.now(),submission:'not attempted'};report.transactions.push(row);await save();
        const prepared=await app.prepare(input);actorIntents.set(selected,prepared.intentId);row.maximumFee=prepared.maximumFee;
        if(preferenceReorg&&type==='preference-root')rootOverlap.arm('ROLLING_WORKFLOW_V1:'+prepared.intentId);
        row.submission='outcome unknown';await save();
        const result=await app.submitPrepared(prepared.intentId);
        const outcome=await journal.inspectOutcome();assert(outcome?.receipt);
        const receipt=outcome.receipt,effect=await ctx.node.getTxEffect(TxHash.fromString(outcome.txHash));
        Object.assign(row,{txHash:outcome.txHash,status:receipt.status,executionResult:receipt.executionResult,blockNumber:Number(receipt.blockNumber),
          blockHash:String(receipt.blockHash),transactionFee:String(receipt.transactionFee),elapsedMs:Date.now()-row.startedAt});
        accountFee(outcome.txHash,receipt.transactionFee,activeActor===actorB);
        if(effect?.data){row.effectSha256=sha(effect.data.toBuffer());await fs.writeFile(path.join(directory,type+'-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});}
        await save(); // Keep actual included fees/effects before semantic acceptance.
        assert.equal(result.status,'confirmed');assert.equal(receipt.executionResult,'success');assert(BigInt(receipt.transactionFee)>0n);
        assert(effect?.data);assert.equal(String(effect.l2BlockHash),String(receipt.blockHash));assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
        const saved=await journal.assertCanStart();assert.equal(String(saved.tx.getTxHash()),outcome.txHash);
        row.publicFootprint=classifyRollingApplicationFootprint({tx:saved.tx,effect:effect.data,owner,otherOwner:actorB?.owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});
        await save();assertRollingPublicFootprint(row.publicFootprint);if(actorB)for(const category of PERSONAL)assert.equal(row.publicFootprint.rolePresence[category].otherAuthor,false);
        const events=await decoder.decodeTransaction(ctx.node,outcome.txHash);projection.stage(events).apply();hashes.push(outcome.txHash);
        for(const event of events)if(event.type==='NameRegistered')publicNameIds.push(event.payload.name_id);
        row.events=events.map(e=>e.type);row.submission='included';if(rejectedWithdrawal)withdrawalCaptures.set(outcome.txHash,{tx:saved.tx,receipt,effect:effect.data,events});await save();return events;
      }
      if(!social&&!names&&!race&&!preferences){
      const registered=await action({type:'name',first:'River',last:'Stone'},'name');
      assert.equal(registered.length,1);assert.equal(registered[0].type,'NameRegistered');ids.nameId=registered[0].payload.name_id;
      await mark('owned-name-recovery');
      report.ownedNameRecovery={beforeBlock:Number((await pxe.getSyncedBlockHeader()).globalVariables.blockNumber),requiredBlock:report.transactions.at(-1).blockNumber};
      const identities=await app.ownedIdentities();
      Object.assign(report.ownedNameRecovery,{afterBlock:Number((await pxe.getSyncedBlockHeader()).globalVariables.blockNumber),count:identities.identities.length,
        registeredNamePresent:identities.identities.some(v=>String(BigInt(v))===ids.nameId),nextCursor:identities.nextCursor});await save();
      assert(report.ownedNameRecovery.afterBlock>=report.ownedNameRecovery.requiredBlock);
      assert.deepEqual(identities.identities.map(v=>String(BigInt(v))),[ids.nameId]);assert.equal(identities.nextCursor,null);
      assert.deepEqual(identities.records.map(record=>({...record,id:String(BigInt(record.id))})),[{id:ids.nameId,first:'River',last:'Stone'}]);
      report.ownedNameRecovery.readableMetadataRecovered=true;await save();
      }
        async function moderate({kind,id,expectedVersion,mainVersion,localVersion=0,reason}){
          assert(['avatar','post','main-policy','subboard'].includes(kind));await mark(kind+'-moderation');const wallet=fees.browserFixture.wallet,operator=ctx.preparation.account.address;
          assert(!operator.equals(owner));await wallet.pxe.sync();
          const {getFeeJuiceBalance}=await import('@aztec-labs/aztec.js/utils');
          const before=await getFeeJuiceBalance(operator,ctx.node),bytes=Buffer.from(reason),packed=Array(kind==='main-policy'?32:7).fill(0n);
          assert(bytes.length>0&&bytes.length<=packed.length*31);
          for(let i=0;i<bytes.length;i++)packed[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));
          const row={submission:'not attempted',operatorIdentityPublic:true};report[kind+'Moderation']=row;await save();
          const methods=Contract.at(ctx.instance.address,checked.artifact,wallet).methods,reasonFields=packed.map(n=>new Fr(n));
          const interaction=kind==='main-policy'?methods.set_main_policy(reasonFields,bytes.length):kind==='subboard'?methods.reject_subboard(new Fr(BigInt(id)),reasonFields,bytes.length):kind==='avatar'?methods.remove_avatar(new Fr(BigInt(id)),expectedVersion,mainVersion,reasonFields,bytes.length):methods.remove_post(new Fr(BigInt(id)),mainVersion,localVersion,reasonFields,bytes.length);
          const {tx}=await proveApplicationAction({wallet,owner:operator,interaction,payerMode:'genesis'}),hash=tx.getTxHash();
          row.txHash=String(hash);row.submission='outcome unknown';
          const intent=await fs.open(path.join(directory,kind+'-moderation-intent.json'),'wx',0o600);
          try{await intent.writeFile(json({txHash:row.txHash,purpose:'Disposable public moderator removal; exactly one send'}));await intent.sync();}finally{await intent.close();}
          await save();await ctx.node.sendTx(tx);
          let receipt;const deadline=Math.min(Date.now()+60000,ctx.applicationDeadlineAt);
          do{receipt=await ctx.node.getTxReceipt(hash);assert.notEqual(receipt.status,TxStatus.DROPPED);
            if(['checkpointed','proven','finalized'].includes(receipt.status))break;await mineL1();}while(Date.now()<deadline);
          Object.assign(row,{status:receipt.status,executionResult:receipt.executionResult,blockNumber:receipt.blockNumber,blockHash:String(receipt.blockHash),transactionFee:String(receipt.transactionFee)});await save();
          assert(['checkpointed','proven','finalized'].includes(receipt.status));
          const effect=await ctx.node.getTxEffect(hash);assert(effect?.data);assert.equal(String(effect.l2BlockHash),String(receipt.blockHash));
          assert.equal(String((await ctx.node.getBlockData(receipt.blockNumber)).blockHash),String(receipt.blockHash));
          await fs.writeFile(path.join(directory,kind+'-moderation-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});row.effectSha256=sha(effect.data.toBuffer());
          Object.assign(row,{before:String(before),submission:'included'});await save();
          const after=await getFeeJuiceBalance(operator,ctx.node);
          row.after=String(after);await save();
          // Preserve actual inclusion and paid effects even when execution reverted.
          assert.equal(receipt.executionResult,'success');
          assert.equal(before-after,BigInt(receipt.transactionFee));assert(BigInt(receipt.transactionFee)>0n);
          row.publicFootprint=classifyRollingApplicationFootprint({tx,effect:effect.data,owner,otherOwner:actorB?.owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});
          for(const category of PERSONAL){assert.equal(row.publicFootprint.rolePresence[category].author,false);if(actorB)assert.equal(row.publicFootprint.rolePresence[category].otherAuthor,false);}
          const events=await decoder.decodeTransaction(ctx.node,String(hash));projection.stage(events).apply();hashes.push(String(hash));row.events=events.map(e=>e.type);if(rejectedWithdrawal)withdrawalCaptures.set(String(hash),{tx,receipt,effect:effect.data,events});await save();return events;
        }
        async function waitPostAdmission(selected=actorA,selectedDeposit=String(claim.claim.depositChainId)){
          const pxe=selected.pxe,appWallet=selected.wallet,owner=selected.owner;
          await pxe.sync();
          const state=(await Contract.at(ctx.instance.address,checked.artifact,appWallet).methods.get_deposit_info(owner,new Fr(BigInt(selectedDeposit))).simulate({from:owner})).result;
          assert.equal(state.length,10);
          const checkpoints=createT04CheckpointScope(ctx.node.getSequencer()),deadline=Math.min(Date.now()+90000,ctx.applicationDeadlineAt);
          try{checkpoints.enable();while((await pxe.getSyncedBlockHeader()).globalVariables.timestamp<BigInt(state[9])){
            assert(Date.now()<deadline);await mineL1();await pxe.sync();}
            const drained=await drainT04Checkpoints({node:ctx.node,l1Client:ctx.l1Client,rollupAddress:network.rollup,checkpoints,deadline});
            if(preferenceBrowser)report.eligibility=drained;
          }finally{checkpoints.restore();}
        }
      async function runNotifications(publishRoot){
        const {runRollingNotificationFixture,settleNotificationEvidence,assertNotificationAccountingQuiescent,observeNotificationTransaction}=await import('./rolling-notification-fixture.mjs');
        const {assertRollingNotificationAcceptance}=await import('./rolling-notification-acceptance.mjs');
        const scope=decoder.scope,initialHead=await actorB.application.readPreferenceHead();
        assert.deepEqual(initialHead,{initialized:false,schema:1,revision:'0',digest:'0'});
        const captured=new Map(),browserEvidenceRows=new Map();let subscribedPreferences,subscription,reply,markedPreferences,recoveredPreferences;
        let root;
        async function collect(tx,other,label){
          const txHash=String(tx.getTxHash());
          if(captured.has(txHash)){const row=captured.get(txHash);assert.equal(row.executionResult,'success');return row;}
          let evidence;
          if(other){
            evidence=browserEvidenceRows.get(txHash);
            if(!evidence){evidence={action:label,txHash,submission:'outcome unknown'};browserEvidenceRows.set(txHash,evidence);report.transactions.push(evidence);}
            await save();
          }
          const {record:row,effect}=await observeNotificationTransaction({tx,node:ctx.node,TxHash,observation:evidence??{},persist:save,
            accountFee:(hash,fee)=>accountFee(hash,fee,other),decode:hash=>decoder.decodeTransaction(ctx.node,hash),
            writeEffect:async bytes=>{if(evidence&&!evidence.effectSha256){await fs.writeFile(path.join(directory,label+'-effect.bin'),bytes,{flag:'wx',mode:0o600});evidence.effectSha256=sha(bytes);}}});
          const events=row.events;
          if(other){
            const publicFootprint=classifyRollingApplicationFootprint({tx,effect,owner,otherOwner:actorB.owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});
            Object.assign(evidence,{events:events.map(e=>e.type),publicFootprint});await save();
            assertRollingPublicFootprint(publicFootprint);for(const key of PERSONAL)assert.equal(publicFootprint.rolePresence[key].otherAuthor,false);
            assert.equal(events.length,0);if(!hashes.includes(txHash))hashes.push(txHash);
          }
          captured.set(txHash,row);return row;
        }
        async function privateSnapshot(label){
          const role='notification-'+label+'-'+randomUUID(),dataDirectory=role;
          const identity=sdk.getPXEStoreIdentity({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,accountAddress:String(actorB.owner),dataDirectory});
          assert(!(await indexedDB.databases()).some(db=>db.name===identity.name));
          const journalPath=path.join(ctx.directory,'rolling-application-journals-'+role);await fs.mkdir(journalPath,{mode:0o700});assert.deepEqual(await fs.readdir(journalPath),[]);
          const before={jobs:service.stats().submitted,sends:transportSends};let reader;
          try{
            reader=await makeActor(feesB,role,dataDirectory);
            let result;do{assert(Date.now()<ctx.applicationDeadlineAt);result=await reader.application.readPreferences({deadlineAt:Math.min(Date.now()+5000,ctx.applicationDeadlineAt)});}while(!result.complete);
            assert.equal(result.status,'complete');assert.deepEqual(result.orphanedReadMarkers,[]);return result;
          }finally{if(reader)await reader.close();assert.deepEqual({jobs:service.stats().submitted,sends:transportSends},before);}
        }
        report.notificationBrowser={};await mark('production-browser-notifications');
        await runRollingNotificationFixture({ctx,actor:actorB,fees:feesB,endpoint,network,artifact:checked.artifact,scope,
          deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},
          prepareRoot:async()=>{
            const rootEvent=await publishRoot();
            const rootTx=forwardedSaved[0];assert(rootTx);assert.equal(String(rootTx.getTxHash()),rootEvent.position.txHash);
            root=await collect(rootTx,false,'notification-root');
            return {expected:{rootId:ids.rootId,rootText:'A genuine preference recovery post.'},rootPosition:rootEvent.position};
          },observation:report.notificationBrowser,persist:save,
          onSubscription:async()=>{
            assert.equal(forwardedSaved.length,2);subscription=await collect(forwardedSaved[1],true,'notification-subscription');
            // Browser is now waiting on the fixed reply barrier, so this separate
            // owned PXE is closed before the browser can prepare its marker.
            subscribedPreferences=await privateSnapshot('subscribed');assert.equal(subscribedPreferences.preferences.head.revision,'1');
            assert.deepEqual(subscribedPreferences.preferences.subscriptions,[ids.rootId]);
            await waitPostAdmission();
            const events=await action({type:'reply',deposit:String(claim.claim.depositChainId),name:'0',subboard:'0',parent:ids.rootId,root:ids.rootId,content:'A genuine notification reply.'},'notification-reply');
            assert.equal(events.length,1);assert.equal(events[0].type,'PostPublished');ids.replyId=events[0].payload.id;
            assert.equal(forwardedSaved.length,3);reply=await collect(forwardedSaved[2],false,'notification-reply');
            return {schemaVersion:1,rootId:ids.rootId,replyId:ids.replyId,replyText:'A genuine notification reply.',replyBlock:reply.blockNumber};
          },
          collectBeforeBrowser:async()=>{
            // No handoff means no browser can still issue writes. The trusted
            // proof queue and every forwarded charge must also be settled.
            report.notificationBrowser.browserOutcome='not-launched';
            report.notificationBrowser.submittedHashes=forwardedSaved.map(tx=>String(tx.getTxHash()));
            const quiet=()=>assertNotificationAccountingQuiescent({stats:service.stats(),
              txHashes:report.notificationBrowser.submittedHashes,accounted});
            await settleNotificationEvidence({observation:report.notificationBrowser,persist:save,
              transactions:forwardedSaved[0]?[{label:'root',run:()=>collect(forwardedSaved[0],false,'notification-root')}]:[],
              balances:[
                {label:'a',run:async()=>{quiet();await fees.verify(feeTotal,feesB.browserFixture.fundedAmount-BigInt(feesB.standalone?.transactionFee??0)-feeTotalB);}},
                {label:'b',run:async()=>{quiet();await feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal);}}
              ]});
          },
          collectAfterBrowser:async(browser,l1,readPublicPage)=>{
            // Canonical effects and their charges are retained before requiring
            // the browser success result. No recovery submission is performed.
            report.notificationBrowser.submittedHashes=forwardedSaved.map(tx=>String(tx.getTxHash()));
            report.notificationBrowser.browserOutcome=browser?'finished':'unknown; do not replay';await save();
            let marker;
            await settleNotificationEvidence({observation:report.notificationBrowser,persist:save,
              transactions:[
                ...(forwardedSaved[1]?[{label:'subscription',run:()=>collect(forwardedSaved[1],true,'notification-subscription')}]:[]),
                ...(forwardedSaved[3]?[{label:'marker',run:async()=>{marker=await collect(forwardedSaved[3],true,'notification-marker');}}]:[])
              ],balances:[
                {label:'a',run:async()=>{assert(browser,'Browser completion unavailable; accounting remains incomplete');await fees.verify(feeTotal,feesB.browserFixture.fundedAmount-BigInt(feesB.standalone?.transactionFee??0)-feeTotalB);}},
                {label:'b',run:async()=>{assert(browser,'Browser completion unavailable; accounting remains incomplete');await feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal);}}
              ]});
            assert(browser?.passed&&subscription&&reply&&marker);assert.equal(forwardedSaved.length,4);
            report.notificationBrowser.compactNative=rpc.compactSnapshot();await save();
            report.notificationBrowser.compact=assertRollingBrowserCompactAcceptance(browser,report.notificationBrowser.compactNative,4);
            for(const key of ['rejected','errors','pending'])assert.equal(l1[key],0);assert(l1.forwarded>0);
            markedPreferences=await privateSnapshot('marked');recoveredPreferences=await privateSnapshot('recovered');
            const markers=markedPreferences.preferences.readMarkers;assert.equal(markers.length,1);assert.equal(markers[0].thread,ids.rootId);
            const metadata=await ctx.node.getBlockData(markers[0].throughBlock);assert(metadata);assert.equal(String(BigInt(String(metadata.blockHash))),markers[0].blockHash);
            const markerContext={blockNumber:String(markers[0].throughBlock),blockHash:String(metadata.blockHash),canonical:true};
            let page;const publicDeadline=Math.min(Date.now()+10000,ctx.applicationDeadlineAt);
            do{assert(Date.now()<publicDeadline);page=await readPublicPage();if(page.complete&&page.checkpoint?.number>=Number(marker.blockNumber))break;await sleep(100);}while(true);
            assert.deepEqual(page.posts,projection.feed({limit:100}).posts);
            report.notificationBrowser.acceptance=await assertRollingNotificationAcceptance({scope:{chainId:network.chainId,version:network.version,board:String(BigInt(String(ctx.instance.address)))},initialHead,root,subscription,reply,marker,markerContext,subscribedPreferences,markedPreferences,recoveredPreferences,publicPage:page,browser,
              receiver:{proofJobs:service.stats().submitted,completedProofJobs:service.stats().completed,nodeSubmissions:transportSends,browserProofJobs:service.stats().submitted-(real?2:0),browserNodeSubmissions:transportSends-2,browserL1Submissions:l1.rejected,recoveryProofJobs:0,recoveryNodeSubmissions:0},
              accounting:{verified:true,chargedTransactions:4,totalTransactionFee:String([root,subscription,reply,marker].reduce((n,r)=>n+BigInt(r.transactionFee),0n))},hash:async(fields,domain)=>(await sdk.poseidon2HashWithSeparator(fields.map(n=>new Fr(n)),domain)).toBigInt()},{proofsEnabled:real});await save();
          }});
      }
      let preferenceCheckpoint;
      if(preferences){
        const {exerciseRollingPreferences,exerciseRollingBrowserPreferences}=await import('./rolling-preference-recovery.mjs');
        const mode=preferenceBrowser?'browser-relationships':scenario==='preference-relationships'?'relationships':'notifications';
        if(mode==='relationships'){
          const registered=await action({type:'name',first:'River',last:'Stone'},'preference-name');
          assert.equal(registered.length,1);assert.equal(registered[0].type,'NameRegistered');ids.nameId=registered[0].payload.name_id;
        }
        const {createRollingColdReorgSnapshots,COLD_REORG_BUDGET}=await import('./rolling-preference-recovery.mjs');
        let coldSnapshots,privateSnapshot,coldObservation;
        if(preferenceReorg){
          assert(real,'Reorg acceptance requires genuine proofs');
          coldActor=await makeActor(fees,'a-cold',undefined,undefined,true);
          assert.notEqual(coldActor.pxe,actorA.pxe);assert.notEqual(coldActor.journal,actorA.journal);
          coldObservation=report.preferenceReorg={passed:false,mode:markerReorg?'initialized-marker-cold':'initialization-hot',fork:{}};
          coldObservation.cold={};
          coldSnapshots=createRollingColdReorgSnapshots({
            readPreferences:options=>coldActor.application.readColdPreferences(options),activity:()=>coldActor.activity(),
            transport:()=>{coldObservation.transport=rollingColdTransportEvidence(coldWire,rpc,coldRpc,coldRejectedSends);return rollingColdAttributedSnapshot(coldWire,coldRpc,coldRejectedSends);},persist:save,observation:coldObservation.cold,bootstrap:true,
            // Public native body counts are an independent workload oracle,
            // never private event authority. The reader still authenticates the
            // whole ordered effects root and every original note/event envelope.
            physicalPages:createRollingColdPhysicalPageOracle({node:ctx.node,contextGuard:()=>coldActor.contextGuard()})});
          privateSnapshot=(phase,options={})=>coldSnapshots.read(phase,Math.min(ctx.applicationDeadlineAt-15000,Date.now()+
            (['bootstrap','restored'].includes(phase)?COLD_REORG_BUDGET.fullReadMs:COLD_REORG_BUDGET.suffixReadMs)),options);
        }
        if(!preferenceBrowser)await waitPostAdmission();
        const publishRoot=async()=>{
          const published=await action({type:'post',deposit:String(claim.claim.depositChainId),name:ids.nameId??'0',subboard:'0',content:'A genuine preference recovery post.'},'preference-root');
          assert.equal(published.length,1);assert.equal(published[0].type,'PostPublished');ids.rootId=published[0].payload.id;
          return published[0];
        };
        let rootEvent;
        if(preferenceReorg){
          coldObservation.overlap={passed:false};await save();
          rootEvent=await settleRollingRootOverlap({observation:coldObservation.overlap,
            drain:()=>rpc.drainSends(),snapshot:()=>rootOverlap.snapshot(),persist:save,
            run:async()=>{
            const result=await rootOverlap.run({submit:publishRoot,
              admissionDeadlineAt:Math.min(Date.now()+COLD_REORG_BUDGET.fullReadMs,ctx.applicationDeadlineAt-COLD_REORG_BUDGET.forkReserveMs),
              scanDeadline:()=>Math.min(Date.now()+COLD_REORG_BUDGET.fullReadMs,ctx.applicationDeadlineAt-COLD_REORG_BUDGET.forkReserveMs),
              bootstrap:async({signal,deadlineAt})=>{
                const value=await coldSnapshots.read('bootstrap',deadlineAt,{signal});
                assert.deepEqual(value.head,{initialized:false,schema:1,revision:'0',digest:'0'});
                for(const key of ['bookmarks','followedBoards','followedNames','subscriptions','readMarkers'])assert.deepEqual(value[key],[]);
                assert.equal(value.replyNotifications,true);return value;
              }});
            // Each successful real worker checks its actual initialized native
            // backend/thread profile, not just the requested environment.
            assert(service.stats().completed===1&&service.stats().failed===0);
            coldObservation.workerProfile={threads:trustedProofThreads,completedWorkerProfileAsserted:true};
            return result;
          }});
        }else rootEvent=notificationBrowser||preferenceBrowser?undefined:await publishRoot();
        const rootPosition=rootEvent?.position;
        if(notificationBrowser){
          await runNotifications(publishRoot);
        }else if(preferenceSaved){
          assert(real,'Saved transaction acceptance requires genuine proofs');
          const {exerciseRollingSavedPreference}=await import('./rolling-preference-saved.mjs');
          const row={action:'preference-saved',startedAt:Date.now(),submission:'not attempted'};report.transactions.push(row);
          const sentBefore=forwardedSaved.length;let savedId,deniedBytes;
          const journalDirectory=path.join(ctx.directory,'rolling-application-journals-a'),dataDirectory='rolling-application-test-a';
          const scopeText=sdk.l2JournalScopeText({account:String(actorA.owner),...network,board:String(ctx.instance.address),portal:ctx.ready.portalAddress});
          const cipherKeys={workflow:sha(Buffer.from(JSON.stringify(['ROLLING_WORKFLOW_V1',scopeText]))),l2Journal:sha(Buffer.from(scopeText))};
          const readCiphertext=async()=>{const out={};for(const [key,digest]of Object.entries(cipherKeys)){const file=path.join(journalDirectory,digest+'.json'),stat=await fs.lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.size>0&&stat.size<=32*1024*1024+16384);out[key]=new Uint8Array(await fs.readFile(file));}return out;};
          const getIntent=async()=>(await actorA.application.inspectRecovery(savedId)).intent;
          const expectedDigest=String((await sdk.poseidon2HashWithSeparator([BigInt(network.chainId),BigInt(network.version),BigInt(String(ctx.instance.address)),1n,1n,1n,BigInt(ids.rootId),1n,0n,0n,0n].map(n=>new Fr(n)),0x52435031)).toBigInt());
          report.preferenceSaved=await exerciseRollingSavedPreference({root:ids.rootId,expectedDigest,deadlineAt:ctx.applicationDeadlineAt-15000,
            activity:()=>({...actorA.activity(),...savedCalls}),
            prepare:async input=>{await mark('preference-save-before-forward');const prepared=await actorA.application.prepare(input);savedId=prepared.intentId;actorIntents.set(actorA,savedId);row.maximumFee=prepared.maximumFee;row.submission='outcome unknown';await save();return prepared;},
            submit:async id=>{try{return await actorA.application.submitPrepared(id);}catch(error){row.originalSubmitRejected=true;await save();throw error;}},
            setSendFault:async armed=>{rpc.setFault(armed?'send-before-forward':'healthy');},
            snapshotSaved:async()=>{const tx=rpc.deniedTransaction();assert(tx);deniedBytes??=Buffer.from(tx.toBuffer());const saved=await actorA.journal.inspect();assert.equal(saved.txHash,String(tx.getTxHash()));row.savedTxHash=saved.txHash;row.sendFault={deniedCount:rpc.snapshot().sendDenied,forwardedCount:forwardedSaved.length-sentBefore};await save();return {...saved,bytes:Buffer.from(tx.toBuffer()),deniedCount:rpc.snapshot().sendDenied,forwardedCount:forwardedSaved.length-sentBefore,ciphertext:await readCiphertext(),intent:await getIntent()};},
            readUnsent:async hash=>{const receipt=await ctx.node.getTxReceipt(TxHash.fromString(hash)),effect=await ctx.node.getTxEffect(TxHash.fromString(hash)),validation=await ctx.node.isValidTx(rpc.deniedTransaction());await fees.verify(feeTotal);
              row.preResume={status:receipt.status,effectAbsent:effect===undefined,validation:validation.result,feesUnchanged:true};await save();return row.preResume;},
            reopenSameStores:async()=>{await mark('preference-same-store-reopen');const old=actorA,identity=sdk.getPXEStoreIdentity({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,accountAddress:String(old.owner),dataDirectory});
              const databases=await indexedDB.databases();assert(databases.some(db=>db.name===identity.name));const namesBefore=databases.map(db=>db.name).sort();
              await old.close();assert.throws(()=>old.contextGuard());actorA=activeActor=await makeActor(fees,'a',dataDirectory);actorIntents.delete(old);actorIntents.set(actorA,savedId);pxe=actorA.pxe;appWallet=actorA.wallet;journal=actorA.journal;app=actorA.application;
              assert.notEqual(actorA,old);assert.notEqual(actorA.pxe,old.pxe);assert.deepEqual((await indexedDB.databases()).map(db=>db.name).sort(),namesBefore);assert.equal(String(actorA.owner),String(old.owner));return {oldClosed:true,freshActor:true,samePXEStore:true,sameJournalStore:true};},
            inspectRecovery:id=>actorA.application.inspectRecovery(id),resumeSaved:(id,options)=>actorA.application.resumeSaved(id,options),
            readPreferences:options=>actorA.application.readPreferences(options),
            collectIncluded:async expectedHash=>{
              const outcome=await actorA.journal.inspectOutcome(),receipt=outcome?.receipt;assert(receipt);accountFee(outcome.txHash,receipt.transactionFee);
              Object.assign(row,{txHash:outcome.txHash,status:receipt.status,executionResult:receipt.executionResult,blockNumber:Number(receipt.blockNumber),blockHash:String(receipt.blockHash),transactionFee:String(receipt.transactionFee),elapsedMs:Date.now()-row.startedAt});await save();
              const effect=await ctx.node.getTxEffect(TxHash.fromString(outcome.txHash));assert(effect?.data);row.effectSha256=sha(effect.data.toBuffer());await fs.writeFile(path.join(directory,'saved-preference-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});await save();
              assert.equal(outcome.txHash,expectedHash);assert.equal(String(effect.l2BlockHash),row.blockHash);assert.equal(Number(effect.l2BlockNumber),row.blockNumber);
              const saved=await actorA.journal.assertCanStart(),events=await decoder.decodeTransaction(ctx.node,outcome.txHash);
              row.publicFootprint=classifyRollingApplicationFootprint({tx:saved.tx,effect:effect.data,owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});assertRollingPublicFootprint(row.publicFootprint);
              projection.stage(events).apply();hashes.push(outcome.txHash);row.events=events.map(event=>event.type);row.submission='included';await save();
              const sent=forwardedSaved.slice(sentBefore);assert.equal(sent.length,1);assert.equal(String(sent[0].getTxHash()),expectedHash);assert(Buffer.from(saved.tx.toBuffer()).equals(deniedBytes));
              return {txHash:outcome.txHash,operation:saved.value.operation,bytes:Buffer.from(saved.tx.toBuffer()),forwardedBytes:Buffer.from(sent[0].toBuffer()),forwardedCount:sent.length,canonical:true,executionResult:receipt.executionResult,transactionFee:String(receipt.transactionFee),events,intent:await getIntent()};
            }});await save();
        }else if(preferenceReorg){
          assert(real,'Reorg acceptance requires genuine proofs');
          const {RollupAbi}=await import('@aztec-foundation/l1-artifacts/RollupAbi');
          const {EthCheatCodes}=await import('@aztec-labs/ethereum/test');
          const {replaceRollingL1Suffix}=await import('./rolling-preference-reorg.mjs');
          const eth=new EthCheatCodes(ctx.config.l1RpcUrls,ctx.dateProvider,silent);
          const observation=coldObservation;
          const pending=async()=>Number(await ctx.l1Client.readContract({address:network.rollup,abi:RollupAbi,functionName:'getPendingCheckpointNumber'}));
          const tips=()=>ctx.node.getChainTips();
          pausePreferenceBoundary=async()=>{
            await ctx.node.getSequencer().pause();
            const deadline=Math.min(Date.now()+15000,ctx.applicationDeadlineAt-90000);
            for(;;){const t=await tips();if(t.proposed.number===t.checkpointed.block.number&&await pending()===Number(t.checkpointed.checkpoint.number))return t;
              assert(Date.now()<deadline,'Published checkpoint boundary did not converge');await sleep(100);}
          };
          async function emptySuffix(atLeast,tick){
            const checkpoints=createT04CheckpointScope(ctx.node.getSequencer()),deadline=Math.min(Date.now()+30000,ctx.applicationDeadlineAt-60000);
            try{checkpoints.enable();while((await tips()).checkpointed.block.number<atLeast){assert(Date.now()<deadline,'Empty checkpoint suffix did not publish');await tick();}
              await drainT04Checkpoints({node:ctx.node,l1Client:ctx.l1Client,rollupAddress:network.rollup,checkpoints,deadline});
            }finally{checkpoints.restore();}
            await actorA.pxe.sync();
          }
          if(markerReorg)assert.deepEqual(await action({type:'preference',expectedRevision:'0',kind:1,target:ids.rootId,enabled:true},'reorg-retained-bookmark'),[]);
          const retainedPreferences=await privateSnapshot('retained');assert.equal(retainedPreferences.head.revision,markerReorg?'1':'0');
          const retainedTips=await pausePreferenceBoundary(),retainedL1=await ctx.l1Client.getBlock({blockTag:'latest'});
          assert.equal((await ctx.l1Client.getBlock({blockTag:'pending'})).transactions.length,0);
          const retained={l1:{number:Number(retainedL1.number),hash:retainedL1.hash},l2:{number:retainedTips.checkpointed.block.number,hash:String(retainedTips.checkpointed.block.hash)},checkpoint:Number(retainedTips.checkpointed.checkpoint.number)};
          assert(Number.isSafeInteger(retained.l1.number));await ctx.node.getSequencer().start();
          await emptySuffix(retained.l2.number+1,mineL1);
          const anchor=await actorA.pxe.getSyncedBlockHeader(),anchorHeight=anchor.getBlockNumber(),anchorHash=String(await anchor.hash());
          assert(anchorHeight>retained.l2.number);
          const input=markerReorg?{type:'read-marker',expectedRevision:'1',thread:ids.rootId,throughBlock:String(anchorHeight)}:{type:'preference',expectedRevision:'0',kind:1,target:ids.rootId,enabled:true};
          assert.deepEqual(await action(input,'reorg-original'),[]);
          const originalRow=report.transactions.at(-1),intentId=actorIntents.get(actorA),original=await actorA.journal.assertCanStart();
          assert.equal(String(original.tx.getTxHash()),originalRow.txHash);
          assert.equal(original.tx.data.constants.anchorBlockHeader.getBlockNumber(),anchorHeight);
          assert.equal(String(await original.tx.data.constants.anchorBlockHeader.hash()),anchorHash);
          const originalBytes=sha(original.tx.toBuffer());
          await fs.writeFile(path.join(directory,'reorg-original-tx.bin'),original.tx.toBuffer(),{flag:'wx',mode:0o600});
          const orphanPreferences=await privateSnapshot('orphaned');assert.equal(orphanPreferences.head.revision,markerReorg?'2':'1');
          observation.original={txHash:originalRow.txHash,blockNumber:originalRow.blockNumber,blockHash:originalRow.blockHash,transactionFee:originalRow.transactionFee,signedBytesSha256:originalBytes,anchor:{number:anchorHeight,hash:anchorHash}};
          observation.retained=retained;observation.cachedOrphanPrefix=true;await save();
          completePreferenceReorg=async()=>{
            assert(report.applicationMining.clientMining.stopped&&report.applicationMining.clientMining.passed&&report.applicationMining.clientMining.autominingRestored);
            await mark('preference-real-l1-reorg');
            observation.cold.forkBudget={remainingMs:ctx.applicationDeadlineAt-Date.now(),requiredMs:COLD_REORG_BUDGET.forkReserveMs};await save();
            assert(observation.cold.forkBudget.remainingMs>=COLD_REORG_BUDGET.forkReserveMs,'Cold fork propagation/rebuild/replacement budget not available');
            const readBoundary=async()=>{
              const l1Tip=await ctx.l1Client.getBlock({blockTag:'latest'}),l1Retained=await ctx.l1Client.getBlock({blockNumber:BigInt(retained.l1.number)}),l2Retained=await ctx.node.getBlockData(retained.l2.number),t=await tips();
              return {l1Tip:{number:Number(l1Tip.number),hash:l1Tip.hash},l1Retained:{number:Number(l1Retained.number),hash:l1Retained.hash},l2Retained:{number:l2Retained.header.globalVariables.blockNumber,hash:String(l2Retained.blockHash)},pendingCheckpoint:await pending(),finalizedNumber:t.finalized.block.number,pendingL1Transactions:(await ctx.l1Client.getBlock({blockTag:'pending'})).transactions.length};
            };
            await replaceRollingL1Suffix({eth,retained,readBoundary,quiescence:{sequencerPaused:true,minerStopped:true,minerPassed:true,autominingRestored:true},deadlineAt:ctx.applicationDeadlineAt,observation:observation.fork,persist:save});
            observation.recoveryMining={};
            await withC01ClientMining({rpcUrl:ctx.config.l1RpcUrls[0],dateProvider:ctx.dateProvider,observation:observation.recoveryMining,mode:'real-wall',deadlineAt:ctx.applicationDeadlineAt},async tick=>{
              await mark('preference-real-archiver-unwind');
              const propagationDeadline=Math.min(Date.now()+45000,ctx.applicationDeadlineAt-60000);
              for(;;){const t=await tips(),world=await ctx.node.getWorldStateSyncStatus();
                if(t.proposed.number===retained.l2.number&&t.checkpointed.block.number===retained.l2.number&&world.latestBlockNumber===retained.l2.number&&world.treesAreSynched)break;
                assert(Date.now()<propagationDeadline,'Archiver/worldstate did not unwind normally');await tick();}
              assert.equal(String((await ctx.node.getBlockData(retained.l2.number)).blockHash),retained.l2.hash);
              observation.actualArchiverAndWorldstateUnwind=true;
              if(markerReorg){
                const old=actorA;await old.close();assert.throws(()=>old.contextGuard());
                // Same journal directory and PXE namespace: this is a real cold
                // reopen of the orphaned prefix, never a fresh-store bypass.
                actorA=activeActor=await makeActor(fees,'a',undefined,undefined,true);actorIntents.delete(old);actorIntents.set(actorA,intentId);
                pxe=actorA.pxe;appWallet=actorA.wallet;journal=actorA.journal;app=actorA.application;
                const oldCold=coldActor;await oldCold.close();assert.throws(()=>oldCold.contextGuard());
                coldActor=await makeActor(fees,'a-cold',undefined,undefined,true);
                observation.sameObserverStoreColdReopen=true;
                observation.sameStoreColdReopen=true;
              }
              assert.equal((await actorA.journal.inspect()).txHash,originalRow.txHash);
              const beforeRead=actorA.activity();assert.deepEqual(await privateSnapshot('restored'),retainedPreferences);assert.deepEqual(actorA.activity(),beforeRead);
              observation.restoredExactRetainedPreferences=true;observation.noRecoveryProofOrSend=true;
              await ctx.node.getSequencer().start();await emptySuffix(anchorHeight,tick);
              const markerBlock=await ctx.node.getBlockData(anchorHeight);assert(markerBlock);assert.notEqual(String(markerBlock.blockHash),anchorHash);
              assert.deepEqual(await privateSnapshot('replacement-height'),retainedPreferences);
              // Both missing effect and normal validation are observed; pool
              // entries are never deleted to manufacture replacement eligibility.
              let inspection;const dropDeadline=Math.min(Date.now()+30000,ctx.applicationDeadlineAt-45000);
              for(;;){inspection=await actorA.application.inspectRecovery(intentId);if(inspection.status==='replacement-available')break;
                assert(['pending','unknown'].includes(inspection.status),'Unexpected replacement state');assert(Date.now()<dropDeadline,'Exact old attempt remains fenced');await tick();}
              assert.equal((await ctx.node.getTxReceipt(TxHash.fromString(originalRow.txHash))).status,TxStatus.DROPPED);
              assert.equal(await ctx.node.getTxEffect(TxHash.fromString(originalRow.txHash)),undefined);
              const validation=await ctx.node.isValidTx(original.tx);assert.equal(validation.result,'invalid');assert(validation.reason.length>0);assert(validation.reason.every(reason=>reason==='Block header not found'));
              assert.equal(sha(original.tx.toBuffer()),originalBytes);
              assert.deepEqual(inspection.head,retainedPreferences.head);
              const restoredFees=feeTotal-BigInt(originalRow.transactionFee);assert(restoredFees>=0n);
              await fees.verify(restoredFees);feeTotal=restoredFees;report.actualHumanFees=String(feeTotal);
              observation.orphanFeeExcludedAfterCanonicalBalanceCheck=true;originalRow.canonicalAfterReorg=false;
              const reviewed=await actorA.application.prepareReplacement(intentId,{expectedTxHash:originalRow.txHash,expectedHead:retainedPreferences.head,...(markerReorg?{expectedMarkerHash:String(markerBlock.blockHash)}:{})});
              assert.equal(reviewed.intentId,intentId);assert.equal(reviewed.status,'replacement-prepared');
              assert(BigInt(reviewed.replacementReview.maximumFee)>0n);observation.renewedFeeReview=true;observation.sameHeightMarkerReviewed=markerReorg;
              await mark('preference-explicit-replacement');let replacement,submitError;
              try{replacement=await actorA.application.submitPrepared(intentId);}catch(error){submitError=error;}
              let outcome,receipt,effect;
              try{
                outcome=await actorA.journal.inspectOutcome();receipt=outcome?.receipt;assert(receipt);
                assert(BigInt(receipt.transactionFee)>0n);accountFee(outcome.txHash,receipt.transactionFee);
                observation.replacement={txHash:outcome.txHash,blockNumber:Number(receipt.blockNumber),blockHash:String(receipt.blockHash),transactionFee:String(receipt.transactionFee),executionResult:receipt.executionResult};
                await save(); // Retain the actual paid inclusion even if effect retrieval or semantic checks fail.
                effect=await ctx.node.getTxEffect(TxHash.fromString(outcome.txHash));assert(effect?.data);
                assert.equal(String(effect.l2BlockHash),String(receipt.blockHash));assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
                await fs.writeFile(path.join(directory,'reorg-replacement-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});
                observation.replacement.effectSha256=sha(effect.data.toBuffer());await save();
              }catch(error){if(submitError)throw new AggregateError([submitError,error],'Replacement submission and outcome collection failed');throw error;}
              if(submitError)throw submitError;
              assert.equal(replacement.status,'confirmed');assert.notEqual(replacement.txHash,originalRow.txHash);assert.equal(outcome.txHash,replacement.txHash);assert.equal(receipt.executionResult,'success');
              assert.deepEqual(await decoder.decodeTransaction(ctx.node,outcome.txHash),[]);
              const replacementRecord=await actorA.journal.assertCanStart();assert.equal(String(replacementRecord.tx.getTxHash()),replacement.txHash);
              const predecessor=replacementRecord.value.replacements.find(item=>item.txHash===originalRow.txHash);assert(predecessor);assert.equal(sha(Buffer.from(predecessor.tx,'hex')),originalBytes);
              observation.exactPriorSignedBytesRetained=true;
              observation.replacement.publicFootprint=classifyRollingApplicationFootprint({tx:replacementRecord.tx,effect:effect.data,owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});
              assertRollingPublicFootprint(observation.replacement.publicFootprint);
              const expected=structuredClone(orphanPreferences);
              if(markerReorg){
                // Independent application digest oracle for the unchanged action
                // at the explicitly reviewed new same-height canonical marker.
                const fields=[BigInt(network.chainId),BigInt(network.version),BigInt(String(ctx.instance.address)),1n,2n,6n,BigInt(ids.rootId),1n,BigInt(anchorHeight),BigInt(String(markerBlock.blockHash)),BigInt(retainedPreferences.head.digest)];
                expected.head={initialized:true,schema:1,revision:'2',digest:String((await sdk.poseidon2HashWithSeparator(fields.map(n=>new Fr(n)),0x52435031)).toBigInt())};
                expected.readMarkers=[{thread:ids.rootId,throughBlock:anchorHeight,blockHash:String(BigInt(markerBlock.blockHash))}];
              }
              assert.deepEqual(await privateSnapshot('replacement'),expected);
              assert.equal((await ctx.node.getTxReceipt(TxHash.fromString(originalRow.txHash))).status,TxStatus.DROPPED);
              await actorA.reopenJournal();const final=await actorA.application.inspectRecovery(intentId);assert.equal(final.status,'canonical');
              assert(final.inclusionHistory.some(item=>item.txHash===originalRow.txHash));assert(final.inclusionHistory.some(item=>item.txHash===replacement.txHash));
              observation.historicalInclusionsRetained=true;await fees.verify(feeTotal);
              const jobs=service.stats(),expectedJobs=markerReorg?4:3;assert.equal(jobs.submitted,expectedJobs);assert.equal(jobs.completed,expectedJobs);assert.equal(jobs.failed,0);assert.equal(jobs.running,false);report.proverJobs=jobs;
              observation.oneCanonicalReplacement=true;observation.privatePreferenceEventsPubliclyAbsent=true;await save();
            });
            assert(observation.recoveryMining.clientMining.stopped&&observation.recoveryMining.clientMining.passed&&observation.recoveryMining.clientMining.autominingRestored);
            observation.passed=true;await save();
          };
        }else if(preferenceBrowser){
          report.browserFollowing.admission=rollingBrowserFollowingAdmission({now:Date.now(),deadlineAt:ctx.applicationDeadlineAt,nextAllowedTime:claim.claim.nextAllowedTime});
          await save();assert(report.browserFollowing.admission.admitted,'Insufficient conservative budget before first browser preference proof');
          // Persistence may itself take time. Recheck immediately before the
          // consumer starts its first write, without another awaited operation.
          report.browserFollowing.admission.finalCheckAt=Date.now();
          report.browserFollowing.admission.finalCheckPassed=rollingBrowserFollowingAdmission({now:report.browserFollowing.admission.finalCheckAt,deadlineAt:ctx.applicationDeadlineAt,nextAllowedTime:claim.claim.nextAllowedTime}).admitted;
          assert(report.browserFollowing.admission.finalCheckPassed,'Browser setup admission expired before first proof');
          const result=await exerciseRollingBrowserPreferences({
            publishRoot:async()=>{
              await mark('browser-posting-eligibility');const started=Date.now();
              await waitPostAdmission();report.browserFollowing.postingEligibility={elapsedMs:Date.now()-started,checked:true};await save();
              return publishRoot();
            },action,readPreferences:options=>actorA.application.readPreferences(options),activity:()=>actorA.activity(),deadlineAt:ctx.applicationDeadlineAt});
          preferenceCheckpoint=result.checkpoint;report.preferences=result.observation;
        }else{
        const result=await exerciseRollingPreferences({mode,root:ids.rootId,name:ids.nameId,rootBlock:Number(rootPosition.blockNumber),rootHash:rootPosition.blockHash,
          proofsEnabled:real,action,readPreferences:options=>actorA.application.readPreferences(options),activity:()=>actorA.activity(),deadlineAt:ctx.applicationDeadlineAt});
        preferenceCheckpoint=result.checkpoint;report.preferences=result.observation;
        }
        const expectedNames=ids.nameId?{[ids.nameId]:projection.identity(ids.nameId)}:{};
        const page=projection.feed({limit:100});assert.equal(page.nextCursor,null);assert.equal(page.posts.length,notificationBrowser?2:1);
        report.social={expectedHTTP:[{route:'feed',parameters:{limit:100},expected:{posts:page.posts,nextCursor:null,names:expectedNames,boards:{}}},
          {route:'thread',parameters:{root:ids.rootId,limit:100},expected:{posts:projection.thread(ids.rootId,{limit:100}).posts,nextCursor:null,names:expectedNames,boards:{}}}]};
        await save();
      }else if(race){
        const {createRollingNameCollisionPlan,createNameCollisionClassifier,assertNameCollisionPending,assertNameCollisionOutcome}=await import('./rolling-name-collision.mjs');
        const {installRollingCollisionObserver}=await import('./rolling-collision-observer.mjs');
        const plan=await createRollingNameCollisionPlan(),actors=[actorA,actorB],prepared=[],submissions=[],settled=[],pendingTxs=[];
        const classify=await createNameCollisionClassifier({artifact:checked.artifact,boardAddress:ctx.instance.address});
        let binding,attemptErrors=[];const confirmationDeadlineAt=ctx.applicationDeadlineAt-90000;
        const barrierRead=fn=>sdk.boundedTransactionRead(fn,Math.min(3000,confirmationDeadlineAt-Date.now()));
        await mark('name-race-pending-barrier');
        report.nameRace={passed:false,bothPendingBeforeSequencing:false};await save();
        try{
          await ctx.node.getSequencer().pause();
          // Serial proving, with ordinary sequencing paused until BOTH real
          // transactions are pending. Neither account is reconstructed or mocked.
          for(let i=0;i<actors.length;i++){
            const actor=actors[i];activeActor=actor;
            const item=await actor.application.prepare(plan.actions[i]);prepared.push(item);actorIntents.set(actor,item.intentId);
            const row={action:'name-race-'+i,startedAt:Date.now(),maximumFee:item.maximumFee,submission:'outcome unknown'};
            report.transactions.push(row);await save();
            await mark('name-race-proof-start-'+i);requireRollingRaceProofBudget(confirmationDeadlineAt);
            submissions.push(actor.application.submitPrepared(item.intentId).then(value=>{settled[i]={value};},error=>{settled[i]={error};}));
            for(;;){
              assert(Date.now()<confirmationDeadlineAt,'Name race pending barrier deadline');
              assert(!settled[i],'Name race submission settled before sequencing');
              const saved=await actor.journal.inspect();
              if(saved?.operation==='ROLLING_WORKFLOW_V1:'+item.intentId){
                const receipt=await barrierRead(()=>ctx.node.getTxReceipt(TxHash.fromString(saved.txHash)));
                if(receipt.status==='pending')break;
                assert(!['checkpointed','proven','finalized'].includes(receipt.status),'Race included before both pending');
              }
              await sleep(100);
            }
          }
          const journals=await Promise.all(actors.map(a=>a.journal.inspect()));
          const receipts=await Promise.all(journals.map(async j=>{const r=await barrierRead(()=>ctx.node.getTxReceipt(TxHash.fromString(j.txHash)));return {txHash:String(r.txHash),status:r.status,executionResult:r.executionResult};}));
          binding=assertNameCollisionPending({intentIds:prepared.map(p=>p.intentId),journals,receipts});
          for(const hash of binding.txHashes){const tx=await barrierRead(()=>ctx.node.getTxByHash(TxHash.fromString(hash)));assert(tx);assert.equal(String(tx.getTxHash()),hash);pendingTxs.push(tx);}
          assert(Date.now()<confirmationDeadlineAt,'Name race pending barrier deadline');
          report.nameRace.bothPendingBeforeSequencing=true;await save();
          // Capture only actual processing after the pending barrier. Preflight
          // estimates cannot qualify the mined loser's structured rejection.
          collisionObserver=installRollingCollisionObserver({classify});
        }catch(error){attemptErrors.push(error);}finally{
          attemptErrors=await settleRollingRaceWriters({submissions,priorErrors:attemptErrors,resume:()=>ctx.node.getSequencer().start()});
        }
        const receipts=[],events=[],boardLogs=[],ownership=[];
        // Collect both accounts before making semantic assertions, including
        // the fee/effect of a reverted transaction. A failed read of one account
        // must not prevent a read-only attempt to preserve the other's receipt.
        const observed=await collectRollingRaceOutcomes({count:submissions.length,priorErrors:attemptErrors,collect:async i=>{
          const actor=actors[i];activeActor=actor;const row=report.transactions[i];
          row.receiptEvidence='unknown';row.effectEvidence='unknown';
          try{
            // Only read-only calls are time bounded. Their late completion cannot
            // write evidence or release a wallet operation still in progress.
            const outcome=await sdk.boundedTransactionRead(()=>actor.journal.inspectOutcome(),3000);
            assert(outcome?.receipt);const r=outcome.receipt;row.receiptEvidence='canonical';
            Object.assign(row,{txHash:outcome.txHash,status:r.status,executionResult:r.executionResult,blockNumber:Number(r.blockNumber),blockHash:String(r.blockHash),transactionFee:String(r.transactionFee),elapsedMs:Date.now()-row.startedAt});
            accountFee(outcome.txHash,r.transactionFee,i===1);await save();
            const effect=await sdk.boundedTransactionRead(()=>ctx.node.getTxEffect(TxHash.fromString(outcome.txHash)),3000);
            if(effect?.data){row.effectEvidence='available';row.effectSha256=sha(effect.data.toBuffer());await fs.writeFile(path.join(directory,row.action+'-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});}
            await save();return {outcome,r,effect};
          }catch(error){report.failureEvidenceAvailability='incomplete';await save();throw error;}
        }});
        assert(binding);assert.equal(observed.length,2);
        for(let i=0;i<actors.length;i++){
          const actor=actors[i];activeActor=actor;const row=report.transactions[i],{outcome,r,effect}=observed[i];
          assert(effect?.data);assert.equal(String(effect.data.txHash),outcome.txHash);assert.equal(String(effect.l2BlockHash),row.blockHash);assert.equal(Number(effect.l2BlockNumber),row.blockNumber);
          const canonical=await sdk.boundedTransactionRead(()=>ctx.node.getBlock(row.blockNumber,{includeTransactions:true}),3000);assert.equal(String(canonical.hash),row.blockHash);
          const included=canonical.body.txEffects.filter(e=>String(e.txHash)===outcome.txHash);assert.equal(included.length,1);assert.equal(sha(included[0].toBuffer()),row.effectSha256);
          receipts.push({txHash:outcome.txHash,status:r.status,executionResult:r.executionResult});
          boardLogs.push(effect.data.publicLogs.filter(log=>String(log.contractAddress)===String(ctx.instance.address)));
          row.publicFootprint=classifyRollingApplicationFootprint({tx:pendingTxs[i],effect:effect.data,owner,otherOwner:actorB.owner,payer:fees.browserFixture.instance.address,board:ctx.instance.address});await save();assertRollingPublicFootprint(row.publicFootprint);
          for(const category of PERSONAL)assert.equal(row.publicFootprint.rolePresence[category].otherAuthor,false);
          const reconciled=await actor.application.reconcile(prepared[i].intentId);assert.equal(reconciled.txHash,outcome.txHash);
          if(r.executionResult==='success'){
            assert.equal(settled[i].value?.status,'confirmed');assert.equal(reconciled.status,'confirmed');
            assert.equal(String((await actor.journal.assertCanStart()).tx.getTxHash()),outcome.txHash);
            const decoded=await decoder.decodeTransaction(ctx.node,outcome.txHash);events.push(decoded);projection.stage(decoded).apply();hashes.push(outcome.txHash);
          }else{
            assert.equal(r.executionResult,'reverted');assert.equal(settled[i].error?.code,'BB_TRANSACTION_FAILED');assert.equal(reconciled.status,'reverted');events.push([]);
            assert.equal(boardLogs.at(-1).length,0);
            if(r.status!=='finalized')await assert.rejects(actor.journal.assertCanStart(),{code:'BB_TRANSACTION_FINALITY_PENDING'});
          }
          const head=await actor.application.ownedIdentities(),tail=await actor.application.ownedIdentities({cursor:8});ownership.push({head,tail});
          row.events=events.at(-1).map(e=>e.type);row.submission='included';await save();
        }
        const loser=receipts.findIndex(r=>r.executionResult==='reverted');assert(loser>=0);const lost=report.transactions[loser];
        const matched=collisionObserver.match({txHash:lost.txHash,effectSha256:lost.effectSha256,blockNumber:lost.blockNumber});
        report.nameRace={...report.nameRace,...assertNameCollisionOutcome({plan,binding,receipts,events,boardLogs,ownership,collision:{txHash:lost.txHash,matched}}),passed:true};
        ids.nameId=String(BigInt(plan.nameId));report.profiles={expectedIdentity:projection.identity(ids.nameId)};report.publicViews=projection.profile(ids.nameId,{limit:100});await save();
      }else if(names){
        const {exerciseRollingOwnedNames}=await import('./rolling-owned-names.mjs');
        report.names=await exerciseRollingOwnedNames({actorA,actorB,actionA:(input,label)=>action(input,label,actorA),actionB:(input,label)=>action(input,label,actorB),onPhase:phase=>wire?.setPhase(phase)});
        if(scenario==='owned-names-wire'){
          await mark('fresh-pxe-owned-name-recovery');
          const started=Date.now(),expected=[await actorA.application.ownedIdentities(),await actorB.application.ownedIdentities()];
          const cipher=async role=>{
            const directory=path.join(ctx.directory,'rolling-application-journals-'+role),files=(await fs.readdir(directory)).sort();
            assert(files.length>0&&files.every(name=>/^[0-9a-f]{64}\.json$/.test(name)));
            return Promise.all(files.map(async name=>[name,sha(await fs.readFile(path.join(directory,name)))]));
          };
          report.coldPXE={passed:false,actors:[],scope:'Fresh IndexedDB PXE namespaces with retained disposable secrets and unchanged encrypted journals; no seed/device/process-cold claim'};
          for(const role of ['a','b']){
            wire.setPhase('recovery-'+role);
            const old=role==='a'?actorA:actorB,other=role==='a'?actorB:actorA,funding=role==='a'?fees:feesB;
            const before=old.activity(),otherBefore=other.activity(),oldPXE=old.pxe,oldJournal=old.journal,oldIntent=actorIntents.get(old),beforeCipher=await cipher(role);
            const dataDirectory='rolling-application-cold-'+role+'-'+randomUUID();
            const identity=sdk.getPXEStoreIdentity({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,accountAddress:String(old.owner),dataDirectory});
            assert(!(await indexedDB.databases()).some(db=>db.name===identity.name));
            await old.close();assert.throws(()=>old.contextGuard());
            const replacement=await makeActor(funding,role,dataDirectory);
            if(role==='a')actorA=replacement;else actorB=replacement;
            activeActor=replacement;actorIntents.delete(old);actorIntents.set(replacement,oldIntent);
            assert(replacement.pxe!==oldPXE&&replacement.journal!==oldJournal);assert.equal(String(replacement.owner),String(old.owner));
            assert((await indexedDB.databases()).some(db=>db.name===identity.name));
            for(const [i,current]of [actorA,actorB].entries()){
              assert.deepEqual(await current.application.ownedIdentities(),expected[i]);
              assert.deepEqual(await current.application.ownedIdentities({cursor:8}),{identities:[],records:[],nextCursor:null});
            }
            const after=replacement.activity();assert.equal(after.walletSubmissions,0);assert.equal(after.proofJobs,before.proofJobs);assert.equal(after.transportSends,before.transportSends);
            assert.deepEqual(other.activity(),otherBefore);assert.deepEqual(await cipher(role),beforeCipher);
            report.coldPXE.actors.push({freshStoreVerified:true,oldActorClosed:true,sameOwner:true,exactNamesRecovered:true,journalCiphertextUnchanged:true,newProofJobs:0,newWalletSubmissions:0,newTransportSends:0,constructorAuthWitnesses:after.authWitnesses});await save();
          }
          pxe=actorA.pxe;appWallet=actorA.wallet;journal=actorA.journal;app=actorA.application;
          report.coldPXE.passed=true;report.coldPXE.elapsedMs=Date.now()-started;await save();
        }
        assert.equal(publicNameIds.length,4);assert.equal(new Set(publicNameIds).size,4);
        report.publicViews=publicNameIds.slice().sort().map(id=>projection.profile(id,{limit:100}));
        const {assertCanonicalOwnedNameProfiles}=await import('./rolling-public-acceptance.mjs');assertCanonicalOwnedNameProfiles(projection,report.publicViews);await save();
      }else if(recovery){
        report.publicViews=projection.profile(ids.nameId,{limit:100});report.profiles={expectedIdentity:report.publicViews.identity};
        assert.equal(report.publicViews.posts.length,0);
      }else if(scenario==='profiles'){
        const {exerciseRollingProfileActions}=await import('./rolling-profile-acceptance.mjs');
        report.profiles=await exerciseRollingProfileActions({nameId:ids.nameId,application:app,action,moderate:args=>moderate({kind:'avatar',id:args.nameId,expectedVersion:args.avatarVersion,...args}),projection});
        report.publicViews=projection.profile(ids.nameId,{limit:100});assert.equal(report.publicViews.posts.length,0);await save();
      }else if(social){
        const {exerciseRollingAnonymousThread,exerciseRollingRepostReactions,captureRollingAnonymousHTTPViews}=await import('./rolling-social-acceptance.mjs');
        const deposit=String(claim.claim.depositChainId);
        const options={deposit,action,projection,waitPostAdmission,moderatePost:args=>moderate({kind:'post',id:args.postId,...args})};
        if(rejectedWithdrawal){
          const {beginRollingRejectedWithdrawal,completeRollingRejectedWithdrawal}=await import('./rolling-rejected-withdrawal.mjs');
          const {exactApplicationDeposit}=await import('../application-post.mjs');
          const {NoteStatus}=await import('@aztec-labs/stdlib/note');
          const {readRollingAdmission}=await import('./rolling-admission-read.mjs');
          const {c01BoardEconomics}=await import('../c01-board-flow.mjs');
          const anchorRecord=(header,blockHash)=>({blockNumber:String(header.globalVariables.blockNumber),blockHash:String(blockHash),
            noteHashRoot:String(header.state.partial.noteHashTree.root),noteHashSize:String(header.state.partial.noteHashTree.nextAvailableLeafIndex),
            nullifierRoot:String(header.state.partial.nullifierTree.root),nullifierSize:String(header.state.partial.nullifierTree.nextAvailableLeafIndex)});
          const capture=async hash=>{
            const original=withdrawalCaptures.get(hash);assert(original);const {tx,receipt,effect,events}=original;
            assert(!tx.chonkProof.isEmpty());assert.equal(String(tx.getTxHash()),hash);assert.equal(String(effect.txHash),hash);
            const anchor=tx.data.constants.anchorBlockHeader,canonical=await ctx.node.getBlockData(anchor.getBlockNumber());
            assert.equal(String(canonical.blockHash),String(await anchor.hash()));
            return {events,txHash:hash,anchorTimestamp:String(anchor.globalVariables.timestamp),nullifiers:effect.nullifiers.map(String),l2ToL1Msgs:effect.l2ToL1Msgs.map(String),
              canonical:{blockNumber:String(receipt.blockNumber),blockHash:String(receipt.blockHash),effectSha256:sha(effect.toBuffer())}};
          };
          const readDeposit=async()=>{
            await actorA.pxe.sync();const header=await actorA.pxe.getSyncedBlockHeader();
            const canonical=await ctx.node.getBlockData(header.getBlockNumber());assert.equal(String(canonical.blockHash),String(await header.hash()));
            const fields=(await Contract.at(ctx.instance.address,checked.artifact,actorA.wallet).methods.get_deposit_info(actorA.owner,claim.claim.depositChainId).simulate({from:actorA.owner})).result.map(value=>BigInt(value.toString()));
            assert.equal(fields.length,10);
            const notes=(await actorA.pxe.debug.getNotes({contractAddress:ctx.instance.address,owner:actorA.owner,storageSlot:checked.artifact.storageLayout.deposits.slot,status:NoteStatus.ACTIVE,scopes:[actorA.owner]})).filter(note=>note.note.items[1]?.equals(claim.claim.depositChainId));
            if(fields.every(value=>value===0n)){assert.equal(notes.length,0);return {fields:fields.map(String),nullifier:null,txHash:null,anchor:anchorRecord(header,canonical.blockHash)};}
            assert.equal(notes.length,1);const note=await exactApplicationDeposit({wallet:actorA.wallet,artifact:checked.artifact,instance:ctx.instance,owner:actorA.owner,chain:claim.claim.depositChainId,fields,txHash:notes[0].txHash});
            return {fields:fields.map(String),nullifier:String(note.siloedNullifier),txHash:String(note.txHash)};
          };
          const waitCanonicalAnchor=async timestamp=>{
            await actorA.pxe.sync();const checkpoints=createT04CheckpointScope(ctx.node.getSequencer()),deadline=Math.min(Date.now()+90000,ctx.applicationDeadlineAt);
            try{checkpoints.enable();while(BigInt((await actorA.pxe.getSyncedBlockHeader()).globalVariables.timestamp)<BigInt(timestamp)){
              assert(Date.now()<deadline);await mineL1();await actorA.pxe.sync();}
              await drainT04Checkpoints({node:ctx.node,l1Client:ctx.l1Client,rollupAddress:network.rollup,checkpoints,deadline});
              await actorA.pxe.sync();const header=await actorA.pxe.getSyncedBlockHeader();assert(BigInt(header.globalVariables.timestamp)>=BigInt(timestamp));
              assert.equal(String((await ctx.node.getBlockData(header.getBlockNumber())).blockHash),String(await header.hash()));
            }finally{checkpoints.restore();}
          };
          const economics=c01BoardEconomics(ctx.preparation),escrow=claim.claim;
          const checkpoint=await beginRollingRejectedWithdrawal({actor:{deposit,activity:actorA.activity,prepare:input=>actorA.application.prepare(input),
            isRejectedSubboardError:error=>error?.code==='ROLLING_SUBBOARD_REJECTED',readDeposit,
            action:async(input,label)=>{await action(input,label,actorA);return capture(report.transactions.at(-1).txHash);}},projection,
            rejectSubboard:async({id,reason})=>{await moderate({kind:'subboard',id,reason});return capture(report.subboardModeration.txHash);},waitCanonicalAnchor,
            readAdmission:id=>readRollingAdmission({node:ctx.node,address:ctx.instance.address,storageLayout:checked.artifact.storageLayout,id}),
            scope:escrow.scope,economics:Object.fromEntries(['minDeposit','baseCooldown','censorWindow','maxSaveUp'].map(k=>[k,economics[k]]))});
          // Preserve ordinary canonical reads and fee/journal checks before the
          // real-wall miner stops. The one-use continuation is kept only in RAM.
          const postRow=report.transactions.find(row=>row.action==='withdrawal-post'),post=projection.feed({limit:100}).posts[0];assert.equal(post.position.txHash,postRow.txHash);
          const board=projection.board(post.record.subboard),enrich=value=>({...value,names:{},boards:{[board.id]:{id:board.id,name:board.name,slug:board.slug}}});
          const expectedHTTP=[{route:'feed',parameters:{limit:100},expected:enrich({posts:[post],nextCursor:null})},
            {route:'thread',parameters:{root:post.id,limit:100},expected:enrich({posts:[post],nextCursor:null})},
            {route:'post',parameters:{id:post.id},expected:enrich({post})}];
          const directoryView=projection.directory({limit:100});expectedHTTP.push({route:'directory',parameters:{limit:100},expected:{boards:directoryView.boards,nextCursor:directoryView.nextCursor}});
          report.social={scenario:'rejected-subboard-withdrawal',privateTransactions:4,expectedHTTP,l2ExitVerified:true,fullWithdrawalPassed:false};
          withdrawalCompletion=async()=>{
            const verifyCanonical=async({captures,absenceAnchor})=>{
              const actual=[];
              for(const wanted of captures){const row=withdrawalCaptures.get(wanted.txHash);assert(row);
                const receipt=await ctx.node.getTxReceipt(TxHash.fromString(wanted.txHash)),effect=await ctx.node.getTxEffect(TxHash.fromString(wanted.txHash));
                assert(['checkpointed','proven','finalized'].includes(receipt.status));assert.equal(receipt.executionResult,'success');
                assert.equal(String(receipt.blockNumber),wanted.canonical.blockNumber);assert.equal(String(receipt.blockHash),wanted.canonical.blockHash);
                assert.equal(String((await ctx.node.getBlockData(receipt.blockNumber)).blockHash),wanted.canonical.blockHash);
                assert.equal(String(effect.l2BlockHash),wanted.canonical.blockHash);assert.equal(Number(effect.l2BlockNumber),Number(receipt.blockNumber));
                assert.equal(sha(effect.data.toBuffer()),wanted.canonical.effectSha256);assert.equal(String(effect.data.txHash),wanted.txHash);
                const events=await decoder.decodeTransaction(ctx.node,wanted.txHash);assert.deepEqual(events,wanted.events);
                actual.push({...await capture(wanted.txHash),events,nullifiers:effect.data.nullifiers.map(String),l2ToL1Msgs:effect.data.l2ToL1Msgs.map(String)});
              }
              const previous=await ctx.node.getBlockData(Number(absenceAnchor.blockNumber));assert.equal(String(previous.blockHash),absenceAnchor.blockHash);
              assert.deepEqual(anchorRecord(previous.header,previous.blockHash),absenceAnchor);
              const current=await ctx.node.getBlockData('checkpointed'),state=anchorRecord(current.header,current.blockHash);
              assert(BigInt(state.blockNumber)>=BigInt(absenceAnchor.blockNumber));
              for(const key of ['noteHashRoot','noteHashSize','nullifierRoot','nullifierSize'])assert.equal(state[key],absenceAnchor[key]);
              return {captures:actual,stateContinuity:true};
            };
            const settleAndRefund=async input=>{
              await mark('rejected-withdrawal-local-settlement');const actual=withdrawalCaptures.get(input.exit.txHash);assert(actual);assert.equal(input.depositor,escrow.depositor);assert.equal(input.amount,String(escrow.amount));
              const {settleC01ApplicationMessage}=await import('../c01-settle-application-message.mjs');
              const {withdrawC01L1}=await import('../c01-withdraw-l1.mjs');
              try{report.exitSettlement=await settleC01ApplicationMessage({node:ctx.node,config:ctx.config,dateProvider:ctx.dateProvider,l1Client:ctx.l1Client,directory:ctx.directory,rollupAddress:ctx.rollupAddress,
                txHash:input.exit.txHash,expectedLeaf:input.expectedExitLeaf,kind:'exit',applicationProofs:real});}catch(error){if(error.settlementObservation)report.exitSettlement=error.settlementObservation;await save();throw error;}await save();
              const exitResult={passed:true,exitEmitted:true,exactNoteNullifierEmitted:true,activeNoteAbsent:true,blockNumber:String(actual.receipt.blockNumber),
                expectedExitContent:input.expectedExitContent,expectedExitLeaf:input.expectedExitLeaf};
              Object.defineProperty(exitResult,'exit',{value:{tx:actual.tx,claim:escrow,instance:ctx.instance}});
              await mark('rejected-withdrawal-original-depositor-refund');
              try{report.withdrawalRefund=await withdrawC01L1({node:ctx.node,preparation:ctx.preparation,ready:ctx.ready,exitResult,settlement:report.exitSettlement,l1Client:ctx.l1Client,rpcUrl:ctx.config.l1RpcUrls[0]});}
              catch(error){if(error.withdrawalObservation)report.withdrawalRefund=error.withdrawalObservation;await save();throw error;}
              await save();return {settlement:report.exitSettlement,refund:report.withdrawalRefund};
            };
            report.withdrawal=await completeRollingRejectedWithdrawal(checkpoint,{quiescence:{privateActorsClosed:report.cleanup.applicationActorA===true&&report.cleanup.fundingWallet===true,
              minerStopped:report.applicationMining.clientMining.stopped,minerPassed:report.applicationMining.clientMining.passed,autominingRestored:report.applicationMining.clientMining.autominingRestored},verifyCanonical,settleAndRefund});
            report.social.fullWithdrawalPassed=true;await save();
          };
        }else if(subboards){
          const {exerciseRollingSubboardAcceptance}=await import('./rolling-subboard-acceptance.mjs');
          const privateRead=async(method,args)=>{await actorA.pxe.sync();const result=(await Contract.at(ctx.instance.address,checked.artifact,actorA.wallet).methods[method](...args).simulate({from:actorA.owner})).result;assert(Array.isArray(result));return result.map(value=>typeof value==='boolean'?value:String(BigInt(value.toString())));};
          report.home={};
          const inspectHome=async({phase,subboardId,post})=>{
            await mark('subboard-home-'+phase);assert(['published','rejected'].includes(phase));
            const {verifyRollingPublicReader}=await import('./rolling-public-acceptance.mjs');
            report.home[phase]={};
            for(const selected of (phase==='published'?[false,true]:[true])){
              const label=selected?'curated':'default',included=selected&&phase==='published',board=projection.board(subboardId);
              const observation=report.home[phase][label]={};await save();
              await verifyRollingPublicReader({node:ctx.node,artifact:checked.artifact,
                scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)},
                deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},
                cacheDirectory:path.join(ctx.directory,'rolling-home-'+phase+'-'+label),scenario:'subboard-home',homeSubboards:selected?[subboardId]:[],
                expectedHTTP:[{route:'home',parameters:{limit:100},expected:{posts:included?[post]:[],nextCursor:null,names:{},boards:included?{[subboardId]:{id:subboardId,name:board.name,slug:board.slug}}:{}}}],
                deadlineAt:ctx.applicationDeadlineAt,observation});await save();
            }
          };
          report.social=await exerciseRollingSubboardAcceptance({
            creator:{action:(input,label)=>action(input,label,actorB),readAccountStatus:()=>actorB.application.readAccountStatus()},
            publisher:{deposit,action:(input,label)=>action(input,label,actorA),prepare:input=>actorA.application.prepare(input),waitPostAdmission,
              readDeposit:()=>privateRead('get_deposit_info',[actorA.owner,new Fr(BigInt(deposit))]),activity:actorA.activity,
              isRejectedSubboardError:error=>error?.code==='ROLLING_SUBBOARD_REJECTED'},
            moderator:{setMainPolicy:({rules})=>moderate({kind:'main-policy',reason:rules}),rejectSubboard:({id,reason})=>moderate({kind:'subboard',id,reason})},
            readPolicy:id=>privateRead('effective_policy',[new Fr(BigInt(id))]),inspectHome,projection});
        }else if(wireSocial){
          const {exerciseRollingSocialWire,exerciseRollingReactionWire}=await import('./rolling-social-wire.mjs');
          const actorOptions=(selected,selectedClaim)=>({action:(input,label)=>action(input,label,selected),ownedIdentities:options=>selected.application.ownedIdentities(options),
            ...(selectedClaim?{deposit:String(selectedClaim.claim.depositChainId),waitPostAdmission:()=>waitPostAdmission(selected,String(selectedClaim.claim.depositChainId))}:{})});
          report.social=await (socialWire?exerciseRollingSocialWire:exerciseRollingReactionWire)({actorA:actorOptions(actorA,claim),actorB:actorOptions(actorB,claimB),projection,onPhase:phase=>wire.setPhase(phase)});
        }else if(multi){
          await waitPostAdmission();const root=await action({type:'post',deposit,name:'0',subboard:'0',content:'One public post, two private accounts.'},'account-reactions-root');
          assert.equal(root.length,1);assert.equal(root[0].type,'PostPublished');const postId=root[0].payload.id;
          const {createRemovedLikeClassifier}=await import('./rolling-removed-like.mjs');
          const isRemovedPostRejection=await createRemovedLikeClassifier({artifact:checked.artifact,boardAddress:ctx.instance.address});
          const actorOptions=actor=>({action:(input,label)=>action(input,label,actor),prepare:async input=>{activeActor=actor;await mark('removed-like-rejection');return actor.application.prepare(input);},activity:actor.activity,isRemovedPostRejection});
          const {exerciseRollingAccountReactions}=await import('./rolling-account-reactions.mjs');
          const result=await exerciseRollingAccountReactions({postId,actorA:actorOptions(actorA),actorB:actorOptions(actorB),moderatePost:options.moderatePost,projection});
          report.social={...result,privateTransactions:6,expectedHTTP:captureRollingAnonymousHTTPViews(projection,[postId],[[postId,[postId]]])};
        }else report.social=await (scenario==='anonymous-thread'?exerciseRollingAnonymousThread:exerciseRollingRepostReactions)(options);
        report.publicViews=report.social.expectedHTTP;await save();
      }else{
      const created=await action({type:'subboard',slug:'application-test',name:'Application test',description:'Real application acceptance',rules:'Be helpful.'},'subboard');
      assert.equal(created.length,1);assert.equal(created[0].type,'SubboardCreated');ids.subboardId=created[0].payload.subboard_id;
      const deposit=String(claim.claim.depositChainId);
      const rootEvents=await action({type:'post',deposit,content:'A real application root',name:ids.nameId,subboard:ids.subboardId},'post');
      assert.equal(rootEvents.length,1);assert.equal(rootEvents[0].type,'PostPublished');ids.rootId=rootEvents[0].payload.id;
      // Wait using real checkpoint production, never mutate the deposit's time.
      await pxe.sync(); // Direct utility below also requires the newly included post anchor.
      const nextTime=(await Contract.at(ctx.instance.address,checked.artifact,appWallet).methods.get_deposit_info(owner,new Fr(BigInt(deposit))).simulate({from:owner})).result;
      assert.equal(nextTime.length,10);
      const replyCheckpoints=createT04CheckpointScope(ctx.node.getSequencer()),replyDeadline=Math.min(Date.now()+90000,ctx.applicationDeadlineAt);
      try{replyCheckpoints.enable();await pxe.sync();while((await pxe.getSyncedBlockHeader()).globalVariables.timestamp<BigInt(nextTime[9])){
        assert(Date.now()<replyDeadline);await mineL1();await pxe.sync();}
        await drainT04Checkpoints({node:ctx.node,l1Client:ctx.l1Client,rollupAddress:network.rollup,checkpoints:replyCheckpoints,deadline:replyDeadline});
      }finally{replyCheckpoints.restore();}
      const replyEvents=await action({type:'reply',deposit,content:'A real application reply',name:ids.nameId,subboard:ids.subboardId,parent:ids.rootId,root:ids.rootId},'reply');
      assert.equal(replyEvents.length,1);assert.equal(replyEvents[0].type,'PostPublished');ids.replyId=replyEvents[0].payload.id;
      const liked=await action({type:'like',post:ids.replyId},'like');assert.equal(liked.length,1);assert.equal(liked[0].type,'LikeChanged');
      report.publicViews=assertRollingApplicationViews(projection,ids);await save();
      }
      await mark('encrypted-journal-reopen');
      const jobsBefore=service.stats().submitted;
      report.journalReopen={sameHash:true,newProofJobs:0,transactionBytesRetained:true,actors:[]};
      for(const actor of [actorA,...(actorB&&!recovery&&!notificationBrowser?[actorB]:[])]){
        wire?.setPhase(actor===actorA?'recovery-a':'recovery-b');const before=await actor.journal.inspectOutcome(),activity=actor.activity();
        await actor.reopenJournal();const reconciled=await actor.application.reconcile(actorIntents.get(actor));
        assert.equal(reconciled.status,race&&before.outcome==='reverted'?'reverted':'confirmed');assert.equal(reconciled.txHash,before.txHash);
        assert.deepEqual(actor.activity(),activity);
        if(race&&before.outcome==='reverted'&&before.receipt.status!=='finalized')await assert.rejects(actor.journal.assertCanStart(),{code:'BB_TRANSACTION_FINALITY_PENDING'});
        else assert((await actor.journal.assertCanStart()).tx);
        assert.equal((await actor.journal.inspect()).txHash,before.txHash);
        report.journalReopen.actors.push({sameHash:true,newProofJobs:0,transactionBytesRetained:true});
      }
      journal=actorA.journal;assert.equal(service.stats().submitted,jobsBefore);
      let verifyRollingPublicReader; // Also used by the later stale-readiness check.
      const recoverPrivatePreferences=async()=>{
      if(preferences&&!preferenceBrowser&&!preferenceReorg&&!preferenceSaved&&!notificationBrowser){
        if(boundedCold)wire?.setPhase('recovery-a');
        await mark('preference-keys-only-recovery');
        const {compareRecoveredRollingPreferences,compareRecoveredColdRollingPreferences}=await import('./rolling-preference-recovery.mjs');
        const old=actorA,dataDirectory='rolling-preference-cold-'+randomUUID(),role='preference-cold-'+randomUUID();
        const freshPath=path.join(ctx.directory,'rolling-application-journals-'+role);
        await fs.mkdir(freshPath,{mode:0o700});assert.deepEqual(await fs.readdir(freshPath),[]);
        const identity=sdk.getPXEStoreIdentity({l1ChainId:Number(network.chainId),rollupAddress:network.rollup,accountAddress:String(old.owner),dataDirectory});
        assert(!(await indexedDB.databases()).some(db=>db.name===identity.name));
        await old.close();assert.throws(()=>old.contextGuard());
        // Recreate from original keys and public artifacts only. Neither the
        // old encrypted journal nor the PXE's retained events are copied.
        const metrics=createRollingPrivateRecoveryMetrics();let recoveryError,coldReadObservation,recoveryFailed=false;
        const sample=()=>{const m=process.memoryUsage();metrics.sampleMemory({rssBytes:m.rss,heapUsedBytes:m.heapUsed});};
        report.preferenceCold={completed:false,scope:'Actual fresh keys-only recovery; CLI fake-indexeddb platform',
          nodeScope:'Forwarded server-window calls, possibly including service readiness; not uniquely actor-attributed',
          memoryScope:'Process samples at cold-window boundaries; supervisor separately measures full process-tree peak',
          transportBytesObserved:false,discoverySeparationObserved:false,foldSeparationObserved:false,endToEndWorkBoundQualified:false};
        sample();coldRecoveryMetrics=metrics;
        try{
          report.preferenceCold.metrics=metrics.snapshot();await save();
          const replacement=await makeActor(fees,role,dataDirectory,metrics,boundedCold);
          actorA=activeActor=replacement;actorIntents.delete(old);
          assert(replacement.pxe!==old.pxe&&replacement.journal!==old.journal);assert.equal(String(replacement.owner),String(old.owner));
          assert((await indexedDB.databases()).some(db=>db.name===identity.name));
          pxe=actorA.pxe;appWallet=actorA.wallet;journal=actorA.journal;app=actorA.application;
          if(boundedCold)coldReadObservation=observeRollingColdRead(options=>app.readColdPreferences(options));
          report.preferenceKeysOnly={freshPXEVerified:true,freshPrivateStoreVerified:true,oldActorClosed:true,
            ...await (boundedCold?compareRecoveredColdRollingPreferences:compareRecoveredRollingPreferences)(preferenceCheckpoint,{readPreferences:options=>boundedCold?coldReadObservation.read(options):app.readPreferences(options),activity:()=>actorA.activity()}),
            storagePlatform:'real SDK IndexedDB adapter on labelled CLI fake-indexeddb; native browser recovery is separate'};
          if(boundedCold){
            report.preferenceCold.compact=rpc.compactSnapshot();
            assert(report.preferenceCold.compact.accepted>0&&report.preferenceCold.compact.pending===0,'Actual native compact recovery required');
            assert.equal(actorA.activity().authWitnesses,0,'Cold recovery must not initialize signing or create auth witnesses');
            report.preferenceCold.reader='production bounded PXE cursor';
          }
          report.preferenceCold.completed=true;
        }catch(error){recoveryFailed=true;recoveryError=error;throw error;}
        finally{
          coldRecoveryMetrics=undefined;sample();report.preferenceCold.metrics=metrics.snapshot();
          if(boundedCold){report.preferenceCold.compact=rpc.compactSnapshot();report.preferenceCold.readProgress=coldReadObservation?.snapshot()??null;}
          // A pending server read remains visibly pending in this snapshot. No
          // extra wait or lifecycle action is introduced to improve the metric.
          await persistRollingRecoveryObservation(save,recoveryFailed,recoveryError);
        }
      }
      };
      const verifyCanonicalPublic=async()=>{
      await mark('canonical-projection-rebuild');
      const rebuilt=createRollingProjection({isValidatedEvent:isRollingEvent});
      for(const hash of hashes)rebuilt.stage(await decoder.decodeTransaction(ctx.node,hash)).apply();
      if(names){const {assertCanonicalOwnedNameProfiles}=await import('./rolling-public-acceptance.mjs');assertCanonicalOwnedNameProfiles(rebuilt,report.publicViews);}
      else if(social||preferences){const {assertCanonicalSocialViews}=await import('./rolling-public-acceptance.mjs');assertCanonicalSocialViews(rebuilt,report.social.expectedHTTP);}
      else assert.deepEqual((scenario==='profiles'||recovery||race)?rebuilt.profile(ids.nameId,{limit:100}):assertRollingApplicationViews(rebuilt,ids),report.publicViews);
      for(const row of [...report.transactions,...(report.avatarModeration?[report.avatarModeration]:[]),...(report.postModeration?[report.postModeration]:[]),...(report['main-policyModeration']?[report['main-policyModeration']]:[]),...(report.subboardModeration?[report.subboardModeration]:[])])assert.equal(String((await ctx.node.getBlockData(row.blockNumber)).blockHash),row.blockHash);
      assert.equal(String((await ctx.node.getBlockData(Number(report.initialPublicAnchor.blockNumber))).blockHash),report.initialPublicAnchor.blockHash);
      report.rebuild={passed:true,canonicalTransactionsRefetched:hashes.length,normalizedCacheTreatedAsAuthority:false};
      wire?.setPhase('public-read');await mark('canonical-public-http-reopen');report.publicReader={};await save();
      ({verifyRollingPublicReader}=await import('./rolling-public-acceptance.mjs'));
      await verifyRollingPublicReader({node:ctx.node,artifact:checked.artifact,
        scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)},
        deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},
        cacheDirectory:path.join(ctx.directory,'rolling-public-index'),ids,scenario:names?'owned-names':(recovery||race)?'profiles':scenario,wire:wire?{nodeUrl:ordinaryRpc.url,artifactPath:path.join(ROOT,'billboard/target/rolling_contract-RollingBoard.json'),onReader:url=>wire.registerEndpoint('public-reader',url)}:undefined,expectedProfiles:names?report.publicViews:undefined,expectedProfile:report.profiles?.expectedIdentity,expectedHTTP:report.social?.expectedHTTP,deadlineAt:ctx.applicationDeadlineAt,observation:report.publicReader});await save();
      };
      await runRollingPublicRecoveryChecks({boundedCold,recoverPrivate:recoverPrivatePreferences,verifyPublic:verifyCanonicalPublic});
      if(preferenceBrowser){
        await mark('production-browser-preferences');report.preferenceBrowser={};
        const {runRollingPreferenceBrowserFixture}=await import('./rolling-preference-browser-fixture.mjs');
        try{await runRollingPreferenceBrowserFixture({ctx,actor:actorA,fees,endpoint,network,artifact:checked.artifact,
          scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)},
          deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},
          service,sendCount:()=>transportSends,expected:{postId:ids.rootId,postText:'A genuine preference recovery post.'},observation:report.preferenceBrowser,persist:save,verifyFees:()=>fees.verify(feeTotal)});}
        finally{await save();}
        report.preferenceBrowser.compactNative=rpc.compactSnapshot();await save();
        report.preferenceBrowser.compact=assertRollingBrowserCompactAcceptance(report.preferenceBrowser.browser,report.preferenceBrowser.compactNative,1);await save();
      }
      if(composer){
        await mark('production-browser-composer');report.composer={};
        const {runRollingComposerFixture}=await import('./rolling-composer-fixture.mjs');
        try{await runRollingComposerFixture({ctx,actors:[actorA,actorB],fees:[fees,feesB],claim:claim.claim,endpoint,network,artifact:checked.artifact,
          scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)},
          deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},service,sendCount:()=>transportSends,observation:report.composer,persist:save,verifyFees:[
            ()=>fees.verify(feeTotal,feesB.browserFixture.fundedAmount-BigInt(feesB.standalone?.transactionFee??0)-feeTotalB),
            ()=>feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal)
          ]});}
        finally{await save();}
      }
      if(multi){const bStandalone=BigInt(feesB.standalone?.transactionFee??0);await fees.verify(feeTotal,feesB.browserFixture.fundedAmount-bStandalone-feeTotalB);await feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal);assert.equal(fees.poolBefore,feesB.poolBefore);report.accountFees={a:String(feeTotal),b:String(feeTotalB)};}else await fees.verify(feeTotal);report.actualHumanFees=String(feeTotal+feeTotalB);report.proverJobs=service.stats();
      assert.equal(report.proverJobs.failed,0);
      if(socialWire)assertRollingSocialWireProofJobs(report.proverJobs,socialWireProofsEnabled);
      else if(!real&&['preference-relationships','preference-notifications','preference-browser','notification-browser','composer'].includes(scenario)){assert.equal(report.proverJobs.completed,0);assert.equal(report.proverJobs.submitted,0);}
      else if(recovery){assert.equal(report.proverJobs.completed,1);assert.equal(report.proverJobs.submitted,1);}
      else if(preferenceReorg){const expected=markerReorg?3:2;assert.equal(report.proverJobs.completed,expected);assert.equal(report.proverJobs.submitted,expected);}
      else if(notificationBrowser){assert.equal(report.proverJobs.completed,4);assert.equal(report.proverJobs.submitted,4);}
      else if(preferenceSaved){assert.equal(report.proverJobs.completed,2);assert.equal(report.proverJobs.submitted,2);}
      else if(preferenceBrowser){assert.equal(report.proverJobs.completed,3);assert.equal(report.proverJobs.submitted,3);}
      else if(race){assert.equal(report.proverJobs.completed,2);assert.equal(report.proverJobs.submitted,2);}
      else if(names){assert.equal(report.proverJobs.completed,4);assert.equal(report.proverJobs.submitted,4);}
      else if(social){const expectedJobs=subboards?2:scenario==='anonymous-thread'?3:multi?6:4;assert.equal(report.proverJobs.completed,expectedJobs);assert.equal(report.proverJobs.submitted,expectedJobs);}
      else{assert.equal(report.proverJobs.completed,5);assert.equal(report.proverJobs.submitted,5);}
      assert.equal(report.proverJobs.running,false);
      if(recovery){
        const {captureRollingRecoveryState,expectRollingPrivateFailure,recoverRollingPrivateState}=await import('./rolling-trusted-recovery.mjs');
        await mark('trusted-prepare-before-outage');
        const prepared=await app.prepare({type:'name',first:'Ellis',last:'Moss'});
        const scopeText=sdk.l2JournalScopeText({account:String(actorA.owner),chainId:network.chainId,version:network.version,rollup:network.rollup,board:String(ctx.instance.address),portal:ctx.ready.portalAddress});
        const keys={workflow:sha(Buffer.from(JSON.stringify(['ROLLING_WORKFLOW_V1',scopeText]))),l2Journal:sha(Buffer.from(scopeText))};
        const journalDirectory=path.join(ctx.directory,'rolling-application-journals-a');
        const readCiphertext=async()=>{
          const files=(await fs.readdir(journalDirectory)).sort();assert.deepEqual(files,Object.values(keys).map(key=>key+'.json').sort());
          const result={};for(const [kind,key]of Object.entries(keys)){
            const file=path.join(journalDirectory,key+'.json'),stat=await fs.lstat(file);
            assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600&&stat.size>0&&stat.size<=32*1024*1024+16384);
            result[kind]=new Uint8Array(await fs.readFile(file));
          }return result;
        };
        const original=await actorA.journal.assertCanStart();assert(original?.tx);const signedHash=sha(original.tx.toBuffer()),originalTxHash=String(original.tx.getTxHash());
        assert.equal(originalTxHash,report.transactions[0].txHash);
        const traffic=()=>{const r=wire.snapshot().receiver.requests;return {ordinaryNode:r['ordinary-node'],publicReader:r['public-reader'],trustedProof:r['trusted-proof']};};
        const capture=()=>captureRollingRecoveryState({actor:actorA,intentId:prepared.intentId,readCiphertext,traffic});
        report.trustedRecovery={passed:false,defaultMaxLagSeconds:120,unavailable:[],afterReadiness:[],stale:[],recoveries:[],signedPredecessorRetained:false};
        const observation=report.trustedRecovery;
        wire.setPhase('outage');let checkpoint=await capture();
        const beforeUnavailable=rpc.snapshot();rpc.setFault('unavailable');
        try{
          observation.unavailable.push(await expectRollingPrivateFailure(checkpoint,{kind:'owned',operation:()=>app.ownedIdentities()}));
          observation.unavailable.push(await expectRollingPrivateFailure(checkpoint,{kind:'submit',operation:()=>app.submitPrepared(prepared.intentId)}));
          const after=rpc.snapshot();assert(after.unavailableRequests>beforeUnavailable.unavailableRequests);assert.deepEqual(after.forwarded,beforeUnavailable.forwarded);
          observation.unavailableNoUpstreamForward=true;
        }finally{rpc.setFault('healthy');}
        observation.recoveries.push(await recoverRollingPrivateState(checkpoint));await save();
        checkpoint=await capture();const beforePersonalized=rpc.snapshot();wire.setPhase('personalized-denial');rpc.setFault('personalized-once');
        try{
          observation.afterReadiness.push(await expectRollingPrivateFailure(checkpoint,{kind:'personalized',operation:()=>node.getContract(actorA.owner)}));
          const after=rpc.snapshot();assert.equal(after.personalizedDenied,beforePersonalized.personalizedDenied+1);
          assert.equal(after.forwarded.getContract??0,beforePersonalized.forwarded.getContract??0);
          assert(after.forwarded.getNodeInfo>beforePersonalized.forwarded.getNodeInfo);assert(after.forwarded.getSyncedL1Timestamp>beforePersonalized.forwarded.getSyncedL1Timestamp);
          observation.personalizedDenial={denied:after.personalizedDenied-beforePersonalized.personalizedDenied,
            forwarded:(after.forwarded.getContract??0)-(beforePersonalized.forwarded.getContract??0),
            readiness:Object.fromEntries(['getNodeInfo','getSyncedL1Timestamp'].map(key=>[key,after.forwarded[key]-beforePersonalized.forwarded[key]]))};
          observation.readinessPassedBeforePersonalizedDenial=true;
        }finally{rpc.setFault('healthy');wire.setPhase('outage');}
        observation.recoveries.push(await recoverRollingPrivateState(checkpoint));
        checkpoint=await capture();await save();
        completeTrustedRecovery=async()=>{
          assert(report.applicationMining.clientMining.stopped&&report.applicationMining.clientMining.passed&&report.applicationMining.clientMining.autominingRestored);
          await mark('trusted-natural-staleness');
          const {createPublicClient,http:transport}=await import('viem'),{foundry}=await import('viem/chains');
          const l1=createPublicClient({chain:foundry,transport:transport(ctx.config.l1RpcUrls[0],{retryCount:0,timeout:5000})});
          let oldAutomine,restore=false,paused=false,agingFailure;
          try{
            await ctx.node.getSequencer().pause();paused=true;
            oldAutomine=await l1.request({method:'anvil_getAutomine',params:[]});assert.equal(typeof oldAutomine,'boolean');restore=true;
            await l1.request({method:'evm_setAutomine',params:[false]});assert.equal(await l1.request({method:'anvil_getAutomine',params:[]}),false);
            // Wait for the real archiver to consume the already-mined final L1 block.
            const last=await l1.getBlock({blockTag:'latest'}),settleDeadline=Math.min(Date.now()+15000,ctx.applicationDeadlineAt-180000);
            while(await ctx.node.getSyncedL1Timestamp()!==last.timestamp){assert(Date.now()<settleDeadline,'Insufficient budget for genuine stale state');await sleep(100);}
            const stamp=await ctx.node.getSyncedL1Timestamp();assert(stamp===last.timestamp);
            const target=Number(stamp+121n)*1000;
            assert(Number.isSafeInteger(target)&&ctx.applicationDeadlineAt-Math.max(Date.now(),target)>=60000,'Do not begin aging without recovery and cleanup reserve');
            observation.aging={startedAt:Date.now(),syncedL1Timestamp:String(stamp),requiredAfter:target,recoveryReserveMs:60000};await save();
            while(Date.now()<target){assert(Date.now()<ctx.applicationDeadlineAt-60000);assert.equal(await ctx.node.getSyncedL1Timestamp(),stamp);assert.equal((await l1.getBlock({blockTag:'latest'})).number,last.number);await sleep(250);}
            assert.equal(await ctx.node.getSyncedL1Timestamp(),stamp);assert.equal((await l1.getBlock({blockTag:'latest'})).number,last.number);
            await assert.rejects(()=>sdk.inspectTrustedNode(ctx.node,{expectedNetworkScope:network,proofsEnabled:real}),error=>error?.code==='BB_TRUSTED_NODE_STALE');
            observation.aging.observedAt=Date.now();observation.aging.actualLagSeconds=Math.floor(Date.now()/1000)-Number(stamp);assert(observation.aging.actualLagSeconds>120);
            // Public chain/index queries remain independent of private readiness.
            observation.stalePublicReader={};
            await verifyRollingPublicReader({node:ctx.node,artifact:checked.artifact,
              scope:{chainId:network.chainId,rollupVersion:network.version,rollupAddress:network.rollup,boardAddress:String(ctx.instance.address),classId:String((await sdk.getContractClassFromArtifact(checked.artifact)).id)},
              deployment:{blockNumber:Number(report.initialPublicAnchor.blockNumber),blockHash:report.initialPublicAnchor.blockHash,txHash:report.initialPublicAnchor.txHash},
              readerPort:report.publicReader.readerPort,cacheDirectory:path.join(ctx.directory,'rolling-stale-public-index'),ids,scenario:'profiles',expectedProfile:report.profiles.expectedIdentity,
              wire:{nodeUrl:ordinaryRpc.url,artifactPath:path.join(ROOT,'billboard/target/rolling_contract-RollingBoard.json'),onReader:url=>wire.registerEndpoint('public-reader',url)},
              deadlineAt:ctx.applicationDeadlineAt,observation:observation.stalePublicReader});
            const beforeStale=rpc.snapshot();
            observation.stale.push(await expectRollingPrivateFailure(checkpoint,{kind:'owned',operation:()=>app.ownedIdentities()}));
            observation.stale.push(await expectRollingPrivateFailure(checkpoint,{kind:'submit',operation:()=>app.submitPrepared(prepared.intentId)}));
            const afterStale=rpc.snapshot(),readinessOnly=new Set(['getNodeInfo','getChainTips','getWorldStateSyncStatus','getBlockData','getSyncedL1Timestamp']);
            for(const method of new Set([...Object.keys(beforeStale.forwarded),...Object.keys(afterStale.forwarded)]))if(!readinessOnly.has(method))assert.equal(afterStale.forwarded[method]??0,beforeStale.forwarded[method]??0);
            observation.staleNoPersonalizedForward=true;await save();
          }catch(error){agingFailure=error;throw error;}finally{
            const errors=[];
            if(restore)try{await l1.request({method:'evm_setAutomine',params:[oldAutomine]});assert.equal(await l1.request({method:'anvil_getAutomine',params:[]}),oldAutomine);observation.autominingRestored=true;}catch(error){errors.push(error);observation.autominingRestored=false;}
            if(paused)try{await ctx.node.getSequencer().start();observation.sequencerResumed=true;}catch(error){errors.push(error);observation.sequencerResumed=false;}
            if(errors.length)throw new AggregateError([...(agingFailure?[agingFailure]:[]),...errors],'Trusted aging and restoration failed');
          }
          await mark('trusted-canonical-recovery');observation.recoveryMining={};
          await withC01ClientMining({rpcUrl:ctx.config.l1RpcUrls[0],dateProvider:ctx.dateProvider,observation:observation.recoveryMining,mode:'real-wall',deadlineAt:ctx.applicationDeadlineAt},async tick=>{
            const deadline=Math.min(Date.now()+30000,ctx.applicationDeadlineAt-15000);
            for(;;){try{await sdk.inspectTrustedNode(ctx.node,{expectedNetworkScope:network,proofsEnabled:real});break;}catch(error){assert(['BB_TRUSTED_NODE_STALE','BB_TRUSTED_NODE_UNSYNCED'].includes(error?.code));assert(Date.now()<deadline);await tick();}}
            observation.recoveries.push(await recoverRollingPrivateState(checkpoint));
            const restored=await actorA.journal.assertCanStart();assert.equal(String(restored.tx.getTxHash()),originalTxHash);assert.equal(sha(restored.tx.toBuffer()),signedHash);
            observation.signedPredecessorRetained=true;
            assert.equal((await app.cancelPrepared(prepared.intentId)).status,'cancelled');observation.preparedCancelledAfterRecovery=true;
            const bStandalone=BigInt(feesB.standalone.transactionFee);await fees.verify(feeTotal,feesB.browserFixture.fundedAmount-bStandalone-feeTotalB);await feesB.verify(feeTotalB,fees.browserFixture.fundedAmount-feeTotal);
            assert.equal(service.stats().submitted,1);assert.equal(service.stats().completed,1);assert.equal(service.stats().failed,0);assert.equal(service.stats().running,false);
          });
          assert(observation.recoveryMining.clientMining.stopped&&observation.recoveryMining.clientMining.passed&&observation.recoveryMining.clientMining.autominingRestored);
          observation.passed=true;await save();
        };
      }
      nativeArtifacts.verify();report.nativeArtifacts=nativeArtifacts.observation();
      assert.deepEqual(await sourceBinding(),report.sourceHashes);assert.deepEqual(buildInputs(),manifest.inputs);
      if(rejectedWithdrawal){
        // Close private query users before leaving the sole real-wall mining
        // scope. Official settlement later advances only this disposable chain.
        await closeRollingResources([['applicationActorA',()=>actorA.close()],['fundingWallet',()=>fees.close()],
          ['proverAndQuery',async()=>{const port=service.address.port;await service.close();await closedPort(port);}],['nodeRPC',()=>rpc.close()]],report.cleanup);
        activeActor=actorA=undefined;fees=undefined;service=rpc=undefined;
      }else{if(preferenceReorg)await pausePreferenceBoundary();report.passed=!recovery&&!preferenceReorg;await mark(preferenceReorg?'preference-reorg-prepared':recovery?'trusted-recovery-prepared':'complete');}
      }catch(error){
        // Keep the exact failure; diagnostic failures must not replace it.
        try{await observe('application-failed');}catch{report.readinessIncomplete=true;}
        throw error;
      }
    });
    assert.equal(report.applicationMining.clientMining.stopped,true);assert.equal(report.applicationMining.clientMining.passed,true);
    if(recovery){await completeTrustedRecovery();assert.deepEqual(await sourceBinding(),report.sourceHashes);nativeArtifacts.verify();report.passed=true;await mark('complete');}
    if(preferenceReorg){await completePreferenceReorg();assert.deepEqual(await sourceBinding(),report.sourceHashes);nativeArtifacts.verify();report.passed=true;await mark('complete');}
    if(rejectedWithdrawal){assert.equal(typeof withdrawalCompletion,'function');await withdrawalCompletion();report.passed=true;await mark('complete');}
  }catch(error){
    failure=error;report.passed=false;
    // Keep only fixed/public observation schemas. Never raw SDK error/cause/stack.
    report.failure={stage:report.stage,code:['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_STALE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_IDENTITY','BB_REMOTE_PROVER_TIMEOUT','BB_REMOTE_PROVER_FAILED','ROLLING_FEE_CHANGED'].includes(error?.code)?error.code:'UNCLASSIFIED'};
    if(error.depositObservation){if(collateralRole==='b')report.secondCollateral=error.depositObservation;else report.collateral=error.depositObservation;}
    if(error.privateFeeObservation)recordRollingFundingFailure(report,fundingRole,error.privateFeeObservation);
    // Failed submit can still have consumed a fee. Read-only canonical observation,
    // no replacement, reproof or resend. Never treat this as application success.
    // Race writers were all settled and both started actors collected above.
    // Do not repeat an unbounded active-actor-only fallback after that attempt.
    if(activeActor&&!race)try{
      const outcome=await activeActor.journal.inspectOutcome();
      if(outcome?.receipt){
        const receipt=outcome.receipt;
        report.lastJournalOutcome={txHash:outcome.txHash,outcome:outcome.outcome,transactionFee:String(receipt.transactionFee),
          blockNumber:Number(receipt.blockNumber),blockHash:String(receipt.blockHash)};
        accountFee(outcome.txHash,receipt.transactionFee,activeActor===actorB);await save();
        const {TxHash}=await import('@aztec-labs/stdlib/tx');
        const effect=await ctx.node.getTxEffect(TxHash.fromString(outcome.txHash));
        if(effect?.data&&String(effect.l2BlockHash)===String(receipt.blockHash)&&Number(effect.l2BlockNumber)===Number(receipt.blockNumber)){
          report.lastJournalOutcome.effectSha256=sha(effect.data.toBuffer());
          await fs.writeFile(path.join(directory,'last-journal-effect.bin'),effect.data.toBuffer(),{flag:'wx',mode:0o600});
        }
      }
    }catch{report.failureEvidenceAvailability='incomplete';}
  }finally{
    wire?.setPhase('cleanup');
    try{await closeRollingResources([
      ...(actorA?[['applicationActorA',()=>actorA.close()]]:[]),
      ...(coldActor?[['coldRecoveryActor',()=>coldActor.close()]]:[]),
      ...(actorB?[['applicationActorB',()=>actorB.close()]]:[]),
      ...(fees?[['fundingWallet',()=>fees.close()]]:[]),
      ...(feesB?[['fundingWalletB',()=>feesB.close()]]:[]),
      ...(coldService?[['coldQuery',async()=>{const port=coldService.address.port;await coldService.close();await closedPort(port);}]]:[]),
      ...(service?[['proverAndQuery',async()=>{const port=service.address.port;await service.close();await closedPort(port);}]]:[]),
      ...(coldRpc?[['coldRPC',()=>coldRpc.close()]]:[]),
      ...(rpc?[['nodeRPC',()=>rpc.close()]]:[]),
      ...(ordinaryRpc?[['ordinaryRPC',()=>ordinaryRpc.close()]]:[]),
      ...(wire?[['wireCapture',()=>wire.close()]]:[]),
      ...(coldWire?[['coldTransportCapture',()=>coldWire.close()]]:[]),
      ...(collisionObserver?[['collisionObserver',()=>{
        assert.equal(collisionObserver.close().restored,true);report.collisionObserver=collisionObserver.snapshot();
        if(report.nameRace?.passed){const lost=report.transactions.find(row=>row.executionResult==='reverted');assert(lost);
          assertClosedCollisionObserver(report.collisionObserver,collisionObserver.match({txHash:lost.txHash,effectSha256:lost.effectSha256,blockNumber:lost.blockNumber}));}
      }]]:[]),
      ...(restoreIndexedDB?[['indexedDBGlobals',restoreIndexedDB]]:[]),
      ...(nativeArtifacts?[['nativeArtifactLoader',()=>{try{nativeArtifacts.close();}finally{report.nativeArtifacts=nativeArtifacts.observation();}}]]:[]),
    ],report.cleanup);}catch(error){report.passed=false;failure=failure?new AggregateError([failure,error],'Rolling fixture and cleanup failed'):error;}
    if(coldWire){report.coldTransport=rollingColdTransportEvidence(coldWire,rpc,coldRpc,coldRejectedSends);try{if(report.passed)rollingColdAttributedSnapshot(coldWire,coldRpc,coldRejectedSends);}catch(error){report.passed=false;failure=failure?new AggregateError([failure,error],'Cold transport acceptance failed'):error;}}
    if(wire){report.wire=wire.snapshot();try{if(!failure){const {assertRollingWireCampaign}=await import('./rolling-wire-campaign.mjs');report.wireAcceptance=recovery?assertRollingRecoveryWire(report.wire,report.trustedRecovery):assertRollingWireCampaign(report.wire,{proofsEnabled:socialWire?socialWireProofsEnabled:true});}}catch(error){report.passed=false;failure=error;}}
    try{await save();}catch(error){report.passed=false;failure=failure?new AggregateError([failure,error],'Rolling evidence failed'):error;}
  }
  if(failure){failure.rollingApplicationObservation=report;throw failure;}
  return report;
}
