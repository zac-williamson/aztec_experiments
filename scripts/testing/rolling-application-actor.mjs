// Trusted test harness extraction of rolling-application-fixture's actual actor
// construction. Parent owns verified artifacts/deployment, global IndexedDB
// adaptation, funding, shared node/prover/miner, deadlines and evidence redaction.
// This private handle MUST NOT be serialized into campaign evidence.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createFileJournalStorage} from '../../apps/src/billboard/user/transaction-journal-store.mjs';
import {verifyRollingBokCapability} from '../../apps/rolling/wallet-session.mjs';
import {createRollingApplication} from '../../shared/rolling/application.mjs';
import {createRollingColdPreferenceReader} from '../../shared/rolling/cold-preference-reader.mjs';
import {createRollingCompactClient} from '../../shared/rolling/compact-client.mjs';
import {createRollingPreferenceReader} from '../../shared/rolling/preference-reader.mjs';
import {createSynchronizedRollingApplication} from '../../shared/rolling/synchronized-application.mjs';
const leases=new Set();
const fail=()=>Object.assign(Error('Rolling actor is unavailable.'),{code:'ROLLING_ACTOR_CONTEXT'});
const discard=()=>{};
const quiet=Object.freeze({trace:discard,debug:discard,verbose:discard,info:discard,warn:discard,error:discard,fatal:discard,
 level:'silent',module:'rolling-actor',isLevelEnabled:()=>false,createChild:()=>quiet,getBindings:()=>({})});

// Harness-only adapter around the existing engine journal/hook. It neither
// writes a journal independently nor substitutes a wallet/PXE/node. The facade
// forwards every engine method to the original receiver and original arguments.
async function rejectAsyncHookResult(value){
 if(value instanceof Promise){await value;throw fail();}
 if(value&&typeof value==='object'){
  const descriptor=Object.getOwnPropertyDescriptor(value,'then');
  if(descriptor){
   assert(Object.hasOwn(descriptor,'value'),'Accessor hook result is unsupported');
   if(typeof descriptor.value==='function'){
    await new Promise((resolve,reject)=>Reflect.apply(descriptor.value,value,[resolve,reject]));throw fail();
   }
  }
 }
}
export async function bindRollingRootSubmission(args,capability,contextGuard) {
 if(!capability)return args;
 assert(args.length===2&&args[1]&&Object.getPrototypeOf(args[1])===Object.prototype,'Invalid root submission options');
 const opts=args[1],operation=Object.getOwnPropertyDescriptor(opts,'journalOperation')?.value;
 assert(typeof operation==='string');
 const hook=capability.select(operation);
 // A supplied callback may already have launched a Promise. Drain it before
 // rejecting a malformed asynchronous selector; never orphan its rejection.
 await rejectAsyncHookResult(hook);contextGuard();
 if(hook===undefined)return args;
 assert(!('beforeSubmit'in opts)&&!('wait'in opts),'Root submission hook collision');
 const callbacks={};for(const key of ['journalPrepared','beforeSubmit']){
  const d=hook&&Object.getOwnPropertyDescriptor(hook,key);assert(d&&Object.hasOwn(d,'value')&&typeof d.value==='function');callbacks[key]=d.value;
 }
 const original=Object.getOwnPropertyDescriptor(opts,'transactionJournal')?.value;assert(original);
 for(const key of ['setOperation','assertCanStart','prepare','confirmed','inspect'])assert(typeof original[key]==='function');
 let prepared;
 const facade={};for(const key of ['setOperation','assertCanStart','confirmed'])facade[key]=(...values)=>Reflect.apply(original[key],original,values);
 facade.prepare=async(...values)=>{
  contextGuard();assert(!prepared,'Duplicate root journal preparation');
  const tx=values[0],bytes=Buffer.from(tx.toBuffer()),txHash=String(tx.getTxHash());
  const result=await Reflect.apply(original.prepare,original,values);contextGuard();
  assert(Buffer.from(tx.toBuffer()).equals(bytes)&&String(tx.getTxHash())===txHash,'Root transaction changed during persistence');
  const saved=await original.inspect();contextGuard();assert(saved?.operation===operation&&saved.txHash===txHash);
  prepared={operation,txHash};
  const observed=Reflect.apply(callbacks.journalPrepared,hook,[{...prepared,bytes:Buffer.from(bytes)}]);
  await rejectAsyncHookResult(observed);contextGuard();
  assert.equal(observed,undefined,'Root journal observer must be synchronous');
  return result;
 };
 const selected=Object.defineProperties({},Object.getOwnPropertyDescriptors(opts));
 Object.defineProperties(selected,{
  transactionJournal:{value:facade,enumerable:true,configurable:true,writable:true},
  beforeSubmit:{enumerable:true,value:async hash=>{
   contextGuard();assert(prepared&&hash===prepared.txHash,'Root signed journal is missing');
   await Reflect.apply(callbacks.beforeSubmit,hook,[{...prepared}]);contextGuard();
  }},
 });
 return [args[0],selected];
}

export async function createRollingApplicationActor({sdk,routing,node,endpoint,network,proofsEnabled,board,fees,portal,
 storageDirectory,dataDirectory,log=discard,externalActivity,confirmationDeadlineAt,metrics,coldPreferences=false,rootSubmissionGate,bok}){
 const bokInput=bok===undefined?undefined:{config:structuredClone(bok.config),artifact:bok.artifact};
 let rootGate;
 if(rootSubmissionGate!==undefined){
  const d=rootSubmissionGate&&Object.getOwnPropertyDescriptor(rootSubmissionGate,'select');
  assert(d&&Object.hasOwn(d,'value')&&typeof d.value==='function'&&Reflect.ownKeys(rootSubmissionGate).length===1,'Invalid root submission gate');
  assert(confirmationDeadlineAt===undefined,'Root gate cannot replace confirmation hooks');
  const select=d.value;rootGate=Object.freeze({select:operation=>Reflect.apply(select,rootSubmissionGate,[operation])});
 }
 assert.equal(typeof coldPreferences,'boolean');assert(sdk.isTrustedPrivateNode(node));assert.equal(typeof proofsEnabled,'boolean');
 assert.equal(typeof externalActivity,'function');assert.equal(typeof log,'function');
 // Optional trusted harness observer only. Capture its capability before any
 // await; never wrap node identity, SDK prototypes or internal sync services.
 // Head utility includes discovery; raw discovery/fold/transport remain absent.
 let observe;
 if(metrics!==undefined){
  const descriptor=metrics&&Object.getOwnPropertyDescriptor(metrics,'wrapCall');
  assert(descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='function','Invalid actor metrics');
  const wrap=descriptor.value;observe=(phase,fn)=>Reflect.apply(wrap,metrics,[phase,fn]);
 }
 const createPXE=observe?observe('pxe-construct',sdk.createPXE):sdk.createPXE;
 // Optional race-only absolute bound, validated before acquiring either lease.
 if(confirmationDeadlineAt!==undefined)assert(Number.isSafeInteger(confirmationDeadlineAt)&&confirmationDeadlineAt>Date.now()&&confirmationDeadlineAt<=Date.now()+540000,'Invalid actor confirmation deadline');
 assert(path.isAbsolute(storageDirectory));assert(typeof dataDirectory==='string'&&dataDirectory.length>0);
 const url=new URL(endpoint);assert(!url.username&&!url.password&&!url.search&&!url.hash);
 assert(url.protocol==='https:'||(url.protocol==='http:'&&['127.0.0.1','[::1]'].includes(url.hostname)&&String(network.chainId)==='31337'));
 const account=fees.authorAccount,owner=account.address,secret=account.secret,salt=account.salt,signingKey=account.signingKey;
 const ownerText=String(owner),capturedNetwork=structuredClone(network),fee=fees.browserFixture;
 const scope={account:ownerText,...capturedNetwork,board:String(board.instance.address),portal:portal.toLowerCase()};
 const leaseKeys=['journal:'+path.resolve(storageDirectory),'pxe:'+dataDirectory];
 assert(leaseKeys.every(key=>!leases.has(key)),'Actor storage is already in use');leaseKeys.forEach(key=>leases.add(key));
 let store,pxe,wallet,journal,app,readPreferences,readColdPreferences,initializeAccount,closed=false,closing,busy;
 let authWitnesses=0,walletSubmissions=0,lastExternal={proofJobs:0,transportSends:0};
 const contextGuard=()=>{
  if(closed||account.secret!==secret||account.salt!==salt||account.signingKey!==signingKey||String(account.address)!==ownerText||!sdk.isTrustedPrivateNode(node))throw fail();
  if(pxe&&!sdk.isPrivatePXEForNode(pxe,node))throw fail();
  if(wallet&&(wallet.aztecNode!==node||wallet.pxe!==pxe||!routing.isPrivateWalletForNode(wallet,node)))throw fail();
 };
 function activity(){
  const value=externalActivity();assert.deepEqual(Object.keys(value).sort(),['proofJobs','transportSends']);
  const result={};for(const key of ['proofJobs','transportSends']){const n=value[key];assert(Number.isSafeInteger(n)&&n>=lastExternal[key]);result[key]=n;}
  lastExternal=result;return {authWitnesses,proofJobs:result.proofJobs,walletSubmissions,transportSends:result.transportSends};
 }
 async function exclusive(fn){contextGuard();if(busy)throw fail();const work=Promise.resolve().then(()=>{contextGuard();return fn();});busy=work;try{return await work;}finally{if(busy===work)busy=undefined;}}
 async function dispose(){
  if(pxe){try{await pxe.stop();pxe=undefined;store=undefined;}catch(error){try{if(store){await store.close();store=undefined;}}catch(cleanup){throw new AggregateError([error,cleanup],'Actor cleanup failed');}throw error;}}
  else if(store){await store.close();store=undefined;}
  leaseKeys.forEach(key=>leases.delete(key));
 }
 const expired=()=>Object.assign(Error('Actor confirmation deadline expired; preserve the saved transaction.'),{code:'ROLLING_ACTOR_CONFIRMATION_EXPIRED'});
 const remaining=()=>Math.max(0,confirmationDeadlineAt-Date.now());
 // The journal reads these at the start of each wait, including after reopen.
 // Receipt inspection remains bounded independently for parent cleanup collection.
 const waitOptions=confirmationDeadlineAt===undefined?undefined:Object.freeze({readTimeoutMs:3000,intervalMs:5000,get timeoutMs(){return remaining();}});
 const journalOptions={walletSecret:String(secret),walletSalt:String(salt),scope,Tx:sdk.Tx,node,contextGuard,...(waitOptions?{waitOptions}:{})};
 function boundedSendArgs(args){
  if(confirmationDeadlineAt===undefined)return args;
  const opts=args[1];assert(opts&&Object.getPrototypeOf(opts)===Object.prototype&&args.length===2,'Bounded actor submission requires ordinary options');
  assert(!('wait' in opts),'Existing submission wait cannot be replaced');
  const hook=Object.getOwnPropertyDescriptor(opts,'beforeSubmit');
  assert(!hook||(Object.hasOwn(hook,'value')&&typeof hook.value==='function'),'Existing submission hook cannot be replaced');
  if(remaining()<=0)throw expired();
  const bounded=Object.defineProperties({},Object.getOwnPropertyDescriptors(opts));
  Object.defineProperties(bounded,{
   // engine.js reads this AFTER proof generation and actual submission. Keeping
   // the getter on the wait object prevents a new540s clock after a long proof.
   wait:{value:Object.freeze({interval:5,get timeout(){return remaining()/1000;}}),enumerable:true},
   beforeSubmit:{value:hook?async function(...values){contextGuard();if(remaining()<=0)throw expired();await Reflect.apply(hook.value,this,values);contextGuard();if(remaining()<=0)throw expired();}:()=>{contextGuard();if(remaining()<=0)throw expired();},enumerable:true},
  });
  return [args[0],bounded];
 }
 const deployment={board:{address:board.instance.address,artifact:board.artifact,instance:board.instance},network:capturedNetwork,portal:scope.portal,proofsEnabled,
  privateFee:{address:fee.instance.address,artifact:fee.artifact,gasSettings:fee.gas}};
 async function rebuild(existingJournal){
  contextGuard();const privateStore=createFileJournalStorage(storageDirectory);
  const nextJournal=existingJournal??await sdk.createL2Journal({...journalOptions,storage:privateStore});contextGuard();
  const next=createRollingApplication({sdk:{...sdk,isPrivateWalletForNode:routing.isPrivateWalletForNode},deployment,contextGuard,privateStore,
   accountSession:{owner,wallet,node,journal:nextJournal,walletSecret:journalOptions.walletSecret,walletSalt:journalOptions.walletSalt}});
  app=createSynchronizedRollingApplication({application:next,synchronize:async()=>{await pxe.sync();await initializeAccount();},contextGuard});
  // Mirror the production session: the actor owns the exclusive lease, while
  // the reader owns sync. Calling the public locked head facade would deadlock.
  // Rebuild starts a new reader bound to this raw application and file store;
  // the existing encrypted prefix is reauthenticated rather than copied in RAM.
  let preferenceReader;
  readPreferences=async options=>{
   await initializeAccount();
   preferenceReader??=createRollingPreferenceReader({sdk,pxe,node,owner,deployment,
    readHead:(observe?observe('head-utility',next.readPreferenceHead):next.readPreferenceHead).bind(next),contextGuard,privateStore,
    walletSecret:journalOptions.walletSecret,walletSalt:journalOptions.walletSalt});
   return preferenceReader.read(options);
  };
  let coldReader;
  readColdPreferences=async options=>{
   contextGuard();assert(coldPreferences,'Cold recovery was not selected');
   if(!coldReader){
    const expectedArtifactHash=(await sdk.computeArtifactHash(board.artifact)).toString();contextGuard();
    const compact=createRollingCompactClient({url:url.origin,tier:'checkpointed',contextGuard,...(String(network.chainId)==='31337'?{allowLocalDev:true}:{})});
    coldReader=createRollingColdPreferenceReader({sdk,pxe,node,owner,deployment,expectedArtifactHash,tier:'checkpointed',compact,contextGuard,privateStore,
     walletSecret:journalOptions.walletSecret,walletSalt:journalOptions.walletSalt});
   }
   return coldReader.read(options);
  };
  journal=nextJournal;wallet._transactionJournal=journal;
 }
 try{
  activity();await sdk.inspectTrustedNode(node,{expectedNetworkScope:capturedNetwork,proofsEnabled});contextGuard();
  if(bokInput)deployment.bok=await verifyRollingBokCapability({sdk,node,...bokInput,deployment,contextGuard});contextGuard();
  store=await sdk.openPXEStore({l1ChainId:Number(capturedNetwork.chainId),rollupAddress:capturedNetwork.rollup,accountAddress:ownerText,dataDirectory},undefined,quiet);contextGuard();
  pxe=await Reflect.apply(createPXE,sdk,[node,{proverEnabled:proofsEnabled,autoSync:false,syncChainTip:'checkpointed'},
   {store,remoteProver:{url:endpoint,board:scope.board,timeoutMs:120000,pollMs:100}}]);contextGuard();
  if(observe){
   // Owned instance only, installed once before any application/reader binds.
   // The approved wrappers return the original Promise/value/error unchanged.
   pxe.sync=observe('block-sync',pxe.sync);
   pxe.getPrivateEvents=observe('events',pxe.getPrivateEvents);
  }
  const accountContract=new sdk.SchnorrInitializerlessAccountContract(signingKey),originalProvider=accountContract.getAuthWitnessProvider;
  assert.equal(typeof originalProvider,'function');const seen=new WeakSet();
  accountContract.getAuthWitnessProvider=function(...args){contextGuard();const provider=originalProvider.apply(this,args);
   if(!seen.has(provider)){const original=provider.createAuthWit;assert.equal(typeof original,'function');
    provider.createAuthWit=function(...values){contextGuard();assert(authWitnesses<Number.MAX_SAFE_INTEGER);authWitnesses++;return original.apply(this,values);};seen.add(provider);}
   return provider;};
  const derived=await sdk.deriveKeys(secret),artifact=await accountContract.getContractArtifact();contextGuard();
  const instance=await sdk.getContractInstanceFromInstantiationParams(artifact,{salt,publicKeys:derived.publicKeys,
   constructorArtifact:undefined,constructorArgs:undefined,immutablesHash:await accountContract.getImmutablesHash()});contextGuard();
  assert.equal(String(instance.address),ownerText);const partial=await sdk.computePartialAddress(instance);contextGuard();await pxe.registerAccount(derived,partial);
  for(const [a,i]of [[artifact,instance],[board.artifact,board.instance],[fee.artifact,fee.instance],...(deployment.bok?[[deployment.bok.artifact,deployment.bok.instance]]:[])]){contextGuard();await pxe.registerContractClass(a);contextGuard();await pxe.registerContract(i);}
  contextGuard();await pxe.sync();contextGuard();
  journal=await sdk.createL2Journal({...journalOptions,storage:createFileJournalStorage(storageDirectory)});contextGuard();
  wallet=routing.createAztecWallet(sdk,pxe,node,node,log,secret,{contextGuard,transactionJournal:journal});contextGuard();
  const send=wallet.sendTx;assert.equal(typeof send,'function');
  wallet.sendTx=function(...args){
   contextGuard();const receiver=this,selected=boundedSendArgs(args);
   const invoke=values=>{contextGuard();assert(walletSubmissions<Number.MAX_SAFE_INTEGER);walletSubmissions++;return send.apply(receiver,values);};
   // Default callers retain the original return/Promise/error identity. Only
   // the explicitly selected harness capability adds an awaited preparation.
   return rootGate?bindRollingRootSubmission(selected,rootGate,contextGuard).then(invoke):invoke(selected);
  };
  wallet._accountManager=await sdk.AccountManager.create(wallet,secret,accountContract,{salt});contextGuard();assert.equal(String(wallet._accountManager.address),ownerText);
  let initialized=false;
  initializeAccount=async()=>{
   contextGuard();if(initialized)return;
   const key=await accountContract.getSigningPublicKey();contextGuard();const constructor=artifact.functions.find(fn=>fn.name==='constructor');
   if(constructor){await new sdk.ContractFunctionInteraction(wallet,owner,constructor,[key.x,key.y]).simulate({from:owner});contextGuard();}
   initialized=true;
  };
  if(!coldPreferences)await initializeAccount();
  await rebuild(journal);
 }catch(error){closed=true;try{await dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Actor initialization and cleanup failed');}throw error;}
 const application=Object.freeze({...Object.fromEntries(Object.keys(app).map(name=>[name,(...args)=>exclusive(()=>app[name](...args))])),
  readPreferences:options=>exclusive(()=>readPreferences(options)),
  readColdPreferences:options=>exclusive(()=>readColdPreferences(options))});
 function close(){if(closing)return closing;closed=true;const pending=busy;
  closing=(async()=>{if(pending)try{await pending;}catch{/* Caller retains the operation failure. */}await dispose();})();return closing;}
 const actor={};Object.defineProperties(actor,{application:{value:application},pxe:{get:()=>pxe},wallet:{value:wallet},journal:{get:()=>journal},owner:{value:owner},
  contextGuard:{value:contextGuard},activity:{value:activity},reopenJournal:{value:()=>exclusive(rebuild)},close:{value:close},
  toJSON:{value:()=>{throw Error('Private actor handles cannot be serialized');}}});return Object.freeze(actor);
}
