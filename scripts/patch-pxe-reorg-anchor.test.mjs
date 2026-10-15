// Actual pinned SDK synchronizer, stream, LMDB and note stores. Chain responses
// and NoteDao values are synthetic fixtures, NOT encrypted FPC recovery evidence.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { transform as transpile } from 'esbuild';
import { openTmpStore } from '@aztec-labs/kv-store/lmdb-v2';
import { L2TipsKVStore } from '@aztec-labs/kv-store/stores';
import { Fr } from '@aztec-labs/foundation/curves/bn254';
import { BlockHash } from '@aztec-labs/stdlib/block';
import { AztecAddress } from '@aztec-labs/stdlib/aztec-address';
import { Note, NoteDao } from '@aztec-labs/stdlib/note';
import { BlockHeader } from '@aztec-labs/stdlib/tx';
import { Barretenberg, BarretenbergSync } from '@aztec-foundation/bb.js';
import { PXE_REORG_ANCHOR_PINS as PINS, transformPxeReorgAnchor, inspectPxeReorgAnchor, patchPxeReorgAnchor } from './patch-pxe-reorg-anchor.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installed = await realpath(join(repo, 'node_modules/@aztec-labs/pxe'));
const installedBefore = await inspectPxeReorgAnchor(installed);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'rolling-pxe-anchor-')));
const sha = value => createHash('sha256').update(value).digest('hex');
const { NoteStore } = await import(pathToFileURL(join(installed, 'dest/storage/note_store/note_store.js')));
const { AnchorBlockStore } = await import(pathToFileURL(join(installed, 'dest/storage/anchor_block_store/anchor_block_store.js')));
const { StagedWriteCoordinator } = await import(pathToFileURL(join(installed, 'dest/storage/staged_write_coordinator.js')));
after(async () => {
  await Barretenberg.destroySingleton(); await BarretenbergSync.destroySingleton();
  assert.deepEqual(await inspectPxeReorgAnchor(installed), installedBefore);
  await rm(temporary, { recursive: true, force: true });
});
async function copyPackage(name) {
  const root = join(temporary, name);
  for (const pin of PINS) {
    const source = await readFile(join(repo, 'scripts/testing/fixtures/pxe-reorg-anchor', pin.path.split('/').at(-1)));
    assert.equal(sha(source), pin.before);
    await mkdir(dirname(join(root, pin.path)), { recursive: true });
    await writeFile(join(root, pin.path), source);
  }
  await cp(join(installed,'dest/block_synchronizer/block_stream_source.js'), join(root,'dest/block_synchronizer/block_stream_source.js'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await symlink(await realpath(join(repo,'node_modules')), join(root,'node_modules'));
  return root;
}
const originalRoot = await copyPackage('original'), patchedRoot = await copyPackage('patched');
await patchPxeReorgAnchor(patchedRoot);
const { BlockSynchronizer: Original } = await import(pathToFileURL(join(originalRoot,PINS[1].path)));
const { BlockSynchronizer: Patched } = await import(pathToFileURL(join(patchedRoot,PINS[1].path)));
const quiet = { trace(){}, debug(){}, verbose(){}, info(){}, warn(){}, error(){}, getBindings(){return {};} };

async function block(n, salt=0) {
  const header=BlockHeader.empty(); header.globalVariables.blockNumber=n; header.totalFees=new Fr(salt);
  return { header, hash:await header.hash(), archive:header.lastArchive, checkpointNumber:n, indexWithinCheckpoint:0 };
}
async function fixture(t,{Constructor=Patched,tier='checkpointed'}={}) {
  const chain=await Promise.all(Array.from({length:17},(_,n)=>block(n)));
  const db=await openTmpStore('rolling-reorg-regression',true,16384);
  const notes=new NoteStore(db),anchor=new AnchorBlockStore(db),tips=new L2TipsKVStore(db,'fixture',chain[0].hash);
  const writes=new StagedWriteCoordinator({kvStore:db,stagedStores:[notes]});
  const other=db.openMap('other-rollbackable');
  const state={tip:0,selected:undefined,missing:false,prunes:[],wipes:0,nodeWipes:0,failRollback:false,reads:0};
  const id=n=>({number:n,hash:chain[n].hash.toString()});
  const checkpoint=n=>({block:id(n),checkpoint:{number:n,hash:new Fr(n+1000).toString()}});
  const get=async q=> {
    state.reads++;
    if(state.onRead) { const override=await state.onRead(q); if(override?.handled)return override.value; }
    if(state.missing)return undefined;
    if(q&&typeof q==='object'&&'number'in q)q=q.number;
    else if(q&&typeof q==='object'&&'hash'in q){ assert(q.hash instanceof BlockHash,'Native hash must be typed');q=q.hash; }
    return typeof q==='number' ? q<=state.tip?chain[q]:undefined : chain.slice(0,state.tip+1).find(b=>b.hash.toString()===q.toString());
  };
  const node={getChainTips:async()=> {
    const n=state.selected??state.tip;
    return {proposed:id(state.tip),checkpointed:checkpoint(tier==='proposed'?state.tip:n),
      proven:checkpoint(['proven','finalized'].includes(tier)?n:0),finalized:checkpoint(tier==='finalized'?n:0)};
  },getBlock:get,getBlockData:async q=>{const r=await get(q);return r?{...r,blockHash:r.hash}:undefined;},
  wipeCache(){state.nodeWipes++;},getBlocks(){throw Error('Unexpected payload download');}};
  const rollbackables=[{async rollbackToBlock(n){state.prunes.push(n);await notes.rollbackToBlock(n);}},
    {async rollbackToBlock(n){await other.set('value',n);if(state.failRollback)throw Error('PRIVATE_SENTINEL');}}];
  const sync=new Constructor(node,db,anchor,rollbackables,tips,{wipe(){state.wipes++;}},{syncChainTip:tier});
  sync.log=quiet; sync.blockStream.log=quiet;
  t.after(async()=>{state.onRead=undefined;state.missing=false;await sync.stop();await db.close();});
  const owner=AztecAddress.fromFieldUnsafe(new Fr(102)),contract=AztecAddress.fromFieldUnsafe(new Fr(101));
  const add=async(n,value,key)=>NoteDao.random({contractAddress:contract,owner,note:new Note([new Fr(value)]),storageSlot:new Fr(1),siloedNullifier:new Fr(key),l2BlockNumber:n,l2BlockHash:chain[n].hash.toString()});
  const commit=async fn=>{const c=writes.begin();try{await fn(c);await writes.commit(c);}catch(e){writes.abort(c);throw e;}};
  const balance=async()=>{const c=writes.begin();try{return (await notes.getNotes({contractAddress:contract,scopes:[owner]},c)).reduce((sum,n)=>sum+n.note.items[0].toBigInt(),0n);}finally{writes.abort(c);}};
  const advance=async n=>{state.tip=n;await sync.sync();assert.equal((await anchor.getBlockHeader()).getBlockNumber(),state.selected??n);};
  const seed=async(intermediate=false)=>{
    await advance(10);const retained=await add(12,100,1001);await commit(c=>notes.addNotes([retained],owner,c));
    if(intermediate)await advance(12);
    await advance(15);const change=await add(15,80,1002),refund=await add(15,10,1003);
    await commit(async c=>{await notes.applyNullifiers([{data:retained.siloedNullifier,l2BlockNumber:15}],c);await notes.addNotes([change,refund],owner,c);});
    await other.set('value',15);assert.equal(await balance(),90n);
  };
  const snapshot=async()=>({header:(await anchor.getBlockHeader()).toBuffer().toString('hex'),tips:await tips.getL2Tips(),balance:await balance(),other:await other.getAsync('value')});
  return {db,notes,anchor,tips,sync,node,state,chain,id,advance,seed,snapshot,balance,other};
}

test('pinned pristine/dest transform; verify-only leaves installed tree untouched; TS/JS syntax',async()=>{
  assert.equal((await inspectPxeReorgAnchor(originalRoot)).state,'original');assert.equal((await inspectPxeReorgAnchor(patchedRoot)).state,'patched');
  assert.deepEqual(await patchPxeReorgAnchor(patchedRoot),await inspectPxeReorgAnchor(patchedRoot));
  for(const pin of PINS){const source=await readFile(join(originalRoot,pin.path),'utf8'),result=transformPxeReorgAnchor(source,pin.path);
    assert.equal(sha(result),pin.after);assert.throws(()=>transformPxeReorgAnchor(source+'\n',pin.path),/PATCH_SOURCE/);
    await transpile(result,{loader:pin.path.endsWith('.ts')?'ts':'js',target:'es2022'});
  }
});
test('unknown/mixed pair and symlink targets fail closed before any write',async()=>{
  const p=await copyPackage('unknown');await writeFile(join(p,PINS[1].path),'PRIVATE_SENTINEL');
  await assert.rejects(patchPxeReorgAnchor(p),/PATCH_STATE/);assert.equal(sha(await readFile(join(p,PINS[0].path))),PINS[0].before);
  await writeFile(join(p,PINS[1].path),await readFile(join(patchedRoot,PINS[1].path)));await assert.rejects(patchPxeReorgAnchor(p),/PATCH_STATE/);
  await symlink(p,join(temporary,'link'));await assert.rejects(patchPxeReorgAnchor(join(temporary,'link')),/PATCH_SYMLINK/);
});
test('pristine actual SDK reproduces sparse checkpoint anchor stuck10 after both sync calls',async t=>{
  const f=await fixture(t,{Constructor:Original});await f.seed();f.state.tip=12;await f.sync.sync();await f.sync.sync();
  assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),10);assert.equal((await f.tips.getL2Tips()).checkpointed.block.number,12);
  assert.equal(await f.balance(),0n);assert.deepEqual(f.state.prunes,[10]);
});
for(const tier of ['proposed','checkpointed','proven'])test(`actual LMDB ${tier}: sparse conservative rollback then canonical12, unchanged second sync`,async t=>{
  const f=await fixture(t,{tier});await f.seed();const wipes=f.state.wipes;f.state.tip=12;await f.sync.sync();
  assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);assert.deepEqual(f.state.prunes,[10]);
  assert.equal(await f.balance(),0n,'Conservative rollback MUST NOT invent retained/rediscovered notes');assert.equal(await f.other.getAsync('value'),10);
  assert(f.state.wipes>wipes);assert.equal(f.state.wipes,f.state.nodeWipes);await f.sync.sync();assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);assert.deepEqual(f.state.prunes,[10]);
});
test('actual LMDB witnessed12 rollback restores retained note and removes orphan spend/change',async t=>{
  const f=await fixture(t);await f.seed(true);f.state.tip=12;await f.sync.sync();assert.deepEqual(f.state.prunes,[12]);assert.equal(await f.balance(),100n);assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);
});
for(const tier of ['proposed','checkpointed','proven','finalized'])test(`configured ${tier} uses exact canonical header and cannot acknowledge missing selected event`,async t=>{
  const f=await fixture(t,{tier});await f.advance(10);const before=await f.snapshot();f.state.tip=12;
  f.state.onRead=async q=>q?.hash?.toString()===f.chain[12].hash.toString()?{handled:true,value:undefined}:undefined;
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);assert.deepEqual(await f.snapshot(),before);
  f.state.onRead=undefined;await f.sync.sync();assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);
});
test('same-height fork rolls back conservatively and delivers new typed-hash canonical tip',async t=>{
  const f=await fixture(t);await f.seed();const old=f.chain[15].hash.toString();f.chain[15]=await block(15,99);await f.sync.sync();
  assert.notEqual((await (await f.anchor.getBlockHeader()).hash()).toString(),old);assert.equal((await (await f.anchor.getBlockHeader()).hash()).toString(),f.chain[15].hash.toString());assert.deepEqual(f.state.prunes,[10]);assert.equal(await f.balance(),0n);
});
test('missing target after stream prefetch cannot commit partial rollback or prune cursor',async t=>{
  const f=await fixture(t);await f.seed();const before=await f.snapshot();f.state.tip=12;let reads=0;
  f.state.onRead=async q=>q?.hash?.toString()===f.chain[12].hash.toString()&&++reads>1?{handled:true,value:undefined}:undefined;
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);assert.deepEqual(await f.snapshot(),before);assert.deepEqual(f.state.prunes,[]);
});
test('stale/wrong returned header rejects before any rollback',async t=>{
  const f=await fixture(t);await f.seed();const before=await f.snapshot();f.state.tip=12;let reads=0;
  f.state.onRead=async q=>q?.hash?.toString()===f.chain[12].hash.toString()&&++reads>1?{handled:true,value:f.chain[15]}:undefined;
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);assert.deepEqual(await f.snapshot(),before);
});
test('rollback failure after actual NoteStore mutation aborts every store/anchor/tip atomically',async t=>{
  const f=await fixture(t);await f.seed();const before=await f.snapshot();f.state.tip=12;f.state.failRollback=true;
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_EVENT_FAILED$/);assert.deepEqual(await f.snapshot(),before);
  f.state.failRollback=false;await f.sync.sync();assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);assert.equal(await f.balance(),0n);
});
test('tips acknowledgement starts only after rollback and canonical anchor commit',async t=>{
  const f=await fixture(t);await f.seed();f.state.tip=12;
  const original=f.tips.handleBlockStreamEvent.bind(f.tips);let checked=false;
  f.tips.handleBlockStreamEvent=async event=>{if(event.type==='chain-pruned'){
    assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);assert.equal(await f.balance(),0n);assert.equal(await f.other.getAsync('value'),10);checked=true;
  }await original(event);};
  await f.sync.sync();assert.equal(checked,true);
});
test('canonical source contradiction during selected lookup fails closed before rollback',async t=>{
  const f=await fixture(t);await f.seed();const before=await f.snapshot();f.state.tip=12;
  f.state.onRead=async q=>{if(q===12)f.state.tip=11;};
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);assert.deepEqual(await f.snapshot(),before);
});
test('finalized tier remains below proposed reorg; no illegal rollback of finalized state',async t=>{
  const f=await fixture(t,{tier:'finalized'});f.state.selected=10;await f.advance(15);const before=await f.snapshot();f.state.tip=12;
  await f.sync.sync();assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),10);assert.deepEqual(f.state.prunes,[]);assert.equal((await f.anchor.getBlockHeader()).toBuffer().toString('hex'),before.header);
});
test('SDK build/check and explicit bootstrap require exact patched source+dest hashes',async()=>{
  const build=await readFile(join(repo,'scripts/build-sdk.mjs'),'utf8'),check=await readFile(join(repo,'scripts/check-sdk.mjs'),'utf8');
  assert(build.indexOf('inspectPxeReorgAnchor(fileURL')<build.indexOf('const portalMetadata=buildPortalRuntime()'));
  assert.match(build,/PXE_REORG_ANCHOR_PINS\.map/);assert.match(check,/manifest\.inputs\['node_modules\/@aztec-labs\/pxe\/'\+pin\.path\]!==pin\.after/);
  const commands=JSON.parse(await readFile(join(repo,'package.json'),'utf8')).scripts['bootstrap:dependencies'].split(' && ');
  const reorg='node scripts/patch-pxe-reorg-anchor.mjs --apply node_modules/@aztec-labs/pxe';
  assert.equal(commands.filter(command=>command===reorg).length,1);
  assert(commands.indexOf(reorg)>commands.indexOf('node scripts/patch-private-event-query.mjs --apply node_modules/@aztec-labs/pxe'));
  assert(commands.indexOf(reorg)<commands.indexOf('node scripts/patch-pxe-preference-page.mjs --apply-installed node_modules/@aztec-labs/pxe'));
  assert.match(build,/pxeReorgAnchor.state!=='patched'/);
});

test('concurrent sync and stop drain the same queued work; no detached mutation',async t=>{
  const f=await fixture(t);await f.advance(10);f.state.tip=12;
  let release,entered;const reached=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let held=false;
  f.state.onRead=async q=>{if(!held&&q?.hash?.toString()===f.chain[12].hash.toString()){held=true;entered();await gate;}};
  const first=f.sync.sync();await reached;const second=f.sync.sync();let stopped=false;const stop=f.sync.stop().then(()=>stopped=true);
  await new Promise(r=>setImmediate(r));assert.equal(stopped,false);release();await Promise.all([first,second,stop]);
  assert.equal(stopped,true);assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);const snapshot=await f.snapshot();await new Promise(r=>setImmediate(r));assert.deepEqual(await f.snapshot(),snapshot);
});
test('contradictory same-height finalized source cannot replace anchor without private rollback',async t=>{
  const f=await fixture(t,{tier:'finalized'});await f.advance(15);const before=await f.snapshot();
  f.chain[15]=await block(15,99);
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);
  assert.equal((await f.anchor.getBlockHeader()).toBuffer().toString('hex'),before.header);
  assert.deepEqual(f.state.prunes,[]);
});

for(const tier of ['proposed','checkpointed','proven','finalized'])for(const timing of ['during-header','after-stream'])test('canonical forward '+tier+' advance '+timing+' acknowledges its exact captured pass',async t=>{
 const f=await fixture(t,{tier});await f.advance(10);f.state.tip=12;
 if(timing==='during-header'){let changed=false;f.state.onRead=async q=>{if(q===12&&!changed){changed=true;f.state.tip=13;}};}
 else{const sync=f.sync.blockStream.sync.bind(f.sync.blockStream);f.sync.blockStream.sync=async()=>{await sync();f.state.tip=13;};}
 await f.sync.sync();assert.deepEqual(f.state.prunes,[]);assert.equal(await f.balance(),0n);
 assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),12);assert.equal(f.sync.syncTips,undefined,'Snapshot ownership ends with this sync');
 const tips=await f.tips.getL2Tips();assert.equal(tier==='proposed'?tips.proposed.number:tips[tier].block.number,12);
 f.state.onRead=undefined;await f.sync.sync();assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),13);
});

for(const change of ['same-height-fork','advanced-orphan','tier-retreat'])test('captured snapshot rejects '+change+' after stream acknowledgement',async t=>{
  const f=await fixture(t);await f.advance(10);f.state.tip=12;
  const sync=f.sync.blockStream.sync.bind(f.sync.blockStream);
  f.sync.blockStream.sync=async()=>{await sync();
    if(change==='tier-retreat')f.state.selected=11;
    else {f.chain[12]=await block(12,99);if(change==='advanced-orphan')f.state.tip=13;}
  };
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);
  assert.equal(f.sync.syncTips,undefined);assert.deepEqual(f.state.prunes,[]);
});
for(const source of ['tips','block'])test('swallowed '+source+' source failure cannot report successful sync',async t=>{
  const f=await fixture(t);await f.advance(10);const before=await f.snapshot();
  if(source==='tips')f.node.getChainTips=async()=>{throw Error('PRIVATE_SENTINEL');};
  else {f.state.tip=12;f.state.onRead=async()=>{throw Error('PRIVATE_SENTINEL');};}
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_EVENT_FAILED$/);
  assert.deepEqual(await f.snapshot(),before);assert.equal(f.sync.syncTips,undefined);
});
for(const tier of ['proposed','checkpointed','proven','finalized'])test('missing '+tier+' acknowledgement rejects an otherwise completed stream',async t=>{
  const f=await fixture(t,{tier:'finalized'});await f.advance(10);f.state.tip=12;
  const handle=f.tips.handleBlockStreamEvent.bind(f.tips);
  f.tips.handleBlockStreamEvent=async event=>{if(event.type!=='chain-'+tier)await handle(event);};
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_INCOMPLETE$/);
  assert.equal(f.sync.syncTips,undefined);
});

test('selected tier retreat during final canonical header check remains a veto',async t=>{
  const f=await fixture(t);await f.advance(10);f.state.tip=12;
  const sync=f.sync.blockStream.sync.bind(f.sync.blockStream);
  f.sync.blockStream.sync=async()=>{await sync();f.state.tip=13;
    f.state.onRead=async query=>{if(query===12)f.state.selected=11;};
  };
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_CHANGED$/);
  assert.equal(f.sync.syncTips,undefined);
});

test('exact previous patched pair upgrades to identical pinned output; mixed or modified predecessors refuse',async()=>{
  const root=await copyPackage('previous');
  for(const pin of PINS){
    const previous=await readFile(join(repo,'scripts/testing/fixtures/pxe-reorg-anchor','previous-'+pin.path.split('/').at(-1)),'utf8');
    assert.equal(sha(previous),pin.previous);
    const next=transformPxeReorgAnchor(previous,pin.path);
    assert.equal(sha(next),pin.after);
    assert.equal(next,await readFile(join(patchedRoot,pin.path),'utf8'));
    assert.throws(()=>transformPxeReorgAnchor(previous+'\n',pin.path),/PATCH_SOURCE/);
    await writeFile(join(root,pin.path),previous);
  }
  assert.equal((await inspectPxeReorgAnchor(root)).state,'previous');
  const before=await readFile(join(root,PINS[0].path));
  await writeFile(join(root,PINS[1].path),await readFile(join(originalRoot,PINS[1].path)));
  await assert.rejects(patchPxeReorgAnchor(root),/PATCH_STATE/);
  assert.deepEqual(await readFile(join(root,PINS[0].path)),before);
  await writeFile(join(root,PINS[1].path),await readFile(join(repo,'scripts/testing/fixtures/pxe-reorg-anchor','previous-block_synchronizer.js')));
  assert.equal((await patchPxeReorgAnchor(root)).state,'patched');
  assert.deepEqual(await inspectPxeReorgAnchor(root),await inspectPxeReorgAnchor(patchedRoot));
});

test('final advancing header cannot hide captured anchor reorg',async t=>{
  const f=await fixture(t);await f.advance(10);f.state.tip=12;
  const sync=f.sync.blockStream.sync.bind(f.sync.blockStream);
  f.sync.blockStream.sync=async()=>{await sync();f.state.tip=13;const get=f.node.getChainTips;let calls=0;
    f.node.getChainTips=async()=>{if(++calls===2){f.chain[12]=await block(12,99);f.state.tip=14;}return get();};};
  await assert.rejects(f.sync.sync(),/^Error: PXE_REORG_ANCHOR_/);
});
test('discarded source prefetch remains owned until rejection drains',async t=>{
  const f=await fixture(t);await f.seed();f.state.tip=12;
  let release;const blocked=new Promise(r=>release=r);let held=false;
  const get=f.node.getChainTips;let tipReads=0;
  f.node.getChainTips=async()=>{if(++tipReads===2)f.state.tip=13;return get();};
  f.state.onRead=async q=>{if(!held&&q?.hash?.toString()===f.chain[12].hash.toString()){held=true;await blocked;throw Error('PRIVATE_SENTINEL');}};
  let settled=false,failure;const run=f.sync.sync().then(()=>{settled=true;},error=>{settled=true;failure=error;});
  await new Promise(r=>setTimeout(r,30));const beforeRelease=settled;release();await run;
  assert.equal(held,true);assert.equal(beforeRelease,false,'sync must drain all source reads before releasing ownership');
  assert.match(String(failure),/^Error: PXE_REORG_ANCHOR_EVENT_FAILED$/);
  assert.equal(f.sync.syncTips,undefined);assert.equal(f.sync.syncPass,undefined);
  f.state.onRead=undefined;f.node.getChainTips=get;await f.sync.sync();
  assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),13,'Explicit next sync is not poisoned by a prior pass');
});

test('stop drains a discarded successful prefetch before releasing sync ownership',async t=>{
  const f=await fixture(t);await f.seed();f.state.tip=12;
  let release,reached;const blocked=new Promise(r=>release=r),streamFinished=new Promise(r=>reached=r);let held=false;
  const get=f.node.getChainTips;let reads=0;
  f.node.getChainTips=async()=>{if(++reads===2)f.state.tip=13;return get();};
  f.state.onRead=async query=>{if(!held&&query?.hash?.toString()===f.chain[12].hash.toString()){held=true;await blocked;}};
  const streamSync=f.sync.blockStream.sync.bind(f.sync.blockStream);
  f.sync.blockStream.sync=async()=>{await streamSync();reached();};
  let synced=false,stopped=false;const run=f.sync.sync().then(()=>{synced=true;});
  await streamFinished;const stop=f.sync.stop().then(()=>{stopped=true;});
  await new Promise(r=>setImmediate(r));
  assert.equal(held,true);assert.equal(synced,false);assert.equal(stopped,false);assert.equal(f.sync.syncPass.pending.size,1);
  release();await Promise.all([run,stop]);assert.equal(synced,true);assert.equal(stopped,true);
  assert.equal(f.sync.syncTips,undefined);assert.equal(f.sync.syncPass,undefined);
  assert.equal((await f.anchor.getBlockHeader()).getBlockNumber(),13);
});
