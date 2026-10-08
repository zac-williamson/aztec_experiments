// TEST ONLY. One board Deposit click funds fees, claims collateral, then enables posting.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {driveT04BrowserPublication,checkpointBrowserStage} from './t04-browser-journey.mjs';

export async function driveT04BrowserFunding({page,directory,message,depositAmount,
  remaining,signal,mark,onSubstage,confirmEthereum}) {
 assert.equal(typeof confirmEthereum,'function','Cold onboarding qualification requires real MetaMask');
 const completeFunding=async stage=>{
  assert.equal(stage,'deposit');
  onSubstage('fee-deposit');mark('gui-automatic-fee-deposit');
  if(confirmEthereum){await confirmEthereum('fee-approval');await confirmEthereum('fee-deposit');}
  await page.waitForFunction(()=>{
   const key=localStorage.getItem('billboard-private-fee-recovery-latest');
   const record=key?JSON.parse(localStorage.getItem(key)):null;
   return typeof record?.leafIndex==='string'||!!document.querySelector('#depositStatus .error');
  },{},{timeout:remaining()});
  assert.equal(await page.locator('#depositStatus .error').count(),0);
  // Observe public funding provenance only. The application's coordinator owns
  // funding, bridge waiting and the combined claim; the driver never calls it.
  const record=await page.evaluate(()=>{
   const key=localStorage.getItem('billboard-private-fee-recovery-latest');
   return key?JSON.parse(localStorage.getItem(key)):null;
  });
  const fields=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
  assert(record&&record.schema==='private-fee-funding-v1');
  assert.deepEqual(Object.keys(record).sort(),fields.sort());
  assert(fields.every(key=>typeof record[key]==='string'));
  await fs.writeFile(path.join(directory,'browser-fee-record.json'),JSON.stringify(record),{flag:'wx',mode:0o600});
  await checkpointBrowserStage(directory,'fee-deposit',[record.txHash],remaining,signal);
  if(confirmEthereum)await confirmEthereum('deposit');
 };
 const stagesObserved=await driveT04BrowserPublication({page,directory,message,depositAmount,remaining,signal,mark,onSubstage,confirmEthereum:completeFunding});
 return {passed:true,coldBrowserFeeFunding:true,singleDepositClick:true,automaticCombinedClaim:true,paidBoardClaimAndPost:true,stagesObserved,externalWalletExtension:!!confirmEthereum};
}
