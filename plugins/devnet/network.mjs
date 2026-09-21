import {bbBinary} from '../../scripts/toolchain.mjs';
// Disposable local development network. No production defaults are modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {Wallet} from 'ethers';
import {getGenesisValues} from '@aztec/world-state/testing';
import {getConfigEnvVars} from '@aztec/aztec-node/config';
import {createAztecNodeService} from '@aztec/aztec-node';
import {SecretValue} from '@aztec/foundation/config';
import {EthAddress} from '@aztec/foundation/eth-address';
import {Fr} from '@aztec/foundation/curves/bn254';
import {TestDateProvider} from '@aztec/foundation/timer';
import {createBlobClient} from '@aztec/blob-client/client';
import {initTelemetryClient} from '@aztec/telemetry-client';
import {RollupContract} from '@aztec/ethereum/contracts/rollup';
import {createNamespacedSafeJsonRpcServer} from '@aztec/foundation/json-rpc/server';
import {AztecNodeApiSchema} from '@aztec/stdlib/interfaces/client';
import {deployC01ApplicationProtocol} from '../../scripts/c01-application-deployment.mjs';
import {synchronizeC01MinedClock} from '../../scripts/c01-client-mining.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export async function startDevnet({directory,fundingAddresses,proofs=false,onProgress=()=>{}}){
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const identity=Wallet.createRandom(),port=await freePort(),rpcUrl='http://127.0.0.1:'+port;
  const terminateChild=()=>{if(anvil&&anvil.exitCode===null)anvil.kill('SIGTERM');};
  let node,nodeServer,anvil,mining,stopMining=false,miningError,spawnError,anvilClosed,closed=false;
  async function close(){
    if(closed)return;closed=true;stopMining=true;const failures=[];
    for(const cleanup of [()=>mining,()=>nodeServer&&new Promise(resolve=>{nodeServer.close(resolve);nodeServer.closeAllConnections();}),()=>node?.stop(),async()=>{if(anvil&&anvil.exitCode===null&&!spawnError){anvil.kill('SIGTERM');await anvilClosed;}}]){
      try{await cleanup();}catch(error){failures.push(error);}
    }
    process.removeListener('exit',terminateChild);
    if(failures.length)throw new AggregateError(failures,'Devnet cleanup failed');
  }
  try{
    onProgress('Starting disposable Ethereum');
    anvil=spawn(path.resolve('.build/anvil-1.7.0/anvil'),['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--mnemonic',identity.mnemonic.phrase,'--silent'],{stdio:'ignore'});
    process.once('exit',terminateChild);
    anvilClosed=new Promise(resolve=>{anvil.once('error',error=>{spawnError=error;resolve();});anvil.once('close',resolve);});
    let ready=false;
    for(let i=0;i<60;i++){
      if(spawnError)throw spawnError;
      if(anvil.exitCode!==null)throw Error('Local Ethereum exited during startup');
      try{const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_accounts',params:[]}),signal:AbortSignal.timeout(500)});ready=(await response.json()).result?.[0]?.toLowerCase()===identity.address.toLowerCase();}catch{}
      if(ready)break;await pause(100);
    }
    if(!ready)throw Error('Local Ethereum failed to start');
    const {genesisArchiveRoot,fundingNeeded,genesis}=await getGenesisValues(fundingAddresses);
    const validator=EthAddress.fromString(identity.address);
    const config={...getConfigEnvVars(),l1RpcUrls:[rpcUrl],l1ChainId:31337,realProofs:proofs,debugForceTxProofVerification:false,
      useAutomineSequencer:false,automineEnableProveEpoch:false,p2pEnabled:false,
      ethereumSlotDuration:1,aztecSlotDuration:5,blockDurationMs:1000,aztecEpochDuration:4,inboxLag:2,
      aztecProofSubmissionEpochs:64,aztecTargetCommitteeSize:1,slasherEnabled:false,
      initialValidators:[{attester:validator,withdrawer:validator,bn254SecretKey:new SecretValue(Fr.random().toBigInt())}]};
    onProgress('Deploying local rollup');
    const {deployment}=await deployC01ApplicationProtocol({rpcUrl,privateKey:identity.privateKey,config,genesisArchiveRoot,fundingNeeded});
    const rollup=new RollupContract(deployment.l1Client,deployment.l1ContractAddresses.rollupAddress.toString());
    let active=false;
    for(let i=0;i<8;i++){
      active=(await rollup.getCurrentEpochCommittee())?.some(a=>a.toString().toLowerCase()===identity.address.toLowerCase());if(active)break;
      const block=await deployment.l1Client.getBlock({blockTag:'latest'});
      await deployment.l1Client.request({method:'evm_setNextBlockTimestamp',params:[Number(block.timestamp)+20]});
      await deployment.l1Client.request({method:'evm_mine',params:[]});
    }
    if(!active)throw Error('Local validator activation failed');
    const dateProvider=new TestDateProvider({warn(){}});
    const nodeConfig={...config,...deployment.l1ContractAddresses,rollupVersion:deployment.rollupVersion,
      dataDirectory:path.join(directory,'node'),bootstrapNodes:[],txPublicSetupAllowListExtend:[],
      sequencerPublisherPrivateKeys:[new SecretValue(identity.privateKey)],validatorPrivateKeys:new SecretValue([identity.privateKey]),coinbase:validator,
      allowEphemeralSigningProtection:true,enableProverNode:false,proverAgentCount:0,
      bbBinaryPath:bbBinary(),bbWorkingDirectory:path.join(directory,'bb-work'),bbIVCConcurrency:1,bbChonkVerifyConcurrency:1,numConcurrentIVCVerifiers:1};
    onProgress('Starting Aztec '+(proofs?'with proofs':'without proof generation'));
    node=await createAztecNodeService(nodeConfig,{telemetry:await initTelemetryClient({}),blobClient:createBlobClient(),dateProvider},{genesis,dontStartSequencer:true,dontStartProverNode:true});
    await node.validatorClient.registerHandlers();node.getSequencer().updateConfig({minTxsPerBlock:1,buildCheckpointIfEmpty:false});
    mining=(async()=>{while(!stopMining){try{await deployment.l1Client.request({method:'evm_mine',params:[]});const b=await deployment.l1Client.getBlock({blockTag:'latest'});synchronizeC01MinedClock(dateProvider,Number(b.timestamp));await pause(1000);}catch(error){miningError=error;stopMining=true;}}})();
    await node.getSequencer().start();
    const rpc=createNamespacedSafeJsonRpcServer({node:[node,AztecNodeApiSchema],aztec:[node,AztecNodeApiSchema]},{maxBatchSize:100,maxBodySizeBytes:10*1024*1024,corsAllowedOrigins:['http://localhost:8080','http://127.0.0.1:8080']});
    nodeServer=http.createServer(rpc.getApp().callback());await new Promise(resolve=>nodeServer.listen(0,'127.0.0.1',resolve));
    return {node,config:nodeConfig,rpcUrl,nodeUrl:'http://127.0.0.1:'+nodeServer.address().port,identity,deployment,dateProvider,close,checkHealth(){if(miningError)throw miningError;}};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Devnet startup and cleanup failed');}throw error;}
}
