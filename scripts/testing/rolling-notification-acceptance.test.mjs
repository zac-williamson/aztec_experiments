// Labelled canonical/PXE/browser/receiver doubles. Actual Poseidon and public
// event validation are used; no chain, browser or genuine acceptance is claimed.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {poseidon2HashWithSeparator} from '@aztec-labs/foundation/crypto/poseidon';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {validateRollingEvent} from '../../shared/rolling/public-events.mjs';
import {replayPreferenceEvents} from '../../shared/rolling/preferences.mjs';
import {assertRollingNotificationAcceptance} from './rolling-notification-acceptance.mjs';
import {NOTIFICATION_BROWSER_CHECKS} from './rolling-notification-browser.mjs';
after(()=>BarretenbergSync.destroySingleton());
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),hash=async(f,d)=>(await poseidon2HashWithSeparator(f,d)).toBigInt();
const scope={chainId:'31337',version:'1',board:'9'},publicScope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'01'.repeat(20),boardAddress:hex(9),classId:hex(10)};
const pack=text=>{const fields=Array(32).fill(0n);for(const[i,b]of Buffer.from(text).entries())fields[Math.floor(i/31)]|=BigInt(b)<<BigInt(8*(30-i%31));return fields.map(String);};
async function fixture(){
 async function post(id,parent,block){const content='Public message '+id+'.',message=pack(content),record={subboard:'0',parent,root:'101',kind:'1',name_id:'0',reference:'0',content_digest:String(await hash([BigInt(Buffer.byteLength(content)),...message.map(BigInt)],0x52435431))};const position={blockNumber:String(block),blockHash:hex(block),txHash:hex(block+100),txIndexWithinBlock:'0',logIndexWithinTx:'0'};
 const event=await validateRollingEvent({schemaVersion:1,scope:publicScope,type:'PostPublished',position,payload:{schema:'1',id,record,timestamp:String(block*100),main_policy_version:'1',local_policy_version:'0',length:String(Buffer.byteLength(content)),message}},publicScope);
 return {tx:{txHash:position.txHash,blockNumber:String(block),txIndexWithinBlock:'0',transactionFee:'10',canonical:true,executionResult:'success',events:[event]},post:{id,record,text:content,timestamp:String(block*100),mainVersion:'1',localVersion:'0',position,order:parent==='0'?'0':'1',likes:'0',removal:null,invocation:null,bot:null}};}
 const root=await post('101','0',1),reply=await post('102','101',3);
 const event1={schema:1,revision:'1',kind:4,target:'101',value:true,read_block:0,read_hash:'0',previous_digest:'0'};
 const digest1=String(await hash([31337n,1n,9n,1n,1n,4n,101n,1n,0n,0n,0n],0x52435031));
 const event2={schema:1,revision:'2',kind:6,target:'101',value:true,read_block:3,read_hash:'3',previous_digest:digest1};
 const digest2=String(await hash([31337n,1n,9n,1n,2n,6n,101n,1n,3n,3n,BigInt(digest1)],0x52435031));
 const full=preferences=>({status:'complete',complete:true,preferences:structuredClone(preferences),orphanedReadMarkers:[]});
 const subscribedPreferences=full(await replayPreferenceEvents({scope,head:{initialized:true,schema:1,revision:'1',digest:digest1},events:[event1],hash}));
 const markedPreferences=full(await replayPreferenceEvents({scope,head:{initialized:true,schema:1,revision:'2',digest:digest2},events:[event1,event2],hash}));
 const tx=n=>({txHash:hex(n+100),blockNumber:String(n),txIndexWithinBlock:'0',transactionFee:'10',canonical:true,executionResult:'success',events:[]});
 return {scope,initialHead:{initialized:false,schema:1,revision:'0',digest:'0'},root:root.tx,reply:reply.tx,subscription:tx(2),marker:tx(4),markerContext:{blockNumber:'3',blockHash:hex(3),canonical:true},subscribedPreferences,markedPreferences,recoveredPreferences:structuredClone(markedPreferences),publicPage:{schemaVersion:1,complete:true,revision:'verified-fixture',scope:publicScope,checkpoint:{number:4,hash:hex(4)},posts:[reply.post,root.post],nextCursor:null,names:{},boards:{}},browser:{schemaVersion:1,passed:true,stage:'complete',elapsedMs:100000,timedOut:false,diagnostic:null,checks:Object.fromEntries(NOTIFICATION_BROWSER_CHECKS.map(k=>[k,true])),cleanup:{contextClosed:true,browserClosed:true},traffic:{proofPolls:2,feedRequests:5,boardRequests:3,walletAssets:5,privateRequests:10,proofSubmits:2,nodeSubmissions:2,completedWritePhases:2,writePhaseOpen:false,l1Submissions:0,deniedWrites:0,blockedRequests:0,inspectionErrors:0}},receiver:{proofJobs:4,completedProofJobs:4,nodeSubmissions:4,browserProofJobs:2,browserNodeSubmissions:2,browserL1Submissions:0,recoveryProofJobs:0,recoveryNodeSubmissions:0},accounting:{verified:true,chargedTransactions:4,totalTransactionFee:'40'},hash};
}
test('actual Poseidon replay + branded synthetic events require complete four-action browser journey',async()=>{const f=await fixture(),r=await assertRollingNotificationAcceptance(f);assert.equal(r.passed,true);assert.equal(r.applicationTransactions,4);for(const forbidden of ['101','digest','scope','txHash','subscriptions','preferences'])assert(!JSON.stringify(r).includes(forbidden));});
const mutations={
 initialNonempty:f=>f.initialHead.revision='1',publicOwner:f=>f.publicPage.posts[0].owner='PRIVATE_SENTINEL',changedPublicClass:f=>f.publicPage.scope={...publicScope,classId:hex(999)},privateDictionary:f=>f.publicPage.names={'9':{owner:'PRIVATE_SENTINEL'}},pending:f=>f.subscription.executionResult='pending',uncanonical:f=>f.marker.canonical=false,free:f=>f.subscription.transactionFee='0',wrongFee:f=>f.accounting.totalTransactionFee='39',unverifiedFee:f=>f.accounting.verified=false,missingCharge:f=>f.accounting.chargedTransactions=3,
 unbranded:f=>f.root.events=[structuredClone(f.root.events[0])],publicPreference:f=>f.subscription.events=[f.root.events[0]],duplicateHash:f=>f.marker.txHash=f.subscription.txHash,wrongOrder:f=>f.subscription.blockNumber='4',missingReply:f=>f.publicPage.posts.pop(),wrongParent:f=>f.publicPage.posts[0].record.parent='999',changedContent:f=>f.publicPage.posts[0].text='changed',wrongPosition:f=>f.publicPage.posts[0].position.blockHash=hex(999),partialPage:f=>f.publicPage.complete=false,hiddenCursor:f=>f.publicPage.nextCursor='another-page',
 wrongScope:f=>f.scope={...scope,board:'99'},wrongDigest:f=>f.subscribedPreferences.preferences.head.digest='999',wrongRevision:f=>f.markedPreferences.preferences.head.revision='1',extraPreference:f=>f.markedPreferences.preferences.bookmarks=['101'],noSubscription:f=>f.subscribedPreferences.preferences.subscriptions=[],disabled:f=>f.subscribedPreferences.preferences.replyNotifications=false,partialPrivate:f=>f.subscribedPreferences.complete=false,orphan:f=>f.markedPreferences.orphanedReadMarkers=[{}],recoveryDrift:f=>f.recoveredPreferences.preferences.head.digest='999',markerBeforeReply:f=>f.markerContext.blockNumber='1',markerFuture:f=>f.markerContext.blockNumber='5',wrongMarkerHash:f=>f.markerContext.blockHash=hex(999),uncanonicalMarker:f=>f.markerContext.canonical=false,
 noFeed:f=>f.browser.traffic.feedRequests=0,noPoll:f=>f.browser.traffic.proofPolls=0,lateBrowser:f=>f.browser.elapsedMs=150001,browserFailed:f=>f.browser.passed=false,browserTimedOut:f=>f.browser.timedOut=true,cleanupFailed:f=>f.browser.cleanup.contextClosed=false,readonlyBrowser:f=>f.browser.traffic.proofSubmits=0,extraSend:f=>f.browser.traffic.nodeSubmissions=3,blockedTraffic:f=>f.browser.traffic.blockedRequests=1,unfinishedPhase:f=>f.browser.traffic.writePhaseOpen=true,failedProof:f=>f.receiver.completedProofJobs=3,extraProof:f=>f.receiver.proofJobs=5,recoverySend:f=>f.receiver.recoveryNodeSubmissions=1,l1Send:f=>f.receiver.browserL1Submissions=1,
};
for(const [name,mutate]of Object.entries(mutations))test('labelled negative rejects '+name+' with no private error detail',async()=>{const f=await fixture();mutate(f);await assert.rejects(assertRollingNotificationAcceptance(f),e=>e.message==='Rolling notification acceptance failed.'&&!e.actual&&!e.expected&&!e.cause);});
for(const key of NOTIFICATION_BROWSER_CHECKS)test('requires genuine browser check '+key,async()=>{const f=await fixture();f.browser.checks[key]=false;await assert.rejects(assertRollingNotificationAcceptance(f));});
test('snapshot before async hash prevents caller rewriting approved states/counters',async()=>{const f=await fixture();let gate,entered;const waiting=new Promise(r=>entered=r),hold=new Promise(r=>gate=r);f.hash=async(fields,domain)=>{entered();await hold;return hash(fields,domain);};const run=assertRollingNotificationAcceptance(f);await waiting;f.accounting.verified=false;f.markedPreferences.preferences.bookmarks=['999'];f.browser.checks.markerConfirmed=false;gate();assert.equal((await run).passed,true);});
test('malicious accessor is rejected without executing or leaking it',async()=>{const f=await fixture();let reads=0;Object.defineProperty(f.browser,'passed',{enumerable:true,get(){reads++;throw Error('PRIVATE_SENTINEL');}});await assert.rejects(assertRollingNotificationAcceptance(f));assert.equal(reads,0);});
test('hash failure never publishes partial acceptance or raw error',async()=>{const f=await fixture();f.hash=async()=>{throw Error('PRIVATE_SENTINEL');};await assert.rejects(assertRollingNotificationAcceptance(f),e=>e.message==='Rolling notification acceptance failed.');});

test('later canonical empty block marker suppresses reply without requiring exact reply height',async()=>{
 const f=await fixture();f.marker.blockNumber='5';f.markerContext={blockNumber:'4',blockHash:hex(4),canonical:true};f.publicPage.checkpoint={number:5,hash:hex(5)};
 const previous=f.subscribedPreferences.preferences.head.digest;const events=[{schema:1,revision:'1',kind:4,target:'101',value:true,read_block:0,read_hash:'0',previous_digest:'0'},{schema:1,revision:'2',kind:6,target:'101',value:true,read_block:4,read_hash:'4',previous_digest:previous}];
 const digest=String(await hash([31337n,1n,9n,1n,2n,6n,101n,1n,4n,4n,BigInt(previous)],0x52435031));
 const preferences=await replayPreferenceEvents({scope,head:{initialized:true,schema:1,revision:'2',digest},events,hash});f.markedPreferences.preferences=preferences;f.recoveredPreferences.preferences=preferences;assert.equal((await assertRollingNotificationAcceptance(f)).passed,true);
});

function disableProofAccounting(f){f.browser.traffic.proofSubmits=0;f.browser.traffic.proofPolls=0;f.receiver.proofJobs=0;f.receiver.completedProofJobs=0;f.receiver.browserProofJobs=0;return f;}
test('disabled notification acceptance retains four authentic schema transactions and all paid fees',async()=>{
 const f=disableProofAccounting(await fixture()),result=await assertRollingNotificationAcceptance(f,{proofsEnabled:false});
 assert.equal(result.applicationTransactions,4);assert.equal(result.browserTransactions,2);assert.equal(result.accountingVerified,true);
});
test('disabled notification acceptance rejects any proof traffic or job and retains other negative gates',async()=>{
 for(const mutate of [f=>f.browser.traffic.proofSubmits=1,f=>f.browser.traffic.proofPolls=1,f=>f.receiver.proofJobs=1,f=>f.receiver.completedProofJobs=1,f=>f.receiver.browserProofJobs=1,...Object.entries(mutations).filter(([name])=>!['noPoll','readonlyBrowser'].includes(name)).map(([,fn])=>fn)]){
  const f=disableProofAccounting(await fixture());mutate(f);await assert.rejects(assertRollingNotificationAcceptance(f,{proofsEnabled:false}));
 }
});
test('disabled notification acceptance remains confined to local development and boolean configuration',async()=>{
 for(const mode of [null,0,'disabled'])await assert.rejects(assertRollingNotificationAcceptance(await fixture(),{proofsEnabled:mode}));
 const f=disableProofAccounting(await fixture());f.scope={...f.scope,chainId:'11155111'};await assert.rejects(assertRollingNotificationAcceptance(f,{proofsEnabled:false}));
 await assert.rejects(assertRollingNotificationAcceptance(disableProofAccounting(await fixture())));
});
