// Test-only wallet UI actions. The caller owns the context and its lifecycle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT} from './toolchain.mjs';
import {Interface,parseEther} from 'ethers';
export function assertMetaMaskTransaction({stage,request,account,chainId,tokenAddress,feePortalAddress,privateFeeAddress,boardPortalAddress,fundingAmount,collateralAmount}){
 assert(Array.isArray(request)&&request.length===1);const tx=request[0];
 assert.equal(BigInt(chainId),31337n);assert(tx.chainId===undefined||BigInt(tx.chainId)===31337n);
 assert.equal(tx.from?.toLowerCase(),account.toLowerCase());
 const methods={'fee-approval':'approve','fee-deposit':'depositToAztecPublic',deposit:'deposit',refund:'withdraw'};
 assert(Object.hasOwn(methods,stage));
 const iface=new Interface(['function approve(address,uint256)','function depositToAztecPublic(bytes32,uint256,bytes32)','function deposit(bytes32) payable','function withdraw(uint256,uint256,uint256,bytes32[])']);
 const parsed=iface.parseTransaction({data:tx.data});assert.equal(parsed?.name,methods[stage]);
 assert.equal(iface.encodeFunctionData(parsed.fragment,parsed.args).toLowerCase(),tx.data.toLowerCase());
 const target=stage==='fee-approval'?tokenAddress:stage==='fee-deposit'?feePortalAddress:boardPortalAddress;
 assert.equal(tx.to?.toLowerCase(),target.toLowerCase());
 assert.equal(BigInt(tx.value??0),stage==='deposit'?parseEther(collateralAmount):0n);
 if(stage==='fee-approval'||stage==='fee-deposit'){
  assert.equal(parsed.args[0].toLowerCase(),(stage==='fee-approval'?feePortalAddress:privateFeeAddress).toLowerCase());
  assert.equal(parsed.args[1],parseEther(fundingAmount));
  if(stage==='fee-deposit')assert.notEqual(BigInt(parsed.args[2]),0n);
 }
}
export const metamaskArchive='.build/metamask-13.49.0/metamask-chrome-13.49.0.zip';
export function unpackMetaMask(directory){
 const archive=path.join(ROOT,metamaskArchive);
 assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'7ba00bfe4fe8b0ffb27be1e8fc06506248f1b888cb4f2e5e5e8b1c37f461f262');
 const extension=path.join(directory,'extension');execFileSync('/usr/bin/unzip',['-q',archive,'-d',extension]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'))).version,'13.49.0.0');return extension;
}
export async function onboardMetaMask(context,mnemonic,password,extensionId,mark){
 for(const page of context.pages())if(page.url().startsWith('chrome-extension://'+extensionId+'/'))await page.close();
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
 mark('wallet-completion');
 // MetaMask opens its own wallet page at completion; reuse that surface rather
 // than loading another copy of the extension UI alongside onboarding.
 await onboarding.getByTestId('onboarding-complete-done').click();
 const deadline=Date.now()+10000;let walletPage;
 while(Date.now()<deadline&&!walletPage) {
  for(const page of context.pages()) {
   if(page!==onboarding&&page.url().startsWith('chrome-extension://'+extensionId+'/home.html')&&await page.getByTestId('account-menu-icon').isVisible()){walletPage=page;break;}
  }
  if(!walletPage)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(walletPage,'MetaMask did not expose its completed wallet page');
 walletPage.setDefaultTimeout(10000);
 for(const page of context.pages())if(page!==walletPage&&page.url().startsWith('chrome-extension://'+extensionId+'/'))await page.close();
 assert.equal(context.pages().filter(page=>page.url().startsWith('chrome-extension://'+extensionId+'/')).length,1);return walletPage;
}

export async function discoverTestMetaMask(page){
 await page.waitForFunction(()=>window.BillboardWalletProviders?.list().some(wallet=>wallet.name==='MetaMask'));
 await page.evaluate(()=>{globalThis.__testMetaMask=window.BillboardWalletProviders.list().find(wallet=>wallet.name==='MetaMask').provider;});
}

export async function addMetaMaskNetwork({page,walletPage,extensionId,rpcUrl,mark}){
 await page.evaluate(()=>{let changed;globalThis.__localNetworkReady=new Promise((resolve,reject)=>{changed=chain=>chain==='0x7a69'?resolve():reject(Error('Unexpected setup chain'));globalThis.__testMetaMask.on('chainChanged',changed);}).finally(()=>globalThis.__testMetaMask.removeListener('chainChanged',changed));});
 mark('add-network');await Promise.all([
  page.evaluate(()=>globalThis.__localNetworkReady),
  page.evaluate(rpcUrl=>globalThis.__testMetaMask.request({method:'wallet_addEthereumChain',params:[{chainId:'0x7a69',chainName:'Disposable board test',rpcUrls:[rpcUrl],nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18}}]}),rpcUrl).then(async()=>{assert.equal(await page.evaluate(()=>globalThis.__testMetaMask.request({method:'eth_chainId'})),'0x7a69');}),
  (async()=>{if(!walletPage.url().startsWith('chrome-extension://'+extensionId+'/sidepanel.html'))await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');mark('network-confirmation-page');await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();mark('network-name');await walletPage.getByText('Disposable board test',{exact:true}).first().waitFor();mark('network-approve');await walletPage.getByTestId('confirm-footer-button').click();})(),
 ]);
}

// Observe the real provider request unchanged. Only the explicit test hook can
// approve it; unexpected or overlapping transactions stop the test.
export async function observeMetaMaskTransactions(page){
 await page.evaluate(()=>{
  const original=globalThis.__testMetaMask.request.bind(globalThis.__testMetaMask);
  globalThis.__walletTestPending=null;globalThis.__walletTestFailure=null;
  globalThis.__testMetaMask.request=async request=>{
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
