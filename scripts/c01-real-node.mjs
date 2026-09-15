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
import {ROOT} from './toolchain.mjs';
export async function qualifyC01RealNode({config,deployment,genesis,directory,privateKey,address,preparation,mark}){
  const nodeConfig={...config,...deployment.l1ContractAddresses,rollupVersion:deployment.rollupVersion,
    dataDirectory:path.join(directory,'node'),bootstrapNodes:[],p2pEnabled:false,
    txPublicSetupAllowListExtend:[],sequencerPublisherPrivateKeys:[new SecretValue(privateKey)],
    validatorPrivateKeys:new SecretValue([privateKey]),coinbase:EthAddress.fromString(address),
    allowEphemeralSigningProtection:true,realProofs:true,useAutomineSequencer:false,automineEnableProveEpoch:false,
    enableProverNode:false,proverAgentCount:0,
    // Application contention concerns one private anchor, not network batch throughput.
    ...(process.env.C03_CONTENTION==='true'?{maxTxsPerBlock:1}:{}),
    bbBinaryPath:path.join(directory,'bb-one-thread'),bbWorkingDirectory:path.join(directory,'bb-work'),
    bbChonkVerifyMaxBatch:1,bbChonkVerifyConcurrency:1,bbIVCConcurrency:1,numConcurrentIVCVerifiers:1,
  };
  let node;
  const include=process.env.C01_BOARD_INCLUDE==='true';
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
    node=await createAztecNodeService(nodeConfig,{telemetry:await initTelemetryClient({}),blobClient:createBlobClient(),dateProvider},{genesis,dontStartSequencer:true,dontStartProverNode:include});
    assert.equal((await node.getConfig()).realProofs,true);
    const actual=node.config; // installed admin API omits static startup settings; inspect constructed service config.
    assert.equal(actual.realProofs,true);assert.equal(actual.enableProverNode,false);
    for(const key of ['useAutomineSequencer','automineEnableProveEpoch'])assert.equal(actual[key],false);
    assert(!node.getProverNode(),'Application tests must not create a network prover');
    assert(node.getSequencer(),'Ordinary sequencer absent');assert(!node.getAutomineSequencer());
    const info=await node.getNodeInfo();assert.equal(Number(info.l1ChainId),31337);
    observation.realProofs=true;observation.proverSubsystemCreated=false;
    observation.ordinarySequencerConstructed=true;observation.sequencerStarted=false;
    observation.rollupVersion=Number(info.rollupVersion);
    if(preparation){
      mark('prove-board-deployment');
      const {proveC01BoardDeployment}=await import('./c01-board-flow.mjs');
      observation.board=await proveC01BoardDeployment(node,preparation,{rollupAddress:deployment.l1ContractAddresses.rollupAddress,rollupVersion:deployment.rollupVersion,directory});
      assert(observation.board.passed);
      if(include){mark('include-board-deployment');const {includeC01Board}=await import('./c01-board-inclusion.mjs');
        observation.inclusion=await includeC01Board({node,tx:observation.board.tx,rpcUrl:config.l1RpcUrls[0],dateProvider});
        if(process.env.C01_READY==='true'){
          mark('prepare-and-prove-ready');
          const {prepareAndProveC01Ready}=await import('./c01-ready-flow.mjs');
          observation.ready=await prepareAndProveC01Ready({node,preparation,instance:observation.board.instance,deploymentReceipt:observation.inclusion,l1Client:deployment.l1Client,directory,rollupAddress:deployment.l1ContractAddresses.rollupAddress,rollupVersion:deployment.rollupVersion});
          assert(observation.ready.passed);
          mark('include-ready');
          observation.readyInclusion=await includeC01Board({node,tx:observation.ready.tx,rpcUrl:config.l1RpcUrls[0],dateProvider,startSequencer:false});
          const effect=await node.getTxEffect(observation.ready.tx.getTxHash());
          assert(effect?.data,'Ready transaction effects unavailable');
          assert(effect.data.l2ToL1Msgs.some(message=>message.toString()===observation.ready.expectedReadyLeaf),'Expected Ready message not emitted');
          observation.ready.readyEmitted=true;observation.ready.bindingSubmitted=true;
          observation.ready.scope='genuine binding proof, normal node validation, successful checkpoint inclusion and exact emitted Ready leaf';
          observation.ready.nextRequired='Controlled Outbox settlement and application portal activation';
          if(process.env.C01_SETTLE==='true'){
            mark('settle-ready-test-message');
            const {settleC01Ready}=await import('./c01-settle-ready.mjs');
            observation.settlement=await settleC01Ready({node,config:nodeConfig,dateProvider,ready:observation.ready,readyInclusion:observation.readyInclusion,l1Client:deployment.l1Client,directory,rollupAddress:deployment.l1ContractAddresses.rollupAddress});
            assert(observation.settlement.passed);
            observation.ready.portalActivated=true;observation.ready.epochProofAccepted=false;observation.ready.controlledSettlement=true;
            if(process.env.C01_BRIDGE==='true'){
              const {completeC01Bridge}=await import('./c01-bridge-flow.mjs');
              observation.bridge=await completeC01Bridge({node,config:nodeConfig,dateProvider,l1Client:deployment.l1Client,
                directory,rollupAddress:deployment.l1ContractAddresses.rollupAddress,preparation,
                instance:observation.board.instance,ready:observation.ready,settlement:observation.settlement,mark,privateFeePosting:process.env.W01_PRIVATE_FEE_POST==='true',privateFees:process.env.W01_PRIVATE_FEES==='true',screeningOnly:process.env.C02_SCREENING==='true',contentionOnly:process.env.C03_CONTENTION==='true'});
              assert(observation.bridge.passed);
            }
          }
        }
        observation.sequencerStarted=true;observation.scope=observation.bridge?.contention?.passed?(process.env.C03_POSTING_DIAGNOSTIC==='true'?'one-author genuine posting diagnostic; not contention qualification':'ten genuine authors preparing posts from one anchor'):observation.bridge?.screening?.passed?'application posting and authenticated screening proofs':observation.bridge?.passed?'application proofs, controlled settlement, deposit/claim/exit/refund':observation.settlement?.passed?'controlled Ready settlement and enabled portal':'genuine client proof and ordinary checkpoint inclusion; no epoch proof acceptance';observation.epochSchedulingStarted=false;observation.idleProverAgentCreated=false;}

    }
    observation.passed=true;
  }finally{
    try{if(node){await node.stop();observation.nodeStopped=true;}}
    finally{try{const failures=[];for(const unsubscribe of subscriptions){try{unsubscribe();}catch(error){failures.push(error);}}await Promise.all(loops.map(loop=>loop.runningPromise));if(failures.length)throw new AggregateError(failures);}finally{RollupContract.prototype.listenToSlasherChanged=oldListen;RunningPromise.prototype.start=oldStart;}}
  }
  return observation;
}
