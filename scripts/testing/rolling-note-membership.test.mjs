// Labelled pure fakes: diagnostic behavior only, no chain or privacy acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRollingNoteMembershipFactory} from './rolling-note-membership.mjs';
const hex = n => '0x' + BigInt(n).toString(16).padStart(64,'0');
const value = n => ({n, toString: () => hex(n), equals: other => other?.n === n});
const roles = ['board-name','board-deposit','FPC-balance','Bok-balance'];
function fixture(options = {}) {
  let receiver, lastPromise;
  const notes = roles.map((role,i) => ({role,contractAddress: value(10+i),noteHash: value(20+i),noteNonce: value(30+i),
    txHash: value(40+i),l2BlockNumber: 4,l2BlockHash: hex(4),privateWitness: 'secret note contents'}));
  const unique = note => value(1000 + note.contractAddress.n + note.noteHash.n + note.noteNonce.n);
  const nullifiers = new Set(), missing = new Set(), calls = [], hashCalls = [];
  const original = function(anchor,tree,leaves) {
    receiver = this; calls.push({anchor,tree,leaves});
    return lastPromise = Promise.resolve(leaves.map(leaf => {
      const note = notes.find(n => unique(n).equals(leaf));
      return !missing.has(String(leaf)) && ((note && note.l2BlockNumber <= Number(anchor.number)) || nullifiers.has(String(leaf))) ? {data: 0n} : undefined;
    }));
  };
  const node = Object.create({findLeavesIndexes: original});
  node.getBlock = async number => ({hash: value(Number(number))});
  node.getTxEffect = async tx => {
    const note = notes.find(n => n.txHash.equals(tx));
    return {data: {txHash:note.txHash,noteHashes: [unique(note)]},l2BlockNumber: note.l2BlockNumber,l2BlockHash: note.l2BlockHash};
  };
  const wallet = {pxe: {getContractInstance: async () => ({initializationHash: value(7)}),getSyncedBlockHeader: async () => ({getBlockNumber: () => 5,hash: async () => value(5)}),
    debug: {getNotes: async filter => notes.filter(note => note.contractAddress.equals(filter.contractAddress))}}};
  const categories = notes.map(note => ({role: note.role,contractAddress: note.contractAddress,storageSlot: value(1)}));
  const helper = createRollingNoteMembershipFactory({noteTree: 1,activeStatus: 1,
    siloNoteHash: async (contract,hash) => {hashCalls.push(['silo',contract,hash]); return value(contract.n+hash.n);},
    computeUniqueNoteHash: async (nonce,siloed) => {hashCalls.push(['unique',nonce,siloed]); return value(1000+nonce.n+siloed.n);},
    nullifierTree: 0, siloNullifier: async(address,inner)=>value(10000+address.n+inner.n),
    computeSiloedPrivateInitializationNullifier: async address=>value(3000+address.n),
    computeSiloedPublicInitializationNullifier: async address=>value(4000+address.n),
    poseidon2HashWithSeparator: async([slot],domain)=>{assert.equal(domain,1653084894);return value(2000+slot.n);},
    ...options.sdk,
  })({node,wallet,owner: value(99),categories,...options});
  return {helper,node,notes,missing,nullifiers,calls,hashCalls,wallet,original,unique,
    receiver: () => receiver,lastPromise: () => lastPromise};
}

test('pure fake: exact unique hash pipeline and public-only canonical source observations', async () => {
  const f = fixture(); const anchor = await f.helper.capture('before-preflight');
  assert.equal(String(anchor.hash),hex(5)); assert.equal(f.hashCalls.length,8);
  assert.equal(f.hashCalls[0][0],'silo'); assert.equal(f.hashCalls[1][0],'unique');
  const snapshot = f.helper.snapshot();
  assert(snapshot.captures[0].categories.every(c => c.notes[0].present && c.notes[0].sourceCanonical
    && c.notes[0].sourceEffectMembership && c.notes[0].sourceAtOrBeforeAnchor));
  assert(snapshot.phases.every(row => row.source === 'diagnostic'));
  for (const note of f.notes) for (const secret of [String(note.noteHash),String(note.noteNonce),String(f.unique(note)),note.privateWitness])
    assert(!JSON.stringify(snapshot).includes(secret));
  f.helper.close(); assert.equal(f.node.findLeavesIndexes,f.original);
  assert.equal(Object.hasOwn(f.node,'findLeavesIndexes'),false); assert.equal(f.helper.snapshot().restored,true);
});

test('pure fake: existing lookup preserves receiver, promise, result and exposes known missing category', async () => {
  const f = fixture(); await f.helper.capture('before-rollback');
  f.helper.setPhase('matching-post'); const leaf = f.unique(f.notes[0]); f.missing.add(String(leaf));
  const promise = f.node.findLeavesIndexes({number:5,hash:value(5)},1,[leaf]);
  assert.equal(promise,f.lastPromise()); assert.equal(f.receiver(),f.node);
  assert.deepEqual(await promise,[undefined]);
  const row = f.helper.snapshot().phases.at(-1);
  assert.equal(row.source,'sdk'); assert.equal(row.missing[0].categories['board-name'],true);
  assert.equal(row.missing[0].sourceEffectMembership,true); assert.equal(row.missing[0].sourceAtOrBeforeAnchor,true);
  f.helper.close();
});

test('pure fake: unknown settled read remains unknown rather than blaming stored name note', async () => {
  const f = fixture(); await f.helper.capture('before-preflight'); f.helper.setPhase('preflight');
  await f.node.findLeavesIndexes({number:5,hash:value(5)},1,[value(98765)]);
  const missing = f.helper.snapshot().phases.at(-1).missing[0];
  assert.equal(missing.matchedCapturedActiveNote,false); assert(Object.values(missing.categories).every(v => !v));
  assert(!JSON.stringify(f.helper.snapshot()).includes(hex(98765))); f.helper.close();
});

test('pure fake: newer FPC change note absent at original anchor is distinguished from corruption', async () => {
  const f = fixture(), oldAnchor = await f.helper.capture('before-rollback');
  f.notes[2].l2BlockNumber = 6; f.notes[2].l2BlockHash = hex(6); f.notes[2].noteNonce = value(90);
  await f.helper.capture('after-rollback-old-anchor',oldAnchor);
  const note = f.helper.snapshot().captures.at(-1).categories[2].notes[0];
  assert.equal(note.present,false); assert.equal(note.sourceAtOrBeforeAnchor,false);
  assert.equal(note.sourceCanonical,true); assert.equal(note.sourceEffectMembership,true);
  await f.helper.capture('after-rollback',{number:6,hash:value(6)});
  assert.equal(f.helper.snapshot().captures.at(-1).categories[2].notes[0].present,true); f.helper.close();
});

test('pure fake: raw thrown/rejected errors never enter diagnostic evidence', async () => {
  for (const asynchronous of [false,true]) {
    const error = new Error('private witness error'), node = {findLeavesIndexes() {
      if (asynchronous) return Promise.reject(error); throw error;
    }};
    const helper = createRollingNoteMembershipFactory({noteTree:1})({node,wallet:{},owner:{},
      categories:roles.map(role=>({role}))});
    if (asynchronous) await assert.rejects(node.findLeavesIndexes({number:1,hash:value(1)},1,[value(99)]),e=>e===error);
    else assert.throws(()=>node.findLeavesIndexes({number:1,hash:value(1)},1,[value(99)]),e=>e===error);
    assert.equal(helper.snapshot().phases[0].outcome,'failed');
    assert(!JSON.stringify(helper.snapshot()).includes(error.message)); helper.close();
  }
});

test('pure fake: failure during note capture is preserved without private exception data', async () => {
  const f = fixture(); f.wallet.pxe.debug.getNotes = async () => {throw Error('private note material');};
  await assert.rejects(f.helper.capture('before-preflight'));
  assert.equal(f.helper.snapshot().captures[0].outcome,'failed');
  assert(!JSON.stringify(f.helper.snapshot()).includes('private note material')); f.helper.close();
});

test('pure fake: bounds and unclassified tree/anchor are explicit', async () => {
  const f = fixture({maxRows:2,maxLeaves:1});
  await f.node.findLeavesIndexes('latest',1,[value(99),value(100)]);
  await f.node.findLeavesIndexes({number:5,hash:value(5)},999,[value(1)]);
  await f.node.findLeavesIndexes({number:5,hash:value(5)},1,[value(101)]);
  await f.node.findLeavesIndexes({number:5,hash:value(5)},1,[value(101)]);
  const snapshot=f.helper.snapshot(); assert.equal(snapshot.unknown,2); assert.equal(snapshot.truncatedLeaves,1);
  assert.equal(snapshot.truncatedRows,1); assert.equal(snapshot.phases[0].missing.length,1); f.helper.close();
});

test('pure fake: ownership conflict never overwrites a replacement method', () => {
  const f=fixture(), replacement=()=>{}; f.node.findLeavesIndexes=replacement;
  assert.throws(()=>f.helper.close(),/ownership changed/); assert.equal(f.node.findLeavesIndexes,replacement);
});

test('pure fake: source effect membership and canonical source failures stay visible', async () => {
  const f=fixture(); f.node.getTxEffect=async()=>({data:{noteHashes:[]},l2BlockNumber:4,l2BlockHash:hex(999)});
  await f.helper.capture('before-preflight');
  const note=f.helper.snapshot().captures[0].categories[0].notes[0];
  assert.equal(note.present,true); assert.equal(note.sourceCanonical,false); assert.equal(note.sourceEffectMembership,false);
  f.helper.close();
});


test('pure fake: nullifier zero/unknown/init/config flags and successful preflight membership are distinct',async()=>{
  const f=fixture({contracts:[{role:'board',address:value(10),configSlot:value(2),portalSlot:value(3)}]});
  await f.helper.capture('before-preflight'); f.helper.setPhase('preflight');
  f.nullifiers.add(hex(12012));
  await f.node.findLeavesIndexes({number:5,hash:value(5)},0,[value(12012)]);
  f.helper.markPreflightSucceeded(); f.nullifiers.clear(); f.helper.setPhase('matching-post');
  await f.node.findLeavesIndexes({number:6,hash:value(6)},0,[value(0),value(12012),value(3010),value(4010),value(12013),value(99999)]);
  const facts=f.helper.snapshot().phases.at(-1).missing.map(row=>row.nullifier);
  assert(facts[0].zero && !facts[0].nonzero); assert(facts[1].nonzero && facts[1].matchedSuccessfulPreflightRead && facts[1].successfulPreflightReadFound);
  assert(facts[1].initializationKinds['config-init'] && facts[1].contractRoles.board);
  assert(facts[2].initializationKinds['private-contract-init']);assert(facts[3].initializationKinds['public-contract-init']);assert(facts[4].initializationKinds['portal-init']);
  assert(!facts[5].oracleMatch && !facts[5].matchedSuccessfulPreflightRead && Object.values(facts[5].initializationKinds).every(v=>!v));
  const saved=JSON.stringify(f.helper.snapshot());for(const n of [12012,3010,4010,12013,99999])assert(!saved.includes(hex(n)));
  f.helper.close();assert.deepEqual(f.helper.snapshot().phases.at(-1).missing.map(row=>row.nullifier),facts);
});

test('pure fake: oracle receiver/promise/result identity and later siloed-match flags survive restoration',async()=>{
  let seen,returned;
  const prototype={isNullifierPending(...args){seen={receiver:this,args};return returned=Promise.resolve(false);},notifyCreatedNullifier(){return returned=Promise.resolve(undefined);}};
  const before=Object.getOwnPropertyDescriptors(prototype);
  const f=fixture({contracts:[{role:'board',address:value(10)}],sdk:{oraclePrototype:prototype}});
  f.helper.setPhase('matching-post');const oracle=Object.create(prototype);oracle.callContext={contractAddress:value(10)};
  const inner=value(33),promise=oracle.isNullifierPending(inner,value(10));assert.equal(promise,returned);assert.equal(seen.receiver,oracle);assert.equal(seen.args[0],inner);assert.equal(await promise,false);
  const creation=oracle.notifyCreatedNullifier(inner);assert.equal(creation,returned);await creation;
  await f.node.findLeavesIndexes({number:5,hash:value(5)},0,[value(10043)]);await f.helper.flush();
  const snapshot=f.helper.snapshot(),facts=snapshot.phases.at(-1).missing[0].nullifier;
  assert(facts.oracleMatch && facts.samePhasePendingFalse && !facts.samePhasePendingTrue && facts.samePhaseCreated && facts.oracleContractRoles.board);
  assert.deepEqual(snapshot.oracleEvents.map(e=>e.role),['board','board']);assert(!JSON.stringify(snapshot).includes(hex(10043)));assert(!JSON.stringify(snapshot).includes(hex(33)));
  f.helper.close();assert.deepEqual(Object.getOwnPropertyDescriptors(prototype),before);
});

test('pure fake: oracle synchronous return, original throw/rejection and private error omission',async()=>{
  for(const mode of ['sync','throw','reject']) {
    const error=Error('private-inner-nullifier');let returned;
    const prototype={isNullifierPending(){if(mode==='throw')throw error;if(mode==='reject')return returned=Promise.reject(error);return true;},notifyCreatedNullifier(){}};
    const f=fixture({sdk:{oraclePrototype:prototype}}),oracle=Object.create(prototype);oracle.callContext={contractAddress:value(10)};
    if(mode==='throw')assert.throws(()=>oracle.isNullifierPending(value(33),value(10)),e=>e===error);
    else if(mode==='reject'){const promise=oracle.isNullifierPending(value(33),value(10));assert.equal(promise,returned);await assert.rejects(promise,e=>e===error);}
    else assert.equal(oracle.isNullifierPending(value(33),value(10)),true);
    await f.helper.flush();const event=f.helper.snapshot().oracleEvents[0];assert.equal(event.outcome,mode==='sync'?'returned':'failed');assert.equal(event.pending,mode==='sync'?true:null);
    assert(!JSON.stringify(f.helper.snapshot()).includes(error.message));f.helper.close();
  }
});

test('pure fake: failed preflight never becomes successful and bounded nullifier/oracle capture reports truncation',async()=>{
  const prototype={isNullifierPending(){return false;},notifyCreatedNullifier(){}};
  const f=fixture({maxRows:1,maxLeaves:1,sdk:{oraclePrototype:prototype}}),oracle=Object.create(prototype);oracle.callContext={contractAddress:value(10)};
  f.helper.setPhase('preflight');await f.node.findLeavesIndexes({number:5,hash:value(5)},0,[value(999)]);
  for(let i=0;i<6;i++)oracle.isNullifierPending(value(33),value(10));await f.helper.flush();
  const snapshot=f.helper.snapshot();assert(!snapshot.preflightPassed);assert(!snapshot.phases[0].missing[0].nullifier.matchedSuccessfulPreflightRead);assert.equal(snapshot.truncatedOracles,2);assert.equal(snapshot.oracleEvents.length,4);f.helper.close();
});

test('pure fake: prototype ownership conflict is refused without clobbering newer writer',()=>{
  const prototype={isNullifierPending(){return false;},notifyCreatedNullifier(){}};
  const f=fixture({sdk:{oraclePrototype:prototype}}),other=()=>true;const owned=prototype.isNullifierPending;prototype.isNullifierPending=other;
  assert.throws(()=>f.helper.close(),/ownership changed/);assert.equal(prototype.isNullifierPending,other);
  prototype.isNullifierPending=owned;f.helper.close();
});
