import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceJson} from './private-bok-fixture.mjs';

test('fixture evidence crosses strict worker JSON boundary without losing token precision or cleanup', () => {
  const amount = (1n << 128n) - 1n;
  const observation = {passed: true, l1: [{gasUsed: 542500n, fee: 781346525452500n}],
    experiment: {states: [{available: amount, reserved: 0n}], withdrawals: [{amount}]}};
  assert.throws(() => JSON.stringify({node: {scenario: observation}}), TypeError);
  observation.walletStopped = true;
  observation.clientMining = {stopped: true};
  const result = JSON.parse(evidenceJson(observation));
  const worker = JSON.parse(JSON.stringify({passed: true, node: {scenario: result, nodeStopped: true}, singletonsStopped: true}));
  assert.equal(worker.node.scenario.experiment.withdrawals[0].amount, amount.toString());
  assert.equal(worker.node.scenario.experiment.states[0].reserved, '0');
  assert.equal(worker.node.scenario.l1[0].fee, '781346525452500');
  assert.equal(worker.node.scenario.walletStopped, true);
  assert.equal(worker.node.scenario.clientMining.stopped, true);
  assert.equal(worker.node.nodeStopped, true);
  assert.equal(worker.singletonsStopped, true);
});

test('evidence encoding preserves failure and rejects unserializable observations', () => {
  const failed = {passed: false, cleanupFailure: {errorClass: 'Error'}, accounting: {reserved: 9007199254740993n}};
  assert.deepEqual(JSON.parse(evidenceJson(failed)), {
    passed: false, cleanupFailure: {errorClass: 'Error'}, accounting: {reserved: '9007199254740993'},
  });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => evidenceJson(cycle), TypeError);
});

import {operatorDevnetInputs,checkOperatorDevnetWallet,reconcileOperatorDevnet} from './private-bok-fixture.mjs';
import {getScenario} from './scenarios.mjs';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {rollingPxeOptions} from '../../plugins/operations.mjs';
const f=n=>'0x'+n.toString(16).padStart(64,'0');
function operatorFixture() {
  const account={type:'schnorr_initializerless',secret:Fr.fromString(f(1)),salt:Fr.fromString(f(2)),
    signingKey:GrumpkinScalar.fromString(f(3)),address:AztecAddress.fromStringUnsafe(f(4))};
  const rollup='0x'+'1'.repeat(40),info={l1ChainId:31337,realProofs:false,rollupVersion:3409706519,l1ContractAddresses:{rollupAddress:rollup}};
  const ctx={scenario:getScenario('rolling-operator-wallet'),preparation:{boardProfile:'rolling',authorAccounts:[account],account},
    instance:{address:AztecAddress.fromStringUnsafe(f(5))},config:{realProofs:false,l1RpcUrls:['http://127.0.0.1:8545/']},rollupAddress:rollup};
  return {ctx,info,nodeUrl:'http://127.0.0.1:8080/'};
}
test('operator scenarios dispatch to native-disabled included Rolling board before resources',async()=>{
  for(const stage of ['wallet','constructor']) {
    const scenario=getScenario('rolling-operator-'+stage);
    assert.equal(scenario.fixture,'included-board');assert.equal(scenario.boardProfile,'rolling');assert.equal(scenario.authors,1);
    assert.equal(scenario.browser,'none');assert.equal(scenario.applicationThreads,1);assert.equal(scenario.deadlineMs,120000);
    await assert.rejects(scenario.run({scenario,directory:'relative'}));
  }
  assert.throws(()=>getScenario('rolling-operator-retry'));
});
test('operator fixture projects actual SDK actor types privately and keeps exact root RPC URL',()=>{
  const {ctx,info,nodeUrl}=operatorFixture(),{actor,config}=operatorDevnetInputs(ctx,info,nodeUrl);
  assert(Object.isFrozen(actor)&&Object.isFrozen(config));assert.deepEqual(Object.keys(actor),['address','secret','salt','signingKey']);
  for(const value of Object.values(actor))assert.equal(typeof value,'string');
  assert.equal(config.nodeUrl,nodeUrl);assert.equal(config.development,true);assert.equal(config.chainId,'31337');
  for(const secret of ['secret','salt','signingKey'])assert(!Object.hasOwn(config,secret));
  assert.equal(actor.address,String(ctx.preparation.account.address));
  ctx.config.l1RpcUrls[0]='http://127.0.0.1:8545';
  assert.equal(operatorDevnetInputs(ctx,info,nodeUrl).config.ethereumUrl,'http://127.0.0.1:8545/');
});
test('operator fixture refuses wrong profile account type network and proof mode before wallet',()=>{
  for(const mutate of [
    x=>x.ctx.scenario={...x.ctx.scenario,fixture:'activated-board'},x=>x.ctx.preparation.boardProfile='legacy',
    x=>x.ctx.preparation.account.type='schnorr',x=>x.ctx.preparation.account.secret=f(1),
    x=>x.ctx.preparation.authorAccounts.push(x.ctx.preparation.account),x=>x.info.realProofs=true,
    x=>x.ctx.config.realProofs=true,x=>x.info.l1ChainId=11155111,x=>x.ctx.rollupAddress='0x'+'2'.repeat(40),
    x=>x.nodeUrl='https://external.example/',
  ]) {const x=operatorFixture();mutate(x);assert.throws(()=>operatorDevnetInputs(x.ctx,x.info,x.nodeUrl));}
});
test('operator wallet preflight uses native disabled options and stops the actual-used wallet boundary',async()=>{
  const {ctx,info,nodeUrl}=operatorFixture(),{actor}=operatorDevnetInputs(ctx,info,nodeUrl);let native=0,stops=0,restores=0;
  const options=await rollingPxeOptions(true,()=>{native++;throw Error('native proof forbidden');});
  assert.deepEqual(options,{proverEnabled:false});
  const result=await checkOperatorDevnetWallet(async()=>({pxe:options,createSchnorrInitializerlessAccount:async(secret,salt,key)=>{
    restores++;assert(secret instanceof Fr&&salt instanceof Fr&&key instanceof GrumpkinScalar);return {address:ctx.preparation.account.address};},stop:async()=>{stops++;}}),actor);
  assert.deepEqual(result,{passed:true,proverEnabled:false,accountMatched:true});assert.equal(native,0);assert.equal(stops,1);assert.equal(restores,1);
});
test('operator wallet failure closes owned store and never accepts another actor or enabled prover',async()=>{
  const {ctx,info,nodeUrl}=operatorFixture(),{actor}=operatorDevnetInputs(ctx,info,nodeUrl);
  for(const mode of ['wrong-actor','proofs','restore-error']) {
    let stops=0;
    await assert.rejects(checkOperatorDevnetWallet(async()=>({pxe:{proverEnabled:mode==='proofs'},
      createSchnorrInitializerlessAccount:async()=>{if(mode==='restore-error')throw Error('labelled restore failure');return {address:f(99)};},stop:async()=>{stops++;}}),actor));
    assert.equal(stops,1);
  }
});
function operationFixture() {
  let calls=0,ticks=0,sends=0,time=0;
  const journal={sha256:'a'.repeat(64),transactionHash:f(8),phase:'submission-unknown',operationCount:1};
  const result={status:'succeeded',canonical:true,scope:'constructor-only',transactionHash:f(8),escrow:f(9),blockNumber:8,blockHash:f(10),portalReady:false,registrationReady:false,hostedServiceReady:false};
  const deps={deadlineAt:100,now:()=>time,sendCount:()=>sends,readJournal:async()=>({...journal}),tick:async()=>{ticks++;time++;},
    invoke:async retained=>{calls++;if(!retained){sends++;return {status:'unresolved'};}return {...result};}};
  return {deps,journal,result,stats:()=>({calls,ticks,sends}),expire:()=>{time=100;}};
}
test('operator constructor workflow sends once then reconciles same journal and confirms result without replay',async()=>{
  const x=operationFixture(),result=await reconcileOperatorDevnet(x.deps);
  assert.deepEqual(x.stats(),{calls:3,ticks:1,sends:1});assert.equal(result.journalSha256,x.journal.sha256);assert.equal(result.sends,1);
  assert.equal(result.portalReady,false);assert.equal(result.registrationReady,false);assert.equal(result.hostedServiceReady,false);
});
test('operator constructor workflow refuses changed journal and never invokes an initial command twice',async()=>{
  const x=operationFixture();let reads=0;
  x.deps.readJournal=async()=>({...x.journal,sha256:(++reads===1?'a':'b').repeat(64)});
  await assert.rejects(reconcileOperatorDevnet(x.deps),/journal changed/);assert.equal(x.stats().sends,1);assert.equal(x.stats().calls,2);
});
test('operator constructor workflow retains preparing unknown outcomes and stops before reconciliation retries',async()=>{
  const x=operationFixture();x.deps.invoke=async retained=>{assert.equal(retained,false);return {status:'unresolved'};};x.deps.readJournal=async()=>({...x.journal,phase:'preparing'});
  await assert.rejects(reconcileOperatorDevnet(x.deps),/exactly one/);assert.equal(x.stats().ticks,0);
});
test('operator constructor workflow rejects false canonical scope readiness and duplicated sends',async()=>{
  for(const change of [{canonical:false},{scope:'hosted'},{portalReady:true},{registrationReady:true},{hostedServiceReady:true},{transactionHash:f(99)},{escrow:'bad'},{blockNumber:0}]){
    const x=operationFixture();Object.assign(x.result,change);await assert.rejects(reconcileOperatorDevnet(x.deps));assert.equal(x.stats().sends,1);
  }
  const x=operationFixture();x.deps.sendCount=()=>2;await assert.rejects(reconcileOperatorDevnet(x.deps),/exactly one/);
});
test('operator constructor workflow honors original deadline and bounded unresolved observation',async()=>{
  const x=operationFixture();x.expire();await assert.rejects(reconcileOperatorDevnet(x.deps),/deadline/);assert.equal(x.stats().calls,0);
  const y=operationFixture(),original=y.deps.invoke;y.deps.invoke=async retained=>{await original(retained);return {status:'unresolved'};};
  await assert.rejects(reconcileOperatorDevnet(y.deps));assert.deepEqual(y.stats(),{calls:33,ticks:32,sends:1});
});
test('operator public projection omits unexpected private result fields',async()=>{
  const x=operationFixture();Object.assign(x.result,{raw:'PRIVATE_RAW_SENTINEL',secret:'PRIVATE_KEY_SENTINEL',salt:'PRIVATE_SALT_SENTINEL'});
  const result=await reconcileOperatorDevnet(x.deps);assert(!JSON.stringify(result).includes('PRIVATE_'));assert(!Object.hasOwn(result,'raw'));
});
