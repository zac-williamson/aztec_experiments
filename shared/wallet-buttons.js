// Account controls: rendering and browser file handling only.
let _statusId="setupStatus";
function walletMessage(message,type="info") { if(typeof log==="function")log(message,type,_statusId); }
function _updateButtonColors() {
  const state=window.BillboardAccount.snapshot();
  const connection=document.getElementById('wbConnectionStatus');
  if(connection)connection.textContent=state.invalidated
    ? 'Wallet connection changed. Reload to reconnect before continuing.'
    : state.ethereumConnected ? state.ethereumWalletName+' · '+state.ethereumAddress : 'No Ethereum wallet connected.';
  for(const id of ['wbAztecBtn','wbAztecGenBtn','wbEthBrowserBtn']) {
    const el=document.getElementById(id); if(el) el.disabled=state.busy || state.invalidated || (id==='wbEthBrowserBtn'?state.ethereumConnected && !!state.address:!!state.address);
  }
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
function downloadAccountRecovery(envelope) {
  _downloadJson('aztec-recovery-'+window.BillboardAccount.snapshot().address.slice(2,18)+'.json',envelope);
  walletMessage('Encrypted recovery file downloaded. Keep it and its password safely. Export again after each transaction or recovery update. Older files do not contain later requests.','success');
}
async function _loadAztecWallet(file) {try{return await window.BillboardAccount.importRecovery(file,document.getElementById('wbPassword')?.value||'');}finally{_clearBackupPassword();}}
async function _generateAztecWallet() {try{downloadAccountRecovery(await window.BillboardAccount.create(_backupPassword(true)));}finally{_clearBackupPassword();}}
async function _exportAztecWallet() {try{downloadAccountRecovery(await window.BillboardAccount.exportRecovery(_backupPassword(true)));}finally{_clearBackupPassword();}}
async function _loadEthBrowser() {
  const wallet=await chooseEthereumWallet();
  if(wallet)return window.BillboardAccount.connect(wallet.provider,wallet.name,{selectAccount:wallet.rdns==='io.metamask'});
}
let _walletPickerOpen=false;
function chooseEthereumWallet() {
  if(_walletPickerOpen)return Promise.resolve(null);
  _walletPickerOpen=true;
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog'),title=document.createElement('h2'),choices=document.createElement('div'),cancel=document.createElement('button');
    title.id='walletPickerTitle';title.textContent='Choose a wallet';dialog.setAttribute('aria-labelledby',title.id);
    cancel.type='button';cancel.textContent='Cancel';
    let unsubscribe=()=>{};
    function finish(provider){unsubscribe();dialog.close();dialog.remove();_walletPickerOpen=false;resolve(provider);}
    function render(){
      choices.replaceChildren();
      const wallets=window.BillboardWalletProviders.list();
      if(!wallets.length){const message=document.createElement('p');message.textContent='No Ethereum wallet was found. Open this board in a browser with MetaMask or another Ethereum wallet installed.';choices.appendChild(message);}
      for(const wallet of wallets){const button=document.createElement('button');button.type='button';button.textContent=wallet.name;button.addEventListener('click',()=>finish(wallet));choices.appendChild(button);}
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});cancel.addEventListener('click',()=>finish(null));
    dialog.append(title,choices,cancel);document.body.appendChild(dialog);
    unsubscribe=window.BillboardWalletProviders.subscribe(render);render();dialog.showModal();window.BillboardWalletProviders.refresh();
  });
}
async function _importPasskeyAccount() {const result=await window.BillboardAccount.importPasskey();if(result?.reloadRequired)location.reload();}
function initWalletButtons(containerId,options={}) {
  const autoPasskey=options.autoPasskey===true;
  _statusId=options.statusId||'setupStatus';
  window.BillboardAccount.configure({...options,onChange:()=>{_updateButtonColors();options.onChange?.(window.BillboardAccount.snapshot());},onMessage:walletMessage});
  const container=document.getElementById(containerId);if(!container)return;
  container.innerHTML=autoPasskey ? `<div class="wallet-btns"><button class="wallet-btn" id="wbEthBrowserBtn">Connect wallet</button>
    <details class="account-menu" id="wbAccountMenu"><summary>Account</summary><div class="account-menu-panel">
    <button class="secondary" id="wbImportPasskeyBtn">Import existing passkey account</button>
    <button class="secondary" id="wbAztecBtn">Import recovery file</button>
    <input type="file" id="wbAztecFile" accept=".json" hidden>
    <label>Recovery file password<input type="password" id="wbPassword" autocomplete="new-password" minlength="12" maxlength="1024"></label>
    <label>Confirm password for export<input type="password" id="wbPasswordConfirm" autocomplete="new-password" maxlength="1024"></label>
    <button class="secondary" id="wbBackupBtn">Export recovery file</button>
    <p>Recovery files also preserve deposit secrets and pending transactions. Export after making deposits. Import a file before connecting; reload first if an account is already open.</p>
    </div></details></div><p>Your passkey secures your private account. Ethereum approves funding and L1 transactions.</p>` : `<input type="file" id="wbAztecFile" accept=".json" hidden>
    <div class="wallet-btns"><div class="wallet-group"><span class="wallet-label">Ethereum</span><button class="secondary wallet-btn" id="wbEthBrowserBtn">Connect browser wallet</button></div>
    <div class="wallet-group"><span class="wallet-label">Aztec</span><button class="secondary wallet-btn" id="wbAztecBtn">Restore wallet</button><button class="secondary wallet-btn" id="wbAztecGenBtn">Create wallet</button><button class="secondary wallet-btn" id="wbBackupBtn">Export recovery file</button></div></div>
    <label>Recovery password <input type="password" id="wbPassword" autocomplete="new-password" minlength="12" maxlength="1024"></label>
    <label>Repeat password when creating a backup <input type="password" id="wbPasswordConfirm" autocomplete="new-password" maxlength="1024"></label>
    <p>Keep your encrypted recovery file and password. Export again after each transaction or recovery update. Older files do not contain later requests. Losing your wallet key or a deposit claim secret can make funds unrecoverable. This browser holds decrypted keys while open; use a trusted device. Reload before changing wallets.</p>`;
  const connection=document.createElement('p');connection.id='wbConnectionStatus';connection.setAttribute('role','status');
  document.body.appendChild(connection);
  if(autoPasskey)document.body.appendChild(document.getElementById('wbAccountMenu'));
  const handle=run=>async()=>{try{await run();}catch(error){walletMessage(['BB_BROWSER_WALLET_MISSING','BB_WALLET_NETWORK','BB_WALLET_REJECTED'].includes(error?.code)?publicOperationFailure(error).message:((error?.code===4001||error?.code==='ACTION_REJECTED')?'Wallet request cancelled. Connect again when you are ready.':'Wallet operation did not complete. Check the file, password and connection. An already loaded wallet cannot be replaced; reload to switch.'),'error');}};
  document.getElementById('wbAztecBtn').addEventListener('click',()=>document.getElementById('wbAztecFile').click());
  document.getElementById('wbImportPasskeyBtn')?.addEventListener('click',handle(_importPasskeyAccount));
  document.getElementById('wbAztecGenBtn')?.addEventListener('click',handle(_generateAztecWallet));
  document.getElementById('wbBackupBtn').addEventListener('click',handle(_exportAztecWallet));
  document.getElementById('wbEthBrowserBtn').addEventListener('click',handle(_loadEthBrowser));
  document.getElementById('wbAztecFile').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file)await handle(()=>_loadAztecWallet(file))();}finally{event.target.value='';}});
  _updateButtonColors();
}
function resetWalletState() { window.BillboardAccount.invalidate(); _updateButtonColors(); }
