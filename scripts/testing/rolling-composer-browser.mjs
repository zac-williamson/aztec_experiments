// TEST ONLY. Drives the production DOM, custody import and browser PXE. Expected
// names are private assertion inputs only; no application/runtime replacement.
// Parent owns deployment/assets, real funding/name proofs, canonical accounting,
// exact permitted origins, remaining deadline and supervised browser process tree.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const invalid=()=>Error('Invalid private composer browser control.');
const stages=['validation','launch','public-reader','unlock-a','import-a','choices-a','prepare-992','cancel-992','reject-996','literal-preview','lock-a','reload','unlock-b','import-b','choices-b','complete'];
const data=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;};
function exact(o,keys){if(!o||![Object.prototype,null].includes(Object.getPrototypeOf(o))||Object.keys(o).sort().join(',')!==[...keys].sort().join(','))throw invalid();}
function origin(value){if(typeof value!=='string'||value.length>100)throw invalid();const u=new URL(value);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.origin!==value)throw invalid();return value;}
function names(value){
 if(!Array.isArray(value)||value.length!==2)throw invalid();
 return [0,1].map(i=>{const r=data(value,String(i));exact(r,['id','first','last']);const id=data(r,'id'),first=data(r,'first'),last=data(r,'last');
  if(typeof id!=='string'||!/^0x[0-9a-f]{64}$/.test(id)||BigInt(id)===0n||BigInt(id)>=21888242871839275222246405745257275088548364400416034343698204186575808495617n||[first,last].some(v=>typeof v!=='string'||v.length<1||v.length>32||!/^[A-Za-z](?:[A-Za-z '-]*[A-Za-z])?$/.test(v)))throw invalid();
  return Object.freeze({id,first,last});});
}
export async function validateRollingBrowserBackup(file,directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory)throw invalid();
 const parent=await fs.lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw invalid();
 if(typeof file!=='string'||file.length>4096||path.dirname(file)!==directory||path.resolve(file)!==file||!file.endsWith('.json'))throw invalid();
 const initial=await fs.lstat(file);if(!initial.isFile()||initial.isSymbolicLink()||initial.uid!==process.getuid()||(initial.mode&0o777)!==0o600||initial.size<1||initial.size>32*1024*1024+4096||await fs.realpath(file)!==file)throw invalid();
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const stat=await handle.stat();if(stat.ino!==initial.ino||stat.dev!==initial.dev||stat.size!==initial.size||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o600)throw invalid();
  const envelope=JSON.parse(await handle.readFile('utf8'));exact(envelope,['schemaVersion','kind','kdf','iterations','salt','iv','ciphertext']);
  if(envelope.schemaVersion!==1||envelope.kind!=='aztec-billboard-encrypted-wallet'||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==600000||typeof envelope.salt!=='string'||!/^[0-9a-f]{32}$/.test(envelope.salt)||typeof envelope.iv!=='string'||!/^[0-9a-f]{24}$/.test(envelope.iv)||typeof envelope.ciphertext!=='string'||!/^(?:[0-9a-f]{2}){16,}$/.test(envelope.ciphertext))throw invalid();
 }finally{await handle.close();}
 return file;
}
/** Async filesystem validation. Capture every control primitive before awaiting;
 * parent keeps the validated private files immutable until the worker exits. */
export async function validateRollingComposerControl(control,{directory}={}){
 try{
  exact(control,['browserMode','browserEngine','origin','trustedOrigin','ethereumOrigin','backupPaths','backupPassword','expectedNames','timeoutMs']);
  if(data(control,'browserMode')!=='rolling-composer'||data(control,'browserEngine')!=='chromium')throw invalid();
  const selected={browserMode:'rolling-composer',browserEngine:'chromium',origin:origin(data(control,'origin')),trustedOrigin:origin(data(control,'trustedOrigin')),ethereumOrigin:origin(data(control,'ethereumOrigin'))};
  if(new Set([selected.origin,selected.trustedOrigin,selected.ethereumOrigin]).size!==3)throw invalid();
  const files=data(control,'backupPaths'),expected=data(control,'expectedNames');exact(files,['a','b']);exact(expected,['a','b']);
  selected.backupPaths={a:data(files,'a'),b:data(files,'b')};selected.expectedNames={a:names(data(expected,'a')),b:names(data(expected,'b'))};
  const all=[...selected.expectedNames.a,...selected.expectedNames.b];if(new Set(all.map(x=>x.id)).size!==4||new Set(all.map(x=>(x.first+' '+x.last).toLowerCase())).size!==4)throw invalid();
  selected.backupPassword=data(control,'backupPassword');selected.timeoutMs=data(control,'timeoutMs');
  if(typeof selected.backupPassword!=='string'||selected.backupPassword.length<12||selected.backupPassword.length>256||!Number.isSafeInteger(selected.timeoutMs)||selected.timeoutMs<1||selected.timeoutMs>120000)throw invalid();
  if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||selected.backupPaths.a===selected.backupPaths.b)throw invalid();
  const stat=await fs.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid()||(stat.mode&0o777)!==0o700||await fs.realpath(directory)!==directory)throw invalid();
  for(const role of ['a','b'])await validateRollingBrowserBackup(selected.backupPaths[role],directory);
  for(const role of ['a','b'])Object.freeze(selected.expectedNames[role]);Object.freeze(selected.expectedNames);Object.freeze(selected.backupPaths);return Object.freeze(selected);
 }catch{throw invalid();}
}

// Exact production wallet-panel alert copies, never arbitrary DOM/error text.
// Poll a single awaited loop: no detached Playwright wait survives a terminal
// result. Parent supplies its existing absolute deadline; no new time allowance.
export async function waitForRollingComposerState({dialog,ready,remaining}){
 const alerts=[
  ['connection-unavailable','The private connection is unavailable. Your encrypted recovery is preserved. Reconnect when the service returns.'],
  ['operation-failed','This operation could not be completed. Recovery records were preserved. Check the existing transaction before preparing another.'],
 ];
 while(true){
  let ms;try{ms=remaining();}catch{return 'deadline';}
  if(!Number.isFinite(ms)||ms<=0)return 'deadline';
  try{
   // work() clears the old error internally but rerenders only when it ends.
   // Do not confuse a previous rendered alert during busy work with its outcome.
   if(await dialog.getAttribute('aria-busy')==='false'){
    for(const [status,text]of alerts){
     if(await dialog.getByRole('alert').and(dialog.getByText(text,{exact:true})).isVisible())return status;
    }
    if(await ready.isVisible()){
     try{if(remaining()<=0)return 'deadline';}catch{return 'deadline';}
     return 'ready';
    }
   }
  }catch{return 'observation-failed';}
  try{ms=remaining();}catch{return 'deadline';}
  if(!Number.isFinite(ms)||ms<=0)return 'deadline';
  await delay(Math.min(50,ms));
 }
}

export async function runRollingComposerBrowser(input){
 const started=Date.now();let stage='validation',browser,context,page,timer,expired=false,selected;
 const result={schemaVersion:1,passed:false,diagnostic:null,scope:'Production browser custody/PXE/composer boundary; no browser publication or extension-funding acceptance',
  checks:{publicBeforeUnlock:false,ownedChoicesA:false,ownedChoicesB:false,exact992Prepared:false,preparedCancelled:false,oversizeRetained:false,literalPreview:false,accountSwitch:false,collateralPendingB:false},
  traffic:{walletAssets:0,privateRequests:0,proofSubmits:0,nodeSubmissions:0,l1Submissions:0,blockedRequests:0,inspectionErrors:0},cleanup:{contextClosed:false,browserClosed:false}};
 const fail=()=>{throw Error('Composer browser check failed.');};
 try{
  const {directory,onStage=()=>{},...control}=input;if(typeof onStage!=='function')fail();
  selected=await validateRollingComposerControl(control,{directory});
  const remaining=()=>{const ms=selected.timeoutMs-(Date.now()-started);if(ms<=0||expired)fail();return ms;};
  const mark=value=>{assert(stages.includes(value));stage=value;onStage('rolling-composer-'+value);remaining();};
  const {chromium}=await import('playwright');mark('launch');
  timer=setTimeout(()=>{expired=true;void context?.close().catch(()=>{});void browser?.close().catch(()=>{});},remaining());
  browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=256'],timeout:remaining()});
  context=await browser.newContext({serviceWorkers:'block'});
  // Three exact parent-authorized local origins only. Inspect request metadata
  // and submission methods, never retain request bodies, errors or URLs.
  await context.route('**/*',async route=>{
   const request=route.request();let allowed=false;
   try{
    const u=new URL(request.url());allowed=[selected.origin,selected.trustedOrigin,selected.ethereumOrigin].includes(u.origin)&&!u.username&&!u.password;
    if(!allowed){result.traffic.blockedRequests++;await route.abort();return;}
    if(u.origin===selected.origin&&u.pathname.startsWith('/wallet/'))result.traffic.walletAssets++;
    if(u.origin===selected.trustedOrigin||u.origin===selected.ethereumOrigin){
     result.traffic.privateRequests++;
     if(u.origin===selected.trustedOrigin&&u.pathname==='/v1/jobs'&&request.method()==='POST')result.traffic.proofSubmits++;
     if(request.method()==='POST'&&!(u.origin===selected.trustedOrigin&&u.pathname==='/v1/jobs')){
      const body=request.postData();if(typeof body!=='string'||Buffer.byteLength(body)>8*1024*1024)fail();
      const parsed=JSON.parse(body),batch=Array.isArray(parsed)?parsed:[parsed];if(batch.length<1||batch.length>100)fail();
      for(const rpc of batch){if(!rpc||typeof rpc.method!=='string')fail();if(/^(?:node|aztec)_sendTx$/.test(rpc.method))result.traffic.nodeSubmissions++;if(['eth_sendTransaction','eth_sendRawTransaction','wallet_sendCalls'].includes(rpc.method))result.traffic.l1Submissions++;}
     }
    }
    await route.continue();
   }catch{result.traffic.inspectionErrors++;await route.abort().catch(()=>{});}
  });
  page=await context.newPage();page.setDefaultTimeout(remaining());
  mark('public-reader');await page.goto(selected.origin,{waitUntil:'networkidle',timeout:remaining()});
  await page.getByRole('button',{name:'Your account',exact:true}).click({timeout:remaining()});
  const dialog=page.getByRole('dialog',{name:'Your private account'});
  await dialog.getByRole('button',{name:'Unlock',exact:true}).waitFor({timeout:remaining()});
  assert.deepEqual(await page.evaluate(()=>({secure:isSecureContext,isolated:crossOriginIsolated,locks:typeof navigator.locks?.request==='function',sdkAbsent:globalThis.__aztec===undefined,accountAbsent:globalThis.BillboardAccount===undefined})),{secure:true,isolated:true,locks:true,sdkAbsent:true,accountAbsent:true});
  assert.equal(result.traffic.walletAssets,0);assert.equal(result.traffic.privateRequests,0);result.checks.publicBeforeUnlock=true;
  const noSpend=()=>{assert.equal(result.traffic.proofSubmits,0);assert.equal(result.traffic.nodeSubmissions,0);assert.equal(result.traffic.l1Submissions,0);assert.equal(result.traffic.blockedRequests,0);assert.equal(result.traffic.inspectionErrors,0);};
  async function waitForState(ready){
   const status=await waitForRollingComposerState({dialog,ready,remaining});
   if(status!=='ready'){result.diagnostic=status;if(status==='deadline')expired=true;fail();}
  }
  async function openAccount(role){
   mark('unlock-'+role);await dialog.getByRole('button',{name:'Unlock',exact:true}).click({timeout:remaining()});
   await waitForState(dialog.getByLabel('Recovery file',{exact:true}));
   mark('import-'+role);await dialog.getByLabel('Recovery password',{exact:true}).fill(selected.backupPassword);
   await dialog.getByLabel('Recovery file',{exact:true}).setInputFiles(selected.backupPaths[role]);
   await dialog.getByRole('button',{name:'Import recovery',exact:true}).click();
   await waitForState(dialog.getByLabel('Posting identity',{exact:true}));
   mark('choices-'+role);
   const options=await dialog.getByLabel('Posting identity',{exact:true}).locator('option').evaluateAll(nodes=>nodes.map(x=>({value:x.value,label:x.textContent})));
   const expected=[{value:'0',label:'Anonymous'},...selected.expectedNames[role].map(x=>({value:x.id,label:x.first+' '+x.last}))];
   assert.deepEqual(options.sort((a,b)=>a.value.localeCompare(b.value)),expected.sort((a,b)=>a.value.localeCompare(b.value)));
   const selector=dialog.getByLabel('Posting identity',{exact:true});assert.equal(await selector.inputValue(),'0');
   const beforeSelection=result.traffic.privateRequests;
   for(const value of [...selected.expectedNames[role].map(x=>x.id),'0']){await selector.selectOption(value);assert.equal(await selector.inputValue(),value);}
   assert.equal(result.traffic.privateRequests,beforeSelection);
   assert.equal(await dialog.getByRole('button',{name:'Load more owned names',exact:true}).count(),0);
   result.checks[role==='a'?'ownedChoicesA':'ownedChoicesB']=true;noSpend();
  }
  await openAccount('a');
  const message=dialog.getByLabel('Message',{exact:true}),review=dialog.getByRole('button',{name:'Check action and review fee',exact:true});
  assert.notEqual(await dialog.getByLabel('Posting collateral',{exact:true}).inputValue(),'');
  const exact='😀'.repeat(248),oversize=exact+'😀';
  mark('prepare-992');await dialog.getByLabel('Posting identity',{exact:true}).selectOption(selected.expectedNames.a[0].id);await message.fill(exact);assert.equal(await message.inputValue(),exact);await dialog.getByText('248 characters · 992/992 UTF-8 bytes · 0 bytes remaining',{exact:true}).waitFor();assert.equal(await review.isEnabled(),true);
  await review.click();await waitForState(dialog.getByRole('heading',{name:'Review before sending',exact:true}));
  const fee=await dialog.getByText(/^Maximum network fee: [0-9]+ fee-juice units\./).textContent();assert(/^Maximum network fee: [1-9][0-9]* fee-juice units\./.test(fee));
  await dialog.getByText('content: '+exact,{exact:true}).waitFor();await dialog.getByText('name: '+selected.expectedNames.a[0].first+' '+selected.expectedNames.a[0].last,{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Confirm and send',exact:true}).isEnabled(),true);result.checks.exact992Prepared=true;noSpend();
  mark('cancel-992');await dialog.getByRole('button',{name:'Cancel prepared action',exact:true}).click();await message.waitFor({timeout:remaining()});await dialog.getByText('Prepared action cancelled. No new transaction was sent.',{exact:true}).waitFor();result.checks.preparedCancelled=true;noSpend();
  mark('reject-996');const requests=result.traffic.privateRequests;await message.fill(oversize);assert.equal(await review.isDisabled(),true);assert.equal(await message.inputValue(),oversize);await dialog.getByText('249 characters · 996/992 UTF-8 bytes · 0 bytes remaining · 4 bytes over the limit',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);assert.equal(result.traffic.privateRequests,requests);result.checks.oversizeRetained=true;noSpend();
  mark('literal-preview');const literal='<img src=x onerror=alert(1)> [unsafe](javascript:alert(1)) https://example.invalid/';await message.fill(literal);await dialog.getByText('Preview message',{exact:true}).click();
  const preview=dialog.getByLabel('Message preview',{exact:true});assert.equal(await preview.textContent(),literal);assert.equal(await preview.locator('img,script,a,iframe').count(),0);assert.equal(await message.inputValue(),literal);result.checks.literalPreview=true;noSpend();
  mark('lock-a');await dialog.getByText('Backup and account security',{exact:true}).click();await dialog.getByRole('button',{name:'Lock account',exact:true}).click();await dialog.getByRole('button',{name:'Reload to unlock',exact:true}).waitFor({timeout:remaining()});assert.equal(await dialog.getByLabel('Posting identity',{exact:true}).count(),0);
  mark('reload');await Promise.all([page.waitForEvent('load',{timeout:remaining()}),dialog.getByRole('button',{name:'Reload to unlock',exact:true}).click()]);
  await page.getByRole('button',{name:'Your account',exact:true}).click({timeout:remaining()});await dialog.getByRole('button',{name:'Unlock',exact:true}).waitFor({timeout:remaining()});
  await openAccount('b');assert.equal(await message.inputValue(),'');assert.equal(await dialog.getByLabel('Posting collateral',{exact:true}).inputValue(),'');await dialog.getByText('No posting deposit was found.',{exact:true}).waitFor();result.checks.accountSwitch=true;result.checks.collateralPendingB=true;noSpend();
  mark('complete');result.passed=true;
 }catch{result.passed=false;}
 finally{
  clearTimeout(timer);
  if(context)try{await context.close();result.cleanup.contextClosed=true;}catch{result.passed=false;}
  else result.cleanup.contextClosed=true;
  if(browser)try{await browser.close();result.cleanup.browserClosed=!browser.isConnected();if(!result.cleanup.browserClosed)result.passed=false;}catch{result.passed=false;}
  else result.cleanup.browserClosed=true;
 }
 if(expired||['proofSubmits','nodeSubmissions','l1Submissions','blockedRequests','inspectionErrors'].some(key=>result.traffic[key]!==0))result.passed=false;
 return {...result,stage,elapsedMs:Date.now()-started,timedOut:expired};
}
