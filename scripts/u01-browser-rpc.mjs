// TEST ONLY. Never expose this fixture as a production RPC proxy.
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {Transaction} from 'ethers';
import {createNamespacedSafeJsonRpcServer} from '@aztec/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
const LIMIT=4*1024*1024;
const METHODS=new Set(['eth_chainId','net_version','eth_blockNumber','eth_getBlockByNumber','eth_getBlockByHash','eth_getBalance','eth_getCode','eth_getStorageAt','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getLogs','eth_sendTransaction','eth_sendRawTransaction']);
const silent=Object.assign(()=>{},{trace(){},debug(){},verbose(){},info(){},warn(){},error(){},fatal(){}});
async function boundedBody(stream){let size=0;const parts=[];for await(const part of stream){const data=Buffer.from(part);size+=data.length;if(size>LIMIT)throw Error('Body exceeds fixture bound');parts.push(data);}return Buffer.concat(parts).toString('utf8');}
function respond(res,status,value){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));}
async function listen(handler){const server=http.createServer(handler);server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=1000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server;}
function stop(server){return new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
export async function startU01BrowserRpc({node,anvilUrl,ethereumAccount,origin,token,observer}){
 const target=new URL(anvilUrl),expectedOrigin=new URL(origin);
 if(target.protocol!=='http:'||target.hostname!=='127.0.0.1'||!target.port||target.username||target.password||target.search||target.hash||target.pathname!=='/')throw Error('Explicit loopback Anvil URL required');
 if(!['https:','http:'].includes(expectedOrigin.protocol)||expectedOrigin.origin!==origin||!['127.0.0.1','localhost'].includes(expectedOrigin.hostname))throw Error('Exact local browser origin required');
 if(!/^[0-9a-f]{32,128}$/.test(token??'')||token.length%2)throw Error('Parent token of at least 128 bits required');
 if(!/^0x[0-9a-fA-F]{40}$/.test(ethereumAccount??'')||BigInt(ethereumAccount)===0n)throw Error('Disposable Ethereum account required');
 const account=ethereumAccount.toLowerCase(),secret=Buffer.from(token);
 const controllers=new Set();let closed=false;
 async function forward(body){const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),15000);try{const result=await fetch(target,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});if(!result.ok)throw Error();return JSON.parse(await boundedBody(result.body));}finally{clearTimeout(timer);controllers.delete(controller);}}
 const network=await forward({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]});if(network.result!=='0x7a69')throw Error('Disposable chain 31337 required');
 function authorized(req){const value=req.headers['x-u01-test-token'];return !closed&&req.headers.origin===origin&&typeof value==='string'&&Buffer.byteLength(value)===secret.length&&timingSafeEqual(Buffer.from(value),secret)&&req.method==='POST'&&req.url==='/';}
 // Observation is optional and must never change transport or application outcomes.
 function begin(channel,method,args){try{return observer?.begin(channel,method,args)??(()=>{});}catch{return ()=>{};}}
 function finish(done,success){try{done(success);}catch{}}
 const observedNode=observer?new Proxy(node,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
  if(!Object.hasOwn(AztecNodeApiSchema,key))return value.bind(target);
  return async(...args)=>{const done=begin('aztec',key,args);try{const result=await value.apply(target,args);finish(done,true);return result;}catch(error){finish(done,false);throw error;}};
 }}):node;
 const rpc=createNamespacedSafeJsonRpcServer({node:[observedNode,AztecNodeApiSchema],aztec:[observedNode,AztecNodeApiSchema]},{maxBatchSize:100,maxBodySizeBytes:10*1024*1024,corsAllowedOrigins:[origin],corsAllowedHeaders:['content-type','x-u01-test-token'],log:silent});
 const callback=rpc.getApp().callback();let nodeServer,ethereumServer;
 try{
  nodeServer=await listen((req,res)=>{if(!authorized(req))return respond(res,403,{error:'Forbidden'});callback(req,res);});
  ethereumServer=await listen(async(req,res)=>{if(!authorized(req))return respond(res,403,{error:'Forbidden'});try{
   const payload=JSON.parse(await boundedBody(req));
   const batch=Array.isArray(payload);if(batch&&(payload.length===0||payload.length>32))throw Error();
   async function execute(body){let done=()=>{};try{if(!body||Array.isArray(body)||body.jsonrpc!=='2.0'||typeof body.method!=='string'||!Array.isArray(body.params)||!['number','string'].includes(typeof body.id))throw Error();
   done=begin('ethereum',body.method,body.params);
   if(['eth_accounts','eth_requestAccounts'].includes(body.method)){if(body.params.length)throw Error();finish(done,true);return {jsonrpc:'2.0',id:body.id,result:[account]};}
   if(!METHODS.has(body.method))throw Error();
   if(body.method==='eth_sendTransaction'){
    const tx=body.params[0];if(body.params.length!==1||!tx||typeof tx!=='object'||Array.isArray(tx)||typeof tx.from!=='string'||tx.from.toLowerCase()!==account)throw Error();
    if(tx.chainId!==undefined&&BigInt(tx.chainId)!==31337n)throw Error();
   }
   if(body.method==='eth_sendRawTransaction'){
    if(body.params.length!==1||typeof body.params[0]!=='string')throw Error();const tx=Transaction.from(body.params[0]);if(tx.from?.toLowerCase()!==account||tx.chainId!==31337n)throw Error();
   }
   const result=await forward(body);finish(done,!result.error);return result;
   }catch{finish(done,false);return {jsonrpc:'2.0',id:body&&['number','string'].includes(typeof body.id)?body.id:null,error:{code:-32600,message:'Fixture request rejected'}};}}
   if(batch){const ids=payload.map(x=>x?.id);if(new Set(ids).size!==ids.length)throw Error();respond(res,200,await Promise.all(payload.map(execute)));}
   else {const result=await execute(payload);respond(res,result.error?.message==='Fixture request rejected'?400:200,result);}
  }catch{if(!res.headersSent)respond(res,400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Fixture request rejected'}});else res.destroy();}});
 }catch(error){if(nodeServer)await stop(nodeServer);throw error;}
 return {nodeUrl:`http://127.0.0.1:${nodeServer.address().port}/`,ethereumUrl:`http://127.0.0.1:${ethereumServer.address().port}/`,async close(){if(closed)return;closed=true;for(const controller of controllers)controller.abort();await Promise.all([stop(nodeServer),stop(ethereumServer)]);}};
}
