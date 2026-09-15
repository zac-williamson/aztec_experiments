// CLI-only durable encrypted adapter. Key management and whole-database rollback detection are external.
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CouponStoreError } from '../shared/sponsor-coupon-store.mjs';
import { assertNodeVersion } from '../scripts/toolchain.mjs';
export { CouponStoreError };
const need=ok=>{if(!ok)throw new CouponStoreError();};
const hex=x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x);
const time=x=>typeof x==='string'&&/^(0|[1-9][0-9]*)$/.test(x)&&x.length<=20&&BigInt(x)<(1n<<64n);
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const aad=row=>encoder.encode(JSON.stringify(['AZTEC_BB_SPONSOR_COUPON_V1',row.id,row.partition,row.expiresAt,row.attempted]));
const fingerprint=rows=>JSON.stringify(rows.map(row=>[row.schemaVersion,row.id,row.partition,row.expiresAt,row.attempted,Buffer.from(row.iv).toString('hex'),Buffer.from(row.ciphertext).toString('hex')]));
function privateFile(file){const s=fs.lstatSync(file);need(s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1);}
export async function createSqliteSponsorCouponStore(options={}){
  let db;
  try {
    assertNodeVersion();
    const {dbPath,encryptionKey,maxRecords=64}=options;
    need(Object.keys(options).every(k=>['dbPath','encryptionKey','maxRecords'].includes(k)));
    need(typeof dbPath==='string'&&path.isAbsolute(dbPath)&&path.resolve(dbPath)===dbPath);
    need(encryptionKey instanceof CryptoKey&&encryptionKey.type==='secret'&&encryptionKey.algorithm.name==='AES-GCM'&&
      [128,192,256].includes(encryptionKey.algorithm.length)&&['encrypt','decrypt'].every(x=>encryptionKey.usages.includes(x)));
    need(Number.isInteger(maxRecords)&&maxRecords>=1&&maxRecords<=64);
    const directory=path.dirname(dbPath);fs.mkdirSync(directory,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(directory);need(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&fs.realpathSync(directory)===directory);
    let fd;try{fd=fs.openSync(dbPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}catch(e){if(e.code!=='EEXIST')throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
    const files=()=>{privateFile(dbPath);for(const suffix of ['-journal','-wal','-shm'])if(fs.existsSync(dbPath+suffix))privateFile(dbPath+suffix);};files();
    db=new DatabaseSync(dbPath,{timeout:5000});
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;');
    let closed=false;
    const transaction=fn=>{need(!closed);files();db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
    transaction(()=>db.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,partition TEXT NOT NULL,expires_at TEXT NOT NULL,attempted INTEGER NOT NULL CHECK(attempted IN (0,1)),iv BLOB NOT NULL,ciphertext BLOB NOT NULL);`));
    const crypt=async(mode,iv,additionalData,bytes)=>new Uint8Array(await webcrypto.subtle[mode]({name:'AES-GCM',iv,additionalData},encryptionKey,bytes));
    const checkAad=encoder.encode('AZTEC_BB_CLI_COUPON_KEY_V1:'+maxRecords),checkPlain=encoder.encode('verified-key');
    const checkIv=webcrypto.getRandomValues(new Uint8Array(12)),checkCipher=await crypt('encrypt',checkIv,checkAad,checkPlain);
    const keyCheck=transaction(()=>{
      const sizes=db.prepare('SELECT length(value) AS n FROM metadata WHERE key=?').get('key-check');need(!sizes||sizes.n===40);
      let row=db.prepare('SELECT value FROM metadata WHERE key=?').get('key-check');
      if(!row){need(db.prepare('SELECT count(*) AS n FROM records').get().n===0&&db.prepare('SELECT count(*) AS n FROM metadata').get().n===0);db.prepare('INSERT INTO metadata(key,value) VALUES(?,?)').run('key-check',Buffer.concat([checkIv,checkCipher]));row=db.prepare('SELECT value FROM metadata WHERE key=?').get('key-check');}
      need(db.prepare('SELECT count(*) AS n FROM metadata').get().n===1);return row.value;
    });
    need(keyCheck instanceof Uint8Array&&keyCheck.length===40);
    need(Buffer.from(await crypt('decrypt',keyCheck.subarray(0,12),checkAad,keyCheck.subarray(12))).equals(checkPlain));
    const storedBounds=()=>{
      need(db.prepare('SELECT count(*) AS n FROM metadata').get().n===1&&db.prepare('SELECT length(value) AS n FROM metadata WHERE key=?').get('key-check')?.n===40);
      need(db.prepare('SELECT count(*) AS n FROM records').get().n<=maxRecords);
      need(db.prepare("SELECT count(*) AS n FROM records WHERE typeof(id)<>'text' OR length(id)<>64 OR typeof(partition)<>'text' OR length(partition)<>64 OR typeof(expires_at)<>'text' OR length(expires_at)>20 OR typeof(iv)<>'blob' OR length(iv)<>12 OR typeof(ciphertext)<>'blob' OR length(ciphertext)<16 OR length(ciphertext)>8208").get().n===0);
    };
    const snapshot=()=>transaction(()=>{
      storedBounds();
      const key=db.prepare('SELECT value FROM metadata WHERE key=?').get('key-check');need(key&&Buffer.from(key.value).equals(keyCheck)&&db.prepare('SELECT count(*) AS n FROM metadata').get().n===1);
      need(db.prepare('SELECT count(*) AS n FROM records').get().n<=maxRecords);
      return db.prepare('SELECT id,partition,expires_at AS expiresAt,attempted,iv,ciphertext FROM records ORDER BY id').all().map(row=>{
        need(hex(row.id)&&hex(row.partition)&&time(row.expiresAt)&&[0,1].includes(row.attempted)&&row.iv instanceof Uint8Array&&row.iv.length===12&&row.ciphertext instanceof Uint8Array&&row.ciphertext.length>=16&&row.ciphertext.length<=8208);
        return {schemaVersion:1,...row,attempted:row.attempted===1};
      });
    });
    const readRaw=()=>{storedBounds();return db.prepare('SELECT id,partition,expires_at AS expiresAt,attempted,iv,ciphertext FROM records ORDER BY id').all().map(row=>{need([0,1].includes(row.attempted));return {schemaVersion:1,...row,attempted:row.attempted===1};});};
    async function decrypt(row){const bytes=await crypt('decrypt',row.iv,aad(row),row.ciphertext),record=JSON.parse(decoder.decode(bytes));need(record.schemaVersion===1&&record.id===row.id&&record.partition===row.partition&&record.expiresAt===row.expiresAt);return record;}
    async function authenticated(){const rows=snapshot(),records=await Promise.all(rows.map(decrypt));return {rows,records};}
    async function encrypt(record,attempted=false){
      need(record?.schemaVersion===1&&hex(record.id)&&hex(record.partition)&&time(record.expiresAt));
      const bytes=encoder.encode(JSON.stringify(record));need(bytes.length<=8192);
      // Detach caller-owned metadata before asynchronous encryption.
      const row={schemaVersion:1,id:record.id,partition:record.partition,expiresAt:record.expiresAt,attempted,iv:webcrypto.getRandomValues(new Uint8Array(12))};
      row.ciphertext=await crypt('encrypt',row.iv,aad(row),bytes);return row;
    }
    function unchanged(rows){storedBounds();const key=db.prepare('SELECT value FROM metadata WHERE key=?').get('key-check');return key&&Buffer.from(key.value).equals(keyCheck)&&db.prepare('SELECT count(*) AS n FROM metadata').get().n===1&&fingerprint(readRaw())===fingerprint(rows);}
    function clean(rows,now){need((typeof now==='string'||typeof now==='bigint'||(typeof now==='number'&&Number.isSafeInteger(now)))&&time(String(now)));const n=BigInt(now);for(const row of rows)if(BigInt(row.expiresAt)<n)db.prepare('DELETE FROM records WHERE id=?').run(row.id);return rows.filter(row=>BigInt(row.expiresAt)>=n);}
    const safe=fn=>async(...args)=>{try{need(!closed);return await fn(...args);}catch{throw new CouponStoreError();}};
    const verified=await authenticated();transaction(()=>need(unchanged(verified.rows)));
    return Object.freeze({
      pending:safe(async({partition,nowSeconds})=>{need(hex(partition));const {rows,records}=await authenticated();return transaction(()=>{need(unchanged(rows));const retained=clean(rows,nowSeconds),pending=retained.filter(row=>row.partition===partition&&!row.attempted);need(pending.length>0||retained.length<maxRecords);return pending.map(row=>records[rows.findIndex(r=>r.id===row.id)]);});}),
      put:safe(async(record,{nowSeconds})=>{const row=await encrypt(record),{rows}=await authenticated();return transaction(()=>{need(unchanged(rows));const retained=clean(rows,nowSeconds);need(!retained.some(r=>r.id===row.id)&&retained.length<maxRecords&&BigInt(row.expiresAt)>=BigInt(nowSeconds));db.prepare('INSERT INTO records(id,partition,expires_at,attempted,iv,ciphertext) VALUES(?,?,?,?,?,?)').run(row.id,row.partition,row.expiresAt,0,row.iv,row.ciphertext);return true;});}),
      markAttempted:safe(async id=>{need(hex(id));const {rows,records}=await authenticated(),i=rows.findIndex(r=>r.id===id);if(i<0||rows[i].attempted)return false;const after=await encrypt(records[i],true);return transaction(()=>{if(!unchanged(rows))return false;db.prepare('UPDATE records SET attempted=1,iv=?,ciphertext=? WHERE id=? AND attempted=0').run(after.iv,after.ciphertext,id);return true;});}),
      close:()=>{if(!closed){db.close();closed=true;}},
    });
  }catch{if(db)try{db.close();}catch{}throw new CouponStoreError();}
}
