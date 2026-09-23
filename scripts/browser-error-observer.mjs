// Test-only observer: fixed error categories and same-origin source coordinates.
// Generic error messages, symbols, wallet values and RPC payloads never leave the page.
// Plain RPC error causes retain only their code and a bounded message with hex values redacted.
export function installBrowserErrorObserver() {

    const original=globalThis.publicOperationFailure;if(typeof original!=='function')throw Error('Diagnostic formatter unavailable');
    globalThis.__u01FormatterDiagnostics=[];
    globalThis.__u01CaptureError=function(error){
     try{
      const names=new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','EvalError','URIError','AggregateError','DOMException','RuntimeError','CompileError','LinkError']);
      const codes=new Set(['BB_REMOTE_PROVER_FAILED','BB_DEPOSIT_READ','BB_GAS_LIMIT_EXCEEDED','BB_SIMULATION_FAILED','BB_PRIVATE_FEE_PREPARATION_FAILED','BB_DEPOSIT_MESSAGE_PENDING','BB_DEPOSIT_MESSAGE_INVALID','BB_DEPOSIT_MESSAGE_UNAVAILABLE','BB_ETH_SUBMISSION_UNKNOWN','BB_ETH_TRANSACTION_FAILED','BB_ETH_RECOVERY_REQUIRED','BB_RECOVERY_UNKNOWN','BB_NO_SAVED_ETHEREUM_TRANSACTION','BB_OPERATION_FAILED','BB_CONNECTION_VERIFICATION_FAILED','BB_FEE_CONFIG_REQUIRED','BB_SUBMISSION_UNKNOWN','BB_TRANSACTION_FAILED','BB_STATE_CONFLICT','BB_RECOVERY_REQUIRED','BB_JOURNAL_INVALID','BB_PRIVATE_FEE_AMOUNT','BB_PRIVATE_FEE_ACTION_FAILED','BB_PRIVATE_FEE_CLAIM_FAILED','PRIVATE_FEE_FUNDING_SUBMISSION_UNKNOWN','INSECURE_CONTEXT','SHARED_MEMORY_UNAVAILABLE','WASM_UNAVAILABLE','WORKER_UNAVAILABLE','CRYPTO_UNAVAILABLE','LOCKS_UNAVAILABLE','STORAGE_UNAVAILABLE','OPFS_UNAVAILABLE','READINESS_TIMEOUT']);
      const chain=[],seen=new Set();let current=error;
      while(current!==null&&current!==undefined&&chain.length<5&&!seen.has(current)){
       seen.add(current);const constructor=current?.constructor?.name,frames=[];
       if(typeof current?.stack==='string')for(const line of current.stack.split('\n').slice(0,17)){
        const match=line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);if(!match)continue;
        const u=new URL(match[1]),row=Number(match[2]),column=Number(match[3]);
        if(u.origin===location.origin&&['/user.html','/fee-juice.html','/aztec_bundle.js'].includes(u.pathname)&&Number.isSafeInteger(row)&&Number.isSafeInteger(column))frames.push({file:u.pathname,line:row,column});
       }
       // Raw messages stay inside this page. Only fixed category booleans leave.
       const message=typeof current?.message==='string'?current.message:'';
       const categories={memory:/out of memory|memory allocation|allocat(?:e|ion).*memory|memory.*grow|grow.*memory/i.test(message),outOfBounds:/out.of.bounds/i.test(message),srs:/\b(?:srs|crs)\b|structured reference string/i.test(message),assertion:/assert(?:ion)?(?: failed| failure)?/i.test(message),typeError:constructor==='TypeError'||/\btypeerror\b/i.test(message)};
       const rpcError=Object.getPrototypeOf(current)===Object.prototype&&Number.isInteger(current.code)&&typeof current.message==='string'
        ? {code:current.code,message:current.message.replace(/0x[0-9a-f]+/gi,'[hex]').slice(0,512)} : undefined;
       chain.push({constructor:names.has(constructor)?constructor:'OtherError',code:codes.has(current?.code)?current.code:null,frames,categories,...(['read','catalog','decompress','board-binding','prove','native-init','native-prove','native-srs','native-constraint','native-verification','native-process','worker'].includes(current?.stage)?{stage:current.stage}:{}),...(rpcError?{rpcError}:{})});current=current?.cause;
      }
      return {chain};
     }catch{return {sanitizerFailed:true};}
    };
    globalThis.publicOperationFailure=function(...args){
     try{if(globalThis.__u01FormatterDiagnostics.length<16)globalThis.__u01FormatterDiagnostics.push(globalThis.__u01CaptureError(args[0]));}catch{}
     return Reflect.apply(original,this,args);
    };

}
