// Real MetaMask application connection; only read-only Aztec node metadata is a fixture.
// No PXE, Aztec proof, existing wallet profile or real funds.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import http from 'node:http';
import vm from 'node:vm';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,webcrypto,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {Wallet,HDNodeWallet,Contract,ContractFactory,JsonRpcProvider} from 'ethers';
import {phantomPackage,walletExtensionMode,unpackPhantom,onboardPhantom,enablePhantomTestnet,phantomPrompt,phantomTypedData,assertPhantomSignature,phantomMethods} from './t04-phantom.mjs';
import {InboxAbi} from '@aztec-foundation/l1-artifacts/InboxAbi';
import {InboxBytecode} from '@aztec-foundation/l1-artifacts/InboxBytecode';
import {TestERC20Abi} from '@aztec-foundation/l1-artifacts/TestERC20Abi';
import {TestERC20Bytecode} from '@aztec-foundation/l1-artifacts/TestERC20Bytecode';
import {FeeJuicePortalAbi} from '@aztec-foundation/l1-artifacts/FeeJuicePortalAbi';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {recoverPrivateFeeClaim} from '../shared/private-fee-funding.mjs';
import {BarretenbergSync} from '@aztec-foundation/bb.js';
import {derivePrivateFeeAddress,derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {discoverTestMetaMask,onboardMetaMask,unpackMetaMask,addMetaMaskNetwork,configureMetaMaskLocalNetwork,guardBrowserRequest,readMetaMaskAggregateControl,driveMetaMaskAggregateFunding,countMetaMaskAggregateNodeSubmissions,inspectMetaMaskAggregateReadiness,assertMetaMaskReadinessRequest,isMetaMaskStartupFrameRequest,isMetaMaskStartupWorkerRequest,driveMetaMaskPaidRecovery,retainedPreparedClaimFlag,readRetainedBokApproval,driveRetainedBokJourney,readRetainedBokObservation,observeRetainedBokJourney,retainedBokRemaining,installWalletFatalObservation,recordMetaMaskStage,exportMetaMaskUnsignedRecovery,walletChromiumLaunch,readMetaMaskUnsignedContinuation,verifyRetainedBokRecoveryFiles,driveRetainedBokRelease,driveRetainedBokWithdrawal,createRetainedBokRefundAdmission,exportMetaMaskReadyRecovery,verifyRetainedClaimReceipt,readRetainedReadyExport,driveMetaMaskReadyContinuation} from './t04-metamask.mjs';
import {projectRollingInitialization} from '../apps/rolling/wallet-panel.mjs';
import {verifyExtensionCollateral} from './t04-extension-collateral.mjs';
import {ROOT,assertNodeVersion,anvilBinary} from './toolchain.mjs';
assertNodeVersion();
assert.equal(process.env.U01_BOUNDED_BROWSER,'true');
assert(path.isAbsolute(process.env.BILLBOARD_TEST_TMPDIR));
const directory=await fs.mkdtemp(path.join(process.env.BILLBOARD_TEST_TMPDIR,'extension-'));
const mode=walletExtensionMode(process.argv.slice(2));
const children=[];let context,provider,walletPage,page,readFundingState,httpServer,finalizeAggregate,stage='preflight';
const report={passed:false,scope:'Real MetaMask onboarding, custom local network and application connection only; fee signing not yet qualified'};
installWalletFatalObservation(process,value=>console.log(JSON.stringify(value)),()=>stage);
const port=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;};
const ready=async read=>{for(let i=0;i<50;i++){try{if(await read())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Local test server unavailable');};
const httpsReady=origin=>new Promise((resolve,reject)=>{const request=https.get(origin+'/feed.html',{rejectUnauthorized:false,timeout:500},response=>{response.resume();response.on('end',()=>resolve(response.statusCode===200));});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('Local HTTPS unavailable')));});

try{
 if(mode.startsWith('phantom')){
  const extension=unpackPhantom(ROOT,directory),user=Wallet.createRandom();
  report.scope='Real Phantom disposable onboarding, named application selection, Sepolia and exact G04 signatures only; no payment, relay, deployed-contract or liquidity qualification';
  const files=new Map([
   ['/ethers.js',path.join(ROOT,'node_modules/ethers/dist/ethers.umd.min.js')],
   ...['app-env.js','wallet-providers.js','account.js','wallet-buttons.js'].map(name=>['/'+name,path.join(ROOT,'shared',name)]),
  ]);
  httpServer=http.createServer((request,response)=>{
   if(request.method!=='GET'){response.writeHead(405).end();return;}
   const filename=files.get(request.url);
   if(filename){response.setHeader('content-type','text/javascript');fs.readFile(filename).then(bytes=>response.end(bytes),()=>response.writeHead(500).end());return;}
   if(request.url!=='/'){response.writeHead(404).end();return;}
   response.setHeader('content-type','text/html');response.end('<!doctype html><title>Disposable Phantom signature check</title><div id="wallet"></div><script src="/ethers.js"></script><script>window.billboardConfigStore={snapshot:()=>({config:{network:{chainId:"11155111"}},revision:0}),subscribe:()=>()=>{}};</script><script src="/app-env.js"></script><script src="/wallet-providers.js"></script><script src="/account.js"></script><script src="/wallet-buttons.js"></script><script>initWalletButtons("wallet",{autoPasskey:false});</script>');
  });
  await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+httpServer.address().port;
  stage='phantom-launch';context=await chromium.launchPersistentContext(path.join(directory,'profile'),{...walletChromiumLaunch(),headless:true,acceptDownloads:false,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=256']});
  const blocked=[];await context.route('**/*',route=>guardBrowserRequest(route,{origin,extensionWallet:true,onBlocked:record=>blocked.push(record)}));
  walletPage=await onboardPhantom(context,user.mnemonic.phrase,randomBytes(24).toString('base64url'),value=>{stage=value;},{passwordOnly:mode==='phantom-onboarding',onProfile:value=>{report.disposablePhantomProfile=value;}});
  if(mode==='phantom-onboarding'){Object.assign(report,{passed:true,scope:'Real Phantom disposable recovery-phrase import, account discovery and password/terms controls only; no connection, signatures or payments',realExtension:true,extensionVersion:phantomPackage.version,browserVersion:context.browser().version(),transactionRequests:0,relayRequests:0});}else{
  await enablePhantomTestnet(walletPage,value=>{stage=value;});
  page=await context.newPage();page.setDefaultTimeout(8000);await page.goto(origin);
  await page.waitForFunction(()=>BillboardWalletProviders.list().some(wallet=>wallet.name==='Phantom'));
  // Observe the authentic provider unchanged; unexpected methods are denied,
  // never substituted. No signing material leaves this disposable origin.
  await page.evaluate(allowedMethods=>{
   const selected=BillboardWalletProviders.list().find(wallet=>wallet.name==='Phantom');globalThis.phantomTransport=selected.provider;
   const original=selected.provider.request.bind(selected.provider);globalThis.walletMethods=[];globalThis.forbiddenWalletRequests=0;
   selected.provider.request=request=>{
    walletMethods.push(request.method);
    if(!allowedMethods.includes(request.method)){forbiddenWalletRequests++;throw Error('Unexpected signature-only request');}
    return original(request);
   };
  },phantomMethods);
  stage='phantom-named-selection';await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'Phantom',exact:true}).click();
  await phantomPrompt(context,'Connect');await page.waitForFunction(()=>BillboardAccount.snapshot().ethereumConnected);
  assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),user.address.toLowerCase());
  assert.equal(await page.evaluate(()=>walletState.ethWalletName),'Phantom');
  assert.equal(BigInt(await page.evaluate(()=>phantomTransport.request({method:'eth_chainId'}))),11155111n);
  const data=phantomTypedData({account:user.address,portal:Wallet.createRandom().address,router:Wallet.createRandom().address,token:Wallet.createRandom().address,nonce:'0x'+randomBytes(32).toString('hex'),now:Math.floor(Date.now()/1000)});
  report.signatures=[];
  for(let i=0;i<data.length;i++){
   stage='phantom-signature-'+i;
   const pending=page.evaluate(async item=>walletState.ethSigner.signTypedData(item.domain,item.types,item.value),data[i]);
   // Attach rejection immediately while the separate real extension UI responds.
   const observed=pending.then(value=>({value}),()=>({failed:true}));
   await phantomPrompt(context,'Confirm');const result=await observed;assert(!result.failed);
   report.signatures.push({verified:true,digest:assertPhantomSignature(data[i],result.value,user.address)});
  }
  stage='phantom-cancel-signature';
  const cancelled=page.evaluate(async item=>{try{await walletState.ethSigner.signTypedData(item.domain,item.types,item.value);return false;}catch(error){return error.code==='ACTION_REJECTED'||error.code===4001;}},data[0]).then(value=>({value}),()=>({failed:true}));
  await phantomPrompt(context,'Cancel');assert.deepEqual(await cancelled,{value:true});report.cancelledSignature=true;
  stage='phantom-account-change';await walletPage.getByTestId('settings-menu-open-button').click();
  await walletPage.getByTestId('settings-item-manage-accounts').click();
  await walletPage.getByTestId('add-account-menu-item').click();await walletPage.getByTestId('add-account-create-new-wallet-button').click();
  await walletPage.getByTestId('add-seed-account-name-input').fill('Disposable second account');await walletPage.getByTestId('add-seed-account-submit-button').click();
  await page.waitForFunction(()=>walletState.invalidated===true);
  assert.equal(await page.evaluate(()=>BillboardAccount.snapshot().ethereumConnected),false);
  const methods=await page.evaluate(()=>walletMethods);assert.equal(methods.filter(x=>x==='eth_signTypedData_v4').length,3);
  assert.equal(await page.evaluate(()=>forbiddenWalletRequests),0);assert.equal(blocked.length,0);
  Object.assign(report,{passed:true,realExtension:true,extensionVersion:phantomPackage.version,browserVersion:context.browser().version(),namedSelection:true,chainId:11155111,accountChangeInvalidated:true,transactionRequests:0,relayRequests:0,methods});
  }
 }else if(mode.startsWith('metamask-aggregate-')){
  const observationPath=process.env.T04_RETAINED_BOK_OBSERVE,observationOnly=observationPath!==undefined;
  if(observationOnly)assert(process.env.T04_RETAINED_BOK!=='true'&&process.env.T04_AGGREGATE_PAID_RECOVERY!=='true'&&process.env.T04_AGGREGATE_REVIEW_PREPARED!=='true'&&process.env.T04_AGGREGATE_CONTINUE_UNFUNDED!=='true'&&process.env.T04_AGGREGATE_READINESS_ONLY!=='true');
  stage='aggregate-launch-inputs';const readinessOnly=process.env.T04_AGGREGATE_READINESS_ONLY==='true',continueUnfunded=process.env.T04_AGGREGATE_CONTINUE_UNFUNDED==='true',continueUnsigned=process.env.T04_AGGREGATE_CONTINUE_UNSIGNED==='true',paidRecovery=process.env.T04_AGGREGATE_PAID_RECOVERY==='true',retained=readinessOnly||continueUnfunded||continueUnsigned||paidRecovery||observationOnly,control=readMetaMaskAggregateControl(process.env.T04_AGGREGATE_CONTROL,mode.slice('metamask-aggregate-'.length),{readinessOnly,continueUnfunded,continueUnsigned,paidRecovery:paidRecovery||observationOnly});
  const exportOnly=process.env.T04_AGGREGATE_EXPORT_ONLY==='true';assert(process.env.T04_AGGREGATE_EXPORT_ONLY===undefined||['true','false'].includes(process.env.T04_AGGREGATE_EXPORT_ONLY));if(exportOnly)assert(readinessOnly&&!continueUnfunded&&!paidRecovery&&!observationOnly&&process.env.T04_RETAINED_BOK!=='true');
  const readyExport=process.env.T04_AGGREGATE_READY_EXPORT==='true';assert(process.env.T04_AGGREGATE_READY_EXPORT===undefined||['true','false'].includes(process.env.T04_AGGREGATE_READY_EXPORT));if(readyExport){assert(exportOnly);assert.match(process.env.T04_AGGREGATE_CLAIM_HASH??'',/^0x[0-9a-f]{64}$/);}
  const networkOnly=process.env.T04_AGGREGATE_NETWORK_ONLY==='true';assert(process.env.T04_AGGREGATE_NETWORK_ONLY===undefined||['true','false'].includes(process.env.T04_AGGREGATE_NETWORK_ONLY));if(networkOnly)assert(continueUnfunded&&!readinessOnly&&!paidRecovery&&!observationOnly&&process.env.T04_RETAINED_BOK!=='true');
  const reviewPrepared=retainedPreparedClaimFlag(process.env.T04_AGGREGATE_REVIEW_PREPARED,{paidRecovery,readinessOnly,continueUnfunded});
  const bokContinuation=process.env.T04_RETAINED_BOK==='true';assert(process.env.T04_RETAINED_BOK===undefined||['true','false'].includes(process.env.T04_RETAINED_BOK));const bokApproval=readRetainedBokApproval(process.env.T04_RETAINED_BOK_APPROVAL,control,{enabled:bokContinuation||observationOnly,paidRecovery:paidRecovery||observationOnly,observation:observationOnly});
  const readyContinuation=process.env.T04_AGGREGATE_READY_EXPORT_SHA256===undefined?null:readRetainedReadyExport(process.env.T04_AGGREGATE_READY_EXPORT_SHA256,control);if(readyContinuation)assert(paidRecovery&&bokContinuation&&bokApproval?.schemaVersion===1&&!reviewPrepared&&!observationOnly);if(bokContinuation&&bokApproval?.schemaVersion===1)assert(readyContinuation,'Bok continuation requires original Ready custody evidence');
  if(bokApproval?.schemaVersion===2){assert(bokContinuation&&!observationOnly&&!reviewPrepared);verifyRetainedBokRecoveryFiles(bokApproval,control);}
  const refundReadOnly=process.env.T04_RETAINED_BOK_REFUND_READONLY==='true';assert(process.env.T04_RETAINED_BOK_REFUND_READONLY===undefined||['true','false'].includes(process.env.T04_RETAINED_BOK_REFUND_READONLY));if(refundReadOnly)assert(paidRecovery&&bokApproval?.journey==='refund');
  const unsignedContinuation=readMetaMaskUnsignedContinuation(process.env.T04_AGGREGATE_CONTINUE_UNSIGNED,process.env.T04_AGGREGATE_UNSIGNED_EXPORT_SHA256,control,{readinessOnly,continueUnfunded,paidRecovery,observationOnly,retainedBok:bokContinuation,networkOnly});
  if(unsignedContinuation)report.retainedUnsignedExportSha256=unsignedContinuation.sha256;
  const originalBok=observationOnly?readRetainedBokObservation(observationPath):null;
  const refundAdmission=bokApproval?.schemaVersion===2&&['withdraw','refund'].includes(bokApproval.journey)?createRetainedBokRefundAdmission({config:control.walletConfig.config,approval:bokApproval,account:Wallet.fromPhrase(control.mnemonic).address.toLowerCase()}):null;
  report.scope='Real selected MetaMask aggregate devnet payment and canonical public bridge effects only. Private claims/post/Bok execution and real-proof testnet acceptance remain separate.';
  // Fail before opening a profile if the actual served metadata is not the
  // explicitly supplied source-bound deployment. Nothing is injected into it.
  const metadataResponse=await fetch(control.origin+'/wallet/runtime.json',{redirect:'error',signal:AbortSignal.timeout(5000)});assert(metadataResponse.ok);
  const metadataBytes=Buffer.from(await metadataResponse.arrayBuffer());assert(metadataBytes.length<=65536);assert.equal(createHash('sha256').update(metadataBytes).digest('hex'),control.runtimeSha256);
  const metadata=JSON.parse(metadataBytes);for(const key of ['config','trustedQuery','remoteProver','proofsEnabled'])assert.deepEqual(metadata[key],control.walletConfig[key]);
  // This archive has no manifest key: its unpacked path determines extension ID.
  // Retain the exact path with the private profile for subsequent recovery.
  const extension=retained?path.join(control.recoveryDirectory,'extension'):unpackMetaMask(control.recoveryDirectory),profile=path.join(control.recoveryDirectory,'profile');if(!retained)await fs.mkdir(profile,{mode:0o700});
  report.privateRecoveryRetained=true; // Parent retains this fresh private directory; never an existing user profile.
  provider=new JsonRpcProvider(control.ethereumUrl,undefined,{cacheTimeout:-1});assert.equal((await provider.getNetwork()).chainId,31337n);
  stage='aggregate-extension';context=await chromium.launchPersistentContext(profile,{...walletChromiumLaunch(process.env,{aggregate:true}),headless:true,acceptDownloads:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=256']});
  report.browserVersion=context.browser().version();
  report.browserLifecycle={contextClosed:false,disconnected:false,pageCrashed:false};context.on('close',()=>{report.browserLifecycle.contextClosed=true;});context.browser().on('disconnected',()=>{report.browserLifecycle.disconnected=true;});context.on('page',p=>p.on('crash',()=>{report.browserLifecycle.pageCrashed=true;}));
  const markAggregate=value=>{stage=value;recordMetaMaskStage(value=>console.log(JSON.stringify(value)),context,control.origin,stage);};
  markAggregate('aggregate-extension');
  const allowed=new Set([control.origin,control.ethereumUrl,new URL(control.walletConfig.trustedQuery.url).origin]);
  if(control.walletConfig.remoteProver)allowed.add(new URL(control.walletConfig.remoteProver.url).origin);
  for(const origin of allowed){const url=new URL(origin);assert.equal(url.protocol,'http:');assert.equal(url.hostname,'127.0.0.1');}
  const extensionIdentity=(context.serviceWorkers()[0]?Promise.resolve(context.serviceWorkers()[0]):context.waitForEvent('serviceworker',{timeout:15000})).then(worker=>'chrome-extension://'+new URL(worker.url()).host);
  let blocked=0,proofRequests=0,l2Submissions=0,extensionStartupDocuments=0;const blockedDetails=[];
  const recordBlocked=(url,reason,frame)=>{blocked++;if(blockedDetails.length<8)blockedDetails.push({origin:url.origin,path:url.pathname.replace(/0x[0-9a-fA-F]{16,}/g,'[hex]').slice(0,160),reason,extensionParent:frame?.parentFrame()?.url().startsWith('chrome-extension:')===true,startupFrame:frame?.url().endsWith('#extensionStartup')===true,topLevel:frame?.parentFrame()===null});};
  finalizeAggregate=()=>{Object.assign(report,{blockedRequests:blocked,blockedDetails,proofRequests,l2Submissions,extensionStartupDocuments});assert.equal(blocked,0);assert.equal(proofRequests,0);};
  await context.route('**/*',async route=>{
   const request=route.request(),worker=request.serviceWorker(),frame=worker?null:request.frame(),url=new URL(request.url());
   if(worker?worker.url().startsWith('chrome-extension:'):frame.url().startsWith('chrome-extension:'))return route.continue();
   if(worker&&isMetaMaskStartupWorkerRequest({method:request.method(),url:request.url(),workerUrl:worker.url(),startupFrameObserved:extensionStartupDocuments>0})){extensionStartupDocuments++;return route.continue();}
   if(frame?.parentFrame()?.url().startsWith('chrome-extension:')&&url.href.startsWith('https://metamask.github.io/phishing-warning/v5.1.0/')){
    const element=await frame.frameElement();try{if(isMetaMaskStartupFrameRequest({method:request.method(),url:request.url(),parentUrl:frame.parentFrame().url(),extensionOrigin:await extensionIdentity,frameSource:await element.getAttribute('src'),sandbox:await element.getAttribute('sandbox')})){extensionStartupDocuments++;return route.continue();}}finally{await element.dispose();}
   }
   if(['http:','https:'].includes(url.protocol)&&!allowed.has(url.origin)){recordBlocked(url,'origin',frame);return route.abort();}
   if(request.method()==='POST'&&url.pathname==='/v1/jobs'){proofRequests++;return route.abort();}
   try{const observed={url:request.url(),method:request.method(),body:request.postData()},sends=countMetaMaskAggregateNodeSubmissions(observed,control.walletConfig.trustedQuery.url);l2Submissions+=sends;if(readinessOnly||observationOnly||networkOnly||bokApproval?.journey==='refund')assert.equal(sends,0);if(readinessOnly||paidRecovery||observationOnly||networkOnly)(refundAdmission&&!refundReadOnly?refundAdmission.assertRequest(observed,control.ethereumUrl):assertMetaMaskReadinessRequest(observed,control.ethereumUrl));}catch{recordBlocked(url,'rpc-or-readiness',frame);return route.abort();}
   return route.continue();
  });
  const extensionId=new URL(await extensionIdentity).host;
  if(!retained)walletPage=await onboardMetaMask(context,control.mnemonic,control.password,extensionId,markAggregate);
  if(continueUnfunded||continueUnsigned||paidRecovery){walletPage=await context.newPage();walletPage.setDefaultTimeout(10000);await walletPage.goto('chrome-extension://'+extensionId+'/home.html');await walletPage.getByTestId('unlock-password').waitFor();await walletPage.getByTestId('unlock-password').fill(control.password);await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('unlock-password').waitFor({state:'hidden'});}
  page=await context.newPage();page.setDefaultTimeout(10000);await page.goto(control.origin);
  markAggregate('aggregate-application-open');
  if(exportOnly){report.scope='Original unsigned private recovery export only; no quote, consent, payment or claim.';if(readyExport){report.scope='Current confirmed private account encrypted export only; keys-only unlock preserves all advanced profile journals; no payment or claim.';await exportMetaMaskReadyRecovery({page,control,provider,transactionHash:process.env.T04_AGGREGATE_PAID_HASH,claimTransactionHash:process.env.T04_AGGREGATE_CLAIM_HASH,mark:markAggregate,report});}else await exportMetaMaskUnsignedRecovery({page,control,mark:markAggregate,report});assert.equal(l2Submissions,0);assert.equal(proofRequests,0);assert.equal(blocked,0);report.passed=true;}else if(observationOnly){report.scope='Read-only original confirmed Bok request: public discovery and canonical SDK event/fee/accounting verification only.';await observeRetainedBokJourney({page,control,approval:bokApproval,publicIntent:originalBok,mark:markAggregate,report,remaining:retainedBokRemaining(Number(process.env.T04_BROWSER_DEADLINE_AT))});assert.equal(l2Submissions,0);assert.equal(proofRequests,0);assert.equal(blocked,0);report.passed=true;report.bokObservationOnly=true;}else if(readinessOnly){report.scope='Retained disposable account initialization only; no signatures, funding, proof or L2 sends';await inspectMetaMaskAggregateReadiness({page,control,mark:markAggregate,remaining:retainedBokRemaining(Number(process.env.T04_BROWSER_DEADLINE_AT))});report.passed=true;report.readinessOnly=true;}else{
  // Discovery and network addition use the authentic extension; no account or
  // native PXE implementation is replaced by this development test.
  await page.getByRole('button',{name:'Your account',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Unlock',exact:true}).click();
  await discoverTestMetaMask(page);
  if(networkOnly)await page.evaluate(()=>{const original=__testMetaMask.request.bind(__testMetaMask);globalThis.__networkOnlyMethods=[];__testMetaMask.request=request=>{if(!['eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain'].includes(request.method))throw Error('Network-only wallet operation forbidden');__networkOnlyMethods.push(request.method);return original(request);};});
  report.localNetwork=await configureMetaMaskLocalNetwork({page,walletPage,extensionId,rpcUrl:control.ethereumUrl,mark:markAggregate});
  await page.getByRole('dialog').getByRole('button',{name:'Close account panel',exact:true}).click();
  if(continueUnfunded||continueUnsigned||paidRecovery)await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');
  if(networkOnly){report.scope='Retained extension local network registration and selection only; no private account, signatures or funding.';report.networkOnly=true;report.methods=await page.evaluate(()=>__networkOnlyMethods);assert.equal(await provider.getTransactionCount(Wallet.fromPhrase(control.mnemonic).address,'pending'),0);assert.equal(l2Submissions,0);assert.equal(proofRequests,0);}
  else if(paidRecovery&&bokApproval?.schemaVersion===2){
   const before=l2Submissions,remaining=retainedBokRemaining(Number(process.env.T04_BROWSER_DEADLINE_AT)),finalizeTraffic=finalizeAggregate;
   const expected=before+(bokApproval.journey==='release'?2:bokApproval.journey==='refund'?0:1);let finalizePaidRecovery;finalizeAggregate=()=>{finalizeTraffic();finalizePaidRecovery?.();if(refundAdmission){if(refundReadOnly){report.bokRefundAdmission=refundAdmission.snapshot();assert.deepEqual(report.bokRefundAdmission,{providerSends:0,outerSends:0,denied:0,acknowledged:false});}else report.bokRefundAdmission=refundAdmission.finish();}assert.equal(l2Submissions,expected);};
   if(bokApproval.journey==='release'){
    finalizePaidRecovery=await driveMetaMaskPaidRecovery({page,walletPage,control,provider,transactionHash:process.env.T04_AGGREGATE_PAID_HASH,mark:markAggregate,report,recoveryFile:bokApproval.recoveryFile});
    assert.equal(l2Submissions,before,'This stage starts only after the original claim is already confirmed');assert.equal(report.paidRecovery.claimTransactionHash,process.env.T04_AGGREGATE_CLAIM_HASH);report.originalCanonicalClaim=await verifyRetainedClaimReceipt({control,transactionHash:process.env.T04_AGGREGATE_CLAIM_HASH});
    await driveRetainedBokRelease({page,control,approval:bokApproval,mark:markAggregate,report,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT)});finalizePaidRecovery();assert.equal(l2Submissions,before+2);
   }else{await driveRetainedBokWithdrawal({page,walletPage,control,approval:bokApproval,provider,refundAdmission,mark:markAggregate,report,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT),readOnly:refundReadOnly});assert.equal(l2Submissions,expected);}
   remaining();report.scope='Original funded private account: explicit interrupted authorization release or separate exact Bok withdrawal; no post, model call, new funding or expiry qualification.';
  }
  else if(paidRecovery){report.scope='Saved canonical payment to private claim through actual UI; no new Ethereum payment. Native development only.';const finalizePaid=readyContinuation?await driveMetaMaskReadyContinuation({page,control,provider,transactionHash:process.env.T04_AGGREGATE_PAID_HASH,readyExport:readyContinuation,mark:markAggregate,report,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT)}):await driveMetaMaskPaidRecovery({page,walletPage,control,provider,transactionHash:process.env.T04_AGGREGATE_PAID_HASH,reviewPrepared,mark:markAggregate,report,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT)});const finalizeTraffic=finalizeAggregate;let expectedBokSends=null;finalizeAggregate=()=>{finalizeTraffic();finalizePaid();if(expectedBokSends!==null)assert.equal(l2Submissions,expectedBokSends);};if(bokContinuation){const before=l2Submissions;await driveRetainedBokJourney({page,control,approval:bokApproval,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT),mark:markAggregate,report});expectedBokSends=before+2;assert.equal(l2Submissions,expectedBokSends);report.scope=bokApproval.completion==='post-only'?'Original paid claim plus exactly approved canonical Bok authorization/post; reply, terminal accounting and provider billing remain pending. Native development only; no new Ethereum payment.':'Original paid claim plus explicitly approved Bok authorization/post and authenticated reply/terminal accounting; native development only, no new Ethereum payment.';}}
  else {const finalizePayment=await driveMetaMaskAggregateFunding({context,page,walletPage,control,provider,mark:markAggregate,report,continueUnfunded,unsignedContinuation,deadlineAt:Number(process.env.T04_BROWSER_DEADLINE_AT)});
  const finalizeTraffic=finalizeAggregate;finalizeAggregate=()=>{finalizeTraffic();finalizePayment();assert.equal(l2Submissions,1,'Automatic triple claim must use exactly one L2 transaction');};}
  if(report.aggregate?.privateClaimQualified)report.scope='Real selected MetaMask aggregate payment, canonical three-bridge effects and automatic original private triple claim to Ready; native development, no new post.';
  assert.equal(blocked,0);assert.equal(proofRequests,0);Object.assign(report,{passed:true,realExtension:true,extensionVersion:'13.49.0.0',browserVersion:context.browser().version(),proofRequests,l2Submissions,privateRecoveryRetained:true});
  }
 }else{
 const extension=unpackMetaMask(directory);
 const rpcUrl='http://127.0.0.1:'+await port();
 children.push(spawn(anvilBinary(),['--host','127.0.0.1','--port',new URL(rpcUrl).port,'--chain-id','31337','--accounts','0','--silent'],{cwd:directory,stdio:'ignore'}));
 await ready(async()=>{const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),signal:AbortSignal.timeout(500)});return (await response.json()).result==='0x7a69';});
 provider=new JsonRpcProvider(rpcUrl,31337,{staticNetwork:true,cacheTimeout:-1,pollingInterval:50});
 const user=Wallet.createRandom(),operator=Wallet.createRandom().connect(provider);
 for(const account of [user,operator])await provider.send('anvil_setBalance',[account.address,'0x3635c9adc5dea00000']);
 stage='ethereum-fixture';const publisherArtifact=JSON.parse(await fs.readFile(path.join(ROOT,'.build/portal-tests/out/PortalV1.t.sol/RootPublisher.json')));
 const publisher=await new ContractFactory(publisherArtifact.abi,publisherArtifact.bytecode.object,operator).deploy(5);await publisher.waitForDeployment();
 const token=await new ContractFactory(TestERC20Abi,TestERC20Bytecode,operator).deploy('Disposable fee token','FEE',operator.address);await token.waitForDeployment();
 const inbox=await new ContractFactory(InboxAbi,InboxBytecode,operator).deploy(await publisher.getAddress(),await token.getAddress(),5,10,1);await inbox.waitForDeployment();await (await publisher.setInbox(await inbox.getAddress())).wait();
 const feePortal=new Contract(await inbox.getFeeAssetPortal(),FeeJuicePortalAbi,provider);await (await token.mint(user.address,2000n)).wait();
 const feeArtifact=JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/private_fee_artifact.json'))),payer=await derivePrivateFeeAddress(feeArtifact);
 const addresses={rollupAddress:(await publisher.getAddress()).toLowerCase(),feeJuicePortalAddress:(await feePortal.getAddress()).toLowerCase(),feeJuiceAddress:(await token.getAddress()).toLowerCase()};
 readFundingState=async()=>{
  const events=await token.queryFilter(token.filters.Approval(user.address,addresses.feeJuicePortalAddress));
  const approvals=[];for(const event of events.slice(0,3)){const tx=await provider.getTransaction(event.transactionHash),receipt=await provider.getTransactionReceipt(event.transactionHash);approvals.push({amount:String(event.args.value),nonce:tx.nonce,chainId:String(tx.chainId),matchesSender:tx.from.toLowerCase()===user.address.toLowerCase(),matchesTarget:tx.to.toLowerCase()===addresses.feeJuiceAddress,matchesCalldata:tx.data===token.interface.encodeFunctionData('approve',[addresses.feeJuicePortalAddress,1000n]),value:String(tx.value),status:receipt.status,canonical:(await provider.getBlock(receipt.blockNumber)).hash===receipt.blockHash});}
  return {nonce:await provider.getTransactionCount(user.address),balance:String(await token.balanceOf(user.address)),allowance:String(await token.allowance(user.address,addresses.feeJuicePortalAddress)),approvals};
 };

 const secret=Fr.random(),salt=Fr.random(),backupPassword=randomBytes(24).toString('base64url');assert(!secret.isZero());
 const backupContext=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile(path.join(ROOT,'shared/wallet-backup.js'),'utf8'),backupContext);
 const backup=await backupContext.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:secret.toString(),salt:salt.toString()},claims:[]},backupPassword),backupPath=path.join(directory,'wallet.encrypted.json');await fs.writeFile(backupPath,JSON.stringify(backup),{mode:0o600,flag:'wx'});
 stage='https';const origin='https://127.0.0.1:'+await port(),cert=path.join(directory,'cert.pem'),key=path.join(directory,'key.pem');
 execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:10000});
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy'),hosting=path.join(directory,'Caddyfile');await fs.writeFile(hosting,generateHosting({dist:path.join(ROOT,'apps/dist'),site:origin,certificate:cert,key,local:true,origins:[rpcUrl]}).caddyfile);
 children.push(spawn(caddy,['run','--config',hosting,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:directory,XDG_DATA_HOME:directory,XDG_CONFIG_HOME:directory},stdio:'ignore'}));await ready(()=>httpsReady(origin));
 stage='extension-launch';context=await chromium.launchPersistentContext(path.join(directory,'profile'),{...walletChromiumLaunch(),headless:true,ignoreHTTPSErrors:true,acceptDownloads:false,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=256']});
 const blockedContextRequests=[];
 await context.route('**/*',route=>guardBrowserRequest(route,{origin,extensionWallet:true,onBlocked:record=>{if(blockedContextRequests.length<8)blockedContextRequests.push(record);}}));report.blockedContextRequests=blockedContextRequests;
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:15000}),extensionId=new URL(worker.url()).host;
 walletPage=await onboardMetaMask(context,user.mnemonic.phrase,randomBytes(24).toString('base64url'),extensionId,value=>{stage=value;});
 stage='application';page=await context.newPage();page.setDefaultTimeout(15000);let unexpectedRequests=0,provingAssetRequests=0;await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/crs/'))provingAssetRequests++;if(['http:','https:'].includes(url.protocol)&&url.origin!==origin&&url.origin!==new URL(rpcUrl).origin){unexpectedRequests++;return route.abort();}return route.continue();});await page.goto(origin+'/fee-juice.html');await page.waitForFunction(()=>!!window.__aztec?.createAztecNodeClient);
 await page.evaluate(async ({addresses})=>{
  const a=globalThis.__aztec;
  const canonical=await a.getContractInstanceFromInstantiationParams(a.loadContractArtifact(BILLBOARD_PRIVATE_FEE_ARTIFACT),{salt:a.Fr.ZERO,deployer:a.AztecAddress.ZERO,constructorArgs:[]});
  const metadata={getContract:async address=>address.toString()===canonical.address.toString()?canonical:undefined,getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5,l1ContractAddresses:addresses}),getL1ContractAddresses:async()=>addresses};
  // Explicit test boundary: real Ethereum fixture identity, no Aztec node/proofs.
  globalThis.__aztec={...globalThis.__aztec,createAztecNodeClient:()=>metadata,createPXE:()=>{throw Error('Unexpected PXE in Ethereum-only test');}};
 },{addresses});
 const config={schemaVersion:1,network:{nodeUrl:origin+'/fixture-node',ethRpcUrl:rpcUrl,chainId:'31337',rollupVersion:'5',rollupAddress:addresses.rollupAddress},board:{portalAddress:addresses.feeJuicePortalAddress,contractAddress:Fr.random().toString()},privateFee:{contractAddress:payer.toString(),gasSettings:{gasLimits:{daGas:'10',l2Gas:'20'},teardownGasLimits:{daGas:'0',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'2',feePerL2Gas:'3'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}};
 // Ethereum-only fixture supplies settings directly; the real Aztec browser journey qualifies hosted loading.
 await page.waitForFunction(()=>document.getElementById('setupStatus').textContent.includes('unavailable for posting'));
 await page.evaluate(config=>{billboardConfigStore.install(config);initializePrivateFees();},config);
 await page.waitForFunction(()=>!!globalThis.billboardConfigStore?.snapshot().config);
 await discoverTestMetaMask(page);report.chainBeforeAddition=await page.evaluate(()=>globalThis.__testMetaMask.request({method:'eth_chainId'}));report.addNetworkState='pending';
 await addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl,mark:value=>{stage=value;}});report.addNetworkState='resolved';
 stage='restore-application-wallet';await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill(backupPassword);await page.locator('#wbAztecFile').setInputFiles(backupPath);await page.waitForFunction(()=>!!window.walletState?.aztec?.address);await page.locator('#wbAccountMenu > summary').click();
 report.accountsBeforeConnect=await page.evaluate(async expected=>{const accounts=await globalThis.__testMetaMask.request({method:'eth_accounts'});return {count:accounts.length,matchesExpected:accounts.length===1&&accounts[0].toLowerCase()===expected};},user.address.toLowerCase());
 stage='connect-wallet';await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
 await walletPage.getByTestId('confirm-btn').waitFor();assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');await walletPage.getByTestId('confirm-btn').click();
 await page.waitForFunction(()=>window.walletState?.ethAccount);assert.equal((await page.evaluate(()=>window.walletState.ethAccount)).toLowerCase(),user.address.toLowerCase());assert.equal(await page.evaluate(()=>window.walletState.ethChainId),'31337');
 await page.waitForFunction(expected=>document.getElementById('azaddr')?.value===expected&&!document.getElementById('depositBtn').disabled&&document.getElementById('setupStatus').textContent.includes('Wallet ready.'),payer.toString());assert.equal(await page.locator('#setupStatus .error').count(),0);assert.equal(unexpectedRequests,0);assert.equal(provingAssetRequests,0);
 assert.equal(await page.locator('#wbConnectionStatus').innerText(),'MetaMask · '+user.address);
 report.selectedWalletIdentityVisible=true;
 stage='reject-token-approval';await page.locator('#amount').fill('0.000000000000001');await page.locator('#depositBtn').click();
 await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();await walletPage.getByTestId('confirm-footer-cancel-button').click();await page.locator('#depositStatus .error').waitFor();
 assert.equal(await provider.getTransactionCount(user.address),0);assert.equal(await token.allowance(user.address,addresses.feeJuicePortalAddress),0n);assert.equal(await token.balanceOf(user.address),2000n);report.rejectionMovedNoFunds=true;
 await page.locator('#depositStatus .error').filter({hasText:'Payment cancelled. No transaction was sent. You can try again.'}).waitFor();
 stage='normal-retry-after-cancellation';await page.locator('#depositBtn').click();await walletPage.getByTestId('confirm-footer-button').click();
 stage='approval-receipt';await ready(async()=>await provider.getTransactionCount(user.address)===1&&await token.allowance(user.address,addresses.feeJuicePortalAddress)===1000n);
 stage='deposit-fees';await walletPage.getByTestId('confirm-footer-button').waitFor();await walletPage.getByTestId('confirm-footer-button').click();await page.locator('#depositStatus .success').filter({hasText:'Deposit recorded. Download the recovery file, then claim after the bridge message is available.'}).waitFor();
 const record=await page.evaluate(()=>JSON.parse(localStorage.getItem(localStorage.getItem('billboard-private-fee-recovery-latest'))));
 stage='verify-canonical-deposit';const owner=AztecAddress.fromStringUnsafe(await page.evaluate(()=>window.walletState.aztec.address.toString()));assert(await owner.isValid());
 const canonical=await derivePrivateFeeInstance(feeArtifact);
 const node={getContract:async address=>address.toString()===canonical.address.toString()?canonical:undefined,getNodeInfo:async()=>({l1ChainId:31337,rollupVersion:5,l1ContractAddresses:addresses})};
 const recoveryInput={node,ethProvider:provider,owner,walletSecret:secret,privateFeeArtifact:feeArtifact,record,expectedChainId:'31337',expectedVersion:'5'};
 const claim=await recoverPrivateFeeClaim(recoveryInput);assert.equal(claim.amount,1000n);assert.equal(record.nonce,'1');assert.equal(record.sender.toLowerCase(),user.address.toLowerCase());
 assert.equal(await token.balanceOf(user.address),1000n);assert.equal(await token.balanceOf(addresses.feeJuicePortalAddress),1000n);assert.equal(await token.allowance(user.address,addresses.feeJuicePortalAddress),0n);
 const approvals=await token.queryFilter(token.filters.Approval(user.address,addresses.feeJuicePortalAddress));assert.equal(approvals.length,1);assert.equal(approvals[0].args.value,1000n);
 const approvalTx=await provider.getTransaction(approvals[0].transactionHash);assert.equal(approvalTx.nonce,0);assert.equal(approvalTx.from.toLowerCase(),user.address.toLowerCase());assert.equal(approvalTx.to.toLowerCase(),addresses.feeJuiceAddress);assert.equal(approvalTx.data,token.interface.encodeFunctionData('approve',[addresses.feeJuicePortalAddress,1000n]));assert.equal(approvalTx.value,0n);const approvalReceipt=await provider.getTransactionReceipt(approvalTx.hash);assert.equal(approvalReceipt.status,1);assert.equal((await provider.getBlock(approvalReceipt.blockNumber)).hash,approvalReceipt.blockHash);
 stage='recover-saved-deposit';await page.getByRole('button',{name:'Check saved Ethereum fee request',exact:true}).click();await page.locator('#depositStatus .success').filter({hasText:'Private fee deposit recovered. Claim after the bridge message is available.'}).waitFor();
 const savedAgain=await page.evaluate(()=>JSON.parse(localStorage.getItem(localStorage.getItem('billboard-private-fee-recovery-latest'))));assert.deepEqual(savedAgain,record);
 const recovered=await recoverPrivateFeeClaim({...recoveryInput,record:savedAgain});assert.equal(recovered.leafIndex.toString(),claim.leafIndex.toString());assert.equal(await provider.getTransactionCount(user.address),2);
 assert.equal(unexpectedRequests,0);assert.equal(provingAssetRequests,0);report.depositAmount='1000';report.canonicalRecoveryVerified=true;report.normalRetryAfterCancellationVerified=true;
 stage='board-collateral-refund';report.collateral=await verifyExtensionCollateral({page,walletPage,provider,publisher,operator,user,rpcUrl});
 // MetaMask may show this optional marketing modal after a transaction.
 // Handle the real overlay during actionability checks, including late arrival.
 await walletPage.addLocatorHandler(walletPage.getByTestId('shield-entry-modal-close-button'),async()=>{await walletPage.getByTestId('shield-entry-modal-close-button').click();report.dismissedWalletOffer=true;});
 stage='wait-wallet-home-after-refund';await walletPage.waitForURL(/#\/$/);
 stage='create-second-disposable-account';
 const secondAccount=HDNodeWallet.fromPhrase(user.mnemonic.phrase,undefined,"m/44'/60'/0'/0/1").address;
 await walletPage.getByTestId('account-menu-icon').click();
 await walletPage.getByTestId('parent-selector-account-list-page').waitFor();
 stage='click-add-second-account';await walletPage.getByTestId('add-multichain-account-button').click();
 stage='wait-second-account-created';await walletPage.getByText('Account 2',{exact:true}).waitFor();
 stage='reselect-already-authorized-account';
 await page.reload();await page.waitForFunction(()=>window.BillboardWalletProviders?.list().some(wallet=>wallet.rdns==='io.metamask')&&window.BillboardAccount);
 // Isolate the account controls from Aztec setup for this Ethereum-only check.
 await page.evaluate(()=>initWalletButtons('walletButtonsContainer',{autoPasskey:false}));
 await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
 await walletPage.getByTestId('confirm-btn').waitFor();
 assert.equal(await page.evaluate(()=>window.BillboardAccount.snapshot().ethereumConnected),false);
 await walletPage.getByTestId('account-selection-section').click();
 const accountChoices=walletPage.locator('input[id^="multichain-account-checkbox-"]');await accountChoices.nth(1).waitFor();
 assert.equal(await accountChoices.count(),2);await accountChoices.nth(0).uncheck();await accountChoices.nth(1).check();
 await walletPage.getByTestId('connect-more-accounts-button').click();
 await walletPage.getByTestId('confirm-btn').click();
 await page.waitForFunction(()=>window.BillboardAccount.snapshot().ethereumConnected);
 assert.equal(await page.locator('#wbConnectionStatus').innerText(),'MetaMask · '+secondAccount);
 report.existingPermissionRequiresApproval=true;report.reselectedDifferentAccount=true;
 assert(blockedContextRequests.every(record=>record.owner==='extension'&&record.hostname==='metamask.github.io'));
 report.passed=true;report.realExtension=true;report.browserVersion=context.browser().version();report.extensionVersion='13.49.0.0';report.connectedLocalAccount=true;report.userEthereumTransactions=await provider.getTransactionCount(user.address);assert.equal(report.userEthereumTransactions,4);report.scope='Real MetaMask connection, rejected approval, normal retry after cancelled approval, fee deposit, board collateral/refund and read-only canonical recovery; controlled Outbox roots, no Aztec claim/proof';
}
}catch(error){
 report.passed=false;report.failure={stage,errorClass:error.name};if(report.browserLifecycle)report.failure.browserLifecycle={...report.browserLifecycle};
 const location=String(error.stack).match(/(?:t04-phantom|t04-metamask|t04-extension-collateral|test-wallet-extension-browser)\.mjs:\d+:\d+/);if(location)report.failure.location=location[0];process.exitCode=1;
 if(mode.startsWith('metamask-aggregate-')&&page&&!page.isClosed())try{const raw=await page.getByRole('dialog').getAttribute('data-rolling-initialization',{timeout:1000});report.initialization=raw&&raw.length<=1024?projectRollingInitialization(JSON.parse(raw)):null;report.privatePanelControls={};for(const label of ['Recover funding','Connect private account','Check account recovery','Import recovery'])report.privatePanelControls[label]=await page.getByRole('dialog').getByRole('button',{name:label,exact:true}).isVisible();}catch{report.initializationDiagnosticFailed=true;}
 if(readFundingState)try{report.canonicalFundingState=await readFundingState();}catch{report.fundingDiagnosticFailed=true;}
 if(page&&!page.isClosed())try{report.applicationState=await page.evaluate(()=>({ethereumConnected:!!window.walletState?.ethAccount,snapshotConnected:window.BillboardAccount?.snapshot().ethereumConnected===true,selectedMetaMask:window.BillboardAccount?.snapshot().ethereumWalletName==='MetaMask',selectedLocalChain:window.walletState?.ethChainId==='31337',aztecLoaded:!!window.walletState?.aztec?.address,setupError:!!document.querySelector('#setupStatus .error'),feeAddressReady:!!document.getElementById('azaddr')?.value,invalidated:window.walletState?.invalidated===true}));}catch(diagnostic){report.applicationDiagnosticFailure={errorClass:diagnostic.name};}
 if(context&&mode.startsWith('phantom'))try{
  report.walletSurfaces=[];
  for(const inspected of context.pages().slice(0,8)){
   const url=new URL(inspected.url());if(url.protocol!=='chrome-extension:')continue;
   const surface={path:url.pathname,controls:{}};
   for(const id of ['onboarding-form-submit-button','onboarding-form-password-input','onboarding-form-terms-of-service-checkbox','username','onboarding-create-username-complete-later','onboarding-create-username-continue','onboarding-claiming-username-get-started','settings-menu-open-button','toggleTestNetwork','btn-confirm','home-header-account-name','settings-item-manage-accounts','add-account-menu-item','add-account-create-new-wallet-button','add-seed-account-name-input'])surface.controls[id]=await inspected.getByTestId(id).isVisible();
   for(const id of ['onboarding-form-password-input','onboarding-form-terms-of-service-checkbox']){const element=inspected.getByTestId(id);if(await element.count())surface.controls[id+'-shape']=await element.evaluate(e=>({tag:e.tagName,type:e.getAttribute('type'),checked:e.type==='checkbox'?e.checked:null}));}
   const username=inspected.getByPlaceholder('username',{exact:true});
   if(await username.isVisible()){
    surface.username={present:true,continueEnabled:await inspected.getByTestId('onboarding-create-username-continue').isEnabled(),validation:{}};
    // Only fixed public translations from the pinned package, never input/body text.
    for(const [code,text] of Object.entries({available:'Username available',unavailable:'Username unavailable',pending:'Checking username…',serverError:'Unable to check if username is available, please try again later',invalidCharacters:'Invalid username. Usernames can only contain letters and numbers.',invalidLength:'Usernames must be between 2 and 20 characters long'}))surface.username.validation[code]=await inspected.getByText(text,{exact:true}).isVisible();
   }
   report.walletSurfaces.push(surface);
  }
 }catch{report.walletDiagnosticFailed=true;}
 if(context&&mode.startsWith('metamask'))try{
  report.walletSurfaces=[];
  for(const inspected of context.pages().slice(0,8)){
   const url=new URL(inspected.url());if(url.protocol!=='chrome-extension:')continue;
   const surface={path:url.pathname,route:url.hash,controls:{}};
   if(mode==='metamask'&&(['#/account-list','#/'].includes(url.hash)||stage==='reselect-already-authorized-account'))surface.visibleText=(await inspected.locator('body').innerText()).slice(0,4000);
   report.walletSurfaces.push(surface);
   for(const id of ['confirm-btn','parent-selector-confirmation-page','confirm-footer-button','parent-selector-template-confirmation-page','confirmation-submit-button','confirmation-cancel-button','account-menu-icon'])surface.controls[id]=await inspected.getByTestId(id).isVisible();
  }
 }catch(diagnostic){report.diagnosticFailure={errorClass:diagnostic.name};}
}
finally{
 try {
 await context?.close();if(httpServer)await new Promise((resolve,reject)=>httpServer.close(error=>error?reject(error):resolve()));await BarretenbergSync.destroySingleton();provider?.destroy();
 for(const child of children){if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1500);await closed;clearTimeout(timer);}}
 await fs.rm(directory,{recursive:true});report.cleanupComplete=true;
 try{finalizeAggregate?.();}catch(error){report.passed=false;throw error;}
 }finally{report.passed=report.passed&&report.cleanupComplete===true;console.log(JSON.stringify(report));}
}
