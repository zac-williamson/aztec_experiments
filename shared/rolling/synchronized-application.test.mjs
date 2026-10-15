// Installed operation queue, controlled block store and notes: no real-chain acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationQueue} from '../../node_modules/@aztec-labs/pxe/dest/operation_queue.js';
import {createSynchronizedRollingApplication} from './synchronized-application.mjs';
const names=['readBokAccounting','readBalances','readWithdrawal','readModeratorStatus','readBokStatus','prepareBokPost','prepareBokRelease','readAccountStatus','readPreferenceHead','readProfile','ownedIdentities','prepare','submitPrepared','cancelPrepared','reconcile','inspectRecovery','prepareReplacement','prepareInterrupted','resumeSaved'];
test('explicit synchronization exposes a newly included name through the actual autoSync:false SDK queue',async()=>{
 let anchor=14,head=14,closed=0,syncs=0;
 const synchronizer={sync:async()=>{syncs++;anchor=head;}};
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop:()=>closed++})},synchronizer,
  anchorBlockStore:{getBlockHeader:async()=>({number:anchor})},contributors:[],
  stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort:()=>{}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 try{
  const raw=Object.fromEntries(names.map(name=>[name,()=>queue.runSynced(({anchorBlockHeader})=>({identities:anchorBlockHeader.number>=15?['registered-name']:[]}))]));
  head=15;assert.deepEqual((await raw.ownedIdentities()).identities,[]);
  const application=createSynchronizedRollingApplication({application:raw,synchronize:()=>queue.run(()=>synchronizer.sync()),contextGuard:()=>{}});
  assert.deepEqual((await application.ownedIdentities()).identities,['registered-name']);assert.equal(syncs,1);assert.equal(closed,2);
 }finally{await queue.stop();}
});
test('failed synchronization and context changes prevent every private operation without retry',async()=>{
 for(const name of names)for(const failure of ['before','sync','after']){
  let guards=0,syncs=0,calls=0;const error=Error(failure);
  const application=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(n=>[n,()=>{calls++;}])),
   contextGuard:()=>{guards++;if(failure==='before'||failure==='after'&&guards===2)throw error;},
   synchronize:()=>{syncs++;if(failure==='sync')throw error;}});
  await assert.rejects(application[name](...(name==='resumeSaved'?['intent',{expectedTxHash:'0x'+'11'.repeat(32)}]:name==='prepareBokRelease'?['intent',{type:'cancel-bok-request'}]:[])),value=>value===error);assert.equal(calls,0);assert.equal(syncs,failure==='before'?0:1);
 }
});
test('capabilities and method receivers are captured before asynchronous synchronization',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),order=[];
 const raw=Object.fromEntries(names.map(name=>[name,function(...args){assert.equal(this,raw);order.push('call');return args;}]));
 const options={application:raw,contextGuard:()=>order.push('guard'),synchronize:()=>{order.push('sync');return gate;}};
 const application=createSynchronizedRollingApplication(options),pending=application.prepare('exact-intent');
 await Promise.resolve();raw.prepare=()=>assert.fail('replacement');options.contextGuard=()=>assert.fail('replacement');options.synchronize=()=>assert.fail('replacement');
 release();assert.deepEqual(await pending,['exact-intent']);assert.deepEqual(order,['guard','sync','guard','call']);assert(Object.isFrozen(application));
});
test('preference head observes the synchronized anchor through the supported operation queue',async()=>{
 let anchor=14,head=15,syncs=0,reads=0;
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},
  anchorBlockStore:{getBlockHeader:async()=>({number:anchor})},contributors:[],
  stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort:()=>{}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 try{
  const raw=Object.fromEntries(names.map(name=>[name,()=>{}]));
  raw.readPreferenceHead=()=>queue.runSynced(({anchorBlockHeader})=>{reads++;return {initialized:true,schema:1,revision:anchorBlockHeader.number>=15?'2':'1',digest:anchorBlockHeader.number>=15?'22':'11'};});
  const application=createSynchronizedRollingApplication({application:raw,synchronize:()=>queue.run(()=>{syncs++;anchor=head;}),contextGuard:()=>{}});
  assert.equal((await raw.readPreferenceHead()).revision,'1');assert.equal((await application.readPreferenceHead()).revision,'2');
  assert.equal(reads,2);assert.equal(syncs,1);
 }finally{await queue.stop();}
});

test('saved resume options are captured before synchronization without invoking accessors',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),hash='0x'+'11'.repeat(32),input={expectedTxHash:hash};
 const raw=Object.fromEntries(names.map(name=>[name,(...args)=>args]));
 const application=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},synchronize:()=>gate});
 const pending=application.resumeSaved('intent',input);await Promise.resolve();input.expectedTxHash='0x'+'22'.repeat(32);release();
 assert.deepEqual(await pending,['intent',{expectedTxHash:hash}]);
 let reads=0,calls=0;const guarded=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{calls++;},synchronize:()=>{calls++;}});
 await assert.rejects(guarded.resumeSaved('intent',{get expectedTxHash(){reads++;throw Error('PRIVATE_SENTINEL');}}),{code:'ROLLING_INVALID_ACTION'});
 assert.equal(reads,0);assert.equal(calls,0);
});
test('RC22 balance cursor is captured before synchronization and accessor input is never evaluated',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),input={cursor:'original-page'};
 const raw=Object.fromEntries(names.map(name=>[name,(...args)=>args]));const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},synchronize:()=>gate});
 const pending=app.readBalances(input);input.cursor='replacement';release();assert.deepEqual(await pending,[{cursor:'original-page'}]);
 let reads=0;await assert.rejects(app.readBalances({get cursor(){reads++;return 0;}}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});assert.equal(reads,0);
});

test('interrupted Bok release captures exact id and action before synchronization without getters or extra fields',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),input={type:'cancel-bok-request'};
 const raw=Object.fromEntries(names.map(name=>[name,(...args)=>args]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},synchronize:()=>gate});
 const pending=app.prepareBokRelease('original-intent',input);input.type='expire-bok-request';release();
 assert.deepEqual(await pending,['original-intent',{type:'cancel-bok-request'}]);
 let reads=0,syncs=0;const guarded=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{syncs++;},synchronize:()=>{syncs++;}});
 for(const bad of [{get type(){reads++;return 'cancel-bok-request';}},{type:'expire-bok-request',requestId:'other'},{type:'post'},Object.create({type:'cancel-bok-request'})])await assert.rejects(guarded.prepareBokRelease('original-intent',bad),{code:'ROLLING_INVALID_ACTION'});
 assert.equal(reads,0);assert.equal(syncs,0);
});
