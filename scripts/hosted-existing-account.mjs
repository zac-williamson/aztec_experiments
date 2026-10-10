// Live-test helper: restore only the disposable identity from a successful hosted run.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {JsonRpcProvider} from 'ethers';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {createAztecNodeClient} from '../shared/aztec-node-client.mjs';
import {discoverTestMetaMask,observeMetaMaskTransactions} from './t04-metamask.mjs';
import {installBrowserErrorObserver} from './browser-error-observer.mjs';
import {ROOT} from './toolchain.mjs';
import {describeFailure} from './testing/supervisor.mjs';
import {verifyHostedAsset} from './hosted-asset-verification.mjs';
import '../shared/public-app-config.js';
export const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export async function canonicalReceipt(node,hash){
 assert.match(hash,/^0x[0-9a-f]{64}$/);const r=await node.getTxReceipt(TxHash.fromString(hash));
 assert(['checkpointed','proven','finalized'].includes(r.status));assert.equal(r.executionResult,'success');
 assert.equal((await node.getBlock(r.blockNumber)).hash.toString(),r.blockHash.toString());
 return {hash,status:r.status,blockNumber:r.blockNumber,blockHash:r.blockHash.toString(),transactionFee:String(r.transactionFee)};
}
export async function openHostedAccount({run,siteConfig,mark}){
 assert(process.env.BOARD_HOSTED_BOUNDED==='true');assert(/^[a-z0-9-]+$/.test(run));
 const directory=path.join(ROOT,'.build/hosted-'+run),privateDir=path.join(directory,'private');
 const onboarding=await readJson(path.join(directory,'result.json'));assert.equal(onboarding.passed,true);
 const config=globalThis.BillboardConfig.validate(await readJson(siteConfig)),identity=await readJson(path.join(privateDir,'identity.json'));
 assert.equal(identity.address,onboarding.ethereumAccount);assert.deepEqual(config,onboarding.config);
 const origin=new URL(config.remoteProver.url).origin;assert.equal(origin,'https://d30njln0kead8n.cloudfront.net');
 const extension=path.join(privateDir,'metamask/extension');
 const context=await chromium.launchPersistentContext(path.join(privateDir,'profile'),{channel:'chromium',headless:true,acceptDownloads:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--js-flags=--max-old-space-size=512']});
 let provider;
 try{
  for(const restored of context.pages())await restored.close();
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker',{timeout:30000}),extensionId=new URL(worker.url()).host;
  const walletPage=await context.newPage();walletPage.setDefaultTimeout(60000);await walletPage.goto('chrome-extension://'+extensionId+'/home.html');
  await walletPage.getByTestId('unlock-password').fill(identity.password);await walletPage.getByTestId('unlock-submit').click();await walletPage.getByTestId('account-menu-icon').waitFor();await walletPage.goto('chrome-extension://'+extensionId+'/sidepanel.html');
  const page=await context.newPage();page.setDefaultTimeout(60000);mark('restore-existing-hosted-account');
  for(const name of ['user.html','aztec_bundle.js','plugins.js']){mark('verify-public-asset:'+name);const expected=await fs.readFile(path.join(ROOT,'apps/dist',name));await verifyHostedAsset({url:origin+'/'+name,expectedBytes:expected.length,expectedSha256:createHash('sha256').update(expected).digest('hex')});}
  mark('load-live-application');
  await page.goto(onboarding.url,{timeout:120000});await page.waitForFunction(()=>globalThis.__aztec?.createPXE&&globalThis.billboardConfigStore?.snapshot().config,{},{timeout:180000});
  await page.evaluate(installBrowserErrorObserver);await discoverTestMetaMask(page);await observeMetaMaskTransactions(page);
  assert.deepEqual(await page.evaluate(()=>billboardConfigStore.snapshot().config),config);assert.equal(await page.evaluate(()=>BillboardProving.snapshot()),'remote');
  mark('restore-disposable-aztec-account');await page.locator('#wbAccountMenu > summary').click();await page.getByText('Restore account',{exact:true}).click();await page.locator('#wbRestorePassword').fill(identity.password);await page.locator('#wbAztecFile').setInputFiles(path.join(privateDir,'aztec-wallet.encrypted.json'));
  await page.waitForFunction(()=>!!BillboardAccount.snapshot().address,{},{timeout:180000});await page.locator('#wbAccountMenu > summary').click();
  mark('reconnect-disposable-ethereum-account');await page.locator('#wbEthBrowserBtn').click();await page.getByRole('dialog').getByRole('button',{name:'MetaMask',exact:true}).click();
  const connected=page.waitForFunction(()=>BillboardAccount.snapshot().ethereumConnected,{},{timeout:180000});
  const state=await Promise.race([connected.then(()=> 'connected'),walletPage.getByTestId('confirm-btn').waitFor().then(()=> 'approve')]);
  if(state==='approve'){assert.equal((await walletPage.getByTestId('confirm-btn').innerText()).trim(),'Connect');await walletPage.getByTestId('confirm-btn').click();}await connected;
  assert.equal(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),'0xaa36a7');
  assert.equal((await page.evaluate(()=>BillboardAccount.snapshot().ethereumAddress)).toLowerCase(),identity.address.toLowerCase());assert.equal(await page.evaluate(()=>BillboardAccount.snapshot().address),onboarding.aztecAccount);
  mark('wait-restored-application');await page.waitForFunction(()=>application.connected&&!['working','waiting'].includes(application.operation().status),{},{timeout:180000});
  assert(!['failed','cancelled'].includes(await page.evaluate(()=>application.operation().status)));
  provider=new JsonRpcProvider(config.network.ethRpcUrl);const node=createAztecNodeClient(config.network.nodeUrl),info=await node.getNodeInfo();
  assert.equal(info.nodeVersion,'6.0.0-rc.1');assert.equal(info.realProofs,true);assert.equal(String(info.rollupVersion),config.network.rollupVersion);
  return {context,page,walletPage,provider,node,identity,onboarding,config,directory,origin,async close(){provider.destroy();await context.close();}};
 }catch(error){process.stdout.write(JSON.stringify({kind:'hosted-account-failure',...describeFailure(error)})+'\n');provider?.destroy();await context.close();throw error;}
}
