// ============================================================
// shared/app-env.js — Common browser environment for all apps
// ============================================================
// Provides: checkBundle, waitForBundle, setupRpcAuth,
//           makeInitCRS, makeCreateStore, getBrowserSigner,
//           buildEnv, buildConfig, makeCallEngine
//
// Does NOT redeclare constants from aztec-lib.js (A, CRS_HOSTS,
// SRS_NUM_POINTS, GRUMPKIN_NUM_POINTS, getNodeUrl) — those are
// already present in user/fee-juice apps. For deploy (which does
// not include aztec-lib.js), we inline constants and use typeof
// guards.
//
// Each app includes this via build placeholder APP_ENV.
// ============================================================

// Connection settings are public, explicit and shared across pages. Deployment
// uses its reviewed manifest; it never inherits an author's selected board.
function _getPublicConfig() { return window.billboardConfigStore?.snapshot().config || null; }
function _getConfigRevision() { return window.billboardConfigStore?.snapshot().revision ?? 0; }
function _connectionConfig() {
  const config=_getPublicConfig();
  if(!config) throw new Error('Import the board connection configuration first.');
  return {aztecNodeUrl:config.network.nodeUrl,ethRpcUrl:config.network.ethRpcUrl,
    portalAddress:config.board.portalAddress,expectedBoardAddress:config.board.contractAddress,
    expectedNetworkScope:{chainId:config.network.chainId,version:config.network.rollupVersion,rollup:config.network.rollupAddress},
    privateFee:config.privateFee,remoteProver:config.remoteProver?{url:config.remoteProver.url,board:config.board.contractAddress}:undefined};
}
function _getEthRpcUrl() { return _connectionConfig().ethRpcUrl; }
window.billboardConfigStore?.subscribe(()=>{
  if(window.walletState?.aztec || window.walletState?.ethSigner || (typeof _walletBusy!=='undefined' && _walletBusy)) {
    _invalidateWalletContext(); _updateAccountState();
  }
});

// ============================================================
// Bundle readiness check
// ============================================================
function checkBundle(statusId) {
  const sid = statusId || 'status';
  if (window.__aztec && window.__aztec.createPXE) {
    log('Bundle loaded. ' + Object.keys(window.__aztec).length + ' exports.', 'success', sid);
    return true;
  }
  return false;
}

function waitForBundle(cb) {
  if (window.__aztec?.createPXE) { cb(); return; }
  let tries=0;
  const fail=()=>{
    if(document.getElementById('bundleFailure'))return;
    const message=document.createElement('p');message.id='bundleFailure';message.setAttribute('role','alert');
    message.textContent='Wallet software could not load. Check the connection and reload this page. Public messages remain available in the reader.';
    const link=document.createElement('a');link.href=new URL('feed.html'+location.hash,location.href).href;link.textContent='Open public reader';
    const retry=document.createElement('button');retry.textContent='Reload application';retry.onclick=()=>location.reload();message.append(' ',link,' ',retry);document.body.prepend(message);
  };
  if(window.__billboardBundleFailed){fail();return;}
  const interval=setInterval(()=>{
    if(window.__aztec?.createPXE){clearInterval(interval);cb();}
    else if(window.__billboardBundleFailed || ++tries>=120){clearInterval(interval);fail();}
  },500);
}

// ============================================================
// RPC config helpers (use aztec-lib.js's getNodeUrl if available)
// ============================================================
function _getNodeUrl() { return _connectionConfig().aztecNodeUrl; }
function _getApiKey() { return ''; }
// Retained entry point for pages; browser-delivered credentials are unsupported.
function setupRpcAuth() {}

// ============================================================
// CRS initialization (browser) — verified local setup for the actual prover
// CRS constants are inlined to avoid conflicts with aztec-lib.js
// ============================================================
function makeInitCRS() {
  return async function initializeCRS() {
    const a = window.__aztec;
    await a.BarretenbergSync.initSingleton();
    // The async worker owns proving SRS. The synchronous hashing instance does
    // not need another full copy of the proving setup.
    await a.initializeBrowserProver();
  };
}

// ============================================================
// PXE store creation (browser: supported SQLite OPFS store)
// ============================================================
function makeCreateStore() {
  return async function createStore(config) {
    return window.__aztec.openPXEStore(config);
  };
}

// ============================================================
// Browser ETH signer
// ============================================================
async function getBrowserSigner() {
  const ws = window.walletState;
  if (ws && ws.ethSigner) return ws.ethSigner;
  throw Object.assign(new Error('Connect your wallet first.'),{code:'BB_WALLET_NOT_READY'});
}

// ============================================================
// Build env object — app provides extra fields (pause, portalBytecode, artifact)
// ============================================================
function buildEnv(extra) {
  const env = {
    aztec: window.__aztec,
    ethers: ethers,
    log: extra.log,
    initCRS: makeInitCRS(),
    createStore: makeCreateStore(),
    getBrowserSigner: getBrowserSigner,
    depositRecoveryProgress:createDepositRecoveryProgress(),
  };
  if (extra) Object.assign(env, extra);
  return env;
}

// ============================================================
// Build config object — app provides action + extra fields
// ============================================================
function buildConfig(action, extra, connection=_connectionConfig()) {
  const ws = window.walletState;
  let ethWallet = null;
  if (ws && ws.ethType === 'json') {
    ethWallet = { privateKey: ws.ethSigner.privateKey };
  }
  const config = {
    ...(extra || {}), ...connection,
    aztecApiKey:'',
    aztecWallet: ws && ws.aztec ? { secretKey: ws.aztec.secretKey, salt: ws.aztec.salt } : null,
    ethWallet, hasEthSigner: !!ws?.ethSigner,
  };
  if (action) config.action = action;
  return config;
}

// ============================================================
// Call engine with log routing to a specific status div
// ============================================================
function publicOperationFailure(error) {
  const messages={
    BB_PLUGIN_UNKNOWN:'This plugin is not registered on this board.',
    BB_SCREENING_NO_PROGRESS:'Withdrawal preparation paused because the network did not advance screening. No further preparation fees will be spent. Refresh your account before continuing.',
    BB_SCREENING_HISTORY_UNAVAILABLE:'Your message history could not be verified. Refresh your account before continuing withdrawal.',
    BB_WITHDRAWAL_REVIEW:'Review the current withdrawal estimate before continuing.',
    BB_WITHDRAWAL_BUDGET:'Withdrawal preparation reached the approved limit. Review the remaining work before continuing; no more fees will be spent automatically.',
    BB_POST_COOLDOWN:'Your next post is not available yet. Wait for the posting countdown to finish.',
    BB_NO_WITHDRAWAL:'There is no refundable deposit available for this account.',
    BB_OPERATION_BUSY:'Another operation is still running. Let it finish before starting this one.',
    BB_MESSAGE_EMPTY:'Write a message before posting.',
    BB_MESSAGE_LONG:'Your message is too long. Shorten it to fit the 992-byte limit.',
    BB_ACCOUNT_RECORD_INVALID:'Saved account information is damaged. Open Account to use your existing passkey or restore an encrypted backup. Your saved data has not been replaced.',
    BB_PASSKEY_PRF_UNSUPPORTED:'This passkey cannot unlock your private account. Use a passkey with PRF support, or restore your encrypted recovery file.',
    BB_FEE_ESTIMATION_UNSTABLE:'The fee estimate did not settle. No transaction was sent. Try again after the account finishes syncing.',
    BB_PASSKEY_CANCELLED:'Passkey approval was cancelled. Your account has not changed. Try unlocking again when ready.',
    BB_PASSKEY_UNSUPPORTED:'This browser or passkey cannot unlock a private account. Use a passkey with PRF support, or restore your encrypted recovery file.',
    BB_POLICY_CHANGED:'The board rules changed while you were reviewing. Open the current rules and review your change again.',
    BB_MODERATOR_ADDRESS:'Enter a valid, nonzero Aztec moderator address.',
    BB_POLICY_LENGTH:'Enter board rules between 1 and 1,488 UTF-8 bytes.',
    BB_MODERATION_INPUT:'Choose a message and keep the removal reason within 200 UTF-8 bytes.',
    BB_OPERATION_PAUSED:'Paused. Your confirmed payments are saved. Continue when you are ready.',
    BB_ACCOUNT_REPLACEMENT:'Lock this account before restoring a different private account.',
    BB_MODERATOR_REVIEW_REQUIRED:'The saved proof is no longer usable. Review the action before approving a new proof.',
    BB_MODERATOR_REVIEW_CHANGED:'The account, board or saved action changed. Open its review again.',
    BB_DEPLOYMENT_MANIFEST:'Check the deployment settings and review them again before creating the board.',
    BB_FUNDING_AMOUNT:'Enter a valid AZTEC amount greater than the maximum transaction fee.',
    BB_BACKUP_PASSWORD:'Use a recovery password of at least 12 characters.',
    BB_BACKUP_PASSWORD_MATCH:'The recovery passwords do not match.',
    BB_DEPLOYMENT_RECORD:'Saved deployment details could not be read. Import your reviewed deployment configuration to continue.',
    BB_DEPLOYMENT_STORAGE:'This browser could not save deployment progress. Allow site storage before deploying.',
    BB_DEPLOYMENT_INPUT:'Check the highlighted board setting.',
    BB_BACKUP_FORMAT:'This is not a valid wallet recovery file. Choose the JSON file you exported.',
    BB_BACKUP_SIZE:'This recovery file is too large. Choose a wallet recovery file smaller than 32 MB.',
    BB_BACKUP_UNLOCK:'The password did not unlock this file, or the encrypted file is damaged. Check the password and try again.',
    BB_BACKUP_INVALID:'This recovery file could not be opened. Check its password and choose the encrypted wallet file.',
    BB_SIMULATION_FAILED:'The network could not validate this transaction. Nothing was submitted. Refresh your account and try again.',
    BB_GAS_LIMIT_EXCEEDED:'This transaction needs a higher fee limit. The board operator must update its settings.',
    PRIVATE_FEE_FUNDING_TOKEN_BALANCE:'Your Ethereum wallet needs more AZTEC tokens for transaction fees. Add AZTEC on the configured test network, then resume setup; no additional board deposit was sent.',
    PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN:'Fee funding was submitted but its confirmation is uncertain. Resume setup to check the saved payment before another is sent.',
    PRIVATE_FEE_RECOVERY_FAILED:'The saved fee funding could not be verified. Check the connection and resume setup; do not send another fee payment.',
    BB_DEPOSIT_READ:'The private wallet could not read the board deposit state. Resume setup to check again; do not send another deposit while its status is unknown.',
    PRIVATE_FEE_BALANCE_INSUFFICIENT:'Your private transaction fee balance is below the required fee budget. Fund private transaction fees, then resume the interrupted operation.',
    PRIVATE_FEE_CLAIM_INSUFFICIENT:'The pending private fee funding is below the required fee budget. Add private transaction fee funding before resuming the interrupted operation.',
    BB_PRIVATE_FEE_PREPARATION_FAILED:'Private transaction fee preparation failed before proving. Check the connection and private fee settings, then resume the interrupted operation.',
    BB_PRIVATE_FEE_ACTION_FAILED:'The private transaction could not be completed. Check saved transactions before retrying.',
    BB_PRIVATE_FEE_UNAVAILABLE:'Private transaction fee settings are unavailable. The board operator must correct its configuration before setup can continue.',
    PRIVATE_FEE_CAP_TOO_LOW:'The configured transaction fee cap is below the network’s current minimum. The board operator needs to update its fee settings before you can continue.',
    INSECURE_CONTEXT:'Wallet actions require HTTPS or localhost.',
    SHARED_MEMORY_UNAVAILABLE:'Wallet actions require cross-origin isolation and shared memory. Check the hosting configuration or use a supported browser.',
    WASM_UNAVAILABLE:'This browser cannot run the required WebAssembly features.',
    WORKER_UNAVAILABLE:'Browser workers are unavailable or blocked. Check the browser and hosting settings.',
    CRYPTO_UNAVAILABLE:'Browser cryptography is unavailable.',
    LOCKS_UNAVAILABLE:'Browser storage locks are unavailable; wallet actions cannot safely continue.',
    BB_REMOTE_PROVER_TIMEOUT:'The prover took too long. No transaction was submitted by this proof attempt. Resume to check saved work before trying again.',
    BB_REMOTE_PROVER_OFFLINE:'The board’s prover could not be reached. Retry when it is available, or turn off Remote proving before resuming.',
    BB_REMOTE_PROVER_BUSY:'The board’s prover is at capacity or rate-limited. Wait before retrying, or turn off Remote proving for the next attempt.',
    BB_REMOTE_PROVER_REJECTED:'The prover rejected this request. The board operator needs to check its configuration.',
    BB_REMOTE_PROVER_RESPONSE:'The prover returned an invalid response. The board operator needs to check the service.',
    BB_REMOTE_PROVER_FAILED:'Remote proving did not complete. Try again or turn off Remote proving to prove locally.',
    BB_BROWSER_PROOF_FAILED:'Browser proving did not complete. Reload and restore your wallet, then check saved transactions before trying again.',
    BB_BROWSER_PROVER_CONFIGURATION:'Browser proving setup could not be verified. Reload this page and check the locally hosted setup files.',
    OPFS_UNAVAILABLE:'Private browser file storage is unavailable or blocked. Wallet storage cannot start.',
    STORAGE_UNAVAILABLE:'Browser storage is unavailable or blocked. Preserve your recovery file before changing browser settings.',
    BB_WALLET_REJECTED:'Wallet request cancelled. Connect again when you are ready.',
    BB_WALLET_NETWORK:'Switch your selected wallet to the network configured for this board, then connect again.',
    BB_WALLET_DISCONNECTED:'The wallet disconnected during setup. Reconnect your wallet, then reload this page to try again.',
    BB_BROWSER_WALLET_MISSING:'No Ethereum wallet was found in this browser. Open this board in a browser with MetaMask or another Ethereum wallet installed, then connect again.',
    BB_WALLET_NOT_READY:'Connect your Ethereum wallet and finish account setup before depositing.',
    READINESS_TIMEOUT:'Browser capability checks timed out. Retry before starting a wallet operation.',
    BB_CONNECTION_VERIFICATION_FAILED:'The portal, network or private fee contract could not be verified. Check the imported configuration before making a payment.',
    BB_FEE_CONFIG_REQUIRED:'Import private fee settings before depositing collateral or creating a new Aztec transaction. Recovery remains available.',
    BB_SUBMISSION_UNKNOWN:'Submission outcome is unknown. Keep the transaction record and check its receipt before retrying.',
    PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN:'Fee funding outcome is unknown. Keep its recovery file and check the transaction before retrying.',
    BB_PRIVATE_FEE_AMOUNT:'Deposit more than the configured maximum claim fee.',
    BB_TRANSACTION_FAILED:'The transaction did not execute successfully. Check its receipt before trying again.',
    BB_STATE_CONFLICT:'Transaction state changed. Refresh the account before creating a new proof.',
    BB_NO_SAVED_ETHEREUM_TRANSACTION:'No saved Ethereum request exists for this wallet and portal.',
    BB_ETH_REQUEST_CANCELLED:'Payment cancelled. No transaction was sent. You can try again.',
    BB_ETH_INSUFFICIENT_FUNDS:'Not enough ETH for this payment and gas. Add funds, then try again.',
    BB_ETH_RECOVERY_REQUIRED:'A previous payment needs checking. Use Resume in Activity; no new payment will be made until its status is known.',
    BB_ETH_SUBMISSION_UNKNOWN:'Ethereum submission is uncertain. Keep this browser profile and use Resume in Activity to check the payment.',
    BB_ETH_TRANSACTION_FAILED:'The Ethereum request reverted or was replaced. Check its saved request before starting another payment.',
    BB_WALLET_SYNC_PENDING:'Your claim is confirmed, but wallet synchronization failed. Keep the saved receipt and refresh before posting; do not make another deposit.',
    BB_RECOVERY_REQUIRED:'Recover the saved Aztec transaction from Wallet Setup before sending another transaction.',
    BB_JOURNAL_INVALID:'Transaction recovery storage could not be authenticated or saved. Preserve this browser profile and recovery records before continuing.',
    BB_CLAIM_SECRET_MISSING:'This Ethereum deposit belongs to a saved private wallet whose claim secret is missing from this browser. Restore the encrypted backup made after that deposit. Creating a new wallet or clearing storage cannot recover it. Do not deposit again.',
    BB_DEPOSIT_LOOKUP_FAILED:'We could not retrieve your deposit from Ethereum. Choose Resume setup; you do not need to deposit again.',
    BB_DEPOSIT_MESSAGE_PENDING:'Your ETH deposit is confirmed. Its message is not yet available to claim; choose Resume setup later. Do not deposit again.',
    BB_DEPOSIT_MESSAGE_UNAVAILABLE:'Your ETH deposit is confirmed, but message availability could not be checked. Restore the connection and resume setup; do not deposit again.',
    BB_DEPOSIT_MESSAGE_INVALID:'The deposit message does not match its receipt. Preserve the original transaction and recover it before continuing.',
    BB_NO_SAVED_TRANSACTION:'No saved Aztec transaction exists for this wallet and board.',
    BB_RECOVERY_UNKNOWN:'Recovery state could not be verified. Keep your recovery records and retry the lookup; do not create a replacement deposit.',
    BB_SETTLEMENT_PENDING:'Your withdrawal is recorded. Network settlement is pending; retry the Ethereum claim later.',
  };
  const code=typeof error?.code==='string'&&Object.hasOwn(messages,error.code)?error.code:'BB_OPERATION_FAILED';
  return Object.assign(new Error(messages[code]||'This operation could not finish. Open Activity to check it before trying again. Details contains a report for the board operator.'),{code,phase:error?.phase==='fee-funding'?'fee-funding':null,field:['msgText','newCensorAddr','moderationPolicyInput','censorResponseText','amount','wbPassword','wbPasswordConfirm','wbRestorePassword','newMinimum','newMaximum','newInterval','newWindow','newMultiplier','newAllowance','newModerator','newRules','recoveryFile'].includes(error?.field)?error.field:null});
}

function makeCallEngine(engineFn, envExtra, {deployment=false,connection=_connectionConfig}={}) {
  let running=false;
  return async function callEngine(action, onProgress, extra) {
    if(running) throw new Error('Another wallet operation is in progress.');
    _assertWalletLive();
    const ws=window.walletState, generation=_walletGeneration;
    if(!ws?.aztec?.address) throw new Error('Load an Aztec wallet first.');
    const identity=()=>JSON.stringify([_getConfigRevision(),connection(),ws.aztec?.secretKey,ws.aztec?.salt,ws.ethAccount,ws.ethChainId],(_,value)=>typeof value==='bigint'?value.toString():value);
    const expected=identity();
    // Capture before acquiring locks or performing any asynchronous work.
    const operationConnection=structuredClone(connection());
    operationConnection.remoteProver=(extra?.provingMode??window.BillboardProving.snapshot())==='remote' ? operationConnection.remoteProver : undefined;
    if(operationConnection.remoteProver)operationConnection.remoteProver=Object.freeze({...operationConnection.remoteProver,onStatus:state=>extra?.onStage?.(state==='queued'?'queued':'proving')});
    Object.freeze(operationConnection);
    async function guard() {
      if(extra?.pauseRequested?.())throw Object.assign(Error('Paused.'),{code:'BB_OPERATION_PAUSED'});
      _assertWalletLive();
      if(generation!==_walletGeneration || expected!==identity()) throw new Error('Wallet or deployment configuration changed. Reload before continuing.');
      if(ws.ethType==='browser') {
        const [accounts,chain]=await Promise.all([ws.ethTransport.request({method:'eth_accounts'}),ws.ethTransport.request({method:'eth_chainId'})]);
        if(!Array.isArray(accounts) || accounts[0]?.toLowerCase()!==ws.ethAccount.toLowerCase() || BigInt(chain)!==BigInt(ws.ethChainId)) {
          _invalidateWalletContext(); throw new Error('Wallet account or chain changed.');
        }
      }
      _assertWalletLive();
      if(generation!==_walletGeneration || expected!==identity()) throw new Error('Wallet or deployment configuration changed. Reload before continuing.');
    }
    async function verifyBoard() {
      if(!envExtra?.artifact || deployment)return;
      const config=_getPublicConfig(),api=window.BillboardPublic;
      if(!config || !api)throw new Error('Board verification is unavailable.');
      await api.connectPublicFeed({nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,
        portalAddress:config.board.portalAddress,expectedConfig:config,metadata:api.metadata,
        storage:api.browserPublicFeedStorage()});
      await guard();
      if(!window.BillboardConnectionCheck)throw new Error('Portal verification is unavailable.');
      await window.BillboardConnectionCheck.verify({sdk:window.__aztec,ethers,config,
        privateFeeArtifact:envExtra.privateFeeArtifact,
        verifyFee:['plugin-account','deposit','claim','post','withdraw','auto','declare-immoral','set-moderation-policy','transfer-censor'].includes(action)});
      await guard();
    }
    if(!navigator.locks?.request) throw new Error('This browser cannot safely coordinate wallet tabs. Use a browser with Web Locks support.');
    // One operation per full account across tabs, including RPC aliases and networks. No secret in lock name.
    const lockName='billboard-wallet:'+ws.aztec.address.toString();
    running=true;
    try {
      return await navigator.locks.request(lockName,{ifAvailable:true},async lock=>{
        if(!lock) throw new Error('This wallet is busy in another tab.');
        await guard();
        if(envExtra?.artifact && !deployment && !_getPublicConfig()?.privateFee && ['deposit','claim','post','withdraw','auto','declare-immoral','set-moderation-policy','transfer-censor'].includes(action)) throw Object.assign(new Error('Private fee configuration required.'),{code:'BB_FEE_CONFIG_REQUIRED'});
        if(!window.BillboardReadiness) throw new Error('Browser capability checks are unavailable.');
        await window.BillboardReadiness.check();
        await guard();
        await verifyBoard();
        const env=buildEnv({...envExtra,log:onProgress,progress:extra?.onStage||(()=>{})}),config=buildConfig(action,extra,operationConnection);
        const prior=config.preProveHook;
        config.contextGuard=guard;
        config.waitForBridge=true;
        config.preProveHook=async value=>{await guard();await verifyBoard();if(prior)await prior(value);await guard();};
        env.getBrowserSigner=async()=>{
          await guard(); if(!ws.ethSigner) throw new Error('Connect an Ethereum wallet first.');
          const signer=ws.ethSigner;
          return new Proxy(signer,{get(target,property){
            const value=Reflect.get(target,property,target);
            if(typeof value!=='function')return value;
            if(['sendTransaction','signTransaction','signMessage','signTypedData'].includes(property))return async(...args)=>{await guard();await verifyBoard();await guard();env.progress('wallet');const result=await value.apply(target,args);env.progress('confirming');return result;};
            return value.bind(target);
          }});
        };
        try {const result=await engineFn(env,config);await guard();return result;}
        catch(error) {
          // RPC/prover exceptions can include witness or request data. Only a
          // bounded public classification crosses into UI error/log handlers.
          throw publicOperationFailure(error);
        }
      });
    } catch(error) {
      throw publicOperationFailure(error);
    } finally {running=false;}
  };
}
