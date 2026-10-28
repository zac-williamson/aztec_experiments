/** Encrypted, explicit-file operational backups. No discovery of credential directories. */
import {readFile,writeFile,mkdir,open,lstat,realpath,rm,mkdtemp} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const MAGIC=Buffer.from('ROLLING-OPS-BACKUP-1\n'),MAX_FILE=32*1024*1024,MAX_TOTAL=64*1024*1024;
const hash = data=>createHash('sha256').update(data).digest('hex');
const safeName = name=>typeof name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,160}$/.test(name)&&!name.split('/').some(x=>!x||x==='.'||x==='..');

async function privateKey(path) {
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077)!==0)throw Error('Backup key must be a private regular file');
  const data=await readFile(path);if(data.length!==32)throw Error('Backup key must contain 32 random bytes');return data;
}
async function regularBytes(path) {
  if(await realpath(path)!==resolve(path))throw Error('Backup paths cannot contain symbolic links');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await handle.stat();if(!before.isFile()||before.size>MAX_FILE)throw Error('Invalid backup input');
    const data=await handle.readFile(),after=await handle.stat();
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||data.length!==before.size)throw Error('Backup input changed during snapshot');
    return data;
  }finally{await handle.close();}
}
async function sqliteBytes(path) {
  if(await realpath(path)!==resolve(path))throw Error('Backup paths cannot contain symbolic links');
  const info=await lstat(path);if(!info.isFile()||info.size>MAX_FILE)throw Error('Invalid SQLite backup input');
  const {DatabaseSync,backup}=await import('node:sqlite');
  const work=await mkdtemp(join(await realpath(tmpdir()),'rolling-ops-db-'));const dest=join(work,'snapshot.sqlite');let db;
  try {
    db=new DatabaseSync(path,{readOnly:true});await backup(db,dest);db.close();db=null;
    await writeFile(dest,await readFile(dest),{mode:0o600});
    const verify=new DatabaseSync(dest,{readOnly:true});
    try{if(verify.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite snapshot failed integrity check');}finally{verify.close();}
    return await regularBytes(dest);
  }finally{db?.close();await rm(work,{recursive:true,force:true});}
}

export async function createBackup({files,keyFile,output,now=Date.now()}={}) {
  if(!Array.isArray(files)||files.length<1||files.length>64||!Number.isSafeInteger(now))throw Error('Invalid backup specification');
  const names=new Set(),records=[];let total=0;
  for(const item of files) {
    if(!safeName(item.name)||names.has(item.name)||!['file','sqlite'].includes(item.kind)||typeof item.path!=='string'||resolve(item.path)===resolve(keyFile))throw Error('Invalid backup item');
    names.add(item.name);const data=await(item.kind==='sqlite'?sqliteBytes(item.path):regularBytes(item.path));
    total+=data.length;if(total>MAX_TOTAL)throw Error('Backup size limit exceeded');
    records.push({name:item.name,kind:item.kind,size:data.length,sha256:hash(data),data:data.toString('base64')});
  }
  const key=await privateKey(keyFile),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(MAGIC);
  const plain=Buffer.from(JSON.stringify({schemaVersion:1,createdAt:new Date(now).toISOString(),files:records}));
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const archive=Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  await writeFile(output,archive,{mode:0o600,flag:'wx'});
  return {schemaVersion:1,lastSuccessAt:new Date(now).toISOString(),fileCount:records.length,plaintextBytes:total,archiveBytes:archive.length,sha256:hash(archive)};
}

export async function restoreBackup({archive,keyFile,destination,now=Date.now()}={}) {
  const encrypted=await regularBytesLarge(archive),key=await privateKey(keyFile);
  if(!encrypted.subarray(0,MAGIC.length).equals(MAGIC)||encrypted.length<MAGIC.length+29)throw Error('Invalid encrypted backup');
  const offset=MAGIC.length,decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(offset,offset+12));
  decipher.setAAD(MAGIC);decipher.setAuthTag(encrypted.subarray(offset+12,offset+28));
  let record;
  try{record=JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(offset+28)),decipher.final()]));}catch{throw Error('Backup authentication failed');}
  if(record.schemaVersion!==1||!Array.isArray(record.files)||record.files.length<1||record.files.length>64||!Number.isFinite(Date.parse(record.createdAt)))throw Error('Invalid backup manifest');
  const names=new Set(),files=[];let total=0;
  for(const item of record.files) {
    if(!safeName(item.name)||names.has(item.name)||!['file','sqlite'].includes(item.kind)||typeof item.data!=='string'||item.data.length>Math.ceil(MAX_FILE*4/3)+4)throw Error('Invalid backup member');
    const data=Buffer.from(item.data,'base64');total+=data.length;
    if(data.length!==item.size||data.length>MAX_FILE||total>MAX_TOTAL||hash(data)!==item.sha256)throw Error('Backup member verification failed');
    names.add(item.name);files.push({name:item.name,kind:item.kind,data});
  }
  // A new destination prevents overwriting live state. Authentication completes before creation.
  await mkdir(destination,{mode:0o700});
  try {
    for(const item of files) {
      const path=join(destination,item.name);await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,item.data,{mode:0o600,flag:'wx'});
      if(item.kind==='sqlite') {
        const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true});
        try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Restored SQLite integrity failed');}finally{db.close();}
      }
    }
  }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
  return {schemaVersion:1,lastVerifiedRestoreAt:new Date(now).toISOString(),fileCount:files.length,bytes:total,sha256:hash(encrypted)};
}

async function regularBytesLarge(path) {
  if(await realpath(path)!==resolve(path))throw Error('Backup paths cannot contain symbolic links');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await fd.stat();if(!stat.isFile()||stat.size>MAX_TOTAL*1.5)throw Error('Invalid backup size');return await fd.readFile();}finally{await fd.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [command,configPath]=process.argv.slice(2);
  if(!['create','verify-restore'].includes(command)||!configPath)throw Error('Usage: backup.mjs create|verify-restore PRIVATE_CONFIG_FILE');
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const report=command==='create'?await createBackup(config):await restoreBackup(config);
  process.stdout.write(JSON.stringify(report)+'\n');
}
