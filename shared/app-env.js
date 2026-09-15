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

// ETH RPC URL (not declared in aztec-lib.js, safe to keep)
const ETH_RPC_URL = window.RPC_CONFIG?.ethRpcUrl || 'https://invictus.ambire.com/ethereum';

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
  if (window.__aztec && window.__aztec.createPXE) { cb(); return; }
  let tries = 0;
  const interval = setInterval(() => {
    if ((window.__aztec && window.__aztec.createPXE) || ++tries > 120) {
      clearInterval(interval);
      if (window.__aztec && window.__aztec.createPXE) cb();
    }
  }, 500);
}

// ============================================================
// RPC config helpers (use aztec-lib.js's getNodeUrl if available)
// ============================================================
function _getNodeUrl() {
  if (typeof getNodeUrl !== 'undefined') return getNodeUrl();
  const cfg = window.RPC_CONFIG;
  return cfg && cfg.nodeUrl ? cfg.nodeUrl : 'https://v5.mainnet.rpc.aztec-labs.com';
}

function _getApiKey() {
  if (typeof getApiKey !== 'undefined') return getApiKey();
  const cfg = window.RPC_CONFIG;
  return cfg && cfg.apiKey ? cfg.apiKey : '';
}

// Monkey-patch fetch to add API key header for Aztec RPC
function setupRpcAuth() {
  const cfg = window.RPC_CONFIG;
  if (!cfg || !cfg.apiKey) return;
  if (window._rpcAuthPatched) return;
  const apiKey = cfg.apiKey;
  const origFetch = window.fetch.bind(window);
  const endpoint = new URL(_getNodeUrl(), window.location.href);
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('Invalid Aztec RPC endpoint');
  window._rpcAuthPatched = true;
  window.fetch = function(input, init) {
    const credentials = init?.credentials ?? (input instanceof Request ? input.credentials : undefined);
    const referrerPolicy = init?.referrerPolicy ?? (input instanceof Request ? input.referrerPolicy : undefined);
    if (credentials === 'omit' && referrerPolicy === 'no-referrer') return origFetch(input, init);
    const target = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    // Only this configured JSON-RPC endpoint receives its credential. Substring
    // matching would also disclose it to unrelated URLs containing the hostname.
    if (target.origin === endpoint.origin && target.pathname === endpoint.pathname) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('x-aztec-api-key', apiKey);
      // A redirect must not forward the credential outside the checked endpoint.
      const options = { ...init, headers, redirect: 'error' };
      return origFetch(input, options);
    }
    return origFetch(input, init);
  };
}

// ============================================================
// CRS initialization (browser) — tries local files, falls back to CDN
// CRS constants are inlined to avoid conflicts with aztec-lib.js
// ============================================================
function makeInitCRS() {
  return async function initializeCRS() {
    const a = window.__aztec;
    const crs = window.BillboardCRS;
    if (!crs) throw new Error('Missing CRS client; rebuild the application');
    await a.BarretenbergSync.initSingleton();
    await crs.initialize(a.BarretenbergSync.getSingleton(), {
      manifest: window.BILLBOARD_CRS_MANIFEST,
      loadLocal: async file => crs.readResponse(await fetch('crs/' + file.name, { signal: AbortSignal.timeout(120000) }), file),
      sha256: async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join(''),
      log: (message, level) => log('  ' + message, level, _currentStatusDiv),
    });
  };
}

// ============================================================
// PXE store creation (browser: IndexedDB)
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
  const config = {
    aztecNodeUrl: _getNodeUrl(),
    aztecApiKey: _getApiKey(),
    ethRpcUrl: ETH_RPC_URL,
    aztecWallet: ws && ws.aztec ? { secretKey: ws.aztec.secretKey, salt: ws.aztec.salt } : null,
    ethWallet: ethWallet,
    hasEthSigner: !!ws?.ethSigner,
    // Public deployment configuration; fee funds belong to this wallet.
    privateFee: window.billboardPrivateFee,
  };
  if (action) config.action = action;
  if (extra) Object.assign(config, extra);
  return config;
}

// ============================================================
// Call engine with log routing to a specific status div
// ============================================================
function makeCallEngine(engineFn, envExtra) {
  let running=false;
  return async function callEngine(action, statusDiv, extra) {
    if(running) throw new Error('Another wallet operation is in progress.');
    _assertWalletLive();
    const ws=window.walletState, generation=_walletGeneration;
    if(!ws?.aztec?.address) throw new Error('Load an Aztec wallet first.');
    const portal=()=>document.getElementById('portalAddr')?.value.trim() || '';
    const identity=()=>JSON.stringify([_getNodeUrl(),ETH_RPC_URL,portal(),ws.aztec?.secretKey,ws.aztec?.salt,ws.ethAccount,ws.ethChainId,window.billboardPrivateFee]);
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
    }
    if(!navigator.locks?.request) throw new Error('This browser cannot safely coordinate wallet tabs. Use a browser with Web Locks support.');
    // One operation per full account across tabs, including RPC aliases and networks. No secret in lock name.
    const lockName='billboard-wallet:'+ws.aztec.address.toString();
    running=true;
    try {
      return await navigator.locks.request(lockName,{ifAvailable:true},async lock=>{
        if(!lock) throw new Error('This wallet is busy in another tab.');
        await guard();
        _currentStatusDiv=statusDiv;
        const env=buildEnv(envExtra),config=buildConfig(action,extra);
        const prior=config.preProveHook;
        config.contextGuard=guard;
        config.preProveHook=async value=>{await guard();if(prior)await prior(value);await guard();};
        env.getBrowserSigner=async()=>{
          await guard(); if(!ws.ethSigner) throw new Error('Connect an Ethereum wallet first.');
          const signer=ws.ethSigner;
          return new Proxy(signer,{get(target,property){
            const value=Reflect.get(target,property,target);
            if(typeof value!=='function')return value;
            if(['sendTransaction','signTransaction','signMessage','signTypedData'].includes(property))return async(...args)=>{await guard();return value.apply(target,args);};
            return value.bind(target);
          }});
        };
        try {const result=await engineFn(env,config);await guard();return result;}
        catch(error) {
          // RPC/prover exceptions can include witness or request data. Only a
          // bounded public classification crosses into UI error/log handlers.
          const code=['BB_SUBMISSION_UNKNOWN','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN','BB_PRIVATE_FEE_AMOUNT'].includes(error?.code)?error.code:'BB_OPERATION_FAILED';
          const clean=new Error(code==='BB_OPERATION_FAILED'?'Operation did not complete. Check your wallet, network, balance and saved recovery records.':'Transaction needs attention. Keep your recovery record and check its outcome before retrying.');
          clean.code=code;throw clean;
        }
      });
    } catch(error) {
      const clean=new Error('Wallet operation did not complete. Check the connection and recovery records; reload if the account or network changed.');
      clean.code=['BB_SUBMISSION_UNKNOWN','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN','BB_PRIVATE_FEE_AMOUNT'].includes(error?.code)?error.code:'BB_OPERATION_FAILED';
      throw clean;
    } finally {running=false;}
  };
}
