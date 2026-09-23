// Bounded phases of the real public-network user flow. All financial actions use
// the built page and a fresh MetaMask profile. Network waiting happens between runs.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {chromium} from 'playwright';import {Wallet,JsonRpcProvider,Contract as EthContract,Interface} from 'ethers';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createAztecNodeClient} from '@aztec/aztec.js/node';
import {Fr} from '@aztec/foundation/curves/bn254';import {TxHash} from '@aztec/stdlib/tx';
import {onboardMetaMask,unpackMetaMask,observeMetaMaskTransactions} from '../../scripts/t04-metamask.mjs';
import {observeUnfundedRejection} from '../devnet/wallet-observation.mjs';
import {startBoardWeb} from '../devnet/web.mjs';import {veniceClient} from '../venice.mjs';import {githubApi} from '../github-tools.mjs';import {outboxArguments} from '../operations.mjs';
const [requestedPhase,directory,servicePath,sitePath]=process.argv.slice(2),recoveringFund=requestedPhase==='recover-fund',phase=recoveringFund?'fund':requestedPhase,phases=['fund','post','reply','redeem'];
if(!phases.includes(phase)||!sitePath)throw Error('Usage: browser.mjs fund|post|reply|redeem AUTHOR_DIRECTORY SERVICE_CONFIG SITE_CONFIG');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8')),actor=await read(path.join(directory,'author.json')),service=await read(servicePath),site=await read(sitePath),scope=service.descriptor.scope;
assert.equal(scope.chainId,'11155111');assert.equal(site.board.contractAddress,scope.boardAddress);assert.equal(site.network.rollupAddress,scope.rollupAddress);
const reportPath=path.join(directory,'public-flow.json');let report;
try{report=await read(reportPath);}catch(e){if(e.code!=='ENOENT')throw e;report={passed:false,next:'fund',phases:{},network:scope};}
assert.deepEqual(report.network,scope);assert.equal(report.next,phase,'Run only the next uncompleted phase');assert(!report.running||(recoveringFund&&report.running==='fund'&&report.error?.stage==='deposit-plugin-usdc'),'Inspect interrupted phase before resuming; do not repeat financial actions');
const save=()=>fs.writeFile(reportPath,JSON.stringify(report,null,2),{mode:0o600});
const node=createAztecNodeClient(service.nodeUrl),provider=new JsonRpcProvider(service.ethereumUrl),signer=Wallet.fromPhrase(actor.mnemonic).connect(provider);
let context,web,page;
const mark=stage=>{report.stage=stage;console.log('STEP',stage);};
const codePath='plugins/smoke/public-escrow-'+path.basename(directory)+'.mjs',code='export const publicEscrowBillingSmoke = true;\n';
const prompt=`@bok Use write_file to create ${codePath} with content obtained by decoding this JSON string exactly (including its final newline): ${JSON.stringify(code)}. Then create_pr titled Public escrow billing integration smoke. Body: Automated public-testnet funded Bok integration test; do not merge. Reply with the PR URL and file path.`;
try{
 assert.equal(Number((await provider.getNetwork()).chainId),11155111);const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),11155111);assert.equal(String(info.rollupVersion),scope.rollupVersion);
 report.applicationProofs=true;
 const inspect=async options=>JSON.parse((await promisify(execFile)(process.execPath,['plugins/public/inspect.mjs',servicePath,directory,JSON.stringify(options??{})],{maxBuffer:65536,timeout:120000})).stdout);
 const token=new EthContract(service.descriptor.funding.tokenAddress,['function balanceOf(address) view returns(uint256)'],provider),portalArtifact=await read('billboard/portal/out/PluginPortal.sol/PluginPortal.json'),portal=new EthContract(service.descriptor.funding.portalAddress,portalArtifact.abi,provider);
 assert.equal(signer.address,actor.ethereumAddress);
 const beforeState=phase==='redeem'?null:await inspect({postId:report.postId});
 // Readiness checks are read-only and do not consume a test phase or open a wallet.
 if(phase==='post'&&!await node.getL1ToL2MessageMembershipWitness('latest',Fr.fromString(report.deposit.key))){console.log('AWAITING Inbox');process.exitCode=0;}
 else if(phase==='reply'&&!beforeState.reply){console.log('AWAITING reply');process.exitCode=0;}
 else if(phase==='redeem'&&(await node.getTxReceipt(TxHash.fromString(report.withdrawal.txHash))).status!=='finalized'){console.log('AWAITING withdrawal finality');process.exitCode=0;}
 else{
 report.running=phase;await save();
 let expectedReply,settledInvocation,remainingBalance;
 if(phase==='fund'){
  if(!recoveringFund){report.initialPostCount=beforeState.postCount;report.initialRequestCount=beforeState.requestCount;}
  assert.equal(beforeState.balance,'0');
 }
 if(phase==='reply'){
  assert.equal(beforeState.postFlagged,false);assert.equal(beforeState.reply.flagged,false);
  expectedReply=beforeState.reply.text;settledInvocation=beforeState.invocation;remainingBalance=BigInt(beforeState.balance);report.reply=beforeState.reply;
 }
 web=await startBoardWeb({fixture:{descriptor:service.descriptor},port:8793,publicConfig:site,connectOrigins:[new URL(service.nodeUrl).origin,new URL(service.ethereumUrl).origin,new URL('https://d30njln0kead8n.cloudfront.net').origin]});
 const extension=!report.walletOnboarded?unpackMetaMask(directory):path.join(directory,'extension');
 context=await chromium.launchPersistentContext(path.join(directory,'public-wallet-profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=1024']});
 // A persistent profile retains storage, but restored tabs must not run duplicate PXEs.
 for(const restored of context.pages())await restored.close();
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:20000}),id=new URL(worker.url()).host;let walletPage;
 if(!report.walletOnboarded){walletPage=await onboardMetaMask(context,actor.mnemonic,actor.password,id,mark,async()=>{await fs.writeFile(path.join(directory,'accept-wallet-terms'),'approved in this task\n',{mode:0o600});});report.walletOnboarded=true;await save();}
 else{mark('unlock-metamask');walletPage=await context.newPage();await walletPage.goto('chrome-extension://'+id+'/home.html');await walletPage.getByTestId('unlock-password').fill(actor.password);await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('account-menu-icon').waitFor();}
 mark('open-public-author-page');page=await context.newPage();page.setDefaultTimeout(30000);await page.goto('http://localhost:8793/user.html');await page.getByText('Board ready. Connect your wallet to continue.',{exact:true}).waitFor();
 if(phase==='fund'&&await page.evaluate(()=>window.ethereum.request({method:'eth_chainId'}))!=='0xaa36a7'){
  mark('switch-sepolia');const switching=page.evaluate(()=>window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xaa36a7'}]}));
  await walletPage.goto('chrome-extension://'+id+'/notification.html');await walletPage.getByRole('button',{name:'Confirm',exact:true}).click();await switching;await walletPage.goto('chrome-extension://'+id+'/home.html');await page.reload();await page.getByText('Board ready. Connect your wallet to continue.',{exact:true}).waitFor();
 }
 assert.equal(await page.evaluate(()=>window.ethereum.request({method:'eth_chainId'})),'0xaa36a7');
 await walletPage.close();
 mark('restore-author');await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill(actor.password);await page.locator('#wbAztecFile').setInputFiles(path.join(directory,'browser-wallet.encrypted.json'));await page.waitForFunction(()=>!!window.walletState?.aztec?.address);await page.locator('#wbAccountMenu > summary').click();
 mark('connect-metamask');const connected=await page.evaluate(()=>window.ethereum.request({method:'eth_accounts'}));await page.locator('#wbEthBrowserBtn').click();if(!connected.length){walletPage=await context.newPage();await walletPage.goto('chrome-extension://'+id+'/notification.html');await walletPage.getByTestId('confirm-btn').click();await walletPage.close();}
 await page.waitForFunction(()=>document.getElementById('postBtn')?.getClientRects().length||document.querySelector('#setupStatus .error'),{},{timeout:120000});assert(await page.locator('#postBtn').isVisible(),await page.locator('#setupStatus').innerText());
 if(['reply','redeem'].includes(phase)){
  mark('reconcile-saved-aztec-transaction');
  await page.evaluate(async()=>{await callEngine('recover','setupStatus',{});});
 }
 await observeMetaMaskTransactions(page);await page.locator('#pluginAccountPanel summary').click();
 const action=async button=>{await page.locator('#pluginStatus').evaluate(e=>e.removeAttribute('data-outcome'));await page.locator(button).click();};
 const success=async()=>{await page.waitForFunction(()=>document.querySelector('#pluginStatus')?.dataset.outcome,{},{timeout:240000});assert.equal(await page.locator('#pluginStatus').getAttribute('data-outcome'),'success',await page.locator('#pluginStatus').innerText());};
 const approve=async(method,target)=>{
  await page.waitForFunction(()=>window.__walletTestPending||document.querySelector('#pluginStatus')?.dataset.outcome==='error',{},{timeout:30000});const tx=(await page.evaluate(()=>window.__walletTestPending))?.[0];assert(tx,await page.locator('#pluginStatus').innerText());assert.equal(tx.from.toLowerCase(),signer.address.toLowerCase());assert.equal(tx.to.toLowerCase(),target.toLowerCase());assert.equal(BigInt(tx.value??0),0n);assert(tx.chainId===undefined||BigInt(tx.chainId)===11155111n);
  const abi=new Interface(['function approve(address,uint256)','function deposit(bytes32,uint128,bytes32)','function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']),parsed=abi.parseTransaction(tx);assert.equal(parsed.name,method);
  if(method==='approve'){assert.equal(parsed.args[0].toLowerCase(),service.descriptor.funding.portalAddress);assert.equal(parsed.args[1],1000000n);}if(method==='deposit'){assert.equal(parsed.args[0],actor.address);assert.equal(parsed.args[1],1000000n);}if(method==='withdraw'){assert.equal(parsed.args[0].toLowerCase(),signer.address.toLowerCase());assert.equal(parsed.args[1],BigInt(report.settlement.remainingMicroUSDC));}
  if(walletPage.isClosed())walletPage=await context.newPage();
  await walletPage.goto('chrome-extension://'+id+'/sidepanel.html');await walletPage.getByTestId('confirm-footer-button').click();await page.waitForFunction(()=>!window.__walletTestPending);await walletPage.close();
 };
 const ledgerClient=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY}),ledger=async()=>(await ledgerClient.json('/api/v1/x402/transactions/'+ledgerClient.address+'?limit=100&offset=0')).data.transactions;
 if(phase==='fund'&&recoveringFund){
  mark('reconcile-confirmed-wallet-deposit');
  assert.equal(report.unfundedPost?.rejected,true);
  const saved=await page.evaluate(receiver=>Object.keys(localStorage).filter(k=>k.startsWith('plugin-account:'+receiver+':')).map(k=>JSON.parse(localStorage[k]).deposit).find(Boolean),scope.receiver);
  assert(saved,'Original deposit intent must remain in browser storage');assert.equal(saved.amount,'1000000');assert.equal(saved.sender.toLowerCase(),signer.address.toLowerCase());
  const events=await portal.queryFilter(portal.filters.Deposited(actor.address),saved.startBlock);assert.equal(events.length,1);const event=events[0],transaction=await provider.getTransaction(event.transactionHash),receipt=await provider.getTransactionReceipt(event.transactionHash);
  assert.equal(receipt.status,1);assert.equal(transaction.from.toLowerCase(),signer.address.toLowerCase());assert.equal(transaction.nonce,saved.nonce);assert.equal(event.args.amount,1000000n);if(saved.txHash)assert.equal(saved.txHash,event.transactionHash);
  assert.equal(await token.balanceOf(signer.address),BigInt(report.initialTokens)-1000000n);
  report.deposit={amount:'1000000',key:event.args.key,transaction:event.transactionHash,reconciledAfterWalletClosure:true};
 }else if(phase==='fund'){
  assert(BigInt((await page.evaluate(()=>readCurrentDeposit())).amount)>0n,'Board admission collateral must be claimed before plugin qualification');
  report.initialTokens=String(await token.balanceOf(signer.address));report.priorInvoiceIds=(await ledger()).map(x=>x.id);await save();
  await action('#pluginBalance');await success();assert.match(await page.locator('#pluginStatus').innerText(),/Available: 0(?:\.0)? USDC/);
  await observeUnfundedRejection(page);
  mark('reject-unfunded-post');await page.locator('#msgText').fill(prompt);await page.locator('#postBtn').click();await page.waitForFunction(()=>document.querySelector('#postStatus .error'),{},{timeout:240000});assert.equal(await page.evaluate(()=>window.__pluginInsufficientBalance),true,'Expected escrow insufficient-balance rejection');assert.equal((await ledger()).filter(x=>!report.priorInvoiceIds.includes(x.id)&&x.type==='CHARGE').length,0);report.unfundedPost={rejected:true,noPublication:true,noProviderCharge:true};
  const block=await provider.getBlockNumber();mark('deposit-plugin-usdc');await action('#pluginDeposit');await approve('approve',await token.getAddress());await approve('deposit',await portal.getAddress());await success();
  const events=await portal.queryFilter(portal.filters.Deposited(),block);assert.equal(events.length,1);report.deposit={amount:'1000000',key:events[0].args.key,transaction:events[0].transactionHash};assert.equal(await token.balanceOf(signer.address),BigInt(report.initialTokens)-1000000n);
 }else if(phase==='post'){
  mark('claim-plugin-credit');await action('#pluginClaim');await success();assert.match(await page.locator('#pluginStatus').innerText(),/Available: 1(?:\.0)? USDC/);
  const before=await provider.getBalance(signer.address);mark('post-through-composer');await page.locator('#msgText').fill(prompt);await page.locator('#postBtn').click();await page.waitForFunction(()=>document.getElementById('postStatus')?.textContent.includes('Message included.')||document.querySelector('#postStatus .error'),{},{timeout:240000});assert.equal(await page.locator('#postStatus .error').count(),0,await page.locator('#postStatus').innerText());
  assert.equal(await provider.getBalance(signer.address),before);report.post={authorizedInAztec:true,noEthereumPayment:true};
 }else if(phase==='reply'){
  const reply=expectedReply;
  const article=page.locator('#billboardFeed article').filter({has:page.getByText(/Bot reply/)});await article.waitFor({timeout:30000});assert.equal(await article.locator('p').nth(1).textContent(),reply);report.reply.visible=true;
  const match=reply.match(/https:\/\/github\.com\/zac-williamson\/aztec_experiments\/pull\/(\d+)/);assert(match);const api=githubApi({token:process.env.GITHUB_TOKEN}),pr=await api('GET','/repos/'+service.repository+'/pulls/'+match[1]),files=await api('GET','/repos/'+service.repository+'/pulls/'+match[1]+'/files');assert.equal(pr.draft,true);assert.equal(pr.head.ref,'bok/'+BigInt(report.postId).toString(16).padStart(64,'0'));assert.equal(files.length,1);assert.equal(files[0].filename,codePath);const content=await api('GET','/repos/'+service.repository+'/contents/'+codePath+'?ref='+pr.head.sha);assert.equal(Buffer.from(content.content,'base64').toString(),code);report.github={url:pr.html_url,head:pr.head.sha,exactContent:true};
  const charges=(await ledger()).filter(x=>!report.priorInvoiceIds.includes(x.id)&&x.type==='CHARGE'),invoice=charges.reduce((n,x)=>{assert(typeof x.amount==='number'&&Number.isFinite(x.amount)&&x.amount<0,'Invalid Venice debit');return n+BigInt(Math.ceil(-x.amount*1e6-1e-9));},0n);assert(charges.length>0);assert(charges.every(x=>x.modelId===(process.env.VENICE_MODEL||'kimi-k2-5')));assert(invoice>0n);const inv=settledInvocation,remaining=remainingBalance;assert.equal(Number(inv[1]),3);assert.equal(BigInt(inv[3]),0n);assert.equal(BigInt(inv[4]),invoice);assert.equal(remaining+invoice,1000000n);report.veniceCharges=charges.map(({balanceAfter,...rest})=>rest);report.settlement={chargedMicroUSDC:String(invoice),remainingMicroUSDC:String(remaining)};
  await page.screenshot({path:path.join(directory,'public-reply.png'),fullPage:true});mark('withdraw-through-ui');await page.locator('#pluginAmount').fill((Number(remaining)/1e6).toFixed(6));await action('#pluginWithdraw');await success();report.withdrawal=await page.evaluate(receiver=>Object.keys(localStorage).filter(k=>k.startsWith('plugin-account:'+receiver+':')).map(k=>JSON.parse(localStorage[k]).withdrawal)[0],scope.receiver);
 }else{
  const w=report.withdrawal,args=[w.recipient,BigInt(w.amount),w.nonce,...await outboxArguments(node,TxHash.fromString(w.txHash))];await assert.rejects(portal.withdraw.staticCall('0x'+'55'.repeat(20),...args.slice(1)));mark('redeem-through-ui');await action('#pluginRedeem');await approve('withdraw',await portal.getAddress());await success();assert.equal(await token.balanceOf(signer.address),BigInt(report.initialTokens)-BigInt(report.settlement.chargedMicroUSDC));await assert.rejects(portal.withdraw.staticCall(...args));report.withdrawal={...w,redeemed:true,wrongRecipientRejected:true,replayRejected:true};report.passed=true;
 }
 await context.close();context=null;
 const afterState=phase==='redeem'?null:await inspect(phase==='post'?{requestIndex:Number(report.initialRequestCount)}:{});
 if(phase==='fund'){
  assert.equal(afterState.postCount,report.initialPostCount);assert.equal(afterState.requestCount,report.initialRequestCount);assert.equal(afterState.balance,'0');
 }
 if(phase==='post'){
  report.postId=afterState.postId;assert.equal(afterState.invocation[0],actor.address);assert.equal(afterState.postText,prompt);
  assert.equal(BigInt(afterState.postCount),BigInt(report.initialPostCount)+1n);
 }
 if(phase==='reply')assert.equal(afterState.balance,'0');
 delete report.error;delete report.uiFailure;report.phases[phase]={passed:true,reconciled:recoveringFund,at:new Date().toISOString()};report.next=phases[phases.indexOf(phase)+1]??null;report.running=null;await save();console.log('PHASE_PASSED',phase);
 }
}catch(error){if(page&&!page.isClosed())report.uiFailure=await page.locator('#setupStatus,#postStatus,#pluginStatus').allTextContents();report.error={stage:report.stage,name:error.name,callSite:String(error.stack).split('\n').find(x=>x.trimStart().startsWith('at ')&&x.includes('public/browser.mjs:'))};await save();throw Error('Public wallet phase failed: '+report.stage);}finally{await context?.close();await web?.close();provider.destroy();}
