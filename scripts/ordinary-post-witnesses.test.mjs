import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {computePublicDataTreeLeafSlot,deriveStorageSlotInMap} from '@aztec-labs/stdlib/hash';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {withCache} from '../node_modules/@aztec-labs/pxe/dest/node/caching_aztec_node.js';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec-labs/stdlib/contract';
after(()=>BarretenbergSync.destroySingleton());
const source=fs.readFileSync(new URL('../shared/ordinary-post-witnesses.mjs',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export async function','async function');
async function fixture({mature=true,actualArtifact}={}){
 const board={address:AztecAddress.fromFieldUnsafe(new Fr(2)),currentContractClassId:actualArtifact?(await getContractClassFromArtifact(actualArtifact)).id:new Fr(42)};
 const artifact=actualArtifact??{name:'RollingBoard',storageLayout:{config:{slot:20},deposits:{slot:31},...Object.fromEntries(['post_exists','post_time','post_flag_deadline','post_flagged'].map((name,i)=>[name,{slot:i+1}]))}};
 const calls=[],pending=[],noteCalls=[],notePending=[];let rejectFirst=false,hold=false,holdNotes=false,anchor={number:1,hash:BlockHash.fromString('0x'+'1'.padStart(64,'0'))};
 const deadline=await computePublicDataTreeLeafSlot(board.address,await deriveStorageSlotInMap(new Fr(3),new Fr(9)));
 const node={getNoteHashMembershipWitness:async(at,hash)=>{noteCalls.push({at,hash});if(holdNotes)await new Promise(resolve=>notePending.push(resolve));return {index:1n,siblingPath:[]};},getPublicDataWitness:async(at,leaf)=>{calls.push({at,leaf});if(rejectFirst&&calls.length===1)throw Error("witness unavailable");if(hold)await new Promise(resolve=>pending.push(resolve));return {leafPreimage:{leaf:{slot:leaf,value:leaf.equals(deadline)?new Fr(mature?50:150):Fr.ONE}}};}};
 const pxe={node:withCache(node),getSyncedBlockHeader:async()=>({globalVariables:{timestamp:100n},toBlockParameter:async()=>anchor})},wallet={pxe};
 const context=vm.createContext({Fr,computePublicDataTreeLeafSlot,deriveStorageSlotInMap,getContractClassFromArtifact:actualArtifact?getContractClassFromArtifact:async()=>({id:new Fr(42)}),isPrivatePXEForNode:(value,route)=>value===pxe&&route===node});vm.runInContext(source,context);
 const args={wallet,node,board,artifact,hints:[{note:{post_id:'9',is_dummy:false}},null]};
 return {run:()=>context.prefetchOrdinaryPostWitnesses(args),args,calls,pending,noteCalls,notePending,holdNotes:()=>{holdNotes=true;},hold:()=>{hold=true;},rejectFirst:()=>{rejectFirst=true;},advance:()=>{anchor={number:2,hash:BlockHash.fromString('0x'+'2'.padStart(64,'0'))};}};
}
test('independent history witnesses start together; native anchored cache serves later reads',async()=>{
 const f=await fixture();f.hold();const work=f.run();
 for(let i=0;i<10&&f.pending.length<4;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,4);f.pending.splice(0).forEach(resolve=>resolve());
 for(let i=0;i<10&&f.pending.length<1;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,1);f.pending.splice(0).forEach(resolve=>resolve());await work;
 assert.equal(f.calls.length,5);await f.run();assert.equal(f.calls.length,5);
});
test('new anchor is fetched afresh; immature history does not fetch flags',async()=>{
 const f=await fixture({mature:false});await f.run();assert.equal(f.calls.length,4);await f.run();assert.equal(f.calls.length,4);
 f.advance();await f.run();assert.equal(f.calls.length,8);assert.notDeepEqual(f.calls[0].at,f.calls[4].at);
});
test('dummy and absent hints fetch only the immutable config witness; foreign PXE route is rejected',async()=>{
 const f=await fixture();f.args.hints=[{note:{is_dummy:true}},null];await f.run();assert.equal(f.calls.length,1);
 const expected=await computePublicDataTreeLeafSlot(f.args.board.address,new Fr(30));assert(f.calls[0].leaf.equals(expected));
 await f.args.wallet.pxe.node.getPublicDataWitness(f.calls[0].at,expected);assert.equal(f.calls.length,1,'private circuit reuses exact native cached hash witness');
 f.args.node={};await assert.rejects(f.run(),{code:'BB_POST_FEE_PROFILE_MISMATCH'});
});

test('a failed witness drains other in-flight reads before rejecting',async()=>{
 const f=await fixture();f.hold();f.rejectFirst();let settled=false;
 const work=f.run().finally(()=>{settled=true;});const rejection=assert.rejects(work,/witness unavailable/);
 for(let i=0;i<20&&f.pending.length<3;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,3);assert.equal(settled,false);
 f.pending.splice(0).forEach(resolve=>resolve());await rejection;assert.equal(f.calls.length,4);
});
test('changing the node while the anchor is pending starts no foreign reads',async()=>{
 const f=await fixture();let release;
 const header=f.args.wallet.pxe.getSyncedBlockHeader;
 f.args.wallet.pxe.getSyncedBlockHeader=()=>new Promise(resolve=>{release=async()=>resolve(await header());});
 const work=f.run();const rejection=assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});
 for(let i=0;i<20&&!release;i++)await new Promise(resolve=>setImmediate(resolve));
 f.args.wallet.pxe.node={getPublicDataWitness:()=>{throw Error('foreign read');}};
 await release();await rejection;assert.equal(f.calls.length,0);
});
test('an immature child prevents speculative grandchild flag reads',async()=>{
 const f=await fixture({mature:false});f.args.hints[1]={note:{post_id:'10',is_dummy:false}};
 await f.run();assert.equal(f.calls.length,7);
});

test('actual native cache joins a still-running prefetch instead of issuing another witness read',async()=>{
 const f=await fixture({mature:false});f.hold();const work=f.run();
 for(let i=0;i<20&&f.pending.length<4;i++)await new Promise(r=>setImmediate(r));
 assert.equal(f.calls.length,4);const first=f.calls[0];
 const required=f.args.wallet.pxe.node.getPublicDataWitness(first.at,first.leaf);
 assert.equal(f.calls.length,4);f.pending.splice(0).forEach(resolve=>resolve());
 await work;const witness=await required;assert(witness.leafPreimage.leaf.slot.equals(first.leaf));assert.equal(f.calls.length,4);
});
test('actual native cache evicts failed prefetch; required private execution read can succeed',async()=>{
 const f=await fixture({mature:false});f.rejectFirst();await assert.rejects(f.run(),/witness unavailable/);
 const first=f.calls[0],before=f.calls.length;
 const witness=await f.args.wallet.pxe.node.getPublicDataWitness(first.at,first.leaf);
 assert(witness.leafPreimage.leaf.slot.equals(first.leaf));assert.equal(f.calls.length,before+1);
});

test('unqualified config layout is rejected before any witness RPC',async()=>{
 const f=await fixture();f.args.artifact.storageLayout.deposits.slot=32;await assert.rejects(f.run(),/config layout/);assert.equal(f.calls.length,0);
});

function metadata(f,hashes=['0x'+new Fr(5).toString().slice(2)]){
 f.args.owner=AztecAddress.fromFieldUnsafe(new Fr(7));
 return {board:f.args.board.address.toString(),owner:f.args.owner.toString(),anchorHash:BlockHash.fromString('0x'+'1'.padStart(64,'0')).toString(),hashes};
}
test('exact selected-note memberships run concurrently with public witnesses and join the native in-flight cache',async()=>{
 const f=await fixture({mature:false});f.args.noteHashWitnessHints=metadata(f);f.hold();f.holdNotes();const work=f.run();
 for(let i=0;i<50&&(f.pending.length<4||f.notePending.length<1);i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.pending.length,4);assert.equal(f.notePending.length,1);
 const note=f.noteCalls[0],actual=f.args.wallet.pxe.node.getNoteHashMembershipWitness(note.at,note.hash);
 assert.equal(f.noteCalls.length,1);f.pending.splice(0).forEach(resolve=>resolve());f.notePending.splice(0).forEach(resolve=>resolve());await work;await actual;
 assert.equal(f.noteCalls.length,1,'private execution uses the same native witness request');
});
for(const changed of ['owner','board','anchorHash','hashes','too-many','count'])test('optional note metadata mismatch is ignored: '+changed,async()=>{
 const f=await fixture({mature:false});const meta=metadata(f);
 if(changed==='hashes')meta.hashes=['not-a-field'];else if(changed==='too-many')meta.hashes=[Fr.ONE.toString(),new Fr(2).toString(),new Fr(3).toString()];else if(changed==='count')meta.hashes=[];else meta[changed]=Fr.ZERO.toString();
 f.args.noteHashWitnessHints=meta;await f.run();assert.equal(f.noteCalls.length,0);assert.equal(f.calls.length,4,'native public preparation unaffected');
});
test('new anchor cannot use old selected-note metadata; no new note query or stale cache reuse',async()=>{
 const f=await fixture({mature:false});f.args.noteHashWitnessHints=metadata(f);await f.run();assert.equal(f.noteCalls.length,1);
 f.advance();await f.run();assert.equal(f.noteCalls.length,1);assert.equal(f.calls.length,8);
});
test('public failure drains held note prefetch before releasing the operation',async()=>{
 const f=await fixture({mature:false});f.args.noteHashWitnessHints=metadata(f);f.rejectFirst();f.holdNotes();let settled=false;
 const work=f.run().finally(()=>settled=true),rejected=assert.rejects(work,/witness unavailable/);
 for(let i=0;i<50&&f.notePending.length<1;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.notePending.length,1);assert.equal(settled,false);f.notePending[0]();await rejected;assert.equal(settled,true);
});


test('current compiled Board artifact prefetches without an old gas-profile class pin',async()=>{
 const artifact=loadContractArtifact(JSON.parse(fs.readFileSync(process.env.ROLLING_TEST_ARTIFACT??new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')));
 const f=await fixture({actualArtifact:artifact});f.args.hints=[null,null];await f.run();
 assert.equal(f.calls.length,1);
 const expected=await computePublicDataTreeLeafSlot(f.args.board.address,new Fr(BigInt(artifact.storageLayout.config.slot)+10n));
 assert(f.calls[0].leaf.equals(expected));
});
for(const mismatch of ['class','artifact-name','address'])test('rejects mismatched ordinary witness context before RPC: '+mismatch,async()=>{
 const f=await fixture();
 if(mismatch==='class')f.args.board.currentContractClassId=new Fr(43);
 if(mismatch==='artifact-name')f.args.artifact.name='OtherBoard';
 if(mismatch==='address')delete f.args.board.address;
 await assert.rejects(f.run());assert.equal(f.calls.length,0);
});
