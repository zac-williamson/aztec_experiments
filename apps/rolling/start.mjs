import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {startRollingPublicServer,createRollingPublicIndexFromConfig} from '../../scripts/rolling-public-server.mjs';
import {loadRollingWalletAssets} from '../../scripts/rolling-wallet-assets.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const files=new Map([['/archive/','archive.html'],['/archive/snapshot.json','archive.json'],['/','live.html'],['/reader.mjs','reader.mjs'],['/reader-client.mjs','reader-client.mjs'],['/feed-ranking.mjs','feed-ranking.mjs'],['/home-reader.mjs','home-reader.mjs'],['/feed-preferences.mjs','feed-preferences.mjs'],['/profile-view.mjs','profile-view.mjs'],['/avatar-upload.mjs','avatar-upload.mjs'],
 ['/performance.mjs','performance.mjs'],['/reader-updates.mjs','reader-updates.mjs'],['/wallet-action.mjs','wallet-action.mjs'],['/model.mjs','model.mjs'],['/navigation.mjs','navigation.mjs'],['/style.css','style.css'],['/wallet-panel.mjs','wallet-panel.mjs'],['/wallet-cache-worker.mjs','wallet-cache-worker.mjs'],
 // Brand assets: self-hosted font, icons, social card and manifest. No network fonts under the CSP.
 ['/fonts/DMSans-latin.woff2','fonts/DMSans-latin.woff2'],['/fonts/DMSans-latin-ext.woff2','fonts/DMSans-latin-ext.woff2'],['/fonts/OFL.txt','fonts/OFL.txt'],['/favicon.svg','favicon.svg'],['/favicon-32.png','favicon-32.png'],['/apple-touch-icon.png','apple-touch-icon.png'],['/icon-192.png','icon-192.png'],['/icon-512.png','icon-512.png'],['/og.png','og.png'],['/site.webmanifest','site.webmanifest']]);
const staticTypes={'.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
const compress=promisify(gzip),MAX_ASSET_BYTES=128*1024*1024,MAX_CACHE_BYTES=64*1024*1024,MAX_RESPONSE_BYTES=128*1024*1024;
// Only gzip and identity are emitted. Explicit exclusions win over wildcards;
// malformed or contradictory weights are not interpreted as permission.
function walletEncoding(header){
 if(header===undefined)return 'identity';
 if(typeof header!=='string'||header.length>1024)return null;
 if(header.trim()==='')return 'identity';
 const entries=header.split(',');if(entries.length>16)return null;const weights=new Map();
 for(const entry of entries){
  const match=entry.trim().match(/^([A-Za-z0-9!#$%&'*+.^_`|~-]+)(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?$/i);
  if(!match)return null;const token=match[1].toLowerCase(),weight=match[2]===undefined?1:Number(match[2]);
  weights.set(token,Math.min(weights.get(token)??1,weight));
 }
 const gz=weights.get('gzip')??weights.get('*')??0;
 const identity=weights.get('identity')??(weights.get('*')===0?0:1);
 return gz>0&&gz>=identity?'gzip':identity>0?'identity':null;
}
// One wallet read/compression at a time, with 32 bounded waiters to admit the
// installed BB runtime's 31-worker burst. Outgoing responses have separate byte
// ownership and deadlines; a slow reader cannot pin this work slot.
function walletAdmission(){
 let active=false;const waiters=[];
 const release=()=>{for(;;){const next=waiters.shift();if(!next){active=false;return;}next.res.off('close',next.closed);if(!next.res.destroyed){next.resolve(release);return;}next.resolve(null);}};
 return res=>{
  if(res.destroyed)return Promise.resolve(null);
  if(!active){active=true;return Promise.resolve(release);}
  if(waiters.length>=32)return Promise.resolve(null);
  return new Promise(resolve=>{const entry={res,resolve,closed:()=>{const i=waiters.indexOf(entry);if(i>=0){waiters.splice(i,1);resolve(null);}}};waiters.push(entry);res.once('close',entry.closed);});
 };
}
async function sendAsset(res,status,headers,body){
 if(res.destroyed)return;
 await new Promise((resolve,reject)=>{
  const done=()=>{res.off('finish',done);res.off('close',done);res.off('error',failed);resolve();};
  const failed=error=>{res.off('finish',done);res.off('close',done);res.off('error',failed);reject(error);};
  res.once('finish',done);res.once('close',done);res.once('error',failed);
  try{res.writeHead(status,headers);res.end(body);}catch(error){failed(error);}
 });
}
export function createRollingReaderAssetHandler(wallet){
 const admit=walletAdmission(),cache=new Map();let cacheBytes=0,responseBytes=0;
 const selectedHeaders=wallet?{...headers,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':`default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' data: ${wallet.connectOrigins.join(' ')}; worker-src 'self' blob:; img-src 'self' blob: data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`}:headers;
 return async function(req,res){
 const reply=(status,body='')=>{res.writeHead(status,selectedHeaders);res.end(body);};
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');reply(405);return;}
 const url=new URL(req.url,'http://127.0.0.1'),file=files.get(url.pathname);
 const pinned=/^\?sha256=([a-f0-9]{64})$/.exec(url.search)?.[1];
 if(wallet&&(!url.search||pinned&&url.pathname!=='/wallet/runtime.json')&&(url.pathname.startsWith('/wallet/')||url.pathname.startsWith('/crs/'))){
  const encoding=walletEncoding(req.headers['accept-encoding']);
  if(!encoding){res.setHeader('Vary','Accept-Encoding');reply(406);return;}
  const release=await admit(res);if(!release){if(!res.destroyed){res.setHeader('Retry-After','1');reply(503);}return;}
  let released=false;
  try{
   if(res.destroyed)return;const asset=await wallet.read(url.pathname);
   if(!asset){reply(404);return;}
   if(!Buffer.isBuffer(asset.body)||asset.body.length>MAX_ASSET_BYTES)throw Error('Invalid wallet asset size');
   let body=asset.body;
   const key=createHash('sha256').update(body).digest('hex');
   if(pinned&&pinned!==key){reply(404);return;}
   if(encoding==='gzip'){
    // Validate the current decoded file on every read; cache keys bind bytes,
    // not only URL, so changed artifacts cannot reuse a stale representation.
    const saved=cache.get(key);
    if(saved){cache.delete(key);cache.set(key,saved);body=saved;}
    else{
     body=await compress(body,{level:6,maxOutputLength:MAX_ASSET_BYTES});
     if(body.length<=MAX_CACHE_BYTES){
      while(cache.size&&(cache.size>=32||cacheBytes+body.length>MAX_CACHE_BYTES)){const oldest=cache.keys().next().value;cacheBytes-=cache.get(oldest).length;cache.delete(oldest);}
      cache.set(key,body);cacheBytes+=body.length;
     }
    }
   }
   // Only hash-verified, account-independent SDK bytes may be shared by an edge cache.
   const outgoing=req.method==='HEAD'?0:body.length;
   if(responseBytes+outgoing>MAX_RESPONSE_BYTES){res.setHeader('Retry-After','1');reply(503);return;}
   responseBytes+=outgoing;
   const response=sendAsset(res,200,{...selectedHeaders,...(pinned?{'Cache-Control':`public, max-age=31536000, immutable`}:{}),'Content-Type':asset.type,'Vary':'Accept-Encoding','Content-Length':String(body.length),...(encoding==='gzip'?{'Content-Encoding':'gzip'}:{})},req.method==='HEAD'?undefined:body).finally(()=>{responseBytes-=outgoing;});
   // The read/compressor has finished. Response bytes remain owned until the
   // socket finishes/closes/errors; elapsed transfer time does not truncate assets.
   release();released=true;await response;return;
  }finally{if(!released)release();}
 }
 if(!file||url.search){reply(404);return;}
 const body=await fs.readFile(path.join(root,file));
 res.writeHead(200,{...selectedHeaders,'Content-Type':staticTypes[path.extname(file)]??'text/html; charset=utf-8'});
 res.end(req.method==='HEAD'?undefined:body);
 };
}
export const serveRollingReaderAsset=createRollingReaderAssetHandler();
export function startRollingReader({index,port=0,wallet,fundingRelay,savedItems,savedItemsDirectory}){
 return startRollingPublicServer({index,port,fundingRelay,savedItems,savedItemsDirectory,staticHandler:createRollingReaderAssetHandler(wallet)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(![3,4,5].includes(process.argv.length))throw Error('A public deployment configuration and optional wallet configuration are required');
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const wallet=process.argv[3]?await loadRollingWalletAssets(JSON.parse(await fs.readFile(process.argv[3],'utf8')),config.scope):undefined;
  const index=await createRollingPublicIndexFromConfig(config);
  let fundingRelay;try{if(process.argv[4]){const {openRollingFundingRelay}=await import('../../plugins/rolling-funding-relay.mjs');fundingRelay=await openRollingFundingRelay(JSON.parse(await fs.readFile(process.argv[4],'utf8')));}}catch(error){await index.index.close?.();throw error;}
  const server=await startRollingReader({...index,wallet,fundingRelay});
  process.stdout.write(JSON.stringify({rollingChatUrl:server.url,scope:wallet?'Public reader with private account actions':'Public reader; wallet deployment not configured'})+'\n');
  let closing=false;
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;server.close().then(()=>process.exit(0),()=>process.exit(1));});
 }catch{process.stderr.write('Rolling Chat could not start. Check the public deployment configuration and node.\n');process.exitCode=1;}
}
