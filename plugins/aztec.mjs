import {TxStatus} from '@aztec/stdlib/tx';
import {Contract} from '@aztec/aztec.js/contracts';
import {NO_FROM} from '@aztec/aztec.js/account';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {packText,unpackText} from './protocol.mjs';

/** Reference implementation of the board port; workers import only its interface. */
export async function aztecBoardPort({node,wallet,scope,boardArtifact,adapterArtifact,operator,finality='finalized'}) {
  if(!['finalized','checkpointed'].includes(finality))throw Error('Invalid confirmation policy');
  if(finality==='checkpointed'&&scope.chainId!=='31337')throw Error('Checkpointed execution is devnet-only');
  const board=await Contract.at(AztecAddress.fromStringUnsafe(scope.boardAddress),boardArtifact,wallet);
  const adapter=await Contract.at(AztecAddress.fromStringUnsafe(scope.receiver),adapterArtifact,wallet);
  const read=async(name,...args)=>(await board.methods[name](...args).simulate({from:NO_FROM})).result;
  return {
    async readRequest(postId){
      const info=await node.getNodeInfo();
      if(String(info.l1ChainId)!==scope.chainId||String(info.rollupVersion)!==scope.rollupVersion||info.l1ContractAddresses.rollupAddress.toString().toLowerCase()!==scope.rollupAddress)throw Error('Board network mismatch');
      const id=Fr.fromString(postId);
      if(!await read('get_post_exists',id))return null;
      const [handle,receiver,reply,publishedBlock]=await read('get_plugin_request',id);
      if(BigInt(handle)===0n)return null;
      const [,enabled]=await read('get_plugin',handle);
      const [fields,length,flagged,head]=await Promise.all([read('get_post',id),read('get_post_length',id),read('is_post_flagged',id),node.getBlockData(finality)]);
      const headNumber=head?.header?.getBlockNumber();
      return {text:unpackText(fields.map(String),Number(length)),receiver:receiver.toString(),enabled,flagged,
        replyPostId:BigInt(reply)===0n?null:new Fr(BigInt(reply)).toString(),
        // Compare the recorded publication block to the confirmed chain tip.
        finalized:headNumber!==undefined&&BigInt(publishedBlock)>0n&&BigInt(publishedBlock)<=BigInt(headNumber)};
    },
    async reply(postId,text){const packed=packText(text);return adapter.methods.reply(Fr.fromString(postId),packed.fields.map(value=>Fr.fromString(value)),packed.length).send({from:operator,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});},
  };
}
