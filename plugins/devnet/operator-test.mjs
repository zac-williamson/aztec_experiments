// Explicit real-contract operations scenario. No inference/provider billing is claimed.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {Barretenberg,BarretenbergSync} from '@aztec-foundation/bb.js';
import {generateSchnorrAccounts} from '@aztec-labs/accounts/testing';
import {L1FeeJuicePortalManager} from '@aztec-labs/aztec.js/ethereum';
import {createLogger} from '@aztec-labs/foundation/log';
import {Fr} from '@aztec-labs/foundation/curves/bn254';import {EthAddress} from '@aztec-labs/foundation/eth-address';
import {Contract as L2Contract} from '@aztec-labs/aztec.js/contracts';import {NO_FROM} from '@aztec-labs/aztec.js/account';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';import {TxHash,TxStatus} from '@aztec-labs/stdlib/tx';
import {computeSecretHash} from '@aztec-labs/stdlib/hash';import {Contract} from 'ethers';
import {bootstrapPluginDevnet} from './bootstrap.mjs';import {drainDevnetCheckpoints} from './network.mjs';
import {operatorCommand} from '../operator.mjs';import {packText,handleField} from '../protocol.mjs';
import {settleC01ApplicationMessage} from '../../scripts/c01-settle-application-message.mjs';
const focused=process.argv.includes('--focused')||process.env.NODE_TEST_CONTEXT!==undefined;
if(!focused){
if(process.env.PLUGIN_PROOFS!==undefined&&process.env.PLUGIN_PROOFS!=='false')throw Error('Development requires proofs disabled');
const directory=await fs.mkdtemp(path.resolve('.build/plugin-operations-'));
console.log('BROWSER_DIRECTORY',directory);console.log('RESULT_PATH',path.join(directory,'operations-result.json'));
const report={passed:false,scenario:'operator-contract-lifecycle',applicationProofs:false};
let fixture;
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const mark=stage=>{report.stage=stage;console.log('STEP',stage);};
try{
 fixture=await bootstrapPluginDevnet({directory,proofs:report.applicationProofs,onProgress:mark});
 const info=await fixture.net.node.getNodeInfo(),statePath=path.join(directory,'operations.json');
 const actor=a=>({address:String(a.address),secret:String(a.secret),salt:String(a.salt),signingKey:String(a.signingKey)});
 const config={nodeUrl:fixture.net.nodeUrl,ethereumUrl:fixture.net.rpcUrl,chainId:'31337',rollupVersion:String(info.rollupVersion),rollupAddress:String(info.l1ContractAddresses.rollupAddress).toLowerCase(),boardAddress:String(fixture.board.address),operatorAddress:String(fixture.operator.address),operatorFile:path.join(directory,'operator.json'),tokenAddress:(await fixture.token.getAddress()).toLowerCase(),descriptorUrl:'http://127.0.0.1:8792/v1/descriptor',handle:'ops',development:true};
 await fs.writeFile(config.operatorFile,JSON.stringify(actor(fixture.operator)),{mode:0o600});
 const run=(command,extra={})=>operatorCommand({command,config,statePath,actor:actor(fixture.author),ethereumKey:fixture.signer.privateKey,...extra});
 mark('fund-new-operator-fees');
 const [fresh]=await generateSchnorrAccounts(1,'schnorr_initializerless');
 assert.equal((await run('fees',{actor:actor(fresh)})).publicFeeJuice,'0');
 const feePortal=await L1FeeJuicePortalManager.new(fixture.net.node,fixture.net.deployment.l1Client,createLogger('plugin:test:fees'));
 const credit=await feePortal.bridgeTokensPublic(fresh.address,undefined,true);
 const claimPath=path.join(directory,'fee-claim.json');await fs.writeFile(claimPath,JSON.stringify({claimAmount:String(credit.claimAmount),claimSecret:String(credit.claimSecret),messageLeafIndex:String(credit.messageLeafIndex)}),{mode:0o600});
 fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
 let feeWitness;const feeDeadline=Date.now()+90000;
 while(Date.now()<feeDeadline){await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();feeWitness=await fixture.net.node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(credit.messageHash));if(feeWitness)break;await new Promise(r=>setTimeout(r,1000));}
 assert(feeWitness);fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});await drainDevnetCheckpoints(fixture.net);
 const claimed=await run('claim-fees',{actor:actor(fresh),claim:claimPath});assert(BigInt(claimed.publicFeeJuice)>0n);report.zeroBalanceFeeOnboarding=true;
 for(const command of ['deploy-escrow','deploy-portal','bind']){
  mark(command);await run(command);const before=JSON.stringify(await read(statePath));
  await run(command);assert.equal(JSON.stringify(await read(statePath)),before,'Repeated command must reuse its transaction');
  if(command==='deploy-escrow'){
   await assert.rejects(run(command,{actor:actor(fixture.operator)}),/another actor/);
   assert.equal(JSON.stringify(await read(statePath)),before,'Wrong-actor replay must preserve deployment state');
  }
 }
 const settle=async hash=>{const txHash=TxHash.fromString(hash),effect=await fixture.net.node.getTxEffect(txHash);return settleC01ApplicationMessage({node:fixture.net.node,config:fixture.net.config,dateProvider:fixture.net.dateProvider,l1Client:fixture.net.deployment.l1Client,directory,rollupAddress:info.l1ContractAddresses.rollupAddress,txHash,expectedLeaf:effect.data.l2ToL1Msgs.find(x=>!x.isZero()),kind:'exit',applicationProofs:report.applicationProofs});};
 await settle((await read(statePath)).operations.bind.hash);
 for(const command of ['activate','config','register']){mark(command);await run(command);}
 const state=await read(statePath),portalArtifact=await read('billboard/portal/out/PluginPortal.sol/PluginPortal.json');
 const portal=new Contract(state.portal,portalArtifact.abi,fixture.signer);
 await (await fixture.token.approve(state.portal,1000000n)).wait();
 const receipt=await(await portal.deposit(String(fixture.author.address),1000000n,String(await computeSecretHash(Fr.ONE)))).wait();
 const event=receipt.logs.map(x=>{try{return portal.interface.parseLog(x);}catch{return null;}}).find(x=>x?.name==='Deposited');
 fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:0,buildCheckpointIfEmpty:true});
 const deadline=Date.now()+90000;let witness;
 while(Date.now()<deadline){await fixture.wallet.pxe.sync();const header=await fixture.wallet.pxe.getSyncedBlockHeader();witness=await fixture.net.node.getL1ToL2MessageMembershipWitness(header.getBlockNumber(),Fr.fromString(event.args.key));if(witness)break;await new Promise(r=>setTimeout(r,1000));}
 assert(witness);fixture.net.node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});await drainDevnetCheckpoints(fixture.net);
 const artifact=loadContractArtifact(await read('plugins/adapter_artifact.json')),instance=await fixture.net.node.getContract((await import('@aztec-labs/stdlib/aztec-address')).AztecAddress.fromStringUnsafe(state.escrow),'latest');
 await fixture.wallet.registerContract(instance,artifact);const escrow=await L2Contract.at(instance.address,artifact,fixture.wallet);
 await fixture.wallet.createSchnorrInitializerlessAccount(fixture.operator.secret,fixture.operator.salt,fixture.operator.signingKey,'operator');
 const opts={from:fixture.author.address,wait:{timeout:120,waitForStatus:TxStatus.CHECKPOINTED}},opOpts={...opts,from:fixture.operator.address};
 mark('claim-and-authorize');await escrow.methods.claim(1000000n,Fr.ONE,new Fr(event.args.index)).send(opts);
 const message=packText('@ops Operator earnings contract integration');await fixture.board.methods.post_with_plugin(fixture.chain,Fr.random(),message.fields.map(x=>Fr.fromString(x)),message.length,null,null,Fr.fromString(handleField('ops'))).send(opts);
 const post=new Fr(BigInt((await escrow.methods.request_at(0).simulate({from:NO_FROM})).result));
 await escrow.methods.start(post).send(opOpts);await escrow.methods.reserve(post,0,10000n).send(opOpts);await escrow.methods.settle(post,0,123n,Fr.ONE).send(opOpts);await escrow.methods.close(post).send(opOpts);
 mark('operator-earnings');const operatorArgs={actor:actor(fixture.operator)};
 assert.equal((await run('earnings',operatorArgs)).availableUSDC,'0.000123');
 await run('withdraw-earnings',{...operatorArgs,amount:'0.000123',recipient:fixture.signer.address});
 const withdrawal=(await read(statePath)).withdrawal;await settle((await read(statePath)).operations['withdraw-'+withdrawal.nonce].hash);
 const before=await fixture.token.balanceOf(fixture.signer.address);await run('redeem-earnings',operatorArgs);assert.equal(await fixture.token.balanceOf(fixture.signer.address),before+123n);
 assert.equal((await run('earnings',operatorArgs)).availableUSDC,'0.0');
 await assert.rejects(run('redeem-earnings',operatorArgs),/No earnings withdrawal/);
 assert.equal(BigInt((await escrow.methods.balance(fixture.author.address).simulate({from:NO_FROM})).result),999877n);
 report.earnings={withdrawnMicroUSDC:'123',userBalanceMicroUSDC:'999877',distinctOperator:true};report.passed=true;mark('passed');
}catch(error){report.failure={name:error.name,message:error.message};throw error;}
finally{try{await fixture?.close();await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();report.cleanupSucceeded=true;}finally{await fs.writeFile(path.join(directory,'operations-result.json'),JSON.stringify(report,null,2));}}

}

if(focused){
 const {test}=await import('node:test');const os=await import('node:os');const {createServer}=await import('node:net');
 const {developmentOptions}=await import('./start.mjs');const {devnetPorts,readDevnetRecord,writeDevnetRecord,validateDevnetResume,assertDevnetPortsFree}=await import('./network.mjs');
 test('current development defaults are Rolling, loopback ports and no provider prerequisite',()=>{const p=developmentOptions([],{VENICE_WALLET_PRIVATE_KEY:undefined});assert.equal(p.profile,'rolling');assert.deepEqual(p.ports,{ethereumPort:18545,nodePort:18080,appPort:8080});assert.equal(p.hostedConfig,undefined);});
 test('development flags reject real proofs, duplicate ports and unknown arguments before startup',()=>{assert.throws(()=>developmentOptions([],{PLUGIN_PROOFS:'true'}));assert.throws(()=>developmentOptions(['--app-port','18080']));assert.throws(()=>developmentOptions(['--app-port','8080','--app-port','8081']));assert.throws(()=>developmentOptions(['--network','testnet']));assert.throws(()=>developmentOptions(['--app-port','0']));});
 test('selected state and separate loopback ports are explicit',()=>{const p=developmentOptions(['--directory','/tmp/owned-local-devnet','--app-port','18081','--node-port','18082','--ethereum-port','18546']);assert.equal(p.directory,'/tmp/owned-local-devnet');assert.equal(p.ports.appPort,18081);});
 test('occupied development port fails before changing an existing listener',async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await assert.rejects(assertDevnetPortsFree({ethereumPort:server.address().port,nodePort:18083,appPort:18084}),/already owned/);assert(server.listening);}finally{await new Promise(r=>server.close(r));}});
 test('private state uses exclusive creation, closed reads and atomic replacement',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-dev-state-'));await fs.chmod(dir,0o700);const file=path.join(dir,'state.json');try{assert.equal(await readDevnetRecord(file),null);await writeDevnetRecord(file,{phase:'starting'},{exclusive:true});assert.equal((await fs.stat(file)).mode&0o777,0o600);await assert.rejects(writeDevnetRecord(file,{phase:'replacement'},{exclusive:true}));assert.deepEqual(await readDevnetRecord(file),{phase:'starting'});await writeDevnetRecord(file,{phase:'stopped'});assert.deepEqual(await readDevnetRecord(file),{phase:'stopped'});await fs.chmod(file,0o644);await assert.rejects(readDevnetRecord(file));await fs.unlink(file);await fs.symlink('target.json',file);await assert.rejects(readDevnetRecord(file));}finally{await fs.rm(dir,{recursive:true,force:true});}});
 const ports=devnetPorts(),fundingAddresses=['0x'+'1'.repeat(64)],toolchainHash='2'.repeat(64);
 const stopped={schemaVersion:1,phase:'stopped',toolchainHash,ports,fundingAddresses,privateKey:'0x'+'3'.repeat(64),validatorSecret:'0x'+'4'.repeat(64),snapshotHash:'5'.repeat(64),mnemonic:Array(12).fill('synthetic').join(' '),addresses:{rollupAddress:'0x'+'6'.repeat(40)},rollupVersion:7};
 test('clean restart preserves exact original identity scope',()=>assert.equal(validateDevnetResume(stopped,{fundingAddresses,ports,toolchainHash}),stopped));
 for(const [name,change] of [['unclean',{phase:'running'}],['starting',{phase:'starting'}],['other genesis',{fundingAddresses:['0x'+'9'.repeat(64)]}],['other ports',{ports:{...ports,nodePort:18085}}],['other binary scope',{toolchainHash:'9'.repeat(64)}],['missing snapshot',{snapshotHash:null}]])test('restart refuses '+name+' without reset',()=>assert.throws(()=>validateDevnetResume({...stopped,...change},{fundingAddresses,ports,toolchainHash}),/recovery required/));
 test('development lease rejects symlinked parent and preserves a replaced owner inode',async()=>{
  const {acquireDevelopmentLease}=await import('./start.mjs');const parent=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-owner-'))),root=path.join(parent,'state'),link=path.join(parent,'link');
  try{await fs.mkdir(root,{mode:0o700});await fs.symlink(parent,link);await assert.rejects(acquireDevelopmentLease(path.join(link,'state')),/canonical/);
   const lease=await acquireDevelopmentLease(root);await lease.assertHeld();await assert.rejects(acquireDevelopmentLease(root),{code:'EEXIST'});
   const lock=path.join(root,'hosted.lock');await fs.rename(lock,lock+'.original');await fs.writeFile(lock,'replacement',{mode:0o600,flag:'wx'});
   await assert.rejects(lease.assertHeld(),/changed/);await assert.rejects(lease.close(),/changed/);assert.equal(await fs.readFile(lock,'utf8'),'replacement');
   await fs.unlink(lock);const second=await acquireDevelopmentLease(root);await second.close();await assert.rejects(fs.stat(lock),{code:'ENOENT'});
   await fs.chmod(root,0o755);await assert.rejects(acquireDevelopmentLease(root),/private/);
  }finally{await fs.rm(parent,{recursive:true,force:true});}
 });
 test('actual checkpoint boundary surfaces miner failure and incomplete shutdown without saving',async()=>{
  const {persistDevnetCheckpoint}=await import('./network.mjs');let saves=0;const save=async()=>{saves++;};
  for(const change of [{miningError:Error('controlled miner failure')},{bootComplete:false},{priorFailure:true}])await assert.rejects(persistDevnetCheckpoint({persistent:true,bootComplete:true,miningError:null,priorFailure:false,save,...change}),/recovery required/);
  const original=Error('controlled original mining failure');await assert.rejects(persistDevnetCheckpoint({persistent:true,bootComplete:true,miningError:original,priorFailure:false,save}),e=>e.cause===original);
  assert.equal(saves,0);await persistDevnetCheckpoint({persistent:true,bootComplete:true,miningError:null,priorFailure:false,save});assert.equal(saves,1);
  await assert.rejects(persistDevnetCheckpoint({persistent:true,bootComplete:true,priorFailure:false,save:async()=>{throw Error('controlled disk failure');}}),/disk failure/);
 });

 test('missing network metadata cannot reset retained chain snapshots, node data or deployment journals',async()=>{
  const {assertFreshDevnetDirectory}=await import('./network.mjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-incomplete-'));
  try{await assertFreshDevnetDirectory(dir);await fs.writeFile(path.join(dir,'operator.json'),'{}',{mode:0o600});await fs.writeFile(path.join(dir,'hosted.lock'),'1',{mode:0o600});await assertFreshDevnetDirectory(dir);
   for(const name of ['ethereum-state.json','node','deployment.json','bok-operations.json']){const p=path.join(dir,name);if(name==='node')await fs.mkdir(p);else await fs.writeFile(p,'retained',{mode:0o600});await assert.rejects(assertFreshDevnetDirectory(dir),/metadata missing/);assert(await fs.lstat(p));await fs.rm(p,{recursive:true});}
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });

 const {activateDevelopmentBok}=await import('./bootstrap.mjs');
 const bokExpected={escrow:'0x'+'4'.repeat(64),operatorAddress:'0x'+'5'.repeat(64),pluginId:'0x'+'1'.repeat(64)};
 const bokStatus={status:'succeeded',canonical:true,scope:'portal-registration',escrow:bokExpected.escrow,pluginId:bokExpected.pluginId,portal:'0x'+'6'.repeat(40),portalReady:true,registrationReady:true,hostedServiceReady:false};
 test('actual lifecycle composition exposes wallet Bok only after ordered canonical status (controlled operator)',async()=>{
  const calls=[];let binds=0;const value=await activateDevelopmentBok({expected:bokExpected,pollMs:0,run:async command=>{calls.push(command);if(command==='bind'&&binds++===0)return {status:'unresolved'};return command==='status'?bokStatus:{status:'succeeded',canonical:true};},settle:async()=>calls.push('settle')});
  assert.deepEqual(calls,['deploy-portal','bind','bind','settle','activate','register','status']);
  assert.deepEqual(value.walletBok,{contractAddress:bokExpected.escrow,operatorAddress:bokExpected.operatorAddress,pluginId:bokExpected.pluginId});
  assert.equal(value.status.hostedServiceReady,false);
 });
 test('lifecycle refuses failed, noncanonical or unresolved retained operation without later activation',async()=>{
  for(const result of [{status:'failed',canonical:true},{status:'succeeded',canonical:false},{status:'unresolved'}]){const calls=[];await assert.rejects(activateDevelopmentBok({expected:bokExpected,waitMs:1,pollMs:1,run:async command=>{calls.push(command);return result;},settle:async()=>calls.push('settle')}),/reconciliation/);assert(calls.every(x=>x==='deploy-portal'));}
 });
 test('settlement failure and canonical status drift cannot publish wallet Bok configuration',async()=>{
  const calls=[];await assert.rejects(activateDevelopmentBok({expected:bokExpected,run:async c=>{calls.push(c);return bokStatus;},settle:async()=>{throw Error('controlled missing Ready');}}),/missing Ready/);assert.deepEqual(calls,['deploy-portal','bind']);
  for(const change of [{escrow:'0x'+'7'.repeat(64)},{pluginId:'0x'+'2'.repeat(64)},{portal:'0x'+'0'.repeat(40)},{portalReady:false},{registrationReady:false},{hostedServiceReady:true},{scope:'constructor-only'}])await assert.rejects(activateDevelopmentBok({expected:bokExpected,run:async c=>c==='status'?{...bokStatus,...change}:bokStatus,settle:async()=>{}}),/status differs/);
 });
 const {waitDevelopmentFinality,failRollingBootstrap}=await import('./bootstrap.mjs');
 const readyHash='0x'+'a'.repeat(64),readyBlockHash='0x'+'b'.repeat(64);
 const readyReceipt={txHash:readyHash,status:'proven',executionResult:'success',blockNumber:3,blockHash:readyBlockHash};
 const finalityNode=()=>({getTxReceipt:async()=>readyReceipt,getBlock:async()=>({hash:readyBlockHash}),getChainTips:async()=>({finalized:{block:{number:3}}})});
 test('default finality deadline admits an immediately finalized canonical receipt',async()=>assert.deepEqual(await waitDevelopmentFinality({node:finalityNode(),txHash:readyHash}),{number:3,hash:readyBlockHash}));
 test('actual finality wait observes pending then finalized with reads only',async()=>{
  const node=finalityNode();let reads=0;node.getChainTips=async()=>({finalized:{block:{number:++reads<3?2:3}}});
  assert.deepEqual(await waitDevelopmentFinality({node,txHash:readyHash,timeoutMs:100,pollMs:0}),{number:3,hash:readyBlockHash});assert.equal(reads,3);
 });
 test('finality timeout or stalled read preserves pending state without CLI or settlement replay',async()=>{
  const node=finalityNode();node.getChainTips=async()=>({finalized:{block:{number:2}}});await assert.rejects(waitDevelopmentFinality({node,txHash:readyHash,timeoutMs:5,pollMs:1}),/finality/);
  node.getChainTips=()=>new Promise(()=>{});await assert.rejects(waitDevelopmentFinality({node,txHash:readyHash,timeoutMs:5,pollMs:0}));
 });
 test('finality wait refuses changed original receipt, reorg, reverted effect and invalid tip',async()=>{
  for(const mutation of [n=>n.getTxReceipt=async()=>({...readyReceipt,txHash:'0x'+'c'.repeat(64)}),n=>n.getTxReceipt=async()=>({...readyReceipt,executionResult:'reverted'}),n=>n.getBlock=async()=>({hash:'0x'+'c'.repeat(64)}),n=>n.getChainTips=async()=>({finalized:{block:{number:'3'}}})]){const node=finalityNode();mutation(node);await assert.rejects(waitDevelopmentFinality({node,txHash:readyHash,timeoutMs:50,pollMs:0}));}
  const node=finalityNode();let reads=0;node.getTxReceipt=async()=>({...readyReceipt,blockNumber:++reads===1?3:4});node.getChainTips=async()=>({finalized:{block:{number:2}}});await assert.rejects(waitDevelopmentFinality({node,txHash:readyHash,timeoutMs:50,pollMs:0}),/anchor changed/);
 });
 test('bootstrap failure retains exact original private cause and cleanup failure behind generic message',async()=>{
  const original=Error('synthetic-private-diagnostic'),cleanup=Error('controlled cleanup');let closes=0;
  await assert.rejects(failRollingBootstrap(original,async()=>{closes++;}),e=>e.cause===original&&!e.message.includes(original.message));assert.equal(closes,1);
  await assert.rejects(failRollingBootstrap(original,async()=>{throw cleanup;}),e=>e instanceof AggregateError&&e.cause===original&&e.errors[0]===original&&e.errors[1]===cleanup&&!e.message.includes(original.message));
 });

 test('retained local Anvil uses official SDK finality depth without removing snapshot or application guards',async()=>{
  const {developmentAnvilArgs}=await import('./network.mjs');const args=developmentAnvilArgs({persistent:true,port:18545,mnemonic:'synthetic-only',recoveryPath:'/tmp/anvil-recovery-00000000-0000-4000-8000-000000000000.json',cachePath:'/tmp/anvil-cache-00000000-0000-4000-8000-000000000000'});
  assert.deepEqual(args,['--host','127.0.0.1','--port','18545','--chain-id','31337','--mnemonic','synthetic-only','--silent','--no-request-size-limit','--slots-in-an-epoch','1','--dump-state','/tmp/anvil-recovery-00000000-0000-4000-8000-000000000000.json','--state-interval','86400','--preserve-historical-states','--cache-path','/tmp/anvil-cache-00000000-0000-4000-8000-000000000000']);
  assert(!developmentAnvilArgs({persistent:false,port:18546,mnemonic:'synthetic-only'}).includes('--slots-in-an-epoch'));
 });

 test('constructor waits for same recorded operation without preparing or sending again',async()=>{
  const {completeDevelopmentOperation}=await import('./bootstrap.mjs'),{onceAztecOperation}=await import('../operations.mjs');let state={operations:{}},prepares=0,sends=0,reads=0;const store={read:()=>state,write:async s=>{state=s;}};
  const result=await completeDevelopmentOperation({command:'deploy-escrow',timeoutMs:100,pollMs:0,run:command=>onceAztecOperation({store,name:command,identity:'retained-constructor',reconcile:async()=>++reads<3?{status:'unresolved',canonical:false}:{status:'succeeded',canonical:true,escrow:bokExpected.escrow},execute:async({submit})=>{prepares++;await submit({hash:'0x'+'7'.repeat(64),raw:'ab'},async()=>{sends++;});}})});
  assert.equal(result.escrow,bokExpected.escrow);assert.equal(reads,3);assert.equal(prepares,1);assert.equal(sends,1);assert.equal(state.operations['deploy-escrow'].phase,'submission-unknown');
 });
 test('constructor deadline retains unknown or hashless intent and refuses a second execution',async()=>{
  const {completeDevelopmentOperation}=await import('./bootstrap.mjs'),{onceAztecOperation}=await import('../operations.mjs');
  for(const phase of ['preparing','submission-unknown']){const original={schemaVersion:1,policy:'reconcile-only',phase,identity:'saved',...(phase==='submission-unknown'?{hash:'0x'+'8'.repeat(64),raw:'ab'}:{})},state={operations:{'deploy-escrow':original}};let executes=0,writes=0;
   await assert.rejects(completeDevelopmentOperation({command:'deploy-escrow',timeoutMs:3,pollMs:1,run:command=>onceAztecOperation({store:{read:()=>state,write:async()=>{writes++;}},name:command,identity:'saved',reconcile:async()=>({status:'unresolved',canonical:false}),execute:async()=>{executes++;}})}),/reconciliation/);
   assert.equal(executes,0);assert.equal(writes,0);assert.equal(state.operations['deploy-escrow'],original);
  }
 });

 const {linkLiquidityBytecode,localPoolPrice,liquidityStage,liquidityPins}=await import('./liquidity.mjs');
 test('genuine dependency pins bind Circle source/compiler and matching official V3 artifact family',()=>{
  assert.equal(liquidityPins.circleCommit,'fc85788bc7c23cefe3df1a757133048bfddadeaa');assert.equal(Object.keys(liquidityPins.circleSources).length,31);assert.equal(liquidityPins.packages.find(p=>p.package==='@uniswap/swap-router-contracts').version,'1.3.1');assert.match(liquidityPins.compilerSha256,/^[a-f0-9]{64}$/);
 });
 test('actual bytecode linker accepts only exact non-overlapping declared library offsets',()=>{
  const a={bytecode:'0x60'+'_'.repeat(40)+'00',linkReferences:{file:{Library:[{start:1,length:20}]}}},addr='0x'+'1'.repeat(40);
  assert.equal(linkLiquidityBytecode(a,{Library:addr}),'0x60'+addr.slice(2)+'00');assert.throws(()=>linkLiquidityBytecode(a,{}));assert.throws(()=>linkLiquidityBytecode({...a,linkReferences:{file:{Library:[{start:1,length:20},{start:1,length:20}]}}},{Library:addr}));assert.throws(()=>linkLiquidityBytecode({...a,linkReferences:{}},{}));
 });
 test('pool initialization uses integer decimal-aware sorted real inventory, not invented quotes',()=>{
  const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40),p=localPoolPrice(a,b,1000000000000000000n,1000000000n),q=localPoolPrice(b,a,1000000000n,1000000000000000000n);assert.deepEqual(p,q);assert.equal(p.amount0,1000000000000000000n);assert(p.sqrtPriceX96>0n);assert.throws(()=>localPoolPrice(a,a,1n,1n));assert.throws(()=>localPoolPrice(a,b,0n,1n));
 });
 test('actual local liquidity journal sends signed intent once and refuses unknown/reorg recovery (controlled chain)',async()=>{
  const {Wallet,Transaction}=await import('ethers');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-liquidity-stage-')),wallet=Wallet.createRandom(),hash='0x'+'8'.repeat(64);let sent=0,prepared=0,receipt,reorg=false,missing=false,receiptReads=0,moved=false;
  const provider={getNetwork:async()=>({chainId:31337n}),getTransactionReceipt:async()=>{receiptReads++;if(receiptReads===2)moved=true;return missing?null:moved?{...receipt,blockNumber:99}:receipt;},getBlock:async()=>({number:4,hash:reorg?'0x'+'9'.repeat(64):hash}),broadcastTransaction:async raw=>{sent++;receipt={hash:Transaction.from(raw).hash,status:1,blockNumber:4,blockHash:hash};return {hash:receipt.hash};}};
  const signer={address:wallet.address,populateTransaction:async t=>{prepared++;return {...t,nonce:0,chainId:31337n,type:2,gasLimit:100000n,maxFeePerGas:2n,maxPriorityFeePerGas:1n};},signTransaction:t=>wallet.signTransaction(t)},args={directory:dir,name:'controlled-call',identity:'controlled',provider,signer,transaction:{to:'0x'+'1'.repeat(40),data:'0x1234',value:0n},effect:async()=>true,timeoutMs:1};
  try{assert.equal((await liquidityStage(args)).status,1);assert.equal(receiptReads,1,'return the canonical captured receipt without another lookup');await assert.rejects(liquidityStage(args),/reconciliation/);moved=false;await liquidityStage(args);assert.equal(sent,1);assert.equal(prepared,1);for(const mode of ['reorg','missing']){reorg=mode==='reorg';missing=mode==='missing';await assert.rejects(liquidityStage(args),/reconciliation/);}assert.equal(sent,1);assert.equal(prepared,1);await assert.rejects(liquidityStage({...args,identity:'changed'}),/scope mismatch/);const saved=await readDevnetRecord(path.join(dir,'controlled-call.json'));assert.equal(saved.operations['relay-funding'].phase,'submission-unknown');reorg=false;missing=false;const stageFile=path.join(dir,'controlled-call.json');await fs.unlink(stageFile);await assert.rejects(liquidityStage(args),/entered liquidity stage missing/);assert.equal(sent,1);await fs.writeFile(stageFile,JSON.stringify(saved),{mode:0o600});await fs.unlink(path.join(dir,'progress.json'));await assert.rejects(liquidityStage(args),/progress missing/);assert.equal(sent,1);assert.equal(prepared,1);}finally{await fs.rm(dir,{recursive:true,force:true});}
 });

 test('prepared official artifact loader accepts exact measured output and rejects changed ABI bytecode links or symlinks',async()=>{
  const {readLiquidityArtifacts}=await import('./liquidity.mjs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'rolling-liquidity-artifact-'));
  const original=await fs.readFile(path.resolve('.build/local-liquidity/artifacts.json'));
  try{
   await fs.writeFile(path.join(dir,'artifacts.json'),original);assert.equal(Object.keys(await readLiquidityArtifacts(dir)).length,11);
   for(const change of [r=>r.artifacts.FiatTokenV2_2.abi=[],r=>r.artifacts.FiatTokenV2_2.bytecode='0x00',r=>r.artifacts.FiatTokenV2_2.linkReferences={},r=>r.pinsSha256='0'.repeat(64)]){const r=JSON.parse(original);change(r);await fs.writeFile(path.join(dir,'artifacts.json'),JSON.stringify(r)+'\n');await assert.rejects(readLiquidityArtifacts(dir),/pin differs/);}
   await fs.unlink(path.join(dir,'artifacts.json'));await fs.symlink(path.resolve('.build/local-liquidity/artifacts.json'),path.join(dir,'artifacts.json'));await assert.rejects(readLiquidityArtifacts(dir),/type/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });
 test('advanced Bok lifecycle cannot reconstruct missing original Circle/config scope',async()=>{
  const {requireDevelopmentCircleScope}=await import('./bootstrap.mjs');
  requireDevelopmentCircleScope({operations:{'deploy-escrow':{phase:'submission-unknown'}}});
  for(const name of ['deploy-portal','bind','activate','register'])assert.throws(()=>requireDevelopmentCircleScope({operations:{[name]:{}},circleScope:{}}),/records missing/);
  assert.throws(()=>requireDevelopmentCircleScope({lifecycle:{},operations:{}}),/records missing/);
  requireDevelopmentCircleScope({lifecycle:{},operations:{register:{}},circleScope:{}});
  assert.throws(()=>requireDevelopmentCircleScope({legacyToken:{operations:{'deploy-portal':{}}}}),/records missing/);
 });

 test('dedicated local relay retains private signer and measured reimbursement policy across reopen (controlled chain)',async()=>{
  const {prepareDevelopmentRelay}=await import('./liquidity.mjs'),dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'rolling-relay-record-'))),address=n=>'0x'+n.toString(16).padStart(40,'0'),hash='0x'+'a'.repeat(64);
  const scope={router:address(1),routerCodeHash:hash,collateralPortal:address(2),feePortal:address(3),bokPortal:address(4),privateFpc:'0x'+'1'.repeat(64),bokToken:address(5),weth:address(6),quoter:address(7),quoterCodeHash:hash},circle={codeHash:hash,implementation:address(8),implementationCodeHash:hash};let quotes=0,fundCalls=0;
  const provider={_getConnection:()=>({url:'http://127.0.0.1:18545/'}),getBlock:async()=>({hash})},quoter={quoteExactOutputSingle:{staticCall:async args=>{quotes++;assert.deepEqual(args,[scope.bokToken,scope.weth,10000000000000000n,3000,0]);return [101n];}}};
  const stage=async(name,tx)=>{fundCalls++;assert.equal(name,'relay-fund');assert.equal(tx.value,100000000000000000n);assert.equal(tx.data,'0x');await fs.writeFile(path.join(dir,'progress.json'),JSON.stringify({entered:['relay-fund']}));};
  const args={directory:dir,provider,stage,scope,circle,quoter,anchor:{number:3,hash},fundingSender:address(99)};
  try{
   await fs.writeFile(path.join(dir,'progress.json'),JSON.stringify({entered:[]}));const first=await prepareDevelopmentRelay(args),key=await fs.readFile(first.signerFile);
   assert.equal(first.policy.feeUsdc,'107');assert.equal((await fs.stat(first.signerFile)).mode&0o777,0o600);assert.equal((await fs.stat(first.stateDirectory)).mode&0o777,0o700);
   assert.deepEqual(await prepareDevelopmentRelay(args),first);assert.deepEqual(await fs.readFile(first.signerFile),key);assert.equal(quotes,1);assert.equal(fundCalls,2,'existing signed-once stage is revisited for reconciliation');
   await fs.unlink(first.signerFile);await assert.rejects(prepareDevelopmentRelay(args),/Original relay signer missing/);assert.equal(fundCalls,2);
   await fs.writeFile(first.signerFile,key,{mode:0o600});await fs.unlink(path.join(dir,'relay-policy.json'));await assert.rejects(prepareDevelopmentRelay(args),/Original relay policy missing/);assert.equal(fundCalls,2);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });

 test('persistent development uses native local settlement and rejects incompatible retained committees',async()=>{
  const {developmentSequencerProfile,assertDevelopmentCommittee}=await import('./network.mjs');
  assert.deepEqual(developmentSequencerProfile({persistent:true,proofs:false}),{useAutomineSequencer:true,automineEnableProveEpoch:true,aztecTargetCommitteeSize:0});
  assert.deepEqual(developmentSequencerProfile({persistent:false,proofs:false}),{useAutomineSequencer:false,automineEnableProveEpoch:false,aztecTargetCommitteeSize:1});
  assert.throws(()=>developmentSequencerProfile({persistent:true,proofs:true}));
  await assertDevelopmentCommittee({getTargetCommitteeSize:async()=>0});
  for(const size of [1,'0',undefined])await assert.rejects(assertDevelopmentCommittee({getTargetCommitteeSize:async()=>size}),/incompatible/);
  const {RollupContract}=await import('@aztec-labs/ethereum/contracts/rollup');
  for(const name of ['getTargetCommitteeSize','getCheckpointNumber','getProvenCheckpointNumber'])assert.equal(typeof RollupContract.prototype[name],'function',name+' is the installed SDK API');
 });
 test('native checkpoint lifecycle drains, settles and verifies before a clean snapshot (controlled SDK)',async()=>{
  const {settleNativeDevelopment}=await import('./network.mjs');let calls=[],proven=0;
  const native={pause:()=>calls.push('pause'),syncPoint:async()=>calls.push('sync'),prove:async()=>{calls.push('prove');proven=4;},resume:()=>calls.push('resume')};
  const node={getAutomineSequencer:()=>native,getChainTips:async()=>({checkpointed:{checkpoint:{number:4},block:{number:7,hash:'a'}},proposed:{number:7,hash:'a'}})},rollup={getCheckpointNumber:async()=>4,getProvenCheckpointNumber:async()=>proven};
  await settleNativeDevelopment({node,rollup,resume:false});assert.deepEqual(calls,['pause','sync','prove','sync']);
  calls=[];await settleNativeDevelopment({node,rollup});assert.equal(calls.at(-1),'resume');
  native.prove=async()=>{};proven=3;await assert.rejects(settleNativeDevelopment({node,rollup,resume:false}),e=>e.developmentStage==='verify'&&/unsettled/.test(e.cause.message));
  proven=4;rollup.getCheckpointNumber=async()=>5;await assert.rejects(settleNativeDevelopment({node,rollup}),e=>e.developmentStage==='verify'&&/unsettled/.test(e.cause.message));
  rollup.getCheckpointNumber=async()=>4;node.getChainTips=async()=>({checkpointed:{checkpoint:{number:4},block:{number:7,hash:'a'}},proposed:{number:7,hash:'b'}});await assert.rejects(settleNativeDevelopment({node,rollup}),e=>e.developmentStage==='verify'&&/unsettled/.test(e.cause.message));
  native.prove=async()=>{throw Error('controlled native failure');};await assert.rejects(settleNativeDevelopment({node,rollup,resume:false}),e=>e.developmentStage==='prove'&&e.cause.message==='controlled native failure');
 });
 test('initialized relay directory or budget loss refuses before funding or replacement (actual filesystem)',async()=>{
  const {prepareDevelopmentRelay}=await import('./liquidity.mjs'),dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'relay-loss-'))),state=path.join(dir,'relay-state');let stages=0;
  const args={directory:dir,stage:async()=>stages++};
  try{
   await fs.writeFile(path.join(dir,'progress.json'),JSON.stringify({entered:['relay-fund']}));
   await fs.writeFile(state+'.initialized.json',JSON.stringify({schemaVersion:1,identity:'0x'+'a'.repeat(64)}),{mode:0o600});
   await assert.rejects(prepareDevelopmentRelay(args),/initialized relay state missing/);await assert.rejects(fs.stat(state),{code:'ENOENT'});
   await fs.mkdir(state,{mode:0o700});await assert.rejects(prepareDevelopmentRelay(args),/initialized relay budget missing/);
   assert.equal(stages,0);assert.deepEqual(await fs.readdir(state),[]);
   await fs.writeFile(state+'.initialized.json','null',{mode:0o600});await assert.rejects(prepareDevelopmentRelay(args),/Invalid original relay initialization/);assert.equal(stages,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });

 test('actual pinned SwapRouter02 and Quoter ABI dependency readback uses inherited factory getter',async()=>{
  const {Contract,Interface}=await import('ethers');const {readLiquidityArtifacts,verifyDevelopmentV3}=await import('./liquidity.mjs');
  const artifacts=await readLiquidityArtifacts(),address=n=>'0x'+n.toString(16).padStart(40,'0'),factory=address(1),weth=address(2),calls=[];let wrong=false;
  function contract(artifact,at){const abi=new Interface(artifact.abi);return new Contract(at,abi,{call:async tx=>{const fn=abi.parseTransaction({data:tx.data});calls.push(fn.name);assert.equal(fn.args.length,0);assert(['factory','WETH9'].includes(fn.name));return abi.encodeFunctionResult(fn.name,[fn.name==='factory'?(wrong?address(9):factory):weth]);}});}
  const swap=contract(artifacts.SwapRouter02,address(3)),quoter=contract(artifacts.QuoterV2,address(4));
  assert.equal(swap.factoryV3,undefined,'factoryV3 is only a constructor input, not a callable method');
  await verifyDevelopmentV3({swap,quoter,factory,weth});assert.deepEqual(calls,['factory','WETH9','factory','WETH9']);
  wrong=true;await assert.rejects(verifyDevelopmentV3({swap,quoter,factory,weth}),/identity differs/);
 });

 test('native idle target uses actual installed warp rounding without a future clock (controlled L1)',async()=>{
  const {AutomineSequencer}=await import('@aztec-labs/sequencer-client/automine');
  const {developmentIdleWarpTarget}=await import('./network.mjs');
  const {RollupContract}=await import('@aztec-labs/ethereum/contracts/rollup');assert.equal(typeof RollupContract.prototype.getSlotDuration,'function');
  async function sample(conservative,genesis){
   let current=990,scheduled,wall=1000;const observations=[];
   const sdk=new AutomineSequencer({l1Constants:{l1GenesisTime:BigInt(genesis),slotDuration:5},ethCheatCodes:{lastBlockTimestamp:async()=>current,setNextBlockTimestamp:async t=>{assert(t>current);scheduled=t;}},dateProvider:{now:()=>current*1000,setTime:()=>{}},log:{debug(){},verbose(){}}});
   // Only L1 publication/settlement is controlled; warpTo, its serial queue,
   // runWarp and actual installed slot arithmetic all run unchanged.
   sdk.runBuild=async({allowEmpty})=>{assert.equal(allowEmpty,true);current=scheduled+2;return {};};sdk.queue.start();
   try{for(;wall<1025;wall++){
    const target=conservative?developmentIdleWarpTarget({wallSeconds:wall,slotDuration:5,ethereumSlotDuration:1}):wall;
    await sdk.warpTo(target);observations.push(wall-current);
   }}finally{await sdk.queue.end();}
   return observations;
  }
  assert((await sample(false,0)).some(lag=>lag<0),'old wall target reproduces future time');
  for(let genesis=0;genesis<5;genesis++)for(const lag of await sample(true,genesis)){assert(lag>=0,'fixed clock is not future');assert(lag<120,'original freshness bound retained');}
  for(const values of [{wallSeconds:1000,slotDuration:0,ethereumSlotDuration:1},{wallSeconds:1000,slotDuration:119,ethereumSlotDuration:1},{wallSeconds:1000.5,slotDuration:5,ethereumSlotDuration:1}])assert.throws(()=>developmentIdleWarpTarget(values),/Invalid native idle clock/);
 });

 test('shutdown diagnostics retain exact private causes with finite stages and safe settlement operands',async()=>{
  const {settleNativeDevelopment,developmentCleanupFailure,developmentShutdownSummary}=await import('./network.mjs');
  const privateError=Error('private-sentinel-not-public');let failure;
  const native={pause(){},async syncPoint(){},async prove(){},resume(){}};
  const node={getAutomineSequencer:()=>native,getChainTips:async()=>({checkpointed:{checkpoint:{number:229},block:{number:229,hash:'a'}},proposed:{number:229,hash:'b'}})};
  try{await settleNativeDevelopment({node,rollup:{getCheckpointNumber:async()=>229,getProvenCheckpointNumber:async()=>229},resume:false});}catch(e){failure=e;}
  assert.equal(failure.developmentStage,'verify');
  const summary=developmentShutdownSummary(new AggregateError([developmentCleanupFailure('settlement',failure),developmentCleanupFailure('checkpoint',privateError)],'private-sentinel-not-public'));
  assert.deepEqual(summary.failures,[{stage:'settlement'},{stage:'verify',observations:{pending:229,proven:229,checkpoint:229,proposedBlock:229,checkpointedBlock:229,sameBlockHash:false}},{stage:'checkpoint'}]);
  assert(!JSON.stringify(summary).includes('private-sentinel'));assert.equal(developmentCleanupFailure('checkpoint',privateError).cause,privateError);
  node.getChainTips=async()=>{throw privateError;};await assert.rejects(settleNativeDevelopment({node,rollup:{},resume:false}),e=>e.developmentStage==='tips'&&e.cause===privateError);
 });
 test('native recovery dump is distinct from qualified checkpoint and cannot admit an unclean restart',async()=>{
  const {developmentAnvilArgs,persistDevnetCheckpoint}=await import('./network.mjs');
  assert.throws(()=>developmentAnvilArgs({persistent:true,port:18545,mnemonic:'synthetic-only'}),/recovery path/);
  assert.throws(()=>developmentAnvilArgs({persistent:true,port:18545,mnemonic:'synthetic-only',recoveryPath:'/tmp/ethereum-state.json'}),/recovery path/);
  let saved=false;await assert.rejects(persistDevnetCheckpoint({persistent:true,bootComplete:true,priorFailure:true,save:async()=>{saved=true;}}));assert.equal(saved,false);
  assert.throws(()=>validateDevnetResume({...stopped,phase:'running',recoveryPath:'/tmp/anvil-recovery-00000000-0000-4000-8000-000000000000.json',cachePath:'/tmp/anvil-cache-00000000-0000-4000-8000-000000000000'},{fundingAddresses,ports,toolchainHash}),/recovery required/);
 });

 test('native file checkpoint streams private bytes and rejects unsafe files and mismatched formats',async()=>{
  const {inspectNativeDevnetSnapshot,developmentAnvilArgs}=await import('./network.mjs'),{createHash}=await import('node:crypto');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-checkpoint-')),name='anvil-recovery-00000000-0000-4000-8000-000000000000.json',file=path.join(dir,name);
  try{
   const bytes=Buffer.from('{"block":1}');await fs.writeFile(file,bytes,{mode:0o600});assert.deepEqual(await inspectNativeDevnetSnapshot(file),{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
   await fs.chmod(file,0o644);await assert.rejects(inspectNativeDevnetSnapshot(file));await fs.chmod(file,0o600);
   const link=path.join(dir,'link');await fs.symlink(file,link);await assert.rejects(inspectNativeDevnetSnapshot(link));
   await fs.truncate(file,7516192769);assert((await fs.stat(file)).blocks*512<1048576,'Oversize boundary fixture must remain sparse');await assert.rejects(inspectNativeDevnetSnapshot(file));await fs.truncate(file,1);await assert.rejects(inspectNativeDevnetSnapshot(file));
   const record={...stopped,snapshotFormat:'native-json-v1',snapshotFile:name,snapshotHead:{number:'0x10',hash:'0x'+'a'.repeat(64),pending:'7',proven:'7'}};
   assert.equal(validateDevnetResume(record,{fundingAddresses,ports,toolchainHash}),record);
   for(const change of [{snapshotFormat:'unknown'},{snapshotFile:'../'+name},{snapshotHead:{...record.snapshotHead,proven:'6'}},{snapshotHead:{...record.snapshotHead,hash:'invalid'}}])assert.throws(()=>validateDevnetResume({...record,...change},{fundingAddresses,ports,toolchainHash}));
   const options={persistent:true,port:18545,mnemonic:'synthetic-only',loadPath:file,recoveryPath:path.join(dir,'anvil-recovery-11111111-1111-4111-8111-111111111111.json'),cachePath:path.join(dir,'anvil-cache-11111111-1111-4111-8111-111111111111')};
   assert.deepEqual(developmentAnvilArgs(options).slice(-2),['--load-state',file]);assert.throws(()=>developmentAnvilArgs({...options,recoveryPath:file}));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
 });

 const {developmentAccountingReaderConfig}=await import('./bootstrap.mjs');
 let accountingFixturePromise;
 const accountingFixture=()=>accountingFixturePromise??=(async()=>{
  const {getContractInstanceFromInstantiationParams,getContractClassFromArtifact}=await import('@aztec-labs/stdlib/contract');
  const {AztecAddress}=await import('@aztec-labs/stdlib/aztec-address');
  const {sha256,toUtf8Bytes}=await import('ethers');const {rollingOperatorConfig}=await import('../operations.mjs');
  const boardRaw=JSON.parse(await fs.readFile(new URL('../../billboard/target/rolling_contract-RollingBoard.json',import.meta.url),'utf8'));
  const bokRaw=JSON.parse(await fs.readFile(new URL('../../experiments/private-bok/target/private_bok-PrivateBok.json',import.meta.url),'utf8'));
  const board=AztecAddress.fromBigIntUnsafe(42n),operator=AztecAddress.fromBigIntUnsafe(43n),salt=new Fr(45n).toString();
  const operatorConfig={applicationProfile:'rolling',nodeUrl:'http://127.0.0.1:18080/',ethereumUrl:'http://127.0.0.1:18545/',chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20),boardAddress:String(board),operatorAddress:String(operator),development:true,operatorFile:'/private/synthetic-actor-sentinel.json'};
  const args=[board,operator,31337n,1n],artifact=loadContractArtifact(bokRaw),boardClass=(await getContractClassFromArtifact(loadContractArtifact(boardRaw))).id.toString(),classId=(await getContractClassFromArtifact(artifact)).id.toString();
  const instance=await getContractInstanceFromInstantiationParams(artifact,{constructorArtifact:'init',constructorArgs:args,deployer:operator,salt:Fr.fromString(salt)});
  const deployment={version:instance.version,...Object.fromEntries(['address','deployer','originalContractClassId','currentContractClassId','salt','initializationHash','immutablesHash'].map(k=>[k,String(instance[k])])),storage:{board:String(board),operator:String(operator),owner:String(operator),l1_chain:new Fr(31337n).toString(),version:Fr.ONE.toString()}};
  const identity=JSON.stringify({profile:'rolling-private-bok-constructor/v1',config:rollingOperatorConfig(operatorConfig),actor:String(operator),artifactSha256:sha256(toUtf8Bytes(JSON.stringify(bokRaw))),classId,boardClass,constructor:args.map(String)});
  const hash='0x'+'13'.repeat(32),blockHash='0x'+'14'.repeat(32),directory='/private/synthetic-campaign';
  const journal={identity,salt,operations:{'deploy-escrow':{schemaVersion:1,policy:'reconcile-only',phase:'submission-unknown',identity,hash,raw:'private-signed-record-sentinel',deployment},bind:{hash:'0x'+'15'.repeat(32)},register:{hash:'0x'+'16'.repeat(32)}}};
  const readerConfig={nodeUrl:operatorConfig.nodeUrl,artifactPath:'/public/RollingBoard.json',scope:{chainId:'31337',rollupVersion:'1',rollupAddress:operatorConfig.rollupAddress,boardAddress:String(board),classId:boardClass},deployment:{blockNumber:3,blockHash:'0x'+'12'.repeat(32),txHash:'0x'+'11'.repeat(32)},cacheDirectory:directory+'/public-index',port:8080};
  return {directory,readerConfig,operatorConfig,journal,boardRaw,bokRaw,bokArtifactPath:'/public/PrivateBok.json',constructorResult:{status:'succeeded',canonical:true,scope:'constructor-only',profile:'rolling-private-bok-constructor/v1',transactionHash:hash,blockNumber:7,blockHash,escrow:deployment.address}};
 })();
 test('accounting startup derives exact public scope from original real ABI constructor and preserves old cache',async()=>{
  const input=structuredClone(await accountingFixture()),before=structuredClone(input),out=await developmentAccountingReaderConfig(input);
  assert.deepEqual(input,before);assert.equal(out.cacheDirectory,input.directory+'/public-index-bok');assert.equal(input.readerConfig.cacheDirectory,input.directory+'/public-index');
  assert.deepEqual(out.scope.bok,{address:input.constructorResult.escrow,classId:input.journal.operations['deploy-escrow'].deployment.originalContractClassId,operatorAddress:input.operatorConfig.operatorAddress,deployer:input.operatorConfig.operatorAddress,salt:input.journal.salt,deployment:{blockNumber:7,blockHash:input.constructorResult.blockHash,txHash:input.constructorResult.transactionHash}});
  assert.equal(out.bokArtifactPath,input.bokArtifactPath);assert.deepEqual(out.deployment,input.readerConfig.deployment);assert(!JSON.stringify(out).includes('sentinel'));
 });
 test('accounting startup refuses missing changed or noncanonical original constructor without latest fallback',async()=>{
  const mutations=[x=>{delete x.journal.operations['deploy-escrow'];},x=>{x.journal.operations['deploy-escrow'].phase='preparing';},x=>{x.constructorResult.transactionHash=x.journal.operations.register.hash;},x=>{x.constructorResult.canonical=false;},x=>{x.constructorResult.blockNumber=2;},x=>{x.journal.salt=Fr.ONE.toString();},x=>{x.journal.operations['deploy-escrow'].deployment.currentContractClassId=Fr.ONE.toString();},x=>{x.operatorConfig.operatorAddress=Fr.ONE.toString();},x=>{x.readerConfig.scope.classId=Fr.ONE.toString();},x=>{x.journal.identity+='changed';},x=>{x.constructorResult.escrow=Fr.ONE.toString();}];
  for(const mutate of mutations){const input=structuredClone(await accountingFixture());mutate(input);await assert.rejects(developmentAccountingReaderConfig(input),e=>e.message==='Original Bok accounting deployment identity unavailable'&&!String(e.stack).includes('sentinel'));}
 });
 test('accounting startup extended reader scope leaves strict public wallet validation unchanged',async()=>{
  const input=await accountingFixture(),out=await developmentAccountingReaderConfig(input),{validateRollingWalletConfig}=await import('../../scripts/rolling-wallet-assets.mjs');
  const gasSettings={gasLimits:{daGas:'1',l2Gas:'1'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}};
  const wallet={config:{network:{chainId:'31337',rollupVersion:'1',rollupAddress:input.operatorConfig.rollupAddress,ethRpcUrl:input.operatorConfig.ethereumUrl},board:{contractAddress:input.operatorConfig.boardAddress,portalAddress:'0x'+'17'.repeat(20)},privateFee:{contractAddress:Fr.ONE.toString(),gasSettings}},trustedQuery:{url:input.operatorConfig.nodeUrl,allowLocalDev:true},remoteProver:null,proofsEnabled:false};
  assert.deepEqual(validateRollingWalletConfig(wallet,out.scope),validateRollingWalletConfig(wallet,input.readerConfig.scope));
  assert.throws(()=>validateRollingWalletConfig(wallet,{...out.scope,boardAddress:Fr.ONE.toString()}));
 });

 test('development deployer awaits fresh PXE sync before initializerless constructor simulation',async()=>{
  const {initializeDevelopmentDeployer}=await import('./bootstrap.mjs');const calls=[];let release;
  const gate=new Promise(resolve=>{release=resolve;}),secret={},salt={},signingKey={},account={};
  const wallet={pxe:{async sync(){calls.push('sync-start');await gate;calls.push('sync-complete');}},async createSchnorrInitializerlessAccount(...args){assert.deepEqual(args,[secret,salt,signingKey,'local public deployer']);calls.push('constructor');return account;}};
  const pending=initializeDevelopmentDeployer(wallet,secret,salt,signingKey);await Promise.resolve();assert.deepEqual(calls,['sync-start']);
  release();assert.equal(await pending,account);assert.deepEqual(calls,['sync-start','sync-complete','constructor']);
 });
 test('development deployer failed synchronization cannot create account or swallow cleanup-owned error',async()=>{
  const {initializeDevelopmentDeployer}=await import('./bootstrap.mjs');const failure=Error('controlled sync failure');let constructors=0;
  await assert.rejects(initializeDevelopmentDeployer({pxe:{async sync(){throw failure;}},async createSchnorrInitializerlessAccount(){constructors++;}}),e=>e===failure);assert.equal(constructors,0);
  const constructorFailure=Error('controlled constructor failure');let syncs=0;
  await assert.rejects(initializeDevelopmentDeployer({pxe:{async sync(){syncs++;}},async createSchnorrInitializerlessAccount(){throw constructorFailure;}}),e=>e===constructorFailure);assert.equal(syncs,1);
 });

 test('native idle cadence uses measured thirty-second lag and preserves explicit readiness refresh',async()=>{
  const {developmentIdleWarpRequired}=await import('./network.mjs');
  for(const lag of [-10,0,1,29])assert.equal(developmentIdleWarpRequired({wallSeconds:1000,l1Timestamp:1000-lag}),false);
  for(const lag of [30,31,1000])assert.equal(developmentIdleWarpRequired({wallSeconds:1000,l1Timestamp:1000-lag}),true);
  assert.equal(developmentIdleWarpRequired({wallSeconds:1000,l1Timestamp:990,refresh:true}),true);
  for(const change of [{wallSeconds:NaN},{l1Timestamp:1.5},{l1Timestamp:-1},{refresh:'yes'}])assert.throws(()=>developmentIdleWarpRequired({wallSeconds:1000,l1Timestamp:990,...change}),/Invalid native idle cadence/);
 });
 test('native idle cadence bounds empty checkpoints while installed pending-build queue stays immediate',async()=>{
  const {AutomineSequencer}=await import('@aztec-labs/sequencer-client/automine');
  const {developmentIdleWarpTarget,developmentIdleWarpRequired}=await import('./network.mjs');
  async function sample(cadenced){
   let current=997,scheduled,wall=1000,empty=0,pending=0;const lags=[];
   const sdk=new AutomineSequencer({l1Constants:{l1GenesisTime:0n,slotDuration:5},ethCheatCodes:{lastBlockTimestamp:async()=>current,setNextBlockTimestamp:async t=>{assert(t>current);scheduled=t;}},dateProvider:{now:()=>current*1000,setTime:()=>{}},log:{debug(){},verbose(){}}});
   // Actual installed queues, pending-build dispatch and warp rounding; only
   // L1 publication/settlement is a finite controlled clock, not a real chain.
   sdk.runBuild=async({allowEmpty})=>{if(allowEmpty){empty++;current=scheduled+2;}else{pending++;current+=5;}return {};};sdk.running=true;sdk.queue.start();
   try{for(;wall<1180;wall++){
    if(wall===1010){assert(wall-current<30);await sdk.buildIfPending();assert.equal(pending,1);}
    if(!cadenced||developmentIdleWarpRequired({wallSeconds:wall,l1Timestamp:current}))await sdk.warpTo(developmentIdleWarpTarget({wallSeconds:wall,slotDuration:5,ethereumSlotDuration:1}));
    lags.push(wall-current);
   }
   // Explicit useWallClock refresh bypasses only the idle cadence; the same
   // conservative target and installed queue retain the nonfuture condition.
   if(developmentIdleWarpRequired({wallSeconds:wall,l1Timestamp:current,refresh:true}))await sdk.warpTo(developmentIdleWarpTarget({wallSeconds:wall,slotDuration:5,ethereumSlotDuration:1}));
   assert(wall-current>=0&&wall-current<5);
   }finally{await sdk.queue.end();}
   return {empty,pending,lags};
  }
  const old=await sample(false),now=await sample(true);assert(old.empty>30);assert(now.empty<=8&&now.empty>=5);assert.equal(now.pending,1);
  assert(now.lags.every(lag=>lag>=0&&lag<30),'idle age remains below original 60/120 second guards');
 });

 test('persistent development retains world state history separately without changing legacy configuration',async()=>{
  const {developmentWorldStateProfile}=await import('./network.mjs');
  assert.deepEqual(developmentWorldStateProfile({persistent:true,directory:'/private/campaign'}),{worldStateCheckpointHistory:0,worldStateDataDirectory:'/private/campaign/world-state-archive'});
  assert.deepEqual(developmentWorldStateProfile({persistent:false,directory:'legacy-relative'}),{});
  for(const directory of ['relative','/private/campaign/../other',undefined])assert.throws(()=>developmentWorldStateProfile({persistent:true,directory}),/Invalid persistent world state/);
  const {worldStateConfigMappings}=await import('@aztec-labs/world-state/config');assert.equal(worldStateConfigMappings.worldStateCheckpointHistory.defaultValue,64);assert.equal(worldStateConfigMappings.worldStateDataDirectory.env,'WS_DATA_DIRECTORY');
 });
 test('installed world state history-zero finalizes without pruning original checkpoints (controlled database)',async()=>{
  const {ServerWorldStateSynchronizer}=await import('@aztec-labs/world-state');const {developmentWorldStateProfile}=await import('./network.mjs');
  let finalized=0,archiveReads=0,closed=0;const stopAtPruning=Error('controlled finite-history pruning read');
  const db={getCommitted:()=>({}),getStatusSummary:async()=>({oldestHistoricalBlock:1}),setFinalized:async number=>{finalized++;return {finalizedBlockNumber:number};},close:async()=>{closed++;}};
  const blocks={getBlockData:async()=>{archiveReads++;throw stopAtPruning;}},log={info(){},debug(){},verbose(){},trace(){}};
  const infinite=new ServerWorldStateSynchronizer(db,blocks,developmentWorldStateProfile({persistent:true,directory:'/private/campaign'}),{},log);
  try{await infinite.handleChainFinalized(400);assert.equal(finalized,1);assert.equal(archiveReads,0);}finally{await infinite.stop();}
  const finite=new ServerWorldStateSynchronizer(db,blocks,{worldStateCheckpointHistory:64},{},log);
  try{await assert.rejects(finite.handleChainFinalized(400),e=>e===stopAtPruning);assert.equal(archiveReads,1);}finally{await finite.stop();}
  assert.equal(closed,2);
 });

 test('actual wall-clock wait fails immediately with the original mining error before or during a read',async()=>{
  // Execute the exact existing method with controlled closure dependencies;
  // no node/Anvil startup and no copied wait implementation or real sleep.
  const source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8'),open='async useWallClock(){',end='},checkHealth()';
  assert.equal(source.split(open).length,2);assert.equal(source.split(end).length,2);
  const method=source.slice(source.indexOf(open),source.indexOf(end)+1);
  const create=new Function('miningError','deployment','pause',`const persistent=true;let wallMode=false,wallRefreshRequested=false;return {${method},setError(error){miningError=error;},refresh(){return wallRefreshRequested;}};`);
  const error=Error('controlled original mining failure');let reads=0,sleeps=0;
  let owner=create(error,{l1Client:{getBlock:async()=>{reads++;}}},async()=>{sleeps++;});
  await assert.rejects(owner.useWallClock(),e=>e===error);assert.equal(reads,0);assert.equal(sleeps,0);assert.equal(owner.refresh(),false);
  owner=create(null,{l1Client:{getBlock:async()=>{reads++;owner.setError(error);return {timestamp:BigInt(Math.floor(Date.now()/1000))};}}},async()=>{sleeps++;});
  await assert.rejects(owner.useWallClock(),e=>e===error);assert.equal(reads,1);assert.equal(sleeps,0);assert.equal(owner.refresh(),false);
  owner=create(null,{l1Client:{getBlock:async()=>({timestamp:0n})}},async()=>{sleeps++;owner.setError(error);});
  await assert.rejects(owner.useWallClock(),e=>e===error);assert.equal(sleeps,1);assert.equal(owner.refresh(),false);
  owner=create(null,{l1Client:{getBlock:async()=>({timestamp:BigInt(Math.floor(Date.now()/1000))})}},async()=>assert.fail('fresh clock must not sleep'));
  await owner.useWallClock();assert.equal(owner.refresh(),false);
 });

 test('native startup readiness reserves retained-load margin beyond sixty seconds without another spawn',async()=>{
  const {waitForDevelopmentEthereum}=await import('./network.mjs');let time=0,calls=0;
  const input={rpcUrl:'http://127.0.0.1:19545',address:'0xabc',child:{exitCode:null,signalCode:null},now:()=>time,wait:async ms=>{assert(ms<=100);time+=ms;},fetchImpl:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:19545');assert.deepEqual(JSON.parse(options.body),{jsonrpc:'2.0',id:1,method:'eth_accounts',params:[]});if(time<74995)throw Error('still loading');return {json:async()=>({result:['0xAbC']})};}};
  assert.deepEqual(await waitForDevelopmentEthereum({...input,retainedNative:true}),{elapsedMs:75000,attempts:751});assert.equal(calls,751);
  time=0;calls=0;await assert.rejects(waitForDevelopmentEthereum(input),/failed to start/);assert.equal(time,6000);assert.equal(calls,60);
 });
 test('native startup readiness has a finite original-process deadline and never accepts wrong identity',async()=>{
  const {waitForDevelopmentEthereum}=await import('./network.mjs');let time=0,calls=0;
  const input={rpcUrl:'http://127.0.0.1:19545',address:'0xabc',child:{exitCode:null,signalCode:null},retainedNative:true,now:()=>time,wait:async ms=>{time+=ms;},fetchImpl:async()=>{calls++;return {json:async()=>({result:['0xdef']})};}};
  await assert.rejects(waitForDevelopmentEthereum(input),/failed to start/);assert.equal(time,120000);assert.equal(calls,1200);
  time=0;await assert.rejects(waitForDevelopmentEthereum({...input,fetchImpl:async()=>{time=120000;return {json:async()=>({result:['0xabc']})};}}),/failed to start/);assert.equal(time,120000);
 });
 test('native startup readiness preserves spawn errors and rejects exit before or during a read',async()=>{
  const {waitForDevelopmentEthereum}=await import('./network.mjs');const original=Error('controlled spawn');let reads=0;
  const child={exitCode:null,signalCode:null},input={rpcUrl:'http://127.0.0.1:19545',address:'0xabc',child,fetchImpl:async()=>{reads++;return {json:async()=>({result:['0xabc']})};}};
  await assert.rejects(waitForDevelopmentEthereum({...input,spawnFailure:()=>original}),e=>e===original);assert.equal(reads,0);
  child.exitCode=1;await assert.rejects(waitForDevelopmentEthereum(input),/exited during startup/);assert.equal(reads,0);
  child.exitCode=null;child.signalCode='SIGTERM';await assert.rejects(waitForDevelopmentEthereum(input),/exited during startup/);assert.equal(reads,0);
  child.signalCode=null;await assert.rejects(waitForDevelopmentEthereum({...input,fetchImpl:async()=>{child.exitCode=0;return {json:async()=>({result:['0xabc']})};}}),/exited during startup/);
 });

 test('restored native clock resets only the verified timestamp and preserves the exact head',async()=>{
  const {restoreDevelopmentNativeClock}=await import('./network.mjs');const head={number:439n,hash:'0x'+'1'.repeat(64),timestamp:1791963551n},calls=[];
  const client={async request(arg){assert.equal(this,client);calls.push(arg);return 0;},async getBlock(arg){assert.equal(this,client);calls.push(arg);return {...head};}};
  await restoreDevelopmentNativeClock(client,head);assert.deepEqual(calls,[{method:'evm_setTime',params:[1791963551]},{blockTag:'latest'}]);
  const source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8');
  assert(source.indexOf('await restoreDevelopmentNativeClock(c,head)')>source.indexOf("throw Error('Native development checkpoint identity differs')"));
  assert(source.indexOf('await restoreDevelopmentNativeClock(c,head)')<source.indexOf('node=await createAztecNodeService'));
 });
 test('restored native clock rejects RPC failure without fallback and preserves falsy errors',async()=>{
  const {restoreDevelopmentNativeClock}=await import('./network.mjs');const head={number:1n,hash:'0x'+'1'.repeat(64),timestamp:100n};
  for(const original of [Error('controlled RPC rejection'),null,undefined,false,0]){let reads=0,calls=0,caught=false;
   try{await restoreDevelopmentNativeClock({request:async()=>{calls++;throw original;},getBlock:async()=>{reads++;}},head);}catch(error){caught=true;assert.equal(error,original);}
   assert(caught);assert.equal(calls,1);assert.equal(reads,0);
  }
 });
 test('restored native clock rejects changed head and invalid timestamp',async()=>{
  const {restoreDevelopmentNativeClock}=await import('./network.mjs');const head={number:1n,hash:'0x'+'1'.repeat(64),timestamp:100n};
  for(const change of [{number:2n},{hash:'0x'+'2'.repeat(64)},{timestamp:101n}])await assert.rejects(restoreDevelopmentNativeClock({request:async()=>0,getBlock:async()=>({...head,...change})},head),/checkpoint changed/);
  for(const timestamp of [-1n,9007199254740992n,1.5]){let calls=0;await assert.rejects(restoreDevelopmentNativeClock({request:async()=>{calls++;}}, {...head,timestamp}),/Invalid restored native timestamp/);assert.equal(calls,0);}
 });
 test('restored native clock permits actual installed lag-safe warp after Anvil wall-floor rejection',async()=>{
  const {restoreDevelopmentNativeClock,developmentIdleWarpTarget}=await import('./network.mjs');const {AutomineSequencer}=await import('@aztec-labs/sequencer-client/automine');
  let current=1000,floor=2000,scheduled,builds=0;const head={number:1n,hash:'0x'+'1'.repeat(64),timestamp:1000n};
  const sdk=new AutomineSequencer({l1Constants:{l1GenesisTime:0n,slotDuration:5},ethCheatCodes:{lastBlockTimestamp:async()=>current,setNextBlockTimestamp:async t=>{if(t<floor)throw Error('Timestamp error: lower than previous');scheduled=t;}},dateProvider:{now:()=>current*1000,setTime(){}},log:{debug(){},verbose(){}}});
  sdk.runBuild=async()=>{builds++;current=scheduled+2;return {};};sdk.queue.start();
  const target=developmentIdleWarpTarget({wallSeconds:2000,slotDuration:5,ethereumSlotDuration:1});
  try{await assert.rejects(sdk.warpTo(target),/lower than previous/);assert.equal(builds,0);
   await restoreDevelopmentNativeClock({request:async({method,params})=>{assert.equal(method,'evm_setTime');floor=params[0];return 0;},getBlock:async()=>({...head})},head);
   await sdk.warpTo(target);assert.equal(builds,1);assert(current<=2000);assert(2000-current<120);
  }finally{await sdk.queue.end();}
 });

 test('development query gateway pins existing disabled service and canonical compact tier',async()=>{
  const {developmentQueryServiceConfig}=await import('./bootstrap.mjs');
  const config=developmentQueryServiceConfig({directory:'/private/tmp/development',appPort:8081,nodeUrl:'http://127.0.0.1:18081',rollupAddress:'0x'+'1'.repeat(40),rollupVersion:1,board:'0x'+'2'.repeat(64),privateFeeAddress:'0x'+'3'.repeat(64),privateBokAddress:'0x'+'4'.repeat(64)});
  assert.equal(config.host,'127.0.0.1');assert.equal(config.port,0);assert.equal(config.chainId,31337);assert.equal(config.proofs,'disabled');assert.equal(config.applicationProfile,'rolling');assert.equal(config.bokEnabled,true);
  assert.deepEqual(config.compactBlocks,{tier:'checkpointed'});assert.equal(config.compactRequestsPerMinute,1800);assert.deepEqual(config.origins,['http://127.0.0.1:8081','http://localhost:8081']);assert.equal(config.queryNode.url,'http://127.0.0.1:18081');assert.equal(config.queryNode.maxLagSeconds,120);
  const source=await fs.readFile(new URL('./bootstrap.mjs',import.meta.url),'utf8');assert(source.includes("queryService.address.port+'/v1/node'"));assert(source.includes('trustedQuery:{url:queryUrl,allowLocalDev:true}'));
  assert(source.includes("{onQueryFailure:(code,diagnostic)=>onProgress(JSON.stringify({event:'development-query-unavailable',code,at:Date.now(),...(diagnostic?{diagnostic}:{})}))}"));
  assert.equal(Object.hasOwn(config,'onQueryFailure'),false);
  assert(source.indexOf('await queryService?.close()')<source.indexOf('await net.close()',source.indexOf('await queryService?.close()')));
 });
 test('development native RPC mounts original compact route and retains ordinary node RPC',async()=>{
  const {startDevelopmentNodeRpc}=await import('./network.mjs');
  const events=[];const unused=async()=>{throw Error('Unexpected native read');};
  const node={getNodeInfo:unused,getChainTips:unused,getWorldStateSyncStatus:unused,getSyncedL1Timestamp:unused,getBlockData:unused,getBlock:unused,getBlockNumber:async()=>7};
  const service=await startDevelopmentNodeRpc({node,config:{l1ChainId:31337,rollupVersion:1,rollupAddress:'0x'+'1'.repeat(40),realProofs:false},onProgress:value=>{events.push(JSON.parse(value));return new Promise(()=>{});}});
  try{
   const wrongMethod=await fetch(service.url+'/rolling/compact-block-v1');assert.equal(wrongMethod.status,405);await wrongMethod.body.cancel();
   const origin=await fetch(service.url+'/rolling/compact-block-v1',{method:'POST',headers:{origin:'http://127.0.0.1:8081','content-type':'application/json'},body:'{}'});assert.equal(origin.status,415);await origin.body.cancel();
   const malformed=await fetch(service.url+'/rolling/compact-block-v1',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(malformed.status,400);await malformed.body.cancel();assert.deepEqual({...events[0],at:0},{event:'development-compact-unavailable',at:0,stage:'request',status:400,diagnostic:null});
   const ordinary=await fetch(service.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'aztec_getBlockNumber',params:[]})});assert.equal(ordinary.status,200);assert.equal((await ordinary.json()).result,7);
  }finally{await service.close();}
  await assert.rejects(fetch(service.url,{signal:AbortSignal.timeout(1000)}));
 });
 test('development compact shutdown waits for its original pending native request',async()=>{
  const {startDevelopmentNodeRpc}=await import('./network.mjs');let release,started;
  const entered=new Promise(resolve=>{started=resolve;}),held=new Promise(resolve=>{release=resolve;});const unused=async()=>{throw Error('Unexpected native read');};
  const node={getNodeInfo:async()=>{started();await held;throw Error('Controlled native failure');},getChainTips:unused,getWorldStateSyncStatus:unused,getSyncedL1Timestamp:unused,getBlockData:unused,getBlock:unused};
  const service=await startDevelopmentNodeRpc({node,config:{l1ChainId:31337,rollupVersion:1,rollupAddress:'0x'+'1'.repeat(40),realProofs:false}});
  let closing;const response=fetch(service.url+'/rolling/compact-block-v1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,number:1,hash:'0x'+'1'.padStart(64,'0'),tier:'checkpointed'})}).then(r=>r.body.cancel(),()=>{});
  try{await entered;let complete=false;closing=service.close().then(()=>{complete=true;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(complete,false);release();await closing;await response;assert.equal(complete,true);}
  finally{release();await service.close();await response;}
 });

 test('native mining failure diagnostic captures only allowlisted own data and survives hostile getters and sinks',async()=>{
  const {reportDevelopmentMiningFailure}=await import('./network.mjs');const reports=[];
  const error=Object.assign(Error('PRIVATE_MESSAGE'),{name:'TimeoutError',code:'ETIMEDOUT',cause:{name:'HttpRequestError',code:'ECONNRESET',url:'PRIVATE_URL'}});
  reportDevelopmentMiningFailure(value=>reports.push(JSON.parse(value)),'warp-l1-clock',error);
  assert.deepEqual(reports[0].error,{name:'TimeoutError',code:'ETIMEDOUT'});assert.deepEqual(reports[0].cause,{name:'HttpRequestError',code:'ECONNRESET'});assert.equal(reports[0].stage,'warp-l1-clock');assert.equal(reports[0].event,'development-mining-stopped');assert(Number.isSafeInteger(reports[0].at));assert(!JSON.stringify(reports).includes('PRIVATE'));
  let reads=0;const hostile=Object.create(null);for(const key of ['name','code','cause','message','stack'])Object.defineProperty(hostile,key,{get(){reads++;throw Error('PRIVATE_GETTER');}});
  reportDevelopmentMiningFailure(value=>reports.push(JSON.parse(value)),'read-l1-head',hostile);assert.equal(reads,0);assert.deepEqual(reports[1].error,{name:null,code:null});assert.deepEqual(reports[1].cause,{name:null,code:null});
  assert.doesNotThrow(()=>reportDevelopmentMiningFailure(()=>{throw Error('sink failed');},'read-l1-head',error));
  reportDevelopmentMiningFailure(value=>reports.push(JSON.parse(value)),'PRIVATE_STAGE',{name:'PRIVATE_NAME',code:'PRIVATE_CODE'});assert.equal(reports[2].stage,'unknown');assert.deepEqual(reports[2].error,{name:null,code:null});
 });
 test('actual native mining loop retains original read and warp failure and stops without retry even if diagnostic sink throws',async()=>{
  const {reportDevelopmentMiningFailure}=await import('./network.mjs'),source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8');
  const start=source.indexOf('mining=(async()=>'),end=source.indexOf('    if(!persistent)await sequencer.start();',start),body=source.slice(start,end);
  const run=new Function('deployment','sequencer','onProgress','reportDevelopmentMiningFailure',`return (async()=>{const persistent=true,settling=false,wallRefreshRequested=false,idleSlotDuration=5,config={ethereumSlotDuration:1};let stopMining=false,miningError,clockTick,mining;const pause=async()=>{throw Error('unexpected retry');},developmentIdleWarpRequired=()=>true,developmentIdleWarpTarget=()=>1;${body}await mining;return {stopMining,miningError};})();`);
  for(const stage of ['read-l1-head','warp-l1-clock']){const original=Object.assign(Error('original'),{name:'TimeoutError',code:'ETIMEDOUT'});let reads=0,warps=0,events=0;
   const outcome=await run({l1Client:{getBlock:async()=>{reads++;if(stage==='read-l1-head')throw original;return {timestamp:1n};}}},{warpTo:async()=>{warps++;throw original;}},text=>{events++;assert.equal(JSON.parse(text).stage,stage);throw Error('sink failure');},reportDevelopmentMiningFailure);
   assert.equal(outcome.miningError,original);assert.equal(outcome.stopMining,true);assert.equal(reads,1);assert.equal(warps,stage==='warp-l1-clock'?1:0);assert.equal(events,1);
  }
 });

 test('native checkpoint replacement retains predecessor and cache until actual matching load qualification',async()=>{
  const {commitNativeDevnetCheckpoint,pruneLoadedNativeDevnetPredecessor,inspectNativeDevnetSnapshot,createDevelopmentAnvilCache}=await import('./network.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-retention-'));const statePath=path.join(directory,'network.json'),previous=path.join(directory,'anvil-recovery-00000000-0000-4000-8000-000000000000.json'),recoveryPath=path.join(directory,'anvil-recovery-11111111-1111-4111-8111-111111111111.json'),unrelated=path.join(directory,'anvil-recovery-22222222-2222-4222-8222-222222222222.json');
  try{for(const file of [previous,recoveryPath,unrelated])await fs.writeFile(file,'{}',{mode:0o600});const anvilCache=await createDevelopmentAnvilCache(directory),checkpointHead={number:'0x1',hash:'0x'+'a'.repeat(64),pending:'1',proven:'1'},saved={...stopped,snapshotFormat:'native-json-v1',snapshotFile:path.basename(previous),snapshotHash:(await inspectNativeDevnetSnapshot(previous)).sha256,snapshotHead:checkpointHead};
   await commitNativeDevnetCheckpoint({directory,statePath,state:saved,saved,recoveryPath,checkpointHead,anvilCache});
   const record=JSON.parse(await fs.readFile(statePath));assert.equal(record.phase,'stopped');assert.equal(record.snapshotFile,path.basename(recoveryPath));assert.equal(record.snapshotHash,(await inspectNativeDevnetSnapshot(recoveryPath)).sha256);
   assert.equal(record.snapshotPredecessor.snapshotFile,path.basename(previous));assert.equal(await fs.readFile(previous,'utf8'),'{}');assert((await fs.stat(anvilCache.path)).isDirectory());
   const restored={directory,statePath,state:record,head:{number:1n,hash:checkpointHead.hash},pending:'1',proven:'1'};
   await assert.rejects(pruneLoadedNativeDevnetPredecessor({...restored,pending:'2'}),/identity differs/);assert.equal(await fs.readFile(previous,'utf8'),'{}');assert((await fs.stat(anvilCache.path)).isDirectory());
   const next=await pruneLoadedNativeDevnetPredecessor(restored);assert.equal(next.snapshotPredecessor,undefined);assert.equal(next.snapshotCache,undefined);
   await assert.rejects(fs.stat(previous),{code:'ENOENT'});await assert.rejects(fs.stat(anvilCache.path),{code:'ENOENT'});assert.equal(await fs.readFile(unrelated,'utf8'),'{}');assert.equal(await fs.readFile(recoveryPath,'utf8'),'{}');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
 });
 test('truncated native dump retains good predecessor and cache, with candidate sync before metadata publication',async()=>{
  const {commitNativeDevnetCheckpoint,inspectNativeDevnetSnapshot,createDevelopmentAnvilCache}=await import('./network.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-truncated-')),statePath=path.join(directory,'network.json'),previous=path.join(directory,'anvil-recovery-00000000-0000-4000-8000-000000000000.json'),recoveryPath=path.join(directory,'anvil-recovery-11111111-1111-4111-8111-111111111111.json');
  const open=fs.open,events=[];
  try{await fs.writeFile(previous,'{}',{mode:0o600});await fs.writeFile(recoveryPath,'{"block":[',{mode:0o600});const anvilCache=await createDevelopmentAnvilCache(directory),checkpointHead={number:'0x1',hash:'0x'+'a'.repeat(64),pending:'1',proven:'1'},saved={...stopped,snapshotFormat:'native-json-v1',snapshotFile:path.basename(previous),snapshotHash:(await inspectNativeDevnetSnapshot(previous)).sha256,snapshotHead:checkpointHead};
   fs.open=async(...args)=>{if(args[0]===statePath+'.tmp')events.push('metadata-open');const fd=await open(...args);if(args[0]!==recoveryPath)return fd;return new Proxy(fd,{get(target,key){if(key==='sync')return async()=>{await target.sync();events.push('candidate-synced');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
   await commitNativeDevnetCheckpoint({directory,statePath,state:saved,saved,recoveryPath,checkpointHead,anvilCache});
   assert(events.indexOf('candidate-synced')>=0&&events.indexOf('candidate-synced')<events.indexOf('metadata-open'));
   assert.throws(()=>JSON.parse('{"block":['));
   assert.equal(await fs.readFile(previous,'utf8'),'{}');assert.equal(await fs.readFile(recoveryPath,'utf8'),'{"block":[');assert((await fs.stat(anvilCache.path)).isDirectory());
   const record=JSON.parse(await fs.readFile(statePath));assert.equal(record.snapshotPredecessor.snapshotHash,saved.snapshotHash);assert.equal(record.snapshotPredecessor.snapshotHead.hash,checkpointHead.hash);
   const source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8');assert(source.indexOf('state=await pruneLoadedNativeDevnetPredecessor(')>source.indexOf('await restoreDevelopmentNativeClock(c,head)'));
  }finally{fs.open=open;await fs.rm(directory,{recursive:true,force:true});}
 });
 test('native checkpoint validation or record-commit failure preserves previous and candidate snapshots',async()=>{
  const {commitNativeDevnetCheckpoint,inspectNativeDevnetSnapshot}=await import('./network.mjs');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'native-retention-failure-')),statePath=path.join(directory,'network.json'),previous=path.join(directory,'anvil-recovery-00000000-0000-4000-8000-000000000000.json'),recoveryPath=path.join(directory,'anvil-recovery-11111111-1111-4111-8111-111111111111.json');
  try{await fs.writeFile(previous,'{}',{mode:0o600});await fs.writeFile(recoveryPath,'{}',{mode:0o600});const saved={snapshotFormat:'native-json-v1',snapshotFile:path.basename(previous),snapshotHash:(await inspectNativeDevnetSnapshot(previous)).sha256};const input={directory,statePath,state:{},saved,recoveryPath,checkpointHead:{number:'0x1'}};
   await assert.rejects(commitNativeDevnetCheckpoint({...input,saved:{...saved,snapshotHash:'0'.repeat(64)}}),/Previous native checkpoint differs/);
   await assert.rejects(commitNativeDevnetCheckpoint({...input,saved:{...saved,snapshotFile:'../'+saved.snapshotFile}}),/ownership|differs/);
   await fs.writeFile(statePath+'.tmp','exclusive owner',{mode:0o600});await assert.rejects(commitNativeDevnetCheckpoint(input),{code:'EEXIST'});
   for(const file of [previous,recoveryPath])assert.equal(await fs.readFile(file,'utf8'),'{}');await assert.rejects(fs.stat(statePath),{code:'ENOENT'});
  }finally{await fs.rm(directory,{recursive:true,force:true});}
 });
 test('storage admission rejects insufficient space before mutating the retained phase or creating its candidate',async()=>{
  const source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8');
  const {assertDevelopmentStorageCapacity}=await import('./network.mjs');const original=fs.statfs;let reads=0;
  const check=bytes=>{fs.statfs=async(directory,options)=>{reads++;assert.equal(directory,'/private/state');assert.equal(options.bigint,true);return {bavail:bytes,bsize:1n};};return assertDevelopmentStorageCapacity('/private/state');};
  try{await assert.rejects(check(9663676415n),/9 GiB free/);await check(9663676416n);assert.equal(reads,2);}finally{fs.statfs=original;}
  assert(source.indexOf('if(persistent)await assertDevelopmentStorageCapacity(directory)')<source.indexOf("await writeDevnetRecord(statePath,{...state,phase:'starting'}"));
 });

 test('Anvil cache cleanup owns one private run directory, refuses replacement and never follows a link',async()=>{
  const {createDevelopmentAnvilCache,removeDevelopmentAnvilCache}=await import('./network.mjs');const directory=await fs.mkdtemp(path.join(os.tmpdir(),'anvil-cache-owner-'));
  try{const owned=await createDevelopmentAnvilCache(directory),other=path.join(directory,'unrelated');await fs.mkdir(other);await fs.writeFile(path.join(other,'keep'),'retained');await fs.symlink(other,path.join(owned.path,'link'));
   await assert.rejects(removeDevelopmentAnvilCache({...owned,ino:owned.ino+1}),/ownership changed/);assert((await fs.stat(owned.path)).isDirectory());
   await removeDevelopmentAnvilCache(owned);await assert.rejects(fs.stat(owned.path),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(other,'keep'),'utf8'),'retained');
   await fs.symlink(other,owned.path);await assert.rejects(removeDevelopmentAnvilCache(owned),/ownership changed/);assert.equal(await fs.readFile(path.join(other,'keep'),'utf8'),'retained');
   const source=await fs.readFile(new URL('./network.mjs',import.meta.url),'utf8');assert(source.includes('if(cache)await removeDevelopmentAnvilCache({path:path.join(directory,cache.directory),dev:cache.dev,ino:cache.ino})'));assert(!source.includes('if(anvilCache)await removeDevelopmentAnvilCache(anvilCache)'));
  }finally{await fs.rm(directory,{recursive:true,force:true});}
 });

}
