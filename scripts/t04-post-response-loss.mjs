// TEST ONLY. Install after the genuine capture/validation wrapper. This changes
// only delivery of sendTx's response; original acceptance and proof verification run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export const T04_POST_ACCEPTED_FILENAME='browser-post-response-accepted.json';
const fixed=code=>Object.assign(new Error(code),{code});
export async function installT04PostResponseLoss({node,directory,timeoutMs=480000}){
 assert(path.isAbsolute(directory));assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=540000);
 assert.equal(typeof node.sendTx,'function');
 const acceptedPath=path.join(directory,T04_POST_ACCEPTED_FILENAME);
 try{await fs.lstat(acceptedPath);throw fixed('T04_ACCEPTED_FILE_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
 const original=node.sendTx,own=Object.getOwnPropertyDescriptor(node,'sendTx');
 let closed=false,calls=0,accepted=false,transactionHash=null,requestStartedAtMs=null,acceptedAtMs=null,ownsFile=false,publishing,release,closePromise;
 const held=new Promise(resolve=>{release=resolve;});
 const wrapper=async function(tx,...args){
  if(closed)throw fixed('T04_RESPONSE_WITHHELD_CLOSED');
  calls++;
  if(calls!==1)throw fixed('T04_DUPLICATE_SUBMISSION');
  requestStartedAtMs=Date.now();
  const hash=tx.getTxHash().toString();assert(/^0x[0-9a-f]{64}$/.test(hash),'T04_INVALID_PUBLIC_HASH');
  transactionHash=hash;
  await original.call(this,tx,...args);
  acceptedAtMs=Date.now();accepted=true;
  if(closed)throw fixed('T04_RESPONSE_WITHHELD_CLOSED');
  publishing=(async()=>{
   const temporary=acceptedPath+'.'+randomUUID()+'.tmp';
   try{
    await fs.writeFile(temporary,JSON.stringify({schemaVersion:1,requestStartedAtMs,acceptedAtMs,transactionHash:hash,sendCalls:1,accepted:true})+'\n',{mode:0o600,flag:'wx'});
    await fs.link(temporary,acceptedPath);ownsFile=true;
   }finally{await fs.rm(temporary,{force:true});}
  })();
  await publishing;
  await held;
  throw fixed('T04_RESPONSE_WITHHELD_CLOSED');
 };
 node.sendTx=wrapper;
 function close(){
  if(closePromise)return closePromise;
  closed=true;release();clearTimeout(timer);
  closePromise=(async()=>{
   let replacementFailure;
   if(node.sendTx!==wrapper)replacementFailure=fixed('T04_SEND_WRAPPER_REPLACED');
   else if(own)Object.defineProperty(node,'sendTx',own);else delete node.sendTx;
   try{await publishing;}catch{/* caller retains publishing failure; cleanup must still run */}
   if(ownsFile)await fs.rm(acceptedPath,{force:true});
   if(replacementFailure)throw replacementFailure;
  })();
  return closePromise;
 }
 const timer=setTimeout(()=>{void close().catch(()=>{});},timeoutMs);
 return {acceptedPath,snapshot:()=>({sendCalls:calls,accepted,transactionHash,requestStartedAtMs,acceptedAtMs,closed}),close};
}
