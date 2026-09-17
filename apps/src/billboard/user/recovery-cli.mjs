import {assertOperatorEnvironment} from '../../../../scripts/operator-launch.mjs';
if(process.env.BILLBOARD_OPERATOR_PROFILE==='1')assertOperatorEnvironment();
// Offline wallet, collateral-secret and transaction-journal portability.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createFileJournalStorage} from './transaction-journal-store.mjs';
import {createClaimSecretStore} from './claim-secret-store.mjs';
import {loadCliWalletInputs} from './wallet-inputs.mjs';
import {createRecoveryFile,restoreRecoveryFile} from './recovery-file.mjs';
async function passwordFromInput() {
 if(!process.stdin.isTTY) {
  const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>4096)throw new Error();chunks.push(chunk);}
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');
 }
 process.stderr.write('Recovery password: ');process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
 try{return await new Promise((resolve,reject)=>{
  let value='';const cleanup=()=>process.stdin.off('data',onData);
  const onData=text=>{for(const c of text){if(c==='\r'||c==='\n'){cleanup();resolve(value);return;}if(c==='\u0003'||c==='\u0004'){cleanup();reject(new Error());return;}if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;if(value.length>1024){cleanup();reject(new Error());return;}}};process.stdin.on('data',onData);
 });}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');}
}
function readEnvelope(file) {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try {const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>32*1024*1024+4096)throw new Error();return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
}
function writeNewPrivateFile(file,value) {
 const temporary=file+'.'+randomBytes(12).toString('hex')+'.tmp';let fd;
 try {
  fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  fs.linkSync(temporary,file);const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
export async function runRecoveryCli(argv,password) {
 const [action,...rest]=argv,options={};
 if(!['export','restore'].includes(action)||rest.length!==4)throw new Error('Usage: recovery-cli.mjs export|restore --wallet PATH --file PATH');
 for(let i=0;i<rest.length;i+=2){if(!['--wallet','--file'].includes(rest[i])||options[rest[i]]||!rest[i+1])throw new Error();options[rest[i]]=rest[i+1];}
 const walletPath=path.resolve(options['--wallet']),backupPath=path.resolve(options['--file']);
 let wallet,missing=false,envelope;
 try{fs.lstatSync(walletPath);}catch(error){if(error.code!=='ENOENT')throw error;missing=true;}
 if(!missing)wallet=loadCliWalletInputs({action:'status',aztecWalletPath:walletPath}).aztecWallet;
 if(action==='restore') {
  envelope=readEnvelope(backupPath);
  const payload=await globalThis.BillboardWalletBackup.decrypt(envelope,password,wallet?{expectedWallet:wallet}:{});
  wallet=payload.wallet;
 }else if(missing)throw new Error('Wallet file is required for export');
 const directory=path.dirname(walletPath);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const storage=createFileJournalStorage(path.join(directory,'transaction-journal-v1'));
 const claimStore=createClaimSecretStore(path.join(directory,'claim-secrets-v2'),wallet.secretKey,wallet.salt);
 if(action==='export')writeNewPrivateFile(backupPath,await createRecoveryFile({wallet,storage,claimStore,password}));
 else {
  await restoreRecoveryFile({wallet,storage,claimStore,password,envelope});
  if(missing)writeNewPrivateFile(walletPath,wallet);
 }
 return action==='export'?'Encrypted recovery file exported.':'Recovery file restored. Reconcile saved transactions before sending new requests.';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try{console.log(await runRecoveryCli(process.argv.slice(2),await passwordFromInput()));}
 catch{console.error('Recovery operation failed. Check the password and file permissions; preserve existing and backup records. No conflicting record is overwritten.');process.exitCode=1;}
}
