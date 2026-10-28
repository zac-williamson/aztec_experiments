import {withBokTiming,measureBokStage,measureBokObjectStages} from './bok-timing.mjs';
import {acquireHostedLease} from './hosted-lease.mjs';
export {acquireHostedLease};
import {prepareInProcessNativeRuntime} from '../prover/runtime.mjs';
import {BackendType,Barretenberg,BarretenbergSync} from '@aztec-foundation/bb.js';
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {getFeeJuiceBalance} from '@aztec-labs/aztec.js/utils';
import {createAztecNodeClient} from '../shared/aztec-node-client.mjs';
import {EmbeddedWallet} from '@aztec-labs/wallets/embedded';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {GrumpkinScalar} from '@aztec-labs/foundation/curves/grumpkin';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {validateDescriptor} from './protocol.mjs';
import {aztecBoardPort,rollingBoardPort} from './aztec.mjs';
import {aztecEscrowPort} from './escrow.mjs';
import {startEscrowService,runPrivateBokRequest,reconcileHostedBilling,isHostedTerminalWithoutReply,hostedUnsubmittedFirstCall,hostedSubmittedFirstCall,hostedReceivedFirstCall,hostedRequestFailure} from './escrow-service.mjs';
import {bokReceiptClaims} from './private-bok-metering.mjs';
import {meteredModel} from './metering.mjs';
import {veniceMeteredProvider} from './venice-metered.mjs';
import {createAgent} from './agent.mjs';
import {rollingConversation} from './conversation.mjs';
import {bokRunner} from './bok.mjs';
import {veniceClient} from './venice.mjs';
import {githubApi,githubToolbox} from './github-tools.mjs';
import {threadRepositories,admittedRepositorySession} from './thread-repositories.mjs';
import {HOSTING_GUIDANCE} from './hosting-policy.mjs';
import {createIsolatedExecution} from './isolated-execution.mjs';
import {createStaticPublication} from './static-publication.mjs';
import {createArtifactApi,ARTIFACT_API_GUIDANCE} from './artifact-api.mjs';
import {createGitHubAppBroker} from './github-app-broker.mjs';
import {provingEnabledForNode} from '../shared/proving-policy.mjs';

// Operator configuration only: keep repository identity stable when upgrading
// a plugin contract. Payment/account scope continues using the current receiver.
export function hostedRepositoryNamespace(config,scope){
 const value=config.repositoryNamespace===undefined?JSON.stringify({scope,pluginId:config.pluginId}):config.repositoryNamespace;
 assert(typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=4096&&!/[\u0000-\u001f\u007f]/.test(value),'Invalid repository namespace');
 return value;
}

// Operator-selected concurrency for the native prover, independent of job concurrency.
export function hostedNativeProverThreads(config){
 const threads=config.nativeProverThreads===undefined?1:config.nativeProverThreads;
 assert(Number.isInteger(threads)&&threads>=1&&threads<=16,'nativeProverThreads must be an integer from 1 to 16');
 return threads;
}

// SDK hashing and proving share this singleton. Initialize it before wallet/account
// work, and reject an earlier incompatible initialization instead of ignoring options.
export async function initializeHostedNativeProver(options){
 const native=await Barretenberg.initSingleton(options);
 for(const key of ['backend','bbPath','threads'])assert.equal(native.options[key],options[key],'Native prover singleton configuration mismatch: '+key);
 return options;
}

/** Composition root: only this module knows which implementations are selected. */
export async function runHostedService({config,env=process.env,onError=error=>console.error('Plugin action failed:',error.message)}) {
 const nativeProverThreads=hostedNativeProverThreads(config);
  assert(config.applicationProfile===undefined||config.applicationProfile==='rolling','Unsupported hosted application profile');
  if(config.applicationProfile==='rolling')return runRollingHostedService({config,env,onError});
  if(!env.VENICE_WALLET_PRIVATE_KEY)throw Error('Configure VENICE_WALLET_PRIVATE_KEY locally before starting the service');
  const repository=env.PLUGIN_REPOSITORY||config.repository,api=githubApi({token:env.GITHUB_TOKEN}),allowWrites=env.PLUGIN_GITHUB_WRITES==='true';
  if(allowWrites&&!env.GITHUB_TOKEN)throw Error('Configure GITHUB_TOKEN before enabling repository writes');
  const toolbox=githubToolbox({repository,api,allowWrites,draftPr:env.PLUGIN_GITHUB_DRAFT!=='false'});
  await api('GET','/repos/'+repository);
  if(config.operatorFile)config={...config,operator:JSON.parse(await fs.readFile(config.operatorFile,'utf8'))};
  const descriptor=validateDescriptor(config.descriptor,config.descriptor.scope);
  const node=createAztecNodeClient(config.nodeUrl),info=await node.getNodeInfo();
  if(config.development&&String(info.l1ChainId)!=='31337')throw Error('Development mode requires a disposable local chain');
  if(String(info.l1ChainId)!==descriptor.scope.chainId||String(info.rollupVersion)!==descriptor.scope.rollupVersion||String(info.l1ContractAddresses.rollupAddress).toLowerCase()!==descriptor.scope.rollupAddress)throw Error('Service network identity mismatch');
  const proverEnabled=provingEnabledForNode(info);
  const wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe:{proverEnabled,...(proverEnabled?{proverOrOptions:await initializeHostedNativeProver({backend:BackendType.NativeUnixSocket,...await prepareInProcessNativeRuntime({}),threads:nativeProverThreads})}:{})}});
  let server,closed=false;
  async function close(){if(closed)return;closed=true;const failures=[];for(const cleanup of [()=>server?.close(),()=>wallet.stop()]){try{await cleanup();}catch(error){failures.push(error);}}if(failures.length)throw new AggregateError(failures,'Service cleanup failed');}
  try{
    const account=await wallet.createSchnorrInitializerlessAccount(Fr.fromString(config.operator.secret),Fr.fromString(config.operator.salt),GrumpkinScalar.fromString(config.operator.signingKey),'bok');
    if(await getFeeJuiceBalance(account.address,node)===0n)throw Error('Fund the operator public Fee Juice account before starting the service');
    const boardArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('../apps/src/billboard/billboard_artifact.json',import.meta.url),'utf8')));
    const adapterArtifact=loadContractArtifact(JSON.parse(await fs.readFile(new URL('./adapter_artifact.json',import.meta.url),'utf8')));
    const board=await aztecBoardPort({node,wallet,scope:descriptor.scope,boardArtifact,adapterArtifact,operator:account.address,finality:'checkpointed'});
    const escrow=await aztecEscrowPort({node,wallet,address:descriptor.scope.receiver,artifact:adapterArtifact,operator:account.address,development:config.development});
    const providerAdapter=veniceMeteredProvider({client:veniceClient({privateKey:env.VENICE_WALLET_PRIVATE_KEY}),model:env.VENICE_MODEL||undefined,autoTopUp:env.VENICE_AUTO_TOP_UP==='true',maxTopUpUsd:Number(env.VENICE_MAX_TOP_UP_USD||5)});
    server=await startEscrowService({descriptor,escrow,board,host:config.host??'127.0.0.1',port:config.port??8787,onError,run:async(postId,text)=>{
      const model=meteredModel({provider:providerAdapter,escrow,postId});
      const agent=bokRunner({runner:createAgent({model,toolbox,instructions:'You are bok, the development assistant for this board. Work on the configured repository and answer the explicit request.'})});
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

/** Decode private actor material in memory; neither parser text nor raw SDK
 * diagnostics may escape this boundary into CLI errors or service logs. */
export async function readHostedActor(config){
 try{
  const actor=config.operatorFile?JSON.parse(await fs.readFile(config.operatorFile,'utf8')):config.operator;
  assert(actor&&Object.getPrototypeOf(actor)===Object.prototype);
  const fields=Object.getOwnPropertyDescriptors(actor);assert(Reflect.ownKeys(fields).every(k=>['address','secret','salt','signingKey'].includes(k)));
  for(const key of ['secret','salt','signingKey'])assert(fields[key]&&Object.hasOwn(fields[key],'value')&&typeof fields[key].value==='string'&&/^0x[0-9a-f]{64}$/.test(fields[key].value));
  return {secret:Fr.fromString(fields.secret.value),salt:Fr.fromString(fields.salt.value),signingKey:GrumpkinScalar.fromString(fields.signingKey.value)};
 }catch{throw Error('Invalid private operator configuration');}
}

/** Use the authenticated index's normal checkpointed tip in both proof modes.
 * Never substitute finalized or latest for the index's requested block selector. */
export function hostedIndexNode(node,development){
 assert.equal(typeof development,'boolean');
 return node;
}

/** Both capabilities retain exact accepted-revision journals. A mirror failure
 * leaves the repository's publication intent pending; restart reconciles it
 * without re-entering a model call. Private mirror URLs never enter replies. */
export async function publishAcceptedRevision({publication,mirror,receipt}){
 if(receipt.connection){assert(mirror&&typeof mirror.syncConnected==='function','Connected repository broker unavailable');return mirror.syncConnected(receipt);}
 const result=await measureBokStage('publication.static',()=>publication.publish(receipt));
 if(mirror)await measureBokStage('publication.mirror',()=>mirror.sync(receipt));
 return result;
}

/** Trusted accepted-source recovery. No agent/tool session or source execution
 * is opened; required mirror publication remains part of recoverAccepted. */
export async function recoverAcceptedHostedRevision({repositories,repository,request}){
 const receipt=await repositories.recoverAccepted({threadId:request.threadId,invocationId:request.requestId,repository});
 assert(receipt.threadId===request.threadId&&receipt.invocationId===request.requestId);
 assert(/^[0-9a-f]{64}$/.test(receipt.repositoryId)&&/^[0-9a-f]{40}$/.test(receipt.acceptedRevision));
 assert(receipt.validation?.passed===true&&receipt.validation.revision===receipt.acceptedRevision&&/^[0-9a-f]{64}$/.test(receipt.validation.sourceDigest));
 const p=receipt.publication;let replyText;
 if(receipt.connection){
  assert(p?.connected===true&&typeof p.url==='string'&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(p.url),'Connected publication required');
  replyText='Recovered repository changes are ready for operator review: '+p.url;
 }else{
  for(const url of [p?.artifactUrl,p?.sourceUrl])assert(typeof url==='string'&&url.length<=320&&/^https?:\/\//.test(url)&&!/[\s\x00-\x1f]/.test(url),'Exact accepted publication links required');
  replyText=`Recovered accepted application revision ${receipt.acceptedRevision}.\nApp: ${p.artifactUrl}\nSource: ${p.sourceUrl}`;
 }
 assert(Buffer.byteLength(replyText)<=992);
 return {replyText,recoveredRevision:{repositoryId:receipt.repositoryId,acceptedRevision:receipt.acceptedRevision,sourceDigest:receipt.validation.sourceDigest}};
}

/** Cheap dispatch hint under the service lease. Re-read durable ownership on
 * each visit; this never authorizes a paid call or replaces canonical recovery. */
export async function hostedRequestDispatchable({request,directory,scope,pluginId,lease,repositories,repository}){
 await lease.assertHeld();
 const id=createHash('sha256').update(JSON.stringify({scope,requestId:request.requestId,target:request.target})).digest('hex');
 const file=path.join(directory,id+'.json');
 try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return true;throw error;}
 const {readHostedPrivateFile}=await import('./operations.mjs');
 const original=JSON.parse((await readHostedPrivateFile(file)).toString('utf8')),saved=original.hostedPrivateBok;
 if(!saved)return true;
 const identity={network:`eip155-${scope.chainId}:aztec-${scope.rollupVersion}:${scope.rollupAddress}`,escrow:scope.receiver,requestId:request.requestId,target:request.target};
 assert.deepEqual(saved.binding,{...identity,postId:request.postId,pluginId});assert.equal(request.pluginId,pluginId);
 assert(['running','result-ready','accounting-only','final-intent','reply-included','reply-intent','reply-confirmed','finished','accounting-recovery','accounted-without-reply'].includes(saved.phase),'Unknown hosted phase');
 if(['result-ready','accounting-only','final-intent','reply-included','reply-intent','reply-confirmed'].includes(saved.phase))return true;
 if(saved.phase!=='running')return false;
 if(hostedUnsubmittedFirstCall(original)||hostedSubmittedFirstCall(original)||hostedReceivedFirstCall(original))return true;
 const journal=original.privateBok,calls=Object.values(journal?.calls??{});
 if(!journal||journal.finished||!calls.length||calls.some(call=>journal.accountingMode==='invocation-v1'?!['received','settled'].includes(call.phase):call.phase!=='settled'))return false;
 assert.deepEqual(journal.identity,identity,'Original metering identity changed');
 return repositories.hasAcceptedRecovery({threadId:request.threadId,invocationId:request.requestId,repository});
}

/** Discover interrupted reply/finish work from the existing private journals.
 * The public pending feed deliberately excludes replied posts. This bounded
 * directory cursor is only a hint: original scope and fresh chain state bind
 * every returned request, and the normal request owner reconciles exact hashes.
 */
export function hostedRecoveryScanner({directory,scope,pluginId,board,lease}){
 let entries,closed=false;
 const field=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n;
 const network=`eip155-${scope.chainId}:aztec-${scope.rollupVersion}:${scope.rollupAddress}`;
 const scan=async()=>{
  assert(!closed,'Recovery scanner closed');await lease.assertHeld();
  entries??=await fs.opendir(directory);const requests=[];
  for(let scanned=0;scanned<64&&requests.length<16;scanned++){
   const entry=await entries.read();if(!entry){await entries.close();entries=null;break;}
   if(!/^[0-9a-f]{64}\.json$/.test(entry.name))continue;
   if(!entry.isFile())throw Error('Invalid hosted recovery journal');
   const file=path.join(directory,entry.name);let handle,saved;
   try{
    handle=await fs.open(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);const stat=await handle.stat();
    assert(stat.isFile()&&stat.size<=8388608);
    const bytes=Buffer.alloc(stat.size+1);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);assert.equal(bytesRead,stat.size);
    saved=JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')).hostedPrivateBok;
   }catch{throw Error('Invalid hosted recovery journal');}finally{await handle?.close();}
   if(!saved||!['result-ready','accounting-only','final-intent','reply-included','reply-intent','reply-confirmed'].includes(saved.phase))continue;
   const b=saved.binding;assert(b&&b.network===network&&b.escrow===scope.receiver&&b.pluginId===pluginId&&field(b.requestId)&&field(b.target)&&field(b.postId),'Hosted recovery identity changed');
   const id=createHash('sha256').update(JSON.stringify({scope,requestId:b.requestId,target:b.target})).digest('hex');
   assert.equal(entry.name,id+'.json','Hosted recovery filename changed');
   const current=await board.readRequest(b.postId);
   assert(current&&current.requestId===b.requestId&&current.target===b.target&&current.pluginId===pluginId&&current.postId===b.postId&&field(current.threadId),'Canonical recovery invocation changed');
   await lease.assertHeld();requests.push(current);
  }
  return requests;
 };
 scan.close=async()=>{closed=true;if(entries){await entries.close();entries=null;}};
 return scan;
}

/** One local billing reconciliation with the same stopped-service lease and
 * operator. No provider, repository, container or public listener is opened. */
function hostedReceiptClaims(directory,lease){
 return bokReceiptClaims({assertHeld:()=>lease.assertHeld(),readJournals:async function*(){
  const {readHostedPrivateFile}=await import('./operations.mjs');let count=0;
  for await(const entry of await fs.opendir(directory)){
   assert(++count<=8192,'Hosted journal directory bound');if(!/^[0-9a-f]{64}\.json$/.test(entry.name))continue;
   yield JSON.parse((await readHostedPrivateFile(path.join(directory,entry.name))).toString('utf8'));
  }
 }});
}

export async function runHostedBillingReconciliation({config,receiptFile,env=process.env}){
 const nativeProverThreads=hostedNativeProverThreads(config);
 let lease,wallet,result,failed=false,cleanupFailed=false;
 try{
  const {rollingOperatorConfig,rollingPxeOptions,operatorNodeFetch,fileState,readHostedBillingReceipt,readHostedPrivateFile}=await import('./operations.mjs');
  const descriptor=validateDescriptor(config.descriptor,config.descriptor.scope);assert.equal(config.applicationProfile,'rolling');assert.equal(descriptor.applicationProfile,'rolling');
  const scope=descriptor.scope;
  rollingOperatorConfig({applicationProfile:'rolling',development:config.development,nodeUrl:config.nodeUrl,ethereumUrl:config.ethereumUrl,chainId:scope.chainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress,boardAddress:scope.boardAddress,operatorAddress:config.operatorAddress});
  assert(typeof config.stateDirectory==='string'&&path.isAbsolute(config.stateDirectory));assert.equal(await fs.realpath(config.stateDirectory),config.stateDirectory);
  const directory=await fs.lstat(config.stateDirectory);assert(directory.isDirectory()&&directory.uid===process.getuid()&&(directory.mode&0o777)===0o700);
  lease=await acquireHostedLease(config.stateDirectory);
  const receipt=await readHostedBillingReceipt(receiptFile),b=receipt.binding;
  assert(b&&Object.keys(b).sort().join()==='escrow,network,pluginId,postId,requestId,target');
  const field=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n;
  assert(field(b.requestId)&&field(b.target)&&field(b.postId)&&field(config.pluginId));
  assert.equal(b.network,`eip155-${scope.chainId}:aztec-${scope.rollupVersion}:${scope.rollupAddress}`);assert.equal(b.escrow,scope.receiver);assert.equal(b.pluginId,config.pluginId);
  const id=createHash('sha256').update(JSON.stringify({scope,requestId:b.requestId,target:b.target})).digest('hex'),file=path.join(config.stateDirectory,id+'.json');
  const original=JSON.parse((await readHostedPrivateFile(file)).toString('utf8'));assert.deepEqual(original.hostedPrivateBok?.binding,b);
  const store=await fileState(file);assert.deepEqual(store.read(),original);
  const key=env.PLUGIN_QUERY_API_KEY;if(!config.development)assert(typeof key==='string','Operator query capability required');
  const [{jsonStringify},{loadRollingArtifacts},{createPrivateBokEscrow}]=await Promise.all([import('@aztec-labs/foundation/json-rpc'),import('../prover/rolling-artifacts.mjs'),import('./private-bok-escrow.mjs')]);
  const node=createAztecNodeClient(config.nodeUrl,{fetch:operatorNodeFetch({endpoint:config.nodeUrl,key,serialize:jsonStringify})});
  const info=await node.getNodeInfo();assert.equal(info.realProofs,!config.development);assert.equal(String(info.l1ChainId),scope.chainId);assert.equal(String(info.rollupVersion),scope.rollupVersion);assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),scope.rollupAddress);
  const actor=await readHostedActor(config),pxe=await rollingPxeOptions(config.development,async()=>initializeHostedNativeProver({backend:BackendType.NativeUnixSocket,...await prepareInProcessNativeRuntime({}),threads:nativeProverThreads}));
  wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe});
  const account=await wallet.createSchnorrInitializerlessAccount(actor.secret,actor.salt,actor.signingKey,'public Bok operator');assert.equal(String(account.address),config.operatorAddress);assert(await getFeeJuiceBalance(account.address,node)>0n);
  const [,bokRaw]=loadRollingArtifacts(),artifact=loadContractArtifact(bokRaw);
  const escrow=await createPrivateBokEscrow({node,wallet,artifact,address:scope.receiver,operator:String(account.address),board:scope.boardAddress,network:scope,requestId:b.requestId,target:b.target,store,lease,development:config.development,proofMode:config.development?'disabled':'real'});
  result=await reconcileHostedBilling({receipt,escrow,store,lease,limits:original.privateBok?.limits??config.limits,claimReceipt:hostedReceiptClaims(config.stateDirectory,lease)});
 }catch{failed=true;}
 finally{for(const close of [()=>wallet?.stop(),()=>lease?.close()])try{await close();}catch{cleanupFailed=true;}}
 if(failed||cleanupFailed)throw Error(cleanupFailed?'Hosted billing recovery failed; owned cleanup requires attention':'Hosted billing recovery unresolved; preserve original receipt and journal');
 return result;
}

/** Keep each request ordered; only wallet mutations share the global lane. */
export function serializeHostedEscrow(port,walletOperation){
 // Observations may write their own request journal, but never mutate PXE or
 // the shared wallet. Keep all same-port calls queued, including after failure.
 const observations=new Set(['request','assertUsable','inspectOperation','waitForOperation']);
 let tail=Promise.resolve();
 const ordered=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
 // The source port is frozen: a distinct frozen port preserves its receiver.
 return Object.freeze(Object.fromEntries(Object.entries(port).map(([key,value])=>[
  key,typeof value==='function'?(...args)=>ordered(()=>observations.has(key)?Reflect.apply(value,port,args):walletOperation(()=>Reflect.apply(value,port,args))):value,
 ])));
}

/** Pin only the required-finality selector for read-only terminal accounting.
 * Numbered canonical rechecks and all other methods retain the original node. */
export function hostedTerminalNode(node,anchor,development){
 assert(anchor&&Number.isSafeInteger(anchor.number)&&anchor.number>=0&&/^0x[0-9a-f]{64}$/.test(anchor.hash));assert.equal(typeof development,'boolean');
 const captured={...anchor},finality='checkpointed';
 return new Proxy(node,{get(target,key){
  if(key==='getBlock')return async(selector,...args)=>{
   if(selector!==finality)return target.getBlock(selector,...args);
   const block=await target.getBlock(captured.number,...args);
   assert.equal(block?.number,captured.number,'Terminal checkpoint changed');assert.equal(String(block?.hash),captured.hash,'Terminal checkpoint changed');return block;
  };
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
}

/** Explicit Rolling composition; the legacy account escrow is never selected. */
export async function runRollingHostedService({config,env=process.env,onError=()=>{}}){
 const nativeProverThreads=hostedNativeProverThreads(config);
 assert(Array.isArray(config.connectedRepositories??[])&&(config.connectedRepositories??[]).length<=32,'Invalid connected repository configuration');
 const [{rollingOperatorConfig,rollingPxeOptions,operatorNodeFetch,fileState,readHostedPrivateFile},{loadRollingArtifacts},{jsonStringify},
  {getContractClassFromArtifact},{createPrivateBokEscrow},{createRollingPersistentPublicIndex},{createRollingPublicSqliteStore},{ownRollingPersistentPublicIndex}]=await Promise.all([
  import('./operations.mjs'),import('../prover/rolling-artifacts.mjs'),import('@aztec-labs/foundation/json-rpc'),
  import('@aztec-labs/stdlib/contract'),import('./private-bok-escrow.mjs'),import('../shared/rolling/public-index.mjs'),
  import('../shared/rolling/public-sqlite.mjs'),import('../scripts/rolling-public-server.mjs')]);
 const descriptor=validateDescriptor(config.descriptor,config.descriptor.scope);assert.equal(descriptor.applicationProfile,'rolling');
 assert.equal(config.applicationProfile,'rolling');assert.equal(typeof config.development,'boolean');
 const scope=descriptor.scope,repositoryNamespace=hostedRepositoryNamespace(config,descriptor.scope);
 // Validate public network/endpoint data before reading actor keys or provider setup.
 rollingOperatorConfig({applicationProfile:'rolling',development:config.development,nodeUrl:config.nodeUrl,ethereumUrl:config.ethereumUrl,
  chainId:scope.chainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress,boardAddress:scope.boardAddress,operatorAddress:config.operatorAddress});
 assert(typeof config.pluginId==='string'&&/^0x[0-9a-f]{64}$/.test(config.pluginId)&&BigInt(config.pluginId)>0n);
 assert(typeof config.stateDirectory==='string'&&path.isAbsolute(config.stateDirectory));
 await fs.mkdir(config.stateDirectory,{recursive:true,mode:0o700});
 assert.equal(await fs.realpath(config.stateDirectory),config.stateDirectory);const directory=await fs.lstat(config.stateDirectory);
 assert(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700);
 const lease=await acquireHostedLease(config.stateDirectory);let wallet,index,server,artifactsServer,artifactApi,recoverPending,rawBoard,closing;
 function close(){return closing??=(async()=>{const errors=[];for(const fn of [()=>server?.close(),()=>recoverPending?.close(),()=>rawBoard?.close(),()=>artifactApi?.close(),()=>artifactsServer?new Promise(resolve=>{artifactsServer.close(resolve);artifactsServer.closeAllConnections();}):undefined,()=>wallet?.stop(),()=>index?.close(),()=>lease.close()])try{await fn();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'Rolling hosted cleanup failed');})();}

 try{
  const key=env.PLUGIN_QUERY_API_KEY;if(!config.development)assert(typeof key==='string','Operator query capability required');
  const node=createAztecNodeClient(config.nodeUrl,{fetch:operatorNodeFetch({endpoint:config.nodeUrl,key,serialize:jsonStringify})});
  const info=await node.getNodeInfo();assert.equal(info.realProofs,!config.development);assert.equal(String(info.l1ChainId),scope.chainId);assert.equal(String(info.rollupVersion),scope.rollupVersion);assert.equal(String(info.l1ContractAddresses.rollupAddress).toLowerCase(),scope.rollupAddress);
  const actor=await readHostedActor(config);
  const pxe=await rollingPxeOptions(config.development,async()=>initializeHostedNativeProver({backend:BackendType.NativeUnixSocket,...await prepareInProcessNativeRuntime({}),threads:nativeProverThreads}));
  wallet=await EmbeddedWallet.create(node,{ephemeral:true,pxe});
  const account=await wallet.createSchnorrInitializerlessAccount(actor.secret,actor.salt,actor.signingKey,'public Bok operator');
  assert.equal(String(account.address),config.operatorAddress);assert(await getFeeJuiceBalance(account.address,node)>0n);
  const [boardRaw,bokRaw]=loadRollingArtifacts(),boardArtifact=loadContractArtifact(boardRaw),artifact=loadContractArtifact(bokRaw);
  // Reply publication now privately derives the operator's per-post key in
  // RollingBoard, so its pinned class must be available to the native PXE.
  const tipBoard=await node.getContract(AztecAddress.fromStringUnsafe(scope.boardAddress),'latest');
  assert.equal(String(tipBoard?.currentContractClassId),String((await getContractClassFromArtifact(boardArtifact)).id));
  await wallet.registerContract(tipBoard,boardArtifact);
  const indexScope={chainId:scope.chainId,rollupVersion:scope.rollupVersion,rollupAddress:scope.rollupAddress,boardAddress:scope.boardAddress,classId:String((await getContractClassFromArtifact(boardArtifact)).id)};
  const storage=createRollingPublicSqliteStore(path.join(config.stateDirectory,'public-index'),{scope:indexScope,serviceOwned:true});
  // Native executed proposals let paid work overlap L1 checkpointing. Each paid
  // call rechecks exact proposed state; successful replies release at inclusion
  // and the existing journal scan observes their checkpoint without paid replay.
  try{index=ownRollingPersistentPublicIndex(await createRollingPersistentPublicIndex({node:hostedIndexNode(node,config.development),artifact:boardArtifact,scope:indexScope,deployment:config.deployment,storage,confirmationTier:'proposed'}),storage);}catch(error){storage.close();throw error;}
  // A request owns its own billing journal. Only shared wallet operations and
  // canonical index snapshots serialize; unrelated model calls may overlap.
  const lane=()=>{let tail=Promise.resolve();return fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};};
  const indexed=lane(),walletOperation=lane(),generatedExecution=lane(),publicationOperation=lane(),claimReceipt=hostedReceiptClaims(config.stateDirectory,lease);
  const isTerminalWithoutReply=async(request,anchor)=>{
   await lease.assertHeld();const id=createHash('sha256').update(JSON.stringify({scope,requestId:request.requestId,target:request.target})).digest('hex');
   const file=path.join(config.stateDirectory,id+'.json');
   try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
   const original=JSON.parse((await readHostedPrivateFile(file)).toString('utf8'));
   if(original.hostedPrivateBok?.phase!=='accounted-without-reply')return false;
   assert(original.privateBokEscrow,'Original terminal escrow journal required');
   const store={read:()=>original,write:async()=>{throw Error('Terminal admission is read only');}};
   const terminalNode=hostedTerminalNode(node,anchor,config.development);
   const rawEscrow=await walletOperation(()=>createPrivateBokEscrow({node:terminalNode,wallet,artifact,address:scope.receiver,operator:account.address.toString(),board:scope.boardAddress,network:scope,
    requestId:request.requestId,target:request.target,store,lease,development:config.development,proofMode:config.development?'disabled':'real'}));
   const result=await isHostedTerminalWithoutReply({request,escrow:serializeHostedEscrow(rawEscrow,walletOperation),store,anchor});
   await lease.assertHeld();assert.deepEqual(JSON.parse((await readHostedPrivateFile(file)).toString('utf8')),original,'Terminal journal changed during admission');return result;
  };
  rawBoard=await rollingBoardPort({node,index,scope,boardArtifact,pluginId:config.pluginId,development:config.development,isTerminalWithoutReply,confirmationTier:'proposed'});
  const board={close:()=>rawBoard.close(),pending:(...args)=>indexed(()=>rawBoard.pending(...args)),readRequest:(...args)=>indexed(()=>rawBoard.readRequest(...args))};
  const rawConversation=rollingConversation({index,node,scope:indexScope,development:config.development,confirmationTier:'proposed'});
  const conversation=measureBokObjectStages({load:input=>indexed(async()=>{const history=await rawConversation.load(input);return {...history,assertCurrent:()=>measureBokStage('conversation.assertCurrent',()=>indexed(()=>history.assertCurrent()))};})},'conversation');
  const summaryModelId=env.VENICE_SUMMARY_MODEL||config.summaryModelId;
  assert(typeof summaryModelId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(summaryModelId),'Cheaper summary model required');
  assert(env.VENICE_WALLET_PRIVATE_KEY,'Provider key required');
  assert(env.VENICE_AUTO_TOP_UP!=='true','Fund provider credits separately before hosted request execution');
  const repository=env.PLUGIN_REPOSITORY||config.repository,api=githubApi({token:env.GITHUB_TOKEN}),allowWrites=env.PLUGIN_GITHUB_WRITES==='true';
  assert(!allowWrites||env.GITHUB_TOKEN);
  const workspaceRoot=path.join(config.stateDirectory,'thread-repositories'),outputRoot=path.join(config.stateDirectory,'static-artifacts');
  for(const directory of [workspaceRoot,outputRoot])await fs.mkdir(directory,{recursive:true,mode:0o700});
  assert(config.staticPublication&&typeof config.staticPublication.origin==='string'&&typeof config.staticPublication.boardOrigin==='string','Separate artifact origin required');
  const execution=createIsolatedExecution({...config.staticExecution,workspaceRoot,outputRoot,origin:config.staticPublication.origin,boardOrigin:config.staticPublication.boardOrigin});
  await execution.assertAvailable();
  const publicationRoot=path.join(config.stateDirectory,'static-publication');await fs.mkdir(publicationRoot,{recursive:true,mode:0o700});
  artifactApi=await createArtifactApi({config:config.staticPublication.api,directory:config.stateDirectory,lease,env});
  const publication=await createStaticPublication({directory:publicationRoot,artifactRoot:outputRoot,origin:config.staticPublication.origin,boardOrigin:config.staticPublication.boardOrigin,development:config.development,artifactApi});
  assert(config.development||config.githubApp?.enabled===true,'Dedicated GitHub App installation required');
  let mirror;
  if(config.githubApp?.enabled===true){
   const directory=path.join(config.stateDirectory,'github-app');await fs.mkdir(directory,{recursive:true,mode:0o700});
   mirror=await createGitHubAppBroker({...config.githubApp,connectedRepositories:config.connectedRepositories??[],directory,artifactRoot:outputRoot});await mirror.assertAvailable();
  }
  assert(!config.connectedRepositories?.length||mirror,'Connected repositories require dedicated GitHub App');
  artifactsServer=http.createServer((req,res)=>{void publication.handle(req,res);});
  await new Promise((resolve,reject)=>{artifactsServer.once('error',reject);artifactsServer.listen(config.staticPublication.port??8788,config.staticPublication.host??'127.0.0.1',resolve);});
  const repositories=threadRepositories({directory:workspaceRoot,namespace:repositoryNamespace,lease,startEmpty:true,ensureThread:mirror?input=>publicationOperation(()=>mirror.ensureThread(input)):undefined,connections:mirror?{connectionFor:mirror.connectionFor,readConnected:threadId=>publicationOperation(()=>mirror.readConnected(threadId))}:undefined,
   validateRevision:input=>generatedExecution(()=>execution.execute(input)),onAccepted:receipt=>publicationOperation(()=>publishAcceptedRevision({publication,mirror,receipt}))});
  await api('GET','/repos/'+repository);
  const provider=veniceMeteredProvider({client:veniceClient({privateKey:env.VENICE_WALLET_PRIVATE_KEY}),model:env.VENICE_MODEL||undefined,autoTopUp:false});
  recoverPending=hostedRecoveryScanner({directory:config.stateDirectory,scope,pluginId:config.pluginId,board,lease});
  server=await startEscrowService({descriptor,profile:'rolling',concurrency:2,board,recoverPending,host:config.host??'127.0.0.1',port:config.port??8787,
   onError:error=>onError(hostedRequestFailure(error)),
   canDispatch:request=>hostedRequestDispatchable({request,directory:config.stateDirectory,scope,pluginId:config.pluginId,lease,repositories,repository}),run:request=>withBokTiming(request.requestId,()=>measureBokStage('request.total',async()=>{
    await lease.assertHeld();const id=createHash('sha256').update(JSON.stringify({scope,requestId:request.requestId,target:request.target})).digest('hex');
    const store=await fileState(path.join(config.stateDirectory,id+'.json'));
    const rawEscrow=await measureBokStage('escrow.open',()=>walletOperation(()=>createPrivateBokEscrow({node,wallet,artifact,address:scope.receiver,operator:account.address.toString(),board:scope.boardAddress,network:scope,
     requestId:request.requestId,target:request.target,store,lease,development:config.development,proofMode:config.development?'disabled':'real',admissionTier:'proposed'})));
    const escrow=measureBokObjectStages(serializeHostedEscrow(rawEscrow,walletOperation),'escrow');
    const limits=store.read().privateBok?.limits??{maxCalls:16,maxTokens:8192,maxInputBytes:262144,...config.limits};
    const admitted=admittedRepositorySession(repositories,{threadId:request.threadId,invocationId:request.requestId,repository});
    const toolbox=githubToolbox({repository,api,repositories:{open:admitted.open}}),invocationProvider=provider.invocation();
    try{return await runPrivateBokRequest({request,board:measureBokObjectStages(board,'board'),escrow,store,provider:invocationProvider,conversation,accountingMode:'invocation-v1',claimReceipt,admitThread:mirror?()=>measureBokStage('repository.admit',()=>admitted.admit()):undefined,limits,recoverAccepted:current=>recoverAcceptedHostedRevision({repositories,repository,request:current}),runAgent:async({model,conversation,...input})=>
     bokRunner({runner:createAgent({model,toolbox,conversation,summaryModelId,maxCalls:limits.maxCalls??16,maxTokens:limits.maxTokens??8192,instructions:'You are bok, the board development assistant. Answer the explicit request. Each thread has its own persistent source repository. For static applications, provide package.json with a build script, explicit Node tests, and dist output. A requested self-contained HTML page can remain one published index.html; keep dependency-free build/test support in source and copy the page to dist/index.html, without adding a framework. Use finish_workspace when the requested edits are complete to run isolated Node tests, builds and browser scenarios; repair any failures before finishing. The isolated build/test runner has Node, no network, and no dependency installation. '+HOSTING_GUIDANCE+' Preserve the explicit expected states and activation sequences in the latest request; never change expected values to match incorrect behavior. Node test success alone does not verify browser behavior. Host validation saves accepted revisions; tools cannot alter permissions or deploy. '+ARTIFACT_API_GUIDANCE})}).run(input)});
    }finally{invocationProvider.close();await admitted.close();}
   }))});
  return {address:server.address,artifactAddress:artifactsServer.address(),close,
   setPublicationDisabled:input=>publicationOperation(async()=>{await lease.assertHeld();return publication.setDisabled(input);})};
 }catch{let cleanupFailed=false;try{await close();}catch{cleanupFailed=true;}throw Error(cleanupFailed?'Rolling hosted startup failed; owned cleanup requires attention':'Rolling hosted startup failed');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {hostedCommand,readHostedPrivateFile}=await import('./operations.mjs');const command=hostedCommand(process.argv.slice(2));
  let config;try{config=JSON.parse(command.kind==='reconcile-billing'?(await readHostedPrivateFile(command.configFile,1048576)).toString('utf8'):await fs.readFile(command.configFile,'utf8'));}catch{throw Error('Invalid service configuration');}
  if(command.kind==='reconcile-billing'){
   try{console.log(JSON.stringify(await runHostedBillingReconciliation({config,receiptFile:command.receiptFile})));}
   catch(error){console.error(error.message);process.exitCode=1;}
   finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}
  }else{
  const service=await runHostedService({config});console.log('Plugin service listening on',service.address);
  let closing=false;async function close(){if(closing)return;closing=true;try{await service.close();}finally{await Barretenberg.destroySingleton();BarretenbergSync.destroySingleton();}}
  const shutdown=()=>close().then(()=>process.exit(0),()=>process.exit(1));
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  }
}
