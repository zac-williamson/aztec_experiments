// Private fee funding: public recovery records only; wallet secrets never enter recovery records.
let fundingRecord = null;
const callEngine = makeCallEngine(runFeeJuiceFlow, {
  privateFeeArtifact: BILLBOARD_PRIVATE_FEE_ARTIFACT,
  fundPrivateFees: options => window.__aztec.fundPrivateFees(options),
});
setupRpcAuth();
function safeFundingError(error) {
  if(error?.code==='BB_PRIVATE_FEE_AMOUNT')return 'Deposit more than the configured maximum claim fee, so a private balance remains after claiming.';
  return ['BB_SUBMISSION_UNKNOWN','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN'].includes(error?.code)
    ? 'Submission outcome is unknown. Keep the recovery record and check the transaction before retrying.'
    : 'The operation did not complete. Keep your recovery record and check your configuration and deposit.';
}
async function loadWalletAndCheck() {
  const result = await callEngine('status', 'setupStatus');
  document.getElementById('azaddr').value = result.feePayer;
  log('Wallet ready. Deposits fund the shared private fee contract.', 'success', 'setupStatus');
}
function saveFundingRecord(record) {
  // This record contains public recovery metadata, not the derived salt or claim secret.
  const allowed=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount','txHash','leafIndex'];
  if(!record || record.schema!=='private-fee-funding-v1' || Object.keys(record).some(key=>!allowed.includes(key))) throw new Error('Invalid recovery record.');
  const text = JSON.stringify(record);
  const key='billboard-private-fee-recovery:'+JSON.stringify([record.chainId,record.rollupAddress,record.privateFeeAddress,record.sender,record.nonce]);
  const priorText=localStorage.getItem(key);
  if(priorText){
    const prior=JSON.parse(priorText);
    const fields=['schema','chainId','version','rollupAddress','portalAddress','tokenAddress','privateFeeAddress','sender','nonce','amount'];
    if(fields.some(field=>prior[field]!==record[field]) || (prior.txHash && prior.txHash!==record.txHash) ||
       (prior.leafIndex!==undefined && prior.leafIndex!==record.leafIndex)) throw new Error('Recovery record conflicts with a previous deposit.');
  }
  localStorage.setItem(key, text);
  localStorage.setItem('billboard-private-fee-recovery-latest',key);
  fundingRecord = record;
}
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
  return withBtn('depositBtn','Depositing...','depositStatus',async()=>{
    try {
      const result=await callEngine('deposit','depositStatus',{depositAmount:document.getElementById('amount').value.trim(),saveRecovery:saveFundingRecord});
      if(result.record)saveFundingRecord(result.record);
      log('Deposit recorded. Download the recovery file, then claim after the bridge message is available.', 'success','depositStatus');
    }catch(error){throw new Error(safeFundingError(error));}
  });
}
async function doClaimPage() {
  return withBtn('claimBtn','Claiming...','claimStatus',async()=>{
    try {
      if(!fundingRecord)throw new Error();
      const txHash=document.getElementById('recoveryTxHash').value.trim();
      const record=txHash?{...fundingRecord,txHash}:fundingRecord;
      await callEngine('claim','claimStatus',{fundingRecord:record});
      saveFundingRecord(record);
      log('Private balance funded. You can now return to the message board.', 'success','claimStatus');
    }catch(error){throw new Error(safeFundingError(error));}
  });
}
try {const key=localStorage.getItem('billboard-private-fee-recovery-latest');const saved=key&&localStorage.getItem(key);if(saved)fundingRecord=JSON.parse(saved);}catch(_){}
function initializePrivateFees() {
  if (!window.__aztec?.createPXE) {setTimeout(initializePrivateFees,500);return;}
  initWalletButtons('walletButtonsContainer',{statusId:'setupStatus',ethRpcUrl:ETH_RPC_URL,onReady:async()=>{
    try{await loadWalletAndCheck();}catch(error){log(safeFundingError(error),'error','setupStatus');}
  }});
}
initializePrivateFees();
