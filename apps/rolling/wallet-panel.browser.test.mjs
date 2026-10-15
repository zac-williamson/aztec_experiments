// LABELLED UI DOUBLES: this suite tests presentation and no-replay controls only.
// RPC, custody, proofs and encrypted persistence are qualified separately. The
// sessionStorage recovery double below is NOT a production persistence mechanism.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import {chromium} from 'playwright';
const fixture=`import {advanceAggregateClaim} from '/aggregate-wallet.mjs';
import {mountRollingWalletPanel} from '/wallet-panel.mjs';
import {selectPrivateViews} from '/private-views.mjs';
const state={loads:0,sessions:0,prepares:0,sends:0,reconciles:0,cancels:0,closes:0,creates:0,imports:0,exports:0,effects:0,ended:0,owned:0,unlocked:true,options:null,failure:null,hold:null,release:null,fee:'fee-ready',profileCalls:0,bioVersion:'3',avatarVersion:'4'};
window.test=state;state.rawAccount={secretKey:'PRIVATE_SENTINEL',address:'HUMAN_IDENTITY_SENTINEL'};state.privateChanges=0;state.preferenceReads=0;state.statusReads=0;state.headReads=0;state.revision='4';state.recoveryChecks=0;state.replacementPrepares=0;state.resumes=0;state.submitCalls=0;state.preferences={scope:{chainId:'31337',version:'1',board:'1'},head:{schema:1,initialized:true,revision:'4',digest:'42'},bookmarks:['10'],followedBoards:['0'],followedNames:[],subscriptions:['10'],replyNotifications:true,readMarkers:[]};
state.previewBlobs=new Map();state.revoked=[];const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);state.previewBlobs.set(url,blob);return url;};URL.revokeObjectURL=url=>{state.revoked.push(url);state.previewBlobs.delete(url);revokeURL(url);};
const envelope={schemaVersion:1,kind:'aztec-billboard-encrypted-wallet',kdf:'PBKDF2-SHA256',iterations:600000,salt:'aa'.repeat(16),iv:'bb'.repeat(12),ciphertext:'cc'.repeat(16)};
const read=()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')||'null');
const write=value=>sessionStorage.setItem('labelled-ui-intent',JSON.stringify(value));
const error=()=>{throw Object.defineProperty(Error('PRIVATE_SENTINEL'), 'code',{get(){throw Error('GETTER_SENTINEL');}});};
async function boundary(name){for(const row of state.refreshRecords?.[name]??[])state.sessionProgress(row);if(state.hold===name)await new Promise(resolve=>state.release=resolve);if(state.failure===name)error();}
const application={
 async readBalances({cursor}){state.balanceReads=(state.balanceReads??0)+1;state.balanceCursor=cursor;await boundary('balances');return state.balances;},
 async readBokAccounting({cursor}){(state.accountingReads??=[]).push(cursor);await boundary('accounting');return state.accountingPages.shift();},
 async readModeratorStatus(){await boundary('moderator');return {authorized:state.moderator===true};},
 async readBokStatus(){return {available:state.bokCredit!==undefined,...(state.bokCredit!==undefined?{availableCredit:state.bokCredit}:{})};},
 async prepareBokPost(id){state.bokContinues=(state.bokContinues??0)+1;await boundary('bok-continue');const prior=read();if(prior.intentId!==id||!['authorized','bok-post-reverted'].includes(prior.status))error();const next={...prior,intentId:'43',status:'prepared',maximumFee:'234',bok:{...prior.bok,phase:'post',authorizationTxHash:'0x'+'7'.repeat(64)}};write(next);return next;},
 async prepareBokRelease(id,input){await boundary('bok-release');const prior=read();if(prior.intentId!==id||!['authorized','bok-post-reverted','bok-release-reverted'].includes(prior.status))error();state.releaseInput={id,...input};const next={intentId:'44',action:{type:input.type,requestId:'0x'+'1'.repeat(64)},status:'prepared',maximumFee:'234',bokRelease:{sourceIntentId:id},releasePrior:prior};write(next);return next;},
 async resumeSaved(id,input){state.resumes++;state.resumeInput={id,...input};state.sends++;await boundary('saved-resume');const next={...read(),txHash:input.expectedTxHash,status:state.resumeOutcome??'confirmed'};write(next);return next;},
 async inspectRecovery(id){state.recoveryChecks++;await boundary('recovery-options');return {...state.recoverySnapshot,intent:read()};},
 async prepareInterrupted(id){state.interruptedReviews=(state.interruptedReviews??0)+1;await boundary('interrupted-review');if(read().intentId!==id)error();const next={...read(),status:'prepared',maximumFee:'456'};write(next);return next;},
 async prepareReplacement(id,input){state.replacementPrepares++;state.replacementInput=input;await boundary('replacement-prepare');const current=read();const next={...current,status:'replacement-prepared',replacementReview:{sourceTxHash:input.expectedTxHash,head:input.expectedHead,marker:current.action.type==='read-marker'?state.recoverySnapshot.marker:null,maximumFee:'456'}};write(next);return next;},
 async readAccountStatus(){state.statusReads++;await boundary('status');const intent=read();return intent&&(!['confirmed','reverted','cancelled'].includes(intent.status)||['withdraw','withdraw-bok'].includes(intent.action.type)&&intent.status==='confirmed'&&!state.refunded)?{status:'recovering',intent}:{status:state.fee,privateFeeCredit:'1000',depositIds:state.fee==='fee-ready'?['9']:[]};},
 async ownedIdentities({cursor}){state.owned++;const page=state.namesPages?.[cursor]??(cursor===0?{identities:['7'],records:[{id:'7',first:'River',last:'Lane'}],nextCursor:8}:{identities:['8'],records:[{id:'8',first:'Ellis',last:'Moss'}],nextCursor:null});await boundary('owned');return page;},
 async readPreferenceHead(){state.headReads++;await boundary('head');return {schema:1,initialized:true,revision:state.revision,digest:'42'};},
 async readColdPreferences(){state.preferenceReads++;await boundary('preferences');return state.partial?{status:'recovering',complete:false,progress:{nextBlock:33,anchorBlock:80,processedRevision:'2',markersChecked:0,markersTotal:null}}:{status:'complete',complete:true,preferences:state.preferences};},
 async readProfile({name}){state.profileCalls++;await boundary('profile');return {name:'0x'+BigInt(name).toString(16).padStart(64,'0'),bioVersion:state.bioVersion,avatarVersion:state.avatarVersion};},
 async prepare(action){state.prepares++;if(action.type==='name'&&state.nameFailure)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:state.nameFailure});if(['bio','avatar'].includes(action.type)&&action.expectedVersion!==state[action.type+'Version'])error();write({intentId:'42',action,maximumFee:'123',status:'prepared',...(action.type==='name'?{nameAvailability:{id:'55',anchor:{blockNumber:1,blockHash:'0x'+'1'.repeat(64),timestamp:'1'}}}:{}),...(['moderate-post','moderate-avatar','reject-subboard','set-main-policy'].includes(action.type)?{moderation:{mainVersion:3,...(action.type==='moderate-avatar'?{avatarVersion:2}:{})}}:{}),...(action.type==='withdraw'?{withdrawal:{amount:'100000000000000000',eligible:true,depositor:'0x'+'3'.repeat(40)}}:{}),...(action.type==='withdraw-bok'?{withdrawal:{kind:'bok',amount:action.amount,eligible:true,depositor:action.recipient}}:{}),...(action.type==='bok'?{bok:{phase:'authorize',budget:action.budget,availableCredit:state.bokCredit}}:{})});await boundary('prepare');return read();},
 async submitPrepared(id){state.submitCalls++;state.sends++;write({...read(),status:'submitting'});await boundary('submit');const intent={...read(),status:state.submitOutcome??(read().bok?.phase==='authorize'?'authorized':'confirmed')};write(intent);return intent;},
 async cancelPrepared(){state.cancels++;write(read().releasePrior??{...read(),status:'cancelled'});return read();},
 async reconcile(){state.reconciles++;await boundary('reconcile');const intent=read();if(state.resolveOutcome){intent.status=state.resolveOutcome;write(intent);}return intent;}
};
const funding={get usdcAvailable(){return state.usdcEnabled===true;},defaultPrivateFeeCap:'1000',advanceClaim:()=>advanceAggregateClaim({application,funding,onProgress:row=>state.sessionProgress(row)}),
 async prepare(input){state.fundingPrepares=(state.fundingPrepares??0)+1;state.fundingAllocation=input;await boundary('funding-quote');if(input.asset==='USDC')return {kind:'rolling-aggregate-usdc-v1',walletName:'MetaMask',privateFeeCap:input.privateFeeCap,slippageBps:input.slippageBps,relayGasBudgetWei:'1000000000000000',breakdown:{collateral:{amount:input.collateralWei,maxUsdc:'5000000'},fee:{amount:input.feeAmount,maxUsdc:'1000000'},bokAmount:input.bokAmount,relayFeeUsdc:'100000',maximumUsdc:'9350000'}};return {walletName:'MetaMask',privateFeeCap:input.privateFeeCap,slippageBps:input.slippageBps,breakdown:{collateralWei:input.collateralWei,fee:{amount:input.feeAmount,maxEth:'1000'},bok:{amount:input.bokAmount,maxEth:'2000'},gasBudgetWei:input.gasBudgetWei,maximumTotalWei:(BigInt(input.collateralWei)+3000n+BigInt(input.gasBudgetWei)).toString()}};},
 async confirm(){state.fundingConfirms=(state.fundingConfirms??0)+1;if(state.fundingGasChanged)throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'ROLLING_FUNDING_GAS_CHANGED'});state.fundingPayments=(state.fundingPayments??0)+1;await boundary('funding-payment');state.paymentSaved=true;return this.recover();},
 async inspect(){return {paymentSaved:state.paymentSaved,privateFeeCap:state.fundingCap??'1000',claim:state.fundingClaim??null,explicitClaimReview:state.explicitClaimReview===true};},
 async checkpointClaim(value){state.fundingClaim=value;},
 async reviewRevertedClaim(){if(!['reverted','cancelled'].includes(read()?.status))error();state.fundingClaim=null;state.explicitClaimReview=true;},
 async recover(){state.fundingRecovers=(state.fundingRecovers??0)+1;return {receipt:{txHash:'0x'+'1'.repeat(64)},feeReceipt:{txHash:'0x'+'1'.repeat(64)},bokReceipt:{txHash:'0x'+'1'.repeat(64)}};}
};
const topup=Object.fromEntries(['private-fee','bok'].map(kind=>{const local={};const cap={defaultPrivateFeeCap:'1000',advanceClaim:()=>advanceAggregateClaim({application,funding:cap,onProgress:row=>state.sessionProgress(row)}),
 async prepare(input){state.topupReview={kind,...input};await boundary('topup-review');local.phase=local.approved?'deposit':'approval';return {kind,phase:local.phase,...input,walletName:'MetaMask'};},
 async confirm(){state.topupPayments=(state.topupPayments??0)+1;await boundary('topup-payment');if(local.phase==='approval'){local.approved=true;return {approved:true};}local.paid=true;return cap.recover();},
 async inspect(){return {paymentSaved:local.paid,claim:local.claim??null,privateFeeCap:'1000',claimAction:kind==='bok'?'claim-bok':'claim-private-fee'};},
 async checkpointClaim(value){local.claim=value;},async recover(){return {receipt:{txHash:'0x'+'1'.repeat(64),amount:'300'}};},async reviewRevertedClaim(){local.claim=null;}
 };return [kind,cap];}));
const runtime={selectPrivateViews,
 fundingWallets:()=>state.walletChoices??[],fundingWalletStatus:()=>state.fundingWallet??{connected:false},
 async connectFundingWallet(id){state.walletConnects=(state.walletConnects??0)+1;state.walletSelected=id;await boundary('funding-wallet');state.fundingWallet={connected:true,name:'MetaMask',address:'0x'+'1'.repeat(40)};},
 getAccount:()=>state.unlocked?state.rawAccount:null,
 account:{configure:options=>{state.options=options;},async create(){state.creates++;await boundary('create');state.unlocked=true;return envelope;},async importRecovery(){state.imports++;await boundary('import');state.unlocked=true;if(state.importWarning)state.options.onMessage(state.importWarning,'warn');},async exportRecovery(){state.exports++;await boundary('export');return envelope;},async endSession(){state.ended++;state.unlocked=false;return {reload:true};}},
 async createSession({onProgress}){state.sessions++;state.sessionProgress=onProgress;for(const record of state.initializationRecords??[])onProgress(record);await boundary('session');return {application,withdrawal:{async prepare(input){state.refundReviews=(state.refundReviews??0)+1;state.refundInput=input;await boundary('refund-review');return {amount:'100000000000000000',maximumGasWei:input.maximumGasWei,walletName:'MetaMask'};},async confirm(){state.refundSends=(state.refundSends??0)+1;await boundary('refund-send');state.refunded=true;return {status:'refunded',amount:read().withdrawal.amount};},async cancel(){state.refundCancelled=true;},async recover(){state.refundChecks=(state.refundChecks??0)+1;await boundary('refund-check');if(state.refundFound)state.refunded=true;return {status:state.refundFound?'refunded':'unknown'};}},topup:state.topupEnabled?topup:null,funding:state.aggregateEnabled?funding:null,busy:false,async close(){state.closes++;await boundary('close');}};}
};
window.panel=mountRollingWalletPanel({loadRuntime:async()=>{state.loads++;await boundary('load');return runtime;},onPublicEffect:()=>{state.effects++;},onPrivateChange:()=>{state.privateChanges++;}});
document.getElementById('open').onclick=()=>window.panel.open(window.defaults);
window.ready=true;`;
async function browserFixture(t){
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/'){res.writeHead(200,{'content-type':'text/html','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src blob:; base-uri 'none'; form-action 'none'"});res.end('<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><button id="open">Open account</button><div id="reader">Public reader</div><script type="module" src="/fixture.mjs"></script>');return;}
  if(req.url==='/fixture.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(fixture);return;}
  if(req.url==='/aggregate-wallet.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/aggregate-wallet.mjs',import.meta.url)));return;}
  const diagnosticModules={'/deployment.mjs':'../../shared/rolling/deployment.mjs','/protocol-commitments.mjs':'../../shared/protocol-commitments.mjs','/protocol-schema.mjs':'../../shared/protocol-schema.mjs'};
  if(Object.hasOwn(diagnosticModules,req.url)){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL(diagnosticModules[req.url],import.meta.url)));return;}
  if(req.url==='/invocation.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/invocation.mjs',import.meta.url)));return;}
  if(req.url==='/private-views.mjs'){res.writeHead(200,{'content-type':'text/javascript'});res.end(await fs.readFile(new URL('../../shared/rolling/private-views.mjs',import.meta.url)));return;}
  if(!['/wallet-panel.mjs','/avatar-upload.mjs','/model.mjs','/style.css'].includes(req.url)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':req.url.endsWith('.css')?'text/css':'text/javascript'});res.end(await fs.readFile(new URL('.'+req.url,import.meta.url)));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const browser=await chromium.launch({headless:true,...(process.env.T04_CHROMIUM_EXECUTABLE?{executablePath:process.env.T04_CHROMIUM_EXECUTABLE}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));
 t.after(()=>assert.deepEqual(errors,[]));await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.ready);
 return {page,requests};
}
async function open(page,defaults){if(defaults)await page.evaluate(value=>window.defaults=value,defaults);await page.getByRole('button',{name:'Open account',exact:true}).click();}
async function unlock(page){await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee',exact:true}).waitFor();}
async function prepare(page){await page.getByLabel('Message',{exact:true}).fill('Hello from the labelled UI double.');await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();}
const counts=page=>page.evaluate(()=>({loads:test.loads,sessions:test.sessions,prepares:test.prepares,sends:test.sends,reconciles:test.reconciles,effects:test.effects}));

test('public opening is SDK-free; dialog survives reader changes, traps focus and restores it',async t=>{
 const {page,requests}=await browserFixture(t);await open(page);assert.equal((await counts(page)).loads,0);
 await page.evaluate(()=>document.getElementById('reader').replaceChildren(document.createTextNode('Rerendered')));assert.equal(await page.getByRole('dialog').count(),1);
 await page.getByRole('button',{name:'Close account panel'}).focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Unlock');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Close account panel');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
 await open(page);assert.equal(await page.getByRole('dialog').count(),1);assert.equal((await counts(page)).loads,0);
 assert(requests.every(url=>!url.includes('aztec')&&!url.includes('/api/')));
});

test('private choices, multibyte limit, literal preview and explicit maximum-fee confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'reply',parent:'10',root:'1',subboard:'3'});await unlock(page);
 assert.equal(await page.evaluate(()=>test.options.requireEth),false);assert.equal(await page.evaluate(()=>test.options.autoPasskey),false);
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/1/10');assert.equal(await page.getByLabel('Reply to post ID').count(),0);assert.equal(await page.getByLabel('Root thread ID').count(),0);
 assert.equal(await page.getByLabel('Posting identity').inputValue(),'0');await page.getByRole('button',{name:'Load more owned names'}).click();await page.getByLabel('Posting identity').selectOption('8');
 await page.getByLabel('Message',{exact:true}).fill('😀'.repeat(249));assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'😀'.repeat(249));assert(await page.getByText(/249 characters · 996\/992/).isVisible());
 await page.getByLabel('Message',{exact:true}).fill('<img src=x onerror=alert(1)>');await page.getByText('Preview message',{exact:true}).click();assert.equal(await page.locator('.preview-body img').count(),0);
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();
 assert(await page.getByText(/Maximum network fee: 123 fee-juice units/).isVisible());assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'reply',subboard:'3',parent:'10',root:'1',content:'<img src=x onerror=alert(1)>',name:'8',deposit:'9'});
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
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction'}).waitFor();
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

test('explicit create, encrypted backup download, no automatic account creation and failed cleanup preserves account',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Create account and download recovery'}).waitFor();
 assert.equal(await page.evaluate(()=>test.creates),0);assert.equal(await page.evaluate(()=>test.imports),0);
 await page.getByLabel('Recovery password',{exact:true}).fill('a strong test-only password');const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Create account and download recovery'}).click();
 const download=await downloading;assert.equal(download.suggestedFilename(),'rolling-chat-encrypted-recovery.json');const downloaded=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(downloaded.kind,'aztec-billboard-encrypted-wallet');assert.equal(Object.hasOwn(downloaded,'secretKey'),false);
 await page.getByRole('button',{name:'Check action and review fee'}).waitFor();await page.getByText('Backup and account security',{exact:true}).click();await page.evaluate(()=>test.failure='close');await page.getByRole('button',{name:'Lock account',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>test.ended),0);
 await page.getByText('Backup and account security',{exact:true}).click();await page.getByLabel('New recovery password',{exact:true}).fill('a new test-only password');const exporting=page.waitForEvent('download');await page.getByRole('button',{name:'Download encrypted recovery'}).click();await exporting;assert.equal(await page.evaluate(()=>test.exports),1);
});

test('plaintext recovery warning survives import and unavailable connection without leaking other custody messages',async t=>{
 const warning='This imported file contains an unencrypted key. Create an encrypted recovery file and protect the original.';
 assert((await fs.readFile(new URL('../../shared/account.js',import.meta.url),'utf8')).includes("_wlog('"+warning+"','warn')"),'Use the existing actual custody warning');
 const {page}=await browserFixture(t);await page.evaluate(warning=>{test.unlocked=false;test.importWarning=warning;test.failure='session';},warning);
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Import recovery',exact:true}).waitFor();
 await page.getByText('Encrypted backup or unencrypted account file',{exact:true}).waitFor();await page.getByText(/A lost password cannot be reset/).waitFor();
 await page.getByLabel('Recovery file',{exact:true}).setInputFiles({name:'disposable-account.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.getByRole('button',{name:'Import recovery',exact:true}).click();
 await page.getByRole('button',{name:'Connect private account',exact:true}).waitFor();await page.getByText(warning,{exact:true}).waitFor();
 await page.evaluate(()=>test.options.onMessage('PRIVATE_SENTINEL unknown custody warning','warn'));assert.equal((await page.locator('body').innerText()).includes('PRIVATE_SENTINEL'),false);
 await page.getByText('Backup and account security',{exact:true}).click();await page.getByText(/If a deposit uses a new random claim secret/).waitFor();
 assert.equal(await page.evaluate(()=>test.imports),1);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page);await page.getByText(warning,{exact:true}).waitFor();
});

test('encrypted recovery import retains backup guidance without a false plaintext warning',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Import recovery',exact:true}).waitFor();
 await page.getByLabel('Recovery file',{exact:true}).setInputFiles({name:'disposable-encrypted-recovery.json',mimeType:'application/json',buffer:Buffer.from('{}')});await page.getByRole('button',{name:'Import recovery',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
 assert.equal(await page.getByText('This imported file contains an unencrypted key.',{exact:false}).count(),0);
 await page.getByText('Backup and account security',{exact:true}).click();await page.getByText(/A lost password cannot be reset/).waitFor();await page.getByText(/Download a fresh backup after funding or transaction recovery changes/).waitFor();
 assert.equal(await page.evaluate(()=>test.imports),1);assert.equal((await counts(page)).sends,0);
});

test('funding remains honest and unavailable connection has no action buttons or automatic retry',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.failure='session');await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Connect private account'}).waitFor();
 assert.equal((await counts(page)).sessions,1);assert.equal(await page.getByRole('button',{name:'Confirm and send'}).count(),0);assert.equal(await page.getByRole('button',{name:'Check action and review fee'}).count(),0);
 await page.evaluate(()=>{test.failure=null;test.fee='collateral-pending';});await page.getByRole('button',{name:'Connect private account'}).click();await page.getByText('No posting deposit was found.',{exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'Recover funding',exact:true}).isVisible());await page.getByLabel('Message',{exact:true}).fill('No collateral');assert(await page.getByRole('button',{name:'Check action and review fee'}).isDisabled());
 await page.getByLabel('Action').selectOption('subboard');await page.getByLabel('Permanent slug (3–40 lowercase letters, digits or single hyphens)').fill('small-tools');await page.getByLabel('Subboard name').fill('Small tools');await page.getByLabel('Description',{exact:true}).fill('Make useful things');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert.equal((await counts(page)).sends,0);
});

test('funding recovery imports only on request and requires a separate claim confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 const data={receipt:{txHash:'0x'+'40'.repeat(32),blockHash:'0x'+'41'.repeat(32),blockNumber:2,sender:'0x'+'33'.repeat(20),nonce:'1',amount:'100',leafIndex:'2',messageKey:'0x'+'01'.repeat(32),secretHash:'0x'+'02'.repeat(32)}};
 await page.getByLabel('Funding recovery receipt',{exact:true}).setInputFiles({name:'funding.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Check funding receipt',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert(await page.getByText('Collateral: 100 wei.',{exact:true}).isVisible());assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'claim-deposit',...data});
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});

test('recovery import is explicit; quote, repost, like and unlike retain exact selected targets',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Import recovery',exact:true}).waitFor();
 await page.getByLabel('Recovery file',{exact:true}).setInputFiles({name:'labelled-encrypted-double.json',mimeType:'application/json',buffer:Buffer.from('{}')});assert.equal(await page.evaluate(()=>test.imports),0);
 await page.getByLabel('Recovery password',{exact:true}).fill('test-only password');await page.getByRole('button',{name:'Import recovery',exact:true}).click();await page.getByRole('button',{name:'Check action and review fee'}).waitFor();assert.equal(await page.evaluate(()=>test.imports),1);
 for(const type of ['quote','repost','like','unlike']){
  await page.getByRole('button',{name:'Close account panel'}).click();await open(page,{type,reference:'22',post:'22'});await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
  if(type==='quote')await page.getByLabel('Message',{exact:true}).fill('A quote');
  await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Cancel prepared action'}).waitFor();
  const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(action.type,type);assert.equal(action[type==='quote'||type==='repost'?'reference':'post'],'22');
  await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Check action and review fee'}).waitFor();
 }
 assert.equal((await counts(page)).sends,0);
});


test('failed export without a private connection is not misreported as a connection failure',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.failure='session');await open(page);
 await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Connect private account'}).waitFor();
 assert.match(await page.getByRole('alert').innerText(),/private connection is unavailable/);
 await page.getByText('Backup and account security',{exact:true}).click();
 await page.getByLabel('New recovery password',{exact:true}).fill('a new test-only password');
 await page.evaluate(()=>test.failure='export');await page.getByRole('button',{name:'Download encrypted recovery'}).click();
 await page.waitForFunction(()=>test.exports===1);
 assert.match(await page.getByRole('alert').innerText(),/This operation could not be completed/);
 assert.doesNotMatch(await page.getByRole('alert').innerText(),/private connection|PRIVATE_SENTINEL|GETTER_SENTINEL/);
 assert.equal((await counts(page)).sessions,1);assert.equal((await counts(page)).sends,0);
});

async function selectProfile(page,type){await page.getByLabel('Action',{exact:true}).selectOption(type);await page.getByLabel('Profile name',{exact:true}).selectOption('7');await page.waitForFunction(()=>!document.querySelector('dialog').matches('[aria-busy="true"]'));}
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
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send');return b&&!b.disabled;});
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
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByText(/saved avatar cannot be previewed safely/).waitFor();assert(await page.getByRole('button',{name:'Confirm and send'}).isDisabled());assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await selectProfile(page,'avatar');await page.getByLabel('Avatar image').setInputFiles(await imageFile(page));await page.waitForFunction(()=>document.querySelector('dialog img')?.naturalWidth===100&&!document.querySelector('dialog').matches('[aria-busy="true"]'));
 assert.equal(await page.evaluate(()=>test.previewBlobs.size),1);await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.evaluate(()=>test.previewBlobs.size),0);assert.equal(await page.locator('dialog img').count(),0);assert.equal(await page.getByRole('button',{name:'Confirm and send'}).count(),0);
});
for(const [code,copy] of [['ROLLING_NAME_TAKEN','This name is already registered.'],['ROLLING_NAME_AVAILABILITY_UNAVAILABLE','Name availability could not be checked.']])test('name availability feedback '+code+' preserves an editable draft without a transaction',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Action').selectOption('name');
 await page.getByLabel('First name',{exact:true}).fill('John');await page.getByLabel('Last name',{exact:true}).fill('Doe');await page.evaluate(code=>test.nameFailure=code,code);
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('alert').waitFor();assert((await page.getByRole('alert').innerText()).includes(copy));
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
 await page.getByRole('button',{name:'Your names',exact:true}).click();await page.getByRole('heading',{name:'Your names',exact:true}).waitFor();
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
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByRole('button',{name:'Your names',exact:true}).click();
 await page.evaluate(()=>test.failure='owned');await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('alert').waitFor();
 const attempted=await page.evaluate(()=>test.owned);assert.equal(attempted,2);assert.deepEqual(await page.getByRole('list',{name:'Your registered names'}).locator('li p').allTextContents(),['River Lane']);
 await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('button',{name:'Your names',exact:true}).click();assert.equal(await page.evaluate(()=>test.owned),attempted);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('button',{name:'Edit bio for Ellis Moss',exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.owned),attempted+1);
 assert.equal((await counts(page)).sends,0);
});

test('names management reuses registration and version-checked profile fee confirmation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByRole('button',{name:'Your names',exact:true}).click();
 await page.getByRole('button',{name:'Register a name',exact:true}).click();assert.equal(await page.getByLabel('Action',{exact:true}).inputValue(),'name');assert.equal(await page.evaluate(()=>test.profileCalls),0);
 await page.getByLabel('First name',{exact:true}).fill('Mira');await page.getByLabel('Last name',{exact:true}).fill('Vale');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Cancel prepared action'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),{type:'name',first:'Mira',last:'Vale'});assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Your names',exact:true}).click();await page.getByRole('button',{name:'Edit bio for River Lane',exact:true}).click();
 await page.getByLabel('Bio (empty to clear)').waitFor();assert.equal(await page.getByLabel('Profile name').inputValue(),'7');assert.equal(await page.evaluate(()=>test.profileCalls),1);
 await page.getByLabel('Bio (empty to clear)').fill('Edit from private names');await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('button',{name:'Confirm and send'}).waitFor();assert(await page.getByText(/Maximum network fee: 123/).isVisible());assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action'}).click();await page.getByRole('button',{name:'Your names',exact:true}).click();await page.getByRole('button',{name:'Edit avatar for River Lane',exact:true}).click();await page.getByLabel('Avatar image').waitFor();assert.equal(await page.getByLabel('Profile name').inputValue(),'7');assert.equal(await page.evaluate(()=>test.profileCalls),2);
 await page.getByRole('button',{name:'Your names',exact:true}).click();await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByLabel('Action').selectOption('post');assert.deepEqual(await page.getByLabel('Posting identity').locator('option').allTextContents(),['Anonymous','River Lane']);
});

for(const boundary of ['owned','profile'])test(`account invalidation clears names/drafts immediately and discards delayed ${boundary} results`,async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Message',{exact:true}).fill('PRIVATE_DRAFT_SENTINEL');await page.getByRole('button',{name:'Your names',exact:true}).click();
 await page.evaluate(value=>test.hold=value,boundary);
 await page.getByRole('button',{name:boundary==='owned'?'Load more owned names':'Edit bio for River Lane',exact:true}).click();await page.waitForFunction(()=>typeof test.release==='function');
 await page.evaluate(()=>{test.options.onChange({invalidated:true});test.namesPages={0:{identities:['9'],records:[{id:'9',first:'Mira',last:'Vale'}],nextCursor:null}};});
 assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);assert.equal(await page.locator('dialog select').count(),0);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));
 await page.evaluate(()=>test.release());await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(!/River Lane|Ellis Moss|Mira Vale|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));assert.equal(await page.getByRole('button',{name:'Check action and review fee'}).count(),0);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Close account panel'}).click();await open(page);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));
});

test('locking from names management removes names and drafts without deleting retained recovery',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByLabel('Message',{exact:true}).fill('PRIVATE_DRAFT_SENTINEL');await page.getByRole('button',{name:'Your names',exact:true}).click();
 await page.getByText('Backup and account security',{exact:true}).click();await page.getByRole('button',{name:'Lock account',exact:true}).click();await page.getByRole('button',{name:'Reload to unlock'}).waitFor();
 assert.equal(await page.evaluate(()=>test.ended),1);assert.equal(await page.evaluate(()=>test.closes),1);assert(!/River Lane|Ellis Moss|PRIVATE_DRAFT_SENTINEL/.test(await page.getByRole('dialog').innerText()));assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);
});

test('empty private names view offers registration without inventing identities or public lookups',async t=>{
 const {page,requests}=await browserFixture(t);await page.evaluate(()=>test.namesPages={0:{identities:[],records:[],nextCursor:null}});await open(page);await unlock(page);await page.getByRole('button',{name:'Your names',exact:true}).click();
 assert(await page.getByText(/No registered names were found/).isVisible());assert.equal(await page.getByRole('link',{name:/View public profile/}).count(),0);assert.equal(await page.getByRole('button',{name:'Load more owned names'}).count(),0);
 assert(await page.getByRole('button',{name:'Register a name',exact:true}).isEnabled());await page.getByRole('button',{name:'Actions',exact:true}).click();assert.deepEqual(await page.getByLabel('Posting identity').locator('option').allTextContents(),['Anonymous']);assert(!requests.some(url=>url.includes('/api/')));
});
for(const invalidPage of ['duplicate','cursor'])test('invalid private names '+invalidPage+' page preserves current list and stops without retry',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);await page.getByRole('button',{name:'Your names',exact:true}).click();
 await page.evaluate(kind=>test.namesPages={8:kind==='duplicate'?{identities:['7'],records:[{id:'7',first:'Forged',last:'Label'}],nextCursor:null}:{identities:['8'],records:[{id:'8',first:'Ellis',last:'Moss'}],nextCursor:8}},invalidPage);
 await page.getByRole('button',{name:'Load more owned names',exact:true}).click();await page.getByRole('alert').waitFor({timeout:3000}).catch(async error=>{t.diagnostic(JSON.stringify(await page.evaluate(()=>({owned:test.owned,busy:document.querySelector('dialog').getAttribute('aria-busy'),alerts:document.querySelectorAll('[role=alert]').length}))));throw error;});assert.deepEqual(await page.getByRole('list',{name:'Your registered names'}).locator('li p').allTextContents(),['River Lane']);assert.equal(await page.evaluate(()=>test.owned),2);assert.equal((await counts(page)).sends,0);
});

// Labelled presentation doubles: production replay, wallet proofs and storage are
// independently qualified; these tests assert explicit UI boundaries only.
test('private recovery is explicit, one bounded step, and never exposes partial preferences',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');
 await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Recover private views',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.statusReads),0);assert.equal(await page.evaluate(()=>test.owned),0);assert(await page.getByText('Recover saved choices without checking funds or preparing a transaction.',{exact:true}).isVisible());assert.equal(await page.getByText('Your posting balance is available.',{exact:false}).count(),0);assert.equal(await page.evaluate(()=>test.preferenceReads),0);await page.evaluate(()=>test.partial=true);
 await page.getByRole('button',{name:'Recover private views',exact:true}).click();await page.getByRole('button',{name:'Continue private recovery',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);assert.equal(await page.evaluate(()=>test.preferenceReads),1);assert(await page.getByText('Next history block to check: 33',{exact:true}).isVisible());
 await page.evaluate(()=>test.partial=false);await page.getByRole('button',{name:'Continue private recovery',exact:true}).click();await page.getByText('Your saved choices are ready.').waitFor();
 assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),true);assert.equal(await page.evaluate(()=>test.sends),0);
 assert(await page.getByText('Your follows, bookmarks and notification settings have been recovered.',{exact:true}).isVisible());assert.equal(await page.getByText(/fee-juice units|deposit IDs|action check/).count(),0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);if(process.env.ROLLING_PREFERENCES_COMPLETE_SCREENSHOT){await page.getByRole('button',{name:'Disable reply notifications'}).scrollIntoViewIfNeeded();await page.screenshot({path:process.env.ROLLING_PREFERENCES_COMPLETE_SCREENSHOT,fullPage:true});}
 await page.getByRole('button',{name:'Close account panel'}).click();await page.evaluate(()=>{test.rawAccount={};});assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);
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
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Recover private views'}).waitFor();
 await page.evaluate(()=>test.hold='preferences');await page.getByRole('button',{name:'Recover private views'}).click();await page.waitForFunction(()=>test.release);
 await page.evaluate(()=>test.options.onChange({invalidated:true}));assert.equal(await page.evaluate(()=>panel.privateStatus()),'locked');assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload to unlock'}).waitFor();assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);
});
test('preference head failure does not prepare and recovery failure never implies an empty successful view',async t=>{
 const {page}=await browserFixture(t);await open(page,{type:'preference',kind:1,target:'10',enabled:false});await unlock(page);await page.evaluate(()=>test.failure='head');
 await page.getByRole('button',{name:'Check action and review fee'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>test.prepares),0);
 await page.evaluate(()=>test.failure=null);await page.getByRole('button',{name:'Check account recovery'}).click();await page.getByRole('button',{name:'Private views',exact:true}).click();await page.evaluate(()=>test.failure='preferences');await page.getByRole('button',{name:'Recover private views'}).click();await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>panel.preferenceEnabled(1,'10')),null);
});
test('locking clears recovered private capability before asynchronous session cleanup settles',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Recover private views'}).click();await page.getByText('Your saved choices are ready.').waitFor();
 await page.getByText('Backup and account security',{exact:true}).click();await page.evaluate(()=>test.hold='close');await page.getByRole('button',{name:'Lock account',exact:true}).click();await page.waitForFunction(()=>test.release);assert.notEqual(await page.evaluate(()=>panel.privateStatus()),'complete');await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload to unlock'}).waitFor();
});
test('explicit recovery abort waits for the original private call and does not publish its late complete result',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Recover private views'}).waitFor();
 await page.evaluate(()=>test.hold='preferences');await page.getByRole('button',{name:'Recover private views'}).click();await page.waitForFunction(()=>test.release);await page.getByRole('button',{name:'Stop private recovery'}).click();
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');await page.keyboard.press('Escape');assert(await page.getByRole('dialog').isVisible());assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');
 await page.evaluate(()=>test.release());await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>panel.privateStatus()),'recovering');assert.equal(await page.evaluate(()=>test.preferenceReads),1);assert.equal(await page.evaluate(()=>test.sends),0);
});

// Actual production DOM and driver; account/RPC behavior remains a labelled UI double.
test('preference lock driver waits for delayed reopen refresh before expanding security',async t=>{
 const {lockRollingPreferencePanel}=await import('../../scripts/testing/rolling-preference-browser.mjs');
 const {page}=await browserFixture(t);await open(page);await unlock(page);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();
 await page.evaluate(()=>test.hold='status');await open(page);
 await page.waitForFunction(()=>typeof test.release==='function');
 const dialog=page.getByRole('dialog'),deadline=Date.now()+3000;
 const locking=lockRollingPreferencePanel({dialog,remaining:()=>Math.max(1,deadline-Date.now())});
 // Attach rejection immediately so the intentionally failing pre-fix case cannot
 // outlive this test or become an unhandled rejection during browser teardown.
 const result=locking.then(value=>({value}),error=>({error}));let observationError;
 try{
  await page.waitForTimeout(200);
  assert.equal(await dialog.getByText('Backup and account security',{exact:true}).evaluate(node=>node.parentElement.open),false,'Security must stay closed while refresh owns the panel');
 }catch(error){observationError=error;}finally{await page.evaluate(()=>{test.hold=null;test.release();});}
 const outcome=await result;if(observationError)throw observationError;if(outcome.error)throw outcome.error;assert.equal(outcome.value,'ready');
 assert.equal(await page.evaluate(()=>test.closes),1);assert.equal(await page.evaluate(()=>test.ended),1);
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
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
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check recovery options',exact:true}).waitFor();
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
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Confirm replacement and send'}).waitFor();
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
 await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload to unlock'}).waitFor();assert.equal(await page.getByRole('button',{name:'Review replacement',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.replacementPrepares+test.sends),0);
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
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.waitForFunction(()=>test.release);
 assert(await page.getByText('Loading private account tools…',{exact:true}).isVisible());
 assert.equal(await page.getByRole('dialog').getAttribute('aria-busy'),'true');
 await page.evaluate(()=>{test.hold=null;test.release();});await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);
 assert(await page.getByRole('heading',{name:prepared?'Review replacement before sending':'Transaction recovery',exact:true}).isVisible());
 assert(await page.getByRole('button',{name:prepared?'Confirm replacement and send':'Check existing transaction',exact:true}).isVisible());
 assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.replacementPrepares+test.recoveryChecks),0);
});

test('settled connection message cleanup preserves custody guidance and failed connection alert',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.unlocked=false);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(await page.getByText('Create an account or import your encrypted recovery file.',{exact:true}).isVisible());
 assert.equal(await page.getByText('Loading private account tools…',{exact:true}).count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>test.failure='status');await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('alert').waitFor();assert(await page.getByText('The private connection is unavailable. Your encrypted recovery is preserved. Reconnect when the service returns.',{exact:true}).isVisible());
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
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check recovery options',exact:true}).waitFor();
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
 await page.evaluate(()=>test.release());await page.getByRole('button',{name:'Reload to unlock',exact:true}).waitFor();assert.equal(await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.resumes),1);
});

// Actual production panel + exact campaign interaction helper. Application
// callbacks remain labelled doubles; this cannot qualify real proofs/recovery.
test('notification campaign reviews, confirms, then navigates to private recovery',async t=>{
 const {reviewRollingNotificationAction}=await import('../../scripts/testing/rolling-notification-browser.mjs');
 const {waitForRollingComposerState}=await import('../../scripts/testing/rolling-composer-browser.mjs');
 const {page}=await browserFixture(t);await open(page,{type:'preference',kind:4,target:'10',enabled:true});await unlock(page);
 const d=page.getByRole('dialog',{name:'Your private account',exact:true});let expires=Date.now()+3000;
 const remaining=()=>{const value=expires-Date.now();assert(value>0);return value;};
 const settled=async ready=>assert.equal(await waitForRollingComposerState({dialog:d,ready,remaining}),'ready');
 let recovered=0;const phases=[],steps=[];
 async function run(reviewText){expires=Date.now()+3000;await reviewRollingNotificationAction({dialog:d,remaining,settled,reviewText,onStep:step=>steps.push(step),onReviewed:()=>phases.push('reviewed'),onConfirm:()=>phases.push('confirmed-send'),onConfirmed:()=>phases.push('included'),recover:async()=>{
  const button=d.getByRole('button',{name:'Recover private views',exact:true});await settled(button);await button.click({timeout:remaining()});await settled(d.getByText('Your saved choices are ready.',{exact:true}));recovered++;
 }});}
 await run('Enable thread subscription for 10. This preference is encrypted, not a public ownership list.');assert.equal(recovered,1);assert.equal((await counts(page)).sends,1);
 await d.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{type:'read-marker',thread:'10',throughBlock:'80'});
 await run('Mark this thread read through block 80');assert.equal(recovered,2);assert.equal((await counts(page)).sends,2);assert.deepEqual(phases,['reviewed','confirmed-send','included','reviewed','confirmed-send','included']);assert.deepEqual(steps,Array(2).fill(['fee-review','send','confirmation','private-navigation-ready','private-navigation-click','private-recovery','recovered']).flat());
});

test('cold private view cannot prepare a preference before checking retained financial recovery',async t=>{
 const {page}=await browserFixture(t);await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('button',{name:'Recover private views',exact:true}).click();await page.getByText('Your saved choices are ready.').waitFor();
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
 await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'session-initialization',step:'deployment',deploymentStep:'board-instance',state:'failed',code:'ROLLING_DEPLOYMENT_INVALID'});
 assert.match(await page.getByRole('alert').innerText(),/The private connection is unavailable/);assert(!await dialog.innerText().then(s=>s.includes('board-instance')||s.includes('PRIVATE_SENTINEL')));
 await page.evaluate(()=>{test.oldProgress=test.sessionProgress;test.failure=null;test.hold='session';test.initializationRecords=[];});await page.getByRole('button',{name:'Connect private account',exact:true}).click();await page.waitForFunction(()=>test.sessions===2&&test.release);
 assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);await page.evaluate(()=>test.oldProgress({stage:'session-initialization',step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'}));assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);
 await page.evaluate(()=>{test.sessionProgress({stage:'session-initialization',step:'application-bind',deploymentStep:null,state:'complete',code:null});test.release();});await page.getByRole('button',{name:'Recover private views',exact:true}).waitFor();
 assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'application-bind');assert.deepEqual(await page.evaluate(()=>[test.statusReads,test.owned,test.preferenceReads,test.sends]),[0,0,0,0]);
});
test('initialization projection ignores accessors and account invalidation clears late observations',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.initializationRecords=[{stage:'session-initialization',step:'application-bind',deploymentStep:null,state:'complete',code:null}];});await open(page,{view:'preferences'});await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Recover private views',exact:true}).waitFor();
 await page.evaluate(()=>{test.getterReads=0;const bad={step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'};Object.defineProperty(bad,'stage',{get(){test.getterReads++;throw Error('PRIVATE_SENTINEL');}});test.sessionProgress(bad);});assert.equal(await page.evaluate(()=>test.getterReads),0);
 const dialog=page.getByRole('dialog');assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'application-bind');
 await page.evaluate(()=>{test.rawAccount={address:'OTHER_PRIVATE_SENTINEL'};test.options.onChange({invalidated:true});test.sessionProgress({stage:'session-initialization',step:'pxe-create',deploymentStep:null,state:'failed',code:'unknown'});});
 assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);await page.getByRole('button',{name:'Reload to unlock',exact:true}).waitFor();assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')));assert.equal((await counts(page)).sends,0);
});


test('Bok composer reviews credit and both fees, restores authorized draft and never auto-publishes',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByText('Available private Bok credit: 1000.',{exact:true}).waitFor();
 await page.getByText('New conversation',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Main board',exact:true}).getAttribute('href'),'#/board/0');assert.equal(await page.getByLabel('Reply to post ID').count(),0);
 await page.getByLabel('Message',{exact:true}).fill('Ask Bok with the exact saved draft');await page.getByLabel('Maximum Bok credits',{exact:true}).fill('400');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);await page.getByText('Bok request budget: 400 credits. This is separate from the network fee.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,1);assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();
 await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();assert.equal((await counts(page)).sends,0);
 await page.getByText('content: Ask Bok with the exact saved draft',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 await page.getByText('Maximum network fee: 234 fee-juice units. This is a maximum, not a guaranteed final charge.',{exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal(await page.getByRole('button',{name:'Cancel prepared action',exact:true}).count(),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});
test('Bok composer hides unavailable capability and rejects unaffordable budgets before preparation',async t=>{
 const {page}=await browserFixture(t);await open(page);await unlock(page);assert.equal(await page.locator('option[value="bok"]').count(),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>test.bokCredit='20');await open(page);await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Message',{exact:true}).fill('Bok draft');
 for(const budget of ['0','21','-1','1e2']){await page.getByLabel('Maximum Bok credits',{exact:true}).fill(budget);assert.equal(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled(),true);}
 assert.equal((await counts(page)).prepares,0);
});
test('Bok continuation failure preserves authorized recovery without another credit authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='1000';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'authorized',action:{type:'bok',content:'Saved Bok draft',budget:'400'},maximumFee:'123',bok:{phase:'authorize',budget:'400',availableCredit:'1000'}}));test.failure='bok-continue';});
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();
 await page.getByRole('alert').waitFor();assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'authorized');
});

test('Bok reverted post stays in explicit saved-request recovery after reopen without a new authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'43',status:'bok-post-reverted',action:{type:'bok',content:'Saved funded Bok draft',budget:'400'},maximumFee:'123',bok:{phase:'post',budget:'400',availableCredit:'1000',authorizationTxHash:'confirmed-authorize'}}));});
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 await page.getByText(/The post reverted. Its paid network fee is not refunded/).waitFor();assert.equal(await page.getByLabel('Action',{exact:true}).count(),0);
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);
 await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,0);assert.equal((await counts(page)).prepares,0);assert.equal(await page.getByRole('button',{name:'Cancel prepared action',exact:true}).count(),0);
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
 await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 assert.equal(await page.evaluate(()=>test.walletConnects??0),0);
 assert(await page.getByRole('button',{name:'Connect Phantom <script>',exact:true}).isVisible());
 await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByText('Funding wallet connected. No payment has been sent.',{exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({selected:test.walletSelected,connections:test.walletConnects,prepares:test.prepares,sends:test.sends})),{selected:'metamask',connections:1,prepares:0,sends:0});
 assert(await page.getByText('MetaMask connected: 0x1111…1111',{exact:true}).isVisible());
 assert.equal(await page.locator('body').innerText().then(v=>v.includes('HUMAN_IDENTITY_SENTINEL')),false);
});

test('rejected funding connection retains recovery and sends nothing',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.walletChoices=[{id:'metamask',name:'MetaMask'}];test.failure='funding-wallet';});
 await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();await page.getByRole('button',{name:'Connect MetaMask',exact:true}).click();
 await page.getByRole('alert').waitFor();assert(!((await page.getByRole('alert').innerText()).includes('PRIVATE_SENTINEL')));
 assert(await page.getByRole('button',{name:'Check funding receipt',exact:true}).isVisible());
 assert.equal(await page.evaluate(()=>test.sends),0);
});
async function aggregateQuote(page,slippage){
 await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 await page.getByLabel('Posting deposit (ETH)',{exact:true}).fill('0.1');await page.getByLabel('Network fee credit (fee tokens)',{exact:true}).fill('2');
 await page.getByLabel('Bok credit (USDC)',{exact:true}).fill('3.25');await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).fill('0.003');
 if(slippage!==undefined)await page.getByLabel('Slippage limit (%)',{exact:true}).fill(slippage);
 await page.getByRole('button',{name:'Get fresh quote',exact:true}).click();await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).waitFor();
}
test('aggregate funding UI reviews exact allocations and consent before one payment and one bounded private claim',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page);
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
 assert.deepEqual(await page.evaluate(()=>test.fundingAllocation),{asset:'ETH',collateralWei:'100000000000000000',feeAmount:'2000000000000000000',bokAmount:'3250000',gasBudgetWei:'3000000000000000',feePoolFee:3000,bokPoolFee:3000,slippageBps:100,privateFeeCap:'1000'});
 assert(await page.getByText(/scoped collateral consent signature/).isVisible());
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();await page.getByText('Funding and the private claim are confirmed.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.fundingClaim.attempted),true);
});
test('aggregate gas refusal explains explicit changed maximum and requires a fresh quote and confirmation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fundingGasChanged=true;});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();
 await page.getByRole('button',{name:'Get fresh quote',exact:true}).waitFor();
 assert.match(await page.getByRole('alert').innerText(),/Ethereum gas costs exceed your approved maximum/);
 assert.match(await page.getByRole('alert').innerText(),/fresh quote and confirm again/);
 assert(!await page.getByRole('dialog').innerText().then(text=>text.includes('PRIVATE_SENTINEL')));
 assert.equal(await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).inputValue(),'0.003');
 assert.equal(await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).count(),0);
 assert.deepEqual(await page.evaluate(()=>({quotes:test.fundingPrepares,confirms:test.fundingConfirms,payments:test.fundingPayments??0,sends:test.sends})),{quotes:1,confirms:1,payments:0,sends:0});
 await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).fill('0.004');
 await page.evaluate(()=>{test.fundingGasChanged=false;});
 assert.equal(await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).count(),0);
 await page.getByRole('button',{name:'Get fresh quote',exact:true}).click();
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingAllocation.gasBudgetWei),'4000000000000000');
 assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();
 await page.getByText('Funding and the private claim are confirmed.',{exact:false}).waitFor();
 assert.deepEqual(await page.evaluate(()=>({quotes:test.fundingPrepares,confirms:test.fundingConfirms,payments:test.fundingPayments,sends:test.sends})),{quotes:2,confirms:2,payments:1,sends:1});
});
test('aggregate funding UI pauses a larger private claim fee without another Ethereum payment',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.fundingCap='100';});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();await page.getByText('The private claim needs a new review.',{exact:false}).waitFor();
 assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.fundingClaim.attempted),false);
});
test('aggregate funding UI reconciles an unknown claim without repeat payment or submission',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.submitOutcome='unknown';});await open(page);await unlock(page);await aggregateQuote(page);
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();await page.getByText('Checking the saved private claim.',{exact:false}).waitFor();
 await page.getByRole('button',{name:'Pause bridge checks',exact:true}).click();await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();
 await page.waitForFunction(()=>test.reconciles===1);assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);
 await page.getByRole('button',{name:'Close account panel'}).click();
});
test('aggregate funding UI links an exact prepared claim after checkpoint interruption without preparing twice',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);
 await page.getByRole('button',{name:'Recover funding',exact:true}).click();await page.evaluate(()=>{
  test.paymentSaved=true;const r={txHash:'0x'+'1'.repeat(64)};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:r,feeReceipt:r,bokReceipt:r},maximumFee:'123',status:'prepared'}));
 });
 await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();await page.getByText('Funding and the private claim are confirmed.',{exact:false}).waitFor();
 assert.equal((await counts(page)).prepares,0);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});
test('aggregate funding UI exposes explicit saved review after attempt checkpoint precedes submission',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 await page.evaluate(()=>{test.paymentSaved=true;test.fundingClaim={intentId:'42',attempted:true};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:{}},maximumFee:'123',status:'prepared'}));});
 await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();await page.getByText('This saved claim has not been submitted.',{exact:false}).waitFor();
 assert.equal((await counts(page)).sends,0);assert(await page.getByRole('button',{name:'Confirm and send',exact:true}).isVisible());assert.equal(await page.getByRole('button',{name:'Pause bridge checks',exact:true}).count(),0);
});

test('aggregate funding UI preserves fractional slippage as exact basis points before consent',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await aggregateQuote(page,'0.75');
 assert.equal(await page.evaluate(()=>test.fundingAllocation.slippageBps),75);assert(await page.getByText(/Slippage limit: 0.75%/).isVisible());assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
});

test('USDC funding UI reviews two signatures and total relay reimbursement without asking the user for ETH gas',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.usdcEnabled=true;});await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 await page.getByLabel('Pay with',{exact:true}).selectOption('USDC');assert.equal(await page.getByLabel('Maximum Ethereum gas cost (ETH)',{exact:true}).count(),0);
 await page.getByLabel('Posting deposit (ETH)',{exact:true}).fill('0.1');await page.getByLabel('Network fee credit (fee tokens)',{exact:true}).fill('2');await page.getByLabel('Bok credit (USDC)',{exact:true}).fill('3.25');
 await page.getByRole('button',{name:'Get fresh quote',exact:true}).click();await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).waitFor();
 assert(await page.getByText(/two scoped signatures/).isVisible());assert(await page.getByText(/Maximum total: 9.35 USDC/).isVisible());
 const allocation=await page.evaluate(()=>test.fundingAllocation);assert.equal(allocation.asset,'USDC');assert.equal(allocation.collateralPoolFee,3000);assert.equal(allocation.gasBudgetWei,undefined);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm funding and private claim',exact:true}).click();await page.getByText('Funding and the private claim are confirmed.',{exact:false}).waitFor();assert.equal(await page.evaluate(()=>test.fundingPayments),1);assert.equal((await counts(page)).sends,1);
});

for(const status of ['reverted','cancelled'])test(`canonical ${status} funding claim requires explicit renewed review and never repeats the original payment`,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.aggregateEnabled=true);await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 await page.evaluate(status=>{test.paymentSaved=true;test.fundingClaim={intentId:'42',attempted:true};sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',action:{type:'claim-deposit',receipt:{amount:'100'}},maximumFee:'123',status}));},status);
 await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();await page.getByRole('button',{name:'Review private claim again',exact:true}).click();
 await page.getByText('The private claim needs a new review.',{exact:false}).waitFor();assert.equal((await counts(page)).sends,0);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.waitForFunction(()=>test.sends===1);assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});

for(const kind of ['private-fee','bok'])test(`standalone ${kind} UI separates approval, deposit and private claim without collateral`,async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.topupEnabled=true;test.bokCredit='2500000';});await open(page);await unlock(page);await page.getByRole('button',{name:'Top up fees or Bok',exact:true}).click();
 assert(await page.getByText('Private Bok balance: 2.5 USDC-backed credits.',{exact:true}).isVisible());await page.getByLabel('Top-up credit',{exact:true}).selectOption(kind);await page.getByLabel(kind==='bok'?'USDC top-up amount':'Fee token top-up amount',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Review top-up',exact:true}).click();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);assert(await page.getByText(/This does not deposit or claim/).isVisible());
 await page.getByRole('button',{name:'Confirm token approval',exact:true}).click();await page.getByText('Token approval confirmed. Review the separate top-up payment; no deposit is sent automatically.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.topupPayments),1);assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Review top-up',exact:true}).click();await page.getByRole('button',{name:'Confirm top-up and private claim',exact:true}).click();await page.getByText('Top-up and private claim confirmed. Your posting collateral is unchanged.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>test.topupPayments),2);assert.equal((await counts(page)).sends,1);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.type),kind==='bok'?'claim-bok':'claim-private-fee');assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);
});
test('standalone top-up failed review and changed account never reach a payment',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.topupEnabled=true;test.failure='topup-review';});await open(page);await unlock(page);await page.getByRole('button',{name:'Top up fees or Bok',exact:true}).click();await page.getByLabel('Fee token top-up amount',{exact:true}).fill('3');await page.getByRole('button',{name:'Review top-up',exact:true}).click();await page.getByText(/could not/).first().waitFor();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
 await page.evaluate(()=>{test.failure=null;test.rawAccount={...test.rawAccount};});await page.getByRole('button',{name:'Review top-up',exact:true}).click();assert.equal(await page.evaluate(()=>test.topupPayments??0),0);
});

async function openBalances(page,{reason='eligible',nextCursor=null}={}){
 await page.evaluate(({reason,nextCursor})=>{test.balances={fee:{available:'2000000000000000000'},bok:{available:'3000000',requestsComplete:false,requests:[]},collateral:{deposits:[{id:'9',amount:'100000000000000000',eligible:reason==='eligible',reason,nextAllowedTime:'100'}],nextCursor}};},{reason,nextCursor});
 await open(page);await unlock(page);await page.getByRole('button',{name:'Balances and withdrawals',exact:true}).click();await page.getByRole('button',{name:'Check private balances',exact:true}).click();await page.getByRole('button',{name:'Review collateral exit',exact:true}).waitFor();
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
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check existing refund',exact:true}).waitFor();await page.evaluate(()=>test.refundFound=true);await page.getByRole('button',{name:'Check existing refund',exact:true}).click();await page.getByText('The saved Ethereum refund is confirmed.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);assert.equal(await page.evaluate(()=>test.refundChecks),1);
});


test('refresh diagnostic survives connect sanitizer and retry then clears on account invalidation',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.failure='status';test.refreshRecords={status:[{stage:'private-refresh',step:'account-status/account-initialize',deploymentStep:null,state:'failed',code:'unknown'}]};});
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).step,'account-status/account-initialize');assert.equal(await page.getByRole('button',{name:'Check account recovery',exact:true}).isVisible(),true);
 assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')||s.includes('account-initialize')));
 await page.evaluate(()=>{test.failure='owned';test.refreshRecords={status:[{stage:'private-refresh',step:'account-status/method',deploymentStep:null,state:'complete',code:null}],owned:[{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'failed',code:'ROLLING_ABI_MISMATCH'}]};});
 await page.getByRole('button',{name:'Check account recovery',exact:true}).click();await page.waitForFunction(()=>test.owned===1&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'failed',code:'ROLLING_ABI_MISMATCH'});
 await page.evaluate(()=>{test.failure=null;test.refreshRecords={owned:[{stage:'private-refresh',step:'owned-names/method',deploymentStep:null,state:'complete',code:null}]};});await page.getByRole('button',{name:'Check account recovery',exact:true}).click();await page.getByRole('button',{name:'Recover funding',exact:true}).waitFor();assert.equal(JSON.parse(await dialog.getAttribute('data-rolling-initialization')).state,'complete');
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
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.aggregateEnabled=true;test.paymentSaved=true;});await open(page);await unlock(page);await page.getByRole('button',{name:'Recover funding',exact:true}).click();
 await page.evaluate(()=>test.failure='prepare');await page.getByRole('button',{name:'Resume saved funding',exact:true}).click();await page.getByRole('alert').waitFor();
 const dialog=page.getByRole('dialog');assert.deepEqual(JSON.parse(await dialog.getAttribute('data-rolling-initialization')),{stage:'funding-claim',step:'prepare',deploymentStep:null,state:'failed',code:'unknown'});
 assert(!await dialog.innerText().then(s=>s.includes('PRIVATE_SENTINEL')||s.includes('GETTER_SENTINEL')||s.includes('funding-claim')));assert.equal(await page.evaluate(()=>test.fundingPayments??0),0);assert.equal((await counts(page)).sends,0);
 await page.evaluate(()=>{test.rawAccount={address:'OTHER_PRIVATE_SENTINEL'};test.options.onChange({invalidated:true});test.sessionProgress({stage:'funding-claim',step:'submit',deploymentStep:null,state:'failed',code:'unknown'});});assert.equal(await dialog.getAttribute('data-rolling-initialization'),null);
});
test('RC22 Bok panel explicitly pages complete accounting without displaying partial or double-counted totals',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.accountingPages=[{complete:false,phase:'public-accounting',nextCursor:'opaque-one',requests:[]},{complete:true,anchor:{blockNumber:7},available:'3000000',totals:{available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'},requests:[{requestId:'0x'+'1'.repeat(64),state:'2',available:'2000000',reserved:'1000000',charged:'500000',refunded:'500000'}]}];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.getByRole('button',{name:'Continue checking Bok requests',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0]);assert(await page.getByText(/No partial total is presented/).isVisible());assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);
 await page.getByRole('button',{name:'Continue checking Bok requests',exact:true}).click();await page.getByText(/Complete owned-request accounting at block 7/).waitFor();assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,'opaque-one']);
 assert(await page.getByText('Unallocated Bok credit: 3 USDC.',{exact:true}).isVisible());assert(await page.getByText(/Returned credit is already part/).isVisible());assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.prepares),0);
 await page.getByRole('button',{name:'Refresh balances',exact:true}).click();await page.getByText(/unlisted reservations are not zero/).waitFor();assert.equal(await page.getByText(/Complete owned-request accounting/).count(),0);
});
test('RC22 Bok panel stops scans and reviews release only for unreserved owned requests',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.accountingPages=[{complete:false,phase:'owned-requests',nextCursor:'opaque-one',requests:[]},{complete:true,anchor:{blockNumber:7},available:'3000000',totals:{available:'2000000',reserved:'0',charged:'0',refunded:'0'},requests:[{requestId:'0x'+'1'.repeat(64),state:'1',available:'2000000',reserved:'0',charged:'0',refunded:'0'}]}];});
 await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.getByRole('button',{name:'Stop checking requests',exact:true}).click();await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();await page.getByRole('button',{name:'Review release of unused credit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>test.accountingReads),[0,0]);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.type),'cancel-bok-request');assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();assert.equal(await page.evaluate(()=>test.sends),0);
});
test('RC22 Bok panel separates private exit and saved-recipient Ethereum refund across reopen',async t=>{
 const {page}=await browserFixture(t);await openBalances(page);await page.evaluate(()=>{test.fundingWallet={connected:true,name:'MetaMask',address:'0x'+'3'.repeat(40)};});
 await page.getByLabel('Bok credit to withdraw in USDC',{exact:true}).fill('1.25');await page.getByRole('button',{name:'Review Bok credit exit',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.amount),'1250000');assert.equal(await page.evaluate(()=>test.sends),0);
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText(/Refund: 1.25 USDC/).waitFor();assert.equal(await page.evaluate(()=>test.sends),1);assert.equal(await page.evaluate(()=>test.refundSends??0),0);
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check existing refund',exact:true}).waitFor();await page.getByRole('button',{name:'Check existing refund',exact:true}).click();await page.getByText(/Refund unknown/).waitFor();assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>test.refundSends??0),0);
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
 assert.equal(await page.evaluate(()=>test.sends),1);await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);
 await page.evaluate(()=>test.resolveOutcome='confirmed');await page.getByRole('button',{name:'Check existing transaction',exact:true}).click();await page.getByText(/Expiry transaction confirmed/).waitFor();
 assert.equal(await page.evaluate(()=>test.sends),0,'new labelled page performs only reconciliation');
 await page.evaluate(()=>{test.balances={fee:{available:'2000000000000000000'},bok:{available:'5000000'},collateral:{deposits:[],nextCursor:null}};test.accountingPages=[{complete:true,anchor:{blockNumber:8},available:'5000000',totals:{available:'0',reserved:'1000000',charged:'500000',refunded:'2500000'},requests:[{requestId:'0x'+'1'.repeat(64),state:'3',available:'0',reserved:'1000000',charged:'500000',refunded:'2500000'}]}];});
 await page.getByRole('button',{name:'Balances and withdrawals',exact:true}).click();await page.getByRole('button',{name:'Check private balances',exact:true}).click();await page.getByRole('button',{name:'Check all Bok requests',exact:true}).click();
 assert(await page.getByText('Unallocated Bok credit: 5 USDC.',{exact:true}).isVisible());assert(await page.getByText(/This request is fenced. Unreserved credit has returned/).isVisible());assert(await page.getByRole('region',{name:'Owned Bok request',exact:true}).getByText(/reserved 1, charged 0.5, returned 2.5 USDC/).isVisible());assert.equal(await page.getByRole('button',{name:'Review request expiry',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review release of unused credit',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.sends),0);
});

for(const [kind,label]of [['cancel-bok-request','Review release of this saved request'],['expire-bok-request','Review expiry of this saved request']])test('Interrupted Bok '+kind+' explicitly reviews one saved request and cancellation restores draft',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'42',status:'authorized',action:{type:'bok',content:'Saved funded draft',budget:'400'},maximumFee:'123',bok:{phase:'authorize',budget:'400',availableCredit:'1000'}}));});
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>test.releaseInput),{id:'42',type:kind});assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:'Cancel prepared action',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action.content),'Saved funded draft');assert.equal((await counts(page)).sends,0);
 await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText(kind==='expire-bok-request'?/Expiry transaction confirmed/:/Transaction confirmed/).waitFor();assert.equal((await counts(page)).sends,1);
});
test('Interrupted Bok release failure and unknown send preserve recovery without another post or authorization',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>{test.bokCredit='600';test.failure='bok-release';sessionStorage.setItem('labelled-ui-intent',JSON.stringify({intentId:'43',status:'bok-post-reverted',action:{type:'bok',content:'Saved rejected draft',budget:'400'},maximumFee:'123',bok:{phase:'post',budget:'400',availableCredit:'1000'}}));});
 await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Review expiry of this saved request',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal((await counts(page)).sends,0);
 assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'bok-post-reverted');
 await page.evaluate(()=>{test.failure=null;test.submitOutcome='unknown';});await page.getByRole('button',{name:'Review expiry of this saved request',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 assert.equal((await counts(page)).sends,1);await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Check existing transaction',exact:true}).waitFor();
 for(const name of ['Confirm and send','Review saved Bok post','Review expiry of this saved request','Review release of this saved request'])assert.equal(await page.getByRole('button',{name,exact:true}).count(),0);
 assert.equal((await counts(page)).sends,0);
});

test('Bok reply selection retains reader thread context through both saved confirmations',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply',parent:'12',root:'11',subboard:'3',content:'Continue this workspace'});await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');for(const name of ['Reply to post ID','Root thread ID','Subboard ID (0 for main board)'])assert.equal(await page.getByLabel(name,{exact:true}).count(),0);
 await page.getByLabel('Action',{exact:true}).selectOption('reply');await page.getByLabel('Action',{exact:true}).selectOption('bok');
 assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Continue this workspace');
 await page.getByLabel('Maximum Bok credits').fill('400');
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.equal(action.parent,'12');assert.equal(action.root,'11');assert.equal(action.subboard,'3');assert.equal(action.type,'bok');
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).waitFor();
 await page.reload();await page.waitForFunction(()=>window.ready);await open(page);await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByRole('button',{name:'Review saved Bok post',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action),action);assert.equal((await counts(page)).sends,0);
 assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');assert.equal(await page.getByRole('button',{name:'Start new conversation',exact:true}).count(),0);
 await page.getByRole('button',{name:'Close account panel',exact:true}).click();await open(page,{type:'reply',parent:'99',root:'98',subboard:'97'});await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'View conversation',exact:true}).getAttribute('href'),'#/thread/11/12');
 await page.getByRole('button',{name:'Confirm and send',exact:true}).click();await page.getByText('Transaction confirmed on the verified chain.',{exact:true}).waitFor();assert.equal((await counts(page)).sends,1);
});


test('Conversation context starts a new Bok thread only by explicit choice and preserves message and board',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply',parent:'12',root:'11',subboard:'3',content:'Keep this draft'});await unlock(page);
 await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Maximum Bok credits').fill('400');
 await page.getByRole('button',{name:'Start new conversation',exact:true}).click();await page.getByText('New conversation',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'View board',exact:true}).getAttribute('href'),'#/board/3');assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Keep this draft');assert.equal(await page.getByLabel('Maximum Bok credits').inputValue(),'400');assert.equal((await counts(page)).prepares,0);
 await page.getByRole('button',{name:'Check action and review fee',exact:true}).click();await page.getByRole('button',{name:'Confirm and send',exact:true}).waitFor();
 const action=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).action);assert.deepEqual({parent:action.parent,root:action.root,subboard:action.subboard},{parent:'0',root:'0',subboard:'3'});assert.equal(action.content,'Keep this draft');assert.equal(action.budget,'400');assert.equal((await counts(page)).sends,0);
});

test('Conversation context rejects missing or incomplete reply selection without preparing a transaction',async t=>{
 const {page}=await browserFixture(t);await page.evaluate(()=>test.bokCredit='1000');await open(page,{type:'reply'});await unlock(page);
 await page.getByText('Choose a post in the reader and select Reply to join its conversation.',{exact:true}).waitFor();await page.getByLabel('Message',{exact:true}).fill('Need a selected post');assert(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled());
 await page.getByRole('button',{name:'Choose a post',exact:true}).click();assert.equal(await page.getByRole('dialog').isVisible(),false);
 await open(page,{type:'reply',parent:'12',root:'0',subboard:'3',content:'Invalid pair'});await page.getByLabel('Action',{exact:true}).waitFor();await page.getByLabel('Action',{exact:true}).selectOption('bok');await page.getByLabel('Maximum Bok credits').fill('400');assert(await page.getByRole('button',{name:'Check action and review fee',exact:true}).isDisabled());assert.equal((await counts(page)).prepares,0);
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
 const names=page.getByRole('button',{name:'Your names',exact:true});await names.click();
 assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Your names');
 assert.equal((await counts(page)).sends,0);
});

for(const replacement of [false,true])test(`ordinary saved post ${replacement?'replacement review':'exact-byte recovery'} is explicit and preserves its draft`,async t=>{
 const {page}=await browserFixture(t),action={type:'post',deposit:'9',content:'Retained original draft',name:'0',subboard:'0'};
 if(replacement)await seedReplacement(page,{action});else await seedSavedResume(page,{action});
 assert.equal(await page.evaluate(()=>test.sends+test.replacementPrepares+test.resumes),0);
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();
 if(replacement){await page.getByRole('button',{name:'Review replacement',exact:true}).click();await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>test.replacementInput),{expectedTxHash:'0x'+(77).toString(16).padStart(64,'0')});assert(await page.getByText(/New maximum network fee: 456/).isVisible());
  assert.equal(await page.evaluate(()=>test.sends),0);await page.getByRole('button',{name:'Confirm replacement and send',exact:true}).click();
 }else{await page.getByRole('button',{name:'Confirm saved transaction and send',exact:true}).waitFor();assert(await page.getByText(/Previously approved maximum fee: 123/).isVisible());
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
test('positive pre-proof failed renewed review never exposes a send or resets unknown recovery',async t=>{
 const {page}=await browserFixture(t);await seedSavedResume(page,{action:{type:'post',deposit:'9',content:'Keep me',name:'0',subboard:'0'}});
 await page.evaluate(()=>{test.recoverySnapshot={status:'pre-proof-review',attempts:[],exactResume:{status:'empty'}};test.failure='interrupted-review';});
 await page.getByRole('button',{name:'Check recovery options',exact:true}).click();await page.getByRole('button',{name:'Review interrupted action',exact:true}).click();await page.getByRole('alert').waitFor();
 assert.equal(await page.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);assert.equal(await page.evaluate(()=>test.sends),0);assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('labelled-ui-intent')).status),'unknown');
});
