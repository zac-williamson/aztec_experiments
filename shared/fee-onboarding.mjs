// Coordinates fee funding through narrow ports. The caller owns wallet locks,
// identity guards and durable Ethereum storage; this module owns no UI state.
export async function ensureOnboardingFees({checkBalance,recoverFunding,fund,recoverClaim,isConsumed,waitForMessage,onProgress=()=>{}}) {
  try { await checkBalance(); return undefined; }
  catch(error) { if(error?.code!=='PRIVATE_FEE_BALANCE_INSUFFICIENT')throw error; }
  onProgress('Preparing transaction fees automatically. Your wallet may request token approval and funding confirmation.','info');
  let previous;
  try { previous=await recoverFunding(); }
  catch(error) { if(error?.code!=='BB_NO_SAVED_ETHEREUM_TRANSACTION')throw error; }
  let claim;
  if(previous?.outcome==='funded') {
    claim=await recoverClaim(previous.record);
    if(await isConsumed(claim))claim=undefined;
  } else if(previous&&!['approved','reverted','replaced'].includes(previous.outcome)) {
    throw Object.assign(new Error('The previous fee payment must be confirmed before another is sent.'),{code:'BB_ETH_RECOVERY_REQUIRED'});
  }
  if(!claim) {
    const record=await fund(previous?.lastEthereumTxHash);
    claim=await recoverClaim(record);
  }
  onProgress('Fee funding confirmed on Ethereum. Waiting for it to become available on Aztec…','info');
  await waitForMessage(claim);
  onProgress('Transaction fees are ready. Continuing your board deposit automatically.','success');
  return claim;
}
