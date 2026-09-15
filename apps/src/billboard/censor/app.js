// ============================================================
// Billboard Censor App — Flag posts & transfer censor rights
// ============================================================
// The censor loads their Aztec wallet, connects to the contract,
// and can flag posts as immoral or transfer censor rights.
// The censor does NOT need an ETH wallet — only L2 FeeJuice.

const MSG_FIELDS = 32;
const MSG_BYTES = MSG_FIELDS * 31;

let _handles = null;
let _stateResult = null;
let _billboardInterval = null;
let _billboardLastCount = -1;
let _billboardLastBlock = -1;
let _showCensored = true; // censor always sees censored posts

// Helpers
function _portalAddr() {
  const v = (document.getElementById('portalAddr') || {}).value || '';
  return v.trim();
}
function _commonConfig() {
  const c = {
    portalAddress: _portalAddr(),
    dataDirPrefix: 'pxe_bb_censor_',
  };
  const ws = window.walletState;
  if (ws && ws.aztec && ws.aztec.raw) {
    c.censorWalletJson = ws.aztec.raw;
  }
  return c;
}

// Bundle readiness
if (!checkBundle('setupStatus')) {
  waitForBundle(() => checkBundle('setupStatus'));
}
setupRpcAuth();

const callEngine = makeCallEngine(runBillboardUser, {
  artifact: typeof BILLBOARD_ARTIFACT !== 'undefined' ? BILLBOARD_ARTIFACT : null,
  sponsorArtifact: typeof BILLBOARD_SPONSOR_ARTIFACT !== 'undefined' ? BILLBOARD_SPONSOR_ARTIFACT : null,
  portalBytecode: typeof PORTAL_BYTECODE !== 'undefined' ? PORTAL_BYTECODE : null,
});

// ============================================================
// Setup — load censor wallet, connect to contract
// ============================================================
async function loadCensorWalletAndConnect() {
  const ws = window.walletState;
  if (!ws || !ws.aztec || !ws.aztec.secretKey) throw new Error('Aztec wallet not loaded.');

  // Use 'status' action to set up PXE, wallet, contract
  // requireEth=false so we don't need an ETH wallet
  const result = await callEngine('status', 'setupStatus', {
    ..._commonConfig(),
  });
  _handles = result.handles;
  _stateResult = result;

  // Auto-fill addresses
  document.getElementById('l2Addr').value = result.l2Addr;
  document.getElementById('portalAddr').value = result.portalAddr;

  log('Setup complete. State: ' + result.state, 'success', 'setupStatus');

  // Check censor status
  await checkCensorStatus();
  startBillboardFeed();
  return result;
}

// ============================================================
// Censor status — am I the censor?
// ============================================================
async function checkCensorStatus() {
  const statusDiv = document.getElementById('censorStatusDiv');
  const controlsCard = document.getElementById('censorControlsCard');
  const transferCard = document.getElementById('transferCard');
  const policyCard = document.getElementById('policyCard');
  if (!_handles || !_handles.contract) return;

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
      statusDiv.innerHTML = '<span class="err">No censor configured for this billboard.</span>';
      controlsCard.style.display = 'none';
      transferCard.style.display = 'none';
      return;
    }

    const myAddr = _handles.address.toString();
    const isCensor = myAddr === censorAddr;
    if (isCensor) {
      statusDiv.innerHTML = '<span class="ok">✅ You are the censor (K=' + kMult + '). You can flag posts and transfer rights.</span>';
      controlsCard.style.display = '';
      transferCard.style.display = '';
      policyCard.style.display = '';
      refreshPolicy();
    } else {
      statusDiv.innerHTML = '<span class="err">⚠️ You are NOT the censor. The censor for this billboard is: ' + censorAddr + '</span><br>' +
        '<span class="muted">Load the censor\'s Aztec wallet to manage censorship.</span>';
      controlsCard.style.display = 'none';
      transferCard.style.display = 'none';
      policyCard.style.display = 'none';
    }
  } catch (e) {
    statusDiv.innerHTML = '<span class="err">Could not check censor status: ' + (e.message || e).substring(0, 120) + '</span>';
    if (controlsCard) controlsCard.style.display = 'none';
    if (transferCard) transferCard.style.display = 'none';
    if (policyCard) policyCard.style.display = 'none';
  }
}

// ============================================================
// Moderation policy — fetch + display + update
// ============================================================
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

async function doSetModerationPolicy() {
  withBtn('setPolicyBtn', 'Updating...', 'policyStatus', async () => {
    const policyText = (document.getElementById('moderationPolicyInput').value || '').trim();
    if (!policyText) throw new Error('Enter policy text.');

    await callEngine('set-moderation-policy', 'policyStatus', {
      moderationPolicy: policyText,
      ..._commonConfig(),
    });

    document.getElementById('moderationPolicyInput').value = '';
    log('  Moderation policy updated.', 'success', 'policyStatus');
    refreshPolicy();
  });
}

// ============================================================
// Billboard feed — censor sees all posts (including censored)
// ============================================================
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
      feed.innerHTML = '<div class="billboard-empty">No messages yet.</div>';
      _billboardLastCount = 0;
      return;
    }

    if (count === _billboardLastCount && currentBlock === _billboardLastBlock) return;
    _billboardLastCount = count;
    _billboardLastBlock = currentBlock;

    const posts = [];
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
        posts.push({ idx: i, msg: '[FLAGGED]', flagged: true, censorResponse, flaggedBy });
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

    feed.innerHTML = posts.map((p) => {
      if (p.flagged) {
        let h = '<div class="billboard-post flagged">' +
          '<div class="billboard-post-meta"><span class="billboard-post-num">#' + p.idx + '</span> <span class="flagged-badge">FLAGGED</span></div>' +
          '<div class="billboard-post-text flagged-text">This post was flagged as immoral.</div>';
        if (p.censorResponse) {
          h += '<div class="censor-response">Censor says: ' + escapeHtml(p.censorResponse) + '</div>';
        }
        h += '</div>';
        return h;
      }
      return '<div class="billboard-post">' +
        '<div class="billboard-post-meta"><span class="billboard-post-num">#' + p.idx + '</span></div>' +
        '<div class="billboard-post-text">' + escapeHtml(p.msg) + '</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    if (meta) meta.textContent = 'Loading messages...';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Flag post as immoral
// ============================================================
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

// ============================================================
// Transfer censor rights
// ============================================================
async function doTransferCensor() {
  withBtn('transferCensorBtn', 'Transferring...', 'transferStatus', async () => {
    const newCensorAddr = (document.getElementById('newCensorAddr').value || '').trim();
    if (!newCensorAddr || !newCensorAddr.startsWith('0x')) throw new Error('Enter a valid Aztec address (0x...).');

    await callEngine('transfer-censor', 'transferStatus', {
      newCensor: newCensorAddr,
      ..._commonConfig(),
    });

    document.getElementById('newCensorAddr').value = '';
    log('  Censor rights transferred.', 'success', 'transferStatus');
    await checkCensorStatus();
  });
}

// ============================================================
// Init — wallet buttons (ETH not required for censor)
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
    initWalletButtons('walletButtonsContainer', {
      statusId: 'setupStatus',
      ethRpcUrl: ETH_RPC_URL,
      requireEth: false,
      onReady: async () => {
        try {
          await loadCensorWalletAndConnect();
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
