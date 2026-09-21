// ============================================================
// Billboard User App — Thin wrapper around engine.js
// ============================================================
// Pages: Wallet Setup → Deposit ETH → Post → Withdraw → Claim L1
// The engine (engine.js) does all the heavy lifting. This file
// builds env/config from shared/app-env.js, calls the engine per
// page, and routes log output to page-specific status divs.
// UI reads plain application data; engine handles remain private.

const MSG_FIELDS = 32;
const MSG_BYTES = MSG_FIELDS * 31;

// ============================================================
// Application interface and rendered state
// ============================================================
const application=createBillboardApplication({kind:'author'});
let _stateResult = null; // result from status action

// Public identity of the selected board
function _portalAddr() { return _getPublicConfig()?.board.portalAddress || ''; }
async function readCurrentDeposit() { return application.readDeposit(); }

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
async function callEngine(action,statusDiv,extra={}) {
  const result=await application.run(action,extra,(message,level)=>log(message,level||'info',statusDiv));
  if(result && Object.hasOwn(result,'withdrawTxHash'))_stateResult={...(_stateResult||{}),withdrawTxHash:result.withdrawTxHash};
  return result;
}
async function recoverSavedTransaction() {
  const revision=_getConfigRevision();
  try {
    await callEngine('recover','setupStatus',{});
    if(revision!==_getConfigRevision())throw Error('Configuration changed. Reconnect.');
    const refreshed=await callEngine('status','setupStatus',{});
    if(revision!==_getConfigRevision())throw Error('Configuration changed. Reconnect.');
    _stateResult=refreshed;
    // Recovery refreshes state; it must not enter the deposit page's automatic
    // claim branch and thereby start a second transaction.
    if(refreshed.state==='postable')showPage(2);
    else if(refreshed.state==='withdrawal_needs_verification')showPage(4);
    else if(refreshed.state==='zero_balance_need_deposit')showPage(1);
    else {
      showPage(0);
      log('Recovery checked. The deposit still needs a claim. Continue to Deposit ETH when ready to claim; no new transaction was started by this refresh.','info','setupStatus');
    }
  } catch(error){log(publicOperationFailure(error),'error','setupStatus');}
}

async function recoverSavedEthereum(retry=false) {
  try {
    await callEngine('recover-eth','setupStatus',{retryEthereum:retry});
    if(application.connected) {const refreshed=await callEngine('status','setupStatus',{});_stateResult=refreshed;}
  }
  catch(error){log(publicOperationFailure(error),'error','setupStatus');}
}

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
  const revision=_getConfigRevision();
  const account=window.BillboardAccount.snapshot();
  if(!account.address)throw Error('Aztec account not loaded.');
  if(!account.ethereumConnected)throw Error('Ethereum wallet not connected.');

  // Call engine status action — does full setup (keys, node, CRS, PXE, sync, wallet)
  const result = await callEngine('status', 'setupStatus', {

  });
  if(revision!==_getConfigRevision())throw Error('Configuration changed. Reconnect.');
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
    if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Claim deposit →'; }
    log('Enter the deposit transaction hash from your Ethereum wallet or recovery record.', 'info', 'depositBalanceCheck');
  } else if (state === 'postable') {
    log('Deposit already claimed on L2. Proceeding to post page.', 'success', 'depositBalanceCheck');
    if (navBtn) navBtn.style.display = 'none';
    nextPage();
  } else if (state === 'withdrawal_needs_verification') {
    log('A withdrawal transaction is saved. Check its settlement before claiming your ETH.', 'info', 'depositBalanceCheck');
    if (navBtn) navBtn.style.display = 'none';
    showPage(4);
  } else {
    if (newSection) newSection.style.display = '';
    if (recoverSection) recoverSection.style.display = 'none';
    if (navBtn) { navBtn.style.display = ''; navBtn.textContent = 'Deposit ETH \u2192'; }
  }
}

async function doDepositPage() {
  async function claimExisting(extra) {
    try{return await callEngine('claim','depositStatus',extra);}
    catch(error){const safe=publicOperationFailure(error);log(safe.message,'error','depositStatus');throw safe;}
  }
  const state = _stateResult ? _stateResult.state : 'unknown';

  if (state === 'postable') { nextPage(); return; }
  if (state === 'withdrawal_needs_verification') { showPage(4); return; }

  if (state === 'zero_balance_need_deposit') {
    clearMissingHighlight();
    const amountStr = document.getElementById('depositAmount').value.trim();
    if (!amountStr) { highlightMissing(['depositAmount']); throw new Error('Enter an amount.'); }
    const amountEth = parseFloat(amountStr);
    if (isNaN(amountEth) || amountEth <= 0) { highlightMissing(['depositAmount']); throw new Error('Invalid amount.'); }

    const operationRevision=_getConfigRevision();
    // Phase 1: Deposit on L1
    log('Making new L1 deposit...', 'info', 'depositStatus');
    let depResult;
    try {
      depResult = await callEngine('deposit', 'depositStatus', {

        depositAmount: amountStr,
      });
    } catch (e) {
      const msg = e.message || String(e);
      if (/insufficient funds/i.test(msg)) {
        throw new Error('L1 deposit failed: not enough ETH balance for the deposit plus gas fees.');
      }
      throw e;
    }
    if(operationRevision!==_getConfigRevision())throw Error('Configuration changed. Recover the original deposit before continuing.');
    const depInfo = depResult.depositInfo;
    // Persist the completed phase before attempting the separate L2 claim.
    // A delayed message or rejected claim must never offer another ETH deposit.
    _stateResult={...(_stateResult||{}),state:'deposited_l1_not_claimed_l2',depositInfo:depInfo};
    const existing=document.getElementById('existingTxHash');if(existing)existing.value=depInfo.txHash;
    const newSection=document.getElementById('newDepositSection');if(newSection)newSection.style.display='none';
    const recoverSection=document.getElementById('recoverDepositSection');if(recoverSection)recoverSection.style.display='';
    const nav=document.getElementById('navNext');if(nav)nav.textContent='Claim deposit →';

    // Phase 2: Wait for L2 ingest + claim on L2
    log('', 'info', 'depositStatus');
    log('Waiting for L2 to ingest deposit, then claiming...', 'info', 'depositStatus');
    await claimExisting({

      reuseTxHash: depInfo.txHash,
    });

    log('Deposit claimed on L2! Proceeding to post page.', 'success', 'depositStatus');
    _stateResult.state = 'postable';
    nextPage();
    return;
  }

  // deposited_l1_not_claimed_l2: claim the existing deposit
  const txHash = _stateResult?.depositInfo?.txHash || document.getElementById('existingTxHash').value.trim();
  const extra = {  };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) { highlightMissing(['existingTxHash']); throw new Error('Enter the deposit transaction hash from your Ethereum wallet or recovery record.'); }
  extra.reuseTxHash = txHash;
  log('Claiming existing deposit on L2...', 'info', 'depositStatus');
  await claimExisting(extra);
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
  initCensorPanel();
}

function withdrawalReadiness(info, l2Time) {
  if(!info || info.amount<=0n)return {ready:false,kind:'unknown',message:'Deposit note unavailable. Refresh or recover the saved transaction; absence does not establish withdrawal.'};
  if(info.lastScreenedIndex<info.lastRealPostIndex)return {ready:false,kind:'screening',message:'Some real posts still need screening. Wait until their moderation window ends, then advance screening. Each transaction checks up to two earlier posts.'};
  if(typeof l2Time!=='number'||!Number.isSafeInteger(l2Time)||l2Time<0)return {ready:false,kind:'unknown',message:'Current chain time is unavailable. Retry the status check.'};
  if(BigInt(l2Time)<info.nextAllowedTime)return {ready:false,kind:'cooldown',message:'Screening is complete; the withdrawal time lock has not expired at the latest chain block.'};
  return {ready:true,kind:'ready',message:'Screening and time-lock checks pass at the latest chain block. The transaction will verify eligibility again.'};
}
function startPostCountdown() {
  if(_countdownInterval)clearInterval(_countdownInterval);
  if(_countdownFetchInterval)clearInterval(_countdownFetchInterval);
  const revision=_getConfigRevision(),session=application.revision;
  if(!application.connected)return;
  let busy=false;
  async function refresh(){if(busy)return;busy=true;try{
    const info=await readCurrentDeposit(),now=info.chainTime;
    if(revision!==_getConfigRevision()||session!==application.revision)return;
    const readiness=withdrawalReadiness(info,now),el=document.getElementById('postCountdown'),screen=document.getElementById('screeningStatus');
    el.textContent=info.amount>0n?(BigInt(now)>=info.nextAllowedTime?'Posting time lock has expired at the latest chain block.':'Posting time lock remains active at the latest chain block.'):'Deposit status is unavailable; refresh or recover.';
    el.className='countdown';screen.textContent=readiness.message;screen.className=readiness.ready?'small success':'small warn';
  }catch{if(revision===_getConfigRevision()){document.getElementById('postCountdown').textContent='Could not refresh chain status. Retry before acting.';document.getElementById('screeningStatus').textContent='Withdrawal eligibility is unknown.';}}finally{busy=false;}}
  refresh();_countdownFetchInterval=setInterval(refresh,15000);
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
  const revision=_getConfigRevision(),session=application.revision;
  const box = document.getElementById('policyBox');
  const txt = document.getElementById('policyText');
  if (!box || !txt || !application.connected) return;
  try {
    const text=await application.readPolicy();
    if(revision!==_getConfigRevision()||session!==application.revision)return;
    if(text){txt.textContent=text;box.style.display='';return;}
    box.style.display = 'none';
  } catch (e) { if(revision!==_getConfigRevision()||session!==application.revision)return; box.style.display = 'none'; }
}

async function refreshBillboard() {
  const feed = document.getElementById('billboardFeed');
  const meta = document.getElementById('billboardMeta');
  if (!feed || !_portalAddr()) return;
  const selectedRevision=_getConfigRevision();
  try {
    const selectedPortal=_portalAddr(),selectedNode=_getNodeUrl();
    const page=await application.readFeed();
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
      const content=document.createElement('p');content.textContent=post.flagged?'Message removed by moderator.':post.text;article.append(content);
      if(post.flagged){const reason=document.createElement('p');reason.textContent='Moderator reason: '+(post.flag?.reason||'No reason supplied');article.append(reason);}
      next.set(key,{article,signature:textSignature});nodes.push(article);
    }
    if(!page.posts.length){const empty=document.createElement('p');empty.textContent='No messages available yet.';nodes.push(empty);}
    let olderLink=null;
    if(page.nextCursor){olderLink=feed._renderRevision===selectedRevision?feed._olderLink:null;if(!olderLink){olderLink=document.createElement('a');olderLink.href='feed.html'+location.hash;olderLink.textContent='Read older messages';}nodes.push(olderLink);}
    feed.replaceChildren();for(const node of nodes)feed.append(node);
    if(focusedKey!==null){const saved=next.get(focusedKey);if(saved?.article.contains?.(active))active.focus?.({preventScroll:true});else{feed.tabIndex=-1;feed.focus?.({preventScroll:true});}}
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

// Post button (non-advancing)
async function doPost() {
  withBtn('postBtn', 'Posting...', 'postStatus', async () => {
    clearMissingHighlight();
    const msgText = document.getElementById('msgText').value.trim();
    if (!msgText) { highlightMissing(['msgText']); throw new Error('Enter a message.'); }
    if(new TextEncoder().encode(msgText).length>992)throw new Error('Messages must fit within 992 UTF-8 bytes.');

    await callEngine('post', 'postStatus', {
      message: msgText,

    });

    document.getElementById('msgText').value = '';
    log('  Message included. Public content and transaction timing remain observable.', 'success', 'postStatus');
    startPostCountdown();
    refreshBillboard();
  });
}

// Dummy post button: advance screening without content (needed before withdrawal)
async function doDummyPost() {
  withBtn('dummyPostBtn', 'Posting dummy...', 'postStatus', async () => {
    await callEngine('post', 'postStatus', {
      isDummy: true,

    });
    log('  Dummy post complete — screening advanced.', 'success', 'postStatus');
    startPostCountdown();
  });
}

// Nav button: eligibility gate — wait for note sync, then advance
async function doProceedToWithdraw() {
  const revision=_getConfigRevision(),session=application.revision;
  if(!application.connected)throw Error('Reconnect to check withdrawal eligibility.');
  const info=await readCurrentDeposit(),now=info.chainTime;
  if(revision!==_getConfigRevision()||session!==application.revision)throw Error('Configuration changed. Reconnect.');
  const readiness=withdrawalReadiness(info,now);
  log(readiness.message,readiness.ready?'success':'warn','proceedStatus');
  if(!readiness.ready)throw Error(readiness.message);
}

// ============================================================
// Page 3: Withdraw on L2
// ============================================================
function onShowWithdraw() {}

async function doWithdrawPage() {
  await callEngine('withdraw', 'withdrawStatus', {

  });
  if (_stateResult) _stateResult.state = 'withdrawal_needs_verification';
}

// ============================================================
// Page 4: Claim ETH on L1
// ============================================================
function onShowClaimL1() {
  document.getElementById('claimL1Wallet').hidden=window.BillboardAccount.snapshot().ethereumConnected;
  log(_stateResult?.withdrawTxHash ? 'The withdrawal transaction is saved. Claim ETH will check whether the network has settled it.' : 'Recover the saved withdrawal transaction on the setup page before claiming ETH.', 'info', 'claimL1Status');
}

async function doClaimL1Page() {
  await callEngine('claim-l1', 'claimL1Status', {

  });
}

// ============================================================
// Censor panel
// ============================================================
async function initCensorPanel() {
  const revision=_getConfigRevision(),session=application.revision;
  const card = document.getElementById('censorCard');
  const statusEl = document.getElementById('censorStatus');
  const controls = document.getElementById('censorControls');
  if (!card || !application.connected) return;

  card.style.display = '';
  try {
    const {address:censorAddr,active:censorActive,isCurrentAccount:isCensor,multiplier:kMult}=await application.readModerator();
    if(revision!==_getConfigRevision()||session!==application.revision)return;
    if (!censorActive) {
      statusEl.textContent = 'No censor configured for this billboard.';
      statusEl.className = 'small';
      controls.style.display = 'none';
      return;
    }

    // Check if the loaded wallet is the censor
    if (isCensor) {
      statusEl.textContent = 'You are the censor (K=' + kMult + '). You can flag posts as immoral.';
      statusEl.className = 'small success';
      controls.style.display = '';
    } else {
      statusEl.textContent = 'Censor is active (K=' + kMult + '). Flagged posts are hidden, and screening a flagged post adds ' + (kMult - 1) + ' extra cooldowns to the next post time lock (total ' + kMult + 'x).';
      statusEl.className = 'small warn';
      controls.style.display = 'none';
    }
  } catch (e) { if(revision!==_getConfigRevision()||session!==application.revision)return;
    controls.style.display='none';
    statusEl.textContent = 'Could not verify moderator status. Reconnect and retry.';
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
window.billboardConfigStore.subscribe(() => {
  _stateResult=null;
  stopBillboardFeed();_billboardLastCount=-1;_billboardLastBlock=-1;
  for(const id of ['censorCard','censorControlsCard','transferCard','policyCard']){const el=document.getElementById(id);if(el)el.style.display='none';}
  const portal=document.getElementById('portalAddr');if(portal)portal.value=_portalAddr();
  const feed=document.getElementById('billboardFeed');if(feed)feed.replaceChildren();
  const policy=document.getElementById('policyBox');if(policy)policy.style.display='none';
  const meta=document.getElementById('billboardMeta');if(meta)meta.textContent='Configuration changed. Reconnect to this board.';
  if(_countdownInterval)clearInterval(_countdownInterval);if(_countdownFetchInterval)clearInterval(_countdownFetchInterval);const countdown=document.getElementById('postCountdown');if(countdown)countdown.textContent='Reconnect to check deposit status.';
});


const initialPortal=document.getElementById('portalAddr');if(initialPortal)initialPortal.value=_portalAddr();

function waitForBundleThenInit() {
  if (window.__aztec && window.__aztec.createPXE) {
    const navNext = document.getElementById('navNext');
    if (navNext) navNext.style.display = 'none';
    initWalletButtons('walletButtonsContainer', {autoPasskey:true,
      statusId: 'setupStatus',
      ethRpcUrl: _getPublicConfig()?.network.ethRpcUrl,
      onReady: async () => {
        try {
          await loadWalletAndConnect();
          nextPage();
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
initializeHostedBoard(waitForBundleThenInit);

// Snapshot the toggle into each operation's config; cache keys isolate routes.
const remoteProvingToggle=document.getElementById('remoteProving');
let lastRemoteProverUrl;
function refreshRemoteProving(){const url=window.billboardConfigStore?.snapshot().config?.remoteProver?.url,available=!!url;if(url!==lastRemoteProverUrl){remoteProvingToggle.checked=available;lastRemoteProverUrl=url;}remoteProvingToggle.disabled=!available;remoteProvingToggle.title=available?'Use this board’s prover. Private witness data is shared with its operator.':'This board has not configured a remote prover.';}
window.billboardConfigStore?.subscribe(refreshRemoteProving);refreshRemoteProving();
