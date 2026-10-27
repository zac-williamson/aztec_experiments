import {captureThreadAction} from './thread-action.mjs';
// The caller owns the account lock, PXE lifetime and trusted-route guard.
// autoSync:false synchronizes once per account flow, and again after chain state changes.
const methods=['readFundingState','readWithdrawalReadiness','readBokAccounting','readBalances','readWithdrawal','readModeratorStatus','readBokStatus','readPrivateFeeCredit','prepareBokPost','prepareBokRelease','readAccountStatus','readProfile','ownedIdentities','prepare','submitPrepared','cancelPrepared','reconcile','inspectRecovery','prepareReplacement','prepareInterrupted','resumeSaved'];
// This financial confirmation must bind the caller's selection before the
// synchronization await, not retain a mutable object until the raw app runs.
function savedResumeArguments(args){
 try{
  const [id,input]=args,descriptor=input&&Object.getOwnPropertyDescriptor(input,'expectedTxHash');
  if(args.length!==2||typeof id!=='string'||!input||Object.getPrototypeOf(input)!==Object.prototype||
    Reflect.ownKeys(input).length!==1||!descriptor||!Object.hasOwn(descriptor,'value')||
    typeof descriptor.value!=='string'||!/^0x[0-9a-f]{64}$/.test(descriptor.value))throw 0;
  return [id,{expectedTxHash:descriptor.value}];
 }catch{throw Object.assign(Error('Invalid Rolling action'),{code:'ROLLING_INVALID_ACTION'});}
}
function bokReleaseArguments(args){
 try{
  const [id,input]=args,d=input&&Object.getOwnPropertyDescriptor(input,'type');
  if(args.length!==2||typeof id!=='string'||!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==1||
    !d||!Object.hasOwn(d,'value')||!['cancel-bok-request','expire-bok-request'].includes(d.value))throw 0;
  return [id,{type:d.value}];
 }catch{throw Object.assign(Error('Invalid Rolling action'),{code:'ROLLING_INVALID_ACTION'});}
}
function balanceArguments(args,allowIncludeBok){
 try{
  if(args.length===0)return [{cursor:0}];
  const [input]=args,d=input&&Object.getOwnPropertyDescriptor(input,'cursor'),bok=input&&Object.getOwnPropertyDescriptor(input,'includeBok');
  if(args.length!==1||Object.getPrototypeOf(input)!==Object.prototype||
    Reflect.ownKeys(input).some(key=>key!=='cursor'&&!(allowIncludeBok&&key==='includeBok'))||
    !d||!Object.hasOwn(d,'value')||!(d.value===0||typeof d.value==='string')||
    bok&&(!allowIncludeBok||!Object.hasOwn(bok,'value')||typeof bok.value!=='boolean'))throw 0;
  return [{cursor:d.value,...(bok?{includeBok:bok.value}:{})}];
 }catch{throw Object.assign(Error('Invalid Rolling balance cursor'),{code:'ROLLING_BALANCE_CURSOR_INVALID'});}
}
function accountStatusArguments(args){
 if(args.length===0)return [];
 try{
  const [input]=args,d=input&&Object.getOwnPropertyDescriptor(input,'opening');
  if(args.length!==1||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==1||!d||!Object.hasOwn(d,'value')||d.value!==true)throw 0;
  return [{opening:true}];
 }catch{throw Object.assign(Error('Invalid Rolling action'),{code:'ROLLING_INVALID_ACTION'});}
}
const boardStateMethods=Object.freeze({thread:'post_thread',like:'set_like',unlike:'set_like',name:'register_name',bio:'set_bio',avatar:'set_avatar',subboard:'create_subboard','moderate-post':'remove_post','moderate-avatar':'remove_avatar','reject-subboard':'reject_subboard','set-main-policy':'set_main_policy','transfer-moderator':'transfer_moderator',screen:'screen',withdraw:'withdraw'});
export function createSynchronizedRollingApplication({application,synchronize,contextGuard,operationScope=()=>null,prepareContext,prepareContractState,preparePredecessorAnchor,beforePostingPrepare}){
 if(typeof synchronize!=='function'||typeof contextGuard!=='function'||prepareContext!==undefined&&typeof prepareContext!=='function'||prepareContractState!==undefined&&typeof prepareContractState!=='function'||preparePredecessorAnchor!==undefined&&typeof preparePredecessorAnchor!=='function'||beforePostingPrepare!==undefined&&typeof beforePostingPrepare!=='function')throw Error('Rolling synchronization unavailable');
 const refreshPostingAnchor=Symbol('refresh-posting-anchor');
 const calls=methods.map(name=>{
  if(typeof application?.[name]!=='function')throw Error('Rolling application unavailable');
  const call=application[name].bind(application);
  return [name,async(...args)=>{
   if(name==='readFundingState'&&args.length!==0)throw Object.assign(Error('Invalid Rolling action'),{code:'ROLLING_INVALID_ACTION'});
   const captured=name==='prepare'&&args[0]?.type==='thread'?[captureThreadAction(args[0]),...args.slice(1)]:name==='readAccountStatus'?accountStatusArguments(args):name==='resumeSaved'?savedResumeArguments(args):name==='prepareBokRelease'?bokReleaseArguments(args):['readBalances','readBokAccounting'].includes(name)?balanceArguments(args,name==='readBalances'):args;
   for(;;){
   const stateMethod=name==='prepare'&&Object.hasOwn(boardStateMethods,captured[0]?.type)?boardStateMethods[captured[0].type]:undefined;
   await contextGuard();
   const scope=operationScope();let ordinaryPost=false;
   if(name==='readFundingState'&&(!scope||!scope.synchronized)){
    const metadata=await call({beforeSync:true});
    await contextGuard();
    if(operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
    // Do not mark this operation synchronized: bridge readiness and the next
    // real preparation still require their normal fresh native anchor.
    // Completed ordinary/claim history still receives its full canonical receipt check.
    if(metadata?.status==='ready')return metadata;
   }
   // Moderator identity is public storage; it needs no private-state sync.
   if(name!=='readModeratorStatus'&&(!scope||!scope.synchronized)){
    // The native sync and public readiness reads are independent. Neither
    // failure may release the account lease while its sibling is still running.
    ordinaryPost=Boolean(scope)&&name==='prepare'&&captured[1]?.immediate===true&&['post','reply','quote','repost'].includes(captured[0]?.type);
    const ordinaryPolicy=ordinaryPost&&(captured[0].subboard===undefined||/^(0|0x0{64})$/.test(captured[0].subboard));
    const accountStatus=Boolean(scope)&&name==='readAccountStatus'&&captured[0]?.opening===true;
    // Likes use the same verified captured-anchor ancestry as account reads.
    // Only this owned immediate action changes synchronization strategy.
    const snapshotAncestry=Boolean(scope)&&name==='prepare'&&captured[1]?.immediate===true&&['like','unlike'].includes(captured[0]?.type);
    // Name completion still discovers native ownership after this fresh sync.
    // Only its public Board class/initialization reads may warm at the anchor.
    const ownedNames=Boolean(scope)&&name==='ownedIdentities';
    const reads=[()=>synchronize({ordinaryPolicy,ordinaryPost,...(accountStatus?{accountStatus:true}:{}),...(ownedNames?{ownedNames:true}:{}),...(snapshotAncestry?{snapshotAncestry:true}:{})})];if(scope&&prepareContext)reads.push(()=>prepareContext({predecessor:name==='prepare',
      ...(name==='prepare'&&Array.isArray(scope.preparationReads)&&captured[1]?.immediate===true&&['post','reply','quote','repost'].includes(captured[0]?.type)?{ordinaryPayment:true}:{}),
      ...(name==='prepare'&&Array.isArray(scope.preparationReads)&&captured[1]?.immediate===true&&['like','unlike'].includes(captured[0]?.type)?{likePayment:true}:{}),
      ...(name==='prepare'&&Array.isArray(scope.preparationReads)&&captured[1]?.immediate===true&&['name','bio','avatar','subboard'].includes(captured[0]?.type)?{deferredPayment:true}:{})}));
    const results=await Promise.allSettled(reads.map(read=>Promise.resolve().then(read)));
    const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
    if(scope&&operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
    if(scope)scope.synchronized=true;
   }
   await contextGuard();
   const overlapMethod=ordinaryPost?'post':scope&&captured[1]?.immediate===true&&['like','unlike','name','bio','avatar','subboard'].includes(captured[0]?.type)?stateMethod:undefined;
   if(scope&&stateMethod&&prepareContractState&&!overlapMethod){
    await prepareContractState({method:stateMethod});
    if(operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
    await contextGuard();
   }
   const invoke=async()=>{
    if(beforePostingPrepare&&name==='prepare'&&captured[1]?.immediate===true&&['post','reply','quote','repost','thread','bok'].includes(captured[0]?.type)){
     // The existing native discovery barrier owns this exact synchronized scope.
     // No workflow intent exists while readiness is inspected or chain time waits.
     if(scope?.contractStateReady)await scope.contractStateReady;
     const ready=await beforePostingPrepare(captured[0]);await contextGuard();
     if(operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
     if(ready===false){
      if(!scope||scope.synchronized!==false)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
      return refreshPostingAnchor;
     }
    }
    return call(...captured);
   };
   let result;
   if(overlapMethod&&prepareContractState){
    // Capture the synchronized header before discovery owns the native queue.
    if(preparePredecessorAnchor){await preparePredecessorAnchor();await contextGuard();if(operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});}
    const ready=Promise.resolve().then(()=>prepareContractState({method:overlapMethod}));
    scope.contractStateReady=ready;
    // Predecessor authority can run during native discovery. The application
    // awaits this exact owned barrier before arguments or a new intent write.
    try{
     const results=await Promise.allSettled([ready,Promise.resolve().then(invoke)]);
     const failed=results.find(value=>value.status==='rejected');if(failed)throw failed.reason;
     await contextGuard();if(operationScope()!==scope)throw Object.assign(Error('Rolling operation changed'),{code:'ROLLING_CONTEXT_CHANGED'});
     result=results[1].value;
    }finally{if(scope.contractStateReady===ready)delete scope.contractStateReady;}
   }else result=await invoke();
   if(result===refreshPostingAnchor)continue;
   if(scope&&['submitPrepared','resumeSaved'].includes(name)&&['included','confirmed','authorized','reverted','bok-post-reverted','bok-release-reverted'].includes(result?.status))scope.synchronized=false;
   return result;
   }
  }];
 });
 return Object.freeze(Object.fromEntries(calls));
}
