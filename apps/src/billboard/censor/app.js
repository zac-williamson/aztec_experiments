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

// Helpers
function _portalAddr() { return _getPublicConfig()?.board.portalAddress || ''; }
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
  createTransactionJournal: options => window.__aztec.createL2Journal({...options,storage:window.__aztec.createBrowserJournalStorage()}),
  artifact: typeof BILLBOARD_ARTIFACT !== 'undefined' ? BILLBOARD_ARTIFACT : null,
  privateFeeArtifact: typeof BILLBOARD_PRIVATE_FEE_ARTIFACT !== 'undefined' ? BILLBOARD_PRIVATE_FEE_ARTIFACT : null,
  portalBytecode: typeof PORTAL_BYTECODE !== 'undefined' ? PORTAL_BYTECODE : null,
});

async function callEngine(action,statusDiv,extra={}) {
  const revision=_getConfigRevision();
  const identity=JSON.stringify([window.walletState?.aztec?.address?.toString(),_portalAddr(),_getNodeUrl(),_getEthRpcUrl(),revision]);
  const result=await runCensorEngine(action,statusDiv,{...extra,acknowledgeTx:journalAcknowledgements.get(identity)});
  if(revision!==_getConfigRevision())throw Error('Configuration changed. Reconnect.');
  if(result?.lastL2TxHash)journalAcknowledgements.set(identity,result.lastL2TxHash);
  return result;
}
async function recoverSavedTransaction() {
  try {await callEngine('recover','setupStatus',_commonConfig());}
  catch(error){log(publicOperationFailure(error),'error','setupStatus');}
}

// ============================================================
// Setup — load censor wallet, connect to contract
// ============================================================
async function loadCensorWalletAndConnect() {
  const revision=_getConfigRevision();
  const ws = window.walletState;
  if (!ws || !ws.aztec || !ws.aztec.secretKey) throw new Error('Aztec wallet not loaded.');

  // Use 'status' action to set up PXE, wallet, contract
  // requireEth=false so we don't need an ETH wallet
  const result = await callEngine('status', 'setupStatus', {
    ..._commonConfig(),
  });
  if(revision!==_getConfigRevision())throw Error('Configuration changed. Reconnect.');
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
  const revision=_getConfigRevision(),handles=_handles;
  const statusDiv = document.getElementById('censorStatusDiv');
  const controlsCard = document.getElementById('censorControlsCard');
  const transferCard = document.getElementById('transferCard');
  const policyCard = document.getElementById('policyCard');
  if (!_handles || !_handles.contract) return;

  try {
    const censorResult = await handles.contract.methods.get_censor().simulate({ from: window.__aztec.NO_FROM });
    let cv = censorResult;
    if (cv && cv.result !== undefined) cv = cv.result;
    if (cv && cv.value !== undefined) cv = cv.value;
    const censorAddr = cv && cv.toString ? cv.toString() : (cv ? '0x' + BigInt(cv).toString(16).padStart(64, '0') : '0x0');
    const censorValue=BigInt(censorAddr);
    if(censorValue<0n||censorValue>=21888242871839275222246405745257275088548364400416034343698204186575808495617n)throw Error('Invalid moderator address');
    const censorActive = censorValue!==0n;

    let kMult = null;
    try {
      const kResult = await handles.contract.methods.get_k_multiplier().simulate({ from: window.__aztec.NO_FROM });
      kMult = Number(extractInt(kResult));
      if(!Number.isSafeInteger(kMult)||kMult<1||kMult>65535)throw Error('Invalid moderator settings');
    } catch (e) { if(revision!==_getConfigRevision()||handles!==_handles)return;throw Error('Moderator settings unavailable');}

    if(revision!==_getConfigRevision()||handles!==_handles)return;
    if (!censorActive) {
      statusDiv.textContent = 'No moderator configured for this board.';
      controlsCard.style.display = 'none';
      transferCard.style.display = 'none';
      policyCard.style.display = 'none';
      return;
    }

    const myAddr = _handles.address.toString();
    const isCensor = BigInt(myAddr) === censorValue;
    if (isCensor) {
      statusDiv.textContent = 'You are the moderator (K=' + kMult + '). You can flag posts and transfer rights.';
      controlsCard.style.display = '';
      transferCard.style.display = '';
      policyCard.style.display = '';
      refreshPolicy();
    } else {
      statusDiv.textContent = 'This wallet is not the moderator. Current moderator: '+censorAddr;
      controlsCard.style.display = 'none';
      transferCard.style.display = 'none';
      policyCard.style.display = 'none';
    }
  } catch (e) { if(revision!==_getConfigRevision()||handles!==_handles)return;
    statusDiv.textContent = 'Could not verify moderator status. Reconnect and retry.';
    if (controlsCard) controlsCard.style.display = 'none';
    if (transferCard) transferCard.style.display = 'none';
    if (policyCard) policyCard.style.display = 'none';
  }
}

// ============================================================
// Moderation policy — fetch + display + update
// ============================================================
async function refreshPolicy() {
  const revision=_getConfigRevision(),handles=_handles;
  const box = document.getElementById('policyBox');
  const txt = document.getElementById('policyText');
  if (!box || !txt || !_handles || !_handles.contract) return;
  try {
    const result = await handles.contract.methods.get_moderation_policy().simulate({ from: window.__aztec.NO_FROM });
    if(revision!==_getConfigRevision()||handles!==_handles)return;
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
  } catch (e) { if(revision!==_getConfigRevision()||handles!==_handles)return; box.style.display = 'none'; }
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
  const selectedRevision=_getConfigRevision();
  try {
    const selectedPortal=_portalAddr(),selectedNode=_getNodeUrl();
    const page=await window.BillboardPublic.readFeed({portalAddress:selectedPortal,nodeUrl:selectedNode,ethereumUrl:_getEthRpcUrl(),expectedConfig:_getPublicConfig()});
    if(selectedRevision!==_getConfigRevision())return;
    _billboardLastCount=page.eventCount;_billboardLastBlock=page.lastBlock;
    if(meta)meta.textContent=page.progress.complete?'Latest messages through block '+page.lastBlock:'Loading public history through block '+page.lastBlock;
    const signature=JSON.stringify([selectedRevision,page.posts.map(post=>[post.postId,post.orderIndex,post.text,post.flagged,post.flag?.reason]),Boolean(page.nextCursor)]);
    if(feed._renderSignature===signature&&feed.children.length>0)return;
    const previous=feed._renderRevision===selectedRevision?(feed._postNodes||new Map()):new Map();
    const active=document.activeElement;let focusedKey=null;
    for(const [key,saved]of previous)if(active&&saved.article.contains?.(active))focusedKey=key;
    const olderFocused=active&&active===feed._olderLink;
    const next=new Map(),nodes=[];
    for(const post of page.posts){
      const key=post.postId??String(post.orderIndex),textSignature=JSON.stringify([post.orderIndex,post.text,post.flagged,post.flag?.reason]);
      const saved=previous.get(key);
      if(saved?.signature===textSignature){next.set(key,saved);nodes.push(saved.article);continue;}
      const article=document.createElement('article');article.className='billboard-post';
      const label=document.createElement('p');label.textContent='#'+post.orderIndex;article.append(label);
      const content=document.createElement('p');content.textContent=post.text;let details=null,summary=null;
      if(post.flagged){details=document.createElement('details');summary=document.createElement('summary');summary.textContent='Flagged message — show content';details.open=saved?.details?.open===true;details.append(summary,content);const reason=document.createElement('p');reason.textContent='Moderator reason: '+(post.flag?.reason||'No reason supplied');details.append(reason);article.append(details);}else article.append(content);
      next.set(key,{article,details,summary,signature:textSignature});nodes.push(article);
    }
    if(!page.posts.length){const empty=document.createElement('p');empty.textContent='No messages available yet.';nodes.push(empty);}
    let olderLink=null;
    if(page.nextCursor){olderLink=feed._renderRevision===selectedRevision?feed._olderLink:null;if(!olderLink){olderLink=document.createElement('a');olderLink.href='feed.html';olderLink.textContent='Read older messages';}nodes.push(olderLink);}
    feed.replaceChildren();for(const node of nodes)feed.append(node);
    if(focusedKey!==null){const saved=next.get(focusedKey);if(saved?.article.contains?.(active))active.focus?.({preventScroll:true});else if(saved?.summary)saved.summary.focus?.({preventScroll:true});else{feed.tabIndex=-1;feed.focus?.({preventScroll:true});}}
    else if(olderFocused){if(olderLink)olderLink.focus?.({preventScroll:true});else{feed.tabIndex=-1;feed.focus?.({preventScroll:true});}}
    feed._postNodes=next;feed._olderLink=olderLink;feed._renderRevision=selectedRevision;feed._renderSignature=signature;

  } catch (e) {
    if(selectedRevision!==_getConfigRevision())return;
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
window.billboardConfigStore.subscribe(() => {
  const previous=_handles;_handles=null;_stateResult=null;
  stopBillboardFeed();_billboardLastCount=-1;_billboardLastBlock=-1;
  journalAcknowledgements.clear();
  for(const id of ['censorCard','censorControlsCard','transferCard','policyCard']){const el=document.getElementById(id);if(el)el.style.display='none';}
  const portal=document.getElementById('portalAddr');if(portal)portal.value=_portalAddr();
  const feed=document.getElementById('billboardFeed');if(feed)feed.replaceChildren();
  const policy=document.getElementById('policyBox');if(policy)policy.style.display='none';
  const meta=document.getElementById('billboardMeta');if(meta)meta.textContent='Configuration changed. Reconnect to this board.';
  if(previous?.pxe?.stop)Promise.resolve(previous.pxe.stop()).catch(()=>{});

});


const initialPortal=document.getElementById('portalAddr');if(initialPortal)initialPortal.value=_portalAddr();

function waitForBundleThenInit() {
  if (window.__aztec && window.__aztec.createPXE) {
    initWalletButtons('walletButtonsContainer', {
      statusId: 'setupStatus',
      ethRpcUrl: _getPublicConfig()?.network.ethRpcUrl,
      requireEth: false,
      onReady: async () => {
        try {
          await loadCensorWalletAndConnect();
        } catch (e) {
          log('Setup did not complete. Check your connection and configuration, then reload and restore your encrypted wallet backup to retry. Check saved transactions before sending again.', 'error', 'setupStatus');
          console.error('Application operation did not complete.');
        }
      },
    });
  } else {
    waitForBundle(waitForBundleThenInit);
  }
}
waitForBundleThenInit();
