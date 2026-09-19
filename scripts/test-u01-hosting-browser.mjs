// Disposable local TLS + actual static release rehearsal. Serial execution only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium,firefox,webkit} from 'playwright';
import {build} from 'esbuild';
import {polyfillNode} from 'esbuild-plugin-polyfill-node';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
const [browserEngine,...args]=process.argv.slice(2);assert(['chromium','firefox','webkit'].includes(browserEngine),'Explicit browser engine required');const selectedBrowser={chromium,firefox,webkit}[browserEngine];
const withCrs=args.includes('--with-crs');const positional=args.filter(arg=>arg!=='--with-crs');if(positional.length>1)throw Error('Usage: test-u01-hosting-browser.mjs ENGINE [CADDY] [--with-crs]');const caddy=path.resolve(positional[0]||path.join(ROOT,'.build/caddy-2.11.4/caddy'));const leafDeadlineMs=120000;
assert.match(execFileSync(caddy,['version'],{encoding:'utf8'}),/^v2\.11\.4 /);
const dir=fs.mkdtempSync(path.join(process.env.BILLBOARD_TEST_TMPDIR||os.tmpdir(),'bb-https-'));let child,browser,context,publicCapabilities,walletReadiness,passed=false,sourceStage='startup';const cspBlocked=[];
const timeout=setTimeout(()=>{child?.kill('SIGKILL');void browser?.close().catch(()=>{});process.exitCode=1;},leafDeadlineMs);
const request=(port,url,headers={})=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:url,rejectUnauthorized:false,headers,timeout:5000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));});req.on('timeout',()=>req.destroy(Error('TLS request timeout')));req.on('error',reject);});
try{
 const historyBundle=path.join(dir,'history.js');
 await build({absWorkingDir:ROOT,entryPoints:['scripts/browser-history-entry.mjs'],outfile:historyBundle,bundle:true,platform:'browser',target:'es2022',format:'iife',mainFields:['browser','module','main'],conditions:['browser'],plugins:[polyfillNode()],alias:{'msgpackr/index-no-eval':'msgpackr/index-no-eval','msgpackr/unpack-no-eval':'msgpackr/unpack-no-eval','msgpackr':'msgpackr/index-no-eval','msgpackr/pack':'msgpackr/index-no-eval','msgpackr/unpack':'msgpackr/index-no-eval'},define:{'process.env.NODE_ENV':'"production"','process.env.LOG_LEVEL':'"silent"'},logLevel:'warning'});
 const historyBundleHash=createHash('sha256').update(fs.readFileSync(historyBundle)).digest('hex');
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:15000});
 const config=generateHosting({dist:path.join(ROOT,'apps/dist'),site:'https://127.0.0.1:'+port,certificate:cert,key,local:true,origins:[]});const file=path.join(dir,'Caddyfile');fs.writeFileSync(file,config.caddyfile);
 execFileSync(caddy,['validate','--config',file,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir},stdio:'pipe',timeout:10000});
 child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir},stdio:'ignore'});
 let result;for(let i=0;i<50;i++){try{result=await request(port,'/feed.html');break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.equal(result?.status,200);
 assert.equal(result.headers['cross-origin-opener-policy'],'same-origin');assert.equal(result.headers['cross-origin-embedder-policy'],'require-corp');assert.equal(result.headers['x-content-type-options'],'nosniff');assert(result.headers['content-security-policy'].includes("frame-ancestors 'none'"));
 for(const url of ['/','/crs/','/.env','/../shared/rpc-config.json','/sdk-manifest.json.map','/apps/src/billboard/user/engine.js']){const r=await request(port,url);assert.equal(r.status,url==='/'?302:404);}
 const wasm=await request(port,'/acvm_js_bg.wasm',{Range:'bytes=0-7'});assert.equal(wasm.status,206);assert.equal(wasm.headers['content-encoding'],undefined);assert.equal(wasm.body.length,8);assert.match(wasm.headers['content-type'],/application\/wasm/);assert.equal(wasm.body.subarray(0,4).toString('hex'),'0061736d');
 const js=await request(port,'/bb-main.worker.js',{Range:'bytes=0-7'});assert.equal(js.status,206);assert.match(js.headers['content-type'],/(javascript|ecmascript)/);
 sourceStage='compressed-sdk-response';const compressedSdk=await request(port,'/aztec_bundle.js',{'Accept-Encoding':'gzip'});assert.equal(compressedSdk.status,200);assert.equal(compressedSdk.headers['content-encoding'],'gzip');const decodedSdk=gunzipSync(compressedSdk.body),sdkFile=fs.readFileSync(path.join(ROOT,'apps/dist/aztec_bundle.js'));assert.equal(createHash('sha256').update(decodedSdk).digest('hex'),createHash('sha256').update(sdkFile).digest('hex'));const sdkTransfer={encoding:'gzip',compressedBytes:compressedSdk.body.length,decodedBytes:decodedSdk.length,decodedHashMatchesBuild:true};
 context=await selectedBrowser.launchPersistentContext(path.join(dir,'profile'),{headless:true,ignoreHTTPSErrors:true,acceptDownloads:true,...(browserEngine==='chromium'?{args:['--js-flags=--max-old-space-size=768']}:{})});browser=context.browser();assert(browser);const externalRequests=[];await context.route('**/*',route=>{const url=route.request().url();if(/^https?:/.test(url)&&new URL(url).origin!=='https://127.0.0.1:'+port){externalRequests.push(new URL(url).origin);return route.abort();}return route.continue();});const requestedPaths=new Set();context.on('request',request=>{if(request.url().startsWith('https://127.0.0.1:'+port))requestedPaths.add(new URL(request.url()).pathname);});await context.exposeBinding('recordHostingCsp',(_source,value)=>cspBlocked.push(value));await context.addInitScript(()=>{addEventListener('securitypolicyviolation',event=>{let blocked;try{const u=new URL(event.blockedURI);blocked=['http:','https:'].includes(u.protocol)?u.origin:u.protocol;}catch{blocked=['inline','eval'].includes(event.blockedURI)?event.blockedURI:'other';}void globalThis.recordHostingCsp({directive:event.effectiveDirective,blocked});});});const page=await context.newPage();page.setDefaultTimeout(20000);const violations=[];page.on('console',m=>{if(/Content Security Policy|Refused to/.test(m.text()))violations.push(m.text().slice(0,200));});
 sourceStage='public-page';await page.goto('https://127.0.0.1:'+port+'/feed.html');
 publicCapabilities=await page.evaluate(()=>({secure:isSecureContext,isolated:crossOriginIsolated,shared:typeof SharedArrayBuffer,opfs:typeof navigator.storage?.getDirectory,writable:typeof globalThis.FileSystemFileHandle?.prototype.createWritable,worker:typeof Worker}));
 sourceStage='public-wasm';
 const wasmCompiled=await page.evaluate(async()=>{
  const response=await fetch('/acvm_js_bg.wasm');
  return (await WebAssembly.compile(await response.arrayBuffer())) instanceof WebAssembly.Module;
 });
 assert.equal(wasmCompiled,true);
 sourceStage='public-worker';
 const workerShared=await page.evaluate(async()=>{
  const url=URL.createObjectURL(new Blob(['postMessage(typeof SharedArrayBuffer)'],{type:'text/javascript'}));
  let worker;
  try{worker=new Worker(url);return await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('worker timeout')),5000);
   worker.onmessage=event=>{clearTimeout(timer);resolve(event.data);};
   worker.onerror=error=>{clearTimeout(timer);reject(error);};
  });}finally{worker?.terminate();URL.revokeObjectURL(url);}
 });
 const checks={...await page.evaluate(()=>({secure:isSecureContext,isolated:crossOriginIsolated,shared:typeof SharedArrayBuffer,publicLoaded:!!globalThis.BillboardPublic})),wasm:wasmCompiled,worker:workerShared};
 assert.deepEqual(checks,{secure:true,isolated:true,shared:'function',wasm:true,worker:'function',publicLoaded:true});assert.deepEqual(violations,[]);
 const sdkStart=Date.now();sourceStage='wallet-page';await page.goto('https://127.0.0.1:'+port+'/user.html');
 await page.waitForFunction(()=>globalThis.__aztec?.Barretenberg && globalThis.BillboardReadiness && document.getElementById('wbAztecGenBtn'));
 const sdkNavigationReadyMs=Date.now()-sdkStart;let crsMeasurement=null;
 if(withCrs){sourceStage='cold-crs-initialization';crsMeasurement=await page.evaluate(async()=>{const manifest=globalThis.BILLBOARD_CRS_MANIFEST,records=[];const original=crypto.subtle.digest.bind(crypto.subtle),originalInitialize=BillboardCRS.initialize;let initializedInstance;const bn254Inputs=[];BillboardCRS.initialize=(bb,options)=>{initializedInstance=bb;const observed=new Proxy(bb,{get(target,property){if(property==='srsInitSrs')return args=>{bn254Inputs.push({bytes:args.pointsBuf.byteLength,numPoints:args.numPoints});return target.srsInitSrs(args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});return originalInitialize(observed,options);};let digestMs=0;crypto.subtle.digest=async function(algorithm,data){const begin=performance.now(),result=await original(algorithm,data);digestMs+=performance.now()-begin;records.push({bytes:data.byteLength,sha256:Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('')});return result;};const begin=performance.now();try{await makeInitCRS()();}finally{crypto.subtle.digest=original;BillboardCRS.initialize=originalInitialize;}const actual=__aztec.Barretenberg.getSingleton();if(actual!==initializedInstance||actual.options.backend!=='WasmWorker'||actual.options.threads!==1||actual.options.skipSrsInit!==true)throw Error('Actual CRS prover instance or policy mismatch');if(bn254Inputs.length!==1||bn254Inputs[0].numPoints!==524288||bn254Inputs[0].bytes!==524288*64)throw Error('Actual BN254 initialization budget mismatch');const assets=[manifest.derivedG1,...manifest.files].filter(asset=>records.some(record=>record.bytes===asset.bytes&&record.sha256===asset.sha256));if(!assets.some(asset=>asset.name==='g1_uncompressed.dat')||!assets.some(asset=>asset.name==='g2.dat')||!assets.some(asset=>asset.name==='grumpkin_g1.dat'))throw Error('Actual verified CRS hash observations incomplete');return {coldBrowserContext:true,actualCrsSingletonVerified:true,bn254Inputs,provingThreads:1,skipAutomaticSrs:true,adapter:'makeInitCRS -> initializeBrowserProver (actual async worker)',totalInitializationMs:Math.round(performance.now()-begin),sha256Ms:Math.round(digestMs),verifiedAssets:assets.map(({name,bytes,numPoints,sha256,format})=>({name,bytes,numPoints,sha256,format})),note:'Total includes fetch, hashing and actual SRS initialization; hashing timing is separately observed.'};});}
 sourceStage='wallet-readiness';
 walletReadiness=await page.evaluate(async()=>{try{await BillboardReadiness.check();return {ready:true};}catch(error){return {ready:false,code:error.code};}});
 assert.equal(walletReadiness.ready,true);
 sourceStage='private-worker-storage-initialization';const privateChecks=await page.evaluate(async withCrs=>{
   await BillboardReadiness.check();const a=globalThis.__aztec;
   if(withCrs){const actual=a.Barretenberg.getSingleton();if(actual.options.backend!=='WasmWorker'||actual.options.threads!==1||actual.options.skipSrsInit!==true)throw Error('Unexpected application prover policy');}
   else{const worker=await a.Barretenberg.new({threads:1,skipSrsInit:true});await worker.destroy();}
   const log={debug(){},info(){},warn(){},error(){}};
   const store=await a.AztecSQLiteOPFSStore.open(log,'https-hosting-smoke',true);let stored;
   try{const map=store.openMap('probe');await map.set('key','value');stored=await map.getAsync('key');}finally{await store.close();}
   return {ready:true,privateWorkersInitialized:true,sqlite:stored,isolated:crossOriginIsolated};
 },withCrs);
 assert.deepEqual(privateChecks,{ready:true,privateWorkersInitialized:true,sqlite:'value',isolated:true});
 sourceStage='persisted-note-history';
 await page.route('**/__test-history.js',route=>route.fulfill({path:historyBundle,contentType:'application/javascript'}));
 await page.addScriptTag({url:'https://127.0.0.1:'+port+'/__test-history.js'});
 const history=await page.evaluate(()=>globalThis.checkBrowserHistory());assert.equal(history.passed,true);
 sourceStage='encrypted-wallet-create';const password='disposable-https-hosting-password';await page.locator('#wbPassword').fill(password);await page.locator('#wbPasswordConfirm').fill(password);
 const downloaded=page.waitForEvent('download');await page.locator('#wbAztecGenBtn').click();const walletDownload=await downloaded;await page.waitForFunction(()=>window.walletState.aztec?.address);
 const encrypted=JSON.parse(fs.readFileSync(await walletDownload.path(),'utf8'));assert.equal(encrypted.kind,'aztec-billboard-encrypted-wallet');assert(!Object.hasOwn(encrypted,'secretKey'));
 await page.evaluate(async()=>{await globalThis.__aztec.Barretenberg.destroySingleton();await globalThis.__aztec.BarretenbergSync.destroySingleton();});
 for(const asset of ['/bb-main.worker.js','/sqlite.worker.js','/sqlite3.wasm'])assert(requestedPaths.has(asset),'Actual private worker asset not requested: '+asset);
 assert(!requestedPaths.has('/bb-thread.worker.js'),'One-thread prover must not request an auxiliary BB worker');
 assert.deepEqual(externalRequests,[]);assert.deepEqual(violations,[]);assert.deepEqual(cspBlocked,[]);
 console.log(JSON.stringify({passed:true,browserEngine,browserVersion:browser.version(),profile:'fresh disposable persistent normal profile',sdkTransfer,leafDeadlineMs,sdkNavigationReadyMs,crsMeasurement,checks,privateChecks,history,historyBundleHash,encryptedWalletCreated:true,externalRequests:0,privateWorkerAssets:[...requestedPaths].filter(p=>/worker|sqlite3.wasm/.test(p)),rangeRequests:true,privatePathsDenied:true,actualBuiltPublicPage:true,actualBuiltWalletPage:true,actualAcvmWasmCompiled:true,crsInitialized:withCrs,crsPaths:[...requestedPaths].filter(p=>p.startsWith('/crs/')),provingQualified:false,tlsScope:'disposable certificate; browser exception scoped to fresh test context'}));passed=true;
}catch(error){console.log(JSON.stringify({passed:false,sourceStage,errorClass:error.name,publicCapabilities,walletReadiness,cspBlocked}));throw new Error('HTTPS rehearsal failed at '+sourceStage+' ('+error.name+')');}finally{
 clearTimeout(timeout);
 try{await context?.close();}catch(error){passed=false;throw error;}
 finally{
  try{
   if(child&&child.exitCode===null&&child.signalCode===null){
    const closed=once(child,'close');child.kill('SIGTERM');
    const kill=setTimeout(()=>child.kill('SIGKILL'),2000);
    try{await closed;}finally{clearTimeout(kill);}
   }
  }finally{
   fs.rmSync(dir,{recursive:true,force:true});
   console.log(JSON.stringify({passed,ownedServerStopped:!child||child.exitCode!==null||child.signalCode!==null,temporaryDirectoryRemoved:!fs.existsSync(dir)}));
  }
 }
}
