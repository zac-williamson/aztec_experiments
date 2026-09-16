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

const journalAcknowledgements=new Map();
const runCensorEngine = makeCallEngine(runBillboardUser, {
  createHistoryCursor: options => window.__aztec.createHistoryCursor({...options,storage:window.__aztec.createBrowserJournalStorage()}),
  createTransactionJournal: options => window.__aztec.createL2Journal({...options,storage:window.__aztec.createBrowserJournalStorage()}),
  artifact: typeof BILLBOARD_ARTIFACT !== 'undefined' ? BILLBOARD_ARTIFACT : null,
  privateFeeArtifact: typeof BILLBOARD_PRIVATE_FEE_ARTIFACT !== 'undefined' ? BILLBOARD_PRIVATE_FEE_ARTIFACT : null,
  portalBytecode: typeof PORTAL_BYTECODE !== 'undefined' ? PORTAL_BYTECODE : null,
});

async function callEngine(action,statusDiv,extra={}) {
  const identity=JSON.stringify([window.walletState?.aztec?.address?.toString(),_portalAddr(),_getNodeUrl()]);
  const result=await runCensorEngine(action,statusDiv,{...extra,acknowledgeTx:journalAcknowledgements.get(identity)});
  if(result?.lastL2TxHash)journalAcknowledgements.set(identity,result.lastL2TxHash);
  return result;
}
async function recoverSavedTransaction() {
  try {await callEngine('recover','setupStatus',_commonConfig());}
  catch(error){log(error.message,'error','setupStatus');}
}

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
  if (!feed || !_portalAddr()) return;
  try {
    const selectedPortal=_portalAddr(),selectedNode=_getNodeUrl();
    const page=await window.BillboardPublic.readFeed({portalAddress:selectedPortal,nodeUrl:selectedNode,ethereumUrl:ETH_RPC_URL});
    if(selectedPortal!==_portalAddr()||selectedNode!==_getNodeUrl())return;
    const posts=page.posts.map(p=>({idx:p.orderIndex,postId:p.postId,msg:p.text,flagged:p.flagged,censorResponse:p.flag?.reason,flaggedBy:p.flag?.censorAddress}));
    const flaggedCount=posts.filter(p=>p.flagged).length;
    const isNewPost=page.eventCount>_billboardLastCount&&_billboardLastCount>=0;
    _billboardLastCount=page.eventCount;_billboardLastBlock=page.lastBlock;
    if(meta)meta.textContent=page.progress.complete?'Latest messages through block '+page.lastBlock:'Loading public history through block '+page.lastBlock;
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
    if(page.nextCursor){const link=document.createElement('a');link.href='feed.html?portal='+encodeURIComponent(_portalAddr());link.textContent='Read older messages';feed.append(link);}
  } catch (e) {
    if (meta) meta.textContent = 'Could not update messages; displayed content may be stale.';
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
          log('Setup failed: ' + 'operation did not complete; check configuration and recovery records', 'error', 'setupStatus');
          console.error('Application operation did not complete.');
        }
      },
    });
  } else {
    setTimeout(waitForBundleThenInit, 500);
  }
}
waitForBundleThenInit();
