// Labelled index/node ports. The persistent-index suite qualifies authentication;
// this suite checks complete ordered retrieval and reorg/finality fences.
import test from 'node:test';import assert from 'node:assert/strict';
import {rollingConversation} from '../conversation.mjs';
const f=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
function fixture(){
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:f(9),classId:f(10)},checkpoint={number:20,hash:f(20)};
 const posts=[1,2,3,4].map((n,i)=>({id:String(n),record:{root:'1'},order:String(i),position:{blockNumber:String(n+10)},text:n===3?'latest':`text${n}`,bot:n===2?{pluginId:'1'}:null,removal:null}));
 const state={revision:'r1',reads:0,reorg:false,finalized:20};
 const env=()=>({complete:true,scope,revision:state.revision,checkpoint});
 const index={sync:async()=>{},status:()=>({...env(),state:'ready',revision:state.revision}),query:(view,args)=>{
  if(view==='post')return {...env(),post:posts.find(post=>post.id===args.id)};state.reads++;if(state.changeRevision)state.revision='r2';
  return {...env(),posts:args.cursor?posts.slice(2):posts.slice(0,2),nextCursor:args.cursor?null:'next'};
 }};
 const node={getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:1,l1ContractAddresses:{rollupAddress:scope.rollupAddress},realProofs:false}),
 getBlock:async n=>({number:state.finalized,hash:f(20)}),getBlockData:async()=>({header:{globalVariables:{blockNumber:20}},blockHash:state.reorg?f(21):f(20)})};
 return {scope,index,node,posts,state,load:()=>rollingConversation({scope,index,node,development:true}).load({postId:f(3)})};
}
test('complete paginated thread includes earlier Bok reply and excludes later messages',async()=>{
 const h=fixture(),result=await h.load();assert.equal(h.state.reads,2);assert.deepEqual(result.messages,[{id:f(1),role:'user',text:'text1'},{id:f(2),role:'assistant',text:'text2'},{id:f(3),role:'user',text:'latest'}]);assert.equal(result.complete,true);
});
for(const [name,change] of [['changed revision',h=>h.state.changeRevision=true],['reorg',h=>h.state.reorg=true],['unconfirmed',h=>h.state.finalized=12],['projection ahead of finality despite old posts',h=>h.state.finalized=14],['missing root',h=>h.posts[0].id='7'],['duplicate',h=>h.posts[1].id='1'],['reordered',h=>h.posts[1].order='0'],['wrong root',h=>h.posts[1].record.root='4']])test(name+' never returns partial history',async()=>{const h=fixture();change(h);await assert.rejects(h.load());});
test('removed prior post is a tombstone without hidden text',async()=>{const h=fixture();h.posts[0].removal={reason:'removed'};h.posts[0].text='HIDDEN_SENTINEL';const r=await h.load();assert.equal(r.messages[0].text,'[Removed post]');assert(!JSON.stringify(r).includes('HIDDEN_SENTINEL'));});

test('retained paid-context guard fences changes after summary and reservation',async()=>{
 for(const change of [h=>h.state.reorg=true,h=>{h.state.revision='r2';h.posts[0].removal={reason:'removed'};},h=>h.posts[1].text='changed']){
  const h=fixture(),history=await h.load();await history.assertCurrent();
  change(h);await assert.rejects(history.assertCurrent());
  assert.equal(h.state.reads,2,'guard must not reload a different paid context');
 }
});

test('own reservation may advance complete projection without replacing original context',async()=>{
 const h=fixture(),history=await h.load();h.state.revision='r2';h.posts[3].text='New later message';
 await history.assertCurrent();assert.equal(h.state.reads,2);assert.equal(history.messages.length,3);
 assert.equal(history.anchor.number,20);
});
