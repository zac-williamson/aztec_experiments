// Labelled development-only observations: no SDK/node/provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReplyAcceptance, assertReplyAccounting, matchesReplyRejection} from './reply-acceptance.mjs';
function fixture() {
  const expected = {id: '90', record: {subboard: '0', parent: '20', root: '10', kind: '4', name_id: '0', reference: '0', content_digest: '80'},
    count: '3', timestamp: '100', mainVersion: '2', localVersion: '0', length: '4', message: ['123', '0'],
    pluginId: '7', requestId: '8', parentId: '20', target: '9'};
  const observed = {requestUnchanged: true, exists: true, removed: '0', reason: '0', record: structuredClone(expected.record), count: '3', atOrder: '90', timestamp: '100',
    published: {schema: '1', id: '90', record: structuredClone(expected.record), timestamp: '100', main_policy_version: '2', local_policy_version: '0', length: '4', message: ['123', '0']},
    linked: {schema: '1', plugin_id: '7', request_id: '8', post_id: '90', parent_id: '20', target: '9'},
    requestBeforeReply: {state: '2', available: '280'}, requestAfterReply: {state: '2', available: '280'}};
  return {expected, observed};
}
test('labelled fake: exact public reply and nested thread accepted', () => {
  const {observed, expected} = fixture(); assertReplyAcceptance(observed, expected);
});
for (const field of ['kind', 'name_id', 'root', 'parent', 'subboard', 'reference', 'content_digest']) {
  test(`labelled fake: incorrect canonical ${field} rejected`, () => {
    const {observed, expected} = fixture(); observed.record[field] = '999';
    assert.throws(() => assertReplyAcceptance(observed, expected));
  });
}
for (const field of ['plugin_id', 'request_id', 'post_id', 'parent_id', 'target']) {
  test(`labelled fake: incorrect authenticated linkage ${field} rejected`, () => {
    const {observed, expected} = fixture(); observed.linked[field] = '999';
    assert.throws(() => assertReplyAcceptance(observed, expected));
  });
}
for (const mutate of [o => { o.published.message[1] = '1'; }, o => {o.published.main_policy_version = '1';},
  o => {o.atOrder = '91';}, o => {o.count = '4';}, o => {o.requestAfterReply.available = '0';},
  o => {o.requestUnchanged = false;}, o => {o.removed = '1';}, o => {o.published.record.kind = '1';}]) {
  test('labelled fake: event/content/order/accounting mutation rejected', () => {
    const {observed, expected} = fixture(); mutate(observed); assert.throws(() => assertReplyAcceptance(observed, expected));
  });
}
test('labelled fake: exact terminal accounting and independent completion flags', () => {
  const expected = {target: '9', receipt: '44'}, observed = {state: '4', invocation_hash: '9', sequence: '1', budget: '400',
    available: '0', reserved: '0', charged: '120', refunded: '280', receipt: '44', primary_done: true,
    secondary_done: true, ownerBalance: '880', operatorEarnings: '120'};
  assertReplyAccounting(observed, expected);
  for (const key of Object.keys(observed)) {
    assert.throws(() => assertReplyAccounting({...observed, [key]: typeof observed[key] === 'boolean' ? false : '999'}, expected));
  }
});

// Real pinned SDK error/field decoding with explicitly fake ABI guard records.
// No generated artifact, RPC or application proof is represented by these tests.
const {SimulationError} = await import('@aztec-labs/stdlib/errors');
const {AztecAddress} = await import('@aztec-labs/stdlib/aztec-address');
const {Fr} = await import('@aztec-labs/foundation/curves/bn254');
const guardContract = address => ({address: AztecAddress.fromBigIntUnsafe(address), artifact: {functions: [
  {name: 'public_dispatch', errorTypes: {'1': {error_kind: 'string', string: 'Already replied'}, '2': {error_kind: 'string', string: 'Only operator'}}},
]}});
const contracts = {board: guardContract(101n), bok: guardContract(202n)};
const guardError = (contract, selector, message = 'Public assertion failed') => new SimulationError(message,
  [{contractAddress: contracts.bok.address}, {contractAddress: contract.address}], [new Fr(selector)]);
test('labelled fake ABI: replay binds deepest Board and operator failure binds deepest PrivateBok', () => {
  assert.equal(matchesReplyRejection(guardError(contracts.board, 1n), contracts, 'replay'), true);
  assert.equal(matchesReplyRejection(guardError(contracts.bok, 2n), contracts, 'wrong-operator'), true);
  // Both fake ABIs deliberately recognize both guards: address binding is essential.
  assert.equal(matchesReplyRejection(guardError(contracts.bok, 1n), contracts, 'replay'), false);
  assert.equal(matchesReplyRejection(guardError(contracts.board, 2n), contracts, 'wrong-operator'), false);
  assert.equal(matchesReplyRejection(guardError(contracts.board, 2n), contracts, 'replay'), false);
  assert.equal(matchesReplyRejection(guardError(contracts.bok, 1n), contracts, 'wrong-operator'), false);
  assert.equal(matchesReplyRejection(guardError(contracts.board, 1n), contracts, 'unknown'), false);
});
test('labelled fake ABI: matching messages without authenticated revert data cannot pass', () => {
  for (const [label, contract, text] of [['replay', contracts.board, 'Already replied'], ['wrong-operator', contracts.bok, 'Only operator']]) {
    assert.equal(matchesReplyRejection(new Error(text), contracts, label), false);
    assert.equal(matchesReplyRejection(new SimulationError(text, [{contractAddress: contract.address}], []), contracts, label), false);
    assert.equal(matchesReplyRejection(guardError(contract, 999n, text), contracts, label), false);
    assert.equal(matchesReplyRejection(new SimulationError(text, [{contractAddress: contract.address}], [new Fr(1n), new Fr(2n)]), contracts, label), false);
  }
});

// Actual-used journey observer, controlled transaction/chain: post-mining
// simulation is deliberately invalid and a swallowed assertion remains fatal.
const {hostedJourneyObserver}=await import('./journey.mjs');
test('hosted journey measures before send and retains swallowed observer failure',async()=>{
 let mined=false,calls=0;const tx={getTxHash:()=> 'fixed-public-hash'},expected={totalGas:{daGas:1,l2Gas:2}};
 const observer=hostedJourneyObserver({sendTx:async value=>{assert.equal(value,tx);mined=true;calls++;}},
  {measure:async()=>{assert.equal(mined,false);return expected;}});
 await observer.node.sendTx(tx);assert.equal(observer.gas.get('fixed-public-hash'),expected);assert.equal(calls,1);
 await assert.rejects(observer.node.sendTx(tx),/retransmission/);assert.equal(calls,1);
 const original=Error('fixed observer assertion');try{await observer.observe(async()=>{throw original;})();}catch{}
 assert.throws(()=>observer.assertHealthy(),e=>e===original);
});

test('hosted observer retains every falsy original failure and never replaces it',async()=>{
 for(const first of [undefined,null,false,0,'']){
  const observer=hostedJourneyObserver({});
  for(const value of [first,Error('later')])try{await observer.observe(async()=>{throw value;})();}catch{}
  let caught=false;try{observer.assertHealthy();}catch(value){caught=true;assert.equal(value,first);}assert(caught);
 }
});

const {observeRollingBokApplicationSubmit}=await import('./journey.mjs');
test('actual-used application send observation retains one original send and post-send failure for fee accounting',async()=>{
 for(const failure of [undefined,null,false,0,'',Error('original')]){
  const tx={},gas={},observer={sent:new Map([['prior',{}]]),gas:new Map()},intent={intentId:'fixed'};let calls=0;
  const result=await observeRollingBokApplicationSubmit({async submitPrepared(id){calls++;assert.equal(id,intent.intentId);observer.sent.set('new',tx);observer.gas.set('new',gas);throw failure;}},intent,observer);
  assert.equal(calls,1);assert.equal(result.tx,tx);assert.equal(result.gas,gas);assert.equal(result.failed,true);assert.equal(result.error,failure);
 }
});
test('actual-used application send observation does not replay unsent failure or accept missing and duplicate sends',async()=>{
 for(const failure of [undefined,null,false,0,'']){
  let calls=0,caught=false;
  try{await observeRollingBokApplicationSubmit({async submitPrepared(){calls++;throw failure;}},{intentId:'fixed'},{sent:new Map(),gas:new Map()});}
  catch(error){caught=true;assert.equal(error,failure);}assert(caught);assert.equal(calls,1);
 }
 await assert.rejects(observeRollingBokApplicationSubmit({submitPrepared:async()=>({status:'confirmed'})},{},{sent:new Map(),gas:new Map()}),/did not submit/);
 const observer={sent:new Map(),gas:new Map()};
 await assert.rejects(observeRollingBokApplicationSubmit({async submitPrepared(){observer.sent.set('a',{});observer.sent.set('b',{});}},{},observer));
});
test('actual-used application send observation keeps successful result identity',async()=>{
 const observer={sent:new Map(),gas:new Map()},tx={},gas={},result={status:'authorized'};
 const observed=await observeRollingBokApplicationSubmit({async submitPrepared(){observer.sent.set('one',tx);observer.gas.set('one',gas);return result;}},{},observer);
 assert.equal(observed.failed,false);assert.equal(observed.result,result);assert.equal(observed.tx,tx);
});

// Import the exact hosted factory seam before a real journey allocates its chain.
// No provider, lease, service, wallet or transaction is started by this check.
test('real Bok journey hosted factory exports are available in the composed source',async()=>{
 const [{acquireHostedLease},{rollingBoardPort},{runPrivateBokRequest}]=await Promise.all([
  import('../../plugins/main.mjs'),import('../../plugins/aztec.mjs'),import('../../plugins/escrow-service.mjs')]);
 for(const factory of [acquireHostedLease,rollingBoardPort,runPrivateBokRequest])assert.equal(typeof factory,'function');
});
