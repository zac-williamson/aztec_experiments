// Unit checks of actual harness routing; doubles are not proof evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_FROM } from '@aztec/aztec.js/account';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { Fr } from '@aztec/foundation/curves/bn254';
import { proveApplicationAction } from './prove-application-action.mjs';
const owner=AztecAddress.fromFieldUnsafe(new Fr(1)),sponsor=AztecAddress.fromFieldUnsafe(new Fr(2));
function fixture(payer=sponsor) {
  const seen={};
  const interaction={request:async options=>{seen.options=options;return {auth:options.authWitnesses};}};
  const wallet={completeFeeOptions:async options=>{seen.fee=options;return options;},
    createTxExecutionRequestFromPayloadAndFee:async(payload,from,fee)=>({payload,from,fee}),
    scopesFrom:(from,additional)=>from===NO_FROM?additional:[from,...additional],
    senderForTagsFrom:(from,sender)=>sender??from,
    pxe:{proveTx:async(request,options)=>{seen.request=request;seen.proofOptions=options;return {
      chonkProof:{isEmpty:()=>false},toTx:async()=>({data:{feePayer:payer}})};}}};
  const options={from:NO_FROM,additionalScopes:[owner],sendMessagesAs:owner,
    authWitnesses:[{testOnly:true}],fee:{gasSettings:{bounded:true}}};
  const prepared={interaction,options,expectedFeePayer:sponsor};
  return {seen,wallet,interaction,prepared};
}
test('sponsored proof receives full authorization, gas and owner tagging context',async()=>{
  const f=fixture();await proveApplicationAction({wallet:f.wallet,owner,sponsoredAction:async()=>f.prepared});
  assert.equal(f.seen.request.from,NO_FROM);assert.deepEqual(f.seen.request.payload.auth,f.prepared.options.authWitnesses);
  assert.deepEqual(f.seen.fee.gasSettings,{bounded:true});assert.deepEqual(f.seen.proofOptions.scopes,[owner]);
  assert.equal(f.seen.proofOptions.senderForTags,owner);
});
test('actual proven author payer rejects despite sponsor preparation',async()=>{
  const f=fixture(owner);await assert.rejects(proveApplicationAction({wallet:f.wallet,owner,sponsoredAction:async()=>f.prepared}),/Actual proven fee payer mismatch/);
});
test('sponsor route never accepts an account root or missing private owner context',async()=>{
  for(const change of [p=>{p.options.from=owner;},p=>{delete p.options.sendMessagesAs;},p=>{p.options.additionalScopes=[];}]){
    const f=fixture();change(f.prepared);
    await assert.rejects(proveApplicationAction({wallet:f.wallet,owner,sponsoredAction:async()=>f.prepared}));
    assert.equal(f.seen.request,undefined);
  }
});
