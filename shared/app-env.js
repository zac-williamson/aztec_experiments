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
  return async function initCRS() {
    const a = window.__aztec;
    const S = _currentStatusDiv;
    await a.BarretenbergSync.initSingleton();
    const bb = a.BarretenbergSync.getSingleton();

    // Use constants from aztec-lib.js if available, otherwise inline
    const hosts = (typeof CRS_HOSTS !== 'undefined') ? CRS_HOSTS
      : ['https://crs.aztec-cdn.foundation', 'https://crs.aztec-labs.com'];
    const srsNum = (typeof SRS_NUM_POINTS !== 'undefined') ? SRS_NUM_POINTS : (2 ** 20 + 1);
    const grumpkinNum = (typeof GRUMPKIN_NUM_POINTS !== 'undefined') ? GRUMPKIN_NUM_POINTS : (2 ** 16 + 1);

    async function fetchCRS(filename, options = {}) {
      try {
        const res = await fetch('crs/' + filename, options);
        if (res.ok || res.status === 206) {
          log('  Loaded ' + filename + ' from local file.', 'info', S);
          return res;
        }
        throw new Error('HTTP ' + res.status);
      } catch (localErr) {
        log('  Local ' + filename + ' unavailable, falling back to CDN...', 'warn', S);
        for (const host of hosts) {
          try {
            const res = await fetch(host + '/' + filename, options);
            if (res.ok || res.status === 206) {
              log('  Loaded ' + filename + ' from ' + host + '.', 'info', S);
              return res;
            }
          } catch (e) {}
        }
        throw new Error('Could not load ' + filename);
      }
    }

    log('  Loading BN254 G1 data...', 'info', S);
    const g1End = srsNum * 64 - 1;
    const g1Res = await fetchCRS('g1.dat', { headers: { Range: 'bytes=0-' + g1End } });
    const g1Data = new Uint8Array(await g1Res.arrayBuffer());

    log('  Loading BN254 G2 data...', 'info', S);
    const g2Res = await fetchCRS('g2.dat');
    const g2Data = new Uint8Array(await g2Res.arrayBuffer());

    log('  Loading Grumpkin G1 data...', 'info', S);
    const grumpkinEnd = grumpkinNum * 64 - 1;
    const grumpkinRes = await fetchCRS('grumpkin_g1.dat', { headers: { Range: 'bytes=0-' + grumpkinEnd } });
    const grumpkinG1Data = new Uint8Array(await grumpkinRes.arrayBuffer());

    log('  Loading BN254 SRS into wasm...', 'info', S);
    bb.srsInitSrs({ pointsBuf: g1Data, numPoints: srsNum, g2Point: g2Data });
    log('  Loading Grumpkin SRS into wasm...', 'info', S);
    bb.srsInitGrumpkinSrs({ pointsBuf: grumpkinG1Data, numPoints: grumpkinNum });
  };
}

// ============================================================
// PXE store creation (browser: IndexedDB)
// ============================================================
function makeCreateStore() {
  return async function createStore(config) {
    return window.__aztec.createIndexedDBStore('pxe_data', config);
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
