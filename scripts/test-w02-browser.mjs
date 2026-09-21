// Fresh local browser contexts only. Never export plaintext custody to the host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
const password=randomBytes(32).toString('hex');
let browser,stage='server',externalRequests=0;
const server=http.createServer(async(req,res)=>{
  try {
    const name=new URL(req.url,'http://localhost').pathname;
    if(!/^\/[a-zA-Z0-9_.-]+$/.test(name)) {res.writeHead(404).end();return;}
    const file=path.join(ROOT,'apps/dist',name.slice(1));
    res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.js')?'application/javascript':'application/octet-stream');
    res.end(await fs.readFile(file));
  }catch{res.writeHead(404).end();}
});
if(process.env.U01_BOUNDED_BROWSER!=='true')throw Error('Run through run-bounded-browser-check.mjs.');
async function readyUser(page) {
 await page.waitForFunction(()=>window.__aztec?.createEthereumJournal);
 // Wallet component scope: hosted board discovery has separate coverage.
 await page.evaluate(()=>initWalletButtons('walletButtonsContainer',{autoPasskey:true}));
 await page.locator('#wbAccountMenu summary').click();
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://localhost:'+server.address().port;
  browser=await chromium.launch({headless:true});
  async function open(pageName='user.html') {
    const context=await browser.newContext({acceptDownloads:true});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const page=await context.newPage();page.setDefaultTimeout(15000);
    await page.goto(origin+'/'+pageName);
    if(pageName==='user.html')await readyUser(page);
    else await page.waitForFunction(()=>window.__aztec?.Fr && document.getElementById('wbEthBrowserBtn'));
    return {context,page};
  }
  stage='create-passkey-account';const first=await open();
  const cdp=await first.context.newCDPSession(first.page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,hasPrf:true,automaticPresenceSimulation:true,isUserVerified:true}});
  await first.page.evaluate(()=>{
    // Wallet UI component test: no Ethereum transaction or Aztec node operation.
    _onReady=null;
    window.ethereum={request:async({method})=>{if(method==='eth_chainId')return '0x7a69';if(['eth_accounts','eth_requestAccounts'].includes(method))return ['0x'+'12'.repeat(20)];throw Error('Unexpected Ethereum request');}};
  });
  await first.page.locator('#wbEthBrowserBtn').click();
  await first.page.waitForFunction(()=>window.walletState.aztec?.address);
  const address=await first.page.evaluate(()=>window.walletState.aztec.address.toString());
  stage='save-disposable-claim';
  const commitment=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,secret=a.Fr.random(),hash=(await a.computeSecretHash(secret)).toString();
    const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'1',boardAddress:'0x'+'0'.repeat(63)+'2',portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    await makeClaimSecretStore(w.secretKey,w.salt).save(scope,{schemaVersion:1,secretHash:hash,secret:secret.toString()});
    return hash;
  });
  stage='export-updated-backup';
  await first.page.locator('#wbPassword').fill(password);await first.page.locator('#wbPasswordConfirm').fill(password);
  const exported=first.page.waitForEvent('download');await first.page.locator('#wbBackupBtn').click();
  const download=await exported,encrypted=await fs.readFile(await download.path());
  assert.equal(JSON.parse(encrypted).kind,'aztec-billboard-encrypted-wallet');
  stage='wrong-password';const second=await open();
  await second.page.locator('#wbPassword').fill('wrong-password-for-test');
  await second.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:encrypted});
  await second.page.waitForFunction(()=>document.getElementById('wbPassword').value==='');
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec),null);
  stage='restore-fresh-profile';
  await second.page.locator('#wbPassword').fill(password);
  await second.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:encrypted});
  await second.page.waitForFunction(()=>window.walletState.aztec?.address);
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  const restored=await second.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,records=await window.BillboardClaimBackup.exportRecords(w);
    return {count:records.length,hash:records[0].record.secretHash,matches:(await a.computeSecretHash(new a.Fr(BigInt(records[0].record.secret)))).toString()===records[0].record.secretHash};
  });
  assert.deepEqual(restored,{count:1,hash:commitment,matches:true});
  await second.context.close();
  stage='same-profile-tab-exclusion';
  const other=await first.context.newPage();other.setDefaultTimeout(15000);
  await other.goto(origin+'/user.html');await readyUser(other);
  await other.locator('#wbPassword').fill(password);await other.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:encrypted});
  await other.waitForFunction(()=>window.walletState.aztec?.address);
  await first.page.evaluate(()=>{
    navigator.locks.request('billboard-wallet:'+window.walletState.aztec.address.toString(),async()=>{
      window._testLockReady=true;await new Promise(resolve=>window._testReleaseLock=resolve);
    });
  });
  await first.page.waitForFunction(()=>window._testLockReady);
  const blocked=await other.evaluate(async()=>{
    let called=false;try {await makeCallEngine(async()=>{called=true;})('status','setupStatus',{});return false;}catch{return !called;}
  });
  assert.equal(blocked,true);await first.page.evaluate(()=>window._testReleaseLock());await other.close();

  stage='journal-before-reload';
  const savedHash=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,tx=a.Tx.random({randomProof:true});
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    const journal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node:{}});
    await journal.prepare(tx,await journal.assertCanStart());return tx.getTxHash().toString();
  });
  stage='journal-reload-and-wallet-restore';
  await first.page.reload();await readyUser(first.page);
  await first.page.locator('#wbPassword').fill(password);await first.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:encrypted});
  await first.page.waitForFunction(()=>window.walletState.aztec?.address);
  const recovery=await first.page.evaluate(async txHash=>{
    const a=window.__aztec,w=window.walletState.aztec;let submissions=0,status='dropped',blocked=false;
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    const node={getTxReceipt:async()=>({txHash,status,executionResult:'success',blockNumber:1,blockHash:'canonical'}),getBlock:async()=>({hash:'canonical'}),isValidTx:async()=>({result:'valid'}),sendTx:async tx=>{if(tx.getTxHash().toString()!==txHash)throw new Error('identity');submissions++;status='checkpointed';}};
    const journal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node});
    try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_RECOVERY_REQUIRED';}
    const receipt=await journal.recover();return {blocked,submissions,sameHash:receipt.txHash.toString()===txHash};
  },savedHash);
  assert.deepEqual(recovery,{blocked:true,submissions:1,sameHash:true});

  stage='ethereum-intent-before-reload';
  const ethereumHash=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,secretHash=a.Fr.random().toString();
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    const blockHash='0x'+'01'.repeat(32),provider={getNetwork:async()=>({chainId:31337n}),getBlock:async()=>({number:1,hash:blockHash}),getTransactionCount:async()=>5};
    const signer={getAddress:async()=>scope.depositor,sendTransaction:async()=>{throw new Error('synthetic lost signing response');}};
    const journal=await a.createEthereumJournal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,provider,signer});
    const iface=new ethers.Interface(['function deposit(bytes32) payable']);
    try{await journal.send({data:iface.encodeFunctionData('deposit',[secretHash]),value:'100',expected:{kind:'deposit',amount:'100',secretHash}});}catch(e){if(e.code!=='BB_ETH_SUBMISSION_UNKNOWN')throw e;}
    return secretHash;
  });
  stage='ethereum-intent-reload';await first.page.reload();await readyUser(first.page);
  await first.page.locator('#wbPassword').fill(password);await first.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:encrypted});await first.page.waitForFunction(()=>window.walletState.aztec?.address);
  const ethRecovered=await first.page.evaluate(async secretHash=>{
    const a=window.__aztec,w=window.walletState.aztec,scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    const blockHash='0x'+'01'.repeat(32),txHash='0x'+'04'.repeat(32);let tx=null,receipt=null,nonce=null,submissions=0;
    const iface=new ethers.Interface(['function deposit(bytes32) payable','event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
    const provider={getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>1,getTransactionCount:async()=>tx?6:5,getBlock:async()=>({number:1,hash:blockHash}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt};
    const signer={getAddress:async()=>scope.depositor,sendTransaction:async request=>{
      if(request.data!==iface.encodeFunctionData('deposit',[secretHash])||request.value!==100n)throw new Error('payment changed');
      submissions++;nonce=request.nonce;tx={...request,hash:txHash};receipt={hash:txHash,from:scope.depositor,to:scope.portal,status:1,blockNumber:1,blockHash,logs:[{address:scope.portal,...iface.encodeEventLog(iface.getEvent('Deposited'),[scope.depositor,100,secretHash,secretHash,0])}]};return tx;
    }};
    const journal=await a.createEthereumJournal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,provider,signer});
    let blocked=false;try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_ETH_RECOVERY_REQUIRED';}
    const result=await journal.recover({retry:true});return {blocked,submissions,nonce,outcome:result.outcome};
  },ethereumHash);
  assert.deepEqual(ethRecovered,{blocked:true,submissions:1,nonce:5,outcome:'success'});

  stage='export-portable-journals';
  await first.page.locator('#wbPassword').fill(password);await first.page.locator('#wbPasswordConfirm').fill(password);
  const portableDownload=first.page.waitForEvent('download');await first.page.locator('#wbBackupBtn').click();
  const portable=await fs.readFile(await (await portableDownload).path());
  await first.context.close();
  stage='restore-journals-fresh-profile';const third=await open('censor.html');
  await third.page.locator('#wbPassword').fill(password);await third.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:portable});
  await third.page.waitForFunction(()=>window.walletState.aztec?.address);
  const portableResult=await third.page.evaluate(async txHash=>{
    const a=window.__aztec,w=window.walletState.aztec,storage=a.createBrowserJournalStorage();
    const records=await (await a.createJournalBackup({storage,walletSecret:w.secretKey,walletSalt:w.salt})).exportRecords();
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    const node={getTxReceipt:async()=>({txHash,status:'checkpointed',executionResult:'success',blockNumber:1,blockHash:'canonical'}),getBlock:async()=>({hash:'canonical'})};
    const journal=await a.createL2Journal({storage,walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node});
    let blocked=false;try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_RECOVERY_REQUIRED';}
    return {count:records.length,claims:(await BillboardClaimBackup.exportRecords(w)).length,blocked,hash:(await journal.recover()).txHash.toString()};
  },savedHash);
  assert.deepEqual(portableResult,{count:2,claims:1,blocked:true,hash:savedHash});
  assert.equal(await third.page.getByRole('button',{name:'Recover saved moderator transaction'}).count(),1);
  await third.context.close();

  stage='deployment-resume-ui';const deploy=await open('deploy.html');
  await deploy.page.locator('#wbPassword').fill(password);await deploy.page.locator('#wbAztecFile').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:portable});
  await deploy.page.waitForFunction(()=>window.walletState.aztec?.address);
  const deployResult=await deploy.page.evaluate(async()=>{
    let calls=0;
    window.runDeploy=async()=>{calls++;return{status:'pending-settlement',l2Addr:'0x'+'2'.padStart(64,'0'),portalAddr:'0x'+'22'.repeat(20),readyTxHash:'0x'+'44'.repeat(32)};};
    const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
    document.getElementById('deploymentManifest').value=JSON.stringify({schemaVersion:1,profile:'local-test',network:{nodeUrl:'http://localhost:8080/',ethRpcUrl:'http://localhost:8545/',chainId:'31337',rollupVersion:'5',rollup:'0x'+'33'.repeat(20),inbox:'0x'+'66'.repeat(20),outbox:'0x'+'77'.repeat(20)},actors:{aztecDeployer:window.walletState.aztec.address.toString(),ethereumDeployer:'0x'+'44'.repeat(20)},board:{salt:'1',minDeposit:'1',maxDeposit:'100',baseCooldown:'10',kMultiplier:'64',censorWindow:'10',maxSaveUp:'16',censor:word(1),policy:'Be kind.'},artifacts:{boardJsonSha256:word(1),boardClassId:word(2),portalCreationSha256:word(3),portalRuntimeMetadataSha256:word(4)}});
    await startDeploy();
    const pending=document.getElementById('status').textContent.includes('Network settlement is pending');
    const hashSaved=document.getElementById('readyTxHash').value==='0x'+'44'.repeat(32);
    const noReadyLink=!document.querySelector('#status a[href^="user.html"]');
    let release;const held=navigator.locks.request('billboard-wallet:'+window.walletState.aztec.address.toString(),async()=>{
      await new Promise(resolve=>release=resolve);
    });
    while(!release)await new Promise(resolve=>setTimeout(resolve,0));
    try{await startDeploy();}finally{release();await held;}
    return{pending,hashSaved,noReadyLink,calls};
  });
  assert.deepEqual(deployResult,{pending:true,hashSaved:true,noReadyLink:true,calls:1});

  console.log(JSON.stringify({passed:true,actualBuiltBrowser:true,freshProfiles:4,maximumConcurrentProfiles:2,deploymentPendingUiAndWalletLock:true,actualPortableJournalRestore:true,wrongPasswordRejected:true,sameRestoredAddress:true,restoredClaimCommitmentVerified:true,actualCrossTabExclusion:true,actualJournalReloadRecovery:true,actualEthereumIntentReloadRecovery:true,externalRequestsBlocked:externalRequests,secretsWrittenToEvidence:false}));
}catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name,location:error.stack?.split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,2)}));process.exitCode=1;}
finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
