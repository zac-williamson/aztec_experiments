// Durable issuer core only. No HTTP, signing, owner/blind collection or chain registration.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Fr } from '@aztec/foundation/curves/bn254';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { DomainSeparator } from '@aztec/constants';
import { assertNodeVersion } from '../scripts/toolchain.mjs';

export class IssuerError extends Error {
  constructor(code) { super(code); this.name = 'IssuerError'; this.code = code; }
}
const need = (condition, code) => { if (!condition) throw new IssuerError(code); };
function exact(input, keys) {
  need(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => keys.includes(key)), 'ISSUER_INVALID_INPUT');
}
function uint(value, bits) {
  need(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 39), 'ISSUER_INVALID_INTEGER');
  const n = BigInt(value); need(n >= 0n && n < (1n << BigInt(bits)), 'ISSUER_INVALID_INTEGER'); return n;
}
function commitment(value) {
  need(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'ISSUER_INVALID_COMMITMENT');
  let f; try { f = Fr.fromString(value); } catch { throw new IssuerError('ISSUER_INVALID_COMMITMENT'); }
  need(!f.isZero() && f.toString() === value, 'ISSUER_INVALID_COMMITMENT'); return value;
}
const tokenHash = token => {
  need(typeof token === 'string' && /^[0-9a-f]{64}$/.test(token), 'ISSUER_INVALID_TOKEN');
  return createHash('sha256').update(token, 'ascii').digest('hex');
};

export async function openIssuer(config, options) {
  try { return await initializeIssuer(config, options); }
  catch(error) { if(error instanceof IssuerError) throw error; throw new IssuerError('ISSUER_DATABASE_UNAVAILABLE'); }
}
async function initializeIssuer(config, { nowSeconds = () => BigInt(Math.floor(Date.now() / 1000)) } = {}) {
  assertNodeVersion();
  exact(config, ['dbPath','chainId','version','sponsorAddress','windowDuration','windowBudget','maxFeePerTicket']);
  need(typeof config.dbPath === 'string' && path.isAbsolute(config.dbPath), 'ISSUER_INVALID_DATABASE');
  const scope = {
    chainId: String(uint(config.chainId, 64)), version: String(uint(config.version, 32)),
    sponsorAddress: commitment(config.sponsorAddress), windowDuration: String(uint(config.windowDuration, 64)),
    windowBudget: String(uint(config.windowBudget, 128)), maxFeePerTicket: String(uint(config.maxFeePerTicket, 128)),
  };
  const duration = BigInt(scope.windowDuration), budget = BigInt(scope.windowBudget), fee = BigInt(scope.maxFeePerTicket);
  need(duration > 0n && duration <= 86400n && fee > 0n && budget >= fee, 'ISSUER_INVALID_POLICY');
  // A private directory prevents untrusted sibling journal replacement; never chmod unrelated existing paths.
  const directory = path.dirname(config.dbPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dirStat = fs.lstatSync(directory);
  need(dirStat.isDirectory() && !dirStat.isSymbolicLink() && (dirStat.mode & 0o077) === 0 && dirStat.uid === process.getuid(), 'ISSUER_DATABASE_PERMISSIONS');
  let fd;
  try { fd = fs.openSync(config.dbPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw new IssuerError('ISSUER_DATABASE_UNAVAILABLE'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  const stat = fs.lstatSync(config.dbPath);
  need(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid() && stat.nlink === 1, 'ISSUER_DATABASE_PERMISSIONS');
  const db = new DatabaseSync(config.dbPath, { enableForeignKeyConstraints: true, timeout: 5000 });
  let closed = false;
  const safe = fn => (...args) => {
    need(!closed, 'ISSUER_CLOSED');
    try { return fn(...args); } catch (error) { if (error instanceof IssuerError) throw error; throw new IssuerError('ISSUER_DATABASE_UNAVAILABLE'); }
  };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS windows(window TEXT PRIMARY KEY,reserved TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,window TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('open','sealing','sealed')),count INTEGER NOT NULL CHECK(count BETWEEN 0 AND 1024),root TEXT,FOREIGN KEY(window) REFERENCES windows(window));
      CREATE UNIQUE INDEX IF NOT EXISTS one_open_batch ON batches(window) WHERE status='open';
      CREATE TABLE IF NOT EXISTS slots(batch_id TEXT NOT NULL,position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 1023),token_hash TEXT UNIQUE NOT NULL,leaf TEXT,PRIMARY KEY(batch_id,position),FOREIGN KEY(batch_id) REFERENCES batches(id));
      CREATE TABLE IF NOT EXISTS paths(batch_id TEXT NOT NULL,position INTEGER NOT NULL,siblings TEXT NOT NULL,PRIMARY KEY(batch_id,position),FOREIGN KEY(batch_id,position) REFERENCES slots(batch_id,position));`);
    transaction(() => {
      const expected = JSON.stringify(scope), existing = db.prepare('SELECT value FROM meta WHERE key=?').get('scope');
      if (existing) need(existing.value === expected, 'ISSUER_CONFIG_MISMATCH');
      else {
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('scope', expected);
        db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('next_batch_id', '1');
      }
    });
  } catch (error) { db.close(); if (error instanceof IssuerError) throw error; throw new IssuerError('ISSUER_DATABASE_UNAVAILABLE'); }
  const now = () => uint(nowSeconds(), 64);
  const endOf = window => {
    const start = BigInt(window) * duration, end = start + duration - 1n;
    need(end < (1n << 64n), 'ISSUER_INVALID_WINDOW'); return end;
  };
  const alive = batch => {
    const time=now();
    need(time >= BigInt(batch.window)*duration, 'ISSUER_INACTIVE_WINDOW');
    need(time <= endOf(batch.window), 'ISSUER_EXPIRED');
  };
  const batchFor = id => {
    const batch = db.prepare('SELECT * FROM batches WHERE id=?').get(String(uint(id, 64)));
    need(batch, 'ISSUER_UNKNOWN_BATCH'); return batch;
  };
  const slotFor = token => {
    const slot = db.prepare('SELECT * FROM slots WHERE token_hash=?').get(tokenHash(token));
    need(slot, 'ISSUER_INVALID_TOKEN'); return slot;
  };
  const publicBatch = batch => ({ chainId:scope.chainId,version:scope.version,sponsorAddress:scope.sponsorAddress,
    window:batch.window,batchId:batch.id,ticketCount:batch.count,expiresAt:String(endOf(batch.window)),
    status:batch.status,root:batch.root??null,registration:'pending',usable:false });
  // Explicit bounded retention: no unbounded startup scan or silently pruned financial history.
  const limits={batches:64,windows:64,slots:65536};
  const countRows=table=>db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  const buildTree=async slots=>{
    const levels=[Array.from({length:1024},()=>Fr.ZERO)];
    for(const slot of slots) if(slot.leaf) levels[0][slot.position]=Fr.fromString(slot.leaf);
    for(let depth=0;depth<10;depth++) {
      const next=[];
      for(let i=0;i<levels[depth].length;i+=2) next.push(await poseidon2HashWithSeparator([levels[depth][i],levels[depth][i+1]],DomainSeparator.MERKLE_HASH));
      levels.push(next);
    }
    return levels;
  };
  try {
    const snapshot=transaction(()=>{
      for(const [table,max] of Object.entries(limits)) need(countRows(table)<=max,'ISSUER_RETENTION_LIMIT');
      need(countRows('paths')<=limits.slots && countRows('meta')===2,'ISSUER_STORED_STATE_INVALID');
      need(db.prepare('PRAGMA foreign_key_check').all().length===0,'ISSUER_STORED_STATE_INVALID');
      return {generation:db.prepare('PRAGMA data_version').get().data_version,
        next:db.prepare('SELECT value FROM meta WHERE key=?').get('next_batch_id')?.value,
        windows:db.prepare('SELECT * FROM windows').all(),batches:db.prepare('SELECT * FROM batches').all(),
        slots:db.prepare('SELECT * FROM slots ORDER BY position').all(),paths:db.prepare('SELECT * FROM paths ORDER BY position').all()};
    });
    const valid=ok=>need(ok,'ISSUER_STORED_STATE_INVALID');
    const windows=new Map(snapshot.windows.map(w=>[w.window,w]));
    let maxId=0n;
    const amounts=new Map(),openWindows=new Set();
    const fieldCanonical=value=>{
      valid(typeof value==='string' && /^0x[0-9a-f]{64}$/.test(value));
      try { valid(Fr.fromString(value).toString()===value); } catch { throw new IssuerError('ISSUER_STORED_STATE_INVALID'); }
    };
    const validationDeadline=Date.now()+15000;
    for(const batch of snapshot.batches) {
      const id=uint(batch.id,64); valid(String(id)===batch.id && id>0n);if(id>maxId)maxId=id;
      valid(windows.has(batch.window) && ['open','sealing','sealed'].includes(batch.status));
      valid(Number.isInteger(batch.count)&&batch.count>0&&batch.count<=1024);
      const slots=snapshot.slots.filter(slot=>slot.batch_id===batch.id),paths=snapshot.paths.filter(item=>item.batch_id===batch.id);
      valid(slots.length===batch.count);
      for(let i=0;i<slots.length;i++) {
        valid(slots[i].position===i && /^[0-9a-f]{64}$/.test(slots[i].token_hash));
        if(slots[i].leaf!==null){fieldCanonical(slots[i].leaf);valid(slots[i].leaf!==Fr.ZERO.toString());}
      }
      amounts.set(batch.window,(amounts.get(batch.window)??0n)+BigInt(batch.count)*fee);
      if(batch.status==='open'){valid(!openWindows.has(batch.window));openWindows.add(batch.window);}
      if(batch.status!=='sealed') {
        valid(batch.root===null && paths.length===0);
        if(batch.status==='sealing')valid(slots.some(slot=>slot.leaf!==null));
      } else {
        fieldCanonical(batch.root);valid(batch.root!==Fr.ZERO.toString()&&slots.some(slot=>slot.leaf!==null)&&paths.length===slots.length);
        const levels=await buildTree(slots);valid(levels[10][0].toString()===batch.root);
        for(let i=0;i<paths.length;i++) {
          valid(paths[i].position===i && typeof paths[i].siblings==='string' && paths[i].siblings.length<=2048);
          const siblings=JSON.parse(paths[i].siblings);valid(Array.isArray(siblings)&&siblings.length===10);
          for(let depth=0;depth<10;depth++){fieldCanonical(siblings[depth]);valid(siblings[depth]===levels[depth][(i>>depth)^1].toString());}
        }
      }
      need(Date.now()<=validationDeadline,'ISSUER_VALIDATION_TIMEOUT');
    }
    valid(uint(snapshot.next,64)===maxId+1n && snapshot.next===String(maxId+1n));
    for(const window of snapshot.windows) {
      valid(String(uint(window.window,64))===window.window);endOf(window.window);
      const reserved=uint(window.reserved,128);valid(String(reserved)===window.reserved && reserved===(amounts.get(window.window)??0n) && reserved>0n && reserved<=budget);
    }
    transaction(()=>need(db.prepare('PRAGMA data_version').get().data_version===snapshot.generation,'ISSUER_STATE_CHANGED'));
  } catch(error) { db.close();closed=true;if(error instanceof IssuerError)throw error;throw new IssuerError('ISSUER_STORED_STATE_INVALID'); }
  const reserve = safe(input => {
    exact(input, ['window']); const window = String(uint(input.window, 64));
    need(BigInt(window) === now() / duration, 'ISSUER_INACTIVE_WINDOW'); endOf(window);
    return transaction(() => {
      // Lock acquisition may cross the window boundary; the pre-lock check is insufficient.
      need(BigInt(window)===now()/duration,'ISSUER_INACTIVE_WINDOW');
      need(countRows('slots')<limits.slots,'ISSUER_RETENTION_LIMIT');
      const row = db.prepare('SELECT reserved FROM windows WHERE window=?').get(window), reserved = BigInt(row?.reserved ?? '0');
      need(reserved + fee <= budget, 'ISSUER_WINDOW_BUDGET_EXHAUSTED');
      if (!row) { need(countRows('windows')<limits.windows,'ISSUER_RETENTION_LIMIT'); db.prepare('INSERT INTO windows(window,reserved) VALUES(?,?)').run(window, '0'); }
      let batch = db.prepare("SELECT * FROM batches WHERE window=? AND status='open'").get(window);
      if (batch) need(batch.count < 1024, 'ISSUER_BATCH_FULL');
      else {
        need(countRows('batches')<limits.batches,'ISSUER_RETENTION_LIMIT');
        const id = uint(db.prepare('SELECT value FROM meta WHERE key=?').get('next_batch_id').value, 64);
        need(id > 0n && id < (1n << 64n) - 1n, 'ISSUER_BATCH_IDS_EXHAUSTED');
        db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(id + 1n), 'next_batch_id');
        db.prepare("INSERT INTO batches(id,window,status,count) VALUES(?,?,'open',0)").run(String(id), window);
        batch = { id:String(id),window,count:0,status:'open' };
      }
      const token = randomBytes(32).toString('hex'), index = batch.count;
      db.prepare('INSERT INTO slots(batch_id,position,token_hash) VALUES(?,?,?)').run(batch.id, index, tokenHash(token));
      db.prepare('UPDATE batches SET count=count+1 WHERE id=?').run(batch.id);
      db.prepare('UPDATE windows SET reserved=? WHERE window=?').run(String(reserved + fee), window);
      return { ...publicBatch({...batch,count:index+1}),index,token };
    });
  });
  const submit = safe(input => {
    exact(input, ['token','leaf']); const leaf = commitment(input.leaf);
    return transaction(() => {
      const slot = slotFor(input.token), batch = batchFor(slot.batch_id); alive(batch);
      need(batch.status === 'open', 'ISSUER_BATCH_FROZEN');
      if (slot.leaf) need(slot.leaf === leaf, 'ISSUER_COMMITMENT_ALREADY_SET');
      else db.prepare('UPDATE slots SET leaf=? WHERE batch_id=? AND position=?').run(leaf,batch.id,slot.position);
      return { accepted:true,batchId:batch.id,index:slot.position };
    });
  });
  const seal = async input => {
    let snapshot;
    try {
      snapshot = safe(() => {
        exact(input, ['batchId']);
        return transaction(() => {
          const batch = batchFor(input.batchId); alive(batch); need(batch.count > 0, 'ISSUER_EMPTY_BATCH');
          if (batch.status !== 'sealed') db.prepare("UPDATE batches SET status='sealing' WHERE id=?").run(batch.id);
          const slots=db.prepare('SELECT position,leaf FROM slots WHERE batch_id=? ORDER BY position').all(batch.id);
          need(slots.some(slot=>slot.leaf),'ISSUER_EMPTY_BATCH');
          return { batch,slots };
        });
      })();
      if (snapshot.batch.status === 'sealed') return publicBatch(snapshot.batch);
      const levels = await buildTree(snapshot.slots);
      const root=levels[10][0].toString(); need(!levels[10][0].isZero(), 'ISSUER_ZERO_ROOT');
      return safe(() => transaction(() => {
        const batch=batchFor(snapshot.batch.id); alive(batch);
        if(batch.status==='sealed') { need(batch.root===root,'ISSUER_SEAL_CONFLICT');return publicBatch(batch); }
        need(batch.status==='sealing','ISSUER_SEAL_CONFLICT');
        for(const slot of snapshot.slots) {
          const siblings=Array.from({length:10},(_,depth)=>levels[depth][(slot.position>>depth)^1].toString());
          db.prepare('INSERT INTO paths(batch_id,position,siblings) VALUES(?,?,?)').run(batch.id,slot.position,JSON.stringify(siblings));
        }
        db.prepare("UPDATE batches SET status='sealed',root=? WHERE id=?").run(root,batch.id);
        return publicBatch({...batch,status:'sealed',root});
      }))();
    } catch(error) { if(error instanceof IssuerError) throw error; throw new IssuerError('ISSUER_SEAL_FAILED'); }
  };
  const retrieve = safe(input => {
    exact(input,['token']); const slot=slotFor(input.token),batch=batchFor(slot.batch_id);alive(batch);
    need(slot.leaf,'ISSUER_COMMITMENT_MISSING');need(batch.status==='sealed','ISSUER_NOT_SEALED');
    return {...publicBatch(batch),index:slot.position,leaf:slot.leaf,
      siblings:JSON.parse(db.prepare('SELECT siblings FROM paths WHERE batch_id=? AND position=?').get(batch.id,slot.position).siblings)};
  });
  const counters = safe(() => {const currentWindow=String(now()/duration);return { batches:db.prepare('SELECT count(*) AS n FROM batches').get().n,
    allocated:db.prepare('SELECT count(*) AS n FROM slots').get().n,
    submitted:db.prepare('SELECT count(*) AS n FROM slots WHERE leaf IS NOT NULL').get().n,
    sealed:db.prepare("SELECT count(*) AS n FROM batches WHERE status='sealed'").get().n,
    currentWindow,currentWindowReserved:db.prepare('SELECT reserved FROM windows WHERE window=?').get(currentWindow)?.reserved??'0' };});
  return Object.freeze({reserve,submit,seal,retrieve,counters,close:()=>{if(!closed){db.close();closed=true;}}});
}
