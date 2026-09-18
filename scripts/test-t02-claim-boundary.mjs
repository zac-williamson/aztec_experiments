// Lightweight regression against the installed pinned SDK cache, without proving.
import assert from 'node:assert/strict';
import test from 'node:test';
import {withCache} from '../node_modules/@aztec/pxe/dest/node/caching_aztec_node.js';
import {BlockHash} from '@aztec/stdlib/block';
import {Fr} from '@aztec/foundation/curves/bn254';
import {SiblingPath} from '@aztec/foundation/trees';
import {createT02InboxProbeNode,restoreT02InboxWitness} from './t02-claim-boundary.mjs';

function fixture(){
 const anchorHash=BlockHash.fromString(new Fr(100).toString()),messageHash=new Fr(200);
 const witness=[0n,new SiblingPath(1,[new Fr(300).toBuffer()])];
 const original=Buffer.from(witness[1].toBuffer());
 const probe=createT02InboxProbeNode({async getL1ToL2MessageMembershipWitness(){return witness;}});
 const node=withCache(probe.node),wallet={pxe:{node}};
 return {anchorHash,messageHash,witness,original,probe,node,wallet};
}

test('disarming corruption leaves SDK cache polluted; restoration refetches authentic membership',async()=>{
 const f=fixture();f.probe.arm(f);
 const corrupt=await f.node.getL1ToL2MessageMembershipWitness(f.anchorHash,f.messageHash);
 assert.notDeepEqual(corrupt[1].toBuffer(),f.original);
 assert.equal(f.probe.clear(),1);
 const stale=await f.node.getL1ToL2MessageMembershipWitness(f.anchorHash,f.messageHash);
 assert.deepEqual(stale[1].toBuffer(),corrupt[1].toBuffer());
 assert.equal(f.probe.membershipReads,1,'SDK retains the fulfilled injected answer');
 assert.deepEqual(await restoreT02InboxWitness(f),{cacheReset:true,authenticWitnessRefetched:true,sourceReads:1});
 assert.equal(f.probe.membershipReads,2);
 const authentic=await f.node.getL1ToL2MessageMembershipWitness(f.anchorHash,f.messageHash);
 assert.deepEqual(authentic[1].toBuffer(),f.original);
 assert.deepEqual(f.witness[1].toBuffer(),f.original,'Injection does not mutate source witness');
 assert.equal(f.probe.membershipReads,2,'Restored authentic answer is now cached');
});

test('restoration rejects a reset that fails to reach the source',async()=>{
 const f=fixture();await f.node.getL1ToL2MessageMembershipWitness(f.anchorHash,f.messageHash);
 const broken=new Proxy(f.node,{get(target,key){if(key==='wipeCache')return ()=>{};return Reflect.get(target,key);}});
 await assert.rejects(restoreT02InboxWitness({...f,wallet:{pxe:{node:broken}}}),/Restoration must fetch through the real node/);
});

test('restoration rejects a source response inconsistent with canonical membership',async()=>{
 const f=fixture(),different=[f.witness[0],new SiblingPath(1,[new Fr(301).toBuffer()])];
 await assert.rejects(restoreT02InboxWitness({...f,witness:different}),/Restored PXE witness must equal canonical membership/);
});
