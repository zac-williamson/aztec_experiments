// LABELLED UI DOUBLES: this suite tests presentation and no-replay controls only.
// RPC, custody, proofs and encrypted persistence are qualified separately. The
// sessionStorage recovery double below is NOT a production persistence mechanism.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const fixture=`import {executeRollingAction} from '/wallet-action.mjs';
import {executeAutomaticWithdrawal} from '/automatic-withdrawal.mjs';
import {advanceAggregateClaim} from '/aggregate-wallet.mjs';
import {mountRollingWalletPanel} from '/wallet-panel.mjs';
const state={loads:0,sessions:0,prepares:0,sends:0,reconciles:0,cancels:0,closes:0,signIns:0,restores:0,effects:0,ended:0,owned:0,unlocked:true,options:null,failure:null,hold:null,release:null,fee:'fee-ready',profileCalls:0,bioVersion:'3',avatarVersion:'4'};
window.test=state;state.rawAccount={secretKey:'PRIVATE_SENTINEL',address:'HUMAN_IDENTITY_SENTINEL'};state.privateChanges=0;state.preferenceReads=0;state.statusReads=0;state.headReads=0;state.revision='4';state.recoveryChecks=0;state.replacementPrepares=0;state.resumes=0;state.submitCalls=0;state.preferences={scope:{chainId:'31337',version:'1',board:'1'},head:{schema:1,initialized:true,revision:'4',digest:'42'},bookmarks:['10'],followedBoards:['0'],followedNames:[],subscriptions:['10'],replyNotifications:true,readMarkers:[]};
state.previewBlobs=new Map();state.revoked=[];const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);state.previewBlobs.set(url,blob);return url;};URL.revokeObjectURL=url=>{state.revoked.push(url);state.previewBlobs.delete(url);revokeURL(url);};
const read=()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')||'null');
const write=value=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify(value));
const error=()=>{throw Object.defineProperty(Error('PRIVATE_SENTINEL'), 'code',{get(){throw Error('GETTER_SENTINEL');}});};
async function boundary(name){for(const row of state.refreshRecords?.[name]??[])state.sessionProgress(row);if(state.hold===name)await new Promise(resolve=>state.release=resolve);if(state.failure===name)error();}
const application={
 async readBalances({cursor}){state.balanceReads=(state.balanceReads??0)+1;state.balanceCursor=cursor;await boundary('balances');return state.balances;},
 async readBokAccounting({cursor}){(state.accountingReads??=[]).push(cursor);await boundary('accounting');return state.accountingPages.shift();},
 async readModeratorStatus(){state.moderatorReads=(state.moderatorReads??0)+1;await boundary('moderator');return {authorized:state.moderator===true};},
 async readBokStatus(){state.bokReads=(state.bokReads??0)+1;await boundary('bok');return {available:state.bokCredit!==undefined,...(state.bokCredit!==undefined?{availableCredit:state.bokCredit}:{})};},
 async prepareBokPost(id){state.bokContinues=(state.bokContinues??0)+1;await boundary('bok-continue');const prior=read();if(prior.intentId!==id||!['authorized','bok-post-reverted'].includes(prior.status))error();const next={...prior,intentId:'43',status:'prepared',maximumFee:'234',bok:{...prior.bok,phase:'post',authorizationTxHash:'0x'+'7'.repeat(64)}};write(next);return next;},
 async prepareBokRelease(id,input){await boundary('bok-release');const prior=read();if(prior.intentId!==id||!['authorized','bok-post-reverted','bok-release-reverted'].includes(prior.status))error();state.releaseInput={id,...input};const next={intentId:'44',action:{type:input.type,requestId:'0x'+'1'.repeat(64)},status:'prepared',maximumFee:'234',bokRelease:{sourceIntentId:id},releasePrior:prior};write(next);return next;},
 async resumeSaved(id,input){state.resumes++;state.resumeInput={id,...input};state.sends++;await boundary('saved-resume');const next={...read(),txHash:input.expectedTxHash,status:state.resumeOutcome??'confirmed'};write(next);return next;},
 async inspectRecovery(id){state.recoveryChecks++;await boundary('recovery-options');return {...state.recoverySnapshot,intent:read()};},
 async prepareInterrupted(id){state.interruptedReviews=(state.interruptedReviews??0)+1;await boundary('interrupted-review');if(read().intentId!==id)error();const next={...read(),status:'prepared',maximumFee:'456'};write(next);return next;},
 async prepareReplacement(id,input){state.replacementPrepares++;state.replacementInput=input;await boundary('replacement-prepare');const current=read();const next={...current,status:'replacement-prepared',replacementReview:{sourceTxHash:input.expectedTxHash,head:input.expectedHead,marker:current.action.type==='read-marker'?state.recoverySnapshot.marker:null,maximumFee:'456'}};write(next);return next;},
 async readAccountStatus(){state.statusReads++;await boundary('status');const intent=read();return intent&&(!['confirmed','reverted','cancelled'].includes(intent.status)||['withdraw','withdraw-bok','cancel-deposit'].includes(intent.action.type)&&intent.status==='confirmed'&&!state.refunded)?{status:'recovering',intent}:{status:state.fee,privateFeeCredit:state.privateFeeCredit??'1000',depositIds:state.depositIds??(state.fee==='fee-ready'?['9']:[])};},
 async ownedIdentities({cursor}){state.owned++;if(state.ownedFailureCursor===cursor)error();const page=state.namesPages?.[cursor]??(cursor===0?{identities:['7'],records:[{id:'7',first:'River',last:'Lane'}],nextCursor:8}:{identities:['8'],records:[{id:'8',first:'Ellis',last:'Moss'}],nextCursor:null});await boundary('owned');return page;},
 async readPreferenceHead(){state.headReads++;await boundary('head');return {schema:1,initialized:true,revision:state.revision,digest:'42'};},
 async readPreferences(){state.preferenceReads++;if(state.preferenceResults?.length)return state.preferenceResults.shift();await boundary('preferences');return {status:'complete',complete:true,preferences:state.preferences};},
 async readProfile({name}){state.profileCalls++;await boundary('profile');return {name:'0x'+BigInt(name).toString(16).padStart(64,'0'),bioVersion:state.bioVersion,avatarVersion:state.avatarVersion};},
 async prepare(action){state.prepares++;if(action.type==='name'&&state.nameFailure)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:state.nameFailure});if(['bio','avatar'].includes(action.type)&&action.expectedVersion!==state[action.type+'Version'])error();write({intentId:'42',action,maximumFee:'123',status:'prepared',...(action.type==='name'?{nameAvailability:{id:'55',anchor:{blockNumber:1,blockHash:'0x'+'1'.repeat(64),timestamp:'1'}}}:{}),...(['moderate-post','moderate-avatar','reject-subboard','set-main-policy','transfer-moderator'].includes(action.type)?{moderation:{mainVersion:3,...(action.type==='moderate-avatar'?{avatarVersion:2}:{})}}:{}),...(action.type==='withdraw'?{withdrawal:{amount:'100000000000000000',eligible:true,depositor:'0x'+'3'.repeat(40)}}:{}),...(action.type==='withdraw-bok'?{withdrawal:{kind:'bok',amount:action.amount,eligible:true,depositor:action.recipient}}:{}),...(action.type==='bok'?{bok:{phase:'authorize',budget:action.budget,availableCredit:state.bokCredit}}:{})});await boundary('prepare');return read();},
 async submitPrepared(id){state.submitCalls++;state.sends++;write({...read(),status:'submitting'});await boundary('submit');const intent={...read(),...(state.txHash?{txHash:state.txHash}:{}),status:state.submitOutcome??(read().bok?.phase==='authorize'?'authorized':'confirmed')};write(intent);return intent;},
 async cancelPrepared(){state.cancels++;write(read().releasePrior??{...read(),status:'cancelled'});return read();},
 async reconcile(){state.reconciles++;await boundary('reconcile');const intent=read();if(state.resolveOutcome){intent.status=state.resolveOutcome;write(intent);}return intent;}
};
const funding={async prepareStarter({asset}){return this.prepare({asset,collateralWei:'100000000000000000',feeAmount:'2000',bokAmount:'0',privateFeeCap:'1000',slippageBps:100,feePoolFee:3000,...(asset==='USDC'?{collateralPoolFee:3000}:{bokPoolFee:0,gasBudgetWei:state.gasBudget??'3000000000000000'})});},get usdcAvailable(){return state.usdcEnabled===true;},defaultPrivateFeeCap:'1000',pauseClaim:()=>{state.fundingPaused=true;},advanceClaim:()=>{state.fundingPaused=false;return advanceAggregateClaim({application,funding,onProgress:row=>state.sessionProgress(row),paused:()=>state.fundingPaused});},
 async prepare(input){state.fundingPrepares=(state.fundingPrepares??0)+1;state.fundingAllocation=input;await boundary('funding-quote');if(state.fundingQuoteFailure)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:state.fundingQuoteFailure,minimumFeeCredit:state.minimumFeeCredit});if(input.asset==='USDC')return {kind:'rolling-aggregate-usdc-v1',walletName:'MetaMask',privateFeeCap:input.privateFeeCap,slippageBps:input.slippageBps,relayGasBudgetWei:'1000000000000000',breakdown:{collateral:{amount:input.collateralWei,maxUsdc:'5000000'},fee:{amount:input.feeAmount,maxUsdc:'1000000'},bokAmount:input.bokAmount,relayFeeUsdc:'100000',maximumUsdc:(6100000n+BigInt(input.bokAmount)).toString()}};return {walletName:'MetaMask',privateFeeCap:input.privateFeeCap,slippageBps:input.slippageBps,breakdown:{collateralWei:input.collateralWei,fee:{amount:input.feeAmount,maxEth:'1000'},bok:{amount:input.bokAmount,maxEth:input.bokAmount==='0'?'0':'2000'},gasBudgetWei:input.gasBudgetWei,maximumTotalWei:(BigInt(input.collateralWei)+1000n+(input.bokAmount==='0'?0n:2000n)+BigInt(input.gasBudgetWei)).toString()}};},
 async confirm(){state.fundingConfirms=(state.fundingConfirms??0)+1;if(state.fundingSignatureCancelled)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_FUNDING_SIGNATURE_CANCELLED'});if(state.fundingGasChanged)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_FUNDING_GAS_CHANGED'});state.fundingPayments=(state.fundingPayments??0)+1;await boundary('funding-payment');state.paymentSaved=true;return this.recover();},
 async inspect(){return {paymentSaved:state.paymentSaved,privateFeeCap:state.fundingCap??'1000',claim:state.fundingClaim??null,explicitClaimReview:state.explicitClaimReview===true};},
 async checkpointClaim(value){state.fundingClaim=value;},
 async reviewRevertedClaim(){if(!['reverted','cancelled'].includes(read()?.status))error();state.fundingClaim=null;state.explicitClaimReview=true;},
 async recover(){state.fundingRecovers=(state.fundingRecovers??0)+1;return {receipt:{txHash:'0x'+'1'.repeat(64)},feeReceipt:{txHash:'0x'+'1'.repeat(64)},...(state.fundingAllocation?.bokAmount==='0'?{}:{bokReceipt:{txHash:'0x'+'1'.repeat(64)}})};}
};
const topup=Object.fromEntries(['private-fee','bok'].map(kind=>{const local={};const cap={defaultPrivateFeeCap:'1000',get ethAvailable(){return state.ethTopup===true;},usdcAvailable:true,pauseClaim:()=>{local.paused=true;},advanceClaim:()=>{local.paused=false;return advanceAggregateClaim({application,funding:cap,onProgress:row=>state.sessionProgress(row),paused:()=>local.paused});},
 async prepare(input){input={gasBudgetWei:'3000000000000000',...input};state.topupReview={kind,...input};await boundary('topup-review');local.phase=local.approved?'deposit':'approval';return {kind,phase:local.phase,...input,...(state.ethTopup?{maximumSwapWei:'250000000000000',maximumUsdc:'750000'}:{}),walletName:'MetaMask'};},
 async confirm(){state.topupPayments=(state.topupPayments??0)+1;await boundary('topup-payment');if(local.phase==='approval'){local.approved=true;return {approved:true};}local.paid=true;return cap.recover();},
 async inspect(){return {paymentSaved:local.paid,claim:local.claim??null,privateFeeCap:'1000',claimAction:kind==='bok'?'claim-bok':'claim-private-fee'};},
 async checkpointClaim(value){local.claim=value;},async recover(){return {receipt:{txHash:'0x'+'1'.repeat(64),amount:'300'}};},async reviewRevertedClaim(){local.claim=null;}
 };return [kind,cap];}));
application.executeAction=(action,options)=>executeRollingAction(application,structuredClone(action),options);
application.readWithdrawalReadiness=async()=>state.withdrawalStates.shift();
application.executeWithdrawal=(deposit,options)=>executeAutomaticWithdrawal({application,deposit,...options,
 guard:async()=>options.signal?.throwIfAborted(),waitUntil:async()=>{await boundary('withdrawal-wait');options.signal?.throwIfAborted();}});
const runtime={
 fundingWallets:()=>state.walletChoices??[{id:'metamask',name:'MetaMask'}],fundingWalletStatus:()=>state.fundingWallet??(state.walletChoices?{connected:false}:{connected:true,name:'MetaMask',address:'0x'+'1'.repeat(40)}),
 async connectFundingWallet(id){state.walletConnects=(state.walletConnects??0)+1;state.walletSelected=id;await boundary('funding-wallet');state.fundingWallet={connected:true,name:'MetaMask',address:'0x'+'1'.repeat(40)};},
 getAccount:()=>state.unlocked?state.rawAccount:null,
 async restoreAccount(){state.restores++;await boundary('restore');return state.unlocked;},
 async signInWallet(id){state.signIns++;await boundary('signin');await this.connectFundingWallet(id);state.unlocked=true;return state.rawAccount;},
 account:{configure:options=>{state.options=options;},async endSession(){state.ended++;state.unlocked=false;return {reload:true};}},
 async createSession({onProgress}){state.sessions++;state.sessionProgress=onProgress;for(const record of state.initializationRecords??[])onProgress(record);await boundary('session');return {application,bokConfigured:state.bokConfigured===true||state.bokCredit!==undefined,depositRefunds:state.depositRefundEnabled?{
 async list(input){state.depositRefundList=input;return {owner:'0x'+'3'.repeat(40),deposits:[{depositId:'0x'+'4'.repeat(64),amount:'1000000000000000',status:'available'}],nextOffset:null};},
 async request(id){state.depositRefundId=id;await boundary('deposit-refund-request');return {depositId:id,sender:'0x'+'3'.repeat(40),amount:'1000000000000000'};},
 async prepare(receipt){await boundary('deposit-refund-bridge');const intent={intentId:'refund-1',action:{type:'cancel-deposit',receipt},status:'prepared',maximumFee:'123',withdrawal:{kind:'cancelled-collateral',depositor:receipt.sender,amount:receipt.amount,depositId:receipt.depositId,eligible:true}};write(intent);return intent;},
 }:null,withdrawal:{async prepareSaved(input){state.savedRefundReviews=(state.savedRefundReviews??0)+1;state.refundInput=input;await boundary('saved-refund-review');if(state.refundFound){state.refunded=true;return {status:'refunded'};}return {savedRequest:true,nonce:7,amount:read().withdrawal.amount,maximumGasWei:input.maximumGasWei??'3000000000000000',walletName:'MetaMask'};},async prepare(input){state.refundReviews=(state.refundReviews??0)+1;state.refundInput=input;await boundary('refund-review');return {amount:'100000000000000000',maximumGasWei:input.maximumGasWei??'3000000000000000',walletName:'MetaMask'};},async confirm(){state.refundSends=(state.refundSends??0)+1;await boundary('refund-send');state.refunded=true;return {status:'refunded',amount:read().withdrawal.amount};},async cancel(){state.refundCancelled=true;},async recover(){state.refundChecks=(state.refundChecks??0)+1;await boundary('refund-check');if(state.refundFound)state.refunded=true;return {status:state.refundFound?'refunded':'unknown'};}},topup:state.topupEnabled?topup:null,funding:state.aggregateEnabled?funding:null,busy:false,async close(){state.closes++;await boundary('close');}};}
};
const originalFetch=globalThis.fetch.bind(globalThis);state.ruleReads=[];state.ruleReleases={};
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('/api/board?'))return originalFetch(url,options);
 const query=new URL(url,location.origin).searchParams,id=query.get('id');state.ruleReads.push({id,limit:query.get('limit')});
 const override=structuredClone(state.rules?.[id]??{}),parent=override.parent??'Respect other people.',version=override.version??'2';
 const body={schemaVersion:1,complete:true,scope:{chainId:'31337',rollupVersion:'1',boardAddress:'0x'+'1'.repeat(64)},boardId:override.boardId??id,
  mainPolicy:{version,text:parent},board:id==='0'?null:{id,name:'Workshop',mainVersion:version,mainRules:parent,rules:override.local??'Share useful ideas.',rejected:override.rejected??false,rejection:override.rejected?{reason:'Outside the parent rules.'}:null}};
 if(state.holdRules===id)await new Promise(resolve=>state.ruleReleases[id]=resolve);
 return new Response(JSON.stringify(body),{status:override.unavailable?503:200,headers:{'Content-Type':'application/json'}});
};
window.panel=mountRollingWalletPanel({loadRuntime:async()=>{state.loads++;await boundary('load');return runtime;},onPublicEffect:()=>{state.effects++;state.publicEffect?.();},onPrivateChange:()=>{state.privateChanges++;}});
document.getElementById('open').onclick=()=>window.panel.open(window.defaults);
window.ready=true;`;
async function browserFixture(t){
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src blob: data:; base-uri 'none'; form-action 'none'"});res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><button id="open">Open account</button><div id="reader">Public reader</div><script type="module" src="/fixture.mjs"></script>');return;}
  if(req.url==='/fixture.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fixture);return;}
  if(req.url==='/aggregate-wallet.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/aggregate-wallet.mjs',import.meta.url)));return;}
  const diagnosticModules={'/deployment-registration.mjs':'../../shared/rolling/deployment-registration.mjs','/deployment.mjs':'../../shared/rolling/deployment.mjs','/protocol-commitments.mjs':'../../shared/protocol-commitments.mjs','/protocol-schema.mjs':'../../shared/protocol-schema.mjs'};
  if(Object.hasOwn(diagnosticModules,req.url)){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL(diagnosticModules[req.url],import.meta.url)));return;}
  if(req.url==='/invocation.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/invocation.mjs',import.meta.url)));return;}
  if(!['/wallet-panel.mjs','/automatic-withdrawal.mjs','/performance.mjs','/wallet-action.mjs','/reader-client.mjs','/avatar-upload.mjs','/model.mjs','/style.css'].includes(req.url)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'text/javascript'});res.end(await fs.readFile(new URL('.'+req.url,import.meta.url)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const browser=await chromium.launch({headless:true,...(process.env.T04_CHROMIUM_EXECUTABLE?{executablePath:process.env.T04_CHROMIUM_EXECUTABLE}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
 page.setDefaultTimeout(3000);const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 t.after(()=>assert.deepEqual(errors,[]));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready);
 return {page,requests};
}
async function open(page,defaults){if(defaults)await page.evaluate(value=>window.defaults=value,defaults);await page.getByRole('button',{name:'Open account',exact:true}).click();}
async function navigateAccount(page,name){
 await page.evaluate(()=>panel.initialize());
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const back=page.getByRole('button',{name:'Back to account',exact:true});if(await back.isVisible())await back.click();
 const settings=page.getByText('Account settings',{exact:true});
 const target=page.getByRole('button',{name,exact:true});
 if(!await target.isVisible()&&await settings.isVisible())await settings.click();
 await target.click();
}
async function unlock(page){await page.evaluate(()=>panel.initialize());await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');if(!await page.getByRole('button',{name:'Check action and review fee',exact:true}).isVisible())await navigateAccount(page,'Write a post');await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();}
async function resumeFunding(page){const details=page.getByText('Already paid?',{exact:true});if(await details.isVisible()&&!await page.getByRole('button',{name:'Resume saved funding',exact:true}).isVisible())await details.click();await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();}

async function prepare(page){await page.getByLabel('Message',{exact:true}).fill('Hello from the labelled UI double.');await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();}
async function rulesBeforePrimary(page){
 assert(await page.getByRole('region',{name:'Current effective rules'}).evaluate(section=>{
  const primary=section.parentElement.querySelector(':scope > button.primary');
  return !!primary&&!!(section.compareDocumentPosition(primary)&Node.DOCUMENT_POSITION_FOLLOWING)&&section.getBoundingClientRect().bottom<=primary.getBoundingClientRect().top;
 }));
}
const counts=page=>page.evaluate(()=>({loads:test.loads,sessions:test.sessions,prepares:test.prepares,sends:test.sends,reconciles:test.reconciles,effects:test.effects}));

test('unsigned opening never prompts a wallet; dialog survives reader changes and restores focus',async t=>{
 const {page,requests}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);await page.getByRole('button',{name:'Connect MetaMask',exact:true}).waitFor();assert.equal((await counts(page)).loads,1);assert.equal(await page.evaluate(()=>test.signIns),0);
 await page.evaluate(()=>document.getElementById('reader').replaceChildren(document.createTextNode('Rerendered')));assert.equal(await page.getByRole('dialog').count(),1);
 await page.getByRole('button',{name:'Close account panel'}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'How privacy works');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Close account panel');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
 await open(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal((await counts(page)).loads,1);
 assert(requests.every(url=>!url.includes('aztec')&&!url.includes('/api/')));
});

test('private choices, multibyte limit, safe link preview and explicit maximum-fee confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await unlock(page);
 assert.equal(await page.evaluate(()=>test.options.requireEth),false);assert.equal(Object.hasOwn(await page.evaluate(()=>test.options),'autoPasskey'),false);
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/1/10');assert.equal(await page.getByLabel('Reply to post ID').count(),0);assert.equal(await page.getByLabel('Root thread ID').count(),0);
 assert.equal(await page.getByLabel('Posting identity').inputValue(),'0');await page.getByRole('button',{name:'Load more owned names'}).click();await page.getByLabel('Posting identity').selectOption('8');
 await page.getByLabel('Message',{exact:true}).fill('😀'.repeat(249));assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'😀'.repeat(249));assert(await page.getByText(/249 characters · 996\/992/).isVisible());
 const message='[Docs](https://example.com/docs?x=1&y=2)\nhttp://example.org/path [Unsafe](javascript:alert) [Data](data:text/html,hello) <img src=x onerror=alert(1)> 😀';
 await page.getByLabel('Message',{exact:true}).fill(message);await page.getByText('Preview message',{exact:true}).click();const preview=page.locator('.preview-body');
 assert.equal(await preview.locator('img,script').count(),0);assert.equal(await preview.textContent(),'Docs\nhttp://example.org/path [Unsafe](javascript:alert) [Data](data:text/html,hello) <img src=x onerror=alert(1)> 😀');
 assert.deepEqual(await preview.locator('a').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,href:n.href,target:n.target,rel:n.rel}))),[{text:'Docs',href:'https://example.com/docs?x=1&y=2',target:'_blank',rel:'noopener noreferrer'},{text:'http://example.org/path',href:'http://example.org/path',target:'_blank',rel:'noopener noreferrer'}]);
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),message);
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();
 assert(await page.getByText(/Maximum network fee: 123 fee-juice units/).isVisible());assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'reply',subboard:'3',parent:'10',root:'1',content:message,name:'8',deposit:'9'});
 await page.getByRole('button',{name:'Confirm and send'}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);assert.equal((await counts(page)).effects,1);
 assert.equal(await page.locator('body').innerText().then(text=>text.includes('PRIVATE_SENTINEL')||text.includes('HUMAN_IDENTITY_SENTINEL')),false);
});

test('uncertain submission cannot resend; reopening and replacement reconcile the retained intent',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await prepare(page);
 await page.evaluate(()=>{test.failure='submit';test.hold='submit';});await page.getByRole('button',{name:'Confirm and send'}).click();await page.waitForFunction(()=>test.sends===1);
 await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());assert(await page.getByRole('button',{name:'Confirm and send'}).isDisabled());
 await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Check existing transaction'}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm and send'}).count(),0);
 assert(!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
 await page.getByRole('button',{name:'Close account panel'}).click();await open(page,{type:'like',post:'66'});await page.getByRole('button',{name:'Check existing transaction'}).waitFor();assert.equal((await counts(page)).sends,1);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check existing transaction'}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
 await page.evaluate(()=>test.resolveOutcome='confirmed');await page.getByRole('button',{name:'Check existing transaction'}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).reconciles,1);
});

test('lost prepare acknowledgement blocks new work until recovery; prepared cancellation never sends',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Action').selectOption('name');await page.getByLabel('First name',{exact:true}).fill('River');await page.getByLabel('Last name',{exact:true}).fill('Lane');
 await page.evaluate(()=>test.failure='prepare');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Check account recovery'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Check action and review fee'}).count(),0);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check account recovery'}).click();await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByText('Prepared action cancelled. No new transaction was sent.').waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.cancels),1);
});

test('wallet sign-in is explicit and failed session cleanup does not sign out',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.signIns),0);
 assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('heading',{name:'Your account',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.signIns),1);assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>test.failure='close');await navigateAccount(page,'Sign out');await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>test.ended),0);
});

test('funding remains honest and unavailable connection has no action buttons or automatic retry',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.failure='session');await open(page);await page.getByRole('button',{name:'Reconnect'}).waitFor();
 assert.equal((await counts(page)).sessions,1);assert.equal(await page.getByRole('button',{name:'Confirm and send'}).count(),0);assert.equal(await page.getByRole('button',{name:'Check action and review fee'}).count(),0);
 await page.evaluate(()=>{test.failure=null;test.fee='collateral-pending';});await page.getByRole('button',{name:'Reconnect'}).click();await page.getByRole('heading',{name:'One more step before your first post',exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'Set up posting',exact:true}).isVisible());await navigateAccount(page,'Write a post');await page.getByLabel('Message',{exact:true}).fill('No collateral');assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());
 await page.getByLabel('Action').selectOption('subboard');await page.getByLabel('Permanent slug (3–40 lowercase letters, digits or single hyphens)').fill('small-tools');await page.getByLabel('Subboard name').fill('Small tools');await page.getByLabel('Description',{exact:true}).fill('Make useful things');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.equal((await counts(page)).sends,0);
});

test('funding recovery imports only on request and requires a separate claim confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');
 const data={receipt:{txHash:'0x'+'40'.repeat(32),blockHash:'0x'+'41'.repeat(32),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:'0x'+'01'.repeat(32),secretHash:'0x'+'02'.repeat(32)}};
 await page.getByText('Already paid?',{exact:true}).click();await page.getByLabel('Funding recovery receipt',{exact:true}).setInputFiles({name:'funding.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Check funding receipt',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert(await page.getByText('Collateral: 100 wei.',{exact:true}).isVisible());assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'claim-deposit',...data});
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});

test('wallet sign-in is explicit; quote, repost, like and unlike retain exact selected targets',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.signIns),0);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('heading',{name:'Your account',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.signIns),1);
 for(const type of ['quote','repost','like','unlike']){
  await page.getByRole('button',{name:'Close account panel'}).click();await open(page,{type,reference:'22',post:'22'});await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
  if(type==='quote')await page.getByLabel('Message',{exact:true}).fill('A quote');
  await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Cancel prepared action'}).waitFor();
  const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(action.type,type);assert.equal(action[type==='quote'||type==='repost'?'reference':'post'],'22');
  await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
 }
 assert.equal((await counts(page)).sends,0);
});

async function selectProfile(page,type){if(!await page.getByLabel('Action',{exact:true}).isVisible())await navigateAccount(page,'Write a post');await page.getByLabel('Action',{exact:true}).selectOption(type);await page.getByLabel('Profile name',{exact:true}).selectOption('7');await page.waitForFunction(()=>!document.querySelector('dialog').matches('[aria-busy="true"]'));}
async function imageFile(page){const bytes=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=180;c.height=120;const ctx=c.getContext('2d');ctx.fillStyle='#43775c';ctx.fillRect(0,0,180,120);const blob=await new Promise(r=>c.toBlob(r,'image/png'));c.width=c.height=0;return [...new Uint8Array(await blob.arrayBuffer())];});return {name:'generated-pattern.png',mimeType:'image/png',buffer:Buffer.from(bytes)};}
async function previewData(page){return page.locator('img[alt="Exact avatar bytes to publish"]').evaluate(async img=>{const blob=test.previewBlobs.get(img.src);return {data:btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()))),size:blob.size,width:img.naturalWidth,height:img.naturalHeight};});}

test('owned names are readable and profile version is fetched only by explicit selection/check',async t=>{
 const {page,requests}=await browserFixture(t);await open(page);await unlock(page);assert.equal(await page.getByLabel('Posting identity').locator('option').allTextContents().then(x=>x.join('|')),'Anonymous|River Lane');
 assert.equal(await page.evaluate(()=>test.profileCalls),0);await page.getByLabel('Action').selectOption('bio');assert.equal(await page.evaluate(()=>test.profileCalls),0);assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());
 await page.getByLabel('Profile name').selectOption('7');await page.waitForFunction(()=>test.profileCalls===1&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 await page.getByLabel('Bio (empty to clear)',{exact:true}).fill('😀'.repeat(249));assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal(await page.getByLabel('Bio (empty to clear)').inputValue(),'😀'.repeat(249));
 await page.getByLabel('Bio (empty to clear)').fill('<script>literal()</script>');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'bio',content:'<script>literal()</script>',name:'7',expectedVersion:'3'});assert.equal(await page.locator('dialog script').count(),0);assert.equal(await page.evaluate(()=>test.profileCalls),1);assert.equal((await counts(page)).sends,0);
 assert(requests.every(url=>!url.includes('/api/')&&!url.includes('owned_')));
});
test('stale bio version fails without rereading or overwriting; empty bio clear requires explicit review',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await selectProfile(page,'bio');await page.evaluate(()=>test.bioVersion='5');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Check account recovery'}).waitFor();assert.equal(await page.evaluate(()=>test.profileCalls),1);assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('labelled-ui-intent')),null);
 await page.getByRole('button',{name:'Check account recovery'}).click();await page.getByRole('button',{name:'Check current profile version'}).waitFor();assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal(await page.evaluate(()=>test.profileCalls),1);await page.getByRole('button',{name:'Check current profile version'}).click();await page.waitForFunction(()=>test.profileCalls===2&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'bio',name:'7',expectedVersion:'5',content:''});assert.equal((await counts(page)).sends,0);
});
test('avatar exact immutable preview bytes survive confirmation and recovered prepared intent',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await selectProfile(page,'avatar');await page.getByLabel('Avatar image',{exact:true}).setInputFiles(await imageFile(page));
 await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));const first=await previewData(page);assert.equal(first.width,100);assert.equal(first.height,100);assert(first.size<=8192);
 assert(await page.getByText(/Centre-square crop, resized to 100/).isVisible());await page.getByRole('button',{name:'Check action and review fee'}).click();await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send');return b&&!b.disabled;});
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.deepEqual(saved,{type:'avatar',name:'7',expectedVersion:'4',width:100,height:100,data:first.data});assert.equal((await previewData(page)).data,first.data);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Close account panel'}).click();assert.equal(await page.evaluate(()=>test.previewBlobs.size),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send');return b&&!b.disabled;});
 assert.equal((await previewData(page)).data,first.data);assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.profileCalls),0);
 await page.getByRole('button',{name:'Confirm and send'}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});
test('avatar clear, rejected uploads and failed profile connection never auto-send',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.evaluate(()=>test.failure='profile');await selectProfile(page,'avatar');await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal(await page.evaluate(()=>test.profileCalls),1);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check current profile version'}).click();await page.waitForFunction(()=>test.profileCalls===2&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 for(const file of [{name:'active.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg onload="PRIVATE_SENTINEL"/>')},{name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(8*1024*1024+1)}]){
  await page.getByLabel('Avatar image').setInputFiles(file);await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal((await counts(page)).prepares,0);
 }
 await page.getByRole('button',{name:'Clear avatar',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'avatar',name:'7',expectedVersion:'4',width:0,height:0,data:''});assert.equal((await counts(page)).sends,0);assert(!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
});
test('invalid recovered avatar disables send and lock invalidates/revokes existing previews',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'prepared',maximumFee:'123',action:{type:'avatar',name:'7',expectedVersion:'4',width:100,height:100,data:btoa('<svg onload="bad()"/>')}})));
 await open(page);await page.getByText(/saved avatar cannot be previewed safely/).waitFor();assert(await page.getByRole('button',{name:'Confirm and send'}).isDisabled());assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await selectProfile(page,'avatar');await page.getByLabel('Avatar image').setInputFiles(await imageFile(page));await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 assert.equal(await page.evaluate(()=>test.previewBlobs.size),1);await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.evaluate(()=>test.previewBlobs.size),0);assert.equal(await page.locator('dialog img').count(),0);assert.equal(await page.getByRole('button',{name:'Confirm and send'}).count(),0);
});
for(const [code,copy] of [['ROLLING_NAME_INVALID','Enter a valid first and last name.'],['ROLLING_NAME_TAKEN','This name is already registered.'],['ROLLING_NAME_AVAILABILITY_UNAVAILABLE','Name availability could not be checked.']])test('name availability feedback '+code+' preserves an editable draft without a transaction',async t=>{
 const {page}=await browserFixture(t);await page.setViewportSize({width:1280,height:720});await open(page);await unlock(page);await page.getByLabel('Action').selectOption('name');
 await page.getByLabel('First name',{exact:true}).fill('John');await page.getByLabel('Last name',{exact:true}).fill('Doe');await page.evaluate(code=>test.nameFailure=code,code);
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes(copy));
 assert(await page.getByRole('alert').evaluate(alert=>{const box=alert.getBoundingClientRect(),dialog=alert.closest('dialog').getBoundingClientRect();return box.top>=Math.max(0,dialog.top)&&box.bottom<=Math.min(innerHeight,dialog.bottom)&&box.left>=Math.max(0,dialog.left)&&box.right<=Math.min(innerWidth,dialog.right);}), 'Validation feedback must be inside the visible dialog and viewport');
 assert(await page.getByRole('alert').evaluate(alert=>document.activeElement===alert),'Keyboard focus must reach the feedback');
 assert.equal(await page.getByLabel('First name',{exact:true}).count(),1,'Known pre-journal failure must keep the form editable');assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'John');assert.equal(await page.getByLabel('Last name',{exact:true}).inputValue(),'Doe');assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('labelled-ui-intent')),null);assert(!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
 await page.evaluate(()=>test.nameFailure=null);await page.getByLabel('First name',{exact:true}).fill('Jane');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert(await page.getByText(/This name was available when checked/).isVisible());assert(await page.getByText(/This is not a reservation/).isVisible());assert.equal((await counts(page)).sends,0);
});
test('name availability does not clear recovery for unknown failures or claim a check for legacy saved actions',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Action').selectOption('name');await page.getByLabel('First name',{exact:true}).fill('John');await page.getByLabel('Last name',{exact:true}).fill('Doe');await page.evaluate(()=>test.failure='prepare');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('alert').waitFor();assert(await page.getByRole('button',{name:'Check account recovery',exact:true}).isVisible());assert.equal(await page.getByLabel('First name',{exact:true}).count(),0);assert(!(await page.locator('body').innerText()).includes('GETTER_SENTINEL'));assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>{test.failure=null;const saved=JSON.parse(sessionStorage.getItem('labelled-ui-intent'));delete saved.nameAvailability;sessionStorage.setItem('labelled-ui-intent',JSON.stringify(saved));});await page.getByRole('button',{name:'Check account recovery',exact:true}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.equal(await page.getByText(/This name was available when checked/).count(),0);assert.equal((await counts(page)).sends,0);
});
test('random names remain editable local proposals until an explicit action check',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Action').selectOption('name');const before=await counts(page),owned=await page.evaluate(()=>test.owned);
 await page.getByRole('button',{name:'Suggest a random name'}).click();assert.match(await page.getByLabel('First name',{exact:true}).inputValue(),/^(River|Ellis|Mira|Rowan|Sage|Robin|Avery|Quinn)$/);assert.match(await page.getByLabel('Last name',{exact:true}).inputValue(),/^(Lane|Moss|Reed|Vale|Stone|Brook|Finch|Wren)$/);
 assert.deepEqual(await counts(page),before);assert.equal(await page.evaluate(()=>test.owned),owned);assert.equal(await page.evaluate(()=>test.profileCalls),0);assert(await page.getByText(/random suggestion is not a reservation/).isVisible());
 await page.getByLabel('First name',{exact:true}).fill('Edited');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.first),'Edited');assert.equal((await counts(page)).sends,0);
});

for(const outcome of ['confirmed','reverted'])test(`profile ${outcome} clears only captured version and requires an explicit new check`,async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await selectProfile(page,'bio');
 await page.getByLabel('Bio (empty to clear)').fill('Preserve this draft after outcome');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();
 await page.evaluate(value=>test.submitOutcome=value,outcome);await page.getByRole('button',{name:'Confirm and send'}).click();await page.getByRole('button',{name:'Check current profile version'}).waitFor();
 assert.equal(await page.getByLabel('Bio (empty to clear)').inputValue(),'Preserve this draft after outcome');assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal(await page.evaluate(()=>test.profileCalls),1);assert.equal((await counts(page)).sends,1);
 await page.getByRole('button',{name:'Check current profile version'}).click();await page.waitForFunction(()=>test.profileCalls===2&&!document.querySelector('dialog').matches('[aria-busy="true"]'));assert(await page.getByRole('button',{name:'Check action and review fee'}).isEnabled());assert.equal((await counts(page)).sends,1);
});
test('lost profile preparation acknowledgement retains saved intent and exact avatar while invalidating draft version',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await selectProfile(page,'avatar');await page.getByLabel('Avatar image').setInputFiles(await imageFile(page));await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));const preview=await previewData(page);
 await page.evaluate(()=>test.failure='prepare');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Check account recovery'}).waitFor();assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check account recovery'}).click();await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send');return b&&!b.disabled;});assert.equal((await previewData(page)).data,preview.data);assert.equal(await page.evaluate(()=>test.profileCalls),1);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Check current profile version'}).waitFor();assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());assert.equal((await previewData(page)).data,preview.data);assert.equal((await counts(page)).sends,0);
});

test('private names view pages only on request and opens one public profile deliberately',async t=>{
 const {page,requests}=await browserFixture(t);await open(page);await unlock(page);const owned=await page.evaluate(()=>test.owned);
 await navigateAccount(page,'Your names');await page.getByRole('heading',{name:'Your names',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.owned),owned);assert.equal(await page.evaluate(()=>test.profileCalls),0);
 assert.deepEqual(await page.getByRole('list',{name:'Your registered names'}).locator('li p').allTextContents(),['River Lane']);
 await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('button',{name:'Edit bio for Ellis Moss',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.owned),owned+1);assert.equal(await page.getByRole('button',{name:'Load more owned names',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>test.profileCalls),0);assert(!requests.some(url=>url.includes('/api/')||url.includes('owned_')||url.includes('profile/')));
 assert.equal(await page.getByRole('link',{name:'View public profile for Ellis Moss',exact:true}).getAttribute('href'),'#/profile/8');
 await page.getByRole('link',{name:'View public profile for Ellis Moss',exact:true}).click();assert.equal(await page.evaluate(()=>location.hash),'#/profile/8');assert.equal(await page.getByRole('dialog').isVisible(),false);
 assert(!requests.some(url=>url.includes('/api/')||url.includes('owned_')));assert.equal((await counts(page)).prepares,0);
});

test('names paging failure keeps existing names and retries only on explicit user action',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await navigateAccount(page,'Your names');
 await page.evaluate(()=>test.failure='owned');await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('alert').waitFor();
 const attempted=await page.evaluate(()=>test.owned);assert.equal(attempted,2);assert.deepEqual(await page.getByRole('list',{name:'Your registered names'}).locator('li p').allTextContents(),['River Lane']);
 await navigateAccount(page,'Write a post');await navigateAccount(page,'Your names');assert.equal(await page.evaluate(()=>test.owned),attempted);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('button',{name:'Edit bio for Ellis Moss',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.owned),attempted+1);
 assert.equal((await counts(page)).sends,0);
});

test('names management reuses registration and version-checked profile fee confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await navigateAccount(page,'Your names');
 await page.getByRole('button',{name:'Register a name',exact:true}).click();assert.equal(await page.getByLabel('Action',{exact:true}).inputValue(),'name');assert.equal(await page.evaluate(()=>test.profileCalls),0);
 await page.getByLabel('First name',{exact:true}).fill('Mira');await page.getByLabel('Last name',{exact:true}).fill('Vale');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Cancel prepared action'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'name',first:'Mira',last:'Vale'});assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await navigateAccount(page,'Your names');await page.getByRole('button',{name:'Edit bio for River Lane',exact:true}).click();
 await page.getByLabel('Bio (empty to clear)').waitFor();assert.equal(await page.getByLabel('Profile name').inputValue(),'7');assert.equal(await page.evaluate(()=>test.profileCalls),1);
 await page.getByLabel('Bio (empty to clear)').fill('Edit from private names');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert(await page.getByText(/Maximum network fee: 123/).isVisible());assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await navigateAccount(page,'Your names');await page.getByRole('button',{name:'Edit avatar for River Lane',exact:true}).click();await page.getByLabel('Avatar image').waitFor();assert.equal(await page.getByLabel('Profile name').inputValue(),'7');assert.equal(await page.evaluate(()=>test.profileCalls),2);
 await navigateAccount(page,'Your names');await navigateAccount(page,'Write a post');await page.getByLabel('Action').selectOption('post');assert.deepEqual(await page.getByLabel('Posting identity').locator('option').allTextContents(),['Anonymous','River Lane']);
});

for(const boundary of ['owned','profile'])test(`account invalidation clears names/drafts immediately and discards delayed ${boundary} results`,async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Message',{exact:true}).fill('PRIVATE_DRAFT_SENTINEL');await navigateAccount(page,'Your names');
 await page.evaluate(value=>test.hold=value,boundary);
 await page.getByRole('button',{name:boundary==='owned'?'Load more owned names':'Edit bio for River Lane',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 await page.evaluate(()=>{test.options.onChange({invalidated:true});test.namesPages={0:{identities:['9'],records:[{id:'9',first:'Mira',last:'Vale'}],nextCursor:null}};});
 assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);assert.equal(await page.locator('dialog select').count(),0);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));
 await page.evaluate(()=>test.release());await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(!/River Lane|Ellis Moss|Mira Vale|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));assert.equal(await page.getByRole('button',{name:'Check action and review fee'}).count(),0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Close account panel'}).click();await open(page);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));
});

test('signing out from names management removes names and drafts without deleting retained recovery',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Message',{exact:true}).fill('PRIVATE_DRAFT_SENTINEL');await navigateAccount(page,'Your names');
 await navigateAccount(page,'Sign out');await page.getByRole('button',{name:'Reload page'}).waitFor();
 assert.equal(await page.evaluate(()=>test.ended),1);assert.equal(await page.evaluate(()=>test.closes),1);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);
});

test('empty private names view offers registration without inventing identities or public lookups',async t=>{
 const {page,requests}=await browserFixture(t);await page.evaluate(()=>test.namesPages={0:{identities:[],records:[],nextCursor:null}});await open(page);await unlock(page);await navigateAccount(page,'Your names');
 assert(await page.getByText(/No registered names were found/).isVisible());assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);assert.equal(await page.getByRole('button',{name:'Load more owned names'}).count(),0);
 assert(await page.getByRole('button',{name:'Register a name',exact:true}).isEnabled());await navigateAccount(page,'Write a post');assert.deepEqual(await page.getByLabel('Posting identity').locator('option').allTextContents(),['Anonymous']);assert(!requests.some(url=>url.includes('/api/')));
});
for(const invalidPage of ['duplicate','cursor'])test('invalid private names '+invalidPage+' page preserves current list and stops without retry',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await navigateAccount(page,'Your names');
 await page.evaluate(kind=>test.namesPages={8:kind==='duplicate'?{identities:['7'],records:[{id:'7',first:'Forged',last:'Label'}],nextCursor:null}:{identities:['8'],records:[{id:'8',first:'Ellis',last:'Moss'}],nextCursor:8}},invalidPage);
 await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('alert').waitFor({timeout:3000}).catch(async error=>{t.diagnostic(JSON.stringify(await page.evaluate(()=>({owned:test.owned,busy:document.querySelector('dialog').getAttribute('aria-busy'),alerts:document.querySelectorAll('[role=alert]').length}))));throw error;});assert.deepEqual(await page.getByRole('list',{name:'Your registered names'}).locator('li p').allTextContents(),['River Lane']);assert.equal(await page.evaluate(()=>test.owned),2);assert.equal((await counts(page)).sends,0);
});

// Labelled presentation doubles: production replay, wallet proofs and storage are
// independently qualified; these tests assert explicit UI boundaries only.
test('one explicit recovery continues sequential bounded reads, including equal progress, without exposing partial preferences',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');
 await page.getByRole('button',{name:'Load saved items',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.statusReads),0);assert.equal(await page.evaluate(()=>test.owned),0);assert(await page.getByText('Recover saved choices without checking funds or preparing a transaction.',{exact:true}).isVisible());assert.equal(await page.getByText('Your posting balance is available.',{exact:false}).count(),0);assert.equal(await page.evaluate(()=>test.preferenceReads),0);await page.evaluate(()=>{test.partialResult={status:'recovering',complete:false,progress:{nextBlock:33,anchorBlock:80,processedRevision:'2',markersChecked:0,markersTotal:null}};test.preferenceResults=[test.partialResult,new Promise(resolve=>test.releasePartial=resolve)];test.hold='preferences';});
 await page.getByRole('button',{name:'Load saved items',exact:true}).click();await page.waitForFunction(()=>test.preferenceReads===2);
 assert.equal(await page.evaluate(()=>test.release),null,'A second bounded read must settle before another starts');await page.getByRole('button',{name:'Stop loading'}).focus();
 await page.evaluate(()=>test.releasePartial(test.partialResult));await page.waitForFunction(()=>typeof test.release==='function');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Stop loading');
 assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);assert.equal(await page.evaluate(()=>test.preferenceReads),3);assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');assert(await page.getByRole('button',{name:'Loading saved items',exact:true}).isDisabled());assert(await page.getByRole('button',{name:'Stop loading'}).isEnabled());assert(await page.getByText('Next history block to check: 33',{exact:true}).isVisible());
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByText('Your saved choices are ready.').waitFor();
 assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),true);assert.equal(await page.evaluate(()=>test.sends),0);
 assert(await page.getByText('Your follows, bookmarks and notification settings have been recovered.',{exact:true}).isVisible());assert.equal(await page.getByText(/fee-juice units|deposit IDs|action check/).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);if(process.env.ROLLING_PREFERENCES_COMPLETE_SCREENSHOT){await page.getByRole('button',{name:'Disable reply notifications'}).scrollIntoViewIfNeeded();await page.screenshot({path:process.env.ROLLING_PREFERENCES_COMPLETE_SCREENSHOT,fullPage:true});}
 await page.getByRole('button',{name:'Close account panel'}).click();await page.evaluate(()=>{test.rawAccount={};});assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);
});

test('anonymous reply review identifies Anonymous and opening private views clears the previous confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await unlock(page);await prepare(page);
 assert(await page.getByText('name: Anonymous',{exact:true}).isVisible());assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{view:'preferences'});
 await page.getByRole('button',{name:'Load saved items',exact:true}).waitFor();assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.preferenceReads),0);
});

test('every preference and read marker captures a fresh head and requires maximum-fee confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 for(const [i,action]of [{type:'preference',kind:1,target:'10',enabled:true},{type:'preference',kind:2,target:'0',enabled:false},{type:'preference',kind:3,target:'7',enabled:true},{type:'preference',kind:4,target:'10',enabled:false},{type:'preference',kind:5,target:'0',enabled:false},{type:'read-marker',thread:'10',throughBlock:'12'}].entries()){
  await page.getByRole('button',{name:'Close account panel'}).click();await open(page,action);await page.getByRole('button',{name:'Check action and review fee'}).waitFor();await page.evaluate(i=>test.revision=String(i+20),i);
  await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{...action,expectedRevision:String(i+20)});
  assert(await page.getByText(/Sending records an encrypted onchain update/).isVisible());assert.equal(await page.evaluate(()=>test.sends),0);
  await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
 }
 assert.equal(await page.evaluate(()=>test.headReads),6);
});
test('account invalidation during preference recovery clears capability, keeps busy until settled and never publishes old result',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Load saved items'}).waitFor();
 await page.evaluate(()=>{test.preferenceResults=[{status:'recovering',complete:false,progress:{nextBlock:1}}];test.hold='preferences';});await page.getByRole('button',{name:'Load saved items'}).click();await page.waitForFunction(()=>test.release);
 await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload page'}).waitFor();assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);assert.equal(await page.evaluate(()=>test.preferenceReads),2);assert.equal(await page.evaluate(()=>test.sends),0);
});
test('preference head failure does not prepare and recovery failure never implies an empty successful view',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'preference',kind:1,target:'10',enabled:false});await unlock(page);await page.evaluate(()=>test.failure='head');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>test.prepares),0);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check account recovery'}).click();await navigateAccount(page,'Follows and bookmarks');await page.evaluate(()=>test.failure='preferences');await page.getByRole('button',{name:'Load saved items'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);
 const feedback=await page.getByRole('alert').textContent();assert.match(feedback,/Private views could not be recovered/);assert.match(feedback,/No transaction was sent/);assert.doesNotMatch(feedback,/PRIVATE_SENTINEL|GETTER_SENTINEL|Check.*transaction/i);assert.equal(await page.evaluate(()=>test.sends),0);
});
test('signing out clears recovered private capability before asynchronous session cleanup settles',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Load saved items'}).click();await page.getByText('Your saved choices are ready.').waitFor();
 await page.evaluate(()=>test.hold='close');await navigateAccount(page,'Sign out');await page.waitForFunction(()=>test.release);assert.notEqual(await page.evaluate(()=>panel.privateStatus()),'complete');await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload page'}).waitFor();
});
test('explicit recovery abort waits for the original private call and does not publish its late complete result',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Load saved items'}).waitFor();
 await page.evaluate(()=>{test.preferenceResults=[{status:'recovering',complete:false,progress:{nextBlock:1}}];test.hold='preferences';});await page.getByRole('button',{name:'Load saved items'}).click();await page.waitForFunction(()=>test.release);await page.getByRole('button',{name:'Stop loading'}).click();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');
 await page.evaluate(()=>test.release());await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>test.preferenceReads),2);assert.equal(await page.evaluate(()=>test.sends),0);
});

test('sign-out stays unavailable while explicit account refresh owns the panel',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 await page.evaluate(()=>test.hold='status');await navigateAccount(page,'Refresh account');await page.waitForFunction(()=>typeof test.release==='function');
 assert(await page.getByRole('button',{name:'Sign out',exact:true}).isDisabled());
 await page.evaluate(()=>{test.hold=null;test.release();});await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 await navigateAccount(page,'Sign out');await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.closes),1);assert.equal(await page.evaluate(()=>test.ended),1);assert.equal((await counts(page)).sends,0);
});

// Recovery decisions are labelled presentation doubles, never genuine chain evidence.
async function seedReplacement(page,{marker=false,status='replacement-available',prepared=false,fullValues=false,action:requestedAction}={}){
 await page.evaluate(({marker,status,prepared,fullValues,requestedAction})=>{
  const hash=n=>'0x'+(fullValues?'1234567890abcdef'.repeat(4):n.toString(16).padStart(64,'0'));
  const head={initialized:true,schema:1,revision:'1',digest:fullValues?'1234567890'.repeat(7)+'123456':'11'};
  const action=requestedAction??(marker?{type:'read-marker',expectedRevision:'1',thread:'42',throughBlock:'10'}:{type:'preference',expectedRevision:'1',kind:1,target:'42',enabled:true});
  test.recoverySnapshot={status,currentTxHash:hash(77),attempts:[{txHash:hash(77),status:'invalid',stateReasons:['Block header not found']}],head,originalPreferenceHead:head,
   marker:marker?{throughBlock:'10',blockHash:hash(44)}:null,originalMarker:marker?{throughBlock:'10',blockHash:hash(43)}:null,
   inclusionHistory:[{txHash:hash(77),inclusions:[{blockNumber:12,blockHash:hash(42),executionResult:'success',transactionFee:'7'}]}]};
  const intent={intentId:'42',status:prepared?'replacement-prepared':'unknown',action,nonce:hash(100),maximumFee:'123',...(prepared?{replacementReview:{sourceTxHash:hash(77),head,marker:marker?test.recoverySnapshot.marker:null,maximumFee:'456'}}:{})};
  sessionStorage.setItem('labelled-ui-intent',JSON.stringify(intent));
 },{marker,status,prepared,fullValues,requestedAction});
 await open(page);await page.getByRole('button',{name:'Check recovery options',exact:true}).waitFor();
}
test('replacement inspection and review never send; confirmation shows distinct ceiling and historical fees',async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page);assert.equal(await page.evaluate(()=>test.recoveryChecks),0);
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Review replacement',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.replacementPrepares),0);assert.equal((await counts(page)).sends,0);
 await page.getByText('Original action and transaction history',{exact:true}).click();assert(await page.getByText(/7 fee-juice units; result success\. Historical record only/).isVisible());assert(await page.getByText('Original saved-settings revision: 1',{exact:true}).isVisible());
 await page.getByRole('button',{name:'Review replacement',exact:true}).click();await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).waitFor();
 assert(await page.getByText(/New maximum network fee: 456 fee-juice units/).isVisible());assert(await page.getByText(/Original maximum fee: 123 fee-juice units/).isVisible());
 assert.deepEqual(await page.evaluate(()=>test.replacementInput),{expectedTxHash:'0x'+(77).toString(16).padStart(64,'0'),expectedHead:{initialized:true,schema:1,revision:'1',digest:'11'}});
 assert.equal((await counts(page)).sends,0);assert.equal(await page.getByRole('button',{name:'Cancel prepared action'}).count(),0);
 await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});
test('changed same-height marker needs explicit consent again after closing before review',async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page,{marker:true});await page.getByRole('button',{name:'Check recovery options'}).click();await page.getByRole('button',{name:'Review replacement',exact:true}).waitFor();
 const consent=page.getByRole('checkbox',{name:'I understand that the same read position now refers to a different block.'});assert(await page.getByRole('button',{name:'Review replacement',exact:true}).isDisabled());await consent.check();
 await page.getByRole('button',{name:'Close account panel'}).click();await open(page);await page.getByRole('button',{name:'Check recovery options'}).click();await consent.waitFor();assert.equal(await consent.isChecked(),false);assert(await page.getByRole('button',{name:'Review replacement',exact:true}).isDisabled());
 await consent.check();await page.getByRole('button',{name:'Review replacement',exact:true}).click();await page.getByRole('button',{name:'Confirm replacement and send'}).waitFor();
 assert.equal(await page.evaluate(()=>test.replacementInput.expectedMarkerHash),'0x'+(44).toString(16).padStart(64,'0'));assert(await page.getByText(/Reviewed read position: block 10/).isVisible());assert.equal((await counts(page)).sends,0);
});
test('reopened replacement restores renewed ceiling without inspecting, preparing or sending automatically',async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page,{prepared:true});assert(await page.getByText(/New maximum network fee: 456/).isVisible());assert.equal(await page.evaluate(()=>test.recoveryChecks+test.replacementPrepares+test.sends),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Confirm replacement and send'}).waitFor();
 assert(await page.getByText(/New maximum network fee: 456/).isVisible());assert.equal(await page.evaluate(()=>test.recoveryChecks+test.replacementPrepares+test.sends),0);
});
for(const status of ['pending','unknown','context-changed','history-unavailable','canonical','limit-reached'])test(`replacement ${status} is honestly fenced without preparation or sending`,async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page,{status});await page.getByRole('button',{name:'Check recovery options'}).click();await page.getByText('Recovery options checked. No transaction was sent.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Review replacement',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.replacementPrepares+test.sends),0);
});
test('failed replacement preparation discards eligibility but preserves saved action and requires explicit recheck',async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page);await page.getByRole('button',{name:'Check recovery options'}).click();await page.getByRole('button',{name:'Review replacement',exact:true}).waitFor();await page.evaluate(()=>test.failure='replacement-prepare');
 await page.getByRole('button',{name:'Review replacement',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Review replacement',exact:true}).count(),0);assert.equal((await counts(page)).sends,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.target),'42');assert(!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check recovery options'}).click();await page.getByRole('button',{name:'Review replacement',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.replacementPrepares),1);
});
test('account invalidation during recovery inspection clears private history and never restores late eligibility',async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page);await page.evaluate(()=>test.hold='recovery-options');await page.getByRole('button',{name:'Check recovery options'}).click();await page.waitForFunction(()=>test.release);
 await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.getByText('Original action and transaction history',{exact:true}).count(),0);assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload page'}).waitFor();assert.equal(await page.getByRole('button',{name:'Review replacement',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.replacementPrepares+test.sends),0);
});

// Full-width canonical values, not shortened fixture identifiers. These are
// synthetic presentation checks; no chain or financial recovery is exercised.
for(const width of [390,1280])for(const phase of ['history','prepared-marker'])test(`recovery full values wrap inside the dialog at ${width}px: ${phase}`,async t=>{
 const {page}=await browserFixture(t);await page.setViewportSize({width,height:844});
 await seedReplacement(page,{marker:true,prepared:phase==='prepared-marker',fullValues:true});
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const hash='0x'+'1234567890abcdef'.repeat(4),digest='1234567890'.repeat(7)+'123456';
 if(phase==='history'){
  await page.getByRole('button',{name:'Check recovery options',exact:true}).click();
  await page.getByText('Original action and transaction history',{exact:true}).click();
  assert.equal(await page.getByText('Original saved-settings fingerprint: '+digest,{exact:true}).textContent(),'Original saved-settings fingerprint: '+digest);
  assert.equal(await page.getByText('Earlier transaction: '+hash,{exact:true}).textContent(),'Earlier transaction: '+hash);
  await page.getByText('Earlier transaction: '+hash,{exact:true}).scrollIntoViewIfNeeded();
 }else{
  const text=`Reviewed read position: block 10; block fingerprint ${hash}.`;
  assert.equal(await page.getByText(text,{exact:true}).textContent(),text);
  await page.getByText(text,{exact:true}).scrollIntoViewIfNeeded();
 }
 const metrics=await page.getByRole('dialog').evaluate(dialog=>({clientWidth:dialog.clientWidth,scrollWidth:dialog.scrollWidth,documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
 t.diagnostic(JSON.stringify({width,phase,...metrics}));
 if(process.env.ROLLING_RECOVERY_SCREENSHOT_DIRECTORY)await page.screenshot({path:`${process.env.ROLLING_RECOVERY_SCREENSHOT_DIRECTORY}/replacement-wrap-${width}-${phase}.png`});
 assert(metrics.scrollWidth<=metrics.clientWidth,`dialog overflows: ${JSON.stringify(metrics)}`);
 assert(metrics.documentWidth<=metrics.viewport);
 assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.replacementPrepares),0);
});

for(const prepared of [false,true])test(`retained ${prepared?'replacement-ready':'unknown'} intent clears loading only after account connection settles`,async t=>{
 const {page}=await browserFixture(t);await seedReplacement(page,{prepared});
 await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>test.hold='status');
 await open(page);await page.waitForFunction(()=>test.release);
 assert(await page.getByRole('heading',{name:'Opening your account…',exact:true}).isVisible());
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'false');
 await page.evaluate(()=>{test.hold=null;test.release();});await page.evaluate(()=>panel.initialize());
 assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);
 assert(await page.getByRole('heading',{name:prepared?'Review replacement before sending':'Transaction recovery',exact:true}).isVisible());
 assert(await page.getByRole('button',{name:prepared?'Confirm replacement and send':'Check existing transaction',exact:true}).isVisible());
 assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.replacementPrepares+test.recoveryChecks),0);
});

test('new actions clear previous confirmation during preparation and submission',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await prepare(page);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();
 await page.evaluate(()=>test.hold='prepare');await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0,'Old confirmation must disappear before the next preparation finishes');
 await page.evaluate(()=>{test.hold=null;test.release();test.release=null;});await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0);
 await page.evaluate(()=>{test.hold='submit';test.submitOutcome='unknown';});await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0);
 assert.equal(await page.getByText('Review the saved action and maximum fee before sending.',{exact:true}).count(),0);
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert(await page.getByText('The transaction is still unconfirmed or unknown. Check later; do not resend.',{exact:true}).isVisible());assert.equal((await counts(page)).sends,2);
});
test('completed refresh and wallet sign-in clear temporary checking messages',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.unlocked=false;test.refreshRecords={status:[{stage:'private-refresh',step:'account-status/method',deploymentStep:null,state:'complete',code:null}]};});
 await open(page,{type:'post'});await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();
 assert.equal(await page.locator('.account-setup-spinner').count(),0);assert.equal(await page.evaluate(()=>test.signIns),1);
 await navigateAccount(page,'Refresh account');await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(await page.getByText('Checking the private account…',{exact:true}).count(),0);
 await navigateAccount(page,'Write a post');await prepare(page);await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Checking the private account…',{exact:true}).count(),0);assert.equal((await counts(page)).sends,1);
});
test('changing action or account view clears old validation feedback and keeps the draft on view changes',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.topupEnabled=true);await open(page);await unlock(page);await page.getByLabel('Action',{exact:true}).selectOption('name');
 await page.getByLabel('First name',{exact:true}).fill('Bok');await page.getByLabel('Last name',{exact:true}).fill('Draft');await page.evaluate(()=>test.nameFailure='ROLLING_NAME_INVALID');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('alert').waitFor();
 await navigateAccount(page,'Add credit');assert.equal(await page.getByRole('alert').count(),0);
 await navigateAccount(page,'Write a post');assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Bok');assert.equal(await page.getByLabel('Last name',{exact:true}).inputValue(),'Draft');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByLabel('Action',{exact:true}).selectOption('subboard');assert.equal(await page.getByRole('alert').count(),0);assert.equal((await counts(page)).sends,0);
});

test('settled connection message cleanup preserves custody guidance and failed connection alert',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);
 await page.evaluate(()=>panel.initialize());
 assert(await page.getByRole('button',{name:'Connect MetaMask',exact:true}).isVisible());assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
 assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>test.failure='status');await open(page);
 await page.getByRole('alert').waitFor();assert(await page.getByText('Your account could not connect. Check your connection and try again.',{exact:true}).isVisible());
 assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);
 assert.equal((await counts(page)).sends,0);
});

// Labelled saved-transaction presentation doubles. Actual bytes, journal guards
// and no-reproof behavior are tested separately in the application/journal suites.
async function seedSavedResume(page,{replacement=false,marker=false,status='resumable',action}={}){
 await seedReplacement(page,{marker,status:'unknown',action});
 await page.evaluate(({replacement,marker,status})=>{
  const hash='0x'+'1234567890abcdef'.repeat(4),old='0x'+'22'.repeat(32),saved=JSON.parse(sessionStorage.getItem('labelled-ui-intent'));
  test.recoverySnapshot.currentTxHash=hash;
  if(marker)test.recoverySnapshot.marker={...test.recoverySnapshot.originalMarker};
  if(replacement){saved.replacementReview={sourceTxHash:old,head:test.recoverySnapshot.head,marker:marker?test.recoverySnapshot.marker:null,maximumFee:'456'};sessionStorage.setItem('labelled-ui-intent',JSON.stringify(saved));}
  test.recoverySnapshot.exactResume={status,txHash:hash,maximumFee:replacement?'456':'123',feeSource:replacement?'replacement':'original',marker:marker?test.recoverySnapshot.marker:null};
 },{replacement,marker,status});
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page);
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
}
for(const replacement of [false,true])test(`saved ${replacement?'replacement':'original'} transaction needs explicit confirmation with its own fee ceiling`,async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{replacement,marker:true});
 assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes),0);
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();const send=page.getByRole('button',{name:'Confirm saved transaction and send',exact:true});await send.waitFor();
 const fee=replacement?'Previously reviewed replacement maximum fee: 456':'Previously approved maximum fee: 123';assert(await page.getByText(new RegExp(fee)).isVisible());
 const hash='0x'+'1234567890abcdef'.repeat(4);assert.equal(await page.getByText('Saved transaction: '+hash,{exact:true}).textContent(),'Saved transaction: '+hash);
 assert(await page.getByText(/Saved read position: block 10; block fingerprint/).isVisible());
 assert.equal(await page.getByRole('button',{name:'Review replacement',exact:true}).count(),0);assert.equal(await page.getByRole('checkbox').count(),0);
 for(const width of [390,1280]){await page.setViewportSize({width,height:844});await send.scrollIntoViewIfNeeded();
  assert.equal(await page.getByRole('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),true);
  if(process.env.ROLLING_RECOVERY_SCREENSHOT_DIRECTORY)await page.screenshot({path:`${process.env.ROLLING_RECOVERY_SCREENSHOT_DIRECTORY}/saved-${replacement?'replacement':'original'}-${width}.png`});
 }
 assert.equal(await page.evaluate(()=>test.resumes+test.prepares+test.replacementPrepares+test.submitCalls),0);
 await send.focus();await page.keyboard.press('Enter');await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>test.resumeInput),{id:'42',expectedTxHash:hash});assert.equal(await page.evaluate(()=>test.resumes),1);
 assert.equal(await page.evaluate(()=>test.prepares+test.replacementPrepares+test.submitCalls),0);assert.equal((await counts(page)).sends,1);
});
for(const status of ['pending','canonical','unknown','empty','context-changed'])test(`saved transaction ${status} never exposes a send action`,async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{status});await page.getByRole('button',{name:'Check recovery options',exact:true}).click();
 await page.getByText('Recovery options checked. No transaction was sent.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes+test.prepares+test.replacementPrepares+test.submitCalls),0);
 if(status==='context-changed')assert(await page.getByText(/no longer matches its required context/).isVisible());
});
for(const mutation of ['hash','fee','fee-source','source-candidate','marker','missing','contradictory'])test(`saved transaction ${mutation} metadata cannot grant confirmation`,async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{replacement:true,marker:true});
 await page.evaluate(mutation=>{const s=test.recoverySnapshot;if(mutation==='hash')s.exactResume.txHash='0x'+'33'.repeat(32);
  if(mutation==='fee')s.exactResume.maximumFee='999';if(mutation==='fee-source')s.exactResume.feeSource='original';
  if(mutation==='source-candidate'){const saved=JSON.parse(sessionStorage.getItem('labelled-ui-intent'));saved.replacementReview.sourceTxHash=s.exactResume.txHash;sessionStorage.setItem('labelled-ui-intent',JSON.stringify(saved));}
  if(mutation==='marker')s.exactResume.marker={throughBlock:'10',blockHash:'0x'+'33'.repeat(32)};
  if(mutation==='missing')delete s.exactResume;if(mutation==='contradictory')s.status='canonical';
 },mutation);
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByText('Recovery options checked. No transaction was sent.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes),0);
});
test('saved transaction eligibility is RAM-only and clears on close and reload',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page);await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).waitFor();
 await page.keyboard.press('Escape');await open(page);assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check recovery options',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes),0);
});
test('unknown saved transaction send clears eligibility and cannot automatically replay',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page);await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).waitFor();
 await page.evaluate(()=>{test.failure='saved-resume';test.hold='saved-resume';});await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).click();await page.waitForFunction(()=>test.release);
 await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);
 assert.equal(await page.getByText('Recovery options checked. No transaction was sent.',{exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>test.resumes),1);assert.equal(await page.evaluate(()=>test.submitCalls+test.prepares+test.replacementPrepares),0);
 await page.getByRole('button',{name:'Check existing transaction',exact:true}).click();assert.equal(await page.evaluate(()=>test.resumes),1);
});
test('account invalidation during saved send keeps busy and hides all late recovery values',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page);await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).waitFor();
 await page.evaluate(()=>test.hold='saved-resume');await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).click();await page.waitForFunction(()=>test.release);
 await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.getByText(/Saved transaction: 0x/).count(),0);assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes),1);
});

// Actual production panel + exact campaign interaction helper. Application
// callbacks remain labelled doubles; this cannot qualify real proofs/recovery.
test('notification campaign reviews, confirms, then navigates to private recovery',async t=>{
 const {reviewRollingNotificationAction}=await import('../../scripts/testing/rolling-notification-browser.mjs');
 const {waitForRollingComposerState}=await import('../../scripts/testing/rolling-composer-browser.mjs');
 const {page}=await browserFixture(t);await open(page,{type:'preference',kind:4,target:'10',enabled:true});await unlock(page);
 const d=page.getByRole('dialog',{});let expires=Date.now()+3000;
 const remaining=()=>{const value=expires-Date.now();assert(value>0);return value;};
 const settled=async ready=>assert.equal(await waitForRollingComposerState({dialog:d,ready,remaining}),'ready');
 let recovered=0;const phases=[],steps=[];
 async function run(reviewText){expires=Date.now()+3000;await reviewRollingNotificationAction({dialog:d,remaining,settled,reviewText,onStep:step=>steps.push(step),onReviewed:()=>phases.push('reviewed'),onConfirm:()=>phases.push('confirmed-send'),onConfirmed:()=>phases.push('included'),recover:async()=>{
  const button=d.getByRole('button',{name:'Load saved items',exact:true});await settled(button);await button.click({timeout:remaining()});await settled(d.getByText('Your saved choices are ready.',{exact:true}));recovered++;
 }});}
 await run('Enable thread subscription for 10. This preference is encrypted, not a public ownership list.');assert.equal(recovered,1);assert.equal((await counts(page)).sends,1);
 await d.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{type:'read-marker',thread:'10',throughBlock:'80'});
 await run('Mark this thread read through block 80');assert.equal(recovered,2);assert.equal((await counts(page)).sends,2);assert.deepEqual(phases,['reviewed','confirmed-send','included','reviewed','confirmed-send','included']);assert.deepEqual(steps,Array(2).fill(['fee-review','send','confirmation','private-navigation-ready','private-navigation-click','private-recovery','recovered']).flat());
});

test('cold private view cannot prepare a preference before checking retained financial recovery',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});
 await page.getByRole('button',{name:'Load saved items',exact:true}).click();await page.getByText('Your saved choices are ready.').waitFor();
 assert.equal(await page.evaluate(()=>test.statusReads),0);assert.equal(await page.evaluate(()=>test.owned),0);
 await page.getByRole('button',{name:'Disable reply notifications',exact:true}).click();
 await page.getByRole('button',{name:'Check account recovery',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>test.prepares),0);assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Check account recovery',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.statusReads),1);assert.equal(await page.evaluate(()=>test.owned),1);
});

// Actual DOM with a labelled initialization emitter. No real session or chain.
test('fixed nested initialization failure preserves generic UI and retry clears stale attempt',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.failure='session';test.initializationRecords=[{stage:'session-initialization',step:'deployment',deploymentStep:'board-instance',state:'failed',code:'ROLLING_DEPLOYMENT_INVALID'}];});
 await open(page,{view:'preferences'});await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'session-initialization',step:'deployment',deploymentStep:'board-instance',state:'failed',code:'ROLLING_DEPLOYMENT_INVALID'});
 assert.match(await page.getByRole('alert').innerText(),/Your account could not connect/);assert(!await dialog.innerText().then(s=>s.includes('board-instance')||s.includes('PRIVATE_SENTINEL')));
 await page.evaluate(()=>{test.oldProgress=test.sessionProgress;test.failure=null;test.hold='session';test.initializationRecords=[];});await page.getByRole('button',{name:'Reconnect',exact:true}).click();await page.waitForFunction(()=>test.sessions===2&&test.release);
 assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);await page.evaluate(()=>test.oldProgress({stage:'session-initialization',step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'}));assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);
 await page.evaluate(()=>{test.sessionProgress({stage:'session-initialization',step:'application-bind',deploymentStep:null,state:'complete',code:null});test.release();});await page.getByRole('button',{name:'Load saved items',exact:true}).waitFor();
 assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'application-bind');assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.preferenceReads,test.sends]),[0,0,0,0]);
});
test('initialization projection ignores accessors and account invalidation clears late observations',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.initializationRecords=[{stage:'session-initialization',step:'application-bind',deploymentStep:null,state:'complete',code:null}];});await open(page,{view:'preferences'});await page.getByRole('button',{name:'Load saved items',exact:true}).waitFor();
 await page.evaluate(()=>{test.getterReads=0;const bad={step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'};Object.defineProperty(bad,'stage',{get(){test.getterReads++;throw Error('PRIVATE_SENTINEL');}});test.sessionProgress(bad);});assert.equal(await page.evaluate(()=>test.getterReads),0);
 const dialog=page.getByRole('dialog');assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'application-bind');
 await page.evaluate(()=>{test.rawAccount={address:'OTHER_PRIVATE_SENTINEL'};test.options.onChange({invalidated:true});test.sessionProgress({stage:'session-initialization',step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'});});
 assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')));assert.equal((await counts(page)).sends,0);
});

test('Bok composer reviews credit and both fees, restores authorized draft and never auto-publishes',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000000';test.refreshRecords={submit:[{stage:'submitting'}]};});await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByText('Available private Bok credit: 1 USDC.',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).inputValue(),'0.25');
 await page.getByText('New conversation',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Main board',exact:true}).getAttribute('href'),'#/board/0');assert.equal(await page.getByLabel('Reply to post ID').count(),0);
 await page.getByLabel('Message',{exact:true}).fill('Ask Bok with the exact saved draft');await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).fill('0.10');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);await page.getByText('Maximum Bok request cost: 0.1 USDC. This ceiling is separate from network fees; the actual charge may be lower.',{exact:true}).waitFor();
 assert(await page.getByText('Private Bok balance checked for this authorization: 1 USDC.',{exact:true}).isVisible());assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.budget),'100000');
 assert(await page.getByText('This step authorizes the saved Bok budget privately and charges a network fee. Your post is not published yet; publication needs separate confirmation.',{exact:true}).isVisible());assert.equal(await page.getByText('Your exact action is saved. Sending publishes it onchain and cannot be undone.',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,1);assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);assert.equal(await page.getByText('Proving and submitting. Keep this page open; do not send again.',{exact:true}).count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);
 await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();assert.equal((await counts(page)).sends,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.budget),'100000');await page.getByText('Maximum Bok request cost: 0.1 USDC. This ceiling is separate from network fees; the actual charge may be lower.',{exact:true}).waitFor();
 await page.getByText('content: Ask Bok with the exact saved draft',{exact:true}).waitFor();
 await page.evaluate(()=>{test.refreshRecords={'bok-continue':[{stage:'estimating'}]};test.hold='bok-continue';});await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.waitForFunction(()=>test.release);
 assert(await page.getByText('Checking the action and its maximum fee…',{exact:true}).isVisible());assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();assert.equal(await page.getByText('Checking the action and its maximum fee…',{exact:true}).count(),0);
 await page.getByText('Maximum network fee: 234 fee-juice units. This is a maximum, not a guaranteed final charge.',{exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal(await page.getByRole('button',{name:'Cancel prepared action',exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});
test('Bok composer hides unavailable capability and rejects unaffordable budgets before preparation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);assert.equal(await page.locator('option[value="bok"]').count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>test.bokCredit='20');await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Message',{exact:true}).fill('Bok draft');
 for(const budget of ['0','0.000021','-1','1e2','0.0000011','0.0000010',' 0.000001','0.000001 ','01']){await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).fill(budget);assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled(),true);}
 assert.equal((await counts(page)).prepares,0);
});

test('Bok budget converts exact six-decimal amounts to raw units without Number rounding',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='9007199254740993');await open(page);await unlock(page);await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Message',{exact:true}).fill('Exact budget');
 assert(await page.getByText('Available private Bok credit: 9007199254.740993 USDC.',{exact:true}).isVisible());
 for(const [amount,raw]of [['0.000001','1'],['1.000001','1000001'],['9007199254.740993','9007199254740993']]){
  await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).fill(amount);await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.budget),raw);assert(await page.getByText('Maximum Bok request cost: '+amount+' USDC. This ceiling is separate from network fees; the actual charge may be lower.',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).waitFor();
 }
 assert.equal((await counts(page)).sends,0);
});

test('Bok continuation failure preserves authorized recovery without another credit authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'authorized',action:{type:'bok',content:'Saved Bok draft',budget:'400'},maximumFee:'123',bok:{phase:'authorize',budget:'400',availableCredit:'1000'}}));test.failure='bok-continue';});
 await open(page);await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'authorized');
});

test('Bok reverted post stays in explicit saved-request recovery after reopen without a new authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'43',status:'bok-post-reverted',action:{type:'bok',content:'Saved funded Bok draft',budget:'400',subboard:'0',parent:'0',root:'0'},maximumFee:'123',bok:{phase:'post',budget:'400',availableCredit:'1000',authorizationTxHash:'confirmed-authorize'}}));});
 await open(page);await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 await page.getByText(/The post reverted. Its paid network fee is not refunded/).waitFor();assert(await page.getByText('Maximum Bok request cost: 0.0004 USDC. This ceiling is separate from network fees; the actual charge may be lower.',{exact:true}).isVisible());assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.budget),'400');assert.equal(await page.getByLabel('Action',{exact:true}).count(),0);
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
 await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);assert.equal(await page.getByRole('button',{name:'Cancel prepared action',exact:true}).count(),0);
 await page.evaluate(()=>{test.submitOutcome='bok-post-reverted';test.refreshRecords={submit:[{stage:'submitting'}]};});await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();assert(await page.getByText('The Bok post reverted. A network fee may have been charged. The funded request remains saved; no action is retried automatically.',{exact:true}).isVisible());assert.equal(await page.getByText('The transaction is still unconfirmed or unknown. Check later; do not resend.',{exact:true}).count(),0);assert.equal(await page.getByText('Proving and submitting. Keep this page open; do not send again.',{exact:true}).count(),0);
});

test('Moderator controls stay hidden from ordinary authors including forged action defaults',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'moderate-post'});await unlock(page);assert.equal(await page.locator('option[value="moderate-post"]').count(),0);assert.equal(await page.getByLabel('Public moderation reason',{exact:true}).count(),0);assert.equal((await counts(page)).sends,0);
});
test('Moderator removal reviews literal reason, target, policy and fee with explicit confirmation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.moderator=true);await open(page);await unlock(page);await page.getByLabel('Action',{exact:true}).selectOption('moderate-post');
 await page.getByLabel('Post ID',{exact:true}).fill('8');await page.getByLabel('Public moderation reason',{exact:true}).fill('<script>Literal rule breach</script>');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 await page.getByText('Reviewed parent rules version: 3.',{exact:true}).waitFor();assert.equal(await page.locator('dialog script').count(),0);assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'moderate-post',post:'8',reason:'<script>Literal rule breach</script>'});
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});
test('Moderator form exposes only contract-supported operations and bounds UTF8 input',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.moderator=true);await open(page);await unlock(page);
 for(const kind of ['moderate-avatar','reject-subboard','set-main-policy']){await page.getByLabel('Action',{exact:true}).selectOption(kind);const field=kind==='set-main-policy'?page.getByLabel('New parent rules',{exact:true}):page.getByLabel('Public moderation reason',{exact:true});if(kind!=='set-main-policy')await page.getByLabel(kind==='moderate-avatar'?'Profile name ID':'Subboard ID',{exact:true}).fill('7');await field.fill('é'.repeat(kind==='set-main-policy'?497:109));assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled(),true);}
 assert.equal((await counts(page)).prepares,0);assert.equal(await page.locator('option[value="hide-post"]').count(),0);
});

test('Moderator avatar review identifies the public target without claiming ownership or needing collateral',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.moderator=true;test.fee='collateral-pending';});await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('moderate-avatar');await page.getByLabel('Profile name ID',{exact:true}).fill('99');await page.getByLabel('Public moderation reason',{exact:true}).fill('Image violates parent rules');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 await page.getByText('name: 99',{exact:true}).waitFor();await page.getByText('Reviewed avatar version: 2.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,0);
 assert.equal((await page.getByRole('dialog').innerText()).includes('Selected owned name'),false);
});

test('Moderator contextual defaults retain exact public avatar target and capability clears synchronously on account invalidation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.moderator=true);await open(page);await unlock(page);
 assert.equal(await page.evaluate(()=>panel.moderatorAuthorized()),true);
 await page.getByRole('button',{name:'Close account panel'}).click();await open(page,{type:'moderate-avatar',name:'99'});
 await page.getByLabel('Profile name ID',{exact:true}).waitFor();assert.equal(await page.getByLabel('Profile name ID',{exact:true}).inputValue(),'99');
 await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.evaluate(()=>panel.moderatorAuthorized()),false);
 assert.equal((await counts(page)).sends,0);
});

test('funding wallet selection is explicit, escaped and never prepares or sends a payment',async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{test.walletChoices=[{id:'metamask',name:'MetaMask'},{id:'phantom',name:'Phantom <script>'}];});
 await open(page);await unlock(page);await navigateAccount(page,'Set up posting');
 assert.equal(await page.evaluate(()=>test.walletConnects??0),0);
 assert(await page.getByRole('button',{name:'Connect Phantom <script>',exact:true}).isVisible());
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByText('MetaMask 0x1111…1111',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({selected:test.walletSelected,connections:test.walletConnects,prepares:test.prepares,sends:test.sends})),{selected:'metamask',connections:1,prepares:0,sends:0});
 assert(await page.getByText('MetaMask 0x1111…1111',{exact:false}).isVisible());
 assert.equal(await page.locator('body').innerText().then(v=>v.includes('HUMAN_IDENTITY_SENTINEL')),false);
});

test('rejected funding connection retains recovery and sends nothing',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.walletChoices=[{id:'metamask',name:'MetaMask'}];test.failure='funding-wallet';});
 await open(page);await unlock(page);await navigateAccount(page,'Set up posting');await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByRole('alert').waitFor();assert(!((await page.getByRole('alert').innerText()).includes('PRIVATE_SENTINEL')));
 assert(await page.getByRole('button',{name:'Connect MetaMask',exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>test.sends),0);
});
async function aggregateQuote(page,slippage){
 await navigateAccount(page,'Set up posting');

 assert.equal(await page.getByLabel('Slippage limit (%)',{exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
}
test('aggregate funding UI reviews exact allocations and consent before one payment and one bounded private claim',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page);
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>test.fundingAllocation),{asset:'ETH',collateralWei:'100000000000000000',feeAmount:'2000',bokAmount:'1000000',gasBudgetWei:'3000000000000000',feePoolFee:3000,bokPoolFee:3000,slippageBps:100,privateFeeCap:'1000'});
 assert(await page.getByText(/Approve the payment in your wallet/).isVisible());
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByText('Payment confirmed.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.fundingClaim.attempted),true);
});
test('initial funding entry exposes allocations without a recovery receipt or payment',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fee='fee-needed';});await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');
 assert.equal(await page.getByLabel('Posting deposit (ETH)',{exact:true}).count(),0);await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert(await page.getByText('Already paid?',{exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>test.fundingPrepares??0),1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
});
for(const [account,bok,expected] of [['fee-ready','3250000','Posting collateral and network fee credit were found.'],['fee-needed','0','Network fee credit is still needed.'],['collateral-pending',undefined,'Network fee credit was found; posting collateral is not yet available.']])test('funding completion reports refreshed '+account+' and Bok credit without claiming readiness',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page);
 await page.evaluate(({account,bok})=>{test.fee=account;test.bokCredit=bok;test.hold='submit';},{account,bok});
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
 await page.waitForFunction(()=>typeof test.release==='function');
 // Hold the refresh after the transaction confirms, rather than the account
 // status read used to prepare the claim. Confirmation alone is not readiness.
 await page.evaluate(()=>{test.hold='status';const release=test.release;test.release=null;release();});
 await page.waitForFunction(()=>typeof test.release==='function');
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'confirmed');
 assert.equal(await page.getByText('Payment confirmed. Your posting balance is set up.',{exact:true}).count(),0);
 await page.evaluate(()=>{test.hold=null;test.release();});
 await page.getByText(account==='fee-ready'?'Payment confirmed. Your posting balance is set up.':'Payment confirmed. Your posting balance is still being checked. Refresh your account before posting.',{exact:true}).waitFor();
 const text=await page.getByRole('dialog').innerText();assert(text.includes(account==='fee-ready'?'Payment confirmed. Your posting balance is set up.':'Your posting balance is still being checked.'));assert(!text.includes('You’re ready to post'));assert(!text.includes('You are ready to post'));
 assert(!text.includes('Bok credit are ready'));assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);
});
for(const [code,expected] of [['AGGREGATE_PUBLIC_READ_FAILED','could not be verified against current Ethereum state'],['AGGREGATE_STALE_QUOTE','quote has expired on Ethereum'],['AGGREGATE_INSUFFICIENT_USER_FUNDS','does not have enough funds']])test('funding quote refusal gives fixed actionable text for '+code,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(code=>{test.aggregateEnabled=true;test.fundingQuoteFailure=code;},code);await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');

 await page.getByRole('alert').waitFor();
 const text=await page.getByRole('alert').innerText();assert(text.includes(expected));assert(!text.includes('PRIVATE_SENTINEL'));
 assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});
test('aggregate gas refusal explains explicit changed maximum and requires a fresh quote and confirmation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fundingGasChanged=true;});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
 await page.getByRole('button',{name:'Refresh price',exact:true}).waitFor();
 assert.match(await page.getByRole('alert').innerText(),/Ethereum gas costs exceed your approved maximum/);
 assert.match(await page.getByRole('alert').innerText(),/fresh price and review/);
 assert(!await page.getByRole('dialog').innerText().then(text=>text.includes('PRIVATE_SENTINEL')));
 assert.equal(await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>({quotes:test.fundingPrepares,confirms:test.fundingConfirms,payments:test.fundingPayments??0,sends:test.sends})),{quotes:1,confirms:1,payments:0,sends:0});

 await page.evaluate(()=>{test.fundingGasChanged=false;test.gasBudget='4000000000000000';});
 assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);
 await page.getByRole('button',{name:'Refresh price',exact:true}).click();
 await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingAllocation.gasBudgetWei),'4000000000000000');
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();
 await page.getByText('Payment confirmed.',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({quotes:test.fundingPrepares,confirms:test.fundingConfirms,payments:test.fundingPayments,sends:test.sends})),{quotes:2,confirms:2,payments:1,sends:1});
});
test('aggregate funding UI pauses a larger private claim fee without another Ethereum payment',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fundingCap='100';});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByText('The private claim needs a new review.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.fundingClaim.attempted),false);
});
test('aggregate funding UI reconciles an unknown claim without repeat payment or submission',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.submitOutcome='unknown';});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByText('The saved private claim remains unresolved.',{exact:false}).waitFor();
 await resumeFunding(page);
 await page.waitForFunction(()=>test.reconciles===1);assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);
 await page.getByRole('button',{name:'Close account panel'}).click();
});
test('aggregate funding UI links an exact prepared claim after checkpoint interruption without preparing twice',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');await page.evaluate(()=>{
  test.paymentSaved=true;const r={txHash:'0x'+'1'.repeat(64)};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:r,feeReceipt:r,bokReceipt:r},maximumFee:'123',status:'prepared'}));
 });
 await resumeFunding(page);await page.getByText('Payment confirmed.',{exact:false}).waitFor();
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});
test('aggregate funding UI exposes explicit saved review after attempt checkpoint precedes submission',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await navigateAccount(page,'Set up posting');
 await page.evaluate(()=>{test.paymentSaved=true;test.fundingClaim={intentId:'42',attempted:true};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:{}},maximumFee:'123',status:'prepared'}));});
 await resumeFunding(page);await page.getByText('This saved claim has not been submitted.',{exact:false}).waitFor();
 assert.equal((await counts(page)).sends,0);assert(await page.getByRole('button',{name:'Confirm and send',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Pause payment checks',exact:true}).count(),0);
});

test('aggregate funding UI sets price tolerance without asking users for basis points',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page,'0.75');
 assert.equal(await page.evaluate(()=>test.fundingAllocation.slippageBps),100);assert.equal(await page.getByLabel('Slippage limit (%)').count(),0);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
});

test('USDC funding UI reviews two signatures and total relay reimbursement without asking the user for ETH gas',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.usdcEnabled=true;});await open(page);await unlock(page);await navigateAccount(page,'Set up posting');
 await page.getByLabel('Pay with',{exact:true}).selectOption('USDC');assert.equal(await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).count(),0);

 await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert(await page.getByText(/two signatures/).isVisible());assert(await page.getByText('7.1 USDC',{exact:true}).isVisible());
 const allocation=await page.evaluate(()=>test.fundingAllocation);assert.equal(allocation.asset,'USDC');assert.equal(allocation.collateralPoolFee,3000);assert.equal(allocation.gasBudgetWei,undefined);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByText('Payment confirmed.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);
});

for(const status of ['reverted','cancelled'])test(`canonical ${status} funding claim requires explicit renewed review and never repeats the original payment`,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await navigateAccount(page,'Set up posting');
 await page.evaluate(status=>{test.paymentSaved=true;test.fundingClaim={intentId:'42',attempted:true};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:{amount:'100'}},maximumFee:'123',status}));},status);
 await resumeFunding(page);await page.getByRole('button',{name:'Review private claim again',exact:true}).click();
 await page.getByText('The private claim needs a new review.',{exact:false}).waitFor();assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.waitForFunction(()=>test.sends===1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});

for(const kind of ['private-fee','bok'])test(`standalone ${kind} UI continues approval, deposit and private claim without extra review clicks`,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.topupEnabled=true;test.bokCredit='2500000';});await open(page);await unlock(page);await navigateAccount(page,'Add credit');
 assert(await page.getByText('Posting balance pays for posts and account updates. Bok credit pays for requests to the AI assistant.',{exact:true}).isVisible());await page.getByLabel('Top-up credit',{exact:true}).selectOption(kind);await page.getByLabel(kind==='bok'?'Bok credit (USD)':'Fee token top-up amount',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Review cost',exact:true}).click();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
 await page.getByRole('button',{name:'Add credit',exact:true}).click();await page.getByText('Top-up and private claim confirmed. Your posting collateral is unchanged.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.topupPayments),2);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.type),kind==='bok'?'claim-bok':'claim-private-fee');assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});
test('standalone top-up failed review and changed account never reach a payment',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.topupEnabled=true;test.failure='topup-review';});await open(page);await unlock(page);await navigateAccount(page,'Add credit');await page.getByLabel('Fee token top-up amount',{exact:true}).fill('3');await page.getByRole('button',{name:'Review cost',exact:true}).click();await page.getByText(/could not/).first().waitFor();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
 await page.evaluate(()=>{test.failure=null;test.rawAccount={...test.rawAccount};});await page.getByRole('button',{name:'Review cost',exact:true}).click();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
});

async function openBalances(page,{reason='eligible',nextCursor=null}={}){
 await page.evaluate(({reason,nextCursor})=>{test.balances={fee:{available:'2000000000000000000'},bok:{available:'3000000',requestsComplete:false,requests:[]},collateral:{deposits:[{id:'9',amount:'100000000000000000',eligible:reason==='eligible',reason,nextAllowedTime:'100'}],nextCursor}};},{reason,nextCursor});
 await open(page);await unlock(page);await navigateAccount(page,'Balance and withdrawals');await page.getByRole('button',{name:'Check private balances',exact:true}).click();await page.getByRole('button',{name:'Review collateral exit',exact:true}).waitFor();
}
test('RC22 panel separates private balances and maturity without creating transactions or claiming complete Bok reservations',async t=>{
 const {page}=await browserFixture(t);await openBalances(page,{reason:'time-locked',nextCursor:10});
 assert(await page.getByText('Available network fees: 2 FEE.',{exact:true}).isVisible());assert(await page.getByText('Unallocated Bok credit: 3 USDC.',{exact:true}).isVisible());assert(await page.getByText(/unlisted reservations are not zero/).isVisible());assert(await page.getByRole('button',{name:'Review collateral exit',exact:true}).isDisabled());
 assert.equal(await page.evaluate(()=>test.prepares),0);await page.getByRole('button',{name:'Next collateral page',exact:true}).click();assert.equal(await page.evaluate(()=>test.balanceCursor),10);assert.equal(await page.evaluate(()=>test.sends),0);
});
test('RC22 panel requires separate explicit exit and refund fee reviews and cancellation sends nothing',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.getByRole('button',{name:'Review collateral exit',exact:true}).click();
 assert(await page.getByText(/Maximum network fee: 123/).isVisible());assert.equal(await page.evaluate(()=>test.sends),0);await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),1);assert.equal(await page.evaluate(()=>test.refundSends??0),0);await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).click();await page.getByRole('button',{name:'Cancel refund review',exact:true}).click();assert.equal(await page.evaluate(()=>test.refundSends??0),0);
 await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).click();await page.getByRole('button',{name:'Confirm Ethereum refund',exact:true}).click();await page.getByText(/Ethereum refund confirmed: 0.1 ETH/).waitFor();assert.equal(await page.evaluate(()=>test.refundSends),1);
});
test('RC22 reopened exit recovers an existing refund read-only and never duplicates the exit',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.getByRole('button',{name:'Review collateral exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).waitFor();
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check existing refund',exact:true}).waitFor();await page.evaluate(()=>test.refundFound=true);await page.getByRole('button',{name:'Check existing refund',exact:true}).click();await page.getByText('The saved Ethereum refund is confirmed.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);assert.equal(await page.evaluate(()=>test.refundChecks),1);
});

test('refresh diagnostic survives connect sanitizer and retry then clears on account invalidation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.failure='status';test.refreshRecords={status:[{stage:'private-refresh',step:'account-status/account-initialize',deploymentStep:null,state:'failed',code:'unknown'}]};});
 await open(page);await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'account-status/account-initialize');assert.equal(await page.getByRole('button',{name:'Check account recovery',exact:true}).isVisible(),true);
 assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')||s.includes('account-initialize')));
 await page.evaluate(()=>{test.failure='owned';test.refreshRecords={status:[{stage:'private-refresh',step:'account-status/method',deploymentStep:null,state:'complete',code:null}],owned:[{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'failed',code:'ROLLING_ABI_MISMATCH'}]};});
 await page.getByRole('button',{name:'Check account recovery',exact:true}).click();await navigateAccount(page,'Your names');await page.waitForFunction(()=>test.owned===1&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'failed',code:'ROLLING_ABI_MISMATCH'});
 await page.evaluate(()=>{test.failure=null;test.refreshRecords={owned:[{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'complete',code:null}]};});await page.getByRole('button',{name:'Load your names',exact:true}).click();await page.getByRole('button',{name:'Edit bio for River Lane',exact:true}).waitFor();assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).state,'complete');
 await page.evaluate(()=>{test.rawAccount={address:'OTHER_PRIVATE_SENTINEL'};test.options.onChange({invalidated:true});test.sessionProgress({stage:'private-refresh',step:'account-status/method',deploymentStep:null,state:'failed',code:'unknown'});});assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);assert.equal((await counts(page)).sends,0);
});

test('claim progress distinguishes saved records, preparation and confirmation without claiming submission success',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 const messages={inspect:'Checking saved funding records…',recover:'Verifying your original payment and bridge delivery…','account-status':'Checking the account before claiming funds…',prepare:'Preparing the private claim and checking its fee…',checkpoint:'Saving private claim recovery records…',submit:'Processing the private claim. Keep this page open; do not send again.',reconcile:'Checking confirmation of the saved private claim…'};
 for(const [step,message]of Object.entries(messages))for(const state of ['started','complete']){
  await page.evaluate(({step,state})=>test.sessionProgress({stage:'funding-claim',step,deploymentStep:null,state,code:null}),{step,state});
  await page.getByText(message,{exact:true}).waitFor({timeout:1000});
  assert.equal(await page.getByText('Checking the private account…',{exact:true}).count(),0);
 }
 await page.evaluate(()=>test.sessionProgress({stage:'funding-claim',step:'submit',deploymentStep:null,state:'failed',code:'unknown'}));
 await page.getByText('This funding step could not be completed. Your recovery records are preserved.',{exact:true}).waitFor({timeout:1000});
 assert.deepEqual(await page.evaluate(()=>[test.prepares,test.sends,test.reconciles,test.fundingPayments??0]),[0,0,0,0]);
});

test('claim progress exposes only fixed preparation failure in DOM and clears it after account invalidation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.paymentSaved=true;});await open(page);await unlock(page);await navigateAccount(page,'Set up posting');
 await page.evaluate(()=>test.failure='prepare');await resumeFunding(page);await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'funding-claim',step:'prepare',deploymentStep:null,state:'failed',code:'unknown'});
 assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')||s.includes('GETTER_SENTINEL')||s.includes('funding-claim')));assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>{test.rawAccount={address:'OTHER_PRIVATE_SENTINEL'};test.options.onChange({invalidated:true});test.sessionProgress({stage:'funding-claim',step:'submit',deploymentStep:null,state:'failed',code:'unknown'});});assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);
});
test('RC22 one explicit Bok accounting check completes bounded pages without partial or double-counted totals',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.accountingComplete={complete:true,anchor:{blockNumber:7},available:'3000000',totals:{available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'},requests:[{requestId:'0x'+'1'.repeat(64),state:'2',available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'}]};test.accountingPages=[{complete:false,phase:'owned-requests',nextCursor:'opaque-one',requests:[]},new Promise(resolve=>test.releaseOwnership=resolve),new Promise(resolve=>test.releaseAccounting=resolve)];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.waitForFunction(()=>test.accountingReads?.length===2);
 assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,'opaque-one']);assert(await page.getByText(/Checking private ownership pages. No partial total is presented/).isVisible());assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.getByRole('button',{name:'Stop checking requests',exact:true}).focus();await page.evaluate(()=>test.releaseOwnership({complete:false,phase:'public-accounting',nextCursor:'opaque-two',requests:[]}));await page.waitForFunction(()=>test.accountingReads.length===3);
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Stop checking requests');assert(await page.getByText(/Checking uniform public accounting pages. No partial total is presented/).isVisible());assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);
 await page.evaluate(()=>test.releaseAccounting(test.accountingComplete));await page.getByText(/Complete owned-request accounting at block 7/).waitFor();assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,'opaque-one','opaque-two']);
 assert(await page.getByText('Unallocated Bok credit: 3 USDC.',{exact:true}).isVisible());assert(await page.getByText(/Returned credit is already part/).isVisible());assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.prepares),0);
 await page.getByRole('button',{name:'Refresh balances',exact:true}).click();await page.getByText(/unlisted reservations are not zero/).waitFor();assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);
});
test('RC22 Bok accounting stop discards a late result before an explicit new check and release review',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.accountingComplete={complete:true,anchor:{blockNumber:7},available:'3000000',totals:{available:'2000000',reserved:'0',charged:'0',refunded:'0'},requests:[{requestId:'0x'+'1'.repeat(64),state:'1',available:'2000000',reserved:'0',charged:'0',refunded:'0'}]};test.accountingPages=[new Promise(resolve=>test.releaseAccounting=resolve),test.accountingComplete];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.waitForFunction(()=>test.accountingReads?.length===1);await page.getByRole('button',{name:'Stop checking requests',exact:true}).click();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);
 await page.evaluate(()=>test.releaseAccounting(test.accountingComplete));await page.getByRole('button',{name:'Check all Bok requests',exact:true}).waitFor();assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.getByRole('button',{name:'Review release of unused credit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,0]);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.type),'cancel-bok-request');assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();assert.equal(await page.evaluate(()=>test.sends),0);
});
for(const outcome of ['invalidated','failed','malformed'])test('RC22 Bok accounting '+outcome+' fences incomplete results without further reads',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.accountingPages=[{complete:false,phase:'public-accounting',nextCursor:'opaque-one',requests:[]},new Promise((resolve,reject)=>{test.releaseAccounting=resolve;test.failAccounting=reject;})];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.waitForFunction(()=>test.accountingReads?.length===2);
 await page.evaluate(outcome=>{if(outcome==='invalidated')test.options.onChange({invalidated:true});if(outcome==='failed')test.failAccounting(Error('PRIVATE_SENTINEL'));else test.releaseAccounting(outcome==='malformed'?{complete:false,phase:'public-accounting',nextCursor:null}: {complete:true,available:'999999999',totals:{},requests:[]});},outcome);
 if(outcome==='invalidated')await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();else await page.getByRole('alert').waitFor();
 assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,'opaque-one']);assert.equal(await page.evaluate(()=>test.sends),0);assert(!(await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'));
});
test('RC22 Bok panel separates private exit and saved-recipient Ethereum refund across reopen',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.fundingWallet={connected:true,name:'MetaMask',address:'0x'+'3'.repeat(40)};});
 await page.getByLabel('Bok credit to withdraw in USDC',{exact:true}).fill('1.25');await page.getByRole('button',{name:'Review Bok credit exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.amount),'1250000');assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText(/Refund: 1.25 USDC/).waitFor();assert.equal(await page.evaluate(()=>test.sends),1);assert.equal(await page.evaluate(()=>test.refundSends??0),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check existing refund',exact:true}).waitFor();await page.getByRole('button',{name:'Check existing refund',exact:true}).click();await page.getByText(/Refund unknown/).waitFor();assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);
 await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).click();await page.getByRole('button',{name:'Confirm Ethereum refund',exact:true}).click();await page.getByText(/Ethereum refund confirmed: 1.25 USDC/).waitFor();assert.equal(await page.evaluate(()=>test.refundSends),1);assert.equal(await page.evaluate(()=>test.sends),0);
});

async function openExpiryReview(page){
 await openBalances(page);await page.evaluate(()=>{test.accountingPages=[{complete:true,anchor:{blockNumber:7},available:'3000000',totals:{available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'},requests:[{requestId:'0x'+'1'.repeat(64),state:'2',available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'}]}];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.getByRole('button',{name:'Review request expiry',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
}
test('RC22 expiry panel requires a separate fee review and cancellation does not send',async t=>{
 const {page}=await browserFixture(t);await openExpiryReview(page);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.type),'expire-bok-request');
 assert(await page.getByText(/Maximum network fee: 123/).isVisible());assert(await page.getByText(/Confirmation does not mean the whole budget was refunded/).isVisible());
 assert.equal(await page.evaluate(()=>test.sends),0);await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();assert.equal(await page.evaluate(()=>test.sends),0);
});
test('RC22 expiry panel preserves unknown transaction on reopen and reports canonical partial refund without another send',async t=>{
 const {page}=await browserFixture(t);await openExpiryReview(page);await page.evaluate(()=>test.submitOutcome='unknown');await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),1);await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);
 await page.evaluate(()=>test.resolveOutcome='confirmed');await page.getByRole('button',{name:'Check existing transaction',exact:true}).click();await page.getByText(/Expiry transaction confirmed/).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),0,'new labelled page performs only reconciliation');
 await page.evaluate(()=>{test.balances={fee:{available:'2000000000000000000'},bok:{available:'5000000'},collateral:{deposits:[],nextCursor:null}};test.accountingPages=[{complete:true,anchor:{blockNumber:8},available:'5000000',totals:{available:'0',reserved:'1000000',charged:'500000',refunded:'2500000'},requests:[{requestId:'0x'+'1'.repeat(64),state:'3',available:'0',reserved:'1000000',charged:'500000',refunded:'2500000'}]}];});
 await navigateAccount(page,'Balance and withdrawals');await page.getByRole('button',{name:'Check private balances',exact:true}).click();await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();
 assert(await page.getByText('Unallocated Bok credit: 5 USDC.',{exact:true}).isVisible());assert(await page.getByText(/This request is fenced. Unreserved credit has returned/).isVisible());assert(await page.getByRole('region',{name:'Owned Bok request',exact:true}).getByText(/reserved 1, charged 0.5, returned 2.5 USDC/).isVisible());assert.equal(await page.getByRole('button',{name:'Review request expiry',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.sends),0);
});

for(const [kind,label]of [['cancel-bok-request','Review release of this saved request'],['expire-bok-request','Review expiry of this saved request']])test('Interrupted Bok '+kind+' explicitly reviews one saved request and cancellation restores draft',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';test.refreshRecords={'bok-release':[{stage:'estimating'}]};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'authorized',action:{type:'bok',content:'Saved funded draft',budget:'400'},maximumFee:'123',bok:{phase:'authorize',budget:'400',availableCredit:'1000'}}));});
 await open(page);await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.getByText('Checking the action and its maximum fee…',{exact:true}).count(),0);assert.deepEqual(await page.evaluate(()=>test.releaseInput),{id:'42',type:kind});assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.content),'Saved funded draft');assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText(kind==='expire-bok-request'?/Expiry transaction confirmed/:/Transaction confirmed/).waitFor();assert.equal((await counts(page)).sends,1);
});
test('Interrupted Bok release failure and unknown send preserve recovery without another post or authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';test.failure='bok-release';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'43',status:'bok-post-reverted',action:{type:'bok',content:'Saved rejected draft',budget:'400'},maximumFee:'123',bok:{phase:'post',budget:'400',availableCredit:'1000'}}));});
 await open(page);await page.getByRole('button',{name:'Review expiry of this saved request',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal((await counts(page)).sends,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'bok-post-reverted');
 await page.evaluate(()=>{test.failure=null;test.submitOutcome='unknown';});await page.getByRole('button',{name:'Review expiry of this saved request',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,1);await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 for(const name of ['Confirm and send','Review saved Bok post','Review expiry of this saved request','Review release of this saved request'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
 assert.equal((await counts(page)).sends,0);
});

for(const finalType of ['bok','post'])test('New conversation Post and Bok switching retains the subboard and entered draft for '+finalType,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000';test.depositIds=['9','19'];});
 await open(page,{type:'post',subboard:'3'});await unlock(page);
 await page.getByLabel('Message',{exact:true}).fill('Build a small tool for this subboard');
 await page.getByLabel('Posting identity',{exact:true}).selectOption('7');
 await page.getByLabel('Posting collateral',{exact:true}).selectOption('19');
 const actionSelect=page.getByLabel('Action',{exact:true});await actionSelect.selectOption('bok');
 await page.getByText('New conversation',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:/^(View board|Main board)$/}).getAttribute('href'),'#/board/3');
 await page.getByLabel('Maximum Bok cost (USDC)').fill('0.0004');
 await actionSelect.selectOption('post');
 assert.equal(await page.getByLabel('Subboard ID (0 for main board)',{exact:true}).inputValue(),'3');
 if(finalType==='bok')await actionSelect.selectOption('bok');
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Build a small tool for this subboard');
 assert.equal(await page.getByLabel('Posting identity',{exact:true}).inputValue(),'7');
 assert.equal(await page.getByLabel('Posting collateral',{exact:true}).inputValue(),'19');
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);
 assert.deepEqual(action,{type:finalType,subboard:'3',content:'Build a small tool for this subboard',name:'7',deposit:'19',...(finalType==='bok'?{parent:'0',root:'0',budget:'400'}:{})});
 assert.equal((await counts(page)).sends,0);
});

test('Bok reply selection retains reader thread context through both saved confirmations',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply',parent:'12',root:'11',subboard:'3',content:'Continue this workspace'});await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');for(const name of ['Reply to post ID','Root thread ID','Subboard ID (0 for main board)'])assert.equal(await page.getByLabel(name,{exact:true}).count(),0);
 await page.getByLabel('Action',{exact:true}).selectOption('reply');await page.getByLabel('Action',{exact:true}).selectOption('bok');
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Continue this workspace');
 await page.getByLabel('Maximum Bok cost (USDC)').fill('0.0004');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(action.parent,'12');assert.equal(action.root,'11');assert.equal(action.subboard,'3');assert.equal(action.type,'bok');
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),action);assert.equal((await counts(page)).sends,0);
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');assert.equal(await page.getByRole('button',{name:'Start new conversation',exact:true}).count(),0);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{type:'reply',parent:'99',root:'98',subboard:'97'});await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});

test('Conversation context starts a new Bok thread only by explicit choice and preserves message and board',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply',parent:'12',root:'11',subboard:'3',content:'Keep this draft'});await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Maximum Bok cost (USDC)').fill('0.0004');
 await page.getByRole('button',{name:'Start new conversation',exact:true}).click();await page.getByText('New conversation',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'View board',exact:true}).getAttribute('href'),'#/board/3');assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Keep this draft');assert.equal(await page.getByLabel('Maximum Bok cost (USDC)').inputValue(),'0.0004');assert.equal((await counts(page)).prepares,0);
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.deepEqual({parent:action.parent,root:action.root,subboard:action.subboard},{parent:'0',root:'0',subboard:'3'});assert.equal(action.content,'Keep this draft');assert.equal(action.budget,'400');assert.equal((await counts(page)).sends,0);
});

test('Conversation context rejects missing or incomplete reply selection without preparing a transaction',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply'});await unlock(page);
 await page.getByText('Choose a post in the reader and select Reply to join its conversation.',{exact:true}).waitFor();await page.getByLabel('Message',{exact:true}).fill('Need a selected post');assert(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Choose a post',exact:true}).click();assert.equal(await page.getByRole('dialog').isVisible(),false);
 await open(page,{type:'reply',parent:'12',root:'0',subboard:'3',content:'Invalid pair'});await page.getByLabel('Action',{exact:true}).waitFor();await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Maximum Bok cost (USDC)').fill('0.0004');assert(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled());assert.equal((await counts(page)).prepares,0);
});

test('dialog selections and view changes retain a meaningful keyboard position',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 const action=page.getByLabel('Action',{exact:true});await action.focus();await action.selectOption('preference');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Action');
 const preference=page.getByLabel('Preference',{exact:true});await preference.focus();await preference.selectOption('3');
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Preference');
 await action.focus();await action.selectOption('bio');const profile=page.getByLabel('Profile name',{exact:true});await profile.focus();await profile.selectOption('7');
 await page.getByText('Current profile version checked. A newer edit will require a fresh check.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Profile name');
 await navigateAccount(page,'Your names');
 assert(await page.getByRole('heading',{name:'Your names',exact:true}).isVisible());
 assert.equal((await counts(page)).sends,0);
});

for(const replacement of [false,true])test(`ordinary saved post ${replacement?'replacement review':'exact-byte recovery'} is explicit and preserves its draft`,async t=>{
 const {page}=await browserFixture(t),action={type:'post',deposit:'9',content:'Retained original draft',name:'0',subboard:'0'};
 await page.evaluate(()=>test.rules={'0':{parent:'Policy sentence. '.repeat(50)}});
 if(replacement)await seedReplacement(page,{action});else await seedSavedResume(page,{action});
 assert.equal(await page.evaluate(()=>test.sends+test.replacementPrepares+test.resumes),0);
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();
 if(replacement){await rulesBeforePrimary(page);await page.getByRole('button',{name:'Review replacement',exact:true}).click();await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).waitFor();await rulesBeforePrimary(page);
  assert.deepEqual(await page.evaluate(()=>test.replacementInput),{expectedTxHash:'0x'+(77).toString(16).padStart(64,'0')});assert(await page.getByText(/New maximum network fee: 456/).isVisible());
  assert.equal(await page.evaluate(()=>test.sends),0);await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).click();
 }else{await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).waitFor();await rulesBeforePrimary(page);assert(await page.getByText(/Previously approved maximum fee: 123/).isVisible());
  assert.equal(await page.evaluate(()=>test.sends),0);await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).click();}
 await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),1);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.content),action.content);
});

test('saved avatar recovery cannot bypass the exact preview requirement',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{action:{type:'avatar',name:'7',expectedVersion:'4',width:100,height:100,data:Buffer.from('<svg onload="bad()"/>').toString('base64')}});
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByText(/saved avatar cannot be previewed safely/).waitFor();
 assert(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).isDisabled());assert.equal((await counts(page)).sends,0);
});

test('positive pre-proof review is explicit, preserves draft, and requires renewed fee confirmation',async t=>{
 const {page}=await browserFixture(t),action={type:'post',deposit:'9',content:'Retained interrupted draft',name:'0',subboard:'0'};
 await seedSavedResume(page,{action});await page.evaluate(()=>{test.recoverySnapshot={status:'pre-proof-review',attempts:[],exactResume:{status:'empty'},inclusionHistory:[]};});
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Review interrupted action',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).count(),0);
 await page.getByRole('button',{name:'Review interrupted action',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert(await page.getByText(/Maximum network fee: 456/).isVisible());assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.interruptedReviews),1);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.content),action.content);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.sends),1);
});
test('restored aggregate claim review explains original payment and requires separate confirmation',async t=>{
 const {page}=await browserFixture(t),action={type:'claim-deposit',receipt:{txHash:'0x'+'44'.repeat(32)}};
 await seedSavedResume(page,{action});await page.evaluate(()=>{test.recoverySnapshot={status:'aggregate-claim-review',attempts:[],exactResume:{status:'empty'},inclusionHistory:[]};});
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Review interrupted action',exact:true}).waitFor();
 assert(await page.getByText(/No new Ethereum payment is needed/).isVisible());assert(await page.getByText(/one-time fee claim/).isVisible());
 assert.equal(await page.getByText(/This device retained an interrupted attempt/).count(),0);assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Review interrupted action',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.interruptedReviews),1);assert(await page.getByText(/Maximum network fee: 456/).isVisible());
});
test('positive pre-proof failed renewed review never exposes a send or resets unknown recovery',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{action:{type:'post',deposit:'9',content:'Keep me',name:'0',subboard:'0'}});
 await page.evaluate(()=>{test.recoverySnapshot={status:'pre-proof-review',attempts:[],exactResume:{status:'empty'}};test.failure='interrupted-review';});
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Review interrupted action',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'unknown');
});

for(const found of [false,true])test(`saved Ethereum refund review ${found?'finds canonical success without sending':'requires separate same-nonce confirmation'}`,async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.getByRole('button',{name:'Review collateral exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Ethereum refund',exact:true}).waitFor();
 await page.evaluate(value=>test.refundFound=value,found);await page.getByRole('button',{name:'Review saved Ethereum refund',exact:true}).click();
 if(found){await page.getByText('The saved Ethereum refund is confirmed.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.refundSends??0),0);}
 else{await page.getByText(/This saved refund may still be pending/).waitFor();assert.equal(await page.evaluate(()=>test.refundSends??0),0);await page.getByRole('button',{name:'Cancel refund review',exact:true}).click();assert.equal(await page.evaluate(()=>test.refundSends??0),0);await page.getByRole('button',{name:'Review saved Ethereum refund',exact:true}).click();await page.getByRole('button',{name:'Confirm saved Ethereum refund',exact:true}).click();await page.getByText(/Ethereum refund confirmed/).waitFor();assert.equal(await page.evaluate(()=>test.refundSends),1);}
 assert.equal(await page.evaluate(()=>test.sends),1);
});

for(const mode of ['failure','account-change'])test(`saved refund review ${mode} reveals no private detail or send control`,async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.getByRole('button',{name:'Review collateral exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Ethereum refund',exact:true}).waitFor();
 await page.evaluate(mode=>{test[mode==='failure'?'failure':'hold']='saved-refund-review';},mode);await page.getByRole('button',{name:'Review saved Ethereum refund',exact:true}).click();
 if(mode==='account-change'){await page.waitForFunction(()=>typeof test.release==='function');await page.evaluate(()=>{test.options.onChange({invalidated:true});test.release();});await page.waitForFunction(()=>document.querySelector('dialog')?.getAttribute('aria-busy')!=='true');}
 else await page.getByText('This operation could not be completed. Recovery records were preserved. Check the existing transaction before preparing another.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm saved Ethereum refund',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);assert(!await page.locator('body').innerText().then(text=>text.includes('PRIVATE_SENTINEL')||text.includes('GETTER_SENTINEL')));
});

test('funding retains the busy panel and prevents duplicate actions until the current operation completes',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.hold='prepare';});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.waitForFunction(()=>!!test.release);
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 assert(await page.getByRole('button',{name:'Close account panel',exact:true}).isDisabled());
 assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);
 await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());
 assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.fundingPayments),1);
 await page.evaluate(()=>{test.hold=null;test.release();});
 await page.getByText('Payment confirmed. Your posting balance is set up.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'false');
 assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.fundingPayments),1);
});

for(const type of ['post','reply','quote','repost','bok'])test('Effective rules are shown for '+type+' and refreshed before publication',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000000';test.rules={'3':{parent:'<img src=x onerror=alert(1)> Parent policy',local:'[Local](javascript:alert(1)) '+ 'Policy sentence. '.repeat(50)}};});
 await open(page,{type,subboard:'3',parent:'12',root:'11',reference:'10',content:'A useful message'});await unlock(page);
 const rules=page.getByRole('region',{name:'Current effective rules'});
 await rules.getByText('Current parent rules · v2',{exact:true}).waitFor();
 assert.equal(await rules.locator('img,script,a').count(),0);assert.match(await rules.textContent(),/Immutable local rules · v1/);
 assert.match(await rules.textContent(),/Parent policy/);assert.match(await rules.textContent(),/javascript:alert/);
 assert.deepEqual(await page.evaluate(()=>test.ruleReads),[{id:'3',limit:'1'}]);await rulesBeforePrimary(page);
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();
 await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.ruleReads.length),2);await rulesBeforePrimary(page);
 await page.evaluate(()=>test.rules['3'].version='3');
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();
 await rules.getByText('Current parent rules · v3',{exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();
 await page.waitForFunction(()=>test.sends===1);
 if(type==='bok'){await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();await rulesBeforePrimary(page);}
});

test('Effective rules follow destination changes without reads per keystroke or stale response overwrite',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 const rules=page.getByRole('region',{name:'Current effective rules'}),destination=page.getByLabel('Subboard ID (0 for main board)',{exact:true}),review=page.getByRole('button',{name:'Check action and review fee',exact:true});
 await rules.getByText('Main board',{exact:true}).waitFor();await page.getByLabel('Message',{exact:true}).fill('Message kept');
 await page.evaluate(()=>test.holdRules='3');await destination.fill('3');
 assert.equal(await page.evaluate(()=>test.ruleReads.length),1);assert(await review.isDisabled());
 await destination.dispatchEvent('change');await page.waitForFunction(()=>test.ruleReleases['3']);
 await destination.fill('4');await destination.dispatchEvent('change');await rules.getByText('Subboard 4',{exact:true}).waitFor();
 await page.evaluate(()=>test.ruleReleases['3']());await page.evaluate(()=>Promise.resolve());
 assert.match(await rules.textContent(),/Subboard 4/);assert(!await review.isDisabled());
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Message kept');
 assert.deepEqual(await page.evaluate(()=>test.ruleReads.map(x=>x.id)),['0','3','4']);
});

for(const failure of ['unavailable','rejected','mismatch'])test('Effective rules block '+failure+' destination and allow explicit recovery',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(failure=>{test.rules={'3':failure==='mismatch'?{boardId:'4'}:{[failure]:true}};},failure);
 await open(page,{type:'post',subboard:'3',content:'Preserved draft'});await unlock(page);
 const rules=page.getByRole('region',{name:'Current effective rules'}),review=page.getByRole('button',{name:'Check action and review fee',exact:true});
 await rules.getByText(failure==='rejected'?/This subboard is rejected/:/Current board rules are unavailable/).waitFor();
 assert(await review.isDisabled());assert.equal((await counts(page)).prepares,0);
 await page.evaluate(()=>test.rules={});await rules.getByRole('button',{name:'Refresh board rules'}).click();
 await rules.getByText('Current parent rules · v2',{exact:true}).waitFor();assert(!await review.isDisabled());
});

test('Effective rules are shared in flight and recovered publication cannot send on an unavailable refresh',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.holdRules='3');await open(page,{type:'post',subboard:'3',content:'Saved publication'});await unlock(page);
 await page.waitForFunction(()=>test.ruleReleases['3']);await page.getByRole('button',{name:'Load more owned names',exact:true}).click();
 assert.equal(await page.evaluate(()=>test.ruleReads.length),1);
 await page.evaluate(()=>{test.holdRules=null;test.ruleReleases['3']();});
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);
 const rules=page.getByRole('region',{name:'Current effective rules'});await rules.getByText('Subboard 3',{exact:true}).waitFor();
 await page.evaluate(()=>test.rules={'3':{unavailable:true}});await page.getByRole('button',{name:'Confirm and send',exact:true}).click();
 await rules.getByText(/Current board rules are unavailable/).waitFor();assert.equal((await counts(page)).sends,0);
 assert(await page.getByRole('button',{name:'Confirm and send',exact:true}).isDisabled());
});

test('Moderator transfer reviews successor and loss of authority before sending',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.moderator=true);await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('transfer-moderator');
 const address=page.getByLabel('Successor Aztec address',{exact:true}),review=page.getByRole('button',{name:'Check action and review fee',exact:true});
 await address.fill('0');assert(await review.isDisabled());
 const successor='0x'+'0'.repeat(62)+'63';await address.fill(successor);await review.click();
 await page.getByText(`Transfer moderator authority to ${successor}. Your current key loses authority immediately. Only the successor can transfer it back.`,{exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'transfer-moderator',successor});
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});

for(const outcome of ['confirmed','failure'])test(`existing refund shows owned confirmation progress until ${outcome} without sending`,async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.getByRole('button',{name:'Review collateral exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Check existing refund',exact:true}).waitFor();
 await page.evaluate(outcome=>{test.hold='refund-check';test.refundFound=outcome==='confirmed';if(outcome==='failure')test.failure='refund-check';},outcome);
 await page.getByRole('button',{name:'Check existing refund',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 const progress=page.getByText('Checking existing Ethereum refund; waiting for network confirmation.',{exact:true});assert(await progress.isVisible());
 assert(await page.getByRole('button',{name:'Check existing refund',exact:true}).isDisabled());assert.equal(await page.evaluate(()=>test.refundSends??0),0);assert.equal(await page.getByText(/Wait for Outbox settlement/).count(),0);
 await page.evaluate(()=>test.release());
 if(outcome==='confirmed')await page.getByText('The saved Ethereum refund is confirmed.',{exact:true}).waitFor();else await page.getByRole('alert').waitFor();
 assert.equal(await progress.count(),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);
});

for(const outcome of ['confirmed','failure'])test(`funding confirmation shows approval and original-payment progress until ${outcome}`,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page);
 await page.evaluate(outcome=>{test.hold='funding-payment';if(outcome==='failure')test.failure='funding-payment';},outcome);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 const pending=page.getByText('Approve the payment in your wallet…',{exact:true});assert(await pending.isVisible());
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.fundingConfirms),1);assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>{test.hold=null;test.release();});
 if(outcome==='confirmed')await page.getByText('Payment confirmed.',{exact:false}).waitFor();else await page.getByRole('alert').waitFor();
 assert.equal(await pending.count(),0);assert.equal(await page.evaluate(()=>test.fundingConfirms),1);assert.equal((await counts(page)).sends,outcome==='confirmed'?1:0);
});

test('fresh funding quote shows progress and cancelled signature keeps the account unlocked',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.hold='funding-quote';});await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');
 await page.waitForFunction(()=>typeof test.release==='function');
 const pending=page.getByText('Getting the current price…',{exact:true});await pending.waitFor();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');assert.equal(await page.getByRole('button',{name:'Confirm payment',exact:true}).count(),0);
 await page.evaluate(()=>{test.hold=null;test.release();test.fundingSignatureCancelled=true;});
 await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.match(await page.getByRole('alert').innerText(),/Signature cancelled. No funding payment was sent/);
 assert.equal(await page.getByRole('button',{name:'Reload page',exact:true}).count(),0);assert.equal(await pending.count(),0);
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal(await page.evaluate(()=>test.sessions),1);
 await page.evaluate(()=>test.fundingSignatureCancelled=false);await page.getByRole('button',{name:'Refresh price',exact:true}).click();await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sessions),1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});

test('cold funding explains the native fee credit requirement without sending or exposing private errors',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fundingQuoteFailure='ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT';test.minimumFeeCredit='13923754136387220000';});await open(page);await unlock(page);
 await navigateAccount(page,'Set up posting');
 await page.getByRole('alert').waitFor();
 const text=await page.getByRole('alert').innerText();assert(text.includes('Review the cost again'));assert(text.includes('No payment was sent'));assert(!text.includes('PRIVATE_SENTINEL'));
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
});

test('account overview enables funding before any names or publishing reads',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.hold='owned';});
 await open(page);
 await navigateAccount(page,'Set up posting');
 assert.equal(await page.getByLabel('Posting deposit (ETH)',{exact:true}).count(),0);await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads??0,test.bokReads??0]),[1,0,0,0]);
 await navigateAccount(page,'Your names');await page.waitForFunction(()=>typeof test.release==='function');
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');assert(await page.getByRole('button',{name:'Back to account',exact:true}).isDisabled());
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('button',{name:'Edit bio for River Lane',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads??0,test.bokReads??0]),[1,1,0,0]);
 await navigateAccount(page,'Write a post');await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Posting identity').locator('option[value="7"]').textContent(),'River Lane');
 await navigateAccount(page,'Your names');await navigateAccount(page,'Write a post');
 assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads,test.bokReads]),[1,1,1,1]);
 await navigateAccount(page,'Refresh account');await navigateAccount(page,'Write a post');await page.waitForFunction(()=>test.bokReads===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads,test.bokReads]),[2,2,2,2]);
});

test('explicit composer waits for owned names and authenticated capabilities, then invalidates late view reads',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.hold='moderator';test.moderator=true;test.bokCredit='1000000';});
 await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await page.waitForFunction(()=>typeof test.release==='function');
 assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>panel.moderatorAuthorized()),false);
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Action',{exact:true}).inputValue(),'reply');assert.equal(await page.getByLabel('Posting identity').locator('option[value="7"]').count(),1);
 assert.equal(await page.evaluate(()=>panel.moderatorAuthorized()),true);
 await page.evaluate(()=>{test.hold='owned';test.release=null;});await navigateAccount(page,'Refresh account');await navigateAccount(page,'Write a post');await page.waitForFunction(()=>typeof test.release==='function');
 await page.evaluate(()=>{test.rawAccount={address:'CHANGED_ACCOUNT'};test.options.onChange({invalidated:true});test.hold=null;test.release();});
 await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();assert.equal(await page.evaluate(()=>panel.moderatorAuthorized()),false);
 assert.equal(await page.getByText('River Lane',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).count(),0);
});

test('failed lazy name read retains funding access and retries only the selected view',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.failure='owned';});await open(page);
 await navigateAccount(page,'Your names');await page.getByRole('alert').waitFor();assert.equal(await page.getByText('No registered names were found.',{exact:false}).count(),0);
 await navigateAccount(page,'Set up posting');assert.equal(await page.getByLabel('Posting deposit (ETH)',{exact:true}).count(),0);await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 await page.evaluate(()=>test.failure=null);await navigateAccount(page,'Your names');await page.getByRole('button',{name:'Edit bio for River Lane',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads??0,test.bokReads??0]),[1,2,0,0]);
});

test('reopening an unlocked composer loads only missing view data and preserves explicit refresh',async t=>{
 const {page}=await browserFixture(t);await open(page);await page.getByRole('button',{name:'Write a post',exact:true}).waitFor();
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await page.evaluate(()=>test.failure='status');
 await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Action',{exact:true}).inputValue(),'reply');
 const reads=()=>page.evaluate(()=>[test.statusReads,test.owned,test.moderatorReads??0,test.bokReads??0]);assert.deepEqual(await reads(),[1,1,1,1]);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{type:'reply',parent:'11',root:'1',subboard:'3'});
 assert(await page.getByLabel('Message',{exact:true}).isEnabled());assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'false');assert.deepEqual(await reads(),[1,1,1,1]);
 await page.evaluate(()=>test.failure=null);await navigateAccount(page,'Refresh account');await navigateAccount(page,'Write a post');await page.waitForFunction(()=>test.bokReads===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(await reads(),[2,2,2,2]);assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
});

test('reopening a blocked account reconciles retained intent before a new draft',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Message',{exact:true}).fill('Original draft');await page.evaluate(()=>test.failure='prepare');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Check account recovery',exact:true}).waitFor();
 const before=await page.evaluate(()=>test.statusReads);await page.getByRole('button',{name:'Close account panel',exact:true}).click();await page.evaluate(()=>test.failure=null);await open(page,{type:'like',post:'99'});
 await page.getByRole('button',{name:'Cancel prepared action',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.statusReads),before+1);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.content),'Original draft');assert.equal((await counts(page)).sends,0);
});

test('reopening after an unnoticed account replacement clears cached private views',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 const before=await page.evaluate(()=>test.statusReads);await page.evaluate(()=>test.rawAccount={address:'REPLACED_ACCOUNT'});await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});
 await page.getByRole('button',{name:'Reload page',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).count(),0);
 assert.equal(await page.getByText('River Lane',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.statusReads),before);assert.equal((await counts(page)).sends,0);
});

for(const width of [390,1280])test(`guided onboarding has one decision per screen at ${width}px`,async t=>{
 const {page}=await browserFixture(t);await page.setViewportSize({width,height:900});
 await page.evaluate(()=>{test.unlocked=false;test.fee='fee-needed';test.aggregateEnabled=true;test.usdcEnabled=true;test.walletChoices=[{id:'metamask',name:'MetaMask',icon:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="orange"/></svg>')},{id:'phantom',name:'Phantom'}];});
 await open(page);
 await page.getByRole('heading',{name:'Connect your wallet',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Unlock',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Recover Ethereum refund only',exact:true}).count(),0);
 assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).waitFor();
 assert.equal(await page.getByText('Account settings',{exact:true}).count(),0);
 assert.equal(await page.locator('.wallet-choice .wallet-icon').count(),2);
 assert.equal(await page.locator('.wallet-icon img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
 if(process.env.ROLLING_UX_SCREENSHOTS)await page.screenshot({path:`${process.env.ROLLING_UX_SCREENSHOTS}/wallet-${width}.png`});
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 for(const name of ['Posting deposit (ETH)','Network fee credit (fee tokens)','Bok credit (USDC)','Maximum Ethereum gas cost (ETH)','Slippage limit (%)'])assert.equal(await page.getByLabel(name,{exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.fundingAllocation.bokAmount),'0');assert.equal(await page.getByText('Bok assistant',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.bokReads??0),0);assert.equal(await page.getByRole('button',{name:'Review cost',exact:true}).count(),0);await page.getByLabel('Pay with').selectOption('USDC');await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 for(const text of await page.locator('.funding-line>strong').allTextContents())assert.match(text,/USDC$/);
 assert.equal(await page.getByText('Account settings',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 const dimensions=await page.getByRole('dialog').evaluate(d=>({width:d.clientWidth,scroll:d.scrollWidth}));assert(dimensions.scroll<=dimensions.width);
 if(process.env.ROLLING_UX_SCREENSHOTS)await page.screenshot({path:`${process.env.ROLLING_UX_SCREENSHOTS}/review-${width}.png`});
});

test('joining from a post leads to setup and retains the draft',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.unlocked=false;test.fee='fee-needed';test.aggregateEnabled=true;});
 await open(page,{type:'post',content:'A draft worth keeping'});await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();assert.equal(await page.getByLabel('Action',{exact:true}).count(),0);
 await navigateAccount(page,'Write a post');assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'A draft worth keeping');
 assert(await page.getByRole('button',{name:'Set up posting',exact:true}).isVisible());assert.equal((await counts(page)).sends,0);
});
test('an existing deposit with depleted fees offers posting top-up, including after choosing Bok',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.fee='fee-needed';test.depositIds=['9'];test.aggregateEnabled=true;test.topupEnabled=true;});await open(page);
 await page.getByRole('button',{name:'Add posting credit',exact:true}).click();await page.getByLabel('Top-up credit').selectOption('bok');
 await navigateAccount(page,'Write a post');await page.getByRole('button',{name:'Add posting credit',exact:true}).click();
 assert.equal(await page.getByLabel('Top-up credit').inputValue(),'private-fee');assert.equal(await page.getByLabel('Fee token top-up amount').inputValue(),'0.000000000000002');assert.equal(await page.getByRole('button',{name:'Review cost',exact:true}).count(),0);assert.equal((await counts(page)).sends,0);
});

// G17 exercises user journeys through the real panel with labelled private-session doubles.
test('G17 focused reply preserves target, anonymous default, draft and explicit spending consent',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.namesPages={0:{identities:[],records:[],nextCursor:null}};});
 await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});
 const review=page.locator('[data-action-review]');await review.waitFor();
 assert.equal(await page.getByLabel('Action',{exact:true}).count(),0);assert.equal(await page.getByLabel('Posting collateral').count(),0);
 assert.equal(await page.getByRole('heading',{name:'Reply',exact:true}).count(),1);
 assert(await page.getByText('Posting as Anonymous',{exact:true}).isVisible());
 await page.getByLabel('Message',{exact:true}).fill('A useful reply');await review.click();await page.locator('[data-action-confirm]').waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'reply',content:'A useful reply',name:'0',deposit:'9',subboard:'3',parent:'10',root:'1'});
 assert.equal((await counts(page)).sends,0);assert.equal(await page.locator('[data-action-confirm]').textContent(),'Reply');
 assert(await page.locator('.preview-body').getByText('A useful reply',{exact:true}).isVisible());
 assert.equal(await page.getByText(/fee-juice units/).count(),0);
 await page.getByRole('button',{name:'Back to editing',exact:true}).click();await review.waitFor();assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'A useful reply');
 await review.click();await page.locator('[data-action-confirm]').click();await page.waitForFunction(()=>test.effects===1);assert.equal((await counts(page)).sends,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
for(const [defaults,expected,label]of [
 [{type:'like',post:'10'},{type:'like',post:'10'},'Like post'],
 [{type:'preference',kind:1,target:'10',enabled:true},{type:'preference',kind:1,target:'10',enabled:true,expectedRevision:'4'},'Save bookmark'],
 [{type:'read-marker',thread:'10',throughBlock:'22'},{type:'read-marker',thread:'10',throughBlock:'22',expectedRevision:'4'},'Mark as read']
])test('G17 contextual '+defaults.type+' automatically reviews cost without editable IDs or unrelated reads',async t=>{
 const {page}=await browserFixture(t);await open(page,defaults);await page.locator('[data-action-confirm]').waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),expected);
 assert.equal(await page.locator('[data-action-confirm]').textContent(),label);assert.equal((await counts(page)).sends,0);
 assert.equal(await page.getByRole('textbox').count(),0);assert.equal(await page.getByRole('combobox').count(),0);
 assert.equal(await page.evaluate(()=>test.owned+(test.bokReads??0)+(test.moderatorReads??0)),0);
 await page.locator('[data-action-confirm]').click();await page.waitForFunction(()=>test.effects===1);assert.equal((await counts(page)).sends,1);
});
test('Bok mentions retain reply ancestry and editing stays available during a pending balance read',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000000';test.hold='bok';});await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await page.locator('[data-action-review]').waitFor();
 await page.waitForFunction(()=>test.release);await page.getByLabel('Message',{exact:true}).fill('Help me @bok with this');
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'false');assert.equal(await page.getByLabel('Message',{exact:true}).isEnabled(),true);
 assert.equal(await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).isVisible(),true);
 await page.getByLabel('Message',{exact:true}).fill('Help me with this');assert.equal(await page.getByLabel('Maximum Bok cost (USDC)',{exact:true}).isVisible(),false);
 await page.getByLabel('Message',{exact:true}).fill('Help me @bok with this');await page.evaluate(()=>{test.hold=null;test.release();});
 await page.getByText('Bok balance: 1 USDC',{exact:true}).waitFor();assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Help me @bok with this');
 await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();
 const a=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(a.type,'bok');assert.equal(a.parent,'10');assert.equal(a.root,'1');assert.equal(a.subboard,'3');assert.equal(a.content,'Help me @bok with this');assert.equal(a.budget,'250000');assert.equal((await counts(page)).sends,0);
});
test('G17 saved items load on opening and technical progress stays in details',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByText('Your saved choices are ready.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.preferenceReads),1);assert.equal(await page.evaluate(()=>test.prepares),0);
});
test('G17 composer rejects overlong content and presents readable desktop and mobile review',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'post'});await page.locator('[data-action-review]').waitFor();
 await page.getByLabel('Message',{exact:true}).fill('😀'.repeat(249));assert(await page.locator('[data-action-review]').isDisabled());assert(await page.getByText('Your message is too long. Shorten it before continuing.',{exact:true}).isVisible());
 await page.getByLabel('Message',{exact:true}).fill('What are you reading this week?');await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`execution/evidence/G17/composer-${width}.png`});}
});
test('G17 balances load without a second check and show withdrawal time as a date',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.balances={fee:{available:'1000000000000000000'},bok:null,collateral:{deposits:[{id:'9',amount:'1000000000000000',reason:'time-locked',nextAllowedTime:'1792530000',eligible:false}],nextCursor:null}});await open(page);await navigateAccount(page,'Balance and withdrawals');await page.getByText('Posting balance: 1 credits (FEE).',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.balanceReads),1);assert(await page.getByText(/Available to withdraw after/).isVisible());assert.equal(await page.getByText(/chain time/).count(),0);assert(await page.getByRole('button',{name:'Withdraw deposit',exact:true}).isEnabled());
});
test('G17 a failed contextual cost check does not automatically retry or send',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.failure='prepare');await open(page,{type:'like',post:'10'});await page.getByRole('alert').waitFor();assert.equal((await counts(page)).prepares,1);assert.equal((await counts(page)).sends,0);assert.equal(await page.getByLabel('Action',{exact:true}).count(),0);
});
test('G17 saved feed loading waits for the current account action before reading',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'like',post:'10'});await page.locator('[data-action-confirm]').waitFor();await page.evaluate(()=>test.hold='submit');await page.locator('[data-action-confirm]').click();await page.waitForFunction(()=>test.submitCalls===1);
 await page.evaluate(()=>{window.savedResult='waiting';void panel.loadSavedItems().then(value=>window.savedResult=value);});assert.equal(await page.evaluate(()=>window.savedResult),'waiting');assert.equal(await page.evaluate(()=>test.preferenceReads),0);
 await page.evaluate(()=>{test.hold=null;test.release();});await page.waitForFunction(()=>window.savedResult===true);assert.equal(await page.evaluate(()=>test.preferenceReads),1);assert.equal((await counts(page)).sends,1);
});
test('G17 account starts a new post after another action and exposes verified moderator settings',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.moderator=true);await open(page,{type:'like',post:'10'});await page.locator('[data-action-confirm]').waitFor();await page.getByRole('button',{name:'Back to editing',exact:true}).click();await navigateAccount(page,'Write a post');await page.getByLabel('Message',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Write a post',exact:true}).count(),1);
 await navigateAccount(page,'Transfer moderator authority');await page.getByLabel('Successor Aztec address').waitFor();assert.equal((await counts(page)).sends,0);
});
test('G17 restored reply returns to editing with its saved content and ancestry',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'prepared',maximumFee:'123',action:{type:'reply',content:'Retained reply after reload',name:'7',deposit:'9',parent:'10',root:'1',subboard:'3'}})));await open(page);await page.locator('[data-action-confirm]').waitFor();await page.getByRole('button',{name:'Back to editing',exact:true}).click();await page.locator('[data-action-review]').waitFor();assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Retained reply after reload');await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();const a=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(a.type,'reply');assert.equal(a.parent,'10');assert.equal(a.root,'1');assert.equal(a.subboard,'3');assert.equal(a.name,'7');assert.equal((await counts(page)).sends,0);
});
test('G17 quote source opens the selected post and closes the idle composer',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'quote',subboard:'0',reference:'10'});await page.getByRole('link',{name:'View original post',exact:true}).click();assert.equal(await page.evaluate(()=>location.hash),'#/post/10');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal((await counts(page)).sends,0);
});

async function inlineNames(page){
 await page.evaluate(()=>{const host=document.createElement('div');host.id='posting-names';document.querySelector('#reader').append(host);panel.attachIdentityControls(host);});
}
test('G18 main-page names carry to posts and replies without a selection dialog',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);
 assert.equal((await counts(page)).loads,0);
 await open(page);await page.waitForFunction(()=>test.owned===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 const select=page.locator('#posting-names select');assert.deepEqual(await select.locator('option').allTextContents(),['Anonymous','River Lane','Ellis Moss','Create a name…']);
 await select.selectOption('8');assert.equal(await page.locator('dialog[open]').count(),0);
 for(const type of ['post','reply']){
  await open(page,{type,subboard:'3',parent:'10',root:'1'});await page.locator('[data-action-review]').waitFor();assert.equal(await page.getByLabel('Posting identity').inputValue(),'8');
  await page.getByLabel('Message',{exact:true}).fill('Selected name works');await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.name),'8');assert.equal((await counts(page)).sends,0);
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 }
 await select.selectOption('0');await open(page,{type:'post'});await page.locator('[data-action-review]').waitFor();assert.equal(await page.getByLabel('Posting identity').inputValue(),'0');
});
test('G18 creates a name entirely inline, waits for confirmation and selects verified ownership',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);const select=page.locator('#posting-names select');await select.selectOption('create');
 await page.getByLabel('First name',{exact:true}).fill(' Quinn ');await page.getByLabel('Last name',{exact:true}).fill('Stone');await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0);assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>{test.hold='submit';});await page.locator('[data-action-confirm]').click();await page.waitForFunction(()=>test.submitCalls===1);
 assert.equal(await select.locator('option[value="55"]').count(),0);assert.equal(await select.isDisabled(),true);
 await page.evaluate(()=>{test.namesPages={0:{identities:['7'],records:[{id:'7',first:'River',last:'Lane'}],nextCursor:8},8:{identities:['55'],records:[{id:'55',first:'Quinn',last:'Stone'}],nextCursor:null}};test.hold=null;test.release();});
 await page.waitForFunction(()=>document.querySelector('#posting-names select').value==='55');assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('.inline-name').isVisible(),false);assert.equal((await counts(page)).sends,1);
 await page.evaluate(()=>{const replacement=document.createElement('div');replacement.id='posting-names';document.querySelector('#posting-names').replaceWith(replacement);panel.attachIdentityControls(replacement);});assert.equal(await select.inputValue(),'55');
 await open(page,{type:'reply',subboard:'3',parent:'10',root:'1'});await page.locator('[data-action-review]').waitFor();assert.equal(await page.getByLabel('Posting identity').inputValue(),'55');
});
test('G18 inline name failure preserves the draft without sending and cancel stays on page',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);await page.locator('#posting-names select').selectOption('create');
 await page.getByLabel('First name',{exact:true}).fill('Quinn');await page.getByLabel('Last name',{exact:true}).fill('Stone');await page.evaluate(()=>{test.nameFailure='ROLLING_NAME_TAKEN';});await page.locator('[data-action-review]').click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Quinn');assert.equal((await counts(page)).sends,0);assert.equal(await page.locator('dialog[open]').count(),0);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`execution/evidence/G18/inline-${width}.png`});}
 await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.locator('.inline-name').isVisible(),false);assert.equal(await page.locator('dialog[open]').count(),0);
});
test('G18 guest inline name entry can create an account and obtain a funding quote',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.unlocked=false;test.fee='fee-needed';test.aggregateEnabled=true;});await inlineNames(page);await page.locator('#posting-names select').selectOption('create');
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>test.fundingPrepares),1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.evaluate(()=>{test.fee='fee-ready';});await page.getByRole('button',{name:'Confirm payment',exact:true}).click();await page.getByLabel('First name',{exact:true}).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>test.fundingPayments),1);
});
test('G18 an incomplete names page can be explicitly retried without changing the posting identity',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);await open(page);await page.waitForFunction(()=>test.owned===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel',exact:true}).click();await page.locator('#posting-names select').selectOption('8');
 await page.evaluate(()=>{test.ownedFailureCursor=8;});await open(page);await page.getByText('Account settings',{exact:true}).click();await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.getByRole('alert').waitFor();await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 assert.equal(await page.locator('#posting-names select').inputValue(),'8');assert.equal(await page.locator('#posting-names select').isDisabled(),true);
 await page.evaluate(()=>{test.ownedFailureCursor=null;});await page.getByRole('button',{name:'Load names',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#posting-names select').disabled);assert.equal(await page.locator('#posting-names select').inputValue(),'8');assert.equal((await counts(page)).sends,0);
});
test('G18 completed ownership refresh explicitly resets a name that is no longer owned',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);await open(page);await page.waitForFunction(()=>test.owned===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel',exact:true}).click();await page.locator('#posting-names select').selectOption('8');
 await page.evaluate(()=>{test.namesPages={0:{identities:[],records:[],nextCursor:null}};});await open(page);await page.getByText('Account settings',{exact:true}).click();await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 assert.equal(await page.locator('#posting-names select').inputValue(),'0');assert(await page.locator('#posting-names').getByText('Your previous posting name is no longer available. Posting as Anonymous.',{exact:true}).isVisible());assert.equal(await page.locator('#posting-names option[value="8"]').count(),0);
});

for(const width of [390,1280])test(`G20 account creation shows immediate progress and actual stages at ${width}px`,async t=>{
 const {page}=await browserFixture(t);await page.setViewportSize({width,height:900});
 await page.evaluate(()=>{test.unlocked=false;test.fee='fee-needed';test.aggregateEnabled=true;test.walletChoices=[{id:'metamask',name:'MetaMask'}];test.hold='signin';});await open(page);
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByRole('heading',{name:'Opening your account…',exact:true}).waitFor();
 assert(await page.locator('.account-setup-progress strong').isVisible());assert.equal(await page.locator('input[type=password]').count(),0);
 assert.equal(await page.locator('.account-setup-spinner').evaluate(n=>getComputedStyle(n).animationName),'account-setup-spin');
 assert.equal(await page.evaluate(()=>test.signIns),1);assert.equal(await page.evaluate(()=>test.sessions),0);
 await page.evaluate(()=>{test.hold='session';test.release();});await page.waitForFunction(()=>typeof test.sessionProgress==='function');
 await page.evaluate(()=>test.sessionProgress({stage:'session-initialization',step:'initial-sync',deploymentStep:null,state:'started',code:null}));
 assert(await page.getByText('Syncing your account with the network…',{exact:true}).isVisible());
 const bounds=await page.locator('.account-setup-progress').boundingBox();assert(bounds.height>=240);assert(bounds.y>=0&&bounds.y+bounds.height<=900);assert(await page.getByRole('button',{name:'Close account panel',exact:true}).isDisabled());
 await page.screenshot({path:`execution/evidence/G20/progress-${width}.png`});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.account-setup-spinner').evaluate(n=>getComputedStyle(n).animationName),'none');
 await page.evaluate(()=>{test.hold=null;test.release();});await page.getByRole('button',{name:'Confirm payment',exact:true}).waitFor();
 assert.equal(await page.locator('.account-setup-spinner').count(),0);assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.signIns),1);
});
test('G20 setup failure removes progress and displays an actionable error',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.unlocked=false;test.hold='signin';});await open(page);await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();await page.getByRole('heading',{name:'Opening your account…',exact:true}).waitFor();
 await page.evaluate(()=>{test.failure='session';test.hold=null;test.release();});await page.getByRole('alert').waitFor();assert.equal(await page.locator('.account-setup-spinner').count(),0);assert(await page.getByRole('button',{name:'Reconnect',exact:true}).isVisible());assert.equal((await counts(page)).sends,0);
});

test('G21 unfinished signup refund uses the connected wallet without an old account backup',async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{
  test.depositRefundEnabled=true;
  test.fundingWallet={connected:true,name:'MetaMask',address:'0x'+'3'.repeat(40)};
  test.balances={fee:{available:'1000000000000000000'},bok:null,collateral:{deposits:[],nextCursor:null}};
 });
 await open(page);
 await navigateAccount(page,'Balance and withdrawals');
 await page.getByRole('button',{name:'Find refundable deposits',exact:true}).click();
 await page.getByRole('button',{name:'Refund 0.001 ETH',exact:true}).click();
 await page.getByRole('button',{name:'Continue refund',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.signIns),0);
 assert.equal(await page.evaluate(()=>test.depositRefundId),'0x'+'4'.repeat(64));
 await page.getByRole('button',{name:'Continue refund',exact:true}).click();
 await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),1);
 await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).click();
 await page.getByRole('button',{name:'Confirm Ethereum refund',exact:true}).click();
 await page.getByText(/Ethereum refund confirmed/).waitFor();
 assert.equal(await page.evaluate(()=>test.refundSends),1);
 assert.equal(await page.evaluate(()=>test.signIns),0);
});

test('optional Bok failure leaves an ordinary reply editable and never reads again automatically',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokConfigured=true;test.failure='bok';});
 await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await page.locator('[data-action-review]').waitFor();
 await page.waitForFunction(()=>test.bokReads===1);await page.getByLabel('Message',{exact:true}).fill('A reply without the assistant');
 assert.equal(await page.getByLabel('Message',{exact:true}).isEnabled(),true);assert.equal(await page.getByLabel('Ask Bok to reply',{exact:true}).count(),0);
 await page.locator('[data-action-review]').click();await page.locator('[data-action-confirm]').waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);
 assert.equal(action.type,'reply');assert.equal(action.parent,'10');assert.equal(action.root,'1');assert.equal(action.content,'A reply without the assistant');
 assert.equal(await page.evaluate(()=>test.bokReads),1);assert.equal((await counts(page)).sends,0);
});

// Navigation regression uses the actual panel with the existing labelled SDK
// double. It does not qualify network latency or cryptographic execution.
test('an unlocked account opens and reopens the composer without private refreshes',async t=>{
 const {page}=await browserFixture(t);await open(page);
 await page.getByRole('button',{name:'Write a post',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const before=await page.evaluate(()=>({sessions:test.sessions,status:test.statusReads,owned:test.owned,moderator:test.moderatorReads??0,bok:test.bokReads??0}));
 await page.evaluate(()=>{test.failure='moderator';});
 await page.getByRole('button',{name:'Write a post',exact:true}).click();
 await page.getByLabel('Message',{exact:true}).fill('Writing should start immediately.');
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await open(page,{type:'reply',parent:'10',root:'1'});
 await page.getByLabel('Message',{exact:true}).fill('The same account can reply.');
 assert.deepEqual(await page.evaluate(()=>({sessions:test.sessions,status:test.statusReads,owned:test.owned,moderator:test.moderatorReads??0,bok:test.bokReads??0})),before);
 assert.equal(await page.locator('dialog').getAttribute('aria-busy'),'false');
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
});
test('names remain explicitly loadable while writing without checking moderator options',async t=>{
 const {page}=await browserFixture(t);await inlineNames(page);await open(page,{type:'post'});
 await page.getByLabel('Message',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(await page.evaluate(()=>test.owned),0);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.locator('#posting-names').getByRole('button',{name:'Load names',exact:true}).click();
 await page.waitForFunction(()=>test.owned===2&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(await page.evaluate(()=>test.moderatorReads??0),0);
 assert.deepEqual(await page.locator('#posting-names select option').allTextContents(),['Anonymous','River Lane','Ellis Moss','Create a name…']);
 assert.equal((await counts(page)).sends,0);
});

for(const homeOnly of [false,true])test(`Bok balance automatically updates only after ${homeOnly?'home reply snapshot':'conversation reply'} confirmation`,async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{
  test.bokCredit='583128';test.submitOutcome='confirmed';test.txHash='0x'+'a'.repeat(64);
  const host=document.createElement('section');host.id='bok-balance-host';document.body.append(host);panel.attachBokControls(host);
 });
 await open(page,{type:'post'});await page.locator('#bok-balance-host').getByText('0.583128 USDC available',{exact:true}).waitFor();
 await page.getByLabel('Message',{exact:true}).fill('@bok make an app');
 await page.locator('.bok-invitation input').fill('0.25');
 await page.evaluate(()=>test.bokCredit='333128');
 await page.getByRole('button',{name:'Post',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open&&test.bokReads===2);
 await page.locator('#bok-balance-host').getByText('0.333128 USDC available',{exact:true}).waitFor();
 const before=await page.evaluate(()=>({sessions:test.sessions,status:test.statusReads,names:test.owned}));
 await page.evaluate(homeOnly=>{
  test.observeReply=(confirmation,number)=>panel.observePublicPosts([
   {id:'20',confirmation:'confirmed',position:{txHash:test.txHash},invocation:{pluginId:'7',requestId:'91',reply:'21'}},
   ...(homeOnly?[]:[{id:'21',confirmation,position:{blockNumber:108},bot:{pluginId:'7',requestId:'91'}}])
  ],{checkpoint:{number:110},confirmationCheckpoint:{number}});
  test.observeReply('pending',100);test.observeReply('pending',105);
 },homeOnly);
 assert.equal(await page.evaluate(()=>test.bokReads),2);
 assert.equal(await page.locator('#bok-balance-host [data-bok-balance]').innerText(),'0.333128 USDC available');
 await page.evaluate(homeOnly=>{test.bokCredit='572166';test.hold='bok';test.observeReply('confirmed',homeOnly?110:108);test.observeReply('confirmed',110);},homeOnly);
 await page.waitForFunction(()=>test.bokReads===3&&typeof test.release==='function');
 await page.evaluate(()=>{test.hold=null;test.release();});
 await page.locator('#bok-balance-host').getByText('0.572166 USDC available',{exact:true}).waitFor();
 await page.evaluate(()=>test.observeReply('confirmed',115));
 assert.equal(await page.evaluate(()=>test.bokReads),3);
 assert.deepEqual(await page.evaluate(()=>({sessions:test.sessions,status:test.statusReads,names:test.owned})),before);
});

for(const outcome of ['confirmed','error'])test(`regular post becomes visible at inclusion while checkpoint ${outcome==='confirmed'?'is pending':'later fails'}`,async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{
  test.hold='submit';test.publicEffect=()=>{const row=document.createElement('article');row.id='included-post';row.textContent='My ordinary message · Confirmation pending';document.getElementById('reader').replaceChildren(row);};
 });
 await open(page,{type:'post'});await page.getByLabel('Message',{exact:true}).fill('My ordinary message');
 await page.getByRole('button',{name:'Post',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 await page.evaluate(()=>{
  test.inclusion={stage:'included',intentId:'42',txHash:'0x'+'c'.repeat(64),blockNumber:108,blockHash:'0x'+'d'.repeat(64)};
  test.sessionProgress({...test.inclusion,intentId:'not-this-operation'});
 });
 assert(await page.locator('dialog').isVisible());assert.equal(await page.evaluate(()=>test.effects),0);
 const before=await page.evaluate(()=>({status:test.statusReads,sends:test.sends,bok:test.bokReads??0,sessions:test.sessions}));
 await page.evaluate(()=>test.sessionProgress(test.inclusion));await page.locator('#included-post').waitFor();
 assert(!await page.locator('dialog').isVisible());assert.equal(await page.locator('dialog').getAttribute('aria-busy'),'true');
 assert.equal(await page.locator('#included-post').innerText(),'My ordinary message · Confirmation pending');
 assert.deepEqual(await page.evaluate(()=>({status:test.statusReads,sends:test.sends,bok:test.bokReads??0,sessions:test.sessions})),before);
 assert.deepEqual(await page.evaluate(()=>panel.act({type:'like',post:'10'})),{status:'blocked',reason:'busy'});
 await page.evaluate(()=>test.sessionProgress(test.inclusion));assert.equal(await page.evaluate(()=>test.effects),1);
 if(outcome==='confirmed'){
  await page.getByRole('button',{name:'Open account',exact:true}).click();assert(await page.getByRole('button',{name:'Close account panel',exact:true}).isEnabled());
  await page.getByRole('button',{name:'Close account panel',exact:true}).click();assert(!await page.locator('dialog').isVisible());
  await page.getByRole('button',{name:'Open account',exact:true}).click();
 }
 await page.evaluate(outcome=>{if(outcome==='error')test.failure='submit';test.hold=null;test.release();},outcome);
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(await page.locator('dialog').isVisible());
 if(outcome==='error')assert(await page.getByRole('alert').isVisible());
 assert.equal(await page.evaluate(()=>test.effects),1);
});

test('automatic withdrawal hides history mechanics and completes required batches with one click',async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{
  test.balances={fee:{available:'1000000000000000000'},bok:null,collateral:{deposits:[{id:'9',amount:'1000000000000000',reason:'screening-required',eligible:false}],nextCursor:null}};
  test.withdrawalStates=[{screenedSequence:'0',needsScreening:true,readyAt:'200',anchor:{timestamp:'100'}},{screenedSequence:'0',needsScreening:true,readyAt:'200',anchor:{timestamp:'200'}},{screenedSequence:'2',needsScreening:true,readyAt:'200',anchor:{timestamp:'200'}},{screenedSequence:'4',needsScreening:false,readyAt:'200',anchor:{timestamp:'200'}}];
  test.hold='withdrawal-wait';
 });
 await open(page);await navigateAccount(page,'Balance and withdrawals');
 assert.equal(await page.getByRole('button',{name:'Check posts for withdrawal'}).count(),0);
 await page.getByRole('button',{name:'Withdraw deposit',exact:true}).click();
 await page.getByText(/Your withdrawal will continue automatically/).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),0);
 assert(await page.getByRole('button',{name:'Withdraw deposit',exact:true}).isDisabled());
 assert(!/screen|history|check posts/i.test(await page.locator('dialog').innerText()));
 await page.evaluate(()=>{test.hold=null;test.release();});
 await page.getByRole('button',{name:'Review Ethereum refund',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({sends:test.sends,prepares:test.prepares})),{sends:3,prepares:3});
 assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);
});

test('public checkpoint while composing does not queue a balance scan ahead of Post',async t=>{
 const {page}=await browserFixture(t);
 await open(page,{type:'post'});await page.getByLabel('Message',{exact:true}).waitFor();
 const before=await page.evaluate(()=>{test.hold='status';return test.statusReads;});
 await page.evaluate(()=>panel.observePublicPosts([],{confirmationCheckpoint:{number:50,hash:'0x'+'1'.repeat(64)}}));
 assert.equal(await page.evaluate(()=>test.statusReads),before);
 await page.getByLabel('Message',{exact:true}).fill('No balance scan ahead of Post.');
 await page.getByRole('button',{name:'Post',exact:true}).click();
 await page.waitForFunction(()=>test.sends===1&&!document.querySelector('dialog').open);
 assert.equal(await page.evaluate(()=>test.prepares),1);
 // Confirmed-account refresh is still allowed after submission completes.
 await page.evaluate(()=>{test.hold=null;test.release?.();});
});


test('name avatar optional upload is published in the single create-name action',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'name'});
 await page.getByLabel('First name',{exact:true}).fill('River');await page.getByLabel('Last name',{exact:true}).fill('Lane');
 await page.getByLabel('Avatar image',{exact:true}).setInputFiles(await imageFile(page));
 await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 const preview=await previewData(page);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Create name',exact:true}).click();await page.waitForFunction(()=>test.sends===1&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);
 assert.deepEqual(saved,{type:'name',first:'River',last:'Lane',avatar:{width:100,height:100,data:preview.data}});
 assert.equal((await counts(page)).prepares,1);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.profileCalls),0);
});
test('composer ring counts emoji overflow and plus moves it into one atomic thread action',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'post',subboard:'0'});
 await page.getByLabel('Message',{exact:true}).fill('🙂'.repeat(249));
 assert.equal(await page.locator('.message-budget-ring').innerText(),'−1');
 assert(await page.getByRole('button',{name:'Post',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Add another post',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Post 1',exact:true}).inputValue(),'🙂'.repeat(248));
 assert.equal(await page.getByRole('textbox',{name:'Post 2',exact:true}).inputValue(),'🙂');
 await page.getByRole('button',{name:'Post all',exact:true}).click();
 await page.waitForFunction(()=>test.sends===1&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);
 assert.deepEqual(saved,{type:'thread',deposit:'9',name:'0',subboard:'0',parent:'0',root:'0',contents:['🙂'.repeat(248),'🙂'],budgets:['0','0']});
 assert.equal((await counts(page)).prepares,1);assert.equal((await counts(page)).sends,1);assert.equal(await page.locator('dialog').isVisible(),false);
});
test('thread composer validates every post and removing a row preserves the others',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'reply',subboard:'0',parent:'11',root:'10'});
 await page.getByLabel('Message',{exact:true}).fill('First');await page.getByRole('button',{name:'Add another post',exact:true}).click();
 assert(await page.getByRole('button',{name:'Post all',exact:true}).isDisabled());
 await page.getByRole('textbox',{name:'Post 2',exact:true}).fill('x'.repeat(1000));assert.equal(await page.locator('.thread-draft .message-budget-ring').innerText(),'−8');
 assert(await page.getByRole('button',{name:'Post all',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Add another post',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Post 3',exact:true}).inputValue(),'xxxxxxxx');
 await page.getByRole('button',{name:'Remove post 2',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'Post 1',exact:true}).inputValue(),'First');assert.equal(await page.getByRole('textbox',{name:'Post 2',exact:true}).inputValue(),'xxxxxxxx');
 await page.getByRole('button',{name:'Post all',exact:true}).click();await page.waitForFunction(()=>test.sends===1);
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(action.parent,'11');assert.equal(action.root,'10');assert.deepEqual(action.contents,['First','xxxxxxxx']);
});
test('name avatar can be removed before creating the name without an image',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'name'});
 await page.getByLabel('First name',{exact:true}).fill('River');await page.getByLabel('Last name',{exact:true}).fill('Lane');
 await page.getByLabel('Avatar image',{exact:true}).setInputFiles(await imageFile(page));
 await page.getByRole('button',{name:'Remove selected avatar',exact:true}).waitFor();
 await page.getByRole('button',{name:'Remove selected avatar',exact:true}).click();assert.equal(await page.locator('dialog img').count(),0);
 await page.getByRole('button',{name:'Create name',exact:true}).click();await page.waitForFunction(()=>test.sends===1);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'name',first:'River',last:'Lane'});
});
test('name avatar saved preview blocks invalid bytes and restores a valid image for editing',async t=>{
 const {page}=await browserFixture(t),file=await imageFile(page);await open(page,{type:'name'});
 await page.getByLabel('Avatar image',{exact:true}).setInputFiles(file);
 await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 const preview=await previewData(page);await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.evaluate(data=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'prepared',maximumFee:'123',action:{type:'name',first:'River',last:'Lane',avatar:{width:100,height:100,data}}})),preview.data);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);
 await page.waitForFunction(()=>document.querySelector('[data-action-confirm]')?.disabled===false);
 assert.equal((await previewData(page)).data,preview.data);
 await page.getByRole('button',{name:'Back to editing',exact:true}).click();await page.getByRole('button',{name:'Remove selected avatar',exact:true}).waitFor();
 assert.equal((await previewData(page)).data,preview.data);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.evaluate(()=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'43',status:'prepared',maximumFee:'123',action:{type:'name',first:'River',last:'Lane',avatar:{width:100,height:100,data:btoa('<svg/>')}}})));
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByText(/saved avatar cannot be previewed safely/).waitFor();
 assert(await page.locator('[data-action-confirm]').isDisabled());assert.equal((await counts(page)).sends,0);
});


test('main-page posting credit opens ETH or USDC payment directly without pause checks',async t=>{
 const {page}=await browserFixture(t);
 await page.evaluate(()=>{test.topupEnabled=true;test.ethTopup=true;test.privateFeeCredit='12500000000000000000';const host=document.createElement('section');host.id='posting-credit-host';document.body.append(host);panel.attachIdentityControls(host);});
 await open(page);await page.locator('#posting-credit-host [data-posting-credit]').getByText('12.5',{exact:true}).waitFor();
 await page.evaluate(()=>panel.close());
 await page.locator('#posting-credit-host').getByRole('button',{name:'Add posting credit',exact:true}).click();
 await page.getByLabel('Posting credit amount',{exact:true}).fill('5');
 await page.getByLabel('Pay with',{exact:true}).selectOption('ETH');
 await page.getByRole('button',{name:'Pay',exact:true}).waitFor();
 await page.waitForFunction(()=>test.topupReview?.asset==='ETH'&&!document.querySelector('.credit-total strong:last-child')?.textContent.includes('—'));
 assert.equal(await page.getByRole('button',{name:'Pay',exact:true}).isEnabled(),true);
 assert.match(await page.locator('.credit-total').innerText(),/0.00025 ETH/);
 await page.getByLabel('Pay with',{exact:true}).selectOption('USDC');
 await page.waitForFunction(()=>test.topupReview?.asset==='USDC'&&document.querySelector('.credit-total')?.textContent.includes('0.75 USDC'));
 assert.equal(await page.getByRole('button',{name:'Pause checks',exact:true}).count(),0);
 assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
});
