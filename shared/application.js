// Browser application boundary. SDK objects and transaction acknowledgements stay here.
/**
 * @typedef {'status'|'deposit'|'claim'|'post'|'withdraw'|'claim-l1'|'recover'|'recover-eth'|'recover-l2'|'declare-immoral'|'set-moderation-policy'|'transfer-censor'|'deploy'} BoardAction
 * @callback BoardProgress
 * @param {string} message
 * @param {string} [level]
 * @returns {void}
 * @typedef {Object} BoardInput
 * @property {string} [message] Public post text, at most 992 UTF-8 bytes.
 * @property {string} [pluginHandle] Registered receiver handle resolved by the application.
 * @property {boolean} [isDummy] Advance screening without publishing text.
 * @property {string} [depositAmount] Decimal token amount.
 * @property {string} [reuseTxHash] Existing Ethereum deposit hash.
 * @property {boolean} [retryEthereum] Retry the saved request with its original nonce.
 * @property {number} [postIndex] Public post index to flag.
 * @property {string} [censorResponse] Public removal reason.
 * @property {string} [newCensor] Replacement Aztec moderator address.
 * @property {string} [moderationPolicy] New policy text.
 * @property {object} [fundingRecord] Public fee-deposit recovery record.
 * @property {string} [readyTxHash] Saved deployment activation transaction.
 * @property {string} [dataDirPrefix] Deployment storage namespace.
 * @typedef {Object} BoardResult
 * @property {string} [state] Engine outcome, e.g. postable or transaction_recovered.
 * @property {string} [status] Deployment activation status.
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
  let handles=null,withdrawTxHash,revision=0,fundingRecord=null;
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
  async function publicConfiguration(result,gasSettings,manifest) {
    if(kind!=='deploy')throw Error('Deployment configuration required.');
    const n=manifest.network;
    const privateFee=gasSettings?{contractAddress:(await window.__aztec.derivePrivateFeeAddress(BILLBOARD_PRIVATE_FEE_ARTIFACT)).toString(),gasSettings}:null;
    return window.BillboardConfig.validate({schemaVersion:1,network:{nodeUrl:n.nodeUrl,ethRpcUrl:n.ethRpcUrl,chainId:n.chainId,rollupVersion:n.rollupVersion,rollupAddress:n.rollup},board:{portalAddress:result.portalAddr.toLowerCase(),contractAddress:result.l2Addr.toLowerCase()},privateFee});
  }
  function stamp(){return JSON.stringify([revision,_getConfigRevision(),_walletGeneration]);}
  function check(expected){_assertWalletLive();if(stamp()!==expected)throw Error('Account or configuration changed. Reconnect.');}
  function connectedHandles(){_assertWalletLive();if(!handles)throw Error('Board account is not connected.');return handles;}
  /** @param {BoardAction} action @param {BoardInput} input @param {BoardProgress} onProgress @returns {Promise<BoardResult>} */
  async function runCore(action,input={},onProgress=()=>{}) {
    const expected=stamp(),ws=window.walletState;
    const identity=JSON.stringify([ws.aztec?.address.toString(),_getConfigRevision(),_getPublicConfig()]);
    const common=isBoard?{portalAddress:_getPublicConfig()?.board.portalAddress,dataDirPrefix:kind==='moderator'?'pxe_bb_censor_':'pxe_bb_',
      depositChainId:handles?.depositChainId,withdrawTxHash,
      claimSecretStore:makeClaimSecretStore(ws.aztec?.secretKey,ws.aztec?.salt),censorWalletJson:ws.aztec?.raw}:{};
    const result=await execute(action,onProgress,{...common,...input,...(kind==='fees'?{saveRecovery:saveFundingRecord}:{}),acknowledgeTx:journalAcknowledgements.get(identity),acknowledgeEthereumTx:ethereumAcknowledgements.get(identity)});
    check(expected);
    if(result?.lastL2TxHash)journalAcknowledgements.set(identity,result.lastL2TxHash);
    if(result?.lastEthereumTxHash)ethereumAcknowledgements.set(identity,result.lastEthereumTxHash);
    if(result?.handles)handles=result.handles;
    if(result&&Object.hasOwn(result,'withdrawTxHash'))withdrawTxHash=result.withdrawTxHash;
    if(kind==='fees'&&result.record)saveFundingRecord(result.record);
    const {handles:privateHandles,receipt:privateReceipt,...data}=result;
    return data;
  }
  async function run(action,input={},onProgress=()=>{}) {
    if(action!=='post'||input.isDummy||!input.message)return runCore(action,input,onProgress);
    const api=window.BillboardPlugins;
    if(!api)throw Error('Plugin client unavailable');
    if(!api.mentions(input.message).length)return runCore(action,input,onProgress);
    const h=connectedHandles(),config=_getPublicConfig(),expected=stamp();
    const scope={chainId:config.network.chainId,rollupVersion:config.network.rollupVersion,rollupAddress:config.network.rollupAddress,boardAddress:config.board.contractAddress};
    const prepare=text=>api.prepareInvocation({text,scope,lookup:async id=>{
        const result=await h.contract.methods.get_plugin(window.__aztec.Fr.fromString(id)).simulate({from:window.__aztec.NO_FROM});check(expected);
        const [receiver,enabled,descriptor,length]=result.result;
        return {receiver:receiver.toString(),enabled,descriptor:descriptor.map(String),length:Number(length)};
      }});
    const plan=await prepare(input.message);check(expected);
    return runCore(action,{...input,...(plan?{pluginHandle:plan.handleField}:{})},onProgress);
  }
  async function pluginAccount(action,input,onProgress=()=>{}) {
    const h=connectedHandles(),expected=stamp(),a=window.__aztec,config=_getPublicConfig();
    const scope={chainId:config.network.chainId,rollupVersion:config.network.rollupVersion,rollupAddress:config.network.rollupAddress,boardAddress:config.board.contractAddress};
    const plan=await window.BillboardPlugins.prepareInvocation({text:'@'+input.handle,scope,allowDisabled:action!=='deposit',lookup:async id=>{
      const {result}=await h.contract.methods.get_plugin(a.Fr.fromString(id)).simulate({from:a.NO_FROM});
      const [receiver,enabled,descriptor,length]=result;return {receiver:String(receiver),enabled,descriptor:descriptor.map(String),length:Number(length)};
    }});
    if(!plan)throw Error('Unknown plugin');check(expected);
    return window.BillboardPlugins.pluginAccountAction({action,input,descriptor:plan.descriptor,sdk:a,handles:h,signer:await getBrowserSigner(),onProgress,
      store:{read:()=>JSON.parse(localStorage.getItem('plugin-account:'+plan.descriptor.scope.receiver+':'+scope.chainId+':'+scope.rollupAddress+':'+scope.rollupVersion+':'+h.address)||'null'),write:value=>{check(expected);localStorage.setItem('plugin-account:'+plan.descriptor.scope.receiver+':'+scope.chainId+':'+scope.rollupAddress+':'+scope.rollupVersion+':'+h.address,JSON.stringify(value));}},
      send:async (interaction,beforeSubmit)=>{check(expected);await h.pxe.sync();const route=config.privateFee;
        const fee=await a.preparePrivateFeePayment({wallet:h.wallet,node:h.aztecNode,owner:h.address,privateFeeAddress:route.contractAddress,privateFeeArtifact:BILLBOARD_PRIVATE_FEE_ARTIFACT,expectedChainId:scope.chainId,expectedVersion:scope.rollupVersion,gasSettings:a.GasSettings.from(route.gasSettings)});
        check(expected);
        const ws=window.walletState,identity=JSON.stringify([ws.aztec.address.toString(),_getConfigRevision(),config]);
        const transactionJournal=await a.createL2Journal({storage:a.createBrowserJournalStorage(),walletSecret:ws.aztec.secretKey.toString(),walletSalt:ws.aztec.salt,
          scope:{account:h.address.toString().toLowerCase(),chainId:String(scope.chainId),rollup:scope.rollupAddress.toLowerCase(),version:String(scope.rollupVersion),board:scope.boardAddress.toLowerCase(),portal:config.board.portalAddress.toLowerCase()},
          Tx:a.Tx,node:h.rawNode,acknowledgeTx:journalAcknowledgements.get(identity),contextGuard:()=>check(expected)});
        const sent=await interaction.send({from:h.address,beforeSubmit,transactionJournal,journalOperation:JSON.stringify({kind:'extension',receiver:plan.descriptor.scope.receiver,action}),fee:{paymentMethod:fee.paymentMethod,gasSettings:fee.gasSettings}});
        check(expected);journalAcknowledgements.set(identity,sent.receipt.txHash.toString());return sent;
      }});
  }

  /** @returns {Promise<{amount:bigint,depositChainId:bigint,nextAllowedTime:bigint,lastScreenedIndex:bigint,lastRealPostIndex:bigint,chainTime:number}>} */
  async function readDeposit() {
    const h=connectedHandles(),expected=stamp();
    const info=await readBillboardDepositInfo(h.contract,h.address,h.depositChainId);
    const chainTime=await getL2Timestamp(h.aztecNode);check(expected);
    if(info.amount>0n)h.depositChainId=info.depositChainId;
    return {...info,chainTime};
  }
  /** @returns {Promise<string>} */
  async function readPolicy() {
    const h=connectedHandles(),expected=stamp();
    const result=await h.contract.methods.get_moderation_policy().simulate({from:window.__aztec.NO_FROM});check(expected);
    const fields=result?.result?.[0],length=Number(result?.result?.[1]??0);
    return length>0?window.unpackFieldsToString(fields,length):'';
  }
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
  async function readFeed(options={}) {
    const expected=stamp(),config=_getPublicConfig();
    const page=await window.BillboardPublic.readFeed({...options,portalAddress:config.board.portalAddress,nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,expectedConfig:config});
    if(stamp()!==expected)throw Error('Configuration changed. Refresh the board.');return page;
  }
  async function reset() {
    const previous=handles;handles=null;withdrawTxHash=undefined;fundingRecord=null;revision++;
    journalAcknowledgements.clear();ethereumAcknowledgements.clear();
    if(previous?.pxe?.stop)await previous.pxe.stop();
  }
  window.billboardConfigStore?.subscribe(()=>{reset().catch(()=>{_invalidateWalletContext();});});
  return Object.freeze({run,pluginAccount,readDeposit,readPolicy,readModerator,readFeed,reset,publicConfiguration,readFundingRecovery,importFundingRecovery:saveFundingRecord,
    get connected(){return handles!==null;},get revision(){return revision;}});
}
