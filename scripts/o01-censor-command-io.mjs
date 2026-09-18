// TEST ONLY. Actual packaged operator commands and official loopback Aztec RPC.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createNamespacedSafeJsonRpcServer} from '@aztec/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
import {Tx} from '@aztec/stdlib/tx';
import {OwnedBuildTree} from './owned-test-process-tree.mjs';
const silent=Object.assign(()=>{},{trace(){},debug(){},verbose(){},info(){},warn(){},error(){},fatal(){}});
const failure=code=>Object.assign(Error(code),{code});
export async function openO01CommandRpc({node}){
 assert.equal(typeof node.sendTx,'function');
 const own=Object.getOwnPropertyDescriptor(node,'sendTx'),original=node.sendTx,captures=new Map(),seen=new Set();
 const sockets=new Set(),requests=new Set();let closed=false,closePromise,release;
 const stopped=new Promise(resolve=>{release=resolve;});
 const wrapper=async function(tx,...args){
  if(closed)throw failure('O01_RPC_CLOSED');
  const copy=Tx.fromBuffer(tx.toBuffer()),hash=copy.getTxHash().toString();
  if(seen.has(hash))throw failure('O01_DUPLICATE_TX');
  if(seen.size>=16)throw failure('O01_CAPTURE_LIMIT');seen.add(hash);
  // Normal node verification and acceptance run unchanged. Only successful calls
  // populate the independent verification map; errors are never called accepted.
  const value=await Promise.race([original.call(this,tx,...args),stopped.then(()=>{throw failure('O01_RPC_CLOSED');})]);
  if(closed)throw failure('O01_RPC_CLOSED');captures.set(hash,copy);return value;
 };
 node.sendTx=wrapper;
 const exposed=new Proxy(node,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return (...args)=>{if(closed)throw failure('O01_RPC_CLOSED');return Promise.race([Promise.resolve().then(()=>value.apply(target,args)),stopped.then(()=>{throw failure('O01_RPC_CLOSED');})]);};}});
 const rpc=createNamespacedSafeJsonRpcServer({node:[exposed,AztecNodeApiSchema],aztec:[exposed,AztecNodeApiSchema]},{maxBatchSize:1,maxBodySizeBytes:10*1024*1024,log:silent});
 const callback=rpc.getApp().callback();
 const server=http.createServer((req,res)=>{
  if(closed||req.method!=='POST'||req.url!=='/'||req.headers.origin){res.writeHead(403);res.end();return;}
  const operation=Promise.resolve(callback(req,res));requests.add(operation);void operation.catch(()=>{}).finally(()=>requests.delete(operation));
 });
 server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=500;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 async function close(){
  if(closePromise)return closePromise;closed=true;release();
  closePromise=(async()=>{
   let replaced=false;if(node.sendTx!==wrapper)replaced=true;else if(own)Object.defineProperty(node,'sendTx',own);else delete node.sendTx;
   const socketClosures=[...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));
   await new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();});await Promise.all(socketClosures);
   // The RPC wait is cancelled; underlying node work has its own owner.
   await Promise.allSettled([...requests]);
   assert.equal(sockets.size,0);
   if(replaced)throw failure('O01_RPC_WRAPPER_REPLACED');
  })();return closePromise;
 }
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
 catch(error){await close();throw error;}
 return {url:'http://127.0.0.1:'+server.address().port+'/',captures,close};
}

// Parse only whole, known application log records. Never expose arbitrary errors,
// policy content, stack traces, environment values or command arguments.
export function createO01CommandOutput(){
 const hashes=new Set(),markers=new Set();const tails={stdout:'',stderr:''};let bytes=0,overflow=false;
 function line(raw){
  const text=raw.replace(/\x1b\[[0-9;]*m/g,'').replace(/^\[[^\[\]\r\n]{1,40}\] /,'').trim();
  const hash=text.match(/^Transaction hash: (0x[0-9a-fA-F]{64})$/);if(hash)hashes.add(hash[1].toLowerCase());
  if(/^TX confirmed! Block: \d+, Status: [a-z-]+$/i.test(text))markers.add('TX_CONFIRMED');
  if(text==='Moderation policy updated.')markers.add('MODERATION_POLICY_UPDATED');
  if(/^New censor on-chain: 0x[0-9a-fA-F]{64}$/.test(text))markers.add('NEW_CENSOR_ON_CHAIN');
  if(text==='Could not read new censor: request did not complete')markers.add('CENSOR_READ_UNAVAILABLE');
  if(text==='FATAL: Private fee payment could not be completed. Check any transaction outcome before another attempt.')markers.add('PRIVATE_FEE_FAILED');
  if(text==='FATAL: Command failed. Preserve wallet/cache and check any transaction outcome before retrying.')markers.add('COMMAND_FAILED');
 }
 return {push(chunk,stream='stdout'){assert(Object.hasOwn(tails,stream));let tail=tails[stream];bytes+=Buffer.byteLength(chunk);if(bytes>1024*1024){overflow=true;return;}tail+=chunk.toString();let index;while((index=tail.indexOf('\n'))>=0){const raw=tail.slice(0,index);tail=tail.slice(index+1);if(raw.length<=4096)line(raw);else overflow=true;}if(tail.length>4096){overflow=true;tail='';}tails[stream]=tail;},finish(){for(const stream of Object.keys(tails)){if(tails[stream])line(tails[stream]);tails[stream]='';}return {txHashes:[...hashes],markers:[...markers].sort()};},get overflow(){return overflow;}};
}
export async function runO01PackagedCommand({packageRoot,args,directory,timeoutMs=120000}){
 assert(path.isAbsolute(packageRoot)&&path.isAbsolute(directory));assert(Array.isArray(args)&&args.every(value=>typeof value==='string'&&!value.includes('\0')));assert(args[0]==='author');
 assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=480000);
 const started=Date.now(),output=createO01CommandOutput();let timer,child,tree,stopReason,cleanup;
 const stop=reason=>{stopReason??=reason;if(tree&&!cleanup){cleanup=tree.cleanup();cleanup.catch(()=>{});}};
 let exit;
 try{
  child=spawn('/bin/sh',[path.join(packageRoot,'scripts/operator-launch.sh'),...args],{cwd:directory,detached:true,env:{HOME:directory,TMPDIR:directory,PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  const ended=new Promise(resolve=>{child.once('error',()=>resolve({code:null,signal:null,spawnFailed:true}));child.once('close',(code,signal)=>resolve({code,signal}));});
  if(Number.isSafeInteger(child.pid))tree=new OwnedBuildTree(child.pid);
  for(const name of ['stdout','stderr'])child[name].on('data',data=>{output.push(data,name);if(output.overflow)stop('OUTPUT_LIMIT');});
  timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
  exit=await ended;
 }finally{clearTimeout(timer);if(tree){cleanup??=tree.cleanup();await cleanup;assert.equal((await tree.sample()).members.length,0);}}
 const parsed=output.finish();if(stopReason)parsed.markers.push(stopReason);if(exit?.spawnFailed)parsed.markers.push('SPAWN_FAILED');else if(exit?.signal&&!stopReason)parsed.markers.push('SIGNAL_EXIT');
 return {code:Number.isInteger(exit?.code)?exit.code:1,txHashes:parsed.txHashes,markers:[...new Set(parsed.markers)].sort(),elapsedMs:Date.now()-started};
}
