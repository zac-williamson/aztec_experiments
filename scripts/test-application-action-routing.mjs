// Unit checks of actual harness routing; doubles are not proof evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FROM } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { Fr } from '@aztec/foundation/curves/bn254';
import { proveApplicationAction, measureApplicationGas } from './prove-application-action.mjs';
const owner=AztecAddress.fromFieldUnsafe(new Fr(1)),privatePayer=AztecAddress.fromFieldUnsafe(new Fr(2));
function fixture(payer=privatePayer) {
  const seen={};
  const interaction={request:async options=>{seen.options=options;return {auth:options.authWitnesses};}};
  const wallet={completeFeeOptions:async options=>{seen.fee=options;return options;},
    createTxExecutionRequestFromPayloadAndFee:async(payload,from,fee)=>({payload,from,fee}),
    scopesFrom:(from,additional)=>from===NO_FROM?additional:[from,...additional],
    senderForTagsFrom:(from,sender)=>sender??from,
    pxe:{proveTx:async(request,options)=>{seen.request=request;seen.proofOptions=options;return {
      chonkProof:{isEmpty:()=>false},toTx:async()=>({data:{feePayer:payer}})};}}};
  const options={from:owner,additionalScopes:[],
    authWitnesses:[{testOnly:true}],fee:{gasSettings:{bounded:true}}};
  const prepared={interaction,options,expectedFeePayer:privatePayer};
  return {seen,wallet,interaction,prepared};
}
test('private fee proof preserves payment options, gas and owner context',async()=>{
  const f=fixture();await proveApplicationAction({payerMode:'private',wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared});
  assert.equal(f.seen.request.from,owner);assert.deepEqual(f.seen.request.payload.auth,f.prepared.options.authWitnesses);
  assert.deepEqual(f.seen.fee.gasSettings,{bounded:true});assert.deepEqual(f.seen.proofOptions.scopes,[owner]);
  assert.equal(f.seen.proofOptions.senderForTags,owner);
});
test('actual proven author payer rejects despite privatePayer preparation',async()=>{
  const f=fixture(owner);await assert.rejects(proveApplicationAction({payerMode:'private',wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared}),/Actual proven fee payer mismatch/);
});
test('private fee route rejects a wrong account or exposed author payer',async()=>{
  for(const change of [p=>{p.options.from=NO_FROM;},p=>{p.expectedFeePayer=owner;}]){
    const f=fixture();change(f.prepared);
    await assert.rejects(proveApplicationAction({payerMode:'private',wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared}));
    assert.equal(f.seen.request,undefined);
  }
});

test('payer mode is required and never inferred from an available callback',async()=>{
  for(const options of [{}, {privateFeeAction:async()=>{}}, {payerMode:'private'},
    {payerMode:'genesis',privateFeeAction:async()=>{}}, {payerMode:'unknown'}]){
    const f=fixture();
    await assert.rejects(proveApplicationAction({wallet:f.wallet,owner,interaction:f.interaction,...options}));
    assert.equal(f.seen.request,undefined);
  }
});
test('explicit genesis fixture uses only the account payer',async()=>{
  const f=fixture(owner);
  await proveApplicationAction({payerMode:'genesis',wallet:f.wallet,owner,interaction:f.interaction});
  assert.equal(f.seen.request.from,owner);
});

test('withdrawal rejection helper emits valid progress for both exact constraint reasons',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./t02-screening-journey.mjs',import.meta.url),'utf8');
 const start=source.indexOf('  async function rejectWithdrawal(reason)'),end=source.indexOf('  const pack=',start);assert(start>=0&&end>start);
 const stages=[],fields=[1n],observation={};let unchanged=0;
 const factory=new Function('mark','board','claim','privateFeeAction','wallet','account','assert','logical','fields','exact','currentHash','observation',source.slice(start,end)+';return rejectWithdrawal;');
 for(const reason of ['Too early to withdraw -- not all posts screened','Too early to withdraw -- time lock not expired']){
  const reject=factory(name=>{assert.match('journey:'+name,/^[a-zA-Z0-9:_-]{1,80}$/);stages.push(name);},{methods:{withdraw:()=>({})}},{depositChainId:1},async()=>{throw Error(reason);},{},{address:'test'},assert,async()=>fields,fields,async()=>{unchanged++;},'hash',observation);
  await reject(reason);
 }
 assert.equal(stages.length,2);assert.equal(unchanged,2);assert.equal(observation.rejections.length,2);
});

test('gas measurement uses the exact proven transaction with fee enforcement and rejects reverts',async()=>{
 const tx={proof:'already-proven'},gasUsed={totalGas:{daGas:12,l2Gas:34},teardownGas:{daGas:0,l2Gas:0}};
 let calls=0;
 const node={simulatePublicCalls:async(actual,skipFees)=>{calls++;assert.equal(actual,tx);assert.equal(skipFees,false);return {gasUsed,revertReason:undefined};}};
 assert.deepEqual(await measureApplicationGas(node,tx),gasUsed);assert.equal(calls,1);
 await assert.rejects(measureApplicationGas({simulatePublicCalls:async()=>({gasUsed,revertReason:Error('reverted')})},tx),/Gas measurement must execute successfully/);
});
