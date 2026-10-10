// Explicit Sepolia/V6 qualification using the published board and real MetaMask.
// No RPC substitutions, simulated settlement, or personal browser profile.
import assert from 'node:assert/strict';
import {setHostedTestGas,verifyHostedPayment} from './hosted-test-gas.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {Wallet,Contract,JsonRpcProvider,parseEther,formatEther,Interface,keccak256} from 'ethers';
import {fileState,recordedTransaction} from '../plugins/operations.mjs';
import {createAztecNodeClient} from '../shared/aztec-node-client.mjs';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {onboardMetaMask,unpackMetaMask,discoverTestMetaMask,observeMetaMaskTransactions,assertMetaMaskTransaction} from './t04-metamask.mjs';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
import {createPublicFeedSource} from '../shared/public-feed-source.mjs';
import {publicNode} from '../shared/public-feed-rpc.mjs';
import {ROOT} from './toolchain.mjs';
const args=process.argv.slice(2),options={};
for(const arg of args){const match=arg.match(/^--(site-config|deployment|funder|funding-eth|run|max-fee-gwei|priority-fee-gwei)=(.+)$/);if(match){assert(!Object.hasOwn(options,match[1]));options[match[1]]=match[2];}else assert(['--resume-deposit','--resume-funded','--resume-approved','--resume-reverted','--fresh','--inspect-wallet'].includes(arg));}
const resumeDeposit=args.includes('--resume-deposit'),resumeFunded=args.includes('--resume-funded'),resumeApproved=args.includes('--resume-approved'),resumeReverted=args.includes('--resume-reverted'),freshRun=args.includes('--fresh'),run=options.run;
assert.equal([resumeDeposit,resumeFunded,resumeApproved,resumeReverted,freshRun].filter(Boolean).length,1);assert(/^[a-z0-9-]+$/.test(run));
assert(!!options['max-fee-gwei']===!!options['priority-fee-gwei']);
for(const key of ['site-config','deployment','funder','funding-eth'])assert(options[key],key+' is required');
assert(process.env.BOARD_HOSTED_BOUNDED==='true','Use the bounded hosted runner');
const read=async file=>JSON.parse(await fs.readFile(path.resolve(ROOT,file),'utf8'));
const expectedConfig=await read(options['site-config']),deployment=await read(options.deployment),manifest=deployment.manifest;
assert.equal(expectedConfig.network.chainId,'11155111');assert.equal(expectedConfig.network.rollupVersion,manifest.network.rollupVersion);
assert.equal(expectedConfig.network.rollupAddress,manifest.network.rollup);assert.equal(expectedConfig.network.nodeUrl,manifest.network.nodeUrl);
assert.equal(expectedConfig.board.contractAddress,deployment.l2Addr);assert.equal(expectedConfig.board.portalAddress.toLowerCase(),deployment.portalAddr.toLowerCase());
const directory=path.join(ROOT,'.build/hosted-'+run),privateDir=path.join(directory,'private');await fs.mkdir(privateDir,{recursive:true,mode:0o700});
const origin=new URL(expectedConfig.remoteProver.url).origin,board=expectedConfig.board.contractAddress,rollup=expectedConfig.network.rollupAddress,portalAddress=expectedConfig.board.portalAddress,version=expectedConfig.network.rollupVersion;
assert.equal(origin,'https://d30njln0kead8n.cloudfront.net');
const fundingETH=parseEther(options['funding-eth']);assert(fundingETH>0n&&fundingETH<=parseEther('0.00015'));
const url=origin+'/user.html#network=11155111:'+rollup+':'+version+'&board='+board;
const report={passed:false,network:'Sepolia / Aztec V6 testnet',url,startedAt:new Date().toISOString(),stages:[]};
let stage='start',context,page,walletPage,provider;
const mark=value=>{stage=value;report.stages.push({stage,at:new Date().toISOString()});console.log(JSON.stringify({stage,at:new Date().toISOString()}));};
const stageTimeout=540000; // The parent supervises the entire run with this total deadline.
const save=()=>fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');
try{
 if(resumeDeposit||resumeFunded||resumeApproved||resumeReverted){for(const file of [path.join(privateDir,'identity.json'),path.join(privateDir,'aztec-wallet.encrypted.json'),path.join(directory,'test-funding.json')])assert((await fs.stat(file)).isFile(),'Resume requires retained disposable account and funding records');}
 let identity;
 try{identity=JSON.parse(await fs.readFile(path.join(privateDir,'identity.json'),'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;const w=Wallet.createRandom();identity={mnemonic:w.mnemonic.phrase,address:w.address,password:randomBytes(32).toString('base64url')};await fs.writeFile(path.join(privateDir,'identity.json'),JSON.stringify(identity),{flag:'wx',mode:0o600});}
 report.ethereumAccount=identity.address;
 const extensionBase=path.join(privateDir,'metamask');await fs.mkdir(extensionBase,{recursive:true,mode:0o700});
 const extension=await fs.stat(path.join(extensionBase,'extension','manifest.json')).catch(()=>null)?path.join(extensionBase,'extension'):unpackMetaMask(extensionBase);
 context=await chromium.launchPersistentContext(path.join(privateDir,'profile'),{channel:'chromium',headless:true,acceptDownloads:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=512']});
 for(const restored of context.pages())await restored.close();
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000}),extensionId=new URL(worker.url()).host;
 const initialized=path.join(privateDir,'initialized');
 if(!await fs.stat(initialized).catch(()=>null)){
  walletPage=await onboardMetaMask(context,identity.mnemonic,identity.password,extensionId,mark);await fs.writeFile(initialized,'true',{mode:0o600});
 }else{
  walletPage=await context.newPage();await walletPage.goto('chrome-extension://'+extensionId+'/home.html');
  await walletPage.getByTestId('unlock-password').waitFor({timeout:60000});await walletPage.getByTestId('unlock-password').fill(identity.password);await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('account-menu-icon').waitFor({timeout:60000});
 }
 walletPage.setDefaultTimeout(60000);await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');
 report.authorPageSha256=createHash('sha256').update(Buffer.from(await(await fetch(origin+'/user.html',{signal:AbortSignal.timeout(30000)})).arrayBuffer())).digest('hex');
 assert.equal(report.authorPageSha256,createHash('sha256').update(await fs.readFile(path.join(ROOT,'apps/dist/user.html'))).digest('hex'),'Hosted author release differs from candidate');
 mark('published-board');page=await context.newPage();page.setDefaultTimeout(60000);
 await page.goto(url,{timeout:120000});await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&globalThis.billboardConfigStore?.snapshot().config,{},{timeout:180000});
 await page.evaluate(installBrowserErrorObserver);await discoverTestMetaMask(page);await observeMetaMaskTransactions(page);
 const config=await page.evaluate(()=>billboardConfigStore.snapshot().config);
 assert.equal(config.network.chainId,'11155111');assert.equal(config.network.rollupVersion,version);assert.equal(config.network.rollupAddress.toLowerCase(),rollup);
 assert.equal(config.board.contractAddress,board);assert.equal(config.board.portalAddress.toLowerCase(),portalAddress);assert.equal(config.remoteProver.url,origin+'/prover');
 report.config=config;assert.equal(await page.evaluate(()=>BillboardProving.snapshot()),'remote');
 const installed=await page.evaluate(async()=>{const r=await fetch('/aztec_bundle.js',{cache:'no-store'});return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');});
 assert.equal(installed,createHash('sha256').update(await fs.readFile(path.join(ROOT,'apps/dist/aztec_bundle.js'))).digest('hex'));report.sdkSha256=installed;
 provider=new JsonRpcProvider(config.network.ethRpcUrl);assert.equal((await provider.getNetwork()).chainId,11155111n);
 const node=createAztecNodeClient(config.network.nodeUrl),info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),11155111);assert.equal(String(info.rollupVersion),version);assert.equal(info.nodeVersion,'6.0.0-rc.1');assert.equal(info.realProofs,true);
 const tokenAddress=info.l1ContractAddresses.feeJuiceAddress.toString(),feePortalAddress=info.l1ContractAddresses.feeJuicePortalAddress.toString();
 assert.equal(tokenAddress.toLowerCase(),'0x762c132040fda6183066fa3b14d985ee55aa3c18');
 const g=config.privateFee.gasSettings,maximumFee=BigInt(g.gasLimits.daGas)*BigInt(g.maxFeesPerGas.feePerDaGas)+BigInt(g.gasLimits.l2Gas)*BigInt(g.maxFeesPerGas.feePerL2Gas),funding=2n*maximumFee;
 const portal=new Contract(portalAddress,['function depositsEnabled() view returns(bool)','function MAX_DEPOSIT() view returns(uint256)','function getDeposit(address) view returns(uint256)'],provider),amount=await portal.MAX_DEPOSIT();assert(amount<=parseEther('0.00001'));assert.equal(await portal.depositsEnabled(),true);
 const health=await(await fetch(origin+'/prover/healthz',{signal:AbortSignal.timeout(30000)})).json();assert(health.ready&&health.proofs==='real');report.proverBefore=health;
 mark('sepolia-network');
 if(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'}))!=='0xaa36a7'){
  const switched=page.evaluate(()=>__testMetaMask.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]}));
  const outcome=await Promise.race([switched.then(()=> 'switched'),walletPage.getByRole('button',{name:'Confirm',exact:true}).waitFor({timeout:60000}).then(()=> 'approve')]);
  if(outcome==='approve'){assert((await walletPage.locator('body').innerText()).includes('Sepolia'));await walletPage.getByRole('button',{name:'Confirm',exact:true}).click();}await switched;
 }
 assert.equal(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),'0xaa36a7');
 mark('fund-disposable-test-wallet');
 const operator=new Wallet((await read(options.funder)).privateKey,provider);
 assert.equal(operator.address.toLowerCase(),manifest.actors.ethereumDeployer);
 const fundingStore=await fileState(path.join(privateDir,'test-funding-journal.json'));
 const fund=async(name,transaction)=>recordedTransaction({store:fundingStore,name,identity:JSON.stringify({chainId:'11155111',sender:operator.address,recipient:identity.address,transaction},(_,v)=>typeof v==='bigint'?String(v):v),prepare:async()=>{const raw=await operator.signTransaction(await operator.populateTransaction(transaction));return {hash:keccak256(raw),raw};},broadcast:async record=>{if(!await provider.getTransaction(record.hash))await provider.broadcastTransaction(record.raw);},wait:async record=>{const receipt=await provider.waitForTransaction(record.hash,1,180000);assert.equal(receipt?.status,1);return receipt;}});
 const token=new Contract(tokenAddress,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)'],operator);
 const fundingFile=path.join(directory,'test-funding.json');let transfers;
 try{transfers=JSON.parse(await fs.readFile(fundingFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;transfers={recipient:identity.address};}
 assert.equal(transfers.recipient,identity.address);
 if(resumeDeposit||resumeFunded||resumeApproved||resumeReverted){assert(transfers.eth&&transfers.token,'Resume must never provision test funds');}
 if(freshRun&&!transfers.eth){assert.equal(await provider.getTransactionCount(identity.address),0);const sent=await fund('eth',{to:identity.address,value:fundingETH});transfers.eth=sent.record.hash;await fs.writeFile(fundingFile,JSON.stringify(transfers));}
 if(freshRun&&!transfers.token){const faucet=new Contract(info.l1ContractAddresses.feeAssetHandlerAddress.toString(),['function FEE_ASSET() view returns(address)','function mintAmount() view returns(uint256)','function mint(address)'],operator);assert.equal((await faucet.FEE_ASSET()).toLowerCase(),tokenAddress.toLowerCase());const mintAmount=await faucet.mintAmount();assert(mintAmount>=funding&&mintAmount<=parseEther('10000'));const estimated=await faucet.mint.estimateGas(identity.address);assert(estimated<1000000n);const sent=await fund('mint',await faucet.mint.populateTransaction(identity.address));transfers.token=sent.record.hash;transfers.mintedAmount=String(mintAmount);await fs.writeFile(fundingFile,JSON.stringify(transfers));}
 if(resumeReverted){const failed=await provider.getTransactionReceipt('0x0a10d0634a0297bd8afb915f251b3a23559ba98de89d6ee2fa1361f656fa425b');assert.equal(failed.status,0);assert.equal((await provider.getBlock(failed.blockNumber)).hash,failed.blockHash);assert.equal(failed.from.toLowerCase(),identity.address.toLowerCase());assert.equal(await provider.getTransactionCount(identity.address,'latest'),3);assert.equal(await provider.getTransactionCount(identity.address,'pending'),3);assert.equal(await portal.getDeposit(identity.address),0n);const approved=new Contract(tokenAddress,['function allowance(address,address) view returns(uint256)'],provider);assert.equal(await approved.allowance(identity.address,feePortalAddress),funding);report.reconciledFailedEthereumTx=failed.hash;report.ethereumNonceBefore=3;}
 if(resumeApproved){assert.equal(await provider.getTransactionCount(identity.address,'latest'),1);assert.equal(await provider.getTransactionCount(identity.address,'pending'),1);assert.equal(await portal.getDeposit(identity.address),0n);const approved=new Contract(tokenAddress,['function allowance(address,address) view returns(uint256)'],provider);assert.equal(await approved.allowance(identity.address,feePortalAddress),funding);report.scenario='resume-confirmed-fee-approval';report.ethereumNonceBefore=await provider.getTransactionCount(identity.address,'latest');}
 report.testFunding=transfers;const nonceBefore=await provider.getTransactionCount(identity.address,'latest');if(freshRun){assert.equal(nonceBefore,0);assert.equal(await provider.getTransactionCount(identity.address,'pending'),0);const approvals=new Contract(tokenAddress,['function allowance(address,address) view returns(uint256)'],provider);assert.equal(await approvals.allowance(identity.address,feePortalAddress),0n);}if(resumeDeposit){assert.equal(await portal.getDeposit(identity.address),amount);report.scenario='resume-confirmed-deposit-after-spot-interruption';report.ethereumNonceBefore=nonceBefore;report.ethereumPendingNonceBefore=await provider.getTransactionCount(identity.address,'pending');assert.equal(report.ethereumPendingNonceBefore,nonceBefore,'Resume scenario requires no pending Ethereum payment');}else{assert.equal(await portal.getDeposit(identity.address),0n);report.scenario=resumeFunded?'resume-confirmed-fee-funding':resumeApproved?'resume-confirmed-fee-approval':resumeReverted?'resume-reverted-wallet-wrapper':'fresh-onboarding';if(resumeFunded){const prior=await provider.getTransactionReceipt('0x15c72009003bd9230cc4c317e4313db8700ff560e8f9d40e1da071cce481dae4');assert.equal(prior.status,1);assert.equal((await provider.getBlock(prior.blockNumber)).hash,prior.blockHash);assert.equal(prior.from.toLowerCase(),identity.address.toLowerCase());report.reusedFeeDeposit=prior.hash;assert.equal(nonceBefore,4);assert.equal(await provider.getTransactionCount(identity.address,'pending'),nonceBefore);report.ethereumNonceBefore=nonceBefore;}}
 if(resumeApproved&&await walletPage.getByTestId('confirm-footer-cancel-button').isVisible()){
  mark('discard-retained-unsigned-test-request');if(!await walletPage.getByTestId('advanced-details-displayed-nonce').isVisible())await walletPage.getByTestId('header-advanced-details-button').click();await walletPage.getByTestId('advanced-details-displayed-nonce').filter({hasText:/^1$/}).waitFor();await walletPage.getByTestId('confirm-footer-cancel-button').click();await walletPage.getByTestId('parent-selector-confirmation-page').waitFor({state:'hidden'});assert.equal(await provider.getTransactionCount(identity.address,'pending'),1);
 }
 mark('connect-with-fresh-passkey');
 const backup=path.join(privateDir,'aztec-wallet.encrypted.json');
 if(await fs.stat(backup).catch(()=>null)){
  await page.locator('#wbAccountMenu > summary').click();await page.getByText('Restore account',{exact:true}).click();await page.locator('#wbRestorePassword').fill(identity.password);await page.locator('#wbAztecFile').setInputFiles(backup);await page.waitForFunction(()=>!!BillboardAccount.snapshot().address,{},{timeout:180000});await page.locator('#wbAccountMenu > summary').click();report.walletPath='restored-disposable-test-backup';
 }else{
  // A failed pre-payment run may have left metadata for its destroyed virtual authenticator.
  // Only this disposable profile is reset, and only before any application transaction.
  assert.equal(await provider.getTransactionCount(identity.address,'latest'),0);assert.equal(await provider.getTransactionCount(identity.address,'pending'),0);assert.equal(await portal.getDeposit(identity.address),0n);
  await page.evaluate(account=>localStorage.removeItem('billboard-passkey-v1:'+account.toLowerCase()),identity.address);
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,hasPrf:true,automaticPresenceSimulation:true,isUserVerified:true}});report.walletPath='fresh-passkey';
 }
 await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
 const connected=page.waitForFunction(()=>BillboardAccount.snapshot().ethereumConnected,{},{timeout:180000});
 const connectState=await Promise.race([connected.then(()=> 'connected'),walletPage.getByTestId('confirm-btn').waitFor({timeout:60000}).then(()=> 'approve')]);
 if(connectState==='approve'){assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');await walletPage.getByTestId('confirm-btn').click();}await connected;
 if(!await page.evaluate(()=>!!BillboardAccount.snapshot().address)){assert(freshRun,'Resume cannot create another private account');await page.locator('#wbNewPasskeyBtn').click();await page.waitForFunction(()=>!!BillboardAccount.snapshot().address,{},{timeout:180000});}
 assert.equal((await page.evaluate(()=>BillboardAccount.snapshot().ethereumAddress)).toLowerCase(),identity.address.toLowerCase());report.aztecAccount=await page.evaluate(()=>BillboardAccount.snapshot().address);
 mark('complete-wallet-setup');
 if(!resumeDeposit){
 await page.locator('#depositPanel').waitFor({state:'visible',timeout:stageTimeout});assert(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).isChecked());
 await page.waitForFunction(()=>!BillboardAccount.snapshot().busy&&!document.getElementById('depositBtn').disabled,{},{timeout:stageTimeout});
 assert(!['failed','cancelled','paused'].includes(await page.evaluate(()=>application.operation().status)),'Operation did not complete normally');
 if(!await fs.stat(backup).catch(()=>null)){
  mark('export-disposable-wallet-backup');
  await page.locator('#wbAccountMenu > summary').click();await page.getByText('Back up account',{exact:true}).click();await page.locator('#wbPassword').fill(identity.password);await page.locator('#wbPasswordConfirm').fill(identity.password);const download=page.waitForEvent('download');await page.locator('#wbBackupBtn').click();await(await download).saveAs(backup);await fs.chmod(backup,0o600);await page.locator('#wbAccountMenu > summary').click();
 }
 await page.locator('#depositPanel').waitFor({state:'visible',timeout:stageTimeout});assert(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).isChecked());await page.waitForFunction(()=>!document.getElementById('depositBtn').disabled||['failed','cancelled','paused'].includes(application.operation().status),{},{timeout:stageTimeout});assert(!['failed','cancelled','paused'].includes(await page.evaluate(()=>application.operation().status)),'Operation did not complete normally');
 await page.locator('#depositAmount').press('End');assert.equal(await page.locator('#depositSelection').textContent(),formatEther(amount)+' ETH');
 if(resumeFunded){const recovery=await page.evaluate(()=>JSON.parse(localStorage.getItem(localStorage.getItem('billboard-private-fee-recovery-latest'))));assert.equal(recovery.nonce,'3');assert.equal(recovery.amount,String(funding));report.feeRecoveryPublic={nonce:recovery.nonce,amount:recovery.amount,txHash:recovery.txHash??report.reusedFeeDeposit};await save();}
 if(resumeApproved){const items=await page.evaluate(()=>application.readActivity());assert(items.some(x=>x.layer==='ethereum'&&x.kind==='fee-funding'&&x.status==='pending'));mark('resume-saved-fee-request');await page.locator('#activityPanel > summary').click();await page.locator('#resumeOperation').click();}else{mark('single-deposit-click');await page.locator('#depositBtn').click();}report.walletConfirmations=[];
 for(const action of (resumeFunded?['deposit']:(resumeApproved||resumeReverted)?['fee-deposit','deposit']:['fee-approval','fee-deposit','deposit'])){
  mark('approve-'+action);
  await page.waitForFunction(()=>Array.isArray(__walletTestPending)||['failed','cancelled','paused'].includes(application.operation().status),{},{timeout:stageTimeout});assert(!['failed','cancelled','paused'].includes(await page.evaluate(()=>application.operation().status)),'Operation did not complete normally');
  const pending=await page.evaluate(()=>__walletTestPending);assertMetaMaskTransaction({stage:action,request:pending,account:identity.address,chainId:await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),expectedChainId:11155111n,tokenAddress,feePortalAddress,privateFeeAddress:config.privateFee.contractAddress,boardPortalAddress:portalAddress,fundingAmount:formatEther(funding),collateralAmount:formatEther(amount)});
  await walletPage.getByTestId('parent-selector-confirmation-page').waitFor({timeout:60000});
  if(args.includes('--inspect-wallet')){if(!await walletPage.getByTestId('advanced-details-displayed-nonce').isVisible())await walletPage.getByTestId('header-advanced-details-button').click();report.walletPublicDetails=await walletPage.locator('body').innerText();await walletPage.screenshot({path:path.join(directory,'pending-wallet.png')});throw Object.assign(Error('Wallet inspection complete; no payment submitted'),{code:'BB_TEST_WALLET_INSPECTION'});}
  if(options['max-fee-gwei']){report.walletFees??={};report.walletFees[action]=await setHostedTestGas({page,walletPage,provider,request:pending[0],maxFeeGwei:options['max-fee-gwei'],priorityFeeGwei:options['priority-fee-gwei'],functionName:action==='fee-approval'?'approve':action==='fee-deposit'?'depositToAztecPublic':'deposit'});}
  await walletPage.getByTestId('confirm-footer-button').click();report.walletConfirmations.push(action);
  await page.waitForFunction(data=>__walletTestPending?.[0]?.data!==data,pending[0].data,{timeout:stageTimeout});
  report.ethereumPayments??={};report.ethereumPayments[action]=await verifyHostedPayment({page,provider,request:pending[0],fees:report.walletFees?.[action],tokenAddress});await save();
 }
 }
 mark('automatic-testnet-claim');
 await page.waitForFunction(()=>!document.getElementById('composer').hidden||['failed','cancelled'].includes(application.operation().status),{},{timeout:stageTimeout});
 assert.equal(await page.evaluate(()=>application.operation().status),'complete');await page.locator('#composer').waitFor({state:'visible'});
 const completedClaim=await page.evaluate(async()=>{const operation=application.operation();if(operation.action==='onboarding')return {hash:operation.result.lastL2TxHash,resumed:false};const claim=(await application.readActivity()).find(item=>item.layer==='aztec'&&item.kind==='claim'&&item.status==='confirmed');return {hash:claim?.txHash,resumed:true};});
 assert(!completedClaim.resumed||resumeDeposit);report.claimHashes=[completedClaim.hash];assert.match(report.claimHashes[0],/^0x[0-9a-f]{64}$/);
 const verify=async hash=>{const deadline=Date.now()+stageTimeout;let receipt;
  while(Date.now()<deadline){receipt=await node.getTxReceipt(TxHash.fromString(hash));if(['checkpointed','proven','finalized'].includes(receipt.status))break;assert(!['dropped','reverted'].includes(receipt.status));await new Promise(r=>setTimeout(r,5000));}
  assert.equal(receipt.executionResult,'success');assert(['checkpointed','proven','finalized'].includes(receipt.status));const block=await node.getBlock(receipt.blockNumber);assert.equal(block.hash.toString(),receipt.blockHash.toString());return {txHash:hash,status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash.toString(),transactionFee:String(receipt.transactionFee)};};
 if(resumeDeposit){report.ethereumNonceAfter=await provider.getTransactionCount(identity.address,'latest');assert.equal(report.ethereumNonceAfter,nonceBefore,'Resuming must not send another Ethereum payment');report.ethereumPendingNonceAfter=await provider.getTransactionCount(identity.address,'pending');assert.equal(report.ethereumPendingNonceAfter,nonceBefore,'Resuming must not leave a new pending Ethereum payment');assert.equal(await page.evaluate(()=>globalThis.__walletTestPending??null),null,'Resuming must not request another Ethereum payment');}
 if(resumeFunded){report.ethereumNonceAfter=await provider.getTransactionCount(identity.address,'latest');assert.equal(report.ethereumNonceAfter,nonceBefore+1,'Funding retry must send only the board deposit');assert.equal(await provider.getTransactionCount(identity.address,'pending'),nonceBefore+1);assert.equal(await page.evaluate(()=>globalThis.__walletTestPending??null),null);}
 if(resumeApproved||resumeReverted){assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore+2);assert.equal(await provider.getTransactionCount(identity.address,'pending'),nonceBefore+2);}
 report.claim=await verify(report.claimHashes[0]);assert.equal(await portal.getDeposit(identity.address),amount);await save();
 mark('testnet-post');const message='Automated end-to-end test: one deposit, automatic claim, remote proof. '+new Date().toISOString();report.message=message;
 await page.locator('#postBtn').waitFor({state:'visible',timeout:stageTimeout});await page.locator('#msgText').fill(message);await page.locator('#postBtn').click();
 await page.waitForFunction(()=>application.operation().action==='post'&&['complete','failed','cancelled'].includes(application.operation().status),{},{timeout:stageTimeout});
 assert.equal(await page.evaluate(()=>application.operation().status),'complete');
 const postHash=await page.evaluate(()=>application.operation().result.lastL2TxHash);assert.match(postHash,/^0x[0-9a-f]{64}$/);report.post=await verify(postHash);
 await page.getByRole('link',{name:'View your message',exact:true}).waitFor();
 await page.screenshot({path:path.join(directory,'posted.png'),fullPage:true});
 report.proverAfter=await(await fetch(origin+'/prover/healthz',{signal:AbortSignal.timeout(30000)})).json();assert(report.proverAfter.queue.completed>=report.proverBefore.queue.completed+(completedClaim.resumed?1:2));assert.equal(report.proverAfter.queue.failed,report.proverBefore.queue.failed);
 const metadata=JSON.parse(await fs.readFile(path.join(ROOT,'apps/dist/public-feed-metadata.json'),'utf8')),scope={l1ChainId:'11155111',rollupVersion:version,rollupAddress:rollup,boardAddress:board,portalAddress};
 const source=await createPublicFeedSource({node:publicNode(config.network.nodeUrl),scope,artifact:metadata.artifact,eventTags:metadata.eventTags,censorWindow:manifest.board.censorWindow});
 const events=await source.getEvents({fromBlock:report.post.blockNumber,toBlock:report.post.blockNumber,referenceBlock:report.post.blockHash});const published=events.filter(e=>e.type==='PostPublished'&&e.position.txHash===report.post.txHash);assert.equal(published.length,1);assert.equal(published[0].payload.text,message);report.publication=published[0];report.passed=true;mark('confirmed-testnet-post');
}catch(error){report.failure={stage,name:error?.name,sourceFrames:typeof error?.stack==='string'?error.stack.split('\n').filter(line=>line.includes('test-hosted-onboarding.mjs:')||line.includes('hosted-test-gas.mjs:')):[],code:typeof error?.code==='string'?error.code:null,gasAssertion:stage.startsWith('approve-')&&error?.name==='AssertionError'?{message:typeof error.message==='string'&&error.message.length<180?error.message:null,actual:typeof error.actual==='bigint'?String(error.actual):null,expected:typeof error.expected==='bigint'?String(error.expected):null}:null};
 if(page&&!page.isClosed())report.ui=await page.evaluate(()=>({operation:application.operation(),report:application.diagnosticReport(),errors:['setupStatus','messageError','postResult','activityStatus'].map(id=>({id,text:document.getElementById(id)?.textContent?.slice(-12000)})),diagnostics:globalThis.__u01FormatterDiagnostics??[],walletFailure:globalThis.__walletTestFailure??null})).catch(()=>({unavailable:true}));
 if(stage==='sepolia-network'&&walletPage&&!walletPage.isClosed())report.walletControls=await walletPage.locator('body').innerText().catch(()=> 'unavailable');
 console.log(JSON.stringify({failed:stage,errorName:error?.name}));process.exitCode=1;
}finally{if(context)await context.close();provider?.destroy();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:report.passed,result:path.join(directory,'result.json')}));}
