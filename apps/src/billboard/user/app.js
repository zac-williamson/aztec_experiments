// ============================================================
// Billboard User App — Thin wrapper around engine.js
// ============================================================
// Pages: Wallet Setup → Deposit ETH → Post → Withdraw → Claim L1
// The engine (engine.js) does all the heavy lifting. This file
// builds env/config from shared/app-env.js, calls the engine per
// page, and routes log output to page-specific status divs.
// Live UI (countdown, billboard feed) uses handles from the
// engine's status result.

const MSG_FIELDS = 32;
const MSG_BYTES = MSG_FIELDS * 31;

// ============================================================
// Global state — handles from the status action + UI state
// ============================================================
let _handles = null;   // { pxe, wallet, contract, aztecNode, address, l2Addr, ... }
let _stateResult = null; // result from status action

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
const callEngine = makeCallEngine(runBillboardUser, {
  artifact: typeof BILLBOARD_ARTIFACT !== 'undefined' ? BILLBOARD_ARTIFACT : null,
  portalBytecode: typeof PORTAL_BYTECODE !== 'undefined' ? PORTAL_BYTECODE : null,
});

// ============================================================
// Pagination
// ============================================================
initPages([
  { label: 'Wallet Setup', busyText: 'Setting up...', statusId: 'setupStatus' },
  { label: 'Deposit ETH', busyText: 'Processing...', statusId: 'depositStatus', action: doDepositPage, onShow: onShowDeposit },
  { label: 'Proceed to Withdraw', busyText: 'Checking eligibility...', statusId: 'proceedStatus', action: doProceedToWithdraw, onShow: onShowPost },
  { label: 'Withdraw on L2', busyText: 'Withdrawing...', statusId: 'withdrawStatus', action: doWithdrawPage, onShow: onShowWithdraw },
  { label: 'Claim ETH on L1', busyText: 'Claiming...', statusId: 'claimL1Status', action: doClaimL1Page, onShow: onShowClaimL1 },
]);

// ============================================================
// Page 0: Wallet Setup (fully automatic)
// ============================================================
async function loadWalletAndConnect() {
  const ws = window.walletState;
  if (!ws || !ws.aztec || !ws.aztec.secretKey) throw new Error('Aztec wallet not loaded.');
  if (!ws || !ws.ethSigner) throw new Error('ETH wallet not loaded.');

  // Call engine status action — does full setup (keys, node, CRS, PXE, sync, wallet)
  const result = await callEngine('status', 'setupStatus', {
    contractSalt: parseInt(document.getElementById('contractSalt').value) || 0,
    dataDirPrefix: 'pxe_bb_',
  });
  _handles = result.handles;
  _stateResult = result;

  // Auto-fill addresses in the UI
  document.getElementById('l2Addr').value = result.l2Addr;
  document.getElementById('portalAddr').value = result.portalAddr;
  if (result.handles.nodeInfo) {
    const l1Contracts = await _handles.aztecNode.getL1ContractAddresses();
    document.getElementById('rollupAddr').value = l1Contracts.rollupAddress;
    document.getElementById('version').value = result.handles.nodeInfo.rollupVersion;
  }

  log('Setup complete. State: ' + result.state, 'success', 'setupStatus');
  return result;
}

// ============================================================
// Page 1: Deposit ETH — auto-detects state from page 0
// ============================================================
function onShowDeposit() {
  if (_handles && _handles.portalAddr) {
    const el = document.getElementById('depositPortalAddr');
    if (el) el.value = _stateResult.portalAddr;
  }

  const state = _stateResult ? _stateResult.state : 'unknown';
  const newSection = document.getElementById('newDepositSection');
  const recoverSection = document.getElementById('recoverDepositSection');
  const navBtn = document.getElementById('navNext');

  if (state === 'zero_balance_need_deposit') {
    if (newSection) newSection.style.display = '';
    if (recoverSection) recoverSection.style.display = 'none';
    if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Deposit ETH \u2192'; }
  } else if (state === 'deposited_l1_not_claimed_l2') {
    if (newSection) newSection.style.display = 'none';
    if (recoverSection) recoverSection.style.display = '';
    if (navBtn) navBtn.style.display = 'none';
    log('Active L1 deposit found. Auto-claiming on L2...', 'info', 'depositBalanceCheck');
    doDepositPage().catch(e => {
      log('Auto-claim failed: ' + (e.message || e), 'error', 'depositBalanceCheck');
      console.error(e);
      if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Retry \u2192'; }
    });
  } else if (state === 'postable') {
    log('Deposit already claimed on L2. Proceeding to post page.', 'success', 'depositBalanceCheck');
    if (navBtn) navBtn.style.display = 'none';
    nextPage();
  } else if (state === 'withdrawn_l2_claimable_l1') {
    log('Deposit already withdrawn on L2. Jumping to L1 claim.', 'success', 'depositBalanceCheck');
    if (navBtn) navBtn.style.display = 'none';
    showPage(4);
  } else {
    if (newSection) newSection.style.display = '';
    if (recoverSection) recoverSection.style.display = 'none';
    if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Deposit ETH \u2192'; }
  }
}

async function doDepositPage() {
  const state = _stateResult ? _stateResult.state : 'unknown';
  const salt = parseInt(document.getElementById('contractSalt').value) || 0;

  if (state === 'postable') { nextPage(); return; }
  if (state === 'withdrawn_l2_claimable_l1') { showPage(4); return; }

  if (state === 'zero_balance_need_deposit') {
    clearMissingHighlight();
    const amountStr = document.getElementById('depositAmount').value.trim();
    if (!amountStr) { highlightMissing(['depositAmount']); throw new Error('Enter an amount.'); }
    const amountEth = parseFloat(amountStr);
    if (isNaN(amountEth) || amountEth <= 0) { highlightMissing(['depositAmount']); throw new Error('Invalid amount.'); }
    if (amountEth > 0.025) { highlightMissing(['depositAmount']); throw new Error('Maximum deposit is 0.025 ETH. This is alpha experimental software, not for production use.'); }

    // Phase 1: Deposit on L1
    log('Making new L1 deposit...', 'info', 'depositStatus');
    let depResult;
    try {
      depResult = await callEngine('deposit', 'depositStatus', {
        depositAmount: amountStr, contractSalt: salt, dataDirPrefix: 'pxe_bb_',
      });
    } catch (e) {
      const msg = e.message || String(e);
      if (/missing revert data|CALL_EXCEPTION|insufficient funds|gas required exceeds/i.test(msg)) {
        throw new Error('L1 deposit failed: not enough ETH balance for the deposit plus gas fees.');
      }
      throw e;
    }
    const depInfo = depResult.depositInfo;

    // Phase 2: Wait for L2 ingest + claim on L2
    log('', 'info', 'depositStatus');
    log('Waiting for L2 to ingest deposit, then claiming...', 'info', 'depositStatus');
    await callEngine('claim', 'depositStatus', {
      reuseTxHash: depInfo.txHash, contractSalt: salt, dataDirPrefix: 'pxe_bb_',
    });

    log('Deposit claimed on L2! Proceeding to post page.', 'success', 'depositStatus');
    _stateResult.state = 'postable';
    nextPage();
    return;
  }

  // deposited_l1_not_claimed_l2: claim the existing deposit
  const txHash = document.getElementById('existingTxHash').value.trim();
  const extra = { contractSalt: salt, dataDirPrefix: 'pxe_bb_' };
  if (txHash) extra.reuseTxHash = txHash;
  log('Claiming existing deposit on L2...', 'info', 'depositStatus');
  await callEngine('claim', 'depositStatus', extra);
  log('Deposit claimed on L2! Proceeding to post page.', 'success', 'depositStatus');
  _stateResult.state = 'postable';
  nextPage();
}

// ============================================================
// Page 2: Post Message + Billboard Feed
// ============================================================
let _countdownInterval = null;
let _countdownFetchInterval = null;
let _billboardInterval = null;
let _billboardLastCount = -1;
let _billboardLastBlock = -1;

function onShowPost() {
  startPostCountdown();
  startBillboardFeed();
}

function startPostCountdown() {
  if (_countdownInterval) clearInterval(_countdownInterval);
  if (_countdownFetchInterval) clearInterval(_countdownFetchInterval);
  const el = document.getElementById('postCountdown');
  if (!el || !_handles || !_handles.contract) return;

  let minUsableTime = null;
  let timeOffset = 0;
  let currentCooldown = 0;

  async function fetchData() {
    if (!_handles || !_handles.contract) {
      el.textContent = 'Billboard contract not registered.';
      el.className = 'countdown warn';
      return;
    }
    try {
      const result = await _handles.contract.methods.get_deposit_info(_handles.address).simulate({ from: _handles.address });
      const { amount, minUsableTime: mut } = extractDepositInfo(result);
      if (amount === 0n) {
        el.textContent = 'No deposit note found. Claim a deposit first.';
        el.className = 'countdown warn';
        minUsableTime = null;
        return;
      }
      minUsableTime = Number(mut);
      const COOLDOWN_BASE = 3600n;
      const MIN_DEPOSIT = ethers.parseEther('0.001');
      currentCooldown = Number(COOLDOWN_BASE * MIN_DEPOSIT / amount);
      if (currentCooldown < 1) currentCooldown = 1;
      const l2Time = await getL2Timestamp(_handles.aztecNode);
      timeOffset = l2Time - Math.floor(Date.now() / 1000);
    } catch (e) {
      if (minUsableTime === null) {
        el.textContent = 'Checking deposit status...';
        el.className = 'countdown warn';
      }
    }
  }

  function updateDisplay() {
    if (minUsableTime === null) return;
    const estL2Time = Math.floor(Date.now() / 1000) + timeOffset;
    const remaining = minUsableTime - estL2Time;
    const cd = currentCooldown || 180;
    const cdMin = Math.floor(cd / 60);
    const cdSec = cd % 60;
    const cdStr = cdMin + ':' + String(cdSec).padStart(2, '0');
    if (remaining <= 0) {
      const postsAvailable = Math.floor(-remaining / cd) + 1;
      el.textContent = '\u2705 Ready to post! (' + postsAvailable + ' post' + (postsAvailable > 1 ? 's' : '') + ' available, then ' + cdStr + ' cooldown)';
      el.className = 'countdown ready';
    } else {
      const mm = Math.floor(remaining / 60);
      const ss = remaining % 60;
      el.textContent = '\u23f3 Next post in ' + mm + ':' + String(ss).padStart(2, '0') + ' (0 posts available now, ' + cdStr + ' cooldown)';
      el.className = 'countdown waiting';
    }
  }

  fetchData();
  updateDisplay();
  _countdownInterval = setInterval(updateDisplay, 1000);
  _countdownFetchInterval = setInterval(fetchData, 15000);
}

function startBillboardFeed() {
  stopBillboardFeed();
  _billboardLastCount = -1;
  _billboardLastBlock = -1;
  refreshBillboard();
  _billboardInterval = setInterval(refreshBillboard, 5000);
}

function stopBillboardFeed() {
  if (_billboardInterval) { clearInterval(_billboardInterval); _billboardInterval = null; }
}

async function refreshBillboard() {
  const feed = document.getElementById('billboardFeed');
  const meta = document.getElementById('billboardMeta');
  if (!feed || !_handles || !_handles.contract) return;

  try {
    let currentBlock = -1;
    try { currentBlock = await _handles.aztecNode.getBlockNumber(); } catch (e) {}

    const countResult = await _handles.contract.methods.get_post_count().simulate({ from: _handles.address });
    const count = Number(extractInt(countResult));

    if (meta) {
      const blkStr = currentBlock >= 0 ? ' &middot; block ' + currentBlock : '';
      meta.innerHTML = count + ' message' + (count !== 1 ? 's' : '') + ' on the billboard' + blkStr;
    }

    if (count === 0) {
      feed.innerHTML = '<div class="billboard-empty">No messages yet. Be the first to post!</div>';
      _billboardLastCount = 0;
      return;
    }

    if (count === _billboardLastCount && currentBlock === _billboardLastBlock) return;
    const isNewPost = count > _billboardLastCount && _billboardLastCount >= 0;
    _billboardLastCount = count;
    _billboardLastBlock = currentBlock;

    const posts = [];
    for (let i = count - 1; i >= 0; i--) {
      try {
        const postResult = await _handles.contract.methods.get_post(BigInt(i)).simulate({ from: _handles.address });
        const vals = extractFieldArray(postResult);
        let bytes = [];
        for (let f = 0; f < MSG_FIELDS; f++) {
          let val = vals[f];
          let fieldBytes = [];
          for (let b = 0; b < 31; b++) {
            fieldBytes.unshift(Number(val & 0xffn));
            val >>= 8n;
          }
          bytes = bytes.concat(fieldBytes);
        }
        let len = bytes.length;
        for (let b = 0; b < bytes.length; b++) {
          if (bytes[b] === 0) { len = b; break; }
        }
        const msg = new TextDecoder().decode(new Uint8Array(bytes.slice(0, len)));
        posts.push({ idx: i, msg: msg || '(binary data)' });
      } catch (err) {
        posts.push({ idx: i, msg: '(error loading)', err: true });
      }
    }

    feed.innerHTML = posts.map((p, i) => {
      const newCls = (isNewPost && i === 0) ? ' new' : '';
      return '<div class="billboard-post' + newCls + '">' +
        '<div class="billboard-post-meta"><span class="billboard-post-num">#' + p.idx + '</span></div>' +
        '<div class="billboard-post-text">' + escapeHtml(p.msg) + '</div>' +
      '</div>';
    }).join('');

    if (isNewPost) feed.scrollTop = 0;
  } catch (e) {
    if (meta) meta.textContent = 'Loading messages...';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Post button (non-advancing)
async function doPost() {
  withBtn('postBtn', 'Posting...', 'postStatus', async () => {
    clearMissingHighlight();
    const msgText = document.getElementById('msgText').value.trim();
    if (!msgText) { highlightMissing(['msgText']); throw new Error('Enter a message.'); }

    await callEngine('post', 'postStatus', {
      message: msgText,
      contractSalt: parseInt(document.getElementById('contractSalt').value) || 0,
      dataDirPrefix: 'pxe_bb_',
    });

    document.getElementById('msgText').value = '';
    log('  Message posted anonymously!', 'success', 'postStatus');
    startPostCountdown();
    refreshBillboard();
  });
}

// Nav button: eligibility gate — wait for note sync, then advance
async function doProceedToWithdraw() {
  const S = 'proceedStatus';
  if (!_handles || !_handles.contract) throw new Error('Billboard contract not registered.');

  log('Checking withdrawal eligibility...', 'info', S);
  log('  (Waiting for PXE to sync your deposit note)', 'info', S);

  const maxAttempts = 72;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await _handles.contract.methods.get_deposit_info(_handles.address).simulate({ from: _handles.address });
      const { amount } = extractDepositInfo(result);

      if (amount === 0n) {
        let pxeBlock = '?', nodeBlock = '?';
        try { pxeBlock = (await _handles.pxe.getSyncedBlockHeader()).getBlockNumber(); } catch (e) {}
        try { nodeBlock = await _handles.aztecNode.getBlockNumber(); } catch (e) {}
        log('  [' + (i+1) + '/' + maxAttempts + '] Note not found yet. PXE block: ' + pxeBlock + ', node: ' + nodeBlock, 'info', S);
      } else {
        log('  Eligible! Note amount: ' + amount.toString() + ' wei.', 'success', S);
        return; // auto-advance
      }
    } catch (e) {
      log('  [' + (i+1) + '/' + maxAttempts + '] Check failed: ' + extractErrorMessage(e).substring(0, 100), 'warn', S);
    }
    if (i < maxAttempts - 1) await sleep(10000);
  }
  throw new Error('Eligibility check timed out after 12 min. The PXE may still be syncing.');
}

// ============================================================
// Page 3: Withdraw on L2
// ============================================================
function onShowWithdraw() {}

async function doWithdrawPage() {
  await callEngine('withdraw', 'withdrawStatus', {
    contractSalt: parseInt(document.getElementById('contractSalt').value) || 0,
    dataDirPrefix: 'pxe_bb_',
  });
  if (_stateResult) _stateResult.state = 'withdrawn_l2_claimable_l1';
}

// ============================================================
// Page 4: Claim ETH on L1
// ============================================================
function onShowClaimL1() {}

async function doClaimL1Page() {
  await callEngine('claim-l1', 'claimL1Status', {
    contractSalt: parseInt(document.getElementById('contractSalt').value) || 0,
    dataDirPrefix: 'pxe_bb_',
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
          await loadWalletAndConnect();
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
