import {formatEther} from 'ethers';
import {mentions,handleField,fetchDescriptor,unpackText} from './protocol.mjs';
export {mentions} from './protocol.mjs';
export {payForInvocation} from './ethereum.mjs';

/** Two transactions, one composer action. Persist only public payment intent. */
export async function postWithPlugins({text,prepare,post,pay,store,progress=()=>{}}) {
  let pending=await store.read();
  if(pending&&pending.text!==text)throw Error('Finish the saved plugin payment before posting another message');
  if(!pending){
    const plan=await prepare(text);
    if(!plan)return post(null);
    progress('@'+plan.handle+': the Ethereum wallet will request '+formatEther(plan.descriptor.payment.amountWei)+' ETH after publication.');
    const result=await post(plan.handleField);
    if(!result.postId)throw Error('Published plugin post ID missing');
    pending={text,plan,postId:result.postId};await store.write(pending);
  }
  progress('Message published. Confirm the plugin payment in your Ethereum wallet.');
  const payment=await pay({...pending,submitted:async transactionHash=>{pending={...pending,transactionHash};await store.write(pending);}});
  await store.clear();return {postId:pending.postId,pluginPayment:payment};
}

/** UI-independent mention resolution. lookup is the board's public plugin API. */
export async function prepareInvocation({text,scope,lookup,loadDescriptor=fetchDescriptor}) {
  const found=[];
  for(const handle of mentions(text)) {
    const id=handleField(handle),plugin=await lookup(id);
    if(!plugin||BigInt(plugin.receiver)===0n)continue;
    if(!plugin.enabled)throw Error('@'+handle+' is disabled');
    found.push({handle,id,plugin});
  }
  if(found.length>1)throw Error('One paid plugin per message');
  if(!found.length)return null;
  const {handle,id,plugin}=found[0];
  const url=typeof plugin.descriptor==='string'?plugin.descriptor:unpackText(plugin.descriptor,plugin.length);
  const descriptor=await loadDescriptor(url,{...scope,receiver:plugin.receiver});
  return {handle,handleField:id,descriptor};
}
