import {mentions,handleField,fetchDescriptor,unpackText} from './protocol.mjs';
export {mentions} from './protocol.mjs';
export {pluginAccountAction} from './account-client.mjs';

/** UI-independent mention resolution. lookup is the board's public plugin API. */
export async function prepareInvocation({text,scope,lookup,loadDescriptor=fetchDescriptor,allowDisabled=false}) {
  const found=[];
  for(const handle of mentions(text)) {
    const id=handleField(handle),plugin=await lookup(id);
    if(!plugin||BigInt(plugin.receiver)===0n)continue;
    if(!plugin.enabled&&!allowDisabled)throw Error('@'+handle+' is disabled');
    found.push({handle,id,plugin});
  }
  if(found.length>1)throw Error('One plugin per message');
  if(!found.length)return null;
  const {handle,id,plugin}=found[0];
  const url=typeof plugin.descriptor==='string'?plugin.descriptor:unpackText(plugin.descriptor,plugin.length);
  const descriptor=await loadDescriptor(url,{...scope,receiver:plugin.receiver});
  return {handle,handleField:id,descriptor};
}
