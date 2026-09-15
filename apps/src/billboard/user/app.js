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

// Helper: read L1 portal address from UI input
function _portalAddr() {
  const v = (document.getElementById('portalAddr') || {}).value || '';
  return v.trim();
}
// Minimal local custody for V1 claim secrets; backup/export and wallet recovery remain W02.
// AES-GCM encrypts at rest. It cannot protect an unlocked wallet against malicious page code.
function makeClaimSecretStore(walletSecret) {
  const encoder = new TextEncoder();
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('');
  const unhex = text => Uint8Array.from(text.match(/../g) || [], pair => parseInt(pair,16));
  if (!/^0x[0-9a-fA-F]{64}$/.test(walletSecret || '') || BigInt(walletSecret) === 0n) throw new Error('A loaded wallet key is required for claim-secret custody.');
  const prefix = encoder.encode('AZTEC_BB_CLAIM_STORE_KEY_V1\0');
  const input = new Uint8Array(prefix.length + 32); input.set(prefix); input.set(unhex(walletSecret.slice(2)),prefix.length);
  const keyPromise = crypto.subtle.digest('SHA-256',input).then(bytes => crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']));
  function aad(scope,secretHash) {
    const fields=['l1ChainId','rollupAddress','rollupVersion','boardAddress','portalAddress','depositor'];
    if (!scope || Object.keys(scope).length!==6 || fields.some(name => typeof scope[name]!=='string')) throw new Error('Invalid claim-secret scope.');
    for (const name of ['l1ChainId','rollupVersion']) {
      if (!/^[1-9][0-9]*$/.test(scope[name]) || BigInt(scope[name]) >= (1n << (name==='l1ChainId'?64n:32n))) throw new Error('Invalid claim-secret network scope.');
    }
    for (const name of ['rollupAddress','portalAddress','depositor']) {
      if (!/^0x[0-9a-f]{40}$/.test(scope[name]) || BigInt(scope[name])===0n) throw new Error('Invalid claim-secret actor.');
    }
    if (!/^0x[0-9a-f]{64}$/.test(scope.boardAddress) || BigInt(scope.boardAddress)===0n ||
        !/^0x[0-9a-f]{64}$/.test(secretHash)) throw new Error('Invalid claim-secret identifier.');
    return JSON.stringify(['AZTEC_BB_CLAIM_STORE_V1',...fields.map(name=>scope[name]),secretHash]);
  }
  function validateRecord(record,secretHash) {
    const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    if (!record || Object.keys(record).sort().join(',')!=='schemaVersion,secret,secretHash' || record.schemaVersion!==1 ||
        record.secretHash!==secretHash || !/^0x[0-9a-f]{64}$/.test(record.secret) || BigInt(record.secret)<=0n || BigInt(record.secret)>=modulus) {
      throw new Error('Invalid saved claim-secret record.');
    }
    return record;
  }
  async function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('aztec-billboard-claim-secrets-v1',1);
      let rejected=false;
      request.onupgradeneeded=()=>request.result.createObjectStore('records');
      request.onerror=()=>{rejected=true;reject(new Error('Cannot open local claim-secret storage.'));};
      request.onblocked=()=>{rejected=true;reject(new Error('Local claim-secret storage is blocked by another page.'));};
      request.onsuccess=()=>{if(rejected)request.result.close();else resolve(request.result);};
    });
  }
  async function readEnvelope(storageKey) {
    const db=await open();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('records','readonly'); const req=tx.objectStore('records').get(storageKey);
        tx.oncomplete=()=>resolve(req.result);
        tx.onabort=tx.onerror=()=>reject(new Error('Cannot read local claim-secret storage.'));
      });
    } finally { db.close(); }
  }
  async function load(scope,secretHash) {
    const storageKey=aad(scope,secretHash); const envelope=await readEnvelope(storageKey);
    if (envelope===undefined) return null;
    if (!envelope || Object.keys(envelope).sort().join(',')!=='ciphertext,iv,schemaVersion' || envelope.schemaVersion!==1 ||
        !/^[0-9a-f]{24}$/.test(envelope.iv) || !/^[0-9a-f]{32,2048}$/.test(envelope.ciphertext) || envelope.ciphertext.length%2) throw new Error('Invalid encrypted claim-secret envelope.');
    try {
      const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(envelope.iv),additionalData:encoder.encode(storageKey),tagLength:128},
        await keyPromise,unhex(envelope.ciphertext));
      return validateRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)),secretHash);
    } catch (_) { throw new Error('Cannot authenticate the saved claim secret with this wallet and scope.'); }
  }
  return {
    load,
    async save(scope,record) {
      validateRecord(record,record?.secretHash);
      const storageKey=aad(scope,record.secretHash);
      const existing=await load(scope,record.secretHash);
      if (existing) {
        if (existing.secret!==record.secret) throw new Error('A different claim secret already occupies this record.');
        return;
      }
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const plaintext=encoder.encode(JSON.stringify({schemaVersion:1,secretHash:record.secretHash,secret:record.secret}));
      const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(storageKey),tagLength:128},await keyPromise,plaintext);
      const db=await open();
      try {
        await new Promise((resolve,reject)=>{
          // Completion of a strict durable transaction, not merely request success.
          const tx=db.transaction('records','readwrite',{durability:'strict'});
          tx.objectStore('records').add({schemaVersion:1,iv:hex(iv),ciphertext:hex(new Uint8Array(ciphertext))},storageKey);
          tx.oncomplete=()=>resolve();
          tx.onabort=tx.onerror=()=>reject(new Error('Claim-secret storage did not commit. Deposit has not been sent.'));
        });
      } finally { db.close(); }
      const restored=await load(scope,record.secretHash);
      if (!restored || restored.secret!==record.secret) throw new Error('Claim-secret storage read-back failed.');
    },
  };
}

async function readCurrentDeposit() {
  if (!_handles?.contract) throw new Error('Billboard wallet is not connected.');
  const info=await readBillboardDepositInfo(_handles.contract,_handles.address,_handles.depositChainId);
  if (info.amount>0n) _handles.depositChainId=info.depositChainId;
  return info;
}

// Helper: build common config for engine calls
// Uses portalAddress only; L2 address is derived from the portal on chain.
function _commonConfig() {
  const c = {
    portalAddress: _portalAddr(),
    dataDirPrefix: 'pxe_bb_',
    depositChainId: _handles?.depositChainId,
    claimSecretStore: makeClaimSecretStore(window.walletState?.aztec?.secretKey),
  };
  // If the loaded Aztec wallet IS the censor, pass its JSON for declare-immoral/transfer-censor
  const ws = window.walletState;
  if (ws && ws.aztec && ws.aztec.raw) {
    c.censorWalletJson = ws.aztec.raw;
  }
  return c;
}

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
  privateFeeArtifact: typeof BILLBOARD_PRIVATE_FEE_ARTIFACT !== 'undefined' ? BILLBOARD_PRIVATE_FEE_ARTIFACT : null,
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
    ..._commonConfig(),
  });
  _handles = result.handles;
  _stateResult = result;

  log('Setup complete. State: ' + result.state, 'success', 'setupStatus');
  return result;
}

// ============================================================
// Page 1: Deposit ETH — auto-detects state from page 0
// ============================================================
function onShowDeposit() {
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

  if (state === 'postable') { nextPage(); return; }
  if (state === 'withdrawn_l2_claimable_l1') { showPage(4); return; }

  if (state === 'zero_balance_need_deposit') {
    clearMissingHighlight();
    const amountStr = document.getElementById('depositAmount').value.trim();
    if (!amountStr) { highlightMissing(['depositAmount']); throw new Error('Enter an amount.'); }
    const amountEth = parseFloat(amountStr);
    if (isNaN(amountEth) || amountEth <= 0) { highlightMissing(['depositAmount']); throw new Error('Invalid amount.'); }

    // Phase 1: Deposit on L1
    log('Making new L1 deposit...', 'info', 'depositStatus');
    let depResult;
    try {
      depResult = await callEngine('deposit', 'depositStatus', {
        ..._commonConfig(),
        depositAmount: amountStr,
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
      ..._commonConfig(),
      reuseTxHash: depInfo.txHash,
    });

    log('Deposit claimed on L2! Proceeding to post page.', 'success', 'depositStatus');
    _stateResult.state = 'postable';
    nextPage();
    return;
  }

  // deposited_l1_not_claimed_l2: claim the existing deposit
  const txHash = document.getElementById('existingTxHash').value.trim();
  const extra = { ..._commonConfig() };
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
let _showCensored = false; // user must opt-in to see censored posts

function onShowPost() {
  startPostCountdown();
  startBillboardFeed();
  initCensorPanel();
}

function startPostCountdown() {
  if (_countdownInterval) clearInterval(_countdownInterval);
  if (_countdownFetchInterval) clearInterval(_countdownFetchInterval);
  const el = document.getElementById('postCountdown');
  if (!el || !_handles || !_handles.contract) return;

  let nextAllowedTime = null;
  let timeOffset = 0;
  let currentCooldown = 0;
  let currentMaxSaveUp = 16;
  let lastScreenedIndex = 0;
  let lastRealPostIndex = 0;

  async function fetchData() {
    if (!_handles || !_handles.contract) {
      el.textContent = 'Billboard contract not registered.';
      el.className = 'countdown warn';
      return;
    }
    try {
      const result = await readCurrentDeposit();
      const { amount, nextAllowedTime: nat, lastScreenedIndex: lsi, lastRealPostIndex: lrpi } = result;
      if (amount === 0n) {
        el.textContent = 'No deposit note found. Claim a deposit first.';
        el.className = 'countdown warn';
        nextAllowedTime = null;
        return;
      }
      nextAllowedTime = Number(nat);
      lastScreenedIndex = Number(lsi);
      lastRealPostIndex = Number(lrpi);
      // Read deployer-configured cooldown parameters from contract
      let COOLDOWN_BASE = 3600n;
      let MIN_DEPOSIT = ethers.parseEther('0.001');
      let maxSaveUp = 16;
      try {
        const cdResult = await _handles.contract.methods.get_base_cooldown().simulate({ from: _handles.address });
        COOLDOWN_BASE = BigInt(Number(extractInt(cdResult)));
        const mdResult = await _handles.contract.methods.get_min_deposit().simulate({ from: _handles.address });
        MIN_DEPOSIT = BigInt(extractInt(mdResult));
        const msuResult = await _handles.contract.methods.get_max_save_up().simulate({ from: _handles.address });
        maxSaveUp = Number(extractInt(msuResult));
      } catch (e) {}
      currentCooldown = Number((COOLDOWN_BASE * MIN_DEPOSIT + amount - 1n) / amount);
      if (currentCooldown < 1) currentCooldown = 1;
      currentMaxSaveUp = maxSaveUp;
      const l2Time = await getL2Timestamp(_handles.aztecNode);
      timeOffset = l2Time - Math.floor(Date.now() / 1000);
    } catch (e) {
      if (nextAllowedTime === null) {
        el.textContent = 'Checking deposit status...';
        el.className = 'countdown warn';
      }
    }
  }

  function updateDisplay() {
    if (nextAllowedTime === null) return;
    const estL2Time = Math.floor(Date.now() / 1000) + timeOffset;
    const remaining = nextAllowedTime - estL2Time;
    const cd = currentCooldown || 180;
    const cdMin = Math.floor(cd / 60);
    const cdSec = cd % 60;
    const cdStr = cdMin + ':' + String(cdSec).padStart(2, '0');
    // Check screening status element
    const scrEl = document.getElementById('screeningStatus');
    if (scrEl) {
      const NO_IDX = 0;
      if (lastRealPostIndex === NO_IDX) {
        scrEl.textContent = '';
        scrEl.className = 'small';
      } else if (lastScreenedIndex >= lastRealPostIndex) {
        scrEl.textContent = '\u2705 All posts screened — eligible to withdraw.';
        scrEl.className = 'small success';
      } else {
        const unscreened = lastRealPostIndex - lastScreenedIndex;
        scrEl.textContent = '\u26a0\ufe0f ' + unscreened + ' post' + (unscreened > 1 ? 's' : '') + ' need screening — make ' + unscreened + ' dummy post' + (unscreened > 1 ? 's' : '') + ' before withdrawal.';
        scrEl.className = 'small warn';
      }
    }
    if (remaining <= 0) {
      const postsAvailable = Math.min(Math.floor(-remaining / cd) + 1, currentMaxSaveUp);
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
  refreshPolicy();
  _billboardInterval = setInterval(refreshBillboard, 5000);
}

function stopBillboardFeed() {
  if (_billboardInterval) { clearInterval(_billboardInterval); _billboardInterval = null; }
}

async function refreshPolicy() {
  const box = document.getElementById('policyBox');
  const txt = document.getElementById('policyText');
  if (!box || !txt || !_handles || !_handles.contract) return;
  try {
    const result = await _handles.contract.methods.get_moderation_policy().simulate({ from: _handles.address });
    let fields = result, len = 0;
    if (result && result.result !== undefined) {
      fields = result.result[0] || result.result;
      len = Number(result.result[1] !== undefined ? result.result[1] : 0);
    }
    if (len > 0 && window.unpackFieldsToString) {
      const text = window.unpackFieldsToString(fields, len);
      if (text) { txt.textContent = text; box.style.display = ''; return; }
    }
    box.style.display = 'none';
  } catch (e) { box.style.display = 'none'; }
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
    let flaggedCount = 0;
    for (let i = count - 1; i >= 0; i--) {
      let flagged = false;
      try {
        const flagResult = await _handles.contract.methods.is_post_flagged(BigInt(i)).simulate({ from: _handles.address });
        let fv = flagResult;
        if (fv && fv.result !== undefined) fv = fv.result;
        if (fv && fv.value !== undefined) fv = fv.value;
        flagged = fv && (fv === true || BigInt(fv.toString ? fv.toString() : fv) > 0n);
      } catch (e) {}

      let censorResponse = null;
      let flaggedBy = null;
      if (flagged) {
        flaggedCount++;
        try {
          const respResult = await _handles.contract.methods.get_censor_response(BigInt(i)).simulate({ from: _handles.address });
          const respVals = extractFieldArray(respResult);
          let rBytes = [];
          for (let f = 0; f < MSG_FIELDS; f++) {
            let val = respVals[f];
            let fieldBytes = [];
            for (let b = 0; b < 31; b++) {
              fieldBytes.unshift(Number(val & 0xffn));
              val >>= 8n;
            }
            rBytes = rBytes.concat(fieldBytes);
          }
          let rLen = rBytes.length;
          for (let b = 0; b < rBytes.length; b++) {
            if (rBytes[b] === 0) { rLen = b; break; }
          }
          censorResponse = new TextDecoder().decode(new Uint8Array(rBytes.slice(0, rLen)));
        } catch (e) {}
        try {
          const fbResult = await _handles.contract.methods.get_post_flagged_by(BigInt(i)).simulate({ from: _handles.address });
          let fbv = fbResult;
          if (fbv && fbv.result !== undefined) fbv = fbv.result;
          if (fbv && fbv.value !== undefined) fbv = fbv.value;
          flaggedBy = fbv?.inner ? fbv.inner.toString() : (fbv?.toString ? fbv.toString() : fbv);
        } catch (e) {}
      }

      if (flagged) {
        // Fetch the actual post content (point 7: show contents + censorship reason after confirmation)
        let actualMsg = '(could not load content)';
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
          actualMsg = new TextDecoder().decode(new Uint8Array(bytes.slice(0, len))) || '(empty)';
        } catch (e) {}
        posts.push({ idx: i, msg: actualMsg, flagged: true, censorResponse, flaggedBy });
        continue;
      }

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

    // Split posts into visible and censored
    const visiblePosts = posts.filter(p => !p.flagged);
    const censoredPosts = posts.filter(p => p.flagged);

    let html = '';

    // Render visible (non-censored) posts
    if (visiblePosts.length === 0 && censoredPosts.length === 0) {
      html = '<div class="billboard-empty">No messages yet. Be the first to post!</div>';
    } else if (visiblePosts.length === 0) {
      html = '<div class="billboard-empty">All posts have been censored.</div>';
    } else {
      html += visiblePosts.map((p, i) => {
        const newCls = (isNewPost && i === 0) ? ' new' : '';
        return '<div class="billboard-post' + newCls + '">' +
          '<div class="billboard-post-meta"><span class="billboard-post-num">#' + p.idx + '</span></div>' +
          '<div class="billboard-post-text">' + escapeHtml(p.msg) + '</div>' +
        '</div>';
      }).join('');
    }

    // Render censored posts only if user opted in
    if (_showCensored && censoredPosts.length > 0) {
      html += '<div class="censored-divider"></div>';
      html += censoredPosts.map((p) => {
        let h = '<div class="billboard-post censored">' +
          '<div class="billboard-post-meta"><span class="billboard-post-num">#' + p.idx + '</span> <span class="flagged-badge">FLAGGED</span></div>' +
          '<div class="billboard-post-text censored-text">' + escapeHtml(p.msg) + '</div>';
        if (p.censorResponse) {
          h += '<div class="censor-response">Censor says: ' + escapeHtml(p.censorResponse) + '</div>';
        }
        h += '</div>';
        return h;
      }).join('');
    }

    // Add "View censored posts" link at the bottom
    if (flaggedCount > 0) {
      if (_showCensored) {
        html += '<div class="censored-toggle" onclick="toggleCensored(false)">Hide censored posts</div>';
      } else {
        html += '<div class="censored-toggle" onclick="confirmViewCensored()">View censored posts (' + flaggedCount + ' hidden)</div>';
      }
    }

    feed.innerHTML = html;
    if (isNewPost) feed.scrollTop = 0;
  } catch (e) {
    if (meta) meta.textContent = 'Loading messages...';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Toggle censored post visibility (with confirmation dialog for showing)
// ============================================================
// Sudoku challenge — gate for viewing censored posts
// ============================================================

function _sudokuIsValid(grid, row, col, num) {
  for (let i = 0; i < 9; i++) {
    if (grid[row][i] === num) return false;
    if (grid[i][col] === num) return false;
  }
  const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
  for (let r = br; r < br + 3; r++)
    for (let c = bc; c < bc + 3; c++)
      if (grid[r][c] === num) return false;
  return true;
}

function _sudokuGenerateFull() {
  const grid = Array(9).fill(null).map(() => Array(9).fill(0));
  function fill() {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r][c] === 0) {
          const nums = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
          for (const n of nums) {
            if (_sudokuIsValid(grid, r, c, n)) {
              grid[r][c] = n;
              if (fill()) return true;
              grid[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }
  fill();
  return grid;
}

function _sudokuGeneratePuzzle() {
  const solution = _sudokuGenerateFull();
  const puzzle = solution.map(row => [...row]);
  // Easy difficulty: remove ~38 cells, leaving ~43 clues.
  // Distribute removals evenly across rows so clues don't cluster.
  // Target: remove ~4 per row (36), then 2 extra from random rows.
  const removePerRow = Array(9).fill(4);
  for (let i = 0; i < 2; i++) removePerRow[Math.floor(Math.random() * 9)]++;
  for (let r = 0; r < 9; r++) {
    const cols = [0,1,2,3,4,5,6,7,8].sort(() => Math.random() - 0.5);
    for (let i = 0; i < removePerRow[r]; i++) {
      puzzle[r][cols[i]] = 0;
    }
  }
  return puzzle;
}

function _sudokuCheckComplete(grid) {
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (grid[r][c] === 0) return false;
  // Check all rows
  for (let r = 0; r < 9; r++) {
    const seen = new Set();
    for (let c = 0; c < 9; c++) {
      if (seen.has(grid[r][c])) return false;
      seen.add(grid[r][c]);
    }
  }
  // Check all columns
  for (let c = 0; c < 9; c++) {
    const seen = new Set();
    for (let r = 0; r < 9; r++) {
      if (seen.has(grid[r][c])) return false;
      seen.add(grid[r][c]);
    }
  }
  // Check all 3x3 boxes
  for (let br = 0; br < 9; br += 3) {
    for (let bc = 0; bc < 9; bc += 3) {
      const seen = new Set();
      for (let r = br; r < br + 3; r++)
        for (let c = bc; c < bc + 3; c++) {
          if (seen.has(grid[r][c])) return false;
          seen.add(grid[r][c]);
        }
    }
  }
  return true;
}

function confirmViewCensored() {
  const puzzle = _sudokuGeneratePuzzle();
  const overlay = document.createElement('div');
  overlay.className = 'censor-confirm-overlay';

  // Build the sudoku grid HTML
  let gridHtml = '<div class="sudoku-grid">';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const val = puzzle[r][c];
      const given = val !== 0;
      const borderRight = (c % 3 === 2 && c !== 8) ? ' sudoku-border-right' : '';
      const borderBottom = (r % 3 === 2 && r !== 8) ? ' sudoku-border-bottom' : '';
      if (given) {
        gridHtml += '<input class="sudoku-cell given' + borderRight + borderBottom + '" type="text" value="' + val + '" readonly data-r="' + r + '" data-c="' + c + '" data-given="1">';
      } else {
        gridHtml += '<input class="sudoku-cell' + borderRight + borderBottom + '" type="text" maxlength="1" data-r="' + r + '" data-c="' + c + '" data-given="0">';
      }
    }
  }
  gridHtml += '</div>';

  overlay.innerHTML = '<div class="censor-confirm-dialog sudoku-dialog">' +
    '<h3>\u26a0\ufe0f Prove You Are an \u00dcbermensch</h3>' +
    '<p class="small">To view censored posts, you must prove that you are an ubermensch. To do this, you must solve a sudoku.</p>' +
    gridHtml +
    '<div class="sudoku-status" id="sudokuStatus"></div>' +
    '<div class="censor-confirm-buttons">' +
      '<button class="secondary" id="censorCancelBtn">Cancel</button>' +
    '</div>' +
  '</div>';
  document.body.appendChild(overlay);

  // Collect current grid state from inputs
  function getGrid() {
    const inputs = overlay.querySelectorAll('.sudoku-cell');
    const grid = Array(9).fill(null).map(() => Array(9).fill(0));
    for (const inp of inputs) {
      const r = parseInt(inp.dataset.r), c = parseInt(inp.dataset.c);
      const v = parseInt(inp.value);
      grid[r][c] = isNaN(v) ? 0 : v;
    }
    return grid;
  }

  function checkSolved() {
    const grid = getGrid();
    if (_sudokuCheckComplete(grid)) {
      document.getElementById('sudokuStatus').innerHTML = '<span class="sudoku-solved">\u2705 Magnificent. Censored posts revealed.</span>';
      setTimeout(() => {
        if (overlay.parentNode) document.body.removeChild(overlay);
        _showCensored = true;
        _billboardLastCount = -1;
        refreshBillboard();
      }, 800);
    }
  }

  // Wire up input events
  const inputs = overlay.querySelectorAll('.sudoku-cell');
  for (const inp of inputs) {
    if (inp.dataset.given === '1') continue;
    inp.addEventListener('input', (e) => {
      // Only allow 1-9
      let v = e.target.value.replace(/[^1-9]/g, '');
      e.target.value = v;
      // Highlight conflicts
      e.target.classList.remove('sudoku-conflict');
      if (v) {
        const r = parseInt(e.target.dataset.r), c = parseInt(e.target.dataset.c);
        const grid = getGrid();
        grid[r][c] = 0; // remove self for checking
        if (!_sudokuIsValid(grid, r, c, parseInt(v))) {
          e.target.classList.add('sudoku-conflict');
        }
      }
      checkSolved();
    });
    // Keyboard navigation
    inp.addEventListener('keydown', (e) => {
      const r = parseInt(e.target.dataset.r), c = parseInt(e.target.dataset.c);
      if (e.key === 'ArrowRight' && c < 8) { e.preventDefault(); overlay.querySelector('[data-r="' + r + '"][data-c="' + (c+1) + '"]').focus(); }
      if (e.key === 'ArrowLeft' && c > 0) { e.preventDefault(); overlay.querySelector('[data-r="' + r + '"][data-c="' + (c-1) + '"]').focus(); }
      if (e.key === 'ArrowDown' && r < 8) { e.preventDefault(); overlay.querySelector('[data-r="' + (r+1) + '"][data-c="' + c + '"]').focus(); }
      if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); overlay.querySelector('[data-r="' + (r-1) + '"][data-c="' + c + '"]').focus(); }
      if (e.key === 'Backspace' || e.key === 'Delete') { e.target.value = ''; e.target.classList.remove('sudoku-conflict'); }
    });
  }

  document.getElementById('censorCancelBtn').onclick = () => { document.body.removeChild(overlay); };
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };

  // Focus first empty cell
  const firstEmpty = overlay.querySelector('.sudoku-cell[data-given="0"]');
  if (firstEmpty) firstEmpty.focus();
}

function toggleCensored(show) {
  _showCensored = show;
  _billboardLastCount = -1; // force refresh
  refreshBillboard();
}

// Post button (non-advancing)
async function doPost() {
  withBtn('postBtn', 'Posting...', 'postStatus', async () => {
    clearMissingHighlight();
    const msgText = document.getElementById('msgText').value.trim();
    if (!msgText) { highlightMissing(['msgText']); throw new Error('Enter a message.'); }

    await callEngine('post', 'postStatus', {
      message: msgText,
      ..._commonConfig(),
    });

    document.getElementById('msgText').value = '';
    log('  Message posted anonymously!', 'success', 'postStatus');
    startPostCountdown();
    refreshBillboard();
  });
}

// Dummy post button: advance screening without content (needed before withdrawal)
async function doDummyPost() {
  withBtn('dummyPostBtn', 'Posting dummy...', 'postStatus', async () => {
    await callEngine('post', 'postStatus', {
      isDummy: true,
      ..._commonConfig(),
    });
    log('  Dummy post complete — screening advanced.', 'success', 'postStatus');
    startPostCountdown();
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
      const result = await readCurrentDeposit();
      const { amount } = result;

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
      ..._commonConfig(),
  });
  if (_stateResult) _stateResult.state = 'withdrawn_l2_claimable_l1';
}

// ============================================================
// Page 4: Claim ETH on L1
// ============================================================
function onShowClaimL1() {}

async function doClaimL1Page() {
  await callEngine('claim-l1', 'claimL1Status', {
      ..._commonConfig(),
  });
}

// ============================================================
// Censor panel
// ============================================================
async function initCensorPanel() {
  const card = document.getElementById('censorCard');
  const statusEl = document.getElementById('censorStatus');
  const controls = document.getElementById('censorControls');
  if (!card || !_handles || !_handles.contract) return;

  card.style.display = '';
  try {
    const censorResult = await _handles.contract.methods.get_censor().simulate({ from: _handles.address });
    let cv = censorResult;
    if (cv && cv.result !== undefined) cv = cv.result;
    if (cv && cv.value !== undefined) cv = cv.value;
    const censorAddr = cv && cv.toString ? cv.toString() : (cv ? '0x' + BigInt(cv).toString(16).padStart(64, '0') : '0x0');
    const censorActive = !censorAddr.endsWith('0000000000000000000000000000000000000000');

    let kMult = 64;
    try {
      const kResult = await _handles.contract.methods.get_k_multiplier().simulate({ from: _handles.address });
      kMult = Number(extractInt(kResult));
    } catch (e) {}

    if (!censorActive) {
      statusEl.textContent = 'No censor configured for this billboard.';
      statusEl.className = 'small';
      controls.style.display = 'none';
      return;
    }

    // Check if the loaded wallet is the censor
    const myAddr = _handles.address.toString();
    const isCensor = myAddr === censorAddr;
    if (isCensor) {
      statusEl.innerHTML = 'You are the censor (K=' + kMult + '). You can flag posts as immoral.';
      statusEl.className = 'small success';
      controls.style.display = '';
    } else {
      statusEl.innerHTML = 'Censor is active (K=' + kMult + '). Flagged posts are hidden, and screening a flagged post adds ' + (kMult - 1) + ' extra cooldowns to the next post time lock (total ' + kMult + 'x).';
      statusEl.className = 'small warn';
      controls.style.display = 'none';
    }
  } catch (e) {
    statusEl.textContent = 'Could not check censor status: ' + (e.message || e).substring(0, 80);
    statusEl.className = 'small';
  }
}

async function doDeclareImmoral() {
  withBtn('declareImmoralBtn', 'Flagging...', 'censorActionStatus', async () => {
    const postIndex = parseInt(document.getElementById('censorPostIndex').value);
    if (isNaN(postIndex) || postIndex < 0) throw new Error('Enter a valid post index.');
    const responseText = document.getElementById('censorResponseText').value.trim();

    await callEngine('declare-immoral', 'censorActionStatus', {
      postIndex: postIndex,
      censorResponse: responseText,
      ..._commonConfig(),
    });

    document.getElementById('censorPostIndex').value = '';
    document.getElementById('censorResponseText').value = '';
    log('  Post ' + postIndex + ' flagged as immoral.', 'success', 'censorActionStatus');
    refreshBillboard();
  });
}

async function doTransferCensor() {
  withBtn('transferCensorBtn', 'Transferring...', 'censorActionStatus', async () => {
    const newCensorAddr = (document.getElementById('newCensorAddr').value || '').trim();
    if (!newCensorAddr || !newCensorAddr.startsWith('0x')) throw new Error('Enter a valid Aztec address (0x...).');

    await callEngine('transfer-censor', 'censorActionStatus', {
      newCensor: newCensorAddr,
      ..._commonConfig(),
    });

    document.getElementById('newCensorAddr').value = '';
    log('  Censor rights transferred.', 'success', 'censorActionStatus');
    initCensorPanel();
  });
}

async function doSetModerationPolicy() {
  withBtn('setPolicyBtn', 'Updating...', 'censorActionStatus', async () => {
    const policyText = (document.getElementById('moderationPolicyInput').value || '').trim();
    if (!policyText) throw new Error('Enter policy text.');

    await callEngine('set-moderation-policy', 'censorActionStatus', {
      moderationPolicy: policyText,
      ..._commonConfig(),
    });

    document.getElementById('moderationPolicyInput').value = '';
    log('  Moderation policy updated.', 'success', 'censorActionStatus');
    refreshPolicy();
  });
}

// ============================================================
// Init — wallet buttons with auto-advance on success
// ============================================================
// Read L1 portal address from URL param (?portal=0x...) if present
(function initPortalFromUrl() {
  const params = new URLSearchParams(location.search);
  const portal = params.get('portal');
  if (portal) {
    const el = document.getElementById('portalAddr');
    if (el) el.value = portal;
  }
})();

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
