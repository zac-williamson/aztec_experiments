// Lightweight regression against the installed pinned SDK cache, without proving.
import assert from 'node:assert/strict';
import test from 'node:test';
import {withCache} from '../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js';
import {BlockHeader} from '@aztec-labs/stdlib/tx';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {SiblingPath} from '@aztec-labs/foundation/trees';
import {createT02InboxProbeNode,restoreT02InboxWitness} from './t02-claim-boundary.mjs';

async function fixture(){
 const referenceBlock=await BlockHeader.empty().toBlockParameter(),messageHash=new Fr(200);
 const witness=[0n,new SiblingPath(1,[new Fr(300).toBuffer()])];
 const original=Buffer.from(witness[1].toBuffer());
 const probe=createT02InboxProbeNode({async getL1ToL2MessageMembershipWitness(){return witness;}});
 const node=withCache(probe.node),wallet={pxe:{node}};
 return {referenceBlock,messageHash,witness,original,probe,node,wallet};
}

test('disarming corruption leaves SDK cache polluted; restoration refetches authentic membership',async()=>{
 const f=await fixture();f.probe.arm(f);
 const corrupt=await f.node.getL1ToL2MessageMembershipWitness(f.referenceBlock,f.messageHash);
 assert.notDeepEqual(corrupt[1].toBuffer(),f.original);
 assert.equal(f.probe.clear(),1);
 const stale=await f.node.getL1ToL2MessageMembershipWitness(f.referenceBlock,f.messageHash);
 assert.deepEqual(stale[1].toBuffer(),corrupt[1].toBuffer());
 assert.equal(f.probe.membershipReads,1,'SDK retains the fulfilled injected answer');
 assert.deepEqual(await restoreT02InboxWitness(f),{cacheReset:true,authenticWitnessRefetched:true,sourceReads:1});
 assert.equal(f.probe.membershipReads,2);
 const authentic=await f.node.getL1ToL2MessageMembershipWitness(f.referenceBlock,f.messageHash);
 assert.deepEqual(authentic[1].toBuffer(),f.original);
 assert.deepEqual(f.witness[1].toBuffer(),f.original,'Injection does not mutate source witness');
 assert.equal(f.probe.membershipReads,2,'Restored authentic answer is now cached');
});

test('restoration rejects a reset that fails to reach the source',async()=>{
 const f=await fixture();await f.node.getL1ToL2MessageMembershipWitness(f.referenceBlock,f.messageHash);
 const broken=new Proxy(f.node,{get(target,key){if(key==='wipeCache')return ()=>{};return Reflect.get(target,key);}});
 await assert.rejects(restoreT02InboxWitness({...f,wallet:{pxe:{node:broken}}}),/Restoration must fetch through the real node/);
});

test('restoration rejects a source response inconsistent with canonical membership',async()=>{
 const f=await fixture(),different=[f.witness[0],new SiblingPath(1,[new Fr(301).toBuffer()])];
 await assert.rejects(restoreT02InboxWitness({...f,witness:different}),/Restored PXE witness must equal canonical membership/);
});

test('probe matches both fields of the actual V6 anchored block parameter and the message',async()=>{
 const f=await fixture();f.probe.arm(f);
 for(const [referenceBlock,messageHash] of [[{...f.referenceBlock,number:f.referenceBlock.number+1},f.messageHash],[{...f.referenceBlock,hash:new Fr(123)},f.messageHash],[f.referenceBlock,new Fr(201)]]){
  const result=await f.node.getL1ToL2MessageMembershipWitness(referenceBlock,messageHash);assert.deepEqual(result[1].toBuffer(),f.original);
 }
 assert.equal(f.probe.clear(),0);
});
