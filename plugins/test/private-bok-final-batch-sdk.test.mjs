import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {Contract,BatchCall} from '@aztec-labs/aztec.js/contracts';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';

test('native stable6 SDK encodes ordered settlement, authenticated reply and refund from deployed ABI',async()=>{
 const artifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url),'utf8')));
 const address=AztecAddress.fromFieldUnsafe(new Fr(52)),wallet={},contract=Contract.at(address,artifact,wallet),request=new Fr(50),receipt=new Fr(88),plugin=new Fr(89),fields=Array.from({length:32},(_,i)=>new Fr(i));
 const payload=await new BatchCall(wallet,[contract.methods.settle(request,0,120n,receipt),contract.methods.publish_reply(request,plugin,fields,1,0,0),contract.methods.finish(request)]).request();
 assert.deepEqual(payload.calls.map(c=>c.name),['settle','publish_reply','finish']);
 assert(payload.calls.every(c=>c.to.equals(address)&&!c.isStatic));
 assert.deepEqual(payload.calls.map(c=>c.type),['public','private','public']);
 assert.deepEqual(payload.calls.map(c=>c.args.map(x=>x.toBigInt())),[[50n,0n,120n,88n],[50n,89n,...fields.map(f=>f.toBigInt()),1n,0n,0n],[50n]]);
 assert.equal(new Set(payload.calls.map(c=>c.selector.toString())).size,3);
});
