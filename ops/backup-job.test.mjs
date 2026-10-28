import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {runBackupJob,validateBackupJobConfig,projectBackupStatus} from './backup-job.mjs';
import {backupCloudConfiguration,backupUnits} from './backup-deployment.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'rolling-backup-job-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const stateFile=path.join(root,'status.json'),source=path.join(root,'service.json');await fs.writeFile(source,'PRIVATE_CONFIG_SENTINEL',{mode:0o600});
 const c={schemaVersion:1,role:'bok',region:'us-east-1',bucket:'rolling-backup-example',prefix:'rolling-ops/bok',keyParameter:'/rolling/operations/backup-key/bok',stateFile,workDirectory:'/run/rolling-ops-backup-bok',files:[{name:'configuration/bok.json',path:source,kind:'file'}]};
 const objects=new Map(),calls=[],key=randomBytes(32).toString('base64');let corrupt=false;
 const aws=async args=>{calls.push(args.slice(0,2));
  if(args[1]==='get-public-access-block')return {PublicAccessBlockConfiguration:{BlockPublicAcls:true,IgnorePublicAcls:true,BlockPublicPolicy:true,RestrictPublicBuckets:true}};
  if(args[1]==='get-bucket-lifecycle-configuration')return {Rules:[{Status:'Enabled',Filter:{Prefix:c.prefix+'/'},Expiration:{Days:7}}]};
  if(args[1]==='get-bucket-versioning')return {};
  if(args[1]==='get-parameter')return {Parameter:{Type:'SecureString',Value:key}};
  const object=args[args.indexOf('--key')+1];
  if(args[1]==='put-object'){objects.set(object,await fs.readFile(args[args.indexOf('--body')+1]));return {};}
  if(args[1]==='get-object'){const b=Buffer.from(objects.get(object));if(corrupt)b[b.length-1]^=1;await fs.writeFile(args.at(-1),b);return {};}
  throw Error('Unexpected command');
 };
 return {c,root,source,key,objects,calls,aws,workRoot:path.join(root,'work'),corrupt(){corrupt=true;}};
}
test('daily job encrypts, uploads, downloads and restores before reporting success, then removes plaintext',async t=>{
 const f=await fixture(t),result=await runBackupJob(f.c,{aws:f.aws,workRoot:f.workRoot});
 assert.equal(result.lastOutcome,'verified');assert(result.lastSuccessAt);assert(result.lastVerifiedRestoreAt);
 assert.equal(f.objects.size,1);for(const bytes of f.objects.values()){assert(!bytes.includes(Buffer.from('PRIVATE_CONFIG_SENTINEL')));assert(!bytes.includes(Buffer.from(f.key)));}
 assert(f.calls.some(c=>c[1]==='get-object'));assert.deepEqual(await fs.readdir(f.workRoot),[]);
 assert(!JSON.stringify(result).includes(f.source));assert(!JSON.stringify(result).includes(f.key));
 assert.deepEqual(Object.keys(projectBackupStatus({...result,secret:'PRIVATE'})),['configured','lastSuccessAt','lastVerifiedRestoreAt','lastOutcome']);
});
test('corrupt off-host download reports failed restore and preserves prior verification time',async t=>{
 const f=await fixture(t),prior='2026-10-20T00:00:00.000Z';await fs.writeFile(f.c.stateFile,JSON.stringify({lastVerifiedRestoreAt:prior}));f.corrupt();
 await assert.rejects(runBackupJob(f.c,{aws:f.aws,workRoot:f.workRoot}),{code:'BACKUP_RESTORE_FAILED'});
 const status=JSON.parse(await fs.readFile(f.c.stateFile));assert.equal(status.lastOutcome,'restore-failed');assert(status.lastSuccessAt);assert.equal(status.lastVerifiedRestoreAt,prior);assert.deepEqual(await fs.readdir(f.workRoot),[]);
});
test('bucket privacy or seven-day retention failure stops before reading key or uploading',async t=>{
 for(const missing of ['get-public-access-block','get-bucket-lifecycle-configuration']){
  const f=await fixture(t),aws=async args=>args[1]===missing?{}:f.aws(args);
  await assert.rejects(runBackupJob(f.c,{aws,workRoot:f.workRoot}),{code:'BACKUP_FAILED'});assert.equal(f.objects.size,0);assert(!f.calls.some(c=>c[1]==='get-parameter'));
 }
 const f=await fixture(t),aws=async args=>args[1]==='get-bucket-versioning'?{Status:'Enabled'}:f.aws(args);
 await assert.rejects(runBackupJob(f.c,{aws,workRoot:f.workRoot}),{code:'BACKUP_FAILED'});assert.equal(f.objects.size,0);
});
test('core backup prunes traffic-free analytics before snapshot and verifies restored SQLite',async t=>{
 const f=await fixture(t),dbPath=path.join(f.root,'analytics.sqlite'),db=new DatabaseSync(dbPath);
 db.exec("CREATE TABLE analytics_daily(day TEXT,event TEXT,dimension TEXT,value TEXT,bucket TEXT,n INTEGER,PRIMARY KEY(day,event,dimension,value,bucket)); INSERT INTO analytics_daily VALUES ('2025-01-01','visit','total','all','none',7)");db.close();
 f.c.role='core';f.c.prefix='rolling-ops/core';f.c.keyParameter='/rolling/operations/backup-key/core';f.c.workDirectory='/run/rolling-ops-backup-core';f.c.files=[{name:'analytics.sqlite',path:dbPath,kind:'sqlite'}];
 const out=await runBackupJob(f.c,{aws:f.aws,workRoot:f.workRoot,now:()=>Date.parse('2026-10-28T00:00:00Z')});assert.equal(out.lastOutcome,'verified');
 const check=new DatabaseSync(dbPath,{readOnly:true});try{assert.equal(check.prepare('SELECT count(*) n FROM analytics_daily').get().n,0);}finally{check.close();}
});
test('configuration cannot turn explicit backups into cache discovery or key storage',async t=>{
 const f=await fixture(t);
 for(const patch of [{extra:'private'},{prefix:'all'},{keyParameter:'/elsewhere'},{files:[{name:'public-index.sqlite',path:f.source,kind:'sqlite'}]},{files:[{name:'configuration/bok.json',path:f.source,kind:'file'},{name:'credentials/bok-operator.json',path:f.source,kind:'file'}]}])assert.throws(()=>validateBackupJobConfig({...f.c,...patch}),{code:'BACKUP_CONFIG'});
 await fs.mkdir(f.workRoot,{mode:0o700});await fs.writeFile(path.join(f.workRoot,'job.lock'),'');await assert.rejects(runBackupJob(f.c,{aws:f.aws,workRoot:f.workRoot}),{code:'BACKUP_BUSY'});assert.equal(f.calls.length,0);
});
test('deployment grants one role only its archive prefix and separate key; timers have no signer or lifecycle permissions',()=>{
 const c=backupCloudConfiguration({bucket:'rolling-backup-example',region:'us-east-1',accountId:'123456789012',role:'core',kmsKeyArn:'arn:aws:kms:us-east-1:123456789012:key/test-key'});
 assert(c.lifecycle.Rules.every(r=>r.Expiration.Days===7));assert.equal(c.rolePolicy.Statement[0].Resource,'arn:aws:s3:::rolling-backup-example/rolling-ops/core/*');assert(!JSON.stringify(c.rolePolicy).includes('PutParameter'));assert(!JSON.stringify(c.rolePolicy).includes('DeleteObject'));
 const units=backupUnits({role:'core',nodeBinary:'/opt/node/bin/node',codeDirectory:'/opt/rolling-ops/current',configFile:'/etc/rolling-ops/core-backup.json',analyticsDirectory:'/var/lib/rolling-ops'});
 assert(units.timer.includes('Persistent=true'));assert(units.service.includes('RuntimeDirectoryMode=0700'));assert(units.service.includes('ProtectSystem=strict'));assert(!units.service.includes('restart'));
});
test('backup job invoked through a release symlink executes and fails closed without configuration',async t=>{
 const f=await fixture(t),link=path.join(f.root,'backup-job.mjs');await fs.symlink(fileURLToPath(new URL('./backup-job.mjs',import.meta.url)),link);
 await assert.rejects(promisify(execFile)(process.execPath,[link]),e=>e.code===1&&e.stderr==='BACKUP_USAGE\n');
});
test('retention CLI invoked through a release symlink actually removes expired rows',async t=>{
 const f=await fixture(t),link=path.join(f.root,'prune.mjs'),dbPath=path.join(f.root,'analytics.sqlite');await fs.symlink(fileURLToPath(new URL('./prune-analytics.mjs',import.meta.url)),link);
 const db=new DatabaseSync(dbPath);db.exec("CREATE TABLE analytics_daily(day TEXT,event TEXT,dimension TEXT,value TEXT,bucket TEXT,n INTEGER,PRIMARY KEY(day,event,dimension,value,bucket)); INSERT INTO analytics_daily VALUES ('2020-01-01','visit','total','all','none',1)");db.close();
 const result=await promisify(execFile)(process.execPath,[link,dbPath]);assert.equal(JSON.parse(result.stdout).removedRows,1);
});
