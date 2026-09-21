import {isIP} from 'node:net';
import http from 'node:http';
import {decodeJob,MAX_REQUEST_BYTES} from '../shared/remote-prover-wire.mjs';
/** HTTP adapter depends only on queue and board policy APIs. */
export function createProverServer({queue,board,chainId,rollupVersion,proofsEnabled=true,origins=[],requestsPerMinute=6,trustedProxy}){
 const clients=new Map();let uploads=0;
 const server=http.createServer(async(req,res)=>{
  const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  res.setHeader('X-Content-Type-Options','nosniff');
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin)){reply(403,{error:'Origin rejected'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');reply(204,{});return;}
  try{
   if(req.method==='POST'&&req.url==='/v1/jobs'){
    let client=req.socket.remoteAddress;
    if(trustedProxy&&client===trustedProxy){const forwarded=req.headers['x-real-ip'];if(typeof forwarded!=='string'||!isIP(forwarded)){reply(400,{error:'Proxy address required'});return;}client=forwarded;}
    const now=Date.now();
    for(const [key,value] of clients)if(now-value.start>=60000)clients.delete(key);
    const rate=clients.get(client)??{start:now,count:0};
    if(rate.count>=requestsPerMinute||clients.size>=10000||uploads>=8){reply(429,{error:'Rate limited'});return;}
    rate.count++;clients.set(client,rate);
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
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=128;
 return server;
}
