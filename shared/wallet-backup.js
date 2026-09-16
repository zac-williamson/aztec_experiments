// Password-encrypted portable custody. This cannot protect an unlocked page
// from malicious code; only ciphertext is intended for download or transport.
(function (global) {
  'use strict';
  const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const encoder = new TextEncoder();
  const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const bytes = text => Uint8Array.from(text.match(/../g) || [], value => parseInt(value, 16));
  const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
  function field(value, nonzero) {
    if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value) || BigInt(value) >= FIELD || (nonzero && BigInt(value) === 0n)) throw new Error('Invalid backup field.');
    return value;
  }
  function validateWallet(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('secretKey' in value) || !('salt' in value)) throw new Error('Invalid backup wallet.');
    const rawSalt = value.salt;
    if (!((typeof rawSalt === 'string' && (/^0x[0-9a-fA-F]{1,64}$/.test(rawSalt) || /^(0|[1-9][0-9]*)$/.test(rawSalt))) || (typeof rawSalt === 'number' && Number.isSafeInteger(rawSalt) && rawSalt >= 0))) throw new Error('Invalid backup wallet salt.');
    const salt = BigInt(rawSalt);
    if (salt >= FIELD) throw new Error('Invalid backup wallet salt.');
    return { secretKey: field(typeof value.secretKey === 'string' ? value.secretKey.toLowerCase() : value.secretKey, true), salt: '0x' + salt.toString(16).padStart(64, '0') };
  }
  function network(value) {
    if (!exact(value, ['l1ChainId', 'rollupAddress', 'rollupVersion'])) throw new Error('Invalid backup network.');
    for (const [name, bits] of [['l1ChainId', 64n], ['rollupVersion', 32n]]) {
      if (typeof value[name] !== 'string' || !/^[1-9][0-9]*$/.test(value[name]) || BigInt(value[name]) >= (1n << bits)) throw new Error('Invalid backup network.');
    }
    if (!/^0x[0-9a-f]{40}$/.test(value.rollupAddress) || BigInt(value.rollupAddress) === 0n) throw new Error('Invalid backup network.');
    return { l1ChainId: value.l1ChainId, rollupAddress: value.rollupAddress, rollupVersion: value.rollupVersion };
  }
  function validateClaim(value) {
    if (!exact(value, ['scope', 'record']) || !exact(value.scope, ['l1ChainId', 'rollupAddress', 'rollupVersion', 'boardAddress', 'portalAddress', 'depositor'])) throw new Error('Invalid backup claim scope.');
    const scope = { ...network({ l1ChainId: value.scope.l1ChainId, rollupAddress: value.scope.rollupAddress, rollupVersion: value.scope.rollupVersion }),
      boardAddress: field(value.scope.boardAddress, true), portalAddress: value.scope.portalAddress, depositor: value.scope.depositor };
    for (const name of ['portalAddress', 'depositor']) if (!/^0x[0-9a-f]{40}$/.test(scope[name]) || BigInt(scope[name]) === 0n) throw new Error('Invalid backup claim actor.');
    if (!exact(value.record, ['schemaVersion', 'secretHash', 'secret']) || value.record.schemaVersion !== 1) throw new Error('Invalid backup claim.');
    return { scope, record: { schemaVersion: 1, secretHash: field(value.record.secretHash, true), secret: field(value.record.secret, true) } };
  }
  function validatePayload(value, { expectedNetwork, expectedWallet } = {}) {
    const portable=value?.schemaVersion===2;
    if (!exact(value, portable?['schemaVersion','wallet','claims','journals']:['schemaVersion','wallet','claims']) || (!portable&&value.schemaVersion!==1) || !Array.isArray(value.claims) || value.claims.length > 10000) throw new Error('Invalid wallet backup.');
    let journals;
    if(portable) {
      if(!Array.isArray(value.journals)||value.journals.length>10000)throw new Error('Invalid recovery journal backup.');
      const keys=new Set();let total=0;
      journals=value.journals.map(record=>{
        if(!exact(record,['key','encoded'])||typeof record.key!=='string'||!/^[0-9a-f]{64}$/.test(record.key)||typeof record.encoded!=='string'||record.encoded.length>16*1024*1024||keys.has(record.key))throw new Error('Invalid recovery journal backup.');
        keys.add(record.key);total+=record.encoded.length;if(total>16*1024*1024)throw new Error('Recovery journal backup is too large.');
        return {key:record.key,encoded:record.encoded};
      });
    }
    const wallet = validateWallet(value.wallet);
    const claims = value.claims.map(validateClaim);
    const ids = claims.map(claim => JSON.stringify([claim.scope, claim.record.secretHash]));
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate backup claim.');
    if (expectedWallet && JSON.stringify(wallet) !== JSON.stringify(validateWallet(expectedWallet))) throw new Error('Backup belongs to another wallet.');
    if (expectedNetwork) {
      if(journals?.length)throw new Error('Network-filtered journal restore is unsupported; restore the complete wallet offline.');
      const expected = network(expectedNetwork);
      if (claims.some(claim => JSON.stringify(network({ l1ChainId: claim.scope.l1ChainId, rollupAddress: claim.scope.rollupAddress, rollupVersion: claim.scope.rollupVersion })) !== JSON.stringify(expected))) throw new Error('Backup belongs to another network.');
    }
    return portable?{schemaVersion:2,wallet,claims,journals}:{schemaVersion:1,wallet,claims};
  }
  const aad = encoder.encode('AZTEC_BB_PASSWORD_BACKUP_V1\0PBKDF2-SHA256:600000:AES-256-GCM');
  function passwordBytes(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Use a backup password between 12 and 1024 characters.');
    return encoder.encode(password);
  }
  async function key(password, salt) {
    const base = await crypto.subtle.importKey('raw', passwordBytes(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(payload, password) {
    const plaintext = encoder.encode(JSON.stringify(validatePayload(payload)));
    if (plaintext.length > 16 * 1024 * 1024) throw new Error('Wallet backup is too large.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    try {
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, await key(password, salt), plaintext);
      return { schemaVersion: 1, kind: 'aztec-billboard-encrypted-wallet', kdf: 'PBKDF2-SHA256', iterations: 600000, salt: hex(salt), iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) };
    } finally { plaintext.fill(0); }
  }
  async function decrypt(envelope, password, options = {}) {
    if (!exact(envelope, ['schemaVersion', 'kind', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext']) || envelope.schemaVersion !== 1 || envelope.kind !== 'aztec-billboard-encrypted-wallet' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== 600000 || !/^[0-9a-f]{32}$/.test(envelope.salt) || !/^[0-9a-f]{24}$/.test(envelope.iv) || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length < 32 || envelope.ciphertext.length > 32 * 1024 * 1024 + 32 || envelope.ciphertext.length % 2 || !/^[0-9a-f]+$/.test(envelope.ciphertext)) throw new Error('Invalid encrypted wallet backup.');
    let plaintext;
    try {
      plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv), additionalData: aad, tagLength: 128 }, await key(password, bytes(envelope.salt)), bytes(envelope.ciphertext)));
    } catch (_) { throw new Error('Cannot unlock wallet backup: wrong password or damaged file.'); }
    try { return validatePayload(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)), options); }
    finally { plaintext.fill(0); }
  }
  global.BillboardWalletBackup = Object.freeze({ encrypt, decrypt, validateWallet, validatePayload, validateClaim });
})(globalThis);
