import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createOperatorAuth} from './auth.mjs';
import {buildReliability} from './monitor.mjs';

const publicRoot=new URL('./public/',import.meta.url);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const assets=new Map([['/_ops/',['index.html','text/html; charset=utf-8']],['/_ops/app.mjs',['app.mjs','text/javascript']],['/_ops/style.css',['style.css','text/css']],['/_ops/font.woff2',['font.woff2','font/woff2']]]);
async function readSnapshot(path){if(!path)return null;try{if((await stat(path)).size>1048576)return null;return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
const unavailable=()=>({status:'unknown',observedAt:null,checks:[],hosts:[],message:'No observation has arrived yet.'});
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
async function body(req){let total=0;const chunks=[];for await(const chunk of req){total+=chunk.length;if(total>32768)throw Error('Too large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString());}
export function createOpsServer({config,analytics,auth=createOperatorAuth(config.auth),reliability,now=Date.now}){
 let tokens=120,last=now();
 const admit=()=>{const time=now();tokens=Math.min(120,tokens+Math.max(0,time-last)*.01);last=time;if(tokens<1)return false;tokens--;return true;};
 const server=http.createServer(async(req,res)=>{
  for(const [key,value]of Object.entries(headers))res.setHeader(key,value);
  let url;try{url=new URL(req.url,config.auth.origin);if(req.url.length>2048)throw Error();}catch{return json(res,400,{error:'invalid_request'});}
  try{
   if(url.pathname==='/_ops/events'){
    if(req.method!=='POST')return json(res,405,{error:'method'});
    if(req.headers.origin!==config.auth.origin||req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return json(res,403,{error:'origin'});
    if(!admit())return json(res,429,{error:'capacity'});
    if(Number(req.headers['content-length'])>32768)return json(res,413,{error:'size'});
    try{analytics.ingest(await body(req));return json(res,202,{accepted:true});}catch{return json(res,400,{error:'invalid_event'});}
   }
   if(url.pathname==='/_ops/health'&&req.method==='GET')return json(res,200,{status:'ready',version:config.revision||'unversioned'});
   if(await auth.handle(req,res,url))return;
   if(url.pathname==='/_ops'){res.writeHead(308,{Location:'/_ops/'});res.end();return;}
   const user=auth.identity(req);
   if(!user){
    if(url.pathname.startsWith('/_ops/api/'))return json(res,401,{error:'sign_in_required'});
    if(url.pathname==='/_ops/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rolling · Operations</title><link rel="stylesheet" href="/_ops/style.css"><main class="signin"><div class="brand">rolling<span>chat</span></div><h1>Your view of Rolling.</h1><p>Growth, reliability and releases. Access is by invitation.</p><a class="button primary" href="/_ops/auth/login">Sign in</a><p class="muted">Operator accounts are separate from anonymous board activity.</p></main></html>');return;}
    if(url.pathname!=='/_ops/style.css'&&url.pathname!=='/_ops/font.woff2')return json(res,401,{error:'sign_in_required'});
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method'});
   if(url.pathname==='/_ops/api/me')return json(res,200,{email:user.email,admin:user.admin,revision:config.revision||null});
   if(url.pathname==='/_ops/api/growth'){
    const end=new Date(now()).toISOString().slice(0,10),start=new Date(now()-(url.searchParams.get('days')==='30'?29:6)*86400000).toISOString().slice(0,10);
    return json(res,200,analytics.summary({from:start,to:end}));
   }
   if(url.pathname==='/_ops/api/reliability')return json(res,200,reliability?await reliability():buildReliability({...await readSnapshot(config.reliabilityInputsFile),now:now()}));
   if(url.pathname==='/_ops/api/releases'){
    const state=await readSnapshot(config.releasesFile);
    return json(res,200,releaseSummary(state));
   }
   if(url.pathname==='/_ops/api/access')return json(res,200,{method:'Invitation only; password and authenticator app',manageUrl:config.accessUrl||null});
   const asset=assets.get(url.pathname);if(!asset)return json(res,404,{error:'not_found'});
   const data=await readFile(new URL(asset[0],publicRoot));res.writeHead(200,{'Content-Type':asset[1]});res.end(req.method==='HEAD'?undefined:data);
  }catch{return json(res,503,{error:'temporarily_unavailable'});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
 return server;
}
async function main(){
 const filename=process.argv[2];if(!filename)throw Error('A private configuration path is required');
 const config=JSON.parse(await readFile(filename,'utf8'));
 const {openAnalyticsStore}=await import('./analytics.mjs');const analytics=openAnalyticsStore({filename:config.database,...(config.campaigns?{campaigns:config.campaigns}:{})});
 const server=createOpsServer({config,analytics});server.listen(config.port||4320,'127.0.0.1',()=>process.stdout.write('Rolling operations ready\n'));
 process.on('SIGTERM',()=>server.close(()=>{analytics.close();process.exit(0);}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{process.stderr.write('Operations configuration or startup failed\n');process.exitCode=1;});

const releaseStates=new Set(['pending','running','passed','failed','blocked','ready','deployed','rolled_back','not_configured','staged','verified']);
const revision=value=>{const r=typeof value==='string'?value:value?.revision;return typeof r==='string'&&/^[a-f0-9]{40}$/.test(r)?r:null;};
const stageNames=new Set(['build','tests','prepare','staging','journey','promote','live','rollback','verify','stage','gate','smoke']);
export function releaseSummary(state){
 const rows=Array.isArray(state?.stages)?state.stages:Object.entries(state?.stages||{}).map(([name,v])=>({name,...v}));
 return {status:releaseStates.has(state?.status)?state.status:'not_configured',current:revision(state?.current),previous:revision(state?.previous),candidate:revision(state?.candidate),stages:rows.filter(s=>stageNames.has(s?.name)&&releaseStates.has(s?.status)).map(s=>({name:s.name,status:s.status})),updatedAt:typeof state?.updatedAt==='string'&&Number.isFinite(Date.parse(state.updatedAt))?new Date(state.updatedAt).toISOString():null,workflow:'https://github.com/zac-williamson/aztec_experiments/actions/workflows/rolling-release.yml',message:state?'':'No release has run through this pipeline yet.'};
}
