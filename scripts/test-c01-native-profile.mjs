import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import {applicationNativeProfile,localApplicationInboxProfile} from './c01-native-profile.mjs';
test('development proof configuration defaults off and preserves explicit acceptance mode',async()=>{
 const {applicationProofsEnabled}=await import('./testing/proof-policy.mjs');
 const prior=process.env.BOARD_TEST_PROOFS;
 try{
  delete process.env.BOARD_TEST_PROOFS;assert.equal(applicationProofsEnabled(),false);
  process.env.BOARD_TEST_PROOFS='disabled';assert.equal(applicationProofsEnabled(),false);
  process.env.BOARD_TEST_PROOFS='real';assert.equal(applicationProofsEnabled(),true);
  for(const mode of ['', 'false', '0', 'REAL']){process.env.BOARD_TEST_PROOFS=mode;assert.throws(applicationProofsEnabled,/Invalid BOARD_TEST_PROOFS/);}
 }finally{if(prior===undefined)delete process.env.BOARD_TEST_PROOFS;else process.env.BOARD_TEST_PROOFS=prior;}
 const runner=await fs.readFile(new URL('./testing/run-application.mjs',import.meta.url),'utf8');
 assert(runner.includes("const proofMode=process.env.BOARD_TEST_PROOFS??'disabled'"));
 assert(!runner.includes('Browser development is held'));
 const wallet=await fs.readFile(new URL('../apps/rolling/wallet-session.mjs',import.meta.url),'utf8');
 assert(wallet.includes('proverEnabled:proofsEnabled,autoSync:false'));
 assert(runner.includes("applicationProofs:proofMode==='real'"));assert(runner.includes('BOARD_TEST_PROOFS:proofMode'));
 for(const name of ['./testing/fixture-worker.mjs','./c01-real-node.mjs']){
  const source=await fs.readFile(new URL(name,import.meta.url),'utf8');assert(source.includes('realProofs:applicationProofsEnabled()'));
 }
});
test('private prover profile defaults to one and explicitly supports two',()=>{
  assert.deepEqual(applicationNativeProfile('/private/tmp/test',{}),{threads:1,bbPath:'/private/tmp/test/bb-one-thread'});
  for(const threads of ['1','2']) assert.deepEqual(applicationNativeProfile('/private/tmp/test',{C01_APPLICATION_BB_THREADS:threads}),{threads:Number(threads),bbPath:`/private/tmp/test/bb-${threads==='1'?'one-thread':'two-threads'}`});
});
test('invalid counts and relative directories fail before singleton initialization',()=>{
  for(const value of ['',0,1,2,'0','3','02',' 2','2\n','auto',null]) assert.throws(()=>applicationNativeProfile('/private/tmp/test',{C01_APPLICATION_BB_THREADS:value}));
  for(const directory of ['', 'relative',undefined,1])assert.throws(()=>applicationNativeProfile(directory,{}));
});
test('scenario resource choices retain established native budgets',async()=>{
 const {getScenario}=await import('./testing/scenarios.mjs');
 assert.equal(getScenario('contention').applicationThreads,2);
 assert.equal(getScenario('rolling-notification-browser').applicationThreads,2);
 for(const name of ['browser-firefox-post','browser-webkit-post','browser-post','browser-journey','browser-post-recovery','private-fees','censor-commands'])assert.equal(getScenario(name).applicationThreads,1);
});

test('local timing has an SDK-valid build window and Inbox readiness headroom',async()=>{
 const {LOCAL_TIMING}=await import('./testing/fixture-worker.mjs');
 const {buildProposerTimetable}=await import('@aztec-labs/stdlib/timetable');
 const timetable=buildProposerTimetable(LOCAL_TIMING,{slotDuration:LOCAL_TIMING.aztecSlotDuration,ethereumSlotDuration:LOCAL_TIMING.ethereumSlotDuration,l1GenesisTime:0n});
 assert(timetable.getMaxBlocksPerCheckpoint()>=1);
 assert.equal(LOCAL_TIMING.inboxLag,2);
 const nominalBridgeSeconds=(LOCAL_TIMING.inboxLag+1)*LOCAL_TIMING.aztecSlotDuration+LOCAL_TIMING.blockDurationMs/1000+LOCAL_TIMING.ethereumSlotDuration;
 assert(nominalBridgeSeconds<20,'Local protocol delay must fit the unchanged browser readiness bound');
});

test('Inbox capacity exemption is confined to the disposable ordinary local fixture',()=>{
 const local={l1ChainId:31337,p2pEnabled:false,useAutomineSequencer:false,automineEnableProveEpoch:false,l1RpcUrls:['http://127.0.0.1:34567']};
 assert.deepEqual(localApplicationInboxProfile(local),{allowUnsafeInboxCatchupCapacity:true});
 for(const change of [{l1ChainId:11155111},{l1ChainId:'31337'},{p2pEnabled:true},{p2pEnabled:undefined},{useAutomineSequencer:true},{automineEnableProveEpoch:true},{l1RpcUrls:[]},{l1RpcUrls:[...local.l1RpcUrls,...local.l1RpcUrls]}])assert.throws(()=>localApplicationInboxProfile({...local,...change}));
 for(const url of ['https://127.0.0.1:34567','http://example.org:34567','http://127.0.0.1','http://user:password@127.0.0.1:34567','http://127.0.0.1:34567/private','http://127.0.0.1:34567/?key=value','http://127.0.0.1:34567/#value'])assert.throws(()=>localApplicationInboxProfile({...local,l1RpcUrls:[url]}));
});

test('actual SDK capacity guard rejects the short profile without its explicit local option',async()=>{
 const {Sequencer}=await import('@aztec-labs/sequencer-client');
 const {MIN_BLOCKS_FOR_INBOX_CATCHUP}=await import('@aztec-labs/stdlib/messaging');
 const {buildProposerTimetable}=await import('@aztec-labs/stdlib/timetable');
 const {LOCAL_TIMING}=await import('./testing/fixture-worker.mjs');
 const count=buildProposerTimetable(LOCAL_TIMING,{slotDuration:LOCAL_TIMING.aztecSlotDuration,ethereumSlotDuration:LOCAL_TIMING.ethereumSlotDuration,l1GenesisTime:0n}).getMaxBlocksPerCheckpoint();
 assert(count<MIN_BLOCKS_FOR_INBOX_CATCHUP);
 const warnings=[],receiver={log:{warn:(...args)=>warnings.push(args)}};
 const check=Sequencer.prototype.assertEffectiveCapacityClearsInboxBacklog;
 assert.throws(()=>check.call(receiver,{maxBlocksPerCheckpoint:MIN_BLOCKS_FOR_INBOX_CATCHUP,allowUnsafeInboxCatchupCapacity:false},count),/Rejecting sequencer configuration/);
 check.call(receiver,{maxBlocksPerCheckpoint:MIN_BLOCKS_FOR_INBOX_CATCHUP,allowUnsafeInboxCatchupCapacity:true},count);
 assert.equal(warnings.length,1);assert.equal(warnings[0][1].effectiveMaxBlocks,count);
 check.call(receiver,{maxBlocksPerCheckpoint:MIN_BLOCKS_FOR_INBOX_CATCHUP,allowUnsafeInboxCatchupCapacity:false},MIN_BLOCKS_FOR_INBOX_CATCHUP);
 assert.equal(warnings.length,1);
});

// Execute the actual option/assertion blocks with labelled singleton doubles.
// No native proof or wallet acceptance is claimed by these composition checks.
test('collateral claim preserves selected profile and rejects stale singleton before wallet work',async()=>{
 const source=await fs.readFile(new URL('./c01-deposit-flow.mjs',import.meta.url),'utf8');
 const block=source.slice(source.indexOf('    const native='),source.indexOf("    mark(ownsWallet?'reopen-claim-wallet'"));assert(block);
 const run=new Function('directory','applicationNativeProfile','BackendType','Barretenberg','assert',block+'return native;');
 for(const threads of ['1','2']){
  const profile=directory=>applicationNativeProfile(directory,{C01_APPLICATION_BB_THREADS:threads}),expected={backend:'native',...profile('/private/tmp/test')};
  let options={...expected};const bb={getSingleton:()=>({options})};
  assert.deepEqual(run('/private/tmp/test',profile,{NativeUnixSocket:'native'},bb,assert),expected);
  for(const key of ['backend','bbPath','threads']){options={...expected,[key]:'wrong'};assert.throws(()=>run('/private/tmp/test',profile,{NativeUnixSocket:'native'},bb,assert));}
 }
});
test('private-fee wallet open and reopen honor both profiles and reject singleton changes before allocation',async()=>{
 const source=await fs.readFile(new URL('./w01-unfunded-wallet.mjs',import.meta.url),'utf8');
 const block=source.slice(source.indexOf(' const open='),source.indexOf(' const close='));assert(block);
 const make=new Function('directory','applicationNativeProfile','BackendType','Barretenberg','assert','EmbeddedWallet','applicationProver','node','persistentDirectory','applicationProofsEnabled',block+'return open;');
 for(const proofsEnabled of [false,true])for(const threads of ['1','2'])for(const persistentDirectory of [undefined,'/private/tmp/test/wallet']){
  const profile=directory=>applicationNativeProfile(directory,{C01_APPLICATION_BB_THREADS:threads}),expected={backend:'native',...profile('/private/tmp/test')};
  let options={...expected};const calls=[],bb={getSingleton:()=>({options})},node={};
  const open=make('/private/tmp/test',profile,{NativeUnixSocket:'native'},bb,assert,{create:async(n,o)=>{assert.equal(n,node);calls.push(o);return {}; }},x=>x,node,persistentDirectory,()=>proofsEnabled);
  await open();await open();assert.equal(calls.length,2);
  for(const c of calls){assert.equal(c.pxe.proverEnabled,proofsEnabled);assert.deepEqual(c.pxe.proverOrOptions,expected);assert.equal(c.ephemeral,persistentDirectory===undefined);assert.equal(c.pxe.dataDirectory,persistentDirectory);}
  for(const key of ['backend','bbPath','threads']){options={...expected,[key]:'wrong'};assert.throws(()=>open());assert.equal(calls.length,2);}
 }
});

// Public-clock controlled RPCs exercise the actual helpers, not Anvil acceptance.
const clockProfile={name:'rolling-bok-post',fixture:'activated-board',boardProfile:'rolling',browser:'none',initialClockOffsetSeconds:120};
const clockBody=(number,timestamp,transactions=[])=>({jsonrpc:'2.0',id:3,result:{number:'0x'+number.toString(16),timestamp:'0x'+timestamp.toString(16),transactions}});
async function clockHelpers(){return import('./testing/fixture-worker.mjs');}
test('past genesis is fixed and limited to the explicit disposable Bok scenario',async()=>{
 const {applicationInitialClock}=await clockHelpers();const {getScenario}=await import('./testing/scenarios.mjs');
 for(const name of ['rolling-bok-post']){
  const scenario=getScenario(name),clock=applicationInitialClock(scenario,()=>1000000);
  assert.deepEqual(clock,{offsetSeconds:120,capturedWallSeconds:1000,genesisTimestamp:880});assert(Object.isFrozen(clock));
 }
 for(const name of ['node','included-board','activated-board','rolling-preference-reorg-initial','rolling-preference-browser','rolling-preference-reorg-marker','private-bok'])assert.equal(applicationInitialClock(getScenario(name),()=>{throw Error('Default must not read clock');}),null);


 const diagnostic=getScenario('rolling-bok-post');assert.equal(diagnostic.deadlineMs,540000);assert.equal(diagnostic.applicationThreads,1);assert.equal(diagnostic.fixture,'activated-board');assert.equal(diagnostic.boardProfile,'rolling');assert.equal(diagnostic.browser,'none');
});
test('clock profile rejects alternative offsets and mismatched capability before reading wall time',async()=>{
 const {applicationInitialClock}=await clockHelpers();let calls=0;const now=()=>{calls++;return 1000000;};
 for(const initialClockOffsetSeconds of [undefined,null,0,119,121,'120',true,NaN,Infinity])assert.throws(()=>applicationInitialClock({...clockProfile,initialClockOffsetSeconds},now));
 for(const change of [{name:'node'},{name:'other'},{fixture:'included-board'},{boardProfile:'other'},{browser:'chromium'}])assert.throws(()=>applicationInitialClock({...clockProfile,...change},now));
 const absent={...clockProfile};delete absent.initialClockOffsetSeconds;assert.throws(()=>applicationInitialClock(absent,now));assert.equal(calls,0);
});
test('clock configuration rejects accessors without invoking them and cannot inherit an enabling name',async()=>{
 const {applicationInitialClock}=await clockHelpers();let accesses=0;
 for(const key of ['name','initialClockOffsetSeconds','fixture','boardProfile','browser']){
  const scenario={...clockProfile};Object.defineProperty(scenario,key,{get(){accesses++;throw Error('Private sentinel');}});assert.throws(()=>applicationInitialClock(scenario,()=>1000000));
 }
 const inherited=Object.assign(Object.create({name:clockProfile.name}),{...clockProfile});delete inherited.name;
 assert.throws(()=>applicationInitialClock(inherited,()=>1000000));assert.equal(accesses,0);
});
test('initial clock captures wall once and rejects unsafe time before spawn',async()=>{
 const {applicationInitialClock}=await clockHelpers();let calls=0;const clock=applicationInitialClock(clockProfile,()=>{calls++;return 1000123;});assert.equal(calls,1);assert.equal(clock.genesisTimestamp,880);
 for(const value of [undefined,null,'1000000',NaN,Infinity,120999,1000000.5])assert.throws(()=>applicationInitialClock(clockProfile,()=>value));
 const failure={fixed:'sentinel'};assert.throws(()=>applicationInitialClock(clockProfile,()=>{throw failure;}),e=>e===failure);
});
test('actual spawn block appends only the captured timestamp and leaves default argv unchanged',async()=>{
 const {applicationInitialClock}=await clockHelpers();const source=await fs.readFile(new URL('./testing/fixture-worker.mjs',import.meta.url),'utf8');
 const first=source.indexOf('    const initialClock=applicationInitialClock(scenario);'),last=source.indexOf('    anvilClosed=',first);assert(first>0&&last>first);
 const run=new Function('applicationInitialClock','scenario','spawn','anvilPath','port','identity','directory','process',`let anvil;const output={};${source.slice(first,last)}return {anvil,output};`);
 let wallCalls=0;const calls=[],spawn=(...args)=>{calls.push(args);return 'owned-child';};
 const evaluate=scenario=>run(s=>applicationInitialClock(s,()=>{wallCalls++;return 1000000;}),scenario,spawn,'/owned/anvil',12345,{mnemonic:{phrase:'synthetic-fixture-phrase'}},'/owned/directory',{env:{}});
 const enabled=evaluate(clockProfile);assert.equal(enabled.anvil,'owned-child');assert.deepEqual(calls[0][1].slice(-2),['--timestamp','880']);assert.equal(enabled.output.initialClock.genesis,null);
 const ordinary=evaluate({name:'included-board'});assert.deepEqual(calls[1][1],calls[0][1].slice(0,-2));assert.deepEqual(ordinary.output,{});assert.equal(wallCalls,1);
});
test('actual clock helper verifies block zero through one fixed public RPC before deployment',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>clockBody(0,880)};});
 const row=await observeApplicationInitialClock('http://127.0.0.1:12345',applicationInitialClock(clockProfile,()=>1000000),'genesis',()=>1001000);
 assert.deepEqual(row,{blockNumber:0,timestamp:880,wallSeconds:1001,leadSeconds:-121});assert(Object.isFrozen(row));assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(calls[0].options.body),{jsonrpc:'2.0',id:3,method:'eth_getBlockByNumber',params:['0x0',false]});assert.equal(calls[0].options.method,'POST');assert(calls[0].options.signal instanceof AbortSignal);
});
test('genesis mismatch or transaction-bearing block rejects without a second request',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let body,calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,json:async()=>body};});
 for(body of [clockBody(0,881),clockBody(1,880),clockBody(0,880,['0x'+'11'.repeat(32)])])await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'genesis',()=>1000000));assert.equal(calls,3);
});
test('first protocol block accepts elapsed wall offset and the next-block minimum without genesis equality',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let timestamp=883;const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>clockBody(1,timestamp,['synthetic-public-txhash'])};});
 assert.equal((await observeApplicationInitialClock('http://127.0.0.1:12345',clock,'first-protocol',()=>1005000)).timestamp,883);
 timestamp=881;assert.equal((await observeApplicationInitialClock('http://127.0.0.1:12345',clock,'first-protocol',()=>1000000)).timestamp,881);
 assert(calls.every(call=>call.params[0]==='0x1'&&call.params[1]===false));
});
test('first protocol block rejects lost offset, wrong block, missing transaction and nonadvancement',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let body;
 t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>body}));
 for(body of [clockBody(1,1000,['x']),clockBody(2,883,['x']),clockBody(1,883),clockBody(1,880,['x'])])await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'first-protocol',()=>1005000));
});
test('clock observation rejects malformed or failed public RPC without fallback',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let body,ok=true,calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok,json:async()=>body};});
 const bad=[null,{...clockBody(0,880),id:4},{...clockBody(0,880),error:{code:-1}},{...clockBody(0,880),jsonrpc:'1.0'},clockBody(0,880)];bad[4].result.timestamp='0x0370';
 for(body of bad)await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'genesis',()=>1000000));
 body=clockBody(0,880);ok=false;await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'genesis',()=>1000000));assert.equal(calls,6);
});
test('clock observation preserves original and falsy request failures',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let failure;
 t.mock.method(globalThis,'fetch',async()=>{throw failure;});
 for(failure of [undefined,null,false,0,{synthetic:'failure'}]){let caught=false;try{await observeApplicationInitialClock('http://127.0.0.1:12345',clock,'genesis',()=>1000000);}catch(error){caught=true;assert.equal(error,failure);}assert(caught);}
});
test('clock observation records actual future activation debt without hiding or editing it',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>clockBody(64,1050)};});
 for(const stage of ['post-activation','node-handoff'])assert.deepEqual(await observeApplicationInitialClock('http://127.0.0.1:12345',clock,stage,()=>1020000),{blockNumber:64,timestamp:1050,wallSeconds:1020,leadSeconds:30});
 assert(calls.every(call=>call.params[0]==='latest'));
});
test('clock observation rejects backward wall time or unknown stage without producing a row',async t=>{
 const {applicationInitialClock,observeApplicationInitialClock}=await clockHelpers();const clock=applicationInitialClock(clockProfile,()=>1000000);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:true,json:async()=>clockBody(0,880)};});
 await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'unknown',()=>1000000));assert.equal(calls,0);
 await assert.rejects(()=>observeApplicationInitialClock('http://127.0.0.1:12345',clock,'genesis',()=>999000));assert.equal(calls,1);
});
test('actual worker checks genesis before protocol work and retains deployment activation and real node order',async()=>{
 const source=await fs.readFile(new URL('./testing/fixture-worker.mjs',import.meta.url),'utf8');
 const points=["const initialClock=applicationInitialClock(scenario);","anvil=spawn(","output.initialClock.genesis=await observeApplicationInitialClock", "mark('prepare-genesis')",'const result=await deployC01ApplicationProtocol(',"output.initialClock.firstProtocolBlock=await observeApplicationInitialClock", "mark('wait-for-local-validator-activation')",'output.initialClock.postActivation=await observeApplicationInitialClock', 'output.initialClock.nodeHandoff=await observeApplicationInitialClock','output.node=await qualifyC01RealNode('];
 let last=-1;for(const text of points){const at=source.indexOf(text,last+1);assert(at>last,text);last=at;}
 assert.equal((source.match(/evm_setNextBlockTimestamp/g)||[]).length,1);assert(source.includes('Number(current.timestamp)+seconds'));assert(source.includes('const seconds=config.aztecSlotDuration*config.aztecEpochDuration'));
 assert(!source.includes('evm_setTime'));assert(!source.includes('setBlockTimestampInterval'));assert(!source.includes('setNextBlockTimestamp\',params:[initialClock'));
});

test('only the Bok scenario gives both setup inclusion calls the original real-wall deadline',async()=>{
 const source=await fs.readFile(new URL('./c01-real-node.mjs',import.meta.url),'utf8');
 assert.equal(source.split("scenario.name==='rolling-bok-post'?{miningMode:'real-wall',deadlineAt:applicationDeadlineAt}:{}").length-1,2);
 const inclusion=await fs.readFile(new URL('./c01-board-inclusion.mjs',import.meta.url),'utf8');
 assert(inclusion.includes("if(tick)await tick();else await client.request({method:'evm_mine',params:[]});"));
 assert(inclusion.includes("const deadline=Date.now()+(diagnostic?45000:120000)"));
});
