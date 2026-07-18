// ============================================================
// app.js — Browser wrapper for the deploy engine
// ============================================================
// Thin layer: loads wallet buttons, builds env/config from
// shared/app-env.js, calls runDeploy().
// ============================================================

// ============================================================
// Bundle readiness
// ============================================================
if (!checkBundle('status')) {
  waitForBundle(() => checkBundle('status'));
}

// Setup RPC auth immediately
setupRpcAuth();

// ============================================================
// Pause handler — file picker for wallet imports
// ============================================================
function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept || '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async (e) => {
      document.body.removeChild(input);
      const file = e.target.files[0];
      if (!file) { reject(new Error('No file selected')); return; }
      try {
        const text = await file.text();
        resolve(JSON.parse(text));
      } catch (err) {
        reject(new Error('Failed to parse file: ' + err.message));
      }
    });
    input.click();
  });
}

async function pause(reason, data) {
  if (reason === 'import-aztec-wallet') {
    log('Please select your Aztec wallet.json file...', 'info', 'status');
    const wallet = await pickFile('.json');
    log('  Loaded: ' + (wallet.address || '(no address field)'), 'success', 'status');
    return wallet;
  }
  if (reason === 'import-eth-wallet') {
    log('Please select your ETH wallet JSON file...', 'info', 'status');
    const wallet = await pickFile('.json');
    log('  Loaded: ' + wallet.address, 'success', 'status');
    return wallet;
  }
  throw new Error('Unknown pause reason: ' + reason);
}

// ============================================================
// Threading detection
// ============================================================
function getThreadingMode() {
  if (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
    return 'multi-threaded (crossOriginIsolated)';
  }
  if (location.protocol === 'file:') {
    return 'single-threaded (file://)';
  }
  return 'single-threaded (no COOP/COEP headers)';
}

// ============================================================
// Main — start the deploy flow
// ============================================================
async function startDeploy() {
  clearStatus('status');

  const threading = getThreadingMode();
  log('Threading mode: ' + threading, 'info', 'status');
  log('Protocol: ' + location.protocol, 'info', 'status');

  if (!window.__aztec || !window.__aztec.createPXE) {
    log('ERROR: Aztec bundle not loaded. Refresh the page.', 'error', 'status');
    return;
  }

  const contractSalt = parseInt(document.getElementById('contractSalt').value) || 1;
  const ws = window.walletState;

  _currentStatusDiv = 'status';
  const env = buildEnv({ pause: pause, portalBytecode: PORTAL_BYTECODE, artifact: BILLBOARD_ARTIFACT });
  const config = buildConfig(null, {
    contractSalt: contractSalt,
    dataDirPrefix: 'pxe_bb_',
  });

  try {
    const result = await runDeploy(env, config);
    log('', 'info', 'status');
    log('All done! Copy these addresses for the user app:', 'success', 'status');
    log('  L2: ' + result.l2Addr, 'info', 'status');
    log('  L1: ' + result.portalAddr, 'info', 'status');
  } catch (e) {
    log('', 'error', 'status');
    log('ERROR: ' + (e.stack || e.message || String(e)), 'error', 'status');
    console.error(e);
  }
}

// ============================================================
// Init — wallet buttons with auto-start
// ============================================================
function waitForBundleThenInit() {
  if (window.__aztec && window.__aztec.createPXE) {
    initWalletButtons('walletButtonsContainer', {
      statusId: 'status',
      ethRpcUrl: ETH_RPC_URL,
      onReady: async () => {
        await startDeploy();
      },
    });
  } else {
    setTimeout(waitForBundleThenInit, 500);
  }
}
waitForBundleThenInit();
