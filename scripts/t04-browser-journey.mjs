// TEST ONLY. Real DOM actions; no application engine/prover/state replacement.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import '../shared/public-app-config.js';
const stages=new Set(['fee-deposit','fee-claim','claim','post','screen','exit','refund','warm-post']);
const hash=/^0x[0-9a-f]{64}$/;
export function validateBrowserControl(value){
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),['backupPassword','browserEngine','browserMode','origin','rpcToken']);
 assert(['post','lifecycle','recovery','withdraw-recovery','funding','performance'].includes(value.browserMode));
 assert(['chromium','chrome','firefox','webkit'].includes(value.browserEngine));
 assert(!['recovery','withdraw-recovery'].includes(value.browserMode)||value.browserEngine==='chromium');
 const origin=new URL(value.origin);assert(origin.protocol==='https:'&&origin.hostname==='127.0.0.1'&&origin.pathname==='/'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash);
 assert(typeof value.rpcToken==='string'&&/^[a-zA-Z0-9_-]{24,256}$/.test(value.rpcToken));
 assert(typeof value.backupPassword==='string'&&/^[a-zA-Z0-9_-]{24,256}$/.test(value.backupPassword));
 return value;
}
// Shared parent-worker validator: exercise the actual producer/consumer boundary.
export function validateBrowserWorkerControl(value,{directory}){
 const controlKeys=['backupPassword','browserEngine','browserMode','origin','rpcToken'];
 assert(value&&typeof value==='object'&&!Array.isArray(value));
 validateBrowserControl(Object.fromEntries(controlKeys.map(key=>[key,value[key]])));
 const handoffKeys=['nodeUrl','ethereumUrl','publicConfig','backupPath','ethereumAccount','message',...(['lifecycle','funding'].includes(value.browserMode)?['depositAmount']:[]),...(value.browserMode==='funding'?['fundingAmount']:[])];
 assert.deepEqual(Object.keys(value).sort(),[...new Set([...handoffKeys,...controlKeys,'timeoutMs'])].sort());
 validateBrowserHandoff(Object.fromEntries(handoffKeys.map(key=>[key,value[key]])),{directory,browserMode:value.browserMode});
 assert(Number.isSafeInteger(value.timeoutMs)&&value.timeoutMs>0&&value.timeoutMs<=480000);
 return value;
}
export function createBrowserHandoff(base,{directory,browserMode,depositAmount,fundingAmount}={}){
 const value={...base,...(['lifecycle','funding'].includes(browserMode)?{depositAmount}:{}),...(browserMode==='funding'?{fundingAmount}:{})};
 return validateBrowserHandoff(value,{directory,browserMode});
}
export function validateBrowserHandoff(value,{directory,browserMode}){
 assert(value&&typeof value==='object'&&!Array.isArray(value));assert(['post','lifecycle','recovery','withdraw-recovery','funding','performance'].includes(browserMode));assert(path.isAbsolute(directory));
 const keys=['nodeUrl','ethereumUrl','publicConfig','backupPath','ethereumAccount','message'];
 const amounts=['lifecycle','funding'].includes(browserMode)?['depositAmount']:[];if(browserMode==='funding')amounts.push('fundingAmount');
 keys.push(...amounts);assert.deepEqual(Object.keys(value).sort(),keys.sort());
 for(const key of amounts){assert(typeof value[key]==='string'&&/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value[key]));assert(BigInt(value[key].replace('.',''))>0n);}
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
 const stages=new Set(['fee-deposit','fee-claim','open-board','wait-deposit-page','fill-amount','click-deposit','await-deposit-claim','claim-checkpoint','post','screen','withdraw','refund']);
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
export async function driveT04BrowserJourney({page,directory,message,depositAmount,remaining,signal,mark,onSubstage=()=>{}}){
 assert(typeof depositAmount==='string'&&/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(depositAmount));
 const stagesObserved=[];
 const checkpoint=async(stage,statusId)=>stagesObserved.push(await checkpointBrowserStage(directory,stage,transactionHashes(await page.locator('#'+statusId).textContent()),remaining,signal));
 const finish=(statusId,predicate)=>finishBrowserStatus(page,statusId,predicate,remaining);
 stagesObserved.push(...await driveT04BrowserPublication({page,directory,message,depositAmount,remaining,signal,mark,onSubstage}));
 onSubstage('screen');mark('gui-screen');await page.locator('#dummyPostBtn').click();await finish('postStatus','Dummy post complete');
 await checkpoint('screen','postStatus'); // parent verifies latest note and eligible exit anchor
 onSubstage('withdraw');mark('gui-withdraw');await page.locator('#navNext').click();await page.locator('#page-3').waitFor({state:'visible',timeout:remaining()});
 await page.locator('#navNext').click();await page.locator('#page-4').waitFor({state:'visible',timeout:remaining()});
 await checkpoint('exit','withdrawStatus'); // mining must unwind; official actual-message settlement then release
 onSubstage('refund');mark('gui-refund');await page.locator('#navNext').click();
 await finish('claimL1Status','ETH claimed successfully!');
 await checkpoint('refund','claimL1Status');
 return {passed:true,stagesObserved,warmNativePrivateFees:true,externalWalletExtension:false};
}

export async function driveT04BrowserPublication({page,directory,message,depositAmount,remaining,signal,mark,onSubstage=()=>{}}){
 assert(typeof depositAmount==='string'&&/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(depositAmount));
 const stagesObserved=[];
 const checkpoint=async(stage,statusId)=>stagesObserved.push(await checkpointBrowserStage(directory,stage,transactionHashes(await page.locator('#'+statusId).textContent()),remaining,signal));
 const finish=(statusId,predicate)=>finishBrowserStatus(page,statusId,predicate,remaining);
 onSubstage('wait-deposit-page');mark('gui-deposit-claim');await page.locator('#page-1').waitFor({state:'visible',timeout:remaining()});
 onSubstage('fill-amount');await page.locator('#depositAmount').fill(depositAmount);onSubstage('click-deposit');await page.locator('#navNext').click();
 onSubstage('await-deposit-claim');
 await finish('depositStatus','Deposit claimed on L2!');
 await page.locator('#postBtn').waitFor({state:'visible',timeout:remaining()});
 onSubstage('claim-checkpoint');await checkpoint('claim','depositStatus'); // parent verifies actual claim and releases eligible post anchor
 onSubstage('post');mark('actual-gui-post');await page.locator('#msgText').fill(message);await page.locator('#postBtn').click();
 await finish('postStatus','Message included. Public content and transaction timing remain observable.');
 await checkpoint('post','postStatus'); // parent waits for real moderation-window eligibility
 return stagesObserved;
}

export async function finishBrowserStatus(page,statusId,predicate,remaining){
 await page.waitForFunction(({statusId,predicate})=>{
  const box=document.getElementById(statusId);return box?.querySelector('.error')||box?.textContent.includes(predicate);
 },{statusId,predicate},{timeout:remaining()});
 assert.equal(await page.locator('#'+statusId+' .error').count(),0);
 assert((await page.locator('#'+statusId).textContent()).includes(predicate));
}
export async function checkpointBrowserStage(directory,stage,hashes,remaining,signal){
 const record=validateJourneySignal({stage,transactionHashes:hashes});
 await writeJourneySignal(directory,record);await waitJourneyRelease(directory,stage,remaining,signal);return record;
}
