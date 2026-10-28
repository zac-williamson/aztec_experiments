import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,readFile,stat,symlink,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createBackup,restoreBackup} from './backup.mjs';
async function fixture(t){const root=await mkdtemp(join(await realpath(tmpdir()),'rolling-ops-backup-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const keyFile=join(root,'key');await writeFile(keyFile,randomBytes(32),{mode:0o600});const source=join(root,'config');await writeFile(source,'PRIVATE_CONFIG_SENTINEL',{mode:0o600});return {root,keyFile,source,output:join(root,'encrypted.backup')};}
test('encrypted config backup restores exact bytes without exposing paths or text',async t=>{
 const f=await fixture(t),record=await createBackup({...f,files:[{name:'config/operator.json',path:f.source,kind:'file'}]});
 const bytes=await readFile(f.output);assert(!bytes.includes(Buffer.from('PRIVATE_CONFIG_SENTINEL')));assert(!JSON.stringify(record).includes(f.source));assert.equal((await stat(f.output)).mode&0o077,0);
 const destination=join(f.root,'restored'),restore=await restoreBackup({archive:f.output,keyFile:f.keyFile,destination});
 assert.equal(await readFile(join(destination,'config/operator.json'),'utf8'),'PRIVATE_CONFIG_SENTINEL');assert.equal(restore.fileCount,1);assert.equal(restore.sha256,record.sha256);
 await assert.rejects(restoreBackup({archive:f.output,keyFile:f.keyFile,destination}));
});
test('SQLite backup includes committed WAL state and restores a usable database',async t=>{
 const f=await fixture(t),path=join(f.root,'live.sqlite'),db=new DatabaseSync(path);
 t.after(()=>db.close());db.exec('PRAGMA journal_mode=WAL; CREATE TABLE observations (value INTEGER); INSERT INTO observations VALUES (42)');
 await createBackup({...f,files:[{name:'analytics.sqlite',path,kind:'sqlite'}]});
 const destination=join(f.root,'restored');await restoreBackup({archive:f.output,keyFile:f.keyFile,destination});
 const restored=new DatabaseSync(join(destination,'analytics.sqlite'),{readOnly:true});try{assert.equal(restored.prepare('SELECT value FROM observations').get().value,42);}finally{restored.close();}
});
test('wrong key and corruption fail before creating restore destination',async t=>{
 const f=await fixture(t);await createBackup({...f,files:[{name:'config',path:f.source,kind:'file'}]});
 const bytes=await readFile(f.output);bytes[bytes.length-1]^=1;await writeFile(f.output,bytes);
 const destination=join(f.root,'restored');await assert.rejects(restoreBackup({archive:f.output,keyFile:f.keyFile,destination}),/authentication/);await assert.rejects(access(destination));
});
test('key inclusion, traversal names and symbolic-link inputs are rejected',async t=>{
 const f=await fixture(t);await symlink(f.source,join(f.root,'link'));
 for(const item of [{name:'../escape',path:f.source,kind:'file'},{name:'key',path:f.keyFile,kind:'file'},{name:'link',path:join(f.root,'link'),kind:'file'}])await assert.rejects(createBackup({...f,files:[item]}));
});
