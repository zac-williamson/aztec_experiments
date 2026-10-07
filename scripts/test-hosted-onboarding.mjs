// Explicit Sepolia/V5 qualification using the published board and real MetaMask.
// No RPC substitutions, simulated settlement, or personal browser profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {Wallet,Contract,JsonRpcProvider,parseEther,formatEther,Interface} from 'ethers';
import {createAztecNodeClient} from '@aztec/aztec.js/node';
import {TxHash} from '@aztec/stdlib/tx';
import {onboardMetaMask,unpackMetaMask,discoverTestMetaMask,observeMetaMaskTransactions,assertMetaMaskTransaction} from './t04-metamask.mjs';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
import {createPublicFeedSource} from '../shared/public-feed-source.mjs';
import {publicNode} from '../shared/public-feed-rpc.mjs';
import {ROOT} from './toolchain.mjs';
const directory=path.join(ROOT,'.build/hosted-onboarding-20261007');
const privateDir=path.join(directory,'private');await fs.mkdir(privateDir,{recursive:true,mode:0o700});
const origin='https://d30njln0kead8n.cloudfront.net';
const board='0x267c4246a61590539743a81acdaa1895019fef3e5f2c07038cc729b87e93b3df';
const rollup='0xd73a91bdcf6891c7642f3e460036e1ef2cc23178';
const portalAddress='0x8081fb65e2b6a6b37a6b093af3cbea292e69809b';
const url=origin+'/user.html#network=11155111:'+rollup+':1821665230&board='+board;
const report={passed:false,network:'Sepolia / Aztec V5 testnet',url,startedAt:new Date().toISOString(),stages:[]};
let stage='start',context,page,walletPage,provider;
const mark=value=>{stage=value;report.stages.push({stage,at:new Date().toISOString()});console.log(JSON.stringify({stage,at:new Date().toISOString()}));};
const stageTimeout=20*60*1000; // Testnet message ingestion/proof/inclusion, not a local fixture deadline.
const save=()=>fs.writeFile(path.join(directory,'result.json'),JSON.stringify(report,null,2)+'\n');
try{
 let identity;
 try{identity=JSON.parse(await fs.readFile(path.join(privateDir,'identity.json'),'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;const w=Wallet.createRandom();identity={mnemonic:w.mnemonic.phrase,address:w.address,password:randomBytes(32).toString('base64url')};await fs.writeFile(path.join(privateDir,'identity.json'),JSON.stringify(identity),{flag:'wx',mode:0o600});}
 report.ethereumAccount=identity.address;
 const extensionBase=path.join(privateDir,'metamask');await fs.mkdir(extensionBase,{recursive:true,mode:0o700});
 const extension=await fs.stat(path.join(extensionBase,'extension','manifest.json')).catch(()=>null)?path.join(extensionBase,'extension'):unpackMetaMask(extensionBase);
 context=await chromium.launchPersistentContext(path.join(privateDir,'profile'),{channel:'chromium',headless:true,acceptDownloads:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=512']});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000}),extensionId=new URL(worker.url()).host;
 const initialized=path.join(privateDir,'initialized');
 if(!await fs.stat(initialized).catch(()=>null)){
  walletPage=await onboardMetaMask(context,identity.mnemonic,identity.password,extensionId,mark);await fs.writeFile(initialized,'true',{mode:0o600});
 }else{
  walletPage=await context.newPage();await walletPage.goto('chrome-extension://'+extensionId+'/home.html');
  await walletPage.getByTestId('unlock-password').waitFor({timeout:60000});await walletPage.getByTestId('unlock-password').fill(identity.password);await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('account-menu-icon').waitFor({timeout:60000});
 }
 walletPage.setDefaultTimeout(60000);await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');
 mark('published-board');page=await context.newPage();page.setDefaultTimeout(60000);
 await page.goto(url,{timeout:120000});await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&globalThis.billboardConfigStore?.snapshot().config,{},{timeout:180000});
 await page.evaluate(installBrowserErrorObserver);await discoverTestMetaMask(page);await observeMetaMaskTransactions(page);
 const config=await page.evaluate(()=>billboardConfigStore.snapshot().config);
 assert.equal(config.network.chainId,'11155111');assert.equal(config.network.rollupVersion,'1821665230');assert.equal(config.network.rollupAddress.toLowerCase(),rollup);
 assert.equal(config.board.contractAddress,board);assert.equal(config.board.portalAddress.toLowerCase(),portalAddress);assert.equal(config.remoteProver.url,origin+'/prover');
 report.config=config;assert(await page.getByRole('checkbox',{name:'Remote proving',exact:true}).isChecked());
 const installed=await page.evaluate(async()=>{const r=await fetch('/aztec_bundle.js',{cache:'no-store'});return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');});
 assert.equal(installed,createHash('sha256').update(await fs.readFile(path.join(ROOT,'apps/dist/aztec_bundle.js'))).digest('hex'));report.sdkSha256=installed;
 provider=new JsonRpcProvider(config.network.ethRpcUrl);assert.equal((await provider.getNetwork()).chainId,11155111n);
 const node=createAztecNodeClient(config.network.nodeUrl),info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),11155111);assert.equal(Number(info.rollupVersion),1821665230);
 const tokenAddress=info.l1ContractAddresses.feeJuiceAddress.toString(),feePortalAddress=info.l1ContractAddresses.feeJuicePortalAddress.toString();
 assert.equal(tokenAddress.toLowerCase(),'0x762c132040fda6183066fa3b14d985ee55aa3c18');
 const g=config.privateFee.gasSettings,maximumFee=BigInt(g.gasLimits.daGas)*BigInt(g.maxFeesPerGas.feePerDaGas)+BigInt(g.gasLimits.l2Gas)*BigInt(g.maxFeesPerGas.feePerL2Gas),funding=2n*maximumFee;
 const portal=new Contract(portalAddress,['function MAX_DEPOSIT() view returns(uint256)','function getDeposit(address) view returns(uint256)'],provider),amount=await portal.MAX_DEPOSIT();assert(amount<=parseEther('0.00001'));
 const health=await(await fetch(origin+'/prover/healthz',{signal:AbortSignal.timeout(30000)})).json();assert(health.ready&&health.proofs==='real');report.proverBefore=health;
 mark('sepolia-network');
 if(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'}))!=='0xaa36a7'){
  const switched=page.evaluate(()=>__testMetaMask.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]}));
  const outcome=await Promise.race([switched.then(()=> 'switched'),walletPage.getByRole('button',{name:'Confirm',exact:true}).waitFor({timeout:60000}).then(()=> 'approve')]);
  if(outcome==='approve'){assert((await walletPage.locator('body').innerText()).includes('Sepolia'));await walletPage.getByRole('button',{name:'Confirm',exact:true}).click();}await switched;
 }
 assert.equal(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),'0xaa36a7');
 mark('fund-disposable-test-wallet');
 const operator=new Wallet(JSON.parse(await fs.readFile('/Users/zac/.local/share/anonymous-message-board/testnet-london-20260920/ethereum.json','utf8')).privateKey,provider);
 assert.equal(operator.address.toLowerCase(),'0x997339dee91f61757a6b2dca5cf8bc169e83688f');
 const token=new Contract(tokenAddress,['function balanceOf(address) view returns(uint256)','function transfer(address,uint256) returns(bool)'],operator);
 const fundingFile=path.join(directory,'test-funding.json');let transfers;
 try{transfers=JSON.parse(await fs.readFile(fundingFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;transfers={recipient:identity.address};}
 assert.equal(transfers.recipient,identity.address);
 if(!transfers.eth){assert.equal(await provider.getTransactionCount(identity.address),0);const tx=await operator.sendTransaction({to:identity.address,value:parseEther('0.003')});transfers.eth=tx.hash;await fs.writeFile(fundingFile,JSON.stringify(transfers));assert.equal((await tx.wait(1,180000)).status,1);}
 if(!transfers.token){const faucet=new Contract(info.l1ContractAddresses.feeAssetHandlerAddress.toString(),['function FEE_ASSET() view returns(address)','function mintAmount() view returns(uint256)','function mint(address)'],operator);assert.equal((await faucet.FEE_ASSET()).toLowerCase(),tokenAddress.toLowerCase());const mintAmount=await faucet.mintAmount();assert(mintAmount>=funding&&mintAmount<=parseEther('10000'));const estimated=await faucet.mint.estimateGas(identity.address);assert(estimated<1000000n);const tx=await faucet.mint(identity.address,{gasLimit:estimated*2n});transfers.token=tx.hash;transfers.mintedAmount=String(mintAmount);await fs.writeFile(fundingFile,JSON.stringify(transfers));assert.equal((await tx.wait(1,180000)).status,1);}
 report.testFunding=transfers;
 mark('connect-with-fresh-passkey');
 const backup=path.join(privateDir,'aztec-wallet.encrypted.json');
 if(await fs.stat(backup).catch(()=>null)){
  await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill(identity.password);await page.locator('#wbAztecFile').setInputFiles(backup);await page.waitForFunction(()=>!!walletState.aztec?.address,{},{timeout:180000});await page.locator('#wbAccountMenu > summary').click();report.walletPath='restored-disposable-test-backup';
 }else{
  // A failed pre-payment run may have left metadata for its destroyed virtual authenticator.
  // Only this disposable profile is reset, and only before any application transaction.
  assert.equal(await provider.getTransactionCount(identity.address,'latest'),0);assert.equal(await provider.getTransactionCount(identity.address,'pending'),0);assert.equal(await portal.getDeposit(identity.address),0n);
  await page.evaluate(account=>localStorage.removeItem('billboard-passkey-v1:'+account.toLowerCase()),identity.address);
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,hasPrf:true,automaticPresenceSimulation:true,isUserVerified:true}});report.walletPath='fresh-passkey';
 }
 await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
 const connected=page.waitForFunction(()=>!!walletState.ethAccount&&!!walletState.aztec?.address,{},{timeout:180000});
 const connectState=await Promise.race([connected.then(()=> 'connected'),walletPage.getByTestId('confirm-btn').waitFor({timeout:60000}).then(()=> 'approve')]);
 if(connectState==='approve'){assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');await walletPage.getByTestId('confirm-btn').click();}await connected;
 assert.equal((await page.evaluate(()=>walletState.ethAccount)).toLowerCase(),identity.address.toLowerCase());report.aztecAccount=await page.evaluate(()=>walletState.aztec.address.toString());
 mark('complete-wallet-setup');
 await page.locator('#page-1').waitFor({state:'visible',timeout:stageTimeout});
 await page.waitForFunction(()=>!BillboardAccount.snapshot().busy&&!document.getElementById('navNext').disabled,{},{timeout:stageTimeout});
 assert.equal(await page.locator('#setupStatus .error').count(),0);
 if(!await fs.stat(backup).catch(()=>null)){
  mark('export-disposable-wallet-backup');
  await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill(identity.password);await page.locator('#wbPasswordConfirm').fill(identity.password);const download=page.waitForEvent('download');await page.locator('#wbBackupBtn').click();await(await download).saveAs(backup);await fs.chmod(backup,0o600);await page.locator('#wbAccountMenu > summary').click();
 }
 await page.locator('#page-1').waitFor({state:'visible',timeout:stageTimeout});await page.waitForFunction(()=>!document.getElementById('navNext').disabled||!!document.querySelector('#depositStatus .error'),{},{timeout:stageTimeout});assert.equal(await page.locator('#depositStatus .error').count(),0);
 await page.locator('#depositAmount').press('End');assert.equal(await page.locator('#depositSelection').textContent(),formatEther(amount)+' ETH');
 mark('single-deposit-click');await page.locator('#navNext').click();report.walletConfirmations=[];
 for(const action of ['fee-approval','fee-deposit','deposit']){
  mark('approve-'+action);
  await page.waitForFunction(()=>Array.isArray(__walletTestPending)||!!document.querySelector('#depositStatus .error'),{},{timeout:stageTimeout});assert.equal(await page.locator('#depositStatus .error').count(),0);
  const pending=await page.evaluate(()=>__walletTestPending);assertMetaMaskTransaction({stage:action,request:pending,account:identity.address,chainId:await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),expectedChainId:11155111n,tokenAddress,feePortalAddress,privateFeeAddress:config.privateFee.contractAddress,boardPortalAddress:portalAddress,fundingAmount:formatEther(funding),collateralAmount:formatEther(amount)});
  await walletPage.getByTestId('parent-selector-confirmation-page').waitFor({timeout:60000});await walletPage.getByTestId('confirm-footer-button').click();report.walletConfirmations.push(action);
  await page.waitForFunction(data=>__walletTestPending?.[0]?.data!==data,pending[0].data,{timeout:stageTimeout});
 }
 mark('automatic-testnet-claim');
 await page.waitForFunction(()=>document.getElementById('depositStatus')?.textContent.includes('Deposit claimed on L2!')||!!document.querySelector('#depositStatus .error'),{},{timeout:stageTimeout});assert.equal(await page.locator('#depositStatus .error').count(),0);
 const hashes=text=>[...new Set([...text.matchAll(/(?:Transaction hash:|Tx hash:)\s*(0x[0-9a-fA-F]{64})/g)].map(x=>x[1]))];
 report.claimHashes=hashes(await page.locator('#depositStatus').textContent());assert.equal(report.claimHashes.length,1);
 const verify=async hash=>{const deadline=Date.now()+stageTimeout;let receipt;
  while(Date.now()<deadline){receipt=await node.getTxReceipt(TxHash.fromString(hash));if(['checkpointed','proven','finalized'].includes(receipt.status))break;assert(!['dropped','reverted'].includes(receipt.status));await new Promise(r=>setTimeout(r,5000));}
  assert.equal(receipt.executionResult,'success');assert(['checkpointed','proven','finalized'].includes(receipt.status));const block=await node.getBlock(receipt.blockNumber);assert.equal(block.hash.toString(),receipt.blockHash.toString());return {txHash:hash,status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash.toString(),transactionFee:String(receipt.transactionFee)};};
 report.claim=await verify(report.claimHashes[0]);assert.equal(await portal.getDeposit(identity.address),amount);await save();
 mark('testnet-post');const message='Automated end-to-end test: one deposit, automatic claim, remote proof. '+new Date().toISOString();report.message=message;
 await page.locator('#postBtn').waitFor({state:'visible',timeout:stageTimeout});await page.locator('#msgText').fill(message);await page.locator('#postBtn').click();
 await page.waitForFunction(()=>document.getElementById('postStatus')?.textContent.includes('Message included. Public content and transaction timing remain observable.')||!!document.querySelector('#postStatus .error'),{},{timeout:stageTimeout});assert.equal(await page.locator('#postStatus .error').count(),0);
 const postHashes=hashes(await page.locator('#postStatus').textContent());assert.equal(postHashes.length,1);report.post=await verify(postHashes[0]);
 report.proverAfter=await(await fetch(origin+'/prover/healthz',{signal:AbortSignal.timeout(30000)})).json();assert(report.proverAfter.queue.completed>=report.proverBefore.queue.completed+2);assert.equal(report.proverAfter.queue.failed,report.proverBefore.queue.failed);
 const metadata=JSON.parse(await fs.readFile(path.join(ROOT,'apps/dist/public-feed-metadata.json'),'utf8')),scope={l1ChainId:'11155111',rollupVersion:'1821665230',rollupAddress:rollup,boardAddress:board,portalAddress};
 const source=await createPublicFeedSource({node:publicNode(config.network.nodeUrl),scope,artifact:metadata.artifact,eventTags:metadata.eventTags,censorWindow:'3600'});
 const events=await source.getEvents({fromBlock:report.post.blockNumber,toBlock:report.post.blockNumber,referenceBlock:report.post.blockHash});const published=events.filter(e=>e.type==='PostPublished'&&e.position.txHash===report.post.txHash);assert.equal(published.length,1);assert.equal(published[0].payload.text,message);report.publication=published[0];report.passed=true;mark('confirmed-testnet-post');
}catch(error){report.failure={stage,name:error?.name,sourceFrames:typeof error?.stack==='string'?error.stack.split('\n').filter(line=>line.includes('test-hosted-onboarding.mjs:')):[],code:typeof error?.code==='string'?error.code:null};
 if(page&&!page.isClosed())report.ui=await page.evaluate(()=>({errors:['setupStatus','depositStatus','postStatus'].map(id=>({id,text:document.getElementById(id)?.textContent?.slice(-12000)})),diagnostics:globalThis.__u01FormatterDiagnostics??[],walletFailure:globalThis.__walletTestFailure??null})).catch(()=>({unavailable:true}));
 if(stage==='sepolia-network'&&walletPage&&!walletPage.isClosed())report.walletControls=await walletPage.locator('body').innerText().catch(()=> 'unavailable');
 console.log(JSON.stringify({failed:stage,errorName:error?.name}));process.exitCode=1;
}finally{if(context)await context.close();provider?.destroy();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:report.passed,result:path.join(directory,'result.json')}));}
