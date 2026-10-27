import {beginRollingMeasure,measureRollingStage,rollingStageObserver} from './performance.mjs';
// Presentation only. Account restoration is delegated to the runtime; wallet prompts require a click.
import {allowance,MAX_THREAD_POSTS,splitMessage,createMessageBudget,createMessageContent,createIcon,mentionsBok} from './model.mjs';
import {createPublicReader} from './reader-client.mjs';
import {prepareAvatarUpload} from './avatar-upload.mjs';
// Presentation-only diagnostic projection. Keep this vocabulary closed even if
// a runtime or DOM value is malformed; never render or report exception text.
const initializationSteps=new Set(['account-lock','trusted-node','deployment','account-derive','store-open','pxe-create','account-register','contracts-register','initial-sync','journal-open','wallet-bind','account-manager','application-bind']);
const deploymentSteps=new Set(['config','node-readiness','artifact-layout','board-class','checkpoint','board-instance','public-config','config-commitment','fee-instance','l1-context','portal-code-and-immutables','canonical-recheck','final-readiness-and-context']);
const initializationCodes=new Set(['unknown','BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE','BB_BROWSER_PROVER_CONFIGURATION','ROLLING_SESSION_CONFIG','ROLLING_OTHER_TAB','ROLLING_CONTEXT_CHANGED','ROLLING_ACCOUNT_MISMATCH','ROLLING_PRIVATE_ROUTE','ROLLING_DEPLOYMENT_INVALID']);
const refreshSteps=new Set(['account-status','owned-names','moderator-status','bok-status'].flatMap(method=>['lock','context','pxe-sync','account-initialize','method'].map(phase=>method+'/'+phase)));
const refreshCodes=new Set(['ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
const fundingPaymentStates=new Set(['unknown','saved','submitted','confirmed','credited']);
const fundingExtraCodes=new Set(['PRIVATE_FEE_INVALID_CLAIM','PRIVATE_FEE_CLAIM_INSUFFICIENT','PRIVATE_FEE_CLAIM_SECRET_MISMATCH','PRIVATE_FEE_CONTEXT_CHANGED','BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_CONFIRMATION_UNKNOWN','BB_ETH_RECOVERY_REQUIRED']);
const fundingSteps=new Set(['inspect','recover','account-status','prepare','checkpoint','submit','reconcile']);
export function fundingProgressMessage({step,state},kind='posting'){
 const credit=kind==='bok'?'Bok credit':'posting balance';
 if(state==='failed')return 'This step could not complete. Your payment details are saved.';
 return {inspect:'Checking your payment…',recover:state==='complete'?'Payment checked. Continuing…':'Waiting for your payment to confirm…','account-status':`Payment confirmed. Checking your ${credit}…`,prepare:`Payment confirmed. Adding your ${credit} on Aztec…`,checkpoint:`Preparing your ${credit}…`,submit:`Adding your ${credit}…`,reconcile:`Waiting for your ${credit} to confirm…`}[step]??`Adding your ${credit}…`;
}
const fundingCodes=new Set(['ROLLING_FUNDING_INVALID','ROLLING_FUNDING_PENDING','ROLLING_FUNDING_NOT_READY','ROLLING_FUNDING_RECOVERY_REQUIRED','ROLLING_FUNDING_MISMATCH','ROLLING_FUNDING_UNKNOWN','ROLLING_FUNDING_REORG','ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_ACTION','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','ROLLING_FEE_CHANGED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
export function projectRollingInitialization(value){
 try{
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Reflect.ownKeys(value).length!==5)return null;
  const out={};for(const key of ['stage','step','deploymentStep','state','code']){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return null;out[key]=d.value;}
  const refresh=out.stage==='private-refresh',funding=out.stage==='funding-claim';
  if(!(funding?fundingSteps.has(out.step):refresh?refreshSteps.has(out.step):out.stage==='session-initialization'&&initializationSteps.has(out.step))||!['started','complete','failed'].includes(out.state))return null;
  if(out.deploymentStep!==null&&(refresh||funding||out.step!=='deployment'||!deploymentSteps.has(out.deploymentStep)))return null;
  if(out.state==='failed'?!(initializationCodes.has(out.code)||refresh&&refreshCodes.has(out.code)||funding&&fundingCodes.has(out.code)):out.code!==null)return null;
  return Object.freeze(out);
 }catch{return null;}
}
// A mention is a local composition choice (one pattern, shared with message
// rendering in model.mjs). Reading credit never belongs to the input event; the
// account-scoped query below is shared by the page and composer.
export {mentionsBok};
export function createBokBalanceQuery({identity,read,onChange=()=>{}}){
 let generation=0,key=null,pending=null,state={phase:'idle',value:null};
 function current(){const next=identity();if(next!==key){generation++;key=next;state={phase:'idle',value:null};}return next;}
 function snapshot(){current();return state;}
 function invalidate(){generation++;key=identity();state={phase:'idle',value:null};onChange();}
 function load({refresh=false}={}){
  const owner=current();if(!owner)return Promise.resolve(null);
  if(pending)return pending;
  if(!refresh&&state.phase!=='idle')return Promise.resolve(state.value);
  const epoch=generation;state={phase:'loading',value:state.value};
  pending=Promise.resolve().then(()=>{if(current()!==owner||epoch!==generation)return null;return read();}).then(value=>{
   if(current()!==owner||epoch!==generation)return null;
   if(value?.available===true&&typeof value.availableCredit==='string'&&/^(0|[1-9][0-9]*)$/.test(value.availableCredit)&&BigInt(value.availableCredit)<1n<<128n)state={phase:'ready',value};
   else if(value?.available===false)state={phase:'unavailable',value};
   else throw Error('Invalid Bok balance');
   return state.value;
  }).catch(()=>{if(current()===owner&&epoch===generation)state={phase:'error',value:null};return null;}).finally(()=>{pending=null;onChange();});
  onChange();return pending;
 }
 return {snapshot,load,invalidate,settled:()=>pending??Promise.resolve(),get pending(){return pending!==null;}};
}
const MODERATOR_TYPES=new Set(['moderate-post','moderate-avatar','reject-subboard','set-main-policy','transfer-moderator']);
const TYPES={'transfer-moderator':'Transfer moderator authority','withdraw-bok':'Withdraw Bok credit','cancel-bok-request':'Release an unused Bok request','expire-bok-request':'Expire a Bok request',withdraw:'Withdraw posting collateral',screen:'Withdraw deposit','moderate-post':'Remove a post','moderate-avatar':'Remove an avatar','reject-subboard':'Reject a subboard','set-main-policy':'Update parent rules',bok:'Ask Bok',bio:'Edit bio',avatar:'Edit avatar',post:'Write a post',reply:'Reply',quote:'Quote a post',repost:'Repost',like:'Like a post',name:'Register a name',subboard:'Create a subboard'};
const COMPOSER_TYPES=new Set(['post','reply','quote','repost','bok']);
// Editing uses the unlocked session and its last account snapshot. Private
// publishing checks still run when preparing the action, not on navigation.
export function rollingViewReady({view,type,namesLoaded=false,moderatorStatus=null}){
 if(view==='names'||view==='action'&&['bio','avatar'].includes(type))return namesLoaded;
 if(view==='action'&&MODERATOR_TYPES.has(type))return moderatorStatus!==null;
 return true;
}
const IDS=['subboard','parent','root','reference','post'];
const field=value=>typeof value==='string'&&/^(?:0x[0-9a-f]{64}|0|[1-9][0-9]{0,76})$/.test(value);
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);for(const child of children.flat())if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;};
const button=(label,handler,primary=false)=>{const node=el('button',{type:'button',class:`button${primary?' primary':''}`},label);node.addEventListener('click',handler);return node;};
const paragraph=text=>el('p',{},text);
const label=(text,control)=>el('label',{class:'form-field'},text,control);
function accountFailure(failure){
 const safeCode=value=>typeof value==='number'&&Number.isSafeInteger(value)?value:typeof value==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value)?value:'unclassified';
 console.warn('[wallet-sign-in]',safeCode(failure?.code),safeCode(failure?.info?.error?.code),safeCode(failure?.error?.code));
 const code=failure?.code;
 if(code===4001||code==='ACTION_REJECTED'||code==='BB_WALLET_REJECTED')return 'Sign-in cancelled in your wallet. Connect again when you are ready.';
 if(code==='BB_ACCOUNT_OWNER_MISMATCH')return 'Connect the Ethereum wallet you used to create this account.';
 if(code==='BB_WALLET_NETWORK')return 'Switch your Ethereum wallet to Sepolia, then connect again.';
 if(code==='BB_ETHEREUM_SESSION_SIGNATURE')return 'Your wallet could not sign in as the selected Ethereum account. Select an account that supports Ethereum message signing.';
 if(typeof code==='string'&&code.startsWith('BB_ETHEREUM_SESSION_STORAGE'))return 'Your browser could not save your sign-in. Allow this site to store data, then connect again.';
 return 'Wallet sign-in could not complete. Check your wallet extension, then connect again.';
}
function nameFailure(failure){
 try{const code=Object.getOwnPropertyDescriptor(failure,'code');if(!code||!Object.hasOwn(code,'value'))return null;
  return code.value==='ROLLING_NAME_INVALID'?'Enter a valid first and last name. Use 1–32 ASCII letters, spaces, apostrophes or hyphens in each part; start and end with a letter. Bok is reserved.':code.value==='ROLLING_NAME_TAKEN'?'This name is already registered. Choose another first and last name.':code.value==='ROLLING_NAME_AVAILABILITY_UNAVAILABLE'?'Name availability could not be checked. Your draft is preserved; try again when the private connection is available.':null;
 }catch{return null;}
}
function actionFailure(failure){
 try{const code=Object.getOwnPropertyDescriptor(failure??{},'code')?.value;
  if(['BB_LIKE_FEE_CREDIT_REQUIRED','BB_PREFERENCE_FEE_CREDIT_REQUIRED'].includes(code))return 'Add posting credit to cover this action’s maximum cost. No transaction was sent.';
  if(code==='ROLLING_LIKES_UNAVAILABLE')return 'Likes could not be checked. Try again. No transaction was sent.';
  if(code==='BB_POST_FEE_CREDIT_REQUIRED')return 'Add posting credit to cover this post’s maximum cost. No transaction was sent.';
  if(code==='BB_POST_FEE_PROFILE_MISMATCH')return 'Posting costs need an application update. Reload the page. No transaction was sent.';
  if(code==='BB_FEE_RESERVATION_UNAFFORDABLE')return 'A fee estimate could not fit your posting credit. No transaction was sent. You can add posting credit and try again.';
  if(code==='BB_FEE_ESTIMATION_UNSTABLE')return 'The posting fee could not be estimated. No transaction was sent.';
 }catch{return null;}
 return nameFailure(failure);
}
function decimal(value,decimals){const text=BigInt(value).toString().padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'');}
// Presentation only. Never feed rounded amounts back into payment authorization.
export function compactAmount(value,decimals,places,roundUp=false){
 const amount=BigInt(value);if(amount<0n||!Number.isInteger(decimals)||!Number.isInteger(places)||places<1||decimals<places)throw Error('Invalid display amount');
 const scale=10n**BigInt(decimals-places),rounded=amount/scale+(roundUp&&amount%scale!==0n?1n:0n);
 return decimal(rounded,places);
}
function fundingFailureText(failure){
 try{const code=Object.getOwnPropertyDescriptor(failure,'code');if(code&&Object.hasOwn(code,'value')){
  if(code.value==='ROLLING_FUNDING_FEE_CREDIT_INSUFFICIENT'){
   const minimum=Object.getOwnPropertyDescriptor(failure,'minimumFeeCredit');
   if(minimum&&Object.hasOwn(minimum,'value')&&typeof minimum.value==='string'&&/^[1-9][0-9]{0,38}$/.test(minimum.value)&&BigInt(minimum.value)<1n<<128n)
    return 'Posting costs have changed. Review the cost again to get an updated price. No payment was sent.';
  }
  const messages={
   ROLLING_FUNDING_TOKEN_BALANCE:'Your connected wallet does not have enough USDC. Choose Pay with ETH, or add USDC to that wallet.',
   ROLLING_FUNDING_FEE_TOKEN_BALANCE:'Your connected wallet does not have enough posting fee tokens. Add fee tokens to that wallet before buying posting credit.',
   ROLLING_FUNDING_SWAP_UNAVAILABLE:'ETH payment is unavailable for this credit. Choose USDC.',
   ROLLING_FUNDING_SWAP_LIQUIDITY:'An ETH price for this credit is unavailable. Try a smaller amount or pay with USDC.',
   ROLLING_FUNDING_SWAP_SCOPE:'The ETH exchange could not be verified. No exchange was sent. Try again when the service is available.',
   BB_ETH_REQUEST_CANCELLED:'Payment cancelled in your wallet. You can continue when you are ready.',
   BB_ETH_INSUFFICIENT_FUNDS:'Your wallet needs more ETH to cover this payment and Ethereum fees.',
   BB_ETH_READ_FAILED:'Ethereum could not confirm the payment details. Refresh the price and try again.',
   BB_ETH_PREFLIGHT_FAILED:'Ethereum rejected this payment before it was sent. Refresh the price and try again.',
   BB_ETH_SUBMISSION_UNKNOWN:'Your wallet may have sent the payment. Check its status before paying again.',
   BB_ETH_CONFIRMATION_UNKNOWN:'Your payment was sent. Confirmation is temporarily unavailable; continue checking this payment.',
   ROLLING_FUNDING_PURCHASE_SCOPE:'The credit payment service could not be verified. No payment was sent.',
   INSUFFICIENT_FUNDS:'Your wallet needs more ETH to cover this payment and Ethereum fees.',
   PRIVATE_FEE_BALANCE_INSUFFICIENT:'Your posting balance needs credit before the Bok credit can be added. Add posting credit, then continue this top-up.',
   ROLLING_FUNDING_SIGNATURE_CANCELLED:'Signature cancelled. No funding payment was sent. Your account remains unlocked; get a fresh quote when you are ready.',
   ROLLING_FUNDING_GAS_CHANGED:'Ethereum fees changed. Review the current cost before continuing.',
   AGGREGATE_STALE_QUOTE:'This quote has expired on Ethereum. Get a fresh quote and review the amounts before confirming again.',
   AGGREGATE_QUOTE_REORG:'Ethereum changed the block used for this quote. Get a fresh quote before confirming again.',
   AGGREGATE_PUBLIC_READ_FAILED:'The current price could not be checked. Try again.',
   AGGREGATE_LIQUIDITY_UNAVAILABLE:'The exchange cannot currently quote this amount. No payment was sent.',
   AGGREGATE_INSUFFICIENT_USER_FUNDS:'Your Ethereum wallet does not have enough funds for these allocations and the approved costs. Add funds to your wallet or choose another payment currency, then review the cost again.',
   AGGREGATE_PORTAL_NOT_READY:'The funding bridge is not accepting deposits. Try again when the service is available.',
   AGGREGATE_RELAY_GAS_REQUIRED:'The USDC funding relay currently lacks Ethereum gas. Try again when the relay is funded.',
   AGGREGATE_COLLATERAL_BOUNDS:'The required deposit has changed. Reopen your account and review the cost again.'
  };
  if(Object.hasOwn(messages,code.value))return messages[code.value];
 }}catch{}
 const stage=Object.getOwnPropertyDescriptor(failure??{},'topupStage')?.value;
 const stages={quote:'The credit price could not be loaded. Check your wallet is connected to the right network, then try again.',swap:'The ETH exchange could not be completed. Check the transaction in your wallet before continuing.',approval:'USDC spending approval could not be completed. Check the approval in your wallet, then continue.',deposit:'The credit payment could not be completed. Check the transaction in your wallet before continuing.',claim:'Your payment was sent, but the private credit could not be added yet. Continue this top-up to finish adding it.'};
 if(Object.hasOwn(stages,stage))return stages[stage];
 return nameFailure(failure);
}

export function aggregateFundingFailure(failure){
 const paymentState=Object.getOwnPropertyDescriptor(failure??{},'fundingPaymentState')?.value;
 if(fundingPaymentStates.has(paymentState))return paymentState==='unknown'?'Payment status is uncertain. Continue checking this payment.':paymentState==='credited'?'Credit received. Account setup could not finish.':paymentState==='confirmed'?'Payment received. Account setup could not finish.':'Payment is still being checked. Account setup could not finish.';
 const message=fundingFailureText(failure);
 const exchanged=Object.getOwnPropertyDescriptor(failure??{},'topupExchanged')?.value===true;
 const stage=Object.getOwnPropertyDescriptor(failure??{},'topupStage')?.value;
 const code=Object.getOwnPropertyDescriptor(failure??{},'code')?.value;
 if(stage==='swap'&&!exchanged&&code==='BB_ETH_REQUEST_CANCELLED')return 'ETH exchange cancelled. No ETH was spent.';
 if(!exchanged||stage==='claim')return message;
 const prefix=code==='BB_ETH_REQUEST_CANCELLED'||stage==='approval'||stage==='quote'?
  'Your ETH exchange completed. The USDC is in your wallet. ':'Your ETH exchange completed. ';
 return prefix+(message??'Continue this top-up to finish adding your credit.');
}

function topupFailure(error,stage,exchanged=false){
 const code=Object.getOwnPropertyDescriptor(error??{},'code')?.value,providerCode=Object.getOwnPropertyDescriptor(error??{},'providerCode')?.value,ethereumStage=Object.getOwnPropertyDescriptor(error??{},'ethereumStage')?.value;
 const safeProvider=['ACTION_REJECTED','INSUFFICIENT_FUNDS','CALL_EXCEPTION','NETWORK_ERROR','SERVER_ERROR','TIMEOUT','UNKNOWN_ERROR','NONCE_EXPIRED','REPLACEMENT_UNDERPRICED','UNSUPPORTED_OPERATION','BAD_DATA','4001','4100','4900','4901','-32002'].includes(providerCode),safeStage=['read','preflight','wallet','confirmation'].includes(ethereumStage);
 return Object.assign(new Error('Credit purchase could not be completed.',{cause:error}),{code:typeof code==='string'?code:'ROLLING_TOPUP_FAILED',...(fundingPaymentStates.has(Object.getOwnPropertyDescriptor(error??{},'fundingPaymentState')?.value)?{fundingPaymentState:Object.getOwnPropertyDescriptor(error,'fundingPaymentState').value}:{}),topupStage:stage,topupExchanged:exchanged,...(safeProvider?{providerCode}:{}),...(safeStage?{ethereumStage}:{})});
}

// Continue only after each preceding Ethereum transaction is confirmed. Each
// send still requires its own wallet approval; no failed payment is retried.
export async function runTopupPayment(cap,input,quote,onStep=()=>{}){
 let current=quote,exchanged=quote.exchanged===true;
 for(const phase of ['swap','approval','deposit']){
  if(current.phase!==phase)continue;
  let stage=phase;
  try{
   await onStep(phase);
   const result=await cap.confirm({onSubmitted:()=>onStep('confirmation')});
   if(phase==='deposit')return result;
   if(phase==='swap'?!result.swapped:!result.approved)throw Error('Unexpected payment result.');
   if(phase==='swap')exchanged=true;
   stage='quote';current=await cap.prepare(input);
   if(!(phase==='swap'?['approval','deposit']:['deposit']).includes(current.phase))throw Error('Unexpected payment step.');
  }catch(error){throw topupFailure(error,stage,exchanged);}
 }
 throw topupFailure(Error('No payment prepared.'),'quote');
}

const message='This action could not be completed. Your draft is saved. If you already sent it, check its status before trying again.';

/** loadRuntime returns the trusted account facade/getAccount/createSession binding.
 * getAccount values are used only as an unlocked boolean, never rendered or logged.
 * close hides the dialog; Sign out ends custody explicitly. No transaction auto-retry.
 * Workflow restoration is the production application's encrypted journal, not DOM
 * state or localStorage. A replaced page discovers it through readAccountStatus.
 * Profile edits capture readProfile versions only on explicit selection/check.
 * Saved-item state belongs to the current account and encrypted offchain client.
 * It is presentation data and never authorizes native transactions.
 * Uploaded bytes come from immutable previewBlob; recovery validates the saved
 * raster but displays its ORIGINAL Blob, never the validator's re-encoded bytes.
 */
export function mountRollingWalletPanel({loadRuntime,onPublicEffect=()=>{},onPrivateChange=()=>{},onIncludedPostRendered=()=>false}){
 if(typeof loadRuntime!=='function'||typeof onPublicEffect!=='function'||typeof onPrivateChange!=='function'||typeof onIncludedPostRendered!=='function')throw Error('Wallet panel configuration unavailable.');
 const runtimeFailure=Object.freeze({}),connectionFailure=Object.freeze({}),avatarFailure=Object.freeze({}),rulesFailure=Object.freeze({});
 const readPublic=createPublicReader(),rulesInFlight=new Map();
 let postingRules=null,rulesScope=null,updateRules=()=>{};
 let initializationAttempt=0,setupMode=null;
 let runtimePending=null,initializationPending=null,initializing=false,connectPending=null;
 let postingInProgress=false,actionInProgress=false,actionOperation=null,operationSettled=Promise.resolve();
 let bokHost=null,updateBokForm=()=>{},bokRefreshNeeded=false;
 const ownBokPosts=new Map();
 let identityHost=null,inlineCreation=false,accountSettingsOpen=false,selectedName='0',selectedLabel='Anonymous',createdNameFeedback=null;
 const actionFeedback=el('span',{class:'inline-action-feedback',role:'status','aria-live':'polite',hidden:''});
 const identityControls=el('div',{class:'posting-name-controls'}),inlineName=el('section',{class:'inline-name',hidden:''});
 const postingCreditControls=el('div',{class:'posting-credit',hidden:''});
 let postingCreditPending=null,postingCreditAttempt=null;
 const likes=new Map(),likeWanted=new Set(),likeAttempted=new Map(),pendingLikes=new Map();let likesPending=null,likeFeedKey=null;
 let runtime,session,busy=false,blocked=false,invalidated=false,reloadRequired=false,returnFocus;
 let depositRefundPage=null;
 let balances=null,bokAccounting=null,accountingCheck=null,bokExitAmount='',refundQuote=null,withdrawalActive=false,pendingWithdrawal=null,refundReadiness=null,refundWatch=null;
 let topupKind='private-fee',topupQuote=null,topupInputs={amount:''},topupQuoteKey=null,topupQuotePending=null,topupQuoteError='',topupSaved=null,updateTopupQuote=()=>{};
 let moderatorStatus=null,bokStatus=null,status=null,intent=null,identities=[],identityRecords=[],cursor=0,error='',notice='',draft={type:'post',subboard:'0',content:''};
 let includedObservation=null,includedRevision=null,pendingPostReveal=null;
 function observeIncludedAction(snapshot,confirmed){
  if(!Number.isSafeInteger(snapshot?.number)||!/^0x[0-9a-f]{64}$/.test(snapshot?.hash))return;
  const watermark=Number.isSafeInteger(confirmed?.number)&&/^0x[0-9a-f]{64}$/.test(confirmed?.hash)?confirmed.number+':'+confirmed.hash:'none';
  includedRevision=snapshot.number+':'+snapshot.hash+':'+watermark;requestIncludedObservation();
 }
 function requestIncludedObservation(){
  const active=session,epoch=accountEpoch;if(!active||typeof active.observeIncluded!=='function'||!unlocked())return;
  // Likes retain their own observation after another action takes over the
  // general feedback slot. All observations are display-only and nonblocking.
  for(const target of new Set([includedObservation,...pendingLikes.values()])){
   if(!target)continue;const revision=includedRevision??'included:'+target.txHash;
   if(target.pending||target.observed===revision)continue;target.observed=revision;
   const post=target.action?.type==='like'?BigInt(target.action.post).toString():null;
   const reading=Promise.resolve().then(()=>active.observeIncluded({txHash:target.txHash,inclusion:target.inclusion})).then(result=>{
    if(epoch!==accountEpoch||active!==session||!unlocked()||result.txHash!==target.txHash)return;
    const ownsFeedback=target===includedObservation,ownsLike=post!==null&&pendingLikes.get(post)===target;if(!ownsFeedback&&!ownsLike)return;
    if(!['confirmed','orphaned','reverted'].includes(result.status))return;
    if(ownsLike){pendingLikes.delete(post);likes.set(post,{liked:result.status==='confirmed',anchor:likeFeedKey});}
    if(ownsFeedback){
     includedObservation=null;actionFeedback.textContent=result.status==='confirmed'?actionLabel(target.action)+': confirmed.':result.status==='reverted'?'The change reverted.':'The change is no longer included.';actionFeedback.hidden=false;
     if(result.status!=='confirmed'){
      profileSnapshot=null;namesLoaded=false;identities=[];identityRecords=[];cursor=0;selectedName='0';selectedLabel='Anonymous';accountRefreshNeeded=true;requestAccountRefresh();if(!busy)render();
     }
    }
    onPrivateChange();
   }).catch(()=>{}).finally(()=>{if(target.pending===reading){target.pending=null;requestIncludedObservation();}});
   target.pending=reading;
  }
 }
 let savedClient=null,savedLoading=null,savedUnsubscribe=null,accountIdentity=null,recoveryInspection=null;
 let fundingAttempt=null,fundingFailureStep=null;
 let fundingQuote=null,fundingQuoteRequested=false,fundingAutomatic=false,fundingActiveCapability=null,fundingInputs={asset:'ETH'};
 let profileSnapshot=null,avatarDraft=null,renderEpoch=0,accountEpoch=0,view='overview',namesLoaded=false,actionsLoaded=false;const previewURLs=new Set();
 const dialog=el('dialog',{class:'account-dialog','aria-labelledby':'rolling-wallet-title','aria-describedby':'rolling-wallet-description'});
 const title=el('h2',{id:'rolling-wallet-title'},'Join rollingchat');
 const closeButton=button('Close account panel',()=>close());closeButton.setAttribute('aria-label','Close account panel');closeButton.replaceChildren(createIcon('close'));
 const content=el('div'),live=el('p',{role:'status','aria-live':'polite',class:'quiet'});
 const description=el('p',{id:'rolling-wallet-description',class:'quiet'});
 // Signup funnel: connect, fund, talk. Shown only while an account is being set up.
 const steps=el('ol',{class:'setup-steps','aria-label':'Account setup steps',hidden:''});
 dialog.append(el('div',{class:'dialog-top'},title,closeButton),steps,description,live,content);
 document.body.append(dialog);
 const bokBalance=createBokBalanceQuery({identity:()=>unlocked()?session:null,read:()=>session.application.readBokStatus(),onChange:()=>{
  bokStatus=bokBalance.snapshot().value;renderBokControls();updateBokForm();updateTopupQuote();if(bokRefreshNeeded&&!bokBalance.pending)requestBokBalance();requestPostingCredit();requestComposerPreparation();
 }});
 function invalidateBokBalance(){bokStatus=null;bokBalance.invalidate();}
 function bokBalanceText(){const {phase,value}=bokBalance.snapshot();return value?.available===true?`${decimal(value.availableCredit,6)} USDC available${phase==='loading'?' · updating':''}`:phase==='loading'?'Checking balance…':phase==='error'?'Balance unavailable':phase==='unavailable'?'Bok is unavailable':'Balance not loaded';}
 function requestBokBalance(refresh=false){
  if(composerPreparation||postingCreditPending||accountRefreshPending||accountRefreshNeeded||topupQuotePending||bokBalance.pending)return;
  if(!initializing&&!busy&&!blocked&&!setupMode&&!intent&&session?.bokConfigured===true&&unlocked()&&(status?.status==='fee-ready'||status?.status==='fee-needed'&&status.depositIds?.length)){
   refresh=refresh||bokRefreshNeeded;bokRefreshNeeded=false;void bokBalance.load({refresh});
  }
 }
 // Public inclusion can precede spendable refunds. Remember the snapshot that
 // first contained a home-feed reply; its parent alone does not tell us the
 // reply's block. Conversation rows provide the exact confirmation directly.
 function observePublicPosts(posts,{checkpoint,confirmationCheckpoint,renderedPosts,revision}={}){
  observeLikeFeed({checkpoint,confirmationCheckpoint,revision});
  observeIncludedAction(checkpoint,confirmationCheckpoint);
  const active=actionOperation;
  if(active?.txHash&&!active.included&&postingTypes.has(intent?.action?.type)&&Array.isArray(renderedPosts))for(const post of renderedPosts){
   const position=post?.position,blockNumber=Number(position?.blockNumber);
   if(position?.txHash===active.txHash&&['pending','confirmed'].includes(post.confirmation)&&
    typeof position.blockNumber==='string'&&/^[1-9][0-9]*$/.test(position.blockNumber)&&
    Number.isSafeInteger(checkpoint?.number)&&blockNumber<=checkpoint.number&&
    (blockNumber!==checkpoint.number||position.blockHash===checkpoint.hash)){
    showIncludedAction({intentId:active.intentId,txHash:active.txHash,blockNumber,blockHash:position.blockHash},{alreadyRendered:true});break;
   }
  }
  const reveal=pendingPostReveal;
  if(reveal?.epoch===accountEpoch&&unlocked()&&!dialog.open&&Array.isArray(renderedPosts))for(const post of renderedPosts){
   const position=post?.position,blockNumber=Number(position?.blockNumber);
   if(field(post?.id)&&position?.txHash===reveal.txHash&&['pending','confirmed'].includes(post.confirmation)&&
    typeof position.blockNumber==='string'&&/^[1-9][0-9]*$/.test(position.blockNumber)&&
    /^0x[0-9a-f]{64}$/.test(position.blockHash)&&Number.isSafeInteger(checkpoint?.number)&&blockNumber<=checkpoint.number&&
    (blockNumber!==checkpoint.number||position.blockHash===checkpoint.hash)){
    // A rendered row supplies the ID; never predict a post before inclusion.
    try{if(onIncludedPostRendered({id:post.id,txHash:reveal.txHash})===true)pendingPostReveal=null;}catch{}break;
   }
  }
  if(!ownBokPosts.size||!Array.isArray(posts)||!unlocked())return;
  for(const post of posts){
   const own=ownBokPosts.get(post?.position?.txHash),invocation=post?.invocation;
   if(own&&field(invocation?.requestId)&&field(invocation?.pluginId)){
    own.requestId=invocation.requestId;own.pluginId=invocation.pluginId;
    const reply=field(invocation.reply)?invocation.reply:null;
    if(own.reply!==reply){own.reply=reply;own.replyBlock=checkpoint?.number??null;own.replyConfirmed=!!reply&&!confirmationCheckpoint;}
   }
  }
  for(const request of ownBokPosts.values()){
   if(request.reply&&confirmationCheckpoint&&Number.isSafeInteger(request.replyBlock))request.replyConfirmed=request.replyBlock<=confirmationCheckpoint.number;
  }
  for(const post of posts)if(post?.bot&&field(post.id))for(const request of ownBokPosts.values()){
   if(request.requestId===post.bot.requestId&&request.pluginId===post.bot.pluginId){
    request.reply=post.id;
    const block=Number(post.position?.blockNumber);
    request.replyBlock=Number.isSafeInteger(block)&&block>=0?block:request.replyBlock;
    request.replyConfirmed=post.confirmation==='confirmed'||post.confirmation===undefined&&!confirmationCheckpoint;
   }
  }
  let changed=false;
  for(const request of ownBokPosts.values()){
   const confirmedReply=request.replyConfirmed?request.reply:null;
   if(request.confirmedReply!==confirmedReply){request.confirmedReply=confirmedReply;changed=true;}
  }
  if(changed){bokRefreshNeeded=true;requestBokBalance();}
 }
 function addBokCredit(){
  if(initializing||busy||!session||!unlocked())return;
  topupKind='bok';topupInputs={amount:''};resetTopupQuote();topupSaved=null;view='topup';clearOperationFeedback();
  if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}render();
 }
 function renderBokControls(){
  if(!bokHost)return;bokHost.replaceChildren();
  if(!session||!unlocked()||session.bokConfigured!==true){bokHost.hidden=true;return;}
  bokHost.hidden=false;
  const balance=el('span',{'data-bok-balance':'','aria-live':'polite'},bokBalanceText());
  bokHost.append(el('strong',{},'Bok balance'),balance);
  if(session.topup?.bok){const add=button('Add credit',addBokCredit);add.disabled=busy||initializing;bokHost.append(add);}
  const phase=bokBalance.snapshot().phase;
  if(phase!=='loading'){const reload=button(phase==='idle'?'Show balance':'Refresh balance',()=>{if(busy||initializing)return;bokBalance.invalidate();requestBokBalance();});reload.disabled=busy||initializing;bokHost.append(reload);}
 }
 function attachBokControls(host){if(!(host instanceof Node))throw Error('Bok balance host unavailable');bokHost=host;renderBokControls();requestBokBalance();}

 function releasePreviews(){updateBokForm=()=>{};renderEpoch++;updateRules=()=>{};for(const url of previewURLs)URL.revokeObjectURL(url);previewURLs.clear();}
 function clearProfileDraft(){profileSnapshot=null;avatarDraft=null;}
 function clearSavedItems(){savedUnsubscribe?.();savedUnsubscribe=null;savedClient?.close();savedClient=null;savedLoading=null;onPrivateChange();}
 function clearPrivateView(){likes.clear();likeWanted.clear();likeAttempted.clear();pendingLikes.clear();likesPending=null;likeFeedKey=null;pendingPostReveal=null;stopRefundWatch();pendingWithdrawal=null;refundReadiness=null;includedObservation=null;includedRevision=null;actionFeedback.textContent='';actionFeedback.hidden=true;composerAttempt=null;composerAbort?.abort();ownBokPosts.clear();bokRefreshNeeded=false;selectedName='0';selectedLabel='Anonymous';stopFunding();depositRefundPage=null;balances=null;bokAccounting=null;bokExitAmount='';refundQuote=null;topupQuote=null;topupQuoteKey=null;topupQuoteError='';topupSaved=null;topupInputs={amount:''};fundingQuote=null;fundingQuoteRequested=false;fundingAttempt=null;fundingFailureStep=null;dialog.removeAttribute('data-rolling-funding');fundingInputs={asset:'ETH'};initializationAttempt++;dialog.removeAttribute('data-rolling-initialization');recoveryInspection=null;accountEpoch++;accountIdentity=null;bokBalance.invalidate();content.replaceChildren();moderatorStatus=null;clearSavedItems();status=null;bokStatus=null;intent=null;identities=[];identityRecords=[];cursor=0;namesLoaded=false;actionsLoaded=false;view='overview';draft={type:'post',subboard:'0',content:''};releasePreviews();clearProfileDraft();}
 function checkAccount(epoch){if(epoch!==accountEpoch||!unlocked())throw connectionFailure;}
 function privateStatus(){if(!unlocked())return 'locked';return savedClient?.snapshot()?'complete':'recovering';}
 function savedItemsSnapshot(){return unlocked()?savedClient?.snapshot()??null:null;}
 function preferenceEnabled(kind,target){const key={1:'bookmarks',2:'followedBoards',3:'followedNames'}[kind],saved=savedItemsSnapshot();return key&&saved&&field(target)?saved[key].includes(BigInt(target).toString()):null;}
 async function ensureSavedItems(){
  if(savedClient)return savedClient;if(savedLoading)return savedLoading;
  const epoch=accountEpoch,active=runtime;checkAccount(epoch);if(typeof active.savedItems!=='function')throw connectionFailure;
  savedLoading=active.savedItems().then(client=>{try{checkAccount(epoch);if(runtime!==active)throw connectionFailure;}catch(error){client.close();throw error;}savedClient=client;savedUnsubscribe=client.subscribe(()=>{if(epoch!==accountEpoch||runtime!==active||!unlocked())return;onPrivateChange();if(view==='preferences'&&!busy)render();});onPrivateChange();return client;}).finally(()=>{if(epoch===accountEpoch)savedLoading=null;});return savedLoading;
 }
 async function loadSavedItems(){try{const client=await ensureSavedItems();if(!client.snapshot())await client.ready;return !!savedItemsSnapshot();}catch{return false;}}
 function preferencesView(){
  content.append(paragraph('Follows and bookmarks are saved immediately on this device and synced in encrypted form to your other browsers.'));
  const state=savedClient?.status();content.append(paragraph(state==='ready'?'Saved items are synced.':state==='syncing'?'Syncing saved items…':state==='unsynced'?'Saved on this device. Sync is unavailable.':state==='unsaved'?'This change could not be saved on this device. Try syncing again.':'Load your saved items to continue.'));
  content.append(button('Sync saved items',()=>{void ensureSavedItems().then(client=>client.refresh()).catch(()=>{notice='Saved items could not sync. Try again.';render();});},true));
 }

 function ownedLabel(id){if(field(id)&&BigInt(id)===0n)return 'Anonymous';const record=identityRecords.find(r=>r.id===id);return record?`${record.first} ${record.last}`:'Selected owned name';}
 function acceptNames(page,append=false){
  if(!Array.isArray(page.identities)||!Array.isArray(page.records)||page.identities.length!==page.records.length)throw Error('Private name records unavailable');
  const records=page.records.map((r,i)=>{if(r.id!==page.identities[i]||!field(r.id)||typeof r.first!=='string'||typeof r.last!=='string'||r.first.length>32||r.last.length>32)throw Error('Invalid private name record');return {id:r.id,first:r.first,last:r.last};});
  if(page.nextCursor!==null&&(!Number.isInteger(page.nextCursor)||page.nextCursor<0||page.nextCursor>0xffffffff-8||append&&page.nextCursor<=cursor))throw Error('Invalid private names cursor');
  const ids=new Set(append?identities:[]);for(const record of records){if(ids.has(record.id))throw Error('Duplicate private name');ids.add(record.id);}
  identityRecords=append?[...identityRecords,...records]:records;identities=identityRecords.map(r=>r.id);cursor=page.nextCursor;
 }
 async function loadNames(append=false){
  const epoch=accountEpoch;checkAccount(epoch);
  const page=await session.application.ownedIdentities({cursor:append?cursor:0});
  checkAccount(epoch);acceptNames(page,append);namesLoaded=true;
 }
 async function checkProfile(name){
  const epoch=accountEpoch;checkAccount(epoch);profileSnapshot=null;let snapshot;try{snapshot=await session.application.readProfile({name});}catch{throw connectionFailure;}
  checkAccount(epoch);
  const version=v=>typeof v==='string'&&/^(?:0|[1-9][0-9]{0,9})$/.test(v)&&BigInt(v)<=0xffffffffn;
  if(!snapshot||!field(snapshot.name)||BigInt(snapshot.name)!==BigInt(name)||!version(snapshot.bioVersion)||!version(snapshot.avatarVersion)||!unlocked())throw Error('Profile version unavailable');
  profileSnapshot={name:snapshot.name,bioVersion:snapshot.bioVersion,avatarVersion:snapshot.avatarVersion};
 }
 function showAvatar(blob,parent,{ready=()=>{},failed=()=>{}}={}){
  const url=URL.createObjectURL(blob);previewURLs.add(url);const image=el('img',{width:'100',height:'100',alt:'Exact avatar bytes to publish'});
  const failure=()=>{URL.revokeObjectURL(url);previewURLs.delete(url);image.replaceWith(paragraph('Avatar preview unavailable.'));failed();};
  image.addEventListener('error',failure,{once:true});image.addEventListener('load',()=>{if(image.naturalWidth===100&&image.naturalHeight===100)ready();else failure();},{once:true});image.src=url;parent.append(image);
 }
 async function blobData(blob){const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length>8192)throw Error('Avatar too large');return btoa(String.fromCharCode(...bytes));}
 function savedAvatarBlob(action){
  const data=action.data;if(typeof data!=='string'||data.length>10924||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw Error('Invalid avatar');
  const raw=atob(data);if(btoa(raw)!==data||raw.length>8192||!raw.length||action.width!==100||action.height!==100)throw Error('Invalid avatar');
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));const type=bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':bytes[0]===82?'image/webp':null;if(!type)throw Error('Invalid avatar');return new Blob([bytes],{type});
 }
 function controlsBusy(value){
  dialog.setAttribute('aria-busy',String(value));
  for(const node of identityControls.querySelectorAll('select,button'))node.disabled=value||!!intent||node.dataset.unavailable==='true';
  for(const host of [dialog,inlineName])for(const node of host.querySelectorAll('button,input,select,textarea'))node.disabled=node.dataset.accountingStop==='true'?!accountingCheck:value||node.dataset.unavailable==='true';
  renderPostingCreditControls();
 }
 let progressNote=false;
 function note(text){
  progressNote=false;
  live.className=setupMode||postingInProgress?'account-setup-progress':'quiet';
  if((setupMode||postingInProgress)&&text)live.replaceChildren(el('span',{class:'account-setup-spinner','aria-hidden':'true'}),el('strong',{},text),el('span',{class:'account-setup-help'},postingInProgress?'Your post is being processed.':'This can take a little while. Keep this page open.'));
  else live.textContent=text;
 }
 function startSetup(){setupMode='wallet';note('Opening your account…');render();}
 function clearOperationFeedback(){error='';notice='';note('');for(const node of content.querySelectorAll('[data-operation-feedback]'))node.remove();}
 let moderatorLookup=null;
 // Optional menu discovery must not lock the presentation. Actual moderator
 // submissions still perform their native authority check before sending.
 function requestModeratorMenu(){
  if(moderatorLookup||moderatorStatus!==null||busy||!session||!unlocked()||typeof session.application.readModeratorStatus!=='function')return;
  const epoch=accountEpoch,active=session;
  const pending=Promise.resolve().then(async()=>{
   if(epoch!==accountEpoch||active!==session||!unlocked())return;
   const value=await active.application.readModeratorStatus();
   if(epoch!==accountEpoch||active!==session||!unlocked())return;
   moderatorStatus={authorized:value?.authorized===true};onPrivateChange();
   if(!busy&&dialog.open&&view==='overview')render();
  }).catch(()=>{}).finally(()=>{if(moderatorLookup===pending)moderatorLookup=null;});
  moderatorLookup=pending;
 }
 async function loadBok(){const epoch=accountEpoch;checkAccount(epoch);await bokBalance.load();checkAccount(epoch);bokStatus=bokBalance.snapshot().value;}
 // View reads stay serialized; refresh and account changes invalidate these private results.
 async function loadView({loadIdentity=false}={}){
  const epoch=accountEpoch;checkAccount(epoch);
  // These are feature reads, not prerequisites for opening/funding an account.
  if(loadIdentity||view==='names'||view==='action'&&['bio','avatar'].includes(draft.type)){
   if(!namesLoaded)await loadNames();
   // Profile edits need the selected owned name, not every remaining page.
   // Explicit identity refresh (including new-name discovery) still exhausts it.
   while(cursor!==null&&(loadIdentity||view!=='action'||!['bio','avatar'].includes(draft.type)||!identities.includes(draft.name)))await loadNames(true);
   if((dialog.open||inlineCreation)&&view==='action'&&['bio','avatar'].includes(draft.type)&&identities.includes(draft.name)&&!profileSnapshot)await checkProfile(draft.name);
  }
  if(view==='action'&&MODERATOR_TYPES.has(draft.type)&&moderatorStatus===null){
   moderatorStatus=typeof session.application.readModeratorStatus==='function'?await session.application.readModeratorStatus():{authorized:false};checkAccount(epoch);onPrivateChange();
  }
  actionsLoaded=true;note('');
 }
 function viewReady(){return rollingViewReady({view,type:draft.type,identityAttached:!!identityHost,namesLoaded,cursor,moderatorStatus,actionsLoaded})&&!(view==='action'&&['bio','avatar'].includes(draft.type)&&(!profileSnapshot||profileSnapshot.name!==draft.name));}
 function rememberBalances(value){balances=value;if(status&&typeof value?.fee?.available==='string'&&/^(0|[1-9][0-9]*)$/.test(value.fee.available))status={...status,privateFeeCredit:value.fee.available};}
 function selectView(next){if(busy)return;clearOperationFeedback();view=next;if(next==='balances'&&!balances){void work(async()=>{const epoch=accountEpoch;const value=await session.application.readBalances({cursor:0});checkAccount(epoch);rememberBalances(value);});return;}if(next==='preferences'){render();void loadSavedItems();}else if(viewReady())render();else void work(loadView);}
 let composerPreparation=null,composerAbort=null,composerAttempt=null,composerOpening=0;
 // Commit native private-state discovery before Post, without scanning balances
 // or retaining an account lease while the user edits. Public checkpoints do not
 // restart speculative work; Post still checks state, policy and fees afresh.
 function requestComposerPreparation(){
  if(postingCreditPending||composerPreparation||busy||initializing||blocked||status?.status!=='fee-ready'||intent||!dialog.open||view!=='action'||!['post','reply','quote','repost'].includes(draft.type)||!session||session.busy||!unlocked()||typeof session.preparePostingState!=='function'||accountRefreshPending||bokBalance.pending||topupQuotePending)return;
  const deposit=draft.deposit;if(typeof deposit!=='string'||!deposit)return;
  const key=accountEpoch+':'+composerOpening+':'+deposit;if(composerAttempt===key)return;
  composerAttempt=key;const epoch=accountEpoch,active=session,opening=composerOpening,controller=new AbortController();composerAbort=controller;
  const pending=Promise.resolve().then(async()=>{
   if(epoch!==accountEpoch||active!==session||deposit!==draft.deposit||busy||initializing||blocked||intent||status?.status!=='fee-ready'||view!=='action'||!['post','reply','quote','repost'].includes(draft.type)||!dialog.open||!unlocked())return;
   const finish=beginRollingMeasure('composer.prepare');try{
    const credit=await active.preparePostingState(deposit,{refreshFeeCredit:typeof status?.privateFeeCredit!=='string',signal:controller.signal});
    if(epoch===accountEpoch&&active===session&&opening===composerOpening&&deposit===draft.deposit&&dialog.open&&view==='action'&&['post','reply','quote','repost'].includes(draft.type)&&unlocked()&&typeof credit?.availableCredit==='string'&&/^(0|[1-9][0-9]*)$/.test(credit.availableCredit)){status={...status,privateFeeCredit:credit.availableCredit};updatePostingBalance();renderPostingCreditControls();}
   }finally{finish();}
  }).catch(()=>{}).finally(()=>{if(composerPreparation===pending){composerPreparation=null;if(composerAbort===controller)composerAbort=null;}if(epoch===accountEpoch&&active===session){requestComposerPreparation();requestBokBalance();}});
  composerPreparation=pending;
 }
 let accountRefreshPending=null,accountRefreshNeeded=false,updatePostingBalance=()=>{};const transactionTiming=rollingStageObserver();
 // Opening the composer or a public checkpoint must not queue a full private
 // balance scan ahead of Post. Submission synchronizes and validates its state.
 function requestAccountRefresh(){
  if(!accountRefreshNeeded||accountRefreshPending||postingCreditPending||busy||!session||!unlocked())return;
  accountRefreshNeeded=false;const epoch=accountEpoch,active=session,finishRefresh=beginRollingMeasure('account.status-refresh');
  accountRefreshPending=Promise.resolve().then(async()=>{
   try{const next=await active.application.readAccountStatus();checkAccount(epoch);if(session!==active)return;status=next;intent=next.intent??null;setPendingWithdrawal(next.pendingWithdrawal??null);}
   catch{if(epoch===accountEpoch)accountRefreshNeeded=true;}
  }).finally(()=>{finishRefresh();accountRefreshPending=null;if(epoch===accountEpoch&&unlocked()){updatePostingBalance();renderPostingCreditControls();requestPostingCredit();renderBokControls();requestBokBalance();}});
 }
 async function work(fn,failureMessage=actionFailure,{posting=false,action=false}={}){
  if(busy)return;if(posting)composerAbort?.abort();createdNameFeedback=null;const finishTiming=posting?beginRollingMeasure('post.interaction'):action?beginRollingMeasure('action.interaction'):()=>{};let finishOperation;operationSettled=new Promise(resolve=>{finishOperation=resolve;});const operationFocus=document.activeElement;busy=true;postingInProgress=posting;actionInProgress=action;actionOperation=null;clearOperationFeedback();controlsBusy(true);if(posting){note('Posting…');for(const button of content.querySelectorAll('[data-action-review]'))button.textContent='Posting…';}
  try{if(initializationPending)await initializationPending;await composerPreparation;await moderatorLookup;await accountRefreshPending;await postingCreditPending;await bokBalance.settled();await topupQuotePending;await fn();}catch(failure){notice='';stopFunding();recoveryInspection=null;note('');error=failure===runtimeFailure?'Account tools could not load. Reload the page to try again.':failure===rulesFailure?'Current board rules are unavailable, changed, or reject new posts. Review the rules below before continuing. Nothing was sent.':failure===connectionFailure?'Your account could not connect. Check your connection and try again.':failure===avatarFailure?'This image could not be prepared. Choose a smaller still PNG, JPEG or WebP image.':failureMessage(failure)??message;}finally{
   try{if((error||actionOperation?.failed)&&pendingPostReveal?.txHash===actionOperation?.txHash)pendingPostReveal=null;if(actionOperation?.included&&!postingInProgress&&(error||actionOperation.failed)){actionFeedback.textContent=error?(actionOperation.confirmed?'Confirmed. Account details could not refresh.':'The change could not be confirmed.'):actionOperation.resultStatus==='reverted'?'The change reverted.':'Confirmation is still pending.';actionFeedback.hidden=false;}if(setupMode){setupMode=null;note('');}if(actionOperation?.included&&actionOperation.modal&&actionOperation.epoch===accountEpoch&&unlocked()&&(error||intent||actionOperation.failed)&&!dialog.open)dialog.showModal();postingInProgress=false;actionInProgress=false;actionOperation=null;if(invalidated||reloadRequired)clearPrivateView();if(progressNote)note('');busy=false;render(document.activeElement===document.body?operationFocus:document.activeElement);
   const created=createdNameFeedback;createdNameFeedback=null;
   if(created&&created.epoch===accountEpoch&&created.name===selectedName&&unlocked()){
    const selector=identityControls.querySelector('select');if(selector?.isConnected){selector.focus({preventScroll:true});selector.scrollIntoView({block:'nearest'});}
   }
   // Failed actions must expose their feedback even when the form was scrolled.
   if(error&&dialog.open){const alert=content.querySelector('[role=alert]');alert.focus({preventScroll:true});alert.scrollIntoView({block:'nearest'});}}finally{transactionTiming.complete();finishTiming();finishOperation();requestAccountRefresh();requestPostingCredit();requestComposerPreparation();}
  }
 }
 function unlocked(){if(invalidated||reloadRequired)return false;const current=runtime?runtime.getAccount():null;if(accountIdentity&&current!==accountIdentity){invalidated=true;clearPrivateView();note('The account changed. Reload before continuing.');return false;}return !!current;}
 async function refresh(openingStatus){
  const epoch=accountEpoch;checkAccount(epoch);balances=null;bokAccounting=null;recoveryInspection=null;invalidateBokBalance();blocked=true;
  const next=openingStatus??await session.application.readAccountStatus();
  checkAccount(epoch);status=next;intent=next.intent??null;setPendingWithdrawal(next.pendingWithdrawal??null);
  if(next.status==='recovering'){
   if(!intent?.intentId)throw Error('Missing recovery intent');
  }
  blocked=false;if(!setupMode)note('');onPrivateChange();
  if(!intent)await loadView();
 }
 function connect(){return connectPending??=connectAccount().finally(()=>{connectPending=null;});}
 async function connectAccount(){
  const epoch=accountEpoch,attempt=++initializationAttempt;let needsFundingQuote=false,openingQuoteError;
  dialog.removeAttribute('data-rolling-initialization');
  if(setupMode)note('Connecting to the network…');
  try{
  if(!accountIdentity)accountIdentity=runtime.getAccount();
  // Offchain saved items do not wait for PXE registration or financial readiness.
  void loadSavedItems();
  if(!session){blocked=true;session=await runtime.createSession({onProgress:progress=>{
   const diagnostic=projectRollingInitialization(progress);
   if(epoch!==accountEpoch||invalidated||reloadRequired||!unlocked()||(['private-refresh','funding-claim'].includes(diagnostic?.stage)?!session:attempt!==initializationAttempt))return;
   if(progress?.stage==='included'){showIncludedAction(progress);return;}
   if(progress?.stage==='submitting'&&actionOperation?.epoch===accountEpoch&&progress.intentId===actionOperation.intentId&&
    /^0x[0-9a-f]{64}$/.test(progress.txHash)&&!actionOperation.txHash)actionOperation.txHash=progress.txHash;
   if(diagnostic)dialog.setAttribute('data-rolling-initialization',JSON.stringify(diagnostic));
   // Optional background reads keep diagnostics, but do not own foreground progress.
   if(!busy&&!initializing&&!setupMode)return;
   if(!busy&&(bokBalance.pending||accountRefreshPending)&&diagnostic?.stage==='private-refresh')return;
   const fundingKind=view==='topup'&&topupKind==='bok'||intent?.action?.type==='claim-bok'?'bok':'posting',credit=fundingKind==='bok'?'Bok credit':'posting balance';
   if(diagnostic?.stage==='funding-claim'){
    if(fundingAttempt?.epoch===epoch&&fundingAttempt.session===session){
     if(diagnostic.state==='failed')fundingFailureStep=diagnostic;
     if(diagnostic.step==='recover'&&diagnostic.state==='complete'&&fundingAttempt.paymentState!=='credited')fundingAttempt.paymentState='confirmed';
     fundingAttempt.step=diagnostic.step;
    }
    // The continuation's actual stage supersedes the earlier Ethereum notice.
    notice='';for(const node of content.querySelectorAll('[data-operation-feedback]'))if(node.getAttribute('role')!=='alert')node.remove();
   }
   if(withdrawalActive)return;
   const stages=fundingAutomatic||fundingActiveCapability?{estimating:`Checking the cost of adding your ${credit}…`,preparing:`Preparing your ${credit}…`,proving:`Preparing your ${credit}…`,submitting:`Adding your ${credit}…`,confirming:`Waiting for your ${credit} to confirm…`}:postingInProgress?{'posting-waiting':'Waiting for the network to unlock posting…',estimating:'Preparing your post…',preparing:'Preparing your post…',proving:'Creating the proof for your post…',submitting:'Sending your post…',confirming:'Waiting for your post to confirm…'}:{estimating:'Checking the cost…',preparing:actionInProgress?'Preparing your action…':'Loading your account…',proving:'Creating the proof…',submitting:'Sending your action. Keep this page open…',confirming:'Waiting for confirmation…'};
   let stage;try{const own=Object.getOwnPropertyDescriptor(progress??{},'stage');if(own&&Object.hasOwn(own,'value')&&typeof own.value==='string')stage=own.value;}catch{}
   transactionTiming.progress(stage);
   const setupMessages={'account-lock':'Opening your account…','trusted-node':'Connecting to the network…',deployment:'Checking the network…','account-derive':'Preparing your private account…','store-open':'Saving your account on this device…','pxe-create':'Preparing your private account…','account-register':'Preparing your private account…','contracts-register':'Preparing your private account…','initial-sync':'Syncing your account with the network…','journal-open':'Finishing account setup…','wallet-bind':'Finishing account setup…','account-manager':'Finishing account setup…','application-bind':'Finishing account setup…'};
   note(setupMode&&diagnostic?.stage==='session-initialization'?(setupMessages[diagnostic.step]??'Finishing account setup…'):setupMode&&diagnostic?.stage==='private-refresh'?'Checking your account balance…':diagnostic?.stage==='funding-claim'?fundingProgressMessage(diagnostic,fundingKind):Object.hasOwn(stages,stage)?stages[stage]:fundingAutomatic||fundingActiveCapability?(diagnostic?.stage==='private-refresh'?`Checking your ${credit}…`:`Adding your ${credit}…`):postingInProgress?'Posting…':'Loading your account…');progressNote=true;
  }});}
  if(setupMode&&runtime.startedFreshAccount?.()&&session.funding){
   // An explicit new test account has a new derivation nonce. Its payment does
   // not require private note discovery. Returning accounts still obtain their
   // actual state; missing local records never mean an empty account.
   status={status:'fee-needed',depositIds:[]};intent=null;blocked=false;view='funding';
   needsFundingQuote=true;
  }else if(setupMode&&session.funding&&typeof session.prepareOpening==='function'){
   const opening=await session.prepareOpening({asset:fundingInputs.asset});checkAccount(epoch);
   await refresh(opening.status);checkAccount(epoch);
   if(opening.quote||opening.quoteError){view='funding';fundingQuoteRequested=true;fundingQuote=opening.quote??null;openingQuoteError=opening.quoteError;}
  }else await refresh();checkAccount(epoch);note('');
  }catch{if(attempt===initializationAttempt)initializationAttempt++;throw connectionFailure;}
  // Connection succeeded. A quote failure must retain its own safe diagnosis.
  if(openingQuoteError)throw openingQuoteError;
  if(needsFundingQuote){try{await prepareFundingQuote();checkAccount(epoch);}catch(failure){checkAccount(epoch);throw failure;}}
 }
 function ensureRuntime(){
  return runtimePending??=Promise.resolve().then(async()=>{
   let loaded;try{loaded=await loadRuntime();}catch{throw runtimeFailure;}
   if(!loaded?.account||typeof loaded.getAccount!=='function'||typeof loaded.createSession!=='function')throw runtimeFailure;
   runtime=loaded;
   runtime.account.configure({requireEth:false,canEndSession:()=>!session?.busy,onSetupError:()=>{error=message;},onChange:value=>{
    if(value?.invalidated===true||accountIdentity&&runtime.getAccount()!==accountIdentity){invalidated=true;runtime.invalidate?.();clearPrivateView();note('The account changed. Reload before continuing.');render();}
   }});
   return runtime;
  });
 }
 function initialize(){
  if(initializationPending)return initializationPending;
  initializing=true;
  initializationPending=Promise.resolve().then(async()=>{
   await ensureRuntime();
   if(runtime.startingTestAccount?.()&&!dialog.open){returnFocus=document.activeElement;dialog.showModal();closeButton.focus();}
   if(!unlocked()&&typeof runtime.restoreAccount==='function')await runtime.restoreAccount();
   if(!unlocked())return false;
   await connect();return true;
  }).catch(failure=>{
   error=failure===runtimeFailure?'Account tools could not load. Reload the page to try again.':failure!==connectionFailure&&session&&view==='funding'&&fundingQuoteRequested?(fundingFailureText(failure)??'The setup price could not be loaded. Try again. No payment was sent.'):'Your account could not connect. Check your connection and try again.';
   return false;
  }).finally(()=>{initializing=false;note('');render();requestComposerPreparation();});
  render();return initializationPending;
 }
 function privacyDetails(){return el('details',{class:'account-details'},el('summary',{},'How privacy works'),paragraph('Posts are public. Other readers cannot see which posts belong to the same anonymous account. This version uses a trusted proving service that can see the private data it processes.'));}
 function walletChoices(target,connectWallet){
  const choices=runtime.fundingWallets();
  if(!Array.isArray(choices)||choices.length>32)throw connectionFailure;
  if(!choices.length)target.append(paragraph('No wallet extension found. Open this page in a browser with MetaMask, Phantom or another Ethereum wallet installed.'));
  const list=el('div',{class:'wallet-choices'});
  for(const choice of choices){
   if(typeof choice.id!=='string'||typeof choice.name!=='string'||choice.name.length>128)throw connectionFailure;
   const connectButton=button('Connect '+choice.name,()=>connectWallet(choice));
   connectButton.className+=' wallet-choice';
   const icon=el('span',{class:'wallet-icon','aria-hidden':'true'});
   // Provider icons remain image data, never wallet-supplied markup.
   if(typeof choice.icon==='string'&&/^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(choice.icon)&&choice.icon.length<131072)icon.append(el('img',{src:choice.icon,alt:'',width:'32',height:'32'}));
   else icon.textContent=/metamask/i.test(choice.name)?'🦊':/phantom/i.test(choice.name)?'👻':/coinbase/i.test(choice.name)?'🔵':'◈';
   connectButton.insertBefore(icon,connectButton.childNodes[0]);list.append(connectButton);
  }
  target.append(list,button('Refresh wallet list',()=>render()));
 }
 function custody(){
  content.append(paragraph(runtime.startingTestAccount?.()?'Connect your wallet to start a new test account with an empty posting balance.':'Connect your Ethereum wallet to open your account. Use the same wallet whenever you come back.'));
  if(typeof runtime.fundingWallets!=='function'||typeof runtime.signInWallet!=='function'){content.append(paragraph('Wallet sign-in is unavailable. Reload the page to try again.'));return;}
  walletChoices(content,choice=>void work(async()=>{
   startSetup();note('Approve sign-in in '+choice.name+'…');await runtime.signInWallet(choice.id);await connect();
   if(!intent&&['fee-needed','collateral-pending'].includes(status?.status)){
    view=status.depositIds?.length?'topup':'funding';topupKind='private-fee';
   }
  },failure=>failure!==connectionFailure&&session&&view==='funding'&&fundingQuoteRequested?(fundingFailureText(failure)??'The setup price could not be loaded. Try again. No payment was sent.'):accountFailure(failure)));
  if(runtime.canStartTestAccount&&!runtime.startingTestAccount?.())content.append(button('Start new test account',startTestAccount));
  content.append(privacyDetails());
 }
 function startTestAccount(){
  if(busy||intent)return;
  location.hash='#/new-account';location.reload();
 }
 function signOut(){return work(async()=>{
  blocked=true;clearPrivateView();render();
  if(session){await session.close();session=null;}
  await runtime.account.endSession();reloadRequired=true;clearPrivateView();note('Signed out.');
 });}
 function savedResumeReview(snapshot){
  const saved=snapshot.exactResume,record=snapshot.intent,hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
  if(saved?.status!=='resumable'||snapshot.status!=='unknown'||!hash(saved.txHash)||saved.txHash!==snapshot.currentTxHash||
   !record.action?.type||['prepared','cancelled','replacement-prepared'].includes(record.status))return null;
  if(typeof saved.maximumFee!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(saved.maximumFee))return null;
  const review=record.replacementReview;
  if(saved.feeSource==='original'){if(review||saved.maximumFee!==record.maximumFee)return null;}
  else if(saved.feeSource==='replacement'){if(!review||!hash(review.sourceTxHash)||saved.txHash===review.sourceTxHash||saved.maximumFee!==review.maximumFee)return null;}
  else return null;
  return {txHash:saved.txHash,maximumFee:saved.maximumFee,feeSource:saved.feeSource};
 }
 function showSavedResume(snapshot,review,ready){
  content.append(el('h3',{},'Review the saved transaction'),paragraph('This sends the exact transaction already saved on this device. It does not create a new transaction or request a new fee quote.'),
   el('p',{class:'recovery-values'},'Saved transaction: '+review.txHash),
   el('p',{class:'recovery-values'},`${review.feeSource==='replacement'?'Previously reviewed replacement':'Previously approved'} maximum fee: ${review.maximumFee} fee-juice units. This is the saved ceiling, not an additional fee or a record of a charge.`));
  const confirm=button('Confirm saved transaction and send',()=>void work(async()=>{
   if(!ready())throw connectionFailure;
   await checkPostingRules(intent.action,{confirm:true});
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);
   if(recoveryInspection!==snapshot||snapshot.intent.intentId!==id)throw connectionFailure;
   const expectedTxHash=review.txHash;recoveryInspection=null;notice='';intent={...intent,status:'unknown'};blocked=true;
   note('Sending the saved transaction. Keep this page open; do not send again.');
   try{const result=await session.application.resumeSaved(id,{expectedTxHash});checkAccount(epoch);await receive(result);}
   catch{throw Error('Saved transaction outcome unknown');}
  }),true);confirm.dataset.actionConfirm='';confirm.dataset.unavailable=String(!ready());confirm.disabled=busy||!ready();content.append(confirm);return confirm;
 }
 function showRecoveryOptions(ready=()=>true){
  content.append(button('Check recovery options',()=>void work(async()=>{
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);recoveryInspection=null;
   const result=await session.application.inspectRecovery(id);checkAccount(epoch);
   if(result?.intent?.intentId!==id||!Array.isArray(result.attempts))throw connectionFailure;
   recoveryInspection=result;notice='Recovery options checked. No transaction was sent.';
  })));
  const snapshot=recoveryInspection;if(!snapshot||snapshot.intent.intentId!==intent.intentId)return;
  const statuses={'aggregate-claim-review':'The original funding payment can be reviewed for a renewed private claim. No new Ethereum payment is needed.','pre-proof-review':'The interrupted preparation can be reviewed on this device.',pending:'This update is still pending. Keep your recovery file and check again.',unknown:'This update is still unresolved. Keep your recovery file and check again. Do not send another copy.',canonical:'An attempt is included in the verified chain. Check the existing transaction to reconcile it; do not send a replacement.',empty:'No signed transaction was found. Keep the saved action and recovery file; a replacement is not available.',
   'context-changed':'The saved action no longer matches its required context. It cannot be repeated safely.', 'history-unavailable':'Earlier transaction details are unavailable. Keep your recovery file; a replacement cannot be reviewed safely.', 'limit-reached':'This update has reached its replacement limit. Keep your recovery file; no further replacement can be sent.',
   'replacement-available':'The earlier attempts can no longer be included. Review this saved update and a new maximum fee before sending a replacement.'};
  const savedReview=savedResumeReview(snapshot);
  const displayStatus=snapshot.status==='unknown'&&['pending','canonical','empty'].includes(snapshot.exactResume?.status)?snapshot.exactResume.status:snapshot.status;
  content.append(paragraph(savedReview?'The saved transaction can be sent without preparing another. Review its saved fee ceiling before confirming.':snapshot.exactResume?.status==='context-changed'?'The saved transaction no longer matches its required context. Keep your recovery file; it cannot be sent safely.':statuses[displayStatus]??statuses.unknown));
  const details=el('details',{class:'recovery-values'},el('summary',{},'Original action and transaction history'));
  for(const attempt of snapshot.inclusionHistory??[]){
   details.append(paragraph('Earlier transaction: '+attempt.txHash));
   for(const fact of attempt.inclusions??[])details.append(paragraph(`Previously included at block ${fact.blockNumber}: ${fact.transactionFee} fee-juice units; result ${fact.executionResult}. Historical record only; this does not show a current charge.`));
  }
  if(!(snapshot.inclusionHistory??[]).length)details.append(paragraph('No earlier inclusion or fee record is available.'));
  content.append(details);
  if(savedReview)return showSavedResume(snapshot,savedReview,ready);
  if(['pre-proof-review','aggregate-claim-review'].includes(snapshot.status)){
   content.append(paragraph(snapshot.status==='aggregate-claim-review'
    ?'Recovery will recheck the original payment and its one-time fee claim. An already consumed claim cannot be charged again. Review the saved action and renewed maximum fee before confirming.'
    :'This device retained an interrupted attempt before any signed transaction was saved. Review the saved action and a renewed maximum fee before confirming.'));
   const review=button('Review interrupted action',()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);if(recoveryInspection!==snapshot)throw connectionFailure;
    recoveryInspection=null;const result=await session.application.prepareInterrupted(id);checkAccount(epoch);
    intent=result;blocked=false;notice='Interrupted action prepared for review. Nothing has been sent. Check the renewed maximum fee before confirming.';
   }),true);review.dataset.unavailable=String(!ready());review.disabled=busy||!ready();content.append(review);return review;
  }
  if(snapshot.status!=='replacement-available')return;

  const review=button('Review replacement',()=>void work(async()=>{
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);
   const input={expectedTxHash:snapshot.currentTxHash,};
   recoveryInspection=null;const result=await session.application.prepareReplacement(id,input);checkAccount(epoch);
   recoveryInspection=null;intent=result;blocked=false;notice='Replacement prepared for review. Nothing has been sent. Check the new maximum fee before confirming.';
  }),true);
  content.append(review);
 }
 async function checkBokAccounting(){
  const epoch=accountEpoch;checkAccount(epoch);bokAccounting=null;
  // The application's bounded accounting API has no abort argument. Stop fences
  // its result and the next read; the current call must settle before releasing busy.
  const scan=accountingCheck={stopped:false};let cursor=0;
  note('Checking all owned Bok requests. No partial total is presented.');render();
  try{for(;;){
   const value=await session.application.readBokAccounting({cursor});checkAccount(epoch);
   if(scan.stopped){note('Request accounting stopped. No partial totals were used.');return;}
   if(value?.complete===true){bokAccounting=value;balances={...balances,bok:{...balances.bok,available:value.available}};note('All owned Bok requests have been checked.');return;}
   if(value?.complete!==false||!['owned-requests','public-accounting'].includes(value.phase)||typeof value.nextCursor!=='string'||!value.nextCursor.length||value.nextCursor===cursor)throw connectionFailure;
   bokAccounting=value;cursor=value.nextCursor;render();
  }}catch(failure){bokAccounting=null;throw failure;}finally{accountingCheck=null;}
 }
 function unfinishedDepositsView() {
  if (!session.depositRefunds || pendingWithdrawal) return;
  const section = el('section',{class:'account-details'},el('h3',{},'Unfinished signup'));
  section.append(paragraph('Return a deposit from a signup you did not finish. You can keep using your current account.'),paragraph('Max cost '+compactAmount(session.postingFeeLimit,18,4,true)+' posting credits. Ethereum gas is paid separately.'));
  const load = async offset => {
   const epoch = accountEpoch;
   const page = await session.depositRefunds.list({offset});
   checkAccount(epoch);
   depositRefundPage = page;
  };
  const connected = fundingWalletView(section,'Connect the wallet that paid the deposit.');
  if (connected) section.append(button('Find refundable deposits',()=>void work(()=>load(0))));
  if (depositRefundPage) {
   const refundable = depositRefundPage.deposits.filter(d=>['available','requested'].includes(d.status));
   if (!refundable.length) section.append(paragraph('No unfinished deposits on this page.'));
   for (const deposit of refundable) {
    section.append(button('Refund '+decimal(deposit.amount,18)+' ETH',()=>void work(async()=>{
     requireNoPendingWithdrawal();
     const epoch = accountEpoch;
     note('Confirm the refund request in your Ethereum wallet.');
     const receipt = await session.depositRefunds.request(deposit.depositId);
     checkAccount(epoch);
     note('Waiting for Aztec to receive your refund request…');
     intent = await session.depositRefunds.prepare(receipt);
     checkAccount(epoch);
     refundQuote = null;
     intent={...intent,status:'unknown'};
     const result=await session.application.submitPrepared(intent.intentId);
     checkAccount(epoch);await receive(result);
     note('');
    },withdrawalFailure,{action:true})));
   }
   if (depositRefundPage.nextOffset !== null) section.append(button('More deposits',()=>void work(()=>load(depositRefundPage.nextOffset))));
  }
  content.append(section);
 }
 function requireNoPendingWithdrawal(){if(pendingWithdrawal)throw Object.assign(new Error('Pending withdrawal'),{code:'ROLLING_WITHDRAWAL_PENDING'});}
 function withdrawalFailure(failure){
  if(failure?.code==='ROLLING_WITHDRAWAL_PENDING')return 'Complete your pending Ethereum refund before starting another withdrawal. No new withdrawal was sent.';
  if(failure?.code==='PRIVATE_FEE_BALANCE_INSUFFICIENT')return 'Add posting credit to cover withdrawal fees, then try again.';
  if(failure?.code==='ROLLING_WITHDRAWAL_NO_PROGRESS')return 'Your withdrawal could not continue. No further payment was sent.';
  return 'Your withdrawal could not complete. Any transaction already sent is saved; check its status before trying again.';
 }
 function setPendingWithdrawal(value){
  if(value?.intentId!==pendingWithdrawal?.intentId||value?.txHash!==pendingWithdrawal?.txHash){stopRefundWatch();refundQuote=null;refundReadiness=null;}
  pendingWithdrawal=value;
 }
 function stopRefundWatch(){refundWatch?.controller.abort();refundWatch=null;}
 function watchPendingRefund(){
  const active=session,saved=pendingWithdrawal,epoch=accountEpoch;
  if(!dialog.open||view!=='refund'||!saved||invalidated||reloadRequired||typeof active?.withdrawal?.waitUntilReady!=='function'){stopRefundWatch();return;}
  if(refundReadiness==='ready'||refundWatch)return;
  const current={controller:new AbortController(),intentId:saved.intentId,txHash:saved.txHash};refundWatch=current;
  void Promise.resolve().then(()=>active.withdrawal.waitUntilReady({signal:current.controller.signal})).then(found=>{
   if(current.controller.signal.aborted||refundWatch!==current||session!==active||epoch!==accountEpoch||!dialog.open||view!=='refund'||pendingWithdrawal?.intentId!==current.intentId||pendingWithdrawal?.txHash!==current.txHash)return;
   checkAccount(epoch);
   if(found?.status==='none')setPendingWithdrawal(null);
   else{
    if(!['waiting','ready','unknown'].includes(found?.status)||found.intentId!==current.intentId||found.txHash!==current.txHash)return;
    refundReadiness=found.status;if(found.status!=='ready')refundQuote=null;
   }
   render();
  }).catch(()=>{});
 }
 async function checkRefundReadiness(){
  const epoch=accountEpoch,active=session,saved=pendingWithdrawal;
  if(!saved||typeof active?.withdrawal?.observe!=='function')throw connectionFailure;
  refundReadiness=null;refundQuote=null;
  const found=await active.withdrawal.observe();checkAccount(epoch);
  if(active!==session||pendingWithdrawal?.intentId!==saved.intentId||pendingWithdrawal?.txHash!==saved.txHash)throw connectionFailure;
  if(found?.status==='none'){setPendingWithdrawal(null);return;}
  if(!['waiting','ready','unknown'].includes(found?.status)||found.intentId!==saved.intentId||found.txHash!==saved.txHash)throw connectionFailure;
  refundReadiness=found.status;
 }
 function openPendingRefund(){
  if(busy||!pendingWithdrawal)return;clearOperationFeedback();view='refund';render();if(typeof session?.withdrawal?.waitUntilReady!=='function')void work(checkRefundReadiness);
 }
 async function withdrawDeposit(deposit){
  requireNoPendingWithdrawal();
  const epoch=accountEpoch,controller=new AbortController();let stop;
  checkAccount(epoch);withdrawalActive=true;refundQuote=null;note('Preparing your withdrawal…');
  try{
   const result=await session.application.executeWithdrawal(deposit,{
    signal:controller.signal,
    onPrepared:value=>{checkAccount(epoch);intent=value;},
    onProgress:progress=>{
     checkAccount(epoch);stop?.remove();stop=null;
     if(progress.stage==='waiting'){
      note('Your deposit is available after '+new Date(Number(progress.availableAt)*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+'. Your withdrawal will continue automatically.');
      stop=button('Withdraw later',()=>{controller.abort();stop.disabled=true;note('Stopping withdrawal…');});content.append(stop);
     }else note(progress.stage==='withdrawing'?'Withdrawing your deposit…':'Preparing your withdrawal…');
    }
   });
   checkAccount(epoch);await receive(result);
  }catch(failure){
   if(!controller.signal.aborted)throw failure;
   checkAccount(epoch);await refresh();notice='You can withdraw your deposit later.';
  }finally{withdrawalActive=false;stop?.remove();}
 }
 function balancesView(){
  content.append(el('h3',{},'Balances and withdrawals'),paragraph('Your deposit is refundable. Your posting balance pays network fees and cannot be withdrawn. Unused Bok credit can be withdrawn separately.'));
  if(pendingWithdrawal)content.append(paragraph('Complete your pending Ethereum refund before starting another withdrawal.'),button('Pending Ethereum refund',openPendingRefund,true));
  unfinishedDepositsView();
  if(!balances){content.append(button('Check private balances',()=>void work(async()=>{const epoch=accountEpoch;const value=await session.application.readBalances({cursor:0});checkAccount(epoch);rememberBalances(value);}),true));return;}
  content.append(paragraph('Posting balance: '+decimal(balances.fee.available,18)+' credits (FEE).'));
  if(balances.fee.pendingReservation)content.append(paragraph('A saved transaction has an unresolved fee reservation, up to '+decimal(balances.fee.pendingReservation.maximumFee,18)+' FEE. It is not subtracted again from the balance above.'));
  if(!balances.bok&&session.bokConfigured===true)content.append(button('Show Bok balance',()=>void work(async()=>{const epoch=accountEpoch;const value=await session.application.readBalances({cursor:0,includeBok:true});checkAccount(epoch);rememberBalances(value);})));
  if(balances.bok){content.append(paragraph('Available Bok credit: '+decimal(balances.bok.available,6)+' USDC.'));
   if(bokAccounting?.complete){
    content.append(paragraph('Complete owned-request accounting at block '+bokAccounting.anchor.blockNumber+'. Allocated '+decimal(bokAccounting.totals.available,6)+', reserved '+decimal(bokAccounting.totals.reserved,6)+', charged '+decimal(bokAccounting.totals.charged,6)+', returned '+decimal(bokAccounting.totals.refunded,6)+' USDC. Returned credit is already part of your unallocated balance; it is not added again.'));
    for(const r of bokAccounting.requests){const area=el('section',{'aria-label':'Owned Bok request'});area.append(paragraph('Request '+r.requestId.slice(0,10)+'… — allocated '+decimal(r.available,6)+', reserved '+decimal(r.reserved,6)+', charged '+decimal(r.charged,6)+', returned '+decimal(r.refunded,6)+' USDC.'));
     if(['1','2'].includes(r.state)){
      if(r.reserved==='0')area.append(button('Release unused credit',()=>void work(()=>executeAction({type:'cancel-bok-request',requestId:r.requestId}),actionFailure,{action:true})));
      area.append(paragraph('After expiry, unreserved credit returns to your balance.'),button('Expire request',()=>void work(()=>executeAction({type:'expire-bok-request',requestId:r.requestId}),actionFailure,{action:true})));
     }else area.append(paragraph(r.state==='4'?'This request is closed. Returned credit is already included in your unallocated balance.':'This request is fenced. Unreserved credit has returned; the reserved amount remains locked until the operator reconciles its actual charge.'));content.append(area);
    }
   }else content.append(paragraph('Complete request accounting is not yet available; unlisted reservations are not zero.'));
   if(typeof session.application.readBokAccounting==='function'){
    content.append(button(accountingCheck?'Checking all Bok requests':'Check all Bok requests',()=>void work(checkBokAccounting)));
    if(bokAccounting&&!bokAccounting.complete)content.append(paragraph('Checking '+(bokAccounting.phase==='owned-requests'?'private ownership pages':'uniform public accounting pages')+'. No partial total is presented.'));
    if(accountingCheck){const stop=button('Stop checking requests',()=>{accountingCheck.stopped=true;bokAccounting=null;note('Accounting stop requested. Waiting for the current private operation to settle.');});stop.dataset.accountingStop='true';content.append(stop);}
   }
   if(!pendingWithdrawal){
   fundingWalletView();const recipient=runtime.fundingWalletStatus?.()?.address?.toLowerCase();
   const amount=el('input',{type:'text',inputmode:'decimal','aria-label':'Bok credit to withdraw in USDC',value:bokExitAmount});amount.addEventListener('input',()=>bokExitAmount=amount.value);
   content.append(label('Bok credit to withdraw (USDC)',amount));
   if(recipient)content.append(paragraph('Receive at '+recipient));
   content.append(paragraph('Max cost '+compactAmount(session.postingFeeLimit,18,4,true)+' posting credits. Ethereum gas is paid separately.'),button('Withdraw Bok credit',()=>{
    const amount=bokExitAmount;
    void work(async()=>{requireNoPendingWithdrawal();const action={type:'withdraw-bok',amount:units(amount,6),recipient};const selected=runtime.fundingWalletStatus?.();if(!selected?.connected||!recipient||selected.address?.toLowerCase()!==recipient)throw connectionFailure;
     refundQuote=null;await executeAction(action,{immediate:true});
    },withdrawalFailure,{action:true});
   },true));
   }
  }
  for(const d of balances.collateral.deposits){
   const area=el('section',{'aria-label':'Posting collateral'});
   if(d.reason==='time-locked')area.append(paragraph('Available to withdraw after '+new Date(Number(d.nextAllowedTime)*1000).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})+'.'));
   area.append(paragraph(decimal(d.amount,18)+' ETH'));
   if(!pendingWithdrawal)area.append(button('Withdraw deposit',()=>void work(()=>withdrawDeposit(d.id),withdrawalFailure,{action:true}),true));
   content.append(area);
  }
  if(!balances.collateral.deposits.length)content.append(paragraph('No refundable deposits on this page.'));
  if(balances.collateral.nextCursor!==null)content.append(button('More deposits',()=>void work(async()=>{const epoch=accountEpoch;const page=await session.application.readBalances({cursor:balances.collateral.nextCursor,includeBok:!!balances.bok});checkAccount(epoch);balances=page;})));
  content.append(button('Refresh balances',()=>void work(async()=>{balances=null;bokAccounting=null;const epoch=accountEpoch;const page=await session.application.readBalances({cursor:0});checkAccount(epoch);balances=page;})));
 }
 function acceptPaidWithdrawal(saved,result){
  const current=pendingWithdrawal??intent;
  if(result?.status!=='refunded'||result.amount!==saved.withdrawal.amount||current?.intentId!==saved.intentId||current?.txHash!==saved.txHash||JSON.stringify(current?.withdrawal)!==JSON.stringify(saved.withdrawal))throw connectionFailure;
  // Native Ethereum confirmation already marked this exact pending slot paid.
  // Unrelated account inventory cannot change that payment result or its amount.
  setPendingWithdrawal(null);balances=null;
  if(intent?.intentId===saved.intentId&&intent?.txHash===saved.txHash)intent=null;
  accountRefreshNeeded=true;
 }
 async function withdrawToEthereum(saved,{resume=false}={}){
  const epoch=accountEpoch,active=session;
  const check=()=>{checkAccount(epoch);const current=pendingWithdrawal??intent;
   if(active!==session||current?.intentId!==saved.intentId||current?.txHash!==saved.txHash||JSON.stringify(current?.withdrawal)!==JSON.stringify(saved.withdrawal))throw connectionFailure;
  };
  const finishEthereum=beginRollingMeasure('withdrawal.ethereum');
  let result;try{
  check();refundQuote=null;note('Preparing your Ethereum withdrawal…');
  const prepared=await (resume?active.withdrawal.prepareSaved({}):active.withdrawal.prepare({}));check();
  result=prepared;
  if(prepared.status!=='refunded'){
   if(prepared.amount!==saved.withdrawal.amount||prepared.recipient!==saved.withdrawal.depositor)throw connectionFailure;
   note('Approve the withdrawal in your Ethereum wallet.');
   result=await active.withdrawal.confirm();check();
  }
  if(result.status!=='refunded'||result.amount!==saved.withdrawal.amount)throw connectionFailure;
  }finally{finishEthereum();}
  note('');const bok=saved.withdrawal.kind==='bok';
  notice='Withdrawn to Ethereum: '+decimal(result.amount,bok?6:18)+(bok?' USDC.':' ETH.');
  acceptPaidWithdrawal(saved,result);
 }
 function refundView(){
  const saved=pendingWithdrawal??intent;if(!saved?.withdrawal){content.append(paragraph('No pending Ethereum refund.'));return;}
  const bok=saved.withdrawal.kind==='bok',amountText=decimal(saved.withdrawal.amount,bok?6:18)+(bok?' USDC':' ETH');
  fundingWalletView(content,'Connect the wallet receiving this withdrawal.');
  content.append(paragraph('Refund: '+amountText),paragraph('To: '+saved.withdrawal.depositor),paragraph('The refund remains saved until Ethereum confirms payment.'));
  if(refundReadiness==='ready')content.append(paragraph('Ready to withdraw. Your wallet will show the Ethereum network fee.'),button('Withdraw to Ethereum',()=>void work(()=>withdrawToEthereum(saved),withdrawalFailure,{action:true}),true));
  else content.append(paragraph(refundReadiness==='unknown'?'The private exit is not currently verified. No refund will be sent.':saved.status==='included'?'Your exit is included on Aztec; confirmation is pending. The Ethereum refund is waiting for settlement. Your account remains available.':'The Ethereum refund is waiting for settlement. Your account remains available.'));
  const details=el('details',{},el('summary',{},'Withdrawal status'));
  details.append(button('Check refund readiness',()=>void work(checkRefundReadiness)),button('Check existing refund',()=>void work(async()=>{const epoch=accountEpoch,active=session;note('Checking your Ethereum withdrawal…');const result=await active.withdrawal.recover();note('');checkAccount(epoch);if(active!==session)throw connectionFailure;if(result.status==='refunded'){acceptPaidWithdrawal(saved,result);notice='The saved Ethereum refund is confirmed.';}else notice='Refund '+result.status+'.';})),paragraph('If a previous wallet request was interrupted, continue that same saved withdrawal.'),button('Continue saved withdrawal',()=>void work(()=>withdrawToEthereum(saved,{resume:true}),withdrawalFailure,{action:true})));
  content.append(details);
 }
 const postingTypes=new Set(['post','reply','quote','repost','bok','thread']);
 const immediateTypes=new Set([...postingTypes,'like','name','bio','avatar','subboard','cancel-bok-request','expire-bok-request',...MODERATOR_TYPES]),readerActionTypes=new Set(['like']);
 const rulesId=action=>postingTypes.has(action?.type)&&field(action.subboard)?BigInt(action.subboard).toString():null;
 function rulesReady(action){return !postingTypes.has(action?.type)||postingRules?.id===rulesId(action)&&postingRules.status==='ready'&&!postingRules.value.rejected;}
 function validateRules(data,id){
  const version=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(v)&&BigInt(v)<=0xffffffffn;
  const safeText=v=>typeof v==='string'&&v.isWellFormed()&&!v.includes('\0')&&new TextEncoder().encode(v).length<=992;
  const scope=data.scope;
  if(!scope||!field(scope.chainId)||!field(scope.rollupVersion)||!/^0x[0-9a-f]{64}$/.test(scope.boardAddress)||data.boardId!==id||!version(data.mainPolicy?.version)||!safeText(data.mainPolicy.text))throw rulesFailure;
  const scopeKey=JSON.stringify([scope.chainId,scope.rollupVersion,scope.boardAddress]);
  if(rulesScope!==null&&rulesScope!==scopeKey)throw rulesFailure;
  const board=data.board;
  if(id==='0'?board!==null:!board||board.id!==id||board.mainVersion!==data.mainPolicy.version||board.mainRules!==data.mainPolicy.text||!safeText(board.rules)||typeof board.rejected!=='boolean'||board.rejected&&!safeText(board.rejection?.reason))throw rulesFailure;
  rulesScope=scopeKey;
  // Local rules are immutable: the contract's SubboardCreated version is always 1.
  return {parentVersion:data.mainPolicy.version,parent:data.mainPolicy.text,localVersion:id==='0'?'0':'1',local:board?.rules??'',rejected:board?.rejected===true,reason:board?.rejection?.reason??''};
 }
 function loadRules(id,fresh=false){
  if(id===null){postingRules=null;updateRules();return Promise.resolve();}
  if(!fresh&&postingRules?.id===id&&postingRules.status!=='loading')return Promise.resolve(postingRules.value);
  let request=rulesInFlight.get(id);
  if(!request){request=readPublic('board',{id,limit:1}).then(data=>validateRules(data,id));rulesInFlight.set(id,request);void request.finally(()=>{if(rulesInFlight.get(id)===request)rulesInFlight.delete(id);}).catch(()=>{});}
  const state=postingRules?.id===id&&postingRules.status==='loading'?postingRules:{id,status:'loading'};postingRules=state;updateRules();
  return request.then(value=>{if(postingRules===state){state.status='ready';state.value=value;updateRules();}return value;},()=>{if(postingRules===state){state.status='unavailable';delete state.value;updateRules();}throw rulesFailure;});
 }
 function rulesView(action,changed=()=>{}){
  if(!postingTypes.has(action?.type))return;
  const epoch=renderEpoch,section=el('section',{'aria-label':'Current effective rules'});
  // Read the rules before reaching review, publication or saved-send controls.
  content.insertBefore(section,content.querySelector(':scope > button.primary'));
  updateRules=()=>{
   if(epoch!==renderEpoch)return;
   const id=rulesId(action),state=postingRules?.id===id?postingRules:null;
   section.replaceChildren();
   if(id===null)section.append(paragraph('Enter a valid destination board to see its rules.'));
   else if(!state||state.status==='loading')section.append(el('p',{role:'status'},'Loading current board rules…'));
   else if(state.status==='unavailable')section.append(el('p',{role:'status'},'Current board rules are unavailable. Posting is disabled.'));
   else{
    const rules=state.value,details=el('details',{class:'composer-rules'},el('summary',{},'Board rules'));section.append(details);details.append(el('p',{class:'post-body'},rules.parent||'No site-wide rules.'));
    if(id!=='0')details.append(el('h4',{},'Additional board rules'),el('p',{class:'post-body'},rules.local||'No additional board rules.'));
    if(rules.rejected)section.append(el('p',{role:'status'},'This subboard is rejected. New posts are disabled. '+rules.reason));
   }
   const retry=button('Refresh board rules',()=>{void loadRules(rulesId(action),true).catch(()=>{});});retry.disabled=busy||state?.status==='loading';if(state?.status==='unavailable')section.append(retry);changed();
  };
  updateRules();void loadRules(rulesId(action)).catch(()=>{});
 }
 function displayedPostingRules(action){
  if(!postingTypes.has(action?.type))return undefined;
  if(!rulesReady(action)||rulesScope===null)throw rulesFailure;
  const [chainId,rollupVersion,boardAddress]=JSON.parse(rulesScope);
  return {chainId,rollupVersion,boardAddress,subboard:rulesId(action),parentVersion:postingRules.value.parentVersion,localVersion:postingRules.value.localVersion};
 }
 async function checkPostingRules(action,{confirm=false}={}){
  if(!postingTypes.has(action?.type))return;
  const epoch=accountEpoch,id=rulesId(action),previous=postingRules?.id===id?postingRules.value:null;
  if(id===null)throw rulesFailure;
  const current=await loadRules(id,true);checkAccount(epoch);
  if(postingRules?.id!==id||!rulesReady(action)||confirm&&JSON.stringify(previous)!==JSON.stringify(current))throw rulesFailure;
 }
 function replyContext(action){return field(action?.parent)&&field(action?.root)&&field(action?.subboard)&&BigInt(action.parent)>0n&&BigInt(action.root)>0n;}
 function conversationContext(action){
  const reply=replyContext(action),link=el('a',{href:reply?'#/thread/'+action.root+'/'+action.parent:'#/board/'+action.subboard},reply?'View conversation':BigInt(action.subboard)===0n?'Main board':'View board');
  link.addEventListener('click',event=>{if(!close())event.preventDefault();});
  content.append(paragraph(reply?'Replying to '+(action.context?.author||'this post'):'New conversation'));
  if(reply&&action.context)content.append(el('blockquote',{class:'reply-context'},el('strong',{},action.context.author),el('p',{},action.context.excerpt)));
  content.append(el('p',{class:'quiet'},link));
 }
 function actionLabel(action){
  return ({post:'Post',reply:'Reply',thread:'Post all',quote:'Post quote',repost:'Repost',like:'Like post',unlike:'Remove like',name:'Create name',subboard:'Create board',bio:'Save bio',avatar:'Save avatar','cancel-deposit':'Continue refund',bok:'Ask Bok'})[action?.type]??TYPES[action?.type]??'Confirm';
 }
 function feeLabel(value){const amount=BigInt(value);return amount>0n&&amount<100000000000000n?'less than 0.0001':'up to '+decimal((amount+99999999999999n)/100000000000000n,4);}
 function reviewLabel(action){return immediateTypes.has(action?.type)?(action.type==='bok'?'Post':actionLabel(action)):'Review cost';}
 function showIntent(){
  if(pendingWithdrawal&&pendingWithdrawal.intentId!==intent.intentId)content.append(button('Pending Ethereum refund',openPendingRefund));
  if(['withdraw','withdraw-bok','cancel-deposit'].includes(intent.action?.type)&&['included','confirmed'].includes(intent.status)&&session.withdrawal){refundView();return;}
  const replacement=intent.status==='replacement-prepared',prepared=intent.status==='prepared'||replacement;
  if(!prepared)content.append(el('h3',{},'Check your action'));
  if(replacement)content.append(paragraph('Review the replacement cost before confirming.'));
  // The saved action owns this context, including after authorization or recovery.
  const conversational=postingTypes.has(intent.action?.type);
  if(conversational&&field(intent.action.subboard)){conversationContext(intent.action);content.append(paragraph('Post as '+ownedLabel(intent.action.name??'0')));}
  // Explicit fields only, and text nodes throughout. No nonce, account or raw error.
  if(intent.action?.type==='thread')for(const [index,text]of intent.action.contents.entries())content.append(el('strong',{},'Post '+(index+1)),el('div',{class:'preview-body'},createMessageContent(text)));
  if(intent.action?.content)content.append(el('div',{class:'preview-body'},createMessageContent(intent.action.content)));
  if(intent.action?.type==='name')content.append(el('h3',{},intent.action.first+' '+intent.action.last));
  const actionDetails=el('details',{class:'account-details'},el('summary',{},'Action details'));
  for(const key of ['slug','name','description','rules','subboard','parent','root','reference','post','target','thread','reason']){
   const value=intent.action?.[key];if(typeof value==='string'&&value)actionDetails.append(el('p',{class:'post-body'},`${key}: ${key==='name'&&!['subboard','moderate-avatar'].includes(intent.action.type)?ownedLabel(value):value}`));
  }
  if(actionDetails.childElementCount>1)content.append(actionDetails);
  const reviewedFee=replacement?intent.replacementReview?.maximumFee:intent.maximumFee,feeReady=typeof reviewedFee==='string'&&/^(0|[1-9][0-9]*)$/.test(reviewedFee);
  if(replacement){
   if(feeReady)content.append(paragraph(`Replacement cost: up to ${decimal(reviewedFee,18)} FEE from your posting balance.`));
   if(typeof intent.maximumFee==='string')content.append(paragraph(`Previous cost limit: ${decimal(intent.maximumFee,18)} FEE. This was a limit, not a charge.`));
   if(intent.replacementReview?.marker)content.append(el('p',{class:'recovery-values'},`Reviewed read position: block ${intent.replacementReview.marker.throughBlock}; block fingerprint ${intent.replacementReview.marker.blockHash}.`));
  }else if(feeReady)content.append(paragraph(intent.replacementReview?`Previous cost limit: ${decimal(intent.maximumFee,18)} FEE. This was a limit, not a charge.`:`Posting cost: ${feeLabel(reviewedFee)} credits from your posting balance.`));
  if(feeReady){actionDetails.append(paragraph('Exact maximum network fee: '+decimal(reviewedFee,18)+' FEE. FEE tokens are your posting credits.'));if(!actionDetails.isConnected)content.append(actionDetails);}
  if(intent.action?.type==='expire-bok-request')content.append(paragraph('Ask the contract to expire this exact saved request. Its deadline is checked again before sending. Only unreserved credit can return; an unresolved reservation remains fenced for the actual charge. Confirmation does not mean the whole budget was refunded. Refresh private balances and complete request accounting afterward.'));
  if(intent.withdrawal)content.append(paragraph(intent.withdrawal.kind==='cancelled-collateral'?'Cancel this unfinished deposit so it can be returned to your Ethereum wallet.':intent.withdrawal.kind==='bok'?'Exit '+decimal(intent.withdrawal.amount,6)+' USDC of unallocated Bok credit to '+intent.withdrawal.depositor+'. Reserved request credit is not spent. A separate Ethereum claim follows after settlement and needs its own gas review.':'Exit '+decimal(intent.withdrawal.amount,18)+' ETH of posting collateral. This first transaction consumes your private deposit. A separate Ethereum refund to the original depositor follows after settlement and needs its own gas review. Moderation does not remove withdrawal rights.'));
  if(intent.action?.type==='name')content.append(el('p',{class:'name-preview'},intent.action.first+' '+intent.action.last));
  if(intent.action?.type==='name'&&prepared&&intent.nameAvailability)content.append(paragraph('This name was available when checked. This is not a reservation; another registration may still win before your transaction.'));
  if(intent.action?.type==='bio'&&intent.action.content==='')content.append(paragraph('Clear the current profile bio. Historical versions remain public.'));
  const savedAvatar=intent.action?.type==='avatar'?intent.action:intent.action?.type==='name'?intent.action.avatar:null;
  let avatarReady=!savedAvatar||savedAvatar.data==='';
  const avatarArea=el('div',{'aria-label':'Saved avatar preview'});
  if(savedAvatar){
   content.append(avatarArea);
   if(savedAvatar.data==='')avatarArea.append(paragraph('Clear avatar. No image bytes will be published.'));
  }
  if(intent.action?.type==='transfer-moderator')content.append(paragraph(`Transfer moderator authority to ${intent.action.successor}. Your current key loses authority immediately. Only the successor can transfer it back.`));
  if(intent.moderation){content.append(paragraph('Moderator action: your authority and the exact target will be checked again before sending. This does not edit the original post or reveal its private owner.'),paragraph(`Reviewed parent rules version: ${intent.moderation.mainVersion}.`));if(intent.moderation.avatarVersion!==undefined)content.append(paragraph(`Reviewed avatar version: ${intent.moderation.avatarVersion}.`));}
  if(intent.bok){
   content.append(paragraph(`Maximum Bok request cost: ${decimal(intent.bok.budget,6)} USDC. This ceiling is separate from network fees; the actual charge may be lower.`),...(intent.bok.availableCredit===null?[]:[paragraph(`Private Bok balance checked for this authorization: ${decimal(intent.bok.availableCredit,6)} USDC.`)]));
   if(intent.bok.phase==='authorize')content.append(paragraph('First authorize this exact request privately. Publishing the saved post requires a separate review and network fee.'));
   else if(intent.bok.phase==='post'){content.append(paragraph('The request is already authorized. This publishes its exact saved post; the Bok budget is not authorized again.'));if(Number.isSafeInteger(intent.bok.mainPolicyVersion)&&Number.isSafeInteger(intent.bok.localPolicyVersion))content.append(paragraph(`Reviewed policy versions: parent ${intent.bok.mainPolicyVersion}, local ${intent.bok.localPolicyVersion}.`));}
  }
  if(fundingCapability()&&['claim-deposit','claim-private-fee','claim-bok'].includes(intent?.action?.type)&&['reverted','cancelled'].includes(intent.status))content.append(button('Review private claim again',()=>void work(async()=>{
   const epoch=accountEpoch;checkAccount(epoch);await fundingCapability().reviewRevertedClaim();checkAccount(epoch);await advanceFunding();
  })));
  if(['authorized','bok-post-reverted','bok-release-reverted'].includes(intent.status)){
   if(intent.status==='bok-post-reverted')content.append(paragraph('The post reverted. Its paid network fee is not refunded.'));
   content.append(paragraph('Your funded request and original draft remain saved. Continuing the post, releasing unused credit, or requesting expiry each needs a separate fee review. Expiry requires the contract deadline; unresolved reservations remain fenced.'));
   if(intent.status!=='bok-release-reverted')content.append(button('Review saved Bok post',()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);await checkPostingRules(intent.action);blocked=true;
    const result=await session.application.prepareBokPost(id);checkAccount(epoch);intent=result;blocked=false;note('');notice='Review the saved post and its separate network fee before sending.';
   }),true));
   for(const [type,label]of [['cancel-bok-request','Review release of this saved request'],['expire-bok-request','Review expiry of this saved request']])content.append(button(label,()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);const result=await session.application.prepareBokRelease(id,{type});checkAccount(epoch);intent=result;blocked=false;note('');notice='Review the private transaction fee. No release or expiry has been sent.';
   })));
   rulesView(intent.action);
   return;
  }
  let confirm;
  const expiryAction=intent.action?.type==='expire-bok-request',fundingAction=['claim-deposit','claim-private-fee','claim-bok'].includes(intent.action?.type);
  if(fundingAction){content.append(paragraph(intent.action.type==='claim-deposit'?'Claim the previously paid posting collateral privately. No second Ethereum payment will be requested.':'Claim the previously paid '+(intent.action.type==='claim-bok'?'Bok credit':'network fee credit')+' privately. Posting collateral is unchanged. No second Ethereum payment will be requested.'),paragraph((intent.action.type==='claim-deposit'?'Collateral: ':intent.action.type==='claim-bok'?'Bok credit: ':'Network fees: ')+intent.action.receipt.amount+(intent.action.type==='claim-deposit'?' wei.':' base units.')));if(intent.action.feeReceipt)content.append(paragraph('Previously bridged transaction fees: '+intent.action.feeReceipt.amount+' fee-juice units. The fee claim and collateral claim share one transaction.'));}
  if(prepared){
   confirm=button(replacement?'Confirm replacement':intent.bok?.phase==='authorize'?'Approve Bok budget':actionLabel(intent.action),()=>void work(async()=>{
    if(!avatarReady||!feeReady||!rulesReady(intent.action))throw Error('Review unavailable');
    await checkPostingRules(intent.action,{confirm:true});
    const epoch=accountEpoch;checkAccount(epoch);recoveryInspection=null;
    const id=intent.intentId;intent={...intent,status:'unknown'};blocked=true;
    try{const result=await session.application.submitPrepared(id);checkAccount(epoch);await receive(result);}catch{note('Submission outcome is unknown. Check this transaction; do not submit again.');throw Error('Unknown outcome');}
   }),true);confirm.dataset.actionConfirm='';confirm.dataset.unavailable=String(!avatarReady||!feeReady);
   const explanation=['withdraw','withdraw-bok','cancel-deposit'].includes(intent.action?.type)?'This private exit starts withdrawal. It does not send the Ethereum refund or publish a post.':expiryAction?'This private expiry attempt charges a network fee. It never releases an unresolved reserved charge.':fundingAction?'Your saved funding receipt will be checked again before sending this private claim.':intent.bok?.phase==='authorize'?'This step authorizes the saved Bok budget privately and charges a network fee. Your post is not published yet; publication needs separate confirmation.':null;if(explanation)content.append(paragraph(explanation));content.append(confirm);
   if(!replacement&&intent.bok?.phase!=='post'){
    const editable=['post','reply','thread','quote','repost','bok','name','subboard','bio','avatar','like','unlike',...MODERATOR_TYPES].includes(intent.action?.type);
    content.append(button(editable?'Back to editing':'Cancel review',()=>void work(async()=>{
     const saved=intent.action;await session.application.cancelPrepared(intent.intentId);intent=null;
     if(editable){draft={...saved};if(saved.type==='thread'){draft={type:replyContext(saved)?'reply':'post',deposit:saved.deposit,name:saved.name,subboard:saved.subboard,parent:saved.parent,root:saved.root,content:saved.contents[0],budget:decimal(BigInt(saved.budgets?.[0]??'0')>0n?saved.budgets[0]:'250000',6),threadPosts:saved.contents.slice(1).map((content,index)=>({content,budget:decimal(BigInt(saved.budgets?.[index+1]??'0')>0n?saved.budgets[index+1]:'250000',6)}))};}if(saved.type==='bok')draft.budget=decimal(saved.budget,6);if(saved.type==='avatar')avatarDraft=saved.data===''?{clear:true}:{blob:savedAvatarBlob(saved)};if(saved.type==='name')avatarDraft=saved.avatar?{blob:savedAvatarBlob(saved.avatar)}:null;view='action';}else view='overview';
     await refresh();if(['bio','avatar'].includes(saved.type))await checkProfile(saved.name);notice='';
    })));
   }
  }else{
   content.append(paragraph('No automatic resend is allowed. A missing receipt does not mean the transaction failed.'),button('Check existing transaction',()=>void work(async()=>{await receive(await session.application.reconcile(intent.intentId));})));
  }
  if(intent.status!=='prepared')confirm=showRecoveryOptions(()=>avatarReady&&feeReady&&rulesReady(intent.action))??confirm;
  rulesView(intent.action,()=>{if(confirm){confirm.dataset.unavailable=String(!avatarReady||!feeReady||!rulesReady(intent.action));confirm.disabled=busy||confirm.dataset.unavailable==='true';}});
  if(savedAvatar&&savedAvatar.data!==''){
   const epoch=renderEpoch,action=savedAvatar;avatarArea.append(paragraph('Checking the exact saved avatar preview…'));
   void (async()=>{try{const blob=savedAvatarBlob(action),checked=await prepareAvatarUpload(blob);
    if(checked.source.width!==100||checked.source.height!==100)throw Error('Invalid saved dimensions');
    if(epoch!==renderEpoch||!unlocked())return;avatarArea.replaceChildren();showAvatar(blob,avatarArea,{ready:()=>{if(epoch!==renderEpoch||!unlocked())return;avatarReady=true;if(confirm){confirm.dataset.unavailable='false';confirm.disabled=busy;}},failed:()=>{avatarReady=false;if(confirm){confirm.dataset.unavailable='true';confirm.disabled=true;}}});avatarArea.append(paragraph(`${blob.size}/8192 encoded bytes. These are the exact saved publication bytes.`));
   }catch{if(epoch===renderEpoch)avatarArea.replaceChildren(paragraph('The saved avatar cannot be previewed safely. Cancel this prepared action or retain its recovery record; it will not be sent.'));}})();
  }
 }
 function requestPostReveal(active,action,txHash){
  if(!active||active.revealRequested||active.epoch!==accountEpoch||!postingTypes.has(action?.type)||!/^0x[0-9a-f]{64}$/.test(txHash))return;
  active.revealRequested=true;pendingPostReveal={epoch:accountEpoch,txHash};
 }
 async function receive(result){
  // The sender has returned. Account/UI refreshes are not blockchain waiting.
  transactionTiming.complete();
  if(result.bok||result.action?.type==='bok'||result.action?.type==='thread'&&result.action.budgets?.some(value=>BigInt(value)>0n)||['claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(result.action?.type))invalidateBokBalance();
  recoveryInspection=null;intent=result;blocked=false;
  if(['included','confirmed','reverted'].includes(result.status)&&['bio','avatar'].includes(result.action?.type))profileSnapshot=null;
  if(result.status==='authorized'){note('');notice='Bok request authorized. Review the saved post when ready; it has not been published.';return;}
  if(['bok-post-reverted','bok-release-reverted'].includes(result.status)){note('');notice=(result.status==='bok-post-reverted'?'The Bok post reverted.':'The Bok release or expiry reverted.')+' A network fee may have been charged. The funded request remains saved; no action is retried automatically.';return;}
  if(['included','confirmed'].includes(result.status)){
   const provisional=result.status==='included';
   if(actionOperation?.intentId===result.intentId)requestPostReveal(actionOperation,result.action,result.txHash);
   if(provisional){includedObservation={txHash:result.txHash,action:result.action,inclusion:result.inclusion,observed:null};if(result.action?.type==='like')pendingLikes.set(BigInt(result.action.post).toString(),includedObservation);actionFeedback.textContent=actionLabel(result.action)+': included; final confirmation pending.';actionFeedback.hidden=false;requestIncludedObservation();}
   if(result.action?.type==='like'){likes.set(BigInt(result.action.post).toString(),{liked:true,anchor:likeFeedKey});onPrivateChange();}
   if(actionOperation?.intentId===result.intentId)actionOperation.confirmed=!provisional;
   if((result.action?.type==='bok'||result.action?.type==='thread'&&result.action.budgets?.some(value=>BigInt(value)>0n))&&typeof result.txHash==='string'&&/^0x[0-9a-f]{64}$/i.test(result.txHash)&&!ownBokPosts.has(result.txHash)){
    ownBokPosts.set(result.txHash,{requestId:null,pluginId:null,reply:null,replyBlock:null,replyConfirmed:false,confirmedReply:null});
    if(ownBokPosts.size>128)ownBokPosts.delete(ownBokPosts.keys().next().value);
   }
   if(immediateTypes.has(result.action?.type)){if(postingTypes.has(result.action?.type)||['bio','avatar'].includes(result.action?.type)){draft={...draft,content:'',threadPosts:[]};releasePreviews();}note('');if(dialog.open&&!actionOperation?.included&&actionOperation?.modal!==false)dialog.close();}
   notice=result.action?.type==='expire-bok-request'?'Expiry transaction confirmed. Only unreserved credit can return; refresh private balances and complete request accounting to see refunded and still-reserved amounts.':actionLabel(result.action)+': done.';
   if(!provisional&&actionOperation?.included&&!postingTypes.has(result.action?.type)){actionFeedback.textContent=actionLabel(result.action)+': confirmed.';actionFeedback.hidden=false;}
   if(result.action?.type==='transfer-moderator')moderatorStatus=null;
   if(['withdraw','withdraw-bok','cancel-deposit'].includes(result.action?.type)&&result.withdrawal){
    setPendingWithdrawal({...result,paymentStatus:'pending'});intent=null;balances=null;view='refund';note('');
    notice='Your exit is '+(provisional?'included on Aztec; confirmation is pending.':'confirmed on Aztec.')+' The Ethereum refund has not been paid.';
    accountRefreshNeeded=true;return;
   }
   if(result.action?.type==='name'){
    // Only owned-name discovery is required to use a newly included name.
    // Posting credit is invalidated below; unrelated inventory is not required.
    namesLoaded=false;identities=[];identityRecords=[];cursor=0;
    await measureRollingStage('action.required-account-refresh',()=>loadView({loadIdentity:true}));
    const registered=result.nameAvailability?.id;
    const owned=field(registered)?identityRecords.find(record=>BigInt(record.id)===BigInt(registered)):null;
    if(owned){selectedName=owned.id;selectedLabel=ownedLabel(owned.id);if(inlineCreation){createdNameFeedback={epoch:accountEpoch,name:owned.id};inlineCreation=false;restoreDialogContent();view='overview';notice='Name created. You’re posting as '+ownedLabel(selectedName)+'.';}}
   }
   if(immediateTypes.has(result.action?.type)){
    // Confirmation finishes the interaction. Feed and affected balance reads
    // update independently, without holding the composer open or its busy state.
    intent=null;
    if(['like','unlike','name','bio','avatar','subboard',...MODERATOR_TYPES].includes(result.action.type)){
     // Name completion already loaded native ownership above. Profile edits
     // retain their fresh-version/public refresh path. Subboard/moderator changes
     // update public Board state; native action checks still enforce policy,
     // eligibility and authority. None creates or spends collateral/Bok notes.
     // Only the displayed posting-credit amount needs invalidation.
     // Do not queue unrelated collateral/account reads before the next action.
     // Composer preparation or an explicit balance view reads native credit again.
     if(status){status={...status};delete status.privateFeeCredit;}balances=null;
    }else accountRefreshNeeded=true;
    onPrivateChange();
    if(!actionOperation?.included)void Promise.resolve().then(()=>onPublicEffect()).catch(()=>{notice='Confirmed. The feed could not refresh; reload it to see the change.';if(!busy)render();});
    return;
   }
   try{if(!actionOperation?.included)await onPublicEffect();}catch{notice+=provisional?' Public feed refresh is unavailable; confirmation is pending.':' Public feed refresh is unavailable; the transaction remains confirmed.';}
   await measureRollingStage('action.required-account-refresh',()=>refresh());
  }else if(result.status==='reverted'){
   notice='Transaction reverted. A network fee may have been charged. Recovery checks must complete before a new action.';await refresh();
  }else note(result.status==='prepared'?'The saved action has not been sent. Review before confirming.':'The transaction is still unconfirmed or unknown. Check later; do not resend.');
 }
 // Receipt progress changes presentation. The sender returns only after its
 // explicit minimum tier and exact canonical block have been verified.
 function showIncludedAction(progress,{alreadyRendered=false}={}){
  const active=actionOperation;
  if(!busy||!active||active.included||active.epoch!==accountEpoch||!unlocked()||
   intent?.intentId!==active.intentId||progress.intentId!==active.intentId||!immediateTypes.has(intent?.action?.type)||intent.bok?.phase==='authorize'||
   active.txHash&&active.txHash!==progress.txHash||
   !/^0x[0-9a-f]{64}$/.test(progress.txHash)||!/^0x[0-9a-f]{64}$/.test(progress.blockHash)||
   !Number.isSafeInteger(progress.blockNumber)||progress.blockNumber<=0)return;
  active.included=true;active.txHash=progress.txHash;
  requestPostReveal(active,intent.action,progress.txHash);
  note('Confirmation pending');closeButton.disabled=false;
  if(!postingTypes.has(intent.action.type)){const finish=beginRollingMeasure('action.included');finish();actionFeedback.textContent=actionLabel(intent.action)+': confirmation pending.';actionFeedback.hidden=false;}
  try{active.onIncluded?.();}catch{}
  if(active.modal&&dialog.open){const finish=postingTypes.has(intent.action.type)?beginRollingMeasure('post.composer-close'):()=>{};dialog.close();finish();}
  if(!alreadyRendered)void Promise.resolve().then(()=>onPublicEffect()).catch(()=>{});
 }
 async function executeAction(action,{immediate=immediateTypes.has(action.type),postingRules:expectedRules,onResult=()=>{},onIncluded=()=>{},modal=true}={}){
  const epoch=accountEpoch;checkAccount(epoch);pendingPostReveal=null;includedObservation=null;blocked=true;
  if(immediate){
   let result;
   try{result=await session.application.executeAction(action,{...(expectedRules===undefined?{}:{postingRules:expectedRules}),onPrepared:prepared=>{checkAccount(epoch);includedObservation=null;intent=prepared;if(immediateTypes.has(prepared.action?.type)){actionFeedback.textContent='';actionFeedback.hidden=true;actionOperation={epoch,intentId:prepared.intentId,included:false,modal,onIncluded};}}});checkAccount(epoch);}catch(failure){
    if(['ROLLING_POSTING_RULES_CHANGED','ROLLING_SUBBOARD_REJECTED'].includes(failure?.code)){checkAccount(epoch);intent=null;actionOperation=null;await loadRules(rulesId(action),true).catch(()=>{});checkAccount(epoch);throw rulesFailure;}
    if(['BB_POST_FEE_CREDIT_REQUIRED','BB_LIKE_FEE_CREDIT_REQUIRED','BB_PREFERENCE_FEE_CREDIT_REQUIRED'].includes(failure?.code)){checkAccount(epoch);intent=null;actionOperation=null;accountRefreshNeeded=true;}
    throw failure;
   }finally{blocked=false;}
   if(actionOperation?.included){actionOperation.failed=!['included','confirmed'].includes(result.status);actionOperation.resultStatus=result.status;}
   onResult(result);await receive(result);return result;
  }
  try{intent=await session.application.prepare(action);checkAccount(epoch);}finally{blocked=false;}
  note('Review the saved action before confirming.');return intent;
 }
 let panelApi;
 async function act(defaults,{onIncluded=()=>{}}={}){
  if(defaults?.type==='preference'){
   const captured={kind:defaults.kind,target:defaults.target,enabled:defaults.enabled,...(defaults.label===undefined?{}:{label:defaults.label})};
   if(![1,2,3].includes(captured.kind)||!field(captured.target)||(captured.enabled!==undefined&&typeof captured.enabled!=='boolean'))return {status:'failed',message:'This saved item is unavailable.'};
   if(!runtime||!unlocked()){panelApi.open({});return {status:'blocked',reason:'setup'};}
   const epoch=accountEpoch;try{const client=await ensureSavedItems();checkAccount(epoch);await client.set(captured);checkAccount(epoch);onPrivateChange();return {status:'confirmed'};}catch(failure){return {status:'failed',message:failure?.code==='ROLLING_SAVED_ITEMS_LIMIT'?(captured.kind===1?'You can save up to 100 bookmarks. Remove one first.':'You can follow up to 100 people and boards. Remove one first.'):'Saved items could not update. Try syncing them again.'};}
  }
  // Capture the user's exact target and selected operation before any await.
  const type=defaults?.type;if(!readerActionTypes.has(type))return {status:'failed',message:'This action is unavailable.'};
  const action={type};
  if(type==='like'||type==='unlike'){if(!field(defaults.post))return {status:'failed',message:'This post is unavailable.'};action.post=defaults.post;}

  if(busy)return {status:'blocked',reason:'busy'};
  if(!initializationPending)await initialize();else if(initializing)await initializationPending;
  if(busy)return {status:'blocked',reason:'busy'};
  if(!session||!unlocked()||blocked||status?.status!=='fee-ready'||intent){panelApi.open(action);return {status:'blocked',reason:intent?'existing-action':'setup'};}
  if(action.type==='like'&&likeState(action.post)===true)return {status:'confirmed',alreadyLiked:true};
  const epoch=accountEpoch,active=session;let outcome;
  await work(async()=>{
   checkAccount(epoch);if(session!==active)throw connectionFailure;note('Saving…');
   try{await executeAction(action,{modal:false,onIncluded,onResult:result=>{outcome=result;}});}catch(failure){
    if(action.type!=='like'||failure?.code!=='ROLLING_ALREADY_LIKED')throw failure;
    if(intent?.action?.type==='like'&&intent.action.post===action.post)await session.application.cancelPrepared(intent.intentId);
    likes.set(BigInt(action.post).toString(),{liked:true,anchor:likeFeedKey});intent=null;actionOperation=null;outcome={status:'confirmed',alreadyLiked:true};actionFeedback.textContent='Already liked. Each account can like a post once.';actionFeedback.hidden=false;onPrivateChange();
   }
  },actionFailure,{action:true});
  if(outcome)return {status:outcome.status};
  return intent?.status==='unknown'?{status:'unknown'}:{status:'failed',message:error||'This action could not complete. Try again.'};
 }
 function chooseAction(type,name){
  if(busy||!unlocked()||intent||blocked)return;
  clearOperationFeedback();view='action';clearProfileDraft();draft={type,subboard:'0',content:'',name:type==='subboard'?'':name??selectedName};
  if(COMPOSER_TYPES.has(type))requestBokBalance(true);
  if(viewReady()&&!name){render();requestComposerPreparation();}else void work(loadView);
 }
 function namesView(){
  content.append(paragraph('A name lets people recognise your posts and follow you. It does not need to be your real name. You can still choose Anonymous when posting.'),button('Register a name',()=>chooseAction('name'),true));
  const list=el('ul',{'aria-label':'Your registered names'});
  for(const record of identityRecords){
   const readable=`${record.first} ${record.last}`;
   const profile=el('a',{href:'#/profile/'+BigInt(record.id).toString(),'aria-label':'View public profile for '+readable},'View public profile');
   profile.addEventListener('click',event=>{if(busy||!unlocked()||!close())event.preventDefault();});
   list.append(el('li',{},el('p',{},readable),button('Edit bio for '+readable,()=>chooseAction('bio',record.id)),button('Edit avatar for '+readable,()=>chooseAction('avatar',record.id)),profile));
  }
  if(identityRecords.length)content.append(list);else content.append(paragraph('No registered names were found. You can still post as Anonymous when your account is funded.'));
  if(cursor!==null)content.append(button('Load more owned names',()=>void work(()=>loadNames(true))));
 }
 function form(){
  if(MODERATOR_TYPES.has(draft.type)&&moderatorStatus?.authorized!==true)draft={type:'post',subboard:'0',content:''};
  const fields=new Map();let updateInvitation=()=>{},transferConsent,bokChip;
  function input(name,text,{area=false,initial='',required=true}={}){
   const node=el(area?'textarea':'input',area?{rows:'5'}:{type:'text'});node.value=draft[name]??initial;if(required)node.required=true;
   node.addEventListener('input',()=>{draft[name]=node.value;if(name==='content')updateInvitation();if(name==='subboard')updateRules();validate();});fields.set(name,node);content.append(label(text,node));return node;
  }
  function avatarInput(optional=false){
   const file=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'Avatar image'});
   file.addEventListener('change',()=>{const selected=file.files?.[0];if(!selected)return;avatarDraft=null;
    void work(async()=>{const epoch=accountEpoch;let prepared;try{prepared=await prepareAvatarUpload(selected);}catch{throw avatarFailure;}checkAccount(epoch);avatarDraft={blob:prepared.previewBlob,notice:prepared.notice};});});
   content.append(label(optional?'Avatar image (optional)':'Avatar image',file),paragraph('Choose a PNG, JPEG or WebP. We’ll crop it to a square and show you a preview.'));
   if(avatarDraft?.blob){showAvatar(avatarDraft.blob,content);if(avatarDraft.notice)content.append(paragraph(avatarDraft.notice));content.append(paragraph(`${avatarDraft.blob.size}/8192 encoded bytes`));}
   if(!optional&&avatarDraft?.clear)content.append(paragraph('The avatar will be cleared.'));
   if(!optional||avatarDraft?.blob)content.append(button(optional?'Remove selected avatar':'Clear avatar',()=>{avatarDraft=optional?null:{clear:true};render();}));
  }
  const canInvite=['post','reply','bok'].includes(draft.type);
  const threadPosts=canInvite?(draft.threadPosts??=[]):[],threadFields=[],threadAddButtons=[];
  if(canInvite)draft.type=mentionsBok(draft.content)?'bok':replyContext(draft)?'reply':'post';
  let kind=draft.type;
  function target(name){const node=el('input',{type:'hidden'});node.value=draft[name]??'';node.required=true;fields.set(name,node);return node;}
  if(MODERATOR_TYPES.has(kind)){
   content.append(paragraph('Moderator controls. Removal keeps the stable link and a visible reason. It cannot edit or delete the underlying chain history.'));
   if(kind==='transfer-moderator'){const successor=input('successor','Successor Aztec address');content.append(el('p',{class:'quiet'},'The successor takes control immediately. Only the successor can transfer authority back.'));transferConsent=el('input',{type:'checkbox','aria-label':'Confirm transfer of moderator control'});transferConsent.addEventListener('change',validate);successor.addEventListener('input',()=>{transferConsent.checked=false;validate();});content.append(label('Transfer moderator control to this address',transferConsent));}
   else if(kind==='set-main-policy')input('rules','New parent rules',{area:true});
   else{input(kind==='moderate-post'?'post':kind==='moderate-avatar'?'name':'subboard',kind==='moderate-post'?'Post ID':kind==='moderate-avatar'?'Profile name ID':'Subboard ID');input('reason','Public moderation reason',{area:true});}
  }else if(kind==='bio'||kind==='avatar'){
   const names=el('select',{'aria-label':'Profile name'},el('option',{value:''},'Choose an owned name'));
   for(const record of identityRecords)names.append(el('option',{value:record.id},`${record.first} ${record.last}`));
   names.value=identities.includes(draft.name)?draft.name:'';draft.name=names.value;
   names.addEventListener('change',()=>{draft.name=names.value;clearProfileDraft();if(draft.name)void work(()=>checkProfile(draft.name));else render();});
   content.append(label('Profile name',names),paragraph('Your profile is public. Save to publish your changes.'));
   const checkVersion=button('Load profile',()=>{if(draft.name)void work(()=>checkProfile(draft.name));});checkVersion.dataset.unavailable=String(!draft.name);if(!profileSnapshot&&draft.name)content.append(checkVersion);
   if(cursor!==null)content.append(button('Load more owned names',()=>void work(()=>loadNames(true))));
   if(kind==='bio')input('content','Bio (empty to clear)',{area:true,required:false});
   else{
    avatarInput();
   }
  }else if(kind==='name'){
   content.append(paragraph('Choose a public name, not necessarily your real one. Names are unique and cannot be changed. Use letters, spaces, apostrophes or hyphens.'));
   const first=input('first','First name'),last=input('last','Last name');
   // Reversible proposal vocabulary: eight valid values per part, uniformly picked
   // from local cryptographic random bits. Availability is never inferred locally.
   const firstNames=['River','Ellis','Mira','Rowan','Sage','Robin','Avery','Quinn'],lastNames=['Lane','Moss','Reed','Vale','Stone','Brook','Finch','Wren'];
   content.append(button('Suggest a random name',()=>{const bytes=crypto.getRandomValues(new Uint8Array(2));first.value=firstNames[bytes[0]&7];last.value=lastNames[bytes[1]&7];draft.first=first.value;draft.last=last.value;validate();}));
   avatarInput(true);

  }else if(kind==='subboard'){
   content.append(paragraph('Create a space for a topic or community. Its web address is permanent. The site’s rules apply alongside your board’s rules.'));
   input('slug','Board address (e.g. book-club)');input('name','Board name');input('description','Description',{area:true});input('rules','Additional rules',{area:true,required:false});
  }else if(kind==='like'||kind==='unlike'){target('post');content.append(paragraph(kind==='like'?'Like this post. Your account stays anonymous.':'Remove your like from this post.'));}
  else{
   const names=el('select',{'aria-label':'Posting identity'},el('option',{value:'0'},'Anonymous'));
   for(const record of identityRecords)names.append(el('option',{value:record.id},`${record.first} ${record.last}`));
   names.value=identities.includes(draft.name)?draft.name:'0';draft.name=names.value;
   names.addEventListener('change',()=>{draft.name=names.value;selectedName=names.value;selectedLabel=ownedLabel(selectedName);renderIdentityControls();});if(identityRecords.length)content.append(label('Post as',names));else content.append(paragraph('Posting as Anonymous'));
   if(cursor!==null)content.append(button('Load more owned names',()=>void work(()=>loadNames(true))));
   const deposits=el('select',{'aria-label':'Posting collateral'});
   for(const id of status?.depositIds??[])deposits.append(el('option',{value:id},`Deposit ${id}`));
   if(!deposits.options.length)deposits.append(el('option',{value:''},'No verified collateral found'));
   deposits.value=(status?.depositIds??[]).includes(draft.deposit)?draft.deposit:deposits.options[0].value;draft.deposit=deposits.value;
   deposits.addEventListener('change',()=>{draft.deposit=deposits.value;validate();requestComposerPreparation();});if(deposits.options.length>1)content.append(el('details',{class:'account-details'},el('summary',{},'Choose a posting deposit'),label('Posting deposit',deposits)));else if(!draft.deposit)content.append(paragraph('Set up your posting balance before publishing.'));
   if(kind==='reply'||kind==='bok'){
    if(kind==='bok'&&draft.parent===undefined&&draft.root===undefined)Object.assign(draft,{parent:'0',root:'0'});
    if(replyContext(draft)||kind==='bok'&&field(draft.subboard)&&draft.parent==='0'&&draft.root==='0')conversationContext(draft);
    else content.append(paragraph('Choose a post in the reader and select Reply to join its conversation.'),button('Choose a post',()=>close()));
    if(replyContext(draft)||kind==='reply')content.append(button('Start new conversation',()=>{draft={...draft,type:kind==='reply'?'post':'bok',parent:'0',root:'0',context:undefined};render();}));
   }else{target('subboard');conversationContext(draft);}
   if(kind==='quote'||kind==='repost'){target('reference');const original=el('a',{href:'#/post/'+draft.reference},'View original post');original.addEventListener('click',event=>{if(!close())event.preventDefault();});content.append(original);}
   input('content',kind==='repost'?'Optional repost comment':threadPosts.length?'Post 1':'Message',{area:true,required:kind!=='repost'});
   if(canInvite){
    const invitation=el('div',{class:'bok-invitation'}),balance=el('p',{'data-composer-bok-balance':'','aria-live':'polite'});
    const budget=input('budget','Maximum Bok cost (USDC)',{initial:'0.25'});budget.inputMode='decimal';const budgetLabel=budget.parentElement;
    const add=button('Add Bok credit',addBokCredit);
    invitation.append(paragraph('Bok will reply to this message. You only pay for the work it does, up to your limit.'),balance,budgetLabel,add);content.append(invitation);
    const paint=()=>{const state=bokBalance.snapshot();balance.textContent=state.phase==='ready'?`Bok balance: ${decimal(state.value.availableCredit,6)} USDC`:bokBalanceText();};
    updateInvitation=()=>{
     kind=draft.type=mentionsBok(draft.content)?'bok':replyContext(draft)?'reply':'post';if(kind==='bok'&&draft.parent===undefined)Object.assign(draft,{parent:'0',root:'0'});invitation.hidden=kind!=='bok';
     if(kind==='bok')fields.set('budget',budget);else fields.delete('budget');
     bokChip?.setAttribute('aria-pressed',String(kind==='bok'));
     title.textContent=replyContext(draft)?'Reply':'Write a post';paint();
    };
    updateBokForm=()=>{paint();validate();};updateInvitation();
   }
  }
  const budgetMeter=createMessageBudget(),counter=budgetMeter.node,preview=el('div',{class:'preview-body','aria-label':'Message preview'});
  if(fields.has('content')){
   const tools=el('div',{class:'composer-tools'});
   if(canInvite){
    // X-style tagging: insert the mention at the caret and let the input listener derive the Bok action.
    const area=fields.get('content');
    bokChip=button('@bok',()=>{if(mentionsBok(area.value)){area.focus();return;}const at=area.selectionStart??area.value.length,before=area.value.slice(0,at),after=area.value.slice(at);area.setRangeText((before&&!/\s$/.test(before)?' ':'')+'@bok'+(after&&!/^\s/.test(after)?' ':''),at,at,'end');area.dispatchEvent(new Event('input',{bubbles:true}));area.focus();});
    bokChip.className='button bok-chip';bokChip.setAttribute('aria-label','Mention Bok');bokChip.setAttribute('aria-pressed',String(kind==='bok'));tools.append(bokChip);
   }
   tools.append(el('details',{},el('summary',{},'Preview message'),preview),counter);content.append(tools);
   if(canInvite){
    const addPost=(area,entry)=>{
     const add=button('+',()=>{
      if(busy||threadPosts.length>=MAX_THREAD_POSTS-1||!area.value)return;
      const [fitting,overflow]=splitMessage(area.value);
      if(overflow){if(entry)entry.content=fitting;else draft.content=fitting;}
      threadPosts.push({content:overflow,budget:'0.25'});render();
      const next=content.querySelector('textarea[data-thread-index="'+threadPosts.length+'"]');next?.focus();next?.scrollIntoView({block:'nearest'});
     });
     add.className='button thread-add';add.setAttribute('aria-label','Add another post');add.title='Add another post';threadAddButtons.push({button:add,area});return add;
    };
    if(!threadPosts.length)tools.append(addPost(fields.get('content'),null));
    const list=el('div',{class:'thread-drafts'});
    threadPosts.forEach((entry,index)=>{
     const row=el('section',{class:'thread-draft','aria-label':'Post '+(index+2)}),area=el('textarea',{rows:'4','data-thread-index':String(index+1),'aria-label':'Post '+(index+2)}),meter=createMessageBudget();area.value=entry.content;
     const remove=button('Remove',()=>{if(busy)return;threadPosts.splice(index,1);render();});remove.className='button thread-remove';remove.setAttribute('aria-label','Remove post '+(index+2));
     const heading=el('div',{class:'thread-draft-heading'},el('strong',{},'Post '+(index+2)),remove),toolbar=el('div',{class:'composer-tools'},meter.node);
     const budget=el('input',{type:'text',inputmode:'decimal','aria-label':'Maximum Bok cost for post '+(index+2)+' (USDC)'});budget.value=entry.budget??'0.25';
     const invitation=label('Maximum Bok cost (USDC)',budget);invitation.classList.add('thread-bok-budget');
     area.addEventListener('input',()=>{entry.content=area.value;validate();});budget.addEventListener('input',()=>{entry.budget=budget.value;validate();});
     threadFields.push({area,meter,budget,invitation});
     if(index===threadPosts.length-1)toolbar.append(addPost(area,entry));
     row.append(heading,area,invitation,toolbar);list.append(row);
    });content.append(list);
   }
  }
  const prepareReview=()=>{
   if(busy||!validate())return;
   let action={type:kind};for(const [key,node]of fields)action[key]=node.value;
   if(kind==='bio'||kind==='avatar'){action.name=draft.name;action.expectedVersion=profileSnapshot[kind==='bio'?'bioVersion':'avatarVersion'];}
   else if(fields.has('content'))Object.assign(action,{name:draft.name,deposit:draft.deposit});
   if(kind==='reply'||kind==='bok')Object.assign(action,{subboard:draft.subboard,parent:draft.parent,root:draft.root});
   if(kind==='bok')action.budget=units(action.budget,6);
   if(threadPosts.length){
    const contents=[fields.get('content').value,...threadFields.map(row=>row.area.value)];
    const budgets=contents.map((text,index)=>mentionsBok(text)?units(index?threadFields[index-1].budget.value:fields.get('budget').value,6):'0');
    action={type:'thread',deposit:draft.deposit,name:draft.name,subboard:draft.subboard,parent:replyContext(draft)?draft.parent:'0',root:replyContext(draft)?draft.root:'0',contents,budgets};
   }
   const selectedAvatar=avatarDraft;
   const direct=immediateTypes.has(action.type);
   void work(async()=>{
    const expectedRules=direct?displayedPostingRules(action):undefined;
    if(!direct)await checkPostingRules(action);
    if(kind==='name'&&selectedAvatar?.blob)action.avatar={width:100,height:100,data:await blobData(selectedAvatar.blob)};
    if(kind==='avatar')Object.assign(action,selectedAvatar?.clear?{width:0,height:0,data:''}:{width:100,height:100,data:await blobData(selectedAvatar.blob)});
    try{await executeAction(action,{immediate:direct,postingRules:expectedRules});}catch(failure){if(kind==='bio'||kind==='avatar')profileSnapshot=null;throw failure;}
   },actionFailure,{posting:postingTypes.has(action.type),action:direct});
  };
  const cost=el('strong'),balance=el('strong');
  if(immediateTypes.has(draft.type)){
   const balanceLabel=el('span');
   updatePostingBalance=()=>{balanceLabel.textContent=accountRefreshNeeded||accountRefreshPending?'Balance (updating) ':'Balance ';balance.textContent=typeof status?.privateFeeCredit==='string'?compactAmount(status.privateFeeCredit,18,4):status?.status==='fee-needed'?'0':'—';if(typeof status?.privateFeeCredit==='string')balance.setAttribute('title',decimal(status.privateFeeCredit,18));else balance.removeAttribute('title');validate();};
   content.append(el('div',{class:'composer-cost'},el('span',{},balanceLabel,balance),el('span',{},'Max cost ',cost),el('small',{},'posting credits')));
  }
  const review=button(reviewLabel(draft),prepareReview,true);
  const threadNotice=el('p',{class:'thread-limit-note',role:'status',hidden:''});
  review.dataset.actionReview='';content.append(threadNotice,review);updatePostingBalance();
  function validate(){
   let valid=rulesReady(draft)&&[...fields.values()].every(node=>!node.required||node.value.length>0);
   for(const id of IDS)if(fields.has(id))valid=valid&&field(fields.get(id).value);
   if(fields.has('content')){
    const text=fields.get('content').value,a=allowance(text);preview.replaceChildren(createMessageContent(text));
    budgetMeter.update(a);
    valid=valid&&a.remaining>=0&&text.isWellFormed()&&!text.includes('\0')&&(kind==='bio'||!!draft.deposit);
   }
   let threadBokCount=0;
   if(threadPosts.length){
    let bokTotal=0n;
    const texts=[fields.get('content').value,...threadFields.map(row=>row.area.value)];
    for(const [index,text]of texts.entries()){
     const a=allowance(text);valid=valid&&a.valid&&text.trim().length>0&&text.isWellFormed()&&!text.includes('\0');
     if(index){const row=threadFields[index-1];row.meter.update(a);row.invitation.hidden=!mentionsBok(text);}
     if(mentionsBok(text)){threadBokCount++;try{const budget=BigInt(units(index?threadFields[index-1].budget.value:fields.get('budget').value,6));valid=valid&&budget>0n;bokTotal+=budget;}catch{valid=false;}}
    }
    valid=valid&&bokTotal<=BigInt(bokStatus?.availableCredit??'0');
   }
   const threadLimit=threadBokCount>1?'Mention Bok in one post per thread.':threadBokCount&&threadPosts.length>2?'Threads with Bok can include up to 3 posts.':'';
   threadNotice.textContent=threadLimit;threadNotice.hidden=!threadLimit;valid=valid&&!threadLimit;
   for(const {button,area}of threadAddButtons){button.dataset.unavailable=String(!area.value||threadPosts.length>=MAX_THREAD_POSTS-1);button.disabled=busy||button.dataset.unavailable==='true';button.title=threadPosts.length>=MAX_THREAD_POSTS-1?`${MAX_THREAD_POSTS} posts per transaction`:'Add another post';}
   if(kind==='transfer-moderator'){const successor=fields.get('successor').value;valid=valid&&moderatorStatus?.authorized===true&&field(successor)&&BigInt(successor)>0n&&transferConsent.checked===true;}
   else if(MODERATOR_TYPES.has(kind)){valid=valid&&moderatorStatus?.authorized===true;const key=kind==='set-main-policy'?'rules':'reason',value=fields.get(key).value;valid=valid&&value.isWellFormed()&&!value.includes('\0')&&new TextEncoder().encode(value).length<=(key==='rules'?992:217);if(kind!=='set-main-policy'){const id=fields.get(kind==='moderate-post'?'post':kind==='moderate-avatar'?'name':'subboard').value;valid=valid&&field(id)&&BigInt(id)>0n;}}
   if(kind==='reply')valid=valid&&replyContext(draft);
   if(kind==='bok'){const {parent,root,subboard}=draft;valid=valid&&field(subboard)&&field(parent)&&field(root)&&((BigInt(parent)===0n)===(BigInt(root)===0n));try{const v=BigInt(units(fields.get('budget').value,6));valid=valid&&v<(1n<<128n)&&v<=BigInt(bokStatus?.availableCredit??'0');}catch{valid=false;}}
   if(kind==='bio'||kind==='avatar')valid=valid&&!!profileSnapshot&&identities.includes(draft.name)&&BigInt(profileSnapshot.name)===BigInt(draft.name)&&(kind!=='avatar'||!!avatarDraft);
   if(kind==='subboard')valid=valid&&/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(fields.get('slug').value);
   const selectedLimit=!threadPosts.length&&['post','reply','quote','repost'].includes(draft.type)?session?.ordinaryPostingFeeLimit:session?.postingFeeLimit;const maximum=typeof selectedLimit==='string'?selectedLimit:null;cost.textContent=maximum?compactAmount(maximum,18,4,true):'—';if(maximum)cost.setAttribute('title',decimal(maximum,18));
   review.textContent=postingInProgress?'Posting…':threadPosts.length?'Post all':reviewLabel(draft);review.dataset.unavailable=String(!valid);review.disabled=busy||!valid;return valid;
  }
  rulesView(draft,validate);
  fields.get('subboard')?.addEventListener('change',()=>{void loadRules(rulesId(draft),true).catch(()=>{});});
  validate();
 }
 function fundingWalletView(target=content, explanation='Choose the wallet you want to pay with.'){
  if(typeof runtime.fundingWallets!=='function'||typeof runtime.connectFundingWallet!=='function'||typeof runtime.fundingWalletStatus!=='function')return true;
  const snapshot=runtime.fundingWalletStatus();
  if(snapshot.connected){
   if(typeof snapshot.name!=='string'||typeof snapshot.address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(snapshot.address))throw connectionFailure;
   target.append(el('p',{class:'connected-wallet'},el('span',{'aria-hidden':'true'},'✓'),snapshot.name+' '+snapshot.address.slice(0,6)+'…'+snapshot.address.slice(-4)));return true;
  }
  target.append(el('h3',{},'Connect your wallet'),paragraph(explanation));
  walletChoices(target,choice=>void work(async()=>{
   const epoch=accountEpoch;checkAccount(epoch);note('Open '+choice.name+' to connect.');await runtime.connectFundingWallet(choice.id);checkAccount(epoch);note('');
  }));return false;
 }
 function stopFunding(){fundingAutomatic=false;fundingActiveCapability?.pauseClaim();}
 function units(value,decimals){
  if(typeof value!=='string'||!new RegExp('^(0|[1-9][0-9]{0,30})(?:\\.[0-9]{1,'+decimals+'})?$').test(value))throw connectionFailure;
  const [whole,fraction='']=value.split('.');const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));if(result<=0n)throw connectionFailure;return result.toString();
 }
 function currentFundingAttempt(capability=session?.funding){
  return fundingAttempt?.epoch===accountEpoch&&fundingAttempt.session===session&&fundingAttempt.capability===capability?fundingAttempt:null;
 }
 function beginFundingAttempt(capability){
  fundingFailureStep=null;dialog.removeAttribute('data-rolling-funding');
  return fundingAttempt={epoch:accountEpoch,session,capability,paymentState:null,step:'payment'};
 }
 function fundingErrorShape(failure){
  try{
  const one=value=>{
   let code;try{code=Object.getOwnPropertyDescriptor(value??{},'code')?.value;}catch{}
   const kind=value instanceof AggregateError?'AggregateError':value instanceof ReferenceError?'ReferenceError':value instanceof TypeError?'TypeError':value instanceof RangeError?'RangeError':value instanceof Error?'Error':'unknown';
   return {kind,code:fundingCodes.has(code)||fundingExtraCodes.has(code)||initializationCodes.has(code)?code:'unknown'};
  };
  const result=one(failure);
  if(result.kind==='AggregateError'){
   const errors=Object.getOwnPropertyDescriptor(failure,'errors')?.value;
   if(Array.isArray(errors))result.causes=errors.slice(0,4).map(one);
  }
  return result;
  }catch{return {kind:'unknown',code:'unknown'};}
 }
 function fundingProblem(failure,attempt){
  if(!attempt||attempt!==fundingAttempt||attempt.epoch!==accountEpoch||attempt.session!==session)return failure;
  if(Object.getOwnPropertyDescriptor(failure??{},'fundingDiagnostic')?.value===attempt.failure&&attempt.failure)return failure;
  const shape=fundingErrorShape(failure),step=fundingFailureStep?.step??attempt.step;
  const diagnostic={stage:'funding',step:fundingSteps.has(step)||['payment','readiness'].includes(step)?step:'payment',state:'failed',...shape,paymentState:fundingPaymentStates.has(attempt.paymentState)?attempt.paymentState:'unconfirmed'};
  dialog.setAttribute('data-rolling-funding',JSON.stringify(diagnostic));attempt.failure=diagnostic;
  if(!fundingPaymentStates.has(attempt.paymentState))return failure;
  return Object.assign(new Error('Funding could not finish.'),{code:shape.code,fundingDiagnostic:diagnostic,fundingPaymentState:attempt.paymentState});
 }
 async function advanceFunding(){
  const epoch=accountEpoch;checkAccount(epoch);
  const capability=fundingActiveCapability=fundingCapability();const attempt=currentFundingAttempt(capability)??beginFundingAttempt(capability);fundingFailureStep=null;attempt.step='inspect';render();
  try{
  let result;try{result=await capability.advanceClaim();}finally{if(fundingActiveCapability===capability)fundingActiveCapability=null;}checkAccount(epoch);
  if(['included','complete'].includes(result.state)){
   attempt.paymentState='credited';attempt.step='readiness';
   transactionTiming.complete();
   const finishReadiness=beginRollingMeasure('funding.readiness');
   try{
   const provisional=result.state==='included';
   if(provisional){const claimed=result.intent;includedObservation={txHash:claimed.txHash,action:claimed.action,inclusion:claimed.inclusion,observed:null};actionFeedback.textContent='Credit added: confirmation pending.';actionFeedback.hidden=false;requestIncludedObservation();}
   const bokTopup=view==='topup'&&topupKind==='bok';stopFunding();
   if(bokTopup){
    // The fresh native Bok balance is the completion read. This claim does
    // not change collateral; invalidate its spent fee display without another
    // full inventory scan. The next transaction still checks native state.
    invalidateBokBalance();await measureRollingStage('action.required-account-refresh',loadBok);checkAccount(epoch);
    if(bokBalance.snapshot().phase!=='ready'||bokStatus?.available!==true)throw connectionFailure;
    if(status){status={...status};delete status.privateFeeCredit;}
    intent=null;blocked=false;balances=null;bokAccounting=null;
   }else if(view==='topup'&&topupKind==='private-fee'){
    // Only fee credit changes. Combine its fresh native value with the
    // existing collateral classification; actual actions validate afresh.
    const credit=await measureRollingStage('action.required-account-refresh',()=>session.application.readPrivateFeeCredit());checkAccount(epoch);
    if(typeof credit?.availableCredit!=='string'||!/^(0|[1-9][0-9]*)$/.test(credit.availableCredit)||BigInt(credit.availableCredit)>=(1n<<128n))throw connectionFailure;
    status={...status,privateFeeCredit:credit.availableCredit};
    if(['fee-needed','fee-ready','collateral-pending'].includes(status.status)&&Array.isArray(status.depositIds))
     status={...status,status:BigInt(credit.availableCredit)===0n?'fee-needed':status.depositIds.length?'fee-ready':'collateral-pending'};
    intent=null;blocked=false;balances=null;
   }else{await refresh();checkAccount(epoch);}
   if(view==='topup'){notice=(bokTopup?'Bok credit added.':'Posting credit added.')+(provisional?' Confirmation pending.':'');topupSaved=null;resetTopupQuote();view=draft.content?'action':'overview';}
   else{
    const account=status?.status==='fee-ready'?'Posting collateral and network fee credit were found.':status?.status==='fee-needed'?'Network fee credit is still needed.':status?.status==='collateral-pending'?'Network fee credit was found; posting collateral is not yet available.':'The account still needs a recovery check.';
    notice=status?.status==='fee-ready'?(provisional?'Your posting balance is ready. Confirmation pending.':'Your posting balance is set up.'):'Your posting balance is still being checked. Refresh your account before posting.';view=inlineCreation?'action':'overview';if(inlineCreation)await loadView();
   }
   if(fundingAttempt===attempt)fundingAttempt=null;dialog.removeAttribute('data-rolling-funding');
   }finally{finishReadiness();}
  }
  else if(result.state==='review-payment'){stopFunding();topupQuote=null;notice='Token approval confirmed. Review the separate top-up payment; no deposit is sent automatically.';}
  else if(['review','review-saved','reverted','cancelled'].includes(result.state)){
   stopFunding();intent=result.intent;
   notice=result.state==='review-saved'?'This saved claim has not been submitted. Review it explicitly before sending; the Ethereum payment will not repeat.':result.state==='reverted'?'The private claim reverted. Review recovery; do not repeat the Ethereum payment.':'The private claim needs a new review. No additional Ethereum payment will be sent.';
  }else{
   stopFunding();
   notice=result.state==='paused'?'Funding checks paused. Your saved payment and claim records are preserved.':result.state==='waiting'?(result.phase==='payment'?'The saved payment is not yet confirmed. Resume recovery to check its original transaction; no payment will be repeated.':'The bridge is not yet ready. Resume saved funding to check delivery; no payment will be repeated.'):'The saved private claim remains unresolved. Resume to check its original transaction; it will not be submitted again.';
  }
  }catch(failure){throw fundingProblem(failure,attempt);}
 }
 function fundingCapability(){
  const type=intent?.action?.type;if(type==='claim-private-fee')return session?.topup?.['private-fee'];if(type==='claim-bok')return session?.topup?.bok;
  return view==='topup'?session?.topup?.[topupKind]:session?.funding;
 }
 function resetTopupQuote(){topupQuote=null;topupQuoteKey=null;topupQuoteError='';updateTopupQuote();}
 function topupSelection(){
  const cap=session?.topup?.[topupKind],isBok=topupKind==='bok';
  if(!cap)return null;
  const input={amount:units(topupInputs.amount,isBok?6:18),asset:topupInputs.asset,privateFeeCap:cap.defaultPrivateFeeCap};
  return {cap,input,key:JSON.stringify([accountEpoch,topupKind,input])};
 }
 function requestTopupQuote(){
  if(busy||initializing||blocked||intent||fundingAutomatic||topupSaved?.paymentSaved&&!topupSaved?.completed||view!=='topup'||!dialog.open||topupQuotePending)return;
  let selected;try{selected=topupSelection();}catch{return;}
  if(!selected||selected.key===topupQuoteKey)return;
  const {cap,input,key}=selected,epoch=accountEpoch;topupQuoteKey=key;topupQuote=null;topupQuoteError='';
  topupQuotePending=(async()=>{
   await bokBalance.settled();await postingCreditPending;if(busy||view!=='topup'||epoch!==accountEpoch){if(topupQuoteKey===key)topupQuoteKey=null;return;}
   let current;try{current=topupSelection();}catch{return;}if(current?.key!==key)return;
   try{const quoted=await cap.prepare(input);checkAccount(epoch);if(topupSelection()?.key===key)topupQuote=quoted;}
   catch(failure){
    if(epoch!==accountEpoch||view!=='topup')return;
    let current;try{current=topupSelection();}catch{return;}if(current?.key!==key)return;
    topupQuoteError=aggregateFundingFailure(topupFailure(failure,'quote'));
    try{const saved=await cap.inspect();checkAccount(epoch);if(saved?.paymentSaved&&!saved.completed)topupSaved=saved;}catch{}
   }
  })().finally(()=>{topupQuotePending=null;updateTopupQuote();if(view==='topup'&&!busy)queueMicrotask(requestTopupQuote);});
  updateTopupQuote();
 }
 async function continueTopup(cap,isBok){
  const saved=await cap.inspect();if(!saved?.paymentSaved||saved.completed){topupSaved=null;resetTopupQuote();return;}
  if(['swap','approval'].includes(saved.phase)){
   await cap.recover({wait:true});topupInputs={amount:decimal(saved.amount,isBok?6:18),asset:saved.asset};topupSaved=null;resetTopupQuote();return;
  }
  fundingAutomatic=true;try{await advanceFunding();}catch(error){stopFunding();throw topupFailure(error,'claim');}
 }
 function topupView(){
  if(!fundingWalletView())return;
  const choices=Object.keys(session.topup??{});if(!choices.length){content.append(paragraph('Credit purchases are unavailable for this account.'));return;}
  if(!choices.includes(topupKind))topupKind=choices[0];
  const cap=session.topup[topupKind],isBok=topupKind==='bok';
  if(!topupInputs.amount)topupInputs.amount=isBok?'1':decimal(BigInt(cap.defaultPrivateFeeCap)*2n,18);
  if(!topupInputs.asset)topupInputs.asset=cap.ethAvailable?'ETH':'USDC';
  if(isBok)content.append(paragraph('Use Bok credit when you ask @bok to reply.'));
  const amountName=isBok?'Amount (USD)':'Posting credit amount',amount=el('input',{type:'text',inputmode:'decimal','aria-label':amountName});amount.value=topupInputs.amount;const edits=[amount];
  amount.addEventListener('input',()=>{topupInputs.amount=amount.value;resetTopupQuote();requestTopupQuote();});
  amount.addEventListener('change',requestTopupQuote);content.append(label(amountName,amount));
  if(isBok){
   const presets=el('div',{class:'credit-presets'});for(const value of ['1','5','10'])presets.append(button('$'+value,()=>{amount.value=value;topupInputs.amount=value;resetTopupQuote();requestTopupQuote();}));edits.push(...presets.children);content.append(presets);
  }
  {
   const asset=el('select',{'aria-label':'Pay with'});if(cap.ethAvailable)asset.append(el('option',{value:'ETH'},'ETH'));if(cap.usdcAvailable!==false)asset.append(el('option',{value:'USDC'},'USDC'));asset.value=topupInputs.asset;edits.push(asset);
   asset.addEventListener('change',()=>{topupInputs.asset=asset.value;resetTopupQuote();requestTopupQuote();});content.append(label('Pay with',asset));
  }
  const summary=el('div',{class:'credit-total','aria-live':'polite'}),feedback=el('p',{role:'status',class:'quiet'});
  const pay=button('Pay',()=>void work(async()=>{
   const selected=topupSelection(),q=topupQuote,epoch=accountEpoch;
   if(!q||selected?.key!==topupQuoteKey)throw topupFailure(Error('Price changed'),'quote');
   topupQuote=null;
   try{
    await runTopupPayment(cap,selected.input,q,phase=>{checkAccount(epoch);note(phase==='confirmation'?'Waiting for Ethereum confirmation…':phase==='approval'?(isBok?'Approve USDC spending in your wallet…':'Approve FEE spending in your wallet…'):'Confirm your payment in your wallet…');});
    checkAccount(epoch);topupSaved={paymentSaved:true,phase:'deposit',...selected.input};fundingAutomatic=true;try{await advanceFunding();}catch(error){stopFunding();throw topupFailure(error,'claim');}
   }catch(failure){topupQuoteError=aggregateFundingFailure(failure)??'The payment could not complete. Refresh the price and try again.';try{topupSaved=await cap.inspect();}catch{}throw failure;}
  },aggregateFundingFailure),true);
  const retry=button('Refresh price',()=>{resetTopupQuote();requestTopupQuote();});
  const resume=button('Continue payment',()=>void work(()=>continueTopup(cap,isBok),aggregateFundingFailure));
  updateTopupQuote=()=>{
   if(view!=='topup'||!summary.isConnected)return;
   let valid=false;try{valid=!!topupQuote&&topupSelection()?.key===topupQuoteKey;}catch{}
   const q=valid?topupQuote:null,balance=isBok?bokStatus?.availableCredit:status?.privateFeeCredit;
   const displayedBalance=balance===undefined?'—':(isBok?decimal(balance,6):compactAmount(balance,18,4))+(isBok?' USDC':''),displayedPayment=q?(q.asset==='ETH'?compactAmount(q.maximumSwapWei,18,8,true)+' ETH':decimal(q.maximumUsdc??q.amount,6)+' USDC'):'—';
   summary.replaceChildren(el('span',{},'Balance ',el('strong',balance===undefined?{}:{title:decimal(balance,isBok?6:18)},displayedBalance)),el('span',{},q?(q.asset==='ETH'||q.maximumUsdc?'Pay up to ':'Pay '):'Payment ',el('strong',q?{title:decimal(q.asset==='ETH'?q.maximumSwapWei:q.maximumUsdc??q.amount,q.asset==='ETH'?18:6)}:{},displayedPayment)));
   const pending=!!topupSaved?.paymentSaved&&!topupSaved.completed;for(const edit of edits){edit.dataset.unavailable=String(pending);edit.disabled=busy||pending;}pay.hidden=pending||fundingAutomatic;pay.dataset.unavailable=String(!valid);pay.disabled=busy||!valid;
   retry.hidden=!topupQuoteError||pending;resume.hidden=!pending||fundingAutomatic;
   feedback.textContent=topupQuotePending?'Getting the current price…':topupQuoteError||(q?(q.maximumUsdc?'Includes the relay fee. No ETH is needed; unused USDC is returned.':'Plus the Ethereum fee shown in your wallet.'):'Enter an amount to see the price.');
  };
  content.append(summary,feedback,pay,retry,resume);updateTopupQuote();
 }
 async function prepareFundingQuote(){
  fundingQuoteRequested=true;const epoch=accountEpoch;checkAccount(epoch);note('Getting the current price…');
  fundingQuote=await session.funding.prepareStarter({asset:fundingInputs.asset});checkAccount(epoch);note('');
 }
 function fundingSummary(labelText,amount,explanation){return el('div',{class:'funding-line'},el('div',{},el('strong',{},labelText),el('p',{class:'quiet'},explanation)),el('strong',{},amount));}
 function aggregateFundingView(){
  if(!session.funding){content.append(paragraph('Account funding is currently unavailable. Try again later.'));return;}
  const savedAttempt=currentFundingAttempt();
  if(savedAttempt&&fundingPaymentStates.has(savedAttempt.paymentState)){
   content.append(el('h3',{},'Finish account setup'));
   if(!fundingAutomatic)content.append(button('Continue setup',()=>void work(()=>advanceFunding(),aggregateFundingFailure),true));
   else content.append(paragraph('Keep this page open while setup continues.'));
   return;
  }
  if(!fundingAutomatic&&session.funding.usdcAvailable){const asset=el('select',{'aria-label':'Pay with'});for(const [value,text]of [['ETH','ETH'],['USDC','USDC — no ETH needed']])asset.append(el('option',{value},text));asset.value=fundingInputs.asset;asset.addEventListener('change',()=>{clearOperationFeedback();fundingInputs.asset=asset.value;fundingQuote=null;fundingQuoteRequested=false;render();});content.append(label('Pay with',asset));}
  if(fundingQuote){
   const q=fundingQuote,b=q.breakdown,isUsdc=q.kind==='rolling-aggregate-usdc-v1',currency=isUsdc?' USDC':' ETH';
   const deposit=isUsdc?decimal(b.collateral.maxUsdc,6):compactAmount(b.collateralWei,18,8,true);
   const posting=isUsdc?decimal(b.fee.maxUsdc,6):compactAmount(b.fee.maxEth,18,8,true);
   const assistant=isUsdc?decimal(b.bokAmount,6):compactAmount(b.bok.maxEth,18,8,true);
   content.append(el('h3',{},'Set up posting'),
    fundingSummary('Refundable deposit',deposit+currency,'Discourages spam. Withdraw after your posts have been checked and the wait between posts has ended. Rule-breaking posts extend the wait.'),
    fundingSummary('Posting balance',posting+currency,'Pays the network each time you post or update your account.'),
    ...(BigInt(isUsdc?b.bokAmount:b.bok.amount)>0n?[fundingSummary('Bok assistant',assistant+currency,decimal(isUsdc?b.bokAmount:b.bok.amount,6)+' USDC of credit for requests to Bok.')]:[]),
    fundingSummary(isUsdc?'Payment fee':'Ethereum fee limit',(isUsdc?decimal(b.relayFeeUsdc,6):compactAmount(b.gasBudgetWei,18,8,true))+currency,isUsdc?'Included in your USDC payment.':'You pay the actual network fee, up to this limit.'),
    el('div',{class:'funding-total'},el('span',{},'Maximum total'),el('strong',{title:decimal(isUsdc?b.maximumUsdc:b.maximumTotalWei,isUsdc?6:18)+currency},(isUsdc?decimal(b.maximumUsdc,6):compactAmount(b.maximumTotalWei,18,8,true))+currency)),
    paragraph(isUsdc?'≈ $'+Number(decimal(b.maximumUsdc,6)).toFixed(2)+' USD':q.usdEstimate?'≈ $'+q.usdEstimate+' USD':'USD estimate unavailable'),
    paragraph('Sepolia testnet · test funds only.'),
    paragraph(isUsdc?'Your wallet will ask for two signatures to approve this payment.':'Approve the payment in your wallet.'));
   const details=el('details',{class:'account-details'},el('summary',{},'Payment details'),paragraph('Deposit held: '+decimal(isUsdc?b.collateral.amount:b.collateralWei,18)+' ETH.'),paragraph('Posting balance: '+decimal(b.fee.amount,18)+' fee tokens. Account setup can use up to '+decimal(q.privateFeeCap,18)+' of these tokens.'),paragraph('Exchange price tolerance: '+(q.slippageBps/100)+'%. Unused exchange funds are returned to the paying wallet.'));content.append(details);
   content.append(button('Confirm payment',()=>void work(async()=>{
    const epoch=accountEpoch,capability=session.funding;checkAccount(epoch);const attempt=beginFundingAttempt(capability);fundingQuote=null;fundingAutomatic=true;notice='Approve the payment in your wallet…';render();
    try{
     const payment=await capability.confirm({onSubmitted:()=>{checkAccount(epoch);attempt.paymentState='submitted';note('Waiting for Ethereum confirmation…');}});note('');checkAccount(epoch);
     attempt.paymentState=payment?.pending?'submitted':'confirmed';fundingAutomatic=true;notice=payment?.pending?'Payment submitted. Waiting for confirmation…':'Payment confirmed. Setting up posting…';await advanceFunding();
    }catch(failure){
     checkAccount(epoch);
     // The existing authenticated local payment summary is the only fallback
     // when a wallet acknowledgment was lost. It cannot authorize another send.
     const code=Object.getOwnPropertyDescriptor(failure??{},'code')?.value;if(!attempt.paymentState&&['BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_CONFIRMATION_UNKNOWN'].includes(code))attempt.paymentState='unknown';
     if(!attempt.paymentState){try{const saved=await capability.inspect();checkAccount(epoch);if(saved?.paymentSaved)attempt.paymentState='saved';}catch{checkAccount(epoch);}}
     throw fundingProblem(failure,attempt);
    }
   },aggregateFundingFailure),true));
  }else if(!fundingAutomatic){
   content.append(el('h3',{},'Set up posting'),paragraph('A refundable deposit discourages spam. Your posting balance pays for posts and account updates.'));
   if(fundingQuoteRequested&&!busy)content.append(button('Refresh price',()=>void work(prepareFundingQuote,aggregateFundingFailure),true));
  }
  if(fundingAutomatic)content.append(paragraph('Keep this page open until your posting balance is ready.'));
 }
 function fundingView(){
  const connected=fundingWalletView();if(connected)aggregateFundingView();

 }
 function restoreDialogContent(){inlineName.hidden=true;dialog.append(description,live,content);}
 function likeSnapshotKey({checkpoint,anchor,confirmationCheckpoint,revision}={}){
  const block=checkpoint??anchor;if(!Number.isSafeInteger(block?.number)||block.number<0||!/^0x[0-9a-f]{64}$/.test(block?.hash)||typeof revision!=='string')return null;
  if(confirmationCheckpoint!==undefined&&(!Number.isSafeInteger(confirmationCheckpoint?.number)||confirmationCheckpoint.number<0||!/^0x[0-9a-f]{64}$/.test(confirmationCheckpoint?.hash)))return null;
  return JSON.stringify([block.number,block.hash,revision,confirmationCheckpoint?.number??null,confirmationCheckpoint?.hash??null]);
 }
 function observeLikeFeed(snapshot){
  const key=likeSnapshotKey(snapshot);if(key===null||key===likeFeedKey)return;
  likeFeedKey=key;likes.clear();likeAttempted.clear();requestLikes();onPrivateChange();
 }
 function likeState(post){
  if(!unlocked()||!field(post))return null;const id=BigInt(post).toString();if(pendingLikes.has(id))return true;
  const value=likes.get(id);return value?.anchor===likeFeedKey?value.liked:null;
 }
 function loadLikes(posts,snapshot){
  if(!Array.isArray(posts))return;
  likeWanted.clear();for(const post of posts)if(field(post)&&BigInt(post)>0n)likeWanted.add(BigInt(post).toString());
  if(snapshot)observeLikeFeed(snapshot);requestLikes();
 }
 function requestLikes(){
  if(likesPending||likeFeedKey===null||!session||!unlocked()||typeof session.application.readLikes!=='function')return;
  const posts=[...likeWanted].filter(post=>!pendingLikes.has(post)&&!likes.has(post)&&likeAttempted.get(post)!==likeFeedKey).slice(0,32);if(!posts.length)return;
  const epoch=accountEpoch,active=session,anchor=likeFeedKey,previous=new Map(posts.map(post=>[post,likes.get(post)]));for(const post of posts)likeAttempted.set(post,anchor);
  const pending=Promise.resolve().then(()=>active.application.readLikes(posts)).then(result=>{
   if(epoch!==accountEpoch||active!==session||!unlocked()||anchor!==likeFeedKey||likeSnapshotKey(result)!==anchor)return;
   if(!Array.isArray(result?.posts)||result.posts.length!==posts.length||result.posts.some((row,index)=>row.post!==posts[index]||typeof row.liked!=='boolean'))return;
   // A completed transaction or receipt observation may have filled this row
   // while the public request was pending. Its newer result owns the display.
   for(const row of result.posts)if(!pendingLikes.has(row.post)&&likes.get(row.post)===previous.get(row.post))likes.set(row.post,{liked:row.liked,anchor});onPrivateChange();
  }).catch(()=>{}).finally(()=>{if(likesPending===pending){likesPending=null;requestLikes();}});
  likesPending=pending;
 }
 function addPostingCredit(){
  if(initializing||busy||blocked||intent||!session?.topup?.['private-fee']||!unlocked())return;
  inlineCreation=false;restoreDialogContent();topupKind='private-fee';topupInputs={amount:''};resetTopupQuote();topupSaved=null;view='topup';clearOperationFeedback();
  if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();}render();
 }
 function requestPostingCredit(){
  if(!identityHost||busy||initializing||blocked||intent||!session||!unlocked()||session.busy||bokBalance.pending||topupQuotePending||postingCreditPending||accountRefreshPending||accountRefreshNeeded||composerPreparation||typeof status?.privateFeeCredit==='string'||postingCreditAttempt===status||typeof session.application.readPrivateFeeCredit!=='function')return;
  const epoch=accountEpoch,active=session,previous=status;postingCreditAttempt=previous;
  postingCreditPending=Promise.resolve().then(()=>active.application.readPrivateFeeCredit()).then(credit=>{
   if(epoch===accountEpoch&&active===session&&status===previous&&unlocked()&&typeof credit?.availableCredit==='string'&&/^(0|[1-9][0-9]*)$/.test(credit.availableCredit))status={...status,privateFeeCredit:credit.availableCredit};
  }).catch(()=>{}).finally(()=>{postingCreditPending=null;renderPostingCreditControls();updatePostingBalance();requestAccountRefresh();requestBokBalance();requestComposerPreparation();});
  renderPostingCreditControls();
 }
 function renderPostingCreditControls(){
  postingCreditControls.replaceChildren();postingCreditControls.hidden=!session||!unlocked();if(postingCreditControls.hidden)return;
  const credit=status?.privateFeeCredit,known=typeof credit==='string'&&/^(0|[1-9][0-9]*)$/.test(credit),updating=!!postingCreditPending||!!accountRefreshPending||accountRefreshNeeded||postingCreditAttempt!==status&&!known;
  const amount=el('span',{'data-posting-credit':'','aria-live':'polite'},known?compactAmount(credit,18,4)+(updating?' · updating':''):updating?'Updating…':'Unavailable');
  if(known)amount.title=decimal(credit,18)+' posting credits';
  postingCreditControls.append(el('strong',{},'Posting credit'),amount);
  if(session.topup?.['private-fee']){const add=button('Add credit',addPostingCredit);add.setAttribute('aria-label','Add posting credit');add.dataset.unavailable=String(initializing||blocked||!!intent);add.disabled=busy||initializing||blocked||!!intent;postingCreditControls.append(add);}
 }
 function renderIdentityControls(){
  if(!identityHost)return;
  const signedIn=unlocked();
  if(signedIn&&namesLoaded&&cursor===null&&selectedName!=='0'&&!identities.includes(selectedName)){selectedName='0';selectedLabel='Anonymous';notice='Your previous posting name is no longer available. Posting as Anonymous.';}
  const select=el('select',{'aria-label':'Post as'},el('option',{value:'0'},'Anonymous'));
  if(signedIn)for(const record of identityRecords)select.append(el('option',{value:record.id},`${record.first} ${record.last}`));
  if(signedIn&&selectedName!=='0'&&!identities.includes(selectedName))select.append(el('option',{value:selectedName},selectedLabel));
  if(signedIn&&session&&(!namesLoaded||cursor!==null))select.append(el('option',{value:'load'},'Show my names…'));
  select.append(el('option',{value:'create'},'Create a name…'));
  select.value=inlineCreation?'create':signedIn?selectedName:'0';
  const incomplete=!!session&&signedIn&&(!namesLoaded||cursor!==null);select.dataset.unavailable=String(initializing);select.disabled=busy||!!intent||initializing;

  select.addEventListener('change',()=>{
   if(busy||intent)return;
   if(select.value==='load'){void work(()=>loadView({loadIdentity:true}));return;}
   if(select.value==='create'){
    inlineCreation=true;clearProfileDraft();clearOperationFeedback();view='action';draft={type:'name',first:'',last:''};
    if(dialog.open)dialog.close();inlineName.hidden=false;inlineName.append(description,live,content);render();
    if(!runtime||initializing)void initialize();else if(session&&unlocked())void work(loadView);
   }else{selectedName=select.value;selectedLabel=ownedLabel(selectedName);if(['post','reply','quote','repost','bok'].includes(draft.type))draft.name=selectedName;}
  });
  identityControls.replaceChildren(label('Post as',select),postingCreditControls,actionFeedback);renderPostingCreditControls();requestPostingCredit();

  if(inlineCreation){
   const cancel=button('Cancel',()=>{if(busy||intent)return;inlineCreation=false;restoreDialogContent();clearOperationFeedback();renderIdentityControls();});cancel.disabled=busy||!!intent;identityControls.append(cancel);
  }else if(notice.startsWith('Name created.')||notice.startsWith('Your previous posting name'))identityControls.append(el('span',{class:'quiet',role:'status'},notice));
 }
 function attachIdentityControls(host){
  identityHost=host;host.append(identityControls,inlineName);renderIdentityControls();
  // Existing names load when this selector is used, without opening a dialog.
 }
 function render(previousFocus=document.activeElement){
  updatePostingBalance=()=>{};
  renderIdentityControls();
  if(!['funding','topup'].includes(view)||invalidated||reloadRequired)stopFunding();
  const hadFocus=dialog.contains(previousFocus);
  // Use labels, never private values, to retain the same control after a form
  // change. Recreated controls have different DOM identities.
  const focusKey=node=>node.tagName+':'+(node.getAttribute('aria-label')??(node.labels?.[0]?[...node.labels[0].childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(''):['BUTTON','SUMMARY'].includes(node.tagName)?node.textContent:node.getAttribute('href')??''));
  const controls=()=>[...content.querySelectorAll('button,input,select,textarea,summary,a[href]')];
  const key=hadFocus?focusKey(previousFocus):null,index=key?controls().filter(n=>focusKey(n)===key).indexOf(previousFocus):-1;
  releasePreviews();content.replaceChildren();
  if(inlineCreation)content.append(el('h3',{},view==='funding'?'Set up your account':intent?'Review your name':'Create a name'));
  const signedIn=!!runtime&&unlocked();
  title.textContent=!signedIn?'Connect your wallet':view==='funding'?'Set up posting':view==='topup'?(topupKind==='bok'?'Add Bok credit':'Add posting credit'):view==='preferences'?'Follows and bookmarks':view==='names'?'Your names':view==='balances'?'Balance and withdrawals':view==='refund'?'Pending Ethereum refund':view==='action'?(TYPES[draft.type]??'Your account'):'Your account';
  if(signedIn&&intent&&['prepared','replacement-prepared'].includes(intent.status))title.textContent=intent.status==='replacement-prepared'?'Review replacement':reviewLabel(intent.action);
  description.textContent=!signedIn?'Join the conversation without sharing your identity.':'';
  description.hidden=!!setupMode||!description.textContent;
  const onboardingFunding=signedIn&&['fee-needed','collateral-pending'].includes(status?.status);
  steps.hidden=!!intent||invalidated||reloadRequired||!(!signedIn||!!setupMode||view==='funding'||onboardingFunding&&view==='topup');
  if(!steps.hidden){const stage=!signedIn?0:onboardingFunding||view==='funding'?1:2;steps.replaceChildren(...['Connect wallet','Set up posting','Start talking'].map((step,index)=>el('li',{'data-state':index<stage?'done':index===stage?'current':'todo'},step)));}
  content.hidden=!!setupMode;
  if(setupMode||initializing)title.textContent='Opening your account…';
  if(error)content.append(el('p',{role:'alert',tabindex:'-1',class:'notice error','data-operation-feedback':''},error));
  if(notice)content.append(el('p',{class:'notice','data-operation-feedback':''},notice));
  if(invalidated||reloadRequired){content.append(paragraph('You are signed out. Reload to connect your wallet.'),button('Reload page',()=>location.reload()));}
  else if(initializing)content.append(paragraph('Opening your account…'));
  else if(!runtime)content.append(error?button('Reload page',()=>location.reload()):paragraph('Loading account setup…'));
  else if(!unlocked())custody();
  else{
   if(!session)content.append(paragraph('Your account could not connect. Try again to continue.'),button('Reconnect',()=>void work(connect),true));
   else if(view==='refund'&&pendingWithdrawal){refundView();content.append(button(intent?'Back to saved action':'Back to account',()=>selectView('overview')));}
   else if(intent)showIntent();
   else if(blocked&&view==='preferences'){
    preferencesView();
    content.append(button('Check account recovery',()=>void work(async()=>{view='overview';await refresh();})));
   }
   else if(blocked)content.append(paragraph('Check retained recovery before preparing any new action.'),button('Check account recovery',()=>void work(refresh)));
   else{
    if(view==='funding'){fundingView();content.append(button('Back to account',()=>selectView('overview')));}
    else if(view==='topup'){topupView();if(draft.content)content.append(button('Back to your post',()=>selectView('action')));content.append(button('Back to account',()=>selectView('overview')));}
    else{
     if(view==='overview'){
      const needsFunding=status?.status==='fee-needed'||status?.status==='collateral-pending',needsTopup=status?.status==='fee-needed'&&status?.depositIds?.length>0;
      content.append(el('h3',{},needsTopup?'Add to your posting balance':needsFunding?'One more step before your first post':'Ready for a conversation?'),paragraph(needsTopup?'Your deposit is already in place. Add posting credit to keep going.':needsFunding?'Set up your posting balance to join in.':'Post anonymously, or choose a name when you write.'),button(needsTopup?'Add posting credit':needsFunding?'Set up posting':'Write a post',()=>{if(needsTopup){topupKind='private-fee';topupInputs={amount:''};resetTopupQuote();topupSaved=null;}if(needsFunding)selectView(needsTopup?'topup':'funding');else chooseAction('post');},true));
      const settings=el('details',{class:'account-links'},el('summary',{},'Account settings'));
      settings.open=accountSettingsOpen;settings.addEventListener('toggle',()=>{accountSettingsOpen=settings.open;if(settings.open)requestModeratorMenu();});
      settings.append(button('Refresh account',()=>void work(refresh)),button('Your names',()=>selectView('names')),button('Follows and bookmarks',()=>selectView('preferences')));
      if(typeof session.application.readBalances==='function')settings.append(button('Balance and withdrawals',()=>{balances=null;bokAccounting=null;selectView('balances');}));
      if(pendingWithdrawal)settings.append(button('Pending Ethereum refund',openPendingRefund));
      settings.append(button('Create a board',()=>chooseAction('subboard')));if(moderatorStatus?.authorized)settings.append(button('Update site rules',()=>chooseAction('set-main-policy')),button('Transfer moderator authority',()=>chooseAction('transfer-moderator')));
      if(session.topup?.['private-fee'])settings.append(button('Add posting credit',()=>{topupKind='private-fee';topupInputs={amount:''};resetTopupQuote();topupSaved=null;selectView('topup');}));
      content.append(settings);
     }else{
      if(!viewReady())content.append(button(view==='names'?'Load your names':'Load publishing options',()=>void work(loadView),true));
      else if(view==='refund')refundView();else if(view==='balances')balancesView();else if(view==='names')namesView();else if(view==='preferences')preferencesView();else{if(status?.status==='fee-needed'||(status?.status==='collateral-pending'&&postingTypes.has(draft.type)))content.append(paragraph('Add a posting balance before publishing.'),button(status?.depositIds?.length?'Add posting credit':'Set up posting',()=>{topupKind='private-fee';topupInputs={amount:''};resetTopupQuote();topupSaved=null;selectView(status?.depositIds?.length?'topup':'funding');},true));form();}
      if(!inlineCreation)content.append(button('Back to account',()=>selectView('overview')));
     }
    }
   }
  }
  if(signedIn&&!initializing&&!invalidated&&!reloadRequired){
   if(runtime.canStartTestAccount&&view==='overview'&&!intent)content.append(button('Start new test account',startTestAccount));
   content.append(button('Sign out',()=>void signOut()));
  }
  controlsBusy(busy);renderBokControls();requestBokBalance();watchPendingRefund();if(view==='topup'&&!busy&&(!runtime.fundingWalletStatus||runtime.fundingWalletStatus().connected))queueMicrotask(requestTopupQuote);
  if(view==='funding'&&!fundingPaymentStates.has(currentFundingAttempt()?.paymentState)&&session?.funding&&!busy&&!blocked&&!intent&&!fundingQuote&&!fundingQuoteRequested&&!fundingAutomatic&&(!runtime.fundingWalletStatus||runtime.fundingWalletStatus().connected)){
   queueMicrotask(()=>{if((dialog.open||inlineCreation)&&view==='funding'&&!busy&&!fundingQuoteRequested)void work(prepareFundingQuote,aggregateFundingFailure);});
  }
  if(dialog.open&&(!busy||previousFocus?.dataset.recoveryStop==='true'||previousFocus?.dataset.accountingStop==='true')&&(hadFocus||document.activeElement===document.body)){
   if(previousFocus.isConnected&&dialog.contains(previousFocus))previousFocus.focus({preventScroll:true});
   else{
    const same=index>=0?controls().filter(n=>focusKey(n)===key)[index]:null;
    const target=same&&!same.disabled?same:content.querySelector('h3')??closeButton;
    if(target.tagName==='H3')target.tabIndex=-1;
    target.focus({preventScroll:true});
   }
  }
 }
 function close(){if(!actionOperation?.included&&(busy||!initializing&&session?.busy&&!bokBalance.pending&&!topupQuotePending&&!postingCreditPending&&!accountRefreshPending&&!composerPreparation)){note('An account operation is in progress. Wait before closing.');return false;}stopFunding();stopRefundWatch();recoveryInspection=null;releasePreviews();if(dialog.open)dialog.close();return true;}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus();});
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(node=>!node.disabled&&node.getClientRects().length);
  if(!focusable.length){event.preventDefault();dialog.focus();return;}
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 });
 render();
 return panelApi=Object.freeze({initialize,act,open(defaults={},extras={}){
  if(defaults.type==='preference'||defaults.type==='read-marker')return false;
  if(busy){if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();closeButton.focus();}return;}
  if(inlineCreation){inlineCreation=false;restoreDialogContent();}
  if(session)unlocked(); // Detect replaced custody before rendering cached account data.
  if(!intent){clearOperationFeedback();view=defaults.view==='preferences'?'preferences':Object.hasOwn(TYPES,defaults.type)?'action':'overview';clearProfileDraft();const next={type:Object.hasOwn(TYPES,defaults.type)?defaults.type:'post',subboard:'0',content:'',name:defaults.type==='subboard'?'':selectedName};
   for(const key of IDS)if(field(defaults[key]))next[key]=defaults[key];
   if(['moderate-avatar','bio','avatar'].includes(next.type)&&field(defaults.name))next.name=defaults.name;
   if(typeof defaults.content==='string'&&defaults.content.length<=10000)next.content=defaults.content;
   // Display-only reply context for the composer; never copied into the action.
   const context=extras?.context;if(context&&field(next.parent)&&typeof context.author==='string'&&typeof context.excerpt==='string')next.context={author:context.author.slice(0,64),excerpt:context.excerpt.slice(0,200)};
   draft=next;}
  // Refunds can arrive while the composer is closed. Refresh this optional
  // snapshot in the background; typing and the unlocked session remain intact.
  if(!dialog.open&&view==='action'&&COMPOSER_TYPES.has(draft.type))requestBokBalance(true);
  if(!dialog.open){composerOpening++;returnFocus=document.activeElement;render();dialog.showModal();closeButton.focus();}
  if(!initializationPending)void initialize();

  if(initializing)return;
  if(unlocked()&&view==='preferences')void loadSavedItems();
  if(session&&unlocked()&&view!=='preferences'){
   // Reopening a draft does not change the account. Preserve the last completed
   // observation; preparation/submission still authenticate current state.
   if(blocked||status===null)void work(refresh);
   else if(!intent&&!viewReady())void work(loadView);
  }
  requestComposerPreparation();
 },close,likeState,loadLikes,attachIdentityControls,attachBokControls,observePublicPosts,loadSavedItems,savedItemsSnapshot,moderatorAuthorized(){return unlocked()&&!!session&&moderatorStatus?.authorized===true;},privateStatus,preferenceEnabled});
}
