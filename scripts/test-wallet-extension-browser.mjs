// Real MetaMask application connection; only read-only Aztec node metadata is a fixture.
// No PXE, Aztec proof, existing wallet profile or real funds.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import vm from 'node:vm';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes,webcrypto} from 'node:crypto';
import {chromium} from 'playwright';
import {Wallet,Contract,ContractFactory,JsonRpcProvider} from 'ethers';
import {InboxAbi} from '@aztec/l1-artifacts/InboxAbi';
import {InboxBytecode} from '@aztec/l1-artifacts/InboxBytecode';
import {TestERC20Abi} from '@aztec/l1-artifacts/TestERC20Abi';
import {TestERC20Bytecode} from '@aztec/l1-artifacts/TestERC20Bytecode';
import {FeeJuicePortalAbi} from '@aztec/l1-artifacts/FeeJuicePortalAbi';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {recoverPrivateFeeClaim} from '../shared/private-fee-funding.mjs';
import {BarretenbergSync} from '@aztec/bb.js';
import {derivePrivateFeeAddress,derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {discoverTestMetaMask,onboardMetaMask,unpackMetaMask,addMetaMaskNetwork,guardBrowserRequest} from './t04-metamask.mjs';
import {verifyExtensionCollateral} from './t04-extension-collateral.mjs';
import {ROOT,assertNodeVersion,anvilBinary} from './toolchain.mjs';
assertNodeVersion();
assert.equal(process.env.U01_BOUNDED_BROWSER,'true');
assert(path.isAbsolute(process.env.BILLBOARD_TEST_TMPDIR));
const directory=await fs.mkdtemp(path.join(process.env.BILLBOARD_TEST_TMPDIR,'extension-'));
const children=[];let context,provider,walletPage,page,readFundingState,stage='preflight';
const report={passed:false,scope:'Real MetaMask onboarding, custom local network and application connection only; fee signing not yet qualified'};
const port=async()=>{const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const value=server.address().port;await new Promise(r=>server.close(r));return value;};
const ready=async read=>{for(let i=0;i<50;i++){try{if(await read())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Local test server unavailable');};
const httpsReady=origin=>new Promise((resolve,reject)=>{const request=https.get(origin+'/feed.html',{rejectUnauthorized:false,timeout:500},response=>{response.resume();response.on('end',()=>resolve(response.statusCode===200));});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('Local HTTPS unavailable')));});

try{
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
 stage='extension-launch';context=await chromium.launchPersistentContext(path.join(directory,'profile'),{channel:'chromium',headless:true,ignoreHTTPSErrors:true,acceptDownloads:false,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=256']});
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
 stage='reject-token-approval';await page.locator('#amount').fill('0.000000000000001');await page.locator('#depositBtn').click();
 await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();await walletPage.getByTestId('confirm-footer-cancel-button').click();await page.locator('#depositStatus .error').waitFor();
 assert.equal(await provider.getTransactionCount(user.address),0);assert.equal(await token.allowance(user.address,addresses.feeJuicePortalAddress),0n);assert.equal(await token.balanceOf(user.address),2000n);report.rejectionMovedNoFunds=true;
 stage='check-rejected-approval';await page.getByRole('button',{name:'Check saved Ethereum fee request',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#depositStatus .error').length===2);assert.equal(await provider.getTransactionCount(user.address),0);assert.equal(await walletPage.getByTestId('confirm-footer-button').isVisible(),false);
 stage='retry-saved-approval';await page.getByRole('button',{name:'Retry saved Ethereum fee request',exact:true}).click();await walletPage.getByTestId('confirm-footer-button').click();
 stage='approval-receipt';await page.locator('#depositStatus .success').filter({hasText:'Token approval recovered. Continue with the deposit.'}).waitFor();assert.equal(await provider.getTransactionCount(user.address),1);assert.equal(await token.allowance(user.address,addresses.feeJuicePortalAddress),1000n);
 stage='deposit-fees';await page.locator('#depositBtn').click();await walletPage.getByTestId('confirm-footer-button').click();await page.locator('#depositStatus .success').filter({hasText:'Deposit recorded. Download the recovery file, then claim after the bridge message is available.'}).waitFor();
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
 assert.equal(unexpectedRequests,0);assert.equal(provingAssetRequests,0);report.depositAmount='1000';report.canonicalRecoveryVerified=true;report.explicitRetryVerified=true;
 stage='board-collateral-refund';report.collateral=await verifyExtensionCollateral({page,walletPage,provider,publisher,operator,user,rpcUrl});
 assert(blockedContextRequests.every(record=>record.owner==='extension'&&record.hostname==='metamask.github.io'));
 report.passed=true;report.realExtension=true;report.browserVersion=context.browser().version();report.extensionVersion='13.49.0.0';report.connectedLocalAccount=true;report.userEthereumTransactions=await provider.getTransactionCount(user.address);assert.equal(report.userEthereumTransactions,4);report.scope='Real MetaMask connection, rejected approval, explicit approval retry, fee deposit, board collateral/refund and read-only canonical recovery; controlled Outbox roots, no Aztec claim/proof';
}catch(error){
 report.passed=false;report.failure={stage,errorClass:error.name};
 const location=String(error.stack).match(/t04-extension-collateral\.mjs:\d+:\d+/);if(location)report.failure.location=location[0];process.exitCode=1;
 if(readFundingState)try{report.canonicalFundingState=await readFundingState();}catch{report.fundingDiagnosticFailed=true;}
 if(page&&!page.isClosed())try{report.applicationState=await page.evaluate(()=>({ethereumConnected:!!window.walletState?.ethAccount,aztecLoaded:!!window.walletState?.aztec?.address,setupError:!!document.querySelector('#setupStatus .error'),feeAddressReady:!!document.getElementById('azaddr')?.value,invalidated:window.walletState?.invalidated===true}));}catch(diagnostic){report.applicationDiagnosticFailure={errorClass:diagnostic.name};}
 if(context)try{
  report.walletSurfaces=[];
  for(const inspected of context.pages().slice(0,8)){
   const url=new URL(inspected.url());if(url.protocol!=='chrome-extension:')continue;
   const surface={path:url.pathname,route:url.hash,controls:{}};
   report.walletSurfaces.push(surface);
   for(const id of ['confirm-btn','parent-selector-confirmation-page','confirm-footer-button','parent-selector-template-confirmation-page','confirmation-submit-button','confirmation-cancel-button','account-menu-icon'])surface.controls[id]=await inspected.getByTestId(id).isVisible();
  }
 }catch(diagnostic){report.diagnosticFailure={errorClass:diagnostic.name};}
}
finally{
 try {
 await context?.close();await BarretenbergSync.destroySingleton();provider?.destroy();
 for(const child of children){if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),1500);await closed;clearTimeout(timer);}}
 await fs.rm(directory,{recursive:true});report.cleanupComplete=true;
 }finally{report.passed=report.passed&&report.cleanupComplete===true;console.log(JSON.stringify(report));}
}
