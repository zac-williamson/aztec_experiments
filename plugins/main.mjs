import {BackendType,Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {getFeeJuiceBalance} from '@aztec/aztec.js/utils';
import {createAztecNodeClient} from '@aztec/aztec.js/node';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {Fr} from '@aztec/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec/foundation/curves/grumpkin';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {validateDescriptor} from './protocol.mjs';
import {aztecBoardPort} from './aztec.mjs';
import {aztecEscrowPort} from './escrow.mjs';
import {startEscrowService} from './escrow-service.mjs';
import {meteredModel} from './metering.mjs';
import {veniceMeteredProvider} from './venice-metered.mjs';
import {createAgent} from './agent.mjs';
import {bokRunner} from './bok.mjs';
import {veniceClient} from './venice.mjs';
import {githubApi,githubToolbox} from './github-tools.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';

/** Composition root: only this module knows which implementations are selected. */
export async function runHostedService({config,env=process.env,onError=error=>console.error('Plugin action failed:',error.message)}) {
  if(!env.VENICE_WALLET_PRIVATE_KEY)throw Error('Configure VENICE_WALLET_PRIVATE_KEY locally before starting the service');
  if(config.operatorFile)config={...config,operator:JSON.parse(await fs.readFile(config.operatorFile,'utf8'))};
  const descriptor=validateDescriptor(config.descriptor,config.descriptor.scope);
  const node=createAztecNodeClient(config.nodeUrl),info=await node.getNodeInfo();
  if(config.development&&String(info.l1ChainId)!=='31337')throw Error('Development mode requires a disposable local chain');
  if(String(info.l1ChainId)!==descriptor.scope.chainId||String(info.rollupVersion)!==descriptor.scope.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==descriptor.scope.rollupAddress)throw Error('Service network identity mismatch');
  const wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:provingEnabledForNode(info),proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
  let server,closed=false;
  async function close(){if(closed)return;closed=true;const failures=[];for(const cleanup of [()=>server?.close(),()=>wallet.stop()]){try{await cleanup();}catch(error){failures.push(error);}}if(failures.length)throw new AggregateError(failures,'Service cleanup failed');}
  try{
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(config.operator.secret),Fr.fromString(config.operator.salt),GrumpkinScalar.fromString(config.operator.signingKey),'bok');
    if(await getFeeJuiceBalance(account.address,node)===0n)throw Error('Fund the operator public Fee Juice account before starting the service');
    const boardArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url),'utf8')));
    const adapterArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('./adapter_artifact.json',import.meta.url),'utf8')));
    const board=await aztecBoardPort({node,wallet,scope:descriptor.scope,boardArtifact,adapterArtifact,operator:account.address,finality:config.development?'checkpointed':'finalized'});
    const escrow=await aztecEscrowPort({node,wallet,address:descriptor.scope.receiver,artifact:adapterArtifact,operator:account.address,development:config.development});
    const providerAdapter=veniceMeteredProvider({client:veniceClient({privateKey:env.VENICE_WALLET_PRIVATE_KEY}),model:env.VENICE_MODEL||undefined,autoTopUp:env.VENICE_AUTO_TOP_UP==='true',maxTopUpUsd:Number(env.VENICE_MAX_TOP_UP_USD||5)});
    server=await startEscrowService({descriptor,escrow,board,host:config.host??'127.0.0.1',port:config.port??8787,onError,run:async(postId,text)=>{
      const model=meteredModel({provider:providerAdapter,escrow,postId});
      const agent=bokRunner({runner:createAgent({model,toolbox:githubToolbox({repository:env.PLUGIN_REPOSITORY||config.repository,api:githubApi({token:env.GITHUB_TOKEN}),allowWrites:env.PLUGIN_GITHUB_WRITES==='true',draftPr:env.PLUGIN_GITHUB_DRAFT!=='false'}),instructions:'You are bok, the development assistant for this board. Work on the configured repository and answer the explicit request.'})});
      try {
      const result=await agent.run({id:postId,postId,text});
      const current=await board.readRequest(postId);
      if(!current||current.flagged||!current.enabled)await model.closeWithoutReply();else await model.finish(result.replyText);
      } catch(error) {
        try { await model.closeWithoutReply(); } catch(cleanup) { throw new AggregateError([error,cleanup],'Invocation failed; chain status needs attention'); }
        throw error;
      }
    }});
    return {address:server.address,close};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Service startup and cleanup failed');}throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const service=await runHostedService({config});console.log('Plugin service listening on',service.address);
  let closing=false;async function close(){if(closing)return;closing=true;try{await service.close();}finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}}
  const shutdown=()=>close().then(()=>process.exit(0),()=>process.exit(1));
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
