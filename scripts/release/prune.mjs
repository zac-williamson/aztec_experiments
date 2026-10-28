// Root timer only: fixed paths, no candidate code/commands, no config-supplied
// deletion root. Keep the actual live/stage targets and last successful rollback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {failure} from './bundle.mjs';
export async function pruneReleases({directory,liveLink,stageLink,stateFile,lockHeld=false}){
 if(!lockHeld)try{await fs.access(stateFile+'.lock');return {removed:0,reason:'release-active'};}catch(e){if(e.code!=='ENOENT')throw e;}
 const state=JSON.parse(await fs.readFile(stateFile,'utf8'));
 if(state.status!=='live')return {removed:0,reason:'no-successful-promotion'};
 if(!/^[a-f0-9]{40}$/.test(state.revision)||!/^[a-f0-9]{40}$/.test(state.previousRevision))throw failure('RELEASE_RETENTION_STATE');
 const cutoff=Date.parse(state.updatedAt);if(!Number.isFinite(cutoff)||cutoff>Date.now()+10000)throw failure('RELEASE_RETENTION_STATE');
 const live=await fs.realpath(liveLink),stage=await fs.realpath(stageLink),root=await fs.realpath(directory);
 if(path.dirname(live)!==root||path.dirname(stage)!==root||path.basename(live)!==state.revision)throw failure('RELEASE_RETENTION_STATE');
 const keep=new Set([live,stage,path.join(root,state.previousRevision)]);let removed=0;
 for(const target of keep){const manifest=JSON.parse(await fs.readFile(path.join(target,'release.json'),'utf8'));if(manifest.schemaVersion!==1||manifest.revision!==path.basename(target))throw failure('RELEASE_RETENTION_STATE');}
 for(const entry of await fs.readdir(root,{withFileTypes:true})){
  if(!/^[a-f0-9]{40}$/.test(entry.name)||!entry.isDirectory()||entry.isSymbolicLink())continue;
  const target=path.join(root,entry.name);if(keep.has(target))continue;
  // A candidate being prepared for the next run has not entered promotion's
  // lock yet. Only prune releases sealed before the last successful promotion.
  if((await fs.stat(path.join(target,'release.json'))).mtimeMs>=cutoff)continue;
  const manifest=JSON.parse(await fs.readFile(path.join(target,'release.json'),'utf8'));
  if(manifest.schemaVersion!==1||manifest.revision!==entry.name)throw failure('RELEASE_RETENTION_STATE');
  // Recheck immediately before each deletion. The timer shares the release lock
  // through its root-owned wrapper below; these checks also reject external work.
  if(await fs.realpath(liveLink)!==live||await fs.realpath(stageLink)!==stage)throw failure('RELEASE_RETENTION_STATE');
  await fs.rm(target,{recursive:true});removed++;
 }
 return {removed,reason:'kept-live-stage-and-previous'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let lock;
 try{
  if(process.getuid?.()!==0||process.argv.length!==2)throw failure('RELEASE_INSTALL_REQUIRES_ROOT');
  const stateFile='/var/lib/rolling-release-state/state.json';
  // A separate maintenance lock would race promotion: use its existing lock.
  const args={directory:'/opt/rolling-releases',liveLink:'/opt/rolling-release-live/current',stageLink:'/opt/rolling-stage/current',stateFile};
  lock=await fs.open(stateFile+'.lock','wx',0o600);
  const result=await pruneReleases({...args,lockHeld:true});process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){if(e.code==='EEXIST')process.stdout.write('{"removed":0,"reason":"release-active"}\n');else{process.stderr.write((e.code?.startsWith('RELEASE_')?e.code:'RELEASE_RETENTION_FAILED')+'\n');process.exitCode=1;}}
 finally{if(lock){await lock.close();await fs.rm('/var/lib/rolling-release-state/state.json.lock',{force:true});}}
}
