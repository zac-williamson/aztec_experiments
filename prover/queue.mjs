import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
/** Queue owns persistence/lifecycle; injected worker owns proof computation. */
export async function createProofQueue({directory,worker,maxJobs=1000,maxBytes=2*1024**3,maxPerClient=4,ttlMs=1800000}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const jobs=new Map();let bytes=0,running=false,closed=false;const pending=[];
 const remove=async job=>{if(!jobs.delete(job.id))return;bytes-=job.bytes;await fs.rm(job.file,{force:true});};
 async function drain(){if(running||closed)return;running=true;try{while(pending.length&&!closed){const job=pending.shift();if(!jobs.has(job.id))continue;if(Date.now()>job.expires){await remove(job);continue;}job.state='running';let state='complete';try{job.result=await worker.prove(job.file);}catch(error){state='failed';job.code=['read','catalog','decompress','board-binding','prove'].includes(error.code)?error.code:'worker';}finally{await fs.rm(job.file,{force:true});bytes-=job.bytes;job.bytes=0;job.expires=Date.now()+60000;}job.state=state;}}finally{running=false;}}
 const timer=setInterval(()=>{for(const job of jobs.values())if(job.state!=='running'&&Date.now()>job.expires)void remove(job).catch(()=>{});},1000);timer.unref();
 return {async submit(body,client){
  if(closed||jobs.size>=maxJobs||bytes+body.length>maxBytes||[...jobs.values()].filter(j=>j.client===client&&['queued','running'].includes(j.state)).length>=maxPerClient)throw Object.assign(Error('Queue capacity reached'),{status:429});
  const id=randomBytes(32).toString('hex'),file=path.join(directory,id),job={id,file,client,bytes:body.length,state:'queued',expires:Date.now()+ttlMs};jobs.set(id,job);bytes+=body.length;
  try{await fs.writeFile(file,body,{flag:'wx',mode:0o600});}catch(error){jobs.delete(id);bytes-=body.length;throw error;}
  pending.push(job);void drain();return id;
 },get(id){const job=jobs.get(id);return job?{state:job.state,...(job.code?{code:job.code}:{}),...(job.state==='complete'?{result:job.result}:{})}:null;},async close(){closed=true;clearInterval(timer);await worker.close();while(running)await new Promise(r=>setTimeout(r,10));for(const job of [...jobs.values()])await remove(job);},stats(){return {jobs:jobs.size,bytes,running};}};
}
