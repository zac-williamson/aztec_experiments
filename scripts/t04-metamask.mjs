// Test-only wallet UI actions. The caller owns the context and its lifecycle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT} from './toolchain.mjs';
export const metamaskArchive='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';
export function unpackMetaMask(directory){
 const archive=path.join(ROOT,metamaskArchive);
 assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'7ba00bfe4fe8b0ffb27be1e8fc06506248f1b888cb4f2e5e5e8b1c37f461f262');
 const extension=path.join(directory,'extension');execFileSync('/usr/bin/unzip',['-q',archive,'-d',extension]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,'13.49.0.0');return extension;
}
export async function onboardMetaMask(context,mnemonic,password,extensionId,mark){
 const onboarding=await context.newPage();onboarding.setDefaultTimeout(10000);
 await onboarding.goto('chrome-extension://'+extensionId+'/home.html');
 mark('wallet-import-method');await onboarding.getByTestId('onboarding-import-wallet').click();
 await onboarding.getByRole('button',{name:'Import using Secret Recovery Phrase',exact:true}).click();
 mark('wallet-import');const words=mnemonic.split(' '),first=onboarding.getByTestId('srp-input-import__srp-note');
 await first.fill(words[0]);await first.press('Space');
 for(let i=1;i<words.length;i++){const input=onboarding.getByTestId('import-srp__srp-word-'+i);await input.fill(words[i]);if(i<words.length-1)await input.press('Space');}
 await onboarding.getByTestId('import-srp-confirm').click();
 mark('wallet-password');await onboarding.getByTestId('create-password-new-input').fill(password);await onboarding.getByTestId('create-password-confirm-input').fill(password);await onboarding.getByTestId('create-password-terms').click();await onboarding.getByTestId('create-password-submit').click();
 mark('wallet-passkey');await onboarding.getByTestId('passkey-maybe-later-button').click();
 mark('wallet-privacy');const analytics=onboarding.getByTestId('metametrics-checkbox');await analytics.waitFor();assert.equal(await analytics.getAttribute('data-checked'),'true');await analytics.click();assert.equal(await analytics.getAttribute('data-checked'),'false');assert.equal(await onboarding.getByTestId('metametrics-data-collection-checkbox').getAttribute('data-checked'),'false');await onboarding.getByTestId('metametrics-i-agree').click();
 mark('wallet-completion');await onboarding.getByTestId('onboarding-complete-done').click();await onboarding.locator('[data-testid=onboarding-complete-done][disabled]').waitFor();
 // Completion opens a side panel. Leave this tab alive while its awaited writes
 // finish; inspect the standard full-page wallet in a separate owned tab.
 const walletPage=await context.newPage();walletPage.setDefaultTimeout(10000);await walletPage.goto('chrome-extension://'+extensionId+'/home.html');await walletPage.getByTestId('account-menu-icon').waitFor();return walletPage;
}

export async function addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl,mark}){
 await page.evaluate(()=>{let changed;globalThis.__localNetworkReady=new Promise((resolve,reject)=>{changed=chain=>chain==='0x7a69'?resolve():reject(Error('Unexpected setup chain'));window.ethereum.on('chainChanged',changed);}).finally(()=>window.ethereum.removeListener('chainChanged',changed));});
 mark('add-network');await Promise.all([
  page.evaluate(()=>globalThis.__localNetworkReady),
  page.evaluate(rpcUrl=>window.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a69',chainName:'Disposable board test',rpcUrls:[rpcUrl],nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}}]}),rpcUrl).then(async()=>{assert.equal(await page.evaluate(()=>window.ethereum.request({method:'eth_chainId'})),'0x7a69');}),
  (async()=>{await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');mark('network-confirmation-page');await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();mark('network-name');await walletPage.getByText('Disposable board test',{exact:true}).first().waitFor();mark('network-approve');await walletPage.getByTestId('confirm-footer-button').click();})(),
 ]);
}

// Observe the real provider request unchanged. Only the explicit test hook can
// approve it; unexpected or overlapping transactions stop the test.
export async function observeMetaMaskTransactions(page){
 await page.evaluate(()=>{
  const original=window.ethereum.request.bind(window.ethereum);
  globalThis.__walletTestPending=null;globalThis.__walletTestFailure=null;
  window.ethereum.request=async request=>{
   if(request.method!=='eth_sendTransaction')return original(request);
   if(globalThis.__walletTestPending)throw Error('Overlapping wallet transaction');
   globalThis.__walletTestPending=structuredClone(request.params);
   try{return await original(request);}catch(error){
    const nested=error?.data?.originalError??error;const message=String(nested?.message??'');
    globalThis.__walletTestFailure={code:Number.isSafeInteger(nested?.code)?nested.code:null,nonceTooLow:/nonce too low/i.test(message),replacement:/replacement.*underpriced/i.test(message),insufficientFunds:/insufficient funds/i.test(message),transport:/fetch|network|connection/i.test(message)};throw error;
   }finally{globalThis.__walletTestPending=null;}
  };
 });
}

export function guardBrowserRequest(route,{origin,extensionWallet,onBlocked}){
 const request=route.request(),worker=request.serviceWorker(),frame=worker?null:request.frame(),url=new URL(request.url());
 if(extensionWallet&&(worker?worker.url().startsWith('chrome-extension:'):frame.url().startsWith('chrome-extension:')))return route.continue();
 if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){
  const owner=extensionWallet&&frame?.page().url().startsWith('chrome-extension:')?'extension':'application';
  onBlocked({owner,hostname:url.hostname,resource:request.resourceType(),navigation:request.isNavigationRequest()});
  return route.abort();
 }
 return route.continue();
}
