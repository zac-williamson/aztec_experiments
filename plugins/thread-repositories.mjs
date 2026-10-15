import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileState} from './operations.mjs';
const exec=promisify(execFile),sha=value=>createHash('sha256').update(value).digest('hex');
const revision=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
/** Trusted fixed Git operations only. Never use this port to execute generated
 * programs. No developer environment, Git configuration or credentials propagate.
 */
export const repositoryGit=(args,options={})=>exec('/usr/bin/git',['-c','core.hooksPath=/dev/null','-c','core.fsync=all','-c','credential.helper=',...args],{
 timeout:60000,maxBuffer:4*1024*1024,...options,env:{PATH:'/usr/bin:/bin',HOME:'/var/empty',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_AUTHOR_NAME:'Bok',GIT_AUTHOR_EMAIL:'bok@invalid',GIT_COMMITTER_NAME:'Bok',GIT_COMMITTER_EMAIL:'bok@invalid',LC_ALL:'C'}});
/** One manager under the existing hosted lease. Its queues serialize a thread,
 * while different threads have independent repositories and invocation drafts.
 * This stores source revisions only; the paid-call journal remains authoritative
 * for provider recovery and must never be replayed because a draft exists.
 */
export function threadRepositories({directory,namespace,lease,git=repositoryGit,validateRevision,maxBytes=64*1024*1024,maxRevisions=1000,startEmpty=false,onAccepted,connections}){
 assert(path.isAbsolute(directory)&&typeof namespace==='string'&&namespace.length>0&&typeof lease?.assertHeld==='function');
 assert(Number.isSafeInteger(maxBytes)&&maxBytes>=1024&&Number.isSafeInteger(maxRevisions)&&maxRevisions>0);
 assert(validateRevision===undefined||typeof validateRevision==='function');
 assert(connections===undefined||(typeof connections.connectionFor==='function'&&typeof connections.readConnected==='function'));assert.equal(typeof startEmpty,'boolean');assert(onAccepted===undefined||typeof onAccepted==='function');
 const queues=new Map();
 async function size(directory){let total=0;for(const entry of await fs.readdir(directory)){const file=path.join(directory,entry),stat=await fs.lstat(file);assert(!stat.isSymbolicLink(),'Repository symlink rejected');if(stat.isDirectory())total+=await size(file);else{assert(stat.isFile());total+=stat.size;}assert(total<=maxBytes,'Thread storage limit reached');}return total;}
 return Object.freeze({async open({threadId,invocationId,repository}){
  assert(/^0x[0-9a-f]{64}$/.test(threadId)&&/^0x[0-9a-f]{64}$/.test(invocationId));
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository));
  const key=sha(namespace+'\0'+threadId),previous=queues.get(key)||Promise.resolve();let unlock;
  const turn=new Promise(resolve=>{unlock=resolve;});queues.set(key,turn);await previous;
  let draft,closed=false;
  const release=()=>{if(queues.get(key)===turn)queues.delete(key);unlock();};
  try{
   await lease.assertHeld();await fs.mkdir(directory,{recursive:true,mode:0o700});assert.equal(await fs.realpath(directory),directory);assert.equal((await fs.stat(directory)).mode&0o777,0o700);
   const root=path.join(directory,key);await fs.mkdir(root,{mode:0o700,recursive:true});assert.equal(await fs.realpath(root),root);
   const store=await fileState(path.join(root,'revisions.json')),repo=path.join(root,'repository.git');let state=store.read();
   const connection=connections?.connectionFor(threadId)??null;
   if(connection)repository=connection.fullName;
   const identity={namespace,threadId,repository,startEmpty,...(connection?{connection}:{})};
   if(!state.identity){
    await git(['init','--bare',repo]);await store.write({identity,acceptedRevision:null,operations:{}});state=store.read();
   }
   assert.deepEqual(state.identity,identity);assert.equal(await fs.realpath(repo),repo);
   const head=async()=>{const r=await git(['for-each-ref','--format=%(objectname)','refs/heads/accepted'],{cwd:repo});return r.stdout.trim()||null;};
   // Recover only an already advanced exact ref after interrupted acknowledgement.
   // A prepared but unapplied intent stays explicit; no ambiguous write replay.
   for(const [id,record] of Object.entries(state.operations))if(record.status==='prepared'){
    assert(revision(record.producedRevision));const current=await head();
    if(current!==record.producedRevision)throw Error('Repository acceptance requires reconciliation');
    await store.write({...state,acceptedRevision:current,operations:{...state.operations,[id]:{...record,status:'accepted'}}});state=store.read();
   }
   assert.equal(await head(),state.acceptedRevision,'Accepted repository ref changed');
   const receipt=record=>({repositoryId:key,threadId,invocationId:record.invocationId,readRevision:record.readRevision,acceptedRevision:record.producedRevision,validation:record.validation,...(connection?{connection:structuredClone(connection)}:{})});
   async function publish(record){
    if(!onAccepted||record.publication?.status==='complete')return record.publication?.result;
    await lease.assertHeld();const result=await onAccepted(receipt(record));
    await store.write({...state,operations:{...state.operations,[record.invocationId]:{...record,publication:{status:'complete',result}}}});state=store.read();return result;
   }
   // Trusted publication/mirror capabilities reconcile their durable intents;
   // never re-enter provider work or retransmit an uncertain external write.
   for(const record of Object.values(state.operations))if(record.status==='accepted'&&record.publication?.status==='pending')await publish(record);
   if(state.operations[invocationId])throw Error('Invocation already has an accepted revision');
   assert(Object.keys(state.operations).length<maxRevisions,'Thread revision limit reached');
   const readRevision=state.acceptedRevision;draft=await fs.mkdtemp(path.join(root,'draft-'));const work=path.join(draft,'repository');let accepted=null,acceptStarted=false;
   let checked=null;
   const prepare=async(forceCheck=false)=>{
    assert(!closed);await lease.assertHeld();
    const parent=(await git(['rev-parse','HEAD'],{cwd:work})).stdout.trim();assert(revision(parent));if(readRevision)assert.equal(parent,readRevision);
    const used=await size(root),scratch=await size(draft);assert(used+scratch<=maxBytes,'Thread storage limit reached');
    await git(['add','--all','--force','--','.'],{cwd:work});const tree=(await git(['write-tree'],{cwd:work})).stdout.trim();assert(revision(tree));
    if(checked?.tree===tree&&checked.parent===parent&&(!forceCheck||checked.validation))return checked;
    checked=null;const produced=(await git(['commit-tree',tree,'-p',parent,'-m',`Bok thread invocation ${invocationId}`],{cwd:work})).stdout.trim();assert(revision(produced));
    const unchanged=(startEmpty||connection)&&tree===(await git(['rev-parse',parent+'^{tree}'],{cwd:work})).stdout.trim();
    const validation=(!unchanged||forceCheck)&&validateRevision?await validateRevision({sourceDirectory:work,revision:produced}):null;
    if((!unchanged||forceCheck)&&validateRevision){assert(validation?.passed===true&&validation.revision===produced&&/^[0-9a-f]{64}$/.test(validation.sourceDigest),'Isolated revision validation failed');await git(['diff','--quiet',produced,'--'],{cwd:work});}
    checked={tree,parent,produced,validation,unchanged};return checked;
   };
   return Object.freeze({work,repositoryPath:repo,readRevision,startEmpty,connection,
    initialSource:connection?async()=>{const source=await connections.readConnected(threadId);assert.deepEqual(source.mapping,connection);return source.files;}:undefined,
    async check(){assert(!acceptStarted);assert(validateRevision,'Isolated revision validation unavailable');return (await prepare(true)).validation;},
    async accept(){
     assert(!closed);if(accepted)return accepted;assert(!acceptStarted,'Acceptance already attempted; reopen and reconcile');acceptStarted=true;await lease.assertHeld();
     const {produced,validation,unchanged}=await prepare();
     if(unchanged)return null;
     // Import objects before persisting the intended CAS. The ref is internal and
     // never selects a source revision for publication by itself.
     const importedRef=`refs/invocations/${invocationId.slice(2)}`;
     await git(['fetch','--no-tags','--update-shallow',work,`${produced}:${importedRef}`],{cwd:repo});
     assert.equal((await git(['rev-parse','--verify',importedRef],{cwd:repo})).stdout.trim(),produced,'Produced revision was not imported');
     await git(['fsck','--connectivity-only','--no-dangling'],{cwd:repo});
     const record={threadId,invocationId,readRevision,producedRevision:produced,validation,status:'prepared',...(onAccepted?{publication:{status:'pending'}}:{})};
     await store.write({...state,operations:{...state.operations,[invocationId]:record}});state=store.read();
     await lease.assertHeld();await git(['update-ref','refs/heads/accepted',produced,readRevision||'0'.repeat(40)],{cwd:repo});
     await store.write({...state,acceptedRevision:produced,operations:{...state.operations,[invocationId]:{...record,status:'accepted'}}});state=store.read();
     const publication=await publish(state.operations[invocationId]);
     accepted=Object.freeze({...receipt(record),...(publication?{publication}:{})});return accepted;
    },
    async close(){if(closed)return;closed=true;try{await fs.rm(draft,{recursive:true,force:true});}finally{release();}}
   });
  }catch(error){release();throw error;}
 }});
}
