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
function preferenceRevision(value){
  check(typeof value==='string'&&/^(?:0|[1-9][0-9]{0,19})$/.test(value)&&BigInt(value)<=0xffffffffffffffffn);
  return BigInt(value);
}
function preferenceArguments(action){
  const revision=preferenceRevision(action.expectedRevision);
  check(Number.isInteger(action.kind)&&action.kind>=1&&action.kind<=5&&typeof action.enabled==='boolean');
  const target=field(action.target,action.kind!==2&&action.kind!==5);
  check(action.kind!==5||target===zero);
  return [revision,action.kind,target,action.enabled];
}
function avatar(action){
  check(typeof action.data==='string'&&action.data.length<=10924&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(action.data));
  const binary=atob(action.data);check(btoa(binary)===action.data&&binary.length<=8192);
  check(binary.length===0?action.width===0&&action.height===0:action.width===100&&action.height===100);
  return [field(action.name,true),version(action.expectedVersion),action.width,action.height,binary.length,pack(Uint8Array.from(binary,c=>c.charCodeAt(0)),265)];
}
function component(fields,length){
  check(Array.isArray(fields)&&fields.length===2&&Number.isInteger(length)&&length>=1&&length<=32,'ROLLING_INVALID_RESPONSE');
  const words=fields.map(value=>{check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)<(1n<<248n),'ROLLING_INVALID_RESPONSE');return BigInt(value);});
  check((words[1]&((1n<<240n)-1n))===0n,'ROLLING_INVALID_RESPONSE');
  const bytes=Array.from({length:31},(_,i)=>Number((words[0]>>BigInt((30-i)*8))&255n));bytes.push(Number(words[1]>>240n));
  check(bytes.slice(length).every(n=>n===0),'ROLLING_INVALID_RESPONSE');return String.fromCharCode(...bytes.slice(0,length));
}
const moderationTypes=new Set(['moderate-post','moderate-avatar','reject-subboard','set-main-policy']);
const keys={'moderate-post':['post','reason'],'moderate-avatar':['name','reason'],'reject-subboard':['subboard','reason'],'set-main-policy':['rules'],'claim-deposit':['receipt','feeReceipt','bokReceipt'],'claim-private-fee':['receipt'],'claim-bok':['receipt','feeReceipt'],preference:['expectedRevision','kind','target','enabled'],'read-marker':['expectedRevision','thread','throughBlock'],bio:['name','expectedVersion','content'],avatar:['name','expectedVersion','width','height','data'],name:['first','last'],subboard:['slug','name','description','rules'],like:['post'],unlike:['post'],'withdraw-bok':['amount','recipient'],'cancel-bok-request':['requestId'],'expire-bok-request':['requestId'],withdraw:['deposit'],screen:['deposit'],
  bok:['deposit','content','name','subboard','budget','parent','root'],post:['deposit','content','name','subboard'],reply:['deposit','content','name','subboard','parent','root'],
  quote:['deposit','content','name','subboard','reference'],repost:['deposit','content','name','subboard','reference']};
const methods={'moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy',bok:'authorize_request','claim-deposit':'claim_deposit','claim-private-fee':'claim-private-fee','claim-bok':'claim',preference:'set_preference','read-marker':'mark_thread_read',bio:'set_bio',avatar:'set_avatar',name:'register_name',subboard:'create_subboard',like:'set_like',unlike:'set_like','withdraw-bok':'withdraw','cancel-bok-request':'cancel','expire-bok-request':'expire',withdraw:'withdraw',screen:'screen',post:'post',reply:'post',quote:'post',repost:'post'};

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
 * preference/read-marker expectedRevision is canonical decimal uint64; kind1..5
 * toggles use opaque canonical IDs (board0 and global0 allowed, other targets
 * nonzero). Deleted/stale targets remain recoverable, without public lookups.
 * read-marker throughBlock is decimal uint32; the contract authenticates its hash.
 * readPreferenceHead returns the pure replay shape, only through the scoped owner
 * utility after trusted-route guards. A failed read never becomes empty history.
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
 * readBokAccounting advances one private ownership or uniform public page per
 * call. Its opaque cursor is session-local and bound to an unchanged canonical
 * PXE anchor. Only a fully consumed public revision returns owned totals. Free
 * balance excludes request allocations; refunded amounts are historical and
 * already returned to that free balance, never additive.
 * receipt remains in this workflow until the captured session refund verifier
 * confirms the separate original-depositor Ethereum journal outcome.
 */
export function createRollingApplication({sdk,deployment,accountSession,privateStore,publicReader,readBokAccountingPage,funding,onProgress=()=>{},contextGuard}){
  void publicReader; // Never route personalized requests through public readers.
  const readAccountingPage=typeof readBokAccountingPage==='function'?readBokAccountingPage:null;
  let busy=false,slotPromise,balanceContinuation=null,accountingScan=null,completedAccounting=null;
  const session=accountSession;
  const preproof=session?.preproofRecovery;
  const localPreproof=preproof&&typeof preproof.checkpoint==='function'&&typeof preproof.send==='function'&&
    typeof privateStore?.readRecoveryEpoch==='function'&&typeof privateStore?.ensureRecoveryEpoch==='function'&&typeof privateStore?.rotateRecoveryEpoch==='function'
    ?Object.freeze({checkpoint:preproof.checkpoint,send:preproof.send}):null;
  const owner=session?.owner?.toString();
  const fundingProvider=funding?.provider,claimStore=funding?.claimStore;
  const resolveBokWithdrawal=typeof funding?.resolveBokWithdrawal==='function'?funding.resolveBokWithdrawal.bind(funding):null;
  const verifyWithdrawal=typeof funding?.verifyWithdrawal==='function'?funding.verifyWithdrawal.bind(funding):null;
  const loadAggregate=typeof funding?.loadAggregate==='function'?funding.loadAggregate.bind(funding):null;
  const fixed=deployment&&{board:deployment.board.address.toString(),network:clone(deployment.network),portal:deployment.portal,
    fee:deployment.privateFee.address.toString(),gas:JSON.parse(JSON.stringify(deployment.privateFee.gasSettings,(_,v)=>typeof v==='bigint'?v.toString():v)),proofsEnabled:deployment.proofsEnabled!==false};
  const bok=deployment?.bok&&{address:deployment.bok.address.toString(),operator:deployment.bok.operator.toString(),pluginId:field(deployment.bok.pluginId,true)};
  const scope=session&&fixed&&{account:owner,chainId:String(fixed.network.chainId),version:String(fixed.network.version),
    rollup:fixed.network.rollup,board:fixed.board,portal:fixed.portal};
  const slot=()=>slotPromise??=createEncryptedJournalSlot({storage:privateStore,walletSecret:session.walletSecret,walletSalt:session.walletSalt,
    scopeText:JSON.stringify(['ROLLING_WORKFLOW_V1',l2JournalScopeText(scope)]),keyDomain:'ROLLING_WORKFLOW_V1'});
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
  async function guard(){
    check(session&&typeof contextGuard==='function','ROLLING_LOCKED');await contextGuard();
    check(owner===session.owner.toString()&&sdk.isTrustedPrivateNode(session.node)&&
      session.wallet.aztecNode===session.node&&sdk.isPrivateWalletForNode(session.wallet,session.node)&&sdk.isPrivatePXEForNode(session.wallet.pxe,session.node)&&fixed.board===deployment.board.address.toString()&&fixed.fee===deployment.privateFee.address.toString()&&
      JSON.stringify(fixed.network)===JSON.stringify(deployment.network)&&fixed.portal===deployment.portal&&
      (!bok||deployment.bok?.address.toString()===bok.address&&deployment.bok?.operator.toString()===bok.operator&&field(deployment.bok?.pluginId,true)===bok.pluginId),'ROLLING_CONTEXT_CHANGED');
    await sdk.inspectTrustedNode(session.node,{expectedNetworkScope:fixed.network,proofsEnabled:fixed.proofsEnabled});
    const chain=await session.wallet.getChainInfo();check(chainValue(chain?.chainId)===chainValue(scope.chainId)&&chainValue(chain?.version)===chainValue(scope.version),'ROLLING_CONTEXT_CHANGED');
    const accounts=await session.wallet.getAccounts();check(accounts.some(a=>(a.address??a).toString()===owner),'ROLLING_CONTEXT_CHANGED');
  }
  async function exclusive(fn){check(!busy,'ROLLING_BUSY');busy=true;try{return await fn();}finally{busy=false;}}
  const progress=stage=>{try{onProgress({stage});}catch{/* display errors cannot alter transaction control */}};
  const contract=()=>sdk.Contract.at(new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.board))),deployment.board.artifact,session.wallet);
  async function utility(board,name,args,artifact=deployment.board.artifact){
    const matches=[...artifact.functions,...(artifact.nonDispatchPublicFunctions??[])].filter(f=>f.name===name);
    check(matches.length===1,'ROLLING_ABI_MISMATCH');const abi=matches[0];
    check(!abi.returnTypes||abi.returnTypes.length<=1,'ROLLING_ABI_MISMATCH');
    const out=await board.methods[name](...args).simulate({from:session.owner});
    return utilityPlain(out.result??out,abi.returnType??abi.returnTypes?.[0]);
  }
  async function fundingClaim(kind,metadata){
    check(fundingProvider&&typeof sdk.prepareFundingClaim==='function','ROLLING_FUNDING_UNAVAILABLE');
    const receipt=exactData(metadata,['txHash','blockHash','blockNumber','sender','nonce','amount','leafIndex','messageKey','secretHash']);
    await guard();const header=await session.wallet.pxe.getSyncedBlockHeader();await guard();
    const anchor={number:Number(header.globalVariables.blockNumber),hash:(await header.hash()).toString(),root:header.state.l1ToL2MessageTree.root.toString()};
    const aggregate=loadAggregate?await loadAggregate(receipt.txHash):null;await guard();
    let claimScope={...fixed.network,portal:fixed.portal,recipient:fixed.board};
    let secrets={walletSecret:session.walletSecret,...(kind==='collateral'?{walletSalt:field(String(session.walletSalt))}:{})};
    if(kind==='bok'){
      check(bok&&aggregate?.bokScope,'ROLLING_FUNDING_UNAVAILABLE');
      claimScope=exactData(aggregate.bokScope,['chainId','version','rollup','portal','recipient','token']);
      check(claimScope.recipient===bok.address&&['chainId','version','rollup'].every(key=>claimScope[key]===fixed.network[key]),'ROLLING_FUNDING_MISMATCH');
      secrets={recipientSalt:field(aggregate.recipientSalt,true),bridgeSecret:field(aggregate.bridgeSecret,true)};
    }
    if(kind==='private-fee'){
      const info=await session.node.getNodeInfo();await guard();
      claimScope={...fixed.network,portal:info.l1ContractAddresses.feeJuicePortalAddress.toString().toLowerCase(),
        token:info.l1ContractAddresses.feeJuiceAddress.toString().toLowerCase(),recipient:fixed.fee};
    }
    const verified=await sdk.prepareFundingClaim({kind,scope:claimScope,receipt,anchor,owner,
      secrets,...(aggregate?{aggregateIntent:aggregate.intent,...(aggregate.aggregateCustody?{aggregateCustody:aggregate.aggregateCustody}:{})}:{}),
      privateFeeArtifact:deployment.privateFee.artifact,ethProvider:fundingProvider,node:session.node,claimStore,contextGuard:guard});
    await guard();check(verified.status==='claim-ready','ROLLING_FUNDING_NOT_READY');return verified.claim;
  }
  async function payment(action,record){
    let claim;
    const receipt=action?.type==='claim-private-fee'?action.receipt:
      ['claim-deposit','claim-bok'].includes(action?.type)?action.feeReceipt:undefined;
    if(receipt!==undefined){
      const verified=await fundingClaim('private-fee',receipt);
      check(verified.contract===fixed.fee&&verified.kind==='private-fee-bridge','ROLLING_FUNDING_MISMATCH');
      claim=verified.bridgeClaim;
      if(action.type==='claim-private-fee'&&record){
        if(record.fundingFee)check(same(plain(claim),record.fundingFee),'ROLLING_FUNDING_MISMATCH');
        else record.fundingFee=plain(claim);
      }
    }
    return sdk.preparePrivateFeePayment({wallet:session.wallet,node:session.node,owner:session.owner,
      privateFeeAddress:fixed.fee,privateFeeArtifact:deployment.privateFee.artifact,expectedChainId:scope.chainId,expectedVersion:scope.version,gasSettings:fixed.gas,
      ...(claim?{claim}:{})});
  }
  async function collateralClaim(action){
    // Receipt metadata cannot replace the authenticated deployment or inject
    // secrets. Both claims are derived from custody and rechecked at submission.
    const claim=await fundingClaim('collateral',action.receipt);
    check(claim.contract===fixed.board&&claim.method==='claim_deposit','ROLLING_FUNDING_MISMATCH');
    return plain(claim.args);
  }
  async function privateBokClaim(receipt){
    const claim=await fundingClaim('bok',receipt);
    check(claim.contract===bok.address&&claim.method==='claim','ROLLING_FUNDING_MISMATCH');
    return {scope:clone(bok),args:plain(claim.args)};
  }
  async function bokFundingClaim(action){
    check(bok&&action.feeReceipt&&action.bokReceipt&&action.receipt.txHash===action.feeReceipt.txHash&&action.receipt.txHash===action.bokReceipt.txHash,'ROLLING_FUNDING_MISMATCH');
    return privateBokClaim(action.bokReceipt);
  }
  const operation=id=>`ROLLING_WORKFLOW_V1:${id}`;
  function summary(record){return {intentId:record.id,action:clone(record.action),status:record.status,maximumFee:record.maximumFee,
    nonce:record.nonce,txHash:record.txHash??null,...(record.withdrawal?{withdrawal:clone(record.withdrawal),actualNetworkFee:record.actualNetworkFee??null}:{}),...(record.moderation?{moderation:clone(record.moderation)}:{}),stage:record.bok?`bok-${record.bok.phase}`:'single-transaction',...(record.bok?{bok:{phase:record.bok.phase,budget:record.bok.budget,availableCredit:record.bok.availableCredit,authorizationTxHash:record.bok.authorizationTxHash??null,...(record.bok.phase==='post'?{mainPolicyVersion:record.args[2].expected_main_policy_version,localPolicyVersion:record.args[2].expected_local_policy_version}:{})}}:{}),...(record.bokReleaseSource?{bokRelease:{sourceIntentId:record.bokReleaseSource.id}}:{}),...(record.replacementReview?{replacementReview:clone(record.replacementReview)}:{}),
    ...(record.nameAvailability?{nameAvailability:clone(record.nameAvailability)}:{}),...(preferenceAction(record)?{inclusionHistory:clone(record.inclusionHistory??[])}:{})};}
  function checkBokRecord(record){for(const savedScope of [record?.bok?.scope,record?.fundingBok?.scope,record?.bokRequestScope,record?.bokReleaseSource?.bok?.scope])if(savedScope)check(bok&&JSON.stringify(savedScope)===JSON.stringify(bok),'ROLLING_CONTEXT_CHANGED');}
  async function savedIntent(id){const saved=await (await slot()).read();check(saved.value?.id===id,'ROLLING_INTENT_NOT_FOUND');checkBokRecord(saved.value);return saved;}
  function acknowledge(found,expected){
    check(found&&found.operation===expected.operation&&found.txHash===expected.txHash&&
      ['success','reverted'].includes(found.outcome)&&found.receipt?.txHash?.toString()===found.txHash,'ROLLING_RECOVERY_REQUIRED');
    // inspectOutcome verified this exact receipt canonically. assertCanStart still
    // rechecks canonicality and rejects non-final reverted sender-tagging ranges.
    session.journal.confirmed(found.receipt);
  }
  async function outcome(saved){
    checkBokRecord(saved.value);
    const found=await session.journal.inspectOutcome();
    if(!found||found.operation!==operation(saved.value.id))return {...summary(saved.value),status:'unknown'};
    if(!['success','reverted'].includes(found.outcome))return {...summary(saved.value),status:'unknown',txHash:found.txHash};
    acknowledge(found,{operation:operation(saved.value.id),txHash:saved.value.replacementReview?found.txHash:(saved.value.txHash??found.txHash)});
    const next={...saved.value,...(saved.value.withdrawal?{actualNetworkFee:String(chainValue(found.receipt.transactionFee))}:{}),status:found.outcome==='success'?'confirmed':'reverted',txHash:found.txHash,...(preferenceAction(saved.value)?{inclusionHistory:inclusionHistory(saved.value,found)}:{})};
    await (await slot()).write(saved,next);return {...summary(next),...(next.bok?.phase==='authorize'&&next.status==='confirmed'?{status:'authorized'}:next.bok?.phase==='post'&&next.status==='reverted'?{status:'bok-post-reverted'}:next.bokReleaseSource&&next.status==='reverted'?{status:'bok-release-reverted'}:{})};
  }
  const preferenceAction=record=>['preference','read-marker'].includes(record.action.type);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const hashText=value=>{const text=value?.toString();check(typeof text==='string'&&/^0x[0-9a-f]{64}$/.test(text),'ROLLING_INVALID_RESPONSE');return text;};
  function exactData(value,names){
    check(value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===names.length,'ROLLING_INVALID_ACTION');
    return Object.fromEntries(names.map(name=>{const d=Object.getOwnPropertyDescriptor(value,name);check(d&&Object.hasOwn(d,'value'),'ROLLING_INVALID_ACTION');return [name,d.value];}));
  }
  async function preferenceHead(){
    await guard();const board=await contract();await guard();
    const record=await utility(board,'preference_head',[session.owner]);
    check(record&&typeof record.initialized==='boolean','ROLLING_INVALID_RESPONSE');
    const numeric=(value,max)=>{check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),'ROLLING_INVALID_RESPONSE');const n=BigInt(value);check(n<=max,'ROLLING_INVALID_RESPONSE');return n;};
    const schema=numeric(record.schema,0xffffffffn),revision=numeric(record.revision,0xffffffffffffffffn),digest=numeric(record.digest,FIELD_MODULUS-1n);
    check(schema===1n&&(record.initialized?revision>0n&&digest>0n:revision===0n&&digest===0n),'ROLLING_INVALID_RESPONSE');
    await guard();return {initialized:record.initialized,schema:1,revision:String(revision),digest:String(digest)};
  }
  async function markerContext(record){
    if(record.action.type!=='read-marker')return null;
    await guard();const height=Number(record.action.throughBlock),block=await session.node.getBlockData(height);await guard();
    check(block&&Number(block.header?.globalVariables?.blockNumber)===height,'ROLLING_RECOVERY_CONTEXT_CHANGED');
    return {throughBlock:record.action.throughBlock,blockHash:hashText(block.blockHash)};
  }
  function inclusionHistory(record,found){
    const history=clone(record.inclusionHistory??[]);if(!preferenceAction(record))return history;
    const receipt=found.receipt,fee=receipt.transactionFee;
    check(Number.isSafeInteger(receipt.blockNumber)&&receipt.blockNumber>0&&
      ['checkpointed','proven','finalized'].includes(receipt.status)&&
      (typeof fee==='bigint'||typeof fee==='string')&&/^(0|[1-9][0-9]{0,76})$/.test(String(fee))&&BigInt(fee)<FIELD_MODULUS,'ROLLING_INVALID_RESPONSE');
    const fact={blockNumber:receipt.blockNumber,blockHash:hashText(receipt.blockHash),executionResult:found.outcome,transactionFee:String(fee)};
    let attempt=history.find(row=>row.txHash===found.txHash);
    if(!attempt){check(history.length<9,'ROLLING_RECOVERY_REQUIRED');attempt={txHash:found.txHash,inclusions:[]};history.push(attempt);}
    const prior=attempt.inclusions.find(row=>row.blockHash===fact.blockHash);
    check(!prior||same(prior,fact),'ROLLING_INVALID_RESPONSE');if(!prior)attempt.inclusions.push(fact);
    return history;
  }
  function savedConsent(record,txHash){
    const review=record.replacementReview;
    // A renewed quote does not prove that new signed bytes were saved. Never
    // attribute that quote to its old source candidate after an interrupted proof.
    if(!txHash||review&&review.sourceTxHash===txHash)return null;
    const maximumFee=review?review.maximumFee:record.maximumFee;
    if(typeof maximumFee!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(maximumFee)||BigInt(maximumFee)>=FIELD_MODULUS)return null;
    return {maximumFee,feeSource:review?'replacement':'original',marker:clone(review?review.marker:record.originalMarker??null)};
  }
  function savedContextMatches(record,consent,head,marker){
    if(!consent)return false;
    if(!preferenceAction(record))return head===null&&marker===null&&(!record.replacementReview||record.replacementReview.head===null&&record.replacementReview.marker===null);
    return !!record.originalPreferenceHead&&same(head,record.originalPreferenceHead)&&
      head.revision===record.action.expectedRevision&&same(marker,consent.marker)&&
      (!record.replacementReview||same(head,record.replacementReview.head));
  }
  async function checkPreproofPreferenceContext(record,{synchronize=false}={}){
    if(!preferenceAction(record))return;
    if(synchronize){await guard();await session.wallet.pxe.sync();await guard();}
    const head=await preferenceHead(),marker=await markerContext(record);
    // A new proof may renew fees and its anchor, never the saved revision or
    // the canonical block acknowledged by a read marker.
    check(savedContextMatches(record,{marker:record.originalMarker??null},head,marker),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    await guard();
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
    const head=preferenceAction(record)?await preferenceHead():null,marker=await markerContext(record);
    if(!preferenceAction(record))await checkActionRecoveryContext(record);
    check(savedContextMatches(record,consent,head,marker),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();
  }
  async function journalCommitment(){
    const prior=await localPreproof.checkpoint();
    check(prior&&Object.hasOwn(prior,'encoded')&&(prior.encoded===null||typeof prior.encoded==='string'),'ROLLING_RECOVERY_REQUIRED');
    const bytes=new TextEncoder().encode(JSON.stringify(prior.encoded));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  }
  async function preproofAvailable(saved){
    const record=saved.value,p=record.preproof;
    if(!localPreproof||record.status!=='pre-proof'||!p||p.version!==1||
      !/^[0-9a-f]{64}$/.test(p.epoch)||!/^0x[0-9a-f]{64}$/.test(p.attempt)||!/^[0-9a-f]{64}$/.test(p.predecessor))return false;
    // Signed bytes always win, even when publication of the signed fence failed.
    const tx=await session.journal.inspect();if(tx?.operation===operation(record.id)&&tx.txHash!==record.predecessor?.txHash)return false;
    if(await privateStore.readRecoveryEpoch()!==p.epoch)return false;
    if(record.predecessor)acknowledge(await session.journal.inspectOutcome(),record.predecessor);
    if(await journalCommitment()!==p.predecessor)return false;
    await guard();check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');
    return await privateStore.readRecoveryEpoch()===p.epoch;
  }
  async function recoverySnapshot(saved){
    const record=saved.value;
    if(await preproofAvailable(saved))return {intent:summary(record),status:'pre-proof-review',attempts:[],requireMissingAnchor:true,
      head:null,marker:null,originalPreferenceHead:clone(record.originalPreferenceHead??null),originalMarker:clone(record.originalMarker??null),inclusionHistory:clone(record.inclusionHistory??[]),currentTxHash:null,exactResume:{status:'empty',txHash:null}};
    const inspected=await session.journal.inspectReplacement(operation(record.id),{requireMissingAnchor:true});
    const head=preferenceAction(record)?await preferenceHead():null,marker=await markerContext(record);await guard();
    const exactResume=await exactResumeSnapshot(record,inspected.txHash,head,marker);
    check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();
    let status=inspected.status==='available'?'replacement-available':inspected.status;
    if(status==='replacement-available'&&preferenceAction(record)&&(!record.originalPreferenceHead||!same(head,record.originalPreferenceHead)||head.revision!==record.action.expectedRevision))status='context-changed';
    if(status==='replacement-available'&&preferenceAction(record)&&['confirmed','reverted'].includes(record.status)&&!record.inclusionHistory?.some(row=>row.txHash===record.txHash))status='history-unavailable';
    if(!preferenceAction(record)&&(status==='replacement-available'||exactResume.status==='resumable')){await session.wallet.pxe.sync();await checkActionRecoveryContext(record);check((await savedIntent(record.id)).encoded===saved.encoded,'ROLLING_RECOVERY_REQUIRED');await guard();}
    return {intent:summary(record),status,attempts:clone(inspected.attempts),requireMissingAnchor:inspected.requireMissingAnchor,
      head,originalPreferenceHead:clone(record.originalPreferenceHead??null),marker,originalMarker:clone(record.originalMarker??null),inclusionHistory:clone(record.inclusionHistory??[]),currentTxHash:inspected.txHash,exactResume};
  }
  async function checkReplacementReview(record,{synchronize=false}={}){
    const review=record.replacementReview;check(review,'ROLLING_RECOVERY_REQUIRED');
    if(synchronize){await guard();await session.wallet.pxe.sync();await guard();}
    if(!preferenceAction(record)){check(review.head===null&&review.marker===null,'ROLLING_RECOVERY_CONTEXT_CHANGED');await checkActionRecoveryContext(record);return;}
    const head=await preferenceHead(),marker=await markerContext(record);
    check(record.originalPreferenceHead&&same(head,record.originalPreferenceHead)&&head.revision===record.action.expectedRevision&&same(head,review.head)&&same(marker,review.marker),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    await guard();
  }
  // Reuse the original submission checks at recovery boundaries; none of these
  // checks grants permission to resend without the exact authenticated journal.
  async function checkActionSubmission(record){
      if(record.withdrawal?.kind==='bok'){check(same(await resolveBokWithdrawal(),record.withdrawal.bokScope),'ROLLING_CONTEXT_CHANGED');const anchor=await balanceAnchor(),available=chainValue(await utility(await bokContract(),'balance_of',[session.owner],deployment.bok.artifact));check(available>=uint128(record.withdrawal.amount),'ROLLING_BOK_CREDIT_INSUFFICIENT');await checkBalanceAnchor(anchor);}
      else if(record.withdrawal){const anchor=await balanceAnchor(),current=await collateralInfo(record.action.deposit,await contract(),BigInt(anchor.timestamp));check(current.eligible&&same(current,record.withdrawal),'ROLLING_WITHDRAWAL_NOT_READY');await checkBalanceAnchor(anchor);}
      if(record.action.type==='claim-deposit')check(same(await collateralClaim(record.action),record.args),'ROLLING_FUNDING_MISMATCH');
      if(record.fundingBok)check(same(await (record.action.type==='claim-bok'?privateBokClaim(record.action.receipt):bokFundingClaim(record.action)),record.fundingBok),'ROLLING_FUNDING_MISMATCH');
      if(record.action.type==='claim-private-fee')check(record.fundingFee,'ROLLING_FUNDING_MISMATCH');
      if(record.bokReleaseSource)await checkBokRelease(record.bokReleaseSource,record.action.type);
      await checkModeration(record);
      if(record.bok)await checkBokThread(record.action,await contract());
      if(record.bok?.phase==='authorize'){const available=await bokCredit();check(available>=BigInt(record.bok.budget),'ROLLING_BOK_CREDIT_INSUFFICIENT');}
      if(record.bok?.phase==='post')await waitingBok(record);
  }
  async function checkActionRecoveryContext(record){
    await guard();checkBokRecord(record);await checkActionSubmission(record);
    // A fresh proof may renew its anchor and fees, never the saved action's
    // screening hints, policy versions, profile version or funded Bok target.
    if(['post','reply','quote','repost','screen'].includes(record.action.type)){
      check(same(plain(await argumentsFor(record.action,await contract(),record.nonce)),record.args),'ROLLING_RECOVERY_CONTEXT_CHANGED');
    }
    if(record.bok){
      await bokContext();const postArgs=plain(await argumentsFor(record.action,await contract(),record.nonce));
      check(same(postArgs,record.bok.phase==='post'?record.args.slice(0,5):record.bok.postArgs),'ROLLING_RECOVERY_CONTEXT_CHANGED');
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
  async function screeningArguments(board,deposit){
    const hints=await utility(board,'get_screen_hints',[session.owner,deposit]);
    check(Array.isArray(hints)&&hints.length===2&&!(!hints[0]&&hints[1]),'ROLLING_HISTORY_UNAVAILABLE');
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
      const head=await session.node.getBlockData('checkpointed'),blockNumber=Number(head?.header?.globalVariables?.blockNumber),blockHash=hashText(head?.blockHash);
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
  async function argumentsFor(action,board,nonce){
    const allowed=keys[action?.type];check(allowed&&Object.keys(action).every(k=>k==='type'||allowed.includes(k)));
    switch(action.type){
      case 'claim-deposit':return collateralClaim(action);
      case 'claim-private-fee':check(action.receipt!==undefined);return [];
      case 'claim-bok':return (await privateBokClaim(action.receipt)).args;
      case 'preference':return preferenceArguments(action);
      case 'read-marker':return [preferenceRevision(action.expectedRevision),field(action.thread,true),version(action.throughBlock)];
      case 'bio':return [field(action.name,true),version(action.expectedVersion),...text(action.content,32,false)];
      case 'avatar':return avatar(action);
      case 'name':return nameRegistration(action.first,action.last).arguments;
      case 'subboard':{
        check(typeof action.slug==='string'&&/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(action.slug));
        return [[...new TextEncoder().encode(action.slug),...Array(40-action.slug.length).fill(0)],action.slug.length,
          ...text(action.name,3),...text(action.description,16),...text(action.rules,32,false)];
      }
      case 'like':case 'unlike':return [field(action.post,true),action.type==='like'];
      case 'withdraw-bok':check(bok&&uint128(action.amount)>0n&&typeof action.recipient==='string'&&/^0x[0-9a-f]{40}$/.test(action.recipient)&&BigInt(action.recipient)>0n);return [action.amount,{inner:field(BigInt(action.recipient).toString())},nonce];
      case 'expire-bok-request':
      case 'cancel-bok-request':check(bok&&completedAccounting&&completedAccounting.requests.some(r=>r.requestId===field(action.requestId,true)&&['1','2'].includes(r.state)&&(action.type==='expire-bok-request'||r.reserved==='0')),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');await checkBalanceAnchor(completedAccounting.anchor);return [field(action.requestId,true)];
      case 'withdraw':return [field(action.deposit,true)];
      case 'screen':return screeningArguments(board,field(action.deposit,true));
      default:{
        await checkBokThread(action,board);
        const subboard=field(action.subboard??'0'),kind=action.type==='quote'?2:action.type==='repost'?3:1;
        const policy=subboard===zero?await utility(board,'main_policy',[]):await utility(board,'effective_policy',[subboard]);
        check(Array.isArray(policy)&&policy.length===(subboard===zero?2:5),'ROLLING_POLICY_UNAVAILABLE');
        check(subboard===zero||policy[4]!==true,'ROLLING_SUBBOARD_REJECTED');
        const [message,length]=text(action.content,32,kind!==3);
        const draft={subboard,parent:field(action.parent??'0',action.type==='reply'),root_reference:field(action.root??'0',action.type==='reply'),kind,
          name_id:field(action.name??'0'),reference:field(action.reference??'0',kind!==1),message,length,
          expected_main_policy_version:Number(BigInt(policy[0])),expected_local_policy_version:subboard===zero?0:Number(BigInt(policy[2]))};
        const [deposit,...hints]=await screeningArguments(board,field(action.deposit,true));
        return [deposit,nonce,draft,...hints];
      }
    }
  }
  async function moderatorStatus(){
    await guard();const slot=deployment.board.artifact.storageLayout?.moderator?.slot;check(slot!==undefined,'ROLLING_ABI_MISMATCH');
    const head=await session.node.getBlockData('checkpointed'),number=Number(head?.header?.globalVariables?.blockNumber),hash=hashText(head?.blockHash);
    check(Number.isSafeInteger(number)&&number>0,'ROLLING_INVALID_RESPONSE');await guard();
    const address=new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.board)));
    const moderator=field((await session.node.getPublicStorageAt({hash},address,new sdk.Fr(BigInt(slot)))).toString(),true);
    await guard();const again=await session.node.getBlockData(number);
    check(hashText(again?.blockHash)===hash&&Number(again?.header?.globalVariables?.blockNumber)===number,'ROLLING_CONTEXT_CHANGED');await guard();
    return {authorized:field(owner,true)===moderator};
  }
  async function moderationArguments(action,board){
    check((await moderatorStatus()).authorized,'ROLLING_MODERATOR_REQUIRED');
    const policy=await utility(board,'main_policy',[]);check(Array.isArray(policy)&&policy.length===2,'ROLLING_POLICY_UNAVAILABLE');
    const mainVersion=version(String(BigInt(policy[0]))),mainDigest=field(policy[1]);
    const review={mainVersion,mainDigest};let args;
    if(action.type==='set-main-policy')args=text(action.rules,32);
    else{
      const reason=text(action.reason,7);
      if(action.type==='moderate-post'){
        const id=field(action.post,true),post=await utility(board,'get_post',[id]);
        check(Array.isArray(post)&&post.length===5&&post[0]===true&&BigInt(post[2])===0n,'ROLLING_MODERATION_TARGET_CHANGED');
        const subboard=field(post[1].subboard),localVersion=subboard===zero?0:1;
        Object.assign(review,{target:id,localVersion});args=[id,mainVersion,localVersion,...reason];
      }else if(action.type==='moderate-avatar'){
        const id=field(action.name,true),profile=await utility(board,'profile_state',[id]),removed=await utility(board,'avatar_moderation',[id]);
        const avatarVersion=version(String(BigInt(profile.avatar_version)));
        check(BigInt(profile.avatar_length)>0n&&BigInt(removed.avatar_version)!==BigInt(avatarVersion),'ROLLING_MODERATION_TARGET_CHANGED');
        Object.assign(review,{target:id,avatarVersion,avatarDigest:field(profile.avatar_digest)});args=[id,avatarVersion,mainVersion,...reason];
      }else{
        check(action.type==='reject-subboard');const id=field(action.subboard,true),state=await utility(board,'subboard_state',[id]);
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
  const bokContract=()=>{check(bok,'ROLLING_BOK_UNAVAILABLE');return sdk.Contract.at(new sdk.AztecAddress(new sdk.Fr(BigInt(bok.address))),deployment.bok.artifact,session.wallet);};
  const uint128=value=>{check(typeof value==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(value)&&BigInt(value)<(1n<<128n));return BigInt(value);};
  async function bokContext(){
    check(bok,'ROLLING_BOK_UNAVAILABLE');await guard();
    const plugin=await utility(await contract(),'get_plugin',[bok.pluginId]);
    check(plugin?.enabled===true&&field(plugin.adapter,true)===field(bok.address,true),'ROLLING_BOK_UNAVAILABLE');
    await guard();return bokContract();
  }
  async function bokCredit(){
    const current=await bokContext(),credit=BigInt(await utility(current,'balance_of',[session.owner],deployment.bok.artifact));
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
    checkBokRecord(source);
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
  async function selectedContract(record){return record.action.type==='claim-private-fee'?null:record.bok?.phase==='authorize'||['claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(record.action.type)?bokContract():contract();}
  async function interaction(board,record){
    check((record.bok?.phase==='post'?'post_with_bok':methods[record.action.type])===record.method,'ROLLING_INTENT_CHANGED');
    if(record.action.type==='claim-private-fee'){
      check(typeof sdk.BatchCall==='function'&&same(record.args,[]),'ROLLING_FUNDING_UNAVAILABLE');
      // The existing payment method supplies FeeJuice.claim + mint_and_pay_fee.
      // An actual SDK empty application batch adds no second mint or board action.
      const encoded=[];if(record.encoded)check(same(record.encoded,encoded),'ROLLING_INTENT_CHANGED');
      return {call:new sdk.BatchCall(session.wallet,[]),encoded};
    }
    let call=board.methods[record.method](...record.args);
    const selectedArtifact=record.bok?.phase==='authorize'||['claim-bok','withdraw-bok','cancel-bok-request','expire-bok-request'].includes(record.action.type)?deployment.bok.artifact:deployment.board.artifact;
    const abi=[...selectedArtifact.functions,...(selectedArtifact.nonDispatchPublicFunctions??[])].find(f=>f.name===record.method);check(abi,'ROLLING_ABI_MISMATCH');
    let encoded=sdk.encodeArguments(abi,record.args).map(f=>f.toString());
    if(record.action.type==='claim-deposit'&&record.action.bokReceipt!==undefined){
      checkBokRecord(record);check(record.fundingBok&&typeof sdk.BatchCall==='function','ROLLING_FUNDING_UNAVAILABLE');
      const bokAbi=deployment.bok.artifact.functions.find(f=>f.name==='claim');check(bokAbi,'ROLLING_ABI_MISMATCH');
      encoded=[encoded,sdk.encodeArguments(bokAbi,record.fundingBok.args).map(f=>f.toString())];
      call=new sdk.BatchCall(session.wallet,[call,(await bokContract()).methods.claim(...record.fundingBok.args)]);
    }
    if(record.encoded)check(JSON.stringify(encoded)===JSON.stringify(record.encoded),'ROLLING_INTENT_CHANGED');
    return {call,encoded};
  }
  async function collateralInfo(id,board,timestamp){
    const values=await utility(board,'get_deposit_info',[session.owner,id]);
    check(Array.isArray(values)&&values.length===10,'ROLLING_INVALID_RESPONSE');
    const v=values.map(chainValue);check(v[0]===1n&&v[1]===BigInt(id)&&v[2]>0n&&v[2]<(1n<<96n)&&v[3]>0n&&v[3]<(1n<<160n)&&
      v[5]<(1n<<64n)&&v[7]<=v[5]&&v[8]<=v[5]&&v[9]<(1n<<64n),'ROLLING_INVALID_RESPONSE');
    return {id:field(id,true),amount:String(v[2]),depositor:'0x'+v[3].toString(16).padStart(40,'0'),
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
    const current=await balanceAnchor();check(same(current,anchor),'ROLLING_CONTEXT_CHANGED');
    const block=await session.node.getBlockData(anchor.blockNumber);check(Number(block?.header?.globalVariables?.blockNumber)===anchor.blockNumber&&hashText(block.blockHash)===anchor.blockHash,'ROLLING_CONTEXT_CHANGED');await guard();
  }
  async function refundComplete(record){return !!verifyWithdrawal&&await verifyWithdrawal(clone(summary(record)))===true;}
  return Object.freeze({
    async readWithdrawal(){return exclusive(async()=>{await guard();const saved=await (await slot()).read();
      if(!['withdraw','withdraw-bok'].includes(saved.value?.action?.type)||!saved.value.withdrawal)return null;
      if(['prepared','cancelled'].includes(saved.value.status))return summary(saved.value);
      return outcome(saved);
    });},
    async readBokAccounting({cursor=0}={}){return exclusive(async()=>{
      check(bok&&readAccountingPage,'ROLLING_BOK_ACCOUNTING_UNAVAILABLE');
      const anchor=await balanceAnchor();
      if(cursor===0){accountingScan={token:crypto.randomUUID(),anchor,offset:0,owned:new Set(),phase:'owned-requests',publicCursor:null,revision:null,descriptor:null,lastId:0n,matched:new Map()};completedAccounting=null;}
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
          const page=await readAccountingPage({limit:50,cursor:scan.publicCursor});
          check(page?.schemaVersion===1&&page.complete===true&&page.checkpoint?.number===anchor.blockNumber&&page.checkpoint?.hash===anchor.blockHash&&typeof page.revision==='string'&&page.revision.length>0&&page.revision.length<=256,'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          const scope=page.scope,b=page.bokScope,instance=deployment.bok.instance;
          check(scope?.chainId===fixed.network.chainId&&scope.rollupVersion===fixed.network.version&&scope.rollupAddress===fixed.network.rollup&&scope.boardAddress===fixed.board&&same(scope.bok,b)&&b?.address===bok.address&&b.operatorAddress===bok.operator&&b.classId===instance?.currentContractClassId.toString()&&b.classId===instance?.originalContractClassId.toString()&&b.deployer===instance?.deployer.toString()&&b.salt===instance?.salt.toString(),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          check(b.deployment&&Number.isSafeInteger(b.deployment.blockNumber)&&b.deployment.blockNumber>0&&b.deployment.blockNumber<=anchor.blockNumber&&/^0x[0-9a-f]{64}$/.test(b.deployment.blockHash)&&/^0x[0-9a-f]{64}$/.test(b.deployment.txHash),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          if(scan.revision===null){scan.revision=page.revision;scan.descriptor=clone(b);}else check(page.revision===scan.revision&&same(b,scan.descriptor),'ROLLING_BOK_ACCOUNTING_INCOMPLETE');
          check(Array.isArray(page.requests)&&page.requests.length<=50&&(page.nextCursor===null||typeof page.nextCursor==='string'&&/^[0-9a-f]{32}:[0-9a-f]{64}:[0-9a-f]{16}$/.test(page.nextCursor)&&page.nextCursor!==scan.publicCursor),'ROLLING_INVALID_RESPONSE');
          for(const row of page.requests){
            const id=field(row.requestId,true);check(BigInt(id)>scan.lastId&&['1','2','3','4'].includes(row.state)&&typeof row.sequence==='string'&&/^(0|[1-9][0-9]*)$/.test(row.sequence)&&BigInt(row.sequence)<=0xffffffffn,'ROLLING_INVALID_RESPONSE');scan.lastId=BigInt(id);
            const amounts=['budget','available','reserved','charged','refunded'].map(k=>uint128(row[k]));check(amounts[0]===amounts.slice(1).reduce((a,b)=>a+b,0n),'ROLLING_INVALID_RESPONSE');
            const p=row.position;check(p&&typeof p.blockNumber==='string'&&/^[1-9][0-9]*$/.test(p.blockNumber)&&BigInt(p.blockNumber)<=BigInt(anchor.blockNumber)&&/^0x[0-9a-f]{64}$/.test(p.blockHash)&&/^0x[0-9a-f]{64}$/.test(p.txHash)&&['txIndexWithinBlock','logIndexWithinTx'].every(k=>typeof p[k]==='string'&&/^(0|[1-9][0-9]*)$/.test(p[k])),'ROLLING_INVALID_RESPONSE');
            if(scan.owned.has(id))scan.matched.set(id,{requestId:id,state:row.state,sequence:row.sequence,...Object.fromEntries(['budget','available','reserved','charged','refunded'].map(k=>[k,row[k]]))});
          }
          check(page.nextCursor===null||page.requests.length>0,'ROLLING_INVALID_RESPONSE');scan.publicCursor=page.nextCursor;
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
    async readBalances({cursor=0}={}){return exclusive(async()=>{
      const continuation=balanceContinuation;check(cursor===0||typeof cursor==='string'&&continuation?.token===cursor,'ROLLING_BALANCE_CURSOR_INVALID');
      const offset=cursor===0?0:continuation.offset;check(offset<=0xffffffff-10);const anchor=await balanceAnchor(),board=await contract();
      if(cursor!==0)check(same(anchor,continuation.anchor),'ROLLING_BALANCE_CURSOR_INVALID');
      const ids=await utility(board,'get_deposit_ids',[session.owner,offset]);check(Array.isArray(ids)&&ids.length===10,'ROLLING_INVALID_RESPONSE');
      const deposits=[],seen=new Set();let empty=false;
      for(const value of ids){const id=field(value);if(BigInt(id)===0n){empty=true;continue;}check(!empty&&!seen.has(id),'ROLLING_INVALID_RESPONSE');seen.add(id);deposits.push(await collateralInfo(id,board,BigInt(anchor.timestamp)));}
      const feeContract=await sdk.Contract.at(new sdk.AztecAddress(new sdk.Fr(BigInt(fixed.fee))),deployment.privateFee.artifact,session.wallet);
      const fee=chainValue(await utility(feeContract,'balance_of',[session.owner],deployment.privateFee.artifact));check(fee<(1n<<128n),'ROLLING_INVALID_RESPONSE');
      let credit=null;if(bok){const current=await bokContract(),available=chainValue(await utility(current,'balance_of',[session.owner],deployment.bok.artifact));check(available<(1n<<128n),'ROLLING_INVALID_RESPONSE');
        credit={available:String(available),token:'USDC',availableMeaning:'unallocated-private-credit',requestsComplete:false,requests:[]};

      }
      const pending=(await (await slot()).read()).value;
      const reservation=pending&&['submitting','unknown'].includes(pending.status)?{status:'unresolved',maximumFee:pending.maximumFee}:null;
      await checkBalanceAnchor(anchor);balanceContinuation=empty?null:{token:crypto.randomUUID(),offset:offset+10,anchor:clone(anchor)};return {anchor,fee:{available:String(fee),token:'FEE',complete:true,availableMeaning:'settled-private-credit',pendingReservation:reservation,withdrawal:'not-supported'},bok:credit,
        collateral:{deposits,complete:empty,nextCursor:balanceContinuation?.token??null}};
    });},
    async readModeratorStatus(){return exclusive(moderatorStatus);},
    async readBokStatus(){return exclusive(async()=>{if(!bok)return {available:false};try{return {available:true,availableCredit:String(await bokCredit()),pluginId:bok.pluginId};}catch(error){if(error?.code==='ROLLING_BOK_UNAVAILABLE')return {available:false};throw error;}});},
    async readAccountStatus(){
      if(!session)return {status:'locked'};
      return exclusive(async()=>{await guard();const saved=await (await slot()).read();
        if(saved.value&&saved.value.status!=='cancelled'){
          checkBokRecord(saved.value);
          if(!['confirmed','reverted'].includes(saved.value.status))return {status:'recovering',intent:summary(saved.value)};
          const canonical=await outcome(saved);if(canonical.status==='confirmed'&&saved.value.withdrawal&&!await refundComplete({...saved.value,txHash:canonical.txHash}))return {status:'recovering',intent:canonical};if(!['confirmed','reverted'].includes(canonical.status))return {status:'recovering',intent:canonical};
        }
        let fee;try{fee=await payment();}catch(error){if(error.code==='PRIVATE_FEE_BALANCE_INSUFFICIENT')return {status:'fee-needed'};throw error;}
        const ids=await utility(await contract(),'get_deposit_ids',[session.owner,0]);check(Array.isArray(ids)&&ids.length===10,'ROLLING_INVALID_RESPONSE');
        return {status:ids.some(id=>BigInt(id)!==0n)?'fee-ready':'collateral-pending',privateFeeCredit:String(fee.availableCredit),
          depositIds:ids.filter(id=>BigInt(id)!==0n),postEligibility:'requires-action-simulation'};
      });
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
    async readPreferenceHead(){return exclusive(async()=>Object.freeze(await preferenceHead()));},
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
    async prepare(input){return exclusive(async()=>{await guard();const action=clone(input),store=await slot();let prior=await store.read();
      if(prior.value&&prior.value.status!=='cancelled'){check(['confirmed','reverted'].includes(prior.value.status),'ROLLING_RECOVERY_REQUIRED');
        const final=await outcome(prior);check(['confirmed','reverted'].includes(final.status),'ROLLING_RECOVERY_REQUIRED');if(final.status==='confirmed'&&prior.value.withdrawal)check(await refundComplete({...prior.value,txHash:final.txHash}),'ROLLING_WITHDRAWAL_RECOVERY_REQUIRED');prior=await store.read();}
      const previousTx=await session.journal.assertCanStart();
      const predecessor=previousTx?.value?{operation:previousTx.value.operation??null,txHash:previousTx.value.txHash}:null;
      const nonce=field(sdk.Fr.random().toString(),true),id=field(sdk.Fr.random().toString(),true),board=await contract();
      const allowed=keys[action?.type];check(allowed&&Object.keys(action).every(key=>key==='type'||allowed.includes(key)));
      const moderation=moderationTypes.has(action.type)?await moderationArguments(action,board):null;
      const args=moderation?moderation.args:plain(await argumentsFor(action,board,nonce));
      const record={version:1,id,action,args,method:methods[action.type],nonce,predecessor,status:'prepared',...(moderation?{moderation:moderation.review}:{})};
      if(action.type==='name')record.nameAvailability=await nameAvailability(action);
      if(action.type==='withdraw'){const anchor=await balanceAnchor();record.withdrawal=await collateralInfo(action.deposit,board,BigInt(anchor.timestamp));check(record.withdrawal.eligible,'ROLLING_WITHDRAWAL_NOT_READY');await checkBalanceAnchor(anchor);}
      if(action.type==='withdraw-bok'){
        check(resolveBokWithdrawal,'ROLLING_BOK_UNAVAILABLE');const anchor=await balanceAnchor(),available=chainValue(await utility(await bokContract(),'balance_of',[session.owner],deployment.bok.artifact));check(available>=uint128(action.amount),'ROLLING_BOK_CREDIT_INSUFFICIENT');
        const scope=await resolveBokWithdrawal();check(scope.recipient===bok.address,'ROLLING_CONTEXT_CHANGED');
        record.withdrawal={kind:'bok',amount:action.amount,depositor:action.recipient,nonce,eligible:true,bokScope:clone(scope)};await checkBalanceAnchor(anchor);
      }
      if(action.type==='claim-deposit'&&action.bokReceipt!==undefined)record.fundingBok=await bokFundingClaim(action);
      if(action.type==='claim-bok')record.fundingBok={scope:clone(bok),args:clone(args)};
      // Expiry selection is private and owned; the contract simulation, not the
      // public accounting snapshot or browser clock, decides deadline eligibility.
      if(action.type==='expire-bok-request')record.bokRequestScope=clone(bok);
      if(action.type==='bok'){
        const budget=uint128(action.budget);check(budget>0n);const available=await bokCredit();check(available>=budget,'ROLLING_BOK_CREDIT_INSUFFICIENT');
        const draft=args[2],requestId=field(sdk.Fr.random().toString(),true);
        const target=await bokInvocationTarget(draft,nonce,action.content);
        record.bok={scope:clone(bok),phase:'authorize',requestId,target,budget:String(budget),availableCredit:String(available),postArgs:args};
        record.args=[requestId,target,String(budget)];
      }
      if(preferenceAction(record)){record.originalPreferenceHead=await preferenceHead();check(record.originalPreferenceHead.revision===action.expectedRevision,'ROLLING_RECOVERY_CONTEXT_CHANGED');}
      if(action.type==='read-marker')record.originalMarker=await markerContext(record);
      const selected=await interaction(await selectedContract(record),record);record.encoded=selected.encoded;
      progress('estimating');const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(action,record),from:session.owner,guard});
      record.maximumFee=estimated.maximumFee.toString();await guard();await store.write(prior,record);return summary(record);
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
    async prepareBokPost(id){return exclusive(async()=>{
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
      progress('estimating');const estimate=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(),from:session.owner,guard});record.maximumFee=estimate.maximumFee.toString();
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
      await guard();const saved=await savedIntent(id);check(await preproofAvailable(saved),'ROLLING_RECOVERY_REQUIRED');
      const record=saved.value;await session.wallet.pxe.sync();await checkActionSubmission(record);await checkActionRecoveryContext(record);await checkPreproofPreferenceContext(record);
      const selected=await interaction(await selectedContract(record),record);progress('estimating');
      const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,
        prepared:await payment(record.action,record),from:session.owner,guard});
      await checkPreproofPreferenceContext(record,{synchronize:true});
      check(await preproofAvailable(saved),'ROLLING_RECOVERY_REQUIRED');await guard();
      // Exact CAS revokes the old attempt. A late proof must fail its lifecycle
      // guard before journal.prepare, and again before any broadcast.
      const next={...record,status:'prepared',maximumFee:estimated.maximumFee.toString(),preproofReview:record.preproof};delete next.preproof;
      await (await slot()).write(saved,next);return summary(next);
    });},
    async prepareReplacement(id,input){
      // Capture only own data primitives before any asynchronous guard or RPC.
      let reviewInput,expectedHead=null;try{
        const hasHead=Object.hasOwn(input??{},'expectedHead');
        reviewInput=exactData(input,hasHead?(Object.hasOwn(input??{},'expectedMarkerHash')?['expectedTxHash','expectedHead','expectedMarkerHash']:['expectedTxHash','expectedHead']):['expectedTxHash']);
        if(hasHead)expectedHead=exactData(reviewInput.expectedHead,['initialized','schema','revision','digest']);
      }catch{throw fail('ROLLING_INVALID_ACTION');}
      check(typeof reviewInput.expectedTxHash==='string'&&/^0x[0-9a-f]{64}$/.test(reviewInput.expectedTxHash));
      if(expectedHead){check(typeof expectedHead.initialized==='boolean'&&expectedHead.schema===1);preferenceRevision(expectedHead.revision);
        check(typeof expectedHead.digest==='string'&&/^(0|[1-9][0-9]*)$/.test(expectedHead.digest)&&BigInt(expectedHead.digest)<FIELD_MODULUS);}
      if(Object.hasOwn(reviewInput,'expectedMarkerHash'))check(typeof reviewInput.expectedMarkerHash==='string'&&/^0x[0-9a-f]{64}$/.test(reviewInput.expectedMarkerHash));
      return exclusive(async()=>{await guard();const saved=await savedIntent(id),record=saved.value;
        check(!['prepared','cancelled'].includes(record.status),'ROLLING_RECOVERY_REQUIRED');
        const snapshot=await recoverySnapshot(saved);
        check(snapshot.status==='replacement-available'&&snapshot.currentTxHash===reviewInput.expectedTxHash,'ROLLING_RECOVERY_REQUIRED');
        check(preferenceAction(record)===(expectedHead!==null)&&same(snapshot.head,expectedHead),'ROLLING_RECOVERY_CONTEXT_CHANGED');
        check(record.action.type==='read-marker'?Object.hasOwn(reviewInput,'expectedMarkerHash')&&snapshot.marker.blockHash===reviewInput.expectedMarkerHash:!Object.hasOwn(reviewInput,'expectedMarkerHash'),'ROLLING_RECOVERY_CONTEXT_CHANGED');
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
      }else if(saved.value.predecessor){
        const found=await session.journal.inspectOutcome();acknowledge(found,saved.value.predecessor);
      }
      await session.journal.assertCanStart(); // Before private simulation, not merely before send.
      await checkActionSubmission(saved.value);
      const selected=await interaction(await selectedContract(saved.value),saved.value);progress('estimating');
      const estimated=await sdk.estimatePrivateFeeTransaction({wallet:session.wallet,node:session.node,interaction:selected.call,prepared:await payment(saved.value.action,saved.value),from:session.owner,guard});
      const maximumFee=replacing?saved.value.replacementReview.maximumFee:saved.value.maximumFee;
      check(estimated.maximumFee<=BigInt(maximumFee),'ROLLING_FEE_CHANGED');await guard();
      let attempt=null,active;
      if(saved.value.preproofReview&&!replacing){
        check(localPreproof&&await privateStore.readRecoveryEpoch()===saved.value.preproofReview.epoch&&
          await journalCommitment()===saved.value.preproofReview.predecessor,'ROLLING_RECOVERY_REQUIRED');
        await checkPreproofPreferenceContext(saved.value,{synchronize:true});
      }
      if(localPreproof&&!replacing){
        const epoch=await privateStore.ensureRecoveryEpoch();check(typeof epoch==='string'&&/^[0-9a-f]{64}$/.test(epoch),'ROLLING_RECOVERY_REQUIRED');
        attempt={version:1,epoch,attempt:field(sdk.Fr.random().toString(),true),predecessor:await journalCommitment()};
        await guard();check(await privateStore.readRecoveryEpoch()===epoch,'ROLLING_RECOVERY_REQUIRED');
      }
      await (await slot()).write(saved,{...saved.value,status:attempt?'pre-proof':'submitting',...(attempt?{preproof:attempt}:{})});
      active=await savedIntent(id);await guard();progress('submitting');
      const options={from:session.owner,fee:{gasSettings:estimated.gasSettings},
        transactionJournal:session.journal,journalOperation:operation(id),...(saved.value.bokReleaseSource?{beforeSubmit:()=>checkBokRelease(saved.value.bokReleaseSource,saved.value.action.type)}:{}),...(saved.value.moderation?{beforeSubmit:async()=>{await checkModeration(saved.value);await guard();}}:{}),...(saved.value.bok?{beforeSubmit:async()=>{
          await checkBokThread(saved.value.action,await contract());
          if(saved.value.bok.phase==='post')await waitingBok(saved.value);else await bokContext();await guard();
        }}:{}),...(replacing?{beforeSubmit:async hash=>{
          await session.journal.assertReplacementPredecessors(operation(id),hash,{requireMissingAnchor:true});
          // Predecessor validation itself awaits the node. Refresh the signed
          // action's context afterwards, not before that asynchronous window.
          await checkReplacementReview(saved.value,{synchronize:true});await guard();
        }}:{})};
      if(attempt){
        const verify=async phase=>{
          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch,'ROLLING_RECOVERY_REQUIRED');
          const current=await savedIntent(id);check(current.encoded===active.encoded&&same(current.value.preproof,attempt)&&
            current.value.status===(phase==='signed'?'submitting':'pre-proof'),'ROLLING_RECOVERY_REQUIRED');
          if(phase==='pre-proof')check(await journalCommitment()===attempt.predecessor,'ROLLING_RECOVERY_REQUIRED');
          else {const tx=await session.journal.inspect();check(tx?.operation===operation(id)&&tx.txHash===current.value.txHash,'ROLLING_RECOVERY_REQUIRED');}
          await checkPreproofPreferenceContext(current.value,{synchronize:true});
          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch&&(await savedIntent(id)).encoded===active.encoded,'ROLLING_RECOVERY_REQUIRED');
        };
        await localPreproof.send(estimated.payload,options,{guard:verify,signed:async txHash=>{
          await guard();check(await privateStore.readRecoveryEpoch()===attempt.epoch&&(await savedIntent(id)).encoded===active.encoded,'ROLLING_RECOVERY_REQUIRED');
          const tx=await session.journal.inspect();check(tx?.operation===operation(id)&&tx.txHash===txHash,'ROLLING_RECOVERY_REQUIRED');
          await (await slot()).write(active,{...active.value,status:'submitting',txHash});active=await savedIntent(id);
        }});
      }else await session.wallet.sendTx(estimated.payload,options);
      return outcome(await savedIntent(id));
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
