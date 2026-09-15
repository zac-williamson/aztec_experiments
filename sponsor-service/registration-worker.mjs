// One bounded operator step. Caller owns scheduling, signer, recovery fence and node trust.
// No HTTP administration, automatic transaction replacement, or network-finality wait.
import {Contract} from '@aztec/aztec.js/contracts';
import {NO_FROM} from '@aztec/aztec.js/account';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {IssuerError} from './issuer.mjs';
import {Tx,TxHash} from '@aztec/stdlib/tx';
import {SponsorStateError,readRegisteredSponsorBatch} from '../shared/sponsor-state.mjs';
export class RegistrationWorkerError extends Error {
  constructor(code='REGISTRATION_WORKER_UNAVAILABLE'){super(code);this.code=code;}
}
const need=(ok,code='REGISTRATION_WORKER_INVALID')=>{if(!ok)throw new RegistrationWorkerError(code);};
const field=value=>typeof value==='bigint'?new Fr(value).toString():value?.toString();
const tuple=batch=>({batchId:String(batch.batchId),root:field(batch.root),window:String(batch.window),ticketCount:String(batch.ticketCount??batch.ticket_count)});
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createRegistrationWorker({issuer,journal,node,wallet,owner,sponsorArtifact,scope,prepareTransaction,assertRecoveryFence}={}) {
  need(issuer?.seal&&journal?.get&&journal?.claim&&journal?.savePrepared&&journal?.observe&&node?.getTxReceipt&&
    wallet&&owner&&scope&&typeof prepareTransaction==='function'&&typeof assertRecoveryFence==='function');
  const checkedScope=Object.freeze({...scope}),operator=owner.toString();
  const artifact=loadContractArtifact(sponsorArtifact);
  const address=AztecAddress.fromFieldUnsafe(Fr.fromString(checkedScope.sponsorAddress));
  const guarded=fn=>async input=>{try{return await fn(input);}catch(error){
    if(error instanceof RegistrationWorkerError)throw error;
    if(error instanceof SponsorStateError||error instanceof IssuerError)throw new RegistrationWorkerError(error.code);
    const journalCodes=['REGISTRATION_JOURNAL_ARTIFACT_MISMATCH','REGISTRATION_JOURNAL_BUSY','REGISTRATION_JOURNAL_CLOSED','REGISTRATION_JOURNAL_INTENT_CONFLICT','REGISTRATION_JOURNAL_INVALID','REGISTRATION_JOURNAL_INVALID_TX','REGISTRATION_JOURNAL_LIMIT','REGISTRATION_JOURNAL_NOT_FOUND','REGISTRATION_JOURNAL_PERMISSIONS','REGISTRATION_JOURNAL_RECEIPT_MISMATCH','REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED','REGISTRATION_JOURNAL_REVISION_CONFLICT','REGISTRATION_JOURNAL_SCOPE_MISMATCH','REGISTRATION_JOURNAL_STATE_CHANGED','REGISTRATION_JOURNAL_TRANSITION','REGISTRATION_JOURNAL_UNAVAILABLE'];
    if(journalCodes.includes(error?.code))throw new RegistrationWorkerError(error.code);
    throw new RegistrationWorkerError(); // Never copy signer/provider error text or transaction bytes.
  }};
  const fence=async()=>{
    need(await assertRecoveryFence(checkedScope)===true,'REGISTRATION_RECOVERY_FENCE_REQUIRED');
    const info=await node.getNodeInfo();
    need(info.l1ContractAddresses?.rollupAddress?.toString().toLowerCase()===checkedScope.rollupAddress,
      'REGISTRATION_ROLLUP_MISMATCH');
  };
  async function read(batchId){
    try{return await readRegisteredSponsorBatch({wallet,node,sponsorAddress:address,sponsorArtifact,
      boardAddress:checkedScope.boardAddress,expectedChainId:checkedScope.chainId,expectedVersion:checkedScope.version,batchId});}
    catch(error){if(error?.code==='SPONSOR_BATCH_UNAVAILABLE')return null;throw error;}
  }
  const verifyRegistered=(batch,job)=>need(batch&&equal(tuple({...batch,batchId:job.intent.batchId}),job.intent),'REGISTRATION_BATCH_CONFLICT');
  async function reconcileJob(job) {
    need(job.txHash,'REGISTRATION_PREPARATION_RECOVERY_REQUIRED');
    const receipt=await node.getTxReceipt(TxHash.fromString(job.txHash));
    need(receipt?.txHash?.toString()===job.txHash,'REGISTRATION_RECEIPT_MISMATCH');
    let observation;
    if(['checkpointed','proven','finalized'].includes(receipt.status)){
      need(['success','reverted'].includes(receipt.executionResult),'REGISTRATION_RECEIPT_MISMATCH');
      const block=await node.getBlock(receipt.blockNumber);
      if(block?.hash?.toString()!==receipt.blockHash?.toString()){
        return journal.observe({batchId:job.intent.batchId,expectedRevision:job.revision,observation:{status:'rollback',txHash:job.txHash}});
      }
      const batch=await read(job.intent.batchId);
      if(receipt.executionResult==='success'){
        if(!batch||!equal(tuple({...batch,batchId:job.intent.batchId}),job.intent)){
          return journal.observe({batchId:job.intent.batchId,expectedRevision:job.revision,observation:{status:'rollback',txHash:job.txHash}});
        }
      }
      else need(batch===null,'REGISTRATION_BATCH_CONFLICT');
      observation={status:receipt.status,txHash:job.txHash,executionResult:receipt.executionResult,
        blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash.toString(),canonicalBlockHash:block.hash.toString(),
        registeredBatch:batch?job.intent:null};
    }else{
      need(['pending','proposed','dropped'].includes(receipt.status),'REGISTRATION_RECEIPT_MISMATCH');
      observation={status:receipt.status,txHash:job.txHash};
    }
    return journal.observe({batchId:job.intent.batchId,expectedRevision:job.revision,observation});
  }
  return Object.freeze({
    reconcile:guarded(async({batchId})=>{await fence();return reconcileJob(await journal.get(batchId));}),
    step:guarded(async({batchId})=>{
      await fence();
      let job;
      try{job=await journal.get(batchId);}catch(error){
        if(error?.code!=='REGISTRATION_JOURNAL_NOT_FOUND')throw error;
        const batch=await issuer.seal({batchId});
        need(batch.status==='sealed'&&String(batch.chainId)===checkedScope.chainId&&String(batch.version)===checkedScope.version&&
          field(batch.sponsorAddress)===checkedScope.sponsorAddress,'REGISTRATION_ISSUER_SCOPE_MISMATCH');
        job=await journal.enqueue(tuple(batch));
      }
      if(['submission-uncertain','pending','included','confirmed','reverted','blocked'].includes(job.state))return reconcileJob(job);
      if(job.state==='preparing')throw new RegistrationWorkerError('REGISTRATION_PREPARATION_RECOVERY_REQUIRED');
      const registered=await read(batchId); // Verifies deployed class/address/network/board before authorization.
      if(registered){verifyRegistered(registered,job);throw new RegistrationWorkerError('REGISTRATION_HISTORY_RECONCILIATION_REQUIRED');}
      const sponsor=Contract.at(address,artifact,wallet);
      const {result:admin}=await sponsor.methods.get_admin().simulate({from:NO_FROM,skipFeeEnforcement:true});
      need(field(admin)===operator,'REGISTRATION_ADMIN_MISMATCH');
      if(job.state==='sealed'){
        job=await journal.claim({batchId,expectedRevision:job.revision});
        const intent=job.intent;
        const prepared=await prepareTransaction({interaction:sponsor.methods.register_batch(BigInt(intent.batchId),Fr.fromString(intent.root),BigInt(intent.window),Number(intent.ticketCount)),owner});
        need(prepared?.data?.feePayer?.toString()===operator,'REGISTRATION_PAYER_MISMATCH');
        job=await journal.savePrepared({batchId,expectedRevision:job.revision,txBytes:prepared.toBuffer()});
      }
      need(job.state==='prepared');
      const persisted=await journal.loadPrepared(batchId),tx=Tx.fromBuffer(persisted.txBytes);
      need(tx.data.feePayer.toString()===operator,'REGISTRATION_PAYER_MISMATCH');
      need((await node.isValidTx(tx)).result==='valid','REGISTRATION_TX_REJECTED');
      need(!(await node.simulatePublicCalls(tx)).revertReason,'REGISTRATION_PUBLIC_REVERT');
      await fence(); // Recheck recovery/admission immediately before durable send intent.
      job=await journal.beginSubmission({batchId,expectedRevision:job.revision});
      try{await node.sendTx(tx);}catch{return {state:'submission-uncertain',txHash:job.txHash,submitted:'unknown'};}
      // Returning after send leaves reconciliation to another bounded step; no epoch/finality wait.
      return {state:'submission-uncertain',txHash:job.txHash,submitted:true};
    }),
  });
}
