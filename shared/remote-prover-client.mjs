import {serializeWitness} from '@aztec/noir-noirc_abi';
import {encodeJob,circuitId} from './remote-prover-wire.mjs';
/** Proving transport interface: prove(executionSteps, publicInputs) -> encoded proof result. */
export function createRemoteProverClient({url,board,chainId,rollupVersion,proofsEnabled=true,fetchImpl=globalThis.fetch,timeoutMs=1800000,pollMs=1000}){
  const endpoint=new URL(url);
  if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!(endpoint.protocol==='https:'||(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))))throw Error('Remote prover requires HTTPS or loopback');
  const base=endpoint.href.replace(/\/$/,'');
  return Object.freeze({async prove(steps,publicInputs=[]){
    const signal=AbortSignal.timeout(timeoutMs);
    const metadata={board,chainId:String(chainId),rollupVersion:String(rollupVersion),mode:proofsEnabled?'real':'disabled',circuits:await Promise.all(steps.map(s=>circuitId(s.bytecode,s.vk)))};
    const body=encodeJob(metadata,steps.map(s=>serializeWitness(s.witness)));
    const request=async(path,options={})=>{const r=await fetchImpl(base+path,{...options,signal,credentials:'include',redirect:'error',cache:'no-store'});if(!r.ok)throw Object.assign(Error('Board remote prover is unavailable or rejected this request.'),{code:'BB_REMOTE_PROVER_FAILED'});const text=await r.text();if(text.length>512000)throw Error('Invalid prover response');return JSON.parse(text);};
    const accepted=await request('/v1/jobs',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
    if(!/^[a-f0-9]{64}$/.test(accepted.id))throw Error('Invalid job identifier');
    for(;;){
      const job=await request('/v1/jobs/'+accepted.id);
      if(job.state==='complete'){if(job.result?.mode!==metadata.mode)throw Error('Prover mode mismatch');return job.result;}
      if(!['queued','running'].includes(job.state))throw Object.assign(Error('Remote proof failed. Try again or select local proving.'),{code:'BB_REMOTE_PROVER_FAILED',stage:job.code});
      await new Promise((resolve,reject)=>{const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);resolve();};const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(finish,pollMs);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    }
  }});
}
