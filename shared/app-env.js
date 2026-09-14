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
const ETH_RPC_URL = 'https://invictus.ambire.com/ethereum';

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
  window._rpcAuthPatched = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url && url.includes('aztec-labs.com')) {
      init = init || {};
      init.headers = { ...(init.headers || {}), 'x-aztec-api-key': cfg.apiKey };
      if (typeof input === 'string') return origFetch(input, init);
      else { input = new Request(input, init); return origFetch(input); }
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
  };
  if (action) config.action = action;
  if (extra) Object.assign(config, extra);
  return config;
}

// ============================================================
// Call engine with log routing to a specific status div
// ============================================================
function makeCallEngine(engineFn, envExtra) {
  return async function callEngine(action, statusDiv, extra) {
    _currentStatusDiv = statusDiv;
    const env = buildEnv(envExtra);
    const config = buildConfig(action, extra);
    return await engineFn(env, config);
  };
}
