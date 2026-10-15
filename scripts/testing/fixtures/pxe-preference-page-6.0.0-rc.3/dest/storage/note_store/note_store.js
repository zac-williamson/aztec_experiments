import { createLogger } from '@aztec-labs/foundation/log';
import { allToCompletion } from '@aztec-labs/foundation/promise';
import { NoteStatus } from '@aztec-labs/stdlib/note';
import { BaseStagingStore } from '../base_staging_store.js';
import { StoredNote } from './stored_note.js';
/**
 * NoteStore manages the storage and retrieval of notes using an append-only model.
 *
 * Notes are written once (keyed by siloedNullifier) and never mutated. They might be deleted in case of reorg though.
 * Nullifier emissions are recorded as separate append-only entries: a map from nullifier to the number of the block
 * that emitted it.
 *
 * Reorgs are handled by delete-on-prune: the `chain-pruned` event triggers deletion of every note and nullifier
 * originating on a reorg'd block.
 */ export class NoteStore extends BaseStagingStore {
    #logger = createLogger('note_store');
    constructor(store){
        super({
            storeName: 'note',
            store,
            buildChangeSet: ()=>({
                    notes: new Map(),
                    nullifierEmissions: new Map()
                }),
            buildDb: (db)=>({
                    notes: db.openMap('notes'),
                    notesByContractAddress: db.openMultiMap('note_nullifiers_by_contract'),
                    notesByBlockNumber: db.openMultiMap('note_nullifiers_by_block'),
                    nullifierEmissions: db.openMap('note_nullifications_by_nullifier'),
                    nullifierEmissionsByBlockNumber: db.openMultiMap('note_nullifications_by_block')
                })
        });
    }
    /**
   * Adds multiple notes to the notes store under the specified scope.
   *
   * Notes are stored using their siloedNullifier as the key, which provides uniqueness. Each note is indexed by
   * multiple criteria for efficient retrieval.
   *
   * @param notes - Notes to store
   * @param scope - The scope (user/account) under which to store the notes
   * @param changeSetId - The change set to stage writes under
   */ addNotes(notes, scope, changeSetId) {
        return this.withChangeSetAndDb(changeSetId, (changeSet, db)=>allToCompletion(notes.map(async (note)=>{
                const noteForChangeSet = await this.#readNote(changeSet, db, note.siloedNullifier.toString()) ?? new StoredNote(note, new Set());
                noteForChangeSet.addScope(scope.toString());
                changeSet.notes.set(note.siloedNullifier.toString(), noteForChangeSet);
            })));
    }
    async #readNote(changeSet, db, nullifier) {
        // Always issue DB read to keep IndexedDB transaction alive (they auto-commit when a new micro-task starts and there
        // are no pending read requests). The staged value still takes precedence if it exists.
        const noteBuffer = await db.notes.getAsync(nullifier);
        const noteForChangeSet = changeSet.notes.get(nullifier);
        return noteForChangeSet ?? (noteBuffer ? StoredNote.fromBuffer(noteBuffer) : undefined);
    }
    /**
   * Reads the block number at which a note's nullifier was emitted, layering the current change set's emission over
   * committed state, the nullifier emission counterpart to {@link #readNote}. Returns the emission block number if the
   * nullifier has been emitted (committed or currently staged), or `undefined` if it has not.
   */ async #readNullifierEmission(changeSet, db, nullifier) {
        // Always issue the DB read to keep the IndexedDB transaction alive (see #readNote); the staged emission still takes
        // precedence if present.
        const committed = await db.nullifierEmissions.getAsync(nullifier);
        return changeSet.nullifierEmissions.get(nullifier) ?? committed;
    }
    /**
   * Retrieves notes based on the provided filter criteria.
   *
   * A note is considered nullified iff its corresponding nullifier emission has been recorded.
   *
   * All DB reads are kicked off before any await so IndexedDB does not auto-commit the transaction mid-read.
   *
   * @param filter - Filter criteria including contractAddress (required), and optional owner,
   *                 storageSlot, status, scopes, and siloedNullifier.
   * @param changeSetId - the change set to read staged data from.
   * @returns Filtered and deduplicated notes (a note might be present in multiple scopes, but returned at most once)
   */ getNotes(filter, changeSetId) {
        return this.withChangeSetAndDb(changeSetId, async (changeSet, db)=>{
            if (filter.scopes.length === 0) {
                return [];
            }
            const targetStatus = filter.status ?? NoteStatus.ACTIVE;
            // Collect note-read and nullifier-emission-read promises together in one map so all DB reads are in-flight
            // before any await. This keeps the IndexedDB transaction alive (IndexedDB auto-commits when a new micro-task
            // starts with no pending read requests), so both promises must be started during the synchronous iteration.
            const candidates = new Map();
            // Committed notes indexed by contract address
            for await (const nullifier of db.notesByContractAddress.getValuesAsync(filter.contractAddress.toString())){
                candidates.set(nullifier, {
                    notePromise: this.#readNote(changeSet, db, nullifier),
                    nullificationPromise: this.#readNullifierEmission(changeSet, db, nullifier)
                });
            }
            // Staged notes from the current change set (not yet committed to the DB index)
            for (const storedNote of changeSet.notes.values()){
                if (storedNote.noteDao.contractAddress.equals(filter.contractAddress)) {
                    const nullifier = storedNote.noteDao.siloedNullifier.toString();
                    if (!candidates.has(nullifier)) {
                        candidates.set(nullifier, {
                            notePromise: Promise.resolve(storedNote),
                            nullificationPromise: this.#readNullifierEmission(changeSet, db, nullifier)
                        });
                    }
                }
            }
            // Await all DB reads together before the await-free tail.
            const entries = [
                ...candidates.entries()
            ];
            const notes = await allToCompletion(entries.map(([, { notePromise }])=>notePromise));
            const nullifierEmissions = await allToCompletion(entries.map(([, { nullificationPromise }])=>nullificationPromise));
            // Await-free tail: filter and sort. No DB ops from here on.
            // Build a lookup: nullifier => emission block number
            const emissionByNullifier = new Map();
            for(let i = 0; i < entries.length; i++){
                emissionByNullifier.set(entries[i][0], nullifierEmissions[i]);
            }
            const foundNotes = new Map();
            for (const note of notes){
                // Defensive: hitting this case means we're mishandling contract indices or in-memory staged data
                if (!note) {
                    throw new Error('PXE note database is corrupted.');
                }
                // A note is nullified once its nullifier emission has been recorded (committed or currently staged).
                const nullified = emissionByNullifier.get(note.noteDao.siloedNullifier.toString()) !== undefined;
                if (targetStatus === NoteStatus.ACTIVE && nullified) {
                    continue;
                }
                if (filter.owner && !note.noteDao.owner.equals(filter.owner)) {
                    continue;
                }
                if (filter.storageSlot && !note.noteDao.storageSlot.equals(filter.storageSlot)) {
                    continue;
                }
                if (filter.siloedNullifier && !note.noteDao.siloedNullifier.equals(filter.siloedNullifier)) {
                    continue;
                }
                if (note.scopes.intersection(new Set(filter.scopes.map((s)=>s.toString()))).size === 0) {
                    continue;
                }
                foundNotes.set(note.noteDao.siloedNullifier.toString(), note.noteDao);
            }
            // Sort by block number, then by tx index within block, then by note index within tx
            return [
                ...foundNotes.values()
            ].sort((a, b)=>{
                if (a.l2BlockNumber !== b.l2BlockNumber) {
                    return a.l2BlockNumber - b.l2BlockNumber;
                }
                if (a.txIndexInBlock !== b.txIndexInBlock) {
                    return a.txIndexInBlock - b.txIndexInBlock;
                }
                return a.noteIndexInTx - b.noteIndexInTx;
            });
        });
    }
    /**
   * Records emission of the given siloed nullifiers, which causes notes to be considered nullified.
   *
   * Each nullifier gets an append-only entry recording the block number at which it was emitted.
   *
   * Every nullifier passed must correspond to a note already present in this store. Callers only apply nullifiers for
   * notes of scopes they track, and a note is always discovered before the nullifier that spends it, so a nullifier
   * with no matching note signals a bug (broken nonce/index discovery, a sync-ordering error, store corruption, etc).
   *
   * `applyNullifiers` is idempotent: a nullifier whose emission is already recorded (committed or currently staged) is
   * skipped, so re-applying it neither re-writes the emission, changes note visibility, nor appears in the result.
   *
   * @param siloedNullifiers - Array of nullifiers with their block locations to record
   * @param changeSetId - The change set to stage writes under
   * @returns The notes that transition from active to nullified in this call; already-nullified notes are skipped, so
   *          a repeat application returns an empty array.
   * @throws If any nullifier has no matching note in this store, or was emitted at block 0.
   */ applyNullifiers(siloedNullifiers, changeSetId) {
        if (siloedNullifiers.length === 0) {
            return Promise.resolve([]);
        }
        if (siloedNullifiers.some((n)=>n.l2BlockNumber === 0)) {
            return Promise.reject(new Error('applyNullifiers: nullifiers cannot have been emitted at block 0'));
        }
        return this.withChangeSetAndDb(changeSetId, async (changeSet, db)=>{
            // Kick off the note read and the existing-emission read together during the synchronous map so all are in
            // flight before the first await, which keeps the IndexedDB transaction alive.
            const resolved = await allToCompletion(siloedNullifiers.map(async (nullifier)=>{
                const key = nullifier.data.toString();
                const [storedNote, existingEmission] = await allToCompletion([
                    this.#readNote(changeSet, db, key),
                    this.#readNullifierEmission(changeSet, db, key)
                ]);
                if (!storedNote) {
                    throw new Error(`Attempted to mark a note as nullified which does not exist in PXE DB: ${key}`);
                }
                return {
                    nullifier,
                    storedNote,
                    alreadyEmitted: existingEmission !== undefined
                };
            }));
            // Await-free tail: record an emission only for notes not already nullified, and return exactly those that
            // transition active -> nullified in this call.
            const affected = [];
            for (const { nullifier, storedNote, alreadyEmitted } of resolved){
                if (alreadyEmitted) {
                    continue;
                }
                changeSet.nullifierEmissions.set(nullifier.data.toString(), nullifier.l2BlockNumber);
                affected.push(storedNote.noteDao);
            }
            return affected;
        });
    }
    async flushChangeSet(changeSet, db) {
        for (const [nullifier, storedNote] of changeSet.notes){
            await db.notes.set(nullifier, storedNote.toBuffer());
            await db.notesByContractAddress.set(storedNote.noteDao.contractAddress.toString(), nullifier);
            await db.notesByBlockNumber.set(storedNote.noteDao.l2BlockNumber, nullifier);
        }
        for (const [nullifier, blockNumber] of changeSet.nullifierEmissions){
            await db.nullifierEmissions.set(nullifier, blockNumber);
            await db.nullifierEmissionsByBlockNumber.set(blockNumber, nullifier);
        }
    }
    /**
   * Deletes every note and nullifier emission originating on a block strictly above `toBlock`, as if nothing past that
   * block height ever happened, retracting notes and nullifiers on a reorg.
   */ async applyRollback(toBlock, db) {
        // Snapshot the orphaned (block, nullifier) pairs before mutating so we never delete from the cursor we are
        // iterating. Scanning from `toBlock + 1` upward covers everything above the rollback target without needing to know
        // the chain tip. Each nullifier's rows are independent (nullifiers are globally unique), so the deletes run
        // concurrently. Keeping requests in flight also prevents the IndexedDB transaction from auto-committing mid-way.
        const orphanedNotes = [];
        for await (const [block, siloedNullifier] of db.notesByBlockNumber.entriesAsync({
            start: toBlock + 1
        })){
            orphanedNotes.push({
                block,
                siloedNullifier
            });
        }
        let removedNotes = 0;
        await allToCompletion(orphanedNotes.map(async ({ block, siloedNullifier })=>{
            const buf = await db.notes.getAsync(siloedNullifier);
            if (!buf) {
                throw new Error(`Note not found for siloedNullifier ${siloedNullifier}`);
            }
            const stored = StoredNote.fromBuffer(buf);
            await db.notes.delete(siloedNullifier);
            await db.notesByContractAddress.deleteValue(stored.noteDao.contractAddress.toString(), siloedNullifier);
            await db.notesByBlockNumber.deleteValue(block, siloedNullifier);
            removedNotes++;
        }));
        // Same procedure, with nullifier emissions
        const orphanedEmissions = [];
        for await (const [block, siloedNullifier] of db.nullifierEmissionsByBlockNumber.entriesAsync({
            start: toBlock + 1
        })){
            orphanedEmissions.push({
                block,
                siloedNullifier
            });
        }
        await allToCompletion(orphanedEmissions.map(async ({ block, siloedNullifier })=>{
            await db.nullifierEmissions.delete(siloedNullifier);
            await db.nullifierEmissionsByBlockNumber.deleteValue(block, siloedNullifier);
        }));
        this.#logger.verbose('rolled back notes and nullifier emissions', {
            removedNotes,
            removedNullifierEmissions: orphanedEmissions.length,
            toBlock
        });
    }
}
