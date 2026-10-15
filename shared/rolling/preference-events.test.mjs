// Actual pinned SDK ABI/selector/Fr objects with artificial vectors. These tests
// are not authenticated encrypted-log delivery or canonical-chain acceptance.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventSelector,decodeFunctionSignature,loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {createPreferenceEventDecoder} from './preference-events.mjs';
after(()=>BarretenbergSync.destroySingleton());
const sdk={EventSelector,decodeFunctionSignature};
const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url))));
async function fixture(values=[1n,1n,1n,4n,1n,0n,0n,0n]){
 const decoder=await createPreferenceEventDecoder({sdk,artifact});
 return {decoder,row:{packedEvent:values.map(n=>new Fr(n)),eventSelector:decoder.selector,l2BlockNumber:9,l2BlockHash:BlockHash.fromString('0x'+9n.toString(16).padStart(64,'0')),txHash:TxHash.fromString('0x'+8n.toString(16).padStart(64,'0'))},range:{fromBlock:1,toBlock:10}};
}
test('registered eight-field ABI decodes exact booleans, u64 and canonical field strings with SDK metadata',async()=>{
 const {decoder,row,range}=await fixture([1n,0xffffffffffffffffn,6n,4n,1n,7n,13n,20n]);
 const actual=decoder.decode(row,range);assert.deepEqual(actual.event,{schema:1,revision:'18446744073709551615',kind:6,target:'4',value:true,read_block:7,read_hash:'13',previous_digest:'20'});assert.equal(actual.blockNumber,9);assert(Object.isFrozen(actual.event));
 row.packedEvent[3]=new Fr(7n);assert.equal(actual.event.target,'4');
});
test('main board follow zero and explicit global notifications opt-out are valid',async()=>{
 for(const values of [[1n,1n,2n,0n,1n,0n,0n,0n],[1n,1n,5n,0n,0n,0n,0n,0n]]){const {decoder,row,range}=await fixture(values);assert.equal(decoder.decode(row,range).event.target,'0');}
});
for(const [index,value] of [[0,2n],[1,0n],[1,1n<<64n],[2,0n],[2,7n],[3,0n],[4,2n],[5,1n],[6,1n]])test('reject malformed event field '+index+'/'+value,async()=>{const f=await fixture();f.row.packedEvent[index]=new Fr(value);assert.throws(()=>f.decoder.decode(f.row,f.range),{code:'ROLLING_PREFERENCE_EVENT_INVALID'});});
test('read markers reject future headers and false values',async()=>{for(const v of [[1n,1n,6n,4n,1n,10n,13n,0n],[1n,1n,6n,4n,0n,7n,13n,0n]]){const f=await fixture(v);assert.throws(()=>f.decoder.decode(f.row,f.range),{code:'ROLLING_PREFERENCE_EVENT_INVALID'});}});
test('reject missing extra fields, selector mismatch and out-of-range metadata',async()=>{
 for(const mutate of [f=>f.row.packedEvent.pop(),f=>f.row.packedEvent.push(new Fr(0)),f=>f.row.eventSelector=EventSelector.fromString('0x00000000'),f=>f.row.l2BlockNumber=10,f=>f.row.l2BlockNumber=0,f=>f.range.toBlock=1,f=>f.row.l2BlockHash='PRIVATE_SENTINEL',f=>f.row.txHash='PRIVATE_SENTINEL']){const f=await fixture();mutate(f);assert.throws(()=>f.decoder.decode(f.row,f.range),e=>e.code==='ROLLING_PREFERENCE_EVENT_INVALID'&&!String(e).includes('PRIVATE_SENTINEL')&&!e.cause);}
});
test('changed, missing, duplicate or differently typed event ABI cannot reuse the decoder',async()=>{
 for(const mutate of [a=>a.name='Other',a=>a.outputs.structs.events=a.outputs.structs.events.filter(e=>e.path!=='RollingBoard::PreferenceChanged'),a=>a.outputs.structs.events.push(structuredClone(a.outputs.structs.events.find(e=>e.path==='RollingBoard::PreferenceChanged'))),a=>a.outputs.structs.events.find(e=>e.path==='RollingBoard::PreferenceChanged').fields[1].type.width=32,a=>a.outputs.structs.events.find(e=>e.path==='RollingBoard::PreferenceChanged').fields[4].name='other']){const a=structuredClone(artifact);mutate(a);await assert.rejects(createPreferenceEventDecoder({sdk,artifact:a}),{code:'ROLLING_PREFERENCE_EVENT_INVALID'});}
});

test('missing decoder input fails with the fixed schema error',async()=>{await assert.rejects(createPreferenceEventDecoder(),{code:'ROLLING_PREFERENCE_EVENT_INVALID'});});
