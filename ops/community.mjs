import {DatabaseSync} from 'node:sqlite';
import {statSync} from 'node:fs';

const DAY=86400;
const buckets=()=>({le_1m:0,le_5m:0,le_1h:0,le_6h:0,le_24h:0,gt_24h:0});
const uint=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(value);
/** Read only the existing validated PUBLIC projection. Temporary post IDs stay
 * inside this function and are never combined with browser analytics. Returns
 * aggregates only. Invoke as the existing index owner, not via a public path. */
export function readCommunitySummary({filename,days=7,now=Date.now,maxPosts=100000}={}){
 let db;
 try{
  if(typeof filename!=='string'||!statSync(filename).isFile()||!Number.isInteger(days)||days<1||days>90||!Number.isInteger(maxPosts)||maxPosts<1||maxPosts>100000)throw Error();
  const end=Math.floor(now()/1000),start=end-days*DAY;
  db=new DatabaseSync(filename,{readOnly:true});db.exec('PRAGMA busy_timeout=50; PRAGMA query_only=ON; BEGIN');
  const row=db.prepare('SELECT value FROM control WHERE id=1').get();
  if(!row||row.value.length>65536)throw Error();const control=JSON.parse(row.value);
  if(control.schema!==3||!uint(control.generation))throw Error();
  // No content, names, transactions, wallets, or per-reader state is selected.
  // Projection timestamps originate in authenticated PostPublished events; the
  // decoder checks them against the native block header (public-events.mjs).
  const posts=db.prepare(`SELECT p.k AS id,json_extract(p.value,'$.record.root') AS root,
   json_extract(p.value,'$.record.parent') AS parent,json_extract(p.value,'$.timestamp') AS stamp,
   json_type(p.value,'$.bot') IS NOT NULL AND json_type(p.value,'$.bot')!='null' AS bot
   FROM projection p WHERE p.g=? AND p.kind='posts' AND p.stamp>=? AND p.stamp<=?
   AND (json_type(p.value,'$.removal') IS NULL OR json_type(p.value,'$.removal')='null')
   AND NOT EXISTS(SELECT 1 FROM projection b WHERE b.g=p.g AND b.kind='boards'
    AND b.k=json_extract(p.value,'$.record.subboard') AND json_extract(b.value,'$.rejected')=1)
   LIMIT ?`).all(control.generation,BigInt(start).toString(16).padStart(64,'0'),BigInt(end).toString(16).padStart(64,'0'),maxPosts+1);
  db.exec('COMMIT');
  if(posts.length>maxPosts)return {schemaVersion:1,status:'unavailable',reason:'window-too-large'};
  let humanPosts=0,bokPosts=0,humanReplies=0,bokReplies=0;
  const threads=new Map(),firstReplies=new Map();
  for(const post of posts){
   if(!uint(post.id)||!uint(post.root)||!uint(post.parent)||!uint(post.stamp)||!Number.isSafeInteger(Number(post.stamp)))throw Error();
   post.stamp=Number(post.stamp);if(post.stamp<start||post.stamp>end)throw Error();
   if(post.bot){bokPosts++;if(post.parent!=='0')bokReplies++;}
   else{humanPosts++;if(post.parent!=='0'){humanReplies++;firstReplies.set(post.root,Math.min(firstReplies.get(post.root)??Infinity,post.stamp));}else if(post.root===post.id)threads.set(post.id,post.stamp);}
  }
  let matureThreads=0,repliedWithin24h=0,threadsWithReply=0;const firstHumanReplySeconds=buckets();
  for(const [id,stamp]of threads){
   const reply=firstReplies.get(id),mature=stamp<=end-DAY;if(mature)matureThreads++;
   if(reply===undefined||reply<stamp)continue;
   threadsWithReply++;const delta=reply-stamp;
   if(mature&&delta<=DAY)repliedWithin24h++;
   const bucket=delta<=60?'le_1m':delta<=300?'le_5m':delta<=3600?'le_1h':delta<=21600?'le_6h':delta<=DAY?'le_24h':'gt_24h';firstHumanReplySeconds[bucket]++;
  }
  return {schemaVersion:1,status:'ok',days,asOfUtcDay:new Date(end*1000).toISOString().slice(0,10),humanPosts,bokPosts,humanReplies,bokReplies,newThreads:threads.size,threadsWithReply,matureThreads,repliedWithin24h,replyWithin24hRate:matureThreads?repliedWithin24h/matureThreads:null,firstHumanReplySeconds,semantics:'Current indexed public posts in the trailing window, excluding removed posts and rejected boards. The 24-hour denominator includes only human-started threads at least 24 hours old. Human means non-Bok; replies may be from the same anonymous author. No author linkage is inferred.'};
 }catch{return {schemaVersion:1,status:'unavailable',reason:'public-index-unavailable'};}
 finally{try{db?.close();}catch{}}
}
