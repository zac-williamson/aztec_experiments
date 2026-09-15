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
  const censorAddrStr = (document.getElementById('censorAddr').value || '').trim();
  const kMultiplierStr = (document.getElementById('kMultiplier').value || '').trim();
  const minDepositEth = (document.getElementById('minDepositEth').value || '0.001').trim();
  const baseCooldown = parseInt(document.getElementById('baseCooldown').value || '3600');
  const censorWindow = parseInt(document.getElementById('censorWindow')?.value || '3600');
  const maxSaveUp = parseInt(document.getElementById('maxSaveUp')?.value || '16');
  const moderationPolicy = (document.getElementById('moderationPolicy') || {}).value || '';
  const ws = window.walletState;

  _currentStatusDiv = 'status';
  const env = buildEnv({ pause: pause, portalBytecode: PORTAL_BYTECODE, artifact: BILLBOARD_ARTIFACT });
  const extraConfig = {
    contractSalt: contractSalt,
    dataDirPrefix: 'pxe_bb_',
  };
  // Only pass censor config if the user provided values
  if (censorAddrStr) extraConfig.censor = censorAddrStr;
  if (kMultiplierStr) extraConfig.kMultiplier = parseInt(kMultiplierStr);
  // Deployer-configurable parameters
  extraConfig.minDepositWei = ethers.parseEther(minDepositEth);
  extraConfig.maxDepositWei = ethers.parseEther(document.getElementById('maxDepositEth').value.trim());
  extraConfig.readyTxHash = document.getElementById('readyTxHash').value.trim() || undefined;
  extraConfig.baseCooldown = baseCooldown;
  extraConfig.censorWindow = censorWindow;
  extraConfig.maxSaveUp = maxSaveUp;
  // Moderation policy (empty string => engine uses default)
  extraConfig.moderationPolicy = moderationPolicy.trim() || undefined;
  const config = buildConfig(null, extraConfig);

  try {
    const result = await runDeploy(env, config);
    log('', 'info', 'status');
    log('All done! Copy these addresses for the user app:', 'success', 'status');
    log('  Salt: ' + (extraConfig.contractSalt || 1), 'info', 'status');
    log('  L2:   ' + result.l2Addr, 'info', 'status');
    log('  L1:   ' + result.portalAddr, 'info', 'status');

    // Add a clickable link to the user app with the portal address pre-filled
    const statusDiv = document.getElementById('status');
    if (statusDiv) {
      const linkDiv = document.createElement('div');
      linkDiv.className = 'status success';
      linkDiv.style.marginTop = '8px';
      const a = document.createElement('a');
      a.href = 'user.html?portal=' + result.portalAddr;
      a.textContent = 'Open User App (L1 address pre-filled)';
      a.style.cssText = 'font-size:1.1em; font-weight:bold;';
      linkDiv.appendChild(a);
      statusDiv.appendChild(linkDiv);
    }
  } catch (e) {
    log('', 'error', 'status');
    log('ERROR: ' + 'operation did not complete; check configuration and recovery records', 'error', 'status');
    console.error('Application operation did not complete.');
  }
}

// ============================================================
// Init — wallet buttons with auto-start
// ============================================================
function waitForBundleThenInit() {
  if (window.__aztec && window.__aztec.createPXE) {
    // Pre-fill moderation policy textarea with the default policy
    const policyEl = document.getElementById('moderationPolicy');
    if (policyEl && !policyEl.value.trim() && window.DEFAULT_MODERATION_POLICY) {
      policyEl.value = window.DEFAULT_MODERATION_POLICY;
    }
    initWalletButtons('walletButtonsContainer', {
      statusId: 'status',
      ethRpcUrl: ETH_RPC_URL,
      onAztecLoad: (address) => {
        const censorInput = document.getElementById('censorAddr');
        if (censorInput && !censorInput.value.trim() && address) {
          censorInput.value = address.toString();
          log('Auto-filled censor address from loaded wallet: ' + address.toString(), 'info', 'status');
        }
      },
      onReady: async () => {
        log('Both wallets ready. Click the Deploy button to begin.', 'success', 'status');
      },
    });
  } else {
    setTimeout(waitForBundleThenInit, 500);
  }
}
waitForBundleThenInit();
