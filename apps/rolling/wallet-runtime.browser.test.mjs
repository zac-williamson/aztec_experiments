// Actual SDK, custody, encrypted export and asset composition in Chromium.
// Public index data and the unavailable private endpoint are explicit doubles;
// this does not qualify funding, chain actions or a production deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {loadRollingWalletAssets} from '../../scripts/rolling-wallet-assets.mjs';
import {startRollingReader} from './start.mjs';
const field=n=>'0x'+n.toString(16).padStart(64,'0'),eth=n=>'0x'+n.toString(16).padStart(40,'0');
test('real browser SDK unlock and encrypted recovery survive unavailable private deployment without submission',{timeout:60000},async t=>{
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),boardAddress:field(2)};
 const config={network:{chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),ethRpcUrl:'http://127.0.0.1:1'},board:{contractAddress:field(2),portalAddress:eth(3)},
  privateFee:{contractAddress:field(4),gasSettings:{gasLimits:{daGas:'1',l2Gas:'1'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
 config.bok={contractAddress:field(5),operatorAddress:field(6),pluginId:field(7)};
 const wallet=await loadRollingWalletAssets({config,trustedQuery:{url:'http://127.0.0.1:1/v1/node',allowLocalDev:true},remoteProver:null,proofsEnabled:true},scope);
 const index={sync:async()=>{},status:()=>({schemaVersion:1,state:'ready'}),query:()=>({schemaVersion:1,scope,complete:true,checkpoint:{number:1,hash:'public'},revision:'1',posts:[],names:{},boards:{},nextCursor:null})};
 const server=await startRollingReader({index,wallet});t.after(()=>server.close());
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true}),requests=[],errors=[];
 page.on('request',request=>requests.push({url:request.url(),method:request.method()}));page.on('pageerror',()=>errors.push('pageerror'));
 await page.goto(server.url);await page.getByRole('heading',{name:'A little quiet here'}).waitFor();
 assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
 assert.equal(requests.some(r=>/\/wallet\//.test(r.url)),false);
 await page.getByRole('button',{name:'Your account',exact:true}).click();await page.getByRole('button',{name:'Unlock',exact:true}).waitFor();
 assert.equal(requests.some(r=>/\/wallet\//.test(r.url)),false);
 await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('button',{name:'Create account and download recovery',exact:true}).waitFor({timeout:30000});
 assert.equal(requests.filter(r=>r.url.endsWith('/wallet/aztec_bundle.js')).length,1);
 assert.equal(requests.filter(r=>r.url.endsWith('/wallet/bok.json')).length,1);
 const bokServed=await wallet.read('/wallet/bok.json');assert.equal(JSON.parse(bokServed.body).name,'PrivateBok');assert.equal(createHash('sha256').update(bokServed.body).digest('hex'),wallet.runtime.artifacts.bok.sha256);
 assert.equal(requests.some(r=>r.method==='POST'),false);
 const facade=await page.evaluate(async()=>{const {loadRollingWalletRuntime}=await import('/wallet/runtime.mjs');const runtime=await loadRollingWalletRuntime();return {selector:typeof runtime.selectPrivateViews,keys:Object.keys(runtime).sort()};});
 assert.equal(facade.selector,'function');assert.deepEqual(facade.keys,['account','connectFundingWallet','createSession','fundingWalletStatus','fundingWallets','getAccount','selectPrivateViews']);
 // Actual browser worker and pinned local CRS initialization, even when the
 // application uses a remote prover. This previously failed on a missing G1
 // derivation route; a public/config double cannot hide that asset failure.
 const manifest=JSON.parse(await fs.readFile('crs-manifest.json','utf8'));
 const served=await wallet.read('/crs/'+manifest.derivedG1.name);
 assert(served,'Pinned uncompressed G1 must be in the production asset inventory');
 assert.equal(served.body.length,manifest.derivedG1.bytes);
 assert.equal(createHash('sha256').update(served.body).digest('hex'),manifest.derivedG1.sha256);
 const initialization=await page.evaluate(async()=>{
  await __aztec.initializeBrowserProver();const options=__aztec.Barretenberg.getSingleton().options;
  return {backend:options.backend,threads:options.threads,skipSrsInit:options.skipSrsInit};
 });
 assert.deepEqual(initialization,{backend:'WasmWorker',threads:1,skipSrsInit:true});
 for(const name of ['g1_uncompressed.dat','g2.dat','grumpkin_g1.dat'])assert.equal(requests.filter(r=>r.url===server.url+'/crs/'+name).length,1);
 assert.equal(requests.some(r=>r.method==='POST'),false);
 await page.getByRole('textbox',{name:'Recovery password',exact:true}).fill('disposable recovery test password');
 const downloadPromise=page.waitForEvent('download',{timeout:5000});
 await page.getByRole('button',{name:'Create account and download recovery',exact:true}).click();
 let download;
 try{download=await downloadPromise;}catch(error){
  t.diagnostic(JSON.stringify(await page.evaluate(()=>({hasAccount:Boolean(window.walletState.aztec),busy:window.BillboardAccount.snapshot().busy}))));
  throw error;
 }
 const encrypted=JSON.parse(await fs.readFile(await download.path(),'utf8'));
 assert.equal(encrypted.kind,'aztec-billboard-encrypted-wallet');assert.equal(Object.hasOwn(encrypted,'secretKey'),false);
 assert.ok(encrypted.ciphertext.length>32);
 await page.getByRole('button',{name:'Connect private account',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>Boolean(window.walletState.aztec)&&!window.walletState.invalidated),true);
 // Real custody binding with a labelled injected transport; this is not a
 // successful MetaMask/Phantom extension or payment qualification.
 const connection=await page.evaluate(async()=>{
  const {loadRollingWalletRuntime}=await import('/wallet/runtime.mjs'),runtime=await loadRollingWalletRuntime();
  const before=runtime.getAccount(),calls=[],address='0x'+'1'.repeat(40);
  const transport={on(){},removeListener(){},async request({method}){calls.push(method);
   if(method==='eth_chainId')return '0x7a69';
   if(method==='eth_requestAccounts'||method==='eth_accounts')return [address];
   if(method==='wallet_requestPermissions')return [];
   throw Error('Unexpected controlled transport operation');
  }};
  dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'controlled-funding-wallet',name:'Labelled funding wallet',rdns:'io.metamask'},provider:transport}}));
  const choices=runtime.fundingWallets();await runtime.connectFundingWallet('controlled-funding-wallet');
  return {choices,status:runtime.fundingWalletStatus(),samePrivateAccount:runtime.getAccount()===before,calls};
 });
 assert.deepEqual(connection.choices,[{id:'controlled-funding-wallet',name:'Labelled funding wallet'}]);
 assert.deepEqual(connection.status,{connected:true,name:'Labelled funding wallet',address:'0x'+'1'.repeat(40)});
 assert.equal(connection.samePrivateAccount,true);assert(connection.calls.includes('wallet_requestPermissions'));
 assert(connection.calls.every(method=>['wallet_requestPermissions','eth_chainId','eth_requestAccounts','eth_accounts'].includes(method)));

 assert.equal(await page.locator('input[type=password]').evaluateAll(nodes=>nodes.every(node=>node.value==='')),true);
 assert.equal(requests.some(r=>r.url.includes('sendTx')||r.url.includes('/v1/jobs')),false);
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'execution/evidence/G05/wallet-unavailable-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.getByRole('button',{name:'Your account',exact:true}).click();
 assert.equal(requests.filter(r=>r.url.endsWith('/wallet/aztec_bundle.js')).length,1);
 assert.equal(await page.locator('dialog').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),true);
});

// Opt-in diagnosis only: real production WASM/CRS, public configuration and no
// account import/creation. The original full custody case above stays unchanged.
// Run this named case alone under the existing owned browser supervisor.
const initializerDiagnosticDirectory=process.env.ROLLING_BROWSER_INITIALIZER_DIAGNOSTIC_DIR;
test('public-only actual browser prover initialization diagnostic',{timeout:60000,skip:!initializerDiagnosticDirectory},async t=>{
 const path=await import('node:path');
 assert(path.isAbsolute(initializerDiagnosticDirectory));
 const directory=await fs.lstat(initializerDiagnosticDirectory);
 assert(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700&&directory.uid===process.getuid());
 assert.equal(await fs.realpath(initializerDiagnosticDirectory),initializerDiagnosticDirectory);
 const report={schemaVersion:1,scope:'Actual production browser initializer only; no chain, account, proof or recovered preferences',passed:false,stage:'asset-load',initialization:null,assets:[],workers:[],pageErrors:0,traffic:null,cleanup:{context:false,browser:false,server:false}};
 const privateFailures=[];let server,browser,context,page,observer;
 const privateError=(stage,error)=>{if(privateFailures.length<16)privateFailures.push({stage,type:typeof error,message:typeof error?.message==='string'?error.message.slice(0,4096):null,stack:typeof error?.stack==='string'?error.stack.slice(0,8192):null});};
 t.after(async()=>{
  for(const [key,value]of [['context',context],['browser',browser],['server',server]]){
   if(!value){report.cleanup[key]=true;continue;}
   try{await value.close();report.cleanup[key]=true;}catch(error){privateError('cleanup-'+key,error);report.passed=false;}
  }
  report.traffic=observer?.snapshot()??null;
  if(report.traffic&&['privateRequests','proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'].some(key=>report.traffic[key]!==0))report.passed=false;
  if(report.pageErrors||!Object.values(report.cleanup).every(Boolean))report.passed=false;
  await fs.writeFile(path.join(initializerDiagnosticDirectory,'failure-private.json'),JSON.stringify({scope:'Public-only actual initializer exceptions; never account/credentials/witness',failures:privateFailures},null,2)+'\n',{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(initializerDiagnosticDirectory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  assert(report.passed,'Public-only initializer diagnostic failed; inspect owned private report');
 });
 try{
  const scope={chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),boardAddress:field(2)};
  const config={network:{chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),ethRpcUrl:'http://127.0.0.1:2'},board:{contractAddress:field(2),portalAddress:eth(3)},
   privateFee:{contractAddress:field(4),gasSettings:{gasLimits:{daGas:'1',l2Gas:'1'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
  const remoteProver={url:'http://127.0.0.1:1',board:field(2),chainId:'31337',rollupVersion:'1',proofsEnabled:true};
  const wallet=await loadRollingWalletAssets({config,trustedQuery:{url:remoteProver.url+'/v1/node',allowLocalDev:true},remoteProver,proofsEnabled:true},scope);
  const index={sync:async()=>{},status:()=>({schemaVersion:1,state:'ready'}),query:()=>({schemaVersion:1,scope,complete:true,checkpoint:{number:1,hash:'public'},revision:'1',posts:[],names:{},boards:{},nextCursor:null})};
  server=await startRollingReader({index,wallet});
  const {createRollingPreferenceTraffic}=await import('../../scripts/testing/rolling-preference-browser.mjs');
  observer=createRollingPreferenceTraffic({origin:server.url,trustedOrigin:remoteProver.url,ethereumOrigin:config.network.ethRpcUrl});
  report.stage='browser-launch';browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=256']});
  context=await browser.newContext({serviceWorkers:'block'});
  await context.routeWebSocket('**/*',route=>{observer.blocked();route.close();});
  await context.route('**/*',async route=>{
   try{const request=route.request();if(!observer.inspect({url:request.url(),method:request.method(),body:request.postData()})){await route.abort();return;}await route.continue();}
   catch{observer.inspectionFailed();await route.abort().catch(()=>{});}
  });
  page=await context.newPage();page.on('pageerror',error=>{report.pageErrors++;privateError('pageerror',error);});
  const manifest=JSON.parse(await fs.readFile('crs-manifest.json','utf8'));
  const assetPaths=new Set(['/wallet/aztec_bundle.js','/wallet/bb-main.worker.js','/wallet/bb-thread.worker.js','/crs/g1_uncompressed.dat','/crs/g2.dat','/crs/grumpkin_g1.dat']);
  page.on('response',response=>{const url=new URL(response.url());if(url.origin===server.url&&assetPaths.has(url.pathname)&&report.assets.length<32)report.assets.push({path:url.pathname,status:response.status()});});
  page.on('worker',worker=>{const url=new URL(worker.url());report.workers.push(url.origin===server.url&&assetPaths.has(url.pathname)?url.pathname:'unexpected');});
  report.stage='runtime-load';await page.goto(server.url+'/#/bookmarks',{waitUntil:'networkidle'});
  assert.deepEqual(await page.evaluate(async()=>({secure:isSecureContext,isolated:crossOriginIsolated,locks:typeof navigator.locks?.request==='function',sdkAbsent:globalThis.__aztec===undefined,nativeDatabase:typeof indexedDB.databases==='function'&&(await indexedDB.databases()).length===0})),{secure:true,isolated:true,locks:true,sdkAbsent:true,nativeDatabase:true});
  await page.getByRole('button',{name:'Open private recovery',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Your private account',exact:true});await dialog.getByRole('button',{name:'Unlock',exact:true}).click();
  await dialog.getByLabel('Recovery file',{exact:true}).waitFor();
  const facade=await page.evaluate(async()=>{const {loadRollingWalletRuntime}=await import('/wallet/runtime.mjs');const runtime=await loadRollingWalletRuntime();return {selector:typeof runtime.selectPrivateViews,keys:Object.keys(runtime).sort(),hasAccount:Boolean(globalThis.walletState.aztec)};});
  assert.equal(facade.selector,'function');assert.deepEqual(facade.keys,['account','connectFundingWallet','createSession','fundingWalletStatus','fundingWallets','getAccount','selectPrivateViews']);assert.equal(facade.hasAccount,false);
  const served=await wallet.read('/crs/'+manifest.derivedG1.name);assert(served);assert.equal(served.body.length,manifest.derivedG1.bytes);assert.equal(createHash('sha256').update(served.body).digest('hex'),manifest.derivedG1.sha256);
  report.stage='actual-initializer';
  const observed=await page.evaluate(async()=>{
   const stages=[],failures=[],hashes=[],srs=[],restore=[],pending=[];let observerErrors=0;
   const note=(stage,state)=>{try{if(stages.length<32)stages.push({stage,state});else observerErrors++;}catch{observerErrors++;}};
   const capture=(stage,error)=>{try{if(failures.length<12)failures.push({stage,type:typeof error,message:typeof error?.message==='string'?error.message.slice(0,4096):null,stack:typeof error?.stack==='string'?error.stack.slice(0,8192):null});}catch{observerErrors++;}};
   const observe=(target,key,stage,onFulfilled)=>{
    const descriptor=Object.getOwnPropertyDescriptor(target,key),original=target[key];if(typeof original!=='function')throw Error('Expected actual initializer method');
    Object.defineProperty(target,key,{configurable:true,writable:true,value:function(...args){
     note(stage,'started');let value;try{value=Reflect.apply(original,this,args);}catch(error){note(stage,'failed');capture(stage,error);throw error;}
     // Observe the original promise without replacing its identity or outcome.
     pending.push(Promise.resolve(value).then(result=>{note(stage,'complete');try{onFulfilled?.(args,result);}catch{observerErrors++;}},error=>{note(stage,'failed');capture(stage,error);}));return value;
    }});restore.push(()=>descriptor?Object.defineProperty(target,key,descriptor):delete target[key]);
   };
   const options=bb=>({backend:['WasmWorker','Wasm','NativeUnixSocket','NativeSharedMem'].includes(bb.options?.backend)?bb.options.backend:'unknown',threads:Number.isSafeInteger(bb.options?.threads)?bb.options.threads:null,skipSrsInit:bb.options?.skipSrsInit===true});
   let before=null;try{before=options(__aztec.Barretenberg.getSingleton());}catch{}
   let passed=false,code='unknown',after=null,selected=null;
   try{
    observe(__aztec.Barretenberg,'initSingleton','async-singleton',(_args,result)=>{selected=options(result);});
    observe(BillboardCRS,'initialize','verified-local-crs');
    observe(crypto.subtle,'digest','sha256',(args,result)=>{if(args[0]==='SHA-256')hashes.push({bytes:args[1].byteLength,sha256:Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('')});});
    observe(__aztec.Barretenberg.prototype,'srsInitSrs','bn254-srs',(args,result)=>srs.push({kind:'bn254',numPoints:args[0].numPoints,bytes:args[0].pointsBuf.byteLength,responseBytes:result.pointsBuf.byteLength}));
    observe(__aztec.Barretenberg.prototype,'srsInitGrumpkinSrs','grumpkin-srs',(args,result)=>srs.push({kind:'grumpkin',numPoints:args[0].numPoints,bytes:args[0].pointsBuf.byteLength,dummy:result.dummy}));
    await __aztec.initializeBrowserProver();after=options(__aztec.Barretenberg.getSingleton());passed=true;code=null;
   }catch(error){capture('exported-initializer',error);const d=error&&Object.getOwnPropertyDescriptor(error,'code');if(d&&Object.hasOwn(d,'value')&&d.value==='BB_BROWSER_PROVER_CONFIGURATION')code=d.value;}
   finally{await Promise.allSettled(pending);for(const undo of restore.reverse())undo();}
   return {passed,code,before,selected,after,stages,hashes,srs,observerErrors,failures,hasAccount:Boolean(globalThis.walletState.aztec)};
  });
  privateFailures.push(...observed.failures);delete observed.failures;report.initialization=observed;
  assert(observed.passed,'Actual production initializer failed');assert.equal(observed.observerErrors,0);assert.equal(observed.hasAccount,false);
  assert.deepEqual(observed.after,{backend:'WasmWorker',threads:1,skipSrsInit:true});
  assert.deepEqual(observed.srs,[{kind:'bn254',numPoints:524288,bytes:524288*64,responseBytes:0},{kind:'grumpkin',numPoints:131072,bytes:8388608,dummy:0}]);
  for(const file of [manifest.derivedG1,...manifest.files.filter(file=>file.name!=='g1.dat')]){
   assert.equal(observed.hashes.filter(row=>row.bytes===file.bytes&&row.sha256===file.sha256).length,1);
   assert.equal(report.assets.filter(row=>row.path==='/crs/'+file.name&&row.status===200).length,1);
  }
  assert.equal(report.assets.filter(row=>row.path==='/wallet/aztec_bundle.js'&&row.status===200).length,1);
  assert.equal(report.workers.filter(name=>name==='/wallet/bb-main.worker.js').length,1);assert(!report.workers.includes('unexpected'));
  assert.equal(report.pageErrors,0);report.stage='complete';report.passed=true;
 }catch(error){privateError(report.stage,error);throw Error('Public-only initializer diagnostic failed; inspect owned private report');}
});

// EIP1193 custody fixtures exercise the actual runtime capture function; no
// Ethereum account signature or transaction is requested by capture/guard.
import {captureRollingFundingWallet,createRollingFundingRelay} from './wallet-runtime.mjs';
test('funding runtime captures named custody and rechecks chain/account without signature or send',async()=>{
 const calls=[],address='0x'+'12'.repeat(20),signer={getAddress:async()=>address};
 const state={ethSigner:signer,ethProvider:{},ethTransport:{request:async request=>{calls.push(request.method);return '0x7a69';}},ethAccount:address,ethWalletName:'MetaMask'};
 const wallet=await captureRollingFundingWallet({getState:()=>state,contextGuard:async()=>{},chainId:'31337'});assert.equal(wallet.name,'MetaMask');await wallet.guard();assert.deepEqual(calls,['eth_chainId','eth_chainId']);assert.equal(wallet.signer,signer);
 state.ethProvider={};await assert.rejects(wallet.guard(),{code:'ROLLING_RUNTIME_UNAVAILABLE'});
});
for(const mode of ['chain','account','transport','provider','invalidated'])test('funding runtime invalidates '+mode+' during custody read',async()=>{
 const address='0x'+'12'.repeat(20);let change=false;
 const state={ethSigner:{getAddress:async()=>address},ethProvider:{},ethAccount:address,ethWalletName:'Phantom',ethTransport:{request:async()=>{
  if(change){if(mode==='account')state.ethAccount='0x'+'13'.repeat(20);if(mode==='transport')state.ethTransport={};if(mode==='provider')state.ethProvider={};if(mode==='invalidated')state.invalidated=true;}return change&&mode==='chain'?'0x1':'0x7a69';
 }}};
 const wallet=await captureRollingFundingWallet({getState:()=>state,contextGuard:async()=>{},chainId:'31337'});change=true;await assert.rejects(wallet.guard(),{code:'ROLLING_RUNTIME_UNAVAILABLE'});
});

test('funding relay uses only bounded same-origin fixed requests and never retries a failed POST',async()=>{
 const old=globalThis.fetch,calls=[];let invalid=false;
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(options.method==='POST')throw Error('labelled lost reply');return new Response(JSON.stringify({status:'absent'}),{status:200});};
 try{
  const relay=createRollingFundingRelay({contextGuard:async()=>{if(invalid)throw Error('account changed');}});
  await relay.terms();await assert.rejects(relay.submit('0x1234'));await relay.status('0x'+'12'.repeat(32));
  assert.deepEqual(calls.map(x=>x.url),['/api/funding/usdc/terms','/api/funding/usdc','/api/funding/usdc/status?planHash=0x'+'12'.repeat(32)]);
  assert.equal(calls[1].options.body,JSON.stringify({data:'0x1234'}));for(const {options}of calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert(options.signal);}
  invalid=true;await assert.rejects(relay.terms());assert.equal(calls.length,3);assert.throws(()=>relay.status('../escape'));assert.throws(()=>relay.submit({}));
 }finally{globalThis.fetch=old;}
});
test('funding relay caps response bytes and rejects a late account change before publication',async()=>{
 const old=globalThis.fetch;try{
  globalThis.fetch=async()=>new Response(' '.repeat(16385),{status:200});const relay=createRollingFundingRelay({contextGuard:async()=>{}});await assert.rejects(relay.terms());
  let calls=0;globalThis.fetch=async()=>new Response('{}',{status:200});await assert.rejects(createRollingFundingRelay({contextGuard:async()=>{if(++calls>1)throw Error('account changed');}}).terms());
 }finally{globalThis.fetch=old;}
});

// Deadline composition against the real loader, with explicit DOM/transport
// doubles and virtual time. These do not qualify remote browser delivery.
async function assetDeadlineFixture(t,{holdArtifact=false}={}){
 t.mock.timers.enable({apis:['setTimeout']});
 for(const [name,value] of Object.entries({isSecureContext:true,crossOriginIsolated:true,navigator:{locks:{request(){}}}})){
  const before=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});
  t.after(()=>before?Object.defineProperty(globalThis,name,before):delete globalThis[name]);
 }
 const bytes=Buffer.from('{}'),hash=createHash('sha256').update(bytes).digest('hex');
 const asset=url=>({url,bytes:bytes.length,sha256:hash});
 const scripts=['ethers.js','aztec_bundle.js','crs-client.js','wallet-providers.js','passkey-wallet.js','wallet-backup.js','claim-secret-store.js','account.js','engine.js'].map(name=>asset('/wallet/'+name));
 const metadata={schemaVersion:1,config:{network:{chainId:'31337'}},trustedQuery:{},remoteProver:null,proofsEnabled:false,scripts,
  artifacts:{board:asset('/wallet/board.json'),privateFee:asset('/wallet/private-fee.json')},crs:asset('/crs/manifest.json')};
 const requests=[],timeouts=[],elements=[];let cancelled=0,ready;const reached=new Promise(resolve=>ready=resolve);
 const savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({remove(){this.removed=true;}}),head:{append(element){elements.push(element);ready();}}}});
 t.after(()=>savedDocument?Object.defineProperty(globalThis,'document',savedDocument):delete globalThis.document);
 const oldCrs=Object.getOwnPropertyDescriptor(globalThis,'BILLBOARD_CRS_MANIFEST'),oldConfig=Object.getOwnPropertyDescriptor(globalThis,'_getPublicConfig');
 t.after(()=>{for(const [key,before] of [['BILLBOARD_CRS_MANIFEST',oldCrs],['_getPublicConfig',oldConfig]])before?Object.defineProperty(globalThis,key,before):delete globalThis[key];});
 t.mock.method(AbortSignal,'timeout',ms=>{timeouts.push(ms);const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  requests.push(url);
  if(url==='/wallet/runtime.json')return new Response(JSON.stringify(metadata));
  if(holdArtifact)return {ok:true,body:{getReader:()=>({read:()=>new Promise((resolve,reject)=>{ready();options.signal.addEventListener('abort',()=>reject(Error('controlled asset deadline')),{once:true});}),cancel:async()=>{cancelled++;}})}};
  return new Response(bytes);
 });
 const {loadRollingWalletRuntime}=await import('./wallet-runtime.mjs?deadline='+encodeURIComponent(t.name));
 const promise=loadRollingWalletRuntime();let settled=false;
 const result=promise.then(()=>{settled=true;return 'unexpected-success';},error=>{settled=true;return error.code;});
 const flush=()=>new Promise(resolve=>setImmediate(resolve));await Promise.race([reached,result.then(code=>{throw Error(code);})]);await flush();
 return {promise,result,loadRollingWalletRuntime,requests,timeouts,elements,flush,get settled(){return settled;},get cancelled(){return cancelled;}};
}
test('public asset loader permits slow scripts within 60s and fences timeout without replay',async t=>{
 const f=await assetDeadlineFixture(t);
 assert.deepEqual(f.timeouts,[30000,60000,60000,60000]);assert.equal(f.elements.length,1);
 assert.equal(f.elements[0].integrity,'sha256-'+createHash('sha256').update('{}').digest('base64'));
 assert.equal(f.elements[0].crossOrigin,'anonymous');assert.equal(f.elements[0].referrerPolicy,'no-referrer');
 t.mock.timers.tick(45000);await f.flush();assert.equal(f.settled,false);assert.equal(f.elements[0].removed,undefined);
 f.elements[0].onload();await f.flush();assert.equal(f.elements.length,2);
 t.mock.timers.tick(59999);await f.flush();assert.equal(f.settled,false);
 t.mock.timers.tick(1);assert.equal(await f.result,'ROLLING_RUNTIME_UNAVAILABLE');assert.equal(f.elements[1].removed,true);
 const before=[f.requests.length,f.elements.length];assert.equal(f.loadRollingWalletRuntime(),f.promise);
 await assert.rejects(f.loadRollingWalletRuntime(),{code:'ROLLING_RUNTIME_UNAVAILABLE'});assert.deepEqual([f.requests.length,f.elements.length],before);
});
test('public artifact loader aborts and cancels a stalled body at 60s without script or replay',async t=>{
 const f=await assetDeadlineFixture(t,{holdArtifact:true});assert.deepEqual(f.timeouts,[30000,60000]);
 t.mock.timers.tick(59999);await f.flush();assert.equal(f.settled,false);
 t.mock.timers.tick(1);assert.equal(await f.result,'ROLLING_RUNTIME_UNAVAILABLE');assert.equal(f.cancelled,1);assert.equal(f.elements.length,0);
 assert.equal(f.loadRollingWalletRuntime(),f.promise);assert.deepEqual(f.requests,['/wallet/runtime.json','/crs/manifest.json']);
});
