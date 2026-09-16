import {createEncryptedJournalSlot} from './journal-record.mjs';
import {l2JournalScopeText} from './l2-journal.mjs';
import {transactionError} from './transaction-outcomes.mjs';
// One cursor per wallet, network, board and exact withdrawal message. Concurrent
// searches cannot overwrite each other's progress; reorg checks belong to scanner.
export async function createHistoryCursor({storage,walletSecret,walletSalt,scope,messageLeaf}) {
  if(typeof messageLeaf!=='string'||!/^0x[0-9a-f]{64}$/.test(messageLeaf))throw transactionError('BB_JOURNAL_INVALID','Invalid withdrawal recovery identity.');
  const slot=await createEncryptedJournalSlot({storage,walletSecret,walletSalt,
    scopeText:JSON.stringify(['AZTEC_BB_HISTORY_V1',l2JournalScopeText(scope),messageLeaf]),keyDomain:'AZTEC_BB_HISTORY_KEY_V1'});
  let previous;
  return {async read(){previous=await slot.read();return previous.value;},async write(value){
    if(!previous)throw transactionError('BB_JOURNAL_INVALID','Read withdrawal recovery state before updating it.');
    previous=await slot.write(previous,value);
  }};
}
