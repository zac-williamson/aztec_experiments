import {prepareInvocation} from './invocation.mjs';
import {pluginAccountAction} from './account-client.mjs';

/** Runs inside the board's guarded, cross-tab transaction boundary. */
export async function runAccountOperation({env,config,connect,storage,resolveInvocation=prepareInvocation,executeAccount=pluginAccountAction}) {
 const a=env.aztec;
 const connected=await connect(env,{...config,action:'status'});
 const h=connected.handles;
 if(!h)throw Object.assign(Error('Connect your board account first.'),{code:'BB_WALLET_NOT_READY'});
 const scope={chainId:String(h.nodeInfo.l1ChainId),rollupVersion:String(h.version),rollupAddress:String(h.nodeInfo.l1ContractAddresses.rollupAddress),boardAddress:String(h.l2Addr)};
 const input=config.pluginInput,action=config.pluginAction;
 const plan=await resolveInvocation({text:'@'+input.handle,scope,allowDisabled:action!=='deposit',lookup:async id=>{
  const {result}=await h.contract.methods.get_plugin(a.Fr.fromString(id)).simulate({from:a.NO_FROM});
  const [receiver,enabled,descriptor,length]=result;
  return {receiver:String(receiver),enabled,descriptor:descriptor.map(String),length:Number(length)};
 }});
 await config.contextGuard();
 if(!plan)throw Object.assign(Error('This plugin is not registered on the board.'),{code:'BB_PLUGIN_UNKNOWN'});
 const key='plugin-account:'+plan.descriptor.scope.receiver+':'+scope.chainId+':'+scope.rollupAddress+':'+scope.rollupVersion+':'+h.address;
 const journal=await env.createTransactionJournal({walletSecret:config.aztecWallet.secretKey,walletSalt:config.aztecWallet.salt,
  scope:{account:String(h.address).toLowerCase(),chainId:scope.chainId,rollup:scope.rollupAddress.toLowerCase(),version:scope.rollupVersion,board:scope.boardAddress.toLowerCase(),portal:config.portalAddress.toLowerCase()},
  Tx:a.Tx,node:h.rawNode,acknowledgeTx:config.acknowledgeTx,contextGuard:config.contextGuard});
 let lastL2TxHash;
 if(['deposit','withdraw','cancel','release'].includes(action))await journal.assertCanStart();
 const result=await executeAccount({action,input,descriptor:plan.descriptor,sdk:a,handles:h,signer:await env.getBrowserSigner(),onProgress:env.log,
  store:{read:()=>JSON.parse(storage.getItem(key)||'null'),write:value=>storage.setItem(key,JSON.stringify(value))},
  send:async(interaction,beforeSubmit)=>{
   await config.contextGuard();await h.pxe.sync();
   const route=config.privateFee;
   const prepared=await a.preparePrivateFeePayment({wallet:h.wallet,node:h.aztecNode,owner:h.address,privateFeeAddress:route.contractAddress,privateFeeArtifact:env.privateFeeArtifact,expectedChainId:scope.chainId,expectedVersion:scope.rollupVersion,gasSettings:route.gasSettings});
   const estimated=await a.estimatePrivateFeeTransaction({wallet:h.wallet,node:h.aztecNode,interaction,prepared,from:h.address,guard:config.contextGuard});
   const sent=await h.wallet.sendTx(estimated.payload,{from:h.address,fee:{gasSettings:estimated.gasSettings},transactionJournal:journal,journalOperation:JSON.stringify({kind:'extension',receiver:plan.descriptor.scope.receiver,action}),beforeSubmit});
   lastL2TxHash=String(sent.receipt.txHash);return sent;
  }});
 await config.contextGuard();
 return {...result,handles:h,...(lastL2TxHash?{lastL2TxHash}:{})};
}
