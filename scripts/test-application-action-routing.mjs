// Unit checks of actual harness routing; doubles are not proof evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FROM } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { Fr } from '@aztec/foundation/curves/bn254';
import { proveApplicationAction } from './prove-application-action.mjs';
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
  const f=fixture();await proveApplicationAction({wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared});
  assert.equal(f.seen.request.from,owner);assert.deepEqual(f.seen.request.payload.auth,f.prepared.options.authWitnesses);
  assert.deepEqual(f.seen.fee.gasSettings,{bounded:true});assert.deepEqual(f.seen.proofOptions.scopes,[owner]);
  assert.equal(f.seen.proofOptions.senderForTags,owner);
});
test('actual proven author payer rejects despite privatePayer preparation',async()=>{
  const f=fixture(owner);await assert.rejects(proveApplicationAction({wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared}),/Actual proven fee payer mismatch/);
});
test('private fee route rejects a wrong account or exposed author payer',async()=>{
  for(const change of [p=>{p.options.from=NO_FROM;},p=>{p.expectedFeePayer=owner;}]){
    const f=fixture();change(f.prepared);
    await assert.rejects(proveApplicationAction({wallet:f.wallet,owner,privateFeeAction:async()=>f.prepared}));
    assert.equal(f.seen.request,undefined);
  }
});
