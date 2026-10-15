import {createPublicReader} from './reader-client.mjs';
import {createPublicAvatar,createPublicProfile} from './profile-view.mjs';
import {safeURL} from './model.mjs';
import {captureRoutePosition,focusRoute,skipToContent} from './navigation.mjs';

const read=createPublicReader(),app=document.querySelector('#app'),positions=new Map();
let controller,sequence=0,route=location.hash.slice(1)||'/home',main,loadedPages=1;
let walletPanel,privatePanel;
const privateViews=new Set(['following','bookmarks','notifications']);
function privateChanged(){
 for(const node of app.querySelectorAll('[data-moderator-action]'))showModeratorButton(node);
 if(privateViews.has(route.split('/')[1])){controller?.abort();main?.replaceChildren();void render();}
 else for(const node of app.querySelectorAll('[data-private-setting]'))node.textContent=preferenceLabel(node.dataset.privateSetting,Number(node.dataset.kind),node.dataset.target);
}
async function openWallet(defaults={}){
 try{
  walletPanel??=import('./wallet-panel.mjs').then(({mountRollingWalletPanel})=>mountRollingWalletPanel({
   loadRuntime:async()=>{const runtime=await import('/wallet/runtime.mjs');return runtime.loadRollingWalletRuntime();},onPublicEffect:()=>render(),onPrivateChange:privateChanged})).then(panel=>(privatePanel=panel));
  (await walletPanel).open(defaults);
 }catch{announce('Account tools could not load. Reload the page before trying again.');}
}
const narrow=matchMedia('(max-width:700px)');
const el=(tag,attrs={},...children)=>{
 const node=document.createElement(tag);for(const [key,value]of Object.entries(attrs)){
  if(key.startsWith('on'))node.addEventListener(key.slice(2).toLowerCase(),value);
  else if(value!==null&&value!==undefined)node.setAttribute(key,String(value));
 }
 for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)node.append(child instanceof Node?child:document.createTextNode(String(child)));
 return node;
};
const link=(label,to,attrs={})=>el('a',{href:'#'+to,...attrs},label);
const button=(label,action,attrs={})=>el('button',{type:'button',class:'button',onClick:action,...attrs},label);
const text=value=>typeof value==='string'?value:'';
const field=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,76})$/.test(value);
const announce=message=>{document.querySelector('#announcement').textContent=message;};
function richText(value){
 const node=el('div',{class:'post-body'}),source=text(value),pattern=/\[([^\]]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s]+)/g;let end=0;
 for(const match of source.matchAll(pattern)){
  node.append(document.createTextNode(source.slice(end,match.index)));const url=safeURL(match[2]||match[3]);
  node.append(url?el('a',{href:url,target:'_blank',rel:'noopener noreferrer'},match[1]||match[3]):document.createTextNode(match[0]));end=match.index+match[0].length;
 }node.append(document.createTextNode(source.slice(end)));return node;
}
// Policy fields are authenticated by the public index. Display their distinct
// provenance; never substitute today's rules for the versions used by a post.
const policyVersion=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(value)&&BigInt(value)<=0xffffffffn;
function policyLabel(label,mainVersion,localVersion){
 if(!policyVersion(mainVersion)||!policyVersion(localVersion))return null;
 return el('p',{class:'quiet'},`${label}: parent v${mainVersion} · local v${localVersion}`);
}
function removalPolicy(value){
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>0xffffffffffffffffn)return null;
 const packed=BigInt(value);return policyLabel('Removal policy',String(packed&0xffffffffn),String(packed>>32n));
}
function preferenceLabel(label,kind,target){return privatePanel?.preferenceEnabled?.(kind,target)===true?({'Bookmark':'Unbookmark','Follow board':'Unfollow board','Follow name':'Unfollow name','Subscribe to thread':'Unsubscribe from thread'}[label]??'Remove '+label):label;}
function preferenceButton(label,kind,target){
 return button(preferenceLabel(label,kind,target),()=>openWallet({type:'preference',kind,target,enabled:privatePanel?.preferenceEnabled?.(kind,target)!==true}),{'data-private-setting':label,'data-kind':kind,'data-target':target});
}
function showModeratorButton(node){node.hidden=privatePanel?.moderatorAuthorized?.()!==true;node.style.display=node.hidden?'none':'';}
function moderatorButton(label,defaults){
 const node=button(label,()=>{if(privatePanel?.moderatorAuthorized?.()===true)void openWallet(defaults);},{'data-moderator-action':''});
 showModeratorButton(node);return node;
}
function postCard(post,data){
 if(!post||!field(post.id)||!post.record||!field(post.record.root))throw Error('Invalid public post');
 const r=post.record,isBot=Boolean(post.bot),named=!isBot&&r.name_id!=='0'?data.names?.[r.name_id]:null,board=data.board?.id===r.subboard?data.board:data.boards?.[r.subboard];
 const author=isBot?'Bok':r.name_id==='0'?'Anonymous':named?`${text(named.first)} ${text(named.last)}`:'Registered name';
 const article=el('article',{class:'post',id:'post-'+post.id,'aria-label':'Post by '+author});
 const who=isBot||r.name_id==='0'?el('span',{class:'author'},author):link(author,'/profile/'+r.name_id,{class:'author'});
 article.append(el('div',{class:'post-top'},named?createPublicAvatar(named,{signal:controller.signal}):el('span',{class:'avatar '+(isBot?'bot':'anonymous'),'aria-hidden':'true'},isBot?'B':'◌'),el('div',{},who,isBot?el('span',{class:'bot-badge'},'Authenticated bot'):null,el('div',{class:'post-context'},field(r.subboard)?link(r.subboard==='0'?'Main board':board?text(board.name):'Subboard','/board/'+r.subboard):'Board unavailable',' · ',timestamp(post.timestamp)))));
 const authoredPolicy=policyLabel('Published under policy',post.mainVersion,post.localVersion);if(authoredPolicy)article.append(authoredPolicy);
 if(Array.isArray(data.policies)){const policy=data.policies.find(p=>p.version===post.mainVersion);if(policy&&policyVersion(policy.version))article.append(el('details',{},el('summary',{},'Parent rules at publication · v'+policy.version),richText(policy.text)));}
 if(field(r.parent)&&r.parent!=='0')article.append(el('p',{class:'reply-line'},'In reply to ',link('an earlier post','/thread/'+r.root+'/'+r.parent)));
 if(field(r.reference)&&r.reference!=='0')article.append(el('p',{class:'reply-line'},r.kind==='3'?'Reposted from ':'Quoted from ',link('the original post','/post/'+r.reference)));
 const unlike=()=>button('Unlike',()=>openWallet({type:'unlike',post:post.id}));
 // Moderation removes content, not the ability to manage private notifications.
 const threadControls=()=>[preferenceButton('Subscribe to thread',4,r.root),
  typeof post.position?.blockNumber==='string'&&/^(0|[1-9][0-9]{0,9})$/.test(post.position.blockNumber)&&BigInt(post.position.blockNumber)<=0xffffffffn?button('Mark thread read',()=>openWallet({type:'read-marker',thread:r.root,throughBlock:String(post.position.blockNumber)})):null];
 if(post.text===null||post.removal||board?.rejected===true){
  article.append(el('p',{class:'removed'},'This post is unavailable under the board’s moderation policy.'));
  // A rejected subboard also redacts posts without an individual removal event.
  if(post.removal){
   if(text(post.removal.reason))article.append(el('p',{class:'removed'},'Removal reason: '+text(post.removal.reason)));
   const policy=removalPolicy(post.removal.policy);if(policy)article.append(policy);
  }
  if(board?.rejected){
   if(text(board.rejection?.reason))article.append(el('p',{class:'removed'},'Subboard rejection reason: '+text(board.rejection.reason)));
   if(policyVersion(board.rejection?.mainVersion))article.append(el('p',{class:'quiet'},'Subboard rejected under parent policy v'+board.rejection.mainVersion));
  }
  article.append(el('div',{class:'post-actions'},link('View thread','/thread/'+r.root),unlike(),preferenceButton('Bookmark',1,post.id),threadControls()));return article;
 }
 article.append(richText(post.text),el('div',{class:'post-actions'},link('View conversation','/thread/'+r.root,{class:'post-link'}),el('span',{class:'action'},`${text(post.likes)} ${post.likes==='1'?'like':'likes'}`),
  button('Reply',()=>openWallet({type:'reply',parent:post.id,root:r.root,subboard:r.subboard})),
  button('Like',()=>openWallet({type:'like',post:post.id})),unlike(),button('Quote',()=>openWallet({type:'quote',reference:post.id,subboard:r.subboard})),
  button('Repost',()=>openWallet({type:'repost',reference:post.id,subboard:r.subboard})),preferenceButton('Bookmark',1,post.id),threadControls()));
 article.append(moderatorButton('Remove this post',{type:'moderate-post',post:post.id}));
 return article;
}
function timestamp(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)return '';const date=new Date(n*1000);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'';}
function shell(title,{boardId=null}={}){
 document.title=title+' · Rolling Chat';
 const rail=el('aside',{class:'rail',id:'community-navigation'},link('◉ rolling.chat','/home',{class:'brand'}),el('nav',{class:'nav-group','aria-label':'Community'},link('Home','/home'),link('Main board','/board/0'),link('Explore subboards','/directory'),link('Following','/following'),link('Bookmarks','/bookmarks'),link('Notifications','/notifications')),el('p',{class:'rail-foot'},'Public conversations. Private participation.'));
 for(const entry of rail.querySelectorAll('nav a'))if(entry.hash.slice(1)===route||entry.hash==='#/directory'&&route.startsWith('/directory/')){entry.setAttribute('aria-current','page');entry.classList.add('active');}
 const closeMenu=()=>{rail.classList.remove('open');rail.inert=narrow.matches;document.querySelector('.workspace').inert=false;menu.setAttribute('aria-expanded','false');menu.focus();};
 const menu=button('☰',()=>{rail.inert=false;rail.classList.add('open');document.querySelector('.workspace').inert=true;menu.setAttribute('aria-expanded','true');rail.querySelector('a').focus();},{class:'menu-toggle','aria-label':'Open navigation','aria-expanded':'false','aria-controls':'community-navigation'});
 rail.append(button('×',closeMenu,{class:'mobile-close','aria-label':'Close navigation'}));rail.inert=narrow.matches;
 rail.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();if(event.key==='Tab'&&rail.classList.contains('open')){const targets=[...rail.querySelectorAll('a,button')],first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
 main=el('main',{id:'content',tabindex:'-1'},el('header',{class:'page-head'},el('div',{},el('h1',{tabindex:'-1'},title),el('p',{class:'intro'},'Read the conversation without connecting an account.'))));
 const context=el('aside',{class:'context'},el('section',{},el('h2',{},'Join the conversation'),el('p',{},'Posts and reactions are recorded onchain. Named identities and authenticated Bok replies are shown with their conversations.'),
  button('Write a post',()=>openWallet({type:'post',...(boardId!==null?{subboard:boardId}:{})}),boardId!==null?{'data-board-compose':'',disabled:''}:{}),button('Register a name',()=>openWallet({type:'name'})),button('Create a subboard',()=>openWallet({type:'subboard'}))));
 app.replaceChildren(el('div',{class:'shell'},rail,el('div',{class:'workspace'},el('header',{class:'topbar'},menu,el('p',{},'rolling.chat'),link('Explore subboards','/directory',{class:'search-link'}),button('Your account',()=>openWallet())),el('div',{class:'layout'},main,context))));
 return main;
}
function boardCard(board){
 const rules=el('details',{},el('summary',{},'Effective rules'),el('h3',{},'Parent rules'),policyVersion(board.mainVersion)?el('p',{class:'quiet'},'Current parent policy v'+board.mainVersion):null,richText(board.mainRules),el('h3',{},'Local rules'),richText(board.rules));
 return el('article',{class:'post'},el('h2',{},field(board.id)?link(text(board.name),'/board/'+board.id):text(board.name)),el('p',{class:'quiet'},'/'+text(board.slug)),el('p',{},text(board.description)),board.rejected?el('p',{class:'removed'},'Rejected by the main board: '+text(board.rejection?.reason)):null,board.rejected&&policyVersion(board.rejection?.mainVersion)?el('p',{class:'quiet'},'Subboard rejected under parent policy v'+board.rejection.mainVersion):null,rules,board.rejected?null:moderatorButton('Reject this subboard',{type:'reject-subboard',subboard:board.id}));
}
function boardOverview(data){
 const section=el('section',{'aria-label':'Board information'}),board=data.board,policy=data.mainPolicy;
 if(board){
  section.append(el('p',{class:'quiet'},'/'+text(board.slug)),el('p',{},text(board.description)));
  if(policyVersion(board.creationVersion))section.append(el('p',{class:'quiet'},'Created under parent policy v'+board.creationVersion));
  if(board.rejected)section.append(el('p',{class:'removed',role:'status'},'This subboard is rejected. New posts are disabled. Existing thread links and unlike remain available.'),el('p',{class:'removed'},'Rejection reason: '+text(board.rejection?.reason)));
 }
 const rules=el('details',{},el('summary',{},'Effective board rules'),el('h2',{},'Current parent rules · v'+policy.version),richText(policy.text));
 if(board)rules.append(el('h2',{},'Immutable local rules'),richText(board.rules),el('p',{class:'quiet'},'Both current parent rules and local rules apply.'));
 else rules.append(el('p',{class:'quiet'},'The main board follows these parent rules.'));
 section.append(rules);
 if(!board)section.append(moderatorButton('Update parent rules',{type:'set-main-policy'}));
 else if(!board.rejected)section.append(moderatorButton('Reject this subboard',{type:'reject-subboard',subboard:board.id}));
 if(board?.rejection&&policyVersion(board.rejection.mainVersion)){
  const applied=data.policies.find(p=>p.version===board.rejection.mainVersion);
  if(applied)section.append(el('details',{},el('summary',{},'Parent rules at rejection · v'+applied.version),richText(applied.text)));
 }
 return section;
}
async function render(){
 controller?.abort();controller=new AbortController();const signal=controller.signal,current=++sequence;
 // Back navigation reloads the same number of pages against the current index.
 // The whole restoration has one deadline, rather than an unbounded request chain.
 const restoreSignal=AbortSignal.any([signal,AbortSignal.timeout(20000)]),saved=positions.get(route);loadedPages=1;
 const parts=route.split('/').filter(Boolean);let api='home',parameters={limit:30},title='Home',expectedRoot,privateView=null;
 if(privateViews.has(parts[0])&&parts.length===1){privateView=parts[0];api='feed';title=privateView[0].toUpperCase()+privateView.slice(1);}
 else if(parts[0]==='directory'){api='directory';title='Explore subboards';try{parameters.query=parts[1]?decodeURIComponent(parts[1]):'';}catch{shell('Page not found');return;}}
 else if(parts[0]==='board'){if(parts.length!==2||!field(parts[1])){shell('Page not found',{boardId:''});return;}api='board';parameters={id:parts[1],limit:30};title=parts[1]==='0'?'Main board':'Subboard';}
 else if(['thread','profile','post'].includes(parts[0])){if(!field(parts[1])||parts[2]&&!field(parts[2])){shell('Page not found');return;}api=parts[0];parameters=api==='post'?{id:parts[1]}:{limit:30,[api==='thread'?'root':'nameId']:parts[1]};title=api==='thread'?'Conversation':api==='profile'?'Profile':'Post';
  if(api==='thread'&&parts[2]){expectedRoot=parts[1];api='post';parameters={id:parts[2]};title='Linked post';}
 }
 else if(parts[0]!=='home'){shell('Page not found');return;}
 shell(title,{boardId:api==='board'?parameters.id:null});
 if(privateView){
  main.querySelector('.intro').textContent='This view is filtered on your device. Your saved choices are encrypted for recovery. The configured trusted prover and its query service can see private data used to recover or prove your activity.';
  main.append(button('Manage private views',()=>openWallet({view:'preferences'})));
  if(privatePanel?.privateStatus?.()!=='complete'){main.append(el('div',{class:'empty'},el('h2',{},'Unlock and recover your private views'),el('p',{},'Recover your saved choices to see this view. Your follows and bookmarks stay private.'),button('Open private recovery',()=>openWallet({view:'preferences'}))));return;}
 }
 const loading=el('p',{role:'status','aria-busy':'true'},'Loading conversations…');main.append(loading);
 if(api==='directory'){
  const input=el('input',{type:'search',value:parameters.query,placeholder:'Search names, descriptions or slugs','aria-label':'Search subboards',maxlength:120});
  const form=el('form',{class:'directory-search',onSubmit:event=>{event.preventDefault();location.hash='/directory/'+encodeURIComponent(input.value.trim());}},input,el('button',{class:'button',type:'submit'},'Search'));main.insertBefore(form,loading);
 }
 const container=el('section',{class:'feed','aria-label':title});let data;
 const seenIds=new Set(),seenCursors=new Set();let lastPosition=null,lastPositionHash=null;
 const position=p=>['blockNumber','txIndexWithinBlock','logIndexWithinTx'].map(key=>{const v=p?.position?.[key];if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v))throw Error('Invalid position');return BigInt(v);});
 const descending=(a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;};
 function append(response){
  if(typeof response.revision!=='string'||response.revision!==data.revision||response.scope.boardAddress!==data.scope.boardAddress||
   response.checkpoint?.number!==data.checkpoint?.number||response.checkpoint?.hash!==data.checkpoint?.hash)throw Error('Changed public snapshot');
  const items=api==='directory'?response.boards:api==='post'?(response.post?[response.post]:[]):response.posts;
  if(!Array.isArray(items))throw Error('Invalid public page');
  if(api==='board'){
   if(response.boardId!==parameters.id||(parameters.id==='0'?response.board!==null:response.board?.id!==parameters.id)||items.some(p=>p.record?.subboard!==parameters.id)||
    !policyVersion(response.mainPolicy?.version)||typeof response.mainPolicy.text!=='string'||!Array.isArray(response.policies))throw Error('Invalid board page');
  }
  const next=response.nextCursor;
  if(next!==null&&next!==undefined&&(typeof next!=='string'||!next.length||next.length>4096||seenCursors.has(next)||!items.length&&api!=='directory'))throw Error('Invalid next cursor');
  const ids=new Set();for(const item of items){if(!field(item?.id)||seenIds.has(item.id)||ids.has(item.id))throw Error('Duplicate public item');ids.add(item.id);}
  // Validate/build the whole page before changing visible content or paging state.
  let visible=items,nextPosition=lastPosition,nextPositionHash=lastPositionHash;
  if(privateView){
   // Inspect all rows before filtering, including cross-page order and duplicates.
   for(const item of items){const at=position(item);if(nextPosition&&(!descending(nextPosition,at)||nextPosition[0]===at[0]&&nextPositionHash!==item.position.blockHash))throw Error('Public order changed');nextPosition=at;nextPositionHash=item.position.blockHash;}
   visible=privatePanel.filterPrivatePage(privateView,response).posts;
  }
  const nodes=visible.map(item=>api==='directory'?boardCard(item):postCard(item,response));
  if(nodes.length)container.querySelector('.empty')?.remove();lastPosition=nextPosition;lastPositionHash=nextPositionHash;
  container.append(...nodes);for(const id of ids)seenIds.add(id);if(next)seenCursors.add(next);return nodes;
 }

 try{
  data=await read(api,parameters,restoreSignal);if(current!==sequence)return;
  if(expectedRoot&&(!data.post||data.post.record?.root!==expectedRoot))throw Error('Linked post does not belong to this conversation');
  append(data);
  let cursor=data.nextCursor;
  while(api!=='directory'&&cursor&&(loadedPages<(saved?.pages??1)||saved?.anchor&&!seenIds.has(saved.anchor.id.slice(5)))){
   const page=await read(api,{...parameters,cursor},restoreSignal);if(current!==sequence)return;append(page);cursor=page.nextCursor;loadedPages++;
  }
  loading.remove();
  if(api==='board'){
   main.querySelector('h1').textContent=data.board?text(data.board.name):'Main board';container.setAttribute('aria-label','Posts in '+(data.board?text(data.board.name):'Main board'));main.append(boardOverview(data),preferenceButton('Follow board',2,parameters.id));
   const compose=document.querySelector('[data-board-compose]');if(compose)compose.disabled=Boolean(data.board?.rejected);
  }
  if(api==='profile'&&data.identity){main.querySelector('h1').textContent=text(data.identity.first)+' '+text(data.identity.last);main.append(createPublicProfile(data.identity,{signal}),preferenceButton('Follow name',3,parameters.nameId),moderatorButton('Remove this avatar',{type:'moderate-avatar',name:parameters.nameId}));}
  document.title=main.querySelector('h1').textContent+' · Rolling Chat';
  if(!container.childElementCount)container.append(el('div',{class:'empty'},el('h2',{},'A little quiet here'),el('p',{},api==='directory'?(cursor?'No matches in this page. Continue searching.':'No subboards match this search.'):'No posts to show yet.')));
  main.append(container);
  if(expectedRoot)main.append(el('p',{},link('Read the conversation from the beginning','/thread/'+expectedRoot)));
  let observer,inFlight=false,stopped=false;
  const stop=()=>{stopped=true;observer?.disconnect();};
  signal.addEventListener('abort',stop,{once:true});
  const more=button('Load more',()=>void loadMore(true));
  async function loadMore(explicit=false){
   if(inFlight||stopped||signal.aborted||current!==sequence||!cursor)return;
   const ownedFocus=explicit&&document.activeElement===more;
   const focusResult=node=>{if(ownedFocus&&(document.activeElement===document.body||document.activeElement===more)){node.tabIndex=-1;node.focus({preventScroll:true});}};
   inFlight=true;more.disabled=true;more.setAttribute('aria-busy','true');observer?.unobserve(more);
   try{
    const page=await read(api,{...parameters,cursor},signal);
    if(signal.aborted||current!==sequence||stopped)return;
    const added=append(page);cursor=page.nextCursor;loadedPages++;
    if(api==='directory'&&container.querySelector('.empty'))container.querySelector('.empty p').textContent=cursor?'No matches in this page. Continue searching.':'No subboards match this search.';
    if(!cursor){stop();more.remove();}else more.disabled=false;
    if(added.length)focusResult(added[0]);
    else if(cursor){if(ownedFocus&&document.activeElement===document.body)more.focus({preventScroll:true});}
    else{const end=el('p',{role:'status'},api==='directory'?'No more subboards.':'No more conversations.');main.append(end);focusResult(end);}
    announce(api==='directory'?'Next search page checked.':'More conversations loaded.');
   }catch(error){
    if(signal.aborted||current!==sequence||stopped)return;
    stop();more.remove();const failed=el('p',{role:'alert'},'The conversation changed or could not load. ',button('Refresh',()=>render()));main.append(failed);focusResult(failed);
   }finally{
    inFlight=false;more.removeAttribute('aria-busy');
    if(!stopped&&!signal.aborted&&current===sequence&&cursor)observer?.observe(more);
   }
  }
  if(cursor)main.append(more);
  main.append(el('p',{class:'quiet'},'Checked against chain block '+String(data.checkpoint?.number??'')));
  focusRoute(route,positions.get(route),current===1);
  // One request owner serves both automatic and keyboard paging. Re-observation
  // after each page fills short viewports, but never creates parallel requests.
  if(api!=='directory'&&cursor&&typeof IntersectionObserver==='function'){
   observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.target===more&&entry.isIntersecting))void loadMore();},{rootMargin:'300px 0px',threshold:0});
   observer.observe(more);
  }

 }catch(error){if(signal.aborted)return;loading.remove();main.append(el('div',{class:'empty',role:'alert'},el('h2',{},error.code==='READER_SYNCING'?'Conversations are being checked':error.code==='READER_NOT_FOUND'?({board:'Board',profile:'Profile',post:'Post',thread:'Conversation'}[api]??'Page')+' not found':'Conversations could not load'),el('p',{},'No account or transaction has changed.'),button('Try again',()=>render())));focusRoute(route,positions.get(route),current===1);}
}
addEventListener('pagehide',()=>{sequence++;controller?.abort();});
addEventListener('pageshow',event=>{if(event.persisted)render();});
document.querySelector('.skip').addEventListener('click',skipToContent);
addEventListener('hashchange',()=>{positions.set(route,captureRoutePosition(loadedPages));if(positions.size>40)positions.delete(positions.keys().next().value);route=location.hash.slice(1)||'/home';render();});
narrow.addEventListener('change',()=>{const rail=document.querySelector('.rail'),workspace=document.querySelector('.workspace');if(rail){rail.classList.remove('open');rail.inert=narrow.matches;workspace.inert=false;document.querySelector('.menu-toggle')?.setAttribute('aria-expanded','false');}});
render();
