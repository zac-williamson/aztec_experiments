// TEST ONLY. Real fee-page controls followed by a paid board publication.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
import {transactionHashes,driveT04BrowserPublication,finishBrowserStatus,checkpointBrowserStage} from './t04-browser-journey.mjs';

export async function driveT04BrowserFunding({page,directory,message,depositAmount,fundingAmount,
  backupPath,backupPassword,remaining,signal,mark,onSubstage,confirmEthereum,onBoardOpened}) {
 const finish=(id,text)=>finishBrowserStatus(page,id,text,remaining);
 const checkpoint=(stage,hashes)=>checkpointBrowserStage(directory,stage,hashes,remaining,signal);
 await page.waitForFunction(()=>document.getElementById('setupStatus')?.textContent.includes('Wallet ready. Deposits fund the shared private fee contract.')||document.querySelector('#setupStatus .error'),{},{timeout:remaining()});
 assert.equal(await page.locator('#setupStatus .error').count(),0);
 assert(await page.evaluate(()=>!!walletState.aztec?.address&&!!walletState.ethSigner&&!!walletState.ethAccount&&!walletState.invalidated));
 const publicConfig=await page.evaluate(()=>JSON.stringify(globalThis.billboardConfigStore.snapshot().config));
 assert(publicConfig&&publicConfig!=='null');
 onSubstage('fee-deposit');mark('gui-fee-deposit');
 await page.locator('#amount').fill(fundingAmount);await page.locator('#depositBtn').click();
 if(confirmEthereum){await confirmEthereum('fee-approval');await confirmEthereum('fee-deposit');}
 await finish('depositStatus','Deposit recorded. Download the recovery file');
 const record=await page.evaluate(()=>{
  const key=localStorage.getItem('billboard-private-fee-recovery-latest');
  const value=key?JSON.parse(localStorage.getItem(key)):null;
  const fields=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
  if(!value||value.schema!=='private-fee-funding-v1'||Object.keys(value).length!==fields.length||
   !fields.every(field=>typeof value[field]==='string'))throw Error('Invalid public funding record');
  return Object.fromEntries(fields.map(field=>[field,value[field]]));
 });
 const fields=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
 assert(record&&record.schema==='private-fee-funding-v1');
 assert.deepEqual(Object.keys(record).sort(),fields.sort());
 assert(fields.every(key=>typeof record[key]==='string'));
 await fs.writeFile(path.join(directory,'browser-fee-record.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
 await checkpoint('fee-deposit',[record.txHash]);
 onSubstage('fee-claim');mark('gui-fee-claim');await page.locator('#claimBtn').click();
 await finish('claimStatus','Private balance funded. You can now return to the message board.');
 await checkpoint('fee-claim',transactionHashes(await page.locator('#claimStatus').textContent()));
 onSubstage('open-board');mark('gui-funded-board');
 const boardUrl=new URL(page.url());boardUrl.pathname='/user.html';await page.goto(boardUrl.toString());
 await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&document.getElementById('wbAztecFile'),{},{timeout:remaining()});
 await page.evaluate(installBrowserErrorObserver);
 if(onBoardOpened)await onBoardOpened();
 assert.equal(await page.evaluate(()=>JSON.stringify(globalThis.billboardConfigStore.snapshot().config)),publicConfig);
 await page.locator('#wbAccountMenu > summary').click();
 await page.locator('#wbPassword').fill(backupPassword);await page.locator('#wbAztecFile').setInputFiles(backupPath);
 await page.waitForFunction(()=>!!globalThis.walletState?.aztec?.address||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()});
 assert(await page.evaluate(()=>!!globalThis.walletState?.aztec?.address));
 await page.locator('#wbAccountMenu > summary').click();
 await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:confirmEthereum?'MetaMask':'Browser wallet (legacy)',exact:true}).click();
 await page.locator('#page-1').waitFor({state:'visible',timeout:remaining()});
 await driveT04BrowserPublication({page,directory,message,depositAmount,remaining,signal,mark,onSubstage,confirmEthereum,onBoardOpened});
 return {passed:true,coldBrowserFeeFunding:true,paidBoardClaimAndPost:true,externalWalletExtension:!!confirmEthereum};
}
