// Contract threads contain two to four contiguous posts in one transaction.
export const MAX_THREAD_POSTS=4;
const invalid=()=>{throw Object.assign(new Error('ROLLING_INVALID_ACTION'),{code:'ROLLING_INVALID_ACTION'});};
const fields=new Set(['type','deposit','name','subboard','parent','root','contents','budgets']);
function dataArray(value,length){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length!==length||Reflect.ownKeys(value).length!==length+1)invalid();
 return Array.from({length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value'))invalid();return d.value;});
}
export function captureThreadAction(input){
 if(!input||Object.getPrototypeOf(input)!==Object.prototype)invalid();
 const result={};
 for(const key of Reflect.ownKeys(input)){const d=Object.getOwnPropertyDescriptor(input,key);if(!fields.has(key)||!d||!Object.hasOwn(d,'value'))invalid();result[key]=d.value;}
 if(result.type!=='thread'||typeof result.deposit!=='string'||!Array.isArray(result.contents)||result.contents.length<2||result.contents.length>MAX_THREAD_POSTS)invalid();
 result.contents=dataArray(result.contents,result.contents.length);
 for(const content of result.contents)if(typeof content!=='string'||!content.isWellFormed()||content.includes('\0')||new TextEncoder().encode(content).length>992||!content.trim())invalid();
 if(result.budgets!==undefined){result.budgets=dataArray(result.budgets,result.contents.length);for(const budget of result.budgets)if(typeof budget!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(budget)||BigInt(budget)>=(1n<<128n))invalid();}
 const invitations=result.budgets?.filter(value=>value!=='0').length??0;
 if(invitations>1||invitations&&result.contents.length>3)throw Object.assign(new Error('ROLLING_THREAD_BOK_LIMIT'),{code:'ROLLING_THREAD_BOK_LIMIT'});
 for(const key of ['name','subboard','parent','root'])if(result[key]!==undefined&&typeof result[key]!=='string')invalid();
 return result;
}
export async function linkThreadDrafts({contents,nonces,baseDraft,postId,encodeContent}){
 const drafts=[],root=BigInt(baseDraft.root_reference)===0n?await postId(nonces[0]):baseDraft.root_reference;
 for(let i=0;i<contents.length;i++){
  const [message,length]=encodeContent(contents[i]);
  drafts.push({...baseDraft,...(i?{parent:await postId(nonces[i-1]),root_reference:root}:{}),message,length});
 }
 return drafts;
}
