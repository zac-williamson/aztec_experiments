import {createHash,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import http from 'node:http';
import {decodeJob,MAX_REQUEST_BYTES} from '../shared/remote-prover-wire.mjs';
import {COMPACT_GATEWAY_ROUTE} from '../shared/rolling/compact-client.mjs';
/** HTTP adapter depends only on queue and board policy APIs. */
export function createProverServer({serviceMode='prover',queue,board,chainId,rollupVersion,proofsEnabled=true,origins=[],requestsPerMinute=6,compactRequestsPerMinute=600,trustedProxy,privateQuery,operatorAuthSha256}){
 if(!['prover','query-only'].includes(serviceMode)||(serviceMode==='query-only'&&(!privateQuery||queue!==undefined||board!==undefined||proofsEnabled!==true)))throw Error('Invalid service mode');
 const queryOnly=serviceMode==='query-only';
 if(operatorAuthSha256!==undefined&&(!queryOnly||typeof operatorAuthSha256!=='string'||!/^[0-9a-f]{64}$/.test(operatorAuthSha256)))throw Error('Invalid query operator authentication');
 const operatorDigest=operatorAuthSha256===undefined?undefined:Buffer.from(operatorAuthSha256,'hex');
 if(!Number.isSafeInteger(compactRequestsPerMinute)||compactRequestsPerMinute<1||compactRequestsPerMinute>6000)throw Error('Invalid compact read rate');
 const clients=new Map();let uploads=0;
 const active=new Set();let closing;
 const handle=async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  res.setHeader('X-Content-Type-Options','nosniff');
  // This opt-in exposes exactly one authenticated operator route. Check raw
  // header occurrences, not Node's merged header map, before consuming a body
  // or entering any inspector. Neither the key nor its digest is forwarded.
  if(operatorDigest){
   const reject=status=>{res.setHeader('Connection','close');res.once('finish',()=>req.socket.destroy());reply(status,{error:'Operator request rejected'});};
   if(req.method!=='POST'||req.url!=='/v1/node'){reject(404);return;}
   const keys=[];for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()==='x-aztec-api-key')keys.push(req.rawHeaders[i+1]);
   if(keys.length!==1||typeof keys[0]!=='string'||!/^[0-9a-f]{64}$/.test(keys[0])||!timingSafeEqual(createHash('sha256').update(keys[0],'ascii').digest(),operatorDigest)){reject(401);return;}
  }
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin)){reply(403,{error:'Origin rejected'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');reply(204,{});return;}
  const admit=(compact=false)=>{
   let client=req.socket.remoteAddress;
   if(trustedProxy&&client===trustedProxy){const forwarded=req.headers['x-real-ip'];if(typeof forwarded!=='string'||!isIP(forwarded)){reply(400,{error:'Proxy address required'});return;}client=forwarded;}
   const now=Date.now();
   for(const [key,value] of clients)if(now-value.start>=60000)clients.delete(key);
   const rate=clients.get(client)??{start:now,count:0,compactCount:0,compactRequests:0};
   const counter=compact?'compactCount':'count',limit=compact?compactRequestsPerMinute:requestsPerMinute;
   if(rate[counter]>=limit||(compact&&rate.compactRequests>=limit)||clients.size>=10000||uploads>=8){reply(429,{error:'Rate limited'});return;}
   rate[counter]++;if(compact)rate.compactRequests++;clients.set(client,rate);
   if(!compact)return client;
   // One request unit is charged even for malformed input. Page parsing can
   // reserve its remaining physical-block bound once, before any upstream read.
   // Keep the original admission bucket across a minute-boundary/body await.
   let reserved=false,settled=false,units=1;
   return Object.freeze({
    reserveAdditional(additional){
     if(reserved||!Number.isSafeInteger(additional)||additional<0||additional>255)return false;
     reserved=true;if(rate.compactCount+additional>limit)return false;
     units+=additional;rate.compactCount+=additional;return true;
    },
    settleUsed(used){
     // Only the trusted gateway can settle this capability, after a successful
     // response finish. Never look up a replacement bucket or refund requests.
     if(settled||!reserved||!res.writableFinished||res.statusCode!==200)return false;
     settled=true;
     if(!Number.isSafeInteger(used)||used<1||used>units)return false;
     rate.compactCount-=units-used;return true;
    },
   });
  };
  try{
   if(req.method==='GET'&&req.url==='/healthz'){reply(200,queryOnly?{ready:true,serviceMode:'query-only',proofs:'not-offered',nodeProofs:'real',queue:null,query:await privateQuery.health()}:{ready:true,proofs:proofsEnabled?'real':'disabled',queue:queue.stats(),query:privateQuery?await privateQuery.health():{enabled:false,ready:false}});return;}
   if(req.method==='POST'&&req.url==='/v1/node'&&privateQuery){await privateQuery.handle(req,res);return;}
   if(req.url===COMPACT_GATEWAY_ROUTE&&privateQuery?.handleCompact){const reserve=admit(true);if(reserve===undefined)return;await privateQuery.handleCompact(req,res,reserve);return;}
   // No request body decoding, queue lookup or proof admission in this mode.
   if(queryOnly&&(req.url==='/v1/jobs'||req.url.startsWith('/v1/jobs/'))){
    res.setHeader('Connection','close');res.once('finish',()=>req.socket.destroy());reply(404,{error:'Proof service not offered'});return;
   }
   if(req.method==='POST'&&req.url==='/v1/jobs'){
    const client=admit();if(client===undefined)return;
    if(req.headers['content-type']!=='application/octet-stream'){reply(415,{error:'Binary job required'});return;}
    uploads++;let body;
    try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST_BYTES)throw Object.assign(Error(),{status:413});chunks.push(chunk);}body=Buffer.concat(chunks);}finally{uploads--;}
    const {metadata}=decodeJob(body);
    if(metadata.board!==board||String(metadata.chainId)!==String(chainId)||String(metadata.rollupVersion)!==String(rollupVersion)||metadata.mode!==(proofsEnabled?'real':'disabled')){reply(403,{error:'Board or proof mode mismatch'});return;}
    const id=await queue.submit(body,client);reply(202,{id});return;
   }
   const match=/^\/v1\/jobs\/([a-f0-9]{64})$/.exec(req.url);
   if(req.method==='GET'&&match){const job=queue.get(match[1]);reply(job?200:404,job??{error:'Job expired'});return;}
   reply(404,{error:'Not found'});
  }catch(error){reply(error.status??400,{error:'Request rejected'});}
 };
 const server=http.createServer((req,res)=>{
  if(closing){req.destroy();return;}
  const pending=handle(req,res);active.add(pending);
  void pending.finally(()=>active.delete(pending)).catch(()=>res.destroy());
 });
 // Listener closure alone does not settle an already admitted SDK upstream
 // request. Await all handler promises (including query/health/compact calls);
 // their existing transport deadlines remain in force. No retry or new calls
 // are admitted after closure starts.
 server.closeAndDrain=()=>closing??=(async()=>{
  const stopped=new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
  server.closeAllConnections();
  await Promise.all([stopped,Promise.allSettled([...active])]);
 })();
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=128;
 return server;
}
