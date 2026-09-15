// Transport boundary only. Caller owns binding, TLS/reverse proxy and service lifecycle.
import http from 'node:http';
import { performance } from 'node:perf_hooks';
const routes = Object.freeze({ '/reserve':'reserve', '/submit':'submit', '/retrieve':'retrieve' });
const errors = Object.freeze({
  ISSUER_INVALID_INPUT:400, ISSUER_INVALID_INTEGER:400, ISSUER_INVALID_COMMITMENT:400, ISSUER_INVALID_TOKEN:400,
  ISSUER_INACTIVE_WINDOW:409, ISSUER_EXPIRED:410, ISSUER_WINDOW_BUDGET_EXHAUSTED:409, ISSUER_BATCH_FULL:409,
  ISSUER_RETENTION_LIMIT:503, ISSUER_COMMITMENT_ALREADY_SET:409, ISSUER_BATCH_FROZEN:409,
  ISSUER_COMMITMENT_MISSING:409, ISSUER_NOT_SEALED:409, ISSUER_CLOSED:503,
});
function bounded(value,min,max) { if(!Number.isInteger(value)||value<min||value>max)throw new Error('ISSUER_HTTP_INVALID_CONFIG');return value; }
function origin(value) {
  try { const u=new URL(value);if(u.origin!==value||u.username||u.password||!['https:','http:'].includes(u.protocol))throw 0;return value; }
  catch {throw new Error('ISSUER_HTTP_INVALID_CONFIG');}
}
export function createIssuerHttpServer({issuer,allowedOrigins=[],maxBodyBytes=4096,maxConcurrent=16,
  maxRequestsPerMinute=120,requestTimeoutMs=5000,headerTimeoutMs=5000}={}) {
  if(!issuer||!Object.values(routes).every(method=>typeof issuer[method]==='function')||!Array.isArray(allowedOrigins)||allowedOrigins.length>32)throw new Error('ISSUER_HTTP_INVALID_CONFIG');
  const origins=new Set(allowedOrigins.map(origin));
  bounded(maxBodyBytes,128,8192);bounded(maxConcurrent,1,64);bounded(maxRequestsPerMinute,1,10000);
  bounded(requestTimeoutMs,50,30000);bounded(headerTimeoutMs,50,30000);
  const stats={requests:0,accepted:0,rejected:0,timeouts:0,active:0};let epoch=performance.now(),admissions=0;
  const server=http.createServer({maxHeaderSize:8192,requestTimeout:requestTimeoutMs,headersTimeout:Math.min(headerTimeoutMs,requestTimeoutMs),connectionsCheckingInterval:1000},async(req,res)=>{
    stats.requests++;
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const send=(status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));}};
    const reject=(status,code)=>{stats.rejected++;res.setHeader('Connection','close');send(status,{error:code});req.resume();};
    if(performance.now()-epoch>=60000){epoch=performance.now();admissions=0;}
    if(++admissions>maxRequestsPerMinute||stats.active>=maxConcurrent){reject(429,'ISSUER_RATE_LIMITED');return;}
    if(!Object.hasOwn(routes,req.url)){reject(404,'ISSUER_ROUTE_NOT_FOUND');return;}
    const requestOrigin=req.headers.origin;
    if(requestOrigin!==undefined){
      if(typeof requestOrigin!=='string'||!origins.has(requestOrigin)){reject(403,'ISSUER_ORIGIN_REJECTED');return;}
      res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');
    }
    if(req.method==='OPTIONS'){
      if(!requestOrigin||req.headers['access-control-request-method']!=='POST'||
        (req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).some(x=>x!=='content-type')){reject(403,'ISSUER_ORIGIN_REJECTED');return;}
      res.setHeader('Access-Control-Allow-Methods','POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;
    }
    if(req.method!=='POST'){res.setHeader('Allow','POST, OPTIONS');reject(405,'ISSUER_METHOD_NOT_ALLOWED');return;}
    if(['authorization','cookie','x-aztec-api-key'].some(name=>req.headers[name]!==undefined)){reject(400,'ISSUER_CREDENTIALS_REJECTED');return;}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'')){reject(415,'ISSUER_JSON_REQUIRED');return;}
    if(req.headers['content-encoding']!==undefined && req.headers['content-encoding']!=='identity'){reject(415,'ISSUER_ENCODING_REJECTED');return;}
    const declared=req.headers['content-length'];
    if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>maxBodyBytes)){reject(413,'ISSUER_BODY_TOO_LARGE');return;}
    stats.active++;
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;stats.timeouts++;req.destroy();res.destroy();},requestTimeoutMs);deadline.unref();
    try {
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes){reject(413,'ISSUER_BODY_TOO_LARGE');return;}chunks.push(chunk);}
      let input;
      try {input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
      catch {reject(400,'ISSUER_INVALID_JSON');return;}
      const value=await issuer[routes[req.url]](input);
      if(timedOut)return;
      const bytes=JSON.stringify(value);
      if(Buffer.byteLength(bytes)>8192)throw new Error('Response limit');
      stats.accepted++;send(200,value);
    } catch(error) {
      if(!timedOut){const code=Object.hasOwn(errors,error?.code)?error.code:'ISSUER_UNAVAILABLE';reject(errors[code]??503,code);}
    } finally {clearTimeout(deadline);stats.active--;}
  });
  server.keepAliveTimeout=1000;
  // Invalid HTTP/parser diagnostics are deliberately discarded; never log request bytes.
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('connect',(_req,socket)=>socket.destroy());
  server.on('upgrade',(_req,socket)=>socket.destroy());
  return Object.freeze({server,counters:()=>Object.freeze({...stats})});
}
