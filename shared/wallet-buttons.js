// Browser custody: random embedded Aztec wallet, encrypted recovery files, and
// an external Ethereum signer. A page has one immutable wallet context.
window.walletState = { aztec:null, ethSigner:null, ethProvider:null, ethAccount:null, ethType:null, invalidated:false };
let _onReady=null, _onAztecLoad=null, _statusId='setupStatus', _requireEth=true, _readyFired=false;
let _walletBusy=false, _walletGeneration=0, _connectingEth=null;
function _wlog(message,type='info') { if(typeof log==='function') log(message,type,_statusId); }
function _assertWalletLive() { if(window.walletState.invalidated) throw new Error('Wallet context changed. Reload this page before continuing.'); }
function _invalidateWalletContext() {
  window.walletState.invalidated=true; _walletGeneration++;
  _wlog('Wallet account or network changed. Reload this page to reconnect; pending transactions must be checked before retrying.','error');
}
function _updateButtonColors() {
  for(const id of ['wbAztecBtn','wbAztecGenBtn','wbEthBrowserBtn']) {
    const el=document.getElementById(id); if(el) el.disabled=_walletBusy || window.walletState.invalidated || (id==='wbEthBrowserBtn'?!!window.walletState.ethSigner:!!window.walletState.aztec);
  }
}
async function _walletOperation(run) {
  _assertWalletLive(); if(_walletBusy) throw new Error('Another wallet operation is in progress.');
  _walletBusy=true; _updateButtonColors();
  try { return await run(); } finally { _walletBusy=false; _updateButtonColors(); }
}
function _checkReady() {
  if(_readyFired || window.walletState.invalidated) return;
  if(window.walletState.aztec && (!_requireEth || window.walletState.ethSigner)) {
    _readyFired=true;
    Promise.resolve().then(()=>_onReady?.()).catch(()=>{_readyFired=false;_wlog('Wallet setup did not complete. Check your network and configuration, then reload to retry.','error');});
  }
}
async function _deriveAccountAddress(a,secretKeyHex,saltVal) {
  const secretKey=a.Fr.fromHexString(secretKeyHex);
  const accountContract=new a.SchnorrInitializerlessAccountContract(a.deriveSigningKey(secretKey));
  const {publicKeys}=await a.deriveKeys(secretKey);
  const artifact=await accountContract.getContractArtifact();
  const instance=await a.getContractInstanceFromInstantiationParams(artifact,{
    constructorArtifact:undefined,constructorArgs:undefined,salt:new a.Fr(BigInt(saltVal)),publicKeys,immutablesHash:await accountContract.getImmutablesHash(),
  });
  return {address:instance.address,partialAddress:await a.computePartialAddress(instance)};
}
async function _prepareWallet(raw) {
  if(window.walletState.aztec) throw new Error('A wallet is already loaded. Reload to use another wallet.');
  const wallet=window.BillboardWalletBackup.validateWallet(raw);
  if(!window.__aztec?.Fr) throw new Error('Wait for the application to load before opening a wallet.');
  const derived=await _deriveAccountAddress(window.__aztec,wallet.secretKey,wallet.salt);
  if(raw.address && String(raw.address).toLowerCase()!==derived.address.toString().toLowerCase()) throw new Error('Wallet address does not match its key and salt.');
  return {...wallet,...derived,raw:wallet};
}
function _activateWallet(prepared) {
  _assertWalletLive(); if(window.walletState.aztec) throw new Error('A wallet is already loaded.');
  window.walletState.aztec=prepared; _walletGeneration++;
  const sk=document.getElementById('secretKey'), salt=document.getElementById('salt');
  if(sk)sk.value=prepared.secretKey; if(salt)salt.value=prepared.salt;
  _wlog('Aztec wallet loaded: '+prepared.address.toString(),'success');
  _updateButtonColors(); if(_onAztecLoad) {try {_onAztecLoad(prepared.address);}catch {_wlog('Wallet loaded, but address display did not update. Reload before continuing.','error');_invalidateWalletContext();}} _checkReady();
}
function _backupPassword(confirm=false) {
  const input=document.getElementById('wbPassword'), repeat=document.getElementById('wbPasswordConfirm');
  const password=input?.value || '';
  if(password.length<12 || password.length>1024) throw new Error('Use a backup password of at least 12 characters.');
  if(confirm && password!==repeat?.value) throw new Error('The backup passwords do not match.');
  return password;
}
function _clearBackupPassword() { for(const id of ['wbPassword','wbPasswordConfirm']) { const el=document.getElementById(id); if(el)el.value=''; } }
function _downloadJson(filename,obj) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function _withRecoveryLock(wallet,run) {
  if(!globalThis.navigator?.locks?.request)throw new Error('This browser cannot safely coordinate wallet recovery.');
  return navigator.locks.request('billboard-wallet:'+wallet.address.toString(),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Another tab is using this wallet. Wait for it to finish before exporting or restoring.');
    _assertWalletLive();return run();
  });
}
async function _writeWalletBackup(wallet,password) {
 return _withRecoveryLock(wallet,async()=>{
  const claims=window.BillboardClaimBackup?await window.BillboardClaimBackup.exportRecords(wallet):[];
  if(!window.__aztec.createJournalBackup)throw new Error('Transaction recovery export is unavailable.');
  const journalBackup=await window.__aztec.createJournalBackup({storage:window.__aztec.createBrowserJournalStorage(),walletSecret:wallet.secretKey,walletSalt:wallet.salt});
  const journals=await journalBackup.exportRecords();
  const envelope=await window.BillboardWalletBackup.encrypt({schemaVersion:2,wallet:{secretKey:wallet.secretKey,salt:wallet.salt},claims,journals},password);
  _downloadJson('aztec-recovery-'+wallet.address.toString().slice(2,18)+'.json',envelope);
  _wlog('Encrypted recovery file downloaded. Keep it and its password safely. Export again after each transaction or recovery update. Older files do not contain later requests.','success');
 });
}
async function _loadAztecWallet(file) {
  return _walletOperation(async()=>{
    try {
      if(!file || file.size>32*1024*1024+4096) throw new Error();
      const parsed=JSON.parse(await file.text());
      // Raw CLI wallets may be imported, but every browser export is encrypted.
      const payload=parsed.secretKey?{wallet:parsed,claims:[]}:await window.BillboardWalletBackup.decrypt(parsed,_backupPassword());
      const prepared=await _prepareWallet(payload.wallet);
      if(payload.claims.length||payload.journals?.length)await _withRecoveryLock(prepared,async()=>{
      if(payload.claims.length) {
        if(!window.BillboardClaimBackup) throw new Error();
        await window.BillboardClaimBackup.restoreRecords(prepared,payload.claims);
      }
      if(payload.journals?.length) {
        const journalBackup=await window.__aztec.createJournalBackup({storage:window.__aztec.createBrowserJournalStorage(),walletSecret:prepared.secretKey,walletSalt:prepared.salt});
        await journalBackup.restoreRecords(payload.journals);
      }
      });
      _activateWallet(prepared);
      if(parsed.secretKey) _wlog('This imported file contains an unencrypted key. Create an encrypted recovery file and protect the original.','warn');
    } finally { _clearBackupPassword(); }
  });
}
async function _generateAztecWallet() {
  return _walletOperation(async()=>{
    try {
      const password=_backupPassword(true);
      const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
      let value; do {const bytes=crypto.getRandomValues(new Uint8Array(32)); value=BigInt('0x'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));} while(value===0n || value>=modulus);
      const prepared=await _prepareWallet({secretKey:'0x'+value.toString(16).padStart(64,'0'),salt:'0x'+'0'.repeat(64)});
      await _writeWalletBackup(prepared,password); _activateWallet(prepared);
    } finally {_clearBackupPassword();}
  });
}
async function _exportAztecWallet() {
  return _walletOperation(async()=>{
    try {if(!window.walletState.aztec)throw new Error();await _writeWalletBackup(window.walletState.aztec,_backupPassword(true));}
    finally {_clearBackupPassword();}
  });
}
function _firstEthereumAccount(accounts) {
  return Array.isArray(accounts) && accounts.length>0 && accounts.every(account=>typeof account==='string' && /^0x[0-9a-fA-F]{40}$/.test(account)) ? accounts[0].toLowerCase() : null;
}
async function _loadEthBrowser() {
  return _walletOperation(async()=>{
    if(window.walletState.ethSigner)throw new Error('An Ethereum wallet is already connected.');
    if(!window.ethereum)throw new Error('An Ethereum browser wallet is required.');
    const generation=_walletGeneration;
    const connection={account:null};_connectingEth=connection;
    try {
    const provider=new ethers.BrowserProvider(window.ethereum);
    const requested=await provider.send('eth_requestAccounts',[]);
    const signer=await provider.getSigner(), account=await signer.getAddress();
    const network=await provider.getNetwork(),current=await provider.send('eth_accounts',[]);
    _assertWalletLive(); if(generation!==_walletGeneration)throw new Error('Wallet context changed.');
    const selected=account.toLowerCase();
    if(_firstEthereumAccount(requested)!==selected || _firstEthereumAccount(current)!==selected || (connection.account!==null && connection.account!==selected)) {
      _invalidateWalletContext();throw new Error('Wallet context changed.');
    }
    window.walletState.ethSigner=signer;window.walletState.ethProvider=provider;window.walletState.ethAccount=account;
    window.walletState.ethType='browser';window.walletState.ethChainId=String(network.chainId);_walletGeneration++;
    // Do not force mainnet: engine verifies signer, node and portal chain agreement.
    _wlog('Ethereum wallet connected. Its chain will be checked against the board.','success');_checkReady();
    } finally {_connectingEth=null;}
  });
}
function initWalletButtons(containerId,options={}) {
  _statusId=options.statusId||'setupStatus';_requireEth=options.requireEth!==false;_onReady=options.onReady||null;_onAztecLoad=options.onAztecLoad||null;
  const container=document.getElementById(containerId);if(!container)return;
  container.innerHTML=`<input type="file" id="wbAztecFile" accept=".json" hidden>
    <div class="wallet-btns"><div class="wallet-group"><span class="wallet-label">Ethereum</span><button class="secondary wallet-btn" id="wbEthBrowserBtn">Connect browser wallet</button></div>
    <div class="wallet-group"><span class="wallet-label">Aztec</span><button class="secondary wallet-btn" id="wbAztecBtn">Restore wallet</button><button class="secondary wallet-btn" id="wbAztecGenBtn">Create wallet</button><button class="secondary wallet-btn" id="wbBackupBtn">Export recovery file</button></div></div>
    <label>Recovery password <input type="password" id="wbPassword" autocomplete="new-password" minlength="12" maxlength="1024"></label>
    <label>Repeat password when creating a backup <input type="password" id="wbPasswordConfirm" autocomplete="new-password" maxlength="1024"></label>
    <p>Keep your encrypted recovery file and password. Export again after each transaction or recovery update. Older files do not contain later requests. Losing your wallet key or a deposit claim secret can make funds unrecoverable. This browser holds decrypted keys while open; use a trusted device. Reload before changing wallets.</p>`;
  const handle=run=>async()=>{try{await run();}catch{_wlog('Wallet operation did not complete. Check the file, password and connection. An already loaded wallet cannot be replaced; reload to switch.','error');}};
  document.getElementById('wbAztecBtn').addEventListener('click',()=>document.getElementById('wbAztecFile').click());
  document.getElementById('wbAztecGenBtn').addEventListener('click',handle(_generateAztecWallet));
  document.getElementById('wbBackupBtn').addEventListener('click',handle(_exportAztecWallet));
  document.getElementById('wbEthBrowserBtn').addEventListener('click',handle(_loadEthBrowser));
  document.getElementById('wbAztecFile').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file)await handle(()=>_loadAztecWallet(file))();}finally{event.target.value='';}});
  if(window.ethereum?.on) for(const name of ['accountsChanged','chainChanged','disconnect'])window.ethereum.on(name,accounts=>{
    if(name==='accountsChanged') {
      const selected=_firstEthereumAccount(accounts);
      if(window.walletState.ethType==='browser' && selected===window.walletState.ethAccount?.toLowerCase()) return;
      // Initial permission approval announces the account being connected. Verify
      // it against both the requested signer and a final account read before use.
      if(_connectingEth && window.walletState.ethType!=='browser' && selected!==null && (_connectingEth.account===null || _connectingEth.account===selected)) {_connectingEth.account=selected;return;}
    }
    if(window.walletState.ethType==='browser' || _connectingEth) {_invalidateWalletContext();_updateButtonColors();}
  });
  _updateButtonColors();
}
function resetWalletState() { _invalidateWalletContext(); _updateButtonColors(); }
