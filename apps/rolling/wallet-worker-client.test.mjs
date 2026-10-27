// Real MessageChannel boundary; SDK and Ethereum are not executed by this unit check.
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {createRollingWorkerClient} from './wallet-worker-client.mjs';
import {errorRecord,restoreError} from './wallet-worker-protocol.mjs';
const {port1,port2}=new MessageChannel();port1.start();port2.start();
let stopped=false,guardCalls=0,callbackId=101,submitted=0;
const messages=[],waiters=[];
port2.on('message',message=>{const match=waiters.findIndex(item=>item.accept(message));if(match>=0)waiters.splice(match,1)[0].resolve(message);else messages.push(message);});
function next(accept=()=>true){const i=messages.findIndex(accept);if(i>=0)return Promise.resolve(messages.splice(i,1)[0]);return new Promise(resolve=>waiters.push({accept,resolve}));}
const client=createRollingWorkerClient({worker:{postMessage:value=>port1.postMessage(value),addEventListener:(...args)=>port1.addEventListener(...args),terminate(){stopped=true;port1.close();port2.close();}},contextGuard:()=>{guardCalls++;},captureFundingWallet:async()=>({address:'0x'+'1'.repeat(40),name:'Test',chainId:'31337',guard:async()=>{},signer:{getAddress:async()=>'0x'+'1'.repeat(40),signTypedData:async()=> 'signature',sendTransaction:async()=>{submitted++;return {hash:'0x'+'a'.repeat(64),private:'must not cross'};}}})});
async function answer(promise,value){const call=await next(m=>m.type==='call');port2.postMessage({type:'result',id:call.id,value});return promise;}
await answer(client.initialize({}),{privateFeeCap:'10',ordinaryPostingFeeLimit:'5',bokConfigured:true,fundingEthAvailable:true,usdcAvailable:true});
await answer(client.openAccount({}),{});
assert.equal(client.session,client);assert.equal(client.topup.bok.ethAvailable,true);assert.equal(client.topup.bok.defaultPrivateFeeCap,'10');assert.equal(typeof client.funding.pauseClaim,'function');
const likeRead=client.application.readLikes(['9']);const likeCall=await next(m=>m.type==='call');assert.equal(likeCall.method,'application.readLikes');assert.equal(client.busy,false);port2.postMessage({type:'result',id:likeCall.id,value:{posts:[{post:'9',liked:true}]}});assert.equal((await likeRead).posts[0].liked,true);
let release;const held=new Promise(resolve=>{release=resolve;});
const action=client.application.executeAction({type:'name'},{onPrepared:async()=>{await held;throw new ReferenceError('SECRET');}});action.catch(()=>{});
const call=await next(m=>m.type==='call');assert.notEqual(call.id,callbackId);
port2.postMessage({type:'callback',id:call.id,callbackId,name:'onPrepared',args:[{intentId:'x'}]});
await new Promise(setImmediate);assert.equal(messages.some(m=>m.type==='callback-result'),false);
release();const ack=await next(m=>m.type==='callback-result');assert.equal(ack.id,callbackId);assert.equal(ack.error.name,'ReferenceError');assert(!JSON.stringify(ack).includes('SECRET'));
port2.postMessage({type:'result',id:call.id,error:ack.error});await assert.rejects(action,ReferenceError);
const payment=client.funding.confirm({onSubmitted(){throw Error('presentation');}});const confirm=await next(m=>m.type==='call');port2.postMessage({type:'callback',id:confirm.id,name:'onSubmitted',args:[]});port2.postMessage({type:'result',id:confirm.id,value:{confirmed:true}});assert.deepEqual(await payment,{confirmed:true});assert.equal(stopped,false);
port2.postMessage({type:'custody',id:501,method:'capture',args:[]});const capture=await next(m=>m.type==='custody-result');assert(capture.value.token);
port2.postMessage({type:'custody',id:502,method:'sendTransaction',token:capture.value.token,args:[{to:'0x'+'2'.repeat(40)}]});const sent=await next(m=>m.type==='custody-result');assert.deepEqual(sent.value,{hash:'0x'+'a'.repeat(64)});assert.equal(submitted,1);assert(guardCalls>0);
const controller=new AbortController();const observation=client.withdrawal.waitUntilReady({signal:controller.signal});observation.catch(()=>{});const waiting=await next(m=>m.type==='call');assert.equal(waiting.signal,true);assert.equal(client.busy,false);controller.abort();assert.equal((await next(m=>m.type==='abort')).id,waiting.id);port2.postMessage({type:'result',id:waiting.id,error:{name:'Error',code:'ROLLING_ABORTED'}});await assert.rejects(observation,{code:'ROLLING_ABORTED'});
const restored=restoreError(errorRecord(new AggregateError([new ReferenceError('SECRET')],'SECRET')));assert(restored instanceof AggregateError);assert(restored.errors[0] instanceof ReferenceError);assert(!JSON.stringify(errorRecord(restored)).includes('SECRET'));
assert.equal(client.topup['private-fee'].ethAvailable,true);assert.equal(client.topup['private-fee'].usdcAvailable,true);assert.equal(client.topup.bok.ethAvailable,true);client.terminate();assert(stopped);console.log('PASS actual MessageChannel: distinct callback IDs + held/rejected preparation, presentation isolation, exact custody hash, abort/nonblocking observation, safe real error kinds, metadata, termination');
