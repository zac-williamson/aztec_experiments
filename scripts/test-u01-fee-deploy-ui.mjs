// UI fixture only: real built HTTPS controls, explicit engine result boundaries.
// Does not qualify fee funding, deployment, proofs, network preflight or real wallets.
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
const dir=fs.mkdtempSync(path.join(process.env.BILLBOARD_TEST_TMPDIR||os.tmpdir(),'u01-fee-deploy-'));
let child,browser,timer,stage='hosting';
const request=port=>new Promise((resolve,reject)=>{const req=https.get({hostname:'127.0.0.1',port,path:'/feed.html',rejectUnauthorized:false,timeout:1000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.on('timeout',()=>req.destroy(Error('server not ready')));});
async function tabTo(page,locator){for(let i=0;i<90;i++){if(await locator.evaluate(el=>el===document.activeElement))return;await page.keyboard.press('Tab');}throw Error('Keyboard target was unreachable');}
async function checkLabels(page,ids){for(const id of ids)assert(await page.locator('#'+id).evaluate(el=>el.labels?.length>0),'Missing associated label: '+id);}
async function main(){
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='https://127.0.0.1:'+port;
 const cert=path.join(dir,'cert.pem'),key=path.join(dir,'key.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore',timeout:10000});
 const caddy=path.join(ROOT,'.build/caddy-2.11.4/caddy'),file=path.join(dir,'Caddyfile');fs.writeFileSync(file,generateHosting({dist:path.join(ROOT,'apps/dist'),site:origin,certificate:cert,key,local:true,origins:[]}).caddyfile);
 child=spawn(caddy,['run','--config',file,'--adapter','caddyfile'],{env:{PATH:'/usr/bin:/bin',HOME:dir,XDG_DATA_HOME:dir,XDG_CONFIG_HOME:dir},stdio:'ignore'});
 let ready=false;for(let i=0;i<40;i++){try{if(await request(port)===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}assert(ready);
 browser=await chromium.launch({headless:true,args:['--js-flags=--max-old-space-size=768']});const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});context.setDefaultTimeout(8000);const external=[];let posts=0;
 await context.route('**/*',route=>{const req=route.request(),url=req.url();if(req.method()==='POST'){posts++;return route.abort();}if(/^https?:/.test(url)&&new URL(url).origin!==origin){external.push(new URL(url).origin);return route.abort();}return route.continue();});

 const page=await context.newPage();stage='fee-page';await page.goto(origin+'/fee-juice.html');await page.waitForFunction(()=>typeof globalThis.callEngine==='function'&&globalThis.__aztec?.createPXE);
 await page.evaluate(()=>{
  const f={mode:'amount-error',calls:[],record:{schema:'private-fee-funding-v1',chainId:'31337',version:'5',rollupAddress:'0x'+'11'.repeat(20),portalAddress:'0x'+'22'.repeat(20),tokenAddress:'0x'+'33'.repeat(20),privateFeeAddress:'0x'+'01'.repeat(32),sender:'0x'+'44'.repeat(20),nonce:'1',amount:'100',txHash:'0x'+'55'.repeat(32),leafIndex:'0'}};globalThis.__feeUIFixture=f;
  // The UI wrapper boundary is explicit: returned records/errors are fixture data.
  globalThis.callEngine=async(action,status,extra={})=>{
   f.calls.push({action,amount:extra.depositAmount??null});
   if(f.mode==='amount-error')throw Object.assign(new Error('Private fixture detail <img src=x onerror=alert(1)>'),{code:'BB_PRIVATE_FEE_AMOUNT'});
   if(f.mode==='unknown')throw Object.assign(new Error('Private fixture detail'),{code:'BB_ETH_SUBMISSION_UNKNOWN'});
   if(f.mode==='hold')await new Promise(resolve=>f.release=resolve);
   return {ok:true,record:f.record};
  };
 });
 stage='fee-amount-rejection';await page.locator('#amount').fill(' 0 ');await page.locator('#depositBtn').click();await page.waitForFunction(()=>!document.getElementById('depositBtn').disabled);assert.match(await page.locator('#depositStatus').textContent(),/Deposit more than the configured maximum claim fee, so a private balance remains after claiming\./);assert.doesNotMatch(await page.locator('#depositStatus').textContent(),/Deposit recorded|Private fixture detail|<img/);assert.equal(await page.evaluate(()=>localStorage.getItem('billboard-private-fee-recovery-latest')),null);assert.equal(await page.evaluate(()=>__feeUIFixture.calls[0].amount),'0');
 stage='fee-busy-and-record';await page.evaluate(()=>__feeUIFixture.mode='hold');await page.locator('#amount').fill(' 1.25 ');await page.locator('#depositBtn').click();await page.waitForFunction(()=>!!__feeUIFixture.release);assert.equal(await page.locator('#depositBtn').isDisabled(),true);await page.evaluate(()=>document.getElementById('depositBtn').click());assert.equal(await page.evaluate(()=>__feeUIFixture.calls.length),2);await page.evaluate(()=>__feeUIFixture.release());await page.waitForFunction(()=>!document.getElementById('depositBtn').disabled);assert.match(await page.locator('#depositStatus').textContent(),/Deposit recorded/);
 const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery record',exact:true}).click();const download=await downloadEvent,record=JSON.parse(fs.readFileSync(await download.path(),'utf8'));assert.equal(record.schema,'private-fee-funding-v1');assert.equal(record.amount,'100');assert(!('secret' in record)&&!('secretKey' in record));
 stage='fee-unknown-preserves-recovery';await page.evaluate(()=>__feeUIFixture.mode='unknown');await page.getByRole('button',{name:'Check saved Ethereum fee request',exact:true}).click();await page.getByText('Submission outcome is unknown. Keep the recovery record and check the transaction before retrying.',{exact:false}).waitFor();const preserved=await page.evaluate(()=>JSON.parse(localStorage.getItem(localStorage.getItem('billboard-private-fee-recovery-latest'))));assert.deepEqual(preserved,record);
 await page.locator('#depositBtn').click();await page.waitForFunction(()=>!document.getElementById('depositBtn').disabled);assert.match(await page.locator('#depositStatus').textContent(),/Submission outcome is unknown\. Keep the recovery record and check the transaction before retrying\./);assert.doesNotMatch(await page.locator('#depositStatus').textContent(),/Deposit recorded|Private fixture detail/);
 await page.locator('#claimBtn').click();await page.waitForFunction(()=>!document.getElementById('claimBtn').disabled);assert.match(await page.locator('#claimStatus').textContent(),/Submission outcome is unknown\. Keep the recovery record and check the transaction before retrying\./);assert.doesNotMatch(await page.locator('#claimStatus').textContent(),/Private balance funded|Private fixture detail/);assert.equal(await page.locator('#claimStatus img').count(),0);
 stage='deploy-manifest';await page.goto(origin+'/deploy.html');await page.waitForFunction(()=>globalThis.__aztec?.deploymentManifestConfig&&typeof globalThis.runDeploy==='function');
 const field=n=>'0x'+n.toString(16).padStart(64,'0'),address=n=>'0x'+n.toString(16).padStart(40,'0');
 const manifest={schemaVersion:1,profile:'local-test',network:{nodeUrl:origin+'/fixture-node',ethRpcUrl:origin+'/fixture-ethereum',chainId:'31337',rollupVersion:'5',rollup:address(11),inbox:address(12),outbox:address(13)},actors:{aztecDeployer:field(1),ethereumDeployer:address(2)},board:{salt:'19',minDeposit:'1',maxDeposit:'100',baseCooldown:'10',kMultiplier:'2',censorWindow:'4',maxSaveUp:'16',censor:field(3),policy:'UI-only reviewed fixture policy'},artifacts:{boardJsonSha256:field(4),boardClassId:field(5),portalCreationSha256:field(6),portalRuntimeMetadataSha256:field(7)}};
 await page.locator('#manifestFile').setInputFiles({name:'ui-manifest.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))});await page.getByText(/Configuration to review: chain 31337/).waitFor();
 await page.evaluate(()=>{
  globalThis.__deployUIFixture={status:'pending',calls:0};
  // Replace only deployment engine result; the actual manifest adapter, browser
  // wrapper, readiness, report creation and public configuration export remain.
  globalThis.runDeploy=async()=>{__deployUIFixture.calls++;return {status:__deployUIFixture.status,l2Addr:'0x'+'0'.repeat(63)+'8',portalAddr:'0x'+'0'.repeat(39)+'9',readyTxHash:'0x'+'77'.repeat(32)};};
  window.walletState.aztec={secretKey:'0x'+'0'.repeat(63)+'1',salt:'0x'+'0'.repeat(64),address:{toString:()=> '0x'+'0'.repeat(63)+'1'}};window.walletState.ethSigner={};window.walletState.ethType='ui-fixture';
 });
 stage='deployment-pending-report';await page.locator('#deployButton').click();await page.getByText(/Deployment saved. Network settlement is pending/).waitFor();assert.equal(await page.getByRole('button',{name:'Download public connection settings',exact:true}).count(),0);const pendingDownload=page.waitForEvent('download');await page.getByRole('link',{name:'Download deployment report',exact:true}).click();const pending=JSON.parse(fs.readFileSync(await (await pendingDownload).path(),'utf8'));assert.equal(pending.status,'pending');assert.deepEqual(pending.manifest,manifest);
 stage='deployment-active-export';await page.evaluate(()=>__deployUIFixture.status='active');const gas={gasLimits:{daGas:'10',l2Gas:'20'},teardownGasLimits:{daGas:'0',l2Gas:'0'},maxFeesPerGas:{feePerDaGas:'2',feePerL2Gas:'3'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}};await page.locator('#publicFeeGas').fill(JSON.stringify(gas));await page.locator('#deployButton').click();await page.getByRole('button',{name:'Download public connection settings',exact:true}).waitFor();const configDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download public connection settings',exact:true}).click();const config=JSON.parse(fs.readFileSync(await (await configDownload).path(),'utf8'));assert.deepEqual(config.network,{nodeUrl:manifest.network.nodeUrl,ethRpcUrl:manifest.network.ethRpcUrl,chainId:'31337',rollupVersion:'5',rollupAddress:manifest.network.rollup});assert.deepEqual(config.board,{contractAddress:field(8),portalAddress:address(9)});assert.deepEqual(config.privateFee.gasSettings,gas);assert.match(config.privateFee.contractAddress,/^0x[0-9a-f]{64}$/);assert.equal(await page.evaluate(()=>__deployUIFixture.calls),2);
 await page.getByRole('button',{name:'Use this board',exact:true}).click();await page.waitForURL(origin+'/user.html#network=31337:'+manifest.network.rollup+':5&board='+field(8));await page.getByText('This board is unavailable for posting. Reload to try again.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>billboardConfigStore.snapshot().config),null);
 stage='account-recovery-menu';await page.evaluate(()=>initWalletButtons('walletButtonsContainer',{autoPasskey:true}));assert.equal(await page.locator('#wbPassword').isVisible(),false);await page.locator('#wbAccountMenu > summary').click();await page.locator('#wbPassword').fill('disposable-menu-test-password');assert.equal(await page.locator('#wbPassword').isVisible(),true);await page.locator('#wbAccountMenu > summary').click();assert.equal(await page.locator('#wbPassword').isVisible(),false);
 assert.deepEqual(external,[]);assert.equal(posts,0);console.log(JSON.stringify({passed:true,scope:'Built HTTPS UI controls with explicit fee/deployment engine fixtures; no real payment, deployment, custody or proof qualification',feeAmountErrorNoSuccess:true,feeBusyPreventsRepeat:true,recoveryDownload:true,unknownOutcomePreservesRecord:true,pendingDeploymentReport:true,explicitDeployedBoardLink:true,unavailableBoardNotReplaced:true,rpcRequests:0,externalRequests:0}));
}
try{await Promise.race([main(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fee/deploy UI fixture exceeded 60 seconds')),60000);})]);}
catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name,...(error.name==='AssertionError'?{assertion:error.message}: {})}));throw Error('Fee/deploy UI fixture qualification failed at '+stage);}
finally{clearTimeout(timer);await browser?.close();if(child&&child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');const escalation=setTimeout(()=>child.kill('SIGKILL'),1500);await closed;clearTimeout(escalation);}fs.rmSync(dir,{recursive:true,force:true});}
