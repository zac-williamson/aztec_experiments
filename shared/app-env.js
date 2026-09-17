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

// Mutable log target — apps set this before calling engine functions
let _currentStatusDiv = 'status';

// Connection settings are public, explicit and shared across pages. Deployment
// uses its reviewed manifest; it never inherits an author's selected board.
function _getPublicConfig() { return window.billboardConfigStore?.snapshot().config || null; }
function _getConfigRevision() { return window.billboardConfigStore?.snapshot().revision ?? 0; }
function _deploymentConfig() {
  const field=document.getElementById('deploymentManifest');
  if(!field) return null;
  if(!window.__aztec?.deploymentManifestConfig) throw new Error('Application is still loading.');
  try { return window.__aztec.deploymentManifestConfig(JSON.parse(field.value)); }
  catch { throw new Error('Import a valid reviewed deployment manifest first.'); }
}
function _connectionConfig() {
  const deployment=_deploymentConfig();
  if(deployment) return deployment;
  const config=_getPublicConfig();
  if(!config) throw new Error('Import the board connection configuration first.');
  return {aztecNodeUrl:config.network.nodeUrl,ethRpcUrl:config.network.ethRpcUrl,
    portalAddress:config.board.portalAddress,expectedBoardAddress:config.board.contractAddress,
    expectedNetworkScope:{chainId:config.network.chainId,version:config.network.rollupVersion,rollup:config.network.rollupAddress},
    privateFee:config.privateFee};
}
function _getEthRpcUrl() { return _connectionConfig().ethRpcUrl; }
window.billboardConfigStore?.subscribe(()=>{
  if(window.walletState?.aztec || window.walletState?.ethSigner || (typeof _walletBusy!=='undefined' && _walletBusy)) {
    _invalidateWalletContext(); _updateButtonColors();
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
    const link=document.createElement('a');link.href='feed.html';link.textContent='Open public reader';
    message.append(' ',link);document.body.prepend(message);
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
  if (!window.ethereum) throw new Error('No browser wallet found.');
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  return provider.getSigner();
}

// ============================================================
// Build env object — app provides extra fields (pause, portalBytecode, artifact)
// ============================================================
function buildEnv(extra) {
  const env = {
    aztec: window.__aztec,
    ethers: ethers,
    log: (msg, level) => log(msg, level || 'info', _currentStatusDiv),
    initCRS: makeInitCRS(),
    createStore: makeCreateStore(),
    getBrowserSigner: getBrowserSigner,
  };
  if (extra) Object.assign(env, extra);
  return env;
}

// ============================================================
// Build config object — app provides action + extra fields
// ============================================================
function buildConfig(action, extra) {
  const ws = window.walletState;
  let ethWallet = null;
  if (ws && ws.ethType === 'json') {
    ethWallet = { privateKey: ws.ethSigner.privateKey };
  }
  const connection=_connectionConfig();
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
    INSECURE_CONTEXT:'Wallet actions require HTTPS or localhost.',
    SHARED_MEMORY_UNAVAILABLE:'Wallet actions require cross-origin isolation and shared memory. Check the hosting configuration or use a supported browser.',
    WASM_UNAVAILABLE:'This browser cannot run the required WebAssembly features.',
    WORKER_UNAVAILABLE:'Browser workers are unavailable or blocked. Check the browser and hosting settings.',
    CRYPTO_UNAVAILABLE:'Browser cryptography is unavailable.',
    LOCKS_UNAVAILABLE:'Browser storage locks are unavailable; wallet actions cannot safely continue.',
    BB_BROWSER_PROVER_CONFIGURATION:'Browser proving setup could not be verified. Reload this page and check the locally hosted setup files.',
    OPFS_UNAVAILABLE:'Private browser file storage is unavailable or blocked. Wallet storage cannot start.',
    STORAGE_UNAVAILABLE:'Browser storage is unavailable or blocked. Preserve your recovery file before changing browser settings.',
    READINESS_TIMEOUT:'Browser capability checks timed out. Retry before starting a wallet operation.',
    BB_CONNECTION_VERIFICATION_FAILED:'The portal, network or private fee contract could not be verified. Check the imported configuration before making a payment.',
    BB_FEE_CONFIG_REQUIRED:'Import private fee settings before depositing collateral or creating a new Aztec transaction. Recovery remains available.',
    BB_SUBMISSION_UNKNOWN:'Submission outcome is unknown. Keep the transaction record and check its receipt before retrying.',
    PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN:'Fee funding outcome is unknown. Keep its recovery file and check the transaction before retrying.',
    BB_PRIVATE_FEE_AMOUNT:'Deposit more than the configured maximum claim fee.',
    BB_TRANSACTION_FAILED:'The transaction did not execute successfully. Check its receipt before trying again.',
    BB_STATE_CONFLICT:'Transaction state changed. Refresh the account before creating a new proof.',
    BB_NO_SAVED_ETHEREUM_TRANSACTION:'No saved Ethereum request exists for this wallet and portal.',
    BB_ETH_RECOVERY_REQUIRED:'Check the saved Ethereum request in Wallet Setup before starting another payment.',
    BB_ETH_SUBMISSION_UNKNOWN:'Ethereum submission is uncertain. Keep this browser profile and check the saved Ethereum request in Wallet Setup.',
    BB_ETH_TRANSACTION_FAILED:'The Ethereum request reverted or was replaced. Check its saved request before starting another payment.',
    BB_RECOVERY_REQUIRED:'Recover the saved Aztec transaction from Wallet Setup before sending another transaction.',
    BB_JOURNAL_INVALID:'Transaction recovery storage could not be authenticated or saved. Preserve this browser profile and recovery records before continuing.',
    BB_NO_SAVED_TRANSACTION:'No saved Aztec transaction exists for this wallet and board.',
    BB_RECOVERY_UNKNOWN:'Recovery state could not be verified. Keep your recovery records and retry the lookup; do not create a replacement deposit.',
    BB_SETTLEMENT_PENDING:'Your withdrawal is recorded. Network settlement is pending; retry the Ethereum claim later.',
  };
  const code=typeof error?.code==='string'&&Object.hasOwn(messages,error.code)?error.code:'BB_OPERATION_FAILED';
  return Object.assign(new Error(messages[code]||'Wallet operation did not complete. Check the connection and recovery records; reload if the account or network changed.'),{code});
}

function makeCallEngine(engineFn, envExtra) {
  let running=false;
  return async function callEngine(action, statusDiv, extra) {
    if(running) throw new Error('Another wallet operation is in progress.');
    _assertWalletLive();
    const ws=window.walletState, generation=_walletGeneration;
    if(!ws?.aztec?.address) throw new Error('Load an Aztec wallet first.');
    const identity=()=>JSON.stringify([_getConfigRevision(),_connectionConfig(),ws.aztec?.secretKey,ws.aztec?.salt,ws.ethAccount,ws.ethChainId],(_,value)=>typeof value==='bigint'?value.toString():value);
    const expected=identity();
    async function guard() {
      _assertWalletLive();
      if(generation!==_walletGeneration || expected!==identity()) throw new Error('Wallet or deployment configuration changed. Reload before continuing.');
      if(ws.ethType==='browser') {
        const [accounts,chain]=await Promise.all([window.ethereum.request({method:'eth_accounts'}),window.ethereum.request({method:'eth_chainId'})]);
        if(!Array.isArray(accounts) || accounts[0]?.toLowerCase()!==ws.ethAccount.toLowerCase() || BigInt(chain)!==BigInt(ws.ethChainId)) {
          _invalidateWalletContext(); throw new Error('Wallet account or chain changed.');
        }
      }
      _assertWalletLive();
      if(generation!==_walletGeneration || expected!==identity()) throw new Error('Wallet or deployment configuration changed. Reload before continuing.');
    }
    async function verifyBoard() {
      if(!envExtra?.artifact || document.getElementById('deploymentManifest'))return;
      const config=_getPublicConfig(),api=window.BillboardPublic;
      if(!config || !api)throw new Error('Board verification is unavailable.');
      await api.connectPublicFeed({nodeUrl:config.network.nodeUrl,ethereumUrl:config.network.ethRpcUrl,
        portalAddress:config.board.portalAddress,expectedConfig:config,metadata:api.metadata,
        storage:api.browserPublicFeedStorage()});
      await guard();
      if(!window.BillboardConnectionCheck)throw new Error('Portal verification is unavailable.');
      await window.BillboardConnectionCheck.verify({sdk:window.__aztec,ethers,config,
        privateFeeArtifact:envExtra.privateFeeArtifact,
        verifyFee:['deposit','claim','post','withdraw','auto','declare-immoral','set-moderation-policy','transfer-censor'].includes(action)});
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
        if(envExtra?.artifact && !document.getElementById('deploymentManifest') && !_getPublicConfig()?.privateFee && ['deposit','claim','post','withdraw','auto','declare-immoral','set-moderation-policy','transfer-censor'].includes(action)) throw Object.assign(new Error('Private fee configuration required.'),{code:'BB_FEE_CONFIG_REQUIRED'});
        if(!window.BillboardReadiness) throw new Error('Browser capability checks are unavailable.');
        await window.BillboardReadiness.check();
        await guard();
        await verifyBoard();
        _currentStatusDiv=statusDiv;
        const env=buildEnv(envExtra),config=buildConfig(action,extra);
        const prior=config.preProveHook;
        config.contextGuard=guard;
        config.preProveHook=async value=>{await guard();await verifyBoard();if(prior)await prior(value);await guard();};
        env.getBrowserSigner=async()=>{
          await guard(); if(!ws.ethSigner) throw new Error('Connect an Ethereum wallet first.');
          const signer=ws.ethSigner;
          return new Proxy(signer,{get(target,property){
            const value=Reflect.get(target,property,target);
            if(typeof value!=='function')return value;
            if(['sendTransaction','signTransaction','signMessage','signTypedData'].includes(property))return async(...args)=>{await guard();await verifyBoard();await guard();return value.apply(target,args);};
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
