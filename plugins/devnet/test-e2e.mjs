import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import {TxStatus} from '@aztec/stdlib/tx';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Fr} from '@aztec/foundation/curves/bn254';
import {poseidon2HashWithSeparator} from '@aztec/foundation/crypto/poseidon';
import {bootstrapPluginDevnet} from './bootstrap.mjs';
import {runHostedService} from '../main.mjs';
import {payForInvocation} from '../ethereum.mjs';
import {packText,unpackText,handleField} from '../protocol.mjs';
import {githubApi} from '../github-tools.mjs';
import {veniceClient} from '../venice.mjs';
const live=process.argv.includes('--live');
const readPrArgument=process.argv.find(x=>x.startsWith('--read-pr='));
const readPr=readPrArgument?Number(readPrArgument.split('=')[1]):null;
if(readPrArgument&&(!live||!Number.isSafeInteger(readPr)||readPr<1))throw Error('--read-pr requires --live and a positive PR number');
const selectedModel=process.env.PLUGIN_E2E_MODEL||'kimi-k2-5';
if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(selectedModel))throw Error('Invalid E2E model');
if(live&&(!process.env.VENICE_WALLET_PRIVATE_KEY||!process.env.GITHUB_TOKEN||(!readPr&&process.env.PLUGIN_GITHUB_WRITES!=='true')))throw Error('Live E2E requires the Venice wallet, GitHub token and explicit GitHub writes for PR creation');
const directory=await fs.mkdtemp(path.resolve('.build/plugin-e2e-'));
let fixture,service,runs=0,workerError,runError;
const evidence={passed:false,liveModel:live,selectedModel,readPr,applicationProofs:process.env.PLUGIN_PROOFS==='true'};
const timer=setTimeout(()=>{console.error('Plugin E2E exceeded 540 seconds');process.exit(1);},540000);
try{
 if(live){
   const provider=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY});
   evidence.veniceBefore=await provider.json('/api/v1/x402/transactions/'+provider.address+'?limit=100&offset=0');
 }
 fixture=await bootstrapPluginDevnet({directory,proofs:process.env.PLUGIN_PROOFS==='true',onProgress:step=>console.log('STEP',step)});
 const {board,wallet,author,chain,descriptor,signer}=fixture;
 service=await runHostedService({config:fixture.serviceConfig,env:{...process.env,...(live?{PLUGIN_GITHUB_DRAFT:'true'}:{}),...(readPr?{PLUGIN_GITHUB_WRITES:'false'}:{})},onError:error=>{workerError=error;console.error('WORKER_ERROR',error.message);},...(live?{}:{runner:{run:async request=>{runs++;assert.equal(request.text,'@bok explain this board');return {replyText:'This board uses Ethereum collateral and Aztec posts.'};}}})});
 const task=readPr?`Read PR ${readPr} using read_pr. Reply with its URL, exact changed file path and a short summary. Do not create or change anything.`:'Read README.md. Then create a draft PR adding only docs/bok-live-smoke.md containing a short description of this anonymous message board based on that README. Title the PR "Bok live integration smoke test". In the PR body say this is an automated integration test, not a production change. Do not modify any other file. Reply with the PR URL.';
 const text=live?`@bok --model=${selectedModel} ${task}`:'@bok explain this board';
 const packed=packText(text),nonce=Fr.random();
 const postId=await poseidon2HashWithSeparator([Fr.ONE,board.address.toField(),nonce],0x42420102);
 console.log('STEP ordinary private plugin post');
 await board.methods.post_with_plugin(chain,nonce,packed.fields.map(x=>Fr.fromString(x)),packed.length,null,null,Fr.fromString(handleField('bok'))).send({from:author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 console.log('STEP Ethereum plugin payment');
 evidence.postId=postId.toString();
 evidence.payment=await payForInvocation({descriptor,postId:postId.toString(),text,signer});
 const deadline=Date.now()+(live?240000:120000);let reply;
 while(Date.now()<deadline){if(workerError)throw workerError;const value=(await board.methods.get_plugin_request(postId).simulate({from:author.address})).result;reply=value[2];if(BigInt(reply)!==0n)break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert(reply!==undefined&&BigInt(reply)!==0n,'Bot reply missing');if(!live)assert.equal(runs,1);
 evidence.replyId=reply.toString();
 const fields=(await board.methods.get_post(reply).simulate({from:author.address})).result;
 const length=(await board.methods.get_post_length(reply).simulate({from:author.address})).result;
 evidence.replyText=unpackText(fields.map(String),Number(length));
 console.log('BOT_REPLY',evidence.replyText);
 if(live){
   const repository=process.env.PLUGIN_REPOSITORY||fixture.serviceConfig.repository;
   const url=evidence.replyText.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/)?.[0];
   assert(url?.startsWith('https://github.com/'+repository+'/pull/'),'Reply must link a real PR in the configured repository');
   const api=githubApi({token:process.env.GITHUB_TOKEN}),number=Number(url.split('/').at(-1));
   evidence.prUrl=url;
   const pr=await api('GET',`/repos/${repository}/pulls/${number}`);
   assert.equal(pr.draft,true);assert.equal(pr.merged,false);
   if(readPr){assert.equal(number,readPr);assert(evidence.replyText.includes('docs/bok-live-smoke.md'));}
   else assert.equal(pr.head.ref,'bok/'+postId.toString().slice(2));
   const files=await api('GET',`/repos/${repository}/pulls/${number}/files`);
   assert.deepEqual(files.map(x=>x.filename),['docs/bok-live-smoke.md']);assert(files[0].additions>0);
   evidence.prHead=pr.head.sha;
   const provider=veniceClient({privateKey:process.env.VENICE_WALLET_PRIVATE_KEY});
   evidence.veniceLedger=await provider.json('/api/v1/x402/transactions/'+provider.address+'?limit=20&offset=0');
   const priorIds=new Set(evidence.veniceBefore.data.transactions.map(x=>x.id));
   evidence.newVeniceCharges=evidence.veniceLedger.data.transactions.filter(x=>!priorIds.has(x.id)&&x.type==='CHARGE');
   assert(evidence.newVeniceCharges.length>0,'Live run must incur actual provider charges');
   assert(evidence.newVeniceCharges.every(x=>x.modelId===selectedModel),'Every provider charge must use the selected model');
   console.log('VERIFIED_PR',url);
 }
 console.log('STEP censor bot reply');
 const version=(await board.methods.get_policy_version().simulate({from:author.address})).result;
 const reason=packText('Test moderation',7);
 await board.methods.declare_immoral(reply,version,reason.fields.map(x=>Fr.fromString(x)),reason.length).send({from:author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 assert.equal((await board.methods.is_post_flagged(reply).simulate({from:author.address})).result,true);
 console.log('PASS Ethereum payment → hosted worker → authenticated board reply → censor');
 evidence.passed=true;evidence.censored=true;
 console.log('EVIDENCE',path.join(directory,'result.json'));
}catch(error){runError=error;evidence.error=error.message;
}finally{
 const errors=[];
 for(const stop of [()=>service?.close(),()=>fixture?.close(),()=>Barretenberg.destroySingleton(),()=>BarretenbergSync.destroySingleton()]){
   try{await stop();}catch(error){errors.push(error);}
 }
 clearTimeout(timer);
 evidence.cleanupSucceeded=errors.length===0;
 if(errors.length){evidence.passed=false;evidence.cleanupErrors=errors.map(x=>x.message);runError=new AggregateError([...(runError?[runError]:[]),...errors],'E2E cleanup failed');}
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(evidence,null,2));
}
if(runError)throw runError;

// The SDK may retain process-global polling timers after its owned services stop.
// This executable has completed all awaited cleanup before terminating.
process.exit(0);
