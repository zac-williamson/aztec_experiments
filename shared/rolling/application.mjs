import {captureThreadAction,linkThreadDrafts,MAX_THREAD_POSTS} from './thread-action.mjs';
import {createEncryptedJournalSlot} from '../journal-record.mjs';
import {l2JournalScopeText} from '../l2-journal.mjs';
import {nameRegistration,NAME_DOMAIN} from './name-policy.mjs';
import {FIELD_MODULUS,INVOCATION_DOMAIN,invocationPreimage} from './invocation.mjs';

const fail=code=>Object.assign(new Error(code),{code});
const check=(ok,code='ROLLING_INVALID_ACTION')=>{if(!ok)throw fail(code);};
const clone=value=>JSON.parse(JSON.stringify(value));
const field=(value,nonzero=false)=>{
  check(typeof value==='string'&&/^(?:0x[0-9a-f]{64}|0|[1-9][0-9]{0,76})$/.test(value));
  const n=BigInt(value);check(n<FIELD_MODULUS&&(!nonzero||n>0n));return `0x${n.toString(16).padStart(64,'0')}`;
};
const zero=field('0');
function paidLikeData(value,keys){
 check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length);
 return Object.fromEntries(keys.map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);check(d&&Object.hasOwn(d,'value'));return [key,d.value];}));
}
function tipPoint(value){
  const point=paidLikeData(value,['x','y']),x=field(point.x),y=field(point.y);
  const a=BigInt(x),b=BigInt(y);
  check((a!==0n||b!==0n)&&(b*b-a*a*a+17n)%FIELD_MODULUS===0n);
  return {x,y};
}
export function capturePaidLikeAction(value){
 const action=paidLikeData(value,['type','post','tipKey']);check(action.type==='like');
 return {type:'like',post:field(action.post,true),tipKey:tipPoint(action.tipKey)};
}
function plain(value,depth=0){
  check(depth<24,'ROLLING_INVALID_RESPONSE');
  if(typeof value==='bigint')return field(value.toString());
  if(value===null||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number'){check(Number.isSafeInteger(value),'ROLLING_INVALID_RESPONSE');return value;}
  if(value?.toField)return field(value.toField().toString());
  if(value?.toBigInt)return field(value.toBigInt().toString());
  if(Array.isArray(value)){check(value.length<=1024,'ROLLING_INVALID_RESPONSE');return value.map(v=>plain(v,depth+1));}
  check(value&&Object.getPrototypeOf(value)===Object.prototype,'ROLLING_INVALID_RESPONSE');
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,plain(v,depth+1)]));
}
// The installed ABI decoder returns undefined for Option::None. Only the
// verified return ABI may grant absence; required values remain fail-closed.
function utilityPlain(value,type,depth=0){
  check(type&&depth<24,'ROLLING_INVALID_RESPONSE');
  if(type.kind==='struct'&&type.path==='std::option::Option'){
    check(type.fields?.length===2&&type.fields[0].name==='_is_some'&&type.fields[0].type.kind==='boolean'&&type.fields[1].name==='_value','ROLLING_ABI_MISMATCH');
    return value===undefined||value===null?null:utilityPlain(value,type.fields[1].type,depth+1);
  }
  check(value!==undefined&&value!==null,'ROLLING_INVALID_RESPONSE');
  if(type.kind==='array'||type.kind==='tuple'){
    const size=type.kind==='array'?type.length:type.fields.length;
    check(Number.isSafeInteger(size)&&size<=1024&&Array.isArray(value)&&value.length===size,'ROLLING_INVALID_RESPONSE');
    return Array.from({length:size},(_,i)=>utilityPlain(value[i],type.kind==='array'?type.type:type.fields[i],depth+1));
  }
  if(type.kind==='struct'&&!value?.toField&&!value?.toBigInt){
    check(Object.getPrototypeOf(value)===Object.prototype&&Array.isArray(type.fields)&&type.fields.length<=64,'ROLLING_INVALID_RESPONSE');
    check(Object.keys(value).sort().join()===type.fields.map(f=>f.name).sort().join(),'ROLLING_INVALID_RESPONSE');
    return Object.fromEntries(type.fields.map(f=>[f.name,utilityPlain(value[f.name],f.type,depth+1)]));
  }
  if(type.kind==='boolean')check(typeof value==='boolean','ROLLING_INVALID_RESPONSE');
  return plain(value,depth);
}
function text(value,count,required=true){
  check(typeof value==='string'&&value.isWellFormed()&&!value.includes('\0'));
  const bytes=new TextEncoder().encode(value);check(bytes.length<=count*31&&(!required||bytes.length));
  return [pack(bytes,count),bytes.length];
}
function pack(bytes,count){
  const packed=Array(count).fill(0n);for(let i=0;i<bytes.length;i++)packed[Math.floor(i/31)]|=BigInt(bytes[i])<<BigInt(8*(30-i%31));
  return packed.map(n=>field(n.toString()));
}
function version(value){check(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,9})$/.test(value)&&BigInt(value)<=0xffffffffn);return Number(value);}


function avatar(action){
  check(typeof action.data==='string'&&action.data.length<=10924&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(action.data));
  const binary=atob(action.data);check(btoa(binary)===action.data&&binary.length<=8192);
  check(binary.length===0?action.width===0&&action.height===0:action.width===100&&action.height===100);
  return [field(action.name,true),version(action.expectedVersion),action.width,action.height,binary.length,pack(Uint8Array.from(binary,c=>c.charCodeAt(0)),265)];
}
function nameAvatar(action,name){
  const value=action.avatar;
  check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()==='data,height,width');
  check(value.width===100&&value.height===100&&typeof value.data==='string'&&value.data.length>0);
  return avatar({...value,name,expectedVersion:'0'});
}
function component(fields,length){
  check(Array.isArray(fields)&&fields.length===2&&Number.isInteger(length)&&length>=1&&length<=32,'ROLLING_INVALID_RESPONSE');
  const words=fields.map(value=>{check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)<(1n<<248n),'ROLLING_INVALID_RESPONSE');return BigInt(value);});
  check((words[1]&((1n<<240n)-1n))===0n,'ROLLING_INVALID_RESPONSE');
  const bytes=Array.from({length:31},(_,i)=>Number((words[0]>>BigInt((30-i)*8))&255n));bytes.push(Number(words[1]>>240n));
  check(bytes.slice(length).every(n=>n===0),'ROLLING_INVALID_RESPONSE');return String.fromCharCode(...bytes.slice(0,length));
}
const moderationTypes=new Set(['moderate-post','moderate-avatar','reject-subboard','set-main-policy','transfer-moderator']);
const keys={'transfer-moderator':['successor'],'moderate-post':['post','reason'],'moderate-avatar':['name','reason'],'reject-subboard':['subboard','reason'],'set-main-policy':['rules'],'cancel-deposit':['receipt'],'claim-deposit':['receipt','feeReceipt','bokReceipt'],'claim-private-fee':['receipt'],'claim-bok':['receipt','feeReceipt'],bio:['name','expectedVersion','content'],avatar:['name','expectedVersion','width','height','data'],name:['first','last','avatar'],subboard:['slug','name','description','rules'],like:['post','tipKey'],'withdraw-bok':['amount','recipient'],'cancel-bok-request':['requestId'],'expire-bok-request':['requestId'],withdraw:['deposit'],screen:['deposit'],
  thread:['deposit','contents','name','subboard','parent','root','budgets'],bok:['deposit','content','name','subboard','budget','parent','root'],post:['deposit','content','name','subboard'],reply:['deposit','content','name','subboard','parent','root'],
  quote:['deposit','content','name','subboard','reference'],repost:['deposit','content','name','subboard','reference']};
const methods={thread:'post_thread','transfer-moderator':'transfer_moderator','moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy',bok:'authorize_request','cancel-deposit':'cancel_deposit','claim-deposit':'claim_deposit','claim-private-fee':'claim-private-fee','claim-bok':'claim',bio:'set_bio',avatar:'set_avatar',name:'register_name',subboard:'create_subboard',like:'paid_like','withdraw-bok':'withdraw','cancel-bok-request':'cancel','expire-bok-request':'expire',withdraw:'withdraw',screen:'screen',post:'post',reply:'post',quote:'post',repost:'post'};

/** Wallet-only port; import after unlock. No SDK, network or public-reader work at import.
 * deployment: {board:{address,artifact}, network:{chainId,version,rollup},portal,
 *              privateFee:{address,artifact,gasSettings},proofsEnabled?}.
 * accountSession: {owner,wallet,node,journal,walletSecret,walletSalt}; node is the
 * branded trusted node; wallet is createAztecWallet with this SAME scoped L2 journal
 * and contextGuard. Parent constructs PXE with that same node: the installed PXE
 * wraps it in an opaque SDK caching proxy; sdk.isPrivatePXEForNode verifies the
 * repository factory's private WeakMap provenance rather than proxy equality.
 * sdk.isPrivateWalletForNode is supplied by the SDK facade from
 * BillboardPrivateFeeRouting.isPrivateWalletForNode in the repository wallet factory;
 * it verifies captured submission-node provenance. The wallet's public .aztecNode
 * identity and factory PXE provenance are also checked before personalized calls.
 * Parent verifies deployment artifacts/publication before binding.
 * privateStore: existing ciphertext read(key)/atomic compareAndSwap(key,prior,next).
 * contextGuard must reject a locked/replaced account or changed deployment.
 * Gas limits/prices may use JSON decimal strings or bigint; they are detached.
 * The loaded RollingBoard artifact must be the processed, manifest-verified artifact.
 * Tests require that normal generated artifact; mocks do not qualify live funding.
 * Inputs are strict plain actions; field identifiers are decimal or 32-byte lowercase
 * hex strings; profile expectedVersion is a canonical decimal uint32 string.
 * ownedIdentities returns private IDs and display records only from owned_name_records;
 * there is no public per-name lookup or legacy fallback. Bios allow992UTF8 bytes,
 * including empty clear. Avatars accept canonical padded base64<=8192bytes,100x100,
 * or empty data with0x0 to clear. The upload UI must validate/decode/moderate pixels
 * and bind confirmed preview bytes before preparing this binary contract action.
 * screen accepts only an existing deposit ID and snapshots authenticated-wallet
 * child/grandchild screening hints. It advances private history without public
 * content or a subboard-policy gate; the contract enforces maturity and debt.
 * This does not retrieve encrypted events or qualify key-only recovery.
 * A prepared post includes authenticated-wallet screening hints and live policy versions.
 * submit delegates the sole prove/journal/send lifecycle to wallet.sendTx. Once its
 * durable fence exists, automatic behavior is limited to read-only reconcile, including after a crash
 * before transaction bytes were saved. New built-in pre-proof attempts alone may
 * explicitly renew review with unchanged local restore-invalidated provenance and
 * exact predecessor journal. Historical/no-provenance fences remain unknown.
 * Missing receipt is never absence. No automatic
 * replacement. Explicit resumeSaved may resend the identical saved bytes
 * after fresh context validation, without estimation or proving; cancelPrepared permits only the pre-send prepared state. Recovery UI must preserve both encrypted journals.
 * claim-deposit accepts public receipt metadata only. The existing receipt verifier
 * derives the private claim from wallet custody and checks delivery at the current
 * PXE anchor before both preparation and submission. Secrets stay in the encrypted
 * workflow record, never its public action/summary. The caller owns funding.provider
 * and its lifetime, guarded with the same account/network context.
 * claim-private-fee consumes a delivered FPC receipt through the existing mint-and-pay
 * method alone; claim-bok consumes a delivered PrivateBok receipt (optional feeReceipt).
 * Neither requires another collateral deposit/withdrawal. loadAggregate(txHash) also
 * loads private direct Bok custody {bokScope,recipientSalt,bridgeSecret}, without an
 * aggregate intent. No imported action supplies this capability or these secrets.
 * These are asynchronous L2 claims only; direct L1 token payments still need user gas.
 * Bok authorization and posting are separately confirmed and journalled. The encrypted
 * workflow retains the exact request, target and draft between them; no automatic resend.
 * withdraw creates the existing funded deposit's L2 exit. Its encrypted original
 * receipt survives later private actions in the single pending-exit slot.
 * readBokAccounting advances one private ownership or uniform public page per
 * call. Its opaque cursor is session-local and bound to an unchanged canonical
 * PXE anchor. Only a fully consumed public revision returns owned totals. Free
 * balance excludes request allocations; refunded amounts are historical and
 * already returned to that free balance, never additive.
 * Only the separate original-recipient Ethereum journal marks the exit paid.
 */
// One current exit is retained independently of the next private action. The
// existing Ethereum journal still owns signing, payment and canonical receipts.
export function createPendingWithdrawalSlot({storage,walletSecret,walletSalt,scope}){
  return createEncryptedJournalSlot({storage,walletSecret,walletSalt,
    scopeText:JSON.stringify(['ROLLING_PENDING_EXIT_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_PENDING_EXIT_V1'});
}
export function createRollingApplication({sdk,deployment,accountSession,privateStore,publicReader,readBokAccountingPage,resolveBok,funding,onProgress=()=>{},contextGuard,measure=(_stage,operation)=>operation()}){
  void publicReader; // Never route personalized requests through public readers.
  const readAccountingPage=typeof readBokAccountingPage==='function'?readBokAccountingPage:null;
  let busy=false,callScope=null,slotPromise,pendingExitPromise,creditCachePromise,balanceContinuation=null,accountingScan=null,completedAccounting=null;
  const networkChecks=new WeakMap(),preparedPayments=new WeakMap(),preparedPolicies=new WeakMap(),withdrawalObservations=new WeakMap();
  const session=accountSession;
  // Only this browser capability enables provisional completion. A private exit
  // may be included while its separately saved Ethereum payment remains pending.
  const proposedTransactions=session?.proposedTransactions===true;
  const atomicBok=record=>record.action?.type==='bok'&&record.bok?.phase==='atomic'&&record.method==='post_with_bok';
  const includedAction=record=>proposedTransactions&&!record.bokReleaseSource&&
    (atomicBok(record)||!record.bok&&['withdraw','withdraw-bok','cancel-deposit','cancel-bok-request','expire-bok-request','screen','claim-deposit','claim-private-fee','claim-bok','post','reply','quote','repost','thread','like','name','bio','avatar','subboard','moderate-post','moderate-avatar','reject-subboard','set-main-policy','transfer-moderator'].includes(record.action?.type));
  const usableStatus=status=>['included','confirmed','reverted'].includes(status);
  const getOperationScope=typeof session?.operationScope==='function'?session.operationScope.bind(session):()=>callScope;
  const chainInfoMethod=session?.wallet?.getChainInfo,accountsMethod=session?.wallet?.getAccounts;
  const preproof=session?.preproofRecovery;
  const localPreproof=preproof&&typeof preproof.checkpoint==='function'&&typeof preproof.send==='function'&&
    typeof privateStore?.readRecoveryEpoch==='function'&&typeof privateStore?.ensureRecoveryEpoch==='function'&&typeof privateStore?.rotateRecoveryEpoch==='function'
    ?Object.freeze({checkpoint:preproof.checkpoint,send:preproof.send}):null;
  const owner=session?.owner?.toString();
  const fundingProvider=funding?.provider,claimStore=funding?.claimStore;
  const bokTopupScope=funding?.bokTopupScope?clone(funding.bokTopupScope):undefined;
  const verifyWithdrawal=typeof funding?.verifyWithdrawal==='function'?funding.verifyWithdrawal.bind(funding):null;
  const resolveBokWithdrawal=typeof funding?.resolveBokWithdrawal==='function'?funding.resolveBokWithdrawal.bind(funding):null;
  const loadAggregate=typeof funding?.loadAggregate==='function'?funding.loadAggregate.bind(funding):null;
  const readBokClaimCustody=typeof funding?.readBokClaimCustody==='function'?funding.readBokClaimCustody.bind(funding):null;
  const fixed=deployment&&{board:deployment.board.address.toString(),network:clone(deployment.network),portal:deployment.portal,
    fee:deployment.privateFee.address.toString(),gas:JSON.parse(JSON.stringify(deployment.privateFee.gasSettings,(_,v)=>typeof v==='bigint'?v.toString():v)),proofsEnabled:deployment.proofsEnabled!==false};
  let bok=deployment?.bok&&{address:deployment.bok.address.toString(),operator:deployment.bok.operator.toString(),pluginId:field(deployment.bok.pluginId,true)};
  let bokBindingVerified=false;
  async function ensureBok({bind=false}={}){
    await localGuard();
    if(!bok&&typeof resolveBok==='function'){
      const verified=await resolveBok();
      if(verified){deployment.bok=verified;bok={address:verified.address.toString(),operator:verified.operator.toString(),pluginId:field(verified.pluginId,true)};}
    }
    if(bind&&bok&&!bokBindingVerified){
      // configure_plugin makes a plugin ID's adapter immutable. Establish this
      // deployment binding once; enabled state belongs to transaction simulation.
      const plugin=await pluginRecord();
      check(field(plugin?.adapter,true)===field(bok.address,true),'ROLLING_BOK_UNAVAILABLE');
      await localGuard();bokBindingVerified=true;
    }
    await localGuard();return bok;
  }
  // Input counts and contracts changed: use native simulation until this new
  // deployment has separately measured gas profiles. Fees remain actual-only.
  const ordinaryPost=()=>undefined,qualifiedLike=()=>undefined;
  const scope=session&&fixed&&{account:owner,chainId:String(fixed.network.chainId),version:String(fixed.network.version),
    rollup:fixed.network.rollup,board:fixed.board,portal:fixed.portal};
  const slot=()=>slotPromise??=createEncryptedJournalSlot({storage:privateStore,walletSecret:session.walletSecret,walletSalt:session.walletSalt,
    scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
  const pendingExitSlot=()=>pendingExitPromise??=createPendingWithdrawalSlot({storage:privateStore,
    walletSecret:session.walletSecret,walletSalt:session.walletSalt,scope});
  async function pendingExit(){await localGuard();const saved=await (await pendingExitSlot()).read();await localGuard();return saved;}
  const sameExit=(a,b)=>a?.intentId===b?.intentId&&a?.txHash===b?.txHash&&same(a?.action,b?.action)&&same(a?.withdrawal,b?.withdrawal);
  async function retainExit(record){
    if(!record.withdrawal||!['included','confirmed'].includes(record.status))return;
    const next=summary(record),saved=await pendingExit();
    if(saved.value&&sameExit(saved.value,next)&&saved.value.paymentStatus==='refunded')return;
    const replacement=saved.value?.paymentStatus==='pending'&&saved.value.intentId===next.intentId&&same(saved.value.action,next.action)&&same(saved.value.withdrawal,next.withdrawal)&&record.replacementReview?.sourceTxHash===saved.value.txHash;
    check(!saved.value||saved.value.paymentStatus==='refunded'||sameExit(saved.value,next)||replacement,'ROLLING_WITHDRAWAL_PENDING');
    await localGuard();await (await pendingExitSlot()).write(saved,{...next,paymentStatus:'pending'});await localGuard();
  }
  async function pendingExitSummary(){const saved=await pendingExit();return saved.value?.paymentStatus==='pending'?clone(saved.value):null;}
  async function pendingExitOutcome(){
    const saved=await pendingExit();if(!saved.value||saved.value.paymentStatus==='refunded')return null;
    const r=saved.value;check(r.paymentStatus==='pending'&&r.withdrawal&&['withdraw','withdraw-bok','cancel-deposit'].includes(r.action?.type),'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');
    const receipt=await session.node.getTxReceipt(sdk.TxHash.fromString(r.txHash));await localGuard();
    check(hashText(receipt?.txHash)===r.txHash,'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');
    if(!['proposed','checkpointed','proven','finalized'].includes(receipt.status)||receipt.executionResult!=='success')return {...clone(r),status:'unknown'};
    check(Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0,'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');
    const block=await session.node.getBlockData(receipt.blockNumber);await localGuard();
    check(Number(block?.header?.globalVariables?.blockNumber)===receipt.blockNumber&&hashText(block.blockHash)===hashText(receipt.blockHash),'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');
    check(await (await pendingExitSlot()).isCurrent(saved.encoded),'ROLLING_CONTEXT_CHANGED');
    return {...clone(r),status:receipt.status==='proposed'?'included':'confirmed',inclusion:{blockNumber:receipt.blockNumber,blockHash:hashText(receipt.blockHash)}};
  }

  function chainValue(value){
    try{
      if(value&&typeof value==='object'&&typeof value.toBigInt==='function')value=value.toBigInt();
      if(typeof value==='number'){check(Number.isSafeInteger(value),'ROLLING_CONTEXT_CHANGED');value=BigInt(value);}
      if(typeof value==='string'){
        check(/^(?:0x[0-9a-f]{64}|0|[1-9][0-9]{0,76})$/.test(value),'ROLLING_CONTEXT_CHANGED');value=BigInt(value);
      }
      check(typeof value==='bigint'&&value>=0n&&value<FIELD_MODULUS,'ROLLING_CONTEXT_CHANGED');return value;
    }catch{throw fail('ROLLING_CONTEXT_CHANGED');}
  }
  async function localGuard(){
    check(session&&typeof contextGuard==='function','ROLLING_LOCKED');await contextGuard();
    check(owner===session.owner.toString()&&session.wallet.getChainInfo===chainInfoMethod&&session.wallet.getAccounts===accountsMethod&&sdk.isTrustedPrivateNode(session.node)&&
      session.wallet.aztecNode===session.node&&sdk.isPrivateWalletForNode(session.wallet,session.node)&&sdk.isPrivatePXEForNode(session.wallet.pxe,session.node)&&fixed.board===deployment.board.address.toString()&&fixed.fee===deployment.privateFee.address.toString()&&
      JSON.stringify(fixed.network)===JSON.stringify(deployment.network)&&fixed.portal===deployment.portal&&
      (!bok||deployment.bok?.address.toString()===bok.address&&deployment.bok?.operator.toString()===bok.operator&&field(deployment.bok?.pluginId,true)===bok.pluginId),'ROLLING_CONTEXT_CHANGED');
  }
  async function guard(){
    await localGuard();
    // One readiness snapshot belongs to the active account operation, not each
    // internal read. Identity/route fences still run at every async boundary.
    const scope=getOperationScope()??callScope;
    let checked=scope&&networkChecks.get(scope);
    if(!checked){
      checked=(async()=>{
        const values=await Promise.allSettled([
          ()=>sdk.inspectTrustedNode(session.node,{expectedNetworkScope:fixed.network,proofsEnabled:fixed.proofsEnabled}),
          ()=>session.wallet.getChainInfo(),()=>session.wallet.getAccounts(),
        ].map(read=>Promise.resolve().then(read)));
        const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        const chain=values[1].value,accounts=values[2].value;
        check(chainValue(chain?.chainId)===chainValue(fixed.network.chainId)&&chainValue(chain?.version)===chainValue(fixed.network.version),'ROLLING_CONTEXT_CHANGED');
        check(accounts.some(a=>(a.address??a).toString()===owner),'ROLLING_CONTEXT_CHANGED');
      })();
      if(scope)networkChecks.set(scope,checked);
    }
    await checked;await localGuard();
  }
  async function exclusive(fn){check(!busy,'ROLLING_BUSY');busy=true;callScope={};try{return await fn();}finally{busy=false;callScope=null;}}
  const progress=stage=>{try{onProgress({stage});}catch{/* display errors cannot alter transaction control */}};
  const contract=()=>sdk.Contract.at(new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.board))),deployment.board.artifact,session.wallet);
  async function utility(board,name,args,artifact=deployment.board.artifact,includeWitnessHints=false){
    const matches=[...artifact.functions,...(artifact.nonDispatchPublicFunctions??[])].filter(f=>f.name===name);
    check(matches.length===1,'ROLLING_ABI_MISMATCH');const abi=matches[0];
    check(!abi.returnTypes||abi.returnTypes.length<=1,'ROLLING_ABI_MISMATCH');
    const run=()=>board.methods[name](...args).simulate({from:session.owner});
    const out=await (name==='get_screen_hints'?measure('action.screening',run,{nativeUtility:true}):run());
    const value=utilityPlain(out.result??out,abi.returnType??abi.returnTypes?.[0]);
    return includeWitnessHints?{value,noteHashWitnessHints:out.noteHashWitnessHints}:value;
  }
  function shareAggregateClaim(action){
    const operation=getOperationScope();
    if(action.type!=='claim-deposit'||!loadAggregate||!callScope||callScope.aggregateClaim||operation?.synchronized!==true)return;
    const receipts=[action.receipt,action.feeReceipt,action.bokReceipt].filter(Boolean),identity=['txHash','blockHash','blockNumber','sender','nonce'];
    if(receipts.length<2||!identity.every(key=>receipts.every(receipt=>receipt[key]===receipts[0][key])))return;
    const wallet=session.wallet,pxe=wallet.pxe,node=session.node,cachedNode=pxe.node,secret=session.walletSecret,salt=session.walletSalt;
    const checkOwner=()=>check(getOperationScope()===operation&&operation.synchronized===true&&session.wallet===wallet&&wallet.pxe===pxe&&session.node===node&&pxe.node===cachedNode&&session.walletSecret===secret&&session.walletSalt===salt,'ROLLING_CONTEXT_CHANGED');
    let pending;
    // The existing exclusive call owns this context. Submission creates a new
    // context and recovers custody afresh after checkpointClaim changed storage.
    callScope.aggregateClaim={...Object.fromEntries(identity.map(key=>[key,receipts[0][key]])),anchor:null,read:async(kind)=>{
      await localGuard();checkOwner();
      pending??=Promise.resolve().then(()=>loadAggregate(receipts[0].txHash));
      let value=await pending;await localGuard();checkOwner();
      if(value===null)value=await loadAggregate(receipts[0].txHash,kind);
      await localGuard();checkOwner();return value===null?null:clone(value);
    }};
  }
  async function fundingClaim(kind,metadata){
    check(fundingProvider&&typeof sdk.prepareFundingClaim==='function','ROLLING_FUNDING_UNAVAILABLE');
    if(kind==='bok')await ensureBok();
    const cancellation = kind === 'collateral-cancel';
    const receipt=exactData(metadata,['txHash','blockHash','blockNumber','sender','nonce','amount','leafIndex','messageKey','secretHash',...(cancellation ? ['depositId'] : [])]);
    await guard();const header=await session.wallet.pxe.getSyncedBlockHeader();await localGuard();
    const anchor={number:Number(header.globalVariables.blockNumber),hash:(await header.hash()).toString(),root:header.state.l1ToL2MessageTree.root.toString()};
    const shared=callScope?.aggregateClaim;
    if(shared&&shared.anchor===null)shared.anchor=clone(anchor);
    const sameAggregate=!cancellation&&shared&&same(shared.anchor,anchor)&&shared.txHash===receipt.txHash&&shared.blockHash===receipt.blockHash&&shared.blockNumber===receipt.blockNumber&&shared.sender===receipt.sender&&shared.nonce===receipt.nonce;
    const readAggregate=()=>!cancellation&&loadAggregate?(sameAggregate?shared.read(kind):loadAggregate(receipt.txHash,kind)):null;
    const ownedBok=kind==='bok'&&readBokClaimCustody?await readBokClaimCustody(receipt):null;await localGuard();
    let aggregate,feeInfo;
    if(kind==='private-fee'){
      // Custody and fee portal metadata are independent reads. Drain both before
      // receipt validation, preserving custody failure priority and node identity.
      const node=session.node;
      const values=await Promise.allSettled([
        async()=>{const value=await readAggregate();await localGuard();return value;},
        async()=>{const value=await node.getNodeInfo();await localGuard();return value;},
      ].map(read=>Promise.resolve().then(read)));
      const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
      check(session.node===node,'ROLLING_CONTEXT_CHANGED');
      [aggregate,feeInfo]=values.map(value=>value.value);
    }else{aggregate=ownedBok??await readAggregate();await localGuard();}
    let claimScope={...fixed.network,portal:fixed.portal,recipient:fixed.board};
    let secrets=cancellation ? undefined : {walletSecret:session.walletSecret,...(kind==='collateral'?{walletSalt:field(String(session.walletSalt))}:{})};
    if(kind==='bok'){
      await ensureBok();check(bok&&aggregate?.bokScope,'ROLLING_FUNDING_UNAVAILABLE');
      claimScope=exactData(aggregate.bokScope,['chainId','version','rollup','portal','recipient','token']);
      check(claimScope.recipient===bok.address&&['chainId','version','rollup'].every(key=>claimScope[key]===fixed.network[key]),'ROLLING_FUNDING_MISMATCH');
      secrets={recipientSalt:field(aggregate.recipientSalt,true),bridgeSecret:field(aggregate.bridgeSecret,true)};
    }
    if(kind==='private-fee'){
      claimScope={...fixed.network,portal:feeInfo.l1ContractAddresses.feeJuicePortalAddress.toString().toLowerCase(),
        token:feeInfo.l1ContractAddresses.feeJuiceAddress.toString().toLowerCase(),recipient:fixed.fee};
    }
    // Full network/account attestation brackets verification. Per-read fences
    // check local session identity without multiplying those network queries.
    const operationScope=session.operationScope?.(),held=operationScope?.synchronized===true?operationScope:undefined;
    const claimOwner={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node,secret:session.walletSecret,salt:session.walletSalt,cachedNode:held?session.wallet.pxe.node:undefined};
    if(held)check(sdk.isPrivatePXEForNode(claimOwner.pxe,claimOwner.node)&&typeof claimOwner.cachedNode?.getL1ToL2MessageMembershipWitness==='function','ROLLING_CONTEXT_CHANGED');
    const claimGuard=async()=>{await localGuard();if(ownedBok)await ownedBok.checkCurrent();if(held)check(session.operationScope()===held&&session.wallet===claimOwner.wallet&&session.wallet.pxe===claimOwner.pxe&&session.node===claimOwner.node&&session.walletSecret===claimOwner.secret&&session.walletSalt===claimOwner.salt&&claimOwner.pxe.node===claimOwner.cachedNode&&sdk.isPrivatePXEForNode(claimOwner.pxe,claimOwner.node),'ROLLING_CONTEXT_CHANGED');};
    const prepareClaim=ownedBok?sdk.prepareBokMessageClaim:sdk.prepareFundingClaim;check(typeof prepareClaim==='function','ROLLING_FUNDING_UNAVAILABLE');
    const verified=await prepareClaim({kind,scope:claimScope,receipt,anchor,owner,...(held?{operationScope:held,membershipNode:claimOwner.cachedNode}:{}),...(kind==='bok'&&bokTopupScope?{bokTopupScope}:{}),
      secrets,...(aggregate?{aggregateIntent:aggregate.intent,...(aggregate.aggregateCustody?{aggregateCustody:aggregate.aggregateCustody}:{})}:{}),
      privateFeeArtifact:deployment.privateFee.artifact,ethProvider:fundingProvider,node:session.node,claimStore,contextGuard:claimGuard,measure});
    await guard();if(verified.status!=='claim-ready')throw Object.assign(Error('Funding is not ready to claim.'),{code:'ROLLING_FUNDING_NOT_READY',reason:verified.reason});return verified.claim;
  }
  async function verifiedFeeClaim(action,record){
    let claim;
    const receipt=action?.type==='claim-private-fee'?action.receipt:
      ['claim-deposit','claim-bok'].includes(action?.type)?action.feeReceipt:undefined;
    if(receipt!==undefined){
      const verified=await fundingClaim('private-fee',receipt);
      check(verified.contract===fixed.fee&&verified.kind==='private-fee-bridge','ROLLING_FUNDING_MISMATCH');
      claim=verified.bridgeClaim;
      if(record){
        if(record.fundingFee)check(same(plain(claim),record.fundingFee),'ROLLING_FUNDING_MISMATCH');
        else record.fundingFee=plain(claim);
      }
    }
    return claim;
  }
  const creditCache=()=>creditCachePromise??=createEncryptedJournalSlot({storage:privateStore,walletSecret:session.walletSecret,walletSalt:session.walletSalt,
    scopeText:JSON.stringify(['ROLLING_PRIVATE_CREDIT_V1',l2JournalScopeText(scope),fixed.fee]),keyDomain:'ROLLING_PRIVATE_CREDIT_V1'});
  async function readFeeCredit(){
    return sdk.readPrivateFeeCredit({wallet:session.wallet,node:session.node,owner:session.owner,
      fpc:deployment.privateFee.address,fpcArtifact:deployment.privateFee.artifact,
      board:deployment.board.address,boardArtifact:deployment.board.artifact,chainId:scope.chainId,version:scope.version,cache:creditCache});
  }
  async function paidLikeArguments(action){
    const post=field(action.post,true),key=tipPoint(action.tipKey);
    const base=deployment.board.artifact.storageLayout?.tip_key_hashes?.slot;check(base!==undefined,'ROLLING_ABI_MISMATCH');
    const anchor=await balanceAnchor(),slot=await sdk.deriveStorageSlotInMap(new sdk.Fr(BigInt(base)),new sdk.Fr(BigInt(post)));
    const actual=chainValue(await session.node.getPublicStorageAt({hash:anchor.blockHash},deployment.board.address,slot));
    await checkBalanceAnchor(anchor);
    const expected=await sdk.poseidon2HashWithSeparator([new sdk.Fr(BigInt(key.x)),new sdk.Fr(BigInt(key.y))],0x5243544b);
    check(field(String(actual),true)===field(expected.toString(),true),'ROLLING_TIP_KEY_CHANGED');
    return {board:deployment.board.address,post:new sdk.Fr(BigInt(post)),
      key:{x:new sdk.Fr(BigInt(key.x)),y:new sdk.Fr(BigInt(key.y))},ephemeral:sdk.Fr.random()};
  }
  async function payment(action,record,{ordinaryProof=false,likeProof=false,deferredBalance=false}={}){
    const claim=await verifiedFeeClaim(action,record);
    const paidLike=action?.type==='like'?await paidLikeArguments(action):undefined;
    return sdk.preparePrivateFeePayment({wallet:session.wallet,node:session.node,owner:session.owner,
      privateFeeAddress:fixed.fee,privateFeeArtifact:deployment.privateFee.artifact,expectedChainId:scope.chainId,expectedVersion:scope.version,gasSettings:fixed.gas,measure,
      creditScope:{board:deployment.board.address,artifact:deployment.board.artifact,cache:creditCache},...(claim?{claim}:{}),...(paidLike?{paidLike}:{}),...((ordinaryProof||likeProof||deferredBalance)&&!action?{creditCheck:'deferred-balance'}:{})});
  }
  // Read the native credit at the caller's held PXE anchor. Account status
  // owns Board/FPC class-qualified discovery; full balance views retain their
  // existing canonical anchor checks. No transaction is prepared by this read.
  async function privateFeeAvailable(){
    await localGuard();
    const available=chainValue(await measure('action.fee-balance',()=>readFeeCredit()));
    check(available<(1n<<128n),'ROLLING_INVALID_RESPONSE');await localGuard();
    return available;
  }
  async function collateralClaim(action){
    // Receipt metadata cannot replace the authenticated deployment or inject
    // secrets. Both claims are derived from custody and rechecked at submission.
    const claim=await fundingClaim('collateral',action.receipt);
    check(claim.contract===fixed.board&&claim.method==='claim_deposit','ROLLING_FUNDING_MISMATCH');
    return plain(claim.args);
  }
  async function cancellationArguments(action) {
    const claim = await fundingClaim('collateral-cancel', action.receipt);
    check(claim.contract === fixed.board && claim.method === 'cancel_deposit', 'ROLLING_FUNDING_MISMATCH');
    return plain(claim.args);
  }
  async function privateBokClaim(receipt){
    const claim=await fundingClaim('bok',receipt);
    check(claim.contract===bok.address&&claim.method==='claim','ROLLING_FUNDING_MISMATCH');
    return {scope:clone(bok),args:plain(claim.args)};
  }
  async function bokFundingClaim(action){
    await ensureBok();check(bok&&action.feeReceipt&&action.bokReceipt&&action.receipt.txHash===action.feeReceipt.txHash&&action.receipt.txHash===action.bokReceipt.txHash,'ROLLING_FUNDING_MISMATCH');
    return privateBokClaim(action.bokReceipt);
  }
  const operation=id=>`ROLLING_WORKFLOW_V1:${id}`;
  function summary(record){return {intentId:record.id,action:clone(record.action),status:record.status,maximumFee:record.maximumFee,
    nonce:record.nonce,txHash:record.txHash??null,...(record.withdrawal?{withdrawal:clone(record.withdrawal),actualNetworkFee:record.actualNetworkFee??null}:{}),...(record.moderation?{moderation:clone(record.moderation)}:{}),stage:record.bok?`bok-${record.bok.phase}`:'single-transaction',...(record.bok?{bok:{phase:record.bok.phase,budget:record.bok.budget,availableCredit:record.bok.availableCredit,authorizationTxHash:record.bok.authorizationTxHash??null,...(['post','atomic'].includes(record.bok.phase)?{mainPolicyVersion:record.args[2].expected_main_policy_version,localPolicyVersion:record.args[2].expected_local_policy_version}:{})}}:{}),...(record.bokReleaseSource?{bokRelease:{sourceIntentId:record.bokReleaseSource.id}}:{}),...(record.replacementReview?{replacementReview:clone(record.replacementReview)}:{}),
    ...(record.inclusion?{inclusion:clone(record.inclusion)}:{}),...(record.nameAvailability?{nameAvailability:clone(record.nameAvailability)}:{})};}
  async function checkBokRecord(record){const scopes=[record?.bok?.scope,record?.threadBok?.scope,record?.fundingBok?.scope,record?.bokRequestScope,record?.bokReleaseSource?.bok?.scope];if(scopes.some(Boolean)||record?.withdrawal?.kind==='bok')await ensureBok({bind:record.bok?.phase==='atomic'||!!record.threadBok});for(const savedScope of scopes)if(savedScope)check(bok&&JSON.stringify(savedScope)===JSON.stringify(bok),'ROLLING_CONTEXT_CHANGED');}
  async function savedIntent(id){const saved=await (await slot()).read();check(saved.value&&saved.value.id===id,'ROLLING_INTENT_NOT_FOUND');await checkBokRecord(saved.value);return saved;}
  async function acknowledge(found,expected){
    check(found&&found.operation===expected.operation&&found.txHash===expected.txHash&&
      ['success','reverted'].includes(found.outcome)&&found.receipt?.txHash?.toString()===found.txHash,'ROLLING_RECOVERY_REQUIRED');
    // inspectOutcome verified this exact receipt canonically. assertCanStart still
    // rechecks canonicality and rejects non-final reverted sender-tagging ranges.
    if(found.receipt.status==='proposed')await session.journal.included(found.receipt);else session.journal.confirmed(found.receipt);
  }
  // Historical receipts belong to this account/board journal, not whichever
  // optional plugin is currently offered. Continuations and exits still require
  // their original plugin; a local terminal label alone never proves completion.
  const terminalHistory=record=>usableStatus(record.status)&&
    !(record.status==='confirmed'&&record.bok?.phase==='authorize')&&
    !(record.status==='reverted'&&(record.bok?.phase==='post'||record.bokReleaseSource));
  async function outcome(saved,{history=false,completion=false}={}){
    const historical=history&&terminalHistory(saved.value);
    if(!historical)await checkBokRecord(saved.value);
    const found=await session.journal.inspectOutcome({reuse:historical,completion});
    if(!found||found.operation!==operation(saved.value.id))return {...summary(saved.value),status:'unknown'};
    if(!['success','reverted'].includes(found.outcome))return {...summary(saved.value),status:'unknown',txHash:found.txHash};
    if(found.receipt?.status==='proposed'&&!includedAction(saved.value))return {...summary(saved.value),status:'unknown',txHash:found.txHash};
    await acknowledge(found,{operation:operation(saved.value.id),txHash:saved.value.replacementReview?found.txHash:(saved.value.txHash??found.txHash)});
    const next={...saved.value,...(saved.value.withdrawal?{actualNetworkFee:String(chainValue(found.receipt.transactionFee))}:{}),status:found.outcome==='success'?(found.receipt.status==='proposed'?'included':'confirmed'):'reverted',txHash:found.txHash,...(includedAction(saved.value)?{inclusion:{blockNumber:found.receipt.blockNumber,blockHash:hashText(found.receipt.blockHash)}}:{})};
    if(historical&&!terminalHistory(next))await checkBokRecord(next);
    await retainExit(next);await (await slot()).write(saved,next);
    return {...summary(next),...(next.bok?.phase==='authorize'&&next.status==='confirmed'?{status:'authorized'}:next.bok?.phase==='post'&&next.status==='reverted'?{status:'bok-post-reverted'}:next.bokReleaseSource&&next.status==='reverted'?{status:'bok-release-reverted'}:{})};
  }
  // Inspect only the authenticated current workflow. Funding needs this fence
  // before a claim, not unrelated deposit and private fee balance utilities.
  async function fundingWorkflowState(beforeSync=false,statusView=false){
    await guard();const saved=await (await slot()).read();await localGuard();
    // Empty or completed ordinary/claim workflows need only authenticated journal
    // authority here, not a native note sync which bridge readiness invalidates.
    // The unchanged outcome path below verifies the actual signed receipt and
    // canonical block; local completion labels never grant readiness.
    if(beforeSync&&saved.value!==null){
      const record=saved.value;
      if(!['included','confirmed'].includes(record.status)||
        !['post','reply','quote','repost','thread','like','name','bio','avatar','subboard','claim-deposit','claim-private-fee','claim-bok'].includes(record.action?.type)||
        record.fundingBok&&!['claim-deposit','claim-bok'].includes(record.action.type)||
        record.fundingFee&&!['claim-deposit','claim-private-fee','claim-bok'].includes(record.action.type)||
        record.bok||record.bokReleaseSource||record.bokRequestScope||record.withdrawal||record.replacementReview||
        await pendingExitSummary())return null;
    }
    // Status presentation still reads fresh native balances below. Completed
    // ordinary/claim history grants no authority to claim, prepare, prove or send.
    // Included claims remain provisional; only fresh native balances below
    // determine current usability, never the saved completion label.
    const record=saved.value,owner=statusView?getOperationScope():null;
    const nativeClaimStatus=['claim-deposit','claim-private-fee','claim-bok'].includes(record?.action?.type)&&['included','confirmed'].includes(record.status);
    if(owner?.synchronized===true&&(nativeClaimStatus||['included','confirmed'].includes(record?.status)&&
      ['post','reply','quote','repost','thread','like','name','bio','avatar','subboard'].includes(record.action?.type))&&
      !record.bok&&(!record.fundingBok||nativeClaimStatus&&['claim-deposit','claim-bok'].includes(record.action.type))&&!record.bokReleaseSource&&!record.bokRequestScope&&!record.withdrawal&&!record.replacementReview&&
      !await pendingExitSummary()){
      await localGuard();check(getOperationScope()===owner&&owner.synchronized===true,'ROLLING_CONTEXT_CHANGED');return {status:'ready'};
    }
    if(saved.value&&saved.value.status!=='cancelled'){
      if(!terminalHistory(saved.value))await checkBokRecord(saved.value);
      if(!usableStatus(saved.value.status))return {status:'recovering',intent:summary(saved.value)};
      const canonical=await outcome(saved,{history:true});await localGuard();
      if(!usableStatus(canonical.status))return {status:'recovering',intent:canonical};
    }
    return {status:'ready'};
  }
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const hashText=value=>{const text=value?.toString();check(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text),'ROLLING_INVALID_RESPONSE');return text;};
  function exactData(value,names){
    check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===names.length,'ROLLING_INVALID_ACTION');
    return Object.fromEntries(names.map(name=>{const d=Object.getOwnPropertyDescriptor(value,name);check(d&&Object.hasOwn(d,'value'),'ROLLING_INVALID_ACTION');return [name,d.value];}));
  }
  function savedConsent(record,txHash){
    const review=record.replacementReview;
    // A renewed quote does not prove that new signed bytes were saved. Never
    // attribute that quote to its old source candidate after an interrupted proof.
    if(!txHash||review&&review.sourceTxHash===txHash)return null;
    const maximumFee=review?review.maximumFee:record.maximumFee;
    if(typeof maximumFee!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(maximumFee)||BigInt(maximumFee)>=FIELD_MODULUS)return null;
    return {maximumFee,feeSource:review?'replacement':'original',marker:null};
  }
  function savedContextMatches(record,consent,head,marker){
    if(!consent)return false;
    return head===null&&marker===null&&(!record.replacementReview||record.replacementReview.head===null&&record.replacementReview.marker===null);
  }

  async function exactResumeSnapshot(record,txHash,head,marker){
    if(!txHash)return {status:'empty',txHash:null,maximumFee:null,feeSource:null,marker:null};
    const inspected=await session.journal.inspectSavedRecovery(operation(record.id),txHash),consent=savedConsent(record,txHash);
    let status=inspected.status;
    if(status==='resumable'&&!consent)status='unknown';
    else if(status==='resumable'&&!savedContextMatches(record,consent,head,marker))status='context-changed';
    if(status==='resumable'&&['prepared','cancelled','replacement-prepared'].includes(record.status))status='unknown';
    return {status,txHash:inspected.txHash,...(consent??{maximumFee:null,feeSource:null,marker:null})};
  }
  async function checkSavedResumeContext(saved,txHash){
    const record=saved.value,consent=savedConsent(record,txHash);
    await guard();await session.wallet.pxe.sync();await guard();
    const head=null,marker=null;
    await checkActionRecoveryContext(record);
    check(savedContextMatches(record,consent,head,marker),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();
  }
  async function journalCommitment(fresh=false){
    const prior=await localPreproof.checkpoint(fresh?{fresh:true}:undefined);
    check(prior&&Object.hasOwn(prior,'encoded')&&(prior.encoded===null||typeof prior.encoded==='string'),'ROLLING_RECOVERY_REQUIRED');
    const bytes=new TextEncoder().encode(JSON.stringify(prior.encoded));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function preproofAvailable(saved,aggregateRenewal=false){
    const record=saved.value,p=record.preproof;
    if(!localPreproof||record.status!=='pre-proof'||!p||p.version!==1||
      !/^[0-9a-f]{64}$/.test(p.epoch)||!/^0x[0-9a-f]{64}$/.test(p.attempt)||!/^[0-9a-f]{64}$/.test(p.predecessor))return false;
    // Signed bytes always win, even when publication of the signed fence failed.
    const tx=await session.journal.inspect();if(tx?.operation===operation(record.id)&&tx.txHash!==record.predecessor?.txHash)return false;
    const epoch=await privateStore.readRecoveryEpoch();
    if(!/^[0-9a-f]{64}$/.test(epoch??''))return false;
    if(aggregateRenewal){
      const a=record.action;
      if(record.txHash||a.type!=='claim-deposit'||!loadAggregate||
        !a.receipt?.txHash||a.receipt.txHash!==a.feeReceipt?.txHash||
        (a.bokReceipt!==undefined ? !record.fundingBok||a.receipt.txHash!==a.bokReceipt.txHash : !!record.fundingBok))return false;
      const custody=await loadAggregate(a.receipt.txHash);
      if(!['aggregate-funding','aggregate-usdc-funding'].includes(custody?.intent?.expected?.kind))return false;
    }else if(epoch!==p.epoch)return false;
    if(record.predecessor)await acknowledge(await session.journal.inspectOutcome(),record.predecessor);
    if(await journalCommitment()!==p.predecessor)return false;
    await guard();check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');
    return await privateStore.readRecoveryEpoch()===epoch;
  }
  async function recoverySnapshot(saved){
    const record=saved.value;
    const withoutSignedAttempt=status=>({intent:summary(record),status,attempts:[],requireMissingAnchor:true,
      head:null,marker:null,currentTxHash:null,exactResume:{status:'empty',txHash:null}});
    if(await preproofAvailable(saved))return withoutSignedAttempt('pre-proof-review');
    if(await preproofAvailable(saved,true))return withoutSignedAttempt('aggregate-claim-review');
    // A completed predecessor is not a signed attempt of this workflow. Lost
    // local provenance cannot turn it into replacement or resend authority.
    const current=await session.journal.inspect();
    if(current&&current.operation!==operation(record.id)){
      await guard();check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');
      return withoutSignedAttempt('unknown');
    }
    const inspected=await session.journal.inspectReplacement(operation(record.id),{requireMissingAnchor:true});
    const head=null,marker=null;await guard();
    const exactResume=await exactResumeSnapshot(record,inspected.txHash,head,marker);
    check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();
    let status=inspected.status==='available'?'replacement-available':inspected.status;
    if(status==='replacement-available'||exactResume.status==='resumable'){await session.wallet.pxe.sync();await checkActionRecoveryContext(record);check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();}
    return {intent:summary(record),status,attempts:clone(inspected.attempts),requireMissingAnchor:inspected.requireMissingAnchor,
      head,marker,currentTxHash:inspected.txHash,exactResume};
  }
  async function checkReplacementReview(record,{synchronize=false}={}){
    const review=record.replacementReview;check(review,'ROLLING_RECOVERY_REQUIRED');
    if(synchronize){await guard();await session.wallet.pxe.sync();await guard();}
    check(review.head===null&&review.marker===null,'ROLLING_RECOVERY_CONTEXT_CHANGED');await checkActionRecoveryContext(record);
  }
  // Reuse the original submission checks at recovery boundaries; none of these
  // checks grants permission to resend without the exact authenticated journal.
  async function checkActionSubmission(record,{moderationReviewed=false}={}){
      shareAggregateClaim(record.action);
      if(record.withdrawal?.kind==='bok'){
        const anchor=await balanceAnchor();
        const reads=await Promise.allSettled([
          ()=>resolveBokWithdrawal(),async()=>chainValue(await utility(await bokContract(),'balance_of',[session.owner],deployment.bok.artifact)),
        ].map(read=>Promise.resolve().then(read)));
        const failure=reads.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        const [scope,available]=reads.map(value=>value.value);
        check(same(scope,record.withdrawal.bokScope),'ROLLING_CONTEXT_CHANGED');check(available>=uint128(record.withdrawal.amount),'ROLLING_BOK_CREDIT_INSUFFICIENT');await checkBalanceAnchor(anchor);
      }
      else if(record.withdrawal?.kind==='cancelled-collateral'){check(same(await cancellationArguments(record.action),record.args),'ROLLING_FUNDING_MISMATCH');}
      else if(record.withdrawal){const anchor=await balanceAnchor(),current=await collateralInfo(record.action.deposit,await contract(),BigInt(anchor.timestamp));check(current.eligible&&same(current,record.withdrawal),'ROLLING_WITHDRAWAL_NOT_READY');await checkBalanceAnchor(anchor);}
      if(record.action.type==='claim-deposit')check(same(await collateralClaim(record.action),record.args),'ROLLING_FUNDING_MISMATCH');
      if(record.fundingBok)check(same(await (record.action.type==='claim-bok'?privateBokClaim(record.action.receipt):bokFundingClaim(record.action)),record.fundingBok),'ROLLING_FUNDING_MISMATCH');
      if(record.action.type==='claim-private-fee')check(record.fundingFee,'ROLLING_FUNDING_MISMATCH');
      if(record.bokReleaseSource)await checkBokRelease(record.bokReleaseSource,record.action.type);
      if(!moderationReviewed)await checkModeration(record);
      if(record.bok&&record.bok.phase!=='atomic')await checkBokThread(record.action,await contract());
      if(record.bok?.phase==='authorize'){const available=await bokCredit();check(available>=BigInt(record.bok.budget),'ROLLING_BOK_CREDIT_INSUFFICIENT');}
      if(record.bok?.phase==='post')await waitingBok(record);
  }
  async function checkActionRecoveryContext(record){
    await guard();await checkBokRecord(record);await checkActionSubmission(record);
    // A fresh proof may renew its anchor and fees, never the saved action's
    // screening hints, policy versions, profile version or funded Bok target.
    if(record.action.type==='thread'){
      const args=plain(await argumentsFor(record.action,await contract(),record.nonce,{threadNonces:record.args[1]}));
      check(same(args.slice(0,5),record.args.slice(0,5)),'ROLLING_RECOVERY_CONTEXT_CHANGED');
      if(record.threadBok)for(const request of record.threadBok.requests)check(await bokInvocationTarget(args[2][request.index],args[1][request.index],record.action.contents[request.index])===request.target,'ROLLING_INTENT_CHANGED');
    }
    if(['post','reply','quote','repost','screen'].includes(record.action.type)){
      check(same(plain(await argumentsFor(record.action,await contract(),record.nonce)),record.args),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    }
    if(record.bok){
      await bokContext();const postArgs=plain(await argumentsFor(record.action,await contract(),record.nonce));
      check(same(postArgs,['post','atomic'].includes(record.bok.phase)?record.args.slice(0,5):record.bok.postArgs),'ROLLING_RECOVERY_CONTEXT_CHANGED');
      check(await bokInvocationTarget(postArgs[2],record.nonce,record.action.content)===record.bok.target,'ROLLING_INTENT_CHANGED');
    }
    if(record.action.type==='name')await nameAvailability(record.action);
    if(['bio','avatar'].includes(record.action.type)){
      const profile=await utility(await contract(),'profile_state',[field(record.action.name,true)]);
      check(String(BigInt(profile[record.action.type==='bio'?'bio_version':'avatar_version']))===record.action.expectedVersion,'ROLLING_RECOVERY_CONTEXT_CHANGED');
    }
    const receipt=record.action.type==='claim-private-fee'?record.action.receipt:record.action.feeReceipt;
    if(receipt!==undefined){
      const claim=await fundingClaim('private-fee',receipt);
      check(claim.contract===fixed.fee&&claim.kind==='private-fee-bridge','ROLLING_FUNDING_MISMATCH');
      if(record.action.type==='claim-private-fee')check(same(plain(claim.bridgeClaim),record.fundingFee),'ROLLING_FUNDING_MISMATCH');
    }
    await interaction(await selectedContract(record),record);await guard();
  }
  async function screeningArguments(board,deposit,prefetch=false){
    const {value:hints,noteHashWitnessHints}=await utility(board,'get_screen_hints',[session.owner,deposit],deployment.board.artifact,true);
    check(Array.isArray(hints)&&hints.length===2&&!(!hints[0]&&hints[1]),'ROLLING_HISTORY_UNAVAILABLE');
    if(prefetch){
      const owner=getOperationScope();
      const reading=measure('action.history-witnesses',()=>sdk.prefetchOrdinaryPostWitnesses({wallet:session.wallet,node:session.node,board:deployment.board.instance,artifact:deployment.board.artifact,hints,owner:session.owner,noteHashWitnessHints}));
      if(Array.isArray(owner?.preparationReads)){
        // The native cache shares in-flight reads with the actual private
        // execution. Prefetch is only a latency hint: a rejected read is evicted
        // and native execution retries/validates what the circuit really needs.
        // The session drains every read before releasing this operation's lock.
        owner.preparationReads.push(reading);reading.catch(()=>{});
      }else await reading;
      await localGuard();check(getOperationScope()===owner,'ROLLING_CONTEXT_CHANGED');
    }
    return [deposit,...hints];
  }
  async function checkBokThread(action,board){
    if(action.type!=='bok')return;
    const parent=field(action.parent??'0'),root=field(action.root??'0');
    check((parent===zero)===(root===zero),'ROLLING_INVALID_ACTION');
    if(parent===zero)return;
    const anchor=await balanceAnchor(),value=await utility(board,'get_post',[parent]);
    check(Array.isArray(value)&&value.length===5&&value[0]===true&&BigInt(value[2])===0n,'ROLLING_PARENT_UNAVAILABLE');
    check(field(value[1]?.root,true)===root&&field(value[1]?.subboard)===field(action.subboard??'0'),'ROLLING_THREAD_CHANGED');
    await checkBalanceAnchor(anchor);
  }
  async function nameAvailability(action){
    const registration=nameRegistration(action.first,action.last);
    const id=field((await sdk.poseidon2HashWithSeparator(registration.preimage.map(n=>new sdk.Fr(n)),NAME_DOMAIN)).toString(),true);
    let registered,anchor;
    try{
      await guard();const map=deployment.board.artifact.storageLayout?.registered_names?.slot;
      check(map!==undefined,'ROLLING_ABI_MISMATCH');
      const head=await session.node.getBlockData(proposedTransactions?'proposed':'checkpointed'),blockNumber=Number(head?.header?.globalVariables?.blockNumber),blockHash=hashText(head?.blockHash);
      check(Number.isSafeInteger(blockNumber)&&blockNumber>0,'ROLLING_INVALID_RESPONSE');anchor={blockNumber,blockHash};
      const slot=await sdk.deriveStorageSlotInMap(new sdk.Fr(BigInt(map)),new sdk.Fr(BigInt(id)));await guard();
      // Match RollingBoard's Map<Field,PublicMutable<bool>> at this exact canonical
      // checkpoint. A public view simulation does not bind its read to this hash.
      registered=chainValue(await session.node.getPublicStorageAt({hash:blockHash},new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.board))),slot));
      check(registered===0n||registered===1n,'ROLLING_INVALID_RESPONSE');await guard();
      const again=await session.node.getBlockData(blockNumber);
      check(Number(again?.header?.globalVariables?.blockNumber)===blockNumber&&hashText(again?.blockHash)===blockHash,'ROLLING_CONTEXT_CHANGED');await guard();
    }catch{throw fail('ROLLING_NAME_AVAILABILITY_UNAVAILABLE');}
    check(registered===0n,'ROLLING_NAME_TAKEN');return {id,anchor};
  }
  async function bokInvocationTarget(draft,nonce,content){
    const preimage=invocationPreimage({chainId:BigInt(scope.chainId),rollupVersion:BigInt(scope.version),board:BigInt(fixed.board),plugin:BigInt(bok.address),
      subboard:BigInt(draft.subboard),parent:BigInt(draft.parent),root:BigInt(draft.root_reference),kind:Number(draft.kind),
      name:BigInt(draft.name_id),reference:BigInt(draft.reference),nonce:BigInt(nonce),content});
    return field((await sdk.poseidon2HashWithSeparator(preimage.map(n=>new sdk.Fr(n)),INVOCATION_DOMAIN)).toString(),true);
  }
  async function postingPolicy(board,subboard,preparedAnchor){
    if(subboard===zero){
      // main_policy is a public static view. Posting needs only this one
      // storage value read at the canonical account anchor.
      const slot=deployment.board.artifact.storageLayout?.main_version?.slot;check(slot!==undefined,'ROLLING_ABI_MISMATCH');
      const anchor=preparedAnchor??await balanceAnchor();
      const value=chainValue(await session.node.getPublicStorageAt({hash:anchor.blockHash},deployment.board.address,new sdk.Fr(BigInt(slot))));
      check(value<=0xffffffffn,'ROLLING_INVALID_RESPONSE');
      // Immediate posting already owns the native synchronizer's authenticated
      // anchor. This storage read uses that exact hash; retain the local owner
      // and anchor fence, then let the native proof validate its real witnesses.
      if(preparedAnchor&&getOperationScope()?.synchronized===true){check(same(await balanceAnchor(),anchor),'ROLLING_CONTEXT_CHANGED');await guard();}
      else await checkBalanceAnchor(anchor);
      return {mainVersion:Number(value),localVersion:0};
    }
    const policy=await utility(board,'effective_policy',[subboard]);
    check(Array.isArray(policy)&&policy.length===5,'ROLLING_POLICY_UNAVAILABLE');
    check(policy[4]!==true,'ROLLING_SUBBOARD_REJECTED');
    return {mainVersion:Number(BigInt(policy[0])),localVersion:Number(BigInt(policy[2]))};
  }
  async function argumentsFor(action,board,nonce,{atomicBok=false,postingAnchor,preparedPolicy,withdrawalObservation,threadNonces}={}){
    const allowed=keys[action?.type];check(allowed&&Object.keys(action).every(k=>k==='type'||allowed.includes(k)));
    switch(action.type){
      case 'cancel-deposit':return cancellationArguments(action);
      case 'claim-deposit':return collateralClaim(action);
      case 'claim-private-fee':check(action.receipt!==undefined);return [];
      case 'claim-bok':return (await privateBokClaim(action.receipt)).args;
      case 'bio':return [field(action.name,true),version(action.expectedVersion),...text(action.content,32,false)];
      case 'avatar':return avatar(action);
      case 'name':{
        // This is input validation before fee estimation or a new journal write.
        // Keep it distinct from an unknown preparation/submission outcome.
        if(action.avatar!==undefined)nameAvatar(action,'1');
        try{return nameRegistration(action.first,action.last).arguments;}
        catch(error){if(error instanceof TypeError||error instanceof RangeError)throw fail('ROLLING_NAME_INVALID');throw error;}
      }
      case 'subboard':{
        check(typeof action.slug==='string'&&/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(action.slug));
        return [[...new TextEncoder().encode(action.slug),...Array(40-action.slug.length).fill(0)],action.slug.length,
          ...text(action.name,3),...text(action.description,16),...text(action.rules,32,false)];
      }
      case 'like':field(action.post,true);tipPoint(action.tipKey);return [];
      case 'withdraw-bok':check(bok&&uint128(action.amount)>0n&&typeof action.recipient==='string'&&/^0x[0-9a-f]{40}$/.test(action.recipient)&&BigInt(action.recipient)>0n);return [action.amount,{inner:field(BigInt(action.recipient).toString())},nonce];
      case 'expire-bok-request':
      case 'cancel-bok-request':check(bok&&completedAccounting&&completedAccounting.requests.some(r=>r.requestId===field(action.requestId,true)&&['1','2'].includes(r.state)&&(action.type==='expire-bok-request'||r.reserved==='0')),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');await checkBalanceAnchor(completedAccounting.anchor);return [field(action.requestId,true)];
      case 'withdraw':return [field(action.deposit,true)];
      case 'thread':{
        captureThreadAction(action);
        const subboard=field(action.subboard??'0'),parent=field(action.parent??'0'),root=field(action.root??'0');
        check((parent===zero)===(root===zero));
        const count=action.contents.length,deposit=field(action.deposit,true);
        const reads=await Promise.allSettled([postingPolicy(board,subboard,postingAnchor),utility(board,'get_thread_screen_hints',[session.owner,deposit,count])]);
        const failed=reads.find(value=>value.status==='rejected');if(failed)throw failed.reason;
        const [policy,hints]=reads.map(value=>value.value);
        check(Array.isArray(hints)&&hints.length===MAX_THREAD_POSTS*2,'ROLLING_HISTORY_UNAVAILABLE');
        let empty=false;for(const hint of hints){if(!hint)empty=true;else check(!empty,'ROLLING_HISTORY_UNAVAILABLE');}
        const nonces=threadNonces??Array.from({length:MAX_THREAD_POSTS},(_,i)=>i<count?(i===0?nonce:field(sdk.Fr.random().toString(),true)):zero);
        const baseDraft={subboard,parent,root_reference:root,kind:1,name_id:field(action.name??'0'),reference:zero,expected_main_policy_version:policy.mainVersion,expected_local_policy_version:policy.localVersion};
        const drafts=await linkThreadDrafts({contents:action.contents,nonces,baseDraft,encodeContent:content=>text(content,32),postId:async value=>field((await sdk.poseidon2HashWithSeparator([1n,BigInt(fixed.board),BigInt(value)].map(n=>new sdk.Fr(n)),0x42420102)).toString(),true)});
        while(drafts.length<MAX_THREAD_POSTS)drafts.push({...baseDraft,parent:zero,root_reference:zero,message:Array(32).fill(zero),length:0});
        return [deposit,nonces,drafts,count,hints,Array(MAX_THREAD_POSTS).fill(zero),Array(MAX_THREAD_POSTS).fill(zero)];
      }
      case 'screen':return withdrawalObservation?.screening??screeningArguments(board,field(action.deposit,true));
      default:{
        // Atomic authorization + publication is validated once by the actual
        // private/public contract simulation, including parent/root/removal.
        if(!atomicBok)await checkBokThread(action,board);
        else check((field(action.parent??'0')===zero)===(field(action.root??'0')===zero),'ROLLING_INVALID_ACTION');
        const subboard=field(action.subboard??'0'),kind=action.type==='quote'?2:action.type==='repost'?3:1;
        let policy,screening;
        if(subboard===zero){
          const observations=await Promise.allSettled([preparedPolicy??measure('action.policy',()=>postingPolicy(board,subboard,postingAnchor)),screeningArguments(board,field(action.deposit,true),action.type!=='bok')]);
          const failure=observations.find(value=>value.status==='rejected');if(failure)throw failure.reason;
          [policy,screening]=observations.map(value=>value.value);
        }else{policy=await postingPolicy(board,subboard);screening=await screeningArguments(board,field(action.deposit,true),action.type!=='bok');}
        const [message,length]=text(action.content,32,kind!==3);
        const draft={subboard,parent:field(action.parent??'0',action.type==='reply'),root_reference:field(action.root??'0',action.type==='reply'),kind,
          name_id:field(action.name??'0'),reference:field(action.reference??'0',kind!==1),message,length,
          expected_main_policy_version:policy.mainVersion,expected_local_policy_version:policy.localVersion};
        const [deposit,...hints]=screening;
        return [deposit,nonce,draft,...hints];
      }
    }
  }
  async function moderatorStatus(){
    await guard();const slot=deployment.board.artifact.storageLayout?.moderator?.slot;check(slot!==undefined,'ROLLING_ABI_MISMATCH');
    const head=await session.node.getBlockData(proposedTransactions?'proposed':'checkpointed'),number=Number(head?.header?.globalVariables?.blockNumber),hash=hashText(head?.blockHash);
    check(Number.isSafeInteger(number)&&number>0,'ROLLING_INVALID_RESPONSE');await guard();
    const address=new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.board)));
    const moderator=field((await session.node.getPublicStorageAt({hash},address,new sdk.Fr(BigInt(slot)))).toString(),true);
    await guard();const again=await session.node.getBlockData(number);
    check(hashText(again?.blockHash)===hash&&Number(again?.header?.globalVariables?.blockNumber)===number,'ROLLING_CONTEXT_CHANGED');await guard();
    return {authorized:field(owner,true)===moderator};
  }
  async function moderationArguments(action,board){
    // Authority, policy and target reads share the held operation but are independent.
    // Native utilities keep their queue ordering; drain every read before release.
    const reads=await Promise.allSettled([
      async()=>{check((await moderatorStatus()).authorized,'ROLLING_MODERATOR_REQUIRED');},
      ()=>utility(board,'main_policy',[]),
      async()=>{
        if(action.type==='moderate-post')return utility(board,'get_post',[field(action.post,true)]);
        if(action.type==='moderate-avatar'){const id=field(action.name,true);return [await utility(board,'profile_state',[id]),await utility(board,'avatar_moderation',[id])];}
        if(action.type==='reject-subboard')return utility(board,'subboard_state',[field(action.subboard,true)]);
      },
    ].map(read=>Promise.resolve().then(read)));
    // Preserve authority/policy error priority even when the target finished first.
    const failure=reads.slice(0,2).find(value=>value.status==='rejected');if(failure)throw failure.reason;
    const policy=reads[1].value;check(Array.isArray(policy)&&policy.length===2,'ROLLING_POLICY_UNAVAILABLE');
    const mainVersion=version(String(BigInt(policy[0]))),mainDigest=field(policy[1]);
    const review={mainVersion,mainDigest};let args;
    if(action.type==='transfer-moderator'){const successor=field(action.successor,true);check(successor!==field(owner,true),'ROLLING_INVALID_ACTION');args=[new sdk.AztecAddress(new sdk.Fr(BigInt(successor)))];review.successor=successor;}
    else if(action.type==='set-main-policy')args=text(action.rules,32);
    else{
      const reason=text(action.reason,7);
      if(reads[2].status==='rejected')throw reads[2].reason;
      if(action.type==='moderate-post'){
        const id=field(action.post,true),post=reads[2].value;
        check(Array.isArray(post)&&post.length===5&&post[0]===true&&BigInt(post[2])===0n,'ROLLING_MODERATION_TARGET_CHANGED');
        const subboard=field(post[1].subboard),localVersion=subboard===zero?0:1;
        Object.assign(review,{target:id,localVersion});args=[id,mainVersion,localVersion,...reason];
      }else if(action.type==='moderate-avatar'){
        const id=field(action.name,true),[profile,removed]=reads[2].value;
        const avatarVersion=version(String(BigInt(profile.avatar_version)));
        check(BigInt(profile.avatar_length)>0n&&BigInt(removed.avatar_version)!==BigInt(avatarVersion),'ROLLING_MODERATION_TARGET_CHANGED');
        Object.assign(review,{target:id,avatarVersion,avatarDigest:field(profile.avatar_digest)});args=[id,avatarVersion,mainVersion,...reason];
      }else{
        check(action.type==='reject-subboard');const id=field(action.subboard,true),state=reads[2].value;
        check(Array.isArray(state)&&state.length===5&&state[0]===true&&state[3]===false,'ROLLING_MODERATION_TARGET_CHANGED');
        Object.assign(review,{target:id,localVersion:1});args=[id,...reason];
      }
    }
    await guard();return {args:plain(args),review};
  }
  async function checkModeration(record){
    if(!moderationTypes.has(record.action.type))return;
    const current=await moderationArguments(record.action,await contract());
    check(same(current.args,record.args)&&same(current.review,record.moderation),'ROLLING_MODERATION_TARGET_CHANGED');
  }
  const bokContract=async()=>{await ensureBok();check(bok,'ROLLING_BOK_UNAVAILABLE');return sdk.Contract.at(new sdk.AztecAddress(new sdk.Fr(BigInt(bok.address))),deployment.bok.artifact,session.wallet);};
  const uint128=value=>{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value)&&BigInt(value)<(1n<<128n));return BigInt(value);};
  async function pluginRecord(){
    // Read the pinned plugin fields at the canonical anchor rather than
    // simulate the public static view. V6 PluginRecord is two Packable fields in
    // consecutive PublicMutable slots, keyed with the native Map derivation.
    const artifact=deployment.board.artifact,slot=artifact.storageLayout?.plugins?.slot;
    const matches=[...artifact.functions,...(artifact.nonDispatchPublicFunctions??[])].filter(fn=>fn.name==='get_plugin');
    check(slot!==undefined&&BigInt(slot)>0n&&matches.length===1,'ROLLING_ABI_MISMATCH');
    const fn=matches[0],layout=fn.returnType??fn.returnTypes?.[0],fields=layout?.fields;
    check(fn.functionType==='public'&&fn.isStatic===true&&fn.parameters.length===1&&fn.parameters[0].type.kind==='field'&&
      layout?.kind==='struct'&&fields?.length===2&&fields[0].name==='adapter'&&fields[0].type.kind==='struct'&&
      fields[0].type.fields?.length===1&&fields[0].type.fields[0].name==='inner'&&fields[0].type.fields[0].type.kind==='field'&&
      fields[1].name==='enabled'&&fields[1].type.kind==='boolean','ROLLING_ABI_MISMATCH');
    const anchor=await balanceAnchor(),base=await sdk.deriveStorageSlotInMap(new sdk.Fr(BigInt(slot)),new sdk.Fr(BigInt(bok.pluginId)));
    await guard();
    const results=await Promise.allSettled([0n,1n].map(offset=>Promise.resolve().then(()=>session.node.getPublicStorageAt(
      {hash:anchor.blockHash},deployment.board.address,new sdk.Fr(BigInt(base.toString())+offset)))));
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    const [adapter,enabled]=results.map(result=>chainValue(result.value));
    check(enabled===0n||enabled===1n,'ROLLING_INVALID_RESPONSE');await checkBalanceAnchor(anchor);
    return {adapter:field(adapter.toString()),enabled:enabled===1n};
  }
  async function checkBokPlugin(){
    const plugin=await pluginRecord();
    check(plugin?.enabled===true&&field(plugin.adapter,true)===field(bok.address,true),'ROLLING_BOK_UNAVAILABLE');
    await guard();bokBindingVerified=true;
  }
  async function bokContext(){
    await ensureBok();check(bok,'ROLLING_BOK_UNAVAILABLE');await guard();
    await checkBokPlugin();return bokContract();
  }
  async function bokCredit(){
    await ensureBok();check(bok,'ROLLING_BOK_UNAVAILABLE');await guard();const current=await bokContract();
    // Public plugin admission and native owned-credit discovery are independent.
    // Drain both, preserving admission error priority before returning any credit.
    const reads=await Promise.allSettled([
      ()=>checkBokPlugin(),()=>utility(current,'balance_of',[session.owner],deployment.bok.artifact),
    ].map(read=>Promise.resolve().then(read)));
    const failure=reads.find(read=>read.status==='rejected');if(failure)throw failure.reason;
    const credit=BigInt(reads[1].value);
    check(credit>=0n&&credit<(1n<<128n),'ROLLING_INVALID_RESPONSE');await guard();return credit;
  }
  async function waitingBok(record){
    check(record.bok&&record.action.type==='bok','ROLLING_INTENT_CHANGED');
    const current=await bokContext(),request=await utility(current,'request',[record.bok.requestId],deployment.bok.artifact);
    check(request&&BigInt(request.state)===1n&&field(request.invocation_hash,true)===record.bok.target&&
      BigInt(request.budget)===BigInt(record.bok.budget)&&BigInt(request.available)===BigInt(record.bok.budget)&&
      ['reserved','charged','refunded','sequence'].every(key=>BigInt(request[key])===0n),'ROLLING_BOK_REQUEST_CHANGED');
    await guard();
  }
  // The encrypted original authorization is the ownership/identity source for
  // this narrow recovery. No public accounting query receives a human's IDs.
  async function checkBokRelease(source,type){
    await checkBokRecord(source);
    check(source.action.type==='bok'&&['authorize','post'].includes(source.bok?.phase)&&
      ['cancel-bok-request','expire-bok-request'].includes(type),'ROLLING_RECOVERY_UNSUPPORTED');
    const hash=source.bok.authorizationTxHash??source.txHash;
    check(typeof hash==='string'&&/^0x[0-9a-f]{64}$/.test(hash),'ROLLING_RECOVERY_REQUIRED');
    await guard();
    const receipt=await session.node.getTxReceipt(sdk.TxHash.fromString(hash));
    check(receipt&&['checkpointed','proven','finalized'].includes(receipt.status)&&receipt.executionResult==='success'&&
      hashText(receipt.txHash)===hash&&Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0,'ROLLING_RECOVERY_REQUIRED');
    const block=await session.node.getBlockData(receipt.blockNumber);
    check(Number(block?.header?.globalVariables?.blockNumber)===receipt.blockNumber&&hashText(block.blockHash)===hashText(receipt.blockHash),'ROLLING_RECOVERY_REQUIRED');
    const request=await utility(await bokContract(),'request',[source.bok.requestId],deployment.bok.artifact);
    check(request&&['1','2'].includes(String(BigInt(request.state)))&&field(request.invocation_hash,true)===source.bok.target&&
      BigInt(request.budget)===BigInt(source.bok.budget)&&(type==='expire-bok-request'||BigInt(request.reserved)===0n),'ROLLING_BOK_REQUEST_CHANGED');
    // Deadline and refund amounts remain authoritative contract simulation rules.
    await guard();
  }
  async function selectedContract(record){return ['claim-private-fee','like'].includes(record.action.type)?null:record.bok?.phase==='authorize'||['claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(record.action.type)?bokContract():contract();}
  async function interaction(board,record){
    check((['post','atomic'].includes(record.bok?.phase)?'post_with_bok':methods[record.action.type])===record.method,'ROLLING_INTENT_CHANGED');
    if(['claim-private-fee','like'].includes(record.action.type)){
      check(typeof sdk.BatchCall==='function'&&same(record.args,[]),'ROLLING_FUNDING_UNAVAILABLE');
      // The payment payload supplies the bridge claim or the paid-like phases.
      // An empty SDK batch adds no duplicate mint, debit or Board call.
      const encoded=[];if(record.encoded)check(same(record.encoded,encoded),'ROLLING_INTENT_CHANGED');
      return {call:new sdk.BatchCall(session.wallet,[]),encoded};
    }
    let call=board.methods[record.method](...record.args);
    const selectedArtifact=record.bok?.phase==='authorize'||['claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(record.action.type)?deployment.bok.artifact:deployment.board.artifact;
    const abi=[...selectedArtifact.functions,...(selectedArtifact.nonDispatchPublicFunctions??[])].find(f=>f.name===record.method);check(abi,'ROLLING_ABI_MISMATCH');
    let encoded=sdk.encodeArguments(abi,record.args).map(f=>f.toString());
    if(record.action.type==='name'&&record.action.avatar!==undefined){
      check(typeof sdk.BatchCall==='function','ROLLING_ABI_MISMATCH');
      const registration=nameRegistration(record.action.first,record.action.last);
      const name=field((await sdk.poseidon2HashWithSeparator(registration.preimage.map(n=>new sdk.Fr(n)),NAME_DOMAIN)).toString(),true);
      const avatarArgs=nameAvatar(record.action,name),avatarAbi=deployment.board.artifact.functions.find(f=>f.name==='set_avatar');
      check(avatarAbi,'ROLLING_ABI_MISMATCH');
      encoded=[encoded,sdk.encodeArguments(avatarAbi,avatarArgs).map(f=>f.toString())];
      // Native ownership created by registration is consumed/reissued by the
      // avatar call. Ordered public calls succeed or revert together.
      call=new sdk.BatchCall(session.wallet,[call,board.methods.set_avatar(...avatarArgs)]);
    }
    if(record.threadBok){
      check(record.action.type==='thread'&&typeof sdk.BatchCall==='function','ROLLING_BOK_UNAVAILABLE');
      await checkBokRecord(record);
      const authorizationAbi=deployment.bok.artifact.functions.find(f=>f.name==='authorize_request');check(authorizationAbi,'ROLLING_ABI_MISMATCH');
      const authorizations=record.threadBok.requests.map(({requestId,target,budget})=>[requestId,target,budget]);
      const current=await bokContract();
      encoded=[...authorizations.map(args=>sdk.encodeArguments(authorizationAbi,args).map(value=>value.toString())),encoded];
      call=new sdk.BatchCall(session.wallet,[...authorizations.map(args=>current.methods.authorize_request(...args)),call]);
    }
    if(record.bok?.phase==='atomic'){
      check(typeof sdk.BatchCall==='function','ROLLING_BOK_UNAVAILABLE');
      const authorization=[record.bok.requestId,record.bok.target,record.bok.budget];
      const authorizationAbi=deployment.bok.artifact.functions.find(f=>f.name==='authorize_request');check(authorizationAbi,'ROLLING_ABI_MISMATCH');
      encoded=[sdk.encodeArguments(authorizationAbi,authorization).map(f=>f.toString()),encoded];
      // Both private calls enqueue public execution in this order. A failed post
      // reverts the authorization as part of the same transaction.
      call=new sdk.BatchCall(session.wallet,[(await bokContract()).methods.authorize_request(...authorization),call]);
    }
    if(record.action.type==='claim-deposit'&&record.action.bokReceipt!==undefined){
      await checkBokRecord(record);check(record.fundingBok&&typeof sdk.BatchCall==='function','ROLLING_FUNDING_UNAVAILABLE');
      const bokAbi=deployment.bok.artifact.functions.find(f=>f.name==='claim');check(bokAbi,'ROLLING_ABI_MISMATCH');
      encoded=[encoded,sdk.encodeArguments(bokAbi,record.fundingBok.args).map(f=>f.toString())];
      call=new sdk.BatchCall(session.wallet,[call,(await bokContract()).methods.claim(...record.fundingBok.args)]);
    }
    if(record.encoded)check(JSON.stringify(encoded)===JSON.stringify(record.encoded),'ROLLING_INTENT_CHANGED');
    return {call,encoded};
  }
  // Readiness may hand its exact selected note to immediate preparation in the
  // same held operation. It is consumed once; final submission still rereads
  // the native deposit and checks its canonical anchor before proving.
  async function takeWithdrawalObservation(action,immediate){
    const operation=session.operationScope?.(),saved=operation&&withdrawalObservations.get(operation);
    if(operation)withdrawalObservations.delete(operation);
    if(!immediate||!saved||operation.synchronized!==true||!['screen','withdraw'].includes(action.type))return null;
    if(saved.deposit!==field(action.deposit,true)||saved.wallet!==session.wallet||saved.pxe!==session.wallet.pxe||saved.node!==session.node||saved.cachedNode!==session.wallet.pxe.node)return null;
    const anchor=await balanceAnchor();
    await localGuard();check(session.operationScope()===operation,'ROLLING_CONTEXT_CHANGED');
    if(!same(anchor,saved.anchor))return null;
    if(action.type==='screen')await checkBalanceAnchor(anchor);
    check(session.operationScope()===operation&&saved.wallet===session.wallet&&saved.pxe===session.wallet.pxe&&saved.node===session.node&&saved.cachedNode===session.wallet.pxe.node,'ROLLING_CONTEXT_CHANGED');
    return saved;
  }
  async function collateralInfo(id,board,timestamp){
    const values=await utility(board,'get_deposit_info',[session.owner,id]);
    check(Array.isArray(values)&&values.length===11,'ROLLING_INVALID_RESPONSE');
    const v=values.map(chainValue);check(v[0]===1n&&v[1]===BigInt(id)&&v[2]>0n&&v[2]<(1n<<96n)&&v[3]>0n&&v[3]<(1n<<160n)&&
      v[5]<(1n<<64n)&&v[7]<=v[5]&&v[8]<=v[5]&&v[9]<(1n<<64n)&&v[10]>0n,'ROLLING_INVALID_RESPONSE');
    return {id:field(id,true),depositId:field(String(v[10]),true),amount:String(v[2]),depositor:'0x'+v[3].toString(16).padStart(40,'0'),
      nextAllowedTime:String(v[9]),screenedSequence:String(v[7]),lastRealSequence:String(v[8]),
      eligible:v[7]>=v[8]&&timestamp>=v[9],reason:v[7]<v[8]?'screening-required':timestamp<v[9]?'time-locked':'eligible'};
  }
  async function balanceAnchor(){
    await guard();const header=await session.wallet.pxe.getSyncedBlockHeader();await guard();
    const blockNumber=Number(header.globalVariables.blockNumber),timestamp=chainValue(header.globalVariables.timestamp);
    check(Number.isSafeInteger(blockNumber)&&blockNumber>0,'ROLLING_INVALID_RESPONSE');
    return {blockNumber,blockHash:hashText(await header.hash()),timestamp:String(timestamp)};
  }
  async function checkBalanceAnchor(anchor){
    await guard();
    // Both checks follow the anchored storage read. The local header may wait
    // behind a screening utility in the PXE queue; the canonical RPC need not.
    const observations=await Promise.allSettled([
      ()=>balanceAnchor(),()=>session.node.getBlockData(anchor.blockNumber),
    ].map(read=>Promise.resolve().then(read)));
    const failure=observations.find(value=>value.status==='rejected');if(failure)throw failure.reason;
    const [current,block]=observations.map(value=>value.value);
    check(same(current,anchor),'ROLLING_CONTEXT_CHANGED');
    check(Number(block?.header?.globalVariables?.blockNumber)===anchor.blockNumber&&hashText(block.blockHash)===anchor.blockHash,'ROLLING_CONTEXT_CHANGED');await guard();
  }
  return Object.freeze({
    // Warm the selected deposit's exact native history witnesses while editing.
    // Nothing is retained as authority: Post selects and verifies again.
    async prefetchPostingWitnesses(deposit){return exclusive(async()=>{
      const id=new sdk.Fr(BigInt(field(deposit,true)));await localGuard();
      await screeningArguments(await contract(),id,true);await localGuard();
    });},
    // Readiness and the previous terminal transaction are independent of native
    // synchronization. The journal permit belongs only to this held operation
    // and its exact authenticated bytes; prepare still reauthenticates both.
    async prefetchPostingPolicy(synchronize){
      await localGuard();const scope=getOperationScope();check(scope&&typeof synchronize==='function','ROLLING_CONTEXT_CHANGED');
      const context={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node};
      const fence=async()=>{await localGuard();check(getOperationScope()===scope&&session.wallet===context.wallet&&session.wallet.pxe===context.pxe&&session.node===context.node,'ROLLING_CONTEXT_CHANGED');};
      const slot=deployment.board.artifact.storageLayout?.main_version?.slot;check(slot!==undefined,'ROLLING_ABI_MISMATCH');
      const result=await synchronize(async anchor=>{
        await fence();check(Number.isSafeInteger(anchor?.number)&&anchor.number>0,'ROLLING_INVALID_RESPONSE');const hash=hashText(anchor.hash);
        const value=await measure('action.policy',()=>session.node.getPublicStorageAt({hash},deployment.board.address,new sdk.Fr(BigInt(slot))));
        await fence();const version=chainValue(value);check(version<=0xffffffffn,'ROLLING_INVALID_RESPONSE');return Number(version);
      });
      await fence();check(Number.isSafeInteger(result?.anchor?.number)&&result.anchor.number>0&&Number.isSafeInteger(result.value)&&result.value>=0&&result.value<=0xffffffff,'ROLLING_INVALID_RESPONSE');
      preparedPolicies.set(scope,{...context,number:result.anchor.number,hash:hashText(result.anchor.hash),mainVersion:result.value});
    },
    async prefetchContext({predecessor=false,ordinaryPayment=false,likePayment=false,deferredPayment=false}={}){
      await localGuard();const owner=getOperationScope();
      const results=await Promise.allSettled([
        guard,
        async()=>{
          if(!predecessor||!owner)return;
          const saved=await (await slot()).read();
          if(saved.value&&(terminalHistory(saved.value)||saved.value.status==='cancelled'&&saved.value.predecessor))await session.journal.inspectOutcome();
        },
        async()=>{
          if((!ordinaryPayment&&!likePayment&&!deferredPayment)||!owner)return;
          // Early payment preparation uses public metadata and local class
          // registration, with no private balance utility or action arguments.
          const context={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node};
          const prepared=await measure('action.payment-prefetch',()=>payment(undefined,undefined,{ordinaryProof:ordinaryPayment,likeProof:likePayment,deferredBalance:deferredPayment}));
          await localGuard();check(getOperationScope()===owner&&session.wallet===context.wallet&&session.wallet.pxe===context.pxe&&session.node===context.node,'ROLLING_CONTEXT_CHANGED');
          preparedPayments.set(owner,{phase:'metadata',payment:prepared,...context});
        },
      ].map(read=>Promise.resolve().then(read)));
      const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
      await localGuard();check(getOperationScope()===owner,'ROLLING_CONTEXT_CHANGED');
    },
    async readWithdrawal(){return exclusive(async()=>{await guard();return pendingExitOutcome();});},
    async readBokAccounting({cursor=0}={}){return exclusive(async()=>{
      await ensureBok();check(bok&&readAccountingPage,'ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
      const anchor=await balanceAnchor();
      if(cursor===0){accountingScan={token:crypto.randomUUID(),anchor,offset:0,owned:new Set(),phase:'owned-requests',publicCursor:null,publicCursors:new Set(),revision:null,descriptor:null,lastId:0n,matched:new Map()};completedAccounting=null;}
      else check(typeof cursor==='string'&&accountingScan?.token===cursor&&same(anchor,accountingScan.anchor),'ROLLING_BALANCE_CURSOR_INVALID');
      const scan=accountingScan;scan.token=null;
      try{
        if(scan.phase==='owned-requests'){
          check(scan.offset<=0xffffffff-8,'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          const ids=await utility(await bokContract(),'owned_requests',[session.owner,scan.offset],deployment.bok.artifact);check(Array.isArray(ids)&&ids.length===8,'ROLLING_INVALID_RESPONSE');let ended=false;
          for(const value of ids){const id=field(value);if(id===zero){ended=true;continue;}check(!ended&&!scan.owned.has(id),'ROLLING_INVALID_RESPONSE');scan.owned.add(id);}
          if(ended)scan.phase='public-accounting';else scan.offset+=8;
        }else{
          // Every public page is fetched independently of matches. Owned IDs
          // never leave this closure and never terminate the uniform scan early.
          const page=await readAccountingPage({limit:50,cursor:scan.publicCursor,...(proposedTransactions?{snapshot:{number:anchor.blockNumber,hash:anchor.blockHash}}:{})});
          check(page?.schemaVersion===1&&page.complete===true&&page.checkpoint?.number===anchor.blockNumber&&page.checkpoint?.hash===anchor.blockHash&&typeof page.revision==='string'&&page.revision.length>0&&page.revision.length<=256,'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          const scope=page.scope,b=page.bokScope,instance=deployment.bok.instance;
          check(scope?.chainId===fixed.network.chainId&&scope.rollupVersion===fixed.network.version&&scope.rollupAddress===fixed.network.rollup&&scope.boardAddress===fixed.board&&same(scope.bok,b)&&b?.address===bok.address&&b.operatorAddress===bok.operator&&b.classId===instance?.currentContractClassId.toString()&&b.classId===instance?.originalContractClassId.toString()&&b.deployer===instance?.deployer.toString()&&b.salt===instance?.salt.toString(),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          check(b.deployment&&Number.isSafeInteger(b.deployment.blockNumber)&&b.deployment.blockNumber>0&&b.deployment.blockNumber<=anchor.blockNumber&&/^0x[0-9a-f]{64}$/.test(b.deployment.blockHash)&&/^0x[0-9a-f]{64}$/.test(b.deployment.txHash),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          if(scan.revision===null){scan.revision=page.revision;scan.descriptor=clone(b);}else check(page.revision===scan.revision&&same(b,scan.descriptor),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          check(Array.isArray(page.requests)&&page.requests.length<=50&&(page.nextCursor===null||typeof page.nextCursor==='string'&&/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(page.nextCursor)&&page.nextCursor!==scan.publicCursor),'ROLLING_INVALID_RESPONSE');
          if(page.nextCursor!==null){check(!scan.publicCursors.has(page.nextCursor),'ROLLING_INVALID_RESPONSE');scan.publicCursors.add(page.nextCursor);}
          for(const row of page.requests){
            const id=field(row.requestId,true);check(BigInt(id)>scan.lastId&&['1','2','3','4'].includes(row.state)&&typeof row.sequence==='string'&&/^(0|[1-9][0-9]*)$/.test(row.sequence)&&BigInt(row.sequence)<=0xffffffffn,'ROLLING_INVALID_RESPONSE');scan.lastId=BigInt(id);
            const amounts=['budget','available','reserved','charged','refunded'].map(k=>uint128(row[k]));check(amounts[0]===amounts.slice(1).reduce((a,b)=>a+b,0n),'ROLLING_INVALID_RESPONSE');
            const p=row.position;check(p&&typeof p.blockNumber==='string'&&/^[1-9][0-9]*$/.test(p.blockNumber)&&BigInt(p.blockNumber)<=BigInt(anchor.blockNumber)&&/^0x[0-9a-f]{64}$/.test(p.blockHash)&&/^0x[0-9a-f]{64}$/.test(p.txHash)&&['txIndexWithinBlock','logIndexWithinTx'].every(k=>typeof p[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(p[k])),'ROLLING_INVALID_RESPONSE');
            if(scan.owned.has(id))scan.matched.set(id,{requestId:id,state:row.state,sequence:row.sequence,...Object.fromEntries(['budget','available','reserved','charged','refunded'].map(k=>[k,row[k]]))});
          }
          // A bounded public page can contain only requests that are still
          // proposed. Its cursor advances while checkpointed rows stay hidden.
          scan.publicCursor=page.nextCursor;
          if(page.nextCursor===null){check(scan.matched.size===scan.owned.size,'ROLLING_BOK_ACCOUNTING_INCOMPLETE');scan.phase='complete';}
        }
        await checkBalanceAnchor(anchor);
        if(scan.phase!=='complete'){scan.token=crypto.randomUUID();return {complete:false,phase:scan.phase,anchor,nextCursor:scan.token,requests:[]};}
        const available=String(chainValue(await utility(await bokContract(),'balance_of',[session.owner],deployment.bok.artifact)));await checkBalanceAnchor(anchor);
        uint128(available);const requests=[...scan.matched.values()],totals=Object.fromEntries(['available','reserved','charged','refunded'].map(k=>[k,String(requests.reduce((n,r)=>n+BigInt(r[k]),0n))]));
        completedAccounting={anchor:clone(anchor),requests:clone(requests)};accountingScan=null;
        return {complete:true,phase:'complete',anchor,nextCursor:null,available,requests,totals,refundedMeaning:'already-returned-to-unallocated-balance'};
      }catch(error){accountingScan=null;completedAccounting=null;throw error;}
    });},
    // Internal preparation read: posting eligibility is independent of exit screening.
    async readPostingReadiness(deposit,{count=1}={}){return exclusive(async()=>{
      check(Number.isInteger(count)&&count>=1&&count<=MAX_THREAD_POSTS);
      const id=field(deposit,true),anchor=await balanceAnchor();
      if(count>1){
        const value=chainValue(await utility(await contract(),'get_thread_ready_time',[session.owner,id,count,anchor.timestamp]));
        check(value<(1n<<64n),'ROLLING_INVALID_RESPONSE');await checkBalanceAnchor(anchor);
        return {anchor,nextAllowedTime:String(value),ready:BigInt(anchor.timestamp)>=value};
      }
      const info=await collateralInfo(id,await contract(),BigInt(anchor.timestamp));
      await checkBalanceAnchor(anchor);
      return {anchor,nextAllowedTime:info.nextAllowedTime,ready:BigInt(anchor.timestamp)>=BigInt(info.nextAllowedTime)};
    });},
    async readWithdrawalReadiness(deposit){return exclusive(async()=>{
      const id=field(deposit,true),operation=session.operationScope?.();
      if(operation)withdrawalObservations.delete(operation);
      const anchor=await balanceAnchor(),board=await contract(),context={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node,cachedNode:session.wallet.pxe.node};
      const info=await collateralInfo(id,board,BigInt(anchor.timestamp));
      const needsScreening=BigInt(info.screenedSequence)<BigInt(info.lastRealSequence);
      let readyAt=BigInt(info.nextAllowedTime),screening=null;
      if(needsScreening){
        screening=await screeningArguments(board,id);const [,child]=screening;
        check(child?.note&&BigInt(child.note.sequence)===BigInt(info.screenedSequence)+1n,'ROLLING_HISTORY_UNAVAILABLE');
        if(!child.note.is_dummy){
          const observations=await Promise.allSettled(['post_exists','post_flag_deadline'].map(async name=>{
            const base=deployment.board.artifact.storageLayout?.[name]?.slot;check(base!==undefined,'ROLLING_ABI_MISMATCH');
            const slot=await sdk.deriveStorageSlotInMap(new sdk.Fr(BigInt(base)),new sdk.Fr(BigInt(child.note.post_id)));
            return chainValue(await session.node.getPublicStorageAt({hash:anchor.blockHash},deployment.board.address,slot));
          }));
          const failure=observations.find(value=>value.status==='rejected');if(failure)throw failure.reason;
          const values=observations.map(value=>value.value);
          check(values[0]===1n&&values[1]>0n&&values[1]<(1n<<64n),'ROLLING_INVALID_RESPONSE');
          if(values[1]>readyAt)readyAt=values[1];
        }
      }
      await checkBalanceAnchor(anchor);
      if(operation?.synchronized===true){
        check(session.operationScope()===operation&&context.wallet===session.wallet&&context.pxe===session.wallet.pxe&&context.node===session.node&&context.cachedNode===session.wallet.pxe.node,'ROLLING_CONTEXT_CHANGED');
        withdrawalObservations.set(operation,{operation,deposit:id,anchor:clone(anchor),info:clone(info),screening,...context});
      }
      return {anchor,screenedSequence:info.screenedSequence,needsScreening,readyAt:String(readyAt)};
    });},
    async readBalances({cursor=0,includeBok=false}={}){return exclusive(async()=>{
      check(typeof includeBok==='boolean');if(includeBok)await ensureBok();
      const continuation=balanceContinuation;check(cursor===0||typeof cursor==='string'&&continuation?.token===cursor,'ROLLING_BALANCE_CURSOR_INVALID');
      const offset=cursor===0?0:continuation.offset;check(offset<=0xffffffff-10);const anchor=await balanceAnchor(),board=await contract();
      if(cursor!==0)check(same(anchor,continuation.anchor),'ROLLING_BALANCE_CURSOR_INVALID');
      const ids=await utility(board,'get_deposit_ids',[session.owner,offset]);check(Array.isArray(ids)&&ids.length===10,'ROLLING_INVALID_RESPONSE');
      const deposits=[],seen=new Set();let empty=false;
      for(const value of ids){const id=field(value);if(BigInt(id)===0n){empty=true;continue;}check(!empty&&!seen.has(id),'ROLLING_INVALID_RESPONSE');seen.add(id);deposits.push(await collateralInfo(id,board,BigInt(anchor.timestamp)));}
      const fee=await privateFeeAvailable();
      let credit=null;if(includeBok&&bok){const current=await bokContract(),available=chainValue(await utility(current,'balance_of',[session.owner],deployment.bok.artifact));check(available<(1n<<128n),'ROLLING_INVALID_RESPONSE');
        credit={available:String(available),token:'USDC',availableMeaning:'unallocated-private-credit',requestsComplete:false,requests:[]};

      }
      const pending=(await (await slot()).read()).value;
      const reservation=pending&&['submitting','unknown'].includes(pending.status)?{status:'unresolved',maximumFee:pending.maximumFee}:null;
      await checkBalanceAnchor(anchor);balanceContinuation=empty?null:{token:crypto.randomUUID(),offset:offset+10,anchor:clone(anchor)};return {anchor,fee:{available:String(fee),token:'FEE',complete:true,availableMeaning:proposedTransactions?'included-private-credit':'settled-private-credit',pendingReservation:reservation,withdrawal:'not-supported'},bok:credit,
        collateral:{deposits,complete:empty,nextCursor:balanceContinuation?.token??null}};
    });},
    async readModeratorStatus(){return exclusive(moderatorStatus);},
    // Display only: the next action still verifies payment readiness itself.
    async readPrivateFeeCredit(){return exclusive(async()=>{
      const anchor=await balanceAnchor();
      const available=await privateFeeAvailable();await checkBalanceAnchor(anchor);
      return {availableCredit:String(available),anchor};
    });},
    async readBokStatus(){return exclusive(async()=>{await ensureBok();if(!bok)return {available:false};try{return {available:true,availableCredit:String(await bokCredit()),pluginId:bok.pluginId};}catch(error){if(error?.code==='ROLLING_BOK_UNAVAILABLE')return {available:false};throw error;}});},
    async readFundingState(options){
      const beforeSync=options!==undefined;
      if(beforeSync)check(exactData(options,['beforeSync']).beforeSync===true,'ROLLING_INVALID_ACTION');
      if(!session)return {status:'locked'};return exclusive(()=>fundingWorkflowState(beforeSync));
    },
    async readAccountStatus(options){
      const opening=options!==undefined;
      if(opening)check(exactData(options,['opening']).opening===true,'ROLLING_INVALID_ACTION');
      if(!session)return {status:'locked'};
      return exclusive(()=>measure('account.status',async()=>{const workflow=await measure('account.status.workflow',()=>fundingWorkflowState(false,true));if(workflow.status==='recovering')return {...workflow,pendingWithdrawal:await pendingExitSummary()};
        const operation=getOperationScope(),context={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node};
        await localGuard();
        const checkContext=async()=>{
          await localGuard();
          check(getOperationScope()===operation&&session.wallet===context.wallet&&context.wallet.pxe===context.pxe&&session.node===context.node,'ROLLING_CONTEXT_CHANGED');
        };
        const synchronized=operation?.synchronized===true;
        // Both status utilities require these exact current classes and native
        // owner records. Raw callers use the same barrier; the public wrapper
        // still owns fresh synchronization before opening this account view.
        const readiness=Promise.resolve().then(async()=>{
          await measure('account.status.discovery-queued',()=>context.pxe.prepareBoardActionState({owner:session.owner,board:deployment.board.address,privateFee:deployment.privateFee.address,method:'get_deposit_ids'}));
          await checkContext();if(synchronized)check(operation.synchronized===true,'ROLLING_CONTEXT_CHANGED');
        });
        const readIds=async()=>{
          await readiness;await checkContext();
          const ids=await measure('account.status.deposit-ids-queued',async()=>utility(await contract(),'get_deposit_ids',[session.owner,0]));check(Array.isArray(ids)&&ids.length===10,'ROLLING_INVALID_RESPONSE');return ids;
        };
        const readCredit=async()=>{
          await readiness;await checkContext();
          const available=await privateFeeAvailable();await checkContext();return available;
        };
        // Only balance and collateral are needed here. Fee prices, gas limits,
        // payment methods and refunds are prepared by the actual action.
        const reads=await Promise.allSettled([
          readIds,pendingExitSummary,readCredit,
        ].map(read=>Promise.resolve().then(read)));
        // Keep collateral, pending-exit, then fee failure priority after draining.
        for(const result of reads.slice(0,2))if(result.status==='rejected')throw result.reason;
        await localGuard();
        check(getOperationScope()===operation&&session.wallet===context.wallet&&session.wallet.pxe===context.pxe&&session.node===context.node,'ROLLING_CONTEXT_CHANGED');
        const ids=reads[0].value,pendingWithdrawal=reads[1].value;
        const emptyOpening=opening&&operation?.synchronized===true&&!pendingWithdrawal&&ids.every(id=>BigInt(id)===0n);
        // Failed native/class/network reads never mean zero credit. Zero is a
        // successfully decoded u128; all failed reads remain errors after drain.
        if(reads[2].status==='rejected')throw reads[2].reason;
        const available=reads[2].value;
        if(available===0n&&!emptyOpening)return {status:'fee-needed',depositIds:ids.filter(id=>BigInt(id)!==0n),pendingWithdrawal};
        if(emptyOpening)return {status:'collateral-pending',depositIds:[],pendingWithdrawal:null,postEligibility:'requires-action-simulation'};
        return {status:ids.some(id=>BigInt(id)!==0n)?'fee-ready':'collateral-pending',privateFeeCredit:String(available),
          depositIds:ids.filter(id=>BigInt(id)!==0n),pendingWithdrawal,postEligibility:'requires-action-simulation'};
      }));
    },
    async readProfile({name}={}){return exclusive(async()=>{
      await guard();const id=field(name,true),record=await utility(await contract(),'profile_state',[id]);
      let bioVersion,avatarVersion;
      try{check([record.bio_version,record.avatar_version].every(value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)),'ROLLING_INVALID_RESPONSE');
        bioVersion=BigInt(record.bio_version);avatarVersion=BigInt(record.avatar_version);
        check(bioVersion>=0n&&bioVersion<=0xffffffffn&&avatarVersion>=0n&&avatarVersion<=0xffffffffn,'ROLLING_INVALID_RESPONSE');
      }catch{throw fail('ROLLING_INVALID_RESPONSE');}
      await guard();return {name:id,bioVersion:String(bioVersion),avatarVersion:String(avatarVersion)};
    });},
    async ownedIdentities({cursor=0}={}){return exclusive(async()=>{await guard();check(Number.isInteger(cursor)&&cursor>=0&&cursor<=0xffffffff-8);
      const values=await utility(await contract(),'owned_name_records',[session.owner,cursor]);check(Array.isArray(values)&&values.length===8,'ROLLING_INVALID_RESPONSE');
      const records=[],seen=new Set();let empty=false;
      try{for(const value of values){
        check(value&&Object.keys(value).sort().join()===['name_id','schema','first_length','first','last_length','last'].sort().join(),'ROLLING_INVALID_RESPONSE');
        const id=field(value.name_id),schema=Number(BigInt(value.schema)),firstLength=Number(BigInt(value.first_length)),lastLength=Number(BigInt(value.last_length));
        if(id===zero){
          check(schema===0&&firstLength===0&&lastLength===0&&[value.first,value.last].every(words=>Array.isArray(words)&&words.length===2&&words.every(word=>word===zero)),'ROLLING_INVALID_RESPONSE');empty=true;continue;
        }
        check(!empty&&schema===1&&!seen.has(id),'ROLLING_INVALID_RESPONSE');
        const first=component(value.first,firstLength),last=component(value.last,lastLength),registration=nameRegistration(first,last);
        check(registration.name.first===first&&registration.name.last===last,'ROLLING_INVALID_RESPONSE');
        const expected=await sdk.poseidon2HashWithSeparator(registration.preimage.map(n=>new sdk.Fr(n)),NAME_DOMAIN);
        check(field(expected.toString(),true)===id,'ROLLING_INVALID_RESPONSE');seen.add(id);records.push({id,first,last});
      }}catch{throw fail('ROLLING_INVALID_RESPONSE');}
      await guard();return {identities:records.map(record=>record.id),records,nextCursor:empty?null:cursor+8};});},
    async prepare(input,options){
      if(input?.type==='like')input=capturePaidLikeAction(input);
      // Bind the operation and its discovery barrier before exclusive/guards or
      // predecessor reads can yield to a replacement operation.
      const externalScope=typeof session?.operationScope==='function';
      const capturedOwner=externalScope?getOperationScope():null,capturedReady=capturedOwner?.contractStateReady;
      return exclusive(async()=>{
      // Standalone applications allocate their local scope inside exclusive.
      const stateOwner=externalScope?capturedOwner:getOperationScope(),stateReady=externalScope?capturedReady:stateOwner?.contractStateReady;
      const immediate=options!==undefined;let postingRules;
      if(immediate){
        const values=exactData(options,Object.hasOwn(options??{},'postingRules')?['immediate','postingRules']:['immediate']);
        check(values.immediate===true&&['post','reply','quote','repost','thread','bok','like','name','bio','avatar','claim-deposit','claim-private-fee','claim-bok','screen','withdraw','subboard','moderate-post','moderate-avatar','reject-subboard','set-main-policy','transfer-moderator','withdraw-bok','cancel-deposit','cancel-bok-request','expire-bok-request'].includes(input?.type));
        if(Object.hasOwn(values,'postingRules')){
          check(['post','reply','quote','repost','thread','bok'].includes(input?.type));
          postingRules=exactData(values.postingRules,['chainId','rollupVersion','boardAddress','subboard','parentVersion','localVersion']);
          for(const key of ['parentVersion','localVersion'])check(typeof postingRules[key]==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(postingRules[key])&&BigInt(postingRules[key])<=0xffffffffn);
          check(postingRules.chainId===scope.chainId&&postingRules.rollupVersion===scope.version&&postingRules.boardAddress===fixed.board&&field(postingRules.subboard)===field(input.subboard??'0'),'ROLLING_POSTING_RULES_CHANGED');
        }
      }
      const captured=input?.type==='thread'?captureThreadAction(input):input;
      await guard();const action=clone(captured),withdrawalObservation=await takeWithdrawalObservation(action,immediate);
      const earlyScope=immediate&&['post','reply','quote','repost'].includes(action.type)&&field(action.subboard??'0')===zero
        ?getOperationScope():null;
      const policyOwner=earlyScope?.synchronized===true?{scope:earlyScope,wallet:session.wallet,pxe:session.wallet.pxe,node:session.node}:null;
      const checkPolicyOwner=()=>check(getOperationScope()===policyOwner.scope&&session.wallet===policyOwner.wallet&&
        session.wallet.pxe===policyOwner.pxe&&session.node===policyOwner.node,'ROLLING_CONTEXT_CHANGED');
      const readPredecessor=async()=>{
        const store=await slot();let prior=await store.read();
        if(prior.value&&prior.value.status!=='cancelled'){check(usableStatus(prior.value.status),'ROLLING_RECOVERY_REQUIRED');
          const final=await outcome(prior,{history:true});check(usableStatus(final.status),'ROLLING_RECOVERY_REQUIRED');prior=await store.read();}
        // A cancelled unsent draft still acknowledges its prior confirmed transaction.
        if(prior.value?.status==='cancelled'&&prior.value.predecessor)await acknowledge(await session.journal.inspectOutcome({reuse:true}),prior.value.predecessor);
        const previousTx=await session.journal.assertCanStart();
        return {store,prior,predecessor:previousTx?.value?{operation:previousTx.value.operation??null,txHash:previousTx.value.txHash}:null};
      };
      let history,earlyPolicy;
      if(policyOwner){
        // These independent reads share this synchronized operation. Drain both
        // before any failure can release its lease or before writing an intent.
        const reads=await Promise.allSettled([
          measure('action.predecessor',readPredecessor),
          (async()=>{const board=await contract(),anchor=await balanceAnchor();checkPolicyOwner();
            const prepared=preparedPolicies.get(policyOwner.scope);preparedPolicies.delete(policyOwner.scope);
            let policy;
            if(prepared){check(prepared.wallet===policyOwner.wallet&&prepared.pxe===policyOwner.pxe&&prepared.node===policyOwner.node&&prepared.number===anchor.blockNumber&&prepared.hash===anchor.blockHash,'ROLLING_CONTEXT_CHANGED');policy={mainVersion:prepared.mainVersion,localVersion:0};}
            else policy=await measure('action.policy',()=>postingPolicy(board,zero,anchor));
            checkPolicyOwner();return {board,anchor,policy};})(),
        ]);
        const failure=reads.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        checkPolicyOwner();[history,earlyPolicy]=reads.map(value=>value.value);
      }else history=await measure('action.predecessor',readPredecessor);
      if(immediate&&['post','reply','quote','repost','thread','like','name','bio','avatar','subboard'].includes(action.type)){
        if(stateReady)await stateReady;
        await localGuard();check(getOperationScope()===stateOwner&&stateOwner?.contractStateReady===stateReady,'ROLLING_CONTEXT_CHANGED');
      }
      const {store,prior,predecessor}=history;
      const nonce=field(sdk.Fr.random().toString(),true),id=field(sdk.Fr.random().toString(),true),board=earlyPolicy?.board??await contract();
      const allowed=keys[action?.type];check(allowed&&Object.keys(action).every(key=>key==='type'||allowed.includes(key)));
      if(['bok','claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(action.type)||action.type==='claim-deposit'&&action.bokReceipt!==undefined){await ensureBok({bind:immediate&&action.type==='bok'});check(bok,'ROLLING_BOK_UNAVAILABLE');}
      let moderation=null;
      const ordinaryPreparation=['post','reply','quote','repost'].includes(action.type);
      const genericPreparation=['thread','like','name','bio','avatar','subboard','screen','withdraw','withdraw-bok','cancel-bok-request','expire-bok-request',...moderationTypes].includes(action.type);
      // Start independent fee metadata alongside posting reads. Both private
      // utilities still run through the native PXE queue at this flow's anchor.
      const paymentScope=immediate&&(ordinaryPreparation||genericPreparation||action.type==='bok')
        ?session.operationScope?.():null;
      const paymentOwner=paymentScope&&{wallet:session.wallet,pxe:session.wallet.pxe,node:session.node};
      const moderationCachedNode=paymentOwner?.pxe.node;
      const moderationAnchor=paymentScope?.synchronized===true&&moderationTypes.has(action.type)?await balanceAnchor():undefined;
      let args,preparedPayment,preparedNameAvailability,preparedFundingBok;
      const claimScope=immediate&&['claim-deposit','claim-private-fee','claim-bok'].includes(action.type)?session.operationScope?.():null;
      const claimOwner=claimScope?.synchronized===true?{wallet:session.wallet,pxe:session.wallet.pxe,node:session.node,cachedNode:session.wallet.pxe.node}:null;
      const claimFields={};
      const checkClaimOwner=()=>check(session.operationScope()===claimScope&&session.wallet===claimOwner.wallet&&
        session.wallet.pxe===claimOwner.pxe&&session.node===claimOwner.node&&session.wallet.pxe.node===claimOwner.cachedNode,'ROLLING_CONTEXT_CHANGED');
      const checkPaymentOwner=()=>check(session.operationScope()===paymentScope&&session.wallet===paymentOwner.wallet&&
        session.wallet.pxe===paymentOwner.pxe&&session.node===paymentOwner.node,'ROLLING_CONTEXT_CHANGED');
      if(claimOwner){
        // Each receipt is independently bound to this operation's native anchor.
        // Drain every validation before saving any claim or unsigned intent.
        checkClaimOwner();
        shareAggregateClaim(action);
        const values=await Promise.allSettled([
          ()=>measure('action.arguments',()=>argumentsFor(action,board,nonce)),
          ()=>action.type==='claim-deposit'&&action.bokReceipt!==undefined?bokFundingClaim(action):undefined,
          ()=>action.type==='claim-private-fee'||action.feeReceipt!==undefined?payment(action,claimFields):undefined,
          ()=>action.type==='claim-deposit'?measure('action.claim-witnesses',()=>sdk.prefetchBoardClaimWitnesses({wallet:session.wallet,node:session.node,board:deployment.board.instance,artifact:deployment.board.artifact})):undefined,
          ()=>action.type==='claim-bok'||action.type==='claim-deposit'&&action.bokReceipt!==undefined?measure(action.type==='claim-bok'?'action.claim-witnesses':'action.bok-claim-witnesses',()=>sdk.prefetchBokClaimWitnesses({wallet:session.wallet,node:session.node,bok:deployment.bok.instance,artifact:deployment.bok.artifact,owner:session.owner})):undefined,
        ].map(read=>Promise.resolve().then(read)));
        const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        await guard();checkClaimOwner();
        args=plain(values[0].value);preparedFundingBok=values[1].value;preparedPayment=values[2].value;
      }else if(paymentScope&&action.type!=='withdraw-bok'){
        // Capture this operation's local anchor before either private utility
        // enters the native PXE queue. The public policy read can then overlap
        // screening and fee-note work; its final canonical/local fences remain.
        const postingAnchor=(ordinaryPreparation||action.type==='thread'||action.type==='bok')?(earlyPolicy?.anchor??(field(action.subboard??'0')===zero?await balanceAnchor():undefined)):undefined;
        checkPaymentOwner();
        const earlier=preparedPayments.get(paymentScope);preparedPayments.delete(paymentScope);
        const deferredBalance=ordinaryPreparation||['like','name','bio','avatar','subboard'].includes(action.type);
        const earlyMode=deferredBalance?'deferred-balance':undefined;
        const earlyPayment=earlyMode&&earlier?.phase==='metadata'&&earlier.payment.creditCheck===earlyMode&&earlier.wallet===session.wallet&&earlier.pxe===session.wallet.pxe&&earlier.node===session.node?earlier.payment:null;
        const values=await Promise.allSettled([
          ()=>measure('action.arguments',async()=>{if(moderationTypes.has(action.type)){moderation=await moderationArguments(action,board);return moderation.args;}return argumentsFor(action,board,nonce,{atomicBok:action.type==='bok',postingAnchor,preparedPolicy:earlyPolicy?.policy,withdrawalObservation});}),
          async()=>{
            const prepared=earlyPayment??await measure('action.payment-prefetch',()=>payment(action,undefined,{ordinaryProof:ordinaryPreparation,likeProof:['like'].includes(action.type)}));
            if(!deferredBalance||!earlyPayment)return prepared;
            // Native record discovery has completed at this operation's anchor.
            // Read credit now; only public metadata overlapped synchronization.
            checkPaymentOwner();check(prepared.creditCheck==='deferred-balance'&&typeof prepared.withAvailableCredit==='function','ROLLING_CONTEXT_CHANGED');
            const funded=await prepared.withAvailableCredit(action.type==='like'?await paidLikeArguments(action):undefined);await guard();checkPaymentOwner();
            check(funded.creditCheck==='read-balance','ROLLING_CONTEXT_CHANGED');return funded;
          },
          ...(action.type==='name'?[()=>nameAvailability(action)]:[]),
        ].map(read=>Promise.resolve().then(read)));
        const failure=values.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        await guard();checkPaymentOwner();
        args=plain(values[0].value);preparedPayment=values[1].value;preparedNameAvailability=values[2]?.value;
      }else {moderation=moderationTypes.has(action.type)?await moderationArguments(action,board):null;args=moderation?moderation.args:plain(await measure('action.arguments',()=>argumentsFor(action,board,nonce,{atomicBok:immediate&&action.type==='bok'})));}
      // Match the rules actually displayed to this exact canonical preparation.
      // A mismatch must fail before creating an unsigned intent or estimating.
      if(postingRules){const drafts=action.type==='thread'?args[2].slice(0,args[3]):[args[2]];check(drafts.every(draft=>String(draft.expected_main_policy_version)===postingRules.parentVersion&&String(draft.expected_local_policy_version)===postingRules.localVersion),'ROLLING_POSTING_RULES_CHANGED');}
      const record={version:1,id,action,args,method:methods[action.type],nonce,predecessor,status:'prepared',...(moderation?{moderation:moderation.review}:{})};
      if(claimFields.fundingFee)record.fundingFee=claimFields.fundingFee;
      if(action.type==='name')record.nameAvailability=preparedNameAvailability??await nameAvailability(action);
      if(['withdraw','withdraw-bok','cancel-deposit'].includes(action.type)){const pending=await pendingExit();check(!pending.value||pending.value.paymentStatus==='refunded','ROLLING_WITHDRAWAL_PENDING');if(pending.value){check(verifyWithdrawal&&await verifyWithdrawal(pending.value),'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');await localGuard();check(await (await pendingExitSlot()).isCurrent(pending.encoded),'ROLLING_CONTEXT_CHANGED');}}
      if(action.type==='withdraw'){const anchor=await balanceAnchor();record.withdrawal=withdrawalObservation&&same(anchor,withdrawalObservation.anchor)?clone(withdrawalObservation.info):await collateralInfo(action.deposit,board,BigInt(anchor.timestamp));check(record.withdrawal.eligible,'ROLLING_WITHDRAWAL_NOT_READY');await checkBalanceAnchor(anchor);}
      if(action.type==='cancel-deposit'){
        record.withdrawal={kind:'cancelled-collateral',depositor:action.receipt.sender,amount:action.receipt.amount,depositId:action.receipt.depositId,eligible:true};
      }
      if(action.type==='withdraw-bok'){
        check(resolveBokWithdrawal,'ROLLING_BOK_UNAVAILABLE');const anchor=await balanceAnchor();
        // Fee metadata joins the existing native-credit/portal wave, rather
        // than delaying that wave. All reads drain inside this owned anchor.
        const reads=await Promise.allSettled([
          async()=>chainValue(await utility(await bokContract(),'balance_of',[session.owner],deployment.bok.artifact)),()=>resolveBokWithdrawal(),
          ...(paymentScope?[()=>measure('action.payment-prefetch',()=>payment(action))]:[]),
        ].map(read=>Promise.resolve().then(read)));
        const failure=reads.find(value=>value.status==='rejected');if(failure)throw failure.reason;
        const [available,scope,fee]=reads.map(value=>value.value);
        if(paymentScope){checkPaymentOwner();preparedPayment=fee;}
        check(available>=uint128(action.amount),'ROLLING_BOK_CREDIT_INSUFFICIENT');check(scope.recipient===bok.address,'ROLLING_CONTEXT_CHANGED');
        record.withdrawal={kind:'bok',amount:action.amount,depositor:action.recipient,nonce,eligible:true,bokScope:clone(scope)};await checkBalanceAnchor(anchor);
      }
      if(action.type==='claim-deposit'&&action.bokReceipt!==undefined)record.fundingBok=preparedFundingBok??await bokFundingClaim(action);
      if(action.type==='claim-bok')record.fundingBok={scope:clone(bok),args:clone(args)};
      // Expiry selection is private and owned; the contract simulation, not the
      // public accounting snapshot or browser clock, decides deadline eligibility.
      if(['cancel-bok-request','expire-bok-request'].includes(action.type))record.bokRequestScope=clone(bok);
      if(action.type==='thread'&&action.budgets?.some(value=>value!=='0')){
        await ensureBok({bind:true});check(bok,'ROLLING_BOK_UNAVAILABLE');
        const requests=[];
        for(let i=0;i<action.contents.length;i++){
          const budget=action.budgets[i];if(budget==='0')continue;
          const requestId=field(sdk.Fr.random().toString(),true),target=await bokInvocationTarget(args[2][i],args[1][i],action.contents[i]);
          requests.push({index:i,requestId,target,budget});args[5][i]=bok.pluginId;args[6][i]=requestId;
        }
        if(!immediate)check(await bokCredit()>=requests.reduce((sum,request)=>sum+BigInt(request.budget),0n),'ROLLING_BOK_CREDIT_INSUFFICIENT');
        record.threadBok={scope:clone(bok),requests};
      }
      if(action.type==='bok'){
        const budget=uint128(action.budget);check(budget>0n);
        const available=immediate?null:await bokCredit();if(available!==null)check(available>=budget,'ROLLING_BOK_CREDIT_INSUFFICIENT');
        const draft=args[2],requestId=field(sdk.Fr.random().toString(),true);
        const target=await bokInvocationTarget(draft,nonce,action.content);
        record.bok={scope:clone(bok),phase:'authorize',requestId,target,budget:String(budget),availableCredit:available===null?null:String(available),postArgs:args};
        record.args=[requestId,target,String(budget)];
        if(immediate){record.bok.phase='atomic';record.method='post_with_bok';record.args=[...args,bok.pluginId,requestId];}
      }
      const selected=await interaction(await selectedContract(record),record);record.encoded=selected.encoded;
      // Immediate actions use the application's configured ceiling. Submission
      // estimates once against current state and must stay within this bound.
      if(immediate){
        // Claim validation retains its exact bridge fee payload even when the
        // separate review simulation is omitted. Submission rechecks it.
        if(!claimOwner&&(action.type==='claim-private-fee'||action.feeReceipt!==undefined))preparedPayment=await payment(action,record);
        record.maximumFee=(ordinaryPost(record)?sdk.ordinaryPostFeeBudget({wallet:session.wallet,prepared:preparedPayment??await payment(action,record,{ordinaryProof:true}),board:ordinaryPost(record)}).maximumFee:qualifiedLike(record)?sdk.likeFeeBudget({wallet:session.wallet,prepared:preparedPayment??await payment(action,record,{likeProof:true}),board:qualifiedLike(record)}).maximumFee:sdk.normalizePrivateFeeGasSettings(fixed.gas).maximumFee).toString();
      }
      else {progress('estimating');const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(action,record),from:session.owner,guard});record.maximumFee=estimated.maximumFee.toString();}await guard();
      if(withdrawalObservation){
        const currentAnchor=await balanceAnchor(),observed=withdrawalObservation;
        check(session.operationScope()===observed.operation&&observed.operation.synchronized===true&&session.wallet===observed.wallet&&session.wallet.pxe===observed.pxe&&session.node===observed.node&&session.wallet.pxe.node===observed.cachedNode&&same(currentAnchor,observed.anchor),'ROLLING_CONTEXT_CHANGED');
      }
      if(paymentScope&&['withdraw-bok','cancel-bok-request','expire-bok-request'].includes(action.type))checkPaymentOwner();
      if(claimOwner)checkClaimOwner();
      if(moderationAnchor){
        checkPaymentOwner();check(paymentScope.synchronized===true&&same(await balanceAnchor(),moderationAnchor),'ROLLING_CONTEXT_CHANGED');checkPaymentOwner();check(session.wallet.pxe.node===moderationCachedNode,'ROLLING_CONTEXT_CHANGED');
      }
      const saved=await store.write(prior,record);
      // No persistent cache: only the unchanged journal record in the same held
      // operation may use this result. Separate submissions prepare afresh.
      if(paymentScope&&session.operationScope()===paymentScope)preparedPayments.set(paymentScope,{encoded:saved.encoded,payment:preparedPayment,...paymentOwner,
        ...(moderationAnchor&&moderation?{moderationReady:{anchor:moderationAnchor,cachedNode:moderationCachedNode}}:{})});
      const claimPaymentScope=immediate&&['claim-deposit','claim-private-fee','claim-bok'].includes(action.type)&&record.fundingFee?session.operationScope?.():null;
      if(claimPaymentScope?.synchronized===true)preparedPayments.set(claimPaymentScope,{encoded:saved.encoded,payment:preparedPayment,wallet:session.wallet,pxe:session.wallet.pxe,node:session.node,claim:true});
      return summary(record);
    });},
    async prepareBokRelease(id,input){return exclusive(async()=>{
      const {type}=exactData(input,['type']);check(['cancel-bok-request','expire-bok-request'].includes(type),'ROLLING_INVALID_ACTION');
      await guard();let saved=await savedIntent(id);const final=await outcome(saved);
      check(['authorized','bok-post-reverted','bok-release-reverted'].includes(final.status),'ROLLING_RECOVERY_REQUIRED');
      saved=await savedIntent(id);const source=clone(saved.value.bokReleaseSource??saved.value),prior=clone(saved.value);delete prior.bokReleasePrior;
      await checkBokRelease(source,type);await session.journal.assertCanStart();
      const record={version:1,id:field(sdk.Fr.random().toString(),true),action:{type,requestId:source.bok.requestId},
        args:[source.bok.requestId],method:methods[type],nonce:field(sdk.Fr.random().toString(),true),status:'prepared',
        predecessor:{operation:operation(saved.value.id),txHash:saved.value.txHash},bokRequestScope:clone(bok),bokReleaseSource:source,bokReleasePrior:prior};
      const selected=await interaction(await bokContract(),record);record.encoded=selected.encoded;
      progress('estimating');const estimate=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(),from:session.owner,guard});record.maximumFee=estimate.maximumFee.toString();
      await checkBokRelease(source,type);await (await slot()).write(saved,record);return summary(record);
    });},
    async prepareBokPost(id,options){return exclusive(async()=>{
      const immediate=options!==undefined;if(immediate)check(options&&Object.keys(options).length===1&&options.immediate===true);
      await guard();let saved=await savedIntent(id);check(['authorize','post'].includes(saved.value.bok?.phase),'ROLLING_RECOVERY_UNSUPPORTED');
      const previousPhase=saved.value.bok.phase,authorized=await outcome(saved);
      check(authorized.status===(previousPhase==='authorize'?'authorized':'bok-post-reverted'),'ROLLING_RECOVERY_REQUIRED');saved=await savedIntent(id);
      await waitingBok(saved.value);await session.journal.assertCanStart();
      const prior=saved.value,postArgs=plain(await argumentsFor(prior.action,await contract(),prior.nonce));
      // Renew only public policy versions and screening hints. The funded target's
      // deposit, nonce and every immutable post field remain the authorized draft.
      check(same(postArgs.slice(0,2),prior.bok.postArgs.slice(0,2))&&
        ['subboard','parent','root_reference','kind','name_id','reference','message','length'].every(key=>same(postArgs[2][key],prior.bok.postArgs[2][key])),'ROLLING_INTENT_CHANGED');
      // Old confirmed authorizations remain immutable. Refuse an incompatible
      // target before estimating; the existing explicit release flow can recover it.
      check(await bokInvocationTarget(postArgs[2],prior.nonce,prior.action.content)===prior.bok.target,'ROLLING_INTENT_CHANGED');
      const record={...prior,id:field(sdk.Fr.random().toString(),true),method:'post_with_bok',args:[...postArgs,bok.pluginId,prior.bok.requestId],
        status:'prepared',txHash:null,encoded:undefined,predecessor:{operation:operation(prior.id),txHash:prior.txHash},
        bok:{...prior.bok,phase:'post',authorizationTxHash:prior.bok.authorizationTxHash??prior.txHash}};
      // This is a new intent with the confirmed authorization as predecessor.
      // Its proof attempt must not inherit authority bound to the previous ID.
      delete record.preproof;delete record.preproofReview;
      const selected=await interaction(await contract(),record);record.encoded=selected.encoded;
      if(immediate)record.maximumFee=sdk.normalizePrivateFeeGasSettings(fixed.gas).maximumFee.toString();
      else {progress('estimating');const estimate=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(),from:session.owner,guard});record.maximumFee=estimate.maximumFee.toString();}
      await waitingBok(record);await guard();await (await slot()).write(saved,record);return summary(record);
    });},
    // Explicit saved-action recovery. Inspection never writes financial records;
    // Original revision/action/nonce remain immutable; a changed head is unresolved,
    // not silently rebased. Exact-byte recovery is separately user-confirmed and
    // never re-estimates or re-proves. Caller retains its wallet lease throughout.
    async inspectRecovery(id){return exclusive(async()=>{await guard();return recoverySnapshot(await savedIntent(id));});},
    async resumeSaved(id,input){
      let expectedTxHash;try{({expectedTxHash}=exactData(input,['expectedTxHash']));}catch{throw fail('ROLLING_INVALID_ACTION');}
      check(typeof expectedTxHash==='string'&&/^0x[0-9a-f]{64}$/.test(expectedTxHash));
      return exclusive(async()=>{
        await guard();const saved=await savedIntent(id),record=saved.value;
        check(!['prepared','cancelled','replacement-prepared'].includes(record.status),'ROLLING_RECOVERY_REQUIRED');
        const current=await session.journal.inspect();
        check(current?.operation===operation(id)&&current.txHash===expectedTxHash,'ROLLING_RECOVERY_REQUIRED');
        // Canonical current attempts can reconcile even when their own effect
        // advanced the head. Pending/unknown states never authorize a broadcast.
        const inspected=await session.journal.inspectSavedRecovery(operation(id),expectedTxHash);
        if(inspected.status==='canonical'){await guard();return outcome(saved);}
        check(inspected.status==='resumable','ROLLING_RECOVERY_REQUIRED');
        await checkSavedResumeContext(saved,expectedTxHash);
        await session.journal.recover({expectedOperation:operation(id),expectedTxHash,beforeSubmit:async hash=>{
          check(hash===expectedTxHash,'ROLLING_RECOVERY_REQUIRED');
          await checkSavedResumeContext(saved,expectedTxHash);
        }});
        await guard();check((await savedIntent(id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();
        return outcome(saved);
      });
    },
    async prepareInterrupted(id){return exclusive(async()=>{
      await guard();const saved=await savedIntent(id),local=await preproofAvailable(saved);
      const aggregateRenewal=!local&&await preproofAvailable(saved,true);check(local||aggregateRenewal,'ROLLING_RECOVERY_REQUIRED');
      const epoch=await privateStore.readRecoveryEpoch(),record=clone(saved.value);await session.wallet.pxe.sync();await checkActionSubmission(record);await checkActionRecoveryContext(record);
      const selected=await interaction(await selectedContract(record),record);progress('estimating');
      const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(record.action,record),from:session.owner,guard});

      check(await preproofAvailable(saved,aggregateRenewal)&&await privateStore.readRecoveryEpoch()===epoch,'ROLLING_RECOVERY_REQUIRED');await guard();
      // Exact CAS revokes the old attempt. A late proof must fail its lifecycle
      // guard before journal.prepare, and again before any broadcast.
      // Aggregate renewal consumes the same original FPC bridge in setup in
      // either native fee mode. Its one-time nullifier prevents two canonical
      // charges even if an older unknown attempt reached application execution.
      // Fresh custody/receipt/witness verification and simulation above remain
      // mandatory; a spent bridge must never fall back to balance-only fees.
      const next={...record,status:'prepared',maximumFee:estimated.maximumFee.toString(),preproofReview:{...record.preproof,epoch},
        ...(aggregateRenewal?{preproofHistory:[...(record.preproofHistory??[]),record.preproof]}:{})};delete next.preproof;
      await (await slot()).write(saved,next);return summary(next);
    });},
    async prepareReplacement(id,input){
      // Capture only own data primitives before any asynchronous guard or RPC.
      let reviewInput;try{reviewInput=exactData(input,['expectedTxHash']);}catch{throw fail('ROLLING_INVALID_ACTION');}
      check(typeof reviewInput.expectedTxHash==='string'&&/^0x[0-9a-f]{64}$/.test(reviewInput.expectedTxHash));
      return exclusive(async()=>{await guard();const saved=await savedIntent(id),record=saved.value;
        check(!['prepared','cancelled'].includes(record.status),'ROLLING_RECOVERY_REQUIRED');
        const snapshot=await recoverySnapshot(saved);
        check(snapshot.status==='replacement-available'&&snapshot.currentTxHash===reviewInput.expectedTxHash,'ROLLING_RECOVERY_REQUIRED');
        await session.journal.allowReplacement(operation(id),{requireMissingAnchor:true});await session.journal.assertCanStart();
        const selected=await interaction(await selectedContract(record),record);
        const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,prepared:await payment(record.action,record),from:session.owner,guard});
        const replacementReview={sourceTxHash:snapshot.currentTxHash,head:snapshot.head,marker:snapshot.marker,maximumFee:estimated.maximumFee.toString()};
        const next={...record,status:'replacement-prepared',replacementReview};
        await checkReplacementReview(next);await session.journal.inspectReplacement(operation(id),{requireMissingAnchor:true}).then(view=>check(view.status==='available'&&view.txHash===replacementReview.sourceTxHash,'ROLLING_RECOVERY_REQUIRED'));
        await guard();await (await slot()).write(saved,next);return {...summary(next),replacementReview:clone(replacementReview)};
      });
    },
    async submitPrepared(id){return exclusive(async()=>{await guard();const saved=await savedIntent(id),replacing=saved.value.status==='replacement-prepared';check(replacing||saved.value.status==='prepared','ROLLING_RECOVERY_REQUIRED');
      if(replacing){
        await checkReplacementReview(saved.value);
        const inspected=await session.journal.inspectReplacement(operation(id),{requireMissingAnchor:true});
        check(inspected.status==='available'&&inspected.txHash===saved.value.replacementReview.sourceTxHash,'ROLLING_RECOVERY_REQUIRED');
        await session.journal.allowReplacement(operation(id),{requireMissingAnchor:true});
      }
      // Reuse only the exact predecessor observation owned by this locked action.
      // A separate submit/reload has no permit and performs a fresh canonical read.
      await session.journal.assertCanStart(!replacing&&saved.value.predecessor?{predecessor:saved.value.predecessor}:undefined); // Before private simulation, not merely before send.
      const paymentScope=session.operationScope?.(),cachedPayment=paymentScope&&preparedPayments.get(paymentScope);
      if(paymentScope)preparedPayments.delete(paymentScope);
      let moderationReviewed=false;
      // Only the completed review for these exact bytes in this still-held
      // native operation can replace the immediately repeated pre-proof read.
      // The post-proof beforeSubmit callback below always checks fresh authority.
      if(!replacing&&saved.value.moderation&&paymentScope?.synchronized===true&&cachedPayment?.moderationReady&&cachedPayment.encoded===saved.encoded&&
        cachedPayment.wallet===session.wallet&&cachedPayment.pxe===session.wallet.pxe&&cachedPayment.node===session.node&&cachedPayment.moderationReady.cachedNode===session.wallet.pxe.node){
        moderationReviewed=same(await balanceAnchor(),cachedPayment.moderationReady.anchor);
        await guard();check(session.operationScope()===paymentScope&&paymentScope.synchronized===true&&cachedPayment.wallet===session.wallet&&
          cachedPayment.pxe===session.wallet.pxe&&cachedPayment.node===session.node&&cachedPayment.moderationReady.cachedNode===session.wallet.pxe.node,'ROLLING_CONTEXT_CHANGED');
      }

      const preparePayment=()=>measure('action.fee-prepare',async()=>{
        if(cachedPayment&&cachedPayment.encoded===saved.encoded&&cachedPayment.wallet===session.wallet&&cachedPayment.pxe===session.wallet.pxe&&cachedPayment.node===session.node){
          if(cachedPayment.claim)await verifiedFeeClaim(saved.value.action,saved.value);
          await guard();check(session.operationScope()===paymentScope,'ROLLING_CONTEXT_CHANGED');return cachedPayment.payment;
        }
        return payment(saved.value.action,saved.value,{ordinaryProof:!!ordinaryPost(saved.value),likeProof:!!qualifiedLike(saved.value)});
      });
      let preparedPayment,selected;
      if(!replacing&&paymentScope?.synchronized===true&&['claim-deposit','claim-private-fee','claim-bok'].includes(saved.value.action.type)){
        const context={wallet:session.wallet,pxe:session.wallet.pxe,node:session.node};
        // All receipt legs still revalidate against current custody and canonical
        // blocks. They share only this submission's existing aggregate context.
        const reads=await Promise.allSettled([
          ()=>checkActionSubmission(saved.value),preparePayment,
        ].map(read=>Promise.resolve().then(read)));
        const failure=reads.find(result=>result.status==='rejected');if(failure)throw failure.reason;
        await guard();check(session.operationScope()===paymentScope&&paymentScope.synchronized===true&&session.wallet===context.wallet&&context.wallet.pxe===context.pxe&&session.node===context.node,'ROLLING_CONTEXT_CHANGED');
        preparedPayment=reads[1].value;
        selected=await interaction(await selectedContract(saved.value),saved.value);progress('estimating');
      }else{
        await checkActionSubmission(saved.value,{moderationReviewed});
        selected=await interaction(await selectedContract(saved.value),saved.value);progress('estimating');
        preparedPayment=await preparePayment();
      }
      const estimated=await measure('action.fee-simulate',()=>sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,prepared:preparedPayment,from:session.owner,guard,deferSimulation:true,ordinaryPost:ordinaryPost(saved.value),qualifiedLike:qualifiedLike(saved.value),measure}));
      const maximumFee=replacing?saved.value.replacementReview.maximumFee:saved.value.maximumFee;
      check(estimated.maximumFee<=BigInt(maximumFee),'ROLLING_FEE_CHANGED');await guard();
      let attempt=null,active;
      if(saved.value.preproofReview&&!replacing){
        check(localPreproof&&await privateStore.readRecoveryEpoch()===saved.value.preproofReview.epoch&&
          await journalCommitment()===saved.value.preproofReview.predecessor,'ROLLING_RECOVERY_REQUIRED');

      }
      if(localPreproof&&!replacing){
        const epoch=await privateStore.ensureRecoveryEpoch();check(typeof epoch==='string'&&/^[0-9a-f]{64}$/.test(epoch),'ROLLING_RECOVERY_REQUIRED');
        attempt={version:1,epoch,attempt:field(sdk.Fr.random().toString(),true),predecessor:await journalCommitment()};
        await guard();check(await privateStore.readRecoveryEpoch()===epoch,'ROLLING_RECOVERY_REQUIRED');
      }
      await (await slot()).write(saved,{...saved.value,status:attempt?'pre-proof':'submitting',...(attempt?{preproof:attempt}:{})});
      active=await savedIntent(id);await guard();progress('submitting');
      const options={from:session.owner,fee:{gasSettings:estimated.gasSettings},simulationValidation:estimated.simulationValidation,atomicSimulation:estimated.atomicSimulation===true,
        transactionJournal:session.journal,journalOperation:operation(id),confirmationTier:includedAction(saved.value)?'proposed':'checkpointed',...(saved.value.bokReleaseSource?{beforeSubmit:()=>checkBokRelease(saved.value.bokReleaseSource,saved.value.action.type)}:{}),...(saved.value.moderation?{beforeSubmit:async()=>{await checkModeration(saved.value);await guard();}}:{}),...(saved.value.bok&&saved.value.bok.phase!=='atomic'?{beforeSubmit:async()=>{
          await checkBokThread(saved.value.action,await contract());
          if(saved.value.bok.phase==='post')await waitingBok(saved.value);else await bokContext();await guard();
        }}:{}),...(replacing?{beforeSubmit:async hash=>{
          await session.journal.assertReplacementPredecessors(operation(id),hash,{requireMissingAnchor:true});
          // Predecessor validation itself awaits the node. Refresh the signed
          // action's context afterwards, not before that asynchronous window.
          await checkReplacementReview(saved.value,{synchronize:true});await guard();
        }}:{})};
      if(!replacing&&(ordinaryPost(saved.value)||qualifiedLike(saved.value)))options.onProvingFailure=async error=>{
        if(!sdk.isPrivateFeeCreditFailure(error,fixed.fee))return;
        // This callback runs inside the built-in wallet before tx conversion,
        // journal preparation or broadcast. Recheck ownership before discarding
        // only this unsigned attempt; a different/signed attempt must survive.
        await guard();const current=await savedIntent(id),tx=await session.journal.inspect();
        check(current.encoded===active.encoded&&(!tx||tx.operation!==operation(id)),'ROLLING_RECOVERY_REQUIRED');
        if(attempt)check(await privateStore.readRecoveryEpoch()===attempt.epoch&&await journalCommitment(true)===attempt.predecessor,'ROLLING_RECOVERY_REQUIRED');
        await (await slot()).write(current,{...saved.value,status:'cancelled'});
        throw fail(qualifiedLike(saved.value)?'BB_LIKE_FEE_CREDIT_REQUIRED':'BB_POST_FEE_CREDIT_REQUIRED');
      };
      if(attempt){
        const verify=async phase=>{
          check(['preparing','pre-proof','signed'].includes(phase),'ROLLING_RECOVERY_REQUIRED');
          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch,'ROLLING_RECOVERY_REQUIRED');
          const current=await savedIntent(id);check(current.encoded===active.encoded&&same(current.value.preproof,attempt)&&
            current.value.status===(phase==='signed'?'submitting':'pre-proof'),'ROLLING_RECOVERY_REQUIRED');
          // The canonical permit belongs to this held account operation and
          // exact encrypted predecessor. Keep reauthenticating bytes/epoch at
          // both proof boundaries; native validation checks live chain state.
          if(phase!=='signed')check(await journalCommitment()===attempt.predecessor,'ROLLING_RECOVERY_REQUIRED');
          else {const tx=await session.journal.inspect();check(tx?.operation===operation(id)&&tx.txHash===current.value.txHash,'ROLLING_RECOVERY_REQUIRED');}

          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch&&(await savedIntent(id)).encoded===active.encoded,'ROLLING_RECOVERY_REQUIRED');
        };
        await localPreproof.send(estimated.payload,options,{guard:verify,signed:async txHash=>{
          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch&&(await savedIntent(id)).encoded===active.encoded,'ROLLING_RECOVERY_REQUIRED');
          const tx=await session.journal.inspect();check(tx?.operation===operation(id)&&tx.txHash===txHash,'ROLLING_RECOVERY_REQUIRED');
          await (await slot()).write(active,{...active.value,status:'submitting',txHash});active=await savedIntent(id);
        }});
      }else await session.wallet.sendTx(estimated.payload,options);
      return outcome(await savedIntent(id),{completion:true});
    });},
    async cancelPrepared(id){return exclusive(async()=>{await guard();const saved=await savedIntent(id);
      check(saved.value.status==='prepared'&&saved.value.bok?.phase!=='post','ROLLING_RECOVERY_REQUIRED');
      const tx=await session.journal.inspect();check(!tx||tx.operation!==operation(id),'ROLLING_RECOVERY_REQUIRED');
      await guard();if(saved.value.bokReleaseSource){
        // A cancelled fee review must not discard the funded draft or unblock unrelated actions.
        const source=saved.value.bokReleasePrior;check(source,'ROLLING_RECOVERY_REQUIRED');const found=await session.journal.inspectOutcome();
        check(found?.operation===operation(source.id),'ROLLING_RECOVERY_REQUIRED');
        await (await slot()).write(saved,source);return outcome(await (await slot()).read());
      }
      const cancelled={...saved.value,status:'cancelled'};await (await slot()).write(saved,cancelled);return summary(cancelled);
    });},
    async reconcile(id){return exclusive(async()=>{await guard();const saved=await savedIntent(id);
      if(['prepared','cancelled','replacement-prepared'].includes(saved.value.status))return {...summary(saved.value),...(saved.value.replacementReview?{replacementReview:clone(saved.value.replacementReview)}:{})};return outcome(saved);
    });},
  });
}
