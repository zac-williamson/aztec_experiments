import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateFeeSimulator} from './private-fee-simulation.mjs';

test('display simulation skips only admission; strict submission simulation retains it',async()=>{
 const calls=[],result={actual:'fee-enforced simulation'};
 const wallet={simulateTx:async(payload,options)=>{calls.push({payload,options});return result;}};
 const payload={},from={},gasSettings={};
 assert.equal(await createPrivateFeeSimulator(wallet,{}, {skipAdmissionValidation:true}).public(payload,from,gasSettings,true),result);
 assert.equal(calls[0].options.skipTxValidation,true);
 assert.equal(calls[0].options.skipFeeEnforcement,false);
 assert.equal(await createPrivateFeeSimulator(wallet,{}).public(payload,from,gasSettings,true),result);
 assert.equal(calls[1].options.skipTxValidation,false);
 assert.equal(calls[1].options.skipFeeEnforcement,false);
 assert.equal(calls.length,2);
});
