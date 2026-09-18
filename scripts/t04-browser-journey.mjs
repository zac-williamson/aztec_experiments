// TEST ONLY. Real DOM actions; no application engine/prover/state replacement.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import '../shared/public-app-config.js';
const stages=new Set(['claim','post','screen','exit','refund']);
const hash=/^0x[0-9a-f]{64}$/;
export function validateBrowserControl(value){
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),['backupPassword','browserJourney','origin','rpcToken']);
 assert.equal(typeof value.browserJourney,'boolean');
 const origin=new URL(value.origin);assert(origin.protocol==='https:'&&origin.hostname==='127.0.0.1'&&origin.pathname==='/'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash);
 assert(typeof value.rpcToken==='string'&&/^[a-zA-Z0-9_-]{24,256}$/.test(value.rpcToken));
 assert(typeof value.backupPassword==='string'&&/^[a-zA-Z0-9_-]{24,256}$/.test(value.backupPassword));
 return value;
}
export function createBrowserHandoff(base,{directory,browserJourney=false,depositAmount}={}){
 const value={...base,...(browserJourney?{browserJourney:true,depositAmount}:{})};
 return validateBrowserHandoff(value,{directory,browserJourney});
}
export function validateBrowserHandoff(value,{directory,browserJourney}){
 assert(value&&typeof value==='object'&&!Array.isArray(value));assert.equal(typeof browserJourney,'boolean');assert(path.isAbsolute(directory));
 const keys=['nodeUrl','ethereumUrl','publicConfig','backupPath','ethereumAccount','message'];
 if(browserJourney)keys.push('browserJourney','depositAmount');
 assert.deepEqual(Object.keys(value).sort(),keys.sort());
 if(browserJourney){assert.equal(value.browserJourney,true);assert(typeof value.depositAmount==='string'&&/^(?:0|[1-9]\d*)\.\d{1,18}$/.test(value.depositAmount));assert(BigInt(value.depositAmount.replace('.',''))>0n);}
 assert.equal(value.backupPath,path.join(directory,'browser-wallet.encrypted.json'));
 for(const key of ['nodeUrl','ethereumUrl']){const u=new URL(value[key]);assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash);}
 assert(typeof value.ethereumAccount==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value.ethereumAccount));
 assert(typeof value.message==='string'&&value.message.isWellFormed()&&Buffer.byteLength(value.message)>0&&Buffer.byteLength(value.message)<=992&&!value.message.includes('\0'));
 globalThis.BillboardConfig.validate(value.publicConfig);
 return value;
}
export function validateJourneySignal(value){
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),['stage','transactionHashes']);
 assert(stages.has(value.stage));assert(Array.isArray(value.transactionHashes)&&value.transactionHashes.length>=1&&value.transactionHashes.length<=3);
 assert(value.transactionHashes.every(v=>typeof v==='string'&&hash.test(v)));
 assert.equal(new Set(value.transactionHashes).size,value.transactionHashes.length);
 return {stage:value.stage,transactionHashes:[...value.transactionHashes]};
}
export async function writeJourneySignal(directory,value){
 const checked=validateJourneySignal(value);assert(path.isAbsolute(directory));
 const target=path.join(directory,'browser-journey-'+checked.stage+'.json'),temporary=target+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temporary,JSON.stringify(checked),{mode:0o600,flag:'wx'});
 try{await fs.link(temporary,target);}finally{await fs.rm(temporary,{force:true});}
}
export async function waitJourneyRelease(directory,stage,remaining,signal){
 assert(stages.has(stage));assert(path.isAbsolute(directory));
 while(remaining()>0){
  if(signal?.aborted)throw Error('T04_RENDEZVOUS_ABORTED');
  try{
   const text=await fs.readFile(path.join(directory,'browser-journey-'+stage+'-verified.json'),'utf8');assert(Buffer.byteLength(text)<=1024);
   const value=JSON.parse(text);assert.deepEqual(value,{stage,verified:true});return;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 throw Error('T04_RENDEZVOUS_DEADLINE');
}
export function transactionHashes(text){
 assert.equal(typeof text,'string');
 return [...new Set([...text.matchAll(/(?:Transaction hash:|Tx hash:|L1 refund transaction:)\s*(0x[0-9a-fA-F]{64})/g)].map(match=>match[1].toLowerCase()))];
}
export async function driveT04BrowserJourney({page,directory,message,depositAmount,remaining,signal,mark}){
 assert(typeof depositAmount==='string'&&/^(?:0|[1-9]\d*)\.\d{1,18}$/.test(depositAmount));
 const stagesObserved=[];
 const checkpoint=async(stage,statusId)=>{
  const hashes=transactionHashes(await page.locator('#'+statusId).textContent());
  const stageSignal=validateJourneySignal({stage,transactionHashes:hashes});await writeJourneySignal(directory,stageSignal);
  await waitJourneyRelease(directory,stage,remaining,signal);stagesObserved.push(stageSignal);
 };
 const finish=async(statusId,predicate)=>{
  await page.waitForFunction(({statusId,predicate})=>{
   const box=document.getElementById(statusId);return box?.querySelector('.error')||box?.textContent.includes(predicate);
  },{statusId,predicate},{timeout:remaining()});
  assert.equal(await page.locator('#'+statusId+' .error').count(),0);
  assert((await page.locator('#'+statusId).textContent()).includes(predicate));
 };
 mark('gui-deposit-claim');await page.locator('#page-1').waitFor({state:'visible',timeout:remaining()});
 await page.locator('#depositAmount').fill(depositAmount);await page.locator('#navNext').click();
 await finish('depositStatus','Deposit claimed on L2!');await page.locator('#postBtn').waitFor({state:'visible',timeout:remaining()});
 await checkpoint('claim','depositStatus'); // parent verifies actual claim and releases eligible post anchor
 mark('actual-gui-post');await page.locator('#msgText').fill(message);await page.locator('#postBtn').click();
 await finish('postStatus','Message included. Public content and transaction timing remain observable.');
 await checkpoint('post','postStatus'); // parent waits for real moderation-window eligibility
 mark('gui-screen');await page.locator('#dummyPostBtn').click();await finish('postStatus','Dummy post complete');
 await checkpoint('screen','postStatus'); // parent verifies latest note and eligible exit anchor
 mark('gui-withdraw');await page.locator('#navNext').click();await page.locator('#page-3').waitFor({state:'visible',timeout:remaining()});
 await page.locator('#navNext').click();await page.locator('#page-4').waitFor({state:'visible',timeout:remaining()});
 await checkpoint('exit','withdrawStatus'); // mining must unwind; official actual-message settlement then release
 mark('gui-refund');await page.locator('#navNext').click();
 await finish('claimL1Status','ETH claimed successfully!');
 await checkpoint('refund','claimL1Status');
 return {passed:true,stagesObserved,warmNativePrivateFees:true,externalWalletExtension:false};
}
