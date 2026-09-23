import {applicationProofsEnabled,applicationProver} from './testing/proof-policy.mjs';
// TEST ONLY: disposable genuine-verifier node and explicitly selected bridge qualification.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createAztecNodeService} from '@aztec/aztec-node';
import {SecretValue} from '@aztec/foundation/config';
import {EthAddress} from '@aztec/foundation/eth-address';
import {TestDateProvider} from '@aztec/foundation/timer';
import {createBlobClient} from '@aztec/blob-client/client';
import {initTelemetryClient} from '@aztec/telemetry-client';
import {RollupContract} from '@aztec/ethereum/contracts/rollup';
import {RunningPromise} from '@aztec/foundation/running-promise';
export async function qualifyC01RealNode({config,deployment,genesis,directory,privateKey,address,preparation,mark,browserControl,scenario,operatorPackage}){
  assert(scenario&&typeof scenario.run==='function');
  assert(['node','included-board','activated-board'].includes(scenario.fixture));
  const nodeConfig={...config,...deployment.l1ContractAddresses,rollupVersion:deployment.rollupVersion,
    dataDirectory:path.join(directory,'node'),bootstrapNodes:[],p2pEnabled:false,
    txPublicSetupAllowListExtend:[],sequencerPublisherPrivateKeys:[new SecretValue(privateKey)],
    validatorPrivateKeys:new SecretValue([privateKey]),coinbase:EthAddress.fromString(address),
    allowEphemeralSigningProtection:true,realProofs:applicationProofsEnabled(),useAutomineSequencer:false,automineEnableProveEpoch:false,
    enableProverNode:false,proverAgentCount:0,
    // Application contention concerns one private anchor, not network batch throughput.
    ...(scenario.name==='contention'?{maxTxsPerBlock:1}:{}),
    bbBinaryPath:path.join(directory,'bb-one-thread'),bbWorkingDirectory:path.join(directory,'bb-work'),
    bbChonkVerifyMaxBatch:1,bbChonkVerifyConcurrency:1,bbIVCConcurrency:1,numConcurrentIVCVerifiers:1,
  };
  let node;
  const include=scenario.fixture!=='node';
  const subscriptions=[],loops=[];
  const oldListen=RollupContract.prototype.listenToSlasherChanged;
  const oldStart=RunningPromise.prototype.start;
  if(include){
    RollupContract.prototype.listenToSlasherChanged=function(...args){const unsubscribe=oldListen.apply(this,args);subscriptions.push(unsubscribe);return unsubscribe;};
    RunningPromise.prototype.start=function(...args){if(new Error().stack.includes('RollupContract.listenToSlasherChanged'))loops.push(this);return oldStart.apply(this,args);};
  }
  const dateProvider=new TestDateProvider({warn(){}});

  const observation={passed:false,scope:'application node with transaction verification; no network prover'};
  try{
    node=await createAztecNodeService(nodeConfig,{telemetry:await initTelemetryClient({}),blobClient:createBlobClient(),dateProvider},{genesis,dontStartSequencer:true,dontStartProverNode:true});
    assert.equal((await node.getConfig()).realProofs,applicationProofsEnabled());
    const actual=node.config; // installed admin API omits static startup settings; inspect constructed service config.
    assert.equal(actual.realProofs,applicationProofsEnabled());assert.equal(actual.enableProverNode,false);
    for(const key of ['useAutomineSequencer','automineEnableProveEpoch'])assert.equal(actual[key],false);
    assert(!node.getProverNode(),'Application tests must not create a network prover');
    assert(node.getSequencer(),'Ordinary sequencer absent');assert(!node.getAutomineSequencer());
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    observation.realProofs=applicationProofsEnabled();observation.proverSubsystemCreated=false;
    observation.ordinarySequencerConstructed=true;observation.sequencerStarted=false;
    observation.rollupVersion=Number(info.rollupVersion);
    const ctx={node,config:nodeConfig,deployment,preparation,directory,dateProvider,browserControl,scenario,mark,l1Client:deployment.l1Client,rollupAddress:deployment.l1ContractAddresses.rollupAddress,packageRoot:operatorPackage?.root};
    if(include){
      assert(preparation);mark('prove-board-deployment');
      const {proveC01BoardDeployment}=await import('./c01-board-flow.mjs');
      observation.board=await proveC01BoardDeployment(node,preparation,{rollupAddress:ctx.rollupAddress,rollupVersion:deployment.rollupVersion,directory,reportStage:mark});assert(observation.board.passed);
      const {includeC01Board}=await import('./c01-board-inclusion.mjs');
      mark('board-inclusion');observation.inclusion=await includeC01Board({node,tx:observation.board.tx,rpcUrl:config.l1RpcUrls[0],dateProvider});assert(observation.inclusion.passed);
      Object.assign(ctx,{instance:observation.board.instance,inclusion:observation.inclusion});observation.sequencerStarted=true;
      if(scenario.fixture==='activated-board'){
        const {prepareAndProveC01Ready}=await import('./c01-ready-flow.mjs');
        observation.ready=await prepareAndProveC01Ready({...ctx,deploymentReceipt:ctx.inclusion,rollupVersion:deployment.rollupVersion});assert(observation.ready.passed);
        mark('ready-inclusion');observation.readyInclusion=await includeC01Board({node,tx:observation.ready.tx,rpcUrl:config.l1RpcUrls[0],dateProvider,startSequencer:false});assert(observation.readyInclusion.passed);
        const effect=await node.getTxEffect(observation.ready.tx.getTxHash());assert(effect?.data);assert(effect.data.l2ToL1Msgs.some(message=>message.toString()===observation.ready.expectedReadyLeaf));
        Object.assign(observation.ready,{readyEmitted:true,bindingSubmitted:true});
        const {settleC01Ready}=await import('./c01-settle-ready.mjs');
        mark('ready-settlement');observation.settlement=await settleC01Ready({...ctx,ready:observation.ready,readyInclusion:observation.readyInclusion});assert(observation.settlement.passed);
        Object.assign(observation.ready,{portalActivated:true,epochProofAccepted:false,controlledSettlement:true});Object.assign(ctx,{ready:observation.ready,settlement:observation.settlement});
      }
    }
    const result=await scenario.run(ctx);assert(result.passed);
    if(scenario.name==='censor-commands')observation.censorCommands=result;
    else if(scenario.fixture==='activated-board'&&scenario.name!=='activated-board')observation.bridge=result;
    else observation.scenario=result;
    observation.scope=scenario.description;observation.epochSchedulingStarted=false;observation.idleProverAgentCreated=false;
    observation.passed=true;
  }finally{
    try{if(node){await node.stop();observation.nodeStopped=true;}}
    finally{try{const failures=[];for(const unsubscribe of subscriptions){try{unsubscribe();}catch(error){failures.push(error);}}await Promise.all(loops.map(loop=>loop.runningPromise));if(failures.length)throw new AggregateError(failures);}finally{RollupContract.prototype.listenToSlasherChanged=oldListen;RunningPromise.prototype.start=oldStart;}}
  }
  return observation;
}
