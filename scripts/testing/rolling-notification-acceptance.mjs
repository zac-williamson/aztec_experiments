// TEST ONLY. Parent authenticates actual canonical receipts/effects, sender
// custody, private reader results and receiver/fee accounting. No lifecycle,
// financial callbacks, private serialization, clock changes or retries here.
import {isDeepStrictEqual} from 'node:util';
import {isRollingEvent,unpackRollingText} from '../../shared/rolling/public-events.mjs';
import {replayPreferenceEvents} from '../../shared/rolling/preferences.mjs';
import {selectPrivateViews} from '../../shared/rolling/private-views.mjs';
import {NOTIFICATION_BROWSER_CHECKS} from './rolling-notification-browser.mjs';
const failed=()=>Error('Rolling notification acceptance failed.');
const check=v=>{if(!v)throw failed();};
const same=isDeepStrictEqual;
const hex=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(v);
function record(o,keys){check(o&&[Object.prototype,null].includes(Object.getPrototypeOf(o))&&Reflect.ownKeys(o).length===keys.length);const result={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(o,k);check(d&&Object.hasOwn(d,'value')&&d.enumerable);result[k]=d.value;}return result;}
// Capture only plain bounded data before first await, never execute accessors.
function copy(v,depth=0){check(depth<=16);if(v===null||['string','number','boolean'].includes(typeof v)){if(typeof v==='string')check(v.length<=8192);return v;}check(v&&typeof v==='object');const d=Object.getOwnPropertyDescriptors(v),array=Array.isArray(v);check(array||[Object.prototype,null].includes(Object.getPrototypeOf(v)));const keys=Reflect.ownKeys(d);check(keys.length<=257);const out=array?[]:{};for(const k of keys){if(array&&k==='length')continue;check(typeof k==='string'&&Object.hasOwn(d[k],'value')&&d[k].enumerable);out[k]=copy(d[k].value,depth+1);}if(array)check(out.length===v.length&&keys.length===out.length+1);return out;}
function transaction(input,type){
 const r=record(input,['txHash','blockNumber','txIndexWithinBlock','transactionFee','canonical','executionResult','events']);
 check(hex(r.txHash)&&decimal(r.blockNumber)&&BigInt(r.blockNumber)>0n&&BigInt(r.blockNumber)<=0xffffffffn&&decimal(r.txIndexWithinBlock)&&BigInt(r.txIndexWithinBlock)<=0xffffffffn&&decimal(r.transactionFee)&&BigInt(r.transactionFee)>0n&&r.canonical===true&&r.executionResult==='success');
 check(Array.isArray(r.events)&&r.events.length===(type?1:0));
 if(type){check(isRollingEvent(r.events[0])&&r.events[0].type===type);const p=r.events[0].position;check(p.txHash===r.txHash&&p.blockNumber===r.blockNumber&&p.txIndexWithinBlock===r.txIndexWithinBlock);}
 return copy(r);
}
function earlier(a,b){return BigInt(a.blockNumber)<BigInt(b.blockNumber)||a.blockNumber===b.blockNumber&&BigInt(a.txIndexWithinBlock)<BigInt(b.txIndexWithinBlock);}
function complete(r){check(r?.status==='complete'&&r.complete===true&&Array.isArray(r.orphanedReadMarkers)&&r.orphanedReadMarkers.length===0&&r.preferences);return r.preferences;}
function projected(post,event,root,parent){
 record(post,['id','record','text','timestamp','mainVersion','localVersion','position','order','likes','removal','invocation','bot']);
 const p=event.payload;check(post&&post.id===p.id&&same(post.position,event.position)&&same(post.record,p.record));
 check(post.text===unpackRollingText(p.message,p.length,992)&&post.mainVersion===p.main_policy_version&&post.localVersion===p.local_policy_version&&post.timestamp===p.timestamp);
 check(p.record.kind==='1'&&p.record.subboard==='0'&&p.record.name_id==='0'&&p.record.reference==='0'&&p.record.root===root&&p.record.parent===parent);
 check(post.removal===null&&post.bot===null&&post.invocation===null&&post.likes==='0');
}
/**
 * Four records in canonical order root→subscription→reply→marker. Public decoder
 * branding validates schema/hash, NOT inclusion: parent must supply genuinely
 * canonical records, complete private reader results and actual fee receipts.
 * markerContext is independently checked canonical block metadata; marker may
 * cover a later empty block than reply, never a future/unavailable block.
 * hash must be actual pinned SDK Poseidon; plain digest equality is not authority.
 * Returns aggregates only. Owner/preference associations remain in caller RAM.
 */
export async function assertRollingNotificationAcceptance(input,{proofsEnabled=true}={}){
 try{
  check(typeof proofsEnabled==='boolean');
  const o=record(input,['scope','initialHead','root','reply','subscription','marker','markerContext','subscribedPreferences','markedPreferences','recoveredPreferences','publicPage','browser','receiver','accounting','hash']);check(typeof o.hash==='function');const hash=o.hash;
  const root=transaction(o.root,'PostPublished'),reply=transaction(o.reply,'PostPublished'),subscription=transaction(o.subscription),marker=transaction(o.marker);
  const d={};for(const k of ['scope','initialHead','markerContext','subscribedPreferences','markedPreferences','recoveredPreferences','publicPage','browser','receiver','accounting'])d[k]=copy(o[k]);
  check(proofsEnabled||d.scope.chainId==='31337');
  const rows=[root,subscription,reply,marker];check(new Set(rows.map(r=>r.txHash)).size===4);for(let i=1;i<4;i++)check(earlier(rows[i-1],rows[i]));
  check(same(d.initialHead,{initialized:false,schema:1,revision:'0',digest:'0'}));
  const rootEvent=root.events[0],replyEvent=reply.events[0],rootId=rootEvent.payload.id,replyId=replyEvent.payload.id;check(rootId!==replyId);
  check(same(rootEvent.scope,replyEvent.scope)&&d.scope.chainId===rootEvent.scope.chainId&&d.scope.version===rootEvent.scope.rollupVersion&&d.scope.board===String(BigInt(rootEvent.scope.boardAddress)));
  const page=d.publicPage;check(same(page.scope,rootEvent.scope)&&same(page.names,{})&&same(page.boards,{}));check(page.nextCursor===null&&page.posts?.length===2&&page.posts[0].id===replyId&&page.posts[1].id===rootId);
  projected(page.posts[1],rootEvent,rootId,'0');projected(page.posts[0],replyEvent,rootId,rootId);
  const context=record(d.markerContext,['blockNumber','blockHash','canonical']);check(decimal(context.blockNumber)&&hex(context.blockHash)&&BigInt(context.blockHash)>0n&&context.canonical===true&&BigInt(context.blockNumber)>=BigInt(reply.blockNumber)&&BigInt(context.blockNumber)<=BigInt(marker.blockNumber));
  if(context.blockNumber===reply.blockNumber)check(context.blockHash===replyEvent.position.blockHash);
  const subscribed=complete(d.subscribedPreferences),marked=complete(d.markedPreferences),recovered=complete(d.recoveredPreferences);
  check(subscribed.head.revision==='1'&&marked.head.revision==='2'&&recovered.head.revision==='2');
  const first={schema:1,revision:'1',kind:4,target:rootId,value:true,read_block:0,read_hash:'0',previous_digest:'0'};
  const firstExpected=await replayPreferenceEvents({scope:d.scope,head:subscribed.head,events:[first],hash});check(same(subscribed,firstExpected));
  const second={schema:1,revision:'2',kind:6,target:rootId,value:true,read_block:Number(context.blockNumber),read_hash:String(BigInt(context.blockHash)),previous_digest:firstExpected.head.digest};
  const finalExpected=await replayPreferenceEvents({scope:d.scope,head:marked.head,events:[first,second],hash});check(same(marked,finalExpected)&&same(recovered,finalExpected));
  const unread=selectPrivateViews({preferences:subscribed,page}).notifications,read=selectPrivateViews({preferences:marked,page}).notifications,restored=selectPrivateViews({preferences:recovered,page}).notifications;
  check(same(unread.posts.map(p=>p.id),[replyId])&&read.posts.length===0&&restored.posts.length===0);
  const b=d.browser;check(b.schemaVersion===1&&b.passed===true&&b.stage==='complete'&&b.timedOut===false&&b.diagnostic===null&&Number.isSafeInteger(b.elapsedMs)&&b.elapsedMs>0&&b.elapsedMs<=150000&&b.cleanup?.contextClosed===true&&b.cleanup?.browserClosed===true);
  for(const k of NOTIFICATION_BROWSER_CHECKS)check(b.checks?.[k]===true);
  check(b.traffic?.proofSubmits===(proofsEnabled?2:0)&&b.traffic.nodeSubmissions===2&&b.traffic.completedWritePhases===2&&b.traffic.writePhaseOpen===false);
  if(proofsEnabled)check(Number.isSafeInteger(b.traffic.proofPolls)&&b.traffic.proofPolls>0);else check(b.traffic.proofPolls===0);
  for(const k of ['feedRequests','boardRequests','walletAssets','privateRequests'])check(Number.isSafeInteger(b.traffic[k])&&b.traffic[k]>0);
  for(const k of ['l1Submissions','deniedWrites','blockedRequests','inspectionErrors'])check(b.traffic[k]===0);
  const r=record(d.receiver,['proofJobs','completedProofJobs','nodeSubmissions','browserProofJobs','browserNodeSubmissions','browserL1Submissions','recoveryProofJobs','recoveryNodeSubmissions']);
  check(same(r,{proofJobs:proofsEnabled?4:0,completedProofJobs:proofsEnabled?4:0,nodeSubmissions:4,browserProofJobs:proofsEnabled?2:0,browserNodeSubmissions:2,browserL1Submissions:0,recoveryProofJobs:0,recoveryNodeSubmissions:0}));
  const accounting=record(d.accounting,['verified','chargedTransactions','totalTransactionFee']);check(accounting.verified===true&&accounting.chargedTransactions===4&&decimal(accounting.totalTransactionFee)&&BigInt(accounting.totalTransactionFee)===rows.reduce((n,r)=>n+BigInt(r.transactionFee),0n));
  return {passed:true,applicationTransactions:4,browserTransactions:2,publicPosts:2,publicPreferenceEvents:0,feeOnlySubscriber:true,uiSubscriptionAndReadConfirmed:true,actualReplyUnreadThenSuppressed:true,exactRecoveredPrivateState:true,canonicalMarker:true,newRecoveryProofJobs:0,newRecoveryNodeSubmissions:0,accountingVerified:true};
 }catch{throw failed();}
}
