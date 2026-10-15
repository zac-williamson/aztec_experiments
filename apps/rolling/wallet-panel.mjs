// Presentation only. No SDK import or account access before explicit Unlock.
import {allowance} from './model.mjs';
import {prepareAvatarUpload} from './avatar-upload.mjs';
// Presentation-only diagnostic projection. Keep this vocabulary closed even if
// a runtime or DOM value is malformed; never render or report exception text.
const initializationSteps=new Set(['account-lock','trusted-node','deployment','account-derive','store-open','pxe-create','account-register','contracts-register','initial-sync','journal-open','wallet-bind','account-manager','application-bind']);
const deploymentSteps=new Set(['config','node-readiness','artifact-layout','board-class','checkpoint','board-instance','public-config','config-commitment','fee-instance','l1-context','portal-code-and-immutables','canonical-recheck','final-readiness-and-context']);
const initializationCodes=new Set(['unknown','BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE','BB_BROWSER_PROVER_CONFIGURATION','ROLLING_SESSION_CONFIG','ROLLING_OTHER_TAB','ROLLING_CONTEXT_CHANGED','ROLLING_ACCOUNT_MISMATCH','ROLLING_PRIVATE_ROUTE','ROLLING_DEPLOYMENT_INVALID']);
const refreshSteps=new Set(['account-status','owned-names','moderator-status','bok-status'].flatMap(method=>['lock','context','pxe-sync','account-initialize','method'].map(phase=>method+'/'+phase)));
const refreshCodes=new Set(['ROLLING_BUSY','ROLLING_LOCKED','ROLLING_INVALID_RESPONSE','ROLLING_ABI_MISMATCH','ROLLING_RECOVERY_REQUIRED','PRIVATE_FEE_PREPARATION_FAILED','PRIVATE_FEE_PROVIDER_REQUIRED','PRIVATE_FEE_CONFIGURATION_REQUIRED','PRIVATE_FEE_OWNER_IS_PAYER','PRIVATE_FEE_CHAIN_MISMATCH','PRIVATE_FEE_CAP_TOO_LOW','PRIVATE_FEE_NONCANONICAL_ADDRESS','PRIVATE_FEE_NOT_PUBLISHED','PRIVATE_FEE_CLASS_MISMATCH','PRIVATE_FEE_ARTIFACT_INVALID','PRIVATE_FEE_INVALID_VALUE','PRIVATE_FEE_INVALID_ADDRESS','PRIVATE_FEE_INVALID_GAS','PRIVATE_FEE_BALANCE_INSUFFICIENT']);
const fundingSteps=new Set(['inspect','recover','account-status','prepare','checkpoint','submit','reconcile']);
const fundingProgressMessages={inspect:'Checking saved funding records…',recover:'Verifying your original payment and bridge delivery…','account-status':'Checking the account before claiming funds…',prepare:'Preparing the private claim and checking its fee…',checkpoint:'Saving private claim recovery records…',submit:'Processing the private claim. Keep this page open; do not send again.',reconcile:'Checking confirmation of the saved private claim…'};
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
const MODERATOR_TYPES=new Set(['moderate-post','moderate-avatar','reject-subboard','set-main-policy']);
const TYPES={'withdraw-bok':'Withdraw Bok credit','cancel-bok-request':'Release an unused Bok request','expire-bok-request':'Expire a Bok request',withdraw:'Withdraw posting collateral',screen:'Screen posting history','moderate-post':'Remove a post','moderate-avatar':'Remove an avatar','reject-subboard':'Reject a subboard','set-main-policy':'Update parent rules',bok:'Ask Bok with a post',preference:'Private preference','read-marker':'Mark thread read',bio:'Edit bio',avatar:'Edit avatar',post:'Write a post',reply:'Reply',quote:'Quote a post',repost:'Repost',like:'Like a post',unlike:'Remove a like',name:'Register a name',subboard:'Create a subboard'};
const IDS=['subboard','parent','root','reference','post'];
const field=value=>typeof value==='string'&&/^(?:0x[0-9a-f]{64}|0|[1-9][0-9]{0,76})$/.test(value);
const el=(tag,attrs={},...children)=>{const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);for(const child of children.flat())if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));return node;};
const button=(label,handler,primary=false)=>{const node=el('button',{type:'button',class:`button${primary?' primary':''}`},label);node.addEventListener('click',handler);return node;};
const paragraph=text=>el('p',{},text);
const label=(text,control)=>el('label',{class:'form-field'},text,control);
function nameFailure(failure){
 try{const code=Object.getOwnPropertyDescriptor(failure,'code');if(!code||!Object.hasOwn(code,'value'))return null;
  return code.value==='ROLLING_NAME_TAKEN'?'This name is already registered. Choose another first and last name.':code.value==='ROLLING_NAME_AVAILABILITY_UNAVAILABLE'?'Name availability could not be checked. Your draft is preserved; try again when the private connection is available.':null;
 }catch{return null;}
}
function aggregateFundingFailure(failure){
 try{const code=Object.getOwnPropertyDescriptor(failure,'code');if(code&&Object.hasOwn(code,'value')&&code.value==='ROLLING_FUNDING_GAS_CHANGED')return 'Ethereum gas costs exceed your approved maximum. Change Maximum Ethereum gas cost (ETH) if you want to approve more, then get a fresh quote and confirm again. Your recovery records are preserved.';}catch{}
 return nameFailure(failure);
}
const message='This operation could not be completed. Recovery records were preserved. Check the existing transaction before preparing another.';
const plaintextRecoveryWarning='This imported file contains an unencrypted key. Create an encrypted recovery file and protect the original.';
const recoveryLimits='Keep your recovery file and its password safe. A lost password cannot be reset. Losing your private account key can make funds and saved choices unrecoverable.';
const backupFreshness='Download a fresh backup after funding or transaction recovery changes. If a deposit uses a new random claim secret, a backup made before that deposit cannot restore that secret.';

/** loadRuntime returns the trusted account facade/getAccount/createSession binding.
 * getAccount values are used only as an unlocked boolean, never rendered or logged.
 * close hides the dialog; Lock ends custody explicitly. No transaction auto-retry.
 * Workflow restoration is the production application's encrypted journal, not DOM
 * state or localStorage. A replaced page discovers it through readAccountStatus.
 * Profile edits capture readProfile versions only on explicit selection/check.
 * Complete authenticated preferences live only in this closure. Page filtering
 * checks the current account on every call; no preference arrays are exported.
 * Recovery takes one explicit bounded step. Abort never releases the busy/SDK
 * account lock before the original operation settles.
 * Uploaded bytes come from immutable previewBlob; recovery validates the saved
 * raster but displays its ORIGINAL Blob, never the validator's re-encoded bytes.
 */
export function mountRollingWalletPanel({loadRuntime,onPublicEffect=()=>{},onPrivateChange=()=>{}}){
 if(typeof loadRuntime!=='function'||typeof onPublicEffect!=='function'||typeof onPrivateChange!=='function')throw Error('Wallet panel configuration unavailable.');
 const connectionFailure=Object.freeze({}),avatarFailure=Object.freeze({});
 let initializationAttempt=0,plaintextRecovery=false;
 let runtime,session,busy=false,blocked=false,invalidated=false,reloadRequired=false,returnFocus;
 let balances=null,bokAccounting=null,bokExitAmount='',refundQuote=null,refundGas='0.003';
 let topupKind='private-fee',topupQuote=null,topupInputs={amount:'',gas:'0.003'};
 let moderatorStatus=null,bokStatus=null,status=null,intent=null,identities=[],identityRecords=[],cursor=0,error='',notice='',draft={type:'post',subboard:'0',content:''};
 let preferences=null,preferenceProgress=null,accountIdentity=null,recoveryAbort=null,recoveryInspection=null;
 let fundingQuote=null,fundingAutomatic=false,fundingTimer=null,fundingInputs={asset:'ETH',collateral:'',fee:'',bok:'',gas:'',slippage:'1'};
 let profileSnapshot=null,avatarDraft=null,renderEpoch=0,accountEpoch=0,view='action';const previewURLs=new Set();
 const dialog=el('dialog',{'aria-labelledby':'rolling-wallet-title','aria-describedby':'rolling-wallet-description'});
 const title=el('h2',{id:'rolling-wallet-title'},'Your private account');
 const closeButton=button('Close account panel',()=>close());
 const content=el('div'),live=el('p',{role:'status','aria-live':'polite',class:'quiet'});
 dialog.append(el('div',{class:'dialog-top'},title,closeButton),el('p',{id:'rolling-wallet-description',class:'quiet'},'Published names and posts are public. Your saved choices are encrypted for recovery, and private views are filtered on your device. The configured trusted prover and its query service can see private data used to recover or prove your activity.'),live,content);
 document.body.append(dialog);
 function releasePreviews(){renderEpoch++;for(const url of previewURLs)URL.revokeObjectURL(url);previewURLs.clear();}
 function clearProfileDraft(){profileSnapshot=null;avatarDraft=null;}
 function clearPreferences(){preferences=null;preferenceProgress=null;onPrivateChange();}
 function clearPrivateView(){stopFunding();balances=null;bokAccounting=null;bokExitAmount='';refundQuote=null;refundGas='0.003';topupQuote=null;topupInputs={amount:'',gas:'0.003'};fundingQuote=null;fundingInputs={asset:'ETH',collateral:'',fee:'',bok:'',gas:'',slippage:'1'};initializationAttempt++;dialog.removeAttribute('data-rolling-initialization');recoveryInspection=null;accountEpoch++;accountIdentity=null;content.replaceChildren();moderatorStatus=null;clearPreferences();status=null;bokStatus=null;intent=null;identities=[];identityRecords=[];cursor=0;view='action';draft={type:'post',subboard:'0',content:''};releasePreviews();clearProfileDraft();}
 function checkAccount(epoch){if(epoch!==accountEpoch||!unlocked())throw connectionFailure;}
 function privateStatus(){if(!unlocked()||!session)return 'locked';return preferences?'complete':'recovering';}
 function preferenceEnabled(kind,target){if(privateStatus()!=='complete')return null;const key={1:'bookmarks',2:'followedBoards',3:'followedNames',4:'subscriptions'}[kind];return kind===5?preferences.replyNotifications:key?preferences[key].includes(BigInt(target).toString()):null;}
 async function recoverPreferences(){
  const epoch=accountEpoch;checkAccount(epoch);clearPreferences();
  const abort=recoveryAbort=new AbortController();controlsBusy(true);
  let result;try{result=await session.application.readColdPreferences({signal:abort.signal});}finally{recoveryAbort=null;}checkAccount(epoch);if(abort.signal.aborted)throw connectionFailure;
  if(result?.status==='complete'&&result.complete===true&&typeof runtime.selectPrivateViews==='function'){preferences=result.preferences;preferenceProgress=null;notice='Your follows, bookmarks and notification settings have been recovered.';}
  else if(result?.status==='recovering'&&result.complete===false){preferenceProgress=result.progress;notice='Your saved choices are still being recovered. Continue when ready; the feed will appear after recovery finishes.';}
  else throw connectionFailure;
  note('');onPrivateChange();
 }
 function preferencesView(){
  content.append(el('h3',{},'Private views'),paragraph('Your saved choices filter this feed on your device. Recovering them does not send a transaction. Changing a setting needs fee confirmation.'));
  if(preferences){content.append(paragraph('Your saved choices are ready.'),button(preferences.replyNotifications?'Disable reply notifications':'Enable reply notifications',()=>choosePreference({type:'preference',kind:5,target:'0',enabled:!preferences.replyNotifications})));}
  else if(preferenceProgress){const p=preferenceProgress,labels={nextBlock:'Next history block to check',scannedThrough:'History checked through block',anchorBlock:'History available through block',processedRevision:'Saved changes recovered',targetRevision:'Saved changes to recover',markersChecked:'Read positions checked',markersTotal:'Read positions to check'};for(const [key,label]of Object.entries(labels))if(/^[0-9]+$/.test(String(p?.[key]??'')))content.append(paragraph(label+': '+p[key]));}
  const stop=button('Stop private recovery',()=>{recoveryAbort?.abort();clearPreferences();note('Recovery stop requested. Waiting for the private operation to settle.');});stop.dataset.recoveryStop='true';content.append(stop);
  content.append(button(preferences?'Refresh private views':preferenceProgress?'Continue private recovery':'Recover private views',()=>void work(recoverPreferences),true));
 }
 function choosePreference(value){if(busy||intent)return;view='action';draft={...value};render();}
 function ownedLabel(id){const record=identityRecords.find(r=>r.id===id);return record?`${record.first} ${record.last}`:'Selected owned name';}
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
  checkAccount(epoch);acceptNames(page,append);
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
 function controlsBusy(value){dialog.setAttribute('aria-busy',String(value));for(const node of dialog.querySelectorAll('button,input,select,textarea'))node.disabled=node.dataset.recoveryStop==='true'?!recoveryAbort:value||node.dataset.unavailable==='true';}
 function note(text){live.textContent=text;}
 async function work(fn,failureMessage=nameFailure){
  if(busy)return;const operationFocus=document.activeElement;busy=true;error='';controlsBusy(true);
  try{await fn();}catch(failure){stopFunding();recoveryInspection=null;clearPreferences();note('');error=failure===connectionFailure?'The private connection is unavailable. Your encrypted recovery is preserved. Reconnect when the service returns.':failure===avatarFailure?'This image could not be prepared. Choose a still PNG, JPEG or WebP under 8 MiB. It must fit 8192 encoded bytes after cropping and compression. No transaction was prepared.':failureMessage(failure)??message;}finally{if(invalidated||reloadRequired)clearPrivateView();busy=false;render(document.activeElement===document.body?operationFocus:document.activeElement);}
 }
 function unlocked(){if(invalidated||reloadRequired)return false;const current=runtime?runtime.getAccount():null;if(accountIdentity&&current!==accountIdentity){invalidated=true;clearPrivateView();note('The account changed. Reload before continuing.');return false;}return !!current;}
 async function refresh(){
  const epoch=accountEpoch;checkAccount(epoch);balances=null;bokAccounting=null;recoveryInspection=null;moderatorStatus=null;clearPreferences();blocked=true;
  const next=await session.application.readAccountStatus();
  checkAccount(epoch);status=next;intent=next.intent??null;
  if(next.status==='recovering'){
   if(!intent?.intentId)throw Error('Missing recovery intent');
  }else{
   await loadNames();
   moderatorStatus=typeof session.application.readModeratorStatus==='function'?await session.application.readModeratorStatus():null;checkAccount(epoch);
   bokStatus=typeof session.application.readBokStatus==='function'?await session.application.readBokStatus():null;checkAccount(epoch);
  }
  blocked=false;onPrivateChange();
 }
 async function connect(){
  const epoch=accountEpoch,attempt=++initializationAttempt;
  dialog.removeAttribute('data-rolling-initialization');
  try{
  if(!accountIdentity)accountIdentity=runtime.getAccount();
  if(!session){blocked=true;session=await runtime.createSession({onProgress:progress=>{
   const diagnostic=projectRollingInitialization(progress);
   if(epoch!==accountEpoch||invalidated||reloadRequired||!unlocked()||(['private-refresh','funding-claim'].includes(diagnostic?.stage)?!session:attempt!==initializationAttempt))return;
   if(diagnostic)dialog.setAttribute('data-rolling-initialization',JSON.stringify(diagnostic));
   const stages={estimating:'Checking the action and its maximum fee…',submitting:'Proving and submitting. Keep this page open; do not send again.'};
   let stage;try{const own=Object.getOwnPropertyDescriptor(progress??{},'stage');if(own&&Object.hasOwn(own,'value')&&typeof own.value==='string')stage=own.value;}catch{}
   note(diagnostic?.stage==='funding-claim'?(diagnostic.state==='failed'?'This funding step could not be completed. Your recovery records are preserved.':fundingProgressMessages[diagnostic.step]):Object.hasOwn(stages,stage)?stages[stage]:'Checking the private account…');
  }});}
  if(view!=='preferences')await refresh();checkAccount(epoch);note('');
  }catch{if(attempt===initializationAttempt)initializationAttempt++;throw connectionFailure;}
 }
 async function unlock(){await work(async()=>{
  note('Loading private account tools…');
  if(!runtime){
   const loaded=await loadRuntime();
   if(!loaded?.account||typeof loaded.getAccount!=='function'||typeof loaded.createSession!=='function')throw Error('Invalid runtime');
   runtime=loaded;
   runtime.account.configure({requireEth:false,autoPasskey:false,canEndSession:()=>!session?.busy,
    // Custody's fixed import warning is safe product copy. Never forward
    // arbitrary account, SDK or exception messages into the private panel.
    onMessage:(value,type)=>{if(type==='warn'&&value===plaintextRecoveryWarning)plaintextRecovery=true;},onSetupError:()=>{error=message;},onChange:value=>{
     if(value?.invalidated===true||accountIdentity&&runtime.getAccount()!==accountIdentity){invalidated=true;recoveryAbort?.abort();clearPrivateView();note('The account changed. Preserve recovery and reload before continuing.');render();}
    }});
  }
  if(unlocked())await connect();else note('Create an account or import your encrypted recovery file.');
 });}
 function download(envelope){
  // Only the existing custody module's ciphertext envelope may leave the panel.
  const keys=['schemaVersion','kind','kdf','iterations','salt','iv','ciphertext'];
  if(!envelope||Object.keys(envelope).sort().join()!==keys.sort().join()||envelope.schemaVersion!==1||envelope.kind!=='aztec-billboard-encrypted-wallet'||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==600000||!/^([0-9a-f]{2}){16}$/.test(envelope.salt)||!/^([0-9a-f]{2}){12}$/.test(envelope.iv)||typeof envelope.ciphertext!=='string'||!/^([0-9a-f]{2}){16,}$/.test(envelope.ciphertext)||envelope.ciphertext.length>32*1024*1024+32)throw Error('Invalid encrypted export');
  const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
  const link=el('a',{href:url,download:'rolling-chat-encrypted-recovery.json'});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function passwordField(text){const input=el('input',{type:'password',autocomplete:'new-password',minlength:'12',required:'', 'aria-label':text});return input;}
 function custody(){
  const password=passwordField('Recovery password'),file=el('input',{type:'file',accept:'.json,application/json','aria-label':'Recovery file'});
  const create=button('Create account and download recovery',()=>{
   if(!password.reportValidity())return;const value=password.value;password.value='';
   void work(async()=>{download(await runtime.account.create(value));notice='Encrypted recovery downloaded. Keep it and your password safe.';await connect();});
  },true);
  const restore=button('Import recovery',()=>{
   if(!file.files?.[0]){error='Choose your recovery file.';render();return;}
   const selected=file.files[0],value=password.value;password.value='';file.value='';
   void work(async()=>{await runtime.account.importRecovery(selected,value);notice='Recovery imported. Checking retained transactions…';await connect();});
  });
  content.append(paragraph('Create a private account or restore an existing one. Creating an account does not fund it.'),paragraph(recoveryLimits),label('Recovery password (at least 12 characters for a new backup)',password),create,label('Encrypted backup or unencrypted account file',file),paragraph('An unencrypted account file contains a private key. Import only on a trusted device, then download an encrypted backup.'),restore);
 }
 function recovery(){
  const section=el('details',{},el('summary',{},'Backup and account security'));
  const password=passwordField('New recovery password');
  section.append(paragraph('The encrypted download includes your private account and retained transaction recovery records. It never downloads a plaintext signing key.'),paragraph(recoveryLimits),paragraph(backupFreshness),label('New recovery password',password),button('Download encrypted recovery',()=>{
   if(!password.reportValidity())return;const value=password.value;password.value='';
   void work(async()=>{download(await runtime.account.exportRecovery(value));notice='Encrypted recovery downloaded.';});
  }),button('Lock account',()=>void work(async()=>{
   blocked=true;clearPrivateView();render();
   if(session){await session.close();session=null;}
   await runtime.account.endSession();reloadRequired=true;clearPrivateView();note('Account locked. Reload before unlocking again.');
  })));
  content.append(section);
 }
 function savedResumeReview(snapshot){
  const saved=snapshot.exactResume,record=snapshot.intent,hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
  if(saved?.status!=='resumable'||snapshot.status!=='unknown'||!hash(saved.txHash)||saved.txHash!==snapshot.currentTxHash||
   !record.action?.type||['prepared','cancelled','replacement-prepared'].includes(record.status))return null;
  if(typeof saved.maximumFee!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(saved.maximumFee))return null;
  const review=record.replacementReview;
  if(saved.feeSource==='original'){if(review||saved.maximumFee!==record.maximumFee)return null;}
  else if(saved.feeSource==='replacement'){if(!review||!hash(review.sourceTxHash)||saved.txHash===review.sourceTxHash||saved.maximumFee!==review.maximumFee)return null;}
  else return null;
  const expectedMarker=review?review.marker:snapshot.originalMarker;
  if(record.action.type==='read-marker'){
   if(!saved.marker||!hash(saved.marker.blockHash)||saved.marker.throughBlock!==record.action.throughBlock||
    saved.marker.blockHash!==expectedMarker?.blockHash||saved.marker.throughBlock!==expectedMarker?.throughBlock||
    saved.marker.blockHash!==snapshot.marker?.blockHash||saved.marker.throughBlock!==snapshot.marker?.throughBlock)return null;
  }else if(saved.marker!==null||expectedMarker!=null)return null;
  return {txHash:saved.txHash,maximumFee:saved.maximumFee,feeSource:saved.feeSource,marker:saved.marker?{...saved.marker}:null};
 }
 function showSavedResume(snapshot,review,ready){
  content.append(el('h3',{},'Review the saved transaction'),paragraph('This sends the exact transaction already saved on this device. It does not create a new transaction or request a new fee quote.'),
   el('p',{class:'recovery-values'},'Saved transaction: '+review.txHash),
   el('p',{class:'recovery-values'},`${review.feeSource==='replacement'?'Previously reviewed replacement':'Previously approved'} maximum fee: ${review.maximumFee} fee-juice units. This is the saved ceiling, not an additional fee or a record of a charge.`));
  if(review.marker)content.append(el('p',{class:'recovery-values'},`Saved read position: block ${review.marker.throughBlock}; block fingerprint ${review.marker.blockHash}.`));
  const confirm=button('Confirm saved transaction and send',()=>void work(async()=>{
   if(!ready())throw connectionFailure;
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);
   if(recoveryInspection!==snapshot||snapshot.intent.intentId!==id)throw connectionFailure;
   const expectedTxHash=review.txHash;recoveryInspection=null;notice='';intent={...intent,status:'unknown'};blocked=true;
   note('Sending the saved transaction. Keep this page open; do not send again.');
   try{const result=await session.application.resumeSaved(id,{expectedTxHash});checkAccount(epoch);await receive(result);}
   catch{throw Error('Saved transaction outcome unknown');}
  }),true);confirm.dataset.unavailable=String(!ready());confirm.disabled=busy||!ready();content.append(confirm);return confirm;
 }
 function showRecoveryOptions(ready=()=>true){
  content.append(button('Check recovery options',()=>void work(async()=>{
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);recoveryInspection=null;clearPreferences();
   const result=await session.application.inspectRecovery(id);checkAccount(epoch);
   if(result?.intent?.intentId!==id||!Array.isArray(result.attempts))throw connectionFailure;
   recoveryInspection=result;notice='Recovery options checked. No transaction was sent.';
  })));
  const snapshot=recoveryInspection;if(!snapshot||snapshot.intent.intentId!==intent.intentId)return;
  const statuses={'pre-proof-review':'The interrupted preparation can be reviewed on this device.',pending:'This update is still pending. Keep your recovery file and check again.',unknown:'This update is still unresolved. Keep your recovery file and check again. Do not send another copy.',canonical:'An attempt is included in the verified chain. Check the existing transaction to reconcile it; do not send a replacement.',empty:'No signed transaction was found. Keep the saved action and recovery file; a replacement is not available.',
   'context-changed':'The saved action no longer matches its required context. It cannot be repeated safely.', 'history-unavailable':'Earlier transaction details are unavailable. Keep your recovery file; a replacement cannot be reviewed safely.', 'limit-reached':'This update has reached its replacement limit. Keep your recovery file; no further replacement can be sent.',
   'replacement-available':'The earlier attempts can no longer be included. Review this saved update and a new maximum fee before sending a replacement.'};
  const savedReview=savedResumeReview(snapshot);
  const displayStatus=snapshot.status==='unknown'&&['pending','canonical','empty'].includes(snapshot.exactResume?.status)?snapshot.exactResume.status:snapshot.status;
  content.append(paragraph(savedReview?'The saved transaction can be sent without preparing another. Review its saved fee ceiling before confirming.':snapshot.exactResume?.status==='context-changed'?'The saved transaction no longer matches its required context. Keep your recovery file; it cannot be sent safely.':statuses[displayStatus]??statuses.unknown));
  const details=el('details',{class:'recovery-values'},el('summary',{},'Original action and transaction history'));
  if(snapshot.originalPreferenceHead){const head=snapshot.originalPreferenceHead;details.append(paragraph('Original saved-settings revision: '+head.revision),paragraph('Original saved-settings fingerprint: '+head.digest));}
  for(const attempt of snapshot.inclusionHistory??[]){
   details.append(paragraph('Earlier transaction: '+attempt.txHash));
   for(const fact of attempt.inclusions??[])details.append(paragraph(`Previously included at block ${fact.blockNumber}: ${fact.transactionFee} fee-juice units; result ${fact.executionResult}. Historical record only; this does not show a current charge.`));
  }
  if(!(snapshot.inclusionHistory??[]).length)details.append(paragraph('No earlier inclusion or fee record is available.'));
  content.append(details);
  if(savedReview)return showSavedResume(snapshot,savedReview,ready);
  if(snapshot.status==='pre-proof-review'){
   content.append(paragraph('This device retained an interrupted attempt before any signed transaction was saved. Review the saved action and a renewed maximum fee before confirming.'));
   const review=button('Review interrupted action',()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);if(recoveryInspection!==snapshot)throw connectionFailure;
    recoveryInspection=null;const result=await session.application.prepareInterrupted(id);checkAccount(epoch);
    intent=result;blocked=false;notice='Interrupted action prepared for review. Nothing has been sent. Check the renewed maximum fee before confirming.';
   }),true);review.dataset.unavailable=String(!ready());review.disabled=busy||!ready();content.append(review);return review;
  }
  if(snapshot.status!=='replacement-available')return;
  const marker=intent.action.type==='read-marker',changed=marker&&snapshot.originalMarker?.blockHash!==snapshot.marker?.blockHash;
  let consent;
  if(marker){
   if(!snapshot.marker||snapshot.marker.throughBlock!==intent.action.throughBlock)return;
   content.append(paragraph(`The read position stays at block ${snapshot.marker.throughBlock} of this thread.`));
   if(changed){consent=el('input',{type:'checkbox'});content.append(label('I understand that the same read position now refers to a different block.',consent));}
  }
  const review=button('Review replacement',()=>void work(async()=>{
   if(changed&&!consent?.checked)throw connectionFailure;
   const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);
   const input={expectedTxHash:snapshot.currentTxHash,...(['preference','read-marker'].includes(intent.action.type)?{expectedHead:{...snapshot.head}}:{}),...(marker?{expectedMarkerHash:snapshot.marker.blockHash}:{})};
   recoveryInspection=null;const result=await session.application.prepareReplacement(id,input);checkAccount(epoch);
   recoveryInspection=null;intent=result;blocked=false;notice='Replacement prepared for review. Nothing has been sent. Check the new maximum fee before confirming.';
  }),true);
  review.dataset.unavailable=String(changed);if(consent)consent.addEventListener('change',()=>{review.dataset.unavailable=String(!consent.checked);review.disabled=busy||!consent.checked;});content.append(review);
 }
 function balancesView(){
  content.append(el('h3',{},'Balances and withdrawals'),paragraph('Posting collateral is refundable ETH. Network fee tokens pay transaction fees and cannot be redeemed by the current protocol. Bok credits are USDC-backed and separate from both.'));
  if(!balances){content.append(button('Check private balances',()=>void work(async()=>{const epoch=accountEpoch;const value=await session.application.readBalances({cursor:0});checkAccount(epoch);balances=value;}),true));return;}
  content.append(paragraph('Available network fees: '+decimal(balances.fee.available,18)+' FEE.'));
  if(balances.fee.pendingReservation)content.append(paragraph('A saved transaction has an unresolved fee reservation, up to '+decimal(balances.fee.pendingReservation.maximumFee,18)+' FEE. It is not subtracted again from the balance above.'));
  if(balances.bok){content.append(paragraph('Unallocated Bok credit: '+decimal(balances.bok.available,6)+' USDC.'));
   if(bokAccounting?.complete){
    content.append(paragraph('Complete owned-request accounting at block '+bokAccounting.anchor.blockNumber+'. Allocated '+decimal(bokAccounting.totals.available,6)+', reserved '+decimal(bokAccounting.totals.reserved,6)+', charged '+decimal(bokAccounting.totals.charged,6)+', returned '+decimal(bokAccounting.totals.refunded,6)+' USDC. Returned credit is already part of your unallocated balance; it is not added again.'));
    for(const r of bokAccounting.requests){const area=el('section',{'aria-label':'Owned Bok request'});area.append(paragraph('Request '+r.requestId.slice(0,10)+'… — allocated '+decimal(r.available,6)+', reserved '+decimal(r.reserved,6)+', charged '+decimal(r.charged,6)+', returned '+decimal(r.refunded,6)+' USDC.'));
     if(['1','2'].includes(r.state)){
      if(r.reserved==='0')area.append(button('Review release of unused credit',()=>void work(async()=>{intent=await session.application.prepare({type:'cancel-bok-request',requestId:r.requestId});})));
      area.append(paragraph('Expiry is checked by the contract. After its deadline, only unreserved credit returns; any unresolved reservation stays fenced.'),button('Review request expiry',()=>void work(async()=>{intent=await session.application.prepare({type:'expire-bok-request',requestId:r.requestId});})));
     }else area.append(paragraph(r.state==='4'?'This request is closed. Returned credit is already included in your unallocated balance.':'This request is fenced. Unreserved credit has returned; the reserved amount remains locked until the operator reconciles its actual charge.'));content.append(area);
    }
   }else content.append(paragraph('Complete request accounting is not yet available; unlisted reservations are not zero.'));
   if(typeof session.application.readBokAccounting==='function'){
    content.append(button(bokAccounting&&!bokAccounting.complete?'Continue checking Bok requests':'Check all Bok requests',()=>void work(async()=>{const epoch=accountEpoch,value=await session.application.readBokAccounting({cursor:bokAccounting&&!bokAccounting.complete?bokAccounting.nextCursor:0});checkAccount(epoch);bokAccounting=value;if(value.complete)balances={...balances,bok:{...balances.bok,available:value.available}};})));
    if(bokAccounting&&!bokAccounting.complete)content.append(paragraph('Checking '+(bokAccounting.phase==='owned-requests'?'private ownership pages':'uniform public accounting pages')+'. No partial total is presented.'),button('Stop checking requests',()=>{bokAccounting=null;render();}));
   }
   fundingWalletView();const amount=el('input',{type:'text',inputmode:'decimal','aria-label':'Bok credit to withdraw in USDC',value:bokExitAmount});amount.addEventListener('input',()=>bokExitAmount=amount.value);
   content.append(label('Bok credit to withdraw (USDC)',amount),paragraph('Only unallocated private credit can exit. First confirm the private transaction fee; after settlement, separately review Ethereum gas. The receiving wallet must pay that gas.'),button('Review Bok credit exit',()=>void work(async()=>{const selected=runtime.fundingWalletStatus?.();if(!selected?.connected||typeof selected.address!=='string')throw connectionFailure;intent=await session.application.prepare({type:'withdraw-bok',amount:units(bokExitAmount,6),recipient:selected.address.toLowerCase()});refundQuote=null;}),true));
  }
  for(const d of balances.collateral.deposits){
   const area=el('section',{'aria-label':'Posting collateral'});area.append(paragraph(decimal(d.amount,18)+' ETH refundable to the original depositing wallet.'),paragraph(d.reason==='screening-required'?'Outstanding posts must finish screening before withdrawal.':d.reason==='time-locked'?'Collateral is time-locked until chain time '+d.nextAllowedTime+'.':'This deposit is eligible for a withdrawal review.'));
   if(d.reason==='screening-required')area.append(button('Review history screening',()=>void work(async()=>{intent=await session.application.prepare({type:'screen',deposit:d.id});})));
   const review=button('Review collateral exit',()=>void work(async()=>{intent=await session.application.prepare({type:'withdraw',deposit:d.id});refundQuote=null;}),true);review.dataset.unavailable=String(!d.eligible);area.append(review);content.append(area);
  }
  if(!balances.collateral.deposits.length)content.append(paragraph('No active posting collateral on this page.'));
  if(balances.collateral.nextCursor!==null)content.append(button('Next collateral page',()=>void work(async()=>{const epoch=accountEpoch;const page=await session.application.readBalances({cursor:balances.collateral.nextCursor});checkAccount(epoch);balances=page;})));
  content.append(button('Refresh balances',()=>void work(async()=>{balances=null;bokAccounting=null;const epoch=accountEpoch;const page=await session.application.readBalances({cursor:0});checkAccount(epoch);balances=page;})));
 }
 function refundView(){
  const bok=intent.withdrawal.kind==='bok',amountText=decimal(intent.withdrawal.amount,bok?6:18)+(bok?' USDC':' ETH');
  fundingWalletView();
  if(intent.actualNetworkFee!==null&&intent.actualNetworkFee!==undefined)content.append(paragraph('Actual private exit fee: '+decimal(intent.actualNetworkFee,18)+' FEE.'));
  content.append(paragraph('The private '+(bok?'Bok credit':'collateral')+' exit is confirmed. The refund remains saved until Ethereum verifies payment to the saved recipient. Wait for Outbox settlement before reviewing the refund.'),paragraph('Refund: '+amountText+'. Connect '+(bok?'the saved receiving':'the original depositing')+' wallet; another recipient cannot be substituted.'));
  if(refundQuote){content.append(paragraph('Wallet: '+refundQuote.walletName),paragraph('Maximum Ethereum gas cost: '+decimal(refundQuote.maximumGasWei,18)+' ETH. The refund amount is separate.'),button('Confirm Ethereum refund',()=>void work(async()=>{const epoch=accountEpoch;refundQuote=null;const result=await session.withdrawal.confirm();checkAccount(epoch);notice='Ethereum refund confirmed: '+decimal(result.amount,bok?6:18)+(bok?' USDC. ':' ETH. ')+(result.gasCostWei===null||result.gasCostWei===undefined?'Gas was paid separately; its exact cost is unavailable here.':'Actual Ethereum gas cost: '+decimal(result.gasCostWei,18)+' ETH.');intent=null;balances=null;await refresh();}),true),button('Cancel refund review',()=>void work(async()=>{await session.withdrawal.cancel();refundQuote=null;})));return;}
  const gas=el('input',{type:'text',inputmode:'decimal','aria-label':'Maximum refund gas cost in ETH',value:refundGas});gas.addEventListener('input',()=>refundGas=gas.value);
  content.append(label('Maximum Ethereum gas cost (ETH)',gas),button('Review Ethereum refund',()=>void work(async()=>{const epoch=accountEpoch;const value=await session.withdrawal.prepare({maximumGasWei:units(refundGas,18)});checkAccount(epoch);refundQuote=value;}),true),button('Check existing refund',()=>void work(async()=>{const epoch=accountEpoch;const result=await session.withdrawal.recover();checkAccount(epoch);if(result.status==='refunded'){notice='The saved Ethereum refund is confirmed.';intent=null;balances=null;await refresh();}else notice='Refund '+result.status+'. A new refund is never sent automatically.';})));
 }
 function replyContext(action){return field(action?.parent)&&field(action?.root)&&field(action?.subboard)&&BigInt(action.parent)>0n&&BigInt(action.root)>0n;}
 function conversationContext(action){
  const reply=replyContext(action),link=el('a',{href:reply?'#/thread/'+action.root+'/'+action.parent:'#/board/'+action.subboard},reply?'View conversation':BigInt(action.subboard)===0n?'Main board':'View board');
  link.addEventListener('click',event=>{if(!close())event.preventDefault();});
  content.append(paragraph(reply?'Replying in this conversation':'New conversation'),link);
 }
 function showIntent(){
  if(['withdraw','withdraw-bok'].includes(intent.action?.type)&&intent.status==='confirmed'&&session.withdrawal){refundView();return;}
  const replacement=intent.status==='replacement-prepared',prepared=intent.status==='prepared'||replacement;
  content.append(el('h3',{},replacement?'Review replacement before sending':prepared?'Review before sending':'Transaction recovery'));
  content.append(paragraph(intent.action?.type==='claim-deposit'?'Recover posting funds':TYPES[intent.action?.type]??'Existing transaction'));
  // The saved action owns this context, including after authorization or recovery.
  const conversational=['reply','bok'].includes(intent.action?.type);
  if(conversational&&field(intent.action.subboard)&&(replyContext(intent.action)||field(intent.action.parent)&&field(intent.action.root)&&BigInt(intent.action.parent)===0n&&BigInt(intent.action.root)===0n))conversationContext(intent.action);
  // Explicit fields only, and text nodes throughout. No nonce, account or raw error.
  for(const key of ['first','last','slug','name','description','rules','content','subboard','parent','root','reference','post','reason']){
   if(conversational&&['subboard','parent','root'].includes(key))continue;
   const value=intent.action?.[key];if(typeof value==='string'&&value)content.append(el('p',{class:'post-body'},`${key}: ${key==='name'&&!['subboard','moderate-avatar'].includes(intent.action.type)?ownedLabel(value):value}`));
  }
  const reviewedFee=replacement?intent.replacementReview?.maximumFee:intent.maximumFee,feeReady=typeof reviewedFee==='string'&&/^(0|[1-9][0-9]*)$/.test(reviewedFee);
  if(replacement){
   if(feeReady)content.append(paragraph(`New maximum network fee: ${reviewedFee} fee-juice units. Confirming authorizes this replacement only; the final charge may be lower.`));
   if(typeof intent.maximumFee==='string')content.append(paragraph(`Original maximum fee: ${intent.maximumFee} fee-juice units. This earlier ceiling is not the replacement fee or an actual charge.`));
   if(intent.replacementReview?.marker)content.append(el('p',{class:'recovery-values'},`Reviewed read position: block ${intent.replacementReview.marker.throughBlock}; block fingerprint ${intent.replacementReview.marker.blockHash}.`));
  }else if(feeReady)content.append(paragraph(intent.replacementReview?`Original maximum fee: ${intent.maximumFee} fee-juice units. This earlier ceiling is not the saved replacement fee or a record of a charge.`:`Maximum network fee: ${reviewedFee} fee-juice units. This is a maximum, not a guaranteed final charge.`));
  if(intent.action?.type==='expire-bok-request')content.append(paragraph('Ask the contract to expire this exact saved request. Its deadline is checked again before sending. Only unreserved credit can return; an unresolved reservation remains fenced for the actual charge. Confirmation does not mean the whole budget was refunded. Refresh private balances and complete request accounting afterward.'));
  if(intent.withdrawal)content.append(paragraph(intent.withdrawal.kind==='bok'?'Exit '+decimal(intent.withdrawal.amount,6)+' USDC of unallocated Bok credit to '+intent.withdrawal.depositor+'. Reserved request credit is not spent. A separate Ethereum claim follows after settlement and needs its own gas review.':'Exit '+decimal(intent.withdrawal.amount,18)+' ETH of posting collateral. This first transaction consumes your private deposit. A separate Ethereum refund to the original depositor follows after settlement and needs its own gas review. Moderation does not remove withdrawal rights.'));
  if(intent.action?.type==='name'&&prepared&&intent.nameAvailability)content.append(paragraph('This name was available when checked. This is not a reservation; another registration may still win before your transaction.'));
  if(intent.action?.type==='bio'&&intent.action.content==='')content.append(paragraph('Clear the current profile bio. Historical versions remain public.'));
  let avatarReady=intent.action?.type!=='avatar'||intent.action.data==='';
  const avatarArea=el('div',{'aria-label':'Saved avatar preview'});
  if(intent.action?.type==='avatar'){
   content.append(avatarArea);
   if(intent.action.data==='')avatarArea.append(paragraph('Clear avatar. No image bytes will be published.'));
  }
  if(intent.moderation){content.append(paragraph('Moderator action: your authority and the exact target will be checked again before sending. This does not edit the original post or reveal its private owner.'),paragraph(`Reviewed parent rules version: ${intent.moderation.mainVersion}.`));if(intent.moderation.avatarVersion!==undefined)content.append(paragraph(`Reviewed avatar version: ${intent.moderation.avatarVersion}.`));}
  if(intent.bok){
   content.append(paragraph(`Bok request budget: ${intent.bok.budget} credits. This is separate from the network fee.`));
   if(intent.bok.phase==='authorize')content.append(paragraph('First authorize this exact request privately. Publishing the saved post requires a separate review and network fee.'));
   else {content.append(paragraph('The request is already authorized. This publishes its exact saved post; the Bok budget is not authorized again.'));if(Number.isSafeInteger(intent.bok.mainPolicyVersion)&&Number.isSafeInteger(intent.bok.localPolicyVersion))content.append(paragraph(`Reviewed policy versions: parent ${intent.bok.mainPolicyVersion}, local ${intent.bok.localPolicyVersion}.`));}
  }
  if(fundingCapability()&&['claim-deposit','claim-private-fee','claim-bok'].includes(intent?.action?.type)&&['reverted','cancelled'].includes(intent.status))content.append(button('Review private claim again',()=>void work(async()=>{
   const epoch=accountEpoch;checkAccount(epoch);await fundingCapability().reviewRevertedClaim();checkAccount(epoch);await advanceFunding();
  })));
  if(['authorized','bok-post-reverted','bok-release-reverted'].includes(intent.status)){
   if(intent.status==='bok-post-reverted')content.append(paragraph('The post reverted. Its paid network fee is not refunded.'));
   content.append(paragraph('Your funded request and original draft remain saved. Continuing the post, releasing unused credit, or requesting expiry each needs a separate fee review. Expiry requires the contract deadline; unresolved reservations remain fenced.'));
   if(intent.status!=='bok-release-reverted')content.append(button('Review saved Bok post',()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);blocked=true;
    const result=await session.application.prepareBokPost(id);checkAccount(epoch);intent=result;blocked=false;notice='Review the saved post and its separate network fee before sending.';
   }),true));
   for(const [type,label]of [['cancel-bok-request','Review release of this saved request'],['expire-bok-request','Review expiry of this saved request']])content.append(button(label,()=>void work(async()=>{
    const epoch=accountEpoch,id=intent.intentId;checkAccount(epoch);const result=await session.application.prepareBokRelease(id,{type});checkAccount(epoch);intent=result;blocked=false;notice='Review the private transaction fee. No release or expiry has been sent.';
   })));
   return;
  }
  let confirm;
  const privateAction=['preference','read-marker'].includes(intent.action?.type),expiryAction=intent.action?.type==='expire-bok-request',fundingAction=['claim-deposit','claim-private-fee','claim-bok'].includes(intent.action?.type);
  if(fundingAction){content.append(paragraph(intent.action.type==='claim-deposit'?'Claim the previously paid posting collateral privately. No second Ethereum payment will be requested.':'Claim the previously paid '+(intent.action.type==='claim-bok'?'Bok credit':'network fee credit')+' privately. Posting collateral is unchanged. No second Ethereum payment will be requested.'),paragraph((intent.action.type==='claim-deposit'?'Collateral: ':intent.action.type==='claim-bok'?'Bok credit: ':'Network fees: ')+intent.action.receipt.amount+(intent.action.type==='claim-deposit'?' wei.':' base units.')));if(intent.action.feeReceipt)content.append(paragraph('Previously bridged transaction fees: '+intent.action.feeReceipt.amount+' fee-juice units. The fee claim and collateral claim share one transaction.'));}
  if(privateAction){content.append(paragraph(intent.action.type==='read-marker'?'Mark this thread read through block '+intent.action.throughBlock:preferenceDescription(intent.action)));}
  if(prepared){
   confirm=button(replacement?'Confirm replacement and send':'Confirm and send',()=>void work(async()=>{
    if(!avatarReady||!feeReady)throw Error('Review unavailable');
    const epoch=accountEpoch;checkAccount(epoch);recoveryInspection=null;
    const id=intent.intentId;intent={...intent,status:'unknown'};blocked=true;
    try{const result=await session.application.submitPrepared(id);checkAccount(epoch);await receive(result);}catch{note('Submission outcome is unknown. Check this transaction; do not submit again.');throw Error('Unknown outcome');}
   }),true);confirm.dataset.unavailable=String(!avatarReady||!feeReady);
   content.append(paragraph(['withdraw','withdraw-bok'].includes(intent.action?.type)?'This private exit starts withdrawal. It does not send the Ethereum refund or publish a post.':expiryAction?'This private expiry attempt charges a network fee. It never releases an unresolved reserved charge.':fundingAction?'Your saved funding receipt will be checked again before sending this private claim.':privateAction?'Your exact private setting is saved. Sending records an encrypted onchain update and charges a network fee.':'Your exact action is saved. Sending publishes it onchain and cannot be undone.'),confirm);
   if(!replacement&&intent.bok?.phase!=='post')content.append(button('Cancel prepared action',()=>void work(async()=>{await session.application.cancelPrepared(intent.intentId);intent=null;await refresh();notice='Prepared action cancelled. No new transaction was sent.';})));
  }else{
   content.append(paragraph('No automatic resend is allowed. A missing receipt does not mean the transaction failed.'),button('Check existing transaction',()=>void work(async()=>{await receive(await session.application.reconcile(intent.intentId));})));
  }
  if(intent.status!=='prepared')confirm=showRecoveryOptions(()=>avatarReady&&feeReady)??confirm;
  if(intent.action?.type==='avatar'&&intent.action.data!==''){
   const epoch=renderEpoch,action=intent.action;avatarArea.append(paragraph('Checking the exact saved avatar preview…'));
   void (async()=>{try{const blob=savedAvatarBlob(action),checked=await prepareAvatarUpload(blob);
    if(checked.source.width!==100||checked.source.height!==100)throw Error('Invalid saved dimensions');
    if(epoch!==renderEpoch||!unlocked())return;avatarArea.replaceChildren();showAvatar(blob,avatarArea,{ready:()=>{if(epoch!==renderEpoch||!unlocked())return;avatarReady=true;if(confirm){confirm.dataset.unavailable='false';confirm.disabled=busy;}},failed:()=>{avatarReady=false;if(confirm){confirm.dataset.unavailable='true';confirm.disabled=true;}}});avatarArea.append(paragraph(`${blob.size}/8192 encoded bytes. These are the exact saved publication bytes.`));
   }catch{if(epoch===renderEpoch)avatarArea.replaceChildren(paragraph('The saved avatar cannot be previewed safely. Cancel this prepared action or retain its recovery record; it will not be sent.'));}})();
  }
 }
 async function receive(result){
  recoveryInspection=null;intent=result;blocked=false;
  if(['confirmed','reverted'].includes(result.status)&&['preference','read-marker'].includes(result.action?.type))clearPreferences();
  if(['confirmed','reverted'].includes(result.status)&&['bio','avatar'].includes(result.action?.type))profileSnapshot=null;
  if(result.status==='authorized'){notice='Bok request authorized. Review the saved post when ready; it has not been published.';return;}
  if(result.status==='confirmed'){
   notice=result.action?.type==='expire-bok-request'?'Expiry transaction confirmed. Only unreserved credit can return; refresh private balances and complete request accounting to see refunded and still-reserved amounts.':'Transaction confirmed on the verified chain.';
   try{await onPublicEffect();}catch{notice+=' Public feed refresh is unavailable; the transaction remains confirmed.';}
   await refresh();
  }else if(result.status==='reverted'){
   notice='Transaction reverted. A network fee may have been charged. Recovery checks must complete before a new action.';await refresh();
  }else note(result.status==='prepared'?'The saved action has not been sent. Review before confirming.':'The transaction is still unconfirmed or unknown. Check later; do not resend.');
 }
 function chooseAction(type,name){
  if(busy||!unlocked()||intent||blocked)return;
  view='action';clearProfileDraft();draft={type,subboard:'0',content:'',...(name?{name}:{})};
  if(name)void work(()=>checkProfile(name));else render();
 }
 function namesView(){
  content.append(el('h3',{},'Your names'),paragraph('This list comes from your private account connection and is not published as an ownership list. Names are permanent. View public profile opens only the selected name.'),button('Register a name',()=>chooseAction('name'),true));
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
 function preferenceDescription(action){const labels={1:'bookmark',2:'board follow',3:'name follow',4:'thread subscription',5:'reply notifications'};return `${action.enabled?'Enable':'Disable'} ${labels[action.kind]??'private setting'}${action.kind===5?'':' for '+action.target}. This preference is encrypted, not a public ownership list.`;}
 function form(){
  if(MODERATOR_TYPES.has(draft.type)&&moderatorStatus?.authorized!==true)draft={type:'post',subboard:'0',content:''};
  const type=el('select',{'aria-label':'Action'});for(const [value,text]of Object.entries(TYPES)){if(['withdraw','withdraw-bok','cancel-bok-request','expire-bok-request','screen'].includes(value)||value==='bok'&&bokStatus?.available!==true||MODERATOR_TYPES.has(value)&&moderatorStatus?.authorized!==true)continue;const option=el('option',{value},text);option.selected=draft.type===value;type.append(option);}
  type.addEventListener('change',()=>{clearProfileDraft();const continuation=['reply','bok'].includes(draft.type)&&['reply','bok'].includes(type.value);draft=continuation?{...draft,type:type.value}:{type:type.value,subboard:'0',content:''};render();});content.append(label('Action',type));
  const fields=new Map();
  function input(name,text,{area=false,initial='',required=true}={}){
   const node=el(area?'textarea':'input',area?{rows:'5'}:{type:'text'});node.value=draft[name]??initial;if(required)node.required=true;
   node.addEventListener('input',()=>{draft[name]=node.value;validate();});fields.set(name,node);content.append(label(text,node));return node;
  }
  const kind=draft.type;
  if(MODERATOR_TYPES.has(kind)){
   content.append(paragraph('Moderator controls. Removal keeps the stable link and a visible reason. It cannot edit or delete the underlying chain history.'));
   if(kind==='set-main-policy')input('rules','New parent rules',{area:true});
   else{input(kind==='moderate-post'?'post':kind==='moderate-avatar'?'name':'subboard',kind==='moderate-post'?'Post ID':kind==='moderate-avatar'?'Profile name ID':'Subboard ID');input('reason','Public moderation reason',{area:true});}
  }else if(kind==='preference'||kind==='read-marker'){
   if(kind==='preference'){
    const select=el('select',{'aria-label':'Preference'});for(const [value,text]of [[1,'Bookmark'],[2,'Follow board'],[3,'Follow name'],[4,'Subscribe to thread'],[5,'Reply notifications']]){const option=el('option',{value:String(value)},text);option.selected=draft.kind===value;select.append(option);}draft.kind=Number(select.value);select.addEventListener('change',()=>{draft.kind=Number(select.value);if(draft.kind===5)draft.target='0';render();});content.append(label('Preference',select));
    if(draft.kind!==5)input('target','Public target ID');else draft.target='0';
    const enabled=el('input',{type:'checkbox','aria-label':'Enabled'});enabled.checked=draft.enabled!==false;draft.enabled=enabled.checked;enabled.addEventListener('change',()=>draft.enabled=enabled.checked);content.append(label('Enabled',enabled));
    content.append(paragraph(preferenceDescription(draft)));
   }else{input('thread','Thread ID');input('throughBlock','Read through chain block');content.append(paragraph('Only replies through this canonical block are marked read. A private proof derives the block hash; no hash is supplied here.'));}
  }else if(kind==='bio'||kind==='avatar'){
   const names=el('select',{'aria-label':'Profile name'},el('option',{value:''},'Choose an owned name'));
   for(const record of identityRecords)names.append(el('option',{value:record.id},`${record.first} ${record.last}`));
   names.value=identities.includes(draft.name)?draft.name:'';draft.name=names.value;
   names.addEventListener('change',()=>{draft.name=names.value;clearProfileDraft();if(draft.name)void work(()=>checkProfile(draft.name));else render();});
   content.append(label('Profile name',names),paragraph('Edits publish publicly for this name. A captured version prevents overwriting a newer edit.'));
   const checkVersion=button('Check current profile version',()=>{if(draft.name)void work(()=>checkProfile(draft.name));});checkVersion.dataset.unavailable=String(!draft.name);content.append(checkVersion);if(profileSnapshot)content.append(paragraph('Current profile version checked. A newer edit will require a fresh check.'));
   if(cursor!==null)content.append(button('Load more owned names',()=>void work(()=>loadNames(true))));
   if(kind==='bio')input('content','Bio (empty to clear)',{area:true,required:false});
   else{
    const file=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':'Avatar image'});
    file.addEventListener('change',()=>{const selected=file.files?.[0];if(!selected)return;avatarDraft=null;
     void work(async()=>{let prepared;try{prepared=await prepareAvatarUpload(selected);}catch{throw avatarFailure;}if(!unlocked())throw Error('Account changed');avatarDraft={blob:prepared.previewBlob,notice:prepared.notice};});});
    content.append(label('Avatar image',file),paragraph('PNG, JPEG or WebP. Centre-square crop to 100×100 pixels, compressed to at most 8192 bytes. Transparency is preserved.'));
    if(avatarDraft?.blob){showAvatar(avatarDraft.blob,content);content.append(paragraph(avatarDraft.notice),paragraph(`${avatarDraft.blob.size}/8192 encoded bytes`));}
    if(avatarDraft?.clear)content.append(paragraph('The avatar will be cleared.'));
    content.append(button('Clear avatar',()=>{avatarDraft={clear:true};render();}));
   }
  }else if(kind==='name'){
   content.append(paragraph('Names are globally unique and permanent. Use 1–32 ASCII letters, spaces, apostrophes or hyphens in each part; start and end with a letter. Bok is reserved.'));
   const first=input('first','First name'),last=input('last','Last name');
   // Reversible proposal vocabulary: eight valid values per part, uniformly picked
   // from local cryptographic random bits. Availability is never inferred locally.
   const firstNames=['River','Ellis','Mira','Rowan','Sage','Robin','Avery','Quinn'],lastNames=['Lane','Moss','Reed','Vale','Stone','Brook','Finch','Wren'];
   content.append(button('Suggest a random name',()=>{const bytes=crypto.getRandomValues(new Uint8Array(2));first.value=firstNames[bytes[0]&7];last.value=lastNames[bytes[1]&7];draft.first=first.value;draft.last=last.value;validate();}),paragraph('A random suggestion is not a reservation. Check action verifies current availability; another registration may still win before your transaction.'));

  }else if(kind==='subboard'){
   content.append(paragraph('Creation needs network fees, not posting collateral. The subboard is usable immediately; it does not automatically appear on Home. Its slug cannot be renamed or transferred. Parent rules also apply.'));
   input('slug','Permanent slug (3–40 lowercase letters, digits or single hyphens)');input('name','Subboard name');input('description','Description',{area:true});input('rules','Additional rules',{area:true,required:false});
  }else if(kind==='like'||kind==='unlike')input('post','Post ID');
  else{
   const names=el('select',{'aria-label':'Posting identity'},el('option',{value:'0'},'Anonymous'));
   for(const record of identityRecords)names.append(el('option',{value:record.id},`${record.first} ${record.last}`));
   names.value=identities.includes(draft.name)?draft.name:'0';draft.name=names.value;
   names.addEventListener('change',()=>{draft.name=names.value;});content.append(label('Posting identity',names));
   if(cursor!==null)content.append(button('Load more owned names',()=>void work(()=>loadNames(true))));
   const deposits=el('select',{'aria-label':'Posting collateral'});
   for(const id of status?.depositIds??[])deposits.append(el('option',{value:id},`Deposit ${id}`));
   if(!deposits.options.length)deposits.append(el('option',{value:''},'No verified collateral found'));
   deposits.value=(status?.depositIds??[]).includes(draft.deposit)?draft.deposit:deposits.options[0].value;draft.deposit=deposits.value;
   deposits.addEventListener('change',()=>{draft.deposit=deposits.value;validate();});content.append(label('Posting collateral',deposits),paragraph('When you review your post, we’ll check your available posting funds and the board’s rules.'));
   if(kind==='reply'||kind==='bok'){
    if(kind==='bok'&&draft.parent===undefined&&draft.root===undefined)Object.assign(draft,{parent:'0',root:'0'});
    if(replyContext(draft)||kind==='bok'&&field(draft.subboard)&&draft.parent==='0'&&draft.root==='0')conversationContext(draft);
    else content.append(paragraph('Choose a post in the reader and select Reply to join its conversation.'),button('Choose a post',()=>close()));
    if(replyContext(draft)||kind==='reply')content.append(button('Start new conversation',()=>{draft={...draft,type:kind==='reply'?'post':'bok',parent:'0',root:'0'};render();}));
   }else input('subboard','Subboard ID (0 for main board)',{initial:'0'});
   if(kind==='quote'||kind==='repost')input('reference','Referenced post ID');
   input('content',kind==='repost'?'Optional repost comment':'Message',{area:true,required:kind!=='repost'});
   if(kind==='bok'){
    content.append(paragraph(`Available private Bok credit: ${bokStatus.availableCredit}.`),paragraph('Bok receives this post only after you confirm its credit authorization and then confirm publication. Each action has its own network fee.'));
    input('budget','Maximum Bok credits',{initial:'1'});
   }
  }
  const counter=el('p',{class:'counter','aria-live':'polite'}),preview=el('div',{class:'preview-body','aria-label':'Message preview'});
  if(fields.has('content'))content.append(counter,el('details',{},el('summary',{},'Preview message'),preview));
  const review=button('Check action and review fee',()=>{
   if(!validate())return;
   const action={type:kind};for(const [key,node]of fields)action[key]=node.value;
   if(kind==='bio'||kind==='avatar'){action.name=draft.name;action.expectedVersion=profileSnapshot[kind==='bio'?'bioVersion':'avatarVersion'];}
   else if(fields.has('content'))Object.assign(action,{name:draft.name,deposit:draft.deposit});
   if(kind==='preference')Object.assign(action,{kind:draft.kind,target:draft.kind===5?'0':action.target,enabled:draft.enabled});
   if(kind==='reply'||kind==='bok')Object.assign(action,{subboard:draft.subboard,parent:draft.parent,root:draft.root});
   const selectedAvatar=avatarDraft;
   void work(async()=>{if(kind==='avatar')Object.assign(action,selectedAvatar?.clear?{width:0,height:0,data:''}:{width:100,height:100,data:await blobData(selectedAvatar.blob)});
    blocked=true;try{if(kind==='preference'||kind==='read-marker'){const epoch=accountEpoch;checkAccount(epoch);const head=await session.application.readPreferenceHead();checkAccount(epoch);if(typeof head?.revision!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(head.revision))throw connectionFailure;action.expectedRevision=head.revision;}intent=await session.application.prepare(action);}catch(failure){if(kind==='bio'||kind==='avatar')profileSnapshot=null;if(kind==='name'&&nameFailure(failure))blocked=false;throw failure;}blocked=false;note('Review the saved action and maximum fee before sending.');});
  },true);
  content.append(review);
  function validate(){
   let valid=[...fields.values()].every(node=>!node.required||node.value.length>0);
   for(const id of IDS)if(fields.has(id))valid=valid&&field(fields.get(id).value);
   if(fields.has('content')){
    const text=fields.get('content').value,a=allowance(text);preview.textContent=text;
    counter.textContent=`${a.characters} characters · ${a.bytes}/992 UTF-8 bytes · ${Math.max(0,a.remaining)} bytes remaining${a.remaining<0?` · ${-a.remaining} bytes over the limit`:''}`;
    counter.className=`counter${a.remaining<0?' invalid':''}`;
    valid=valid&&a.remaining>=0&&text.isWellFormed()&&!text.includes('\0')&&(kind==='bio'||!!draft.deposit);
   }
   if(MODERATOR_TYPES.has(kind)){valid=valid&&moderatorStatus?.authorized===true;const key=kind==='set-main-policy'?'rules':'reason',value=fields.get(key).value;valid=valid&&value.isWellFormed()&&!value.includes('\0')&&new TextEncoder().encode(value).length<=(key==='rules'?992:217);if(kind!=='set-main-policy'){const id=fields.get(kind==='moderate-post'?'post':kind==='moderate-avatar'?'name':'subboard').value;valid=valid&&field(id)&&BigInt(id)>0n;}}
   if(kind==='reply')valid=valid&&replyContext(draft);
   if(kind==='bok'){const {parent,root,subboard}=draft;valid=valid&&field(subboard)&&field(parent)&&field(root)&&((BigInt(parent)===0n)===(BigInt(root)===0n));const v=fields.get('budget').value;valid=valid&&/^[1-9][0-9]{0,38}$/.test(v)&&BigInt(v)<(1n<<128n)&&BigInt(v)<=BigInt(bokStatus?.availableCredit??'0');}
   if(kind==='bio'||kind==='avatar')valid=valid&&!!profileSnapshot&&identities.includes(draft.name)&&BigInt(profileSnapshot.name)===BigInt(draft.name)&&(kind!=='avatar'||!!avatarDraft);
   if(kind==='preference')valid=valid&&field(draft.kind===5?'0':fields.get('target').value)&&(draft.kind===2||draft.kind===5||BigInt(fields.get('target').value||'0')!==0n);
   if(kind==='read-marker')valid=valid&&field(fields.get('thread').value)&&BigInt(fields.get('thread').value||'0')!==0n&&/^(0|[1-9][0-9]{0,9})$/.test(fields.get('throughBlock').value)&&BigInt(fields.get('throughBlock').value)<=0xffffffffn;
   if(kind==='subboard')valid=valid&&/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(fields.get('slug').value);
   review.dataset.unavailable=String(!valid);review.disabled=busy||!valid;return valid;
  }
  validate();
 }
 function fundingWalletView(){
  if(typeof runtime.fundingWallets!=='function'||typeof runtime.connectFundingWallet!=='function'||typeof runtime.fundingWalletStatus!=='function')return;
  content.append(el('h3',{},'Your funding wallet'),paragraph('Choose the Ethereum wallet that will pay. Connecting does not transfer money or publish your private account.'));
  const snapshot=runtime.fundingWalletStatus();
  if(snapshot.connected){
   if(typeof snapshot.name!=='string'||typeof snapshot.address!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(snapshot.address))throw connectionFailure;
   content.append(paragraph(snapshot.name+' connected: '+snapshot.address.slice(0,6)+'…'+snapshot.address.slice(-4)));return;
  }
  const choices=runtime.fundingWallets();
  if(!Array.isArray(choices)||choices.length>32)throw connectionFailure;
  if(!choices.length)content.append(paragraph('No Ethereum wallet was found. Open MetaMask or Phantom in this browser, then refresh the wallet list.'));
  for(const choice of choices){
   if(typeof choice.id!=='string'||typeof choice.name!=='string'||choice.name.length>128)throw connectionFailure;
   content.append(button('Connect '+choice.name,()=>void work(async()=>{
    const epoch=accountEpoch;checkAccount(epoch);await runtime.connectFundingWallet(choice.id);checkAccount(epoch);
    notice='Funding wallet connected. No payment has been sent.';
   })));
  }
  content.append(button('Refresh wallet list',()=>render()));
 }
 function stopFunding(){fundingAutomatic=false;clearTimeout(fundingTimer);fundingTimer=null;}
 function units(value,decimals){
  if(typeof value!=='string'||!new RegExp('^(0|[1-9][0-9]{0,30})(?:\\.[0-9]{1,'+decimals+'})?$').test(value))throw connectionFailure;
  const [whole,fraction='']=value.split('.');const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0'));if(result<=0n)throw connectionFailure;return result.toString();
 }
 function decimal(value,decimals){const text=BigInt(value).toString().padStart(decimals+1,'0'),fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'');}
 function scheduleFunding(){
  clearTimeout(fundingTimer);fundingTimer=null;
  if(!fundingAutomatic||!['funding','topup'].includes(view)||!dialog.open||!unlocked())return;
  fundingTimer=setTimeout(()=>{fundingTimer=null;if(fundingAutomatic&&['funding','topup'].includes(view)&&dialog.open){if(busy)scheduleFunding();else void work(advanceFunding);}},5000);
 }
 async function advanceFunding(){
  const epoch=accountEpoch;checkAccount(epoch);
  const result=await fundingCapability().advanceClaim();checkAccount(epoch);
  if(result.state==='complete'){stopFunding();notice=view==='topup'?'Top-up and private claim confirmed. Your posting collateral is unchanged.':'Funding and the private claim are confirmed. Your posting deposit, network fees and Bok credit are ready.';await refresh();}
  else if(result.state==='review-payment'){stopFunding();topupQuote=null;notice='Token approval confirmed. Review the separate top-up payment; no deposit is sent automatically.';}
  else if(['review','review-saved','reverted','cancelled'].includes(result.state)){
   stopFunding();intent=result.intent;
   notice=result.state==='review-saved'?'This saved claim has not been submitted. Review it explicitly before sending; the Ethereum payment will not repeat.':result.state==='reverted'?'The private claim reverted. Review recovery; do not repeat the Ethereum payment.':'The private claim needs a new review. No additional Ethereum payment will be sent.';
  }else{notice=result.state==='waiting'?'Payment confirmed. Waiting for the bridge; no second Ethereum payment will be requested.':'Checking the saved private claim. It will not be submitted again.';scheduleFunding();}
 }
 function fundingCapability(){
  const type=intent?.action?.type;if(type==='claim-private-fee')return session?.topup?.['private-fee'];if(type==='claim-bok')return session?.topup?.bok;
  return view==='topup'?session?.topup?.[topupKind]:session?.funding;
 }
 function topupView(){
  fundingWalletView();content.append(el('h3',{},'Add network fees or Bok credit'),paragraph('Use tokens already in your Ethereum wallet. Your posting deposit stays untouched. Each token approval and bridge payment is reviewed separately. ETH is needed for Ethereum gas.'));
  const choices=Object.keys(session.topup??{});if(!choices.length){content.append(paragraph('Direct top-ups are unavailable for this deployment.'));return;}
  if(!choices.includes(topupKind))topupKind=choices[0];const cap=session.topup[topupKind];
  if(topupQuote){const q=topupQuote;content.append(paragraph(q.phase==='approval'?'Approve only the displayed token amount for the verified bridge. This does not deposit or claim the top-up.':'Deposit the reviewed tokens to the verified bridge. Then claim the credit privately; no posting deposit is changed.'),paragraph('Amount: '+decimal(q.amount,topupKind==='bok'?6:18)+(topupKind==='bok'?' USDC for Bok.':' fee tokens.')),paragraph('Ethereum gas maximum for this step: '+decimal(q.gasBudgetWei,18)+' ETH.'),paragraph('Private claim fee maximum: '+decimal(q.privateFeeCap,18)+' fee tokens ('+q.privateFeeCap+' base units).'),paragraph('Wallet: '+q.walletName+'.'));
   content.append(button(q.phase==='approval'?'Confirm token approval':'Confirm top-up and private claim',()=>void work(async()=>{const epoch=accountEpoch;checkAccount(epoch);topupQuote=null;const result=await cap.confirm();checkAccount(epoch);if(result.approved){stopFunding();notice='Token approval confirmed. Review the separate top-up payment; no deposit is sent automatically.';}else{fundingAutomatic=true;await advanceFunding();}}),true),button('Change top-up review',()=>{topupQuote=null;render();}));
  }else if(!fundingAutomatic){
   const select=el('select',{'aria-label':'Top-up credit'});for(const kind of choices)select.append(el('option',{value:kind},kind==='bok'?'Bok credit (USDC)':'Network fee credit'));select.value=topupKind;select.addEventListener('change',()=>{topupKind=select.value;topupInputs.amount='';render();});content.append(label('Top-up credit',select));
   for(const [key,name]of [['amount',topupKind==='bok'?'USDC top-up amount':'Fee token top-up amount'],['gas','Top-up Ethereum gas maximum (ETH)']]){const input=el('input',{type:'text',inputmode:'decimal','aria-label':name});input.value=topupInputs[key];input.addEventListener('input',()=>topupInputs[key]=input.value);content.append(label(name,input));}
   content.append(button('Review top-up',()=>void work(async()=>{const epoch=accountEpoch;checkAccount(epoch);topupQuote=await cap.prepare({amount:units(topupInputs.amount,topupKind==='bok'?6:18),gasBudgetWei:units(topupInputs.gas,18),privateFeeCap:cap.defaultPrivateFeeCap});checkAccount(epoch);}),true));
  }
  content.append(button(fundingAutomatic?'Pause top-up checks':'Resume saved top-up',()=>{if(fundingAutomatic){stopFunding();notice='Top-up checks paused. Saved payment and custody are preserved.';render();}else void work(async()=>{fundingAutomatic=true;try{await advanceFunding();}catch(error){stopFunding();throw error;}});}));
 }
 function aggregateFundingView(){
  if(!session.funding){content.append(paragraph('New funding is unavailable until this deployment has verified exchange and bridge settings. Saved payments can still be recovered.'));return;}
  content.append(el('h3',{},'Fund your private account'),paragraph('One payment supplies your posting deposit, private network fees and USDC-backed Bok credit. The bridge and one private claim continue here after confirmation.'));
  if(fundingQuote){
   const q=fundingQuote,b=q.breakdown,isUsdc=q.kind==='rolling-aggregate-usdc-v1';
   if(isUsdc){
    content.append(paragraph('Pay USDC with '+q.walletName+'. No ETH is required in your wallet.'),
     paragraph('Posting deposit: '+decimal(b.collateral.amount,18)+' ETH; maximum exchange cost '+decimal(b.collateral.maxUsdc,6)+' USDC.'),
     paragraph('Network fee credit: '+decimal(b.fee.amount,18)+' fee tokens; maximum exchange cost '+decimal(b.fee.maxUsdc,6)+' USDC.'),
     paragraph('Bok credit: '+decimal(b.bokAmount,6)+' USDC.'),paragraph('Relay fee: '+decimal(b.relayFeeUsdc,6)+' USDC. Maximum total: '+decimal(b.maximumUsdc,6)+' USDC.'),
     paragraph('Slippage limit: '+(q.slippageBps/100)+'%. Relay Ethereum gas budget: '+decimal(q.relayGasBudgetWei,18)+' ETH, paid by the configured relayer and reimbursed by the displayed relay fee.'),
     paragraph('Private claim fee maximum: '+decimal(q.privateFeeCap,18)+' fee tokens ('+q.privateFeeCap+' base units).'),
     paragraph('Confirming asks for two scoped signatures: collateral consent and exact USDC payment authorization. The configured relayer sends one transaction. Recovery only checks its status; it never repeats that payment.'));
   }else content.append(paragraph('Pay with '+q.walletName+'.'),paragraph('Posting deposit: '+decimal(b.collateralWei,18)+' ETH.'),
    paragraph('Network fee credit: '+decimal(b.fee.amount,18)+' fee tokens; maximum exchange cost '+decimal(b.fee.maxEth,18)+' ETH.'),
    paragraph('Bok credit: '+decimal(b.bok.amount,6)+' USDC; maximum exchange cost '+decimal(b.bok.maxEth,18)+' ETH.'),
    paragraph('Slippage limit: '+(q.slippageBps/100)+'%. Ethereum gas maximum: '+decimal(b.gasBudgetWei,18)+' ETH.'),
    paragraph('Maximum total payment and Ethereum gas: '+decimal(b.maximumTotalWei,18)+' ETH.'),
    paragraph('Private claim fee maximum: '+decimal(q.privateFeeCap,18)+' fee tokens ('+q.privateFeeCap+' base units). This ceiling comes from this deployment’s configured gas limits and prices.'),
    paragraph('Confirming first asks your wallet for a scoped collateral consent signature, then one Ethereum payment. It also approves the single private claim within the maximum above. Keep this panel open for bridge progress.'));
   content.append(button('Confirm funding and private claim',()=>void work(async()=>{
    const epoch=accountEpoch;checkAccount(epoch);fundingQuote=null;const payment=await session.funding.confirm();checkAccount(epoch);
    fundingAutomatic=true;notice=payment?.pending?'Payment submitted. Checking relay and bridge delivery…':'Payment confirmed. Checking bridge delivery…';await advanceFunding();
   },aggregateFundingFailure),true),button('Change allocation',()=>{fundingQuote=null;render();}));
  }else if(!fundingAutomatic){
   if(session.funding.usdcAvailable){const asset=el('select',{'aria-label':'Pay with'});for(const [value,text]of [['ETH','ETH'],['USDC','USDC — no ETH needed']])asset.append(el('option',{value},text));asset.value=fundingInputs.asset;asset.addEventListener('change',()=>{fundingInputs.asset=asset.value;render();});content.append(label('Pay with',asset));}
   const fields={};for(const [key,name]of [['collateral','Posting deposit (ETH)'],['fee','Network fee credit (fee tokens)'],['bok','Bok credit (USDC)'],['gas','Maximum Ethereum gas cost (ETH)'],['slippage','Slippage limit (%)']]){
    if(key==='gas'&&fundingInputs.asset==='USDC')continue;
    const input=el('input',{type:'text',inputmode:'decimal','aria-label':name});input.value=fundingInputs[key];input.addEventListener('input',()=>fundingInputs[key]=input.value);fields[key]=input;content.append(label(name,input));
   }
   content.append(button('Get fresh quote',()=>void work(async()=>{
    const epoch=accountEpoch;checkAccount(epoch);const values={...fundingInputs};
    if(!/^(?:[0-4](?:\.[0-9]{1,2})?|5(?:\.0{1,2})?)$/.test(values.slippage))throw connectionFailure;
    const slippageBps=Math.round(Number(values.slippage)*100);
    fundingQuote=await session.funding.prepare({asset:values.asset,collateralWei:units(values.collateral,18),feeAmount:units(values.fee,18),bokAmount:units(values.bok,6),
     ...(values.asset==='USDC'?{collateralPoolFee:3000}:{gasBudgetWei:units(values.gas,18),bokPoolFee:3000}),feePoolFee:3000,slippageBps,privateFeeCap:session.funding.defaultPrivateFeeCap});checkAccount(epoch);
   }),true));
  }
  content.append(button(fundingAutomatic?'Pause bridge checks':'Resume saved funding',()=>{
   if(fundingAutomatic){stopFunding();notice='Automatic checks paused. Your encrypted payment and claim records are preserved.';render();}
   else void work(async()=>{fundingAutomatic=true;try{await advanceFunding();}catch(error){stopFunding();throw error;}});
  }));
 }
 function fundingView(){
  fundingWalletView();aggregateFundingView();
  content.append(el('h3',{},'Recover a completed funding payment'),paragraph('Import the public receipt saved when funding. We check the original payment and bridge delivery before offering a private claim. This does not request another Ethereum payment.'));
  const file=el('input',{type:'file',accept:'.json,application/json','aria-label':'Funding recovery receipt'});
  const review=button('Check funding receipt',()=>void work(async()=>{
   const epoch=accountEpoch;checkAccount(epoch);const selected=file.files?.[0];
   if(!selected||selected.size>16384)throw connectionFailure;
   const recovered=JSON.parse(await selected.text());checkAccount(epoch);
   if(!recovered||Object.getPrototypeOf(recovered)!==Object.prototype||Object.keys(recovered).some(key=>!['receipt','feeReceipt','bokReceipt'].includes(key))||!recovered.receipt)throw connectionFailure;
   const action={type:'claim-deposit',receipt:recovered.receipt,...(recovered.feeReceipt?{feeReceipt:recovered.feeReceipt}:{}),...(recovered.bokReceipt?{bokReceipt:recovered.bokReceipt}:{})};
   blocked=true;intent=await session.application.prepare(action);checkAccount(epoch);blocked=false;
   notice='Payment and bridge delivery verified. Review the private claim and maximum fee.';
  }),true);
  review.dataset.unavailable='true';review.disabled=true;
  file.addEventListener('change',()=>{const ready=!!file.files?.[0]&&file.files[0].size<=16384;review.dataset.unavailable=String(!ready);review.disabled=busy||!ready;});
  content.append(label('Saved funding receipt',file),review);
 }
 function render(previousFocus=document.activeElement){
  if(!['funding','topup'].includes(view)||invalidated||reloadRequired)stopFunding();
  const hadFocus=dialog.contains(previousFocus);
  // Use labels, never private values, to retain the same control after a form
  // change. Recreated controls have different DOM identities.
  const focusKey=node=>node.tagName+':'+(node.getAttribute('aria-label')??(node.labels?.[0]?[...node.labels[0].childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(''):['BUTTON','SUMMARY'].includes(node.tagName)?node.textContent:node.getAttribute('href')??''));
  const controls=()=>[...content.querySelectorAll('button,input,select,textarea,summary,a[href]')];
  const key=hadFocus?focusKey(previousFocus):null,index=key?controls().filter(n=>focusKey(n)===key).indexOf(previousFocus):-1;
  releasePreviews();content.replaceChildren();
  if(error)content.append(el('p',{role:'alert',class:'notice error'},error));
  if(notice)content.append(el('p',{class:'notice'},notice));
  if(plaintextRecovery)content.append(el('p',{role:'status',class:'notice'},plaintextRecoveryWarning));
  if(invalidated||reloadRequired){content.append(paragraph('This account session has ended. Existing recovery records remain encrypted on this device.'),button('Reload to unlock',()=>location.reload()));}
  else if(!runtime)content.append(paragraph('Browsing needs no wallet. Unlock only when you want to manage your account or publish.'),button('Unlock',()=>void unlock(),true));
  else if(!unlocked())custody();
  else{
   if(!session)content.append(paragraph('Your account is unlocked. The verified private connection is not ready.'),button('Connect private account',()=>void work(connect),true));
   else if(intent)showIntent();
   else if(blocked&&view==='preferences'){
    content.append(paragraph('Recover saved choices without checking funds or preparing a transaction.'));preferencesView();
    content.append(button('Check account recovery',()=>void work(async()=>{await refresh();view='action';})));
   }
   else if(blocked)content.append(paragraph('Check retained recovery before preparing any new action.'),button('Check account recovery',()=>void work(refresh)));
   else{
    const messages={'fee-needed':'Funds for transaction fees are needed.','collateral-pending':'No posting deposit was found.','fee-ready':'A posting deposit was found. We’ll check whether it can be used when you review an action.'};
    content.append(paragraph(messages[status?.status]??'The private account has not been verified.'));
    if(status?.privateFeeCredit&&/^[0-9]+$/.test(status.privateFeeCredit))content.append(paragraph(status.privateFeeCredit==='0'?'No funds for transaction fees are available.':'Funds for transaction fees are available.'));
    content.append(button('Recover funding',()=>{view='funding';topupQuote=null;render();}));if(session.topup)content.append(button('Top up fees or Bok',()=>{view='topup';fundingQuote=null;render();}));
    if(status?.privateFeeCredit&&/^[0-9]+$/.test(status.privateFeeCredit))content.append(paragraph('Private network fee balance: '+decimal(status.privateFeeCredit,18)+' fee tokens.'));
    if(bokStatus?.available&&/^[0-9]+$/.test(bokStatus.availableCredit))content.append(paragraph('Private Bok balance: '+decimal(bokStatus.availableCredit,6)+' USDC-backed credits.'));
    if(status?.status!=='locked'){
     content.append(el('nav',{'aria-label':'Private account views'},button('Actions',()=>{view='action';render();}),button('Your names',()=>{view='names';render();}),...(typeof session.application.readBalances==='function'?[button('Balances and withdrawals',()=>{view='balances';balances=null;bokAccounting=null;render();})]:[]),button('Private views',()=>{view='preferences';render();})));
     if(view==='balances')balancesView();else if(view==='names')namesView();else if(view==='preferences')preferencesView();else if(view==='funding')fundingView();else if(view==='topup')topupView();else form();
    }
    content.append(button('Refresh private account',()=>void work(refresh)));
   }
   recovery();
  }
  controlsBusy(busy);
  if(dialog.open&&!busy&&(hadFocus||document.activeElement===document.body)){
   if(previousFocus.isConnected&&dialog.contains(previousFocus))previousFocus.focus({preventScroll:true});
   else{
    const same=index>=0?controls().filter(n=>focusKey(n)===key)[index]:null;
    const target=same&&!same.disabled?same:content.querySelector('h3')??closeButton;
    if(target.tagName==='H3')target.tabIndex=-1;
    target.focus({preventScroll:true});
   }
  }
 }
 function close(){if(busy||session?.busy){note('An account operation is in progress. Wait before closing.');return false;}stopFunding();recoveryInspection=null;releasePreviews();if(dialog.open)dialog.close();return true;}
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>{for(const input of dialog.querySelectorAll('input[type=password]'))input.value='';if(returnFocus?.isConnected)returnFocus.focus();});
 dialog.addEventListener('keydown',event=>{
  if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(node=>!node.disabled&&node.getClientRects().length);
  if(!focusable.length){event.preventDefault();dialog.focus();return;}
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 });
 render();
 return Object.freeze({open(defaults={}){
  if(busy)return;
  if(!intent){view=defaults.view==='preferences'?'preferences':'action';clearProfileDraft();const next={type:Object.hasOwn(TYPES,defaults.type)?defaults.type:'post',subboard:'0',content:''};
   for(const key of IDS)if(field(defaults[key]))next[key]=defaults[key];
   if(next.type==='moderate-avatar'&&field(defaults.name))next.name=defaults.name;
   if(next.type==='preference'&&Number.isInteger(defaults.kind)&&defaults.kind>=1&&defaults.kind<=5&&field(defaults.target)&&typeof defaults.enabled==='boolean')Object.assign(next,{kind:defaults.kind,target:defaults.target,enabled:defaults.enabled});
   if(next.type==='read-marker'&&field(defaults.thread)&&typeof defaults.throughBlock==='string')Object.assign(next,{thread:defaults.thread,throughBlock:defaults.throughBlock});
   if(typeof defaults.content==='string'&&defaults.content.length<=10000)next.content=defaults.content;draft=next;}
  if(!dialog.open){returnFocus=document.activeElement;render();dialog.showModal();closeButton.focus();}
  if(session&&unlocked()&&view!=='preferences')void work(refresh);
 },close,moderatorAuthorized(){return unlocked()&&!!session&&moderatorStatus?.authorized===true;},privateStatus,preferenceEnabled,filterPrivatePage(view,page){if(privateStatus()!=='complete'||!['following','bookmarks','notifications'].includes(view))throw connectionFailure;return runtime.selectPrivateViews({preferences,page})[view];}});
}
