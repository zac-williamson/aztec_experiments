// ============================================================
// Fee Juice App — Thin wrapper around engine.js
// ============================================================
// Pages: Wallet Setup → Deposit AZTEC → Claim Fee Juice
// Uses shared/app-env.js for env/config building + log routing.

// ============================================================
// Global state
// ============================================================
let _handles = null;   // { aztecNode, address, ... } from status action
let _stateResult = null;
let _depositInfo = null; // { amount, secret, leafIndex, txHash } from deposit/scan

// ============================================================
// Bundle readiness
// ============================================================
if (!checkBundle('setupStatus')) {
  waitForBundle(() => checkBundle('setupStatus'));
}
setupRpcAuth();

// ============================================================
// Engine caller with log routing
// ============================================================
const callEngine = makeCallEngine(runFeeJuiceFlow);

// ============================================================
// Pagination
// ============================================================
initPages([
  { label: 'Wallet Setup', busyText: 'Setting up...', statusId: 'setupStatus' },
  { label: 'Deposit AZTEC', busyText: 'Depositing...', statusId: 'depositStatus', action: doDepositPage, onShow: onShowDeposit },
  { label: 'Claim Fee Juice', busyText: 'Claiming...', statusId: 'claimStatus', action: doClaimPage, onShow: onShowClaim },
]);

// ============================================================
// Page 0: Wallet Setup (fully automatic)
// ============================================================
async function loadWalletAndCheck() {
  const ws = window.walletState;
  if (!ws || !ws.aztec || !ws.aztec.secretKey) throw new Error('Aztec wallet not loaded.');
  if (!ws || !ws.ethSigner) throw new Error('ETH wallet not loaded.');

  const result = await callEngine('status', 'setupStatus', { dataDirPrefix: 'pxe_fj_' });
  _handles = result.handles;

  // Auto-fill Aztec address
  document.getElementById('azaddr').value = result.address;

  log('Setup complete. Fee Juice balance: ' + (BigInt(result.feeJuiceBalance) > 0n ? result.feeJuiceBalance + ' wei' : '0'), 'success', 'setupStatus');
  return result;
}

// ============================================================
// Page 1: Deposit AZTEC
// ============================================================
function onShowDeposit() {
  if (_handles && _handles.address) {
    document.getElementById('azaddr').value = _handles.address.toString();
  }
  autoScanDeposits();
}

async function autoScanDeposits() {
  const S = 'depositStatus';
  try {
    log('Checking for existing unclaimed deposits...', 'info', S);
    const result = await callEngine('scan', S, { dataDirPrefix: 'pxe_fj_' });
    if (result.ok && result.depositInfo) {
      const di = result.depositInfo;
      log('Found unclaimed deposit!', 'success', S);
      log('  Amount: ' + di.amount + ' wei', 'info', S);
      log('  Leaf index: ' + di.leafIndex, 'info', S);
      log('  Tx: ' + di.txHash, 'info', S);
      log('  Available: ' + di.available, 'info', S);

      _depositInfo = di;
      document.getElementById('claimSecret').value = di.secret;
      document.getElementById('claimAmount').value = di.amount;
      document.getElementById('leafIndex').value = di.leafIndex;
      document.getElementById('l1TxHash').value = di.txHash;

      if (di.available) {
        log('Deposit is ready — auto-claiming...', 'success', S);
        setTimeout(() => nextPage(), 1500);
      } else {
        log('Deposit found but not yet checkpointed. Wait ~5-10 min then use the Claim page.', 'warn', S);
      }
      return;
    }
    log('No unclaimed deposits found. Make a new deposit below.', 'info', S);
  } catch (e) {
    log('Auto-scan failed: ' + (e.message || e), 'warn', S);
  }
}

async function doDepositPage() {
  const S = 'depositStatus';
  clearMissingHighlight();

  const amountStr = document.getElementById('amount').value.trim();
  if (!amountStr) { highlightMissing(['amount']); throw new Error('Enter an amount.'); }

  const result = await callEngine('deposit', S, {
    depositAmount: amountStr, dataDirPrefix: 'pxe_fj_',
  });

  if (result.ok && result.depositInfo) {
    const di = result.depositInfo;
    di.available = true; // deposit action waits for checkpoint, so it's ready
    _depositInfo = di;
    document.getElementById('claimSecret').value = di.secret;
    document.getElementById('claimAmount').value = di.amount;
    document.getElementById('leafIndex').value = di.leafIndex;
    document.getElementById('l1TxHash').value = di.txHash;
    log('Deposit complete and checkpointed!', 'success', S);
    log('Auto-claiming...', 'success', S);
  }
}

// Recover button — recover a past deposit from tx hash
async function recoverSecret() {
  withBtn('recoverBtn', 'Recovering...', 'recoverStatus', async () => {
    const S = 'recoverStatus';
    const txHash = document.getElementById('recoverTxHash').value.trim();

    if (txHash) {
      log('Recovering deposit from tx hash ' + txHash.substring(0, 12) + '...', 'info', S);
    } else {
      log('No tx hash provided — backward scanning L1 for your deposits...', 'info', S);
    }

    const extra = { dataDirPrefix: 'pxe_fj_' };
    if (txHash) extra.reuseTxHash = txHash;
    const result = await callEngine('scan', S, extra);
    if (result.ok && result.depositInfo) {
      const di = result.depositInfo;
      _depositInfo = di;
      document.getElementById('claimSecret').value = di.secret;
      document.getElementById('claimAmount').value = di.amount;
      document.getElementById('leafIndex').value = di.leafIndex;
      document.getElementById('l1TxHash').value = di.txHash;
      document.getElementById('recoverTxHash').value = di.txHash;
      log('Deposit recovered!', 'success', S);
      if (di.available) {
        log('Deposit is ready — auto-claiming...', 'success', S);
        setTimeout(() => nextPage(), 1500);
      } else {
        log('Deposit found but not yet checkpointed. Wait ~5-10 min then go to Claim page.', 'warn', S);
      }
    } else {
      throw new Error('No unclaimed deposit found' + (txHash ? ' for that tx hash' : '') + '.');
    }
  });
}

// ============================================================
// Page 2: Claim Fee Juice on L2
// ============================================================
function onShowClaim() {
  if (_depositInfo) {
    document.getElementById('claimSecret').value = _depositInfo.secret;
    document.getElementById('claimAmount').value = _depositInfo.amount;
    document.getElementById('leafIndex').value = _depositInfo.leafIndex;
    if (_depositInfo.txHash) {
      document.getElementById('l1TxHash').value = _depositInfo.txHash;
    }

    // Auto-claim if deposit is ready
    if (_depositInfo.available) {
      const navBtn = document.getElementById('navNext');
      if (navBtn) navBtn.style.display = 'none';
      log('Deposit is ready — auto-claiming...', 'success', 'claimStatus');
      doClaimPage().catch(e => {
        log('Auto-claim failed: ' + (e.message || e), 'error', 'claimStatus');
        console.error(e);
        if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Retry Claim \u2192'; }
      });
    } else {
      log('Deposit not yet checkpointed. Wait ~5-10 min then press the button.', 'warn', 'claimStatus');
    }
  }
}

async function doClaimPage() {
  const S = 'claimStatus';
  clearMissingHighlight();

  const claimSecret = document.getElementById('claimSecret').value.trim();
  const claimAmount = document.getElementById('claimAmount').value.trim();
  const leafIndex = document.getElementById('leafIndex').value.trim();

  if (!claimSecret) { highlightMissing(['claimSecret']); throw new Error('Enter claim secret.'); }
  if (!claimAmount) { highlightMissing(['claimAmount']); throw new Error('Enter claim amount.'); }
  if (!leafIndex) { highlightMissing(['leafIndex']); throw new Error('Enter leaf index.'); }

  const extra = {
    depositAmount: claimAmount,
    depositSecret: claimSecret,
    depositLeafIndex: leafIndex,
    dataDirPrefix: 'pxe_fj_',
  };
  if (_depositInfo && _depositInfo.messageHash) {
    extra.depositMessageHash = _depositInfo.messageHash;
  }

  await callEngine('claim', S, extra);

  log('Fee Juice claimed successfully!', 'success', S);
}

// Fetch deposit info from L1 tx hash (manual entry on claim page)
async function fetchDepositInfo() {
  withBtn('fetchBtn', 'Fetching...', 'fetchStatus', async () => {
    const S = 'fetchStatus';
    const txHash = document.getElementById('l1TxHash').value.trim();
    // tx hash is optional — backward scan if not provided

    log('Fetching deposit info from L1' + (txHash ? ' from tx ' + txHash.substring(0, 12) : ' (backward scan)') + '...', 'info', S);
    const extra = { dataDirPrefix: 'pxe_fj_' };
    if (txHash) extra.reuseTxHash = txHash;
    const result = await callEngine('scan', S, extra);
    if (result.ok && result.depositInfo) {
      const di = result.depositInfo;
      document.getElementById('claimSecret').value = di.secret;
      document.getElementById('claimAmount').value = di.amount;
      document.getElementById('leafIndex').value = di.leafIndex;
      log('Deposit info fetched!', 'success', S);
    } else {
      throw new Error('No unclaimed deposit found. Make sure you have a deposit on L1.');
    }
  });
}

// ============================================================
// Init — wallet buttons with auto-advance on success
// ============================================================
function waitForBundleThenInit() {
  if (window.__aztec && window.__aztec.createPXE) {
    const navNext = document.getElementById('navNext');
    if (navNext) navNext.style.display = 'none';
    initWalletButtons('walletButtonsContainer', {
      statusId: 'setupStatus',
      ethRpcUrl: ETH_RPC_URL,
      onReady: async () => {
        try {
          await loadWalletAndCheck();
          nextPage();
        } catch (e) {
          log('Setup failed: ' + (e.message || e), 'error', 'setupStatus');
          console.error(e);
        }
      },
    });
  } else {
    setTimeout(waitForBundleThenInit, 500);
  }
}
waitForBundleThenInit();
