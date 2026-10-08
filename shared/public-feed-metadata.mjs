// BUILD/TESТ ONLY. Do not import this module into the public-reader runtime.
import {DomainSeparator} from '@aztec/constants';
import {EventSelector,decodeFunctionSignature} from '@aztec/stdlib/abi';
import {computeLogTag} from '@aztec/stdlib/hash';
const types=['PolicyPublished','PostPublished','PostFlagged','PluginConfigured','PluginInvoked','PluginReplyLinked'];
function count(type){if(type.kind==='field'||type.kind==='integer')return 1;if(type.kind==='array')return type.length*count(type.type);if(type.kind==='struct')return type.fields.reduce((sum,field)=>sum+count(field.type),0);throw new Error('Unsupported public event ABI');}
export async function publicFeedMetadata(artifact){
 const result={};
 for(const type of types){
  const events=artifact?.outputs?.structs?.events?.filter(event=>event.path?.split('::').at(-1)===type);
  if(events?.length!==1)throw new Error('Missing public event ABI');
  const abiType=events[0],selector=await EventSelector.fromSignature(decodeFunctionSignature(type,abiType.fields));
  result[type]={abiType,count:count(abiType),tag:(await computeLogTag(selector.toField(),DomainSeparator.EVENT_LOG_TAG)).toString()};
 }
 return result;
}
