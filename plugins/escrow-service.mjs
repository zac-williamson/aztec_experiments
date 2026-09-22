import http from 'node:http';
/** On-chain state owns work. The bounded in-memory queue never resumes paid calls. */
export async function startEscrowService({descriptor,escrow,board,run,host='127.0.0.1',port=8787,onError=console.error,pollMs=2000,concurrency=2}){
 if(!Number.isSafeInteger(concurrency)||concurrency<1||concurrency>16)throw Error('Invalid service concurrency');
 let stopped=false,polling=false,cursor=0,inFlight=Promise.resolve(),lastFailure=null,lastSuccess=null;
 const jobs=new Map(),deferred=new Set();
 const failed=error=>{lastFailure={at:new Date().toISOString(),kind:error.name||'Error'};onError(error);};
 const server=http.createServer((req,res)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/v1/descriptor')return res.end(JSON.stringify(descriptor));
 if(req.method==='GET'&&req.url==='/health')return res.end(JSON.stringify({status:lastFailure?'degraded':jobs.size?'working':'ready',active:jobs.size,lastFailure,lastSuccess}));res.writeHead(404);res.end();});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 async function visit(index){
  const post=await escrow.at(index),inv=await escrow.invocation(post);
  if(inv.state!==1||jobs.has(post)){deferred.delete(index);return;}
  const account=String(inv.account),sameAccount=[...jobs.values()].filter(job=>job.account===account);
  // Wait for existing collateral to be released. New deposits can fund another job;
  // there is no one-invocation-per-account rule in the service or the contract.
  if(sameAccount.length){
   if(await escrow.available(post)===0n){deferred.add(index);return;}
   for(const job of sameAccount)if((await escrow.invocation(job.post)).reserved===0n){deferred.add(index);return;}
  }
  const request=await board.readRequest(post);
  if(!request||!request.finalized){deferred.add(index);return;}
  if(request.flagged||!request.enabled||request.receiver!==descriptor.scope.receiver){deferred.delete(index);return;}
  deferred.delete(index);
  const job={post,account,promise:null};jobs.set(post,job);
  job.promise=(async()=>{try{await escrow.start(post);await run(post,request.text);lastFailure=null;lastSuccess=new Date().toISOString();}catch(error){deferred.add(index);failed(error);}finally{jobs.delete(post);}})();
 }
 async function poll(){if(stopped||polling)return;polling=true;try{
  // Rotate deferred entries, then scan new entries so one empty account cannot
  // block unrelated users. Bound reads per tick without retaining a billing DB.
  for(const index of [...deferred].slice(0,64)){
   if(stopped||jobs.size>=concurrency)break;
   deferred.delete(index);deferred.add(index);await visit(index);
  }
  const count=await escrow.count();let scanned=0;
  while(cursor<count&&!stopped&&jobs.size<concurrency&&scanned++<64){const index=cursor;deferred.add(index);await visit(index);cursor++;}
 }catch(error){failed(error);}finally{polling=false;}}
 const timer=setInterval(()=>{if(!polling)inFlight=poll();},pollMs);inFlight=poll();
 return {address:server.address(),async close(){stopped=true;clearInterval(timer);await inFlight;await Promise.all([...jobs.values()].map(job=>job.promise));await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}
