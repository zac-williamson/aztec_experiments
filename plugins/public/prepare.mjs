// Public qualification fixture: fresh identities and faucet-funded test assets only.
// No local sequencer controls, storage mutation or fabricated settlement.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto,randomBytes} from 'node:crypto';
import {Wallet,JsonRpcProvider,Contract,keccak256,parseEther} from 'ethers';
import {Fr} from '@aztec/foundation/curves/bn254';
import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {createAztecNodeClient} from '@aztec/aztec.js/node';
import {restoreApplicationAuthor} from '../../scripts/w02-wallet-restore.mjs';
import {recordedTransaction,fileState} from '../operations.mjs';
const [configPath,directory,treasuryFile]=process.argv.slice(2);
if(!configPath||!directory||!treasuryFile)throw Error('Usage: prepare.mjs PUBLIC_CONFIG PRIVATE_NEW_DIRECTORY FAUCET_WALLET');
const config=JSON.parse(await fs.readFile(configPath,'utf8')),node=createAztecNodeClient(config.nodeUrl),provider=new JsonRpcProvider(config.ethereumUrl);
try{
 if(Number((await provider.getNetwork()).chainId)!==11155111||Number((await node.getNodeInfo()).l1ChainId)!==11155111)throw Error('Public qualification requires Sepolia');
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const actorPath=path.join(directory,'author.json');let actor;
 try{actor=JSON.parse(await fs.readFile(actorPath,'utf8'));}catch(error){
  if(error.code!=='ENOENT')throw error;
  const {author}=await restoreApplicationAuthor({secret:Fr.random(),salt:Fr.random()});
  const ethereum=Wallet.createRandom(),password=randomBytes(24).toString('hex');
  actor={address:String(author.address),secret:String(author.secret),salt:String(author.salt),signingKey:String(author.signingKey),ethereumAddress:ethereum.address,ethereumKey:ethereum.privateKey,mnemonic:ethereum.mnemonic.phrase,password};
  await fs.writeFile(actorPath,JSON.stringify(actor),{mode:0o600,flag:'wx'});
 }
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array});vm.runInContext(await fs.readFile('shared/wallet-backup.js','utf8'),context);
 const backup=await context.BillboardWalletBackup.encrypt({schemaVersion:1,wallet:{secretKey:actor.secret,salt:actor.salt},claims:[]},actor.password);
 await fs.writeFile(path.join(directory,'browser-wallet.encrypted.json'),JSON.stringify(backup),{mode:0o600});
 await fs.writeFile(path.join(directory,'application-wallet.json'),JSON.stringify({secretKey:actor.secret,salt:actor.salt}),{mode:0o600});
 await fs.writeFile(path.join(directory,'ethereum.json'),JSON.stringify({privateKey:actor.ethereumKey,address:actor.ethereumAddress}),{mode:0o600});
 const signer=new Wallet(JSON.parse(await fs.readFile(treasuryFile,'utf8')).privateKey,provider),store=await fileState(path.join(directory,'funding.json'));
 const send=async(name,tx)=>recordedTransaction({store,name,identity:JSON.stringify(tx,(_,v)=>typeof v==='bigint'?String(v):v),prepare:async()=>{const raw=await signer.signTransaction(await signer.populateTransaction(tx));return {raw,hash:keccak256(raw)};},broadcast:async r=>{if(!await provider.getTransaction(r.hash))await provider.broadcastTransaction(r.raw);},wait:async r=>{const receipt=await provider.waitForTransaction(r.hash,1,120000);if(receipt?.status!==1)throw Error('Fixture funding awaits confirmation');return receipt;}});
 await send('gas',{to:actor.ethereumAddress,value:parseEther('0.02')});
 const token=new Contract(config.tokenAddress,['function transfer(address,uint256) returns(bool)'],provider);
 await send('usdc',await token.transfer.populateTransaction(actor.ethereumAddress,2000000n));
 console.log(JSON.stringify({aztecAddress:actor.address,ethereumAddress:actor.ethereumAddress,funding:Object.fromEntries(Object.entries(store.read().operations).map(([k,v])=>[k,v.hash]))},null,2));
}finally{provider.destroy();await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
