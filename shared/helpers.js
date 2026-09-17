// ============================================================
// Pagination system (shared by all apps)
// ============================================================
// Each page registers: { label, busyText, statusId, action, onShow }
// The nav button (bottom right) calls the current page's action.
// On success (no throw), auto-advances to the next page.
// Secondary buttons within pages can call withBtn() for non-advancing actions,
// or withBtnAdvance() to do an action + advance.

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let _pages = [];
let _currentPage = 0;

function initPages(pages) {
  _pages = pages;
  _currentPage = 0;
  showPage(0);
}

function showPage(n) {
  if (n < 0 || n >= _pages.length) return;
  const changed = _currentPage !== n;
  _currentPage = n;
  document.querySelectorAll('.page').forEach((p, i) => {
    p.classList.toggle('active', i === n);
  });
  const back = document.getElementById('navBack');
  const next = document.getElementById('navNext');
  const progress = document.getElementById('navProgress');
  if (back) back.style.visibility = n === 0 ? 'hidden' : 'visible';
  if (progress) progress.textContent = (n + 1) + ' / ' + _pages.length;
  if (next) {
    const p = _pages[n];
    next.style.display = ''; // restore (page 0 may hide it)
    if (p && p.label) {
      next.textContent = p.label + (n < _pages.length - 1 ? ' \u2192' : '');
      next.disabled = false;
    } else {
      next.textContent = '\u2192';
      next.disabled = false;
    }
  }
  if(changed)queueMicrotask(()=>{
    // onShow may immediately skip a completed step. Focus only the final page.
    if(_currentPage!==n)return;
    const heading=document.querySelector('.page.active h2');
    if(heading){heading.setAttribute('tabindex','-1');heading.focus();}
  });
  if (_pages[n] && _pages[n].onShow) {
    try { _pages[n].onShow(); } catch (e) { console.error('Application operation did not complete.'); }
  }
}

function nextPage() {
  if (_currentPage < _pages.length - 1) showPage(_currentPage + 1);
}

function prevPage() {
  if (_currentPage > 0) showPage(_currentPage - 1);
}

function doNavAction() {
  const p = _pages[_currentPage];
  if (!p || !p.action) { nextPage(); return; }
  const btn = document.getElementById('navNext');
  const origText = btn.textContent;
  const origPage = _currentPage;
  btn.disabled = true;
  btn.classList.add('working');
  btn.textContent = p.busyText || 'Working...';
  if (p.statusId) clearStatus(p.statusId);
  let workingDiv = null;
  if (p.statusId) workingDiv = log(p.busyText || 'Working...', 'working', p.statusId);

  Promise.resolve()
    .then(() => p.action())
    .then(() => {
      if (workingDiv && workingDiv.parentNode) workingDiv.remove();
      // Brief pause to show success, then advance
      if (p.statusId) log('\u2713 Step complete.', 'success', p.statusId);
      setTimeout(() => {
        // If the action already changed the page (e.g. skipped ahead), don't advance/restore.
        if (_currentPage !== origPage) {
          btn.disabled = false;
          btn.classList.remove('working');
          return;
        }
        if (_currentPage < _pages.length - 1) {
          nextPage();
        } else {
          // Last page - restore button
          btn.disabled = false;
          btn.classList.remove('working');
          btn.textContent = origText;
        }
      }, 700);
    })
    .catch(e => {
      if (workingDiv && workingDiv.parentNode) workingDiv.remove();
      if (p.statusId) log('ERROR: ' + 'operation did not complete; check configuration and recovery records', 'error', p.statusId);
      console.error('Application operation did not complete.');
      btn.disabled = false;
      btn.classList.remove('working');
      btn.textContent = origText;
    });
}

// ============================================================
// withBtn -- for secondary in-page buttons (no auto-advance)
// ============================================================
function withBtn(btnId, busyText, statusId, action, autoAdvance) {
  const btn = document.getElementById(btnId);
  if (!btn) return Promise.resolve();
  if (btn.disabled) return Promise.resolve(); // prevent double-click
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.classList.add('working');
  btn.textContent = busyText;
  let workingDiv = null;
  if (statusId) {
    clearStatus(statusId);
    workingDiv = log(busyText, 'working', statusId);
  }
  return Promise.resolve()
    .then(action)
    .then(
      () => {
        if (autoAdvance) {
          if (workingDiv && workingDiv.parentNode) workingDiv.remove();
          if (statusId) log('\u2713 Done. Advancing...', 'success', statusId);
          setTimeout(() => nextPage(), 700);
        }
      },
      (e) => {
        if (statusId) log('ERROR: ' + 'operation did not complete; check configuration and recovery records', 'error', statusId);
        console.error('Application operation did not complete.');
      }
    )
    .finally(() => {
      if (!(autoAdvance)) {
        if (workingDiv && workingDiv.parentNode) workingDiv.remove();
        btn.disabled = false;
        btn.classList.remove('working');
        btn.textContent = originalText;
      }
    });
}

// ============================================================
// Status / logging
// ============================================================
function log(msg, type, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  const div = document.createElement('div');
  div.className = 'status ' + (type || 'info');
  const time = new Date().toLocaleTimeString();
  if (type === 'working') {
    const spinner=document.createElement('span'); spinner.className='spinner'; div.appendChild(spinner); div.appendChild(document.createTextNode(`[${time}] ${msg}`));
  } else {
    div.textContent = `[${time}] ${msg}`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function clearFieldValidation(el) {
  el.classList.remove('missing');el.removeAttribute('aria-invalid');
  const errorId=el.id+'-validation-error';
  const remaining=(el.getAttribute('aria-describedby')||'').split(/\s+/).filter(id=>id&&id!==errorId);
  if(remaining.length)el.setAttribute('aria-describedby',remaining.join(' '));else el.removeAttribute('aria-describedby');
  document.getElementById(errorId)?.remove();
}
function clearMissingHighlight() {
  for(const el of document.querySelectorAll('input.missing, textarea.missing, select.missing'))clearFieldValidation(el);
}
const _validationBoundFields=new WeakSet();
function highlightMissing(fieldIds) {
  clearMissingHighlight();let first;
  for(const id of fieldIds){
    const el=document.getElementById(id);if(!el)continue;first??=el;
    el.classList.add('missing');el.setAttribute('aria-invalid','true');
    const error=document.createElement('p');error.id=id+'-validation-error';error.className='field-error';
    error.textContent=id==='msgText'?'Enter a message before posting.':id==='depositAmount'?'Enter a valid amount greater than zero.':'Check this field before continuing.';
    el.insertAdjacentElement('afterend',error);
    el.setAttribute('aria-describedby',[(el.getAttribute('aria-describedby')||'').trim(),error.id].filter(Boolean).join(' '));
    if(!_validationBoundFields.has(el)){el.addEventListener('input',()=>clearFieldValidation(el));_validationBoundFields.add(el);}
  }
  first?.focus();
}

function clearStatus(containerId) {
  const container = document.getElementById(containerId);
  if (container) container.innerHTML = '';
}

// ============================================================
// Block monitor -- shows latest Aztec block number at top right
// ============================================================
// Called after the Aztec node is connected. Creates a fixed-position
// indicator that polls the node every 10 seconds.
let _blockMonitorNode = null;
let _blockMonitorInterval = null;

function startBlockMonitor(aztecNode) {
  if (_blockMonitorInterval) clearInterval(_blockMonitorInterval);
  _blockMonitorNode = aztecNode;

  let el = document.getElementById('blockMonitor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blockMonitor';
    el.className = 'block-monitor';
    el.textContent = 'Aztec block: ...';
    document.body.appendChild(el);
  }

  async function update() {
    try {
      const block = await _blockMonitorNode.getBlockNumber();
      el.textContent = 'Aztec block: ' + block;
      el.className = 'block-monitor ok';
    } catch (e) {
      el.textContent = 'Aztec block: ...';
      el.className = 'block-monitor err';
    }
  }

  update();
  _blockMonitorInterval = setInterval(update, 10000);
}

// ============================================================
// Value extraction from Aztec simulation results
// ============================================================
// Aztec simulate() returns { value: ... } where the structure depends
// on the return type. These helpers handle common cases.

// Extract an EthAddress (struct { inner: Field }) from a sim result
function extractEthAddress(simResult) {
  let val = simResult && simResult.value !== undefined ? simResult.value : simResult;
  // EthAddress is { inner: Fr }
  if (val && typeof val === 'object' && val.inner !== undefined) val = val.inner;
  // Fr has toString() that returns hex
  if (val && typeof val === 'object' && val.toString) {
    const s = val.toString();
    try { return '0x' + BigInt(s).toString(16).padStart(40, '0'); } catch (e) {}
  }
  // Fallback: try direct BigInt conversion
  try { return '0x' + BigInt(val).toString(16).padStart(40, '0'); } catch (e) {}
  // Fallback: try as array of fields (EthAddress can serialize as [inner])
  if (Array.isArray(val) && val.length > 0) {
    try {
      const inner = val[0] && val[0].toString ? val[0].toString() : val[0];
      return '0x' + BigInt(inner).toString(16).padStart(40, '0');
    } catch (e) {}
  }
  // Last resort: log what we got
  console.warn('Could not decode Ethereum address.');
  return '0x0000000000000000000000000000000000000000';
}

// Extract a u32/u64/u128 integer from a sim result
function extractInt(simResult) {
  let val = simResult;
  if (simResult && simResult.result !== undefined) val = simResult.result;
  else if (simResult && simResult.value !== undefined) val = simResult.value;
  if (val && val.toString) val = val.toString();
  return Number(BigInt(val));
}

// Extract a BigInt from a sim result (for large integers)
function extractBigInt(simResult) {
  let val = simResult;
  if (simResult && simResult.result !== undefined) val = simResult.result;
  else if (simResult && simResult.value !== undefined) val = simResult.value;
  if (val && val.toString) val = val.toString();
  return BigInt(val);
}

// Extract an array of Field from a sim result (e.g. [Field; 32])
function extractFieldArray(simResult) {
  let val = simResult;
  if (simResult && simResult.result !== undefined) val = simResult.result;
  else if (simResult && simResult.value !== undefined) val = simResult.value;
  if (!Array.isArray(val)) return [];
  return val.map(v => {
    if (v && v.toString) return BigInt(v.toString());
    return BigInt(v);
  });
}

// Decode the single V1 note layout. Malformed results are errors, not an empty wallet.
function extractDepositInfo(simResult) {
  const val = simResult?.result ?? simResult?.value ?? simResult;
  if (!Array.isArray(val) || val.length !== 11) throw new Error('Invalid V1 deposit note');
  const words = val.map(value => BigInt(value?.inner?.toString?.() ?? value?.toString?.() ?? value));
  const modulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  if (words.some(value => value < 0n || value >= modulus)) throw new Error('Noncanonical deposit Field');
  const [schemaVersion, depositChainId, depositNonce, amount, depositor, postChainHead,
    headSequence, lastScreenedLink, lastScreenedIndex, lastRealPostIndex, nextAllowedTime] = words;
  const empty = words.every(value => value === 0n);
  if (!empty && (schemaVersion !== 1n || depositChainId === 0n || depositNonce === 0n || depositNonce >= 1n << 64n ||
      amount === 0n || amount >= 1n << 96n || depositor === 0n || depositor >= 1n << 160n ||
      headSequence >= 1n << 64n || lastScreenedIndex > headSequence || lastRealPostIndex > headSequence ||
      nextAllowedTime > (1n << 63n) - 1n)) throw new Error('Invalid V1 deposit fields');
  return { schemaVersion, depositChainId, depositNonce, amount, nextAllowedTime,
    l1Depositor: '0x' + depositor.toString(16).padStart(40, '0'), postChainHead,
    headSequence, lastScreenedLink, lastScreenedIndex, lastRealPostIndex };
}

// Never silently choose the first unrelated right. Full wallet selection/recovery is W02.
async function readBillboardDepositInfo(contract, owner, selectedChain) {
  let chain = selectedChain == null ? null : BigInt(selectedChain.toString());
  if (chain === null) {
    const result = await contract.methods.get_deposit_ids(owner, 0).simulate({ from: owner });
    const values = result?.result ?? result?.value ?? result;
    if (!Array.isArray(values) || values.length !== 10) throw new Error('Invalid deposit discovery response');
    const ids = values.map(value => BigInt(value.toString())).filter(value => value !== 0n);
    if (ids.length > 1) throw new Error('Multiple deposit rights: select a depositChainId');
    if (ids.length === 0) return extractDepositInfo(Array(11).fill(0n));
    chain = ids[0];
  }
  if (chain === 0n) throw new Error('Deposit identity must be nonzero');
  const result = await contract.methods.get_deposit_info(owner, chain).simulate({ from: owner });
  const info = extractDepositInfo(result);
  if (info.amount !== 0n && info.depositChainId !== chain) throw new Error('Deposit identity mismatch');
  return info;
}

// ============================================================
// Fee formatting
// ============================================================
function toAztec(bi, decimals = 4) {
  const factor = 10n ** BigInt(decimals);
  return (Number(bi * factor / 10n ** 18n) / Number(factor)).toFixed(decimals);
}

// ============================================================
// CREATE2 deterministic deployment
// ============================================================
// Uses the 0xSequence Create2 Deployer proxy on Ethereum mainnet:
//   0x4e59b44847b379578588920cA78FbF26c0B4956C
//
// The proxy is a minimal CREATE2 wrapper: calldata = [32-byte salt][init code],
// it does create2(value, 0, calldatasize-32, salt). The deployed address is
//   keccak256(0xff ++ proxy ++ salt ++ keccak256(initCode))[12:]
// which is independent of the caller's address, nonce, or gas price.
//
// We use the L2 contract address (itself deterministic from the wallet) as the
// salt, so the L1 portal address is fully determined by the wallet.

const CREATE2_PROXY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

// Build the full creation bytecode (init code) for the portal: linked bytecode + encoded constructor args
function portalCreationBytecode(portalBytecode, portalAbi, rollup, l2AddrHex, version, minDeposit, maxDeposit, configHash) {
  const iface = new ethers.Interface(portalAbi);
  const encodedArgs = iface.encodeDeploy([rollup, l2AddrHex, BigInt(version), BigInt(minDeposit), BigInt(maxDeposit), configHash]);
  return ethers.concat([portalBytecode, encodedArgs]); // Uint8Array
}

// Compute the CREATE2 address of the portal (off-chain, no tx needed)
function computePortalAddress(portalBytecode, portalAbi, l2AddrHex, rollup, version, minDeposit, maxDeposit, configHash) {
  const creation = portalCreationBytecode(portalBytecode, portalAbi, rollup, l2AddrHex, version, minDeposit, maxDeposit, configHash);
  const salt = ethers.getBytes(l2AddrHex); // 32 bytes
  const initCodeHash = ethers.keccak256(creation);
  return ethers.getCreate2Address(CREATE2_PROXY, salt, initCodeHash);
}

// Deploy via the CREATE2 proxy. Returns { address, tx, alreadyDeployed }.
// If the proxy is not present on the current chain, returns { fallback: true }
// and the caller should deploy directly via ContractFactory.
async function create2DeployPortal(signer, portalBytecode, portalAbi, l2AddrHex, rollup, version, minDeposit, maxDeposit, configHash) {
  const provider = signer.provider;
  const creation = portalCreationBytecode(portalBytecode, portalAbi, rollup, l2AddrHex, version, minDeposit, maxDeposit, configHash);
  const salt = ethers.getBytes(l2AddrHex);
  const predicted = computePortalAddress(portalBytecode, portalAbi, l2AddrHex, rollup, version, minDeposit, maxDeposit, configHash);

  // Check if portal already exists at the predicted address
  const existingCode = await provider.getCode(predicted);
  if (existingCode !== '0x') {
    return { address: predicted, alreadyDeployed: true };
  }

  // Check if the CREATE2 proxy exists on this chain
  const proxyCode = await provider.getCode(CREATE2_PROXY);
  if (proxyCode === '0x') {
    return { fallback: true, predicted };
  }

  // Deploy via proxy: data = salt(32 bytes) + creation bytecode
  const data = ethers.concat([salt, creation]);
  const tx = await signer.sendTransaction({ to: CREATE2_PROXY, data, value: 0 });
  return { address: predicted, tx, alreadyDeployed: false };
}

// Explicit exports also support the CLI's CommonJS loading of this shared script.
Object.assign(globalThis, { extractDepositInfo, readBillboardDepositInfo });
