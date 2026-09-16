// V2 account custody binds the key and full account salt. The old V1 database
// is left untouched and is never imported automatically; there are no deployed
// application versions requiring a key-only custody migration.
// AES-GCM encrypts at rest. It cannot protect an unlocked wallet against malicious page code.
function makeClaimSecretStore(walletSecret, walletSalt = '0x' + '0'.repeat(64)) {
  const canonicalWallet = globalThis.BillboardWalletBackup.validateWallet({secretKey: walletSecret, salt: walletSalt});
  walletSecret = canonicalWallet.secretKey; walletSalt = canonicalWallet.salt;
  const encoder = new TextEncoder();
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  const unhex = text => Uint8Array.from(text.match(/../g) || [], pair => parseInt(pair,16));
  if (!/^0x[0-9a-fA-F]{64}$/.test(walletSecret || '') || BigInt(walletSecret) === 0n) throw new Error('A loaded wallet key is required for claim-secret custody.');
  const prefix = encoder.encode('AZTEC_BB_CLAIM_STORE_KEY_V2\0');
  const input = new Uint8Array(prefix.length + 64); input.set(prefix); input.set(unhex(walletSecret.slice(2)),prefix.length); input.set(unhex(walletSalt.slice(2)),prefix.length + 32);
  const walletIdPromise = crypto.subtle.digest('SHA-256', encoder.encode('AZTEC_BB_CLAIM_BACKUP_OWNER_V2\0' + walletSecret + walletSalt)).then(value => hex(new Uint8Array(value)));
  const keyPromise = crypto.subtle.digest('SHA-256',input).then(bytes => crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']));
  function aad(scope,secretHash) {
    const fields=['l1ChainId','rollupAddress','rollupVersion','boardAddress','portalAddress','depositor'];
    if (!scope || Object.keys(scope).length!==6 || fields.some(name => typeof scope[name]!=='string')) throw new Error('Invalid claim-secret scope.');
    for (const name of ['l1ChainId','rollupVersion']) {
      if (!/^[1-9][0-9]*$/.test(scope[name]) || BigInt(scope[name]) >= (1n << (name==='l1ChainId'?64n:32n))) throw new Error('Invalid claim-secret network scope.');
    }
    for (const name of ['rollupAddress','portalAddress','depositor']) {
      if (!/^0x[0-9a-f]{40}$/.test(scope[name]) || BigInt(scope[name])===0n) throw new Error('Invalid claim-secret actor.');
    }
    if (!/^0x[0-9a-f]{64}$/.test(scope.boardAddress) || BigInt(scope.boardAddress)===0n ||
        !/^0x[0-9a-f]{64}$/.test(secretHash)) throw new Error('Invalid claim-secret identifier.');
    return JSON.stringify(['AZTEC_BB_CLAIM_STORE_V2',...fields.map(name=>scope[name]),secretHash]);
  }
  function validateRecord(record,secretHash) {
    const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    if (!record || Object.keys(record).sort().join(',')!=='schemaVersion,secret,secretHash' || record.schemaVersion!==1 ||
        record.secretHash!==secretHash || !/^0x[0-9a-f]{64}$/.test(record.secret) || BigInt(record.secret)<=0n || BigInt(record.secret)>=modulus) {
      throw new Error('Invalid saved claim-secret record.');
    }
    return record;
  }
  async function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('aztec-billboard-claim-secrets-v2',1);
      let rejected=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('records');
      request.onerror=()=>{rejected=true;reject(new Error('Cannot open local claim-secret storage.'));};
      request.onblocked=()=>{rejected=true;reject(new Error('Local claim-secret storage is blocked by another page.'));};
      request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
    });
  }
  async function readEnvelope(storageKey) {
    const db=await open();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('records','readonly'); const req=tx.objectStore('records').get(storageKey);
        tx.oncomplete=()=>resolve(req.result);
        tx.onabort=tx.onerror=()=>reject(new Error('Cannot read local claim-secret storage.'));
      });
    } finally { db.close(); }
  }
  async function load(scope,secretHash) {
    const storageKey=aad(scope,secretHash); const envelope=await readEnvelope((await walletIdPromise) + ':' + storageKey);
    if (envelope===undefined) return null;
    return decodeEnvelope(envelope,storageKey,secretHash);
  }
  async function decodeEnvelope(envelope,storageKey,secretHash) {
    if (!envelope || Object.keys(envelope).sort().join(',')!=='ciphertext,iv,schemaVersion,walletId' || envelope.schemaVersion!==1 ||
        !/^[0-9a-f]{24}$/.test(envelope.iv) || !/^[0-9a-f]{32,2048}$/.test(envelope.ciphertext) || envelope.ciphertext.length%2) throw new Error('Invalid encrypted claim-secret envelope.');
    if (envelope.walletId !== undefined && envelope.walletId !== await walletIdPromise) throw new Error('Saved claim belongs to another wallet.');
    try {
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(envelope.iv),additionalData:encoder.encode(storageKey),tagLength:128},
        await keyPromise,unhex(envelope.ciphertext));
      return validateRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)),secretHash);
    } catch (_) { throw new Error('Cannot authenticate the saved claim secret with this wallet and scope.'); }
  }
  async function exportRecords() {
    const db = await open(); let entries;
    try {
      entries = await new Promise((resolve, reject) => {
        const tx = db.transaction('records','readonly'); const store = tx.objectStore('records');
        const keys = store.getAllKeys(); const values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.map((key, i) => [key, values.result[i]]));
        tx.onabort = tx.onerror = () => reject(new Error('Cannot read claim secrets for backup.'));
      });
    } finally { db.close(); }
    if (entries.length > 10000) throw new Error('Claim-secret backup is too large.');
    const walletId = await walletIdPromise; const records = [];
    for (const [storageKey, envelope] of entries) {
      if (typeof storageKey !== 'string' || !storageKey.startsWith(walletId + ':')) continue;
      const scopeKey = storageKey.slice(walletId.length + 1);
      const parts = JSON.parse(scopeKey);
      if (!Array.isArray(parts) || parts.length !== 8 || parts[0] !== 'AZTEC_BB_CLAIM_STORE_V2') throw new Error('Invalid claim-secret backup scope.');
      const fields = ['l1ChainId','rollupAddress','rollupVersion','boardAddress','portalAddress','depositor'];
      const scope = Object.fromEntries(fields.map((name,i) => [name,parts[i+1]]));
      const secretHash = parts[7];
      if (aad(scope,secretHash) !== scopeKey) throw new Error('Invalid claim-secret backup scope.');
      // V2 never imports the old key-only store automatically. Every selected
      // account record must authenticate before a backup is considered complete.
      const record = await decodeEnvelope(envelope, scopeKey, secretHash);
      records.push({scope,record});
    }
    return records;
  }
  async function restoreRecords(records) {
    if (!Array.isArray(records) || records.length > 10000) throw new Error('Invalid restored claims.');
    const prepared = []; const keys = new Set(); const walletId = await walletIdPromise;
    for (const value of records) {
      const {scope,record} = globalThis.BillboardWalletBackup.validateClaim(value);
      const sdk = globalThis.__aztec;
      if (!sdk?.Fr || typeof sdk.computeSecretHash !== 'function') throw new Error('Load the pinned Aztec SDK before restoring claim secrets.');
      const actualHash = await sdk.computeSecretHash(new sdk.Fr(BigInt(record.secret)));
      if (actualHash.toString().toLowerCase() !== record.secretHash) throw new Error('Restored claim secret does not match its commitment.');
      const storageKey = aad(scope,record.secretHash);
      if (keys.has(storageKey)) throw new Error('Duplicate restored claim.'); keys.add(storageKey);
      const databaseKey = walletId + ':' + storageKey;
      const existing = await readEnvelope(databaseKey);
      if (existing !== undefined) {
        const old = await decodeEnvelope(existing,storageKey,record.secretHash);
        if (old.secret !== record.secret) throw new Error('A different claim secret already occupies this record.');
      }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(storageKey),tagLength:128},await keyPromise,encoder.encode(JSON.stringify(record)));
      prepared.push({storageKey:databaseKey,expected:existing,envelope:{schemaVersion:1,walletId,iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext))}});
    }
    const db = await open();
    try {
      await new Promise((resolve,reject) => {
        const tx = db.transaction('records','readwrite',{durability:'strict'}); const store = tx.objectStore('records');
        for (const entry of prepared) {
          const request = store.get(entry.storageKey);
          request.onsuccess = () => {
            if (JSON.stringify(request.result) !== JSON.stringify(entry.expected)) { tx.abort(); return; }
            if (request.result === undefined) store.add(entry.envelope,entry.storageKey);
          };
        }
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error('Claim restore did not commit; existing records were preserved.'));
      });
    } finally { db.close(); }
  }
  return {
    load, exportRecords, restoreRecords,
    async save(scope,record) {
      validateRecord(record,record?.secretHash);
      const storageKey=aad(scope,record.secretHash);
      const existing=await load(scope,record.secretHash);
      if (existing) {
        if (existing.secret!==record.secret) throw new Error('A different claim secret already occupies this record.');
        return;
      }
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const plaintext=encoder.encode(JSON.stringify({schemaVersion:1,secretHash:record.secretHash,secret:record.secret}));
      const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(storageKey),tagLength:128},await keyPromise,plaintext);
      const walletId = await walletIdPromise;
      const db=await open();
      try {
        await new Promise((resolve,reject)=>{
          // Completion of a strict durable transaction, not merely request success.
          const tx=db.transaction('records','readwrite',{durability:'strict'});
          tx.objectStore('records').add({schemaVersion:1,walletId,iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext))},walletId + ':' + storageKey);
          tx.oncomplete=()=>resolve();
          tx.onabort=tx.onerror=()=>reject(new Error('Claim-secret storage did not commit. Deposit has not been sent.'));
        });
      } finally { db.close(); }
      const restored=await load(scope,record.secretHash);
      if (!restored || restored.secret!==record.secret) throw new Error('Claim-secret storage read-back failed.');
    },
  };
}

// Every wallet screen preserves the same collateral custody during backup.
globalThis.BillboardClaimBackup=Object.freeze({
  exportRecords(wallet){return makeClaimSecretStore(wallet.secretKey,wallet.salt).exportRecords();},
  restoreRecords(wallet,claims){return makeClaimSecretStore(wallet.secretKey,wallet.salt).restoreRecords(claims);},
});
