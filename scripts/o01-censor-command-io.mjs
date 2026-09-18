// TEST ONLY. Actual packaged operator commands and official loopback Aztec RPC.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createNamespacedSafeJsonRpcServer} from '@aztec/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
import {Tx} from '@aztec/stdlib/tx';
const silent=Object.assign(()=>{},{trace(){},debug(){},verbose(){},info(){},warn(){},error(){},fatal(){}});
const failure=code=>Object.assign(Error(code),{code});
export async function openO01CommandRpc({node}){
 assert.equal(typeof node.sendTx,'function');
 const own=Object.getOwnPropertyDescriptor(node,'sendTx'),original=node.sendTx,captures=new Map(),seen=new Set();
 const sockets=new Set(),requests=new Set();let closed=false,closePromise,release,sendAttempts=0;
 const stopped=new Promise(resolve=>{release=resolve;});
 const wrapper=async function(tx,...args){
  if(closed)throw failure('O01_RPC_CLOSED');
  sendAttempts++;
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
 const rpc=createNamespacedSafeJsonRpcServer({node:[exposed,AztecNodeApiSchema],aztec:[exposed,AztecNodeApiSchema]},{maxBodySizeBytes:10*1024*1024,log:silent});
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
 return {url:'http://127.0.0.1:'+server.address().port+'/',captures,get sendAttempts(){return sendAttempts;},close};
}

// Parse only whole, known application log records. Never expose arbitrary errors,
// policy content, stack traces, environment values or command arguments.
export function createO01CommandOutput(){
 const hashes=new Set(),markers=new Set();const tails={stdout:'',stderr:''};let bytes=0,overflow=false;
 function line(raw){
  const text=raw.replace(/\x1b\[[0-9;]*m/g,'').replace(/^\[[^\[\]\r\n]{1,40}\] /,'').trim();
  const stages={
   'SDK loaded.':'SDK_LOADED','Step 1: Deriving account keys...':'DERIVE_ACCOUNT',
   'Step 2: Connecting to Aztec node...':'CONNECT_NODE','Step 3: Computing contract addresses...':'RESOLVE_BOARD',
   'Step 4: Initializing CRS...':'INITIALIZE_CRS','CRS ready.':'CRS_READY',
   'Step 5: Creating PXE...':'CREATE_PXE','PXE created.':'PXE_READY',
   'Step 6: Registering account with PXE...':'REGISTER_ACCOUNT','Account registered.':'ACCOUNT_REGISTERED',
   'Billboard contract registered.':'BOARD_REGISTERED','Syncing PXE with node...':'SYNC_PXE','Wallet ready.':'WALLET_READY',
   'Storing signing key capsule...':'STORE_CAPSULE','Capsule stored.':'CAPSULE_STORED',
   'Checking L2 deposit note...':'READ_DEPOSIT','No L2 deposit note found.':'NO_DEPOSIT',
   'Registering censor account with PXE...':'REGISTER_CENSOR',
   'Storing censor signing key capsule...':'STORE_CENSOR_CAPSULE','Censor capsule stored.':'CENSOR_CAPSULE_STORED',
  };
  if(Object.hasOwn(stages,text))markers.add(stages[text]);
  const location=text.match(/^Failure location: ((?:(?:billboard-user-engine|billboard-sdk)\.js|[a-zA-Z0-9_]{1,64}\.nr):\d+:\d+)$/);
  if(location)markers.add(location[1]);
  const failureCode=text.match(/^FATAL: (BB_CLI_PROVER_CONFIGURATION|BB_PRIVATE_FEE_PREPARATION_FAILED|BB_PRIVATE_FEE_ACTION_FAILED): /);
  if(failureCode)markers.add(failureCode[1]);
  const hash=text.match(/^(?:Transaction hash: |To start another action, acknowledge the confirmed transaction with --acknowledge-tx )(0x[0-9a-fA-F]{64})$/);if(hash)hashes.add(hash[1].toLowerCase());
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
 const started=Date.now(),output=createO01CommandOutput();let stopReason;
 const child=spawn('/bin/sh',[path.join(packageRoot,'scripts/operator-launch.sh'),...args],{cwd:directory,env:{HOME:directory,TMPDIR:directory,PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
 const stop=reason=>{stopReason=reason;child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();};
 for(const stream of ['stdout','stderr'])child[stream].on('data',data=>{output.push(data,stream);if(output.overflow)stop('OUTPUT_LIMIT');});
 const timer=setTimeout(()=>stop('TIMEOUT'),timeoutMs);
 let exit;
 try {exit=await new Promise(resolve=>{
   child.once('error',()=>resolve({code:1,signal:null,spawnFailed:true}));
   child.once('close',(code,signal)=>resolve({code,signal}));
 });}finally{clearTimeout(timer);}
 const parsed=output.finish();
 if(stopReason)parsed.markers.push(stopReason);
 if(exit.spawnFailed)parsed.markers.push('SPAWN_FAILED');
 if(exit.signal)parsed.markers.push('SIGNAL_EXIT');
 return {code:stopReason||exit.code!==0?1:0,txHashes:parsed.txHashes,markers:[...new Set(parsed.markers)].sort(),elapsedMs:Date.now()-started};
}
