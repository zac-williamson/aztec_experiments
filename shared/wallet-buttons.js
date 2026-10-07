// Account controls: rendering and browser file handling only.
let _statusId="setupStatus";
function walletMessage(message,type="info") { const region=document.getElementById("wbAccountStatus");if(region){region.textContent=message;region.className=type==="error"?"error":"";} if(typeof log==="function")log(message,type,_statusId); }
function _updateButtonColors() {
  const state=window.BillboardAccount.snapshot();
  const connection=document.getElementById('wbConnectionStatus');
  if(connection)connection.textContent=state.invalidated
    ? 'Wallet connection changed. Switch wallet to reconnect.'
    : state.ethereumConnected ? state.ethereumWalletName+' · '+state.ethereumAddress.slice(0,6)+'…'+state.ethereumAddress.slice(-4) : 'No Ethereum wallet connected.';
  const summary=document.querySelector('#wbAccountMenu > summary');if(summary)summary.textContent=state.ethereumConnected?'Account · '+state.ethereumAddress.slice(0,6)+'…'+state.ethereumAddress.slice(-4):'Account';
  const eth=document.getElementById('wbEthIdentity'),privateId=document.getElementById('wbPrivateIdentity');if(eth)eth.textContent=state.ethereumAddress||'Ethereum wallet not connected';if(privateId)privateId.textContent=state.address||'Private account locked';
  const choice=document.getElementById('wbPasskeyChoice');if(choice)choice.hidden=!state.needsPasskey;
  for(const id of ['wbAztecBtn','wbAztecGenBtn','wbEthBrowserBtn']) {
    const el=document.getElementById(id); if(el) el.disabled=state.busy || state.invalidated || (id==='wbEthBrowserBtn'?state.ethereumConnected && !!state.address:!!state.address);
  }
}
function _backupPassword(confirm=false) {
  const input=document.getElementById('wbPassword'), repeat=document.getElementById('wbPasswordConfirm');
  const password=input?.value || '';
  for(const el of [input,repeat])el?.removeAttribute('aria-invalid');
  if(password.length<12 || password.length>1024) throw Object.assign(new Error(),{code:'BB_BACKUP_PASSWORD',field:'wbPassword'});
  if(confirm && password!==repeat?.value) throw Object.assign(new Error(),{code:'BB_BACKUP_PASSWORD_MATCH',field:'wbPasswordConfirm'});
  return password;
}
function _clearBackupPassword() { for(const id of ['wbPassword','wbPasswordConfirm','wbRestorePassword']) { const el=document.getElementById(id); if(el)el.value=''; } }
function _downloadJson(filename,obj) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(obj,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadAccountRecovery(envelope) {
  _downloadJson('aztec-recovery-'+window.BillboardAccount.snapshot().address.slice(2,18)+'.json',envelope);
  walletMessage('Encrypted recovery file downloaded. Keep it and its password safely. It restores your account; it also includes the pending requests saved at the time of export.','success');
}
async function _loadAztecWallet(file) {try{return await window.BillboardAccount.importRecovery(file,document.getElementById('wbRestorePassword')?.value||'');}finally{_clearBackupPassword();}}
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
  window.BillboardAccount.configure({...options,onSetupError:error=>walletMessage(publicOperationFailure(error).message,'error'),onChange:()=>{_updateButtonColors();options.onChange?.(window.BillboardAccount.snapshot());},onMessage:walletMessage});
  const container=document.getElementById(containerId);if(!container)return;
  container.innerHTML=autoPasskey ? `<div class="wallet-btns"><button class="wallet-btn" id="wbEthBrowserBtn">Connect wallet</button>
    <div id="wbPasskeyChoice" hidden><p>Have you used this private account before?</p><button id="wbExistingPasskeyBtn">Unlock with existing passkey</button><button class="secondary" id="wbNewPasskeyBtn">Create a new account</button><p class="small">Use the same Ethereum wallet and passkey when returning on another device.</p></div>
    <details class="account-menu" id="wbAccountMenu"><summary>Account</summary><div class="account-menu-panel">
    <p id="wbConnectionStatus" class="account-address"></p><p id="wbAccountStatus" role="status" aria-live="polite"></p>
    <button class="secondary" id="wbLockBtn">Lock account</button><button class="secondary" id="wbSwitchBtn">Switch wallet</button>
    <div id="accountActions"></div>
    <details><summary>Restore account</summary>
    <button class="secondary" id="wbImportPasskeyBtn">Use existing passkey</button>
    <button class="secondary" id="wbAztecBtn">Import recovery file</button>
    <input type="file" id="wbAztecFile" accept=".json" hidden>
    <label>Existing recovery file password<input type="password" id="wbRestorePassword" autocomplete="current-password" maxlength="1024"></label>
    </details><details><summary>Back up account</summary>
    <label>New recovery file password<input type="password" id="wbPassword" autocomplete="new-password" minlength="12" maxlength="1024"></label>
    <label>Confirm password for export<input type="password" id="wbPasswordConfirm" autocomplete="new-password" maxlength="1024"></label>
    <button class="secondary" id="wbBackupBtn">Export recovery file</button>
    <p>Your same passkey and Ethereum wallet restore new board deposits on another device. A recovery file is an alternative way to restore the private account and includes pending requests at export time. Older deposits created before automatic recovery need their original backup. Lock your account before importing another.</p>
    </details></div></details></div>` : `<input type="file" id="wbAztecFile" accept=".json" hidden>
    <div class="wallet-btns"><div class="wallet-group"><span class="wallet-label">Ethereum</span><button class="secondary wallet-btn" id="wbEthBrowserBtn">Connect browser wallet</button></div>
    <div class="wallet-group"><span class="wallet-label">Aztec</span><button class="secondary wallet-btn" id="wbAztecBtn">Restore wallet</button><button class="secondary wallet-btn" id="wbAztecGenBtn">Create wallet</button><button class="secondary wallet-btn" id="wbBackupBtn">Export recovery file</button></div></div>
    <label>Existing recovery file password <input type="password" id="wbRestorePassword" autocomplete="current-password" maxlength="1024"></label>
    <label>New backup password <input type="password" id="wbPassword" autocomplete="new-password" minlength="12" maxlength="1024"></label>
    <label>Repeat password when creating a backup <input type="password" id="wbPasswordConfirm" autocomplete="new-password" maxlength="1024"></label>
    <p>Keep your encrypted recovery file and password. It restores your private account and includes pending requests at export time. New deposits are recoverable from the same private account and Ethereum wallet. Older deposits need their original backup. Losing your private account can make funds unrecoverable. This browser holds decrypted keys while open; use a trusted device. Lock your account before changing wallets.</p>`;
  if(!autoPasskey){const connection=document.createElement('p');connection.id='wbConnectionStatus';container.append(connection);const lock=document.createElement('button');lock.id='wbLockBtn';lock.className='secondary';lock.textContent='Lock account';container.append(lock);const change=document.createElement('button');change.id='wbSwitchBtn';change.className='secondary';change.textContent='Switch wallet';container.append(change);}
  const identities=document.createElement('details');identities.innerHTML='<summary>Account addresses</summary><p class="small">Ethereum pays deposits. Your private account posts messages.</p><p id="wbEthIdentity" class="account-address"></p><button id="wbCopyEth" class="secondary">Copy Ethereum address</button><p id="wbPrivateIdentity" class="account-address"></p><button id="wbCopyPrivate" class="secondary">Copy private account address</button>';(document.querySelector('.account-menu-panel')||container).prepend(identities);
  for(const [id,key]of [['wbCopyEth','ethereumAddress'],['wbCopyPrivate','address']])document.getElementById(id).onclick=async()=>{const address=window.BillboardAccount.snapshot()[key];if(address){try{await navigator.clipboard.writeText(address);walletMessage('Address copied.');}catch{walletMessage('Copy was unavailable. Select the address above to copy it.');}}};
  if(autoPasskey)(document.getElementById('accountSlot')||container).appendChild(document.getElementById('wbAccountMenu'));
  document.getElementById('wbExistingPasskeyBtn')?.addEventListener('click',()=>handle(_importPasskeyAccount)());
  document.getElementById('wbNewPasskeyBtn')?.addEventListener('click',()=>handle(()=>window.BillboardAccount.createPasskey())());
  for(const id of ['wbLockBtn','wbSwitchBtn'])document.getElementById(id)?.addEventListener('click',()=>handle(async()=>{await window.BillboardAccount.endSession();location.reload();})());
  const handle=run=>async()=>{try{await run();}catch(error){const safe=publicOperationFailure(error?.code===4001||error?.code==='ACTION_REJECTED'?{code:'BB_WALLET_REJECTED'}:error);walletMessage(safe.message,'error');const field=safe.field&&document.getElementById(safe.field);if(field){field.setAttribute('aria-invalid','true');field.focus();}}};
  document.getElementById('wbAztecBtn').addEventListener('click',()=>document.getElementById('wbAztecFile').click());
  document.getElementById('wbImportPasskeyBtn')?.addEventListener('click',handle(_importPasskeyAccount));
  document.getElementById('wbAztecGenBtn')?.addEventListener('click',handle(_generateAztecWallet));
  document.getElementById('wbBackupBtn').addEventListener('click',handle(_exportAztecWallet));
  document.getElementById('wbEthBrowserBtn').addEventListener('click',handle(_loadEthBrowser));
  document.getElementById('wbAztecFile').addEventListener('change',async event=>{try{const file=event.target.files[0];if(file)await handle(()=>_loadAztecWallet(file))();}finally{event.target.value='';}});
  _updateButtonColors();
}
function resetWalletState() { window.BillboardAccount.invalidate(); _updateButtonColors(); }
