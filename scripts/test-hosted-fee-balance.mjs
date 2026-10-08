// Read-only follow-up to the successful fresh testnet journey, using its disposable MetaMask profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {JsonRpcProvider} from 'ethers';
import {discoverTestMetaMask,observeMetaMaskTransactions} from './t04-metamask.mjs';
import {ROOT} from './toolchain.mjs';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
const source=path.join(ROOT,'.build/hosted-ux-fresh-20261007'),privateDir=path.join(source,'private');
const output=path.join(ROOT,'.build/hosted-ux-fee-balance-20261007');await fs.mkdir(output,{recursive:true});
const qualification=JSON.parse(await fs.readFile(path.join(source,'result.json'),'utf8'));assert.equal(qualification.passed,true);
const identity=JSON.parse(await fs.readFile(path.join(privateDir,'identity.json'),'utf8'));assert.equal(identity.address,qualification.ethereumAccount);
const report={passed:false,network:qualification.network,ethereumAccount:identity.address,startedAt:new Date().toISOString()};let context,provider,page,stage='browser';const mark=value=>{stage=value;console.log(JSON.stringify({stage}));};
try{
 const extension=path.join(privateDir,'metamask','extension');
 context=await chromium.launchPersistentContext(path.join(privateDir,'profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000}),extensionId=new URL(worker.url()).host;
 const wallet=await context.newPage();wallet.setDefaultTimeout(60000);await wallet.goto('chrome-extension://'+extensionId+'/home.html');await wallet.getByTestId('unlock-password').fill(identity.password);await wallet.getByTestId('unlock-submit').click();await wallet.getByTestId('account-menu-icon').waitFor();await wallet.goto('chrome-extension://'+extensionId+'/sidepanel.html');
 mark('candidate-page');const feeUrl=qualification.url.replace('/user.html','/fee-juice.html');report.pageSha256=createHash('sha256').update(Buffer.from(await(await fetch(feeUrl,{signal:AbortSignal.timeout(30000)})).arrayBuffer())).digest('hex');assert.equal(report.pageSha256,createHash('sha256').update(await fs.readFile(path.join(ROOT,'apps/dist/fee-juice.html'))).digest('hex'));
 page=await context.newPage();page.setDefaultTimeout(60000);await page.goto(qualification.url.replace('/user.html','/fee-juice.html'),{timeout:120000});await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&globalThis.billboardConfigStore?.snapshot().config,{},{timeout:180000});
 await page.evaluate(installBrowserErrorObserver);await discoverTestMetaMask(page);await observeMetaMaskTransactions(page);
 const config=await page.evaluate(()=>billboardConfigStore.snapshot().config);assert.deepEqual(config,qualification.config);
 provider=new JsonRpcProvider(config.network.ethRpcUrl);assert.equal((await provider.getNetwork()).chainId,11155111n);report.nonceBefore=await provider.getTransactionCount(identity.address,'pending');
 mark('restore-private-account');await page.locator('#wbAccountMenu > summary').click();await page.getByText('Restore account',{exact:true}).click();await page.locator('#wbRestorePassword').fill(identity.password);await page.locator('#wbAztecFile').setInputFiles(path.join(privateDir,'aztec-wallet.encrypted.json'));await page.waitForFunction(()=>!!BillboardAccount.snapshot().address,{},{timeout:180000});await page.locator('#wbAccountMenu > summary').click();
 mark('connect-ethereum');await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
 const connected=page.waitForFunction(()=>BillboardAccount.snapshot().ethereumConnected,{},{timeout:60000});
 const state=await Promise.race([connected.then(()=> 'connected'),wallet.getByTestId('confirm-btn').waitFor().then(()=> 'approve')]);if(state==='approve'){assert.equal((await wallet.getByTestId('confirm-btn').innerText()).trim(),'Connect');await wallet.getByTestId('confirm-btn').click();}await connected;
 await page.locator('#fundingPanel').waitFor({state:'visible',timeout:120000});assert.equal((await page.evaluate(()=>BillboardAccount.snapshot().ethereumAddress)).toLowerCase(),identity.address.toLowerCase());
 assert.equal(await page.evaluate(()=>BillboardAccount.snapshot().address),qualification.aztecAccount);
 mark('read-private-fee-balance');let timer;try{report.feeBalance=await Promise.race([page.evaluate(async()=>String(await application.readFeeBalance())),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Balance read exceeded five minutes')),300000);})]);}finally{clearTimeout(timer);}assert(BigInt(report.feeBalance)>0n);assert.equal(await page.evaluate(()=>globalThis.__walletTestPending),null);
 report.nonceAfter=await provider.getTransactionCount(identity.address,'pending');assert.equal(report.nonceAfter,report.nonceBefore);assert.equal(await page.evaluate(()=>application.operation().status),'complete');report.passed=true;
}catch(error){report.diagnostics=await page?.evaluate(()=>globalThis.__u01FormatterDiagnostics??[]).catch(()=>[]);report.failure={stage,category:['Error','TypeError','RangeError','AssertionError','TimeoutError'].includes(error.name)?error.name:'OtherError'};process.exitCode=1;}
finally{if(context)await context.close();provider?.destroy();report.finishedAt=new Date().toISOString();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
