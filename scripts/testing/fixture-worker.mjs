import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,assertNodeVersion,assertAztecPackages,anvilBinary} from '../toolchain.mjs';
import {applicationNativeProfile} from '../c01-native-profile.mjs';
import {describeFailure} from './supervisor.mjs';
const execFileAsync=promisify(execFile);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Explicit local timing, shared by protocol deployment and its node. Keep the
// normal two-checkpoint Inbox delay within the application's readiness window.
export const LOCAL_TIMING=Object.freeze({ethereumSlotDuration:1,aztecSlotDuration:5,blockDurationMs:1000,aztecEpochDuration:4,inboxLag:2});
export async function runFixture(directory, scenario, browserControl, operatorPackage) {
  let stage='startup', anvil, identity;
  const originalStdout=process.stdout.write.bind(process.stdout), originalStderr=process.stderr.write.bind(process.stderr);
  const capture=(chunk,encoding,callback)=>{if(typeof encoding==='function')encoding();else if(callback)callback();return true;};
  process.stdout.write=capture;process.stderr.write=capture;
  let anvilClosed;
  const output={passed:false,profile:'application transaction proofs with official local protocol fixture and controlled settlement'};
  const mark=name=>{stage=name;originalStdout(JSON.stringify({stage,elapsedMs:Math.round(performance.now())})+'\n');};
  try {
    assertNodeVersion();assertAztecPackages();
    const {pins}=await import('../toolchain.mjs');
    assert.equal(sha(await fs.readFile(process.env.FOUNDRY_SOLC)),'738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683');
    const anvilPath=anvilBinary();
    assert((await execFileAsync(process.env.FORGE_BIN,['--version'],{timeout:10000})).stdout.includes(pins.foundry));
    const {Wallet}=await import('ethers');
    identity=Wallet.createRandom();
    const net=await import('node:net');
    // Documentation-only TEST-NET address: permission denial, not timeout/refusal,
    // is required to establish that the sandbox forbids nonlocal IP connections.
    await new Promise((resolve,reject)=>{
      const socket=net.connect({host:'192.0.2.1',port:9});
      const timer=setTimeout(()=>{socket.destroy();reject(new Error('Network control timeout'));},1000);
      socket.once('connect',()=>{clearTimeout(timer);socket.destroy();reject(new Error('External network permitted'));});
      socket.once('error',error=>{clearTimeout(timer);socket.destroy();if(['EPERM','EACCES'].includes(error.code))resolve();else reject(new Error('Network restriction not established'));});
    });
    output.nonlocalNetworkDenied=true;
    const reservation=net.createServer();
    await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
    const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    const rpcUrl='http://127.0.0.1:'+port;
    mark('start-disposable-l1');
    anvil=spawn(anvilPath,['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--mnemonic',identity.mnemonic.phrase,'--silent'],{cwd:directory,env:process.env,stdio:'ignore'});
    anvilClosed=new Promise(resolve=>{anvil.once('error',error=>resolve({errorClass:error.name}));anvil.once('close',(code,signal)=>resolve({code,signal}));});
    let ready=false;
    for(let i=0;i<60;i++){
      try {
        const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_accounts',params:[]}),signal:AbortSignal.timeout(500)});
        const body=await response.json();ready=body.result?.[0]?.toLowerCase()===identity.address.toLowerCase();
      }catch{}
      if(ready)break;await pause(100);
    }
    assert(ready,'Disposable L1 identity check failed');
    if(browserControl?.ethereumWallet==='metamask'){
      const browserIdentity=Wallet.createRandom();assert.notEqual(browserIdentity.address,identity.address);
      const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'anvil_setBalance',params:[browserIdentity.address,'0x3635c9adc5dea00000']})});
      const funded=await response.json();assert(response.ok&&!funded.error&&funded.result===null);
      await fs.writeFile(path.join(directory,'metamask-credentials.json'),JSON.stringify({mnemonic:browserIdentity.mnemonic.phrase,address:browserIdentity.address,rpcUrl}),{mode:0o600,flag:'wx'});
    }
    mark('prepare-genesis');
    const [{getGenesisValues},{getConfigEnvVars},{deployC01ApplicationProtocol}]=await Promise.all([
      import('@aztec/world-state/testing'),import('@aztec/aztec-node/config'),import('../c01-application-deployment.mjs')]);
    let preparation;
    if(scenario.fixture !== 'node'){const {prepareC01BoardFlow}=await import('../c01-board-flow.mjs');preparation=await prepareC01BoardFlow({bbBinaryPath:applicationNativeProfile(directory).bbPath,directory,authorCount:scenario.authors,boardTiming:scenario.boardTiming});}
    if(scenario.name === 'censor-commands'){const {restoreApplicationAuthor}=await import('../w02-wallet-restore.mjs');const restored=await restoreApplicationAuthor(preparation.account);preparation.account=restored.author;preparation.authorAccounts[0]=restored.author;preparation.fundingAddresses=preparation.authorAccounts.map(account=>account.address);output.censorIdentity=restored.observation;}
    const {genesisArchiveRoot,fundingNeeded,genesis}=await getGenesisValues(preparation?.fundingAddresses??[]);
    const {SecretValue}=await import('@aztec/foundation/config');
    const {EthAddress}=await import('@aztec/foundation/eth-address');
    const validatorAddress=EthAddress.fromString(identity.address);
    const {Fr}=await import('@aztec/foundation/curves/bn254');
    let bn254Key;do{bn254Key=Fr.random().toBigInt();}while(bn254Key===0n);
    const config={...getConfigEnvVars(),l1RpcUrls:[rpcUrl],l1ChainId:31337,
      realProofs:true,useAutomineSequencer:false,automineEnableProveEpoch:false,
      p2pEnabled:false,...LOCAL_TIMING,aztecProofSubmissionEpochs:64,
      aztecTargetCommitteeSize:1,slasherEnabled:false,
      initialValidators:[{attester:validatorAddress,withdrawer:validatorAddress,bn254SecretKey:new SecretValue(bn254Key)}]};
    mark('deploy-local-protocol-fixture');
    const result=await deployC01ApplicationProtocol({rpcUrl,privateKey:identity.privateKey,config,genesisArchiveRoot,fundingNeeded});
    output.deployment=result.observation;
    if(scenario.fixture !== 'node'){
      mark('wait-for-local-validator-activation');
      const {RollupContract}=await import('@aztec/ethereum/contracts/rollup');
      const rollup=new RollupContract(result.deployment.l1Client,result.deployment.l1ContractAddresses.rollupAddress.toString());
      const adjustments=[];let committee;output.validatorActivation={observations:adjustments};
      for(let attempt=0;attempt<8;attempt++){
        committee=await rollup.getCurrentEpochCommittee();
        if(committee?.some(member=>member.toString().toLowerCase()===identity.address.toLowerCase()))break;
        const seconds=config.aztecSlotDuration*config.aztecEpochDuration;
        const current=await result.deployment.l1Client.getBlock({blockTag:'latest'});
        await result.deployment.l1Client.request({method:'evm_setNextBlockTimestamp',params:[Number(current.timestamp)+seconds]});
        await result.deployment.l1Client.request({method:'evm_mine',params:[]});
        const advanced=await result.deployment.l1Client.getBlock({blockTag:'latest'});
        adjustments.push({seconds,timestamp:String(advanced.timestamp),epoch:String(await rollup.getCurrentEpoch()),committee:committee?.map(member=>member.toString())??null});
      }
      assert(committee?.some(member=>member.toString().toLowerCase()===identity.address.toLowerCase()),'Fresh validator never became eligible');
      output.validatorActivation={committee:committee.map(member=>member.toString()),ordinaryTimeAdvancesSeconds:adjustments};
    }
    {
      mark('start-application-node');
      const {qualifyC01RealNode}=await import('../c01-real-node.mjs');
      output.node=await qualifyC01RealNode({config,deployment:result.deployment,genesis,directory,privateKey:identity.privateKey,address:identity.address,preparation,mark,browserControl,scenario,operatorPackage});
      assert(output.node.passed);
    }
    output.passed=true;
  }catch(error){if(error.censorCommandObservation)output.censorCommands=error.censorCommandObservation;if(error.registrationObservation)output.registration=error.registrationObservation;if(error.deploymentObservation)output.deployment=error.deploymentObservation;if(error.boardObservation)output.board=error.boardObservation;if(error.readyObservation)output.ready=error.readyObservation;if(error.settlementObservation)output.settlement=error.settlementObservation;if(error.bridgeObservation)output.bridge=error.bridgeObservation;output.failure={stage,...describeFailure(error)};}
  finally{
    if(anvil){anvil.kill('SIGKILL');output.anvilExit=await anvilClosed;}
    try{const {Barretenberg,BarretenbergSync}=await import('@aztec/bb.js');await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();output.singletonsStopped=true;}catch(error){output.passed=false;output.cleanupFailure=describeFailure(error);}
    process.stdout.write=originalStdout;process.stderr.write=originalStderr;
    await fs.writeFile(path.join(directory,'worker-result.json'),JSON.stringify(output,null,2)+'\n');process.exitCode=output.passed?0:1;
  }
}

