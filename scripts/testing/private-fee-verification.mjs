// Test accounting only. Retain observations before assertions so a failed real
// journey preserves the measured values, rather than the previous successful read.
import assert from 'node:assert/strict';

function tip(value){
 const number=value?.number,hash=String(value?.hash);
 assert(Number.isSafeInteger(number)&&number>=0&&/^0x[0-9a-f]{64}$/.test(hash),'Invalid accounting anchor');
 return {number,hash};
}
async function header(pxe){const h=await pxe.getSyncedBlockHeader();return tip({number:h.getBlockNumber(),hash:await h.hash()});}
async function canonical(node,anchor){const block=await node.getBlockData(anchor.number);return block?String(block.blockHash)===anchor.hash:false;}

export async function verifyPrivateFeeAccounting({pxe,node,readPrivateBalance,readAuthorPublicBalance,readPoolBalance,expectedPrivateBalance,expectedPoolBalance,observation}){
 observation.passed=false;
 assert.equal(typeof expectedPrivateBalance,'bigint');assert.equal(typeof expectedPoolBalance,'bigint');
 const sample=observation.lastVerification={status:'running',stage:'target',expected:{privateBalance:String(expectedPrivateBalance),authorPublicBalance:'0',poolBalance:String(expectedPoolBalance)}};
 try{
  sample.target=tip((await node.getChainTips()).checkpointed.block);
  sample.anchorBeforeSync=await header(pxe);sample.stage='sync';await pxe.sync();
  sample.anchorBeforeRead=await header(pxe);sample.stage='canonical-before';
  sample.targetCanonicalBefore=await canonical(node,sample.target);
  sample.anchorCanonicalBefore=await canonical(node,sample.anchorBeforeRead);
  assert(sample.targetCanonicalBefore&&sample.anchorCanonicalBefore,'Fee accounting synchronization must reach canonical state');
  assert(sample.anchorBeforeRead.number>=sample.target.number,'Fee accounting synchronization did not reach its checkpoint target');
  sample.stage='balances';
  sample.privateBalance=String(await readPrivateBalance());
  sample.authorPublicBalance=String(await readAuthorPublicBalance());
  sample.poolBalance=String(await readPoolBalance());
  sample.anchorAfterRead=await header(pxe);sample.stage='canonical-after';
  sample.targetCanonicalAfter=await canonical(node,sample.target);
  sample.anchorCanonicalAfter=await canonical(node,sample.anchorAfterRead);
  assert(sample.targetCanonicalAfter&&sample.anchorCanonicalAfter,'Fee accounting anchor changed during the balance read');
  assert.deepEqual(sample.anchorAfterRead,sample.anchorBeforeRead,'Fee accounting reads must use one PXE anchor');
  sample.stage='balances-equal';
  assert.equal(BigInt(sample.privateBalance),expectedPrivateBalance);
  assert.equal(BigInt(sample.authorPublicBalance),0n);
  assert.equal(BigInt(sample.poolBalance),expectedPoolBalance);
  sample.status='passed';sample.stage='complete';
  return {privateBalance:BigInt(sample.privateBalance),poolBalance:BigInt(sample.poolBalance)};
 }catch(error){sample.status='failed';throw error;}
}
