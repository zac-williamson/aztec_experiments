// Local browser preparation only. The browser owns post creation and plugin payment.
import fs from 'node:fs/promises';
import {drainDevnetCheckpoints} from './network.mjs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto,randomBytes} from 'node:crypto';
import {BatchCall} from '@aztec/aztec.js/contracts';
import {GasFees} from '@aztec/stdlib/gas';
import {TxStatus} from '@aztec/stdlib/tx';
import {derivePrivateFeeInstance,createPrivateFeeDeployment,requirePublishedPrivateFee,preparePrivateFeePayment} from '../../shared/private-fee-client.mjs';
import {bridgePrivateFeeCredit} from '../../scripts/w01-private-funding.mjs';

export async function prepareBrowserAuthor({fixture,directory,onProgress=console.log}){
 const {wallet,author,net}=fixture;
 const artifact=JSON.parse(await fs.readFile('apps/src/billboard/private_fee_artifact.json','utf8'));
 onProgress('Publishing private fee contract');
 const instance=await derivePrivateFeeInstance(artifact);
 if(!await net.node.getContract(instance.address,'latest'))await createPrivateFeeDeployment(wallet,artifact).send({from:author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 await requirePublishedPrivateFee(net.node,instance);
 const funded=await bridgePrivateFeeCredit({node:net.node,l1Client:net.deployment.l1Client,wallet,owner:author.address,
  walletSecret:author.secret,walletSalt:author.salt,payer:instance.address,privateFeeArtifact:artifact,directory,rpcUrl:net.rpcUrl,
  mineL1:()=>new Promise(resolve=>setTimeout(resolve,1000)),mark:onProgress});
 await drainDevnetCheckpoints(net);
 await wallet.pxe.sync();
 const gas=(await wallet.completeFeeOptions({from:author.address,feePayer:instance.address})).gasSettings.clone();
 gas.maxFeesPerGas=new GasFees(gas.maxFeesPerGas.feePerDaGas*16n||1n,gas.maxFeesPerGas.feePerL2Gas*16n||1n);
 const payment=await preparePrivateFeePayment({wallet,node:net.node,owner:author.address,privateFeeAddress:instance.address,
  privateFeeArtifact:artifact,expectedChainId:31337,expectedVersion:fixture.descriptor.scope.rollupVersion,gasSettings:gas,claim:funded.claim});
 onProgress('Claiming private fee credit');
 await new BatchCall(wallet,[]).send({from:author.address,additionalScopes:[author.address],fee:{paymentMethod:payment.paymentMethod,gasSettings:payment.gasSettings},wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 const gasSettings=Object.fromEntries(['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas'].map(name=>[name,Object.fromEntries((name.endsWith('Gas')?['feePerDaGas','feePerL2Gas']:['daGas','l2Gas']).map(key=>[key,String(gas[name][key])]))]));
 const password=randomBytes(24).toString('hex'),context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});
 vm.runInContext(await fs.readFile('shared/wallet-backup.js','utf8'),context);
 const backup=await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:author.secret.toString(),salt:author.salt.toString()},claims:[]},password);
 const backupPath=path.join(directory,'browser-wallet.encrypted.json');
 await fs.writeFile(backupPath,JSON.stringify(backup),{mode:0o600});
 return {privateFee:{contractAddress:instance.address.toString(),gasSettings},backupPath,password};
}
