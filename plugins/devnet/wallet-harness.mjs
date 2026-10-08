import {observeUnfundedRejection} from './wallet-observation.mjs';
// Real MetaMask + unchanged built author application. No injected wallet or engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {Contract,Interface} from 'ethers';
import {Fr} from '@aztec/foundation/curves/bn254';
import {NO_FROM} from '@aztec/aztec.js/account';
import {onboardMetaMask,unpackMetaMask,addMetaMaskNetwork,observeMetaMaskTransactions} from '../../scripts/t04-metamask.mjs';
import {unpackText} from '../protocol.mjs';
import {veniceClient} from '../venice.mjs';
import {githubApi} from '../github-tools.mjs';
import {drainDevnetCheckpoints} from './network.mjs';
import {settleC01ApplicationMessage} from '../../scripts/c01-settle-application-message.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));


export async function runWalletHarness({fixture,author,directory,origin,onProgress=console.log,signal,scenario='read',onInterruption}){
 const report={passed:false,realMetaMask:true,applicationProofs:process.env.PLUGIN_PROOFS==='true',stage:'launch'};
 const mark=stage=>{report.stage=stage;onProgress(stage);};
 let context,page;
 const expectedModel=process.env.VENICE_MODEL||'kimi-k2-5';
 assert.equal(process.env.PLUGIN_REPOSITORY||fixture.serviceConfig.repository,'zac-williamson/aztec_experiments','This acceptance scenario reads the existing smoke PR in the configured fork');
 const cancel=()=>{void context?.close().catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 const deadline=process.env.PLUGIN_SUPERVISED==='true'?null:setTimeout(cancel,480000);
 const ledgerClient=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY});
 const ledger=async()=>(await ledgerClient.json('/api/v1/x402/transactions/'+ledgerClient.address+'?limit=100&offset=0')).data.transactions;
 const read=async(method,...args)=>(await fixture.board.methods[method](...args).simulate({from:NO_FROM})).result;
 const escrowRead=async(method,...args)=>(await fixture.adapter.methods[method](...args).simulate({from:NO_FROM})).result;
 if(!['read','write','interruption'].includes(scenario))throw Error('Unknown plugin scenario');
 const codePath='plugins/smoke/escrow-'+path.basename(directory)+'.mjs';
 const code='export const escrowBillingSmoke = true;\n';
 const text=scenario==='write'?`@bok Use write_file to create ${codePath} with content obtained by decoding this JSON string exactly (including its final newline): ${JSON.stringify(code)}. Then create_pr titled Escrow billing integration smoke. Body: Automated funded Bok integration test; do not merge. Reply with the PR URL and file path.`:'@bok Read PR 1 using read_pr. Reply with its URL, exact changed file path and a short summary. Do not create or change anything.';
 try{
  signal?.throwIfAborted();
  const extension=unpackMetaMask(directory);
  const launch=()=>chromium.launchPersistentContext(path.join(directory,'wallet-browser-profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=1024']});
  context=await launch();
  signal?.throwIfAborted();
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:20000});
  const extensionId=new URL(worker.url()).host;
  let walletPage=await onboardMetaMask(context,fixture.signer.mnemonic.phrase,author.password,extensionId,mark,async onboarding=>{
   const gate=path.join(directory,'accept-wallet-terms');
   // The user explicitly accepted these wallet terms in this task.
   await fs.writeFile(gate,'approved\n');
   await fs.writeFile(path.join(directory,'wallet-terms-prompt.txt'),await onboarding.locator('body').innerText());
   mark('awaiting-wallet-terms-confirmation');
   const deadline=Date.now()+300000;
   while(Date.now()<deadline){signal?.throwIfAborted();try{if((await fs.readFile(gate,'utf8')).trim()==='approved')return;}catch(error){if(error.code!=='ENOENT')throw error;}await pause(500);}
   throw Error('Wallet terms confirmation not received');
  });
  // Onboarding has confirmed persisted account readiness. Start a fresh session
  // with that same profile so its large setup renderer does not overlap proving.
  mark('reopen-configured-wallet');await context.close();context=await launch();
  for(const restored of context.pages())await restored.close();
  walletPage=await context.newPage();await walletPage.goto('chrome-extension://'+extensionId+'/home.html');
  await walletPage.getByTestId('unlock-password').fill(author.password);
  await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('account-menu-icon').waitFor();
  page=await context.newPage();page.setDefaultTimeout(30000);
  // Configure the test chain before loading the application: a chain change and
  // page reload otherwise overlap two copies of the browser prover at startup.
  mark('configure-wallet-network');await page.goto(origin+'/wallet-setup.html');
  await page.waitForFunction(()=>window.ethereum);
  await addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl:fixture.net.rpcUrl,mark});
  mark('authorize-test-origin');
  const accounts=page.evaluate(()=>window.ethereum.request({method:'eth_requestAccounts'}));
  await walletPage.getByTestId('confirm-btn').waitFor();
  assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');
  await walletPage.getByTestId('confirm-btn').click();
  assert.deepEqual((await accounts).map(value=>value.toLowerCase()),[fixture.signer.address.toLowerCase()]);
  await walletPage.close();
  mark('open-author-page');await page.goto(origin+'/user.html');
  await page.waitForFunction(()=>window.__aztec&&window.ethereum&&document.getElementById('wbAztecFile'));
  await page.getByText('Board ready. Connect your wallet to continue.',{exact:true}).waitFor();
  mark('restore-funded-author');await page.locator('#wbAccountMenu > summary').click();
  await page.locator('#wbPassword').fill(author.password);await page.locator('#wbAztecFile').setInputFiles(author.backupPath);
  await page.waitForFunction(()=>!!window.walletState?.aztec?.address);
  await page.locator('#wbAccountMenu > summary').click();
  mark('connect-metamask');await page.locator('#wbEthBrowserBtn').click();
  await page.waitForFunction(()=>document.getElementById('postBtn')?.getClientRects().length||document.querySelector('#setupStatus .error'),{},{timeout:120000});
  assert(await page.locator('#postBtn').isVisible(),'Author setup failed: '+await page.locator('#setupStatus').innerText());
  await observeMetaMaskTransactions(page);
  mark('read-provider-ledger');
  const before=await ledger(),priorIds=new Set(before.map(x=>x.id));
  const initialCount=BigInt(await read('get_post_count'));
  const initialTokens=await fixture.token.balanceOf(fixture.signer.address);
  await page.locator('#pluginAccountPanel summary').click();
  await action('#pluginBalance');await success();
  assert.match(await page.locator('#pluginStatus').innerText(),/Available: 0(?:\.0)? USDC/);
  await observeUnfundedRejection(page);
  mark('reject-unfunded-plugin-post-through-ui');
  await page.locator('#msgText').fill(text);await page.locator('#postBtn').click();
  await page.waitForFunction(()=>document.querySelector('#postStatus .error'),{},{timeout:120000});
  assert.equal(await page.evaluate(()=>window.__pluginInsufficientBalance),true,'Expected escrow insufficient-balance rejection');
  assert.equal(BigInt(await read('get_post_count')),initialCount,'Failed escrow hook must roll back publication');
  assert.equal(Number(await escrowRead('request_count')),0);
  if(scenario!=='interruption')assert.equal((await ledger()).filter(x=>!priorIds.has(x.id)&&x.type==='CHARGE').length,0,'Unfunded post must not spend provider credits');
  report.unfundedPost={rejectedThroughBrowser:true,noPublication:true,...(scenario==='interruption'?{provider:'simulated interruption runner'}:{noProviderCharge:true})};
  async function action(button){await page.locator('#pluginStatus').evaluate(e=>e.removeAttribute('data-outcome'));await page.locator(button).click();}
  async function success(){await page.waitForFunction(()=>document.querySelector('#pluginStatus')?.dataset.outcome,{},{timeout:120000});assert.equal(await page.locator('#pluginStatus').getAttribute('data-outcome'),'success',await page.locator('#pluginStatus').innerText());}
  async function approve(method,to){
   await page.waitForFunction(()=>window.__walletTestPending||document.querySelector('#pluginStatus')?.dataset.outcome==='error',{},{timeout:30000});
   const request=await page.evaluate(()=>window.__walletTestPending);assert(request,'Missing wallet transaction: '+await page.locator('#pluginStatus').innerText());
   assert.equal(request.length,1);const tx=request[0];assert.equal(tx.from.toLowerCase(),fixture.signer.address.toLowerCase());assert.equal(tx.to.toLowerCase(),to.toLowerCase());assert.equal(BigInt(tx.value??0),0n);
   const abi=new Interface(['function approve(address,uint256)','function deposit(bytes32,uint128,bytes32)','function withdraw(address,uint128,bytes32,uint256,uint256,uint256,bytes32[])']);
   const parsed=abi.parseTransaction(tx);assert.equal(parsed.name,method);
   if(method==='approve'){assert.equal(parsed.args[0].toLowerCase(),fixture.descriptor.funding.portalAddress);assert.equal(parsed.args[1],1000000n);}
   if(method==='deposit'){assert.equal(parsed.args[0],fixture.author.address.toString());assert.equal(parsed.args[1],1000000n);}
   if(walletPage.isClosed())walletPage=await context.newPage();
   await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');
   await walletPage.getByTestId('confirm-footer-button').click();
   await page.waitForFunction(()=>!window.__walletTestPending);await walletPage.close();
  }
  mark('deposit-plugin-usdc-through-wallet');await action('#pluginDeposit');
  await approve('approve',await fixture.token.getAddress());await approve('deposit',await fixture.escrowPortal.getAddress());await success();
  assert.equal(await fixture.token.balanceOf(fixture.signer.address),initialTokens-1000000n);
  assert.equal(BigInt(await escrowRead('balance',fixture.author.address)),0n);
  mark('wait-for-plugin-inbox');
  const depositEvent=(await fixture.escrowPortal.queryFilter(fixture.escrowPortal.filters.Deposited()))[0].args;
  fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
  const inboxDeadline=Date.now()+90000;let witness;
  while(Date.now()<inboxDeadline){await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();witness=await fixture.net.node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(depositEvent.key));if(witness)break;await pause(1000);}
  assert(witness,'Inbox message unavailable');fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});await drainDevnetCheckpoints(fixture.net);
  mark('claim-plugin-deposit-through-ui');await action('#pluginClaim');await success();
  assert.equal(BigInt(await escrowRead('balance',fixture.author.address)),1000000n);
  report.deposit={amount:'1000000',asset:'USDC',claimedThroughBrowser:true};
  const initialEth=await fixture.provider.getBalance(fixture.signer.address);
  mark('post-through-composer');await page.locator('#msgText').fill(text);await page.locator('#postBtn').click();
  await page.waitForFunction(()=>document.getElementById('postStatus')?.textContent.includes('Message included.')||document.querySelector('#postStatus .error'),{},{timeout:120000});
  assert.equal(await page.locator('#postStatus .error').count(),0,await page.locator('#postStatus').innerText());
  assert.equal(BigInt(await read('get_post_count')),initialCount+1n);
  const postId=String(await escrowRead('request_at',0));report.postId=postId;
  const id=Fr.fromString(postId);
  assert.equal(unpackText((await read('get_post',id)).map(String),Number(await read('get_post_length',id))),text);
  assert.equal(await page.evaluate(()=>window.__walletTestPending),null);
  assert.equal(await fixture.provider.getBalance(fixture.signer.address),initialEth);
  report.post={noEthereumPayment:true,authorizedInAztec:true};
  if(scenario==='interruption'){
   mark('restart-interrupted-service-and-expire');report.interruption=await onInterruption(postId);
   await action('#pluginRequests');await success();
   const release=page.locator('#pluginRequestsList').getByRole('button',{name:'Release funds',exact:true});await release.waitFor();
   mark('release-expired-funds-through-ui');await page.locator('#pluginStatus').evaluate(e=>e.removeAttribute('data-outcome'));await release.click();await success();
   const released=await escrowRead('invocation',id);assert.equal(Number(released[1]),5);assert.equal(BigInt(released[3]),0n);assert.equal(BigInt(released[4]),0n);
   assert.equal(BigInt(await escrowRead('balance',fixture.author.address)),1000000n);assert.equal(await fixture.token.balanceOf(await fixture.escrowPortal.getAddress()),1000000n);
   await assert.rejects(fixture.adapter.methods.release_expired(id).simulate({from:fixture.author.address}));
   report.interruption={...report.interruption,releasedThroughBrowser:true,restoredMicroUSDC:'1000000',replayRejected:true};report.passed=true;mark('passed');return report;
  }
  mark('wait-for-live-bok-reply');
  await page.locator('#billboardFeed').getByText(/Bot reply/).waitFor({timeout:240000});
  const replyId=(await read('get_plugin_request',id))[2];assert.notEqual(BigInt(replyId),0n);
  const replyField=Fr.fromString(replyId.toString());
  const reply=unpackText((await read('get_post',replyField)).map(String),Number(await read('get_post_length',replyField)));
  const api=githubApi({token:process.env.GITHUB_TOKEN});
  if(scenario==='write'){
   const url=reply.match(/https:\/\/github\.com\/zac-williamson\/aztec_experiments\/pull\/(\d+)/);assert(url,'Reply must include created PR URL');
   const pr=await api('GET','/repos/zac-williamson/aztec_experiments/pulls/'+url[1]);
   const repo=await api('GET','/repos/zac-williamson/aztec_experiments');
   assert.equal(pr.draft,true);assert.equal(pr.state,'open');assert.equal(pr.base.ref,repo.default_branch);assert.equal(pr.head.ref,'bok/'+BigInt(postId).toString(16).padStart(64,'0'));
   const files=await api('GET','/repos/zac-williamson/aztec_experiments/pulls/'+url[1]+'/files');assert.equal(files.length,1);assert.equal(files[0].filename,codePath);assert.equal(files[0].status,'added');
   report.github={url:pr.html_url,draft:pr.draft,head:pr.head.sha,file:codePath,exactContent:false};
   const content=await api('GET','/repos/zac-williamson/aztec_experiments/contents/'+codePath+'?ref='+pr.head.sha);assert.equal(Buffer.from(content.content,'base64').toString('utf8'),code);
   report.github={url:pr.html_url,draft:pr.draft,head:pr.head.sha,file:codePath,exactContent:true};
  }else{assert(reply.includes('https://github.com/zac-williamson/aztec_experiments/pull/1'));assert(reply.includes('docs/bok-live-smoke.md'));}
  assert.equal(await read('is_post_flagged',id),false);assert.equal(await read('is_post_flagged',replyField),false);

  const charges=(await ledger()).filter(x=>!priorIds.has(x.id)&&x.type==='CHARGE');assert(charges.length>0);assert(charges.every(x=>x.modelId===expectedModel));
  report.reply={postId:replyField.toString(),text:reply,visible:false,flagged:false};report.veniceCharges=charges;
  mark('verify-visible-reply');
  const article=page.locator('#billboardFeed article').filter({has:page.getByText(/Bot reply/)});
  assert.equal(await article.count(),1);assert(await article.isVisible());
  const content=article.locator('p').nth(1);assert(await content.isVisible());
  assert.equal(await content.textContent(),reply);
  // Normal paragraph layout collapses whitespace; still require all rendered words.
  const normalize=value=>value.replace(/\s+/g,' ').trim();
  assert.equal(normalize(await content.innerText()),normalize(reply));
  report.reply.visible=true;
  const inv=await escrowRead('invocation',id);assert.equal(Number(inv[1]),3);assert.equal(BigInt(inv[3]),0n);
  const charged=BigInt(inv[4]),balance=BigInt(await escrowRead('balance',fixture.author.address));
  report.settlement={chargedMicroUSDC:String(charged),remainingMicroUSDC:String(balance),reserved:'0'};
  const invoiced=charges.reduce((sum,c)=>{assert(typeof c.amount==='number'&&Number.isFinite(c.amount)&&c.amount<0,'Invalid Venice debit');return sum+BigInt(Math.ceil(-c.amount*1e6-1e-9));},0n);
  assert.equal(charged,invoiced,'Escrow charge must equal live Venice invoices rounded per call to micro-USDC');
  assert(charged>0n);assert.equal(balance+charged,1000000n);assert.equal(BigInt(await escrowRead('earned',fixture.operator.address)),charged);
  report.settlement.providerMicroUSDC=String(invoiced);
  await action('#pluginRequests');await success();assert.match(await page.locator('#pluginRequestsList').innerText(),/Reply published/);
  report.requestStatus={shownThroughBrowser:true};
  await action('#pluginBalance');await success();
  await page.screenshot({path:path.join(directory,'browser-reply.png'),fullPage:true});
  mark('withdraw-plugin-balance-through-ui');await page.locator('#pluginAmount').fill((Number(balance)/1e6).toFixed(6));await action('#pluginWithdraw');await success();
  assert.equal(BigInt(await escrowRead('balance',fixture.author.address)),0n);
  const withdrawal=await page.evaluate(receiver=>Object.keys(localStorage).filter(k=>k.startsWith('plugin-account:'+receiver+':')).map(k=>JSON.parse(localStorage[k]).withdrawal)[0],fixture.descriptor.scope.receiver);
  const hash=(await import('@aztec/stdlib/tx')).TxHash.fromString(withdrawal.txHash);
  const effect=await fixture.net.node.getTxEffect(hash),leaf=effect.data.l2ToL1Msgs.find(x=>!x.isZero());
  const settledExit=await settleC01ApplicationMessage({node:fixture.net.node,config:fixture.net.config,dateProvider:fixture.net.dateProvider,l1Client:fixture.net.deployment.l1Client,directory,rollupAddress:(await fixture.net.node.getNodeInfo()).l1ContractAddresses.rollupAddress,txHash:hash,expectedLeaf:leaf,kind:'exit',applicationProofs:report.applicationProofs});
  const exitWitness=settledExit.witness,exitArgs=[withdrawal.recipient,BigInt(withdrawal.amount),withdrawal.nonce,BigInt(exitWitness.epochNumber),BigInt(exitWitness.numCheckpointsInEpoch),exitWitness.leafIndex,exitWitness.siblingPath.toBufferArray().map(b=>'0x'+b.toString('hex'))];
  await assert.rejects(fixture.escrowPortal.withdraw.staticCall('0x'+'55'.repeat(20),...exitArgs.slice(1)),'Outbox proof must bind recipient');
  mark('redeem-plugin-usdc-through-wallet');await action('#pluginRedeem');await approve('withdraw',await fixture.escrowPortal.getAddress());await success();
  assert.equal(await fixture.token.balanceOf(fixture.signer.address),initialTokens-charged);
  assert.equal(await fixture.token.balanceOf(await fixture.escrowPortal.getAddress()),charged);
  await assert.rejects(fixture.escrowPortal.withdraw.staticCall(...exitArgs),'Outbox proof must be single-use');
  report.withdrawal={returnedMicroUSDC:String(balance),throughBrowser:true,wrongRecipientRejected:true,replayRejected:true};report.passed=true;mark('passed');
 }catch(error){report.error='Wallet harness failed at '+report.stage+' ('+error.name+')';report.failureMessage=String(error.message).slice(0,2000);report.callSite=String(error.stack).split('\n').find(line=>line.includes('wallet-harness.mjs:'));if(page)report.uiStatus=await page.locator('#setupStatus, #postStatus, #pluginStatus').allTextContents().catch(()=>[]);throw new Error(report.error);
 }finally{
  clearTimeout(deadline);signal?.removeEventListener('abort',cancel);
  try{await context?.close();}catch(error){report.passed=false;report.cleanupError=error.message;throw error;}
  finally{await fs.writeFile(path.join(directory,'browser-result.json'),JSON.stringify(report,null,2));}
 }
 return report;
}
