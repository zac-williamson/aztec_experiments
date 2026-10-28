import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyBundle,checkPublicAssets,failure} from './bundle.mjs';

export async function replaceLink(link,target){
 if(!path.isAbsolute(link)||!path.isAbsolute(target))throw failure('RELEASE_PATH');
 const temp=link+'.'+randomUUID();await fs.symlink(target,temp);
 try{await fs.rename(temp,link);}finally{await fs.rm(temp,{force:true});}
}
const safeError=e=>typeof e?.code==='string'&&/^RELEASE_[A-Z_]+$/.test(e.code)?e.code:'RELEASE_FAILED';
const journeySteps=['signup-ETH','signup-USDC','post','reply','like','reload','bok'];
const completedSteps=value=>Array.isArray(value)?[...new Set(value.slice(0,journeySteps.length).filter(step=>journeySteps.includes(step)))]:[];
export async function writeReleaseState(file,state){const tmp=file+'.next';await fs.mkdir(path.dirname(file),{recursive:true,mode:0o750});await fs.writeFile(tmp,JSON.stringify(state)+'\n',{mode:0o640});await fs.chmod(tmp,0o640);await fs.rename(tmp,file);}
/** The gate is an in-process call to the browser journey, never an imported JSON
 * report or caller-supplied passed flag. Only an operator-owned entry point may
 * supply adapters; all live adapters are fixed by run.mjs. */
export async function releaseCandidate({candidate,stageLink,liveLink,stageOrigin,liveOrigin,stateFile,restartStage,restartLive,journey,smoke=checkPublicAssets,writeState=writeReleaseState}){
 const lock=stateFile+'.lock';await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o750});let handle;
 try{handle=await fs.open(lock,'wx',0o600);}catch{throw failure('RELEASE_BUSY');}
 let state={schemaVersion:1,status:'checking',revision:null,previousRevision:null,startedAt:new Date().toISOString(),updatedAt:null,stages:[],journeyCompleted:[],error:null},previous,switched=false;
 const mark=async stage=>{state.stages.push(stage);state.status=stage;state.updatedAt=new Date().toISOString();await writeState(stateFile,state);};
 try{
  const sealed=await verifyBundle(candidate);state.revision=sealed.manifest.revision;
  previous=await fs.realpath(liveLink);if(previous===await fs.realpath(candidate))throw failure('RELEASE_ALREADY_LIVE');
  const old=await verifyBundle(previous);state.previousRevision=old.manifest.revision;
  if(sealed.manifest.baseline!==old.manifest.revision||JSON.stringify(sealed.manifest.compatibility)!==JSON.stringify(old.manifest.compatibility))throw failure('RELEASE_BASELINE_CHANGED');
  if(stageOrigin===liveOrigin||stageLink===liveLink)throw failure('RELEASE_STAGE_IS_LIVE');
  await mark('staging');await replaceLink(stageLink,candidate);await restartStage();await smoke(stageOrigin,sealed.manifest);
  await mark('testnet-journey');const result=await journey();
  state.journeyCompleted=completedSteps(result?.completed);
  if(result?.passed!==true||result.proofs!=='real'||result.chainId!=='11155111'||!journeySteps.every(name=>state.journeyCompleted.includes(name)))throw failure('RELEASE_JOURNEY_FAILED');
  // Hash files again after browser work and compare the exact observed live
  // version immediately before switching. Another deployment makes this stale.
  if((await verifyBundle(candidate)).digest!==sealed.digest||await fs.realpath(liveLink)!==previous||(await verifyBundle(previous)).digest!==old.digest)throw failure('RELEASE_CHANGED_DURING_TEST');
  await mark('promoting');await replaceLink(liveLink,candidate);switched=true;await restartLive();await smoke(liveOrigin,sealed.manifest);
  await mark('live');return state;
 }catch(e){
  state.error=safeError(e);
  if(Array.isArray(e?.completed))state.journeyCompleted=completedSteps(e.completed);
  if(switched){
   try{await mark('rolling-back');if(await fs.realpath(liveLink)!==await fs.realpath(candidate))throw failure('RELEASE_ROLLBACK_CONCURRENT_DEPLOY');await replaceLink(liveLink,previous);await restartLive();await smoke(liveOrigin,(await verifyBundle(previous)).manifest);await mark('rolled-back');}
   catch{state.error='RELEASE_ROLLBACK_FAILED';await mark('rollback-failed');}
  }else await mark('blocked');
  throw Object.assign(failure(state.error),{releaseState:state});
 }finally{await handle.close();await fs.rm(lock,{force:true});}
}
export async function rollbackRelease({liveLink,target,stateFile,restartLive,liveOrigin,smoke=checkPublicAssets}){
 // Explicit rollback uses another previously sealed same-contract release.
 const lock=stateFile+'.lock';await fs.mkdir(path.dirname(stateFile),{recursive:true,mode:0o750});let handle;
 try{handle=await fs.open(lock,'wx',0o600);}catch{throw failure('RELEASE_BUSY');}
 let state;
 try{
  const previous=await fs.realpath(liveLink),current=await verifyBundle(previous),next=await verifyBundle(target);
  if(JSON.stringify(current.manifest.compatibility)!==JSON.stringify(next.manifest.compatibility))throw failure('RELEASE_ROLLBACK_INCOMPATIBLE');
  state={schemaVersion:1,status:'rolling-back',revision:next.manifest.revision,previousRevision:current.manifest.revision,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),stages:['operator-rollback'],error:null};await writeReleaseState(stateFile,state);
  if(await fs.realpath(liveLink)!==previous)throw failure('RELEASE_CHANGED_DURING_TEST');
  await replaceLink(liveLink,target);await restartLive();await smoke(liveOrigin,next.manifest);
  state.status='rolled-back';state.updatedAt=new Date().toISOString();await writeReleaseState(stateFile,state);return state;
 }catch(e){if(state){state.status='rollback-failed';state.error=safeError(e);state.updatedAt=new Date().toISOString();await writeReleaseState(stateFile,state);}throw e;}
 finally{await handle.close();await fs.rm(lock,{force:true});}
}
