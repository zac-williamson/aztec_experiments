// ============================================================
// pxe-cache.cjs — Dump/restore PXE IndexedDB state to a JSON file
// ============================================================
//
// The PXE uses IndexedDB to store all its state (synced blocks,
// decrypted notes, merkle trees, contract registrations, etc.).
// In the browser, IndexedDB is persistent. In the CLI, we use
// fake-indexeddb which is in-memory and lost on every run.
//
// This module dumps all IndexedDB databases to a JSON file after
// PXE operations, and restores them before PXE creation on the
// next run. The cache file is keyed by account address so
// different wallets get separate caches.
//
// Usage:
//   const { dumpPxeCache, restorePxeCache } = require('./pxe-cache.cjs');
//
//   // Before PXE creation:
//   await restorePxeCache(indexedDB, '/path/to/cache.json');
//
//   // After PXE operations (before process exit):
//   await dumpPxeCache(indexedDB, '/path/to/cache.json');
// ============================================================

const fs = require('fs');

// --- Serialization for JSON-incompatible types ---

function serializeValue(value, depth = 0) {
  if (depth > 100) return null; // depth guard
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') {
    return { __t: 'bi', d: value.toString() };
  }
  if (value instanceof Uint8Array) {
    return { __t: 'u8', d: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) {
    return { __t: 'ab', d: Buffer.from(value).toString('base64') };
  }
  if (Array.isArray(value)) {
    return value.map(v => serializeValue(v, depth + 1));
  }
  if (typeof value === 'object') {
    // Check for typed arrays (Int8Array, Float64Array, etc.)
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
      return { __t: 'u8', d: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = serializeValue(v, depth + 1);
    }
    return result;
  }
  return value; // primitives
}

function deserializeValue(value, depth = 0) {
  if (depth > 100) return null;
  if (value === null || value === undefined) return value;
  if (typeof value === 'object') {
    if (value.__t === 'bi') {
      return BigInt(value.d);
    }
    if (value.__t === 'u8') {
      return new Uint8Array(Buffer.from(value.d, 'base64'));
    }
    if (value.__t === 'ab') {
      return Buffer.from(value.d, 'base64').buffer;
    }
    if (Array.isArray(value)) {
      return value.map(v => deserializeValue(v, depth + 1));
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = deserializeValue(v, depth + 1);
    }
    return result;
  }
  return value;
}

// --- Dump all databases ---

function dumpDatabase(indexedDB, name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      const db = req.result;
      const storeNames = [...db.objectStoreNames];
      if (storeNames.length === 0) {
        db.close();
        resolve({ stores: {} });
        return;
      }
      const tx = db.transaction(storeNames, 'readonly');
      const stores = {};
      let pending = storeNames.length;

      for (const storeName of storeNames) {
        const store = tx.objectStore(storeName);
        // Use openCursor to get key-value pairs, filtering out null/invalid records
        const cursorReq = store.openCursor();
        const records = [];
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const val = cursor.value;
            // Skip null/undefined values and records with null keys
            if (val !== null && val !== undefined) {
              const serialized = serializeValue(val);
              // Only keep records that have a valid slot (the keyPath)
              if (serialized && serialized.slot !== null && serialized.slot !== undefined) {
                records.push(serialized);
              }
            }
            cursor.continue();
          } else {
            stores[storeName] = records;
            if (--pending === 0) {
              db.close();
              resolve({ stores });
            }
          }
        };
        cursorReq.onerror = () => {
          db.close();
          reject(cursorReq.error);
        };
      }
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

async function dumpPxeCache(indexedDB, filePath) {
  // Get all database names from fake-indexeddb's internal map
  if (!indexedDB._databases) {
    return false; // not fake-indexeddb
  }
  const dbNames = [...indexedDB._databases.keys()];
  if (dbNames.length === 0) return false;

  const dump = {};
  for (const name of dbNames) {
    dump[name] = await dumpDatabase(indexedDB, name);
  }

  fs.writeFileSync(filePath, JSON.stringify(dump));
  return true;
}

// --- Restore databases ---

function createAndPopulateDatabase(indexedDB, name, storeData) {
  return new Promise((resolve, reject) => {
    // Open with version 1 to trigger upgrade
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Create the "data" object store with keyPath "slot" (same as AztecIndexedDBStore)
      if (!db.objectStoreNames.contains('data')) {
        const objectStore = db.createObjectStore('data', { keyPath: 'slot' });
        objectStore.createIndex('key', ['container', 'key'], { unique: false });
        objectStore.createIndex('keyCount', ['container', 'key', 'keyCount'], { unique: true });
        objectStore.createIndex('hash', ['container', 'key', 'hash'], { unique: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (!storeData || !storeData.stores || !storeData.stores.data) {
        db.close();
        resolve();
        return;
      }
      const records = storeData.stores.data.map(v => deserializeValue(v));
      if (records.length === 0) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction('data', 'readwrite');
      const store = tx.objectStore('data');
      for (const record of records) {
        if (!record || record.slot === null || record.slot === undefined) continue;
        store.put(record);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

async function restorePxeCache(indexedDB, filePath) {
  if (!fs.existsSync(filePath)) return false;

  const dump = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const [name, storeData] of Object.entries(dump)) {
    await createAndPopulateDatabase(indexedDB, name, storeData);
  }
  return true;
}

module.exports = { dumpPxeCache, restorePxeCache };
