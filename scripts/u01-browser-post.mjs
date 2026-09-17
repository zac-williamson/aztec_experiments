// TEST ONLY: a real GUI post using a disposable Anvil wallet adapter. No engine,
// PXE, prover, receipt or Aztec node behavior is replaced by this driver.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';

export async function runU01BrowserPost({directory,origin,nodeUrl,ethereumUrl,rpcToken,publicConfig,backupPath,backupPassword,ethereumAccount,message,timeoutMs=480000,diagnostic=false,onStage=()=>{}}) {
 assertNodeVersion();
 const started=Date.now();let browser,child,timer,page,debuggerSession,stage='validation';
 const mark=value=>{stage=value;onStage(value);};
 const external=new Set(),csp=new Set(),paths=new Set(),failedHttp=new Map(),cspDetails=[];
 const publicPath=value=>/^\/(?:rpc\/(?:aztec|ethereum)|(?:user|feed|censor|deploy|fee-juice)\.html|(?:aztec_bundle|public-feed|bb-main.worker|bb-thread.worker|sqlite.worker|sqlite3-opfs-async-proxy)\.js|(?:sqlite3|acvm_js_bg|noirc_abi_wasm_bg)\.wasm|crs\/(?:crs-manifest\.json|g1\.dat|g1_uncompressed\.dat|g2\.dat|grumpkin_g1\.dat))$/.test(value)?value:'other-local-path';
 const observation={passed:false,sourceStage:stage,elapsedMs:0,diagnosticInstrumentation:diagnostic,performanceQualified:false,diagnosticScope:diagnostic?'Error formatter and catch breakpoint observation; original application behavior preserved.':'No formatter wrapper or debugger enabled; GUI wall time only, not isolated proof performance.'};
 const requireValue=(condition)=>{if(!condition)throw Error('Invalid disposable browser test parameters');};
 const local=value=>{const u=new URL(value);requireValue(['http:','https:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/');return u;};
 const site=local(origin),node=local(nodeUrl),ethereum=local(ethereumUrl);
 requireValue(site.protocol==='https:'&&node.protocol==='http:'&&ethereum.protocol==='http:');
 requireValue(path.isAbsolute(directory)&&path.isAbsolute(backupPath)&&/^[a-zA-Z0-9_-]{24,256}$/.test(rpcToken)&&/^0x[0-9a-fA-F]{40}$/.test(ethereumAccount));
 requireValue(typeof diagnostic==='boolean');
 requireValue(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=480000&&typeof message==='string'&&message.trim()===message&&Buffer.byteLength(message)>0&&Buffer.byteLength(message)<=992);
 const config=structuredClone(publicConfig);config.network.nodeUrl=site.origin+'/rpc/aztec';config.network.ethRpcUrl=site.origin+'/rpc/ethereum';
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy');
 const remaining=()=>Math.max(1,timeoutMs-(Date.now()-started));
 try {
  mark('local-https');fs.mkdirSync(directory,{recursive:true});
  const cert=path.join(directory,'u01-browser-cert.pem'),key=path.join(directory,'u01-browser-key.pem'),file=path.join(directory,'u01-browser-Caddyfile');
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:15000});
  const generated=generateHosting({dist:path.join(ROOT,'apps/dist'),site:site.origin,certificate:cert,key,local:true,origins:[]});
  const proxy=(name,upstream)=>`  handle /rpc/${name} {\n   rewrite * /\n   reverse_proxy ${upstream.host} {\n    header_up x-u01-test-token ${rpcToken}\n   }\n  }\n`;
  // Only this disposable fixture adds RPC routes; the production generator stays static.
  requireValue(generated.caddyfile.includes('  @allowed path '));
  fs.writeFileSync(file,generated.caddyfile.replace('  @allowed path ',proxy('aztec',node)+proxy('ethereum',ethereum)+'  @allowed path '),{mode:0o600});
  const env={PATH:'/usr/bin:/bin',HOME:directory,XDG_DATA_HOME:directory,XDG_CONFIG_HOME:directory};
  requireValue(/^v2\.11\.4 /.test(execFileSync(caddy,['version'],{encoding:'utf8'})));
  execFileSync(caddy,['validate','--config',file,'--adapter','caddyfile'],{env,stdio:'pipe',timeout:10000});
  child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env,stdio:'ignore'});child.on('error',()=>{});
  const ping=()=>new Promise((resolve,reject)=>{const request=https.get(site.origin+'/user.html',{rejectUnauthorized:false,timeout:1000},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('timeout')));});
  let available=false;for(let i=0;i<50;i++){try{if(await ping()===200){available=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}requireValue(available);
  const workflow=async()=>{
   mark('browser-start');browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=768']});
   const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:false});
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(['http:','https:'].includes(u.protocol)&&u.origin!==site.origin){external.add(u.origin);return route.abort();}return route.continue();});
   context.on('request',request=>{const u=new URL(request.url());if(u.origin===site.origin)paths.add(publicPath(u.pathname));});
   context.on('response',response=>{const u=new URL(response.url());if(u.origin===site.origin&&response.status()>=400){const safe=publicPath(u.pathname),key=safe+':'+response.status();failedHttp.set(key,{path:safe,status:response.status()});}});
   await context.exposeBinding('recordU01Csp',(_source,value)=>{if(value&&typeof value.directive==='string'&&/^[a-z-]+$/.test(value.directive)){csp.add(value.directive);if(cspDetails.length<16)cspDetails.push(value);}});
   await context.addInitScript(({account})=>{
    addEventListener('securitypolicyviolation',event=>{
     let blocked=['eval','wasm-eval','inline'].includes(event.blockedURI)?event.blockedURI:'other',source='other';
     try{if(new URL(event.blockedURI).origin===location.origin)blocked='self';}catch{}
     try{const u=new URL(event.sourceFile);if(u.origin===location.origin&&['/user.html','/aztec_bundle.js','/bb-main.worker.js','/bb-thread.worker.js'].includes(u.pathname))source=u.pathname;}catch{}
     const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
     void globalThis.recordU01Csp({directive:event.effectiveDirective,blocked,source,line:integer(event.lineNumber),column:integer(event.columnNumber)});
    });
    let id=0;const listeners=new Map();
    const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_sendTransaction']);
    globalThis.ethereum={isU01DisposableTestAdapter:true,on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return this;},removeListener(name,fn){listeners.get(name)?.delete(fn);return this;},async request({method,params=[]}){
     if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
     if(!allowed.has(method)||!Array.isArray(params))throw Error('Disposable wallet method denied');
     if(method==='eth_sendTransaction'&&params[0]?.from?.toLowerCase()!==account.toLowerCase())throw Error('Disposable wallet sender denied');
     const response=await fetch('/rpc/ethereum',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
     if(!response.ok)throw Error('Disposable wallet transport failed');const result=await response.json();if(result.error)throw Error('Disposable wallet RPC failed');return result.result;
    }};
   },{account:ethereumAccount});
   page=await context.newPage();page.setDefaultTimeout(Math.min(20000,remaining()));
   mark('wallet-software');const navigationStarted=Date.now();await page.goto(site.origin+'/user.html');
   await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&document.getElementById('wbAztecFile'),{},{timeout:remaining()});observation.sdkReadyMs=Date.now()-navigationStarted;
   if(diagnostic){
   // Diagnostic run only: observe the original error at the existing formatter
   // boundary, then call that formatter with the same receiver and arguments.
   await page.evaluate(()=>{
    const original=globalThis.publicOperationFailure;if(typeof original!=='function')throw Error('Diagnostic formatter unavailable');
    globalThis.__u01FormatterDiagnostics=[];
    globalThis.__u01CaptureError=function(error){
     try{
      const names=new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','EvalError','URIError','AggregateError','DOMException','RuntimeError','CompileError','LinkError']);
      const codes=new Set(['BB_OPERATION_FAILED','BB_CONNECTION_VERIFICATION_FAILED','BB_FEE_CONFIG_REQUIRED','BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','BB_PRIVATE_FEE_AMOUNT','BB_PRIVATE_FEE_ACTION_FAILED','BB_PRIVATE_FEE_CLAIM_FAILED','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN','INSECURE_CONTEXT','SHARED_MEMORY_UNAVAILABLE','WASM_UNAVAILABLE','WORKER_UNAVAILABLE','CRYPTO_UNAVAILABLE','LOCKS_UNAVAILABLE','STORAGE_UNAVAILABLE','OPFS_UNAVAILABLE','READINESS_TIMEOUT']);
      const chain=[],seen=new Set();let current=error;
      while(current!==null&&current!==undefined&&chain.length<5&&!seen.has(current)){
       seen.add(current);const constructor=current?.constructor?.name,frames=[];
       if(typeof current?.stack==='string')for(const line of current.stack.split('\n').slice(1,17)){
        if(!/^\s*at\s/.test(line))continue;const match=line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);if(!match)continue;
        const u=new URL(match[1]),row=Number(match[2]),column=Number(match[3]);
        if(u.origin===location.origin&&['/user.html','/aztec_bundle.js'].includes(u.pathname)&&Number.isSafeInteger(row)&&Number.isSafeInteger(column))frames.push({file:u.pathname,line:row,column});
       }
       // Raw messages stay inside this page. Only fixed category booleans leave.
       const message=typeof current?.message==='string'?current.message:'';
       const categories={memory:/out of memory|memory allocation|allocat(?:e|ion).*memory|memory.*grow|grow.*memory/i.test(message),outOfBounds:/out.of.bounds/i.test(message),srs:/\b(?:srs|crs)\b|structured reference string/i.test(message),assertion:/assert(?:ion)?(?: failed| failure)?/i.test(message),typeError:constructor==='TypeError'||/\btypeerror\b/i.test(message)};
       chain.push({constructor:names.has(constructor)?constructor:'OtherError',code:codes.has(current?.code)?current.code:null,frames,categories});current=current?.cause;
      }
      return {chain};
     }catch{return {sanitizerFailed:true};}
    };
    globalThis.publicOperationFailure=function(...args){
     try{if(globalThis.__u01FormatterDiagnostics.length<16)globalThis.__u01FormatterDiagnostics.push(globalThis.__u01CaptureError(args[0]));}catch{}
     return Reflect.apply(original,this,args);
    };
   });
   }
   mark('public-config-import');await page.getByLabel('Public configuration JSON',{exact:true}).fill(JSON.stringify(config));await page.getByRole('button',{name:'Import configuration',exact:true}).click();
   await page.waitForFunction(()=>globalThis.billboardConfigStore?.snapshot().config!==null);
   mark('encrypted-wallet-restore');await page.locator('#wbPassword').fill(backupPassword);await page.locator('#wbAztecFile').setInputFiles(backupPath);
   await page.waitForFunction(()=>!!globalThis.walletState?.aztec?.address||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()});requireValue(await page.evaluate(()=>!!globalThis.walletState?.aztec?.address));
   mark('wallet-connect-and-status');const setupStarted=Date.now();await page.locator('#wbEthBrowserBtn').click();
   await page.waitForFunction(()=>{const button=document.getElementById('postBtn');return (button&&button.getClientRects().length>0)||!!document.querySelector('#setupStatus .error');},{},{timeout:remaining()});requireValue(await page.locator('#postBtn').isVisible());observation.walletSetupMs=Date.now()-setupStarted;
   if(diagnostic){
   // Stop only at the existing catch-to-safe-error boundary, before its
   // original error is discarded. Never fetch scope objects or raw error data.
   const html=fs.readFileSync(path.join(ROOT,'apps/dist/user.html'),'utf8');
   const statement="throw privateFeeFailure('BB_PRIVATE_FEE_ACTION_FAILED');";
   requireValue(html.split(statement).length===2);
   const offset=html.indexOf(statement),lineNumber=html.slice(0,offset).split('\n').length-1;
   const columnNumber=offset-html.lastIndexOf('\n',offset)-1;
   observation.catchBreakpoint={file:'/user.html',line:lineNumber+1,column:columnNumber+1};
   observation.privateFeeCatchDiagnostics=[];
   debuggerSession=await context.newCDPSession(page);await debuggerSession.send('Debugger.enable');
   let catchBreakpointId;
   debuggerSession.on('Debugger.paused',async event=>{
    try{
     if(catchBreakpointId&&event.hitBreakpoints?.includes(catchBreakpointId)&&event.callFrames?.[0]&&observation.privateFeeCatchDiagnostics.length<5){
      const result=await debuggerSession.send('Debugger.evaluateOnCallFrame',{callFrameId:event.callFrames[0].callFrameId,expression:'globalThis.__u01CaptureError(error)',returnByValue:true,silent:true});
      observation.privateFeeCatchDiagnostics.push(result.exceptionDetails?{evaluationFailed:true}:(result.result.value??{evaluationFailed:true}));
     }
    }catch{observation.catchDiagnosticFailed=true;}
    finally{await debuggerSession.send('Debugger.resume').catch(()=>{});}
   });
   const breakpoint=await debuggerSession.send('Debugger.setBreakpointByUrl',{url:site.origin+'/user.html',lineNumber,columnNumber});
   catchBreakpointId=breakpoint.breakpointId;requireValue(breakpoint.locations.length===1);
   }
   mark('actual-gui-post');await page.locator('#msgText').fill(message);const postStarted=Date.now();await page.locator('#postBtn').click();
   await page.waitForFunction(()=>{const text=document.getElementById('postStatus')?.textContent||'';return text.includes('Message included. Public content and transaction timing remain observable.')||!!document.querySelector('#postStatus .error');},{},{timeout:remaining()});
   observation.guiPostElapsedMs=Date.now()-postStarted;
   const text=await page.locator('#postStatus').textContent();requireValue(text.includes('Message included. Public content and transaction timing remain observable.'));observation.publicTransactionHashes=[...new Set([...text.matchAll(/Transaction hash:\s*(0x[0-9a-fA-F]{64})/g)].map(x=>x[1].toLowerCase()))];
   observation.proofTimingMs=null;observation.proofTimingScope='GUI post elapsed includes setup/simulation/proving/submission; no prover method was instrumented or replaced.';
   requireValue(external.size===0&&csp.size===0);observation.passed=true;
  };
  await Promise.race([workflow(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser test deadline')),remaining());})]);
 }catch {observation.passed=false;observation.failure='Browser post failed or timed out; raw provider/browser errors intentionally omitted.';}
 finally {
  if(page&&!page.isClosed()){
   try{observation.uiDiagnostic=await Promise.race([page.evaluate(()=>{
    const texts=['setupStatus','postStatus','depositBalanceCheck'].map(id=>document.getElementById(id)?.textContent||'').join(' ');
    // Fixed UI strings only; no provider message, wallet value or RPC payload leaves the page.
    const markers={walletFailure:'Wallet operation did not complete.',setupFailure:'Setup did not complete.',operationFailure:'ERROR: operation did not complete',configurationFailure:'configuration changed',provingStarted:'Proving tx (can take minutes)',provingComplete:'Proving complete. Submitting to node',messageIncluded:'Message included. Public content and transaction timing remain observable.'};
    return {formatterDiagnostics:globalThis.__u01FormatterDiagnostics??[],walletRestored:!!globalThis.walletState?.aztec?.address,ethereumConnected:!!globalThis.walletState?.ethSigner,postVisible:!!document.getElementById('postBtn')?.getClientRects().length,postBusy:document.getElementById('postBtn')?.disabled===true,setupHasError:!!document.querySelector('#setupStatus .error'),postHasError:!!document.querySelector('#postStatus .error'),markers:Object.fromEntries(Object.entries(markers).map(([name,text])=>[name,texts.toLowerCase().includes(text.toLowerCase())]))};
   }),new Promise(resolve=>{const t=setTimeout(()=>resolve({unavailable:true}),1000);t.unref();})]);}catch{observation.uiDiagnostic={unavailable:true};}
  }
  clearTimeout(timer);await debuggerSession?.send('Debugger.resume').catch(()=>{});await debuggerSession?.detach().catch(()=>{});await browser?.close().catch(()=>{});
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);await closed;clearTimeout(kill);}
  for(const name of ['u01-browser-Caddyfile','u01-browser-cert.pem','u01-browser-key.pem'])fs.rmSync(path.join(directory,name),{force:true});
 }
 return {...observation,sourceStage:stage,elapsedMs:Date.now()-started,externalRequestCount:external.size,failedHttp:[...failedHttp.values()],cspDirectives:[...csp],cspDetails,requestedPaths:[...paths].sort(),ownedServerStopped:!child||child.exitCode!==null||child.signalCode!==null,browserClosed:!browser||!browser.isConnected(),scope:'Actual GUI post from preseeded disposable funded wallet; parent must verify canonical node effects. Not a full deposit-to-withdraw journey.'};
}
