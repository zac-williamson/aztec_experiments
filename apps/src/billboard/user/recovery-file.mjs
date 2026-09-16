import '../../../../shared/wallet-backup.js';
import {createJournalBackup} from '../../../../shared/journal-backup.mjs';
import {Fr} from '@aztec/foundation/curves/bn254';
import {computeSecretHash} from '@aztec/stdlib/hash';
// Offline portable custody; neither export nor restore contacts a node or signs.
export async function createRecoveryFile({wallet,storage,claimStore,password}) {
 const canonical=globalThis.BillboardWalletBackup.validateWallet(wallet);
 const journals=await (await createJournalBackup({storage,walletSecret:canonical.secretKey,walletSalt:canonical.salt})).exportRecords();
 const claims=await claimStore.exportRecords();
 for(const {record} of claims)if((await computeSecretHash(Fr.fromHexString(record.secret))).toString()!==record.secretHash)throw new Error('Claim commitment mismatch');
 return globalThis.BillboardWalletBackup.encrypt({schemaVersion:2,wallet:canonical,claims,journals},password);
}
export async function restoreRecoveryFile({wallet,storage,claimStore,password,envelope}) {
 const payload=await globalThis.BillboardWalletBackup.decrypt(envelope,password,{expectedWallet:wallet});
 for(const {scope,record} of payload.claims) {
  if((await computeSecretHash(Fr.fromHexString(record.secret))).toString()!==record.secretHash)throw new Error('Claim commitment mismatch');
  const prior=await claimStore.load(scope,record.secretHash);
  if(prior&&prior.secret!==record.secret)throw new Error('Conflicting local claim recovery record');
 }
 await (await createJournalBackup({storage,walletSecret:payload.wallet.secretKey,walletSalt:payload.wallet.salt})).restoreRecords(payload.journals||[]);
 for(const {scope,record} of payload.claims)await claimStore.save(scope,record);
 return {claims:payload.claims.length,journals:payload.journals?.length||0};
}
