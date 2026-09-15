import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import {Fr} from '@aztec/foundation/curves/bn254';
const context=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});
vm.runInContext(await readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8'),context);
const codec=context.BillboardPostCodec;
const id=new Fr(1n<<180n).toString();
test('large stable Field identity is preserved without Number conversion',()=>{
  assert.equal(codec.canonicalPostId({Fr},id,true),id);
  for(const bad of [0,1,0n,Fr.ZERO,'0x1',id.toUpperCase(),null])assert.throws(()=>codec.canonicalPostId({Fr},bad,true));
});
test('order parsing rejects truncation and unsafe integer aliases',()=>{
  for(const bad of ['1x','01','1.0','-1','1e2',Number.MAX_SAFE_INTEGER+1,1n<<64n,{},null])assert.throws(()=>codec.safePostOrder(bad));
  assert.equal(codec.safePostOrder('42'),42);
});
test('message byte length and canonical padding round trip multi-byte text',()=>{
  for(const text of ['hello','é'.repeat(31),'private 🌍','a'.repeat(992)]){
    const packed=codec.packPostMessage(text);
    assert.equal(packed.byteLength,Buffer.byteLength(text));
    assert.equal(codec.decodePostMessage(packed.fields,packed.byteLength),text);
  }
  for(const text of ['', 'a\0b', '\ud800','a'.repeat(993)])assert.throws(()=>codec.packPostMessage(text));
  const packed=codec.packPostMessage('ok');packed.fields[31]=1n;
  assert.throws(()=>codec.decodePostMessage(packed.fields,2),/padding/);
});
test('moderation resolves displayed order once and thereafter carries only identity',async()=>{
  const calls=[];const contract={methods:{
    get_post_id:order=>({simulate:async()=>{calls.push(['order',order]);return{result:BigInt(id)};}}),
    get_post_exists:value=>({simulate:async()=>{calls.push(['id',value.toString()]);return{result:true};}}),
  }};
  assert.equal(await codec.resolvePostId({Fr},contract,'author',{postIndex:'7'}),id);
  assert.deepEqual(calls,[['order',7n],['id',id]]);
  calls.length=0;
  assert.equal(await codec.resolvePostId({Fr},contract,'author',{postId:id}),id);
  assert.deepEqual(calls,[['id',id]]);
});
test('unknown identity and unsafe order stop before signing',async()=>{
  let count=0;const contract={methods:{get_post_exists:()=>({simulate:async()=>{count++;return{result:false};}})}};
  await assert.rejects(codec.resolvePostId({Fr},contract,'author',{postId:id}),/Unknown post ID/);
  await assert.rejects(codec.resolvePostId({Fr},contract,'author',{postIndex:'7garbage'}),/Invalid post order/);
  assert.equal(count,1);
});
test('state conflict causes refresh and a new attempt, never resubmission of old proof',async()=>{
  const events=[];let number=0;
  const result=await codec.withFreshPostState(async()=>{
    const value=`proof-${++number}`;const txHash={toString:()=>value};events.push(txHash.toString());
    const tx={getTxHash:()=>txHash};
    await codec.submitOnceWithReconciliation({sendTx:async()=>{if(number===1)throw new Error('existing nullifier');},getTxReceipt:async()=>({txHash,status:'dropped'}),isValidTx:async()=>({result:'invalid',reason:['Existing nullifier']})},tx);
    return number;
  },async()=>events.push('refresh'));
  assert.equal(result,2);assert.deepEqual(events,['proof-1','refresh','proof-2']);
});
test('uncertain submission never triggers automatic new proof or resend',async()=>{
  let sent=0,refreshed=0;const txHash={toString:()=>id};
  await assert.rejects(codec.withFreshPostState(()=>codec.submitOnceWithReconciliation({sendTx:async()=>{sent++;throw new Error('timeout');},getTxReceipt:async()=>({txHash,status:'dropped'})},{getTxHash:()=>txHash}),async()=>refreshed++),e=>e.code==='BB_SUBMISSION_UNKNOWN');
  assert.equal(sent,1);assert.equal(refreshed,0);
});
test('exact already-known transaction is reconciled without resending',async()=>{
  let sent=0;const txHash={toString:()=>id};
  await codec.submitOnceWithReconciliation({sendTx:async()=>{sent++;throw new Error('already exists');},getTxReceipt:async()=>({txHash,status:'pending'})},{getTxHash:()=>txHash});
  assert.equal(sent,1);
});
test('failed, proposed, dropped and mismatched receipts never report success',()=>{
  const txHash={toString:()=>id};const receipt={txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
  assert.equal(codec.requireSuccessfulReceipt(receipt,txHash),receipt);
  for(const change of [{status:'proposed'},{status:'dropped'},{executionResult:'reverted'},{txHash:{toString:()=> 'other'}},{blockNumber:null}])assert.throws(()=>codec.requireSuccessfulReceipt({...receipt,...change},txHash));
});
test('queued drop requires structured pinned conflict validation before fresh proof',async()=>{
  const txHash={toString:()=>id},tx={getTxHash:()=>txHash},receipt={txHash,status:'dropped',error:'Tx dropped by P2P node'};
  for(const reason of ['Existing nullifier','Block header not found']){
    let attempts=0,refreshes=0;
    const answer=await codec.withFreshPostState(async()=>{attempts++;if(attempts===1)await codec.classifyDroppedTransaction({getTxReceipt:async()=>receipt,isValidTx:async value=>{assert.equal(value,tx);return{result:'invalid',reason:[reason]};}},tx,receipt);return 'new proof';},async()=>refreshes++);
    assert.equal(answer,'new proof');assert.equal(attempts,2);assert.equal(refreshes,1);
  }
  for(const validation of [{result:'valid'},{result:'invalid',reason:['bad signature']},{result:'invalid',reason:['Existing nullifier','bad signature']}]){
    await assert.rejects(codec.classifyDroppedTransaction({getTxReceipt:async()=>receipt,isValidTx:async()=>validation},tx,receipt),e=>e.code==='BB_SUBMISSION_UNKNOWN');
  }
});
test('state refresh has a bounded retry budget',async()=>{
  let attempts=0,refreshes=0;
  await assert.rejects(codec.withFreshPostState(async()=>{attempts++;throw Object.assign(new Error('conflict'),{code:'BB_STATE_CONFLICT'});},async()=>refreshes++),e=>e.code==='BB_STATE_CONFLICT');
  assert.equal(attempts,3);assert.equal(refreshes,2);
});
test('receipt becoming included during revalidation prevents fresh proof',async()=>{
  const txHash={toString:()=>id},tx={getTxHash:()=>txHash};
  const included={txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'block'};
  let refreshes=0;
  const result=await codec.withFreshPostState(()=>codec.classifyDroppedTransaction({isValidTx:async()=>({result:'invalid',reason:['Existing nullifier']}),getTxReceipt:async()=>included},tx,{txHash,status:'dropped'}),async()=>refreshes++);
  assert.equal(result,included);assert.equal(refreshes,0);
});
test('dummy retries reject ambiguous spent-right conflicts and allow only invalid anchor refresh',async()=>{
  for(const reason of ['Existing nullifier','Block header not found']){
    let attempts=0,refreshes=0;
    const run=codec.withFreshPostState(async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('state'),{code:'BB_STATE_CONFLICT',stateReasons:[reason]});return 'new';},async()=>refreshes++,2,codec.dummyStateCanRetry);
    if(reason==='Existing nullifier'){await assert.rejects(run,e=>e.code==='BB_STATE_CONFLICT');assert.equal(attempts,1);assert.equal(refreshes,0);}
    else{assert.equal(await run,'new');assert.equal(attempts,2);assert.equal(refreshes,1);}
  }
});

test('outer post retry cannot override an inner dummy spent-right refusal',async()=>{
  const conflict=Object.assign(new Error('state'),{code:'BB_STATE_CONFLICT',stateReasons:['Existing nullifier']});
  for(const isDummy of [true,false]){
    let attempts=0,innerRefresh=0,outerRefresh=0;
    const run=codec.withFreshPostState(()=>codec.withFreshPostState(async()=>{
      attempts++;if(attempts===1)throw conflict;return 'fresh real post';
    },async()=>innerRefresh++,2,codec.dummyStateCanRetry),async()=>outerRefresh++,2,error=>codec.postStateCanRetry(isDummy,error));
    if(isDummy){await assert.rejects(run,error=>error===conflict);assert.equal(attempts,1);assert.equal(outerRefresh,0);}
    else{assert.equal(await run,'fresh real post');assert.equal(attempts,2);assert.equal(outerRefresh,1);}
    assert.equal(innerRefresh,0);
  }
});
test('auto screening propagates unresolved transaction outcomes and retains a timing wait control',async()=>{
  for(const code of ['BB_STATE_CONFLICT','BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_TRANSACTION_DROPPED','BB_DEPOSIT_READ']){
    const failure=Object.assign(new Error('controlled outcome'),{code});let waits=0,attempts=0;
    const workflow=async()=>{for(let i=0;i<2;i++){try{attempts++;throw failure;}
      catch(error){if(!codec.screeningFailureCanWait(error))throw error;waits++;}}};
    await assert.rejects(workflow,error=>error===failure);assert.equal(attempts,1);assert.equal(waits,0);
  }
  const timing=new Error('Too early to post');assert.equal(codec.screeningFailureCanWait(timing),true);
  assert.equal(codec.dummyStateCanRetry({stateReasons:[]}),false);
  assert.equal(codec.dummyStateCanRetry({stateReasons:['Block header not found','Existing nullifier']}),false);
});

test('nested dummy anchor recovery retains one two-refresh budget',async()=>{
  let attempts=0,innerRefresh=0,outerRefresh=0;
  const error=Object.assign(new Error('anchor'),{code:'BB_STATE_CONFLICT',stateReasons:['Block header not found']});
  await assert.rejects(codec.withFreshPostState(()=>codec.withFreshPostState(async()=>{attempts++;throw error;},
    async()=>innerRefresh++,2,codec.dummyStateCanRetry),async()=>outerRefresh++,2,e=>codec.postStateCanRetry(true,e)),e=>e===error);
  assert.equal(attempts,3);assert.equal(innerRefresh,2);assert.equal(outerRefresh,0);
});
