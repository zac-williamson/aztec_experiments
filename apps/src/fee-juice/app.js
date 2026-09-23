// Private fee funding: public recovery records only; wallet secrets never enter recovery records.
let fundingRecord = null;
let feeWalletReady = false;
function setFeeWalletReady(ready) {
  feeWalletReady=ready;
  for(const id of ['depositBtn','claimBtn'])document.getElementById(id).disabled=!ready;
}
const application=createBillboardApplication({kind:'fees'});
async function callEngine(action,statusDiv,extra={}) {
  return application.run(action,extra,(message,level)=>log(message,level||'info',statusDiv));
}
async function recoverSavedFeeTransaction() {
  try {await callEngine('recover-l2','claimStatus');}
  catch(error){log(safeFundingError(error),'error','claimStatus');}
}
async function recoverSavedFeeEthereum(retry=false) {
  try {const result=await callEngine('recover-eth','depositStatus',{retryEthereum:retry,fundingRecord});if(result.record)saveFundingRecord(result.record);}
  catch(error){log(safeFundingError(error),'error','depositStatus');}
}
setupRpcAuth();
function safeFundingError(error) {
  if(error?.code==='BB_WALLET_NOT_READY')return 'Connect your wallet and wait for account setup to finish before funding fees.';
  if(error?.code==='BB_REMOTE_PROVER_FAILED')return 'Remote proving failed. Retry or turn off Remote proving to prove on this device.';
  if(error?.code==='PRIVATE_FEE_CAP_TOO_LOW')return 'The configured transaction fee cap is below the network’s current minimum. The board operator needs to update its fee settings before you can continue.';
  if(error?.code==='BB_ETH_RECOVERY_REQUIRED')return 'Check the saved Ethereum fee request before starting another deposit.';
  if(error?.code==='BB_RECOVERY_REQUIRED')return 'Recover the saved private fee transaction before attempting another claim.';
  if(error?.code==='BB_JOURNAL_INVALID')return 'Private fee recovery storage could not be authenticated or saved. Preserve your recovery files.';
  if(error?.code==='BB_PRIVATE_FEE_AMOUNT')return 'Deposit more than the configured maximum claim fee, so a private balance remains after claiming.';
  return ['BB_SUBMISSION_UNKNOWN','BB_ETH_SUBMISSION_UNKNOWN','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN'].includes(error?.code)
    ? 'Submission outcome is unknown. Keep the recovery record and check the transaction before retrying.'
    : 'The operation did not complete. Keep your recovery record and check your configuration and deposit.';
}
async function loadWalletAndCheck() {
  const result = await callEngine('status', 'setupStatus');
  setFeeWalletReady(true);
  document.getElementById('azaddr').value = result.feePayer;
  log('Wallet ready. Deposits fund the shared private fee contract.', 'success', 'setupStatus');
}
function saveFundingRecord(record) {fundingRecord=application.importFundingRecovery(record);}
function downloadRecovery() {
  if (!fundingRecord) throw new Error('No recovery record is available.');
  const url = URL.createObjectURL(new Blob([JSON.stringify(fundingRecord,null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href=url;link.download='private-fee-recovery.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function importRecovery(event) {
  try {
    const file=event.target.files[0];if(!file||file.size>16384)throw new Error();
    saveFundingRecord(JSON.parse(await file.text()));
    log('Recovery record loaded. It will be checked against your wallet and the chain.', 'success', 'claimStatus');
  } catch (_) {log('Could not load the recovery record.', 'error', 'claimStatus');}
}
async function doDepositPage() {
  if(!feeWalletReady){log(safeFundingError({code:'BB_WALLET_NOT_READY'}),'error','depositStatus');return;}
  return withBtn('depositBtn','Depositing...','depositStatus',async()=>{
    try {
      const result=await callEngine('deposit','depositStatus',{depositAmount:document.getElementById('amount').value.trim()});
      if(result.record)saveFundingRecord(result.record);
      log('Deposit recorded. Download the recovery file, then claim after the bridge message is available.', 'success','depositStatus');
    }catch(error){log(safeFundingError(error),'error','depositStatus');}
  });
}
async function doClaimPage() {
  if(!feeWalletReady){log(safeFundingError({code:'BB_WALLET_NOT_READY'}),'error','claimStatus');return;}
  return withBtn('claimBtn','Claiming...','claimStatus',async()=>{
    try {
      if(!fundingRecord)throw new Error();
      const txHash=document.getElementById('recoveryTxHash').value.trim();
      const record=txHash?{...fundingRecord,txHash}:fundingRecord;
      await callEngine('claim','claimStatus',{fundingRecord:record});
      saveFundingRecord(record);
      log('Private balance funded. You can now return to the message board.', 'success','claimStatus');
    }catch(error){log(safeFundingError(error),'error','claimStatus');}
  });
}

function initializePrivateFees() {
  setFeeWalletReady(false);
  const publicConfig = _getPublicConfig();
  const fee = ethers.formatUnits(BigInt(BillboardConfig.maximumFee(publicConfig)), 18);
  document.getElementById('azaddr').value = publicConfig.privateFee.contractAddress;
  document.getElementById('feeBudget').textContent = 'Each private transaction requires up to ' + fee + ' AZTEC in available credit. You pay the actual fee; unused gas returns to your private balance. Deposit more than this amount to cover the claim and leave credit for posting and withdrawing.';
  if (!window.__aztec?.createPXE) {waitForBundle(initializePrivateFees);return;}
  fundingRecord=application.readFundingRecovery();
  initWalletButtons('walletButtonsContainer',{autoPasskey:true,statusId:'setupStatus',onChange:state=>{if(state.invalidated)setFeeWalletReady(false);},onReady:async()=>{
    try{await loadWalletAndCheck();}catch(error){log(safeFundingError(error),'error','setupStatus');}
  }});
}
initializeHostedBoard(initializePrivateFees);

window.billboardConfigStore?.subscribe(()=>{fundingRecord=null;});
