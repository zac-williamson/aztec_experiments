import {serializeWitness} from '@aztec/noir-noirc_abi';
import {encodeJob,circuitId} from './remote-prover-wire.mjs';
const failure=code=>Object.assign(Error('Remote proof did not complete.'),{code});
/** Proving transport: prove(executionSteps, publicInputs) -> encoded proof result. */
export function createRemoteProverClient({url,board,chainId,rollupVersion,proofsEnabled=true,fetchImpl=globalThis.fetch,timeoutMs=1800000,pollMs=1000,onStatus=()=>{}}){
 const endpoint=new URL(url);
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))))throw Error('Remote prover requires HTTPS or loopback');
 const base=endpoint.href.replace(/\/$/,'');
 return Object.freeze({async prove(steps,publicInputs=[]){
  const signal=AbortSignal.timeout(timeoutMs);
  const metadata={board,chainId:String(chainId),rollupVersion:String(rollupVersion),mode:proofsEnabled?'real':'disabled',circuits:await Promise.all(steps.map(s=>circuitId(s.bytecode,s.vk)))};
  const body=encodeJob(metadata,steps.map(s=>serializeWitness(s.witness)));
  async function request(path,options={}){
   let response,text;
   try{response=await fetchImpl(base+path,{...options,signal,credentials:'include',redirect:'error',cache:'no-store'});text=await response.text();}
   catch{throw failure(signal.aborted?'BB_REMOTE_PROVER_TIMEOUT':'BB_REMOTE_PROVER_OFFLINE');}
   if(!response.ok)throw failure(response.status===429?'BB_REMOTE_PROVER_BUSY':[401,403,400,413,422].includes(response.status)?'BB_REMOTE_PROVER_REJECTED':'BB_REMOTE_PROVER_OFFLINE');
   try{if(text.length>512000)throw Error();return JSON.parse(text);}catch{throw failure('BB_REMOTE_PROVER_RESPONSE');}
  }
  const accepted=await request('/v1/jobs',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
  if(!/^[a-f0-9]{64}$/.test(accepted.id))throw failure('BB_REMOTE_PROVER_RESPONSE');
  for(;;){
   const job=await request('/v1/jobs/'+accepted.id);
   if(['queued','running'].includes(job.state)){try{onStatus(job.state);}catch{}}
   if(job.state==='complete'){if(job.result?.mode!==metadata.mode)throw failure('BB_REMOTE_PROVER_RESPONSE');return job.result;}
   if(!['queued','running'].includes(job.state))throw failure('BB_REMOTE_PROVER_FAILED');
   await new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve();};
    const abort=()=>{clearTimeout(timer);reject(failure('BB_REMOTE_PROVER_TIMEOUT'));};
    const timer=setTimeout(finish,pollMs);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
   });
  }
 }});
}
