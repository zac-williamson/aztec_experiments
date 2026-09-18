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
export function validateVerifiedBrowserStages(value){
 assert(value&&Object.keys(value).sort().join(',')==='schemaVersion,stages');
 assert(value.schemaVersion===1&&Array.isArray(value.stages)&&value.stages.length>=1&&value.stages.length<=4);
 const order=['claim','post','screen','exit'],seen=new Set();
 for(const [index,item] of value.stages.entries()){
  assert(item&&Object.keys(item).sort().join(',')==='blockHash,blockNumber,canonicalReceipt,normalNodeVerification,stage,txHash');
  assert(item.stage===order[index]&&typeof item.txHash==='string'&&typeof item.blockHash==='string'&&hash.test(item.txHash)&&hash.test(item.blockHash));
  assert(typeof item.blockNumber==='string'&&/^[1-9][0-9]{0,19}$/.test(item.blockNumber));
  assert(item.canonicalReceipt===true&&item.normalNodeVerification===true&&!seen.has(item.txHash));seen.add(item.txHash);
 }
 return {schemaVersion:1,stages:value.stages.map(item=>({...item}))};
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
export function safeJourneyDriverFailure(error,substage){
 const stages=new Set(['wait-deposit-page','fill-amount','click-deposit','await-deposit-claim','claim-checkpoint','post','screen','withdraw','refund']);
 const names=new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','AssertionError','TimeoutError','DOMException']);
 return {substage:stages.has(substage)?substage:'other',exceptionClass:names.has(error?.name)?error.name:'OtherError'};
}
// Self-contained for page.evaluate: only fixed booleans leave the page.
export function readJourneyUiDiagnostic(){
 const text=id=>globalThis.document.getElementById(id)?.textContent||'';
 const hasError=id=>!!globalThis.document.querySelector('#'+id+' .error');
 const deposit=text('depositStatus'),withdraw=text('withdrawStatus'),refund=text('claimL1Status');
 const milestones={depositStarted:deposit.includes('Making new L1 deposit'),claimSecretSaved:deposit.includes('Claim secret saved locally'),depositConfirmed:deposit.includes('Deposit confirmed'),waitingForClaim:deposit.includes('Waiting for L2 to ingest deposit'),claimComplete:deposit.includes('Deposit claimed on L2!'),withdrawalIncluded:withdraw.includes('L2->L1 message sent.'),refundSubmitted:refund.includes('L1 refund transaction:'),refundComplete:refund.includes('ETH claimed successfully!')};
 return {depositHasError:hasError('depositStatus'),withdrawHasError:hasError('withdrawStatus'),refundHasError:hasError('claimL1Status'),milestones};
}
// shared/helpers.js log() adds one localized timestamp, not part of the message.
export function normalizeT04StatusMessage(text){
 assert(typeof text==='string'&&text.length<=2048,'T04_STATUS_MESSAGE_INVALID');
 const prefix=text.match(/^\[([^\[\]\r\n]{1,40})\] /u);
 if(prefix&&/\p{N}/u.test(prefix[1]))return text.slice(prefix[0].length);
 return text;
}
export const T04_PENDING_CLAIM_MESSAGE='Your ETH deposit is confirmed. Its message is not yet available to claim; retry this same claim later. Do not deposit again.';
const navigationFailure='ERROR: operation did not complete; check configuration and recovery records';
export async function retryT04PendingClaim({outcome,retry,remaining}){
 let originalHash;
 for(let attempt=1;attempt<=3;attempt++){
  assert(remaining()>0,'T04_CLAIM_DEADLINE');
  const state=await outcome();
  if(state.success){assert.equal(state.errors.length,0);if(originalHash)assert.equal(state.depositHash,originalHash);return {claimAttempts:attempt,claimRetries:attempt-1};}
  assert(state.errors.includes(T04_PENDING_CLAIM_MESSAGE),'T04_CLAIM_UNEXPECTED_ERROR');
  assert(state.errors.every(message=>message===T04_PENDING_CLAIM_MESSAGE||message===navigationFailure),'T04_CLAIM_UNEXPECTED_ERROR');
  assert(state.existingVisible&&!state.newVisible&&state.pageVisible,'T04_CLAIM_STATE_CHANGED');
  assert(hash.test(state.depositHash),'T04_CLAIM_RECEIPT_MISSING');
  if(originalHash)assert.equal(state.depositHash,originalHash,'T04_CLAIM_RECEIPT_CHANGED');else originalHash=state.depositHash;
  assert.equal(state.transactionHashes.length,0,'T04_CLAIM_ALREADY_SUBMITTED');
  assert(attempt<3,'T04_CLAIM_PENDING_ATTEMPTS_EXHAUSTED');assert(remaining()>0,'T04_CLAIM_DEADLINE');
  await retry(state.depositHash);
 }
}
export async function driveT04BrowserJourney({page,directory,message,depositAmount,remaining,signal,mark,onSubstage=()=>{}}){
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
 onSubstage('wait-deposit-page');mark('gui-deposit-claim');await page.locator('#page-1').waitFor({state:'visible',timeout:remaining()});
 onSubstage('fill-amount');await page.locator('#depositAmount').fill(depositAmount);onSubstage('click-deposit');await page.locator('#navNext').click();
 onSubstage('await-deposit-claim');
 const claimProgress=await retryT04PendingClaim({remaining,outcome:async()=>{
  await page.waitForFunction(()=>{const box=document.getElementById('depositStatus');return box?.querySelector('.error')||box?.textContent.includes('Deposit claimed on L2!');},null,{timeout:remaining()});
  const status=await page.locator('#depositStatus').textContent();
  return {success:status.includes('Deposit claimed on L2!'),errors:(await page.locator('#depositStatus .error').allTextContents()).map(normalizeT04StatusMessage),depositHash:await page.locator('#existingTxHash').inputValue(),existingVisible:await page.locator('#recoverDepositSection').isVisible(),newVisible:await page.locator('#newDepositSection').isVisible(),pageVisible:await page.locator('#page-1').isVisible(),transactionHashes:transactionHashes(status)};
 },retry:async depositHash=>{
  await page.waitForFunction(()=>{const button=document.getElementById('navNext');return button&&!button.disabled&&button.getClientRects().length>0;},null,{timeout:remaining()});
  assert.equal(await page.locator('#existingTxHash').inputValue(),depositHash);
  assert(await page.locator('#recoverDepositSection').isVisible());assert(!(await page.locator('#newDepositSection').isVisible()));
  assert(await page.locator('#page-1').isVisible());assert.equal((await page.locator('#navNext').textContent()).trim(),'Claim deposit →');
  assert.equal(transactionHashes(await page.locator('#depositStatus').textContent()).length,0);
  await page.locator('#navNext').click();
 }});
 await page.locator('#postBtn').waitFor({state:'visible',timeout:remaining()});
 onSubstage('claim-checkpoint');await checkpoint('claim','depositStatus'); // parent verifies actual claim and releases eligible post anchor
 onSubstage('post');mark('actual-gui-post');await page.locator('#msgText').fill(message);await page.locator('#postBtn').click();
 await finish('postStatus','Message included. Public content and transaction timing remain observable.');
 await checkpoint('post','postStatus'); // parent waits for real moderation-window eligibility
 onSubstage('screen');mark('gui-screen');await page.locator('#dummyPostBtn').click();await finish('postStatus','Dummy post complete');
 await checkpoint('screen','postStatus'); // parent verifies latest note and eligible exit anchor
 onSubstage('withdraw');mark('gui-withdraw');await page.locator('#navNext').click();await page.locator('#page-3').waitFor({state:'visible',timeout:remaining()});
 await page.locator('#navNext').click();await page.locator('#page-4').waitFor({state:'visible',timeout:remaining()});
 await checkpoint('exit','withdrawStatus'); // mining must unwind; official actual-message settlement then release
 onSubstage('refund');mark('gui-refund');await page.locator('#navNext').click();
 await finish('claimL1Status','ETH claimed successfully!');
 await checkpoint('refund','claimL1Status');
 return {passed:true,stagesObserved,...claimProgress,warmNativePrivateFees:true,externalWalletExtension:false};
}
