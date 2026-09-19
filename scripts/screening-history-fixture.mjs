// Synthetic storage/query workload. Authentication is qualified separately by Noir and real transactions.
import assert from 'node:assert/strict';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Note,NoteDao,NoteStatus,Comparator} from '@aztec/stdlib/note';
import {TxHash} from '@aztec/stdlib/tx';
// Exact installed internal APIs, pinned by the lockfile.
import {NoteStore} from '../node_modules/@aztec/pxe/dest/storage/note_store/note_store.js';
import {NoteService} from '../node_modules/@aztec/pxe/dest/notes/note_service.js';
import {pickNotes} from '../node_modules/@aztec/pxe/dest/contract_function_simulator/pick_notes.js';
export async function checkScreeningHistory(openStore){
assert.equal(typeof openStore,'function');
const started = performance.now();
let store;
let noteStore;
let sequence = 0;
const board = AztecAddress.fromFieldUnsafe(new Fr(101));
const owner = AztecAddress.fromFieldUnsafe(new Fr(102));
const otherOwner = AztecAddress.fromFieldUnsafe(new Fr(103));
const slot = new Fr(104);
const chain = new Fr(105);
const otherChain = new Fr(106);
const target = new Fr(107);
const next = new Fr(108);
function makeNote(deposit, previous, overrides = {}) {
  const id = ++sequence;
  // Real PostNote's seven packed fields. Noir compact_note tests independently
  // assert the generated properties are chain[1] and previous_link[5], full Fr.
  return new NoteDao(new Note([
    new Fr(1), deposit, new Fr(id), new Fr(10000 + id), new Fr(100 + id), previous, Fr.ZERO,
  ]), overrides.board ?? board, overrides.owner ?? owner, overrides.slot ?? slot,
  new Fr(id), new Fr(id), new Fr(id), new Fr(id), TxHash.fromBigInt(BigInt(id)),
  overrides.block ?? id, Fr.ZERO.toString(), 0, 0);
}
async function open() {
  store = await openStore();
  noteStore = new NoteStore(store);
}
async function add(notes, scope = owner) {
  await noteStore.addNotes(notes, scope, 'seed');
  await store.transactionAsync(() => noteStore.commit('seed'));
}
async function query(deposit, previous, offset = 0) {
  // This is the same NoteService -> pickNotes path used by the utility oracle.
  // Node/header must not be touched: this query reads already synced PXE notes.
  const inaccessible = new Proxy({}, { get() { throw new Error('Unexpected network access'); } });
  const service = new NoteService(noteStore, inaccessible, inaccessible, 'read');
  const notes = await service.getNotes(board, owner, slot, NoteStatus.ACTIVE, [owner]);
  return pickNotes(notes, { selects: [
    { selector: { index: 1, offset: 0, length: 32 }, value: deposit, comparator: Comparator.EQ },
    { selector: { index: 5, offset: 0, length: 32 }, value: previous, comparator: Comparator.EQ },
  ], limit: 2, offset });
}
try {
  await open();
  // Requested successors have creation heights beyond the old 1,000-note cap.
  const history = Array.from({ length: 1100 }, (_, i) => makeNote(chain, new Fr(20000 + i)));
  const child = makeNote(chain, target);
  const grandchild = makeNote(chain, next);
  const unrelated = makeNote(otherChain, target);
  // Reverse insertion order: PXE's own canonical ordering still governs reads.
  await add([...history, child, grandchild, unrelated].reverse());
  await add([makeNote(chain, target, { owner: otherOwner })], otherOwner);
  await add([makeNote(chain, target, { slot: new Fr(999) })]);
  await add([makeNote(chain, target, { board: AztecAddress.fromFieldUnsafe(new Fr(999)) })]);
  const stored = await noteStore.getNotes({ contractAddress: board, owner, storageSlot: slot, scopes: [owner] }, 'read');
  assert.equal(stored.length, 1103);
  assert(!pickNotes(stored, { limit: 1000 }).some(n => n.siloedNullifier.equals(child.siloedNullifier)),
    'fixture must reproduce a requested successor beyond the old cap');
  for (const [deposit, previous, expected] of [[chain, target, child], [chain, next, grandchild], [otherChain, target, unrelated]]) {
    const found = await query(deposit, previous);
    assert.equal(found.length, 1);
    assert(found[0].siloedNullifier.equals(expected.siloedNullifier));
  }
  assert.equal((await query(chain, new Fr(999999))).length, 0);
  await store.close();
  store = undefined;
  await open();
  assert((await query(chain, target))[0].siloedNullifier.equals(child.siloedNullifier));
  // Same DAO under another scope remains one note, rather than false ambiguity.
  await add([child], otherOwner);
  assert.equal((await query(chain, target)).length, 1);
  // A distinct matching note must survive limit 2, allowing contract ambiguity rejection.
  const duplicate = makeNote(chain, target, { block: 1 });
  await add([duplicate]);
  assert.equal((await query(chain, target)).length, 2);
  assert.equal((await query(chain, target, 1)).length, 1);
  // More duplicates are bounded to two; no arbitrary first-match acceptance.
  await add([makeNote(chain, target)]);
  assert.equal((await query(chain, target)).length, 2);
  return { passed:true, status: 'passed', fixture: 'synthetic persisted NoteDao history; no proofs',
    pxeVersion: '5.2.0', historyNotes: 1100, checks: ['beyond old cap', 'two successors', 'deposit isolation',
      'owner/slot/contract isolation', 'missing match', 'reverse insertion', 'persistent reopen',
      'scope deduplication', 'duplicate detection', 'pagination after selectors', 'bounded duplicates'],
    elapsedMs: Math.round(performance.now() - started) };
} finally {
  if (store) await store.close();
}

}
