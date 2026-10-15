import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit bootstrap only. Do not patch dependencies under running consumers.
export const INDEXEDDB_ATOMICITY_PINS = Object.freeze([{"path":"src/deprecated/indexeddb/store.ts","before":"fb534e8e211909b0de90fe171212a9fdcfd5af0d80a22fa827c7fc901ad44ebf","after":"e71b52af584c9e2285c80f635503c1f4d1989948a3b8b21db860d8178f7ae0f6"},{"path":"dest/deprecated/indexeddb/store.js","before":"2f1a33c8bbcdd16af817eb7c0d5dc0e1c944f5f5055f99d280da4f8d0e321cdf","after":"e6efed86ab1f05b268cf11bfe02ecd0e9fe6462e6747585285090d00232c3100"}]);
const sha = value => createHash('sha256').update(value).digest('hex');

function replacement(ts) {
  const type = text => ts ? text : '';
  return `
    return this.#txQueue.put(async () => {
      const tx = this.#rootDB.transaction('data', 'readwrite');
      // Attach the rejection handler before invoking application code.
      const completion = tx.done.then(() => ({ ok: true${type(' as const')} }), error => ({ ok: false${type(' as const')}, error }));
      let callbackPending = true;
      let closed = false;
      let closedError${type(': unknown')};
      const inflight${type(': Set<Promise<any>>')} = new Set();
      const pending${type(': Array<{ run: () => void; reject: (error: unknown) => void }>')} = [];
      const enqueue = (run${type(': () => any')}) => new Promise${type('<any>')}((resolveOperation, reject) => {
        if (closed) { reject(closedError); return; }
        pending.push({ reject, run: () => {
          try {
            const running = Promise.resolve(run()); inflight.add(running);
            running.then(value => { inflight.delete(running); resolveOperation(value); },
              error => { inflight.delete(running); reject(error); });
          }
          catch (error) { reject(error); }
        } });
      });
      const rejectPending = (error${type(': unknown')}) => {
        closed = true; closedError = error;
        for (const operation of pending.splice(0)) operation.reject(error);
      };
      // Containers keep their existing codecs. Only raw IDB operations cross
      // this boundary, issued synchronously from an active native request event.
      const scheduled = (target${type(': any')})${type(': any')} => {
        const proxy${type(': any')} = new Proxy(target, { get(object, property) {
          if (['transaction', 'source', 'request', 'objectStore'].includes(String(property))) throw new Error('INDEXEDDB_TRANSACTION_RAW_HANDLE');
          if (property === 'index') return (name${type(': string')}) => scheduled(object.index(name));
          if (property === 'iterate' || property === Symbol.asyncIterator) return async function* (...args${type(': any[]')}) {
            let cursor = object instanceof IDBCursor ? proxy : await proxy.openCursor(...args);
            while (cursor) {
              let advanced${type(': Promise<any> | undefined')};
              const view = new Proxy(cursor, { get(current, key) {
                if (['continue', 'continuePrimaryKey', 'advance'].includes(String(key))) {
                  return (...advanceArgs${type(': any[]')}) => { advanced = current[key](...advanceArgs); };
                }
                return current[key];
              } });
              yield view;
              cursor = await (advanced ?? cursor.continue());
            }
          };
          const value = object[property];
          if (typeof value !== 'function') return value;
          if (!['add', 'put', 'get', 'getKey', 'getAll', 'getAllKeys', 'count', 'clear', 'delete',
            'openCursor', 'openKeyCursor', 'continue', 'continuePrimaryKey', 'advance', 'update'].includes(String(property))) {
            throw new Error('INDEXEDDB_TRANSACTION_UNSUPPORTED_METHOD');
          }
          return (...args${type(': any[]')}) => {
            // IDB normally clones inputs at the call, not when its request runs.
            // Key ranges are immutable native values, not structured-cloneable.
            let copied${type(': any[]')};
            try { copied = args.map(arg => arg instanceof IDBKeyRange ? arg : structuredClone(arg)); }
            catch (error) { return Promise.reject(error); }
            return enqueue(() => Promise.resolve(value.apply(object, copied)).then(result =>
              result instanceof IDBCursor ? scheduled(result) : result));
          };
        } });
        return proxy;
      };
      this.#activeStore = scheduled(tx.store);
      for (const container of this.#containers) container.db = this.#activeStore;
      // Exactly one harmless read is outstanding. Schedule the next request
      // from the native IDB success event, while this transaction is active.
      // This prevents auto-commit during asynchronous callback work.
      const heartbeat = new Promise${type('<{ ok: true } | { ok: false; error: unknown }>')}(resolveHeartbeat => {
        const fail = (error${type(': unknown')}) => {
          callbackPending = false;
          rejectPending(error);
          try { tx.abort(); } catch {}
          resolveHeartbeat({ ok: false, error });
        };
        const next = () => {
          let request${type(': IDBRequest')};
          try { request = unwrap(tx.store).get(''); }
          catch (error) { fail(error); return; }
          request.onsuccess = () => {
            for (const operation of pending.splice(0)) operation.run();
            if (callbackPending || pending.length || inflight.size) next(); else resolveHeartbeat({ ok: true });
          };
          // Do not prevent the request's default transaction abort.
          request.onerror = () => fail(request.error);
        };
        next();
      });
      try {
        const result = await callback();
        callbackPending = false;
        const heartbeatResult = await heartbeat;
        if (!heartbeatResult.ok) throw heartbeatResult.error;
        const transactionResult = await completion;
        if (!transactionResult.ok) throw transactionResult.error;
        return result;
      } catch (error) {
        callbackPending = false;
        rejectPending(error);
        // Abort may throw if an IDB request already aborted the transaction.
        try { tx.abort(); } catch {}
        await heartbeat;
        await completion;
        await Promise.allSettled([...inflight]);
        throw error;
      } finally {
        // The callback, outstanding read and transaction have all settled.
        closed = true;
        if (closedError === undefined) closedError = new Error('INDEXEDDB_TRANSACTION_FINISHED');
        this.#activeStore = undefined;
        for (const container of this.#containers) container.db = undefined;
      }
    });
  }
`;
}

export function transformIndexedDBAtomicity(source, filename) {
  const pin = INDEXEDDB_ATOMICITY_PINS.find(pin => pin.path === filename);
  if (!pin || typeof source !== 'string' || sha(source) !== pin.before) throw new Error('INDEXEDDB_PATCH_SOURCE');
  const ts = filename.endsWith('.ts');
  let output = source.replace(ts ? 'type IDBPDatabase, deleteDB, openDB' : 'deleteDB, openDB',
    ts ? 'type IDBPDatabase, type IDBPObjectStore, deleteDB, openDB, unwrap' : 'deleteDB, openDB, unwrap');
  output = output.replace(ts ? '  #txQueue: SerialQueue;' : '    #txQueue;',
    ts ? "  #txQueue: SerialQueue;\n  #activeStore?: IDBPObjectStore<AztecIDBSchema, ['data'], 'data', 'readwrite'>;" : '    #txQueue;\n    #activeStore;');
  for (const name of ['map', 'set', 'multimap', 'array', 'singleton']) {
    const line = `this.#containers.add(${name});`;
    if (output.split(line).length !== 2) throw new Error('INDEXEDDB_PATCH_LAYOUT');
    output = output.replace(line, `${name}.db = this.#activeStore;\n    ${line}`);
  }
  const start = output.indexOf(ts ? '  transactionAsync<T>(' : ' transactionAsync(callback)');
  const begin = output.indexOf('\n', start);
  const end = output.indexOf('\n  /**\n   * Clears', begin) !== -1
    ? output.indexOf('\n  /**\n   * Clears', begin) : output.indexOf('\n    /**\n   * Clears', begin);
  if (start < 0 || begin < 0 || end < 0) throw new Error('INDEXEDDB_PATCH_LAYOUT');
  output = output.slice(0, begin) + replacement(ts) + output.slice(end);
  output = output.replace("await this.#rootDB.transaction('data', 'readwrite').store.clear();",
    "await (this.#activeStore ?? this.#rootDB.transaction('data', 'readwrite').store).clear();");
  if (sha(output) !== pin.after) throw new Error('INDEXEDDB_PATCH_OUTPUT');
  return output;
}

async function checkedPaths(packageRoot) {
  const root = resolve(packageRoot);
  if (await realpath(root) !== root) throw new Error('INDEXEDDB_PATCH_SYMLINK');
  const paths = [];
  for (const pin of INDEXEDDB_ATOMICITY_PINS) {
    const filename = join(root, pin.path);
    if (!(await lstat(filename)).isFile() || await realpath(filename) !== filename) throw new Error('INDEXEDDB_PATCH_SYMLINK');
    paths.push({ pin, filename, source: await readFile(filename, 'utf8') });
  }
  return paths;
}
export async function inspectIndexedDBAtomicity(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const states = paths.map(({ pin, source }) => sha(source) === pin.before ? 'original' : sha(source) === pin.after ? 'patched' : 'unknown');
  if (states.includes('unknown') || states[0] !== states[1]) throw new Error('INDEXEDDB_PATCH_STATE');
  return Object.freeze({ state: states[0], files: Object.freeze(paths.map(({ pin, source }) => Object.freeze({ path: pin.path, sha256: sha(source) }))) });
}
export async function patchIndexedDBAtomicity(packageRoot) {
  const paths = await checkedPaths(packageRoot);
  const state = await inspectIndexedDBAtomicity(packageRoot);
  if (state.state === 'patched') return state;
  const outputs = paths.map(({ pin, source }) => transformIndexedDBAtomicity(source, pin.path));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i].filename, outputs[i]);
  return inspectIndexedDBAtomicity(packageRoot);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, root, ...extra] = process.argv.slice(2);
  if (!root || extra.length || !['--verify', '--apply'].includes(mode)) {
    process.stderr.write('Usage: patch-indexeddb-atomicity.mjs --verify|--apply EXPLICIT_PACKAGE_ROOT\n');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await (mode === '--verify' ? inspectIndexedDBAtomicity : patchIndexedDBAtomicity)(root))); }
    catch { process.stderr.write('INDEXEDDB_PATCH_FAILED\n'); process.exitCode = 1; }
  }
}
