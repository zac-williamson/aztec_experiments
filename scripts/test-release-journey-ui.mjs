// Real Chromium + the actual wallet panel. Session/payment doubles test only
// UI control sequencing; this is never real-proof or testnet acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {closeJourneyAccountPanel,openJourneyComposer,submitJourneyComposer,buyJourneyBokCredit} from './release/journey.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=`<!doctype html><html><body><button id="write">Write a post</button><button id="reply">Reply</button>
<script type="module">
import {mountRollingWalletPanel} from '/apps/rolling/wallet-panel.mjs';
import {executeRollingAction} from '/apps/rolling/wallet-action.mjs';
window.calls={prepared:[],submitted:[],payments:[],claims:0,signins:0};
let account=new URL(location.href).searchParams.has('locked')?null:{},prepared,credit='0';
const cap={defaultPrivateFeeCap:'1000000000000000',ethAvailable:true,usdcAvailable:true,
 prepare:async input=>({phase:'deposit',...input,maximumSwapWei:'1000000000000000'}),
 confirm:async()=>{calls.payments.push({asset:'ETH',amount:'1000000'});return {pending:false};},
 inspect:async()=>({paymentSaved:false}),pauseClaim(){},
 advanceClaim:async()=>{calls.claims++;credit='1000000';return {state:'complete'};}};
const application={
 readAccountStatus:async()=>({status:'fee-ready',privateFeeCredit:'100000000000000000000',depositIds:['9']}),
 readPrivateFeeCredit:async()=>({privateFeeCredit:'100000000000000000000'}),
 ownedIdentities:async()=>({identities:[],records:[],nextCursor:null}),readModeratorStatus:async()=>({authorized:false}),
 readBokStatus:async()=>({available:true,availableCredit:credit}),
 prepare:async action=>{prepared=structuredClone(action);calls.prepared.push(prepared);return {intentId:'ui-'+calls.prepared.length,action:prepared,status:'prepared',maximumFee:'100'};},
 submitPrepared:async id=>{calls.submitted.push(id);return {intentId:id,action:prepared,status:'confirmed'};}
};
application.executeAction=(action,options)=>executeRollingAction(application,structuredClone(action),options);
const session={application,busy:false,ordinaryPostingFeeLimit:'1000000000000000',postingFeeLimit:'1000000000000000',bokConfigured:true,topup:{bok:cap}};
const runtime={getAccount:()=>account,account:{configure(){}},createSession:async()=>session,
 fundingWallets:()=>[{id:'test',name:'CI test wallet'}],signInWallet:async()=>{calls.signins++;account={};}};
window.panel=mountRollingWalletPanel({loadRuntime:async()=>runtime});
document.querySelector('#write').onclick=()=>panel.open({type:'post',subboard:'0'});
document.querySelector('#reply').onclick=()=>panel.open({type:'reply',parent:'10',root:'10',subboard:'0'});
panel.open({});
</script></body></html>`;
async function setup(t,{locked=false}={}){
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  requests.push(req.method);const url=new URL(req.url,'http://localhost');
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(fixture);return;}
  if(url.pathname==='/api/board'){
   res.setHeader('content-type','application/json');res.end(JSON.stringify({schemaVersion:1,complete:true,scope:{chainId:'31337',rollupVersion:'1',boardAddress:'0x'+'1'.repeat(64)},boardId:'0',board:null,mainPolicy:{version:'1',text:''}}));return;
  }
  if(!/^\/apps\/rolling\/[a-z0-9-]+\.mjs$/.test(url.pathname)){res.writeHead(404);res.end();return;}
  try{const body=await fs.readFile(path.join(root,url.pathname));res.setHeader('content-type','text/javascript');res.end(body);}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port,errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 page.setDefaultTimeout(5000);await page.goto(origin+(locked?'/?locked':''));
 await page.locator('dialog.account-dialog[aria-busy="false"]').waitFor();
 t.after(()=>{assert.deepEqual(errors,[]);assert(requests.every(method=>method==='GET'));});
 return {page,remaining:()=>5000,dialog:page.locator('dialog.account-dialog')};
}
test('release closes the actual account modal before posting once', {timeout:15000},async t=>{
 const {page,dialog,remaining}=await setup(t);
 assert.equal(await page.getByRole('button',{name:'Close',exact:true}).count(),0);
 // Reproduce the obsolete selector leaving a real modal over the board.
 await assert.rejects(page.getByRole('button',{name:'Write a post',exact:true}).first().click({timeout:250}),{name:'TimeoutError'});
 assert.deepEqual(await page.evaluate(()=>calls.submitted),[]);
 await closeJourneyAccountPanel(page,remaining);assert.equal(await dialog.isVisible(),false);
 await openJourneyComposer(page,'UI regression post',remaining);
 assert.equal(await dialog.getByRole('button',{name:'Confirm and send',exact:true}).count(),0);
 await submitJourneyComposer(page,'post',remaining);await dialog.waitFor({state:'hidden'});
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.prepared.length,1);assert.equal(calls.prepared[0].type,'post');assert.equal(calls.submitted.length,1);assert.equal(calls.signins,0);
});
test('release unlocks the same composer and submits a direct reply once',{timeout:15000},async t=>{
 const {page,dialog,remaining}=await setup(t,{locked:true});
 await openJourneyComposer(page,'Restored account post',remaining);await submitJourneyComposer(page,'post',remaining);await dialog.waitFor({state:'hidden'});
 await page.locator('#reply').click();await dialog.getByLabel('Message',{exact:true}).fill('UI reply');
 await submitJourneyComposer(page,'reply',remaining);await dialog.waitFor({state:'hidden'});
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.signins,1);assert.deepEqual(calls.prepared.map(a=>a.type),['post','reply']);assert.equal(calls.prepared[1].parent,'10');assert.equal(calls.submitted.length,2);
});
test('release buys one Bok credit then posts the retained mention draft once',{timeout:15000},async t=>{
 const {page,dialog,remaining}=await setup(t);
 await openJourneyComposer(page,'@bok UI regression request',remaining);
 await buyJourneyBokCredit(page,remaining);
 assert.equal(await dialog.getByLabel('Message',{exact:true}).inputValue(),'@bok UI regression request');
 await submitJourneyComposer(page,'bok',remaining);await dialog.waitFor({state:'hidden'});
 const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls.payments,[{asset:'ETH',amount:'1000000'}]);assert.equal(calls.claims,1);assert.equal(calls.prepared[0].type,'bok');assert.equal(calls.submitted.length,1);
});
