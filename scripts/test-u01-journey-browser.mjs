// UI STATE FIXTURES ONLY: actual built HTTPS DOM with explicit callEngine/read-result fixtures.
// No wallet custody, chain, signing, proof, inclusion or network qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {generateHosting} from '../deploy/hosting-config.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
assertNodeVersion();
const dir=fs.mkdtempSync(path.join(process.env.BILLBOARD_TEST_TMPDIR||os.tmpdir(),'u01-journey-'));
let child,browser,timer,stage='hosting';
const request=port=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:'/feed.html',rejectUnauthorized:false,timeout:1000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('server not ready')));});
async function tabTo(page,locator){for(let i=0;i<90;i++){if(await locator.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Keyboard target was unreachable');}
async function checkLabels(page,ids){for(const id of ids)assert(await page.locator('#'+id).evaluate(el=>el.labels?.length>0),'Missing associated label: '+id);}
function installJourneyFixture(){
  // The selected seam is the browser page's callEngine function. Its original
  // security/proof wrapper is intentionally NOT qualified by this UI fixture.
  const fixture={calls:[],state:'postable',screened:0n,real:1n,time:100,allowed:90n,holdPost:false,pendingSettlement:true,untrusted:'<img src=x onerror="globalThis.__uiExecuted=true">',recoveryState:'postable'};
  globalThis.__journeyFixture=fixture;
  const view=value=>({simulate:async()=>typeof value==='function'?value():value});
  const handles={depositChainId:1n,address:{toString:()=> '0x'+'01'.repeat(32)},aztecNode:{getBlockNumber:async()=>1,getBlock:async()=>({header:{globalVariables:{timestamp:fixture.time}}})},contract:{methods:{
   get_deposit_info:()=>view(()=>[1n,1n,1n,100n,1n,2n,1n,0n,fixture.screened,fixture.real,fixture.allowed]),
   get_censor:()=>view(0n),get_k_multiplier:()=>view(2n),get_moderation_policy:()=>view({result:[[],0]})
  }}};
  // Clearly synthetic non-funded wallet object solely satisfies UI prerequisites.
  window.walletState.aztec={secretKey:'0x'+'0'.repeat(63)+'1',salt:'0x'+'0'.repeat(64),address:handles.address};window.walletState.ethSigner={};
  globalThis.callEngine=async(action,status,extra)=>{
   fixture.calls.push(action);
   if(action==='status')return {state:fixture.state,handles,l2Addr:handles.address.toString(),portalAddr:'0x'+'22'.repeat(20)};
   if(action==='recover'){fixture.state=fixture.recoveryState;return {state:'transaction_recovered'};}
   if(action==='claim'){fixture.claimHash=extra.reuseTxHash;fixture.state='postable';return {ok:true};}
   if(action==='post'){if(fixture.holdPost)await new Promise(resolve=>fixture.releasePost=resolve);return {ok:true};}
   if(action==='withdraw'){fixture.state='withdrawn_l2_claimable_l1';return {ok:true};}
   if(action==='claim-l1'){
    if(fixture.pendingSettlement){log('Withdrawal is recorded. Network settlement is pending; retry this claim later.','info',status);throw publicOperationFailure(Object.assign(new Error(fixture.untrusted),{code:'BB_SETTLEMENT_PENDING'}));}
    return {ok:true};
   }
   throw Error('Unexpected fixture action');
  };
  window.BillboardPublic={...window.BillboardPublic,readFeed:async()=>({eventCount:1,lastBlock:1,progress:{complete:true},nextCursor:null,posts:[{postId:'fixture',orderIndex:1,text:fixture.untrusted,flagged:true,flag:{reason:fixture.untrusted}}]})};

}
async function main(){
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='https://127.0.0.1:'+port;
 const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:10000});
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy'),file=path.join(dir,'Caddyfile');fs.writeFileSync(file,generateHosting({dist:path.join(ROOT,'apps/dist'),site:origin,certificate:cert,key,local:true,origins:[]}).caddyfile);
 child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir},stdio:'ignore'});
 let ready=false;for(let i=0;i<40;i++){try{if(await request(port)===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=768']});const context=await browser.newContext({ignoreHTTPSErrors:true});context.setDefaultTimeout(8000);const external=[];let posts=0;
 await context.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()==='POST'){posts++;return route.abort();}if(/^https?:/.test(url)&&new URL(url).origin!==origin){external.push(new URL(url).origin);return route.abort();}return route.continue();});

 const page=await context.newPage();stage='fixture-page';await page.goto(origin+'/user.html');
 await page.waitForFunction(()=>typeof globalThis.callEngine==='function'&&typeof globalThis.loadWalletAndConnect==='function');
 const record={schemaVersion:1,network:{nodeUrl:origin+'/node',ethRpcUrl:origin+'/eth',chainId:'31337',rollupVersion:'5',rollupAddress:'0x'+'11'.repeat(20)},board:{portalAddress:'0x'+'22'.repeat(20),contractAddress:'0x'+'01'.repeat(32)},privateFee:null};
 await page.getByLabel('Public configuration JSON').fill(JSON.stringify(record));await page.getByRole('button',{name:'Import configuration',exact:true}).click();
 await page.evaluate(installJourneyFixture);
 stage='status-to-post';await page.evaluate(async()=>{await loadWalletAndConnect();nextPage();});await page.locator('#postBtn').waitFor({state:'visible'});
 assert.deepEqual(await page.evaluate(()=>__journeyFixture.calls),['status']);
 await page.waitForFunction(()=>document.getElementById('screeningStatus').textContent.includes('still need screening'));
 await page.locator('#billboardFeed summary').click();assert.match(await page.locator('#billboardFeed').textContent(),/<img src=x/);assert.equal(await page.locator('#billboardFeed img').count(),0);assert.equal(await page.evaluate(()=>globalThis.__uiExecuted===true),false);
 stage='posting-busy-state';await page.evaluate(()=>__journeyFixture.holdPost=true);await page.locator('#msgText').fill('UI-only fixture message');await page.locator('#postBtn').click();
 await page.waitForFunction(()=>!!__journeyFixture.releasePost);assert.equal(await page.locator('#postBtn').isDisabled(),true);
 await page.evaluate(()=>document.getElementById('postBtn').click());assert.equal(await page.evaluate(()=>__journeyFixture.calls.filter(x=>x==='post').length),1);
 await page.evaluate(()=>__journeyFixture.releasePost());await page.getByText('Message included. Public content and transaction timing remain observable.',{exact:false}).waitFor();assert.equal(await page.locator('#msgText').inputValue(),'');await page.waitForFunction(()=>!document.getElementById('postBtn').disabled);
 stage='withdrawal-screening-gate';await page.locator('#navNext').click();await page.waitForFunction(()=>!document.getElementById('navNext').disabled);assert.equal(await page.locator('#page-2').isVisible(),true);assert.equal(await page.evaluate(()=>__journeyFixture.calls.includes('withdraw')),false);assert.match(await page.locator('#proceedStatus').textContent(),/still need screening/);
 stage='withdrawal-time-gate';await page.evaluate(()=>{__journeyFixture.screened=1n;__journeyFixture.allowed=101n;});await page.locator('#navNext').click();await page.waitForFunction(()=>!document.getElementById('navNext').disabled);assert.equal(await page.locator('#page-2').isVisible(),true);assert.match(await page.locator('#proceedStatus').textContent(),/time lock has not expired/);
 stage='withdrawal-ready';await page.evaluate(()=>__journeyFixture.allowed=100n);await page.locator('#navNext').click();await page.locator('#page-3').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>__journeyFixture.calls.includes('withdraw')),false,'Eligibility navigation alone must not withdraw');
 await page.locator('#navNext').click();await page.locator('#page-4').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>__journeyFixture.calls.filter(x=>x==='withdraw').length),1);
 stage='settlement-pending';await page.locator('#navNext').click();await page.waitForFunction(()=>!document.getElementById('navNext').disabled);assert.equal(await page.locator('#page-4').isVisible(),true);assert.match(await page.locator('#claimL1Status').textContent(),/Network settlement is pending/);assert.equal(await page.locator('#claimL1Status img').count(),0);assert.doesNotMatch(await page.locator('#claimL1Status').textContent(),/<img/);
 stage='recovery-refresh';
 for(const [state,target]of [['postable',2],['withdrawn_l2_claimable_l1',4],['zero_balance_need_deposit',1],['deposited_l1_not_claimed_l2',0]]){
  const before=await page.evaluate(state=>{showPage(0);__journeyFixture.recoveryState=state;return __journeyFixture.calls.length;},state);
  await page.getByRole('button',{name:'Recover saved Aztec transaction',exact:true}).click();await page.waitForFunction(({target,before})=>document.getElementById('page-'+target).classList.contains('active')&&__journeyFixture.calls.length>=before+2&&__journeyFixture.calls.at(-1)==='status',{target,before});
  assert.deepEqual(await page.evaluate(before=>__journeyFixture.calls.slice(before),before),['recover','status']);
 }
 assert.match(await page.locator('#setupStatus').textContent(),/deposit still needs a claim/);
 stage='explicit-deposit-recovery';
 const beforeClaim=await page.evaluate(()=>{const count=__journeyFixture.calls.length;showPage(1);return count;});
 assert.equal(await page.evaluate(()=>__journeyFixture.calls.length),beforeClaim,'Showing recovery must not start a claim');
 await page.locator('#navNext').click();await page.waitForFunction(()=>!document.getElementById('navNext').disabled);
 assert.equal(await page.evaluate(()=>__journeyFixture.calls.length),beforeClaim,'Missing receipt must not call the engine');
 const receiptHash='0x'+'34'.repeat(32);await page.locator('#existingTxHash').fill(receiptHash);
 await page.locator('#navNext').click();await page.locator('#page-2').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>__journeyFixture.claimHash),receiptHash);
 assert.deepEqual(await page.evaluate(before=>__journeyFixture.calls.slice(before),beforeClaim),['claim']);
 stage='reload-recovery-navigation';
 await page.reload();await page.waitForFunction(()=>typeof globalThis.callEngine==='function');
 assert.deepEqual(await page.evaluate(()=>billboardConfigStore.snapshot().config),record);
 await page.evaluate(installJourneyFixture);
 const recoveryStarted=Date.now();await page.getByRole('button',{name:'Recover saved Aztec transaction',exact:true}).click();
 await page.locator('#page-2').waitFor({state:'visible'});
 assert.deepEqual(await page.evaluate(()=>__journeyFixture.calls),['recover','status']);
 assert(Date.now()-recoveryStarted<60000);
 assert.deepEqual(external,[]);assert.equal(posts,0);
 console.log(JSON.stringify({passed:true,scope:'Actual built HTTPS DOM with explicit UI-state engine and read-result fixtures; no genuine wallet/transaction/proof qualification',statusNavigation:true,postBusyPreventsRepeat:true,untrustedTextLiteral:true,screeningAndTimeGates:true,withdrawalActionExplicit:true,pendingSettlementKeepsClaimPage:true,recoveryRefreshAllStates:true,reloadRecoveryNavigation:true,explicitReceiptRecovery:true,rpcRequests:0,externalRequests:0}));
}
try{await Promise.race([main(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Journey UI test exceeded 60 seconds')),60000);})]);}
catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name}));throw Error('Journey UI fixture qualification failed at '+stage);}
finally{clearTimeout(timer);await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const escalation=setTimeout(()=>child.kill('SIGKILL'),1500);await closed;clearTimeout(escalation);}fs.rmSync(dir,{recursive:true,force:true});}
