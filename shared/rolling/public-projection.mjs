// Deliberately dependency-free: the wallet SDK must not enter public reading.
const rollingError=()=>Object.assign(Error('Rolling public history is invalid or unavailable.'),{code:'ROLLING_PUBLIC_INVALID'});
const check=v=>{if(!v)throw rollingError();};
const copy=v=>structuredClone(v);
// Operator configuration, never event-derived or accepted as an HTTP parameter.
// Main board zero is always included; unknown future subboards are harmless until
// their authenticated creation. The field bound matches pinned Aztec Fr.
export function normalizeHomeSubboards(value=[]){
 check(Array.isArray(value)&&value.length<=256);
 const ids=Array.from(value);check(ids.every(id=>typeof id==='string'&&/^[1-9][0-9]{0,76}$/.test(id)&&BigInt(id)<0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n));
 check(new Set(ids).size===ids.length);return Object.freeze(ids);
}
// Public post selection only: no account, local tag or membership predicate.
export function normalizeLikePosts(value){
 check(typeof value==='string'&&value.length<=2495);
 const ids=value.split(',');check(ids.length>=1&&ids.length<=32&&new Set(ids).size===ids.length);
 check(ids.every(id=>/^[1-9][0-9]{0,76}$/.test(id)&&BigInt(id)<0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n));
 return ids.sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
}
const pos=e=>[e.position.blockNumber,e.position.txIndexWithinBlock,e.position.logIndexWithinTx].map(BigInt);
const compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;};
const text=(p,field,length)=>{const bytes=new Uint8Array(p[field].length*31);p[field].forEach((word,i)=>{let n=BigInt(word);for(let j=30;j>=0;j--){bytes[i*31+j]=Number(n&255n);n>>=8n;}});return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.slice(0,Number(p[length])));};
// Reversible JSON representation for exact raster bytes. Standard padded base64
// keeps public JSON bounded; MIME/image decoding is a separate consumer duty.
const binaryBase64=(fields,length)=>{const bytes=[];for(const word of fields){let n=BigInt(word),chunk=new Array(31);for(let j=30;j>=0;j--){chunk[j]=Number(n&255n);n>>=8n;}bytes.push(...chunk);}const data=bytes.slice(0,Number(length)),alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let encoded='';for(let i=0;i<data.length;i+=3){const a=data[i],b=data[i+1],c=data[i+2],n=(a<<16)|((b??0)<<8)|(c??0);encoded+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(b===undefined?'=':alphabet[(n>>>6)&63])+(c===undefined?'=':alphabet[n&63]);}return encoded;};
const emptyProfile=()=>({bio:{version:'0',digest:'0',length:'0',text:''},avatar:{version:'0',digest:'0',width:'0',height:'0',length:'0',encoding:'base64',data:'',removal:null}});
// Shared semantic reducer. The port is synchronous point access only; adapters
// own atomicity/CAS. A bounded overlay records the first before-image even when
// an event range changes the same key repeatedly. No history enumeration here.
export const ROLLING_PROJECTION_TABLES=Object.freeze(['posts','names','boards','policies','plugins','requests','likes','bok']);
export function stageRollingPublicReduction(events,{isValidatedEvent,read,scalars}={}){
 check(Array.isArray(events)&&events.length<=10000&&typeof isValidatedEvent==='function'&&typeof read==='function');
 const point=(table,key)=>{const value=read(table,key);check(value===undefined||typeof value==='boolean'||value&&Object.getPrototypeOf(value)===Object.prototype);return value;};
 const changes=new Map(),next={...scalars,eventCount:String(BigInt(scalars.eventCount)+BigInt(events.length))};
 for(const table of ROLLING_PROJECTION_TABLES){
  const get=key=>{const id=table+':'+key;return changes.has(id)?changes.get(id).value:point(table,key);};
  next[table]={get,has:key=>get(key)!==undefined,set(key,value){const id=table+':'+key;
   if(!changes.has(id)){const old=point(table,key);changes.set(id,{table,key,existed:old!==undefined,before:old,value});}
   else changes.get(id).value=value;
  }};
 }
  const awaiting=new Set();
  const sameTx=(a,b)=>a.position.txHash===b.position.txHash&&a.position.blockHash===b.position.blockHash;
  const putPost=(id,patch)=>{check(next.posts.has(id));next.posts.set(id,{...next.posts.get(id),...patch});};
  for(const e of events){
   check(isValidatedEvent(e));const p=e.payload,coordinate=pos(e),scope=JSON.stringify(e.scope);
   check(!next.scope||next.scope===scope);next.scope=scope;
   check(!next.last||compare(pos(next.last),coordinate)<0);if(next.last?.position.blockNumber===e.position.blockNumber){check(next.last.position.blockHash===e.position.blockHash);if(next.last.position.txIndexWithinBlock===e.position.txIndexWithinBlock)check(next.last.position.txHash===e.position.txHash);}
   next.last=e;
   if(e.type==='AccountingChanged'){
    const old=next.bok.get(p.request_id);
    check(old?old.budget===p.budget:p.state==='1'&&p.sequence==='0'&&p.available===p.budget&&p.reserved==='0'&&p.charged==='0'&&p.refunded==='0');
    next.bok.set(p.request_id,{requestId:p.request_id,state:p.state,sequence:p.sequence,budget:p.budget,available:p.available,reserved:p.reserved,charged:p.charged,refunded:p.refunded,position:copy(e.position)});
   } else if(e.type==='ModeratorTransferred'){
    // Keep the authenticated event/cursor without changing content or policy.
    // Authorization always reads current canonical contract storage.
   } else if(e.type==='MainPolicyPublished'){check(BigInt(p.version)===BigInt(next.version)+1n);next.policies.set(p.version,{...p,text:text(p,'rules','length')});next.version=p.version;}
   else if(e.type==='NameRegistered'){check(!next.names.has(p.name_id));next.names.set(p.name_id,{id:p.name_id,first:text(p,'first','first_length'),last:text(p,'last','last_length'),profile:emptyProfile()});}
   else if(e.type==='BioPublished'||e.type==='AvatarPublished'){
    const name=next.names.get(p.name_id);check(name);const part=e.type==='BioPublished'?'bio':'avatar';
    check(BigInt(p.version)===BigInt(name.profile[part].version)+1n);
    const value=part==='bio'?{version:p.version,digest:p.digest,length:p.length,text:text(p,'content','length')}:{version:p.version,digest:p.digest,width:p.width,height:p.height,length:p.length,encoding:'base64',data:binaryBase64(p.data,p.length),removal:null};
    next.names.set(p.name_id,{...name,profile:{...name.profile,[part]:value}});
   }
   else if(e.type==='AvatarRemoved'){
    const name=next.names.get(p.name_id),avatar=name?.profile.avatar;
    check(avatar&&avatar.length!=='0'&&avatar.version===p.avatar_version&&avatar.digest===p.avatar_digest&&p.main_policy_version===next.version&&!avatar.removal);
    const removal={avatarVersion:p.avatar_version,avatarDigest:p.avatar_digest,mainPolicyVersion:p.main_policy_version,reasonDigest:p.reason_digest,reason:text(p,'reason','length'),position:e.position};
    next.names.set(p.name_id,{...name,profile:{...name.profile,avatar:{...avatar,removal}}});
   }
   else if(e.type==='SubboardCreated'){check(!next.boards.has(p.subboard_id)&&p.main_policy_version===next.version);next.boards.set(p.subboard_id,{id:p.subboard_id,slug:text(p,'slug','slug_length'),name:text(p,'name','name_length'),description:text(p,'description','description_length'),rules:text(p,'rules','rules_length'),creationVersion:p.main_policy_version,rejected:false,rejection:null});}
   else if(e.type==='SubboardRejected'){const board=next.boards.get(p.subboard_id);check(board&&!board.rejected&&p.main_policy_version===next.version);next.boards.set(p.subboard_id,{...board,rejected:true,rejection:{reason:text(p,'reason','reason_length'),mainVersion:p.main_policy_version,position:e.position}});}
   else if(e.type==='PluginConfigured'){const old=next.plugins.get(p.plugin_id);check(!old||old.adapter===p.adapter);next.plugins.set(p.plugin_id,{...p});}
   else if(e.type==='PostPublished'){
    const r=p.record,parent=next.posts.get(r.parent),reference=next.posts.get(r.reference),board=next.boards.get(r.subboard);
    check(!next.posts.has(p.id)&&p.main_policy_version===next.version&&next.policies.has(next.version));
    check(r.subboard==='0'||board&&!board.rejected);check(p.local_policy_version===(r.subboard==='0'?'0':'1'));
    check(r.name_id==='0'||next.names.has(r.name_id));
    if(r.parent!=='0')check(parent&&!parent.removal&&parent.record.root===r.root&&parent.record.subboard===r.subboard);
    if(r.reference!=='0')check(reference&&!reference.removal);
    next.posts.set(p.id,{id:p.id,record:copy(r),text:text(p,'message','length'),timestamp:p.timestamp,mainVersion:p.main_policy_version,localVersion:p.local_policy_version,position:e.position,order:next.postCount,likes:'0',removal:null,invocation:null,bot:null});next.postCount=String(BigInt(next.postCount)+1n);
    if(r.kind==='4')awaiting.add(p.id);
   } else if(e.type==='PostRemoved'){
    const post=next.posts.get(p.id);check(post&&!post.removal);const local=post.record.subboard==='0'?0n:1n;
    check(BigInt(p.policy_version)===BigInt(next.version)+(local<<32n));
    putPost(p.id,{removal:{reason:text(p,'reason','reason_length'),policy:p.policy_version,penalized:p.penalized,position:e.position}});
   } else if(e.type==='PluginInvoked'){
    const post=next.posts.get(p.post_id),plugin=next.plugins.get(p.plugin_id);check(post&&post.record.kind!=='4'&&!post.invocation&&plugin?.enabled&&sameTx(post,e));
    const key=plugin.adapter+':'+p.request_id;check(!next.requests.has(key));
    const invocation={pluginId:p.plugin_id,adapter:plugin.adapter,requestId:p.request_id,target:p.target,parent:p.post_id,reply:null};
    next.requests.set(key,invocation);putPost(p.post_id,{invocation});
   } else if(e.type==='PluginReplyPublished'){
    const plugin=next.plugins.get(p.plugin_id),post=next.posts.get(p.post_id);check(plugin?.enabled&&post&&awaiting.has(p.post_id)&&sameTx(post,e));
    const key=plugin.adapter+':'+p.request_id,request=next.requests.get(key),parent=next.posts.get(p.parent_id);
    check(request&&request.pluginId===p.plugin_id&&request.parent===p.parent_id&&request.target===p.target&&!request.reply&&parent&&!parent.removal&&post.record.parent===p.parent_id&&post.record.root===parent.record.root&&post.record.subboard===parent.record.subboard);
    const updated={...request,reply:p.post_id};next.requests.set(key,updated);putPost(p.parent_id,{invocation:updated});putPost(p.post_id,{bot:{pluginId:p.plugin_id,requestId:p.request_id,target:p.target,parent:p.parent_id}});awaiting.delete(p.post_id);
   } else if(e.type==='LikeChanged'){
    const post=next.posts.get(p.post);check(post);const key=p.post+':'+p.tag,was=next.likes.get(key)??false;check(was!==p.active&&(!p.active||!post.removal));
    check(BigInt(p.count)===BigInt(post.likes)+(p.active?1n:-1n));next.likes.set(key,p.active);putPost(p.post,{likes:p.count});
   } else throw rollingError();
  }
  // Cache ranges must include whole transactions; never display an unauthenticated
  // kind-4 post while waiting for a later fragment with its linkage event.
  check(awaiting.size===0);
 return {scalars:Object.fromEntries(['version','last','scope','eventCount','postCount'].map(key=>[key,next[key]])),changes:[...changes.values()]};
}
// stage changes nothing; apply and reverse-order undo are single-use and reject
// stale candidates. Ordinary views omit like tags; likeTags returns public tags for local matching.
export function createRollingProjection({isValidatedEvent,maxEvents=50000,homeSubboards}={}) {
 check(typeof isValidatedEvent==='function'&&Number.isSafeInteger(maxEvents)&&maxEvents>0&&maxEvents<=1000000);
 const curated=new Set(['0',...normalizeHomeSubboards(homeSubboards)]);
 let state={posts:new Map(),names:new Map(),boards:new Map(),policies:new Map(),plugins:new Map(),requests:new Map(),likes:new Map(),bok:new Map(),order:[],version:'0',last:null,scope:null,eventCount:0},revision=0,tip=Symbol('initial');
 function stage(events){
  check(Array.isArray(events)&&events.length<=10000&&state.eventCount+events.length<=maxEvents);
  const expectedRevision=revision,baseTip=tip,ownTip=Symbol('range'),oldLength=state.order.length,appended=[];
  // Retain only touched values. Never retain a cloned Map or full order array
  // per checkpoint: the cache keeps these undo closures for its whole suffix.
  const scalarKeys=['version','last','scope','eventCount'];
  const beforeScalars=Object.fromEntries(scalarKeys.map(key=>[key,state[key]]));
  const reduction=stageRollingPublicReduction(events,{isValidatedEvent,read:(table,key)=>state[table].get(key),
   scalars:{...beforeScalars,eventCount:String(state.eventCount),postCount:String(oldLength)}});
  for(const change of reduction.changes)if(change.table==='posts'&&!change.existed)appended.push(change.key);
  const next={...reduction.scalars,eventCount:Number(reduction.scalars.eventCount)};
  const deltas=reduction.changes.map(change=>({apply(){state[change.table].set(change.key,change.value);},
   undo(){if(change.existed)state[change.table].set(change.key,change.before);else state[change.table].delete(change.key);}}));
  let applied=false,undone=false;
  const afterScalars=Object.fromEntries(scalarKeys.map(key=>[key,next[key]]));
  return {apply(){
    check(!applied&&!undone&&revision===expectedRevision&&tip===baseTip);
    for(const delta of deltas)delta.apply();state.order.push(...appended);Object.assign(state,afterScalars);
    tip=ownTip;revision++;applied=true;
   },undo(){
    check(applied&&!undone&&tip===ownTip);
    for(const delta of deltas)delta.undo();state.order.length=oldLength;Object.assign(state,beforeScalars);
    tip=baseTip;revision++;undone=true;
   }};
 }
 // Preserve immutable event bytes/history internally, redact only every public
 // identity accessor. Replacement versions carry no applicable removal.
 const publicIdentity=name=>{const value=copy(name);if(value.profile.avatar.removal)value.profile.avatar.data=null;return value;};
 const visible=post=>{const p=copy(post),board=state.boards.get(p.record.subboard);if(p.removal||board?.rejected)p.text=null;return p;};
 function select(ids,{limit=50,cursor=null}={}){
  check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100);let offset=0;
  if(cursor!==null){check(typeof cursor==='string'&&/^[0-9]+:[0-9]+$/.test(cursor));const [r,n]=cursor.split(':').map(Number);check(r===revision&&Number.isSafeInteger(n)&&n<=ids.length);offset=n;}
  const selected=ids.slice(offset,offset+limit),next=offset+selected.length;
  return {posts:selected.map(id=>visible(state.posts.get(id))),nextCursor:next<ids.length?`${revision}:${next}`:null,revision};
 }
 return {stage,get postCount(){return state.order.length;},
  page(limit=50,upper=null,before=null){check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100);const bound=v=>{check(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v));return BigInt(v);};
   let ids=[...state.order].reverse().filter(id=>(upper===null||BigInt(state.posts.get(id).order)<=bound(upper))&&(before===null||BigInt(state.posts.get(id).order)<bound(before)));
   const posts=ids.slice(0,limit).map(id=>visible(state.posts.get(id))),needed=new Set([state.version,...posts.map(p=>p.mainVersion),...posts.filter(p=>p.removal).map(p=>String(BigInt(p.removal.policy)&0xffffffffn))]);return {posts,policies:[...needed].filter(v=>state.policies.has(v)).map(v=>copy(state.policies.get(v))),hasMore:ids.length>limit};},
  likeTags(posts,{limit=50,cursor=null}={}){
   const postIds=normalizeLikePosts(posts),selected=new Set(postIds);
   check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100);let offset=0;
   if(cursor!==null){check(typeof cursor==='string'&&/^[0-9]+:[0-9]+$/.test(cursor));const [r,n]=cursor.split(':').map(Number);check(r===revision&&Number.isSafeInteger(n));offset=n;}
   const entries=[...state.likes].filter(([key,active])=>active&&selected.has(key.split(':')[0])).map(([key])=>{const [post,tag]=key.split(':');return {post,tag};}).sort((a,b)=>a.post!==b.post?(BigInt(a.post)<BigInt(b.post)?-1:1):BigInt(a.tag)<BigInt(b.tag)?-1:1);
   check(offset<=entries.length);const items=entries.slice(offset,offset+limit),next=offset+items.length;
   return {postIds,items,nextCursor:next<entries.length?`${revision}:${next}`:null,revision};
  },
  feed:options=>select([...state.order].reverse(),options),
  boardFeed(id,{limit=50,cursor=null}={}){
   check(id==='0'||state.boards.has(id));
   if(cursor!==null){check(typeof cursor==='string'&&cursor.startsWith(id+':'));cursor=cursor.slice(id.length+1);}
   // Select the complete board history before paging; rejected boards retain
   // navigable tombstones through the same visible() redaction as every view.
   const page=select([...state.order].reverse().filter(key=>state.posts.get(key).record.subboard===id),{limit,cursor});
   if(page.nextCursor)page.nextCursor=id+':'+page.nextCursor;
   const board=state.boards.get(id),needed=new Set([state.version,...page.posts.map(p=>p.mainVersion),...page.posts.filter(p=>p.removal).map(p=>String(BigInt(p.removal.policy)&0xffffffffn))]);
   if(board?.rejection)needed.add(board.rejection.mainVersion);
   const policies=[...needed].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0).map(version=>{
    const policy=state.policies.get(version);check(policy);return {version,digest:policy.digest,text:policy.text};
   });
   return {...page,boardId:id,board:board?{...copy(board),mainVersion:state.version,mainRules:state.policies.get(state.version)?.text}:null,
    mainPolicy:copy(policies.find(p=>p.version===state.version)),policies};
  },
  // Reversible ranking default: prefer community likes, then recent canonical
  // timestamps, then numeric post ID ascending for stable ties. Filter and rank
  // the complete bounded history BEFORE paging. No creation-based promotion.
  home:options=>select(state.order.filter(id=>{const p=state.posts.get(id);return curated.has(p.record.subboard)&&!state.boards.get(p.record.subboard)?.rejected;}).sort((a,b)=>{
   const x=state.posts.get(a),y=state.posts.get(b);
   for(const key of ['likes','timestamp']){const left=BigInt(x[key]),right=BigInt(y[key]);if(left!==right)return left>right?-1:1;}
   return BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
  }),options),
  thread(root,options){check(state.posts.get(root)?.record.root===root);return select(state.order.filter(id=>state.posts.get(id).record.root===root),options);},
  profile(nameId,options){check(state.names.has(nameId));return {...select([...state.order].reverse().filter(id=>state.posts.get(id).record.name_id===nameId),options),identity:publicIdentity(state.names.get(nameId))};},
  directory({query='',limit=50,cursor=null}={}){check(typeof query==='string'&&query.length<=120&&Number.isSafeInteger(limit)&&limit>=1&&limit<=100);const q=query.trim().toLowerCase(),boards=[...state.boards.values()].filter(b=>[b.slug,b.name,b.description].some(v=>v.toLowerCase().includes(q))).sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
   let start=0;if(cursor!==null){check(typeof cursor==='string'&&/^[0-9]+:[0-9]+$/.test(cursor));const [r,n]=cursor.split(':').map(Number);check(r===revision&&Number.isSafeInteger(n)&&n<=boards.length);start=n;}
   return {boards:boards.slice(start,start+limit).map(b=>({...copy(b),mainVersion:state.version,mainRules:state.policies.get(state.version)?.text})),nextCursor:start+limit<boards.length?`${revision}:${start+limit}`:null,revision};},
  post(id){const p=state.posts.get(id);return p?visible(p):null;},
  identity(id){const name=state.names.get(id);return name?publicIdentity(name):null;},
  board(id){const board=state.boards.get(id);return board?{...copy(board),mainVersion:state.version,mainRules:state.policies.get(state.version)?.text}:null;},
 };
}
