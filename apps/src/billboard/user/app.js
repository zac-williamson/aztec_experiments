// The author view renders public application results; it owns no transaction lifecycle.
const application=createBillboardApplication({kind:'author'});
const view=window.BillboardView, element=id=>document.getElementById(id);
view.header({section:'Write'});
view.bindOperation(application,element('operationStatus'));
let accountState=null,terms=null,ready=false,invalidated=false,operationBusy=false,feedBusy=false,feedSignature='',pendingFeed=null;
let poller=null,readinessBusy=false,withdrawalPlan=null,draftRevision=0,pendingDraft=null,loadedDraftKey=null,gasEstimateRevision=0;
const hidden=(id,value)=>element(id).hidden=value;
const isBusy=()=>['working','waiting'].includes(application.operation().status);
function showFailure(error){element('setupStatus').textContent=publicOperationFailure(error).message;element('setupStatus').className='error';hidden('retrySetup',!window.BillboardAccount.snapshot().address);}
function draftKey(){return 'board-draft:'+_getPublicConfig()?.board.contractAddress+':'+(window.BillboardAccount.snapshot().address||'guest');}
function updateDraft(save=false){if(save)draftRevision++;const bytes=new TextEncoder().encode(element('msgText').value).length;element('messageCapacity').textContent=bytes+' / 992 bytes';element('messageError').textContent=bytes>992?'Shorten this message before posting.':'';element('msgText').setAttribute('aria-invalid',String(bytes>992));element('postBtn').disabled=invalidated||operationBusy||!ready||bytes===0||bytes>992;if(!save)return;try{localStorage.setItem(draftKey(),element('msgText').value);element('draftState').textContent='Draft saved in this browser';}catch{element('draftState').textContent='Draft is only kept while this page is open';}}
function loadDraft(){const key=draftKey();if(loadedDraftKey===key)return;loadedDraftKey=key;draftRevision++;try{element('msgText').value=localStorage.getItem(draftKey())||'';}catch{}updateDraft();}
function renderAmount(){if(!terms)return;const amount=terms.minWei+(terms.maxWei-terms.minWei)*BigInt(element('depositAmount').value)/1000n;const value=ethers.formatEther(amount)+' ETH';element('depositSelection').textContent=value;element('depositCost').textContent=value;const seconds=(terms.baseCooldown*terms.minWei+amount-1n)/amount;element('depositCooldown').textContent='Post about every '+seconds+' seconds.';element('depositAmount').setAttribute('aria-valuetext',value+'; '+seconds+' seconds between posts');}
async function refreshGasEstimate(){const quotedTerms=terms,revision=++gasEstimateRevision;if(!quotedTerms||invalidated)return;const amount=selectedAmount(),current=()=>terms===quotedTerms&&!invalidated&&revision===gasEstimateRevision&&selectedAmount()===amount;element('depositGas').textContent='Calculating…';try{const quote=await application.estimateDepositGas(amount);if(!current())return;const eth=Number(ethers.formatEther(quote.maximumGasCost));element('depositGas').textContent=(eth<0.00000001?'<0.00000001':eth.toFixed(8))+' ETH at current fee limits';}catch{if(current())element('depositGas').textContent='Estimate unavailable; your wallet will show the fee before approval.';}}
function selectedAmount(){return ethers.formatEther(terms.minWei+(terms.maxWei-terms.minWei)*BigInt(element('depositAmount').value)/1000n);}
async function presentAccount(result){
  accountState=result;element('setupStatus').textContent='';hidden('connectPanel',true);hidden('depositPanel',true);terms=null;element('depositBtn').disabled=true;hidden('composer',result.state!=='postable');hidden('provingSettings',false);hidden('activityPanel',false);
  if(result.state==='zero_balance_need_deposit'){
    terms=await application.readDepositTerms();element('depositAmount').disabled=terms.minWei===terms.maxWei;
    element('depositLimits').textContent=ethers.formatEther(terms.minWei)+'–'+ethers.formatEther(terms.maxWei)+' ETH';renderAmount();refreshGasEstimate();
    element('feeCost').textContent=Number(ethers.formatEther(application.fundingQuote().fundingAmount)).toFixed(2)+' AZTEC';
    hidden('depositPanel',false);element('depositBtn').disabled=isBusy()||invalidated;
  }
  if(result.state==='postable'){await refreshReadiness();loadDraft();}
  if(result.state==='withdrawal_needs_verification'){hidden('withdrawPanel',false);element('withdrawSummary').textContent='Your withdrawal is already recorded. Continue to check settlement and return your ETH.';element('withdrawConfirm').textContent='Continue withdrawal';withdrawalPlan=null;}
  element('activityStatus').textContent=result.state==='postable'?'Your account is ready.':result.state==='zero_balance_need_deposit'?'No active board deposit.':'Setup or withdrawal is not yet complete.';
}
async function setupAccount(){
  hidden('retrySetup',true);element('setupStatus').textContent='Opening your private account…';
  try{const result=await application.run('status');await presentAccount(result);await refreshActivity();if(result.state==='deposited_l1_not_claimed_l2')await deposit();}
  catch(error){showFailure(error);hidden('connectPanel',false);throw error;}
}
async function deposit(){
  if(invalidated||!accountState||!application.connected){showFailure({code:'BB_WALLET_NOT_READY'});return;}
  try{const result=await application.completeDeposit(accountState?.state==='zero_balance_need_deposit'?{depositAmount:selectedAmount()}:{});await presentAccount(result);element('postResult').textContent='Your deposit is ready. Write your first message.';}
  catch(error){showFailure(error);hidden('resumeOperation',false);element('activityStatus').textContent='Setup paused. Your confirmed payments remain saved.';}
}
async function refreshReadiness(){
  if(!application.connected||readinessBusy||isBusy())return;readinessBusy=true;
  try{const info=await application.readDeposit();const seconds=info.nextAllowedTime-BigInt(info.chainTime);ready=info.amount>0n&&seconds<=0n;element('postCountdown').textContent=ready?'Ready to post':info.amount>0n?'Next post available in about '+seconds+' seconds.':'No active deposit.';element('postCountdown').className='countdown'+(ready?' ready':'');updateDraft();}
  catch{ready=false;element('postCountdown').textContent='Could not check posting availability. We will check again shortly.';updateDraft();}finally{readinessBusy=false;}
}
async function post(){
  element('postResult').textContent='';const message=element('msgText').value.trim();pendingDraft={revision:draftRevision,key:draftKey()};
  try{const result=await application.run('post',{message});presentPost(result);await refreshReadiness();await refreshMessages(true);await refreshActivity();}
  catch(error){element('messageError').textContent=publicOperationFailure(error).message;hidden('resumeOperation',false);}
}
function presentPost(result){
 const unchanged=pendingDraft&&pendingDraft.revision===draftRevision&&pendingDraft.key===draftKey();
 if(unchanged){element('msgText').value='';updateDraft(true);}pendingDraft=null;
 element('postResult').textContent='Message posted. '+(!unchanged&&element('msgText').value?'Your current draft is still saved. ':'');
 if(result.postId){const link=view.element('a','View your message');const target=view.url('feed.html');target.searchParams.set('message',result.postId);link.href=target;element('postResult').append(link);}
}
async function refreshMessages(apply=false){
  if(feedBusy||!_getPublicConfig())return;feedBusy=true;
  try{const page=await application.readFeed();const signature=JSON.stringify(page.posts);view.rules(element('boardRules'),page.policies,page.participation);
    if(!feedSignature||apply){view.renderMessages(element('billboardFeed'),page.posts);feedSignature=signature;pendingFeed=null;hidden('newMessages',true);}
    else if(signature!==feedSignature){pendingFeed=page;hidden('newMessages',false);}
    element('billboardMeta').textContent=page.progress.complete?'':'Loading earlier messages…';
  }catch{element('billboardMeta').textContent='Messages could not be updated. Existing messages are still shown.';}finally{feedBusy=false;}
}
async function refreshActivity(){
  let items;try{items=await application.readActivity();}catch{element('activityStatus').textContent='Activity could not be updated. Your completed action is unchanged.';return;}const container=element('activityRecords');container.replaceChildren();
  let pending=false;
  for(const item of items){
    const row=view.element('details'),label=item.kind==='post'?'Message':item.kind==='withdraw'?'Withdrawal':item.kind==='deposit'||item.kind==='claim'?'Deposit setup':'Transaction';
    row.append(view.element('summary',label+' · '+item.status));
    if(item.txHash)row.append(view.element('p',item.txHash,'account-address'));
    if(item.feePaid)row.append(view.element('p','Actual network fee: '+Number(ethers.formatEther(BigInt(item.feePaid))).toFixed(4)+' AZTEC'));
    container.append(row);pending ||=item.status==='pending'||Boolean(item.nextAction);
  }
  const interrupted=items.find(item=>item.status==='pending'||item.nextAction);element('resumeOperation').textContent=interrupted?.kind==='post'?'Check message':interrupted?.kind==='withdraw'||interrupted?.kind==='refund'?'Check withdrawal':interrupted&&['deposit','claim','fee-funding','fee-deposit','fee-approval','fee-claim'].includes(interrupted.kind)?'Finish setup':'Check saved transaction';
  hidden('resumeOperation',!pending);if(pending)element('activityStatus').textContent='A saved operation needs checking before another transaction.';
}
async function showAccount(){
  hidden('accountPanel',false);const balances=element('balances');balances.textContent='Loading balances…';
  try{const data=await application.readAccount();balances.replaceChildren();for(const [label,value]of [['Refundable deposit',ethers.formatEther(data.deposit.amount)+' ETH'],['Private transaction credit',Number(ethers.formatEther(data.feeBalance)).toFixed(2)+' AZTEC']])balances.append(view.element('dt',label),view.element('dd',value));}
  catch{balances.textContent='Could not load balances. Close and reopen Account to try again.';}
}
async function reviewWithdrawal(){
  try{withdrawalPlan=await application.readWithdrawalPlan();const plan=withdrawalPlan;element('withdrawSummary').textContent='Return '+ethers.formatEther(plan.amount)+' ETH. '+(plan.readyAt>plan.chainTime?(plan.waitingReason?plan.waitingReason+' ':'')+'Preparation can start after '+new Date(plan.readyAt*1000).toLocaleString()+'. ':'')+(plan.remaining?'Up to '+plan.maxScreeningSteps+' preparation transactions, then withdrawal. ':'')+'Maximum total credit spend for this attempt: '+Number(ethers.formatEther(plan.maximumCreditSpend)).toFixed(2)+' AZTEC. You pay actual fees only.';hidden('withdrawPanel',false);element('withdrawConfirm').focus();}
  catch(error){showFailure(error);}
}
function presentWithdrawal(result){
  element('withdrawResult').textContent=ethers.formatEther(BigInt(result.refundAmount))+' ETH returned to '+result.refundRecipient+'. ';const back=view.element('a','Return to the board');back.href=view.url('feed.html');element('withdrawResult').append(back);if(result.lastEthereumTxHash){const details=view.element('details');details.append(view.element('summary','Payment receipt'),view.element('p',result.lastEthereumTxHash,'account-address'));element('withdrawResult').append(details);}hidden('withdrawReview',true);element('withdrawHeading').textContent='Deposit returned';hidden('withdrawConfirm',true);hidden('composer',true);hidden('withdrawCancel',true);element('withdrawStart').disabled=true;hidden('withdrawPanel',false);hidden('depositPanel',true);hidden('resumeOperation',true);withdrawalPlan=null;
}
async function withdraw(){
  try{presentWithdrawal(await application.completeWithdrawal(withdrawalPlan));}
  catch(error){element('withdrawResult').textContent=publicOperationFailure(error).message;hidden('resumeOperation',false);}
}
application.subscribe(state=>{operationBusy=['working','waiting'].includes(state.status);for(const id of ['depositBtn','withdrawConfirm','resumeOperation','retrySetup'])element(id).disabled=operationBusy||invalidated;element('depositBtn').disabled=operationBusy||invalidated||!terms;element('withdrawCancel').disabled=operationBusy;updateDraft();element('activeProving').textContent=operationBusy?'Current operation: '+(state.mode==='remote'?'board’s prover':'this device')+'. Toggle changes apply next time.':'';});
element('depositAmount').oninput=()=>{renderAmount();element('depositGas').textContent='Release the slider to update the estimate.';};element('depositAmount').onchange=refreshGasEstimate;element('depositBtn').onclick=deposit;element('retrySetup').onclick=()=>setupAccount().catch(()=>{});element('postBtn').onclick=post;element('msgText').oninput=()=>updateDraft(true);
element('discardDraft').onclick=()=>{element('msgText').value='';updateDraft(true);};element('newMessages').onclick=()=>{if(pendingFeed){view.renderMessages(element('billboardFeed'),pendingFeed.posts);feedSignature=JSON.stringify(pendingFeed.posts);pendingFeed=null;hidden('newMessages',true);}};
element('closeAccount').onclick=()=>hidden('accountPanel',true);element('withdrawStart').onclick=reviewWithdrawal;element('withdrawConfirm').onclick=withdraw;element('withdrawCancel').onclick=()=>hidden('withdrawPanel',true);
element('resumeOperation').onclick=async()=>{try{const result=await application.resume();if(result.refundAmount&&result.refundRecipient)presentWithdrawal(result);else {if(result.postId)presentPost(result);await presentAccount(result);}hidden('resumeOperation',true);}catch(error){if(error.code==='BB_WITHDRAWAL_REVIEW'){hidden('resumeOperation',true);await reviewWithdrawal();}else showFailure(error);}};
function initialize(){
  view.identity(_getPublicConfig());refreshMessages();
  if(!window.__aztec?.createPXE){waitForBundle(initialize);return;}
  initWalletButtons('walletButtonsContainer',{autoPasskey:true,statusId:'setupStatus',canEndSession:()=>!isBusy(),onReady:setupAccount,onChange:state=>{invalidated=state.invalidated;if(invalidated){ready=false;element('depositBtn').disabled=true;element('withdrawConfirm').disabled=true;updateDraft();}}});
  const button=view.element('button','Balance & activity','secondary');button.onclick=()=>{showAccount();element('wbAccountMenu').open=false;};element('accountActions').append(button);
  element('setupStatus').textContent='';poller=setInterval(()=>{if(!document.hidden){refreshMessages();refreshReadiness();}},15000);
}
initializeHostedBoard(initialize);

window.BillboardPlugins?.mountAccountPanel({container:element('pluginAccountPanel'),application,formatError:publicOperationFailure});
