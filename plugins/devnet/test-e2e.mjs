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
import {packText,handleField,fetchDescriptor} from '../protocol.mjs';
const directory=await fs.mkdtemp(path.resolve('.build/plugin-e2e-'));
let fixture,service,runs=0;
const timer=setTimeout(()=>{console.error('Plugin E2E exceeded 540 seconds');process.exit(1);},540000);
try{
 fixture=await bootstrapPluginDevnet({directory,proofs:process.env.PLUGIN_PROOFS==='true',onProgress:step=>console.log('STEP',step)});
 const {board,wallet,author,chain,descriptor,signer}=fixture;
 service=await runHostedService({config:fixture.serviceConfig,runner:{run:async request=>{runs++;assert.equal(request.text,'@bok explain this board');return {replyText:'This board uses Ethereum collateral and Aztec posts.'};}}});
 const text='@bok explain this board',packed=packText(text),nonce=Fr.random();
 const postId=await poseidon2HashWithSeparator([Fr.ONE,board.address.toField(),nonce],0x42420102);
 console.log('STEP ordinary private plugin post');
 await board.methods.post_with_plugin(chain,nonce,packed.fields.map(x=>Fr.fromString(x)),packed.length,null,null,Fr.fromString(handleField('bok'))).send({from:author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 console.log('STEP Ethereum plugin payment');
 await payForInvocation({descriptor,postId:postId.toString(),text,signer});
 const deadline=Date.now()+120000;let reply;
 while(Date.now()<deadline){const value=(await board.methods.get_plugin_request(postId).simulate({from:author.address})).result;reply=value[2];if(BigInt(reply)!==0n)break;await new Promise(resolve=>setTimeout(resolve,1000));}
 assert(reply!==undefined&&BigInt(reply)!==0n,'Bot reply missing');assert.equal(runs,1);
 console.log('STEP censor bot reply');
 const version=(await board.methods.get_policy_version().simulate({from:author.address})).result;
 const reason=packText('Test moderation',7);
 await board.methods.declare_immoral(reply,version,reason.fields.map(x=>Fr.fromString(x)),reason.length).send({from:author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}});
 assert.equal((await board.methods.is_post_flagged(reply).simulate({from:author.address})).result,true);
 console.log('PASS Ethereum payment → hosted worker → authenticated board reply → censor');
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({passed:true,applicationProofs:process.env.PLUGIN_PROOFS==='true',liveModel:false,postId:postId.toString(),replyId:reply.toString()}));
}finally{try{await service?.close();}finally{try{await fixture?.close();}finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();clearTimeout(timer);}}}

// The SDK may retain process-global polling timers after its owned services stop.
// This executable has completed all awaited cleanup before terminating.
process.exit(0);
