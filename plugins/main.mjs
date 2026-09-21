import {BackendType,Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {JsonRpcProvider} from 'ethers';
import {createAztecNodeClient} from '@aztec/aztec.js/node';
import {EmbeddedWallet} from '@aztec/wallets/embedded';
import {Fr} from '@aztec/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec/foundation/curves/grumpkin';
import {loadContractArtifact} from '@aztec/stdlib/abi';
import {validateDescriptor} from './protocol.mjs';
import {ethereumPaymentSource} from './ethereum.mjs';
import {aztecBoardPort} from './aztec.mjs';
import {openDispatchStore} from './dispatch-store.mjs';
import {createPluginWorker} from './worker.mjs';
import {createAgent} from './agent.mjs';
import {veniceClient,veniceModel} from './venice.mjs';
import {githubApi,githubToolbox} from './github-tools.mjs';
import {startPluginServer} from './server.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';

/** Composition root: only this module knows which implementations are selected. */
export async function runHostedService({config,runner,env=process.env}) {
  if(!runner&&!env.VENICE_WALLET_PRIVATE_KEY)throw Error('Configure VENICE_WALLET_PRIVATE_KEY locally before starting the service');
  const descriptor=validateDescriptor(config.descriptor,config.descriptor.scope);
  const node=createAztecNodeClient(config.nodeUrl),info=await node.getNodeInfo();
  const wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled:provingEnabledForNode(info),proverOrOptions:{backend:BackendType.NativeUnixSocket,threads:1}}});
  let store,server,provider,closed=false;
  async function close(){if(closed)return;closed=true;const failures=[];for(const cleanup of [()=>server?.close(),()=>store?.close(),()=>provider?.destroy(),()=>wallet.stop()]){try{await cleanup();}catch(error){failures.push(error);}}if(failures.length)throw new AggregateError(failures,'Service cleanup failed');}
  try{
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(config.operator.secret),Fr.fromString(config.operator.salt),GrumpkinScalar.fromString(config.operator.signingKey),'bok');
    provider=new JsonRpcProvider(config.ethereumUrl);
    const payments=ethereumPaymentSource({provider,receiverAddress:descriptor.payment.contractAddress,expectedScope:descriptor.scope});
    await payments.verify();
    const boardArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url),'utf8')));
    const adapterArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('./adapter_artifact.json',import.meta.url),'utf8')));
    const board=await aztecBoardPort({node,wallet,scope:descriptor.scope,boardArtifact,adapterArtifact,operator:account.address,finality:config.development?'checkpointed':'finalized'});
    const selectedRunner=runner??createAgent({model:veniceModel({client:veniceClient({privateKey:env.VENICE_WALLET_PRIVATE_KEY}),model:env.VENICE_MODEL||undefined,autoTopUp:env.VENICE_AUTO_TOP_UP==='true',maxTopUpUsd:Number(env.VENICE_MAX_TOP_UP_USD||5)}),
      toolbox:githubToolbox({repository:env.PLUGIN_REPOSITORY||config.repository,api:githubApi({token:env.GITHUB_TOKEN}),allowWrites:env.PLUGIN_GITHUB_WRITES==='true'}),
      instructions:'You are bok, the development assistant for this board. Work on the configured repository and answer the explicit request.',usdPerEth:Number(env.PLUGIN_USD_PER_ETH)});
    await fs.mkdir(config.stateDirectory,{recursive:true,mode:0o700});store=openDispatchStore(path.join(config.stateDirectory,'dispatch.sqlite'));
    const worker=createPluginWorker({scope:descriptor.scope,payments,board,dispatch:store,runner:selectedRunner});
    server=await startPluginServer({descriptor,worker,payments,provider,startBlock:config.startBlock,host:config.host??'127.0.0.1',port:config.port??8787,finality:config.development?'latest':'finalized',onError:error=>console.error('Plugin action failed:',error.name)});
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
