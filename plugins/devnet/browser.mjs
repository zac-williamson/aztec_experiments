// Interactive local author environment: ordinary built apps and real hosted service.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {bootstrapPluginDevnet} from './bootstrap.mjs';
import {prepareBrowserAuthor} from './browser-fixture.mjs';
import {startBoardWeb,retainPreviewCheckpoint} from './web.mjs';
import {startU01BrowserRpc} from '../../scripts/u01-browser-rpc.mjs';
import {runHostedService} from '../main.mjs';
if(!process.env.VENICE_WALLET_PRIVATE_KEY)throw Error('Configure the local Venice wallet');
if(!process.env.GITHUB_TOKEN)process.env.GITHUB_TOKEN=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:10000}).trim();
const directory=await fs.mkdtemp(path.resolve('.build/plugin-browser-'));
const automated=process.argv.includes('--test-wallet');
const port=automated?8791:8789,servicePort=automated?8792:8786;
const origin='http://localhost:'+port,token=randomBytes(32).toString('hex');
console.log('BROWSER_DIRECTORY',directory);
let fixture,service,web,rpc,stop,runError;
const abort=new AbortController();
const stopped=new Promise(resolve=>{stop=()=>{abort.abort();resolve();};});
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const mark=step=>console.log('STEP',step);
try{
 fixture=await bootstrapPluginDevnet({directory,port:servicePort,browserAuthor:true,proofs:process.env.PLUGIN_PROOFS==='true',onProgress:mark});
 const author=await prepareBrowserAuthor({fixture,directory,onProgress:mark});
 rpc=await startU01BrowserRpc({node:fixture.net.node,anvilUrl:fixture.net.rpcUrl,ethereumAccount:fixture.signer.address,origin,token});
 web=await startBoardWeb({fixture,port,privateFee:author.privateFee,browserRpc:{...rpc,token},connectOrigins:['http://127.0.0.1:'+servicePort]});
 service=await runHostedService({config:fixture.serviceConfig,env:{...process.env,PLUGIN_GITHUB_WRITES:process.argv.includes('--github-writes')?'true':'false',PLUGIN_GITHUB_DRAFT:'true'},onError:error=>console.error('BOT_ERROR',error.message)});
 await retainPreviewCheckpoint(fixture.serviceConfig);
 await fs.writeFile(path.join(directory,'browser-control.json'),JSON.stringify({origin,backupPath:author.backupPath,backupPassword:author.password,ethereumAccount:fixture.signer.address,ethereumMnemonic:fixture.signer.mnemonic.phrase,ethereumUrl:fixture.net.rpcUrl,publicConfig:fixture.descriptor}),{mode:0o600});
 console.log('BROWSER_READY',origin+'/user.html',directory);
 if(automated){
  const {runWalletHarness}=await import('./wallet-harness.mjs');
  await runWalletHarness({fixture,author,directory,origin,onProgress:mark,signal:abort.signal});
  await retainPreviewCheckpoint(fixture.serviceConfig);
 }else await stopped;
}catch(error){runError=error;}finally{
 const failures=[];
 for(const close of [()=>web?.close(),()=>service?.close(),()=>rpc?.close(),()=>fixture?.close(),()=>Barretenberg.destroySingleton(),()=>BarretenbergSync.destroySingleton()]){try{await close();}catch(error){failures.push(error);}}
 if(automated){
  const resultPath=path.join(directory,'browser-result.json');
  let result;try{result=JSON.parse(await fs.readFile(resultPath,'utf8'));}catch(error){if(error.code!=='ENOENT')failures.push(error);}
  result??={passed:false,stage:'preparation'};
  result.cleanupSucceeded=failures.length===0;
  if(runError||failures.length)result.passed=false;
  await fs.writeFile(resultPath,JSON.stringify(result,null,2));
 }
 if(failures.length)runError=new AggregateError([...(runError?[runError]:[]),...failures],'Browser devnet cleanup failed');
}
if(runError)throw runError;
process.exit(0);
