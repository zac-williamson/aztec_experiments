// Encrypted, scoped CLI PXE checkpoints. Never imports the old plaintext cache.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v8 = require('node:v8');
const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX = 256 * 1024 * 1024;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function scopeBytes(scope) {
  if (!scope || Object.keys(scope).sort().join(',') !== 'account,chainId,databaseName,rollup,version' ||
      !/^0x[0-9a-f]{64}$/.test(scope.account) || BigInt(scope.account) <= 0n || BigInt(scope.account) >= FR ||
      !/^0x[0-9a-f]{40}$/.test(scope.rollup) || BigInt(scope.rollup) === 0n ||
      !/^[1-9][0-9]{0,19}$/.test(scope.chainId) || BigInt(scope.chainId) >= 1n << 64n ||
      !/^[1-9][0-9]{0,9}$/.test(scope.version) || BigInt(scope.version) >= 1n << 32n ||
      typeof scope.databaseName !== 'string' || scope.databaseName.length > 2048) throw new Error('Invalid PXE cache scope');
  const identity = JSON.parse(scope.databaseName);
  if (!Array.isArray(identity) || identity.length !== 8 || identity[0] !== 'billboard-pxe' || identity[1] !== 1 ||
      identity[3] !== 'pxe_data' || String(identity[4]) !== scope.chainId || identity[5] !== scope.rollup ||
      identity[7] !== scope.account || !Number.isSafeInteger(identity[6]) || identity[6] < 0) throw new Error('PXE database identity differs from scope');
  return Buffer.from(JSON.stringify(['BILLBOARD_PXE_CACHE_V2', scope.account, scope.chainId, scope.rollup, scope.version, scope.databaseName]));
}
function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('PXE IndexedDB operation failed')); }); }
async function snapshot(indexedDB, name) {
  const databases = await indexedDB.databases();
  if (databases.some(db => db.name?.startsWith('["billboard-pxe",') && db.name !== name)) throw new Error('Unexpected PXE database scope; refusing checkpoint');
  if (!databases.some(db => db.name === name)) return null;
  const db = await request(indexedDB.open(name));
  try {
    const names = [...db.objectStoreNames];
    if (!names.length) throw new Error('Empty PXE database');
    const tx = db.transaction(names, 'readonly');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('PXE snapshot failed')); });
    const stores = await Promise.all(names.map(async name => {
      const store = tx.objectStore(name);
      if (store.autoIncrement) throw new Error('Unsupported auto-increment PXE store');
      const indexes = [...store.indexNames].map(name => { const i = store.index(name); return { name, keyPath: i.keyPath, unique: i.unique, multiEntry: i.multiEntry }; });
      const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
      return { name, keyPath: store.keyPath, indexes, keys, values };
    }));
    await done;
    return { version: db.version, stores };
  } finally { db.close(); }
}
async function populate(indexedDB, name, data) {
  if ((await indexedDB.databases()).some(db => db.name === name)) throw new Error('PXE restore requires an empty scoped database');
  if (!data || !Number.isSafeInteger(data.version) || data.version < 1 || !Array.isArray(data.stores) || !data.stores.length) throw new Error('Invalid PXE snapshot');
  const req = indexedDB.open(name, data.version);
  req.onupgradeneeded = () => {
    try {
      for (const item of data.stores) {
        const store = req.result.createObjectStore(item.name, { keyPath: item.keyPath });
        for (const i of item.indexes) store.createIndex(i.name, i.keyPath, { unique: i.unique, multiEntry: i.multiEntry });
      }
    } catch { req.transaction.abort(); }
  };
  const db = await request(req);
  try {
    const tx = db.transaction(data.stores.map(s => s.name), 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(new Error('PXE restore transaction failed')); });
    try {
      for (const item of data.stores) {
        if (item.keys.length !== item.values.length) throw new Error('Invalid PXE records');
        const store = tx.objectStore(item.name);
        for (let i = 0; i < item.keys.length; i++) {
          if (item.keyPath === null) store.add(item.values[i], item.keys[i]);
          else store.add(item.values[i]);
        }
      }
    } catch { tx.abort(); }
    await done;
  } finally { db.close(); }
}
function createPxeCacheSession({ directory, walletSecret, scope }) {
  if (typeof walletSecret !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(walletSecret) || BigInt(walletSecret) <= 0n || BigInt(walletSecret) >= FR) throw new Error('Invalid PXE wallet key');
  const aad = scopeBytes(scope);
  const key = crypto.createHash('sha256').update('BILLBOARD_PXE_KEY_V2\0').update(Buffer.from(walletSecret.slice(2), 'hex')).digest();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077) throw new Error('PXE cache requires a private directory');
  const name = path.join(directory, hash(aad)), file = name + '.json', lock = name + '.lock';
  let lockFd;
  try { lockFd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
  catch { throw new Error('PXE cache is locked. Another process may be active; preserve the cache and inspect the lock before explicit recovery.'); }
  fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid })); fs.fsyncSync(lockFd);
  const lockStat = fs.fstatSync(lockFd);
  let closed = false, ready = false, previous;
  function checkOpen() { if (closed) throw new Error('PXE cache session closed'); }
  function read() {
    let fd;
    try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (e) { if (e.code === 'ENOENT') return null; throw new Error('Cannot read PXE checkpoint'); }
    try {
      const s = fs.fstatSync(fd);
      if (!s.isFile() || s.mode & 0o077 || s.size > MAX * 1.4) throw new Error('Invalid private PXE checkpoint file');
      return fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
  }
  return {
    async restore(indexedDB) {
      checkOpen(); if (ready) throw new Error('PXE cache already restored');
      const bytes = read(); previous = bytes ? hash(bytes) : null;
      if (bytes) {
        let data;
        try {
          const e = JSON.parse(bytes);
          if (e.schema !== 2 || typeof e.iv !== 'string' || !/^[0-9a-f]{24}$/.test(e.iv) || typeof e.ciphertext !== 'string') throw new Error();
          const encrypted = Buffer.from(e.ciphertext, 'base64');
          if (encrypted.length < 16 || encrypted.length > MAX) throw new Error();
          const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'hex'));
          decipher.setAAD(aad); decipher.setAuthTag(encrypted.subarray(-16));
          data = v8.deserialize(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]));
        } catch { throw new Error('PXE checkpoint authentication failed; existing data preserved'); }
        await populate(indexedDB, scope.databaseName, data);
      }
      ready = true; return Boolean(bytes);
    },
    async save(indexedDB) {
      checkOpen(); if (!ready) throw new Error('PXE cache was not restored successfully');
      const data = await snapshot(indexedDB, scope.databaseName);
      if (!data) return false;
      const payload = v8.serialize(data);
      if (payload.length + 16 > MAX) throw new Error('PXE checkpoint exceeds supported size; previous checkpoint preserved');
      const current = read(); if ((current ? hash(current) : null) !== previous) throw new Error('PXE checkpoint changed concurrently; refusing overwrite');
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(payload), cipher.final(), cipher.getAuthTag()]);
      const bytes = Buffer.from(JSON.stringify({ schema: 2, iv: iv.toString('hex'), ciphertext: ciphertext.toString('base64') }) + '\n');
      const temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      let fd;
      try {
        fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(temp, file); const directoryFd = fs.openSync(directory, 'r');
        try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
        previous = hash(bytes); return true;
      } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temp, { force: true }); }
    },
    close() {
      if (closed) return;
      closed = true; key.fill(0); fs.closeSync(lockFd);
      const current = fs.lstatSync(lock);
      if (current.ino === lockStat.ino && current.dev === lockStat.dev) fs.unlinkSync(lock);
      else throw new Error('PXE cache lock changed; refusing cleanup');
    },
  };
}
module.exports = { createPxeCacheSession };
