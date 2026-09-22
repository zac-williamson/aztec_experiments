// TEST ONLY: a real GUI post using a disposable Anvil wallet adapter. No engine,
// PXE, prover, receipt or Aztec node behavior is replaced by this driver.
import fs from 'node:fs';
import {onboardMetaMask,unpackMetaMask,addMetaMaskNetwork,observeMetaMaskTransactions,guardBrowserRequest,assertMetaMaskTransaction} from './t04-metamask.mjs';
import {observeProofPhases} from './t04-browser-performance.mjs';
import {Wallet} from 'ethers';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
import path from 'node:path';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium,firefox,webkit} from 'playwright';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {readJourneyUiDiagnostic,safeJourneyDriverFailure} from './t04-browser-journey.mjs';
import {runT04BrowserPostRecovery} from './t04-browser-post-recovery.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';

export const browserRpcProxy=(name,upstream,token)=>`  handle /rpc/${name} {\n   rewrite * /\n   reverse_proxy ${upstream.host} {\n    header_up x-u01-test-token ${token}\n    transport http {\n     keepalive 500ms\n    }\n   }\n  }\n`;

export async function runU01BrowserPost({directory,browserEngine,ethereumWallet,origin,nodeUrl,ethereumUrl,rpcToken,publicConfig,backupPath,backupPassword,ethereumAccount,message,timeoutMs=480000,diagnostic=false,observeProofStages=false,onStage=()=>{},journeyDriver,depositAmount,fundingAmount,browserMode}) {
 assertNodeVersion();
 const extensionWallet=ethereumWallet==='metamask';
 let walletPage,extensionId,credentials;
 const browserRecovery=['recovery','withdraw-recovery'].includes(browserMode);
 if(!['post','lifecycle','recovery','withdraw-recovery','funding','performance'].includes(browserMode))throw Error('Invalid browser mode');
 const lifecycleAbort=new AbortController();
 const started=Date.now();let browser,context,child,timer,page,debuggerSession,stage='validation';
 const browserProfile=path.join(directory,'browser-profile');let ownsBrowserProfile=false;
 const mark=value=>{stage=value;onStage(value);};
 const confirmations=[],blockedExtensionRequests=[];let proofPhaseCount=0;
 const external=new Set(),csp=new Set(),paths=new Set(),failedHttp=new Map(),cspDetails=[];
 const publicPath=value=>/^\/(?:rpc\/(?:aztec|ethereum)|(?:user|feed|censor|deploy|fee-juice)\.html|(?:aztec_bundle|public-feed|bb-main.worker|bb-thread.worker|sqlite.worker|sqlite3-opfs-async-proxy)\.js|(?:sqlite3|acvm_js_bg|noirc_abi_wasm_bg)\.wasm|crs\/(?:crs-manifest\.json|g1\.dat|g1_uncompressed\.dat|g2\.dat|grumpkin_g1\.dat))$/.test(value)?value:'other-local-path';
 const observation={passed:false,browserEngine,browserMode,ethereumWallet,sourceStage:stage,elapsedMs:0,diagnosticInstrumentation:diagnostic,proofStageObservation:observeProofStages,performanceQualified:false,diagnosticScope:diagnostic&&journeyDriver?'Formatter-only observation with fixed driver/UI diagnostics; no breakpoint or engine/prover replacement.':diagnostic?'Error formatter and catch breakpoint observation; original application behavior preserved.':'Fixed error-category observer; no debugger. GUI wall time only, not isolated proof performance.'};
 const requireValue=(condition)=>{if(!condition)throw Error('Invalid disposable browser test parameters');};
 requireValue(['disposable','metamask'].includes(ethereumWallet));
 requireValue(!extensionWallet||(browserEngine==='chromium'&&['lifecycle','funding'].includes(browserMode)));
 requireValue(['chromium','chrome','firefox','webkit'].includes(browserEngine));
 requireValue(browserEngine==='chromium'||(!browserRecovery&&!diagnostic));
 const selectedBrowser={chromium,chrome:chromium,firefox,webkit}[browserEngine];
 const launchOptions={headless:true,...(browserEngine==='chrome'?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{}),...(['chromium','chrome'].includes(browserEngine)?{args:['--js-flags=--max-old-space-size=768']}:{})};
 const local=value=>{const u=new URL(value);requireValue(['http:','https:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/');return u;};
 const site=local(origin),node=local(nodeUrl),ethereum=local(ethereumUrl);
 requireValue(site.protocol==='https:'&&node.protocol==='http:'&&ethereum.protocol==='http:');
 requireValue(path.isAbsolute(directory)&&path.isAbsolute(backupPath)&&/^[a-zA-Z0-9_-]{24,256}$/.test(rpcToken)&&/^0x[0-9a-fA-F]{40}$/.test(ethereumAccount));
 requireValue(typeof diagnostic==='boolean'&&typeof browserRecovery==='boolean');
 requireValue(['lifecycle','funding','performance'].includes(browserMode)===(typeof journeyDriver==='function'));
 requireValue(!browserRecovery||(!journeyDriver&&!observeProofStages&&!diagnostic));
 requireValue(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=480000&&typeof message==='string'&&message.trim()===message&&Buffer.byteLength(message)>0&&Buffer.byteLength(message)<=992);
 const remoteTarget=publicConfig.remoteProver?local(publicConfig.remoteProver.url):null;
 const config=structuredClone(publicConfig);if(remoteTarget)config.remoteProver={url:site.origin+'/prover'};config.network.nodeUrl=site.origin+'/rpc/aztec';config.network.ethRpcUrl=site.origin+'/rpc/ethereum';
 if(browserMode==='performance')observation.gasSettings=structuredClone(config.privateFee.gasSettings);
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy');
 const remaining=()=>Math.max(1,timeoutMs-(Date.now()-started));
 try {
  mark('local-https');fs.mkdirSync(directory,{recursive:true});
  if(extensionWallet){
   const file=path.join(directory,'metamask-credentials.json');requireValue((fs.lstatSync(file).mode&0o777)===0o600);
   credentials=JSON.parse(fs.readFileSync(file,'utf8'));fs.unlinkSync(file);
   requireValue(Wallet.fromPhrase(credentials.mnemonic).address.toLowerCase()===ethereumAccount.toLowerCase());
   requireValue(local(credentials.rpcUrl).protocol==='http:');
   const extension=unpackMetaMask(directory);launchOptions.channel='chromium';launchOptions.args.push('--disable-extensions-except='+extension,'--load-extension='+extension);
  }
  const cert=path.join(directory,'u01-browser-cert.pem'),key=path.join(directory,'u01-browser-key.pem'),file=path.join(directory,'u01-browser-Caddyfile');
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:15000});
  const generated=generateHosting({dist:path.join(ROOT,'apps/dist'),site:site.origin,certificate:cert,key,local:true,origins:[]});
  // Only this disposable fixture adds RPC routes; the production generator stays static.
  requireValue(generated.caddyfile.includes('  @allowed path '));
  fs.writeFileSync(file,generated.caddyfile.replace('  @allowed path ',(remoteTarget?`  handle_path /prover/* {\n    reverse_proxy ${remoteTarget.host}\n  }\n`:'')+browserRpcProxy('aztec',node,rpcToken)+browserRpcProxy('ethereum',ethereum,rpcToken)+`  handle /board-reader-config.json {\n    header Content-Type application/json\n    respond ${JSON.stringify(JSON.stringify(config))} 200\n  }\n`+'  @allowed path '),{mode:0o600});
  const env={PATH:'/usr/bin:/bin',HOME:directory,XDG_DATA_HOME:directory,XDG_CONFIG_HOME:directory};
  requireValue(/^v2\.11\.4 /.test(execFileSync(caddy,['version'],{encoding:'utf8'})));
  execFileSync(caddy,['validate','--config',file,'--adapter','caddyfile'],{env,stdio:'pipe',timeout:10000});
  child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env,stdio:['ignore','ignore','pipe']});child.on('error',()=>{});
  // Retain fixed transport categories only; Caddy records include private headers.
  observation.proxyErrors=[];observation.proxyErrorsTruncated=false;let proxyLine='';
  child.stderr.on('data',chunk=>{
   proxyLine+=chunk.toString();let end;
   while((end=proxyLine.indexOf('\n'))>=0){const line=proxyLine.slice(0,end);proxyLine=proxyLine.slice(end+1);
    if(line.length>8192||observation.proxyErrors.length>=8){observation.proxyErrorsTruncated=true;continue;}
    try{const value=JSON.parse(line);if(value.level!=='error')continue;
     const message=String(value.msg??'');const category=/\bEOF\b/.test(message)?'eof':/connection reset/i.test(message)?'reset':/connection refused/i.test(message)?'refused':/timeout|deadline exceeded/i.test(message)?'timeout':'other';
     observation.proxyErrors.push({category,status:Number.isInteger(value.status)?value.status:null,elapsedMs:Date.now()-started});
    }catch{/* Non-JSON diagnostics are not retained. */}
   }
   if(proxyLine.length>8192){proxyLine='';observation.proxyErrorsTruncated=true;}
  });
  const ping=()=>new Promise((resolve,reject)=>{const request=https.get(site.origin+'/user.html',{rejectUnauthorized:false,timeout:1000},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('timeout')));});
  let available=false;for(let i=0;i<50;i++){try{if(await ping()===200){available=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}requireValue(available);
  const workflow=async()=>{
   const configureContext=async context=>{
   await context.route('**/*',route=>guardBrowserRequest(route,{origin:site.origin,extensionWallet,onBlocked:record=>{if(record.owner==='extension'){if(blockedExtensionRequests.length<8)blockedExtensionRequests.push(record);}else external.add(record.hostname);}}));
   context.on('request',request=>{const u=new URL(request.url());if(u.origin===site.origin)paths.add(publicPath(u.pathname));});
   context.on('response',response=>{const u=new URL(response.url());if(u.origin===site.origin&&response.status()>=400){const safe=publicPath(u.pathname),key=safe+':'+response.status();failedHttp.set(key,{path:safe,status:response.status()});}});
   await context.exposeBinding('recordProofPhase',(_source,value)=>{requireValue(/^proof-(crs|pxe|proveTx|toTx)-(start|complete)$/.test(value)&&++proofPhaseCount<=64);onStage(value);});
   await context.addInitScript(observeProofPhases);
   await context.exposeBinding('recordU01Csp',(_source,value)=>{if(value&&typeof value.directive==='string'&&/^[a-z-]+$/.test(value.directive)){csp.add(value.directive);if(cspDetails.length<16)cspDetails.push(value);}});
   await context.addInitScript(({account,extensionWallet})=>{
    if(location.protocol==='chrome-extension:')return;
    addEventListener('securitypolicyviolation',event=>{
     let blocked=['eval','wasm-eval','inline'].includes(event.blockedURI)?event.blockedURI:'other',source='other';
     try{if(new URL(event.blockedURI).origin===location.origin)blocked='self';}catch{}
     try{const u=new URL(event.sourceFile);if(u.origin===location.origin&&['/user.html','/aztec_bundle.js','/bb-main.worker.js','/bb-thread.worker.js'].includes(u.pathname))source=u.pathname;}catch{}
     const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
     void globalThis.recordU01Csp({directive:event.effectiveDirective,blocked,source,line:integer(event.lineNumber),column:integer(event.columnNumber)});
    });
    if(extensionWallet)return;
    let id=0;const listeners=new Map();
    const allowed=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_sendTransaction']);
    globalThis.ethereum={isU01DisposableTestAdapter:true,on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);return this;},removeListener(name,fn){listeners.get(name)?.delete(fn);return this;},async request({method,params=[]}){
     if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
     if(!allowed.has(method)||!Array.isArray(params))throw Error('Disposable wallet method denied');
     if(method==='eth_sendTransaction'&&params[0]?.from?.toLowerCase()!==account.toLowerCase())throw Error('Disposable wallet sender denied');
     const response=await fetch('/rpc/ethereum',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
     if(!response.ok)throw Error('Disposable wallet transport failed');const result=await response.json();if(result.error)throw Error('Disposable wallet RPC failed');return result.result;
    }};
   },{account:ethereumAccount,extensionWallet});
   };
   const openContext=async()=>{
    const launched=await selectedBrowser.launchPersistentContext(browserProfile,{...launchOptions,ignoreHTTPSErrors:true,acceptDownloads:false});
    if(lifecycleAbort.signal.aborted){await launched.close();throw Error('Browser lifecycle ended');}
    context=launched;browser=context.browser();requireValue(browser);
    observation.browserVersion=browser.version();
    requireValue(!lifecycleAbort.signal.aborted);await configureContext(context);requireValue(!lifecycleAbort.signal.aborted);
   };
   mark('browser-start');
   fs.mkdirSync(browserProfile,{mode:0o700});ownsBrowserProfile=true;
   await openContext();
   if(extensionWallet){
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:15000});extensionId=new URL(worker.url()).host;
    walletPage=await onboardMetaMask(context,credentials.mnemonic,backupPassword,extensionId,mark);
   }
   page=await context.newPage();page.setDefaultTimeout(Math.min(20000,remaining()));
   mark('wallet-software');const navigationStarted=Date.now();await page.goto(site.origin+(browserMode==='funding'?'/fee-juice.html':'/user.html'));
   await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&document.getElementById('wbAztecFile'),{},{timeout:remaining()});observation.sdkReadyMs=Date.now()-navigationStarted;
   await page.evaluate(installBrowserErrorObserver);
   if(extensionWallet){await page.waitForFunction(()=>!!window.ethereum);await addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl:credentials.rpcUrl,mark});credentials=null;await observeMetaMaskTransactions(page);}
   mark('hosted-board-loaded');if(remoteTarget){requireValue(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).isChecked());requireValue(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).isEnabled());observation.remoteProver=true;}requireValue(await page.getByLabel('Public configuration JSON',{exact:true}).count()===0);requireValue(await page.evaluate(address=>billboardConfigStore.snapshot().config?.board.contractAddress===address,config.board.contractAddress));
   await page.waitForFunction(()=>globalThis.billboardConfigStore?.snapshot().config!==null);
   mark('encrypted-wallet-restore');await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill(backupPassword);await page.locator('#wbAztecFile').setInputFiles(backupPath);
   await page.waitForFunction(()=>!!globalThis.walletState?.aztec?.address||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()});requireValue(await page.evaluate(()=>!!globalThis.walletState?.aztec?.address));
   await page.locator('#wbAccountMenu > summary').click();
   mark('wallet-connect-and-status');const setupStarted=Date.now();await page.locator('#wbEthBrowserBtn').click();
   if(extensionWallet){await walletPage.getByTestId('confirm-btn').waitFor();requireValue((await walletPage.getByTestId('confirm-btn').innerText()).trim()==='Connect');await walletPage.getByTestId('confirm-btn').click();await page.waitForFunction(()=>!!window.walletState?.ethAccount);requireValue((await page.evaluate(()=>window.walletState.ethAccount)).toLowerCase()===ethereumAccount.toLowerCase());}
   if(journeyDriver){
    requireValue(typeof journeyDriver==='function'&&!observeProofStages);
    if(browserMode==='funding'){
     await page.waitForFunction(()=>document.getElementById('setupStatus')?.textContent.includes('Wallet ready. Deposits fund the shared private fee contract.')||document.querySelector('#setupStatus .error'),{},{timeout:remaining()});
     requireValue(await page.locator('#setupStatus .error').count()===0);
    }else if(browserMode==='performance'){
     await page.waitForFunction(()=>document.getElementById('postBtn')?.getClientRects().length>0||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()});requireValue(await page.locator('#postBtn').isVisible());
    }else{
     requireValue(browserMode==='lifecycle');
     await page.waitForFunction(()=>document.getElementById('page-1')?.classList.contains('active')||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()});
     requireValue(await page.locator('#page-1').isVisible());
    }
    observation.walletSetupMs=Date.now()-setupStarted;
    const expectedConfirmations=browserMode==='funding'?['fee-approval','fee-deposit','deposit']:['deposit','refund'];
    const feeAddresses=extensionWallet&&browserMode==='funding'?await page.evaluate(async()=>{const info=await window.__aztec.createAztecNodeClient(billboardConfigStore.snapshot().config.network.nodeUrl).getNodeInfo();return {tokenAddress:info.l1ContractAddresses.feeJuiceAddress.toString(),feePortalAddress:info.l1ContractAddresses.feeJuicePortalAddress.toString()};}):{};
    observation.journey=await journeyDriver({page,directory,message,depositAmount,fundingAmount,backupPath,backupPassword,remaining:()=>timeoutMs-(Date.now()-started),signal:lifecycleAbort.signal,mark,
     onBoardOpened:extensionWallet?async()=>{await page.waitForFunction(()=>!!window.ethereum);await observeMetaMaskTransactions(page);}:undefined,
     confirmEthereum:extensionWallet?async stage=>{
      requireValue(stage===expectedConfirmations[confirmations.length]);
      await page.waitForFunction(()=>Array.isArray(globalThis.__walletTestPending),{},{timeout:remaining()});
      await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();
      const pending=await page.evaluate(()=>globalThis.__walletTestPending);
      assertMetaMaskTransaction({stage,request:pending,account:ethereumAccount,chainId:await page.evaluate(()=>window.ethereum.request({method:'eth_chainId'})),...feeAddresses,privateFeeAddress:config.privateFee.contractAddress,boardPortalAddress:config.board.portalAddress,fundingAmount,collateralAmount:depositAmount});
      await walletPage.getByTestId('confirm-footer-button').click();confirmations.push(stage);
      await page.waitForFunction(data=>globalThis.__walletTestPending?.[0]?.data!==data,pending[0].data,{timeout:remaining()});
     }:undefined,onSubstage:value=>{observation.driverSubstage=value;}});
    if(extensionWallet){requireValue(confirmations.join(',')===expectedConfirmations.join(','));requireValue(!await walletPage.getByTestId('confirm-footer-button').isVisible());observation.walletConfirmations=confirmations;}
    requireValue(observation.journey.passed===true&&external.size===0&&csp.size===0);if(browserMode==='performance')observation.publicTransactionHashes=observation.journey.samples.map(sample=>sample.transactionHash);observation.passed=true;return;
   }
   await page.waitForFunction(()=>{const button=document.getElementById('postBtn');return (button&&button.getClientRects().length>0)||!!document.querySelector('#setupStatus .error');},{},{timeout:remaining()});requireValue(await page.locator('#postBtn').isVisible());observation.walletSetupMs=Date.now()-setupStarted;
   if(browserRecovery){
    mark(browserMode==='withdraw-recovery'?'actual-gui-withdraw':'actual-gui-post');
    const persistedConfig=await page.evaluate(()=>JSON.stringify(globalThis.billboardConfigStore.snapshot().config));
    requireValue(typeof persistedConfig==='string'&&persistedConfig!=='null');
    const recovery=await runT04BrowserPostRecovery({action:browserMode==='withdraw-recovery'?'withdraw':'post',page,directory,remaining:()=>timeoutMs-(Date.now()-started),signal:lifecycleAbort.signal,backupPath,backupPassword,message,restart:async()=>{
     mark('browser-restart');const oldBrowser=browser;
     await context.close();requireValue(!oldBrowser.isConnected());const closedAtMs=Date.now();
     requireValue(!lifecycleAbort.signal.aborted);await openContext();
     page=await context.newPage();page.setDefaultTimeout(Math.min(20000,remaining()));
     await page.goto(site.origin+'/user.html');
     await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&document.getElementById('wbAztecFile'),{},{timeout:remaining()});
     requireValue(await page.evaluate(expected=>JSON.stringify(globalThis.billboardConfigStore?.snapshot().config)===expected,persistedConfig));
     mark('browser-recovery');
     return {page,previousBrowserClosed:true,samePersistentProfile:true,closedAtMs};
    }});
    page=recovery.page;observation.recovery={...recovery};
    observation.publicTransactionHashes=[recovery.transactionHash];
    requireValue(recovery.passed===true&&external.size===0&&csp.size===0);observation.passed=true;return;
   }
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
   if(observeProofStages){
    const phases=new Set(['start','load','accumulate','finalize','hiding-key','verify','compress']);let observed=0;
    await page.exposeBinding('recordU01ProofStage',(_source,phase)=>{if(phases.has(phase)&&observed++<256)onStage('prover-'+phase);});
    await page.evaluate(()=>{
     const actual=globalThis.__aztec.Barretenberg.getSingleton();
     for(const [method,phase] of [['chonkStart','start'],['chonkLoad','load'],['chonkAccumulate','accumulate'],['chonkProve','finalize'],['chonkComputeVk','hiding-key'],['chonkVerify','verify'],['chonkCompressProof','compress']]){
      const original=actual[method];if(typeof original!=='function')throw Error('Proof stage boundary unavailable');
      // Observe public method names only; preserve exact receiver, arguments and
      // returned promise. No debugger, bytecode, witness or proof data captured.
      actual[method]=function(...args){void globalThis.recordU01ProofStage(phase).catch(()=>{});return Reflect.apply(original,this,args);};
     }
    });
   }
   mark('actual-gui-post');await page.locator('#msgText').fill(message);const postStarted=Date.now();await page.locator('#postBtn').click();
   await page.waitForFunction(()=>{const text=document.getElementById('postStatus')?.textContent||'';return text.includes('Message included. Public content and transaction timing remain observable.')||!!document.querySelector('#postStatus .error');},{},{timeout:remaining()});
   observation.guiPostElapsedMs=Date.now()-postStarted;
   const text=await page.locator('#postStatus').textContent();requireValue(text.includes('Message included. Public content and transaction timing remain observable.'));observation.publicTransactionHashes=[...new Set([...text.matchAll(/Transaction hash:\s*(0x[0-9a-fA-F]{64})/g)].map(x=>x[1].toLowerCase()))];
   observation.proofTimingMs=null;observation.proofTimingScope=observeProofStages?'GUI elapsed includes preparation and submission; fixed prover method-entry phases observed without changing arguments or returned promises.':'GUI elapsed includes preparation, proving and submission; no prover method observation.';
   requireValue(external.size===0&&csp.size===0);observation.passed=true;
  };
  await Promise.race([workflow(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser test deadline')),remaining());})]);
 }catch(error) {if(journeyDriver)observation.driverFailure=safeJourneyDriverFailure(error,observation.driverSubstage);observation.passed=false;observation.failure='Browser post failed or timed out; raw provider/browser errors intentionally omitted.';}
 finally {
  lifecycleAbort.abort();
  if(page&&!page.isClosed()){
   if(journeyDriver)try{observation.journeyUiDiagnostic=await Promise.race([page.evaluate(readJourneyUiDiagnostic),new Promise(resolve=>{const timer=setTimeout(()=>resolve({unavailable:true}),1000);timer.unref();})]);}catch{observation.journeyUiDiagnostic={unavailable:true};}
   try{observation.uiDiagnostic=await Promise.race([page.evaluate(()=>{
    const texts=['setupStatus','postStatus','depositBalanceCheck'].map(id=>document.getElementById(id)?.textContent||'').join(' ');
    // Fixed UI strings only; no provider message, wallet value or RPC payload leaves the page.
    const markers={walletFailure:'Wallet operation did not complete.',setupFailure:'Setup did not complete.',operationFailure:'ERROR: operation did not complete',configurationFailure:'configuration changed',provingStarted:'Proving tx (can take minutes)',provingComplete:'Proving complete. Submitting to node',messageIncluded:'Message included. Public content and transaction timing remain observable.'};
    const postText=document.getElementById('postStatus')?.textContent||'';
    const progress=['Reusing cached PXE/wallet setup.','Posting message (','Time lock check passed.','Fetching screening hints...','Pre-flight passed.'];
    return {postProgress:progress.map(text=>postText.includes(text)),formatterDiagnostics:globalThis.__u01FormatterDiagnostics??[],walletRestored:!!globalThis.walletState?.aztec?.address,ethereumConnected:!!globalThis.walletState?.ethSigner,postVisible:!!document.getElementById('postBtn')?.getClientRects().length,postBusy:document.getElementById('postBtn')?.disabled===true,setupHasError:!!document.querySelector('#setupStatus .error'),postHasError:!!document.querySelector('#postStatus .error'),markers:Object.fromEntries(Object.entries(markers).map(([name,text])=>[name,texts.toLowerCase().includes(text.toLowerCase())]))};
   }),new Promise(resolve=>{const t=setTimeout(()=>resolve({unavailable:true}),1000);t.unref();})]);}catch{observation.uiDiagnostic={unavailable:true};}
  }
  if(extensionWallet&&page&&!page.isClosed())try{observation.walletFailure=await page.evaluate(()=>globalThis.__walletTestFailure);observation.blockedExtensionRequests=blockedExtensionRequests;}catch{observation.walletDiagnosticUnavailable=true;}
  clearTimeout(timer);await debuggerSession?.send('Debugger.resume').catch(()=>{});await debuggerSession?.detach().catch(()=>{});await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);await closed;clearTimeout(kill);}
  for(const name of ['u01-browser-Caddyfile','u01-browser-cert.pem','u01-browser-key.pem'])fs.rmSync(path.join(directory,name),{force:true});
  if(ownsBrowserProfile)try{fs.rmSync(browserProfile,{recursive:true,force:true});}catch{observation.passed=false;observation.recoveryProfileCleanupFailed=true;}
 }
 return {...observation,sourceStage:stage,elapsedMs:Date.now()-started,externalRequestCount:external.size,failedHttp:[...failedHttp.values()],cspDirectives:[...csp],cspDetails,requestedPaths:[...paths].sort(),ownedServerStopped:!child||child.exitCode!==null||child.signalCode!==null,browserClosed:!browser||!browser.isConnected(),scope:browserMode==='funding'?'Actual GUI cold fee deposit/claim and paid board claim/post; parent canonical verification required.':browserRecovery?'Actual GUI accepted-transaction response-loss recovery after full persistent-browser restart; parent must verify canonical effects and no repeat submission.':journeyDriver?'Actual GUI lifecycle driver; parent canonical verification is required.': 'Actual GUI post from preseeded disposable funded wallet; parent must verify canonical node effects. Not a full deposit-to-withdraw journey.'};
}
