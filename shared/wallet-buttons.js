// ============================================================
// wallet-buttons.js — Common wallet loading UI for all apps
// ============================================================
//
// Renders buttons for loading or generating wallets:
//   AZTEC:  "Load from JSON"  |  "Generate"
//   ETH:    "Load from JSON"   |  "Generate"  |  "Load Browser Wallet"
//
// Button color states:
//   - When a wallet is loaded, its button turns green (.loaded)
//   - When the OTHER ETH wallet type is loaded, the remaining
//     ETH button turns greyish-green (.other) to indicate
//     "ETH is ready, but via the other method"
//
// When all required wallets are loaded (AZTEC + one ETH method),
// the onReady callback is called automatically.
//
// Usage:
//   initWalletButtons('walletButtonsContainer', {
//     statusId: 'setupStatus',
//     ethRpcUrl: 'https://invictus.ambire.com/ethereum',
//     requireEth: true,        // default true
//     onReady: async () => { ... },
//   });
//
// Global state is in window.walletState:
//   .aztec       — { secretKey, salt, address, partialAddress } or null
//   .ethSigner   — ethers Signer or null
//   .ethProvider — ethers Provider or null
//   .ethAccount  — string (hex address) or null
//   .ethType     — 'json' | 'browser' | null
// ============================================================

const DEFAULT_ETH_RPC = 'https://invictus.ambire.com/ethereum';

// Global wallet state
window.walletState = window.walletState || {
  aztec: null,
  ethSigner: null,
  ethProvider: null,
  ethAccount: null,
  ethType: null,
};

// Internal state
let _onReady = null;
let _statusId = 'setupStatus';
let _ethRpcUrl = DEFAULT_ETH_RPC;
let _requireEth = true;
let _readyFired = false;

function _wlog(msg, type) {
  if (typeof log === 'function') {
    log(msg, type || 'info', _statusId);
  }
}

// Update button colors based on current wallet state
function _updateButtonColors() {
  const aztecBtn = document.getElementById('wbAztecBtn');
  const aztecGenBtn = document.getElementById('wbAztecGenBtn');
  const ethJsonBtn = document.getElementById('wbEthJsonBtn');
  const ethGenBtn = document.getElementById('wbEthGenBtn');
  const ethBrowserBtn = document.getElementById('wbEthBrowserBtn');

  // AZTEC buttons
  [aztecBtn, aztecGenBtn].forEach(b => b && b.classList.remove('loaded', 'other'));
  const aztecFromEthBtn = document.getElementById('wbAztecFromEthBtn');
  if (aztecFromEthBtn) aztecFromEthBtn.classList.remove('loaded', 'other');
  if (window.walletState.aztec) {
    if (aztecBtn) aztecBtn.classList.add('loaded');
    if (aztecGenBtn) aztecGenBtn.classList.add('other');
    if (aztecFromEthBtn) aztecFromEthBtn.classList.add('other');
  }

  // ETH buttons
  [ethJsonBtn, ethGenBtn, ethBrowserBtn].forEach(b => b && b.classList.remove('loaded', 'other'));
  if (window.walletState.ethType === 'json') {
    if (ethJsonBtn) ethJsonBtn.classList.add('loaded');
    if (ethGenBtn) ethGenBtn.classList.add('other');
    if (ethBrowserBtn) ethBrowserBtn.classList.add('other');
  } else if (window.walletState.ethType === 'browser') {
    if (ethBrowserBtn) ethBrowserBtn.classList.add('loaded');
    if (ethJsonBtn) ethJsonBtn.classList.add('other');
    if (ethGenBtn) ethGenBtn.classList.add('other');
  }
}

// Check if all required wallets are loaded; if so, fire onReady
function _checkReady() {
  if (_readyFired) return;
  const hasAztec = !!window.walletState.aztec;
  const hasEth = !!window.walletState.ethSigner;
  if (hasAztec && (!_requireEth || hasEth)) {
    _readyFired = true;
    _wlog('All wallets loaded. Starting...', 'success');
    if (_onReady) {
      _onReady().catch(err => {
        _wlog('Setup failed: ' + (err.message || err), 'error');
        console.error(err);
      });
    }
  }
}

// Load AZTEC wallet from JSON file
async function _loadAztecWallet(file) {
  const text = await file.text();
  const w = JSON.parse(text);
  if (!w.secretKey) throw new Error('No secretKey in wallet JSON.');

  // Populate hidden DOM inputs for backwards compat with aztec-lib.js
  const skInput = document.getElementById('secretKey');
  const saltInput = document.getElementById('salt');
  if (skInput) skInput.value = w.secretKey;
  if (saltInput) {
    const currentSalt = parseInt(saltInput.value) || 0;
    if (currentSalt === 0 && w.salt !== undefined) {
      const s = typeof w.salt === 'string' ? parseInt(w.salt, 16) : w.salt;
      saltInput.value = (isNaN(s) ? 0 : s);
    }
  }

  // Derive address if bundle is available
  let address = null, partialAddress = null;
  if (window.__aztec && window.__aztec.Fr) {
    try {
      const a = window.__aztec;
      const saltVal = typeof w.salt === 'string' ? parseInt(w.salt, 16) : (w.salt || 0);
      const result = await _deriveAccountAddress(a, w.secretKey, saltVal);
      address = result.address;
      partialAddress = result.partialAddress;
    } catch (e) {
      // Non-critical — address will be derived later by the app
    }
  }

  window.walletState.aztec = {
    secretKey: w.secretKey,
    salt: typeof w.salt === 'string' ? parseInt(w.salt, 16) : (w.salt || 0),
    address,
    partialAddress,
    raw: w,
  };

  _wlog('AZTEC wallet loaded' + (address ? ': ' + address.toString() : ''), 'success');
  _updateButtonColors();
  _checkReady();
}

// Derive account address (inline to avoid dependency on aztec-lib load order)
async function _deriveAccountAddress(a, secretKeyHex, saltVal) {
  const secretKey = a.Fr.fromHexString(secretKeyHex);
  const signingKey = a.deriveSigningKey(secretKey);
  const accountContract = new a.SchnorrInitializerlessAccountContract(signingKey);
  const { publicKeys } = await a.deriveKeys(secretKey);
  const accountArtifact = await accountContract.getContractArtifact();
  const immutablesHash = await accountContract.getImmutablesHash();
  const instance = await a.getContractInstanceFromInstantiationParams(accountArtifact, {
    constructorArtifact: undefined, constructorArgs: undefined,
    salt: new a.Fr(saltVal), publicKeys, immutablesHash,
  });
  const partialAddress = await a.computePartialAddress(instance);
  return { address: instance.address, partialAddress };
}

// Load ETH wallet from JSON file
async function _loadEthWalletJson(file) {
  const text = await file.text();
  const w = JSON.parse(text);
  if (!w.privateKey) throw new Error('No privateKey in ETH wallet JSON.');
  const provider = new ethers.JsonRpcProvider(_ethRpcUrl);
  const wallet = new ethers.Wallet(w.privateKey, provider);
  window.walletState.ethProvider = provider;
  window.walletState.ethSigner = wallet;
  window.walletState.ethAccount = wallet.address;
  window.walletState.ethType = 'json';
  _wlog('ETH wallet loaded from JSON: ' + wallet.address, 'success');
  _updateButtonColors();
  _checkReady();
}

// Load ETH wallet from browser wallet (window.ethereum)
async function _loadEthBrowser() {
  if (!window.ethereum) {
    _wlog('No browser wallet found. Install one or load an ETH wallet JSON.', 'error');
    return;
  }
  _wlog('Connecting to browser wallet...', 'info');
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const net = await provider.getNetwork();
  if (net.chainId !== 1n) {
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] });
    } catch (e) { throw new Error('Switch your browser wallet to Ethereum Mainnet.'); }
  }
  const signer = await provider.getSigner();
  window.walletState.ethProvider = provider;
  window.walletState.ethSigner = signer;
  window.walletState.ethAccount = await signer.getAddress();
  window.walletState.ethType = 'browser';
  _wlog('Browser wallet connected: ' + window.walletState.ethAccount, 'success');
  _updateButtonColors();
  _checkReady();
}

// ============================================================
// Wallet generation
// ============================================================

// Download a JSON file to the user's computer
function _downloadJson(filename, obj) {
  const text = JSON.stringify(obj, null, 2) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Generate a random Aztec wallet (random secret key, salt=0),
// download the JSON, and immediately set it as the active wallet.
async function _generateAztecWallet() {
  _wlog('Generating Aztec wallet...', 'info');
  // Generate a random 32-byte secret key mod p
  const MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  let bi;
  do {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    bi = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')) % MODULUS;
  } while (bi === 0n);
  const secretKey = '0x' + bi.toString(16).padStart(64, '0');
  const salt = 0;

  await _setAztecWalletFromSecret(secretKey, salt, 'aztec_wallet.json', 'Aztec wallet generated');
}

// Generate an Aztec wallet from the loaded ETH wallet via signature-as-seed.
// The ETH wallet signs a deterministic message; the first 32 bytes of the
// signature (reduced mod p) become the Aztec secret key.
async function _generateAztecFromEth() {
  if (!window.walletState.ethSigner) {
    _wlog('Load an ETH wallet first (JSON, Generate, or Browser).', 'error');
    return;
  }
  const signer = window.walletState.ethSigner;
  const ethAddr = window.walletState.ethAccount;
  _wlog('Deriving Aztec wallet from ETH wallet ' + ethAddr + '...', 'info');
  _wlog('  Signing message with ETH wallet...', 'info');
  const msg = 'Aztec Account Derivation\nAddress: ' + ethAddr + '\nDomain: aztec-billboard';
  let sig;
  try {
    sig = await signer.signMessage(msg);
  } catch (e) {
    _wlog('ETH wallet refused to sign: ' + (e.message || e), 'error');
    return;
  }
  // Take first 32 bytes of the signature, reduce mod p
  const MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const sigBytes = sig.slice(2, 66); // first 32 bytes (r component)
  let bi = BigInt('0x' + sigBytes) % MODULUS;
  if (bi === 0n) bi = 1n; // avoid zero
  const secretKey = '0x' + bi.toString(16).padStart(64, '0');
  const salt = 0;

  await _setAztecWalletFromSecret(secretKey, salt, null, 'Aztec wallet derived from ETH signature');
}

// Common: set an Aztec wallet from a secret key + salt, derive address, download, activate
async function _setAztecWalletFromSecret(secretKey, salt, filename, label) {
  // Derive address if bundle is available
  let address = null, partialAddress = null;
  if (window.__aztec && window.__aztec.Fr) {
    try {
      const a = window.__aztec;
      const result = await _deriveAccountAddress(a, secretKey, salt);
      address = result.address;
      partialAddress = result.partialAddress;
    } catch (e) {
      // Non-critical — address will be derived later
    }
  }

  const walletJson = {
    secretKey,
    salt: '0x' + salt.toString(16).padStart(64, '0'),
    address: address ? address.toString() : undefined,
    partialAddress: partialAddress ? partialAddress.toString() : undefined,
  };

  if (filename) {
    _downloadJson(filename, walletJson);
    _wlog(label + ' and downloaded: ' + filename, 'success');
  } else {
    _wlog(label, 'success');
  }

  // Populate hidden DOM inputs for backwards compat
  const skInput = document.getElementById('secretKey');
  const saltInput = document.getElementById('salt');
  if (skInput) skInput.value = secretKey;
  if (saltInput) saltInput.value = salt;

  window.walletState.aztec = {
    secretKey,
    salt,
    address,
    partialAddress,
    raw: walletJson,
  };

  _wlog('Aztec wallet set' + (address ? ': ' + address.toString() : ''), 'success');
  _updateButtonColors();
  _checkReady();
}

// Generate a random ETH wallet, download the JSON, and immediately set it.
async function _generateEthWallet() {
  _wlog('Generating ETH wallet...', 'info');
  const wallet = ethers.Wallet.createRandom();
  const walletJson = {
    privateKey: wallet.privateKey,
    address: wallet.address,
  };

  _downloadJson('eth_wallet.json', walletJson);
  _wlog('ETH wallet generated and downloaded: eth_wallet.json', 'success');

  // Set as active wallet (same logic as _loadEthWalletJson)
  const provider = new ethers.JsonRpcProvider(_ethRpcUrl);
  const w = new ethers.Wallet(wallet.privateKey, provider);
  window.walletState.ethProvider = provider;
  window.walletState.ethSigner = w;
  window.walletState.ethAccount = w.address;
  window.walletState.ethType = 'json';
  _wlog('ETH wallet set: ' + w.address, 'success');
  _updateButtonColors();
  _checkReady();
}

// ============================================================
// initWalletButtons — render the 3 buttons and wire up events
// ============================================================
function initWalletButtons(containerId, options) {
  options = options || {};
  _statusId = options.statusId || 'setupStatus';
  _ethRpcUrl = options.ethRpcUrl || DEFAULT_ETH_RPC;
  _requireEth = options.requireEth !== false;
  _onReady = options.onReady || null;
  _readyFired = false;

  const container = document.getElementById(containerId);
  if (!container) { console.error('Container not found:', containerId); return; }

  // Hidden file inputs + buttons
  container.innerHTML = `
    <input type="file" id="wbAztecFile" accept=".json" style="display:none">
    <input type="file" id="wbEthJsonFile" accept=".json" style="display:none">
    <div class="wallet-btns">
      <div class="wallet-group">
        <span class="wallet-label">ETH <small>(any one)</small></span>
        <div class="wallet-btn-row">
          <button class="secondary wallet-btn" id="wbEthJsonBtn">Load from JSON</button>
          <button class="secondary wallet-btn" id="wbEthGenBtn">Generate</button>
          <button class="secondary wallet-btn" id="wbEthBrowserBtn">Browser Wallet</button>
        </div>
      </div>
      <div class="wallet-group">
        <span class="wallet-label">AZTEC</span>
        <div class="wallet-btn-row">
          <button class="secondary wallet-btn" id="wbAztecBtn">Load from JSON</button>
          <button class="secondary wallet-btn" id="wbAztecGenBtn">Generate</button>
          <button class="secondary wallet-btn" id="wbAztecFromEthBtn">From ETH Wallet</button>
        </div>
      </div>
    </div>
  `;

  // Wire up buttons
  document.getElementById('wbAztecBtn').addEventListener('click', () => {
    document.getElementById('wbAztecFile').click();
  });
  document.getElementById('wbAztecGenBtn').addEventListener('click', () => {
    _generateAztecWallet().catch(err => _wlog('Failed: ' + err.message, 'error'));
  });
  document.getElementById('wbAztecFromEthBtn').addEventListener('click', () => {
    _generateAztecFromEth().catch(err => _wlog('Failed: ' + err.message, 'error'));
  });
  document.getElementById('wbEthJsonBtn').addEventListener('click', () => {
    document.getElementById('wbEthJsonFile').click();
  });
  document.getElementById('wbEthGenBtn').addEventListener('click', () => {
    _generateEthWallet().catch(err => _wlog('Failed: ' + err.message, 'error'));
  });
  document.getElementById('wbEthBrowserBtn').addEventListener('click', () => {
    _loadEthBrowser().catch(err => _wlog('Failed: ' + err.message, 'error'));
  });

  // Wire up file inputs
  document.getElementById('wbAztecFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await _loadAztecWallet(file); }
    catch (err) { _wlog('Failed to load AZTEC wallet: ' + err.message, 'error'); }
    e.target.value = ''; // allow re-selecting same file
  });
  document.getElementById('wbEthJsonFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await _loadEthWalletJson(file); }
    catch (err) { _wlog('Failed to load ETH wallet: ' + err.message, 'error'); }
    e.target.value = '';
  });

  _updateButtonColors();
}

// Reset wallet state (e.g. when switching pages or re-initializing)
function resetWalletState() {
  window.walletState.aztec = null;
  window.walletState.ethSigner = null;
  window.walletState.ethProvider = null;
  window.walletState.ethAccount = null;
  window.walletState.ethType = null;
  _readyFired = false;
  _updateButtonColors();
}
