// Test-only assertion consumer. Parent supplies actual production actor calls,
// canonical node evidence, same-store lifecycle and fee/effect persistence.
// No keys, action identifiers, signed bytes or private state leave this function.
const fail=()=>Error('Rolling saved preference acceptance failed.');
const check=value=>{if(!value)throw fail();};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=['authWitnesses','proofJobs','walletSubmissions','transportSends','estimates','payments'];
function counts(read){const c=read(),out={};for(const k of keys){check(Number.isSafeInteger(c[k])&&c[k]>=0);out[k]=c[k];}return out;}
function bytes(a,b){check(a instanceof Uint8Array&&b instanceof Uint8Array&&a.length>0&&a.length===b.length);for(let i=0;i<a.length;i++)check(a[i]===b[i]);}
function unchanged(read,before){check(same(counts(read),before));}
function intent(a,b){for(const k of ['intentId','action','nonce','maximumFee'])check(same(a[k],b[k]));}
export async function exerciseRollingSavedPreference({root,expectedDigest,prepare,submit,setSendFault,snapshotSaved,readUnsent,reopenSameStores,inspectRecovery,resumeSaved,collectIncluded,readPreferences,activity,deadlineAt}){
 try{
  check(typeof root==='string'&&/^[1-9][0-9]{0,76}$/.test(root)&&typeof expectedDigest==='string'&&/^[1-9][0-9]{0,76}$/.test(expectedDigest)&&Number.isSafeInteger(deadlineAt)&&deadlineAt>Date.now());
  for(const fn of [prepare,submit,setSendFault,snapshotSaved,readUnsent,reopenSameStores,inspectRecovery,resumeSaved,collectIncluded,readPreferences,activity])check(typeof fn==='function');
  const prepared=await prepare({type:'preference',expectedRevision:'0',kind:1,target:root,enabled:true});
  check(prepared.status==='prepared'&&typeof prepared.intentId==='string'&&typeof prepared.nonce==='string'&&BigInt(prepared.maximumFee)>0n);
  const before=counts(activity);await setSendFault(true);
  let rejected=false;try{await submit(prepared.intentId);}catch{rejected=true;}
  // Fault remains armed across any HTTP retry, until the explicit resume phase.
  check(rejected);const saved=await snapshotSaved();
  check(saved.operation==='ROLLING_WORKFLOW_V1:'+prepared.intentId&&/^0x[0-9a-f]{64}$/.test(saved.txHash));
  check(saved.deniedCount>=1&&saved.forwardedCount===0&&saved.bytes instanceof Uint8Array&&saved.bytes.length>0);intent(saved.intent,prepared);
  const afterProof=counts(activity);check(afterProof.proofJobs===before.proofJobs+1&&afterProof.walletSubmissions===before.walletSubmissions+1&&afterProof.transportSends===before.transportSends);
  const unsent=await readUnsent(saved.txHash);check(unsent.status==='dropped'&&unsent.effectAbsent===true&&unsent.validation==='valid'&&unsent.feesUnchanged===true);
  unchanged(activity,afterProof);
  const reopened=await reopenSameStores();check(reopened.samePXEStore===true&&reopened.sameJournalStore===true&&reopened.oldClosed===true&&reopened.freshActor===true);
  const baseline=counts(activity);check(baseline.proofJobs===afterProof.proofJobs&&baseline.transportSends===afterProof.transportSends&&baseline.walletSubmissions===0);
  const retained=await snapshotSaved();check(retained.operation===saved.operation&&retained.txHash===saved.txHash);bytes(retained.bytes,saved.bytes);for(const key of ['workflow','l2Journal'])bytes(retained.ciphertext[key],saved.ciphertext[key]);intent(retained.intent,prepared);
  const inspection=await inspectRecovery(prepared.intentId);unchanged(activity,baseline);intent(inspection.intent,prepared);
  check(inspection.currentTxHash===saved.txHash&&inspection.exactResume?.status==='resumable'&&inspection.exactResume.txHash===saved.txHash&&inspection.exactResume.feeSource==='original'&&inspection.exactResume.maximumFee===prepared.maximumFee);
  const afterInspection=await snapshotSaved();for(const key of ['workflow','l2Journal'])bytes(afterInspection.ciphertext[key],saved.ciphertext[key]);unchanged(activity,baseline);
  check(inspection.head?.initialized===false&&inspection.head.schema===1&&inspection.head.revision==='0'&&inspection.head.digest==='0');
  await setSendFault(false);unchanged(activity,baseline);
  let result,sendError;try{result=await resumeSaved(prepared.intentId,{expectedTxHash:saved.txHash});}catch(error){sendError=error;}
  // ALWAYS collect and persist real paid inclusion before later acceptance or
  // reporting the original send error. Parent does not infer zero fees on error.
  const included=await collectIncluded(saved.txHash);
  check(!sendError&&result.status==='confirmed'&&result.txHash===saved.txHash);
  check(included.txHash===saved.txHash&&included.operation===saved.operation&&included.executionResult==='success'&&BigInt(included.transactionFee)>0n);
  check(included.canonical===true&&included.events.length===0&&included.forwardedCount===1);bytes(included.bytes,saved.bytes);bytes(included.forwardedBytes,saved.bytes);intent(included.intent,prepared);
  const after=counts(activity);for(const k of keys)check(after[k]===baseline[k]+(k==='transportSends'?1:0));
  let previous,complete;
  for(;;){check(Date.now()<deadlineAt);const state=await readPreferences({deadlineAt});unchanged(activity,after);
   if(state.complete){check(state.status==='complete'&&state.orphanedReadMarkers?.length===0);complete=state.preferences;break;}
   check(state.status==='recovering'&&!Object.hasOwn(state,'preferences')&&state.progress);
   if(previous)check(state.progress.scannedThrough>previous.scannedThrough||state.progress.markersChecked>previous.markersChecked);previous=state.progress;
  }
  check(complete.head.initialized&&complete.head.schema===1&&complete.head.revision==='1'&&complete.head.digest===expectedDigest);
  check(same(complete.bookmarks,[root])&&same(complete.followedBoards,[])&&same(complete.followedNames,[])&&same(complete.subscriptions,[])&&same(complete.readMarkers,[])&&complete.replyNotifications===true);
  return {passed:true,sameStoreRecovery:true,controlledPreForwardFailure:true,originalSubmitRejected:true,unchargedBeforeResume:true,readOnlyInspection:true,identicalSignedBytes:true,sameOperationNonceAndFeeCeiling:true,explicitResume:true,resumeProofJobs:0,resumeEstimates:0,resumePayments:0,resumeWalletSubmissions:0,resumeTransportSends:1,canonicalInclusions:1,publicPreferenceEvents:0,exactPrivateBookmark:true};
 }catch{throw fail();}
}
