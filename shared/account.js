// Browser custody: passkey or explicitly imported Aztec account, recovery files, and
// an external Ethereum signer. A page has one immutable wallet context.
window.walletState = { aztec:null, ethSigner:null, ethProvider:null, ethTransport:null, ethAccount:null, ethType:null, ethWalletName:null, invalidated:false };
let _onReady=null, _onAztecLoad=null, _requireEth=true, _readyFired=false;
let _autoPasskey=false;
let _walletBusy=false, _walletGeneration=0, _connectingEth=null;
/** @type {(state:ReturnType<typeof accountSnapshot>)=>void} */
let _accountNotify=()=>{};
/** @type {(message:string,type:string)=>void} */
let _accountLog=()=>{};
function _wlog(message,type='info') { _accountLog(message,type); }
function _updateAccountState() { _accountNotify(accountSnapshot()); }
/** Public account state contains no signing material. */
function accountSnapshot() { return {address:window.walletState.aztec?.address.toString()||null,ethereumAddress:window.walletState.ethAccount,busy:_walletBusy,invalidated:window.walletState.invalidated,ethereumWalletName:window.walletState.ethWalletName,ethereumConnected:!!window.walletState.ethSigner && !window.walletState.invalidated}; }
function _assertWalletLive() { if(window.walletState.invalidated) throw new Error('Wallet context changed. Reload this page before continuing.'); }
function _invalidateWalletContext() {
  if(window.walletState.invalidated)return;
  window.walletState.invalidated=true; _walletGeneration++;
  _wlog('Wallet account or network changed. Reload this page to reconnect; pending transactions must be checked before retrying.','error');
  _updateAccountState();
}
async function _walletOperation(run) {
  _assertWalletLive(); if(_walletBusy) throw new Error('Another wallet operation is in progress.');
  _walletBusy=true; _updateAccountState();
  try { return await run(); } finally { _walletBusy=false; _updateAccountState(); }
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
async function _prepareWallet(raw,allowExisting=false) {
  if(window.walletState.aztec && !allowExisting) throw new Error('A wallet is already loaded. Reload to use another wallet.');
  const wallet=window.BillboardWalletBackup.validateWallet(raw);
  if(!window.__aztec?.Fr) throw new Error('Wait for the application to load before opening a wallet.');
  const derived=await _deriveAccountAddress(window.__aztec,wallet.secretKey,wallet.salt);
  if(raw.address && String(raw.address).toLowerCase()!==derived.address.toString().toLowerCase()) throw new Error('Wallet address does not match its key and salt.');
  return {...wallet,...derived,raw:wallet};
}
function _activateWallet(prepared) {
  _assertWalletLive(); if(window.walletState.aztec) throw new Error('A wallet is already loaded.');
  window.walletState.aztec=prepared; _walletGeneration++;
  _wlog('Aztec wallet loaded: '+prepared.address.toString(),'success');
  _updateAccountState(); if(_onAztecLoad) {try {_onAztecLoad(prepared.address.toString());}catch {_wlog('Wallet loaded, but address display did not update. Reload before continuing.','error');_invalidateWalletContext();}} _checkReady();
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
  return envelope;
 });
}
/** @param {Blob} file @param {string} password @returns {Promise<void>} */
async function importAccountRecovery(file,password) {
  return _walletOperation(async()=>{
    {
      if(!file || file.size>32*1024*1024+4096) throw new Error();
      const parsed=JSON.parse(await file.text());
      // Raw CLI wallets may be imported, but every browser export is encrypted.
      const payload=parsed.secretKey?{wallet:parsed,claims:[]}:await window.BillboardWalletBackup.decrypt(parsed,password);
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
    }
  });
}
/** @param {string} password @returns {Promise<object>} Encrypted recovery envelope. */
async function createAccount(password) {
  return _walletOperation(async()=>{
    {
      const modulus=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
      let value; do {const bytes=crypto.getRandomValues(new Uint8Array(32)); value=BigInt('0x'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''));} while(value===0n || value>=modulus);
      const prepared=await _prepareWallet({secretKey:'0x'+value.toString(16).padStart(64,'0'),salt:'0x'+'0'.repeat(64)});
      const envelope=await _writeWalletBackup(prepared,password); _activateWallet(prepared); return envelope;
    }
  });
}
/** @param {string} password @returns {Promise<object>} Encrypted recovery envelope. */
async function exportAccountRecovery(password) {
  return _walletOperation(async()=>{
    if(!window.walletState.aztec)throw new Error('No account is open.');
    return _writeWalletBackup(window.walletState.aztec,password);
  });
}
function _firstEthereumAccount(accounts) {
  return Array.isArray(accounts) && accounts.length>0 && accounts.every(account=>typeof account==='string' && /^0x[0-9a-fA-F]{40}$/.test(account)) ? accounts[0].toLowerCase() : null;
}
async function connectEthereumAccount(transport, walletName='Browser wallet', {selectAccount=false}={}) {
  return _walletOperation(async()=>{
    if(window.walletState.ethSigner) {
      if(window.walletState.aztec || !_autoPasskey)throw new Error('An Ethereum wallet is already connected.');
      // A cancelled passkey has not activated an application account. Honour
      // the next explicit wallet selection instead of reusing the old signer.
      Object.assign(window.walletState,{ethSigner:null,ethProvider:null,ethTransport:null,ethAccount:null,ethType:null,ethWalletName:null,ethChainId:null});
      _walletGeneration++;_updateAccountState();
    }
    if(typeof transport?.request!=='function')throw Object.assign(new Error('Choose an Ethereum wallet.'),{code:'BB_BROWSER_WALLET_MISSING'});
    _bindEthereumProvider(transport);
    const generation=_walletGeneration;
    const connection={account:null,switchingTo:null};_connectingEth=connection;
    try {
    // MetaMask account selection must not silently reuse an older site grant.
    if(selectAccount)await transport.request({method:'wallet_requestPermissions',params:[{eth_accounts:{}}]});
    const expected=typeof _getPublicConfig==='function'?_getPublicConfig()?.network?.chainId:null;
    if(expected!==null&&expected!==undefined){
      const chainId='0x'+BigInt(expected).toString(16);
      if(BigInt(await transport.request({method:'eth_chainId'}))!==BigInt(expected)){
        connection.switchingTo=chainId;
        try{await transport.request({method:'wallet_switchEthereumChain',params:[{chainId}]});}
        catch(error){throw Object.assign(new Error('Switch your wallet to the board network.'),{code:error?.code===4001?'BB_WALLET_REJECTED':'BB_WALLET_NETWORK'});}
        if(BigInt(await transport.request({method:'eth_chainId'}))!==BigInt(expected))throw Object.assign(new Error('Wallet network mismatch.'),{code:'BB_WALLET_NETWORK'});
      }
    }
    const provider=new ethers.BrowserProvider(transport);
    const requested=await provider.send('eth_requestAccounts',[]);
    const signer=await provider.getSigner(), account=await signer.getAddress();
    const network=await provider.getNetwork(),current=await provider.send('eth_accounts',[]);
    _assertWalletLive(); if(generation!==_walletGeneration)throw new Error('Wallet context changed.');
    const selected=account.toLowerCase();
    if(_firstEthereumAccount(requested)!==selected || _firstEthereumAccount(current)!==selected || (connection.account!==null && connection.account!==selected)) {
      _invalidateWalletContext();throw new Error('Wallet context changed.');
    }
    window.walletState.ethTransport=transport;window.walletState.ethSigner=signer;window.walletState.ethProvider=provider;window.walletState.ethAccount=account;
    window.walletState.ethWalletName=typeof walletName==='string' && walletName.trim() && walletName.length<=128?walletName:'Browser wallet';
    window.walletState.ethType='browser';window.walletState.ethChainId=String(network.chainId);_walletGeneration++;
    // The engine independently verifies signer, node and portal chain agreement.
    _wlog(window.walletState.ethWalletName+' connected: '+account,'success');
    _updateAccountState();
    if(_autoPasskey && !window.walletState.aztec)await _openPasskeyAccount();
    _checkReady();
    } finally {_connectingEth=null;}
  });
}
function _passkeyRecordKey() {return 'billboard-passkey-v1:'+window.walletState.ethAccount.toLowerCase();}
async function _openPasskeyAccount(importExisting=false) {
  const generation=_walletGeneration,account=window.walletState.ethAccount;
  if(!account)throw Error('Connect your Ethereum wallet first.');
  return navigator.locks.request('billboard-passkey:'+account.toLowerCase(),async()=>{
    _assertWalletLive();if(generation!==_walletGeneration)throw Error('Wallet context changed.');
    const key=_passkeyRecordKey(),text=localStorage.getItem(key);
    const record=importExisting || text===null?null:JSON.parse(text);
    if(record && (record.version!==1 || typeof record.credentialId!=='string' || !/^0x[0-9a-f]{64}$/i.test(record.address)))throw Error('Saved account information is invalid. Import your account from Account settings.');
    _wlog(importExisting || record?'Approve your passkey to unlock your account.':'Set up a passkey to secure your account.');
    const result=await BillboardPasskey.ceremony(account,{create:!importExisting && !record,credentialId:importExisting?undefined:record?.credentialId});
    _assertWalletLive();if(generation!==_walletGeneration)throw Error('Wallet context changed.');
    const raw={...result.wallet};
    if(record && !importExisting)raw.address=record.address;
    // Import changes the selected account for the next page load. Existing
    // transactions and their journals remain bound to their original identities.
    const prepared=await _prepareWallet(raw,importExisting);
    _assertWalletLive();if(generation!==_walletGeneration)throw Error('Wallet context changed.');
    localStorage.setItem(key,JSON.stringify({version:1,credentialId:result.credentialId,address:prepared.address.toString()}));
    if(importExisting && window.walletState.aztec) return {reloadRequired:true};
    _activateWallet(prepared);
  });
}
async function importPasskeyAccount() {
  return _walletOperation(async()=>{return _openPasskeyAccount(true);});
}
/** @param {{autoPasskey?:boolean,requireEth?:boolean,onReady?:()=>void|Promise<void>,onAztecLoad?:(address:string)=>void,onChange?:(state:ReturnType<typeof accountSnapshot>)=>void,onMessage?:(message:string,type:string)=>void}} options */
function configureAccount(options={}) {
  _autoPasskey=options.autoPasskey===true;_requireEth=options.requireEth!==false;
  _onReady=options.onReady||null;_onAztecLoad=options.onAztecLoad||null;
  _accountNotify=options.onChange||(()=>{});_accountLog=options.onMessage||(()=>{});
}
function _bindEthereumProvider(transport) {
  if(_accountProvider===transport)return;
  for(const [name,handler] of _accountListeners)_accountProvider?.removeListener?.(name,handler);
  _accountListeners=[];_accountProvider=transport;
  if(transport.on) for(const name of ['accountsChanged','chainChanged','disconnect']) {
    const handler=accounts=>{
    if(_accountProvider!==transport)return;
    if(name==='chainChanged' && _connectingEth?.switchingTo && accounts===_connectingEth.switchingTo)return;
    if(name==='accountsChanged') {
      const selected=_firstEthereumAccount(accounts);
      if(window.walletState.ethType==='browser' && selected===window.walletState.ethAccount?.toLowerCase()) return;
      // Initial permission approval announces the account being connected. Verify
      // it against both the requested signer and a final account read before use.
      if(_connectingEth && window.walletState.ethType!=='browser' && selected!==null && (_connectingEth.account===null || _connectingEth.account===selected)) {_connectingEth.account=selected;return;}
    }
    if(window.walletState.ethType==='browser' || _connectingEth) {_invalidateWalletContext();}
    };
    _accountListeners.push([name,handler]);transport.on(name,handler);
  }
}
let _accountProvider, _accountListeners=[];
/** Account operations return data; rendering, downloads and reloads belong to the caller. */
window.BillboardAccount=Object.freeze({configure:configureAccount,snapshot:accountSnapshot,
  connect:connectEthereumAccount,importPasskey:importPasskeyAccount,importRecovery:importAccountRecovery,
  create:createAccount,exportRecovery:exportAccountRecovery,invalidate:_invalidateWalletContext});
