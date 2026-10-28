import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
/** Queue owns persistence/lifecycle; injected worker owns proof computation. */
export async function createProofQueue({directory,worker,maxJobs=1000,maxBytes=2*1024**3,maxPerClient=4}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const jobs=new Map();let waiters=0;let bytes=0,running=false,closed=false;const pending=[];let submitted=0,completed=0,failed=0,lastWorkerMs=null,lastQueueWaitMs=null;
 const snapshot=job=>job?{state:job.state,...(job.code?{code:job.code}:{}),...(['complete','failed'].includes(job.state)?{timings:{...job.timings,resultReadyToSnapshotMs:Math.max(0,performance.now()-job.completedAt)}}:{}),...(job.state==='complete'?{result:job.result}:{})}:null;
 const notify=job=>{for(const finish of [...(job.waiters??[])])finish(snapshot(job));};
 const remove=async job=>{if(!jobs.delete(job.id))return;for(const finish of [...(job.waiters??[])])finish(null);bytes-=job.bytes;await fs.rm(job.file,{force:true});};
 async function drain(){
  if(running||closed)return;running=true;
  try{while(pending.length&&!closed){
   const job=pending.shift();if(!jobs.has(job.id))continue;
   const startedAt=performance.now();job.startedAt=startedAt;job.timings.queueWaitMs=startedAt-job.queuedAt;job.state='running';job.draining=true;let state='complete';
   const publish=(result,state='complete')=>{
    if(['complete','failed'].includes(job.state))return;
    job.result=result;job.completedOrder=completed+failed;job.state=state;job.completedAt=performance.now();
    job.timings.resultReadyMs=job.completedAt-startedAt;
    if(state==='complete')completed++;else failed++;notify(job);
   };
   try{job.result=await worker.prove(job.file,{onResult:result=>publish(result),onTimings:values=>{
    for(const key of ['readMs','decompressMs','bindingMs','backendMs','nativeProveMs','bbStartMs','bbLoadMs','bbAccumulateMs','bbProveMs','bbVerifyMs','bbCompressMs','resultEncodeMs','childTotalMs','readyWaitMs','dispatchToResultMs','resultToExitMs','warmReplacementMs']){
     const value=values?.[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)job.timings[key]=value;
    }
   }});}catch(error){if(job.state!=='complete'){state='failed';job.code=['read','catalog','decompress','board-binding','prove','native-init','native-prove','native-srs','native-constraint','native-verification','native-process'].includes(error.code)?error.code:'worker';}}
   finally{
    const cleanupAt=performance.now();job.timings.workerMs=cleanupAt-startedAt;
    lastWorkerMs=job.timings.workerMs;lastQueueWaitMs=job.timings.queueWaitMs;
    await fs.rm(job.file,{force:true});bytes-=job.bytes;job.bytes=0;job.timings.cleanupMs=performance.now()-cleanupAt;job.draining=false;
   }
   if(job.state!=='complete')publish(job.result,state);
   // Acknowledging delivery cannot release the process/file reservation early.
   if(job.acknowledged)await remove(job);
  }}finally{running=false;}
 }

 return {async submit(body,client){
  const reject=()=>{throw Object.assign(Error('Queue capacity reached'),{status:429});};
  const admitted=()=>!closed&&bytes+body.length<=maxBytes&&[...jobs.values()].filter(j=>j.client===client&&(j.draining||['queued','running'].includes(j.state))).length<maxPerClient;
  if(!admitted())reject();
  // Retain results until acknowledged or displaced by new work. Only terminal
  // entries are evictable; elapsed time never cancels an admitted proof.
  while(jobs.size>=maxJobs){
   const terminal=[...jobs.values()].filter(j=>!j.draining&&['complete','failed'].includes(j.state)).sort((a,b)=>a.completedOrder-b.completedOrder)[0];
   if(!terminal)reject();await remove(terminal);if(!admitted())reject();
  }
  const id=randomBytes(32).toString('hex'),file=path.join(directory,id),job={id,file,client,bytes:body.length,state:'queued',timings:{}};jobs.set(id,job);bytes+=body.length;
  const persistAt=performance.now();
  try{await fs.writeFile(file,body,{flag:'wx',mode:0o600});}catch(error){jobs.delete(id);bytes-=body.length;throw error;}
  job.queuedAt=performance.now();job.timings.persistMs=job.queuedAt-persistAt;
  submitted++;pending.push(job);void drain();return id;
 },async acknowledge(id){const job=jobs.get(id);if(!job)return true;if(!['complete','failed'].includes(job.state))return false;if(job.draining)job.acknowledged=true;else await remove(job);return true;},get(id){return snapshot(jobs.get(id));},waitForResult(id,signal){
  const job=jobs.get(id);if(!job||['complete','failed'].includes(job.state))return Promise.resolve(snapshot(job));
  if(signal?.aborted)return Promise.reject(signal.reason);
  if(waiters>=128||(job.waiters?.size??0)>=4)throw Object.assign(Error('Too many result observers'),{status:429});
  return new Promise((resolve,reject)=>{
   job.waiters??=new Set();waiters++;
   const clear=()=>{if(!job.waiters.delete(finish))return false;waiters--;signal?.removeEventListener('abort',abort);return true;};
   const finish=value=>{if(clear())resolve(value);};
   const abort=()=>{if(clear())reject(signal.reason);};
   job.waiters.add(finish);signal?.addEventListener('abort',abort,{once:true});
  });
 },async close(){closed=true;await worker.close();while(running)await new Promise(r=>setTimeout(r,10));for(const job of [...jobs.values()])await remove(job);},stats(){
  const now=performance.now(),queued=[...jobs.values()].filter(job=>job.state==='queued'),active=[...jobs.values()].filter(job=>job.draining);
  const age=(rows,key)=>rows.reduce((maximum,job)=>Number.isFinite(job[key])?Math.max(maximum,now-job[key]):maximum,0)/1000;
  return {jobs:jobs.size,bytes,running,submitted,completed,failed,queued:queued.length,active:active.length,
   oldestJobAgeSeconds:age(queued,'queuedAt'),oldestActiveAgeSeconds:age(active,'startedAt'),lastWorkerMs,lastQueueWaitMs};
 }};
}
