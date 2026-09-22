import test from 'node:test';import assert from 'node:assert/strict';
import {recordedTransaction} from '../operations.mjs';
test('saved signed transaction is reused after interruption before broadcast',async()=>{
 let value={operations:{}},prepares=0,broadcasts=0;
 const args={store:{read:()=>value,write:async x=>{value=x;}},name:'deposit',identity:'scope',prepare:async()=>{prepares++;return {hash:'h',raw:'same'};},broadcast:async r=>{broadcasts++;assert.equal(r.raw,'same');assert.equal(value.operations.deposit.hash,'h');if(broadcasts===1)throw Error('offline');},wait:async()=>({status:1})};
 await assert.rejects(recordedTransaction(args),/offline/);await recordedTransaction(args);assert.equal(prepares,1);assert.equal(broadcasts,2);
 await assert.rejects(recordedTransaction({...args,identity:'another'}),/different/);
});
