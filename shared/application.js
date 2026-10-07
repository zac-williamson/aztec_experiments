// Browser application boundary. SDK objects and transaction acknowledgements stay here.
/**
 * @typedef {'status'|'balance'|'deposit'|'claim'|'post'|'withdraw'|'claim-l1'|'recover'|'recover-eth'|'recover-l2'|'declare-immoral'|'set-moderation-policy'|'transfer-censor'|'deploy'} BoardAction
 * @callback BoardProgress
 * @param {string} message
 * @param {string} [level]
 * @returns {void}
 * @typedef {Object} BoardInput
 * @property {string} [message] Public post text, at most 992 UTF-8 bytes.
 * @property {boolean} [isDummy] Advance screening without publishing text.
 * @property {string} [depositAmount] Decimal token amount.
 * @property {string} [reuseTxHash] Existing Ethereum deposit hash.
 * @property {number} [maxScreeningSteps]
 * @property {string} [maximumCreditSpend]
 * @property {boolean} [prepareWithdrawal]
 * @property {string} [postId]
 * @property {string} [expectedPolicyVersion]
 * @property {boolean} [retryEthereum] Retry the saved request with its original nonce.
 * @property {number} [postIndex] Public post index to flag.
 * @property {string} [censorResponse] Public removal reason.
 * @property {string} [newCensor] Replacement Aztec moderator address.
 * @property {{txHash:string,operation:string,policyVersion:string,allowReplacement:boolean}} [moderatorRecovery]
 * @property {string} [moderationPolicy] New policy text.
 * @property {object} [fundingRecord] Public fee-deposit recovery record.
 * @property {string} [readyTxHash] Saved deployment activation transaction.
 * @property {string} [dataDirPrefix] Deployment storage namespace.
 * @typedef {Object} BoardResult
 * @property {string} [state] Engine outcome, e.g. postable or transaction_recovered.
 * @property {string} [status] Deployment activation status.
 * @property {string} [outcome] Ethereum funding outcome.
 * @property {string} [amount]
 * @property {string} [feeBalance]
 * @property {string} [refundAmount]
 * @property {string} [refundRecipient]
 * @property {boolean} [claimConsumed]
 * @property {string} [lastL2TxHash]
 * @property {string} [lastEthereumTxHash]
 * @property {string|null} [withdrawTxHash]
 * @property {string} [l2Addr]
 * @property {string} [portalAddr]
 * @property {string} [feePayer]
 * @property {{txHash:string}} [depositInfo]
 * @property {object} [record] Public fee recovery data.
 */
/**
 * One instance per page. Application state survives UI rendering; reload clears it.
 * @param {{kind?: 'author'|'moderator'|'fees'|'deploy', deploymentConfig?: ()=>{deploymentManifest:any}, pause?: Function}} options
 */
function createBillboardApplication({kind='author',deploymentConfig,pause}={}) {
  const operation=window.BillboardOperations.create();
  let workflow=false,pauseRequested=false,lastIntent=null,moderatorRecoveryReview=null;
  let handles=null,withdrawTxHash,revision=0,fundingRecord=null,savedOperation=null;
  const journalAcknowledgements=new Map(),ethereumAcknowledgements=new Map();
  const isBoard=kind==='author'||kind==='moderator';
  const execute=makeCallEngine((env,config)=>kind==='deploy'?runDeploy(env,config):kind==='fees'?runFeeJuiceFlow(env,config):runBillboardUser(env,config),{
    ...(isBoard||kind==='deploy'?{artifact:BILLBOARD_ARTIFACT,portalBytecode:PORTAL_BYTECODE}:{}),
    ...(kind!=='deploy'?{privateFeeArtifact:BILLBOARD_PRIVATE_FEE_ARTIFACT}:{}),
    ...(pause?{pause}:{}),
    createJournalStorage:()=>window.__aztec.createBrowserJournalStorage(),
    createTransactionJournal:options=>window.__aztec.createL2Journal({...options,storage:window.__aztec.createBrowserJournalStorage()}),
    createEthereumJournal:options=>window.__aztec.createEthereumJournal({...options,storage:window.__aztec.createBrowserJournalStorage()}),
    fundPrivateFees:options=>window.__aztec.fundPrivateFees(options),
  },{deployment:kind==='deploy',connection:deploymentConfig});
function saveFundingRecord(record) {
  // This record contains public recovery metadata, not the derived salt or claim secret.
  const allowed=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
  if(!record || record.schema!=='private-fee-funding-v1' || Object.keys(record).some(key=>!allowed.includes(key))) throw new Error('Invalid recovery record.');
  const text = JSON.stringify(record);
  const key='billboard-private-fee-recovery:'+JSON.stringify([record.chainId,record.rollupAddress,record.privateFeeAddress,record.sender,record.nonce]);
  const priorText=localStorage.getItem(key);
  if(priorText){
    const prior=JSON.parse(priorText);
    const fields=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount'];
    if(fields.some(field=>prior[field]!==record[field]) || (prior.txHash && prior.txHash!==record.txHash) ||
       (prior.leafIndex!==undefined && prior.leafIndex!==record.leafIndex)) throw new Error('Recovery record conflicts with a previous deposit.');
  }
  localStorage.setItem(key, text);
  localStorage.setItem('billboard-private-fee-recovery-latest',key);
  fundingRecord = record;
  return record;
}
  function readFundingRecovery() {
    if(fundingRecord)return fundingRecord;
    const key=localStorage.getItem('billboard-private-fee-recovery-latest');
    const saved=key&&localStorage.getItem(key);
    return saved?saveFundingRecord(JSON.parse(saved)):null;
  }
  async function prepareDeployment(board) {
    if(kind!=='deploy')throw Error('Deployment interface required.');
    const expected=stamp(),account=window.BillboardAccount.snapshot(),a=window.__aztec;
    if(!account.address||!account.ethereumConnected)throw Object.assign(Error('Connect both accounts first.'),{code:'BB_WALLET_NOT_READY'});
    const hosted=await window.loadHostedSettings(),n=hosted.network,node=a.createAztecNodeClient(n.nodeUrl),info=await node.getNodeInfo();
    if(String(info.l1ChainId)!==n.chainId||String(info.rollupVersion)!==n.rollupVersion||info.l1ContractAddresses.rollupAddress.toString().toLowerCase()!==n.rollupAddress)throw Object.assign(Error('Network changed.'),{code:'BB_CONNECTION_VERIFICATION_FAILED'});
    const hash=value=>ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(value)));
    const manifest=a.validateDeploymentManifest({schemaVersion:1,profile:'operator',network:{nodeUrl:n.nodeUrl,ethRpcUrl:n.ethRpcUrl,chainId:n.chainId,rollupVersion:n.rollupVersion,rollup:n.rollupAddress,inbox:info.l1ContractAddresses.inboxAddress.toString().toLowerCase(),outbox:info.l1ContractAddresses.outboxAddress.toString().toLowerCase()},actors:{aztecDeployer:account.address.toLowerCase(),ethereumDeployer:account.ethereumAddress.toLowerCase()},board:{...board,salt:a.Fr.random().toBigInt().toString(),minDeposit:ethers.parseEther(board.minDeposit).toString(),maxDeposit:ethers.parseEther(board.maxDeposit).toString()},artifacts:{boardJsonSha256:hash(BILLBOARD_ARTIFACT),boardClassId:window.BillboardPublic.metadata.classId,portalCreationSha256:ethers.sha256(PORTAL_BYTECODE),portalRuntimeMetadataSha256:hash(a.portalRuntimeMetadata)}});
    check(expected);return {manifest,gas:hosted.privateFee?.gasSettings||null};
  }
  async function publicConfiguration(result,gasSettings,manifest) {
    if(kind!=='deploy')throw Error('Deployment configuration required.');
    const n=manifest.network;
    const privateFee=gasSettings?{contractAddress:(await window.__aztec.derivePrivateFeeAddress(BILLBOARD_PRIVATE_FEE_ARTIFACT)).toString(),gasSettings}:null;
    return window.BillboardConfig.validate({schemaVersion:1,network:{nodeUrl:n.nodeUrl,ethRpcUrl:n.ethRpcUrl,chainId:n.chainId,rollupVersion:n.rollupVersion,rollupAddress:n.rollup},board:{portalAddress:result.portalAddr.toLowerCase(),contractAddress:result.l2Addr.toLowerCase()},privateFee});
  }
  async function deploymentCapabilities(result,manifest) {
    const report={reading:'not-checked',hostedReading:false,deposits:result.status==='active'?'verified':'pending',posting:'not-checked',remoteProver:'not-configured',moderator:'configured'};
    if(result.status!=='active')return report;
    const exported=await publicConfiguration(result,null,manifest);
    try {
      await window.BillboardPublic.connectPublicBoard({network:exported.network,boardAddress:exported.board.contractAddress,metadata:window.BillboardPublic.metadata,storage:window.BillboardPublic.browserPublicFeedStorage()});
      report.reading='verified';
    } catch { report.reading='unavailable'; }
    try {
      const hosted=await window.loadHostedSettings();
      if(['chainId','rollupVersion','rollupAddress'].some(key=>String(hosted.network[key]).toLowerCase()!==String(exported.network[key]).toLowerCase()) )return report;
      await window.BillboardPublic.connectPublicBoard({network:hosted.network,boardAddress:exported.board.contractAddress,metadata:window.BillboardPublic.metadata,storage:window.BillboardPublic.browserPublicFeedStorage()});report.hostedReading=true;
      if(!hosted.privateFee)return report;
      const config=window.BillboardConfig.validate({...exported,network:hosted.network,privateFee:hosted.privateFee});
      await window.BillboardConnectionCheck.verify({sdk:window.__aztec,ethers,config,privateFeeArtifact:BILLBOARD_PRIVATE_FEE_ARTIFACT,verifyFee:true});
      report.posting='configuration-verified';
      if(hosted.board.contractAddress===exported.board.contractAddress&&hosted.remoteProver)report.remoteProver='configured';
    } catch { report.posting='not-checked'; }
    return report;
  }
  function stamp(){return JSON.stringify([revision,_getConfigRevision(),_walletGeneration]);}
  function check(expected){_assertWalletLive();if(stamp()!==expected)throw Error('Account or configuration changed. Reconnect.');}
  function connectedHandles(){_assertWalletLive();if(!handles)throw Error('Board account is not connected.');return handles;}
  /** @param {BoardAction} action @param {BoardInput} input @param {BoardProgress} onProgress @returns {Promise<BoardResult>} */
  async function runEngine(action,input={},onProgress=()=>{}) {
    const expected=stamp(),ws=window.walletState;
    const identity=JSON.stringify([ws.aztec?.address.toString(),_getConfigRevision(),_getPublicConfig()]);
    const common=isBoard?{portalAddress:_getPublicConfig()?.board.portalAddress,dataDirPrefix:kind==='moderator'?'pxe_bb_censor_':'pxe_bb_',
      depositChainId:handles?.depositChainId,withdrawTxHash,
      claimSecretStore:makeClaimSecretStore(ws.aztec?.secretKey,ws.aztec?.salt),censorWalletJson:ws.aztec?.raw}:{};
    const result=await execute(action,onProgress,{...common,...input,...(['fees','author'].includes(kind)?{saveRecovery:saveFundingRecord}:{}),...(kind==='author'?{automaticFeeFunding:true}:{}),pauseRequested:()=>pauseRequested,provingMode:operation.snapshot().mode,onStage:stage=>operation.progress(stage),acknowledgeTx:journalAcknowledgements.get(identity),acknowledgeEthereumTx:ethereumAcknowledgements.get(identity)});
    check(expected);
    if(result?.lastL2TxHash)journalAcknowledgements.set(identity,result.lastL2TxHash);
    if(result?.lastEthereumTxHash)ethereumAcknowledgements.set(identity,result.lastEthereumTxHash);
    if(result?.handles)handles=result.handles;
    if(result&&Object.hasOwn(result,'withdrawTxHash'))withdrawTxHash=result.withdrawTxHash;
    if(kind==='fees'&&result.record)saveFundingRecord(result.record);
    operation.receipt(result);
    const {handles:privateHandles,receipt:privateReceipt,...data}=result;
    return data;
  }
  async function transact(action,run) {
    operation.begin(action,_getPublicConfig()?.remoteProver?.url?window.BillboardProving.snapshot():'local');pauseRequested=false;
    try {const value=await run();operation.finish();return value;}
    catch(error){const safe=publicOperationFailure(error);operation.fail(safe);throw safe;}
  }
  async function run(action,input={},onProgress=()=>{}) {
    if(workflow)throw Object.assign(Error('Wait for the current operation.'),{code:'BB_OPERATION_BUSY'});
    validateInput(action,input);
    if(!['status','recover','recover-eth','recover-l2'].includes(action))lastIntent={action,input:structuredClone(input)};
    return transact(action,()=>runEngine(action,input,onProgress));
  }
  function validateInput(action,input) {
    const invalid=(code,field)=>{throw Object.assign(Error(code),{code,field});};
    if(action==='post'&&!input.isDummy){if(typeof input.message!=='string'||!input.message.trim())invalid('BB_MESSAGE_EMPTY','msgText');if(new TextEncoder().encode(input.message).length>992)invalid('BB_MESSAGE_LONG','msgText');}
    if(action==='transfer-censor'&&(!/^0x[0-9a-fA-F]{64}$/.test(input.newCensor||'')||BigInt(input.newCensor)<=0n||BigInt(input.newCensor)>=21888242871839275222246405745257275088548364400416034343698204186575808495617n))invalid('BB_MODERATOR_ADDRESS','newCensorAddr');
    if(action==='set-moderation-policy'&&(!input.moderationPolicy?.trim()||new TextEncoder().encode(input.moderationPolicy).length>1488))invalid('BB_POLICY_LENGTH','moderationPolicyInput');
    if(action==='declare-immoral'&&((input.postIndex!==undefined&&(!Number.isSafeInteger(input.postIndex)||input.postIndex<0))||new TextEncoder().encode(input.censorResponse||'').length>200))invalid('BB_MODERATION_INPUT','censorResponseText');
  }
  // The application owns the complete funding operation. Rendering and duplicate
  // clicks cannot split it into separately initiated payment and claim actions.
  let fundingOperation=null,fundingState=null,fundingStamp=null;
  function onboardingKey(){const config=_getPublicConfig();return 'board-onboarding-v1:'+JSON.stringify([config.network,config.board,window.walletState.aztec?.address.toString(),window.walletState.ethAccount]);}
  function savedDepositInput(){try{const amount=localStorage.getItem(onboardingKey());return amount&&/^\d+(?:\.\d{1,18})?$/.test(amount)?{depositAmount:amount}:{};}catch{return {};}}
  /** @param {BoardInput} input @param {BoardProgress} onProgress @returns {Promise<BoardResult>} */
  function completeDeposit(input={},onProgress=()=>{}) {
    if(fundingOperation){check(fundingStamp);return fundingOperation;}
    if(workflow)throw Object.assign(Error('Operation in progress.'),{code:'BB_OPERATION_BUSY'});
    const expected=stamp();fundingStamp=expected;fundingState=null;
    workflow=true;
    fundingOperation=transact('onboarding',async()=>{
      let result=await runEngine('status',{},onProgress);check(expected);fundingState=result.state;
      if(result.state==='postable')return result;
      if(result.state==='zero_balance_need_deposit') {
        if(input.depositAmount)localStorage.setItem(onboardingKey(),input.depositAmount);
        if(!input.depositAmount)throw Object.assign(new Error('Select a deposit amount.'),{code:'BB_WALLET_NOT_READY'});
        result=await runEngine('deposit',input,onProgress);check(expected);fundingState='deposited_l1_not_claimed_l2';
      } else if(result.state!=='deposited_l1_not_claimed_l2') {
        throw Object.assign(new Error('Recover the existing operation before depositing.'),{code:'BB_RECOVERY_REQUIRED'});
      }
      onProgress('Deposit confirmed. Finishing setup automatically; no further Ethereum payment is needed.','info');
      check(expected);
      const claimed=await runEngine('claim',input.retryEthereum?{retryEthereum:true}:{},onProgress);check(expected);fundingState=claimed.state;localStorage.removeItem(onboardingKey());
      return claimed;
    }).finally(()=>{fundingOperation=null;workflow=false;});
    return fundingOperation;
  }
  /** @returns {Promise<{amount:bigint,depositChainId:bigint,nextAllowedTime:bigint,lastScreenedIndex:bigint,lastRealPostIndex:bigint,chainTime:number}>} */
  async function readDeposit() {
    const h=connectedHandles(),expected=stamp();
    const info=await readBillboardDepositInfo(h.contract,h.address,h.depositChainId);
    const chainTime=await getL2Timestamp(h.aztecNode);check(expected);
    if(info.amount>0n)h.depositChainId=info.depositChainId;
    return {...info,chainTime};
  }
  /** @returns {Promise<{minWei:bigint,maxWei:bigint,baseCooldown:bigint}>} */
  async function readDepositTerms() {
    const h=connectedHandles(),expected=stamp();
    const values=await Promise.all(['get_min_deposit','get_max_deposit','get_base_cooldown'].map(
      name=>h.contract.methods[name]().simulate({from:window.__aztec.NO_FROM})));
    const [minWei,maxWei,baseCooldown]=values.map(value=>extractBigInt(value));
    check(expected);
    if(minWei<=0n || maxWei<minWei || maxWei>0xffffffffffffffffffffffffn || baseCooldown<=0n || baseCooldown>0xffffffffn)throw Error('Invalid board deposit settings.');
    return {minWei,maxWei,baseCooldown};
  }
  /** @returns {Promise<string>} */
  async function readPolicy() {
    const h=connectedHandles(),expected=stamp();
    const result=await h.contract.methods.get_moderation_policy().simulate({from:window.__aztec.NO_FROM});check(expected);
    const fields=result?.result?.[0],length=Number(result?.result?.[1]??0);
    return length>0?window.unpackFieldsToString(fields,length):'';
  }
  async function readPolicyReview() {
    const h=connectedHandles(),expected=stamp();
    const value=await h.contract.methods.get_moderation_policy_snapshot().simulate({from:window.__aztec.NO_FROM});check(expected);
    const tuple=value?.result??value;
    return {text:window.unpackFieldsToString(tuple[0],Number(tuple[1])),version:tuple[2].toString()};
  }
  function reviewPolicyChange(moderationPolicy){validateInput('set-moderation-policy',{moderationPolicy});return {moderationPolicy};}
  function reviewTransfer(address){validateInput('transfer-censor',{newCensor:address});return {address:address.toLowerCase()};}
  /** @returns {Promise<{address:string,active:boolean,isCurrentAccount:boolean,multiplier:number}>} */
  async function readModerator() {
    const h=connectedHandles(),expected=stamp();
    let value=await h.contract.methods.get_censor().simulate({from:window.__aztec.NO_FROM});
    if(value?.result!==undefined)value=value.result;if(value?.value!==undefined)value=value.value;
    const address=value?.toString?value.toString():value?'0x'+BigInt(value).toString(16).padStart(64,'0'):'0x0';
    const n=BigInt(address);if(n<0n||n>=21888242871839275222246405745257275088548364400416034343698204186575808495617n)throw Error('Invalid moderator address');
    const multiplier=Number(extractInt(await h.contract.methods.get_k_multiplier().simulate({from:window.__aztec.NO_FROM})));
    if(!Number.isSafeInteger(multiplier)||multiplier<1||multiplier>65535)throw Error('Invalid moderator settings');
    check(expected);return {address,active:n!==0n,isCurrentAccount:BigInt(h.address.toString())===n,multiplier};
  }
  // Read-only chain reconciliation. Returns no request payloads or SDK objects.
  async function readActivity() {
    const h=connectedHandles(),expected=stamp(),config=_getPublicConfig(),ws=window.walletState,a=window.__aztec;
    const identity=JSON.stringify([ws.aztec.address.toString(),_getConfigRevision(),config]);
    const scope={account:ws.aztec.address.toString().toLowerCase(),chainId:config.network.chainId,rollup:config.network.rollupAddress,version:config.network.rollupVersion,board:config.board.contractAddress,portal:config.board.portalAddress};
    const storage=a.createBrowserJournalStorage(),custody={storage,walletSecret:ws.aztec.secretKey,walletSalt:ws.aztec.salt,scope};
    const l2=await a.createL2Journal({...custody,Tx:a.Tx,node:h.aztecNode});
    const saved=await l2.inspect(),items=[];savedOperation=null;
    if(saved){
      let kind='transaction';try{const intent=JSON.parse(saved.operation);kind=typeof intent.kind==='string'?intent.kind:'moderation';}catch{}
      const receipt=await h.aztecNode.getTxReceipt(a.TxHash.fromString(saved.txHash));
      const confirmed=receipt.txHash?.toString()===saved.txHash&&['checkpointed','proven','finalized'].includes(receipt.status)&&receipt.blockNumber!==undefined&&String((await h.aztecNode.getBlock(receipt.blockNumber))?.hash)===String(receipt.blockHash);
      check(expected);
      if(confirmed)journalAcknowledgements.set(identity,saved.txHash);else savedOperation={layer:'aztec',kind};
      items.push({layer:'aztec',kind,txHash:saved.txHash,status:confirmed?(receipt.executionResult==='success'?'confirmed':'failed'):'pending',feePaid:confirmed&&receipt.transactionFee!==undefined?String(receipt.transactionFee):null});
    }
    if(ws.ethAccount){
      const provider=new ethers.JsonRpcProvider(config.network.ethRpcUrl);
      try{
        const journal=await a.createEthereumJournal({...custody,scope:{...scope,depositor:ws.ethAccount.toLowerCase()},provider});
        const summary=await journal.inspectSummary();check(expected);
        if(summary){const resolved=summary.outcome!=='unknown';if(resolved)ethereumAcknowledgements.set(identity,summary.txHash);else if(!savedOperation)savedOperation={layer:'ethereum',kind:summary.kind};items.push({layer:'ethereum',kind:summary.kind,txHash:summary.txHash,status:resolved?(summary.outcome==='success'?'confirmed':'failed'):'pending'});}
        const contracts=await h.aztecNode.getL1ContractAddresses();
        const feeJournal=await a.createEthereumJournal({...custody,scope:{...scope,board:config.privateFee.contractAddress,portal:contracts.feeJuicePortalAddress.toString().toLowerCase(),token:contracts.feeJuiceAddress.toString().toLowerCase(),depositor:ws.ethAccount.toLowerCase()},provider});
        const funding=await feeJournal.inspectSummary();check(expected);
        if(funding){if(funding.outcome==='unknown'&&!savedOperation)savedOperation={layer:'funding',kind:funding.kind};items.push({layer:'ethereum',kind:'fee-funding',txHash:funding.txHash,status:funding.outcome==='unknown'?'pending':funding.outcome==='success'?'confirmed':'failed'});}
      }finally{provider.destroy();}
    }
    check(expected);return items;
  }
  async function readModeratorRecovery() {
    if(kind!=='moderator')throw Error('Moderator interface required.');
    const expected=stamp(),items=await readActivity();moderatorRecoveryReview=null;
    const pending=items.find(item=>item.layer==='aztec'&&item.status==='pending');if(!pending)return null;
    if(pending.kind!=='moderation')return {action:'other-board-operation',txHash:pending.txHash};
    const h=connectedHandles(),config=_getPublicConfig(),ws=window.walletState,a=window.__aztec;
    const journal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:ws.aztec.secretKey,walletSalt:ws.aztec.salt,scope:{account:ws.aztec.address.toString().toLowerCase(),chainId:config.network.chainId,rollup:config.network.rollupAddress,version:config.network.rollupVersion,board:config.board.contractAddress,portal:config.board.portalAddress},Tx:a.Tx,node:h.aztecNode});
    const saved=await journal.inspect();if(!saved||saved.txHash!==pending.txHash)throw Object.assign(Error('Saved action changed.'),{code:'BB_MODERATOR_REVIEW_CHANGED'});
    const action=window.BillboardModerationCodec.restoreModeratorOperation(a,saved.operation),policy=await readPolicyReview(),authority=await readModerator();check(expected);
    let message=null;if(action.action==='declare-immoral'){const id=a.Fr.fromString(action.postId);const fields=await h.contract.methods.get_post(id).simulate({from:a.NO_FROM}),length=await h.contract.methods.get_post_length(id).simulate({from:a.NO_FROM});message=window.unpackFieldsToString(fields.result??fields,Number(extractInt(length)));check(expected);}
    const id=crypto.randomUUID(),canReplace=authority.isCurrentAccount&&(action.action!=='declare-immoral'||action.expectedPolicyVersion===policy.version);
    moderatorRecoveryReview={id,scope:expected,txHash:saved.txHash,operation:saved.operation,policyVersion:policy.version,canReplace};
    return {id,txHash:saved.txHash,...action,message,currentPolicy:policy.text,canReplace};
  }
  function resumeModeratorRecovery(id,allowReplacement=false){const review=moderatorRecoveryReview;if(!review||review.id!==id||review.scope!==stamp()||(allowReplacement&&!review.canReplace))throw Object.assign(Error('Review changed.'),{code:'BB_MODERATOR_REVIEW_CHANGED'});return run('recover',{moderatorRecovery:{txHash:review.txHash,operation:review.operation,policyVersion:review.policyVersion,allowReplacement}});}
  async function resume() {
    const last=operation.snapshot();
    if(last.error?.phase==='fee-funding'||savedOperation?.layer==='funding')return completeDeposit({...savedDepositInput(),retryEthereum:true});
    if(last.status==='paused'){if(last.action==='withdrawal')return completeWithdrawal();if(last.action==='onboarding')return completeDeposit(savedDepositInput());}
    if(last.error?.code==='BB_DEPOSIT_MESSAGE_UNAVAILABLE'||last.error?.code==='BB_DEPOSIT_READ')return completeDeposit();
    const ethereum=savedOperation?.layer==='ethereum'||last.error?.code?.startsWith('BB_ETH_')||last.error?.code==='PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN';
    try{const recovered=await run(ethereum?'recover-eth':'recover',{retryEthereum:ethereum});if(recovered.refundAmount&&recovered.refundRecipient)return recovered;}
    catch(error){if(/** @type {{code?:string}} */(error).code!=='BB_NO_SAVED_TRANSACTION')throw error;if(last.action==='onboarding')return completeDeposit(savedDepositInput());if(lastIntent)return run(lastIntent.action,lastIntent.input);throw error;}
    const result=await run('status');
    if(kind==='author'&&result.state==='deposited_l1_not_claimed_l2')return completeDeposit();
    if(kind==='author'&&result.state==='withdrawal_needs_verification')return completeWithdrawal();
    return result;
  }
  let feeOperation=null;
  function completeFeeFunding(input={}) {
    if(feeOperation)return feeOperation;
    if(workflow)throw Object.assign(Error('Operation in progress.'),{code:'BB_OPERATION_BUSY'});
    workflow=true;
    const expected=stamp();
    async function completeFunding(){
      if(!input.resumeOnly&&(typeof input.depositAmount!=='string'||!/^\d+(?:\.\d{1,18})?$/.test(input.depositAmount)||ethers.parseEther(input.depositAmount)<=fundingQuote().maximumFee))throw Object.assign(Error('Invalid amount.'),{code:'BB_FUNDING_AMOUNT'});
      let recovered;
      try{recovered=await runEngine('recover-eth',{retryEthereum:input.resumeOnly===true});}catch(error){if(/** @type {{code?:string}} */(error).code!=='BB_NO_SAVED_ETHEREUM_TRANSACTION')throw error;}
      let record=recovered?.record;
      if(recovered?.outcome==='funded'&&recovered.claimConsumed){
        try{await runEngine('recover-l2');}catch(error){if(!['BB_NO_SAVED_TRANSACTION'].includes(/** @type {{code?:string}} */(error).code||''))throw error;}
        if(input.resumeOnly)return {state:'funded'};
      }
      if(input.resumeOnly&&(!recovered||['reverted','replaced'].includes(recovered.outcome||'')))throw Object.assign(Error('No funding to resume.'),{code:'BB_NO_SAVED_ETHEREUM_TRANSACTION'});
      if(recovered?.outcome!=='funded'||recovered.claimConsumed){
        if(recovered&&!recovered.claimConsumed&&!['approved','reverted','replaced'].includes(recovered.outcome||''))throw Object.assign(Error('Funding requires recovery.'),{code:'BB_ETH_RECOVERY_REQUIRED'});
        if(input.resumeOnly&&recovered?.outcome==='approved'&&!recovered.amount)throw Object.assign(Error('Saved funding amount missing.'),{code:'BB_JOURNAL_INVALID'});
        const amount=input.resumeOnly&&recovered?.outcome==='approved'?ethers.formatEther(BigInt(/** @type {string} */(recovered.amount))):input.depositAmount;
        const result=await runEngine('deposit',{...input,depositAmount:amount});record=result.record;
      }
      try{return await runEngine('claim',{fundingRecord:record});}catch(error){if(/** @type {{code?:string}} */(error).code!=='BB_RECOVERY_REQUIRED'||!input.resumeOnly)throw error;const result=await runEngine('recover-l2');if(result.state==='transaction_reverted')throw Object.assign(Error('Credit claim reverted.'),{code:'BB_TRANSACTION_FAILED'});return result;}
    }
    feeOperation=transact('fee-funding',async()=>{
      const result=await completeFunding();operation.progress('syncing');
      // The funding outcome remains successful if a subsequent balance read is unavailable.
      // The application retains ownership until that read finishes, so a second top-up cannot race it.
      try{const feeBalance=await readFeeBalance();return {...result,feeBalance:feeBalance.toString()};}
      catch{check(expected);return {...result,feeBalance:null};}
    }).finally(()=>{feeOperation=null;workflow=false;});
    return feeOperation;
  }
  function fundingQuote() {
    const config=_getPublicConfig();
    const maximum=BigInt(window.BillboardConfig.maximumFee(config));
    return {maximumFee:maximum,fundingAmount:maximum*2n};
  }
  async function estimateDepositGas(depositAmount){
    const expected=stamp(),config=_getPublicConfig(),account=window.BillboardAccount.snapshot();
    if(!account.ethereumConnected)throw Object.assign(Error('Connect a wallet.'),{code:'BB_WALLET_NOT_READY'});
    const provider=new ethers.JsonRpcProvider(config.network.ethRpcUrl);
    try{const data=new ethers.Interface(['function deposit(bytes32 secretHash) payable']).encodeFunctionData('deposit',['0x'+'01'.repeat(32)]);
      const [gas,fees]=await Promise.all([provider.estimateGas({from:account.ethereumAddress,to:config.board.portalAddress,data,value:ethers.parseEther(depositAmount)}),provider.getFeeData()]);check(expected);
      if(fees.maxFeePerGas===null)throw Error('Fee estimate unavailable');return {maximumGasCost:gas*fees.maxFeePerGas};
    }finally{provider.destroy();}
  }
  async function readFeeBalance() {
    if(kind==='fees'){const expected=stamp(),result=await execute('balance',()=>{},{});check(expected);return BigInt(result.feeBalance);}
    const h=connectedHandles(),expected=stamp(),a=window.__aztec;
    const address=a.AztecAddress.fromString(_getPublicConfig().privateFee.contractAddress);
    const artifact=a.loadContractArtifact(BILLBOARD_PRIVATE_FEE_ARTIFACT);
    await h.wallet.registerContract(await a.derivePrivateFeeInstance(artifact),artifact);
    const feeContract=await a.Contract.at(address,artifact,h.wallet);
    const value=await feeContract.methods.balance_of(h.address).simulate({from:h.address});
    check(expected);return extractBigInt(value);
  }
  async function readAccount(){const expected=stamp();const deposit=await readDeposit(),feeBalance=await readFeeBalance();check(expected);return {deposit,feeBalance,...fundingQuote()};}
  async function readWithdrawalPlan() {
    const h=connectedHandles(),expected=stamp(),info=await readDeposit();
    const remaining=info.lastRealPostIndex>info.lastScreenedIndex?info.lastRealPostIndex-info.lastScreenedIndex:0n;
    let readyAt=info.nextAllowedTime;
    if(remaining>0n){
      const [child]=await window.BillboardScreeningHistory.readScreeningHints(h.contract,h.address,info.depositChainId);
      if(!child?.note)throw Object.assign(Error('Screening history missing.'),{code:'BB_SCREENING_HISTORY_UNAVAILABLE'});
      if(!child.note.is_dummy){const deadline=extractBigInt(await h.contract.methods.get_post_flag_deadline(child.note.post_id).simulate({from:window.__aztec.NO_FROM}));if(deadline>readyAt)readyAt=deadline;}
    }
    check(expected);
    const steps=Number(remaining>20n?20n:remaining);
    return {scope:expected,depositChainId:info.depositChainId,amount:info.amount,readyAt:Number(readyAt),chainTime:info.chainTime,remaining:Number(remaining),maxScreeningSteps:steps,maximumCreditSpend:fundingQuote().maximumFee*BigInt(steps+1)};
  }
  let withdrawalOperation=null;
  /** @param {{scope:string,maxScreeningSteps:number,maximumCreditSpend:bigint}|null} [plan] @param {BoardProgress} [onProgress] */
  function completeWithdrawal(plan=null,onProgress=()=>{}) {
    if(withdrawalOperation)return withdrawalOperation;
    if(workflow)throw Object.assign(Error('Operation in progress.'),{code:'BB_OPERATION_BUSY'});
    workflow=true;const expected=stamp();
    withdrawalOperation=transact('withdrawal',async()=>{
      let result=await runEngine('status',{},onProgress);check(expected);
      if(result.state==='postable'){
        if(!plan||plan.scope!==expected||!Number.isInteger(plan.maxScreeningSteps)||plan.maxScreeningSteps<0||plan.maxScreeningSteps>20||typeof plan.maximumCreditSpend!=='bigint')throw Object.assign(Error('Review withdrawal first.'),{code:'BB_WITHDRAWAL_REVIEW'});
        result=await runEngine('withdraw',{prepareWithdrawal:true,maxScreeningSteps:plan.maxScreeningSteps,maximumCreditSpend:plan.maximumCreditSpend.toString()},onProgress);
      }
      else if(result.state!=='withdrawal_needs_verification')throw Object.assign(Error('No withdrawal to complete.'),{code:'BB_NO_WITHDRAWAL'});
      while(true){
        check(expected);if(pauseRequested)throw Object.assign(Error('Paused.'),{code:'BB_OPERATION_PAUSED'});operation.progress('settlement');
        try{return await runEngine('claim-l1',{},onProgress);}
        catch(error){if(/** @type {{code?:string}} */(error).code!=='BB_SETTLEMENT_PENDING')throw error;}
        await new Promise(resolve=>setTimeout(resolve,30000));
      }
    }).finally(()=>{withdrawalOperation=null;workflow=false;});
    return withdrawalOperation;
  }
  async function readFeed(options={}) {
    const expected=stamp(),config=_getPublicConfig();
    const page=await window.BillboardPublic.readFeed({...options,portalAddress:config.board.portalAddress,nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,expectedConfig:config});
    if(stamp()!==expected)throw Error('Configuration changed. Refresh the board.');return page;
  }
  function requestPause(){if(!['bridge','settlement','screening'].includes(operation.snapshot().stage))return false;pauseRequested=true;return true;}
  async function reset() {
    fundingState=null;savedOperation=null;lastIntent=null;moderatorRecoveryReview=null;
    const previous=handles;handles=null;withdrawTxHash=undefined;fundingRecord=null;revision++;
    journalAcknowledgements.clear();ethereumAcknowledgements.clear();
    if(previous?.pxe?.stop)await previous.pxe.stop();
  }
  window.billboardConfigStore?.subscribe(()=>{reset().catch(()=>{_invalidateWalletContext();});});
  return Object.freeze({subscribe:operation.subscribe,operation:operation.snapshot,diagnosticReport:operation.report,run,resume,requestPause,completeFeeFunding,completeDeposit,completeWithdrawal,readWithdrawalPlan,fundingQuote,estimateDepositGas,readAccount,readFeeBalance,readActivity,readDeposit,readDepositTerms,readPolicy,readPolicyReview,reviewPolicyChange,readModeratorRecovery,resumeModeratorRecovery,reviewTransfer,readModerator,readFeed,reset,prepareDeployment,publicConfiguration,deploymentCapabilities,readFundingRecovery,importFundingRecovery:saveFundingRecord,
    get fundingState(){return fundingStamp===stamp()?fundingState:null;},get connected(){return handles!==null;},get revision(){return revision;}});
}
