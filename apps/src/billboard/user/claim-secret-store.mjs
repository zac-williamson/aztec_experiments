import fs from 'node:fs';
import path from 'node:path';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const names = ['l1ChainId', 'rollupAddress', 'rollupVersion', 'boardAddress', 'portalAddress', 'depositor'];
function field(value) {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) > 0n && BigInt(value) < FR;
}
function aadFor(scope, secretHash) {
  if (!scope || Object.keys(scope).length !== names.length || names.some(name => !Object.hasOwn(scope, name))) throw new Error('Invalid claim storage scope');
  for (const [name, bits] of [['l1ChainId', 64n], ['rollupVersion', 32n]]) {
    if (typeof scope[name] !== 'string' || !/^[1-9][0-9]*$/.test(scope[name]) || scope[name].length > 20 || BigInt(scope[name]) >= 1n << bits) throw new Error('Invalid claim storage network');
  }
  for (const name of ['rollupAddress', 'portalAddress', 'depositor']) {
    if (typeof scope[name] !== 'string' || !/^0x[0-9a-f]{40}$/.test(scope[name]) || BigInt(scope[name]) === 0n) throw new Error('Invalid claim storage actor');
  }
  if (!field(scope.boardAddress) || !field(secretHash)) throw new Error('Invalid claim storage Field');
  return Buffer.from(JSON.stringify(['AZTEC_BB_CLAIM_STORE_V1', ...names.map(name => scope[name]), secretHash]));
}
function validateRecord(record, secretHash) {
  if (!record || Object.keys(record).sort().join(',') !== 'schemaVersion,secret,secretHash' || record.schemaVersion !== 1 ||
      record.secretHash !== secretHash || !field(record.secret)) throw new Error('Invalid saved claim record');
  return { schemaVersion: 1, secretHash: record.secretHash, secret: record.secret };
}

/** Encrypted, immutable records. A successful save includes file and directory fsync and read-back. */
export function createClaimSecretStore(directory, walletSecret, walletSalt = 0) {
  if (!field(walletSecret)) throw new Error('Invalid claim storage wallet key');
  if (!((typeof walletSalt === 'number' && Number.isSafeInteger(walletSalt) && walletSalt >= 0) || (typeof walletSalt === 'string' && /^(?:0x[0-9a-fA-F]{1,64}|0|[1-9][0-9]{0,76})$/.test(walletSalt))) || BigInt(walletSalt) >= FR) throw new Error('Invalid claim storage wallet salt');
  const saltBytes = Buffer.from(BigInt(walletSalt).toString(16).padStart(64, '0'), 'hex');
  const key = createHash('sha256').update('AZTEC_BB_CLAIM_STORE_KEY_V2\0').update(Buffer.from(walletSecret.slice(2), 'hex')).update(saltBytes).digest();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Claim storage must be a private directory');
  const filename = aad => path.join(directory, createHash('sha256').update(aad).digest('hex') + '.json');
  function load(scope, secretHash) {
    const aad = aadFor(scope, secretHash);
    let fd;
    try { fd = fs.openSync(filename(aad), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('Cannot open saved claim record'); }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 4096 || (stat.mode & 0o077)) throw new Error('Invalid claim record file');
      const envelope = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (envelope.schemaVersion !== 1 || !/^[0-9a-f]{24}$/.test(envelope.iv) ||
          typeof envelope.ciphertext !== 'string' || !/^(?:[0-9a-f]{2}){17,2048}$/.test(envelope.ciphertext)) throw new Error('Invalid claim envelope');
      const bytes = Buffer.from(envelope.ciphertext, 'hex');
      const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
      cipher.setAAD(aad); cipher.setAuthTag(bytes.subarray(-16));
      const plaintext = Buffer.concat([cipher.update(bytes.subarray(0, -16)), cipher.final()]);
      return validateRecord(JSON.parse(plaintext.toString('utf8')), secretHash);
    } catch { throw new Error('Saved claim record failed authentication'); }
    finally { fs.closeSync(fd); }
  }
  return {
    async load(scope, secretHash) { return load(scope, secretHash); },
    async save(scope, input) {
      const record = validateRecord(input, input?.secretHash);
      const aad = aadFor(scope, record.secretHash);
      const existing = load(scope, record.secretHash);
      if (existing) {
        if (existing.secret !== record.secret) throw new Error('Claim record collision');
        return;
      }
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final(), cipher.getAuthTag()]);
      const envelope = JSON.stringify({ schemaVersion: 1, iv: iv.toString('hex'), ciphertext: ciphertext.toString('hex') });
      const target = filename(aad), temporary = target + '.' + randomBytes(12).toString('hex') + '.tmp';
      let fd;
      try {
        fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, envelope); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        try { fs.linkSync(temporary, target); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        fs.unlinkSync(temporary);
        const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
        const restored = load(scope, record.secretHash);
        if (!restored || restored.secret !== record.secret) throw new Error('Claim record read-back mismatch');
      } finally {
        if (fd !== undefined) fs.closeSync(fd);
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
