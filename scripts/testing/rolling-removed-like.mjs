// Trusted harness attribution only. artifact must be the parent-authenticated,
// processed RollingBoard artifact. Never persist the error, stack or revert data.
import {FunctionSelector} from '@aztec-labs/stdlib/abi';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {SimulationError} from '@aztec-labs/stdlib/errors';
import {resolveAssertionMessageFromRevertData} from '@aztec-labs/simulator/client';
const invalid=()=>Error('Removed-like classifier configuration is invalid.');
function data(object,key){const d=Object.getOwnPropertyDescriptor(object,key);if(!d||!Object.hasOwn(d,'value'))throw invalid();return d.value;}
// Capture pinned SDK primitive storage without invoking methods/getters supplied
// by the error. Reconstruct clean SDK values before invoking its ABI decoder.
function field(value){if(Object.getPrototypeOf(value)!==Fr.prototype)throw invalid();const n=data(value,'asBigInt');if(typeof n!=='bigint'||n<0n||n>=Fr.MODULUS)throw invalid();return new Fr(n);}
function address(value){if(Object.getPrototypeOf(value)!==AztecAddress.prototype)throw invalid();return field(data(value,'xCoord')).toString();}
function selector(value){if(Object.getPrototypeOf(value)!==FunctionSelector.prototype)throw invalid();const n=data(value,'value');if(!Number.isSafeInteger(n)||n<0||n>0xffffffff)throw invalid();return n;}

export async function createRemovedLikeClassifier({artifact,boardAddress}){
 let expectedAddress,expectedSelector,assertionSelector,dispatch;
 try{
  expectedAddress=typeof boardAddress==='string'?boardAddress:address(boardAddress);
  if(!/^0x[0-9a-f]{64}$/.test(expectedAddress)||new Fr(BigInt(expectedAddress)).toString()!==expectedAddress||BigInt(expectedAddress)===0n)throw invalid();
  const functions=artifact.nonDispatchPublicFunctions?.filter(fn=>fn.name==='_set_like');
  const dispatchers=artifact.functions?.filter(fn=>fn.name==='public_dispatch');
  if(functions?.length!==1||dispatchers?.length!==1||functions[0].functionType!=='public'||functions[0].isOnlySelf!==true)throw invalid();
  dispatch={errorTypes:structuredClone(dispatchers[0].errorTypes)};
  const guards=Object.entries(dispatch.errorTypes).filter(([,v])=>v.error_kind==='string'&&v.string==='Post removed');if(guards.length!==1)throw invalid();
  if(!/^(?:0|[1-9][0-9]*)$/.test(guards[0][0]))throw invalid();
  assertionSelector=new Fr(BigInt(guards[0][0])).toBigInt();
  expectedSelector=selector(await FunctionSelector.fromNameAndParameters(functions[0]));
 }catch{throw invalid();}
 return error=>{
  try{
   if(!(error instanceof SimulationError))return false;
   // SDK getCallStack returns its own data field. Reject accessor replacement
   // before calling the installed prototype; never call an error-owned method.
   const stored=data(error,'functionErrorStack');
   const stack=SimulationError.prototype.getCallStack.call(error);
   if(stack!==stored||!Array.isArray(stack)||stack.length<1||stack.length>32)return false;
   const leaf=data(stack,String(stack.length-1));
   if(address(data(leaf,'contractAddress'))!==expectedAddress||selector(data(leaf,'functionSelector'))!==expectedSelector)return false;
   const raw=data(error,'revertData');
   // The required assertion is a static Noir string: exactly its selector, no
   // variable payload. Missing/trailing data cannot qualify the guard.
   if(!Array.isArray(raw)||raw.length!==1)return false;
   const revertData=[field(data(raw,'0'))];
   // Unknown selectors can make the Noir WASM decoder print a panic before
   // throwing. Only the artifact-bound static guard may reach that decoder.
   if(revertData[0].toBigInt()!==assertionSelector)return false;
   return resolveAssertionMessageFromRevertData(revertData,dispatch)==='Post removed';
  }catch{return false;}
 };
}
