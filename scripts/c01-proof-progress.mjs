// TEST-ONLY, read-only diagnostics for the pinned in-process 5.2 prover. Never claims jobs.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ProvingRequestType} from '@aztec/stdlib/proofs';

const jobKey=id=>{
  assert(typeof id==='string'&&id.length<=4096);
  return createHash('sha256').update(id).digest('hex');
};
const circuit=type=>{
  const name=ProvingRequestType[type];assert(typeof name==='string'&&/^[A-Z_]+$/.test(name));return name;
};
const duration=value=>Number.isFinite(value)?Math.max(0,Math.round(value)):null;
const safeInteger=value=>{const number=Number(value);assert(Number.isSafeInteger(number)&&number>=0);return number;};

/** Call from the parent's existing poll; creates no timer, background task, or proof work.
 * Public methods provide sessions/checkpoints/agent status. Pinned TypeScript-private (not #private)
 * metadata Maps supply broker counts without fetching results/proof URIs from its database.
 */
export async function readC01ProofProgress({prover,epochs=[]}){
  const result={available:false,scope:'observed circuit scheduling only; no proof acceptance or native subphase claim',
    sampledAt:new Date().toISOString(),agents:[],sessions:[],checkpoints:[]};
  try{
    assert(Array.isArray(epochs)&&epochs.length<=32);const selected=[...new Set(epochs.map(safeInteger))];
    const sessions=await prover.getJobs();assert(Array.isArray(sessions)&&sessions.length<=128);
    const sessionStates=new Set(['initialized','awaiting-checkpoints','awaiting-root','awaiting-predecessor','publishing-proof','completed','superseded','failed','stopped','cancelled','timed-out']);
    result.sessions=sessions.map(job=>({jobKeySha256:jobKey(job.uuid),epoch:safeInteger(job.epochNumber),
      status:sessionStates.has(job.status)?job.status:'unrecognized'}));
    const client=prover.getProver();assert(Array.isArray(client.agents)&&client.agents.length<=16);
    const now=Date.now();
    result.agents=client.agents.map((agent,index)=>{
      const status=agent.getStatus();assert(['proving','running','stopped'].includes(status.status));
      const item={index,status:status.status};
      if(status.status==='proving'){
        Object.assign(item,{jobKeySha256:jobKey(status.jobId),circuit:circuit(status.proofType),
          elapsedSinceDispatchMs:duration(now-Date.parse(status.startedAtISO))});
        const controller=agent.currentJobController;
        if(controller){const state=controller.getStatus();assert(['idle','running','done'].includes(state));item.controllerStatus=state;}
      }
      return item;
    });
    const broker=client.getProvingJobSource();
    for(const name of ['jobsCache','resultsCache','inProgress','enqueuedAt','retries'])assert(broker[name] instanceof Map,'Local broker metadata unavailable');
    assert(broker.jobsCache.size<=10000,'Broker diagnostic inventory bound exceeded');
    const byCircuit={},details=[];
    for(const [id,job] of broker.jobsCache){
      const name=circuit(job.type),epoch=safeInteger(job.epochNumber);
      if(selected.length&&!selected.includes(epoch))continue;
      const settled=broker.resultsCache.get(id),active=broker.inProgress.get(id);
      const status=settled?.status??(active?'in-progress':'in-queue');
      assert(['fulfilled','rejected','aborted','in-progress','in-queue'].includes(status));
      const counts=byCircuit[name]??={known:0,fulfilled:0,rejected:0,aborted:0,'in-progress':0,'in-queue':0};
      counts.known++;counts[status]++;
      if(details.length<64&&(status==='in-progress'||status==='in-queue'||status==='rejected')){
        const item={jobKeySha256:jobKey(id),circuit:name,epoch,status,retries:safeInteger(broker.retries.get(id)??0)};
        if(active){item.elapsedSinceDispatchMs=duration(now-active.startedAt);item.lastProgressAgeMs=duration(now-active.lastUpdatedAt);}
        const queued=broker.enqueuedAt.get(id);if(queued)item.currentQueueWaitMs=duration(queued.ms());
        details.push(item);
      }
    }
    result.broker={byCircuit,details,detailLimit:64,totalRetainedJobs:broker.jobsCache.size,
      countsScope:'retained broker metadata for selected epochs; historical completed jobs may have been evicted',
      timingScope:'current dispatch/queue ages, not CPU time or measured completion durations'};
    const checkpoints=prover.getCheckpointStore().list();assert(checkpoints.length<=128);
    for(const checkpoint of checkpoints){
        const epoch=safeInteger(checkpoint.epochNumber);if(selected.length&&!selected.includes(epoch))continue;
        assert(typeof checkpoint.completed==='boolean');
        result.checkpoints.push({epoch,number:safeInteger(checkpoint.checkpoint.number),
          failed:checkpoint.isFailed(),cancelled:checkpoint.isCancelled(),
          blockProvingFullyEnqueued:checkpoint.completed,subTreeCreated:checkpoint.subTree!==undefined});
    }
    result.available=true;
    assert(Buffer.byteLength(JSON.stringify(result))<=65536,'Progress output bound exceeded');
    return result;
  }catch(error){return {available:false,scope:result.scope,errorClass:error?.name??'Error',
    reason:'Pinned local diagnostic shape unavailable or bounded snapshot rejected'};}
}
