import {FIELD_MODULUS} from './invocation.mjs';
const fail=()=>Object.assign(Error('Public likes are unavailable.'),{code:'ROLLING_LIKES_UNAVAILABLE'});
const check=value=>{if(!value)throw fail();};
export function likePostIds(input){
 if(!Array.isArray(input)||input.length<1||input.length>32)throw fail();
 const ids=Array.from(input,value=>{check(typeof value==='string'&&/^(?:0x[0-9a-f]{64}|[1-9][0-9]{0,76})$/.test(value)&&BigInt(value)>0n&&BigInt(value)<FIELD_MODULUS);return BigInt(value).toString();});
 check(new Set(ids).size===ids.length);return ids;
}
const sorted=ids=>[...ids].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
const anchor=value=>value&&Number.isSafeInteger(value.number)&&value.number>=0&&/^0x[0-9a-f]{64}$/.test(value.hash);
const scalar=value=>typeof value==='string'&&/^[1-9][0-9]{0,76}$/.test(value)&&BigInt(value)<FIELD_MODULUS;
// Every request is scoped only by public posts. Neither a secret-derived tag,
// storage slot, owner, nor a personalized filter crosses this boundary.
const pendingByFetcher=new WeakMap();
export function createPublicLikeReader({fetcher=globalThis.fetch,origin=globalThis.__rollingWalletAssetBase?new URL(globalThis.__rollingWalletAssetBase).origin:globalThis.location?.origin}={}){
 check(typeof fetcher==='function');let pending=pendingByFetcher.get(fetcher);if(!pending){pending=new Map();pendingByFetcher.set(fetcher,pending);}
 return input=>{
  const posts=sorted(likePostIds(input.posts));check(input.limit===100&&(input.cursor===null||typeof input.cursor==='string'&&input.cursor.length>0&&input.cursor.length<=2048));
  const url=new URL('/api/likes',origin);url.searchParams.set('posts',posts.join(','));url.searchParams.set('limit','100');if(input.cursor!==null)url.searchParams.set('cursor',input.cursor);
  const key=url.href;if(pending.has(key))return pending.get(key);
  const result=(async()=>{
   const response=await fetcher(key,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});check(response.ok&&response.body);
   const reader=response.body.getReader(),parts=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;check(size<=1024*1024);parts.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  })().finally(()=>pending.delete(key));pending.set(key,result);return result;
 };
}
export async function readPublicLikeState({sdk,readPage,network,board,walletSecret,guard,authenticateAnchor},input){
 const ids=likePostIds(input),postIds=sorted(ids);check(typeof readPage==='function');await guard();
 const tags=new Map(postIds.map(post=>[post,new Set()])),cursors=new Set();let cursor=null,publication;
 // Exhaust the same public pages for every account, even when a match is found.
 for(let page=0;;page++){
  check(page<1024);const value=await readPage({posts:postIds,limit:100,cursor});await guard();
  check(value?.schemaVersion===1&&value.complete===true&&anchor(value.checkpoint)&&anchor(value.confirmationCheckpoint)&&value.confirmationCheckpoint.number<=value.checkpoint.number&&typeof value.revision==='string'&&value.revision.length>0&&value.revision.length<=128);
  check(value.scope?.chainId===String(network.chainId)&&value.scope.rollupVersion===String(network.version)&&value.scope.rollupAddress===network.rollup&&value.scope.boardAddress===String(board));
  check(JSON.stringify(value.postIds)===JSON.stringify(postIds)&&Array.isArray(value.items)&&value.items.length<=100);
  const current=JSON.stringify([value.scope,value.checkpoint,value.confirmationCheckpoint,value.revision]);if(publication)check(current===publication.identity);else publication={identity:current,anchor:{...value.checkpoint},confirmationCheckpoint:{...value.confirmationCheckpoint},revision:value.revision};
  for(const row of value.items){check(row&&tags.has(row.post)&&scalar(row.tag)&&!tags.get(row.post).has(row.tag));tags.get(row.post).add(row.tag);}
  cursor=value.nextCursor;if(cursor===null)break;check(typeof cursor==='string'&&cursor.length>0&&cursor.length<=2048&&!cursors.has(cursor)&&value.items.length>0);cursors.add(cursor);
 }
 if(authenticateAnchor)await authenticateAnchor(publication.anchor);await guard();
 const address=new sdk.AztecAddress(new sdk.Fr(BigInt(board))),master=sdk.deriveMasterNullifierHidingSecretKey(new sdk.Fr(BigInt(walletSecret))),nhk=await sdk.computeAppNullifierHidingKey(master,address);await guard();
 const posts=await Promise.all(ids.map(async post=>{const tag=await sdk.poseidon2HashWithSeparator([1n,BigInt(network.chainId),BigInt(network.version),BigInt(board),BigInt(post),BigInt(nhk.toString())].map(value=>new sdk.Fr(value)),0x52434c31);return {post,liked:tags.get(post).has(BigInt(tag.toString()).toString())};}));
 await guard();return {posts,anchor:publication.anchor,revision:publication.revision,confirmationCheckpoint:publication.confirmationCheckpoint};
}
