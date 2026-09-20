// Storage adapters return one consistent snapshot and atomically commit ranges/head.
export async function readFeedSnapshot(read,key,maxRanges){
 const head=(await read(key))??null,ranges=[];
 if(head===null)return {head,ranges};
 let id=JSON.parse(head).latest;const seen=new Set();
 while(id!==null){
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)||seen.has(id)||ranges.length>=maxRanges)throw Error('Invalid public feed range chain.');
  seen.add(id);const value=await read(`${key}:range:${id}`);
  if(typeof value!=='string')throw Error('Missing public feed range.');
  ranges.push({id,value});id=JSON.parse(value).previous;
 }
 return {head,ranges};
}
