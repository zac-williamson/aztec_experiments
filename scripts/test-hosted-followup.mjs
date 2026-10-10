// Explicit live phases. No automatic retries, additional funding, or simulated finality.
import assert from 'node:assert/strict';
import {setHostedTestGas,verifyHostedPayment} from './hosted-test-gas.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Contract,Interface,parseUnits,formatUnits} from 'ethers';
import {createPublicClient,http} from 'viem';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {TxHash} from '@aztec-labs/stdlib/tx';
import {openHostedAccount,canonicalReceipt,readJson} from './hosted-existing-account.mjs';
import {journeyExitLeaf,verifyJourneyRefund} from './t04-browser-journey-verify.mjs';
import {outboxArguments} from '../plugins/operations.mjs';
import {ROOT} from './toolchain.mjs';
import {hostedAuthorPostDeadlines} from './hosted-post-deadlines.mjs';
const options={};for(const arg of process.argv.slice(2)){if(arg==='--inspect-wallet'){options.inspectWallet=true;continue;}const m=arg.match(/^--(run|phase|site-config|service-config|max-fee-gwei|priority-fee-gwei|request-report)=(.+)$/);assert(m&&!Object.hasOwn(options,m[1]));options[m[1]]=m[2];}
assert(!!options['max-fee-gwei']===!!options['priority-fee-gwei']);
const {run,phase}=options;assert(/^[a-z0-9-]+$/.test(run));
assert(phase==='plugin-reply-withdraw'?['plugin-claim-post.json','plugin-request.json'].includes(options['request-report']):options['request-report']===undefined);
const directory=path.join(ROOT,'.build/hosted-'+run),filename=path.join(directory,phase+'.json');
const previous=await readJson(filename).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
assert(!previous||previous.awaiting||phase==='withdrawal-plan','Inspect the previous phase before any repeated action');
const report={phase,passed:false,startedAt:new Date().toISOString(),stages:[]};let session,stage='start';
const mark=s=>{stage=s;report.stages.push({stage,at:new Date().toISOString()});console.log(JSON.stringify({stage}));};
const save=()=>fs.writeFile(filename,JSON.stringify(report,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n',{mode:0o600});
await save();
try{
 session=await openHostedAccount({run,siteConfig:path.resolve(ROOT,options['site-config']),mark});
 const {page,walletPage,node,provider,identity,onboarding,config}=session;
 const nonceBefore=await provider.getTransactionCount(identity.address,'latest');assert.equal(await provider.getTransactionCount(identity.address,'pending'),nonceBefore);report.ethereumNonceBefore=nonceBefore;
 const activity=await page.evaluate(()=>application.readActivity());assert(!activity.some(x=>x.status==='pending'),'Reconcile the existing transaction before starting another phase');
 const waitOperation=async action=>{await page.waitForFunction(action=>application.operation().action===action&&['complete','failed','cancelled','paused'].includes(application.operation().status),action,{timeout:500000});const result=await page.evaluate(()=>application.operation());assert.equal(result.status,'complete');return result.result;};
 const approve=async validate=>{await page.waitForFunction(()=>Array.isArray(globalThis.__walletTestPending),{},{timeout:180000});const pending=await page.evaluate(()=>__walletTestPending);assert.equal(pending.length,1);const request=pending[0];assert.equal(request.from.toLowerCase(),identity.address.toLowerCase());assert.equal(await page.evaluate(()=>__testMetaMask.request({method:'eth_chainId'})),'0xaa36a7');validate(request);await walletPage.getByTestId('parent-selector-confirmation-page').waitFor();if(options.inspectWallet){if(!await walletPage.getByTestId('advanced-details-displayed-nonce').isVisible())await walletPage.getByTestId('header-advanced-details-button').click();try{await walletPage.getByTestId('advanced-details-displayed-nonce').waitFor({timeout:60000});}finally{report.walletPublicDetails=await walletPage.locator('body').innerText();await save();}await walletPage.screenshot({path:path.join(directory,phase+'-wallet.png')});throw Object.assign(Error('Wallet inspection; no approval submitted'),{code:'BB_TEST_WALLET_INSPECTION'});}if(options['max-fee-gwei']){const functionName=phase==='refund'||phase==='plugin-redeem'?'withdraw':request.data.startsWith('0x095ea7b3')?'approve':'deposit';report.walletFees??=[];report.walletFees.push(await setHostedTestGas({page,walletPage,provider,request,maxFeeGwei:options['max-fee-gwei'],priorityFeeGwei:options['priority-fee-gwei'],functionName}));}await walletPage.getByTestId('confirm-footer-button').click();await page.waitForFunction(data=>__walletTestPending?.[0]?.data!==data,request.data,{timeout:180000});report.ethereumPayments??=[];report.ethereumPayments.push(await verifyHostedPayment({page,provider,request,fees:report.walletFees?.at(-1),amount:report.expectedRefundAmount}));await save();return request;};
 if(['withdrawal-plan','withdraw','refund'].includes(phase)){
  const portalJson=await readJson(path.join(ROOT,'billboard/portal/out/BillboardPortal.sol/BillboardPortal.json'));
  const portal=new Contract(config.board.portalAddress,portalJson.abi,provider),amount=await portal.getDeposit(identity.address);assert(amount>0n);
  if(phase!=='refund'){
   const plan=await page.evaluate(async()=>JSON.parse(JSON.stringify(await application.readWithdrawalPlan(),(_,v)=>typeof v==='bigint'?String(v):v)));report.plan=plan;
   const fixture=await readJson(path.join(directory,'moderation-post.json'));assert.equal(fixture.phase,'moderation-post');assert(Number.isSafeInteger(fixture.flagDeadline)&&fixture.flagDeadline>0);
   const reports=[fixture];for(const name of ['plugin-claim-post.json','plugin-request.json']){
    const saved=await readJson(path.join(directory,name)).catch(e=>{if(e.code!=='ENOENT')throw e;return undefined;});
    if(saved!==undefined){assert(saved&&typeof saved==='object');assert.equal(saved.phase,name.slice(0,-5));reports.push(saved);}
   }
   const feed=await page.evaluate(()=>application.readFeed());report.authorPostDeadlines=hostedAuthorPostDeadlines({onboarding,reports,posts:feed.posts});
   report.moderationFixtureDeadline=fixture.flagDeadline;report.readyAt=Math.max(plan.readyAt,...report.authorPostDeadlines.map(p=>p.flagDeadline));
   if(report.readyAt>plan.chainTime){report.awaiting='moderation-period';}
   else if(phase==='withdrawal-plan')report.passed=true;
   else{
    mark('screen-and-withdraw');await page.locator('#wbAccountMenu > summary').click();await page.getByRole('button',{name:'Balance & activity',exact:true}).click();await page.locator('#withdrawStart').click();await page.locator('#withdrawConfirm').click();
    await page.waitForFunction(()=>application.operation().stage==='settlement'||['failed','cancelled'].includes(application.operation().status),{},{timeout:500000});assert.equal(await page.evaluate(()=>application.operation().stage),'settlement');
    await page.getByRole('button',{name:'Pause and continue later',exact:true}).click();await page.waitForFunction(()=>application.operation().status==='paused');
    const exit=(await page.evaluate(()=>application.readActivity())).find(x=>x.layer==='aztec'&&x.kind==='withdraw'&&x.status==='confirmed');assert(exit);report.exit=await canonicalReceipt(node,exit.txHash);await save();
    const scope={l1ChainId:config.network.chainId,rollupVersion:config.network.rollupVersion,boardAddress:config.board.contractAddress,portalAddress:config.board.portalAddress};const {leaf}=journeyExitLeaf({scope,depositor:identity.address,amount});
    const effect=await node.getTxEffect(TxHash.fromString(exit.txHash));assert.equal(effect.data.l2ToL1Msgs.filter(x=>x.equals(leaf)).length,1);report.exitLeaf=leaf.toString();report.amount=String(amount);
    assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore);assert.equal(await portal.getDeposit(identity.address),amount);report.passed=true;
   }
  }else{
   const withdrawal=await readJson(path.join(directory,'withdraw.json'));assert(withdrawal.passed);assert.equal(String(amount),withdrawal.amount);
   const receipt=await node.getTxReceipt(TxHash.fromString(withdrawal.exit.hash));
   if(receipt.status!=='finalized'){report.awaiting='network-finality';report.exitStatus=receipt.status;}
   else{
    const args=await outboxArguments(node,TxHash.fromString(withdrawal.exit.hash));await portal.withdraw.staticCall(...args,{from:identity.address});
    const before={liability:await portal.totalDeposited(),portalBalance:await provider.getBalance(config.board.portalAddress),depositorBalance:await provider.getBalance(identity.address)};
    report.expectedRefundAmount=String(amount);mark('redeem-board-deposit');await page.locator('#withdrawConfirm').click();const expected=portal.interface.encodeFunctionData('withdraw',args);
    report.walletRequest=await approve(request=>{assert.equal(request.to.toLowerCase(),config.board.portalAddress.toLowerCase());assert.equal(request.data,expected);assert.equal(BigInt(request.value??0),0n);});
    const result=await waitOperation('withdrawal');report.refund=await verifyJourneyRefund({l1Client:createPublicClient({transport:http(config.network.ethRpcUrl)}),portalAbi:portalJson.abi,portalAddress:config.board.portalAddress,depositor:identity.address,amount,txHash:result.lastEthereumTxHash,before});await save();
    await assert.rejects(portal.withdraw.staticCall(...args,{from:identity.address}),e=>e.code==='CALL_EXCEPTION'&&e.reason==='No active deposit');assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore+1);report.replayRejected=true;report.passed=true;
   }
  }
 }else if(phase==='moderation-post'){
  report.message="I will not argue with you at tonight's meeting. I will wait outside afterward and punch you in the face.";
  mark('post-moderation-test-fixture');await page.locator('#composer').waitFor({state:'visible'});await page.locator('#msgText').fill(report.message);await page.locator('#postBtn').click();
  const post=await waitOperation('post');report.postId=post.postId;report.post=await canonicalReceipt(node,post.lastL2TxHash);await save();
  const feed=await page.evaluate(()=>application.readFeed());const published=feed.posts.find(p=>p.postId===report.postId);assert(published);assert.equal(published.text,report.message);report.publication=published;report.flagDeadline=Number(published.flagDeadline);assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore);report.passed=true;
 }else{
  const service=await readJson(path.resolve(ROOT,options['service-config'])),descriptor=service.descriptor;assert.equal(descriptor.scope.boardAddress,config.board.contractAddress);
  const token=new Contract(descriptor.funding.tokenAddress,['function balanceOf(address) view returns(uint256)','function approve(address,uint256)'],provider),portalJson=await readJson(path.join(ROOT,'billboard/portal/out/PluginPortal.sol/PluginPortal.json')),portal=new Contract(descriptor.funding.portalAddress,portalJson.abi,provider);
  const key='plugin-account:'+descriptor.scope.receiver+':'+descriptor.scope.chainId+':'+descriptor.scope.rollupAddress+':'+descriptor.scope.rollupVersion+':'+onboarding.aztecAccount;
  const saved=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),key);
  const action=async(name,approval)=>{await page.locator('#plugin'+name).click();if(approval)await approval();await page.waitForFunction(()=>!!document.getElementById('pluginStatus').dataset.outcome,{},{timeout:500000});assert.equal(await page.locator('#pluginStatus').getAttribute('data-outcome'),'success',await page.locator('#pluginStatus').innerText());assert.equal(await page.evaluate(()=>application.operation().status),'complete');return page.evaluate(()=>application.operation().result);};
  const balance=async()=>parseUnits((await page.evaluate(()=>application.pluginAccount('balance',{handle:'bok'}))).balance,6);
  await page.locator('#composer').waitFor({state:'visible'});await page.locator('#pluginAccountPanel summary').click();await page.locator('#pluginHandle').fill('bok');
  if(phase==='plugin-deposit'){
   assert(!(await saved())?.deposit);const before=await token.balanceOf(identity.address);assert(before>=1000000n,'Fund the disposable test wallet with free test USDC first');assert.equal(await balance(),0n);await page.locator('#pluginAmount').fill('1');
   mark('deposit-one-test-usdc');await action('Deposit',async()=>{await approve(r=>{assert.equal(r.to.toLowerCase(),descriptor.funding.tokenAddress.toLowerCase());assert.equal(r.data,token.interface.encodeFunctionData('approve',[descriptor.funding.portalAddress,1000000n]));assert.equal(BigInt(r.value??0),0n);});await approve(r=>{assert.equal(r.to.toLowerCase(),descriptor.funding.portalAddress.toLowerCase());const decoded=portal.interface.parseTransaction({data:r.data});assert.equal(decoded.name,'deposit');assert.equal(decoded.args.account,onboarding.aztecAccount);assert.equal(decoded.args.amount,1000000n);assert.equal(BigInt(r.value??0),0n);});});
   const record=(await saved()).deposit,receipt=await provider.getTransactionReceipt(record.txHash);assert.equal(receipt.status,1);const events=receipt.logs.filter(l=>l.address.toLowerCase()===descriptor.funding.portalAddress.toLowerCase()).map(l=>{try{return portal.interface.parseLog(l);}catch{return null;}}).filter(e=>e?.name==='Deposited');assert.equal(events.length,1);assert.equal(events[0].args.account,onboarding.aztecAccount);assert.equal(events[0].args.amount,1000000n);assert.equal(await token.balanceOf(identity.address),before-1000000n);assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore+2);
   report.deposit={txHash:record.txHash,key:record.key,leafIndex:record.leafIndex,amount:record.amount};report.tokenBalanceBefore=String(before);report.passed=true;await save();
  }else if(phase==='plugin-claim-post'){
   const deposit=await readJson(path.join(directory,'plugin-deposit.json'));assert(deposit.passed);const witness=await node.getL1ToL2MessageMembershipWitness(await node.getBlockNumber(),Fr.fromString(deposit.deposit.key));
   if(!witness)report.awaiting='inbox';else{
    mark('claim-plugin-credit');const claim=await action('Claim');report.claim=await canonicalReceipt(node,claim.lastL2TxHash);await save();assert.equal(await balance(),1000000n);await page.evaluate(()=>application.readActivity());
    report.prompt='@bok Reply with exactly: V6 testnet plugin works. Do not use tools, add formatting, or create a pull request.';mark('post-plugin-request');await page.locator('#msgText').fill(report.prompt);await page.locator('#postBtn').click();const post=await waitOperation('post');report.postId=post.postId;report.post=await canonicalReceipt(node,post.lastL2TxHash);await save();assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore);report.passed=true;
   }
  }else if(phase==='plugin-request'){
   const prior=await readJson(path.join(directory,'plugin-claim-post.json'));assert(prior.passed&&prior.phase==='plugin-claim-post');
   const requests=await page.evaluate(()=>application.pluginAccount('requests',{handle:'bok'})),old=requests.requests.find(x=>x.postId===prior.postId);
   assert(old);assert.equal(old.state,6);assert.equal(old.charged,'0');assert.equal(old.reserved,'0');assert.equal(await balance(),1000000n);report.previousInvocation=old;
   report.prompt='@bok Reply with exactly: V6 testnet plugin works. Do not use tools, add formatting, or create a pull request.';
   mark('post-new-plugin-request');await page.locator('#msgText').fill(report.prompt);await page.locator('#postBtn').click();const post=await waitOperation('post');report.postId=post.postId;assert.notEqual(report.postId,prior.postId);report.post=await canonicalReceipt(node,post.lastL2TxHash);await save();assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore);report.passed=true;
  }else if(phase==='plugin-reply-withdraw'){
   report.requestReport=options['request-report'];const request=await readJson(path.join(directory,report.requestReport));assert(request.passed&&request.phase===report.requestReport.slice(0,-5));assert.match(request.postId,/^0x[0-9a-f]{64}$/);const requests=await page.evaluate(()=>application.pluginAccount('requests',{handle:'bok'}));const invocation=requests.requests.find(x=>x.postId===request.postId);assert(invocation);report.invocation=invocation;
   if(invocation.state!==3){assert([1,2].includes(invocation.state),'Plugin stopped without a reply');report.awaiting='plugin-reply';}else{
    assert.equal(invocation.reserved,'0');assert(BigInt(invocation.charged)>0n);const available=await balance();assert.equal(available+BigInt(invocation.charged),1000000n);
    const feed=await page.evaluate(()=>application.readFeed());const reply=feed.posts.find(p=>p.pluginReply?.parentId===request.postId);assert(reply&&!reply.flagged);assert.equal(reply.text,'V6 testnet plugin works.');report.reply={postId:reply.postId,text:reply.text};
    await page.waitForFunction(id=>document.querySelector('article[data-post-id="'+id+'"]')||!document.getElementById('newMessages').hidden,reply.postId);if(!await page.locator('article[data-post-id="'+reply.postId+'"]').count())await page.locator('#newMessages').click();assert.equal(await page.locator('article[data-post-id="'+reply.postId+'"] .message-text').innerText(),reply.text);
    mark('withdraw-unused-plugin-credit');await page.evaluate(()=>application.readActivity());await page.locator('#pluginAmount').fill(formatUnits(available,6));const result=await action('Withdraw');const record=(await saved()).withdrawal;report.withdrawal={amount:record.amount,recipient:record.recipient,nonce:record.nonce,txHash:record.txHash};report.receipt=await canonicalReceipt(node,result.lastL2TxHash);await save();assert.equal(await balance(),0n);assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore);report.passed=true;
   }
  }else if(phase==='plugin-redeem'){
   const prior=await readJson(path.join(directory,'plugin-reply-withdraw.json'));assert(prior.passed);const record=prior.withdrawal,receipt=await node.getTxReceipt(TxHash.fromString(record.txHash));
   if(receipt.status!=='finalized')report.awaiting='network-finality';else{
    const args=[record.recipient,BigInt(record.amount),record.nonce,...await outboxArguments(node,TxHash.fromString(record.txHash))];await portal.withdraw.staticCall(...args,{from:identity.address});const before=await token.balanceOf(identity.address),expected=portal.interface.encodeFunctionData('withdraw',args);let request;
    mark('redeem-unused-plugin-credit');await action('Redeem',async()=>{request=await approve(r=>{assert.equal(r.to.toLowerCase(),descriptor.funding.portalAddress.toLowerCase());assert.equal(r.data,expected);assert.equal(BigInt(r.value??0),0n);});});assert.equal(await token.balanceOf(identity.address),before+BigInt(record.amount));assert.equal((await saved()).withdrawal,null);assert.equal(await provider.getTransactionCount(identity.address,'latest'),nonceBefore+1);const replayError=new Interface(['error Outbox__AlreadyNullified(uint256 epoch,uint256 leafIndex)']);await assert.rejects(portal.withdraw.staticCall(...args,{from:identity.address}),e=>e.code==='CALL_EXCEPTION'&&!!e.data&&replayError.parseError(e.data)?.name==='Outbox__AlreadyNullified');report.amount=record.amount;report.replayRejected=true;report.passed=true;await save();
   }
  }else throw Error('Unknown phase');
 }
 report.ethereumNonceAfter=await provider.getTransactionCount(identity.address,'latest');assert.equal(await provider.getTransactionCount(identity.address,'pending'),report.ethereumNonceAfter);mark(report.awaiting?'awaiting-'+report.awaiting:'phase-complete');
}catch(error){report.passed=false;delete report.awaiting;report.failure={stage,name:error?.name,code:typeof error?.code==='string'?error.code:null,assertion:error?.code==='ERR_ASSERTION'?error.message:undefined,frames:String(error?.stack).split('\n').filter(x=>x.includes('test-hosted-followup.mjs:')||x.includes('hosted-existing-account.mjs:')||x.includes('hosted-test-gas.mjs:'))};if(session)report.ui=await session.page.evaluate(()=>({operation:application.operation(),diagnostic:application.diagnosticReport(),pluginStatus:document.getElementById('pluginStatus')?.textContent})).catch(()=>null);process.exitCode=1;}
finally{await session?.close();report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({phase,passed:report.passed,awaiting:report.awaiting,failure:report.failure}));}
