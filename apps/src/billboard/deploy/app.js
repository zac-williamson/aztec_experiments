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
const callDeploy = makeCallEngine((env, config) => runDeploy(env, config), {
  pause, portalBytecode: PORTAL_BYTECODE, artifact: BILLBOARD_ARTIFACT,
  createJournalStorage: () => window.__aztec.createBrowserJournalStorage(),
  createTransactionJournal: options => window.__aztec.createL2Journal({...options, storage: window.__aztec.createBrowserJournalStorage()}),
});
let deploymentReportUrl;
async function startDeploy() {
  if(deploymentReportUrl){URL.revokeObjectURL(deploymentReportUrl);deploymentReportUrl=null;}
  clearStatus('status');

  const threading = getThreadingMode();
  log('Threading mode: ' + threading, 'info', 'status');
  log('Protocol: ' + location.protocol, 'info', 'status');

  if (!window.__aztec || !window.__aztec.createPXE) {
    log('ERROR: Aztec bundle not loaded. Refresh the page.', 'error', 'status');
    return;
  }

  let extraConfig;
  try{extraConfig=window.__aztec.deploymentManifestConfig(JSON.parse(document.getElementById('deploymentManifest').value));}
  catch(error){log('Import a valid reviewed deployment manifest before deploying.','error','status');return;}
  extraConfig.retryEthereum=document.getElementById('retryEthereum')?.checked===true;
  extraConfig.readyTxHash=document.getElementById('readyTxHash').value.trim()||undefined;
  extraConfig.dataDirPrefix='pxe_bb_';
  _currentStatusDiv='status';

  try {
    const result = await callDeploy('deploy', 'status', extraConfig);
    log('', 'info', 'status');
    log(result.status === 'active' ? 'Deployment complete. The board is ready to use.' : 'Deployment saved. Network settlement is pending; resume with the same settings later.', result.status === 'active' ? 'success' : 'info', 'status');
    const report=new Blob([JSON.stringify({schemaVersion:1,manifest:extraConfig.deploymentManifest,...result},null,2)],{type:'application/json'});
    const reportLink=document.createElement('a');reportLink.textContent='Download deployment report';reportLink.download='deployment-report.json';deploymentReportUrl=URL.createObjectURL(report);reportLink.href=deploymentReportUrl;document.getElementById('status').appendChild(reportLink);
    if (result.readyTxHash) document.getElementById('readyTxHash').value = result.readyTxHash;
    log('  Salt: ' + extraConfig.contractSalt, 'info', 'status');
    log('  L2:   ' + result.l2Addr, 'info', 'status');
    log('  L1:   ' + result.portalAddr, 'info', 'status');

    // Add a clickable link to the user app with the portal address pre-filled
    const statusDiv = document.getElementById('status');
    if (statusDiv && result.status === 'active') {
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
    initWalletButtons('walletButtonsContainer', {
      statusId: 'status',
      ethRpcUrl: ETH_RPC_URL,
      onReady: async () => {
        log('Both wallets ready. Click the Deploy button to begin.', 'success', 'status');
      },
    });
  } else {
    setTimeout(waitForBundleThenInit, 500);
  }
}
waitForBundleThenInit();

async function importDeploymentManifest(input){
  const file=input.files?.[0];if(!file)return;
  try{if(file.size>65536)throw Error();const text=await file.text();const m=window.__aztec.validateDeploymentManifest(JSON.parse(text));document.getElementById('deploymentManifest').value=JSON.stringify(m);document.getElementById('manifestSummary').textContent='Configuration to review: chain '+m.network.chainId+', rollup '+m.network.rollup+', Aztec deployer '+m.actors.aztecDeployer+', Ethereum deployer '+m.actors.ethereumDeployer+', censor '+m.board.censor+'. Deposit range (wei): '+m.board.minDeposit+'–'+m.board.maxDeposit+'. Policy: '+m.board.policy;}
  catch{document.getElementById('deploymentManifest').value='';document.getElementById('manifestSummary').textContent='Invalid deployment manifest.';}
}
