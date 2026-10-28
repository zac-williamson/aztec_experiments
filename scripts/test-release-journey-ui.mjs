// Real Chromium + the actual wallet panel. Session/payment doubles test only
// UI control sequencing; this is never real-proof or testnet acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {closeJourneyAccountPanel,openJourneyMainBoard,journeyPostCard,openJourneyComposer,submitJourneyComposer,buyJourneyBokCredit} from './release/journey.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=`<!doctype html><html><head><meta charset="utf-8"></head><body><nav aria-label="Community"><a href="#/home">Home</a><a href="#/board/0">Main board</a></nav><section id="feed"></section><button id="write">Write a post</button><button id="reply">Reply</button>
<script type="module">
import {mountRollingWalletPanel} from '/apps/rolling/wallet-panel.mjs';
import {executeRollingAction} from '/apps/rolling/wallet-action.mjs';
import {createFeedRanking} from '/apps/rolling/feed-ranking.mjs';
window.calls={prepared:[],submitted:[],payments:[],claims:0,signins:0,fundingConnections:0};
const params=new URL(location.href).searchParams;
let account=params.has('locked')?null:{},fundingConnected=!params.has('funding-disconnected'),fundingInput,prepared,credit='0';
const cap={defaultPrivateFeeCap:'1000000000000000',ethAvailable:true,usdcAvailable:true,
 prepare:async input=>{if(!fundingConnected)throw Error('Funding wallet disconnected');fundingInput=structuredClone(input);return {phase:'deposit',...input,maximumSwapWei:'1000000000000000'};},
 confirm:async()=>{if(!fundingConnected)throw Error('Funding wallet disconnected');calls.payments.push({asset:fundingInput.asset,amount:fundingInput.amount});return {pending:false};},
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
 fundingWalletStatus:()=>({connected:fundingConnected,name:fundingConnected?'CI test wallet':null,address:fundingConnected?'0x'+'1'.repeat(40):null}),
 connectFundingWallet:async id=>{if(id!=='test')throw Error('Unexpected wallet');calls.fundingConnections++;fundingConnected=true;},
 fundingWallets:()=>[{id:'test',name:'CI test wallet'}],signInWallet:async()=>{calls.signins++;account={};fundingConnected=true;}};
let publicPosts=[],priorityTxs=[];
window.showPublicPosts=(posts=publicPosts,priorities=priorityTxs)=>{
 publicPosts=posts;priorityTxs=priorities;
 const items=location.hash==='#/board/0'?[...posts].reverse():createFeedRanking({items:posts,now:1000,seed:'ui-regression',priorityTxs}).page().items;
 document.querySelector('#feed').replaceChildren(...items.map(post=>{const article=document.createElement('article');article.className='post';article.id='post-'+post.id;article.textContent=post.text;const like=document.createElement('button');like.textContent='Like · 20 credits';like.onclick=()=>calls.liked=post.id;article.append(like);return article;}));
 document.querySelector('#write').toggleAttribute('data-board-compose',location.hash==='#/board/0');
};
addEventListener('hashchange',()=>showPublicPosts());
window.panel=mountRollingWalletPanel({loadRuntime:async()=>runtime});
document.querySelector('#write').onclick=()=>panel.open({type:'post',subboard:'0'});
document.querySelector('#reply').onclick=()=>panel.open({type:'reply',parent:'10',root:'10',subboard:'0'});
panel.open({});
</script></body></html>`;
async function setup(t,{locked=false,fundingConnected=true}={}){
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
 page.setDefaultTimeout(5000);const query=new URLSearchParams();if(locked)query.set('locked','');if(!fundingConnected)query.set('funding-disconnected','');await page.goto(origin+(query.size?'/?'+query:'/'));
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
for(const fundingConnected of [true,false])test(`release buys one Bok credit and retains the draft with payment wallet ${fundingConnected?'connected':'disconnected after account restore'}`,{timeout:15000},async t=>{
 const {page,dialog,remaining}=await setup(t,{fundingConnected});
 await openJourneyComposer(page,'@bok UI regression request',remaining);
 await buyJourneyBokCredit(page,remaining);
 assert.equal(await dialog.getByLabel('Message',{exact:true}).inputValue(),'@bok UI regression request');
 await submitJourneyComposer(page,'bok',remaining);await dialog.waitFor({state:'hidden'});
 const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls.payments,[{asset:'ETH',amount:'1000000'}]);assert.equal(calls.claims,1);assert.equal(calls.prepared[0].type,'bok');assert.equal(calls.submitted.length,1);
 assert.equal(calls.signins,0,'restored posting account does not sign in again');assert.equal(calls.fundingConnections,fundingConnected?0:1);
});

test('release uses chronological Main board and pins Like to the original receipt ID',{timeout:15000},async t=>{
 const {page,remaining}=await setup(t);await closeJourneyAccountPanel(page,remaining);
 const hash='0x'+'1'.repeat(64),tag='Release check test';
 const post=(id,parent,text)=>({id,record:{root:'1',parent,name_id:'0',subboard:'0'},text,timestamp:'1000',likes:'0',position:{txHash:id==='2'?hash:'0x'+'2'.repeat(64)}});
 const posts=[post('1','0',tag),post('2','1',tag+' reply')];
 await page.evaluate(({posts,hash})=>showPublicPosts(posts,[hash]),{posts,hash});
 assert.deepEqual(await page.locator('article.post').evaluateAll(nodes=>nodes.map(n=>n.id)),['post-2'],'actual Home ranking replaces the root with the newly included reply');
 await openJourneyMainBoard(page,remaining);
 assert.deepEqual(await page.locator('article.post').evaluateAll(nodes=>nodes.map(n=>n.id)),['post-2','post-1']);
 const old=page.locator('article.post').filter({hasText:tag}).first();assert.equal(await old.getAttribute('id'),'post-2','old text locator silently retargets the reply even on Main board');
 await journeyPostCard(page,'post-1').getByRole('button',{name:'Like · 20 credits',exact:true}).click();
 assert.equal(await page.evaluate(()=>calls.liked),'1');
 assert.throws(()=>journeyPostCard(page,'post-1, article'),{code:'RELEASE_INCLUSION'});
});
