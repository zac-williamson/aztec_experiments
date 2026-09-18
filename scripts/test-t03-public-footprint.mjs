import assert from 'node:assert/strict';
import test from 'node:test';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Tx,TxEffect,HashedValues} from '@aztec/stdlib/tx';
import {PublicDataWrite} from '@aztec/stdlib/avm';
import {PartialPrivateTailPublicInputsForPublic,PublicCallRequest} from '@aztec/stdlib/kernel';
import {PrivateLog,PublicLog} from '@aztec/stdlib/logs';
import {classifyT03PublicFootprint} from './t03-public-footprint.mjs';
const address=n=>new AztecAddress(new Fr(n));
function fixture(){
 const tx=Tx.random(),effect=TxEffect.empty();effect.txHash=tx.getTxHash();
 const roles={author:address(101),sharedPayer:address(202),board:address(303),funder:'0x0000000000000000000000000000000000000194'};
 tx.data.feePayer=roles.sharedPayer;
 return{tx,effect,roles};
}
test('actual SDK types distinguish shared payer, missing roles and zero effect counts',()=>{
 const f=fixture(),result=classifyT03PublicFootprint(f);
 assert.equal(result.sharedFeePayer,true);assert.equal(result.authorIsPublicFeePayer,false);
 assert.equal(result.rolePresence.feePayer.otherAuthor,null);assert.equal(result.counts.nullifiers,0);
 const output=JSON.stringify(result);for(const role of Object.values(f.roles))assert(!output.includes(role.toString()));
});
test('detects author in public fields without confusing ciphertext match with clear public argument',()=>{
 const f=fixture(),author=f.roles.author.toField();
 f.tx.publicFunctionCalldata.push(new HashedValues([author],new Fr(600)));
 f.effect.publicDataWrites.push(new PublicDataWrite(new Fr(700),author));
 f.effect.publicLogs.push(new PublicLog(f.roles.board,[author]));
 f.effect.nullifiers.push(new Fr(800));
 f.effect.privateLogs.push(PrivateLog.fromBlobFields(2,[f.roles.sharedPayer.toField(),author]));
 const result=classifyT03PublicFootprint(f);
 assert.equal(result.rolePresence.publicCallCalldata.author,true);
 assert.equal(result.rolePresence.publicWriteValues.author,true);
 assert.equal(result.rolePresence.publicLogContracts.board,true);
 assert.equal(result.rolePresence.privateDeliveryPayloadFields.author,true);
 assert.equal(result.rolePresence.privateDeliveryTags.sharedPayer,true);
 assert.equal(result.rolePresence.nullifiers.author,false);
 assert.equal(result.counts.privateDeliveryEmittedFields,2);
 assert.equal(result.counts.nullifiers,1);
});
test('detects direct author payer and rejects wrong effect or ambiguous/unknown roles',()=>{
 const f=fixture();f.tx.data.feePayer=f.roles.author;
 assert.equal(classifyT03PublicFootprint(f).authorIsPublicFeePayer,true);
 assert.throws(()=>classifyT03PublicFootprint({...f,effect:TxEffect.empty()}),/Effect does not belong/);
 assert.throws(()=>classifyT03PublicFootprint({...f,roles:{...f.roles,secret:'0x123'}}),/Unknown role/);
 assert.throws(()=>classifyT03PublicFootprint({...f,roles:{...f.roles,author:'0x0'}}),/Zero role/);
 assert.throws(()=>classifyT03PublicFootprint({...f,roles:{...f.roles,sharedPayer:f.roles.author}}),/Author cannot/);
});

test('real SDK public call decoding exposes sender and target, including teardown',async()=>{
 const f=fixture(),calldata=await HashedValues.fromCalldata([new Fr(900),f.roles.author.toField()]);
 f.tx.publicFunctionCalldata.length=0;f.tx.publicFunctionCalldata.push(calldata);
 f.tx.data.forRollup=undefined;f.tx.data.forPublic=PartialPrivateTailPublicInputsForPublic.empty();
 f.tx.data.forPublic.publicTeardownCallRequest=new PublicCallRequest(f.roles.author,f.roles.board,false,calldata.hash);
 const result=classifyT03PublicFootprint(f);
 assert.equal(result.counts.publicCalls,1);
 assert.equal(result.rolePresence.publicCallSenders.author,true);
 assert.equal(result.rolePresence.publicCallTargets.board,true);
 assert.equal(result.rolePresence.publicCallCalldata.author,true);
});
