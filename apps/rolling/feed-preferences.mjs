// Reading signals remain in memory in this tab. No account identifier or
// browsing history is transmitted or stored in shared unencrypted storage.
const stop=new Set(['this','that','with','from','have','your','they','there','what','when','will','would','about','into','just','been','were','their','then','than','some','more']);
const tokens=text=>[...new Set(String(text??'').toLowerCase().match(/[\p{L}]{4,24}/gu)??[])].filter(x=>!stop.has(x)).slice(0,24);
// Dedupe visible feed cards in this tab only. The reporter receives fixed event
// names, never the temporary post IDs used by the reader. Saturation stops new
// measurements rather than evicting entries and recounting live refreshes.
export function createFeedObservation({report=()=>{},limit=1000}={}){
 const seen=new Set(),opened=new Set();
 const emit=name=>{try{report(name);}catch{}};
 function observe(id){
  if(typeof id!=='string'||!id.length||id.length>100||seen.has(id)||seen.size>=limit)return false;
  seen.add(id);emit('feed_impression');return true;
 }
 return Object.freeze({observe,open(id){if(!seen.has(id)&&!observe(id)||opened.has(id))return false;opened.add(id);emit('feed_open');return true;},reset(){seen.clear();opened.clear();}});
}
export function createFeedPreferences({now=()=>Math.floor(Date.now()/1000)}={}){
 let scope=null;const topics=new Map(),seen=new Map(),read=new Map();
 const trim=(map,max)=>{while(map.size>max)map.delete(map.keys().next().value);};
 return {
  reset(){topics.clear();seen.clear();read.clear();},
  scope(value){if(value!==scope){scope=value;this.reset();}},
  seen(id){if(typeof id!=='string')return;const old=seen.get(id);seen.delete(id);seen.set(id,{count:Math.min(5,(old?.count??0)+1),lastSeen:now()});trim(seen,1000);},
  engage(post,{readThread=false,weight=1}={}){if(!post?.record)return;for(const token of tokens(post.text)){const count=topics.get(token)??0;topics.delete(token);topics.set(token,Math.min(12,count+weight));}trim(topics,120);if(readThread){read.delete(post.record.root);read.set(post.record.root,now());trim(read,300);}},
  snapshot(saved){return {followedBoards:[...(saved?.followedBoards??[])],followedNames:[...(saved?.followedNames??[])],topics:[...topics].sort((a,b)=>b[1]-a[1]).slice(0,40).map(([word])=>word),readThreads:Object.fromEntries(read),seenPosts:Object.fromEntries(seen)};}
 };
}
