// The worker owns private SDK state. Only these application capabilities cross
// the channel; no arbitrary object traversal, eval, provider RPC or key logging.
export const APPLICATION_METHODS=Object.freeze(['readFundingState','readWithdrawalReadiness','readBokAccounting','readBalances','readWithdrawal','readModeratorStatus','readBokStatus','readPrivateFeeCredit','prepareBokPost','prepareBokRelease','readAccountStatus','readProfile','ownedIdentities','prepare','submitPrepared','cancelPrepared','reconcile','inspectRecovery','prepareReplacement','prepareInterrupted','resumeSaved','executeAction','executeWithdrawal']);
export const FUNDING_METHODS=Object.freeze(['prepareStarter','prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim','advanceClaim','pauseClaim']);
export const TOPUP_METHODS=Object.freeze(['prepare','confirm','recover','inspect','checkpointClaim','reviewRevertedClaim','advanceClaim','pauseClaim']);
export const WITHDRAWAL_METHODS=Object.freeze(['inspect','observe','waitUntilReady','prepare','prepareSaved','confirm','recover','cancel']);
export const DEPOSIT_METHODS=Object.freeze(['list','request','prepare']);
export const CALLBACKS=Object.freeze(['onPrepared','onProgress','onSubmitted']);
export const CUSTODY_METHODS=Object.freeze(['capture','guard','getAddress','signTypedData','sendTransaction']);
export function workerFailure(code='ROLLING_WORKER_UNAVAILABLE') {return Object.assign(new Error('Account operation could not finish.'),{code});}
export function errorRecord(error,depth=0){
 const data=key=>{try{return Object.getOwnPropertyDescriptor(error??{},key)?.value;}catch{return undefined;}};
 const code=data('code'),name=data('name')??(error instanceof AggregateError?'AggregateError':error instanceof ReferenceError?'ReferenceError':error instanceof TypeError?'TypeError':error instanceof RangeError?'RangeError':'Error');
 const value={name:['Error','TypeError','ReferenceError','RangeError','AggregateError'].includes(name)?name:'Error',code:typeof code==='number'&&Number.isSafeInteger(code)||typeof code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:'ROLLING_WORKER_UNAVAILABLE'};
 for(const key of ['providerCode','ethereumStage','stage','step']){const field=data(key);if(typeof field==='string'&&/^[-a-zA-Z0-9_/]{1,80}$/.test(field))value[key]=field;}
 const errors=data('errors');if(depth===0&&Array.isArray(errors))value.errors=errors.slice(0,4).map(item=>errorRecord(item,1));
 return value;
}
export function restoreError(value){
 const Constructor=value?.name==='ReferenceError'?ReferenceError:value?.name==='TypeError'?TypeError:value?.name==='RangeError'?RangeError:Error;
 const error=value?.name==='AggregateError'?new AggregateError((value.errors??[]).map(restoreError),'Account operation could not finish.'):new Constructor('Account operation could not finish.');
 if(value&&typeof value==='object')for(const key of ['code','providerCode','ethereumStage','stage','step'])if(typeof value[key]==='string'||typeof value[key]==='number')error[key]=value[key];
 if(['TypeError','ReferenceError','RangeError'].includes(value?.name))error.name=value.name;
 return error;
}
