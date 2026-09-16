import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reconcileFlag} from './flag-outcome.mjs';
const id=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const scope={l1ChainId:'31337',rollupAddress:'0x'+'12'.repeat(20),rollupVersion:'1',boardAddress:id(1),portalAddress:'0x'+'34'.repeat(20)};
const receipt={txHash:id(20),status:'finalized',executionResult:'success',blockNumber:10,blockHash:id(10)};
const event={schemaVersion:1,scope,type:'PostFlagged',position:{blockNumber:'10',blockHash:id(10),txHash:id(20),txIndexWithinBlock:'0',logIndexWithinTx:'1'},payload:{postId:id(2),policyVersion:id(3),reason:'Spam',flaggedAt:'50',censorAddress:id(4)}};
function fixture({changeReceipt={},changeEvent={},node={}}={}){
 const r={...receipt,...changeReceipt};
 return {scope,postId:id(2),policyVersion:id(3),transactionHash:id(20),flagEvent:{...event,...changeEvent},node:{getTxReceipt:async()=>r,getBlockData:async()=>({blockHash:id(10),header:{globalVariables:{blockNumber:10}}}),...node}};
}
test('canonical finalized receipt and matching scoped flag are required to confirm',async()=>{
 const result=await reconcileFlag(fixture());assert.equal(result.state,'confirmed');assert.deepEqual(result.receipt,receipt);assert.deepEqual(result.flagEvent,event);
});
for(const status of ['checkpointed','proven'])test(status+' success remains submitted',async()=>assert.equal((await reconcileFlag(fixture({changeReceipt:{status}}))).state,'submitted'));
for(const [status,state] of [['pending','pending'],['proposed','pending'],['dropped','dropped'],['unknown','unknown']])test(status+' never confirms',async()=>assert.equal((await reconcileFlag(fixture({changeReceipt:{status}}))).state,state));
test('canonical revert remains reverted even with a matching event',async()=>assert.equal((await reconcileFlag(fixture({changeReceipt:{executionResult:'reverted'}}))).state,'reverted'));
for(const executionResult of [undefined,'unknown',null])test('unknown execution outcome remains unknown: '+executionResult,async()=>assert.equal((await reconcileFlag(fixture({changeReceipt:{executionResult}}))).state,'unknown'));
test('canonical successful receipt without event awaits event',async()=>assert.equal((await reconcileFlag({...fixture(),flagEvent:null})).state,'awaiting-event'));
for(const [label,changeReceipt] of [['wrong transaction',{txHash:id(21)}],['missing hash',{blockHash:undefined}],['invalid height',{blockNumber:'10'}]])test(label+' receipt fails closed',async()=>assert.equal((await reconcileFlag(fixture({changeReceipt}))).state,'unknown'));
for(const [label,changeEvent] of [
 ['wrong post',{payload:{...event.payload,postId:id(5)}}],['wrong policy',{payload:{...event.payload,policyVersion:id(5)}}],
 ['wrong transaction',{position:{...event.position,txHash:id(21)}}],['wrong block',{position:{...event.position,blockHash:id(11)}}],
 ['wrong height',{position:{...event.position,blockNumber:'11'}}],['wrong scope',{scope:{...scope,boardAddress:id(5)}}],
 ['malformed event',{payload:{}}],
 ['different event type',{type:'PolicyPublished',payload:{policyVersion:id(3),text:'No spam',censorWindow:'3600'}}],
])test(label+' event cannot confirm',async()=>assert.equal((await reconcileFlag(fixture({changeEvent}))).state,'unknown'));
for(const block of [null,{blockHash:id(11),header:{globalVariables:{blockNumber:10}}},{blockHash:id(10),header:{globalVariables:{blockNumber:11}}}])test('reorg or missing canonical block remains unknown',async()=>assert.equal((await reconcileFlag(fixture({node:{getBlockData:async()=>block}}))).state,'unknown'));
for(const method of ['getTxReceipt','getBlockData'])test(method+' RPC failure stays unknown',async()=>assert.equal((await reconcileFlag(fixture({node:{[method]:async()=>{throw new Error('offline');}}}))).state,'unknown'));
test('malformed transaction hash does not call RPC',async()=>{let calls=0;assert.equal((await reconcileFlag({...fixture({node:{getTxReceipt:async()=>{calls++;}}}),transactionHash:'bad'})).state,'unknown');assert.equal(calls,0);});
