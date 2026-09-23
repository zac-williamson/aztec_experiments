import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const helpers=fs.readFileSync(new URL('../shared/helpers.js',import.meta.url),'utf8');
const author=fs.readFileSync(new URL('../apps/src/billboard/user/app.js',import.meta.url),'utf8');
function fixture(){const elements=new Map(['navBack','navNext','navProgress'].map(id=>[id,{style:{},classList:{toggle(){},add(){},remove(){}}}]));const c=vm.createContext({document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[],querySelector:()=>null},queueMicrotask(){},console,setTimeout});vm.runInContext(helpers,c);for(const n of ['doDepositPage','onShowDeposit','doProceedToWithdraw','onShowPost','doWithdrawPage','onShowWithdraw','doClaimL1Page','onShowClaimL1'])c[n]=()=>{};vm.runInContext(author.slice(author.indexOf('initPages(['),author.indexOf('\n]);',author.indexOf('initPages(['))+4),c);return{c,elements};}
test('wallet setup cannot be skipped before or after returning to it',()=>{const f=fixture();for(let i=0;i<2;i++){assert.equal(f.elements.get('navNext').style.display,'none');f.c.doNavAction();assert.equal(f.elements.get('navProgress').textContent,'1 / 5');f.c.showPage(1);f.c.prevPage();}});
test('deposit rejects an uninitialized account before calling an engine',async()=>{const start=author.indexOf('async function doDepositPage()'),end=author.indexOf('\n// =====',start);let calls=0;const c=vm.createContext({_stateResult:null,application:{connected:false},publicOperationFailure:e=>e,callEngine(){calls++;throw Error('engine called');}});vm.runInContext(author.slice(start,end),c);await assert.rejects(c.doDepositPage(),e=>e.code==='BB_WALLET_NOT_READY');assert.equal(calls,0);});
test('fee deposit and claim cannot start before wallet setup succeeds',async()=>{
 const source=fs.readFileSync(new URL('../apps/src/fee-juice/app.js',import.meta.url),'utf8');
 const template=fs.readFileSync(new URL('../apps/src/fee-juice/template.html',import.meta.url),'utf8');
 for(const id of ['depositBtn','claimBtn'])assert(template.includes('id="'+id+'" disabled'));
 let calls=0;const c=vm.createContext({feeWalletReady:false,log(){},safeFundingError:()=> 'Not ready',withBtn(){calls++;throw Error('Operation started');}});
 const start=source.indexOf('async function doDepositPage()'),end=source.indexOf('function initializePrivateFees()',start);
 vm.runInContext(source.slice(start,end),c);await c.doDepositPage();await c.doClaimPage();assert.equal(calls,0);
});


test('invalidated wallet keeps navigation actions disabled across page changes',()=>{
 const f=fixture();let calls=0;f.c.initPages([{label:'Deposit',action:()=>{calls++;}},{label:'Post',action:()=>{calls++;}}]);
 f.c.setPageActionsEnabled(false);f.c.showPage(1);f.c.prevPage();f.c.doNavAction();
 assert.equal(f.elements.get('navNext').disabled,true);assert.equal(calls,0);
});
test('action failure cannot re-enable navigation after wallet invalidation',async()=>{
 const f=fixture();let fail;f.c.initPages([{label:'Deposit',action:()=>new Promise((_r,reject)=>{fail=reject;})}]);
 f.c.doNavAction();await Promise.resolve();f.c.setPageActionsEnabled(false);fail(Error('Disconnected'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.elements.get('navNext').disabled,true);
});
