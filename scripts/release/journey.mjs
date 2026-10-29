// Real-testnet acceptance only. UI actions use the production wallet/runtime;
// the injected EIP-1193 provider owns fresh, disposable Sepolia-only keys.
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {failure} from './bundle.mjs';
import {runtimeIdentity} from './compatibility.mjs';
import {openChainEvidence} from './evidence.mjs';
export function validateJourneyConfig(value){
 const allowed=['stagingOrigin','liveOrigin','ethereumRpc','testFunderKey','ethPerAccountWei','usdcPerAccount','timeoutMs','testOnly'];
 if(!value||Object.keys(value).sort().join()!==allowed.sort().join()||value.testOnly!==true)throw failure('RELEASE_FIXTURE_CONFIG');
 for(const key of ['stagingOrigin','liveOrigin']){const u=new URL(value[key]);if(u.origin!==value[key]||u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw failure('RELEASE_FIXTURE_CONFIG');}
 if(value.stagingOrigin===value.liveOrigin||!/^0x[0-9a-fA-F]{64}$/.test(value.testFunderKey)||!/^\d+$/.test(value.ethPerAccountWei)||BigInt(value.ethPerAccountWei)>5n*10n**17n||BigInt(value.ethPerAccountWei)<=0n||!/^\d+$/.test(value.usdcPerAccount)||BigInt(value.usdcPerAccount)>100000000n||BigInt(value.usdcPerAccount)<=0n||!Number.isInteger(value.timeoutMs)||value.timeoutMs<1000||value.timeoutMs>540000)throw failure('RELEASE_FIXTURE_CONFIG');
 const rpc=new URL(value.ethereumRpc);if(rpc.protocol!=='https:'&&!(rpc.protocol==='http:'&&rpc.hostname==='127.0.0.1'))throw failure('RELEASE_FIXTURE_CONFIG');
 return value;
}
export async function readJourneyConfig(file){const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>16384)throw failure('RELEASE_FIXTURE_PERMISSIONS');return validateJourneyConfig(JSON.parse(await fs.readFile(file,'utf8')));}
export function installTestProvider(){
 const listeners=new Map(),provider={isMetaMask:true,isConnected:()=>true,
  request:async request=>{const answer=await globalThis.__rollingReleaseWallet(request);if(answer.error)throw Object.assign(new Error('Test wallet request failed'),{code:answer.code});return answer.result;},
  on:(event,fn)=>{if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(fn);return provider;},
  removeListener:(event,fn)=>{listeners.get(event)?.delete(fn);return provider;}};
 Object.defineProperty(window,'ethereum',{value:provider,configurable:false});
 const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'6f6d2480-cc33-4bb6-98ea-0602ab0d8860',name:'CI test wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'chat.rolling.ci'},provider}}));
 window.addEventListener('eip6963:requestProvider',announce);announce();
}
const readMethods=new Set(['eth_chainId','eth_blockNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_maxPriorityFeePerGas','eth_feeHistory','eth_getTransactionCount','eth_getTransactionReceipt','eth_getBlockByNumber','eth_getTransactionByHash']);
export async function createTestWalletBridge({wallet,provider,allowedTargets,capWei,getBytes}){
 let spent=0n;
 return async({method,params=[]})=>{
  if(!Array.isArray(params)||typeof method!=='string')throw failure('RELEASE_WALLET_REQUEST');
  if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet.address];
  if(method==='wallet_switchEthereumChain'){if(BigInt(params[0]?.chainId??0)!==11155111n)throw failure('RELEASE_NETWORK');return null;}
  if(method==='wallet_requestPermissions')return [{parentCapability:'eth_accounts'}];
  if(method==='personal_sign'){
   const [message,address]=params;if(address?.toLowerCase()!==wallet.address.toLowerCase()||typeof message!=='string'||message.length>16384)throw failure('RELEASE_WALLET_REQUEST');return wallet.signMessage(getBytes(message));
  }
  if(method==='eth_signTypedData_v4'){
   if(params[0]?.toLowerCase()!==wallet.address.toLowerCase())throw failure('RELEASE_WALLET_REQUEST');const typed=JSON.parse(params[1]);
   if(BigInt(typed.domain?.chainId??0)!==11155111n||!allowedTargets.has(typed.domain?.verifyingContract?.toLowerCase()))throw failure('RELEASE_NETWORK');
   const types={...typed.types};delete types.EIP712Domain;return wallet.signTypedData(typed.domain,types,typed.message);
  }
  if(method==='eth_sendTransaction'){
   const tx={...params[0]};if(tx.from?.toLowerCase()!==wallet.address.toLowerCase()||!allowedTargets.has(tx.to?.toLowerCase())||tx.chainId!==undefined&&BigInt(tx.chainId)!==11155111n)throw failure('RELEASE_WALLET_REQUEST');
   delete tx.from;if(tx.gas!==undefined){tx.gasLimit=tx.gas;delete tx.gas;}tx.chainId=11155111;
   const populated=tx.gasLimit===undefined||tx.maxFeePerGas===undefined&&tx.gasPrice===undefined?await wallet.populateTransaction(tx):tx;
   const cost=BigInt(populated.value??0)+BigInt(populated.gasLimit)*BigInt(populated.maxFeePerGas??populated.gasPrice);if(spent+cost>capWei)throw failure('RELEASE_FIXTURE_SPEND_LIMIT');spent+=cost;
   return (await wallet.sendTransaction(populated)).hash;
  }
  if(readMethods.has(method))return provider.send(method,params);
  throw failure('RELEASE_WALLET_METHOD');
 };
}
// These helpers operate the actual modal, including after account restoration.
// Direct post/reply/Bok submission has one button; there is no second confirmation.
export const journeyFailureSteps=Object.freeze(['setup','fund-ETH','fund-USDC','signup-ETH','signup-USDC','close-account','post-compose','post-submit','post-inclusion','reply-compose','reply-submit','reply-inclusion','like','reload','bok-compose','bok-credit','bok-submit','bok-inclusion','bok-reply','final-check']);
const actionTimeout=remaining=>Math.min(90000,remaining());
// Inclusion can reveal a post before the panel finishes its local operation.
// Its existing busy signal, even while hidden, owns readiness for the next action.
export async function waitForJourneyAccountIdle(page,remaining){
 await page.locator('dialog.account-dialog[aria-busy="false"]').waitFor({state:'attached',timeout:actionTimeout(remaining)});
}
export async function closeJourneyAccountPanel(page,remaining){
 await waitForJourneyAccountIdle(page,remaining);
 const dialog=page.locator('dialog.account-dialog');
 if(await dialog.isVisible()){
  await dialog.getByRole('button',{name:'Close account panel',exact:true}).click({timeout:actionTimeout(remaining)});
  await dialog.waitFor({state:'hidden',timeout:actionTimeout(remaining)});
 }
}
export async function openJourneyMainBoard(page,remaining){
 await page.locator('nav[aria-label="Community"]').getByRole('link',{name:'Main board',exact:true}).click({timeout:actionTimeout(remaining)});
 await page.waitForURL('**/#/board/0',{timeout:actionTimeout(remaining)});
 await page.locator('[data-board-compose]').waitFor({state:'visible',timeout:actionTimeout(remaining)});
}
export function journeyPostCard(page,id){
 if(typeof id!=='string'||!/^post-[1-9][0-9]{0,76}$/.test(id))throw failure('RELEASE_INCLUSION');
 return page.locator('article.post#'+id);
}
export async function waitForJourneyPost(page,message,remaining){
 // The hidden composer preview can retain this exact text after inclusion.
 // Observe the published card, then retain its canonical ID across rerenders.
 const card=page.locator('article.post').filter({has:page.getByText(message,{exact:true})}).first();
 await card.waitFor({timeout:remaining()});
 const receipt=await card.evaluate(el=>({hash:el.dataset.txHash,block:el.dataset.blockNumber,blockHash:el.dataset.blockHash,id:el.id}));
 if(!/^0x[0-9a-f]{64}$/.test(receipt.hash??'')||!/^0x[0-9a-f]{64}$/.test(receipt.blockHash??'')||!(Number(receipt.block)>0))throw failure('RELEASE_INCLUSION');
 return {card:journeyPostCard(page,receipt.id),receipt};
}
export async function openJourneyComposer(page,message,remaining){
 await closeJourneyAccountPanel(page,remaining);
 await page.getByRole('button',{name:'Write a post',exact:true}).first().click({timeout:actionTimeout(remaining)});
 const dialog=page.locator('dialog.account-dialog'),editor=dialog.getByLabel('Message',{exact:true}),connect=dialog.getByRole('button',{name:'Connect CI test wallet',exact:true});
 await dialog.waitFor({state:'visible',timeout:actionTimeout(remaining)});
 // A restored account opens the editor immediately; a locked account requires
 // the explicit wallet click before the same draft becomes available.
 await editor.or(connect).first().waitFor({state:'visible',timeout:actionTimeout(remaining)});
 if(await connect.isVisible())await connect.click({timeout:actionTimeout(remaining)});
 await editor.fill(message,{timeout:actionTimeout(remaining)});
}
export async function openJourneyReply(page,card,message,remaining){
 await waitForJourneyAccountIdle(page,remaining);
 await card.getByRole('button',{name:'Reply',exact:true}).click({timeout:actionTimeout(remaining)});
 const dialog=page.locator('dialog.account-dialog');
 await dialog.getByRole('button',{name:'Reply',exact:true}).waitFor({state:'visible',timeout:actionTimeout(remaining)});
 await dialog.getByLabel('Message',{exact:true}).fill(message,{timeout:actionTimeout(remaining)});
}
export async function clickJourneyLike(page,card,remaining){
 await waitForJourneyAccountIdle(page,remaining);
 await card.getByRole('button',{name:'Like · 20 credits',exact:true}).click({timeout:actionTimeout(remaining)});
}
export async function reloadJourneyPage(page,remaining){
 await waitForJourneyAccountIdle(page,remaining);
 await page.reload({waitUntil:'domcontentloaded'});
}
export async function submitJourneyComposer(page,kind,remaining){
 if(!['post','reply','bok'].includes(kind))throw failure('RELEASE_JOURNEY_STEP');
 await page.locator('dialog.account-dialog').getByRole('button',{name:kind==='reply'?'Reply':'Post',exact:true}).click({timeout:actionTimeout(remaining)});
}
export async function selectJourneySignupAsset(page,asset,remaining){
 if(!['ETH','USDC'].includes(asset))throw failure('RELEASE_JOURNEY_STEP');
 const dialog=page.locator('dialog.account-dialog');
 // A fresh gasless wallet cannot obtain the default ETH quote. Select its
 // funded asset before waiting for that asset's payment confirmation button.
 await dialog.getByLabel('Pay with',{exact:true}).selectOption(asset,{timeout:actionTimeout(remaining)});
 await dialog.getByRole('button',{name:'Confirm payment',exact:true}).waitFor({timeout:remaining()});
}
export async function buyJourneyBokCredit(page,remaining){
 const dialog=page.locator('dialog.account-dialog'),amount=dialog.getByLabel('Amount (USD)',{exact:true}),connect=dialog.getByRole('button',{name:'Connect CI test wallet',exact:true});
 await dialog.getByRole('button',{name:'Add Bok credit',exact:true}).click({timeout:actionTimeout(remaining)});
 // Reload can restore the posting account without reconnecting its Ethereum
 // payment wallet. Follow the actual top-up prompt before editing the purchase.
 await amount.or(connect).first().waitFor({state:'visible',timeout:actionTimeout(remaining)});
 if(await connect.isVisible())await connect.click({timeout:actionTimeout(remaining)});
 await amount.fill('1',{timeout:actionTimeout(remaining)});
 await dialog.getByLabel('Pay with',{exact:true}).selectOption('ETH',{timeout:actionTimeout(remaining)});
 await dialog.getByRole('button',{name:'Pay',exact:true}).click({timeout:actionTimeout(remaining)});
 await dialog.getByText(/Bok credit added\./).waitFor({timeout:remaining()});
}
export async function runTestnetJourney(file,{onStage=async()=>{},expectedOrigin,expectedCompatibility,publicFile}={}){
 const cfg=await readJourneyConfig(file);if(expectedOrigin!==undefined&&cfg.stagingOrigin!==expectedOrigin)throw failure('RELEASE_FIXTURE_CONFIG');const {chromium}=await import('playwright'),{JsonRpcProvider,Wallet,Contract,getBytes}=await import('ethers');
 const provider=new JsonRpcProvider(cfg.ethereumRpc);if((await provider.getNetwork()).chainId!==11155111n)throw failure('RELEASE_NETWORK');
 const runtimeResponse=await fetch(cfg.stagingOrigin+'/wallet/runtime.json',{signal:AbortSignal.timeout(15000)});if(!runtimeResponse.ok)throw failure('RELEASE_RUNTIME');
 const runtime=await runtimeResponse.json(),config=runtime.config;
 if(runtime.proofsEnabled!==true||config?.network?.chainId!=='11155111'||runtime.remoteProver?.proofsEnabled!==true)throw failure('RELEASE_REAL_PROOFS_REQUIRED');
 const runtimeFingerprint=runtimeIdentity(runtime);
 if(expectedCompatibility&&(expectedCompatibility.chainId!==config.network.chainId||expectedCompatibility.board!==config.board.contractAddress||expectedCompatibility.rollup!==config.network.rollupAddress||expectedCompatibility.rollupVersion!==config.network.rollupVersion||expectedCompatibility.runtimeSha256!==runtimeIdentity(runtime)))throw failure('RELEASE_RUNTIME_CHANGED');
 const funding=config.aggregateFunding;if(!funding?.bokToken||!funding?.router||!config.bok)throw failure('RELEASE_FIXTURE_CONFIG');
 const allowedTargets=new Set(['router','bokToken','feeToken','collateralPortal','feePortal','bokPortal'].map(k=>funding[k]?.toLowerCase()).filter(Boolean));
 const funder=new Wallet(cfg.testFunderKey,provider),token=new Contract(funding.bokToken,['function transfer(address,uint256) returns(bool)'],funder);
 const result={passed:false,proofs:'real',chainId:'11155111',completed:[],proofResponses:0,elapsedMs:0};
 let browser,failureStep='setup';const started=Date.now();let expired=false;const timer=setTimeout(()=>{expired=true;void browser?.close();},cfg.timeoutMs);timer.unref();
 const remaining=()=>Math.max(1,cfg.timeoutMs-(Date.now()-started));
 const record=async name=>{result.completed.push(name);await onStage(name);};
 try{
  if(!publicFile||!expectedCompatibility)throw failure('RELEASE_FIXTURE_CONFIG');
  const evidence=await openChainEvidence(publicFile,expectedCompatibility,remaining);
  browser=await chromium.launch({headless:true});
  for(const asset of ['ETH','USDC']){
   failureStep='fund-'+asset;const wallet=Wallet.createRandom().connect(provider);
   if(asset==='ETH'){const paid=await funder.sendTransaction({to:wallet.address,value:BigInt(cfg.ethPerAccountWei)});if((await paid.wait(1,remaining()))?.status!==1)throw failure('RELEASE_FIXTURE_FUNDING');}
   else{
    // Gasless signup must work for an address which has never received ETH.
    if(await provider.getBalance(wallet.address)!==0n)throw failure('RELEASE_GASLESS_FIXTURE');
    const transfer=await token.transfer(wallet.address,BigInt(cfg.usdcPerAccount));if((await transfer.wait(1,remaining()))?.status!==1)throw failure('RELEASE_FIXTURE_FUNDING');
   }
   const context=await browser.newContext({serviceWorkers:'block'});context.setDefaultTimeout(Math.min(90000,remaining()));
   try{
    const bridge=await createTestWalletBridge({wallet,provider,allowedTargets,capWei:asset==='USDC'?0n:BigInt(cfg.ethPerAccountWei),getBytes});
    await context.exposeBinding('__rollingReleaseWallet',async({frame},request)=>{
     if(new URL(frame.url()).origin!==cfg.stagingOrigin)return {error:true,code:4100};
     try{return {result:await bridge(request)};}catch{return {error:true,code:4001};}
    });
    await context.addInitScript(installTestProvider);
    const page=await context.newPage();let pageErrors=0,proofs=0;const submissions=[];
    page.on('request',r=>{if(r.method()==='POST'&&r.url()===runtime.trustedQuery.url)submissions.push(evidence.submission(r).catch(()=>null));});
    const hashesSince=async start=>{const values=await Promise.all(submissions.slice(start));if(values.some(v=>v===null))throw failure('RELEASE_SUBMISSION_INVALID');return values.flat();};
    page.on('pageerror',()=>pageErrors++);
    page.on('response',r=>{if(r.request().method()==='POST'&&r.url().startsWith(runtime.remoteProver.url)&&r.ok())proofs++;});
    failureStep='signup-'+asset;await page.goto(cfg.stagingOrigin+'/#/new-account',{waitUntil:'domcontentloaded'});
    // This route opens the account modal itself; the navigation button behind
    // it is inert. Scope every signup control to that actual dialog.
    const dialog=page.locator('dialog.account-dialog');await dialog.waitFor({state:'visible',timeout:actionTimeout(remaining)});
    await dialog.getByRole('button',{name:'Connect CI test wallet',exact:true}).click({timeout:actionTimeout(remaining)});
    await selectJourneySignupAsset(page,asset,remaining);
    await dialog.getByRole('button',{name:'Confirm payment',exact:true}).click({timeout:actionTimeout(remaining)});
    await dialog.getByText(/Your posting balance is (ready|set up)/).waitFor({timeout:remaining()});
    const signupHashes=await hashesSince(0);if(!signupHashes.length)throw failure('RELEASE_SUBMISSION_MISSING');
    for(const hash of signupHashes)await evidence.require([hash],()=>true,remaining);
    if(asset==='USDC'&&await provider.getBalance(wallet.address)!==0n)throw failure('RELEASE_GASLESS_FIXTURE');
    await record('signup-'+asset);
    failureStep='close-account';await closeJourneyAccountPanel(page,remaining);
    if(asset==='USDC'){result.proofResponses+=proofs;if(!proofs||pageErrors)throw failure('RELEASE_BROWSER_ERRORS');continue;}
    // Home keeps one ranked representative per conversation. The chronological
    // board retains both our root and reply, including after reload.
    failureStep='post-compose';await openJourneyMainBoard(page,remaining);
    const tag='Release check '+randomUUID();
    async function compose(message,{buyBokCredit=false}={}){
     const start=submissions.length,kind=buyBokCredit?'bok':'post';
     failureStep=kind+'-compose';await openJourneyComposer(page,message,remaining);
     if(buyBokCredit){failureStep='bok-credit';await buyJourneyBokCredit(page,remaining);}
     failureStep=kind+'-submit';await submitJourneyComposer(page,kind,remaining);
     failureStep=kind+'-inclusion';
     const {card,receipt}=await waitForJourneyPost(page,message,remaining);
     const hashes=await hashesSince(start);if(!hashes.includes(receipt.hash))throw failure('RELEASE_INCLUSION');
     const events=await evidence.require([receipt.hash],events=>events.some(e=>e.type==='PostPublished'&&e.payload.id===receipt.id.slice(5)&&e.payload.record.parent==='0'&&e.payload.record.root===e.payload.id&&evidence.text(e.payload)===message)&&events.some(e=>e.type==='PostTipKey'&&e.payload.post===receipt.id.slice(5)),remaining);
     return {card,receipt,events};
    }
    const {card,receipt}=await compose(tag);await record('post');
    failureStep='reply-compose';const replyStart=submissions.length;
    await openJourneyReply(page,card,tag+' reply',remaining);failureStep='reply-submit';await submitJourneyComposer(page,'reply',remaining);
    failureStep='reply-inclusion';
    const reply=await waitForJourneyPost(page,tag+' reply',remaining),replyHashes=await hashesSince(replyStart);
    if(!replyHashes.includes(reply.receipt.hash))throw failure('RELEASE_INCLUSION');
    await evidence.require([reply.receipt.hash],events=>events.some(e=>e.type==='PostPublished'&&e.payload.id===reply.receipt.id.slice(5)&&e.payload.record.parent===receipt.id.slice(5)&&e.payload.record.root===receipt.id.slice(5)&&evidence.text(e.payload)===tag+' reply'),remaining);await record('reply');
    failureStep='like';const likeStart=submissions.length;await clickJourneyLike(page,card,remaining);await page.waitForFunction(id=>Number.parseInt(document.querySelector('#'+id+' .likes')?.textContent??'0',10)>0,receipt.id,{timeout:remaining()});
    await evidence.require(await hashesSince(likeStart),events=>events.some(e=>e.type==='LikeChanged'&&e.payload.post===receipt.id.slice(5)&&e.payload.active===true&&BigInt(e.payload.count)>0n),remaining);await record('like');
    failureStep='reload';await reloadJourneyPage(page,remaining);await page.getByText(tag,{exact:true}).waitFor({timeout:remaining()});await record('reload');
    // Starter intentionally excludes Bok credit. Exercise the actual purchase
    // and require a new bot reply to this unique request before allowing release.
    const bok=await compose(tag+' @bok reply with the word ready only',{buyBokCredit:true});await waitForJourneyAccountIdle(page,remaining);await page.goto(cfg.stagingOrigin+'/#/thread/'+bok.receipt.id.slice(5),{waitUntil:'domcontentloaded'});
    const invocation=bok.events.find(e=>e.type==='PluginInvoked'&&e.payload.post_id===bok.receipt.id.slice(5)&&e.payload.plugin_id===BigInt(config.bok.pluginId).toString());if(!invocation)throw failure('RELEASE_INCLUSION');
    failureStep='bok-reply';const bot=page.locator('article.bot-post').first();await bot.waitFor({timeout:remaining()});const botHash=await bot.getAttribute('data-tx-hash');
    await evidence.require([botHash],events=>events.some(e=>e.type==='PluginReplyPublished'&&e.payload.request_id===invocation.payload.request_id&&e.payload.plugin_id===invocation.payload.plugin_id&&e.payload.parent_id===invocation.payload.post_id&&e.payload.target===invocation.payload.target&&events.some(p=>p.type==='PostPublished'&&p.payload.id===e.payload.post_id&&p.payload.record.kind==='4'&&p.payload.record.parent===invocation.payload.post_id&&p.payload.record.root===invocation.payload.post_id)),remaining);await record('bok');
    result.proofResponses+=proofs;if(!proofs||pageErrors)throw failure('RELEASE_BROWSER_ERRORS');
   }finally{await context.close();}
  }
  failureStep='final-check';await evidence.recheck();
  const after=await(await fetch(cfg.stagingOrigin+'/wallet/runtime.json',{signal:AbortSignal.timeout(15000)})).json();
  if(runtimeIdentity(after)!==runtimeFingerprint)throw failure('RELEASE_RUNTIME_CHANGED');
  result.passed=!expired;return result;
 }catch(e){throw Object.assign(failure(e.code?.startsWith('RELEASE_')?e.code:expired?'RELEASE_JOURNEY_TIMEOUT':'RELEASE_JOURNEY_FAILED'),{completed:result.completed,failureStep});}
 finally{clearTimeout(timer);await browser?.close();provider.destroy();result.elapsedMs=Date.now()-started;}
}
