import {fork} from 'node:child_process';
/** Worker interface: prove(file) -> result; close() cancels owned process tree. */
export function createProcessWorker({proofsEnabled,threads=1,bbPath,crsPath,timeoutMs=120000}){
 let active;
 const kill=child=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
 return {prove(file){if(active)throw Error('Worker busy');return new Promise((resolve,reject)=>{
  const child=fork(new URL('./worker.mjs',import.meta.url),[file],{detached:true,stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,HOME:process.env.HOME,CRS_PATH:crsPath,PROVER_PROOFS:proofsEnabled?'real':'disabled',PROVER_THREADS:String(threads),HARDWARE_CONCURRENCY:String(threads),PROVER_BB:bbPath,LOG_LEVEL:'silent'}});active=child;let result;
  const timer=setTimeout(()=>kill(child),timeoutMs);
  child.on('message',value=>{result=value;});child.on('error',()=>{clearTimeout(timer);active=undefined;reject(Error('Worker unavailable'));});
  child.on('exit',code=>{clearTimeout(timer);kill(child);active=undefined;if(code===0&&result)resolve(result);else reject(Object.assign(Error('Proof worker failed'),{code:result?.errorStage??'worker'}));});
 });},async close(){if(active){const child=active;await new Promise(resolve=>{child.once('exit',resolve);kill(child);});}}};
}
