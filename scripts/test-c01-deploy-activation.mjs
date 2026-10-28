// Complete production module evaluation; inert RPC/portal controls, no proofs or transactions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TxStatus,TxExecutionResult,BlockHeader} from '@aztec-labs/stdlib/tx';
import {BlockHash,L2Block} from '@aztec-labs/stdlib/block';
import {BlockResponseSchema} from '@aztec-labs/stdlib/interfaces/client';
import {AppendOnlyTreeSnapshot} from '@aztec-labs/stdlib/trees';
import {jsonStringify} from '@aztec-labs/foundation/json-rpc';

const source=await readFile(new URL('../apps/src/billboard/deploy/engine.js',import.meta.url),'utf8');
for(const initial of [false,true])test(`class publication uses its own transaction; already published=${initial}`,async()=>{
  const context=vm.createContext({});vm.runInContext(source,context);
  let published=initial;const calls=[],payload={calls:['class-only']};
  await context.BillboardDeployPublication.publishBoardClass({
    deployMethod:{getInstance:async()=>({currentContractClassId:'class-id'}),getPublicationExecutionPayload:async options=>{assert.equal(options.skipInstancePublication,true);calls.push('payload');return payload;}},
    wallet:{getContractClassMetadata:async id=>{assert.equal(id,'class-id');return {isContractClassPubliclyRegistered:published};},sendTx:async(p,o)=>{assert.equal(p,payload);assert.equal(o.from,'account');calls.push('send');published=true;}},
    address:'account',journal:{setOperation:op=>calls.push(op)},read:fn=>fn(),operation:'publish-board-class:class-id',stale:false,
  });
  assert.deepEqual(calls,initial?[]:['publish-board-class:class-id','payload','send']);
});
test('unreconciled publication cannot advance merely because its class exists',async()=>{
  const context=vm.createContext({});vm.runInContext(source,context);
  await assert.rejects(context.BillboardDeployPublication.publishBoardClass({
    deployMethod:{getInstance:async()=>({currentContractClassId:'class-id'})},
    wallet:{getContractClassMetadata:async()=>({isContractClassPubliclyRegistered:true})},read:fn=>fn(),stale:true,
  }),{code:'BB_RECOVERY_REQUIRED'});
});
test('a returned publication submission is insufficient without observed class registration',async()=>{
  const context=vm.createContext({});vm.runInContext(source,context);
  await assert.rejects(context.BillboardDeployPublication.publishBoardClass({
    deployMethod:{getInstance:async()=>({currentContractClassId:'class-id'}),getPublicationExecutionPayload:async()=>({calls:['class-only']})},
    wallet:{getContractClassMetadata:async()=>({isContractClassPubliclyRegistered:false}),sendTx:async()=>({})},
    journal:{setOperation(){}},read:fn=>fn(),stale:false,
  }),/publication was not observed/);
});
const hash='0x'+'1'.repeat(64),blockA='0x'+'a'.padStart(64,'0'),blockB='0x'+'b'.padStart(64,'0');
const operator='0x'+'3'.repeat(40),expectedPortal='0x'+'4'.repeat(40);
const included=(extra={})=>({txHash:hash,status:TxStatus.CHECKPOINTED,executionResult:TxExecutionResult.SUCCESS,blockNumber:5,blockHash:blockA,...extra});
const wireBlock=(number,hash)=>JSON.parse(jsonStringify({header:BlockHeader.empty(),archive:AppendOnlyTreeSnapshot.empty(),
  hash:BlockHash.fromString(hash),number,checkpointNumber:1,indexWithinCheckpoint:0}));
function harness({receipt=included(),canonical=blockA,binding={portal:expectedPortal,checkpoint:{height:5,hash:blockA}},portalOperator=operator,activationStatus=1,enabled=true,staticFailure=false}={}){
 const context=vm.createContext({setTimeout,clearTimeout});vm.runInContext(source,context,{filename:'deploy/engine.js'});
 const calls={activate:[],staticCall:[],binding:0,receipt:0,order:[]};
 const node={getTxReceipt:async value=>{assert.equal(value,hash);calls.receipt++;calls.order.push('receipt');return receipt;},getBlock:async number=>{assert.equal(number,5);return BlockResponseSchema.parse(wireBlock(number,canonical));},getL2ToL1MembershipWitness:()=>assert.fail('Deployment must not request a proven witness'),getChainTips:()=>assert.fail('No epoch/finalized prerequisite')};
 const portal={DEPLOYMENT_OPERATOR:async()=>portalOperator,activate:async(...args)=>{calls.activate.push(args);calls.order.push('activate');return {wait:async()=>({status:activationStatus})};},depositsEnabled:async()=>enabled};
 portal.activate.staticCall=async(...args)=>{calls.staticCall.push(args);calls.order.push('static');if(staticFailure)throw Object.assign(Error('Operator rejected'),{code:'CALL_EXCEPTION'});};
 const verifyBinding=async()=>{calls.binding++;calls.order.push('binding');return binding;};
 const run=extra=>context.BillboardDeployActivation.activateReady({node,portal,hash,operator,expectedPortal,verifyBinding,log(){},timeoutMs:30,...extra});
 return {run,calls,node,portal,context};
}
test('pinned internal L2Block hash method differs from public node BlockResponse hash value',()=>{
  assert.equal(typeof L2Block.prototype.hash,'function');
  const wire=wireBlock(5,blockA),response=BlockResponseSchema.parse(wire);
  assert(response.hash instanceof BlockHash);assert.equal(typeof response.hash,'object');
  assert.equal(response.hash.toString(),blockA);
  assert.equal(response.checkpointNumber,1);
  assert.equal(BlockResponseSchema.safeParse({...wire,hash:L2Block.prototype.hash}).success,false);
});
test('checkpoint binding enables operator activation without Outbox or proven witness',async()=>{
 const f=harness();assert.equal((await f.run()).status,'active');assert.equal(f.calls.receipt,1);assert.equal(f.calls.binding,1);
 assert.deepEqual(f.calls.order,['receipt','static','binding','activate']);
 assert.deepEqual(Array.from(f.calls.activate[0],v=>Array.isArray(v)?Array.from(v):v),[]);
 assert.equal(f.calls.staticCall[0].at(-1).from,operator);
});
for(const [name,receipt,message] of [
 ['reverted',included({executionResult:TxExecutionResult.REVERTED}),/did not execute successfully/],
 ['missing success',included({executionResult:undefined}),/did not execute successfully/],
 ['dropped',{txHash:hash,status:TxStatus.DROPPED},/dropped/],
 ['unknown',included({status:'new-unknown-state'}),/unknown receipt status/],
 ['wrong transaction',included({txHash:'another'}),/hash mismatch/],
 ['missing block hash',included({blockHash:undefined}),/incomplete inclusion/],
])test(`${name} binding receipt fails closed`,async()=>{const f=harness({receipt});await assert.rejects(f.run(),message);assert.equal(f.calls.activate.length,0);});
for(const receipt of [{status:TxStatus.PENDING},included({status:TxStatus.PROPOSED})])test(`binding ${receipt.status} remains resumable without sending`,async()=>{const f=harness({receipt});assert.equal((await f.run()).status,'pending-settlement');assert.equal(f.calls.activate.length,0);assert.equal(f.calls.binding,0);});
test('noncanonical binding receipt cannot authorize activation',async()=>{const f=harness({canonical:blockB});assert.equal((await f.run()).status,'pending-settlement');assert.equal(f.calls.activate.length,0);});
for(const binding of [{portal:operator,checkpoint:{height:5,hash:blockA}},{portal:expectedPortal,checkpoint:{height:4,hash:blockA}},{portal:expectedPortal,checkpoint:{height:5,hash:blockB}}])test('mismatched current Board binding cannot activate '+JSON.stringify(binding),async()=>{const f=harness({binding});await assert.rejects(f.run(),/checkpoint binding mismatch/);assert.equal(f.calls.activate.length,0);});
test('operator mismatch and static rejection fail without pretending settlement is pending',async()=>{for(const options of [{portalOperator:expectedPortal},{staticFailure:true}]){const f=harness(options);await assert.rejects(f.run());assert.equal(f.calls.activate.length,0);}});
for(const options of [{activationStatus:0},{enabled:false}])test('activation requires successful L1 receipt and enabled portal '+JSON.stringify(options),async()=>{const f=harness(options);await assert.rejects(f.run(),/Portal activation failed/);assert.equal(f.calls.activate.length,1);});
test('original bounded receipt read preserves unknown outcome without sending',async()=>{const f=harness();f.node.getTxReceipt=()=>new Promise(()=>{});await assert.rejects(f.run({timeoutMs:10}),{code:'BB_RECOVERY_UNKNOWN'});assert.equal(f.calls.activate.length,0);});

const pinnedCreate2Runtime='0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3';
for (const [label, code, accepted] of [['missing','0x',false],['unrecognized','0x6000',false],['pinned',pinnedCreate2Runtime,true]]) {
  test(`deployment ${label} CREATE2 proxy is checked before wallet or proving work`, async () => {
    const calls=[], context=vm.createContext({setTimeout,clearTimeout});
    vm.runInContext(source,context,{filename:'deploy/engine.js'});
    const stop=Error('PREFLIGHT_COMPLETE');
    class Provider {
      async getCode(address) {calls.push('proxy');assert.equal(address.toLowerCase(),'0x4e59b44847b379578588920ca78fbf26c0b4956c');return code;}
      destroy(){calls.push('destroy');}
    }
    const aztec={
      verifyDeploymentInputs(){return {manifest:{}};},createAztecNodeClient(){return {};},
      async preflightDeploymentNetwork(){calls.push('network');return {proofsEnabled:false};},
      async boundedTransactionRead(read){return read();},
      loadContractArtifact(){calls.push('artifact');throw stop;},
    };
    const env={aztec,ethers:{JsonRpcProvider:Provider},pause(){calls.push('wallet');throw Error('Unexpected wallet access');},initCRS(){calls.push('prover');throw Error('Unexpected proving setup');}};
    await assert.rejects(context.runDeploy(env,{deploymentManifest:{schemaVersion:2,board:{kind:'rolling'}}}),accepted?error=>error===stop:/Required CREATE2 proxy runtime is missing or unsupported/);
    assert.deepEqual(calls,accepted?['network','proxy','artifact','destroy']:['network','proxy','destroy']);
  });
}

// Installed ABI is the authority for the explicit Rolling branch; inert chain
// controls above still do not qualify a genuine deployment or operator activation.
test('Rolling deployment targets current ABI, not legacy policy/portal getters',async()=>{
 const {loadContractArtifact,encodeArguments,getInitializer,getAllFunctionAbis}=await import('@aztec-labs/stdlib/abi');
 const {Fr}=await import('@aztec-labs/foundation/curves/bn254');
 const {EthAddress}=await import('@aztec-labs/foundation/eth-address');
 const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
 const raw=JSON.parse(await readFile(new URL('../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8')),artifact=loadContractArtifact(raw);
 const init=getInitializer(artifact,'init'),functions=getAllFunctionAbis(artifact);
 assert.deepEqual(init.parameters.map(p=>p.name),['rules','length','l1_chain_id','rollup_address','rollup_version','min_deposit','max_deposit','base_cooldown','k','censor_window','max_save_up','private_fee']);
 for(const absent of ['get_portal','is_portal_set','get_censor','get_policy_version'])assert.equal(functions.some(f=>f.name===absent),false);
 for(const present of ['update_portal','main_policy','get_config_hash'])assert(functions.some(f=>f.name===present));
 const args=[Array(32).fill(Fr.ZERO),1n,11155111n,EthAddress.fromString('0x'+'11'.repeat(20)),3409706519n,1n,100n,60n,4n,60n,16n,AztecAddress.fromFieldUnsafe(new Fr(13))];
 assert.equal(encodeArguments(init,args).length,43);
 for(const [index,width]of [[1,16],[2,64],[4,32],[5,128],[6,128],[7,32],[8,16],[9,32],[10,16]]){const bad=args.slice();bad[index]=1n<<BigInt(width);assert.throws(()=>encodeArguments(init,bad));}
 const bad=args.slice();bad[0]=Array(48).fill(Fr.ZERO);assert.throws(()=>encodeArguments(init,bad));
});
