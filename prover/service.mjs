import fs from 'node:fs/promises';
import path from 'node:path';
import {prepareNativeRuntime} from './runtime.mjs';
import {createProofQueue} from './queue.mjs';
import {createProcessWorker} from './process-worker.mjs';
import {createProverServer} from './server.mjs';

// Composition root: owns only the resources it creates. Tests and the host use
// this same entry point; HTTP, queue and worker communicate through interfaces.
export async function startProverService(config){
 if(!/^[1-9][0-9]*$/.test(String(config.chainId))||!/^[1-9][0-9]*$/.test(String(config.rollupVersion))||!Array.isArray(config.origins)||!config.origins.every(o=>{try{return new URL(o).origin===o;}catch{return false;}})||!Number.isSafeInteger(config.threads??1)||(config.threads??1)<1||(config.threads??1)>256)throw Error('Invalid network, origins or threads');
 if(!/^0x[0-9a-f]{64}$/.test(config.board)||!['real','disabled'].includes(config.proofs))throw Error('Invalid board/proofs configuration');
 if(config.privateFeeAddress!==undefined&&!/^0x[0-9a-f]{64}$/.test(config.privateFeeAddress))throw Error('Invalid private fee address');
 const host=config.host??'127.0.0.1',proofsEnabled=config.proofs==='real';
 if(!proofsEnabled&&(!['127.0.0.1','::1','localhost'].includes(host)||String(config.chainId)!=='31337'))throw Error('Disabled proofs require loopback local devnet');
 const runtime=proofsEnabled?await prepareNativeRuntime(config):{};
 const directory=await fs.mkdtemp(path.join(config.queueDirectory??'/tmp','board-prover-'));
 const worker=createProcessWorker({proofsEnabled,threads:config.threads??1,privateFeeAddress:config.privateFeeAddress,...runtime});
 let queue,server,closing;
 const close=()=>closing??=(async()=>{if(server){server.close();server.closeAllConnections();}await (queue?queue.close():worker.close());await fs.rm(directory,{recursive:true,force:true});})();
 try{
  queue=await createProofQueue({directory,worker,maxJobs:1000,maxBytes:config.maxQueueBytes??2*1024**3});
  server=createProverServer({...config,queue,proofsEnabled});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??8081,host,()=>{server.removeListener('error',reject);resolve();});});
  return {address:server.address(),close,stats:()=>queue.stats()};
 }catch(error){await close();throw error;}
}
