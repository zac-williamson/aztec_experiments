// Local ranking only: no wallet identity, network, storage or telemetry. A session
// captures time and preferences so later reads cannot reshuffle already paged rows.
export const FEED_RANKING_VERSION=1;
const fail=()=>{throw Error('Invalid feed ranking input');};
const field=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x);
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const hash=text=>{let value=2166136261;for(const c of text){value^=c.codePointAt(0);value=Math.imul(value,16777619);}return value>>>0;};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const words=text=>String(text??'').normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]{2,32}/gu)??[];
function ids(value){if(value===undefined)return new Set();if(!Array.isArray(value)||value.length>1000||value.some(id=>!field(id)))fail();return new Set(value);}
export function createFeedRanking({items,now,seed,preferences={},boards={},priorityTxs=[]}={}){
 if(!Array.isArray(items)||items.length>3000||!finite(now)||typeof seed!=='string'||seed.length>200||!preferences||!boards||!Array.isArray(priorityTxs)||priorityTxs.length>100||priorityTxs.some(v=>!/^0x[0-9a-f]{64}$/.test(v)))fail();
 const follows=ids(preferences.followedBoards),names=ids(preferences.followedNames),priorities=new Set(priorityTxs);
 const topics=preferences.topics??[];if(!Array.isArray(topics)||topics.length>100||topics.some(v=>typeof v!=='string'||v.length>100))fail();
 const topicWords=new Set(topics.flatMap(words));const reads=preferences.readThreads??{},seen=preferences.seenPosts??{};
 const unique=new Map();
 for(const source of items){
  if(!source||!field(source.id)||source.id==='0'||!field(source.record?.root)||!field(source.record?.name_id)||!field(source.record?.subboard)||!field(source.timestamp)||!field(source.likes))fail();
  // Removed posts/boards remain visible through their direct routes, not recommendations.
  if(source.text===null||source.removal||source.record.root==='0')continue;
  if(unique.has(source.id))continue;
  const post=freeze(structuredClone(source)),age=Math.max(0,now-Number(post.timestamp))/3600;
  const fresh=1/Math.pow(1+age/36,1.15),engagement=Math.min(4,Math.log1p(Math.min(Number(post.likes),1e12))/2);
  const followed=follows.has(post.record.subboard)||post.record.name_id!=='0'&&names.has(post.record.name_id);
  const board=boards[post.record.subboard],tokens=new Set(words([post.text,board?.name,board?.slug].filter(Boolean).join(' ')));
  const topicMatches=[...topicWords].filter(word=>tokens.has(word)).length;
  const relevance=(follows.has(post.record.subboard)?2.4:0)+(post.record.name_id!=='0'&&names.has(post.record.name_id)?2.8:0)+Math.min(2.4,topicMatches*.8);
  const viewed=seen[post.id],count=finite(viewed?.count)?Math.min(viewed.count,20):0,last=finite(viewed?.lastSeen)?viewed.lastSeen:0;
  const fatigue=1/(1+count*.65*Math.exp(-Math.max(0,now-last)/(7*86400)));
  const read=finite(reads[post.record.root])&&Number(post.timestamp)<=reads[post.record.root];
  const score=(1.4+relevance+engagement)*fresh*fatigue*(read ? .4 : 1);
  const random=hash(seed+':'+post.id)/0x100000000;
  unique.set(post.id,{post,score,followed,read,count,random,priority:priorities.has(post.position?.txHash),exploration:(.4+fresh+random*.8)*fatigue*(read ? .4 : 1)/(1+engagement*.25)});
 }
 // One representative per conversation. Fresh unread replies can revive an old
 // root; prioritizing an included post never fabricates a post or an identity.
 const conversations=new Map();
 for(const row of unique.values()){
  const prior=conversations.get(row.post.record.root);
  if(!prior||row.priority&&!prior.priority||row.priority===prior.priority&&(row.score>prior.score||row.score===prior.score&&row.random>prior.random))conversations.set(row.post.record.root,row);
 }
 const remaining=[...conversations.values()],ordered=[],recentNames=[];
 const compare=(a,b,explore)=>{
  if(a.priority!==b.priority)return a.priority?-1:1;
  const adjusted=row=>{const name=row.post.record.name_id,repeats=name==='0'?0:recentNames.filter(n=>n===name).length;return (explore?row.exploration:row.score)/(1+repeats*.85);};
  const delta=adjusted(b)-adjusted(a);if(delta!==0)return delta;
  return a.random!==b.random?b.random-a.random:BigInt(a.post.id)<BigInt(b.post.id)?-1:1;
 };
 while(remaining.length){
  // Reserve every fifth place for discovery when an unseen, unfamiliar candidate
  // exists. This is variety, not an inferred view of anonymous authors.
  const explore=ordered.length%5===4&&!remaining.some(row=>row.priority);
  const pool=explore?remaining.filter(row=>!row.followed&&!row.read&&row.count===0):[];
  const row=(pool.length?pool:remaining).reduce((best,next)=>compare(next,best,explore&&pool.length>0)<0?next:best);
  remaining.splice(remaining.indexOf(row),1);ordered.push(row.post);recentNames.push(row.post.record.name_id);if(recentNames.length>8)recentNames.shift();
 }
 const key=hash(JSON.stringify([FEED_RANKING_VERSION,seed,now,preferences,priorityTxs,ordered.map(p=>p.id)])).toString(16);
 return Object.freeze({size:ordered.length,page({cursor=null,limit=20}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)fail();let offset=0;
  if(cursor!==null){if(typeof cursor!=='string'||!new RegExp('^'+key+':(0|[1-9][0-9]{0,4})$').test(cursor))fail();offset=Number(cursor.split(':')[1]);if(offset>=ordered.length)fail();}
  return {items:ordered.slice(offset,offset+limit),nextCursor:offset+limit<ordered.length?key+':'+(offset+limit):null};
 }});
}
