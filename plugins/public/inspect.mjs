// Read-only verification in a short-lived process so native WASM allocations
// cannot overlap the real browser's prover. Never submits a transaction.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {Barretenberg,BarretenbergSync,BackendType} from '@aztec/bb.js';
import {createAztecNodeClient} from '@aztec/aztec.js/node';import {EmbeddedWallet} from '@aztec/wallets/embedded';import {Contract} from '@aztec/aztec.js/contracts';import {NO_FROM} from '@aztec/aztec.js/account';
import {AztecAddress} from '@aztec/stdlib/aztec-address';import {Fr} from '@aztec/foundation/curves/bn254';import {loadContractArtifact} from '@aztec/stdlib/abi';import {unpackText} from '../protocol.mjs';
const [servicePath,directory,selection='{}']=process.argv.slice(2),read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
let wallet,result,failed=false;
try{
 const service=await read(servicePath),actor=await read(path.join(directory,'author.json')),scope=service.descriptor.scope,options=JSON.parse(selection),node=createAztecNodeClient(service.nodeUrl),info=await node.getNodeInfo();
 assert.equal(String(info.l1ChainId),scope.chainId);assert.equal(String(info.rollupVersion),scope.rollupVersion);assert.equal(String(info.l1ContractAddresses.rollupAddress),scope.rollupAddress);
 wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:true,proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
 async function contract(address,file){const artifact=loadContractArtifact(await read(file)),instance=await node.getContract(AztecAddress.fromStringUnsafe(address),'latest');assert(instance);await wallet.registerContract(instance,artifact);return Contract.at(instance.address,artifact,wallet);}
 const board=await contract(scope.boardAddress,'apps/src/billboard/billboard_artifact.json'),escrow=await contract(scope.receiver,'plugins/adapter_artifact.json'),account=AztecAddress.fromStringUnsafe(actor.address);
 const query=async(c,name,...args)=>(await c.methods[name](...args).simulate({from:NO_FROM})).result;
 result={postCount:String(await query(board,'get_post_count')),requestCount:String(await query(escrow,'request_count')),balance:String(await query(escrow,'balance',account))};
 const postId=options.postId??(options.requestIndex!==undefined?String(await query(escrow,'request_at',options.requestIndex)):null);
 if(postId){
  const post=Fr.fromString(postId),reply=Fr.fromString(String((await query(board,'get_plugin_request',post))[2]));
  result.postId=postId;result.invocation=(await query(escrow,'invocation',post)).map(String);
  result.postText=unpackText((await query(board,'get_post',post)).map(String),Number(await query(board,'get_post_length',post)));
  result.postFlagged=await query(board,'is_post_flagged',post);
  if(!reply.isZero())result.reply={postId:String(reply),text:unpackText((await query(board,'get_post',reply)).map(String),Number(await query(board,'get_post_length',reply))),flagged:await query(board,'is_post_flagged',reply)};
 }
}catch{failed=true;}finally{
 try{await wallet?.stop();await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}catch{failed=true;}
}
if(failed){process.stderr.write('Read-only public verification failed\n');process.exit(1);}
process.stdout.write(JSON.stringify(result)+'\n');process.exit(0);
