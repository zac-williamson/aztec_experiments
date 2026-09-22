// Real MetaMask + unchanged built author application. No injected wallet or engine.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {Contract,Interface} from 'ethers';
import {Fr} from '@aztec/foundation/curves/bn254';
import {NO_FROM} from '@aztec/aztec.js/account';
import {onboardMetaMask,unpackMetaMask,addMetaMaskNetwork,observeMetaMaskTransactions} from '../../scripts/t04-metamask.mjs';
import {PAYMENT_ABI,messageHash,unpackText} from '../protocol.mjs';
import {veniceClient} from '../venice.mjs';
import {githubApi} from '../github-tools.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function validatePluginWalletRequest({request,descriptor,account,text}){
 assert(Array.isArray(request)&&request.length===1);
 const tx=request[0],abi=new Interface(PAYMENT_ABI);
 assert.equal(descriptor.scope.chainId,'31337');
 assert.equal(tx.from.toLowerCase(),account.toLowerCase());
 assert.equal(tx.to.toLowerCase(),descriptor.payment.contractAddress.toLowerCase());
 assert.equal(BigInt(tx.value),BigInt(descriptor.payment.amountWei));
 if(tx.chainId!==undefined)assert.equal(BigInt(tx.chainId),31337n);
 const parsed=abi.parseTransaction(tx);assert.equal(parsed.name,'pay');
 assert.equal(parsed.args.messageHash,messageHash(text));
 assert.equal(abi.encodeFunctionData('pay',parsed.args).toLowerCase(),tx.data.toLowerCase());
 return parsed.args.postId;
}

export async function runWalletHarness({fixture,author,directory,origin,onProgress=console.log,signal}){
 const report={passed:false,realMetaMask:true,applicationProofs:process.env.PLUGIN_PROOFS==='true',stage:'launch'};
 const mark=stage=>{report.stage=stage;onProgress(stage);};
 let context,page;
 const expectedModel=process.env.VENICE_MODEL||'kimi-k2-5';
 assert.equal(process.env.PLUGIN_REPOSITORY||fixture.serviceConfig.repository,'zac-williamson/aztec_experiments','This acceptance scenario reads the existing smoke PR in the configured fork');
 const cancel=()=>{void context?.close().catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 const deadline=setTimeout(cancel,480000);
 const ledgerClient=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY});
 const ledger=async()=>(await ledgerClient.json('/api/v1/x402/transactions/'+ledgerClient.address+'?limit=100&offset=0')).data.transactions;
 const read=async(method,...args)=>(await fixture.board.methods[method](...args).simulate({from:NO_FROM})).result;
 const payments=new Contract(fixture.descriptor.payment.contractAddress,PAYMENT_ABI,fixture.provider);
 const text='@bok Read PR 1 using read_pr. Reply with its URL, exact changed file path and a short summary. Do not create or change anything.';
 try{
  signal?.throwIfAborted();
  const extension=unpackMetaMask(directory);
  context=await chromium.launchPersistentContext(path.join(directory,'wallet-browser-profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=1024']});
  signal?.throwIfAborted();
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:20000});
  const extensionId=new URL(worker.url()).host;
  const walletPage=await onboardMetaMask(context,fixture.signer.mnemonic.phrase,author.password,extensionId,mark,async onboarding=>{
   const gate=path.join(directory,'accept-wallet-terms');
   await fs.writeFile(path.join(directory,'wallet-terms-prompt.txt'),await onboarding.locator('body').innerText());
   mark('awaiting-wallet-terms-confirmation');
   const deadline=Date.now()+300000;
   while(Date.now()<deadline){signal?.throwIfAborted();try{if((await fs.readFile(gate,'utf8')).trim()==='approved')return;}catch(error){if(error.code!=='ENOENT')throw error;}await pause(500);}
   throw Error('Wallet terms confirmation not received');
  });
  page=await context.newPage();page.setDefaultTimeout(30000);
  mark('open-author-page');await page.goto(origin+'/user.html');
  await page.waitForFunction(()=>window.__aztec&&window.ethereum&&document.getElementById('wbAztecFile'));
  await page.getByText('Board ready. Connect your wallet to continue.',{exact:true}).waitFor();
  await addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl:fixture.net.rpcUrl,mark});
  // Adding a network changes wallet identity; reload before importing application keys.
  await page.reload();await page.getByText('Board ready. Connect your wallet to continue.',{exact:true}).waitFor();
  mark('restore-funded-author');await page.locator('#wbAccountMenu > summary').click();
  await page.locator('#wbPassword').fill(author.password);await page.locator('#wbAztecFile').setInputFiles(author.backupPath);
  await page.waitForFunction(()=>!!window.walletState?.aztec?.address);
  await page.locator('#wbAccountMenu > summary').click();
  mark('connect-metamask');await page.locator('#wbEthBrowserBtn').click();
  await walletPage.getByTestId('confirm-btn').waitFor();assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');await walletPage.getByTestId('confirm-btn').click();
  await page.waitForFunction(()=>document.getElementById('postBtn')?.getClientRects().length||document.querySelector('#setupStatus .error'),{},{timeout:120000});
  assert(await page.locator('#postBtn').isVisible(),'Author setup failed: '+await page.locator('#setupStatus').innerText());
  await observeMetaMaskTransactions(page);
  const before=await ledger(),priorIds=new Set(before.map(x=>x.id));
  const initialCount=BigInt(await read('get_post_count'));
  const initialBalance=await fixture.provider.getBalance(fixture.signer.address);
  mark('post-through-composer');await page.locator('#msgText').fill(text);await page.locator('#postBtn').click();
  await page.waitForFunction(()=>window.__walletTestPending||document.querySelector('#postStatus .error'),{},{timeout:120000});
  const request=await page.evaluate(()=>window.__walletTestPending);
  const postId=validatePluginWalletRequest({request,descriptor:fixture.descriptor,account:fixture.signer.address,text});
  report.postId=postId;
  assert.equal(BigInt(await read('get_post_count')),initialCount+1n);
  const id=Fr.fromString(postId);
  assert.equal(unpackText((await read('get_post',id)).map(String),Number(await read('get_post_length',id))),text);
  mark('reject-plugin-payment');await walletPage.getByTestId('confirm-footer-cancel-button').click();
  await page.locator('#postStatus .error').waitFor();
  // Three service polling periods after rejection; independently inspect chain and provider.
  await pause(6500);
  assert.equal((await payments.payments(postId,messageHash(text))).amount,0n);
  assert.equal(BigInt((await read('get_plugin_request',id))[2]),0n);
  assert.equal(await fixture.provider.getBalance(fixture.signer.address),initialBalance);
  assert.equal((await ledger()).filter(x=>!priorIds.has(x.id)&&x.type==='CHARGE').length,0);
  report.rejection={noPayment:true,noReply:true,noVeniceCharge:true,observationMs:6500};
  mark('retry-same-post-payment');await page.locator('#postBtn').click();
  await page.waitForFunction(()=>window.__walletTestPending,{},{timeout:30000});
  const retry=await page.evaluate(()=>window.__walletTestPending);
  assert.equal(validatePluginWalletRequest({request:retry,descriptor:fixture.descriptor,account:fixture.signer.address,text}),postId);
  assert.equal(BigInt(await read('get_post_count')),initialCount+1n);
  mark('approve-plugin-payment');await walletPage.getByTestId('confirm-footer-button').click();
  await page.locator('#postStatus .success').filter({hasText:'Message included.'}).waitFor({timeout:60000});
  const paid=await payments.queryFilter(payments.filters.PluginPaid(postId,fixture.signer.address));assert.equal(paid.length,1);
  const receipt=await fixture.provider.getTransactionReceipt(paid[0].transactionHash);assert.equal(receipt.status,1);
  const tx=await fixture.provider.getTransaction(receipt.hash);assert.equal(tx.from.toLowerCase(),fixture.signer.address.toLowerCase());assert.equal(tx.value,BigInt(fixture.descriptor.payment.amountWei));
  report.payment={transactionHash:receipt.hash,amountWei:String(tx.value),payer:tx.from,blockNumber:receipt.blockNumber};
  mark('wait-for-live-bok-reply');
  await page.locator('#billboardFeed').getByText(/Bot reply/).waitFor({timeout:240000});
  const replyId=(await read('get_plugin_request',id))[2];assert.notEqual(BigInt(replyId),0n);
  const replyField=Fr.fromString(replyId.toString());
  const reply=unpackText((await read('get_post',replyField)).map(String),Number(await read('get_post_length',replyField)));
  assert(reply.includes('https://github.com/zac-williamson/aztec_experiments/pull/1'));assert(reply.includes('docs/bok-live-smoke.md'));
  assert.equal(await read('is_post_flagged',id),false);assert.equal(await read('is_post_flagged',replyField),false);
  const api=githubApi({token:process.env.GITHUB_TOKEN});const files=await api('GET','/repos/zac-williamson/aztec_experiments/pulls/1/files');assert(files.some(x=>x.filename==='docs/bok-live-smoke.md'));
  const charges=(await ledger()).filter(x=>!priorIds.has(x.id)&&x.type==='CHARGE');assert(charges.length>0);assert(charges.every(x=>x.modelId===expectedModel));
  const visible=await page.locator('#billboardFeed').innerText();assert(visible.includes(reply));
  report.reply={postId:replyField.toString(),text:reply,visible:true,flagged:false};report.veniceCharges=charges;
  await page.screenshot({path:path.join(directory,'browser-reply.png'),fullPage:true});report.passed=true;mark('passed');
 }catch(error){report.error='Wallet harness failed at '+report.stage+' ('+error.name+')';if(page)report.uiStatus=await page.locator('#setupStatus, #postStatus').allTextContents().catch(()=>[]);throw new Error(report.error);
 }finally{
  clearTimeout(deadline);signal?.removeEventListener('abort',cancel);
  try{await context?.close();}catch(error){report.passed=false;report.cleanupError=error.message;throw error;}
  finally{await fs.writeFile(path.join(directory,'browser-result.json'),JSON.stringify(report,null,2));}
 }
 return report;
}
