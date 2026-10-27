// Installed operation queue, controlled block store and notes: no real-chain acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationQueue} from '../../node_modules/@aztec-labs/pxe/dest/operation_queue.js';
import {createSynchronizedRollingApplication} from './synchronized-application.mjs';
const names=['readFundingState','readWithdrawalReadiness','readBokAccounting','readBalances','readWithdrawal','readModeratorStatus','readBokStatus','readPrivateFeeCredit','prepareBokPost','prepareBokRelease','readAccountStatus','readProfile','ownedIdentities','prepare','submitPrepared','cancelPrepared','reconcile','inspectRecovery','prepareReplacement','prepareInterrupted','resumeSaved'];
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
 for(const name of names.filter(name=>name!=='readModeratorStatus'))for(const failure of ['before','sync','after']){
  let guards=0,syncs=0,calls=0;const error=Error(failure);
  const application=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(n=>[n,options=>{if(n==='readFundingState'&&options?.beforeSync)return null;calls++;}])),
   contextGuard:()=>{guards++;if(failure==='before'||failure==='after'&&guards===2)throw error;},
   synchronize:()=>{syncs++;if(failure==='sync')throw error;}});
  await assert.rejects(application[name](...(name==='resumeSaved'?['intent',{expectedTxHash:'0x'+'11'.repeat(32)}]:name==='prepareBokRelease'?['intent',{type:'cancel-bok-request'}]:[])),value=>value===error);assert.equal(calls,0);assert.equal(syncs,failure==='before'||name==='readFundingState'&&failure==='after'?0:1);
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
test('profile state observes the synchronized anchor through the supported operation queue',async()=>{
 let anchor=14,head=15,syncs=0,reads=0;
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},
  anchorBlockStore:{getBlockHeader:async()=>({number:anchor})},contributors:[],
  stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort:()=>{}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 try{
  const raw=Object.fromEntries(names.map(name=>[name,()=>{}]));
  raw.readProfile=()=>queue.runSynced(({anchorBlockHeader})=>{reads++;return {version:anchorBlockHeader.number>=15?'2':'1'};});
  const application=createSynchronizedRollingApplication({application:raw,synchronize:()=>queue.run(()=>{syncs++;anchor=head;}),contextGuard:()=>{}});
  assert.equal((await raw.readProfile()).version,'1');assert.equal((await application.readProfile()).version,'2');
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

test('one flow reuses its anchor and refreshes after its own confirmed transaction',async()=>{
 let scope={synchronized:false},syncs=0,guards=0,calls=0;
 const raw=Object.fromEntries(names.map(name=>[name,async()=>{calls++;return {status:name==='submitPrepared'?'confirmed':'prepared'};}]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{guards++;},synchronize:()=>{syncs++;},operationScope:()=>scope});
 await app.readAccountStatus();await app.prepare({type:'post'});await app.submitPrepared('id');assert.equal(syncs,1);
 await app.readAccountStatus();assert.equal(syncs,2);assert.equal(calls,4);assert.equal(guards,8);
 scope={synchronized:false};await app.readAccountStatus();assert.equal(syncs,3);
});
test('public moderator identity does not synchronize private state',async()=>{
 const raw=Object.fromEntries(names.map(name=>[name,async()=>({authorized:true})]));let guards=0;
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{guards++;},synchronize:()=>assert.fail('public identity has no private anchor')});
 assert.deepEqual(await app.readModeratorStatus(),{authorized:true});assert.equal(guards,2);
});

for(const failure of [null,'sync','context'])test(`parallel readiness and synchronization ${failure??'succeed'} drain before private application`,async()=>{
 const scope={},gates=[Promise.withResolvers(),Promise.withResolvers()],entered=Promise.withResolvers(),error=Error('Exact failure');let started=0,calls=0,settled=false;
 const work=index=>async()=>{if(++started===2)entered.resolve();await gates[index].promise;if((failure==='sync'?0:failure==='context'?1:-1)===index)throw error;};
 const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,()=>{calls++;return 'ready';}])),contextGuard:()=>{},operationScope:()=>scope,synchronize:work(0),prepareContext:work(1)});
 const result=app.prepare({type:'post'}).finally(()=>{settled=true;});const observed=failure?assert.rejects(result,e=>e===error):result;
 await entered.promise;assert.equal(started,2);assert.equal(calls,0);
 gates[failure==='context'?1:0].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);assert.equal(scope.synchronized,undefined);
 gates[0].resolve();gates[1].resolve();await observed;assert.equal(calls,failure?0:1);assert.equal(scope.synchronized,failure?undefined:true);
});
test('prefetched readiness is scoped to the held operation and replacement ownership rejects before application',async()=>{
 let scope={},contexts=0,syncs=0,calls=0;const gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const raw=Object.fromEntries(names.map(name=>[name,()=>{calls++;}]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:async()=>{syncs++;},prepareContext:async()=>{contexts++;if(contexts===2){entered.resolve();await gate.promise;}}});
 await app.prepare({type:'post'});await app.prepare({type:'post'});assert.equal(contexts,1);assert.equal(syncs,1);
 scope={};const pending=app.prepare({type:'post'});await entered.promise;scope={};gate.resolve();await assert.rejects(pending,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(calls,2);assert.equal(scope.synchronized,undefined);
});

test('only new preparation requests an overlapping predecessor observation',async()=>{
 const seen=[];let scope={};const raw=Object.fromEntries(names.map(name=>[name,()=>({})]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:()=>{},prepareContext:options=>seen.push(options)});
 await app.prepare({type:'post'});scope={};await app.submitPrepared('id');scope={};await app.readAccountStatus();
 assert.deepEqual(seen,[{predecessor:true},{predecessor:false},{predecessor:false}]);
});
test('only one-click ordinary posting starts payment metadata during synchronization',async()=>{
 const seen=[];let scope={preparationReads:[]};const raw=Object.fromEntries(names.map(name=>[name,()=>({})]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:()=>{},prepareContext:options=>seen.push(options)});
 await app.prepare({type:'post'},{immediate:true});scope={preparationReads:[]};await app.prepare({type:'bok'},{immediate:true});scope={};await app.prepare({type:'post'},{immediate:true});
 assert.deepEqual(seen,[{predecessor:true,ordinaryPayment:true},{predecessor:true},{predecessor:true}]);
});

test('captured policy read is requested only for synchronized ordinary main-board preparation',async()=>{
 for(const [input,options,wanted] of [
  [{type:'post'},{immediate:true},true],[{type:'reply',subboard:'0'},{immediate:true},true],
  [{type:'quote',subboard:'0x'+'0'.repeat(64)},{immediate:true},true],
  [{type:'repost',subboard:'2'},{immediate:true},false],[{type:'bok'},{immediate:true},false],
  [{type:'post'},undefined,false],[{type:'like'},{immediate:true},false],
 ]){
  const scope={},seen=[],raw=Object.fromEntries(names.map(name=>[name,()=>{}]));
  const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:options=>seen.push(options)});
  await app.prepare(input,options);assert.deepEqual(seen,[{ordinaryPolicy:wanted,ordinaryPost:Boolean(scope)&&options?.immediate===true&&['post','reply','quote','repost'].includes(input.type),...(options?.immediate===true&&['like','unlike'].includes(input.type)?{snapshotAncestry:true}:{})}]);
 }
});

const genericBoardActions={like:'set_like',unlike:'set_like',name:'register_name',bio:'set_bio',avatar:'set_avatar',subboard:'create_subboard','moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy','transfer-moderator':'transfer_moderator',screen:'screen',withdraw:'withdraw'};
test('known generic actions prepare exact native methods after sync; other financial/Bok/post paths remain separate',async()=>{
 for(const type of [...Object.keys(genericBoardActions),'bok','claim-bok','claim-deposit','cancel-deposit','withdraw-bok','cancel-bok-request','expire-bok-request','post']){
  const seen=[],scope={};const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,()=>seen.push('action')])),operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>seen.push('sync'),prepareContractState:({method})=>seen.push(method)});
  await app.prepare({type});assert.deepEqual(seen,genericBoardActions[type]?['sync',genericBoardActions[type],'action']:['sync','action']);
 }
});
test('already synchronized profile context still prepares Board state without duplicate global sync',async()=>{
 const seen=[],scope={};const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,()=>seen.push(name)])),operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>seen.push('sync'),prepareContractState:({method})=>seen.push(method)});
 await app.readProfile();await app.prepare({type:'bio'});assert.deepEqual(seen,['sync','readProfile','set_bio','prepare']);
});
for(const fail of ['discovery','scope'])test('generic preparation '+fail+' failure cannot enter application or release early',async()=>{
 const gate=Promise.withResolvers(),entered=Promise.withResolvers(),error=Error('discovery failed');let scope={},calls=0,done=false;
 const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,()=>calls++])),operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>{},prepareContractState:async()=>{entered.resolve();await gate.promise;if(fail==='discovery')throw error;}});
 const observed=assert.rejects(app.prepare({type:'like'}).finally(()=>done=true),fail==='discovery'?e=>e===error:{code:'ROLLING_CONTEXT_CHANGED'});await entered.promise;assert.equal(done,false);if(fail==='scope')scope={};gate.resolve();await observed;assert.equal(calls,0);
});


test('held immediate actions start only their corresponding fee metadata alongside native synchronization',async()=>{
 for(const type of ['like','unlike','bio','avatar','name','subboard','moderate-post'])for(const immediate of [false,true]){
  let seen;const scope={preparationReads:[]},gate=Promise.withResolvers(),entered=Promise.withResolvers();let stages=0,called=false;
  const arrive=async()=>{if(++stages===2)entered.resolve();await gate.promise;};
  const raw=Object.fromEntries(names.map(name=>[name,()=>{called=true;return {};} ]));
  const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:arrive,prepareContext:async options=>{seen=options;await arrive();}});
  const work=app.prepare({type},immediate?{immediate:true}:undefined);await entered.promise;assert.equal(called,false);assert.equal(seen.likePayment,immediate&&['like','unlike'].includes(type)?true:undefined);assert.equal(seen.deferredPayment,immediate&&['name','bio','avatar','subboard'].includes(type)?true:undefined);gate.resolve();await work;assert.equal(called,true);
 }
});

test('balances capture the optional Bok selection before the first context await; accounting remains cursor-only',async()=>{
 const gate=Promise.withResolvers();let guards=0;
 const raw=Object.fromEntries(names.map(name=>[name,(...args)=>args]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{if(++guards===1)return gate.promise;},synchronize:()=>{}});
 const input={cursor:0,includeBok:true},pending=app.readBalances(input);
 input.cursor='changed';input.includeBok=false;gate.resolve();
 assert.deepEqual(await pending,[{cursor:0,includeBok:true}]);
 assert.deepEqual(await app.readBalances({cursor:'page',includeBok:false}),[{cursor:'page',includeBok:false}]);
 for(const method of ['readBalances','readBokAccounting']){
  assert.deepEqual(await app[method](),[{cursor:0}]);
  assert.deepEqual(await app[method]({cursor:'page'}),[{cursor:'page'}]);
 }
 await assert.rejects(app.readBokAccounting({cursor:0,includeBok:true}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
});
test('invalid Bok balance options are rejected without accessors, synchronization or application calls',async()=>{
 let reads=0,calls=0;
 const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,()=>calls++])),contextGuard:()=>calls++,synchronize:()=>calls++});
 for(const input of [
  {cursor:0,get includeBok(){reads++;return true;}},
  {get cursor(){reads++;return 0;},includeBok:true},
  ...[undefined,null,0,1,'true',{}].map(includeBok=>({cursor:0,includeBok})),
  {includeBok:true},{cursor:0,includeBok:true,extra:1},
  {cursor:0,includeBok:true,[Symbol('extra')]:1},Object.assign(Object.create({includeBok:true}),{cursor:0}),
 ])await assert.rejects(app.readBalances(input),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
 for(const includeBok of [true,false])await assert.rejects(app.readBokAccounting({cursor:0,includeBok}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
 await assert.rejects(app.readBalances({cursor:0,includeBok:true},{}),{code:'ROLLING_BALANCE_CURSOR_INVALID'});
 assert.equal(reads,0);assert.equal(calls,0);
});

// The exported action entry still uses the native queue for retained actions.
import {executeRollingAction} from '../../apps/rolling/wallet-action.mjs';
test('immediate like prepares native state once and refreshes its anchor after inclusion',async()=>{
 let anchor=14,head=15,syncs=0,submitted=0;const discovered=[],scope={preparationReads:[]};
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},anchorBlockStore:{getBlockHeader:async()=>({number:anchor})},contributors:[],stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort:()=>{}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 try{
  const raw=Object.fromEntries(names.map(name=>[name,()=>assert.fail('unexpected '+name)]));
  raw.prepare=(action,options)=>queue.runSynced(({anchorBlockHeader})=>{assert.equal(action.type,'like');assert.equal(anchorBlockHeader.number,head);assert.deepEqual(options,{immediate:true});return {intentId:'exact'};});
  raw.submitPrepared=id=>{assert.equal(id,'exact');submitted++;return {status:'included'};};
  const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>queue.run(()=>{syncs++;anchor=head;}),prepareContractState:({method})=>queue.runSynced(({anchorBlockHeader})=>{assert.equal(method,'set_like');discovered.push(anchorBlockHeader.number);})});
  assert.equal(app.readPreferenceHead,undefined);assert.deepEqual(await executeRollingAction(app,{type:'like',post:'42'}),{status:'included'});
  assert.equal(scope.synchronized,false);assert.equal(syncs,1);assert.equal(submitted,1);assert.deepEqual(discovered,[15]);
  head=16;await app.prepare({type:'like',post:'42'},{immediate:true});assert.equal(syncs,2);assert.deepEqual(discovered,[15,16]);
 }finally{await queue.stop();}
});

for(const fail of ['sync','context'])test(`like initial ${fail} failure drains its sibling before native action work`,async()=>{
 const gates=[Promise.withResolvers(),Promise.withResolvers()],entered=Promise.withResolvers(),failure=Error(fail);let starts=0,calls=0,done=false;
 const work=index=>async()=>{if(++starts===2)entered.resolve();await gates[index].promise;if(index===(fail==='sync'?0:1))throw failure;};
 const scope={preparationReads:[]},raw=Object.fromEntries(names.map(name=>[name,()=>calls++]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:work(0),prepareContext:work(1),prepareContractState:()=>calls++});
 const pending=assert.rejects(executeRollingAction(app,{type:'like',post:'42'}).finally(()=>done=true),error=>error===failure);
 await entered.promise;gates[fail==='sync'?0:1].resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(done,false);assert.equal(calls,0);
 gates.forEach(g=>g.resolve());await pending;assert.equal(calls,0);assert.equal(scope.synchronized,undefined);
});

for(const fail of ['scope','discovery'])test(`initial like ${fail} change prevents intent creation`,async()=>{
 const entered=Promise.withResolvers(),gate=Promise.withResolvers(),failure=Error('discovery');let scope={preparationReads:[]},predecessorStarts=0,intentWrites=0;
 const raw=Object.fromEntries(names.map(name=>[name,()=>assert.fail('unexpected '+name)]));
 raw.prepare=async()=>{
  const owner=scope,ready=owner.contractStateReady;predecessorStarts++;
  await ready;if(scope!==owner||owner.contractStateReady!==ready)throw Object.assign(Error('changed'),{code:'ROLLING_CONTEXT_CHANGED'});
  intentWrites++;return {intentId:'new-intent'};
 };
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>{},prepareContext:()=>{},prepareContractState:async()=>{entered.resolve();await gate.promise;if(fail==='discovery')throw failure;}});
 const pending=assert.rejects(executeRollingAction(app,{type:'like',post:'42'}),fail==='scope'?{code:'ROLLING_CONTEXT_CHANGED'}:error=>error===failure);
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(predecessorStarts,1);assert.equal(intentWrites,0);
 if(fail==='scope')scope={preparationReads:[]};gate.resolve();await pending;assert.equal(intentWrites,0);
});


test('empty funding workflow does not qualify a native snapshot and the next preparation still synchronizes',async()=>{
 const scope={},calls=[];let syncs=0,contexts=0;
 const raw=Object.fromEntries(names.map(name=>[name,(...args)=>{calls.push([name,...args]);return {status:name==='readFundingState'?'ready':'prepared'};}]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:()=>{syncs++;},prepareContext:()=>{contexts++;}});
 assert.deepEqual(await app.readFundingState(),{status:'ready'});assert.deepEqual(calls,[['readFundingState',{beforeSync:true}]]);
 assert.equal(syncs,0);assert.equal(contexts,0);assert.equal(scope.synchronized,undefined);
 await app.prepare({type:'claim-deposit'});assert.equal(syncs,1);assert.equal(contexts,1);assert.equal(scope.synchronized,true);
});
test('nonempty funding workflow uses the original synchronized read without forwarding the internal probe option',async()=>{
 const scope={},seen=[];const raw=Object.fromEntries(names.map(name=>[name,()=>{}]));
 raw.readFundingState=(...args)=>{seen.push(['read',args,scope.synchronized]);return args.length?null:{status:'recovering'};};
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{},operationScope:()=>scope,synchronize:()=>seen.push(['sync']),prepareContext:()=>seen.push(['context'])});
 assert.deepEqual(await app.readFundingState(),{status:'recovering'});
 assert.deepEqual(seen,[['read',[{beforeSync:true}],undefined],['sync'],['context'],['read',[],true]]);
});
for(const failure of ['probe','context','scope'])test(`empty funding probe rejects ${failure} before exposing readiness`,async()=>{
 let scope={},valid=true;const entered=Promise.withResolvers(),held=Promise.withResolvers(),error=Error('probe failed');
 const raw=Object.fromEntries(names.map(name=>[name,()=>{}]));raw.readFundingState=async()=>{entered.resolve();await held.promise;if(failure==='probe')throw error;return {status:'ready'};};
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{if(!valid)throw error;},synchronize:()=>assert.fail('no native operation from failed empty probe')});
 const pending=app.readFundingState();await entered.promise;if(failure==='context')valid=false;if(failure==='scope')scope={};held.resolve();
 await assert.rejects(pending,failure==='scope'?{code:'ROLLING_CONTEXT_CHANGED'}:e=>e===error);assert.equal(scope.synchronized,undefined);
});
test('funding callers cannot forward an internal empty-only probe through the synchronized public method',async()=>{
 let reads=0;const raw=Object.fromEntries(names.map(name=>[name,()=>{reads++;}]));
 const app=createSynchronizedRollingApplication({application:raw,contextGuard:()=>{reads++;},synchronize:()=>{reads++;}});
 await assert.rejects(app.readFundingState({beforeSync:true}),{code:'ROLLING_INVALID_ACTION'});assert.equal(reads,0);
});

test('opening account status captures exact option before held synchronization',async()=>{
 const entered=Promise.withResolvers(),gate=Promise.withResolvers(),scope={};let seen,calls=0;
 const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,options=>{calls++;seen=options;return 'ready';}])),contextGuard:()=>{},operationScope:()=>scope,synchronize:async()=>{entered.resolve();await gate.promise;}});
 const input={opening:true},work=app.readAccountStatus(input);await entered.promise;input.opening=false;input.extra=true;gate.resolve();assert.equal(await work,'ready');assert.deepEqual(seen,{opening:true});assert.equal(calls,1);
 for(const invalid of [{opening:false},{opening:true,extra:true},null])await assert.rejects(app.readAccountStatus(invalid),{code:'ROLLING_INVALID_ACTION'});
 assert.equal(calls,1);
});

test('only captured opening status requests the public Board sync warmup under its held scope',async()=>{
 for(const kind of ['opening','normal','other','unowned']){
  let scope=kind==='unowned'?null:{},calls=0;const seen=[],held=Promise.withResolvers();
  const raw=Object.fromEntries(names.map(name=>[name,()=>{calls++;}]));
  const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:async options=>{seen.push(options);await held.promise;}});
  const option={opening:true},work=kind==='other'?app.ownedIdentities():kind==='normal'?app.readAccountStatus():app.readAccountStatus(option);option.opening=false;
  await new Promise(r=>setImmediate(r));assert.equal(calls,0);assert.equal(seen[0].accountStatus,kind==='opening'?true:undefined);held.resolve();await work;assert.equal(calls,1);
 }
});
test('opening public sync completion cannot authorize a replaced operation',async()=>{
 let scope={},calls=0;const held=Promise.withResolvers(),raw=Object.fromEntries(names.map(name=>[name,()=>{calls++;}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>held.promise});
 const work=app.readAccountStatus({opening:true});await new Promise(r=>setImmediate(r));scope={};held.resolve();await assert.rejects(work,{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(calls,0);
});

for(const type of ['post','like','unlike','name','bio','avatar','subboard'])for(const failure of ['none','predecessor','discovery','both'])test(type+' discovery overlaps predecessor and drains both before return: '+failure,async()=>{
 const scope={synchronized:false},gate=Promise.withResolvers(),started=Promise.withResolvers();let appStarted=false,settled=false;
 const raw=Object.fromEntries(names.map(name=>[name,async()=>{}]));raw.prepare=async()=>{appStarted=true;started.resolve();if(failure==='predecessor'||failure==='both')throw Error('predecessor failed');await scope.contractStateReady;return 'prepared';};
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>{},prepareContractState:async({method})=>{assert.equal(method,type==='post'?'post':genericBoardActions[type]);assert.equal(scope.synchronized,true);await gate.promise;if(failure==='discovery'||failure==='both')throw Error('discovery failed');}});
 const work=app.prepare({type},{immediate:true});work.then(()=>settled=true,()=>settled=true);const result=failure==='none'?work:assert.rejects(work,failure==='predecessor'?/predecessor failed/:/discovery failed/);
 await started.promise;assert.equal(appStarted,true);await new Promise(r=>setImmediate(r));assert.equal(settled,false);gate.resolve();await result;assert.equal(scope.contractStateReady,undefined);
});

test('captured native header lets predecessor reads start while discovery holds the SDK queue',async()=>{
 let anchor=14,scope={},captured,checks=0;const gate=Promise.withResolvers(),entered=Promise.withResolvers(),predecessor=Promise.withResolvers();
 const queue=new OperationQueue({autoSync:false,node:{startRecording:()=>({stop(){}})},synchronizer:{},anchorBlockStore:{getBlockHeader:async()=>({number:anchor})},contributors:[],stagedWriteCoordinator:{begin:()=>1,commit:async()=>{},abort:()=>{}},log:{debug(){},verbose(){},warn(){}}});queue.start();
 const raw=Object.fromEntries(names.map(name=>[name,async()=>{}]));raw.prepare=async()=>{assert.equal(captured.number,anchor);checks++;predecessor.resolve();await scope.contractStateReady;return 'ready';};
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>queue.run(()=>{anchor++;}),preparePredecessorAnchor:async()=>{captured=await queue.run(()=>({number:anchor}));},prepareContractState:()=>queue.runSynced(async()=>{entered.resolve();await gate.promise;})});
 try{
  const work=app.prepare({type:'like'},{immediate:true});await entered.promise;await predecessor.promise;assert.equal(checks,1);assert.equal(captured.number,15);gate.resolve();assert.equal(await work,'ready');assert.equal(scope.contractStateReady,undefined);
  scope={};await app.prepare({type:'like'},{immediate:true});assert.equal(captured.number,16);assert.equal(checks,2);
 }finally{gate.resolve();await queue.stop();}
});
for(const failure of ['read','scope'])test('failed predecessor header capture prevents discovery and execution: '+failure,async()=>{
 let scope={},calls=0;const raw=Object.fromEntries(names.map(name=>[name,async()=>{calls++;}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:()=>{},preparePredecessorAnchor:async()=>{if(failure==='read')throw Error('header unavailable');scope={};},prepareContractState:async()=>{calls++;}});
 await assert.rejects(app.prepare({type:'like'},{immediate:true}),failure==='read'?/header unavailable/:{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(calls,0);
});

for(const kind of ['names','unowned','other','replaced','failed'])test('owned-name warmup preserves fresh sync and operation fences: '+kind,async()=>{
 let scope=kind==='unowned'?null:{},calls=0;const held=Promise.withResolvers(),seen=[];
 const raw=Object.fromEntries(names.map(name=>[name,()=>{calls++;return 'native result';}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:async options=>{seen.push(options);await held.promise;}});
 const work=kind==='other'?app.readProfile():app.ownedIdentities({cursor:0});
 const result=work.then(value=>({value}),error=>({error}));await new Promise(setImmediate);
 assert.equal(calls,0);assert.equal(seen[0].ownedNames,['names','replaced','failed'].includes(kind)?true:undefined);
 if(kind==='replaced')scope={};if(kind==='failed')held.reject(Error('sync failed'));else held.resolve();
 const out=await result;
 if(kind==='replaced'){assert.equal(out.error.code,'ROLLING_CONTEXT_CHANGED');assert.equal(calls,0);}
 else if(kind==='failed'){assert.match(out.error.message,/sync failed/);assert.equal(calls,0);}
 else{assert.equal(out.value,'native result');assert.equal(calls,1);}
});

test('snapshot ancestry belongs only to an owned immediate Like or Unlike preparation',async()=>{
 for(const type of ['like','unlike','name','bio','post','claim-private-fee'])for(const immediate of [false,true])for(const owned of [false,true]){
  const scope=owned?{}:null,seen=[],raw=Object.fromEntries(names.map(name=>[name,()=>({})]));
  const application=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:options=>seen.push(options)});
  await application.prepare({type},{immediate});
  assert.equal(seen.length,1);assert.equal(seen[0].snapshotAncestry,owned&&immediate&&['like','unlike'].includes(type)?true:undefined);
 }
});


for(const type of ['post','reply','quote','repost','bok'])for(const name of ['0','5'])for(const waits of [0,2])test(`posting readiness preserves fast sync and exact ${type} name=${name}, waits=${waits}`,async()=>{
 const scope={synchronized:false,preparationReads:[]},events=[],syncOptions=[],action={type,name,deposit:'9',subboard:'0',content:'Exact draft',budget:'100000',parent:'10',root:'1'};let checks=0,discoveries=0,prepares=0;
 const raw=Object.fromEntries(names.map(method=>[method,async(...args)=>{if(method==='prepare'){assert.deepEqual(args[0],action);prepares++;events.push('prepare');return {intentId:'one',action:args[0]};}if(method==='submitPrepared'){events.push('send');return {status:'confirmed'};}}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:async options=>{syncOptions.push(options);events.push('sync');},prepareContext:async()=>{},preparePredecessorAnchor:async()=>{},prepareContractState:async({method})=>{assert.equal(method,'post');discoveries++;events.push('discovery');},beforePostingPrepare:async exact=>{
  assert.deepEqual(exact,action);assert.equal(prepares,0);assert.equal(scope.synchronized,true);events.push('check');
  if(type!=='bok')assert.equal(discoveries,checks+1);
  if(checks++<waits){scope.synchronized=false;events.push('chain-advanced');return false;}return true;
 }});
 const prepared=await app.prepare(action,{immediate:true});events.push('onPrepared');await app.submitPrepared(prepared.intentId);
 assert.equal(checks,waits+1);assert.equal(syncOptions.length,waits+1);assert.equal(discoveries,type==='bok'?0:waits+1);assert.equal(prepares,1);
 for(const options of syncOptions){assert.equal(options.ordinaryPost,type!=='bok');assert.equal(options.ordinaryPolicy,type!=='bok');}
 assert.deepEqual(events.slice(-3),['prepare','onPrepared','send']);
});
for(const reason of ['account changed','aborted','read failed'])test('posting readiness '+reason+' prevents intent creation and submit',async()=>{
 const scope={synchronized:false};let calls=0;const failure=Error(reason);
 const raw=Object.fromEntries(names.map(name=>[name,async()=>{calls++;}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:async()=>{},prepareContractState:async()=>{},beforePostingPrepare:async()=>{throw failure;}});
 await assert.rejects(app.prepare({type:'post',deposit:'9'},{immediate:true}),error=>error===failure);assert.equal(calls,0);assert.equal(scope.contractStateReady,undefined);
});
test('posting readiness cannot request a fresh pass without invalidating its held anchor',async()=>{
 const scope={synchronized:false};let calls=0;const raw=Object.fromEntries(names.map(name=>[name,async()=>{calls++;}]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},synchronize:async()=>{},prepareContractState:async()=>{},beforePostingPrepare:async()=>false});
 await assert.rejects(app.prepare({type:'post',deposit:'9'},{immediate:true}),{code:'ROLLING_CONTEXT_CHANGED'});assert.equal(calls,0);
});

test('atomic thread uses generic discovery and posting readiness before one preparation',async()=>{
 const seen=[],scope={},raw=Object.fromEntries(names.map(name=>[name,()=>seen.push('action')]));
 const app=createSynchronizedRollingApplication({application:raw,operationScope:()=>scope,contextGuard:()=>{},
  synchronize:options=>{assert.equal(options.ordinaryPost,false);assert.equal(options.ordinaryPolicy,false);seen.push('sync');},
  prepareContext:options=>{assert.equal(options.ordinaryPayment,undefined);assert.equal(options.likePayment,undefined);},
  prepareContractState:({method})=>{assert.equal(method,'post_thread');seen.push('discovery');},
  beforePostingPrepare:action=>{assert.equal(action.contents.length,2);seen.push('readiness');return true;}});
 await app.prepare({type:'thread',deposit:'1',contents:['first','second']},{immediate:true});
 assert.deepEqual(seen,['sync','discovery','readiness','action']);
});

test('thread content and Bok budgets are captured before synchronization yields',async()=>{
 const gate=Promise.withResolvers(),input={type:'thread',deposit:'1',contents:['first','second'],budgets:['0','250000']};
 const app=createSynchronizedRollingApplication({application:Object.fromEntries(names.map(name=>[name,value=>value])),contextGuard:()=>gate.promise,synchronize:()=>{}});
 const pending=app.prepare(input);input.contents[0]='changed';input.budgets[1]='0';gate.resolve();
 assert.deepEqual(await pending,{type:'thread',deposit:'1',contents:['first','second'],budgets:['0','250000']});
});
