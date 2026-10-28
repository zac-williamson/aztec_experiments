// Fresh local browser contexts only. Never export plaintext custody to the host.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {Wallet,getBytes,toUtf8String} from 'ethers';
import {chromium} from 'playwright';
import {ROOT} from './toolchain.mjs';
import {MinedTxReceipt,DroppedTxReceipt,TxHash} from '@aztec-labs/stdlib/tx';
import {BlockHash} from '@aztec-labs/stdlib/block';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';
// Disposable fixture signer stays in process memory. No wallet/account key is exported.
const signer=Wallet.createRandom();
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
 await page.waitForFunction(()=>window.__aztec?.createEthereumJournal && window.BillboardEthereumSession);
 // Shared account component only: hosted board discovery/transactions have separate coverage.
 await page.evaluate(async()=>{
   _getPublicConfig=()=>({network:{chainId:'31337'}});
   await initWalletButtons('walletButtonsContainer',{requireEth:false});
 });
}
async function connect(page) {
 await page.locator('#wbEthBrowserBtn').click();
 await page.getByRole('dialog').getByRole('button',{name:'Browser wallet (legacy)',exact:true}).click();
 await page.waitForFunction(()=>window.walletState.aztec?.address && !BillboardAccount.snapshot().busy);
}
async function claim(page,hash) {
 return page.evaluate(async hash=>{
   const a=window.__aztec,w=window.walletState.aztec;
   const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'1',boardAddress:'0x'+'0'.repeat(63)+'2',portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
   const record=await makeClaimSecretStore(w.secretKey,w.salt).load(scope,hash);
   return record?{hash:record.secretHash,matches:(await a.computeSecretHash(a.Fr.fromHexString(record.secret))).toString()===record.secretHash}:null;
 },hash);
}
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://localhost:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  async function attach(page,wallet=signer) {
    const counts={signatures:0};
    await page.exposeFunction('__fixtureEthereumRequest',async({method,params})=>{
      if(method==='eth_chainId')return '0x7a69';
      if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet.address];
      assert.equal(method,'personal_sign','Component check must not submit transactions');
      assert.equal(params[1].toLowerCase(),wallet.address.toLowerCase());
      assert(toUtf8String(params[0]).startsWith('Create or open your private Rolling Chat account.\n\nOnly sign this request on '+origin+'.\n'));
      counts.signatures++;return wallet.signMessage(getBytes(params[0]));
    });
    await page.addInitScript(()=>{
      window.ethereum={request:async request=>{
        if(request.method==='personal_sign'&&window.__rejectSignature)throw Object.assign(Error('Rejected'),{code:4001});
        return window.__fixtureEthereumRequest(request);
      }};
    });
    page.setDefaultTimeout(10000);
    return counts;
  }
  async function open(pageName='user.html',wallet=signer) {
    const context=await browser.newContext({acceptDownloads:false});
    await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){externalRequests++;return route.abort();}return route.continue();});
    const page=await context.newPage(),counts=await attach(page,wallet);
    await page.goto(origin+'/'+pageName);await readyUser(page);
    return {context,page,counts};
  }
  stage='ethereum-sign-in';const first=await open();
  assert.equal(first.counts.signatures,0);
  assert.equal(await first.page.evaluate(()=>window.walletState.aztec===null),true);
  for(const id of ['wbPassword','wbRestorePassword','wbAztecFile','wbNewPasskeyBtn','wbBackupBtn'])assert.equal(await first.page.locator('#'+id).count(),0);
  await connect(first.page);
  const address=await first.page.evaluate(()=>window.walletState.aztec.address.toString());
  assert.equal(first.counts.signatures,1);
  const custody=await first.page.evaluate(async()=>{
    const w=window.walletState.aztec,publicText=JSON.stringify(BillboardAccount.snapshot())+document.body.innerHTML+JSON.stringify({...localStorage});
    const record=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('rolling-ethereum-account-session',1);
      request.onerror=()=>reject(Error('session database'));
      request.onsuccess=()=>{const db=request.result,tx=db.transaction('sessions','readonly'),read=tx.objectStore('sessions').get(JSON.stringify(['ROLLING_ETHEREUM_SESSION_V1',location.origin,'31337']));tx.oncomplete=()=>{db.close();resolve(read.result);};tx.onerror=()=>reject(Error('session read'));};
    });
    let nonextractable=false;try{await crypto.subtle.exportKey('raw',record.key);}catch{nonextractable=true;}
    return {publicClean:![w.secretKey,w.salt].some(value=>publicText.includes(value)),nonextractable,keyType:record.key.type,ciphertext:record.ciphertext.byteLength>32,rawAbsent:!('secretKey' in record)&&!('salt' in record)};
  });
  assert.deepEqual(custody,{publicClean:true,nonextractable:true,keyType:'secret',ciphertext:true,rawAbsent:true});
  stage='silent-session-reload';await first.page.reload();await readyUser(first.page);
  assert.equal(await first.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  assert.equal(first.counts.signatures,1);
  assert.equal(await first.page.evaluate(()=>BillboardAccount.snapshot().ethereumConnected),false);

  stage='save-disposable-claim';
  const commitment=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,secret=a.Fr.random(),hash=(await a.computeSecretHash(secret)).toString();
    const scope={l1ChainId:'31337',rollupAddress:'0x'+'11'.repeat(20),rollupVersion:'1',boardAddress:'0x'+'0'.repeat(63)+'2',portalAddress:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    await makeClaimSecretStore(w.secretKey,w.salt).save(scope,{schemaVersion:1,secretHash:hash,secret:secret.toString()});
    return hash;
  });
  stage='fresh-profile-signature-rejection';const second=await open();
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec===null),true);
  await second.page.evaluate(()=>window.__rejectSignature=true);
  await second.page.locator('#wbEthBrowserBtn').click();await second.page.getByRole('dialog').getByRole('button',{name:'Browser wallet (legacy)',exact:true}).click();
  await second.page.waitForFunction(()=>!BillboardAccount.snapshot().busy && document.getElementById('wbAccountStatus').textContent==='Wallet request cancelled. Connect again when you are ready.');
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec===null),true);assert.equal(second.counts.signatures,0);
  assert.equal(await second.page.evaluate(async()=>(await BillboardEthereumSession.load({origin:location.origin,chainId:'31337'}))===null),true);
  stage='fresh-profile-same-ethereum-account';await second.page.evaluate(()=>window.__rejectSignature=false);await connect(second.page);
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  assert.equal(await claim(second.page,commitment),null); // Same identity does not copy local private claim data.
  stage='tampered-remembered-session-rejected';
  await second.page.evaluate(async()=>{
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('rolling-ethereum-account-session',1);request.onerror=()=>reject(Error('session database'));
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction('sessions','readwrite'),store=tx.objectStore('sessions'),key=JSON.stringify(['ROLLING_ETHEREUM_SESSION_V1',location.origin,'31337']),read=store.get(key);
        read.onsuccess=()=>{const record=read.result,bytes=new Uint8Array(record.ciphertext);bytes[0]^=1;record.ciphertext=bytes.buffer;store.put(record,key);};
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(Error('session tamper fixture'));
      };
    });
  });
  await second.page.reload();await readyUser(second.page);
  assert.equal(await second.page.evaluate(()=>window.walletState.aztec===null),true);assert.equal(second.counts.signatures,1);
  await second.context.close();

  stage='same-profile-tab-exclusion';
  const other=await first.context.newPage(),otherCounts=await attach(other);await other.goto(origin+'/user.html');await readyUser(other);
  assert.equal(await other.evaluate(()=>window.walletState.aztec.address.toString()),address);assert.equal(otherCounts.signatures,0);
  await first.page.evaluate(()=>{navigator.locks.request('billboard-wallet:'+window.walletState.aztec.address.toString(),async()=>{window._testLockReady=true;await new Promise(resolve=>window._testReleaseLock=resolve);});});
  await first.page.waitForFunction(()=>window._testLockReady);
  const blocked=await other.evaluate(async()=>{
    let called=false,actionBlocked=false,signOutBlocked=false;
    try{await makeCallEngine(async()=>{called=true;})('status','setupStatus',{});}catch{actionBlocked=!called;}
    try{await BillboardAccount.endSession();}catch(error){signOutBlocked=error.code==='BB_OPERATION_BUSY';}
    return {actionBlocked,signOutBlocked};
  });
  assert.deepEqual(blocked,{actionBlocked:true,signOutBlocked:true});await first.page.evaluate(()=>window._testReleaseLock());await other.close();

  stage='journal-before-reload';
  const savedHash=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,tx=a.Tx.random({randomProof:true});
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    const journal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node:{}});
    await journal.prepare(tx,await journal.assertCanStart());return tx.getTxHash().toString();
  });
  const savedReceipt=JSON.parse(jsonStringify(MinedTxReceipt.from({txHash:TxHash.fromString(savedHash),status:'checkpointed',executionResult:'success',transactionFee:0n,blockNumber:1,blockHash:BlockHash.ZERO,slotNumber:1,txIndexInBlock:0,epochNumber:0})));
  const droppedReceipt=JSON.parse(jsonStringify(new DroppedTxReceipt(TxHash.fromString(savedHash))));
  stage='journal-reload-and-silent-session';
  await first.page.reload();await readyUser(first.page);
  assert.equal(await first.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  assert.deepEqual(await claim(first.page,commitment),{hash:commitment,matches:true});
  const recovery=await first.page.evaluate(async({minedReceipt,droppedReceipt})=>{
    const a=window.__aztec,w=window.walletState.aztec,txHash=minedReceipt.txHash;let submissions=0,observed=droppedReceipt,blocked=false;
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    const receiptClient=a.createAztecNodeClient('http://receipt.fixture',{fetch:async(_url,calls)=>({headers:new Headers(),response:calls.map(call=>{
      if(call.method!=='aztec_getTxReceipt'||call.params[0].toString()!==txHash)throw Error('Unexpected recovery request');
      return {jsonrpc:'2.0',id:call.id,result:observed};
    })})});
    const node={getTxReceipt:hash=>receiptClient.getTxReceipt(hash),getBlock:async()=>({hash:minedReceipt.blockHash}),isValidTx:async()=>({result:'valid'}),sendTx:async tx=>{if(tx.getTxHash().toString()!==txHash)throw new Error('identity');submissions++;observed=minedReceipt;}};
    const journal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node});
    try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_RECOVERY_REQUIRED';}
    const receipt=await journal.recover();return {blocked,submissions,sameHash:receipt.txHash.toString()===txHash};
  },{minedReceipt:savedReceipt,droppedReceipt});
  assert.deepEqual(recovery,{blocked:true,submissions:1,sameHash:true});

  stage='ethereum-intent-before-reload';
  const ethereumHash=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec,secretHash=a.Fr.random().toString();
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    const blockHash='0x'+'01'.repeat(32),provider={getNetwork:async()=>({chainId:31337n}),getBlock:async()=>({number:1,hash:blockHash}),getTransactionCount:async()=>5,estimateGas:async()=>100000n};
    let signingAttempts=0;
    const signer={getAddress:async()=>scope.depositor,sendTransaction:async request=>{signingAttempts++;if(request.gasLimit!==200000n)throw Error('deposit gas allowance');throw new Error('synthetic lost signing response');}};
    const journal=await a.createEthereumJournal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,provider,signer});
    const iface=new ethers.Interface(['function deposit(bytes32) payable']);
    try{await journal.send({data:iface.encodeFunctionData('deposit',[secretHash]),value:'100',expected:{kind:'deposit',amount:'100',secretHash}});}catch(e){if(e.code!=='BB_ETH_SUBMISSION_UNKNOWN')throw e;}
    if(signingAttempts!==1)throw Error('Signing was not reached');
    return secretHash;
  });
  stage='ethereum-intent-reload';await first.page.reload();await readyUser(first.page);
  assert.equal(await first.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  assert.equal(first.counts.signatures,1);
  const ethRecovered=await first.page.evaluate(async secretHash=>{
    const a=window.__aztec,w=window.walletState.aztec,scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20),depositor:'0x'+'33'.repeat(20)};
    const blockHash='0x'+'01'.repeat(32),txHash='0x'+'04'.repeat(32);let tx=null,receipt=null,nonce=null,submissions=0;
    const iface=new ethers.Interface(['function deposit(bytes32) payable','event Deposited(address indexed depositor,uint128 amount,bytes32 secretHash,bytes32 key,uint256 index)']);
    const provider={getNetwork:async()=>({chainId:31337n}),getBlockNumber:async()=>1,getTransactionCount:async()=>tx?6:5,getBlock:async()=>({number:1,hash:blockHash}),getTransaction:async()=>tx,getTransactionReceipt:async()=>receipt,estimateGas:async()=>100000n};
    const signer={getAddress:async()=>scope.depositor,sendTransaction:async request=>{
      if(request.data!==iface.encodeFunctionData('deposit',[secretHash])||request.value!==100n||request.gasLimit!==200000n)throw new Error('payment changed');
      submissions++;nonce=request.nonce;tx={...request,hash:txHash};receipt={hash:txHash,from:scope.depositor,to:scope.portal,status:1,blockNumber:1,blockHash,logs:[{address:scope.portal,...iface.encodeEventLog(iface.getEvent('Deposited'),[scope.depositor,100,secretHash,secretHash,0])}]};return tx;
    }};
    const journal=await a.createEthereumJournal({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt,scope,provider,signer});
    let blocked=false;try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_ETH_RECOVERY_REQUIRED';}
    const result=await journal.recover({retry:true});return {blocked,submissions,nonce,outcome:result.outcome};
  },ethereumHash);
  assert.deepEqual(ethRecovered,{blocked:true,submissions:1,nonce:5,outcome:'success'});

  stage='export-authenticated-journal-ciphertext';
  const portable=await first.page.evaluate(async()=>{
    const a=window.__aztec,w=window.walletState.aztec;
    const records=await (await a.createJournalBackup({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt})).exportRecords();
    const json=JSON.stringify(records);if(json.includes(w.secretKey)||json.includes(w.salt))throw Error('Plaintext custody in journal transport');return json;
  });
  assert.equal(JSON.parse(portable).length,2);
  await first.context.close();
  stage='foreign-owner-journal-rejected';const foreign=await open('user.html',Wallet.createRandom());await connect(foreign.page);
  assert.notEqual(await foreign.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  assert.equal(await foreign.page.evaluate(async json=>{
    const a=window.__aztec,w=window.walletState.aztec,storage=a.createBrowserJournalStorage();
    try{await (await a.createJournalBackup({storage,walletSecret:w.secretKey,walletSalt:w.salt})).restoreRecords(JSON.parse(json));return false;}
    catch(error){return error.code==='BB_JOURNAL_INVALID'&&(await storage.keys()).length===0;}
  },portable),true);await foreign.context.close();
  stage='restore-journals-fresh-profile';const third=await open('censor.html');await connect(third.page);
  assert.equal(await third.page.evaluate(()=>window.walletState.aztec.address.toString()),address);
  await third.page.evaluate(async json=>{const a=window.__aztec,w=window.walletState.aztec;await (await a.createJournalBackup({storage:a.createBrowserJournalStorage(),walletSecret:w.secretKey,walletSalt:w.salt})).restoreRecords(JSON.parse(json));},portable);
  const portableResult=await third.page.evaluate(async receipt=>{
    const a=window.__aztec,w=window.walletState.aztec,storage=a.createBrowserJournalStorage();
    const records=await (await a.createJournalBackup({storage,walletSecret:w.secretKey,walletSalt:w.salt})).exportRecords();
    const scope={account:w.address.toString(),chainId:'31337',rollup:'0x'+'11'.repeat(20),version:'5',board:'0x'+'0'.repeat(63)+'2',portal:'0x'+'22'.repeat(20)};
    // Decode actual SDK wire data; this component fixture never makes a network request.
    const receiptClient=a.createAztecNodeClient('http://receipt.fixture',{fetch:async(_url,calls)=>({headers:new Headers(),response:calls.map(call=>{
      if(call.method!=='aztec_getTxReceipt'||call.params[0].toString()!==receipt.txHash)throw Error('Unexpected recovery request');
      return {jsonrpc:'2.0',id:call.id,result:receipt};
    })})});
    const node={getTxReceipt:hash=>receiptClient.getTxReceipt(hash),getBlock:async()=>({hash:receipt.blockHash})};
    const journal=await a.createL2Journal({storage,walletSecret:w.secretKey,walletSalt:w.salt,scope,Tx:a.Tx,node});
    let blocked=false;try{await journal.assertCanStart();}catch(e){blocked=e.code==='BB_RECOVERY_REQUIRED';}
    return {count:records.length,blocked,hash:(await journal.recover()).txHash.toString()};
  },savedReceipt);
  assert.deepEqual(portableResult,{count:2,blocked:true,hash:savedHash});
  assert.equal(await claim(third.page,commitment),null);
  assert.equal(await third.page.getByRole('button',{name:'Check saved action',includeHidden:true}).count(),1);
  await third.context.close();

  stage='deployment-resume-ui';const deploy=await open('deploy.html');
  await connect(deploy.page);
  const deployResult=await deploy.page.evaluate(async()=>{
    let calls=0;
    window.runDeploy=async()=>{calls++;return{status:'pending-settlement',l2Addr:'0x'+'2'.padStart(64,'0'),portalAddr:'0x'+'22'.repeat(20),readyTxHash:'0x'+'44'.repeat(32)};};
    const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
    document.getElementById('deploymentManifest').value=JSON.stringify({schemaVersion:1,profile:'local-test',network:{nodeUrl:'http://localhost:8080/',ethRpcUrl:'http://localhost:8545/',chainId:'31337',rollupVersion:'5',rollup:'0x'+'33'.repeat(20),inbox:'0x'+'66'.repeat(20),outbox:'0x'+'77'.repeat(20)},actors:{aztecDeployer:window.walletState.aztec.address.toString(),ethereumDeployer:'0x'+'44'.repeat(20)},board:{salt:'1',minDeposit:'1',maxDeposit:'100',baseCooldown:'10',kMultiplier:'64',censorWindow:'10',maxSaveUp:'16',censor:word(1),policy:'Be kind.'},artifacts:{boardJsonSha256:word(1),boardClassId:word(2),portalCreationSha256:word(3),portalRuntimeMetadataSha256:word(4)}});
    await importDeploymentManifest({files:[{size:10000,text:async()=>document.getElementById('deploymentManifest').value}]});
    await startDeploy();
    const pending=document.getElementById('status').textContent.includes('Activation is waiting for network settlement');
    const hashSaved=document.getElementById('readyTxHash').value==='0x'+'44'.repeat(32);
    const noReadyLink=document.getElementById('postBoard').hidden;
    let release;const held=navigator.locks.request('billboard-wallet:'+window.walletState.aztec.address.toString(),async()=>{
      await new Promise(resolve=>release=resolve);
    });
    while(!release)await new Promise(resolve=>setTimeout(resolve,0));
    try{await startDeploy();}finally{release();await held;}
    return{pending,hashSaved,noReadyLink,calls};
  });
  assert.deepEqual(deployResult,{pending:true,hashSaved:true,noReadyLink:true,calls:1});

  stage='sign-out-clears-session';
  await deploy.page.locator('#wbAccountMenu > summary').click();
  await Promise.all([deploy.page.waitForEvent('load'),deploy.page.locator('#wbLockBtn').click()]);await readyUser(deploy.page);
  assert.equal(await deploy.page.evaluate(()=>window.walletState.aztec===null),true);
  assert.equal(await deploy.page.evaluate(async()=>(await BillboardEthereumSession.load({origin:location.origin,chainId:'31337'}))===null),true);
  const signatures=deploy.counts.signatures;await connect(deploy.page);
  assert.equal(await deploy.page.evaluate(()=>window.walletState.aztec.address.toString()),address);assert.equal(deploy.counts.signatures,signatures+1);
  await deploy.context.close();
  console.log(JSON.stringify({passed:true,actualBuiltBrowser:true,freshProfiles:5,maximumConcurrentProfiles:2,deploymentPendingUiAndWalletLock:true,actualPortableJournalRestore:true,rejectedSignatureLeavesNoSession:true,nonextractableRememberedSession:true,tamperedRememberedSessionRejected:true,sameSignatureDerivedAddress:true,claimReloadCommitmentVerified:true,freshProfileClaimsIsolated:true,foreignWalletJournalRejected:true,signOutRequiresNewSignature:true,actualCrossTabExclusion:true,actualJournalReloadRecovery:true,actualEthereumIntentReloadRecovery:true,externalRequestsBlocked:externalRequests,secretsWrittenToEvidence:false}));
}catch(error){console.log(JSON.stringify({passed:false,stage,errorClass:error.name,location:error.stack?.split('\n').filter(l=>l.trim().startsWith('at ')).slice(0,2)}));process.exitCode=1;}
finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
