import {ProtocolContractAddress} from '@aztec/protocol-contracts';
import {ProtocolContractArtifact} from '@aztec/protocol-contracts/providers/bundle';
import {encode} from '@aztec/entrypoints/encoding';
import {FunctionCall,FunctionSelector,loadContractArtifact} from '@aztec/stdlib/abi';
import artifact from '../plugins/adapter_artifact.json' with {type:'json'};
import feeArtifact from '../apps/src/billboard/private_fee_artifact.json' with {type:'json'};
const selector=async(raw,name)=>{const artifact=loadContractArtifact(raw);return BigInt((await FunctionSelector.fromNameAndParameters([...artifact.functions,...artifact.nonDispatchPublicFunctions].find(f=>f.name===name))).toString());};
export async function pluginSelectors(){return {feeClaim:BigInt((await FunctionSelector.fromNameAndParameters(ProtocolContractArtifact.FeeJuice.functions.find(f=>f.name==='claim'))).toString()),paddingHash:BigInt((await encode([FunctionCall.empty()])).encodedFunctionCalls[0].args_hash.toString()),claim:await selector(artifact,'claim'),public:new Set(await Promise.all(['withdraw','cancel','release_expired'].map(name=>selector(artifact,name)))),fee:new Set(await Promise.all(['pay_fee','mint_and_pay_fee'].map(name=>selector(feeArtifact,name))))};}
/** Inspect the signed account payload; a harmless plugin call cannot authorize unrelated work. */
export function validatePluginPayload(inputs,{metadata,pluginAddresses,privateFeeAddress,selectors,allowFeeOnly=false}) {
 const context=inputs.inputs.tx_context;
 if(BigInt(context.chain_id)!==BigInt(metadata.chainId)||BigInt(context.version)!==BigInt(metadata.rollupVersion))throw Error('Wrong plugin network');
 const allowed=new Set(pluginAddresses.map(BigInt));let count=0;
 for(const call of inputs.app_payload.function_calls){
  const target=BigInt(call.target_address.inner),id=BigInt(call.function_selector.inner);
  if(target===0n&&id===0n&&BigInt(call.args_hash)===selectors.paddingHash&&call.is_public&&!call.hide_msg_sender&&!call.is_static)continue;
  if(call.hide_msg_sender||call.is_static)throw Error('Invalid plugin call flags');
  if(allowed.has(target)&&((call.is_public&&selectors.public.has(id))||(!call.is_public&&id===selectors.claim))){count++;continue;}
  if(allowFeeOnly&&target===BigInt(ProtocolContractAddress.FeeJuice.toString())&&!call.is_public&&id===selectors.feeClaim)continue;
  if(privateFeeAddress&&target===BigInt(privateFeeAddress)&&!call.is_public&&selectors.fee.has(id))continue;
  throw Error('Unapproved plugin call');
 }
 if(!count&&!allowFeeOnly)throw Error('Plugin operation required');
 return count;
}
