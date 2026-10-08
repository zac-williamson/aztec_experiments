import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Fr} from '@aztec/foundation/curves/bn254';
import {SiblingPath} from '@aztec/foundation/trees';
import {L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
const source=await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const c=vm.createContext({performance,setTimeout,clearTimeout,console});vm.runInContext(source,c);
const wait=c.BillboardDepositReadiness.waitForDepositMessage;
const witness=()=>[3n,new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},()=>Fr.ONE.toBuffer()))];
function fixture(read){let syncs=0,guards=0,reads=0;return{args:{a:{Fr},key:new Fr(7).toString(),index:3n,timeoutMs:25,pollMs:1,contextGuard:async()=>guards++,wallet:{pxe:{sync:async()=>syncs++,getSyncedBlockHeader:async()=>({hash:async()=>`anchor-${syncs}`})}},node:{getL1ToL2MessageMembershipWitness:async(hash,key)=>{assert.equal(hash,`anchor-${syncs}`);assert.equal(key.toString(),new Fr(7).toString());return read(++reads);}}},counts:()=>({syncs,guards,reads})};}
test('delayed genuine-shape membership refreshes PXE anchor and guards before readiness',async()=>{const f=fixture(n=>n<2?undefined:witness());await wait(f.args);assert.deepEqual(f.counts(),{syncs:2,guards:4,reads:2});});
test('absent message, RPC error and stalled sync return fixed bounded pending result',async()=>{
 for(const mode of ['absent','rpc','stall']){const f=fixture(()=>{if(mode==='rpc')throw Error('private RPC text');return undefined;});if(mode==='stall')f.args.wallet.pxe.sync=()=>new Promise(()=>{});
 const start=Date.now();await assert.rejects(wait(f.args),e=>e.code===(mode==='absent'?'BB_DEPOSIT_MESSAGE_PENDING':'BB_DEPOSIT_MESSAGE_UNAVAILABLE')&&!e.message.includes('private RPC'));assert(Date.now()-start<250);}
});
test('wrong index and malformed witnesses fail closed; context change propagates',async()=>{
 for(const value of [[4n,witness()[1]],[3n,null],null,[3n,{pathSize:36,toFields(){throw Error('private body');}}]]){const f=fixture(()=>value);await assert.rejects(wait(f.args),e=>e.code==='BB_DEPOSIT_MESSAGE_INVALID'&&!e.message.includes('private body'));}
 const f=fixture(witness);f.args.contextGuard=()=>{throw Object.assign(Error('changed'),{code:'CONTEXT_CHANGED'});};await assert.rejects(wait(f.args),e=>e.code==='CONTEXT_CHANGED');assert.equal(f.counts().reads,0);
});
test('readiness precedes private fee preparation and old proof-based wait is removed',()=>{const claim=source.slice(source.indexOf('    async function doClaim()'),source.indexOf('    async function doPost()'));const ready=claim.indexOf('await waitForDepositMessage('),send=claim.indexOf("await sendPrivate('claim'");assert(ready>=0&&send>ready);assert(!source.includes('waitForL2Ingest'));assert.match(source,/key:event\.key/);assert.match(source,/key:depositInfo\.key/);});

// Controller workflow acceptance lives in test-wallet-setup-gate; application
// no-repeat funding and recovery routing live in test-application-interface.
