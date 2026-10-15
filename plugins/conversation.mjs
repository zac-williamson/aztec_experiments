import assert from 'node:assert/strict';
const field=value=>'0x'+BigInt(value).toString(16).padStart(64,'0');
/** Trusted hosted-service capability. Uses the authenticated persistent index,
 * never a user-supplied history or cache response. Returns all chronological
 * posts through this request, including authenticated bot replies/tombstones.
 * A changing publication, missing page or capacity limit fails before billing.
 */
export function rollingConversation({index,node,scope,development=false,maxMessages=4096}){
 assert.equal(typeof development,'boolean');assert(!development||scope.chainId==='31337');
 assert(Number.isSafeInteger(maxMessages)&&maxMessages>=1&&maxMessages<=4096);
 scope=Object.freeze({...scope});const expected=JSON.stringify(scope),sync=index.sync.bind(index),query=index.query.bind(index),status=index.status.bind(index);
 return Object.freeze({async load({postId}){
  const id=field(postId);await sync();const initial=status();assert(initial.state==='ready'&&initial.complete===true);
  assert.equal(JSON.stringify(initial.scope),expected);
  const selected=query('post',{id:BigInt(id).toString()}),request=selected.post;
  assert(request&&field(request.id)===id&&!request.bot&&!request.removal);
  const revision=selected.revision,checkpoint=selected.checkpoint,threadId=field(request.record.root);
  assert.equal(revision,initial.revision);
  const info=await node.getNodeInfo();assert.equal(String(info.l1ChainId),scope.chainId);assert.equal(String(info.rollupVersion),scope.rollupVersion);
  assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),scope.rollupAddress);assert.equal(info.realProofs,!development);
  const confirmed=await node.getBlock(development?'checkpointed':'finalized');assert(confirmed&&Number.isSafeInteger(confirmed.number)&&/^0x[0-9a-f]{64}$/.test(String(confirmed.hash))); 
  assert(Number.isSafeInteger(checkpoint.number)&&checkpoint.number<=confirmed.number,'Conversation publication is not finalized');
  const check=async()=>{
   const current=status();assert(current.state==='ready'&&current.complete&&current.revision===revision);
   const block=await node.getBlockData(checkpoint.number);assert.equal(Number(block?.header?.globalVariables?.blockNumber),checkpoint.number);assert.equal(String(block?.blockHash),checkpoint.hash);
   assert.equal(String((await node.getBlock(confirmed.number))?.hash),String(confirmed.hash));
   const end=status();assert(end.state==='ready'&&end.complete===true&&end.revision===revision);
  };
  await check();const messages=[],captured=[],seen=new Set(),cursors=new Set();let cursor=null,prior=-1n,found=false;
  while(!found){
   const page=query('thread',{root:BigInt(threadId).toString(),limit:100,cursor});
   assert(page.complete===true&&page.revision===revision&&JSON.stringify(page.scope)===expected&&JSON.stringify(page.checkpoint)===JSON.stringify(checkpoint));
   assert(Array.isArray(page.posts)&&page.posts.length>0);
   for(const post of page.posts){
    const postId=field(post.id),order=BigInt(post.order);assert(!seen.has(postId)&&order>prior&&field(post.record.root)===threadId);
    assert(BigInt(post.position.blockNumber)<=BigInt(confirmed.number));
    if(!messages.length)assert.equal(postId,threadId);
    assert(messages.length<maxMessages);seen.add(postId);prior=order;
    messages.push({id:postId,role:post.bot?'assistant':'user',text:post.removal?'[Removed post]':post.text});
    captured.push({id:postId,root:field(post.record.root),order:String(post.order),block:String(post.position.blockNumber),role:post.bot?'assistant':'user',text:post.removal?'[Removed post]':post.text});
    if(postId===id){found=true;break;}
   }
   if(!found){assert(typeof page.nextCursor==='string'&&!cursors.has(page.nextCursor));cursors.add(page.nextCursor);cursor=page.nextCursor;}
  }
  assert.equal(messages.at(-1).text,request.text);await check();
  // The trusted host retains this closure for its immediate pre-inference
  // guard. It validates this exact history; it never reloads a newer thread
  // after a summary has already been paid for. Do not serialize it into a
  // metering request or expose it as a user-supplied capability.
  const assertCurrent=async()=>{
   // Our own reservation advances the public index. A later complete projection
   // is allowed only while the exact summarized rows and original anchors remain
   // canonical. Newer posts do not silently enter the already-paid summary.
   const current=status();assert(current.state==='ready'&&current.complete===true&&JSON.stringify(current.scope)===expected);
   assert(Number.isSafeInteger(current.checkpoint.number)&&current.checkpoint.number>=checkpoint.number);
   const head=await node.getBlock(development?'checkpointed':'finalized');assert(head&&current.checkpoint.number<=head.number);
   for(const saved of captured){
    const result=query('post',{id:BigInt(saved.id).toString()}),post=result.post;
    assert(result.revision===current.revision&&post);
    assert.deepEqual({id:field(post.id),root:field(post.record.root),order:String(post.order),block:String(post.position.blockNumber),role:post.bot?'assistant':'user',text:post.removal?'[Removed post]':post.text},saved,'Paid conversation changed');
   }
   for(const anchor of [checkpoint,current.checkpoint]){
    const block=await node.getBlockData(anchor.number);assert.equal(Number(block?.header?.globalVariables?.blockNumber),anchor.number);assert.equal(String(block?.blockHash),anchor.hash);
   }
   assert.equal(String((await node.getBlock(confirmed.number))?.hash),String(confirmed.hash));
   const end=status();assert(end.state==='ready'&&end.complete===true&&end.revision===current.revision);
  };
  return {canonical:true,complete:true,threadId,anchor:{...checkpoint},messages,assertCurrent};
 }});
}
