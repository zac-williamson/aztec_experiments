import http from 'node:http';
/** Polls public on-chain invocations. A restart skips started jobs; it never replays paid calls. */
export async function startEscrowService({descriptor,escrow,board,run,host='127.0.0.1',port=8787,onError=console.error,pollMs=2000}){
 let stopped=false,busy=false,cursor=0,inFlight=Promise.resolve(),lastFailure=null,lastSuccess=null;
 const failed=error=>{lastFailure={at:new Date().toISOString(),kind:error.name||'Error'};onError(error);};
 const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/v1/descriptor')return res.end(JSON.stringify(descriptor));
 if(req.method==='GET'&&req.url==='/health')return res.end(JSON.stringify({status:lastFailure?'degraded':busy?'working':'ready',lastFailure,lastSuccess}));res.writeHead(404);res.end();});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 async function poll(){if(stopped||busy)return;busy=true;try{
  const count=await escrow.count();
  while(cursor<count&&!stopped){const post=await escrow.at(cursor),inv=await escrow.invocation(post);
   if(inv.state!==1){cursor++;continue;}
   const request=await board.readRequest(post);if(!request||!request.finalized)break;
   if(request.flagged||!request.enabled||request.receiver!==descriptor.scope.receiver){cursor++;continue;}
   await escrow.start(post);cursor++;
   try{await run(post,request.text);lastFailure=null;lastSuccess=new Date().toISOString();}catch(error){failed(error);}
  }
 }catch(error){failed(error);}finally{busy=false;}}
 const timer=setInterval(()=>{if(!busy)inFlight=poll();},pollMs);inFlight=poll();
 return {address:server.address(),async close(){stopped=true;clearInterval(timer);await inFlight;await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}
