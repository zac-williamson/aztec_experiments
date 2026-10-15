import test from 'node:test';import assert from 'node:assert/strict';
import {recordedTransaction} from '../operations.mjs';
test('hosted billing CLI accepts only one local receipt command and leaves service invocation unchanged',async()=>{
 const {hostedCommand}=await import('../operations.mjs');assert.deepEqual(hostedCommand(['config.json']),{kind:'serve',configFile:'config.json'});
 assert.deepEqual(hostedCommand(['--reconcile-billing','/private/config.json','/private/receipt.json']),{kind:'reconcile-billing',configFile:'/private/config.json',receiptFile:'/private/receipt.json'});
 for(const args of [[],['--reconcile-billing'],['--reconcile-billing','config','receipt'],['--reconcile-billing','/config','/receipt','extra'],['--other','/config','/receipt']])assert.throws(()=>hostedCommand(args));
});
test('original hosted billing evidence is bounded owner-only regular input with exact hash',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{createHash}=await import('node:crypto');
 const {readHostedBillingReceipt,readHostedPrivateFile}=await import('../operations.mjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'hosted-billing-'));
 const receiptFile=path.join(directory,'receipt.json'),evidenceFile=path.join(directory,'evidence.json'),bytes=Buffer.from('ORIGINAL_PRIVATE_PROVIDER_EVIDENCE');
 const input={schemaVersion:1,binding:{},callId:0,inputDigest:'ab'.repeat(32),billing:{},evidenceFile,evidenceSha256:createHash('sha256').update(bytes).digest('hex')};
 const write=async value=>fs.writeFile(receiptFile,JSON.stringify(value),{mode:0o600});
 try{
  await fs.writeFile(evidenceFile,bytes,{mode:0o600});await write(input);
  const result=await readHostedBillingReceipt(receiptFile);assert.equal(result.evidenceSha256,input.evidenceSha256);assert.equal(Object.hasOwn(result,'evidenceFile'),false);assert(!JSON.stringify(result).includes('ORIGINAL_PRIVATE'));
  for(const change of [{evidenceSha256:'cd'.repeat(32)},{callId:64},{inputDigest:'bad'},{extra:true},{schemaVersion:2}]){await write({...input,...change});await assert.rejects(readHostedBillingReceipt(receiptFile),error=>error.message==='Invalid original hosted billing receipt');}
  await write(input);await fs.chmod(evidenceFile,0o644);await assert.rejects(readHostedBillingReceipt(receiptFile));await fs.chmod(evidenceFile,0o600);
  const link=path.join(directory,'link');await fs.symlink(evidenceFile,link);await assert.rejects(readHostedPrivateFile(link));
  await fs.link(evidenceFile,path.join(directory,'hardlink'));await assert.rejects(readHostedPrivateFile(evidenceFile));await fs.unlink(path.join(directory,'hardlink'));
  await assert.rejects(readHostedPrivateFile(evidenceFile,3));await assert.rejects(readHostedPrivateFile(directory));
  await fs.writeFile(receiptFile,'PRIVATE_SENTINEL invalid json');await assert.rejects(readHostedBillingReceipt(receiptFile),error=>!String(error).includes('PRIVATE_SENTINEL'));
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('saved signed transaction is reused after interruption before broadcast',async()=>{
 let value={operations:{}},prepares=0,broadcasts=0;
 const args={store:{read:()=>value,write:async x=>{value=x;}},name:'deposit',identity:'scope',prepare:async()=>{prepares++;return {hash:'h',raw:'same'};},broadcast:async r=>{broadcasts++;assert.equal(r.raw,'same');assert.equal(value.operations.deposit.hash,'h');if(broadcasts===1)throw Error('offline');},wait:async()=>({status:1})};
 await assert.rejects(recordedTransaction(args),/offline/);await recordedTransaction(args);assert.equal(prepares,1);assert.equal(broadcasts,2);
 await assert.rejects(recordedTransaction({...args,identity:'another'}),/different/);
});
test('public portal operations require finalized successful source even when a witness is available',async()=>{
 const {outboxArguments}=await import('../operations.mjs');let witnesses=0;
 const node={getTxReceipt:async()=>({status:'checkpointed',executionResult:'success'}),getTxEffect:async()=>({data:{l2ToL1Msgs:[{isZero:()=>false}]}}),getL2ToL1MembershipWitness:async()=>{witnesses++;return {epochNumber:1,numCheckpointsInEpoch:2,leafIndex:3n,siblingPath:{toBufferArray:()=>[]}};}};
 await assert.rejects(outboxArguments(node,'tx'),/finality/);assert.equal(witnesses,0);
 node.getTxReceipt=async()=>({status:'finalized',executionResult:'reverted'});await assert.rejects(outboxArguments(node,'tx'),/failed/);
 node.getTxReceipt=async()=>({status:'finalized',executionResult:'success'});assert.deepEqual(await outboxArguments(node,'tx'),[1n,2n,3n,[]]);
 node.getL2ToL1MembershipWitness=async()=>undefined;await assert.rejects(outboxArguments(node,'tx'),/settlement/);
});

import {operatorApplicationProfile,rollingOperatorConfig,operatorNodeFetch,onceAztecOperation,reconcileRollingOperation,rollingPxeOptions,bindRollingJournal,readOperatorActor,projectRollingReceipt} from '../operations.mjs';
const field=n=>'0x'+n.toString(16).padStart(64,'0');
const config=()=>({applicationProfile:'rolling',nodeUrl:'http://127.0.0.1:8083/v1/node',ethereumUrl:'http://127.0.0.1:8545/',chainId:'31337',rollupVersion:'3409706519',rollupAddress:'0x'+'1'.repeat(40),boardAddress:field(1),operatorAddress:field(2),development:true});
function memory(initial={operations:{}}){let value=structuredClone(initial);return {read:()=>value,write:async next=>{value=structuredClone(next);}};}
const signed={hash:field(9),raw:'010203'};

test('rolling profile captures detached public constructor scope and omits actor locator',()=>{
 const input={...config(),operatorFile:'/private/operator.json'},got=rollingOperatorConfig(input);
 input.boardAddress=field(99);assert.equal(got.boardAddress,field(1));assert(Object.isFrozen(got));assert(!('operatorFile'in got));
});
test('rolling profile rejects getters coercions credentials and unsupported fields before reads',()=>{
 let accesses=0;
 const getter=config();Object.defineProperty(getter,'boardAddress',{get(){accesses++;throw Error('private');}});
 const coercion={toString(){accesses++;return field(1);}};
 for(const c of [getter,{...config(),boardAddress:coercion},{...config(),queryApiKey:'secret'},{...config(),nodeUrl:'http://u:p@127.0.0.1:8083/v1/node'},{...config(),nodeUrl:'http://127.0.0.1:8083/v1/node?token=x'},{...config(),nodeUrl:'http://127.0.0.1:8083/v1/node#x'},{...config(),development:true,chainId:'11155111'},{...config(),operatorAddress:field(0)}])assert.throws(()=>rollingOperatorConfig(c));
 assert.equal(accesses,0);
});
test('public rolling profile requires exact HTTPS query route and explicit nonzero network',()=>{
 const c={...config(),development:false,chainId:'11155111',nodeUrl:'https://query.example/v1/node',ethereumUrl:'https://l1.example/'};
 assert.equal(rollingOperatorConfig(c).chainId,'11155111');
 for(const patch of [{nodeUrl:'https://query.example/'},{nodeUrl:'http://query.example/v1/node'},{chainId:'0'},{rollupVersion:'18446744073709551616'},{rollupAddress:'0x'+'0'.repeat(40)},{applicationProfile:'legacy'}])assert.throws(()=>rollingOperatorConfig({...c,...patch}));
});
test('native development PXE disables proof setup without preparing native runtime',async()=>{
 let calls=0;const factory=async()=>{calls++;return {backend:'labelled-native-options'};};
 assert.deepEqual(await rollingPxeOptions(true,factory),{proverEnabled:false});assert.equal(calls,0);
 assert.deepEqual(await rollingPxeOptions(false,factory),{proverEnabled:true,proverOrOptions:{backend:'labelled-native-options'}});assert.equal(calls,1);
});

test('rolling intent is durable before preparation and exact signed bytes before sole send',async()=>{
 const store=memory();let sends=0;
 const result=await onceAztecOperation({store,name:'deploy-escrow',identity:'scope',execute:async({submit,bindDeployment})=>{
  assert.equal(store.read().operations['deploy-escrow'].phase,'preparing');await bindDeployment({address:field(3)});
  await submit(signed,async()=>{sends++;assert.deepEqual(store.read().operations['deploy-escrow'],{schemaVersion:1,policy:'reconcile-only',identity:'scope',phase:'submission-unknown',deployment:{address:field(3)},...signed});});
 },reconcile:async r=>({hash:r.hash})});assert.equal(sends,1);assert.equal(result.hash,signed.hash);
});
test('retained signed operation only reconciles after unknown send and never retransmits',async()=>{
 const store=memory();let prepares=0,sends=0,reads=0;
 const args={store,name:'deploy-escrow',identity:'scope',execute:async({submit})=>{prepares++;await submit(signed,async()=>{sends++;throw Error('private response lost');});},reconcile:async()=>{reads++;return {status:'unresolved'};}};
 assert.equal((await onceAztecOperation(args)).status,'unresolved');const before=JSON.stringify(store.read());
 await onceAztecOperation(args);await onceAztecOperation(args);assert.equal(prepares,1);assert.equal(sends,1);assert.equal(reads,2);assert.equal(JSON.stringify(store.read()),before);
});
test('retained preparing fee claim does not reopen claim file wallet or signing callback',async()=>{
 const store=memory();let prepares=0;
 const args={store,name:'claim-fees',identity:'scope',execute:async()=>{prepares++;throw Error('claim secret unavailable');},reconcile:async r=>{assert.equal(r.hash,undefined);return {status:'unresolved'};}};
 await onceAztecOperation(args);await onceAztecOperation(args);assert.equal(prepares,1);
});
test('rolling retained scope or legacy policy mismatch causes no write prepare or send',async()=>{
 for(const record of [{identity:'other',schemaVersion:1,policy:'reconcile-only',phase:'preparing'},{identity:'scope',...signed},{identity:'scope',schemaVersion:1,policy:'reconcile-only',phase:'done'}]){
  const store=memory({operations:{'deploy-escrow':record}}),before=JSON.stringify(store.read());
  await assert.rejects(onceAztecOperation({store,name:'deploy-escrow',identity:'scope',execute:()=>assert.fail(),reconcile:()=>assert.fail()}),/scope mismatch/);assert.equal(JSON.stringify(store.read()),before);
 }
});
test('rolling persistence uncertainty before signed acknowledgement prevents broadcast',async()=>{
 const store=memory(),write=store.write;let writes=0,sends=0;
 store.write=async value=>{if(++writes===2)throw Error('fsync unavailable');await write(value);};
 const result=await onceAztecOperation({store,name:'deploy-escrow',identity:'scope',execute:({submit})=>submit(signed,async()=>sends++),reconcile:()=>assert.fail()});
 assert.equal(result.status,'unresolved');assert.equal(sends,0);assert.equal(store.read().operations['deploy-escrow'].phase,'preparing');
});
test('rolling sole send rejects a second SDK send within one invocation',async()=>{
 const store=memory();let sends=0;
 await onceAztecOperation({store,name:'deploy-escrow',identity:'scope',execute:async({submit})=>{await submit(signed,async()=>sends++);await submit(signed,async()=>sends++);},reconcile:()=>assert.fail()});assert.equal(sends,1);
});

function reconciliation(){
 const expected={version:2,address:field(3),deployer:field(4),originalContractClassId:field(5),currentContractClassId:field(5),salt:field(6),initializationHash:field(7),immutablesHash:field(0),storage:{board:field(1),operator:field(2),owner:field(4),l1_chain:field(31337),version:field(9)}};
 const record={...signed,phase:'submission-unknown',deployment:structuredClone(expected)};
 const receipt={txHash:signed.hash,status:'finalized',executionResult:'success',blockNumber:8,blockHash:field(8)};
 const effect={l2BlockHash:field(8),l2BlockNumber:8,data:{txHash:signed.hash,revertCode:{isOK:()=>true}}};
 const reads={signed:async()=>true,receipt:async()=>receipt,effect:async()=>effect,block:async()=>({hash:field(8)}),instance:async()=>expected,address:async()=>expected.address,storage:async(_,key)=>expected.storage[key]};
 return {record,expected,receipt,effect,reads,development:false};
}
test('rolling constructor success requires canonical effect class deployer and all immutable values',async()=>{
 const f=reconciliation(),result=await reconcileRollingOperation(f);assert.equal(result.status,'succeeded');assert.equal(result.escrow,f.expected.address);
 assert.equal(result.portalReady,false);assert.equal(result.registrationReady,false);assert.equal(result.hostedServiceReady,false);
});
test('missing pending dropped nonfinalized and unavailable receipts never qualify or mutate record',async()=>{
 for(const status of ['pending','proposed','dropped','checkpointed','unknown']){const f=reconciliation();f.receipt.status=status;const before=JSON.stringify(f.record);assert.equal((await reconcileRollingOperation(f)).status,'unresolved');assert.equal(JSON.stringify(f.record),before);}
 const f=reconciliation();f.reads.receipt=async()=>{throw Error('PRIVATE_PROVIDER_SENTINEL');};assert(!JSON.stringify(await reconcileRollingOperation(f)).includes('PRIVATE_PROVIDER'));
});
test('canonical reconciliation rejects wrong transaction effect block and reorg',async()=>{
 const mutations=[f=>f.receipt.txHash=field(99),f=>f.effect.data.txHash=field(99),f=>f.effect.l2BlockNumber=9,f=>f.effect.l2BlockHash=field(99),f=>f.effect.data.revertCode.isOK=()=>false,f=>{let n=0;f.reads.block=async()=>({hash:++n===1?field(8):field(99)});}];
 for(const mutate of mutations){const f=reconciliation();mutate(f);assert.equal((await reconcileRollingOperation(f)).status,'unresolved');}
});
test('constructor reconciliation rejects changed class owner address and every constructor field',async()=>{
 for(const key of ['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash']){const f=reconciliation();f.reads.instance=async()=>({...f.expected,[key]:field(99)});assert.equal((await reconcileRollingOperation(f)).status,'unresolved');}
 for(const key of ['board','operator','owner','l1_chain','version']){const f=reconciliation();f.reads.storage=async(_,fieldName)=>fieldName===key?field(99):f.expected.storage[fieldName];assert.equal((await reconcileRollingOperation(f)).status,'unresolved');}
 const f=reconciliation();f.reads.address=async()=>field(99);assert.equal((await reconcileRollingOperation(f)).status,'unresolved');
});
test('reverted canonical transaction is failure and local checkpoint is development only',async()=>{
 const f=reconciliation();f.receipt.executionResult='reverted';f.effect.data.revertCode.isOK=()=>false;f.reads.instance=()=>assert.fail();assert.equal((await reconcileRollingOperation(f)).status,'failed');
 const local=reconciliation();local.receipt.status='checkpointed';assert.equal((await reconcileRollingOperation(local)).status,'unresolved');local.development=true;assert.equal((await reconcileRollingOperation(local)).status,'succeeded');
});

const rpcBody=[{jsonrpc:'2.0',id:1,method:'aztec_getNodeInfo',params:[]}];
const rpcResponse=()=>new Response(JSON.stringify([{jsonrpc:'2.0',id:1,result:{public:true}}]),{headers:{'content-type':'application/json'}});
test('operator transport scopes synthetic authentication to exact endpoint POST without redirect retry',async()=>{
 const key='a'.repeat(64),endpoint=config().nodeUrl;let calls=0;
 const transport=operatorNodeFetch({endpoint,key,serialize:JSON.stringify,fetchImpl:async(url,init)=>{calls++;assert.equal(url,endpoint);assert.equal(init.method,'POST');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.headers['x-aztec-api-key'],key);return rpcResponse();}});
 assert.deepEqual((await transport(endpoint,rpcBody)).response[0].result,{public:true});
 for(const host of [endpoint+'/',endpoint+'?x=1','https://elsewhere.example/v1/node'])await assert.rejects(transport(host,rpcBody),/RPC unavailable/);
 await assert.rejects(transport(endpoint,rpcBody,{authorization:'private'}));assert.equal(calls,1);
});
test('operator transport refuses inherited hidden and accessor headers without access',async()=>{
 let calls=0,gets=0;const endpoint=config().nodeUrl,transport=operatorNodeFetch({endpoint,serialize:JSON.stringify,fetchImpl:async()=>{calls++;return rpcResponse();}});
 const accessor={};Object.defineProperty(accessor,'authorization',{get(){gets++;throw Error('private');}});
 for(const headers of [Object.create({authorization:'private'}),Object.defineProperty({},'authorization',{value:'private'}),accessor,{[Symbol('private')]:'private'}])await assert.rejects(transport(endpoint,rpcBody,headers));
 assert.equal(calls,0);assert.equal(gets,0);
});
test('operator transport caps requests and response and suppresses provider errors',async()=>{
 const endpoint=config().nodeUrl;let calls=0;
 const transport=operatorNodeFetch({endpoint,serialize:JSON.stringify,fetchImpl:async()=>{calls++;throw Error('PRIVATE_UPSTREAM_TOKEN');}});
 await assert.rejects(transport(endpoint,[{x:'x'.repeat(8*1024**2)}]),/RPC unavailable/);assert.equal(calls,0);
 await assert.rejects(transport(endpoint,rpcBody),e=>e.message==='Operator RPC unavailable');assert.equal(calls,1);
 let cancelled=false;
 const huge=operatorNodeFetch({endpoint,serialize:JSON.stringify,fetchImpl:async()=>({status:200,redirected:false,body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(32*1024**2+1)}),cancel:async()=>{cancelled=true;}})}})});
 await assert.rejects(huge(endpoint,rpcBody));assert(cancelled);
});
test('operator transport replaces RPC error detail and rejects malformed response before SDK logging',async()=>{
 const endpoint=config().nodeUrl;
 const send=value=>operatorNodeFetch({endpoint,serialize:JSON.stringify,fetchImpl:async()=>new Response(JSON.stringify(value))})(endpoint,rpcBody);
 const response=await send([{jsonrpc:'2.0',id:1,error:{message:'PRIVATE_SECRET',data:'PRIVATE_SECRET'}}]);assert(!JSON.stringify(response.response).includes('PRIVATE_SECRET'));
 for(const value of [{message:'PRIVATE_SECRET'},[{jsonrpc:'2.0',id:99,result:'PRIVATE_SECRET'}],[{jsonrpc:'2.0',id:1,result:1,error:{}}]])await assert.rejects(send(value),e=>e.message==='Operator RPC unavailable');
});

test('profile dispatch preserves omitted legacy and rejects accessor or inherited opt-in',()=>{
 assert.equal(operatorApplicationProfile({}),'legacy');assert.equal(operatorApplicationProfile({applicationProfile:'legacy'}),'legacy');assert.equal(operatorApplicationProfile({applicationProfile:'rolling'}),'rolling');
 let calls=0;const accessor=Object.defineProperty({},'applicationProfile',{get(){calls++;return 'rolling';}});
 for(const value of [accessor,Object.create({applicationProfile:'rolling'}),{applicationProfile:'future'}])assert.throws(()=>operatorApplicationProfile(value));assert.equal(calls,0);
});

test('reconciliation verifies retained signed bytes hash and network before receipt access',async()=>{
 const f=reconciliation();f.reads.signed=async()=>false;f.reads.receipt=()=>assert.fail();assert.equal((await reconcileRollingOperation(f)).status,'unresolved');
 for(const patch of [{raw:'unknown'},{raw:''},{phase:'preparing'}]){const x=reconciliation();Object.assign(x.record,patch);x.reads.signed=()=>assert.fail();assert.equal((await reconcileRollingOperation(x)).status,'unresolved');}
});

test('rolling journal refuses historical dynamic claim keys without new salt or writes',async()=>{
 for(const value of [{operations:{'claim-fees-owner-leaf':signed}},{identity:'scope',salt:field(1),operations:{'claim-fees-owner-leaf':signed}},{identity:'scope',salt:field(1),operations:{},escrow:field(3)}]){
  const store=memory(value),before=JSON.stringify(store.read());await assert.rejects(bindRollingJournal(store,'scope',()=>assert.fail()));assert.equal(JSON.stringify(store.read()),before);
 }
 const store=memory();await bindRollingJournal(store,'scope',()=>field(1));await bindRollingJournal(store,'scope',()=>assert.fail());assert.equal(store.read().salt,field(1));
});

test('SDK receipt boundary projects typed hashes before finite canonical reconciliation',async()=>{
 const f=reconciliation(),hash=field(8);
 // Labelled SDK-shaped hash instances; the pinned SDK BlockHash schema is bound
 // in the preparation. Actual SDK constructor acceptance is separately required.
 class TypedHash {toString(){return hash;}}
 const typed={...f.receipt,blockHash:new TypedHash(),error:'PRIVATE_PROVIDER_SENTINEL'};
 f.reads.receipt=async()=>typed;assert.equal((await reconcileRollingOperation(f)).status,'unresolved');
 const projected=projectRollingReceipt(typed);assert.equal(projected.blockHash,hash);assert(!('error'in projected));typed.blockHash={toString:()=>field(99)};
 f.reads.receipt=async()=>projected;assert.equal((await reconcileRollingOperation(f)).status,'succeeded');
});
test('actual CLI actor-loading boundary rejects unsupported rolling commands before secret read',async()=>{
 let reads=0;const read=async file=>{reads++;assert.equal(file,'/private/actor.json');return {address:field(4)};};
 for(const command of ['register','bind','deploy-portal','withdraw-earnings','config','future'])await assert.rejects(readOperatorActor({command,config:config(),actorPath:'/private/actor.json',read}));
 assert.equal(reads,0);
 assert.deepEqual(await readOperatorActor({command:'fees',config:config(),actorPath:'/private/actor.json',read}),{address:field(4)});assert.equal(reads,1);
 await readOperatorActor({command:'register',config:{operatorFile:'/private/actor.json'},read});assert.equal(reads,2);
});
test('local real-proof and unknown public network configurations fail before actor loading',async()=>{
 let reads=0;
 for(const c of [{...config(),development:false},{...config(),development:false,chainId:'1'},{...config(),development:true,chainId:'11155111'}]){
  assert.throws(()=>rollingOperatorConfig(c));
  await assert.rejects(readOperatorActor({command:'deploy-escrow',config:c,read:async()=>{reads++;}}));
 }
 assert.equal(reads,0);
});

test('actual installed SDK receipt types pass the production primitive projection',async()=>{
 const [{MinedTxReceipt,PendingTxReceipt,TxHash},{BlockHash}]=await Promise.all([import('@aztec-labs/stdlib/tx'),import('@aztec-labs/stdlib/block')]);
 const f=reconciliation(),typed=MinedTxReceipt.from({txHash:TxHash.fromString(signed.hash),status:'finalized',executionResult:'success',transactionFee:0n,blockHash:BlockHash.fromString(field(8)),blockNumber:8,slotNumber:8,txIndexInBlock:0,epochNumber:0});
 assert(typed.blockHash instanceof BlockHash);assert(typed.txHash instanceof TxHash);
 f.reads.receipt=async()=>typed;assert.equal((await reconcileRollingOperation(f)).status,'unresolved');
 const projected=projectRollingReceipt(typed);assert.equal(typeof projected.blockHash,'string');assert.equal(typeof projected.txHash,'string');
 f.reads.receipt=async()=>projected;assert.equal((await reconcileRollingOperation(f)).status,'succeeded');
 f.reads.receipt=async()=>projectRollingReceipt(PendingTxReceipt.from({txHash:TxHash.fromString(signed.hash),tx:undefined}));assert.equal((await reconcileRollingOperation(f)).status,'unresolved');
});

test('actual SDK PrivateBok four-argument constructor derives identity without wallet or send',async()=>{
 const {installRollingNativeArtifacts}=await import('../../scripts/testing/rolling-native-artifacts.mjs');
 const adapter=installRollingNativeArtifacts(),oldFetch=globalThis.fetch;let network=0,walletReads=0,bb;
 globalThis.fetch=async()=>{network++;throw Error('CONSTRUCTOR_NETWORK_FORBIDDEN');};
 try{
  const [{loadRollingArtifacts},{loadContractArtifact,getInitializer},{getContractClassFromArtifact,getContractInstanceFromInstantiationParams,computeContractAddressFromInstance},{Contract},{AztecAddress},{Fr},backend]=await Promise.all([
   import('../../prover/rolling-artifacts.mjs'),import('@aztec-labs/stdlib/abi'),import('@aztec-labs/stdlib/contract'),import('@aztec-labs/aztec.js/contracts'),import('@aztec-labs/stdlib/aztec-address'),import('@aztec-labs/foundation/curves/bn254'),import('@aztec-foundation/bb.js'),
  ]);
  bb=backend;await bb.Barretenberg.initSingleton({backend:bb.BackendType.Wasm,skipSrsInit:true,threads:1});
  const [,raw]=loadRollingArtifacts(),artifact=loadContractArtifact(raw),initializer=getInitializer(artifact,'init');
  assert.equal(artifact.name,'PrivateBok');assert.deepEqual(initializer.parameters.map(p=>p.name),['board','operator','l1_chain','version']);
  const args=[AztecAddress.fromStringUnsafe(field(1)),AztecAddress.fromStringUnsafe(field(2)),31337n,3409706519n],deployer=AztecAddress.fromStringUnsafe(field(4)),salt=new Fr(6);
  const wallet=new Proxy({},{get(){walletReads++;throw Error('CONSTRUCTOR_WALLET_FORBIDDEN');}});
  const instance=await Contract.deploy(wallet,artifact,args,'init',{deployer,salt}).getInstance();
  const independent=await getContractInstanceFromInstantiationParams(artifact,{constructorArgs:args,constructorArtifact:'init',deployer,salt});
  assert.equal(instance.address.toString(),independent.address.toString());assert.equal((await computeContractAddressFromInstance(instance)).toString(),instance.address.toString());
  const classId=(await getContractClassFromArtifact(artifact)).id.toString();assert.equal(instance.originalContractClassId.toString(),classId);assert.equal(instance.currentContractClassId.toString(),classId);assert.equal(instance.deployer.toString(),deployer.toString());
  await assert.rejects(Contract.deploy(wallet,artifact,[...args,deployer],'init',{deployer,salt}).getInstance(),/expects 4 argument/);
  const changed=await Contract.deploy(wallet,artifact,[args[0],AztecAddress.fromStringUnsafe(field(3)),...args.slice(2)],'init',{deployer,salt}).getInstance();assert.notEqual(changed.address.toString(),instance.address.toString());
  assert.equal(walletReads,0);assert.equal(network,0);assert.deepEqual(await rollingPxeOptions(true,()=>assert.fail()),{proverEnabled:false});adapter.verify();
 }finally{
  try{if(bb){await bb.Barretenberg.destroySingleton();bb.BarretenbergSync.destroySingleton();}}finally{globalThis.fetch=oldFetch;adapter.close();}
 }
 assert.equal(adapter.observation().closed,true);
});

test('actual SDK custom transport authenticates only the loopback operator HTTP route and drains',async()=>{
 const [{createProverServer},{createAztecNodeClient},{jsonStringify},{createHash},{once}]=await Promise.all([import('../../prover/server.mjs'),import('../../shared/aztec-node-client.mjs'),import('@aztec-labs/foundation/json-rpc'),import('node:crypto'),import('node:events')]);
 const key='b'.repeat(64),digest=createHash('sha256').update(key,'ascii').digest('hex');let handled=0;
 // Actual production authentication/server boundary; the downstream public
 // handler is a labelled fixture. This does not qualify a real node or inspector.
 const server=createProverServer({serviceMode:'query-only',operatorAuthSha256:digest,privateQuery:{handle:async(req,res)=>{
  const chunks=[];let size=0;for await(const c of req){size+=c.length;assert(size<4096);chunks.push(c);}
  const batch=JSON.parse(Buffer.concat(chunks).toString());assert.equal(req.url,'/v1/node');assert.equal(req.method,'POST');assert.equal(batch.length,1);assert.equal(batch[0].method,'aztec_getBlockNumber');assert.deepEqual(batch[0].params,[]);handled++;
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify([{jsonrpc:'2.0',id:batch[0].id,result:8}]));
 }}});
 let endpoint;
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');endpoint='http://127.0.0.1:'+server.address().port+'/v1/node';
  const goodFetch=operatorNodeFetch({endpoint,key,serialize:jsonStringify});
  const good=createAztecNodeClient(endpoint,{fetch:goodFetch});assert.equal(await good.getBlockNumber(),8);assert.equal(handled,1);
  for(const credential of [undefined,'c'.repeat(64)]){
   const denied=createAztecNodeClient(endpoint,{fetch:operatorNodeFetch({endpoint,key:credential,serialize:jsonStringify})});
   await assert.rejects(denied.getBlockNumber(),error=>!String(error).includes(key));
  }
  assert.equal(handled,1);await assert.rejects(goodFetch(endpoint+'/other',rpcBody));assert.equal(handled,1);
 }finally{await server.closeAndDrain();}
 assert.equal(server.listening,false);
 await assert.rejects(operatorNodeFetch({endpoint,key,serialize:jsonStringify})(endpoint,rpcBody),/Operator RPC unavailable/);
 assert.equal(handled,1);
});

test('Sepolia seed fixed plan captures fields and rejects inherited accessors foreign chains and excessive gas',async()=>{
 const {captureSepoliaLiquidityPlan,sepoliaLiquidityTransactions}=await import('../operations.mjs');
 const p=seedPlan(),captured=captureSepoliaLiquidityPlan(p);p.codeHashes.fee='0x'+'3'.repeat(64);assert.notEqual(captured.codeHashes.fee,p.codeHashes.fee);
 let reads=0;for(const bad of [Object.create(seedPlan()),{...seedPlan(),chainId:'31337'},{...seedPlan(),ethereumUrl:'https://name:password@example.org'},{...seedPlan(),unknown:'x'},{...seedPlan(),gasLimits:{...seedPlan().gasLimits,'seed-usdc-fee':'60000001'}},Object.defineProperty(seedPlan(),'owner',{get(){reads++;return 'x';}})])assert.throws(()=>captureSepoliaLiquidityPlan(bad));
 assert.equal(reads,0);const steps=await sepoliaLiquidityTransactions(seedPlan());assert.equal(steps[0].name,'inventory-usdc');assert.equal(steps[4].name,'seed-weth-fee');assert(steps.every(s=>s.chainId==='11155111'));assert.equal(steps.find(s=>s.name==='seed-usdc-fee').pool.minimum0,'47520');
});
function seedPlan(){
 const owner='0x'+'1'.repeat(40),inventoryOwner='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64);
 return {schemaVersion:1,campaign:'sepolia-seed-controlled-20261014',chainId:'11155111',ethereumUrl:'https://example.org/',owner,inventoryOwner,ownerNonce:10,inventoryNonce:20,expiresAt:2000000000,cleanupExpiresAt:2000086400,feeAmount:'10000000000000000000',usdcAmount:'48000',ethAmount:'1000000000000',inventoryEth:'0',includeUsdcPool:true,includeWethPool:true,gasLimits:{'inventory-usdc':'150000','approve-fee':'150000','approve-usdc':'150000','seed-usdc-fee':'40000000','seed-weth-fee':'40000000','revoke-fee':'150000','revoke-usdc':'150000'},maxFeePerGas:'1100000',maxPriorityFeePerGas:'1000000',futureReserveWei:'132000000000000',usdcImplementation:'0xda317c1d3e835dd5f1be459006471acaa1289068',usdcImplementationCodeHash:'0x'+'b'.repeat(64),codeHashes:Object.fromEntries(['factory','positions','fee','usdc','weth'].map(n=>[n,hash]))};
}
test('Sepolia seed actual signed transaction binds every fee nonce recipient calldata and value field',async()=>{
 const {Wallet,keccak256}=await import('ethers'),{sepoliaLiquidityTransactions,matchSepoliaLiquiditySigned}=await import('../operations.mjs');const wallet=new Wallet('0x'+'41'.repeat(32)),p={...seedPlan(),inventoryOwner:wallet.address.toLowerCase()},step=(await sepoliaLiquidityTransactions(p))[0];
 const tx={type:2,chainId:11155111,nonce:step.nonce,to:step.to,data:step.data,value:BigInt(step.value),gasLimit:BigInt(step.gasLimit),maxFeePerGas:BigInt(step.maxFeePerGas),maxPriorityFeePerGas:BigInt(step.maxPriorityFeePerGas),accessList:[]};
 const signed=async x=>{const raw=await wallet.signTransaction(x);return {raw:raw.slice(2),hash:keccak256(raw)};};assert(await matchSepoliaLiquiditySigned(await signed(tx),step));
 for(const change of [{chainId:31337},{nonce:step.nonce+1},{to:p.owner},{data:'0x'},{value:1n},{gasLimit:tx.gasLimit+1n},{maxFeePerGas:tx.maxFeePerGas+1n},{maxPriorityFeePerGas:0n},{accessList:[{address:p.owner,storageKeys:[]}]}])assert.equal(await matchSepoliaLiquiditySigned(await signed({...tx,...change}),step),false);
});
test('Sepolia seed intent and exact signed bytes precede sole send; uncertain restart never signs again',async()=>{
 const {Wallet,keccak256}=await import('ethers'),{runSepoliaLiquidityStage}=await import('../operations.mjs');const wallet=new Wallet('0x'+'42'.repeat(32)),plan={...seedPlan(),inventoryOwner:wallet.address.toLowerCase()};let value={operations:{}},signs=0,sends=0,preflights=0;
 const store={read:()=>value,write:async next=>{value=structuredClone(next);}};
 const ports={preflight:async()=>{preflights++;},sign:async s=>{signs++;assert.equal(value.operations[s.name].phase,'preparing');assert.equal(value.seedLiquidity.entered[0],s.name);return wallet.signTransaction({type:2,chainId:11155111,nonce:s.nonce,to:s.to,data:s.data,value:s.value,gasLimit:s.gasLimit,maxFeePerGas:s.maxFeePerGas,maxPriorityFeePerGas:s.maxPriorityFeePerGas});},broadcast:async raw=>{sends++;assert.equal(value.operations['inventory-usdc'].phase,'submission-unknown');assert.equal(value.operations['inventory-usdc'].hash,keccak256(raw));throw Error('unknown');},receipt:async()=>null};
 const args={plan,stage:'inventory-usdc',store,ports,now:()=>0};assert.equal((await runSepoliaLiquidityStage(args)).status,'unresolved');const original=JSON.stringify(value);assert.equal((await runSepoliaLiquidityStage(args)).status,'unresolved');assert.equal(JSON.stringify(value),original);assert.deepEqual([preflights,signs,sends],[1,1,1]);
 delete value.operations['inventory-usdc'];await assert.rejects(runSepoliaLiquidityStage(args),/inventory/);assert.equal(sends,1);
});
test('Sepolia seed preparing loss expiry and unknown preceding stage never advance or load a key',async()=>{
 const {runSepoliaLiquidityStage}=await import('../operations.mjs');let value={operations:{}},calls=0;const store={read:()=>value,write:async n=>{value=structuredClone(n);}},ports={preflight:async()=>{calls++;throw Error('simulation failed');}};
 await assert.rejects(runSepoliaLiquidityStage({plan:seedPlan(),stage:'inventory-usdc',store,ports,now:()=>2000000000000}));assert.equal(calls,0);
 await assert.rejects(runSepoliaLiquidityStage({plan:seedPlan(),stage:'approve-fee',store,ports,now:()=>0}));assert.equal(calls,0);
 await assert.rejects(runSepoliaLiquidityStage({plan:seedPlan(),stage:'inventory-usdc',store,ports,now:()=>0}),/simulation/);assert.deepEqual(value.seedLiquidity.entered,[]);assert.equal(calls,1);
});

test('Sepolia seed finalized mint after expiry retains bounded exact zero-allowance cleanup authority',async()=>{
 const {Wallet,keccak256}=await import('ethers'),{captureSepoliaLiquidityPlan,sepoliaLiquidityTransactions,runSepoliaLiquidityStage}=await import('../operations.mjs');
 for(const mintStatus of [1,0]){
  const owner=new Wallet('0x'+'51'.repeat(32)),inventory=new Wallet('0x'+'52'.repeat(32)),plan=captureSepoliaLiquidityPlan({...seedPlan(),owner:owner.address.toLowerCase(),inventoryOwner:inventory.address.toLowerCase()}),steps=await sepoliaLiquidityTransactions(plan),identity=JSON.stringify(plan),{createHash}=await import('node:crypto');
  let value={seedLiquidity:{schemaVersion:1,binding:createHash('sha256').update(identity).digest('hex'),entered:[]},operations:{}};const receipts=new Map();
  async function sign(s){return (s.from===plan.owner?owner:inventory).signTransaction({type:2,chainId:11155111,nonce:s.nonce,to:s.to,data:s.data,value:s.value,gasLimit:s.gasLimit,maxFeePerGas:s.maxFeePerGas,maxPriorityFeePerGas:s.maxPriorityFeePerGas});}
  for(const step of steps.slice(0,steps.findIndex(s=>s.name==='revoke-fee'))){const raw=await sign(step),hash=keccak256(raw);value.seedLiquidity.entered.push(step.name);value.operations[step.name]={schemaVersion:1,policy:'reconcile-only',identity:identity+':'+step.name,phase:'submission-unknown',raw:raw.slice(2),hash};receipts.set(hash,{hash,status:step.pool?mintStatus:1,blockNumber:10,blockHash:'0x'+'a'.repeat(64)});}
  let signed=0,sent=0;const store={read:()=>value,write:async n=>{value=structuredClone(n);}},ports={receipt:async h=>receipts.get(h)??null,block:async()=>({hash:'0x'+'a'.repeat(64)}),head:async tag=>{assert.equal(tag,'finalized');return{number:11};},effect:async()=>true,preflight:async()=>{},sign:async s=>{signed++;return sign(s);},broadcast:async()=>{sent++;}};
  const args={plan,stage:'revoke-fee',store,ports,now:()=>plan.expiresAt*1000+1};assert.equal((await runSepoliaLiquidityStage(args)).status,'unresolved');assert.deepEqual([signed,sent],[1,1]);
  assert.equal((await runSepoliaLiquidityStage({...args,now:()=>plan.cleanupExpiresAt*1000+1})).status,'unresolved');assert.deepEqual([signed,sent],[1,1]);
 }
});

// Controlled RPC results with real ethers signatures; no network or funded key.
async function seedResolutionFixture(){
 const {Wallet,keccak256}=await import('ethers'),ops=await import('../operations.mjs');
 const owner=new Wallet('0x'+'61'.repeat(32)),inventory=new Wallet('0x'+'62'.repeat(32));
 const plan=ops.captureSepoliaLiquidityPlan({...seedPlan(),owner:owner.address.toLowerCase(),inventoryOwner:inventory.address.toLowerCase()}),steps=await ops.sepoliaLiquidityTransactions(plan),identity=JSON.stringify(plan),{createHash}=await import('node:crypto');
 const binding=createHash('sha256').update(identity).digest('hex'),anchor='0x'+'a'.repeat(64);let original={seedLiquidity:{schemaVersion:1,binding,entered:[]},operations:{}},saved={operations:{}},remaining={operations:{}};
 const receipts=new Map(),blockHashes=new Map(),signedSteps=[],broadcasts=[];let finalized=11,canonical=anchor,validEffect=true,preflights=0;
 const sign=s=>(s.from===plan.owner?owner:inventory).signTransaction({type:2,chainId:11155111,nonce:s.nonce,to:s.to,data:s.data,value:s.value,gasLimit:s.gasLimit,maxFeePerGas:s.maxFeePerGas,maxPriorityFeePerGas:s.maxPriorityFeePerGas});
 for(const step of steps.slice(0,steps.findIndex(s=>s.name==='approve-usdc')+1)){
  const raw=await sign(step),hash=keccak256(raw);original.seedLiquidity.entered.push(step.name);original.operations[step.name]={schemaVersion:1,policy:'reconcile-only',identity:identity+':'+step.name,phase:'submission-unknown',raw:raw.slice(2),hash};
  if(step.name!=='approve-usdc')receipts.set(hash,{hash,status:1,blockNumber:10,blockHash:anchor});
 }
 const resolution={schemaVersion:1,originalPlanSha256:binding,originalTransactionHash:original.operations['approve-usdc'].hash,expiresAt:plan.expiresAt+60};
 const ports={receipt:async h=>receipts.get(h)??null,block:async n=>({hash:blockHashes.get(n)??canonical}),head:async tag=>{assert.equal(tag,'finalized');return {number:finalized};},effect:async()=>validEffect,cancellationEffect:async()=>validEffect,
  preflightCancellation:async()=>{preflights++;},preflightContinuation:async()=>{preflights++;},preflight:async()=>{preflights++;},sign:async s=>{signedSteps.push(s);return sign(s);},broadcast:async raw=>{broadcasts.push(raw);}};
 const args={plan,resolution,originalStore:{read:()=>original},store:{read:()=>saved,write:async value=>{saved=structuredClone(value);}},ports,now:()=>plan.expiresAt*1000};
 const continuation=()=>({...args,cancellationStore:args.store,store:{read:()=>remaining,write:async value=>{remaining=structuredClone(value);}},remainingPlan:{...plan,campaign:'sepolia-seed-resolved-controlled',ownerNonce:steps.find(s=>s.name==='approve-usdc').nonce+1,expiresAt:plan.expiresAt+600,cleanupExpiresAt:plan.cleanupExpiresAt+600}});
 const confirm=(hash,status=1,blockNumber=10)=>receipts.set(hash,{hash,status,blockNumber,blockHash:anchor});
 return {ops,args,continuation,original,receipts,signedSteps,broadcasts,confirm,get saved(){return saved;},get remaining(){return remaining;},get preflights(){return preflights;},setFinalized:n=>finalized=n,setCanonical:(h,n)=>n===undefined?canonical=h:blockHashes.set(n,h),setEffect:b=>validEffect=b};
}
test('Seed cancellation uses exact20percent bump self zero21000 and never replays unknown original or cancellation',async()=>{
 const f=await seedResolutionFixture(),original=JSON.stringify(f.original);await f.ops.runSepoliaLiquidityCancellation(f.args);
 assert.equal(f.signedSteps.length,1);const s=f.signedSteps[0],old=(await f.ops.sepoliaLiquidityTransactions(f.args.plan)).find(x=>x.name==='approve-usdc');
 assert.deepEqual([s.from,s.to,s.nonce,s.value,s.data,s.gasLimit],[old.from,old.from,old.nonce,'0','0x','21000']);assert.equal(s.maxFeePerGas,String((BigInt(old.maxFeePerGas)*120n+99n)/100n));assert.equal(s.maxPriorityFeePerGas,String((BigInt(old.maxPriorityFeePerGas)*120n+99n)/100n));
 await f.ops.runSepoliaLiquidityCancellation({...f.args,now:()=>Number.MAX_SAFE_INTEGER});assert.equal(f.broadcasts.length,1);assert.equal(f.signedSteps.length,1);assert.equal(JSON.stringify(f.original),original);
});
test('Seed original winner before cancellation requires zero signatures and carries only mint/revokes',async()=>{
 const f=await seedResolutionFixture();f.confirm(f.args.resolution.originalTransactionHash);
 assert.equal((await f.ops.runSepoliaLiquidityCancellation(f.args)).winner,'original');assert.equal(f.signedSteps.length,0);
 const next=f.continuation();await f.ops.runSepoliaLiquidityContinuation({...next,stage:'seed-usdc-fee'});
 assert.equal(f.signedSteps.length,1);assert.equal(f.signedSteps[0].name,'seed-usdc-fee');assert.equal(f.signedSteps[0].nonce,next.remainingPlan.ownerNonce);
 for(const stage of ['inventory-usdc','approve-fee','approve-usdc'])await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...next,stage}));assert.equal(f.broadcasts.length,1);
});
test('Seed original wins after cancellation attempt and neither signed operation is replayed',async()=>{
 const f=await seedResolutionFixture();f.args.ports.broadcast=async raw=>{f.broadcasts.push(raw);f.confirm(f.args.resolution.originalTransactionHash);throw Error('response lost');};
 const result=await f.ops.runSepoliaLiquidityCancellation(f.args);assert.equal(result.winner,'original');assert.equal(result.status,'succeeded');
 await f.ops.runSepoliaLiquidityCancellation(f.args);assert.equal(f.broadcasts.length,1);
});
test('Seed cancellation finalized winner carries exact prefix and only remaining approval with fresh nonce',async()=>{
 const f=await seedResolutionFixture(),original=JSON.stringify(f.original);await f.ops.runSepoliaLiquidityCancellation(f.args);f.confirm(f.saved.operations['relay-funding'].hash);
 assert.equal((await f.ops.runSepoliaLiquidityCancellation(f.args)).winner,'cancellation');const next=f.continuation();await f.ops.runSepoliaLiquidityContinuation({...next,stage:'approve-usdc'});
 assert.equal(f.signedSteps[1].name,'approve-usdc');assert.equal(f.signedSteps[1].nonce,next.remainingPlan.ownerNonce);assert.deepEqual(f.remaining.seedLiquidity.entered,['approve-usdc']);assert.equal(JSON.stringify(f.original),original);
 await f.ops.runSepoliaLiquidityContinuation({...next,stage:'approve-usdc'});assert.equal(f.signedSteps.length,2);
});
test('Seed cancellation nonfinal reorg failed effects and conflicting winners never admit continuation',async()=>{
 for(const failure of ['nonfinal','reorg','effect','failed','both']){
  const f=await seedResolutionFixture();await f.ops.runSepoliaLiquidityCancellation(f.args);f.confirm(f.saved.operations['relay-funding'].hash,failure==='failed'?0:1,12);f.setFinalized(failure==='nonfinal'?11:12);
  if(failure==='reorg')f.setCanonical('0x'+'b'.repeat(64),12);if(failure==='effect')f.args.ports.cancellationEffect=async()=>false;if(failure==='both')f.confirm(f.args.resolution.originalTransactionHash);
  await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...f.continuation(),stage:'approve-usdc'}));assert.equal(f.signedSteps.length,1);
 }
});
test('Seed cancellation rejects altered identity missing prefix later entered stage expired authority before sign',async()=>{
 for(const change of ['plan','hash','prefix','later','expired','fee','zero-tip']){
  const f=await seedResolutionFixture();let args={...f.args};
  if(change==='plan')args.resolution={...args.resolution,originalPlanSha256:'b'.repeat(64)};
  if(change==='hash')args.resolution={...args.resolution,originalTransactionHash:'0x'+'b'.repeat(64)};
  if(change==='prefix')f.receipts.clear();if(change==='later')f.original.seedLiquidity.entered.push('seed-usdc-fee');
  if(change==='expired')args.now=()=>args.resolution.expiresAt*1000;
  if(change==='fee')args.plan={...args.plan,maxFeePerGas:'5000000000'};
  if(change==='zero-tip')args.plan={...args.plan,maxPriorityFeePerGas:'0'};
  await assert.rejects(f.ops.runSepoliaLiquidityCancellation(args));assert.equal(f.signedSteps.length,0);assert.equal(f.broadcasts.length,0);
 }
});
test('Seed cancellation preparing or broadcast failure stays reconcile only across reentry',async()=>{
 for(const mode of ['sign','broadcast']){
  const f=await seedResolutionFixture();if(mode==='sign')f.args.ports.sign=async()=>{throw false;};else f.args.ports.broadcast=async raw=>{f.broadcasts.push(raw);throw null;};
  await f.ops.runSepoliaLiquidityCancellation(f.args);const saved=JSON.stringify(f.saved);await f.ops.runSepoliaLiquidityCancellation(f.args);assert.equal(JSON.stringify(f.saved),saved);assert.equal(f.preflights,1);assert.equal(f.broadcasts.length,mode==='sign'?0:1);
 }
});
test('Seed continuation rejects economic scope changed nonce skipped prefix and missing original signed bytes',async()=>{
 for(const change of ['amount','nonce','scope','missing','skip']){
  const f=await seedResolutionFixture();f.confirm(f.args.resolution.originalTransactionHash);const next=f.continuation();
  if(change==='amount')next.remainingPlan.feeAmount='1';if(change==='nonce')next.remainingPlan.ownerNonce++;
  if(change==='scope')next.remainingPlan.inventoryOwner='0x'+'9'.repeat(40);if(change==='missing')delete f.original.operations['approve-fee'].raw;
  await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...next,stage:change==='skip'?'revoke-fee':'seed-usdc-fee'}));assert.equal(f.signedSteps.length,0);
 }
});
test('Seed resolved continuation completes bounded original economics without replaying prefix',async()=>{
 for(const winner of ['original','cancellation']){
  const f=await seedResolutionFixture(),original=JSON.stringify(f.original);
  if(winner==='original')f.confirm(f.args.resolution.originalTransactionHash);else{await f.ops.runSepoliaLiquidityCancellation(f.args);f.confirm(f.saved.operations['relay-funding'].hash);}
  const next=f.continuation(),names=[...(winner==='cancellation'?['approve-usdc']:[]),'seed-usdc-fee','seed-weth-fee','revoke-fee','revoke-usdc'];
  for(const stage of names){await f.ops.runSepoliaLiquidityContinuation({...next,stage});f.confirm(f.remaining.operations[stage].hash);}
  assert.deepEqual(f.remaining.seedLiquidity.entered,names);assert.equal(JSON.stringify(f.original),original);
  assert.deepEqual(f.signedSteps.filter(s=>s.to!==s.from).map(s=>s.name),names);
  assert.deepEqual(f.signedSteps.filter(s=>s.to!==s.from).map(s=>s.nonce),names.map((_,i)=>next.remainingPlan.ownerNonce+i));
  await f.ops.runSepoliaLiquidityContinuation({...next,stage:'revoke-usdc',now:()=>Number.MAX_SAFE_INTEGER});assert.equal(f.broadcasts.length,names.length+(winner==='cancellation'?1:0));
 }
});
test('Seed cancellation rejects changed retained signed cancellation bytes even when original wins',async()=>{
 const f=await seedResolutionFixture();await f.ops.runSepoliaLiquidityCancellation(f.args);
 Object.assign(f.saved.operations['relay-funding'],{raw:f.original.operations['approve-usdc'].raw,hash:f.original.operations['approve-usdc'].hash});
 f.confirm(f.args.resolution.originalTransactionHash);await assert.rejects(f.ops.runSepoliaLiquidityCancellation(f.args));assert.equal(f.broadcasts.length,1);
});
test('Seed continuation current allowance or balance failure blocks signing while keeping original prefix intact',async()=>{
 const f=await seedResolutionFixture();f.confirm(f.args.resolution.originalTransactionHash);const original=JSON.stringify(f.original);
 f.args.ports.preflightContinuation=async()=>{throw Error('current allowance mismatch');};await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...f.continuation(),stage:'seed-usdc-fee'}),/allowance/);
 assert.equal(f.signedSteps.length,0);assert.equal(JSON.stringify(f.original),original);
});

test('Seed broadcast diagnostics retain only finite data descriptors, never private exception content',async()=>{
 const {seedBroadcastFailure}=await import('../operations.mjs');
 assert.deepEqual(seedBroadcastFailure({code:'UNKNOWN_ERROR',info:{error:{code:-32005,message:'secret'},response:{statusCode:429}},message:'secret',payload:{raw:'secret'}}),{state:'rejected',httpStatus:429,rpcCode:-32005,ethersCode:'UNKNOWN_ERROR'});
 let reads=0;const hostile={get code(){reads++;throw null;},get info(){reads++;throw false;},get httpStatus(){reads++;throw 0;}};
 for(const value of [hostile,null,false,0,'secret',{code:'PRIVATE_CODE',httpStatus:999,info:{error:{code:123}}}])assert.deepEqual(seedBroadcastFailure(value),{state:'rejected',httpStatus:null,rpcCode:null,ethersCode:'unknown'});
 assert.equal(reads,0);
});
test('Seed sole broadcast records prepared and terminal classification without changing unknown reconciliation',async()=>{
 for(const outcome of ['returned','rejected','falsy']){
  const store=memory();let sends=0,prepares=0;
  const args={store,name:'relay-funding',identity:'seed',observeBroadcast:true,execute:async({submit})=>{prepares++;await submit(signed,async()=>{sends++;assert.equal(store.read().operations['relay-funding'].broadcastAttempt.state,'prepared');if(outcome==='rejected')throw {code:'SERVER_ERROR',httpStatus:503,info:{error:{code:-32603}},message:'private'};if(outcome==='falsy')throw false;return 'normal-result';});},reconcile:async()=>({status:'unresolved',canonical:false})};
  await onceAztecOperation(args);const record=store.read().operations['relay-funding'];assert.equal(record.broadcastAttempt.state,outcome==='returned'?'returned':'rejected');assert.equal(record.hash,signed.hash);assert.equal(record.raw,signed.raw);assert(!JSON.stringify(record).includes('private'));
  const retained=JSON.stringify(store.read());await onceAztecOperation(args);assert.equal(JSON.stringify(store.read()),retained);assert.equal(prepares,1);assert.equal(sends,1);
 }
});
test('Seed diagnostic write failure leaves durable prepared intent and never repeats broadcast',async()=>{
 const store=memory(),write=store.write;let writes=0,sends=0;
 store.write=async value=>{if(++writes===3)throw Error('disk');await write(value);};
 const args={store,name:'relay-funding',identity:'seed',observeBroadcast:true,execute:({submit})=>submit(signed,async()=>{sends++;throw {code:'TIMEOUT'};}),reconcile:async()=>({status:'unresolved'})};
 await onceAztecOperation(args);assert.equal(store.read().operations['relay-funding'].broadcastAttempt.state,'prepared');await onceAztecOperation(args);assert.equal(sends,1);
});
test('Seed Ethereum transport exposes only numeric HTTP failure status without retry',async()=>{
 const {operatorEthereumRequest,seedBroadcastFailure}=await import('../operations.mjs');let calls=0;
 class Request{constructor(url){this.url=url;this.getUrlFunc=async()=>{calls++;return {statusCode:429,body:new Uint8Array()};};}setThrottleParams(value){assert.equal(value.maxAttempts,1);}}
 const request=operatorEthereumRequest(Request,'https://example.invalid/');
 await assert.rejects(request.getUrlFunc(request),error=>{assert.deepEqual(seedBroadcastFailure(error),{state:'rejected',httpStatus:429,rpcCode:null,ethersCode:'unknown'});assert.equal(error.message,'Operator Ethereum RPC unavailable');return true;});assert.equal(calls,1);assert.equal(request.retryFunc(),false);
});

async function seedSuccessorFixture(){
 const f=await seedResolutionFixture();await f.ops.runSepoliaLiquidityCancellation(f.args);
 const {createHash}=await import('node:crypto'),first=f.saved.operations['relay-funding'];let successorState={operations:{}};
 const successor={schemaVersion:1,originalPlanSha256:f.args.resolution.originalPlanSha256,originalTransactionHash:f.args.resolution.originalTransactionHash,cancellationTransactionHash:first.hash,cancellationIdentitySha256:createHash('sha256').update(first.identity).digest('hex'),expiresAt:f.args.resolution.expiresAt+600,maxFeePerGas:'3000000',maxPriorityFeePerGas:'2000000'};
 const store={read:()=>successorState,write:async value=>{successorState=structuredClone(value);}};
 const args={...f.args,cancellationStore:f.args.store,store,successor};
 return {...f,args,first,originalSnapshot:JSON.stringify(f.original),firstSnapshot:JSON.stringify(f.saved),get successorState(){return successorState;},continuation:()=>({...f.continuation(),successor,successorStore:store}),originalFixture:f};
}
test('Seed successor explicit fees bind both retained intents and persist signed bytes before its only transport',async()=>{
 const f=await seedSuccessorFixture(),send=f.args.ports.broadcast;
 f.args.ports.broadcast=async raw=>{const r=f.successorState.operations['relay-funding'];assert.equal(r.phase,'submission-unknown');assert.equal(r.raw,raw.slice(2));assert.equal(r.deployment.originalHash,f.args.successor.originalTransactionHash);assert.equal(r.deployment.cancellationHash,f.first.hash);return send(raw);};
 assert.equal((await f.ops.runSepoliaLiquiditySuccessor(f.args)).status,'unresolved');
 const s=f.signedSteps[1];assert.deepEqual([s.chainId,s.from,s.to,s.nonce,s.value,s.data,s.gasLimit,s.maxFeePerGas,s.maxPriorityFeePerGas],['11155111',f.args.plan.owner,f.args.plan.owner,f.signedSteps[0].nonce,'0','0x','21000','3000000','2000000']);
 const saved=JSON.stringify(f.successorState);await f.ops.runSepoliaLiquiditySuccessor({...f.args,now:()=>Number.MAX_SAFE_INTEGER});assert.equal(JSON.stringify(f.successorState),saved);assert.equal(f.signedSteps.length,2);assert.equal(f.broadcasts.length,2);assert.equal(JSON.stringify(f.original),f.originalSnapshot);assert.equal(JSON.stringify(f.originalFixture.saved),f.firstSnapshot);
});
test('Seed successor rejects malformed binding or authority before any second signature',async()=>{
 for(const change of ['plan','original-hash','first-hash','first-identity','extra','same-fee','same-tip','cap','tip-cap','expired','far-future','first-preparing','first-bytes','original-bytes','original-journal','first-journal']){
  const f=await seedSuccessorFixture(),s={...f.args.successor};let args={...f.args,successor:s};
  if(change==='plan')s.originalPlanSha256='b'.repeat(64);if(change==='original-hash')s.originalTransactionHash='0x'+'b'.repeat(64);if(change==='first-hash')s.cancellationTransactionHash='0x'+'b'.repeat(64);if(change==='first-identity')s.cancellationIdentitySha256='b'.repeat(64);if(change==='extra')s.nonce=99;
  if(change==='same-fee')s.maxFeePerGas=f.signedSteps[0].maxFeePerGas;if(change==='same-tip')s.maxPriorityFeePerGas=f.signedSteps[0].maxPriorityFeePerGas;if(change==='cap')s.maxFeePerGas='5000000000';if(change==='tip-cap')s.maxPriorityFeePerGas='3000001';
  if(change==='expired')args.now=()=>s.expiresAt*1000;if(change==='far-future')s.expiresAt=Math.floor(args.now()/1000)+86401;
  if(change==='first-preparing')f.first.phase='preparing';if(change==='first-bytes')f.first.raw=f.original.operations['approve-usdc'].raw;if(change==='original-bytes')f.original.operations['approve-usdc'].raw=f.first.raw;if(change==='original-journal')f.original.operations['approve-usdc'].journalIdentity='changed';if(change==='first-journal')f.first.journalIdentity='changed';
  await assert.rejects(f.ops.runSepoliaLiquiditySuccessor(args),change);assert.equal(f.signedSteps.length,1,change);assert.equal(f.broadcasts.length,1,change);
 }
});
test('Seed successor reconciles any of three finalized winners without replay and continues only remaining stages',async()=>{
 for(const winner of ['original','cancellation','successor']){
  const f=await seedSuccessorFixture();await f.ops.runSepoliaLiquiditySuccessor(f.args);
  const hashes={original:f.args.successor.originalTransactionHash,cancellation:f.first.hash,successor:f.successorState.operations['relay-funding'].hash};f.confirm(hashes[winner]);
  const r=await f.ops.runSepoliaLiquiditySuccessor(f.args);assert.equal(r.winner,winner);assert.equal(r.status,'succeeded');assert.equal(r.transactionHash,hashes[winner]);assert.equal(f.signedSteps.length,2);
  const next=f.continuation(),stage=winner==='original'?'seed-usdc-fee':'approve-usdc';await f.ops.runSepoliaLiquidityContinuation({...next,stage});assert.equal(f.signedSteps[2].name,stage);assert.equal(f.signedSteps[2].nonce,next.remainingPlan.ownerNonce);
  for(const forbidden of ['inventory-usdc','approve-fee',...(winner==='original'?['approve-usdc']:[])])await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...next,stage:forbidden}));
  assert.equal(JSON.stringify(f.original),f.originalSnapshot);assert.equal(JSON.stringify(f.originalFixture.saved),f.firstSnapshot);
 }
});
test('Seed successor original or first cancellation wins before signing including preflight races',async()=>{
 for(const winner of ['original','cancellation'])for(const moment of ['before','preflight']){
  const f=await seedSuccessorFixture(),hash=winner==='original'?f.args.successor.originalTransactionHash:f.first.hash;
  if(moment==='before')f.confirm(hash);else f.args.ports.preflightCancellation=async()=>{f.confirm(hash);};
  const r=await f.ops.runSepoliaLiquiditySuccessor(f.args);assert.equal(r.winner,winner);assert.equal(r.status,'succeeded');assert.equal(f.signedSteps.length,1);assert.equal(f.broadcasts.length,1);assert.deepEqual(f.successorState,{operations:{}});
 }
});
test('Seed successor lost acknowledgement reconciles raced original allowance and never relabels it cancellation',async()=>{
 const f=await seedSuccessorFixture();f.args.ports.broadcast=async raw=>{f.broadcasts.push(raw);f.confirm(f.args.successor.originalTransactionHash);throw Error('lost response');};
 let originalEffect=0;f.args.ports.effect=async step=>{if(step.name==='approve-usdc')originalEffect++;return true;};
 const r=await f.ops.runSepoliaLiquiditySuccessor(f.args);assert.equal(r.winner,'original');assert.equal(r.status,'succeeded');assert(originalEffect>0);
 f.args.ports.effect=async step=>step.name!=='approve-usdc';assert.equal((await f.ops.runSepoliaLiquiditySuccessor(f.args)).canonical,false);await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...f.continuation(),stage:'seed-usdc-fee'}));assert.equal(f.signedSteps.length,2);
});
test('Seed successor preparing and transport failures are fenced even after deadline expiry',async()=>{
 for(const failure of ['sign','broadcast']){
  const f=await seedSuccessorFixture();let attempts=0;
  if(failure==='sign')f.args.ports.sign=async()=>{attempts++;assert.equal(f.successorState.operations['relay-funding'].phase,'preparing');throw Error();};
  else f.args.ports.broadcast=async()=>{attempts++;assert.equal(f.successorState.operations['relay-funding'].phase,'submission-unknown');throw Error();};
  await f.ops.runSepoliaLiquiditySuccessor(f.args);const snapshot=JSON.stringify(f.successorState);
  await f.ops.runSepoliaLiquiditySuccessor({...f.args,now:()=>Number.MAX_SAFE_INTEGER});assert.equal(attempts,1);assert.equal(JSON.stringify(f.successorState),snapshot);
 }
});
test('Seed successor failed receipts reorg nonfinal wrong effect and conflicting winners block continuation',async()=>{
 for(const failure of ['failed','reorg','nonfinal','effect','original-conflict','first-conflict','changed-successor','changed-first']){
  const f=await seedSuccessorFixture();await f.ops.runSepoliaLiquiditySuccessor(f.args);const r=f.successorState.operations['relay-funding'];f.confirm(r.hash,failure==='failed'?0:1,12);f.setFinalized(failure==='nonfinal'?11:12);
  if(failure==='reorg')f.setCanonical('0x'+'b'.repeat(64),12);if(failure==='effect')f.args.ports.cancellationEffect=async()=>false;
  if(failure==='original-conflict')f.confirm(f.args.successor.originalTransactionHash);if(failure==='first-conflict')f.confirm(f.first.hash);
  if(failure==='changed-successor')r.raw=f.first.raw;if(failure==='changed-first')f.first.raw=r.raw;
  await assert.rejects(f.ops.runSepoliaLiquidityContinuation({...f.continuation(),stage:'approve-usdc'}),failure);assert.equal(f.signedSteps.length,2);
  if(failure==='failed'){const result=await f.ops.runSepoliaLiquiditySuccessor(f.args);assert.equal(result.status,'failed');assert.equal(result.winner,'successor');assert.equal(result.canonical,true);}
 }
});

// Exact-dispatch unit cases use synthetic signatures and chain doubles only.
// The production owner separately restricts the public entrypoint to the single
// retained project sender/nonce/hash; no real signed transaction is a fixture.
async function exactDispatchFixture(){
 const f=await seedSuccessorFixture();await f.ops.runSepoliaLiquiditySuccessor(f.args);
 const {createHash}=await import('node:crypto'),digest=v=>createHash('sha256').update(v).digest('hex'),r=f.successorState.operations['relay-funding'];
 const objects=[f.args.plan,f.original,f.args.resolution,f.originalFixture.saved,f.args.successor,f.successorState];
 const sourceHashes=Object.fromEntries(f.ops.exactCancellationFiles.map((name,i)=>[name,digest(JSON.stringify(objects[i]))]));
 const dispatchIntent={schemaVersion:1,transactionHash:r.hash,rawSha256:digest(Buffer.from(r.raw,'hex')),identitySha256:digest(r.identity),sourceHashes,expiresAt:f.args.successor.expiresAt+60};
 let entry=null,observation=null,checks=0,preflights=0;const rawCalls=[],absence=[];
 const recoveryStore={read:()=>entry,enter:async value=>{assert.equal(entry,null);entry=structuredClone(value);},observe:async value=>{observation=structuredClone(value);}};
 const ports={...f.args.ports,sign:()=>assert.fail('Exact recovery cannot sign'),preflightCancellation:async()=>{preflights++;},assertAbsent:async hashes=>{absence.push([...hashes]);for(const h of hashes)assert.equal(f.receipts.has(h),false);},broadcastExact:async(raw,hash)=>{assert.equal(entry.phase,'entered');rawCalls.push(raw);return hash;}};
 const args={...f.args,dispatchIntent,sourceHashes,recoveryStore,ports,assertSourceFiles:async()=>{checks++;}};
 return {...f,args,rawCalls,absence,originals:JSON.stringify(objects),objects,get entry(){return entry;},get observation(){return observation;},get checks(){return checks;},get exactPreflights(){return preflights;}};
}
test('Exact cancellation reuses original bytes once with durable entry and three-winner checks, never signing',async()=>{
 const f=await exactDispatchFixture(),r=f.successorState.operations['relay-funding'];
 assert.equal((await f.ops.runSepoliaExactCancellation(f.args)).status,'unresolved');
 assert.deepEqual(f.rawCalls,['0x'+r.raw]);assert.deepEqual(f.observation,{state:'returned'});
 assert.equal(f.exactPreflights,2);assert.equal(f.checks,3);assert.equal(f.absence.length,2);
 assert.deepEqual(f.absence[0],[f.args.resolution.originalTransactionHash,f.first.hash,r.hash]);assert.deepEqual(f.absence[1],f.absence[0]);
 await f.ops.runSepoliaExactCancellation({...f.args,now:()=>Number.MAX_SAFE_INTEGER});assert.equal(f.rawCalls.length,1);
 await assert.rejects(f.ops.runSepoliaExactCancellation({...f.args,dispatchIntent:{...f.args.dispatchIntent,expiresAt:f.args.dispatchIntent.expiresAt+1}}));assert.equal(f.rawCalls.length,1);
 f.confirm(r.hash);assert.equal((await f.ops.runSepoliaExactCancellation(f.args)).winner,'successor');assert.equal(f.rawCalls.length,1);
 assert.equal(f.signedSteps.length,2);assert.equal(JSON.stringify(f.objects),f.originals);
});
test('Exact cancellation finalized original first or successor winner needs no dispatch including races',async()=>{
 for(const winner of ['original','cancellation','successor'])for(const race of [false,true]){
  const f=await exactDispatchFixture(),hash={original:f.args.resolution.originalTransactionHash,cancellation:f.first.hash,successor:f.successorState.operations['relay-funding'].hash}[winner];
  if(race){const preflight=f.args.ports.preflightCancellation;f.args.ports.preflightCancellation=async()=>{await preflight();if(f.exactPreflights===2)f.confirm(hash);};}else f.confirm(hash);
  const result=await f.ops.runSepoliaExactCancellation(f.args);assert.equal(result.winner,winner);assert.equal(result.canonical,true);assert.equal(f.rawCalls.length,0);assert.equal(f.signedSteps.length,2);
  assert.equal(JSON.stringify(f.objects),f.originals);
 }
});
test('Exact cancellation rejects changed bytes identity six-file bindings and invalid dispatch windows before entry',async()=>{
 for(const change of ['raw','hash','identity','file','file-race','expired','future','preflight','pending']){
  const f=await exactDispatchFixture();
  if(change==='raw')f.args.dispatchIntent.rawSha256='a'.repeat(64);
  if(change==='hash')f.args.dispatchIntent.transactionHash=field(9);
  if(change==='identity')f.args.dispatchIntent.identitySha256='a'.repeat(64);
  if(change==='file')f.args.sourceHashes={...f.args.sourceHashes,'state.json':'a'.repeat(64)};
  if(change==='file-race')f.args.assertSourceFiles=async()=>{throw Error('Original file changed');};
  if(change==='expired')f.args.now=()=>f.args.dispatchIntent.expiresAt*1000;
  if(change==='future')f.args.now=()=>f.args.dispatchIntent.expiresAt*1000-86400001;
  if(change==='preflight')f.args.ports.preflightCancellation=async()=>{throw Error('Nonce/fee/EOA/simulation inadmissible');};
  if(change==='pending')f.args.ports.assertAbsent=async()=>{throw Error('Candidate pending');};
  await assert.rejects(f.ops.runSepoliaExactCancellation(f.args));assert.equal(f.entry,null);assert.equal(f.rawCalls.length,0);assert.equal(f.signedSteps.length,2);
 }
});
test('Exact cancellation every entered failure remains reconcile-only on reopen with no repeated dispatch',async()=>{
 for(const failure of ['fsync','late-preflight','late-absence','late-file','expired','rejected','timeout','ack','observation']){
  const f=await exactDispatchFixture(),enter=f.args.recoveryStore.enter,observe=f.args.recoveryStore.observe,preflight=f.args.ports.preflightCancellation;
  if(failure==='fsync')f.args.recoveryStore.enter=async value=>{await enter(value);throw Error('fsync acknowledgement uncertain');};
  if(failure==='late-preflight')f.args.ports.preflightCancellation=async()=>{await preflight();if(f.exactPreflights===2)throw Error();};
  if(failure==='late-absence'){let n=0;f.args.ports.assertAbsent=async()=>{if(++n===2)throw Error();};}
  if(failure==='late-file'){let n=0;f.args.assertSourceFiles=async()=>{if(++n===3)throw Error();};}
  if(failure==='expired')f.args.now=()=>f.entry?f.args.dispatchIntent.expiresAt*1000:f.args.plan.expiresAt*1000;
  if(['rejected','timeout','ack'].includes(failure))f.args.ports.broadcastExact=async(raw)=>{f.rawCalls.push(raw);if(failure==='ack')return field(99);throw failure==='timeout'?{code:'TIMEOUT'}:{httpStatus:429,message:'PRIVATE_RAW_SENTINEL'};};
  if(failure==='observation')f.args.recoveryStore.observe=async value=>{await observe(value);throw Error('Observation fsync');};
  let result;try{result=await f.ops.runSepoliaExactCancellation(f.args);}catch{}
  assert.equal(f.entry.phase,'entered');const sends=f.rawCalls.length;
  await f.ops.runSepoliaExactCancellation({...f.args,now:()=>Number.MAX_SAFE_INTEGER});assert.equal(f.rawCalls.length,sends);assert.equal(f.signedSteps.length,2);assert.equal(JSON.stringify(f.objects),f.originals);
  if(['rejected','timeout','ack'].includes(failure)){assert.equal(result.dispatchAttempt.state,'rejected');assert(!JSON.stringify(result).includes('PRIVATE_RAW_SENTINEL'));assert.equal(sends,1);}else assert.equal(sends,failure==='observation'?1:0);
 }
});
test('Exact cancellation fixed production target and closed intent schema reject alternate authority',async()=>{
 const {requireAuthorizedExactCancellation,captureSepoliaExactDispatch}=await import('../operations.mjs');
 const good={from:'0x0443527ca2fd922e62cda88a087757116c71dc21',nonce:15,hash:'0xc0b5bc809bce870e3b4a4eaa506e26e1958c51ce63918c95bb324f0664ef2a62'};
 requireAuthorizedExactCancellation(good);for(const patch of [{from:'0x'+'1'.repeat(40)},{nonce:16},{hash:field(9)}])assert.throws(()=>requireAuthorizedExactCancellation({...good,...patch}));
 const f=await exactDispatchFixture();for(const patch of [{extra:true},{sourceHashes:{}},{expiresAt:NaN},{transactionHash:null},{rawSha256:'x'}])assert.throws(()=>captureSepoliaExactDispatch({...f.args.dispatchIntent,...patch}));
});
test('Exact cancellation raw transport sends one bounded request and validates exact RPC acknowledgement',async()=>{
 const f=await exactDispatchFixture(),{broadcastExactSepoliaCancellation}=f.ops,raw='0x'+f.successorState.operations['relay-funding'].raw,hash=f.args.dispatchIntent.transactionHash;
 for(const mode of ['ok','wrong-id','wrong-hash','error','http429','redirect']){
  let calls=0;class Request{
   constructor(url){this.url=url;this.getUrlFunc=async()=>{calls++;return {statusCode:mode==='http429'?429:200,body:new Uint8Array()};};}
   setThrottleParams(p){assert.equal(p.maxAttempts,1);}setHeader(k,v){assert.equal(k,'content-type');assert.equal(v,'application/json');}
   async send(){assert.equal(this.timeout,10000);assert.equal(this.retryFunc(),false);assert.deepEqual(JSON.parse(this.body),{jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[raw]});assert.equal(this.method,'POST');await this.getUrlFunc(mode==='redirect'?{url:'https://other.invalid'}:this);return{bodyJson:{jsonrpc:'2.0',id:mode==='wrong-id'?2:1,result:mode==='wrong-hash'?field(9):hash,...(mode==='error'?{error:{code:-32000,message:'PRIVATE_RAW_SENTINEL'}}:{})}};}
  }
  if(mode==='ok')assert.equal(await broadcastExactSepoliaCancellation(Request,'https://example.invalid',raw,hash),hash);
  else await assert.rejects(broadcastExactSepoliaCancellation(Request,'https://example.invalid',raw,hash));
  assert.equal(calls,mode==='redirect'?0:1);
 }
});
test('Exact cancellation durable exclusive slot survives reopen and rejects duplicate writers or missing entry',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{openExactCancellationDispatchStore}=await import('../operator.mjs');
 const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'exact-cancel-')));await fs.chmod(directory,0o700);
 const statePath=path.join(directory,'state.json'),hash=field(7),entry={schemaVersion:1,phase:'entered',identity:'synthetic'};
 try{
  const a=await openExactCancellationDispatchStore(statePath,hash),b=await openExactCancellationDispatchStore(statePath,hash);
  const results=await Promise.allSettled([a.enter(entry),b.enter(entry)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const reopened=await openExactCancellationDispatchStore(statePath,hash);assert.deepEqual(reopened.read(),entry);await reopened.observe({state:'returned'});await assert.rejects(reopened.observe({state:'returned'}));
  const file=statePath+'.exact-cancel-'+hash.slice(2)+'.entered.json';assert.equal((await fs.stat(file)).mode&0o777,0o600);
  await fs.unlink(file);await assert.rejects(openExactCancellationDispatchStore(statePath,hash),/entry missing/);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('Exact cancellation copied campaign cannot relocate the permanent dispatch slot through either operator entrypoint',async()=>{
 const {recoverExactSepoliaCancellation,seedTestnetLiquidity}=await import('../operator.mjs');
 // Intentionally absent files and invalid plan: path rejection must precede
 // source reads, plan parsing, the owner lock, provider or signing key loading.
 for(const statePath of ['/private/tmp/copied-campaign/state.json','state.json','/Users/zac/Documents/ChatGPT/Anonymous Message Board/rolling-design/.build/sepolia-liquidity-20261014/state.json']){
  await assert.rejects(recoverExactSepoliaCancellation({planPath:'/absent/plan.json',statePath,intentPath:'/absent/intent.json'}),/^Error: Original exact cancellation state path required$/);
  await assert.rejects(seedTestnetLiquidity({plan:null,statePath,stage:'approve-usdc',keyFile:'/absent/key.json',recovery:{kind:'exact-dispatch'}}),/^Error: Original exact cancellation state path required$/);
 }
});
