import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPrivateFeeAccounting} from './private-fee-verification.mjs';
// Labelled accounting/control fixtures, not actual encrypted-note recovery.
const h=n=>'0x'+n.toString(16).padStart(64,'0');
function fixture(){
 const state={anchor:{number:10,hash:h(10)},canonical:new Map([[10,h(10)],[11,h(11)]]),reads:0,syncs:0,values:[90n,0n,95n]};
 const pxe={getSyncedBlockHeader:async()=>({getBlockNumber:()=>state.anchor.number,hash:async()=>state.anchor.hash}),sync:async()=>{state.syncs++;state.anchor={number:11,hash:h(11)};}};
 const node={getChainTips:async()=>({checkpointed:{block:{number:11,hash:h(11)}}}),getBlockData:async number=>state.canonical.has(number)?{blockHash:state.canonical.get(number)}:undefined};
 const observation={passed:true,privateBalance:'historical'};
 const options={pxe,node,observation,expectedPrivateBalance:90n,expectedPoolBalance:95n,readPrivateBalance:async()=>{state.reads++;return state.values[0];},readAuthorPublicBalance:async()=>state.values[1],readPoolBalance:async()=>state.values[2]};
 return {state,pxe,node,observation,options};
}
test('accounting requires achieved canonical checkpoint and retains all measurements',async()=>{
 const f=fixture();assert.deepEqual(await verifyPrivateFeeAccounting(f.options),{privateBalance:90n,poolBalance:95n});
 assert.equal(f.state.syncs,1);assert.equal(f.state.reads,1);assert.equal(f.observation.lastVerification.status,'passed');
 assert.deepEqual(f.observation.lastVerification.anchorBeforeSync,{number:10,hash:h(10)});assert.deepEqual(f.observation.lastVerification.anchorAfterRead,{number:11,hash:h(11)});
});
for(const index of [0,1,2])test('failed balance '+index+' retains every actual value before equality assertions',async()=>{
 const f=fixture();f.state.values[index]++;
 await assert.rejects(verifyPrivateFeeAccounting(f.options));const s=f.observation.lastVerification;
 assert.equal(f.observation.passed,false);assert.equal(s.status,'failed');assert.equal(s.stage,'balances-equal');assert.equal(s.privateBalance,String(f.state.values[0]));assert.equal(s.authorPublicBalance,String(f.state.values[1]));assert.equal(s.poolBalance,String(f.state.values[2]));assert.equal(s.expected.privateBalance,'90');
});
for(const mode of ['behind','orphan','same-height'])test('swallowed synchronization failure cannot authorize accounting: '+mode,async()=>{
 const f=fixture();f.pxe.sync=async()=>{f.state.syncs++;if(mode==='orphan')f.state.anchor={number:12,hash:h(12)};if(mode==='same-height')f.state.anchor={number:11,hash:h(99)};};
 await assert.rejects(verifyPrivateFeeAccounting(f.options));assert.equal(f.state.reads,0);assert.equal(f.state.syncs,1);assert.equal(f.observation.lastVerification.stage,'canonical-before');assert.equal(f.observation.lastVerification.status,'failed');
});
for(const mode of ['anchor','canonical'])test('chain/context changes during private balance read fail closed: '+mode,async()=>{
 const f=fixture();f.options.readPrivateBalance=async()=>{if(mode==='anchor')f.state.anchor={number:10,hash:h(10)};else f.state.canonical.set(11,h(99));return 90n;};
 await assert.rejects(verifyPrivateFeeAccounting(f.options));assert.equal(f.observation.lastVerification.stage,'canonical-after');assert.equal(f.observation.lastVerification.privateBalance,'90');assert.equal(f.observation.lastVerification.poolBalance,'95');
});
test('read errors retain stage and partial observations, without retry',async()=>{
 const f=fixture(),sentinel=Error('labelled pool unavailable');f.options.readPoolBalance=async()=>{throw sentinel;};
 await assert.rejects(verifyPrivateFeeAccounting(f.options),error=>error===sentinel);const s=f.observation.lastVerification;
 assert.equal(s.status,'failed');assert.equal(s.stage,'balances');assert.equal(s.privateBalance,'90');assert.equal(s.authorPublicBalance,'0');assert.equal(Object.hasOwn(s,'poolBalance'),false);assert.equal(f.state.syncs,1);
});
