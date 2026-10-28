/** Daily encrypted off-host backup plus an actual download/restore check.
 * No directory discovery, raw AWS output, service restart or signer invocation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createBackup,restoreBackup} from './backup.mjs';
import {pruneAnalytics} from './prune-analytics.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export const BACKUP_NAMES=Object.freeze({
 core:['configuration/application.json','configuration/wallet.json','configuration/funding-relay.json','configuration/prover.json','configuration/moderator.json','configuration/operations.json','configuration/release.json','credentials/moderator.json','credentials/funding-relayer.json','analytics.sqlite'],
 bok:['configuration/bok.json','credentials/bok-operator.json','credentials/github-app.pem','credentials/model-provider.env'],
});
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const absolute=v=>typeof v==='string'&&/^\/[A-Za-z0-9/_.-]+$/.test(v)&&path.resolve(v)===v;
const failed=code=>Object.assign(Error(code),{code});
export function validateBackupJobConfig(c){
 if(!exact(c,['schemaVersion','role','region','bucket','prefix','keyParameter','stateFile','workDirectory','files'])||c.schemaVersion!==1||typeof c.role!=='string'||!Object.hasOwn(BACKUP_NAMES,c.role)||typeof c.region!=='string'||!/^[-a-z0-9]+-\d$/.test(c.region)||typeof c.bucket!=='string'||!/^[-a-z0-9]{3,63}$/.test(c.bucket)||c.prefix!=='rolling-ops/'+c.role||c.keyParameter!=='/rolling/operations/backup-key/'+c.role||!absolute(c.stateFile)||c.workDirectory!=='/run/rolling-ops-backup-'+c.role||!Array.isArray(c.files)||!c.files.length||c.files.length>BACKUP_NAMES[c.role].length)throw failed('BACKUP_CONFIG');
 const names=new Set(),paths=new Set();
 for(const item of c.files){
  if(!exact(item,['name','path','kind'])||!BACKUP_NAMES[c.role].includes(item.name)||names.has(item.name)||paths.has(item.path)||!absolute(item.path)||item.kind!==(item.name==='analytics.sqlite'?'sqlite':'file')||item.path===c.stateFile||item.path.startsWith(c.workDirectory+'/'))throw failed('BACKUP_CONFIG');
  names.add(item.name);paths.add(item.path);
 }
 if(c.role==='core'&&!names.has('analytics.sqlite'))throw failed('BACKUP_CONFIG');
 return c;
}
export async function readBackupJobConfig(file){
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size>16384)throw failed('BACKUP_CONFIG');
 return validateBackupJobConfig(JSON.parse(await fs.readFile(file,'utf8')));
}
export async function awsCommand(args,{region}){
 // The installed hosts already have boto3. Requests go through stdin, and the
 // separate key response stays in this captured pipe, never logs or arguments.
 return new Promise((resolve,reject)=>{
  const child=spawn('/usr/bin/python3',[fileURLToPath(new URL('./backup-cloud.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});let bytes=0,chunks=[],settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(failed('BACKUP_CLOUD_UNAVAILABLE')):resolve(result);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(true);},90000);
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){child.kill('SIGKILL');finish(true);}else chunks.push(chunk);});
  child.stderr.resume();child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));
  child.on('close',code=>{if(code!==0)return finish(true);try{finish(false,JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{finish(true);}});
  child.stdin.end(JSON.stringify({region,args}));
 });
}
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export function projectBackupStatus(value){return {configured:true,lastSuccessAt:date(value?.lastSuccessAt),lastVerifiedRestoreAt:date(value?.lastVerifiedRestoreAt),lastOutcome:['uploaded','verified','backup-failed','restore-failed','cleanup-failed'].includes(value?.lastOutcome)?value.lastOutcome:'unknown'};}
async function previousStatus(file){try{return projectBackupStatus(JSON.parse(await fs.readFile(file,'utf8')));}catch{return projectBackupStatus();}}
async function writeStatus(file,value){
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();
 try{await fs.writeFile(temp,JSON.stringify(value)+'\n',{mode:0o600,flag:'wx'});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
function checkBucket(access,lifecycle,versioning,prefix){
 const block=access?.PublicAccessBlockConfiguration;
 if(!['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].every(k=>block?.[k]===true))throw failed('BACKUP_BUCKET_PRIVACY');
 const rules=lifecycle?.Rules;
 if(!Array.isArray(rules)||!rules.some(r=>r.Status==='Enabled'&&(r.Filter?.Prefix??r.Prefix)===prefix+'/'&&r.Expiration?.Days===7))throw failed('BACKUP_RETENTION');
 if(versioning?.Status!==undefined)throw failed('BACKUP_RETENTION');
}
/** The cloud adapter is injected only for local tests. Installed CLI uses AWS. */
export async function runBackupJob(c,{aws=awsCommand,now=Date.now,workRoot}={}){
 validateBackupJobConfig(c);await fs.mkdir(path.dirname(c.stateFile),{recursive:true,mode:0o700});
 const root=workRoot??c.workDirectory;await fs.mkdir(root,{recursive:true,mode:0o700});
 if(await fs.realpath(root)!==path.resolve(root)||(await fs.stat(root)).mode&0o077)throw failed('BACKUP_WORK_DIRECTORY');
 const lockFile=path.join(root,'job.lock');let lock;try{lock=await fs.open(lockFile,'wx',0o600);}catch{throw failed('BACKUP_BUSY');}
 const status={schemaVersion:1,...await previousStatus(c.stateFile),lastAttemptAt:new Date(now()).toISOString(),lastOutcome:'running'};
 let work,uploaded=false;
 try{
  // Retention runs before snapshotting, even with no visitors or dashboard reads.
  const analytics=c.files.find(v=>v.name==='analytics.sqlite');if(analytics)await pruneAnalytics(analytics.path,{now});
  const call=args=>aws(args,{region:c.region});
  checkBucket(await call(['s3api','get-public-access-block','--bucket',c.bucket]),await call(['s3api','get-bucket-lifecycle-configuration','--bucket',c.bucket]),await call(['s3api','get-bucket-versioning','--bucket',c.bucket]),c.prefix);
  work=await fs.mkdtemp(path.join(root,'run-'));
  const parameter=await call(['ssm','get-parameter','--name',c.keyParameter,'--with-decryption']);
  const encoded=parameter?.Parameter?.Value;if(parameter?.Parameter?.Type!=='SecureString'||typeof encoded!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(encoded))throw failed('BACKUP_KEY');
  const key=Buffer.from(encoded,'base64');if(key.length!==32)throw failed('BACKUP_KEY');
  const keyFile=path.join(work,'key');await fs.writeFile(keyFile,key,{mode:0o600,flag:'wx'});key.fill(0);
  const output=path.join(work,'archive.rbackup'),created=await createBackup({files:c.files,keyFile,output,now:now()});
  const object=c.prefix+'/'+new Date(now()).toISOString().replaceAll(':','-')+'-'+randomUUID()+'.rbackup';
  await call(['s3api','put-object','--bucket',c.bucket,'--key',object,'--body',output,'--server-side-encryption','AES256']);
  uploaded=true;status.lastSuccessAt=new Date(now()).toISOString();status.lastOutcome='uploaded';await writeStatus(c.stateFile,status);
  const downloaded=path.join(work,'downloaded.rbackup');
  await call(['s3api','get-object','--bucket',c.bucket,'--key',object,downloaded]);await fs.chmod(downloaded,0o600);
  if(hash(await fs.readFile(downloaded))!==created.sha256)throw failed('BACKUP_DOWNLOAD_MISMATCH');
  const restored=await restoreBackup({archive:downloaded,keyFile,destination:path.join(work,'restore'),now:now()});
  if(restored.sha256!==created.sha256||restored.fileCount!==created.fileCount)throw failed('BACKUP_RESTORE_MISMATCH');
  status.lastVerifiedRestoreAt=restored.lastVerifiedRestoreAt;status.lastOutcome='verified';
  await writeStatus(c.stateFile,status);return status;
 }catch{
  status.lastOutcome=uploaded?'restore-failed':'backup-failed';await writeStatus(c.stateFile,status);
  throw failed(uploaded?'BACKUP_RESTORE_FAILED':'BACKUP_FAILED');
 }finally{
  try{if(work)await fs.rm(work,{recursive:true,force:true});}
  catch{status.lastOutcome='cleanup-failed';await writeStatus(c.stateFile,status);throw failed('BACKUP_CLEANUP_FAILED');}
  finally{await lock.close();await fs.rm(lockFile,{force:true});}
 }
}
const invokedFile=process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null);
if(invokedFile&&import.meta.url===pathToFileURL(invokedFile).href){
 try{if(process.argv.length!==3)throw failed('BACKUP_USAGE');const status=await runBackupJob(await readBackupJobConfig(process.argv[2]));process.stdout.write(JSON.stringify(projectBackupStatus(status))+'\n');}
 catch(e){process.stderr.write((/^BACKUP_[A-Z_]+$/.test(e.code??'')?e.code:'BACKUP_FAILED')+'\n');process.exitCode=1;}
}
