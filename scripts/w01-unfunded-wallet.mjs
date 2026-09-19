// TEST ONLY. Account and canonical FPC registration; no funding or transaction.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {generateSchnorrAccounts} from '@aztec/accounts/testing';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {BackendType} from '@aztec/bb.js';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {derivePrivateFeeInstance} from '../shared/private-fee-client.mjs';
import {restoreApplicationAuthor} from './w02-wallet-restore.mjs';
import {ROOT} from './toolchain.mjs';

export async function prepareW01UnfundedWallet({node,preparation,directory,persistentDirectory}) {
 assert(path.isAbsolute(directory));
 if(persistentDirectory!==undefined){assert(path.isAbsolute(persistentDirectory));assert.equal(path.dirname(persistentDirectory),directory);}
 const raw=JSON.parse(await fs.readFile(path.join(ROOT,'apps/src/billboard/private_fee_artifact.json')));
 const artifact=loadContractArtifact(raw),instance=await derivePrivateFeeInstance(raw),info=await node.getNodeInfo();
 const [generated]=await generateSchnorrAccounts(1,'schnorr_initializerless');
 const restored=await restoreApplicationAuthor(generated),author=restored.author;
 assert(!author.address.equals(preparation.account.address));assert.equal(await getFeeJuiceBalance(author.address,node),0n);
 let wallet;
 const open=()=>EmbeddedWallet.create(node,{ephemeral:persistentDirectory===undefined,pxe:{
  ...(persistentDirectory===undefined?{}:{dataDirectory:persistentDirectory}),proverEnabled:true,
  proverOrOptions:{backend:BackendType.NativeUnixSocket,bbPath:path.join(directory,'bb-one-thread'),threads:1},
  autoSync:false,syncChainTip:'checkpointed'}});
 const close=async()=>{if(wallet){await wallet.stop();wallet=undefined;}};
 try{
  wallet=await open();await wallet.createSchnorrInitializerlessAccount(author.secret,author.salt,author.signingKey,'private-fee-test-author');
  await wallet.registerContract(instance,artifact);
  // Private preparation material never enters JSON evidence.
  return Object.defineProperties({walletRestore:restored.observation},{
   raw:{value:raw},artifact:{value:artifact},instance:{value:instance},info:{value:info},author:{value:author},
   wallet:{get:()=>wallet},close:{value:close},
   reopen:{value:async()=>{assert(persistentDirectory!==undefined&&!wallet);wallet=await open();}},
  });
 }catch(error){await close();throw error;}
}
