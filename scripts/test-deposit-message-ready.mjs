import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {Fr} from '@aztec/foundation/curves/bn254';
import {SiblingPath} from '@aztec/foundation/trees';
import {L1_TO_L2_MSG_TREE_HEIGHT} from '@aztec/constants';
const source=await fs.readFile(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8');
const c=vm.createContext({performance,setTimeout,clearTimeout,console});vm.runInContext(source,c);
const wait=c.BillboardDepositReadiness.waitForDepositMessage;
const witness=()=>[3n,new SiblingPath(L1_TO_L2_MSG_TREE_HEIGHT,Array.from({length:L1_TO_L2_MSG_TREE_HEIGHT},()=>Fr.ONE.toBuffer()))];
function fixture(read){let syncs=0,guards=0,reads=0;return{args:{a:{Fr},key:new Fr(7).toString(),index:3n,timeoutMs:25,pollMs:1,contextGuard:async()=>guards++,wallet:{pxe:{sync:async()=>syncs++,getSyncedBlockHeader:async()=>({hash:async()=>`anchor-${syncs}`})}},node:{getL1ToL2MessageMembershipWitness:async(hash,key)=>{assert.equal(hash,`anchor-${syncs}`);assert.equal(key.toString(),new Fr(7).toString());return read(++reads);}}},counts:()=>({syncs,guards,reads})};}
test('delayed genuine-shape membership refreshes PXE anchor and guards before readiness',async()=>{const f=fixture(n=>n<2?undefined:witness());await wait(f.args);assert.deepEqual(f.counts(),{syncs:2,guards:4,reads:2});});
test('absent message, RPC error and stalled sync return fixed bounded pending result',async()=>{
 for(const mode of ['absent','rpc','stall']){const f=fixture(()=>{if(mode==='rpc')throw Error('private RPC text');return undefined;});if(mode==='stall')f.args.wallet.pxe.sync=()=>new Promise(()=>{});
 const start=Date.now();await assert.rejects(wait(f.args),e=>e.code===(mode==='absent'?'BB_DEPOSIT_MESSAGE_PENDING':'BB_DEPOSIT_MESSAGE_UNAVAILABLE')&&!e.message.includes('private RPC'));assert(Date.now()-start<250);}
});
test('wrong index and malformed witnesses fail closed; context change propagates',async()=>{
 for(const value of [[4n,witness()[1]],[3n,null],null,[3n,{pathSize:36,toFields(){throw Error('private body');}}]]){const f=fixture(()=>value);await assert.rejects(wait(f.args),e=>e.code==='BB_DEPOSIT_MESSAGE_INVALID'&&!e.message.includes('private body'));}
 const f=fixture(witness);f.args.contextGuard=()=>{throw Object.assign(Error('changed'),{code:'CONTEXT_CHANGED'});};await assert.rejects(wait(f.args),e=>e.code==='CONTEXT_CHANGED');assert.equal(f.counts().reads,0);
});
test('UI delegates funding and retains the confirmed phase after failure',async()=>{
 const app=await fs.readFile(new URL('../apps/src/billboard/user/app.js',import.meta.url),'utf8');const start=app.indexOf('async function doDepositPage() {'),end=app.indexOf('\n// ============================================================',start);
 let renders=0;const calls=[];const ctx=vm.createContext({application:{connected:true,fundingState:'deposited_l1_not_claimed_l2',completeDeposit:async input=>{calls.push(input);throw Object.assign(Error('pending'),{code:'BB_DEPOSIT_MESSAGE_PENDING'});}},ethers:{formatEther:()=> '0.001'},selectedDepositWei:()=>1n,_stateResult:{state:'zero_balance_need_deposit'},_currentPage:1,onShowDeposit(){renders++;},log(){},showPage(){}});
 vm.runInContext(app.slice(start,end),ctx);await assert.rejects(ctx.doDepositPage(),{code:'BB_DEPOSIT_MESSAGE_PENDING'});
 assert.equal(ctx._stateResult.state,'deposited_l1_not_claimed_l2');assert.equal(renders,1);await assert.rejects(ctx.doDepositPage());assert.equal(calls[0].depositAmount,'0.001');assert.deepEqual(Object.keys(calls[1]),[]);
});
test('readiness precedes private fee preparation and old proof-based wait is removed',()=>{const claim=source.slice(source.indexOf('    async function doClaim()'),source.indexOf('    async function doPost()'));const ready=claim.indexOf('await waitForDepositMessage('),send=claim.indexOf("await sendPrivate('claim'");assert(ready>=0&&send>ready);assert(!source.includes('waitForL2Ingest'));assert.match(source,/key:event\.key/);assert.match(source,/key:depositInfo\.key/);});

test('actual navigation failure preserves action-updated claim label and restores ordinary labels',async()=>{
 const helpers=await fs.readFile(new URL('../shared/helpers.js',import.meta.url),'utf8');const start=helpers.indexOf('function doNavAction() {'),end=helpers.indexOf('\n// ============================================================',start);
 for(const phaseChanged of [true,false]){
  const button={textContent:'Deposit ETH',disabled:false,classList:{add(){},remove(){}}};let caught;const finished=new Promise(resolve=>caught=resolve);
  const nav=vm.createContext({performance,_pageActionsEnabled:true,_pages:[{busyText:'Processing...',statusId:'status',action:async()=>{if(phaseChanged)button.textContent='Claim deposit →';throw Error('pending');}}],_currentPage:0,document:{getElementById:()=>button},clearStatus(){},log(){},console:{error(){caught();}},setTimeout,nextPage(){throw Error('Must not advance after failure');}});
  vm.runInContext(helpers.slice(start,end),nav);nav.doNavAction();await finished;await Promise.resolve();
  assert.equal(button.disabled,false);assert.equal(button.textContent,phaseChanged?'Claim deposit →':'Deposit ETH');
 }
});

test('reloaded deposit UI claims without any transaction hash input',async()=>{
 const app=await fs.readFile(new URL('../apps/src/billboard/user/app.js',import.meta.url),'utf8');const start=app.indexOf('async function doDepositPage() {'),end=app.indexOf('\n// ============================================================',start);
 const calls=[];const ctx=vm.createContext({application:{connected:true,completeDeposit:async input=>{calls.push({input});return {state:'postable'};}},_stateResult:{state:'deposited_l1_not_claimed_l2'},publicOperationFailure:e=>e,log(){},showPage(){}});
 vm.runInContext(app.slice(start,end),ctx);await ctx.doDepositPage();assert.equal(calls.length,1);assert.deepEqual(Object.keys(calls[0].input),[]);assert.equal(ctx._stateResult.state,'postable');
});
