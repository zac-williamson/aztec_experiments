// Application-owned progress. Only a bounded, public vocabulary crosses into views.
(function(root){
  const stages=Object.freeze({
    checking:'Checking your account',preparing:'Preparing your transaction',
    wallet:'Confirm the request in your wallet',funding:'Adding transaction credit',
    deposit:'Sending your refundable deposit',bridge:'Waiting for your deposit to reach the board',
    queued:'Waiting in the board’s proof queue',proving:'Creating your private proof',submitting:'Sending your transaction',
    confirming:'Waiting for confirmation',syncing:'Updating your account',
    screening:'Preparing your deposit for return',settlement:'Waiting for Ethereum settlement',
    complete:'Complete',failed:'Could not finish',cancelled:'Cancelled',idle:''
  });
  function createOperationState({now=()=>Date.now(),id=()=>crypto.randomUUID()}={}){
    let state=Object.freeze({id:null,action:null,status:'idle',stage:'idle',message:'',mode:null,error:null,startedAt:null,result:null,failedAtStage:null,endedAt:null,history:Object.freeze([])});
    const listeners=new Set();
    const publish=patch=>{state=Object.freeze({...state,...patch});for(const listener of listeners){try{listener(state);}catch{ /* Rendering cannot alter an operation outcome. */ }}return state;};
    return Object.freeze({
      snapshot:()=>state,
      subscribe(listener){listeners.add(listener);try{listener(state);}catch{}return()=>listeners.delete(listener);},
      begin(action,mode){if(state.status==='working'||state.status==='waiting')throw Object.assign(Error('An operation is already running.'),{code:'BB_OPERATION_BUSY'});return publish({id:id(),action,mode,status:'working',stage:'checking',message:stages.checking,error:null,startedAt:now(),result:null,failedAtStage:null,endedAt:null,history:Object.freeze([])});},
      progress(stage){if(!Object.hasOwn(stages,stage)||!['working','waiting'].includes(state.status))return;return publish({history:Object.freeze([...new Set([...state.history,stage])]),stage,message:stages[stage],status:['wallet','bridge','confirming','settlement','queued'].includes(stage)?'waiting':'working'});},
      receipt(value){const result={...state.result};for(const key of ['state','lastL2TxHash','lastEthereumTxHash','postId','feePaid','refundAmount','refundRecipient'])if(typeof value?.[key]==='string')result[key]=value[key];return publish({result:Object.freeze(result)});},
      finish(){return publish({endedAt:now(),status:'complete',stage:'complete',message:stages.complete,error:null});},
      fail(error){if(error.code==='BB_OPERATION_PAUSED')return publish({endedAt:now(),status:'paused',message:'Paused. Your completed payments are saved.',error:Object.freeze({code:error.code})});const cancelled=['BB_WALLET_REJECTED','BB_ETH_REQUEST_CANCELLED'].includes(error.code);return publish({endedAt:now(),failedAtStage:state.stage,status:cancelled?'cancelled':'failed',stage:cancelled?'cancelled':'failed',message:error.message,error:Object.freeze({code:error.code||'BB_OPERATION_FAILED',phase:error.phase==='fee-funding'?'fee-funding':null,field:error.field||null,action:error.action||'retry'})});},
      report(){return JSON.stringify({schema:1,operationId:state.id,operation:state.action,stage:state.failedAtStage||state.stage,status:state.status,proving:state.mode,errorCode:state.error?.code??null},null,2);},
    });
  }
  root.BillboardOperations=Object.freeze({create:createOperationState,stages});
})(globalThis);
