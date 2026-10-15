import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit dependency bootstrap, run after locked installation and before services.
// Never mutate a shared dependency directory while its consumers are running.
// No schema/index changes. Query limits are reversible development defaults, NOT
// product capacity criteria. Cold SDK synchronization and native browser IndexedDB
// qualification remain separate gates. An over-limit interval has no partial result.
export const PRIVATE_EVENT_QUERY_LIMITS = Object.freeze({ rows: 4096, bytes: 8 * 1024 * 1024, recordBytes: 1024 * 1024 });
export const PRIVATE_EVENT_QUERY_PINS = Object.freeze([
  Object.freeze({ path: 'src/storage/private_event_store/private_event_store.ts', before: '62b5b7b7baee04df34dc5d97f8ffcc09c94abf0a2cb77b5b8b94190760cbf8de', after: '03e6c42214af82b82c6e2b46c44efc2f0a9f5c77fcb3f60b007d26b6e54c9376' }),
  Object.freeze({ path: 'dest/storage/private_event_store/private_event_store.js', before: '2811609acbb653f7584bbc3e8df597999abad7c43ae613df53b1126ba3481b35', after: '918ea32152a22abcb7d63b43fc7a04b653dba8369e322b242c9efbdf4ea589ff' }),
]);
const sha = value => createHash('sha256').update(value).digest('hex');

function body(ts) {
  const type = text => ts ? text : '';
  return `
    const rangeError = new Error('PXE_PRIVATE_EVENT_QUERY_RANGE');
    const limitError = new Error('PXE_PRIVATE_EVENT_QUERY_LIMIT');
    const indexError = new Error('PXE_PRIVATE_EVENT_QUERY_INDEX');
    const queryError = new Error('PXE_PRIVATE_EVENT_QUERY_FAILED');
    return this.withChangeSetAndDb(changeSetId, async (changeSet, db) => {
      try {
      if (!Number.isSafeInteger(filter.fromBlock) || !Number.isSafeInteger(filter.toBlock) ||
          filter.fromBlock < 0 || filter.toBlock < filter.fromBlock) throw rangeError;
      if (filter.fromBlock === filter.toBlock) return [];
      // Fail before scanning staged sync backlog; never spread the entire change set.
      if (changeSet.size > 4096) throw limitError;
      const key = this.#keyFor(filter.contractAddress, eventSelector);
      const targetScopes = new Set(filter.scopes.map(s => s.toString()));
      const seen${type(': Set<EventId>')} = new Set();
      const events${type(': Array<{ l2BlockNumber: number; txIndexInBlock: number; eventIndexInTx: number; event: PackedPrivateEvent }>')} = [];
      let rows = 0;
      let bytes = 0;
      const charge = (length${type(': number')}) => {
        if (!Number.isSafeInteger(length) || length < 0 || length > 1048576 || bytes + length > 8388608) throw limitError;
        bytes += length;
      };
      const chargeStaged = (event${type(': StoredPrivateEvent')}) => {
        // Exact existing StoredPrivateEvent encoding size, without allocating a
        // second serialized plaintext copy. Each field is 32 bytes; strings carry
        // a four-byte length. Abort during iteration before a dense scopes vector.
        let size = 152 + event.msgContent.length * 32;
        if (size > 1048576) throw limitError;
        for (const scope of event.scopes) {
          if (scope.length > 1048576) throw limitError;
          size += 4 + new TextEncoder().encode(scope).byteLength;
          if (size > 1048576) throw limitError;
        }
        charge(size);
      };
      const select = (event${type(': StoredPrivateEvent')}) => {
        // The block index includes OTHER contracts/selectors: recheck both.
        if (this.#keyFor(event.contractAddress, event.eventSelector) !== key ||
            event.l2BlockNumber < filter.fromBlock || event.l2BlockNumber >= filter.toBlock ||
            event.scopes.intersection(targetScopes).size === 0 ||
            (filter.txHash && !event.txHash.equals(filter.txHash))) return;
        events.push({ l2BlockNumber: event.l2BlockNumber, txIndexInBlock: event.txIndexInBlock,
          eventIndexInTx: event.eventIndexInTx, event: { packedEvent: event.msgContent,
            l2BlockNumber: BlockNumber(event.l2BlockNumber), txHash: event.txHash,
            l2BlockHash: event.l2BlockHash, eventSelector } });
      };
      for await (const [block, eventId] of db.eventsByBlockNumber.entriesAsync({ start: filter.fromBlock, end: filter.toBlock })) {
        if (++rows > 4096) throw limitError;
        if (seen.has(eventId)) throw indexError;
        seen.add(eventId);
        // Issue a read even for staged overrides, as required for IndexedDB
        // transaction liveness. Await it here: at most ONE outstanding primary
        // read, drained on every success/failure path; no detached IO promises.
        const buffer = await db.events.getAsync(eventId);
        if (!buffer) throw indexError;
        charge(buffer.byteLength); // BEFORE deserialization of an untrusted buffer.
        const staged = changeSet.get(eventId);
        if (staged) chargeStaged(staged);
        const event = staged ?? StoredPrivateEvent.fromBuffer(buffer);
        if (event.l2BlockNumber !== block) throw indexError;
        select(event);
      }
      for (const [eventId, event] of changeSet) {
        if (++rows > 4096) throw limitError;
        if (seen.has(eventId) || this.#keyFor(event.contractAddress, event.eventSelector) !== key ||
            event.l2BlockNumber < filter.fromBlock || event.l2BlockNumber >= filter.toBlock) continue;
        chargeStaged(event);
        select(event);
      }
      events.sort((a, b) => a.l2BlockNumber - b.l2BlockNumber ||
        a.txIndexInBlock - b.txIndexInBlock || a.eventIndexInTx - b.eventIndexInTx);
      return events.map(event => event.event);
      } catch (error) {
        // IndexedDB attaches the callback handler after tx.done. Return an
        // internal failure until the read transaction drains, then reject below.
        return { failure: error === rangeError || error === limitError || error === indexError ? error : queryError };
      }
    }).then(result => {
      if (!Array.isArray(result)) throw result.failure;
      return result;
    }).catch((error${type(': unknown')}) => {
      // Only our own fixed errors escape; no record, selector, scope, decoder
      // details or arbitrary storage errors enter diagnostics.
      throw error === rangeError || error === limitError || error === indexError ? error : queryError;
    });
  }
`;
}

export function transformPrivateEventQuery(source, path) {
  const pin = PRIVATE_EVENT_QUERY_PINS.find(item => item.path === path);
  if (!pin || typeof source !== 'string' || sha(source) !== pin.before) throw new Error('PRIVATE_EVENT_PATCH_SOURCE');
  const ts = path.endsWith('.ts');
  const method = source.indexOf(ts ? '  public getPrivateEvents(' : ' getPrivateEvents(eventSelector, filter, changeSetId) {');
  const begin = source.indexOf('    return this.withChangeSetAndDb', method);
  const end = source.indexOf(ts ? '\n  /**\n   * Deletes every event' : '\n    /**\n   * Deletes every event', begin);
  if (method < 0 || begin < 0 || end < 0) throw new Error('PRIVATE_EVENT_PATCH_LAYOUT');
  // Retain the signature, replace ONLY this method body. All remaining source
  // (store/commit/discard/rollback/index maintenance) remains byte-identical.
  const output = source.slice(0, begin).replace(/[ \t]+$/, '') + body(ts).trimStart() + source.slice(end);
  if (sha(output) !== pin.after) throw new Error('PRIVATE_EVENT_PATCH_OUTPUT');
  return output;
}

async function checkedPaths(packageRoot) {
  const root = resolve(packageRoot);
  if (await realpath(root) !== root) throw new Error('PRIVATE_EVENT_PATCH_SYMLINK');
  const paths = [];
  for (const pin of PRIVATE_EVENT_QUERY_PINS) {
    const path = join(root, pin.path);
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error('PRIVATE_EVENT_PATCH_SYMLINK');
    paths.push({ pin, path, source: await readFile(path, 'utf8') });
  }
  return paths;
}

export async function inspectPrivateEventQuery(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const states = paths.map(({ pin, source }) => sha(source) === pin.before ? 'original' : sha(source) === pin.after ? 'patched' : 'unknown');
  if (states.includes('unknown') || states[0] !== states[1]) throw new Error('PRIVATE_EVENT_PATCH_STATE');
  return Object.freeze({ state: states[0], files: Object.freeze(paths.map(({pin,source}) => Object.freeze({ path: pin.path, sha256: sha(source) }))) });
}

export async function patchPrivateEventQuery(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const state = await inspectPrivateEventQuery(packageRoot);
  if (state.state === 'patched') return state;
  // Validate BOTH transformations before ANY write. An interrupted two-file
  // installation is detected as mixed state, never silently considered installed.
  const outputs = paths.map(({pin,source}) => transformPrivateEventQuery(source, pin.path));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i].path, outputs[i]);
  return inspectPrivateEventQuery(packageRoot);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...extra] = process.argv.slice(2);
  if (!root || extra.length || !['--verify', '--apply'].includes(mode)) {
    process.stderr.write('Usage: patch-private-event-query.mjs --verify|--apply EXPLICIT_PACKAGE_ROOT\n');
    process.exitCode = 1;
  } else {
    try {
      const result = await (mode === '--verify' ? inspectPrivateEventQuery : patchPrivateEventQuery)(root);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch { process.stderr.write('PRIVATE_EVENT_PATCH_FAILED\n'); process.exitCode = 1; }
  }
}
