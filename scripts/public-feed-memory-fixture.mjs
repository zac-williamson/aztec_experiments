import assert from 'node:assert/strict';
import {readFeedSnapshot} from '../shared/public-feed-storage.mjs';
// Transactional memory double for the two real cache adapters.
export function memoryFeedStorage(data,beforeCommit=()=>{}){
 return {load:(key,max)=>readFeedSnapshot(k=>data.get(k)??null,key,max),
  async commit(key,previous,next,range,removed){
   beforeCommit();assert.equal(data.get(key)??null,previous,'concurrent cache change');
   if(range){assert(!data.has(`${key}:range:${range.id}`));data.set(`${key}:range:${range.id}`,range.value);}
   data.set(key,next);for(const id of removed)data.delete(`${key}:range:${id}`);
  }};
}
