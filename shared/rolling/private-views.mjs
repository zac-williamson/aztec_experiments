// Wallet-local selection from an ordinary public feed page. The caller must
// authenticate/recover preferences and canonical read-marker hashes first.
// No follow, bookmark, subscription or account identifier is sent anywhere.
import {FIELD_MODULUS} from './invocation.mjs';
const fail=()=>Object.assign(Error('Private views are unavailable. Refresh the public and private histories.'),{code:'ROLLING_PRIVATE_VIEWS_INVALID'});
const check=v=>{if(!v)throw fail();};
const natural=v=>Number.isSafeInteger(v)&&v>=0&&!Object.is(v,-0);
const decimal=(v,max=FIELD_MODULUS-1n)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<=max;
const field=v=>decimal(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
function fields(values,{zero=false}={}){
 check(Array.isArray(values));let previous=-1n;
 for(const value of values){check(field(value)&&(zero||value!=='0')&&BigInt(value)>previous);previous=BigInt(value);}
 return new Set(values);
}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function earlier(a,b){for(let i=0;i<a.length;i++){if(a[i]!==b[i])return a[i]<b[i];}return false;}
/**
 * Inputs are JSON data from the validated public client and authenticated private
 * recovery reader. Each result covers exactly ONE public page. Preserve its
 * nextCursor even when no selected posts occur: an empty subset is not exhaustion.
 * Following is the union of followed boards and named identities, in the source
 * feed's reverse canonical order. Explicit thread subscriptions produce reply
 * notifications after the recovered read marker (or from thread creation if no
 * marker exists). These reversible presentation defaults add no chain state.
 */
export function selectPrivateViews(input){
 try{
  const {preferences,page}=input;
  const p=structuredClone(preferences),source=structuredClone(page);
  check(p&&source&&source.schemaVersion===1&&source.complete===true&&typeof source.revision==='string'&&source.revision.length>0);
  check(p.scope&&source.scope&&p.scope.chainId===source.scope.chainId&&p.scope.version===source.scope.rollupVersion);
  check(field(p.scope.chainId)&&p.scope.chainId!=='0'&&field(p.scope.version)&&p.scope.version!=='0'&&field(p.scope.board)&&p.scope.board!=='0');
  check(hash(source.scope.boardAddress)&&BigInt(source.scope.boardAddress).toString()===p.scope.board);
  check(p.head?.schema===1&&typeof p.head.initialized==='boolean'&&decimal(p.head.revision,0xffffffffffffffffn)&&field(p.head.digest));
  check(p.head.initialized?p.head.revision!=='0'&&p.head.digest!=='0':p.head.revision==='0'&&p.head.digest==='0');
  const bookmarks=fields(p.bookmarks),boards=fields(p.followedBoards,{zero:true}),names=fields(p.followedNames),subscriptions=fields(p.subscriptions);
  check(typeof p.replyNotifications==='boolean'&&Array.isArray(p.readMarkers));const read=new Map();
  for(const marker of p.readMarkers){check(field(marker.thread)&&marker.thread!=='0'&&!read.has(marker.thread)&&natural(marker.throughBlock)&&marker.throughBlock<=0xffffffff&&field(marker.blockHash)&&marker.blockHash!=='0');read.set(marker.thread,marker.throughBlock);}
  check(natural(source.checkpoint?.number)&&hash(source.checkpoint.hash));
  for(const height of read.values())check(height<=source.checkpoint.number);
  if(!p.head.initialized)check(!bookmarks.size&&!boards.size&&!names.size&&!subscriptions.size&&!read.size&&p.replyNotifications===true);
  check(source.nextCursor===null||typeof source.nextCursor==='string'&&source.nextCursor.length>0&&source.nextCursor.length<=120);
  check(Array.isArray(source.posts)&&source.posts.length<=100&&source.names&&source.boards);
  const selected={following:[],bookmarks:[],notifications:[]},seen=new Set(),blockHashes=new Map();let previous;
  for(const post of source.posts){
   check(field(post.id)&&post.id!=='0'&&!seen.has(post.id));seen.add(post.id);
   const r=post.record,pos=post.position;check(r&&pos&&[r.subboard,r.name_id,r.parent,r.root].every(field)&&r.root!=='0');
   check([pos.blockNumber,pos.txIndexWithinBlock,pos.logIndexWithinTx].every(v=>decimal(v,BigInt(Number.MAX_SAFE_INTEGER)))&&hash(pos.blockHash));
   const position=[pos.blockNumber,pos.txIndexWithinBlock,pos.logIndexWithinTx].map(BigInt);
   check(position[0]<=BigInt(source.checkpoint.number)&&(!previous||earlier(position,previous)));previous=position;
   check(!blockHashes.has(pos.blockNumber)||blockHashes.get(pos.blockNumber)===pos.blockHash);blockHashes.set(pos.blockNumber,pos.blockHash);
   if(boards.has(r.subboard)||r.name_id!=='0'&&names.has(r.name_id))selected.following.push(post);
   if(bookmarks.has(post.id))selected.bookmarks.push(post);
   if(p.replyNotifications&&r.parent!=='0'&&subscriptions.has(r.root)&&position[0]>BigInt(read.get(r.root)??0))selected.notifications.push(post);
  }
  // Reuse one immutable copy of public content/enrichment across the three views.
  freeze(source);
  return freeze(Object.fromEntries(Object.entries(selected).map(([name,posts])=>[name,{...source,posts}])));
 }catch{throw fail();}
}
