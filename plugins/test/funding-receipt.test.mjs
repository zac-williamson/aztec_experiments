import test from 'node:test';
import assert from 'node:assert/strict';
import {readPluginFundingReceipt} from '../funding-receipt.mjs';
import {fundingFixture,fundingIdentity as x} from './funding-fixture.mjs';

test('direct and wallet-wrapped payments bind canonical transaction and exact effects',async()=>{
 for(const kind of ['deposit','withdraw'])for(const tx of [{},{to:x.portal}]){
  const result=await readPluginFundingReceipt(fundingFixture(kind,{tx}));assert.equal(result.outcome,'success');
 }
});
test('deposit binds the portal event and full official V6 Inbox message',async()=>{
 for(const mutation of [
  {account:x.key},{amount:2n},{portal:x.sender},{inbox:x.sender},{duplicate:true},{duplicateInbox:true},
  {message:{secretHash:x.key}},{message:{index:4n}},
  {message:{sender:{actor:x.sender,chainId:31337n}}},{message:{sender:{actor:x.portal,chainId:1n}}},
  {message:{recipient:{actor:x.key,version:42n}}},{message:{recipient:{actor:x.receiver,version:43n}}},
 ])await assert.rejects(readPluginFundingReceipt(fundingFixture('deposit',mutation)),{code:'BB_RECOVERY_REQUIRED'});
});
test('withdrawal rejects missing, duplicate or mismatched exact effects',async()=>{
 for(const mutation of [{recipient:x.portal},{amount:2n},{nonce:x.key},{portal:x.sender},{duplicate:true},{receipt:{logs:[]}}])
  await assert.rejects(readPluginFundingReceipt(fundingFixture('withdraw',mutation)),{code:'BB_RECOVERY_REQUIRED'});
});
test('both payments reject transaction identity substitution and noncanonical receipts',async()=>{
 for(const kind of ['deposit','withdraw'])for(const mutation of [
  {tx:{hash:x.key}},{tx:{from:x.portal}},{tx:{nonce:8}},{tx:{chainId:1n}},
  {receipt:{hash:x.key}},{receipt:{from:x.portal}},{receipt:{to:x.portal}},{block:{hash:x.key}},
  {receipt:{status:2}},{receipt:{blockNumber:null}},
 ])await assert.rejects(readPluginFundingReceipt(fundingFixture(kind,mutation)),{code:'BB_RECOVERY_REQUIRED'});
});
test('pending and canonical reverted payments do not claim a successful effect',async()=>{
 for(const kind of ['deposit','withdraw']){
  assert.equal((await readPluginFundingReceipt(fundingFixture(kind,{receipt:{status:0,logs:[]}}))).outcome,'reverted');
  const pending=fundingFixture(kind);pending.provider.getTransactionReceipt=async()=>null;assert.equal(await readPluginFundingReceipt(pending),null);
 }
});
