// TEST ONLY: bounded read-only transport to one owned loopback Anvil.
import assert from 'node:assert/strict';
import http from 'node:http';
export async function startMonitorDrillTransport({upstream,unavailable=false,signal}){
 signal?.throwIfAborted();const url=new URL(upstream);assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password);
 const allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode','eth_getBalance']);
 const sockets=new Set(),controllers=new Set(),inflight=new Set(),counts={};let rejected=0,closed=false,closePromise;
 const server=http.createServer((req,res)=>{const task=handle(req,res);inflight.add(task);void task.finally(()=>inflight.delete(task));});
 async function handle(req,res){
  let controller,timer;
  try{
   if(closed||signal?.aborted||unavailable){res.writeHead(503);res.end();return;}
   if(req.method!=='POST'||req.url!=='/')throw Error();
   let text='';for await(const bytes of req){text+=bytes.toString();if(Buffer.byteLength(text)>65536)throw Error();}
   if(closed||signal?.aborted)throw Error();
   const value=JSON.parse(text);if(value?.jsonrpc!=='2.0'||!allowed.has(value.method)||!Array.isArray(value.params)||!Number.isSafeInteger(value.id))throw Error();
   counts[value.method]=(counts[value.method]??0)+1;
   controller=new AbortController();controllers.add(controller);timer=setTimeout(()=>controller.abort(),3000);
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),signal:controller.signal,redirect:'error'});
   if(!response.ok)throw Error();
   let size=0;const chunks=[];for await(const bytes of response.body){size+=bytes.length;if(size>1024*1024)throw Error();chunks.push(bytes);}
   res.writeHead(200,{'content-type':'application/json'});res.end(Buffer.concat(chunks));
  }catch{rejected++;controller?.abort();if(!res.headersSent)res.writeHead(502);res.end();}
  finally{clearTimeout(timer);if(controller)controllers.delete(controller);}
 }
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=500;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const endpoint='http://127.0.0.1:'+server.address().port+'/';
 function close(){
  if(closePromise)return closePromise;closed=true;
  closePromise=(async()=>{for(const controller of controllers)controller.abort();const socketClosures=[...sockets].map(socket=>new Promise(resolve=>socket.once('close',resolve)));await new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();});await Promise.all(socketClosures);await Promise.allSettled([...inflight]);signal?.removeEventListener('abort',onAbort);})();
  return closePromise;
 }
 const onAbort=()=>{void close().catch(()=>{});};signal?.addEventListener('abort',onAbort,{once:true});
 if(signal?.aborted){await close();signal.throwIfAborted();}
 return {url:endpoint,snapshot:()=>({methods:{...counts},rejected,listening:server.listening,openSockets:sockets.size,pendingRequests:controllers.size}),close};
}
