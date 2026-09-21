// TEST ONLY. Actual UI recovery after a genuine accepted send loses its response.
// Caller owns persistent-profile/browser processes, RPC fault hook and canonical verification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const acceptedName='browser-post-response-accepted.json';
const safeError=()=>Error('T04_BROWSER_RECOVERY_FAILED');
export function validateT04PostAcceptance(value){
 assert(value&&Object.keys(value).sort().join(',')==='accepted,acceptedAtMs,requestStartedAtMs,schemaVersion,sendCalls,transactionHash');
 assert(Number.isSafeInteger(value.requestStartedAtMs)&&value.requestStartedAtMs>0&&Number.isSafeInteger(value.acceptedAtMs)&&value.acceptedAtMs>=value.requestStartedAtMs);
 assert(value.schemaVersion===1&&value.accepted===true&&value.sendCalls===1&&/^0x[0-9a-f]{64}$/.test(value.transactionHash));
 return {...value};
}
export async function verifyT04IdentityOnlyBackup(backupPath,password){
 const stat=await fs.stat(backupPath);assert(stat.isFile()&&stat.size<=32*1024*1024+4096);
 const ctx=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});
 vm.runInContext(await fs.readFile(new URL('../shared/wallet-backup.js',import.meta.url),'utf8'),ctx);
 const payload=await ctx.BillboardWalletBackup.decrypt(JSON.parse(await fs.readFile(backupPath,'utf8')),password);
 // Reimport the same identity/immutable claims only; never restore old journal records.
 assert(payload.schemaVersion===1&&!Object.hasOwn(payload,'journals'),'Recovery fixture must use schema-v1 backup without journals');
 return {schemaVersion:1,journalsImported:false};
}
export async function runT04BrowserPostRecovery({page,directory,remaining,signal,restart,backupPath,backupPassword,message,action='post'}){
 assert(['post','withdraw'].includes(action));
 assert(path.isAbsolute(directory)&&path.isAbsolute(backupPath)&&typeof remaining==='function'&&typeof restart==='function');
 const acceptancePath=path.join(directory,acceptedName),origin=new URL(page.url()).origin;
 let abort;
 const aborted=new Promise((_,reject)=>{abort=()=>reject(safeError());signal?.addEventListener('abort',abort,{once:true});});
 // Every asynchronous step shares caller's remaining overall deadline.
 async function bounded(fn){if(signal?.aborted)throw safeError();const left=remaining();if(!Number.isFinite(left)||left<=0)throw safeError();let timer;try{return await Promise.race([Promise.resolve().then(fn),aborted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(safeError()),left);})]);}finally{clearTimeout(timer);}}
 try{
  await bounded(()=>verifyT04IdentityOnlyBackup(backupPath,backupPassword));
  await assert.rejects(fs.access(acceptancePath),{code:'ENOENT'});
  if(action==='post'){
   await bounded(()=>page.locator('#msgText').fill(message));
   await bounded(()=>page.locator('#postBtn').click());
  }else{
   await bounded(()=>page.locator('#navNext').click());
   await bounded(()=>page.locator('#page-3').waitFor({state:'visible',timeout:remaining()}));
   await bounded(()=>page.locator('#navNext').click());
  }
  let accepted;
  for(;;){
   accepted=await bounded(async()=>{try{const stat=await fs.stat(acceptancePath);assert(stat.isFile()&&stat.size<=1024);return validateT04PostAcceptance(JSON.parse(await fs.readFile(acceptancePath,'utf8')));}catch(error){if(error.code==='ENOENT')return undefined;throw error;}});
   if(accepted)break;
   await bounded(()=>new Promise(resolve=>setTimeout(resolve,25)));
  }
  // This must physically close the browser before the app's20-second submit
  // timeout can start in-process reconciliation. Caller reports process closure.
  const fresh=await bounded(()=>restart({page,signal,remaining,acceptedTransactionHash:accepted.transactionHash}));
  assert(page.isClosed()&&fresh?.page&&fresh.page!==page&&fresh.previousBrowserClosed===true&&fresh.samePersistentProfile===true);
  assert(Number.isSafeInteger(fresh.closedAtMs)&&fresh.closedAtMs>=accepted.acceptedAtMs&&fresh.closedAtMs-accepted.requestStartedAtMs<15000,'Browser closure must precede normal submission timeout');
  page=fresh.page;assert.equal(new URL(page.url()).origin,origin);
  await bounded(()=>page.locator('#wbAccountMenu > summary').click());
  await bounded(()=>page.locator('#wbPassword').fill(backupPassword));
  await bounded(()=>page.locator('#wbAztecFile').setInputFiles(backupPath));
  await bounded(()=>page.waitForFunction(()=>!!globalThis.walletState?.aztec?.address||!!document.querySelector('#setupStatus .error'),{},{timeout:remaining()}));
  assert(await bounded(()=>page.evaluate(()=>!!globalThis.walletState?.aztec?.address)));
  await bounded(()=>page.locator('#wbAccountMenu > summary').click());
  // No ETH connection: it would auto-navigate away from the recovery controls.
  const button=page.getByRole('button',{name:'Recover saved Aztec transaction',exact:true});
  assert(await bounded(()=>button.isVisible()));await bounded(()=>button.click());
  await bounded(()=>page.waitForFunction(({hash,expectedPage})=>{const text=document.getElementById('setupStatus')?.textContent||'';return (text.includes('Saved transaction succeeded. Hash: '+hash)&&document.getElementById(expectedPage)?.classList.contains('active'))||!!document.querySelector('#setupStatus .error');},{hash:accepted.transactionHash,expectedPage:action==='post'?'page-2':'page-4'},{timeout:remaining()}));
  const status=await bounded(()=>page.locator('#setupStatus').textContent());
  assert(status.includes('Saved transaction succeeded. Hash: '+accepted.transactionHash));
  assert(!await bounded(()=>page.locator('#setupStatus .error').count()));
  if(action==='withdraw'){
   // Reconnect only after recovering the original L2 transaction. The app then
   // discovers outstanding escrow; never click the refund submission button.
   await bounded(()=>page.getByRole('button',{name:'Connect Ethereum wallet',exact:true}).click());
   await bounded(()=>page.locator('#page-0').waitFor({state:'visible',timeout:remaining()}));
   await bounded(()=>page.locator('#wbEthBrowserBtn').click());
   await bounded(()=>page.locator('#page-4').waitFor({state:'visible',timeout:remaining()}));
  }
  const result={passed:true,action,ethereumRefundPending:action==='withdraw',transactionHash:accepted.transactionHash,fullBrowserRestart:true,samePersistentProfile:true,journalsImported:false,recoveryControl:'Recover saved Aztec transaction',closureAfterAcceptanceMs:fresh.closedAtMs-accepted.acceptedAtMs,closureAfterRequestMs:fresh.closedAtMs-accepted.requestStartedAtMs,scope:'Actual UI accepted-transaction recovery; parent must verify original canonical effects, one accepted transaction, no restart submission and one fee debit. Submission capture does not count discarded or unsubmitted proofs'};
  Object.defineProperty(result,'page',{value:page,enumerable:false});return result;
 }catch{throw safeError();}
 finally{signal?.removeEventListener('abort',abort);}
}
