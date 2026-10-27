import {createReaderUpdates} from './reader-updates.mjs';
import {beginRollingMeasure} from './performance.mjs';
import {createPublicReader} from './reader-client.mjs';
import {createPublicAvatar,createPublicProfile} from './profile-view.mjs';
import {createMessageContent as richText,createInlineActionRegistry,savedPreferenceControl,savedReaderSelection,savedReaderRoute,createIcon,createBrand,createSkeletonFeed,createThreadView,boardTone,boardInitial} from './model.mjs';
import {captureRoutePosition,focusRoute,skipToContent,revealIncludedPost} from './navigation.mjs';

const read=createPublicReader(),app=document.querySelector('#app'),positions=new Map();
const currentRoute=()=>savedReaderRoute(location.hash==='#/new-account'?'/home':location.hash.slice(1)||'/home');
let controller,sequence=0,route=currentRoute(),main,renderedRoute,loadedPages=1,loadedThreadEnd=false,renderActive=0,activeThread=null;
// Collapse choices per conversation survive paging, live refresh and Back.
const threadStates=new Map();
function threadState(root){if(!threadStates.has(root)){if(threadStates.size>40)threadStates.delete(threadStates.keys().next().value);threadStates.set(root,{collapsed:new Set(),expanded:new Set()});}return threadStates.get(root);}
let walletPanel,privatePanel,savedItemsLoad,accountPreparation,savedItemsAttempted=false,savedItemsRevision=null;
async function preparePublicAssetCache(){
 if(!navigator.serviceWorker)return;
 try{
  const registration=await navigator.serviceWorker.register('/wallet-cache-worker.mjs',{scope:'/'});
  if(navigator.serviceWorker.controller)return;
  const worker=registration.active??registration.installing??registration.waiting;
  if(worker)await new Promise((resolve,reject)=>{
   const changed=()=>{if(worker.state==='activated'||worker.state==='redundant'){worker.removeEventListener('statechange',changed);worker.state==='activated'?resolve():reject(Error('Asset cache installation failed'));}};
   worker.addEventListener('statechange',changed);changed();
  });
 }catch{/* Public reading and account tools also work when browser storage is disabled. */}
}
function prepareAccountTools(){
 if(!accountPreparation){
  void preparePublicAssetCache();
  accountPreparation=import('/wallet/runtime.mjs').then(runtime=>runtime.loadRollingWalletRuntime());
 }
 return accountPreparation;
}
const privateViews=new Set(['following','bookmarks']);
function loadSavedItems(){
 return savedItemsLoad??=Promise.resolve().then(()=>privatePanel.loadSavedItems()).finally(()=>{savedItemsLoad=null;updatePreferenceControls();});
}
function hydrateSavedItems(){
 const status=privatePanel?.privateStatus?.();
 if(status==='locked'){savedItemsAttempted=false;return;}
 if(status!=='recovering'||savedItemsAttempted||typeof privatePanel?.loadSavedItems!=='function')return;
 savedItemsAttempted=true;void loadSavedItems().catch(()=>{});
}
function privateChanged(){
 hydrateSavedItems();
 for(const node of app.querySelectorAll('[data-moderator-action]'))showModeratorButton(node);
 const revision=JSON.stringify([privatePanel?.privateStatus?.(),privatePanel?.savedItemsSnapshot?.()??null]),changed=revision!==savedItemsRevision;savedItemsRevision=revision;
 if(changed&&privateViews.has(route.split('/')[1])){controller?.abort();main?.replaceChildren();void render();}
 else updatePreferenceControls();
 updateLikeControls();
}
async function accountPanel(){
 return walletPanel??=import('./wallet-panel.mjs').then(({mountRollingWalletPanel})=>mountRollingWalletPanel({
   loadRuntime:prepareAccountTools,onIncludedPostRendered:post=>{activeThread?.reveal(post?.id);return revealIncludedPost(post);},onPublicEffect:()=>!main?.querySelector('.public-content')||privateViews.has(route.split('/')[1])||route.split('/')[1]==='directory'?render({live:!!main?.querySelector('.public-content')}):updates.request(),onPrivateChange:privateChanged})).then(panel=>{privatePanel=panel;void Promise.resolve(panel.initialize()).then(privateChanged).catch(()=>{});return panel;});
}
// `extras` carries display-only hints (such as the post being answered); the action itself is `defaults`.
async function openWallet(defaults={},extras={}){
 try{
  (await accountPanel()).open(defaults,extras);
 }catch{walletPanel=null;const message='Account tools could not load. Check your connection and try again.';announce(message);main?.querySelector('[data-account-error]')?.remove();main?.prepend(el('div',{class:'notice error',role:'alert','data-account-error':''},message,button('Try again',()=>openWallet(defaults,extras))));}
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
function preferenceControl(label,kind,target){return savedPreferenceControl(label,privatePanel?.preferenceEnabled?.(kind,target),privatePanel?.privateStatus?.()??'locked',!!savedItemsLoad);}
// Action buttons keep their icon through every relabel; the text node stays the accessible name.
const labelled=(node,value)=>node.replaceChildren(...(node.dataset.icon?[createIcon(node.dataset.icon)]:[]),value);
function updatePreferenceControl(node,blocked=false){const state=preferenceControl(node.dataset.privateSetting,Number(node.dataset.kind),node.dataset.target);labelled(node,state.label);node.disabled=blocked||state.disabled;if(state.busy)node.setAttribute('aria-busy','true');else node.removeAttribute('aria-busy');}
function updatePreferenceControls(){for(const node of app.querySelectorAll('[data-private-setting]')){const retained=inlineActions.snapshot(node.dataset.inlineAction);if(retained)node.renderInlineAction(retained);else updatePreferenceControl(node);}}
const inlineActions=createInlineActionRegistry({perform:async(captured,onIncluded)=>{
 let panel;try{panel=await accountPanel();}catch{walletPanel=null;return {status:'failed',message:'Account tools could not load. Try again.'};}
 return panel.act(captured,{onIncluded});
},onState(key,snapshot){
 for(const node of app.querySelectorAll('[data-inline-action]'))if(node.dataset.inlineAction===key)node.renderInlineAction(snapshot,true);
}});
let currentLikeSnapshot=null;
function updateLikeControls(){
 const posts=[];
 for(const node of app.querySelectorAll('[data-like-post]')){
  posts.push(node.dataset.likePost);
  const retained=inlineActions.snapshot(node.dataset.inlineAction);if(retained){node.renderInlineAction(retained);continue;}
  const liked=privatePanel?.likeState?.(node.dataset.likePost)===true;
  node.disabled=liked;labelled(node,liked?'Liked':'Like');node.setAttribute('aria-pressed',String(liked));
 }
 privatePanel?.loadLikes?.([...new Set(posts)],currentLikeSnapshot);
}
function socialButton(label,action,attrs={}){
 let feedback;
 // The target identity excludes the toggle value: a rerender must not offer
 // its inverse while this exact target's previous operation still owns it.
 const target=action(),key=JSON.stringify([target.type,target.post??null,target.kind??null,target.target??null,target.thread??null]);
 const node=button(label,()=>{if(attrs['data-private-setting']&&typeof action().enabled!=='boolean'&&(privatePanel?.privateStatus?.()??'locked')==='locked'){void openWallet();return;}void inlineActions.run(key,action);},{...attrs,'data-inline-action':key});
 if(attrs['data-icon'])labelled(node,label);
 node.renderInlineAction=({state,captured,result},notify=false)=>{
  feedback?.remove();feedback=null;
  const knownLike=privatePanel?.likeState?.(captured.post);
  const liked=captured.type==='like'&&(knownLike===true||knownLike!==false&&['included','confirmed'].includes(state));
  node.disabled=liked||['pending','unknown'].includes(state)||state==='included'&&!result;
  if(state==='pending'){node.setAttribute('aria-busy','true');labelled(node,({like:'Liking…',unlike:'Removing like…'})[captured.type]??'Saving…');return;}
  if(state==='included'&&!result){node.setAttribute('aria-busy','true');labelled(node,'Confirmation pending');if(notify)announce('Change included. Confirmation pending.');return;}
  node.removeAttribute('aria-busy');
  if(attrs['data-private-setting'])updatePreferenceControl(node,node.disabled);else labelled(node,liked?'Liked':label);
  if(captured.type==='like')node.setAttribute('aria-pressed',String(liked));
  const message=state==='included'?'Saved. Confirmation pending.':state==='confirmed'?'Saved.':state==='unknown'?'Still waiting for confirmation.':state==='reverted'?'This change did not go through.':state==='failed'?(result.message||'This change could not be saved. Try again.'):state==='blocked'&&result.reason==='busy'?'Another action is still finishing.':'';
  if(message&&notify)announce(message);
  if(['unknown','reverted','failed'].includes(state)&&node.isConnected){
   feedback=el('span',{class:'inline-action-feedback',role:'status'},message);
   if(state==='unknown')feedback.append(' ',button('Check action',()=>openWallet()));
   node.after(feedback);
  }
 };
 if(target.type==='like'){node.dataset.likePost=target.post;if(privatePanel?.likeState?.(target.post)===true){node.disabled=true;labelled(node,'Liked');node.setAttribute('aria-pressed','true');}}
 const retained=inlineActions.snapshot(key);if(retained)node.renderInlineAction(retained);
 return node;
}
function preferenceButton(label,kind,target,savedLabel,icon){
 const node=socialButton(preferenceControl(label,kind,target).label,()=>({type:'preference',kind,target,enabled:preferenceControl(label,kind,target).enabled,...(savedLabel?{label:savedLabel}:{})}),{'data-private-setting':label,'data-kind':kind,'data-target':target,...(icon?{'data-icon':icon}:{})});
 if(!inlineActions.snapshot(node.dataset.inlineAction))updatePreferenceControl(node);return node;
}
function showModeratorButton(node){node.hidden=privatePanel?.moderatorAuthorized?.()!==true;node.style.display=node.hidden?'none':'';}
function moderatorButton(label,defaults){
 const node=button(label,()=>{if(privatePanel?.moderatorAuthorized?.()===true)void openWallet(defaults);},{'data-moderator-action':''});
 showModeratorButton(node);return node;
}
function postCard(post,data){
 if(!post||!field(post.id)||!post.record||!field(post.record.root))throw Error('Invalid public post');
 if(post.confirmation!==undefined&&!['pending','confirmed'].includes(post.confirmation)||data.confirmationCheckpoint&&post.confirmation===undefined)throw Error('Invalid post confirmation');
 const pending=post.confirmation==='pending';
 const afterConfirmation=node=>{if(pending&&node){node.disabled=true;node.title='Available after confirmation';}return node;};
 const r=post.record,isBot=Boolean(post.bot),named=!isBot&&r.name_id!=='0'?data.names?.[r.name_id]:null,board=data.board?.id===r.subboard?data.board:data.boards?.[r.subboard];
 const author=isBot?'Bok':r.name_id==='0'?'Anonymous':named?`${text(named.first)} ${text(named.last)}`:'Registered name';
 const article=el('article',{class:'post',id:'post-'+post.id,'data-tx-hash':post.position?.txHash,'data-block-number':post.position?.blockNumber,'data-block-hash':post.position?.blockHash,'aria-label':'Post by '+author,...(post.confirmation?{'data-confirmation':post.confirmation}:{})});
 const who=isBot||r.name_id==='0'?el('span',{class:'author'},author):link(author,'/profile/'+r.name_id,{class:'author'});
 if(isBot)article.classList.add('bot-post');
 article.append(el('div',{class:'post-top'},named?createPublicAvatar(named,{signal:controller.signal}):el('span',{class:'avatar '+(isBot?'bot':'anonymous'),'aria-hidden':'true'},createIcon(isBot?'sparkle':'user')),el('div',{class:'post-meta'},who,isBot?el('span',{class:'bot-badge'},createIcon('sparkle'),'AI assistant'):null,pending?el('span',{class:'post-confirmation',role:'status'},'Confirmation pending'):null,el('div',{class:'post-context'},field(r.subboard)?link(r.subboard==='0'?'Main board':board?text(board.name):'Subboard','/board/'+r.subboard):'Board unavailable',el('span',{class:'post-time'},timestamp(post.timestamp))))));
 const provenance=el('details',{class:'post-provenance'},el('summary',{},'Post details'));const authoredPolicy=policyLabel('Published under policy',post.mainVersion,post.localVersion);if(authoredPolicy)provenance.append(authoredPolicy);
 if(Array.isArray(data.policies)){const policy=data.policies.find(p=>p.version===post.mainVersion);if(policy&&policyVersion(policy.version))provenance.append(el('details',{},el('summary',{},'Parent rules at publication · v'+policy.version),richText(policy.text)));}
 if(field(r.parent)&&r.parent!=='0')article.append(el('p',{class:'reply-line','data-parent-line':''},'In reply to ',link('an earlier post','/thread/'+r.root+'/'+r.parent)));
 if(field(r.reference)&&r.reference!=='0')article.append(el('p',{class:'reply-line'},r.kind==='3'?'Reposted from ':'Quoted from ',link('the original post','/post/'+r.reference)));
 const more=(...actions)=>el('details',{class:'post-more'},el('summary',{class:'action'},createIcon('more'),'More'),el('div',{class:'post-secondary-actions'},actions));
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
  article.append(el('div',{class:'post-actions'},preferenceButton('Bookmark',1,post.id,undefined,'bookmark'),more(provenance),link([createIcon('message'),'View thread'],'/thread/'+r.root,{class:'post-link'})));return article;
 }
 article.append(richText(post.text),el('div',{class:'post-actions'},
  button([createIcon('reply'),'Reply'],()=>openWallet({type:'reply',parent:post.id,root:r.root,subboard:r.subboard},{context:{author,excerpt:text(post.text).slice(0,200)}})),
  socialButton('Like',()=>({type:'like',post:post.id}),{'data-icon':'heart'}),el('span',{class:'action likes'},`${text(post.likes)} ${post.likes==='1'?'like':'likes'}`),preferenceButton('Bookmark',1,post.id,undefined,'bookmark'),
  more(button([createIcon('quote'),'Quote'],()=>openWallet({type:'quote',reference:post.id,subboard:r.subboard})),
   button([createIcon('repeat'),'Repost'],()=>openWallet({type:'repost',reference:post.id,subboard:r.subboard})),provenance),
  link([createIcon('message'),'View conversation'],'/thread/'+r.root,{class:'post-link'})));
 article.append(afterConfirmation(moderatorButton('Remove this post',{type:'moderate-post',post:post.id})));
 return article;
}
function timestamp(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0)return '';const date=new Date(n*1000);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'';}
function shell(title,{boardId=null}={}){
 document.title=title+' · rollingchat';
 const nav=(label,to,icon)=>link([el('span',{class:'nav-icon','aria-hidden':'true'},createIcon(icon)),label],to);
 const rail=el('aside',{class:'rail',id:'community-navigation'},link(createBrand(),'/home',{class:'brand'}),el('p',{class:'rail-label'},'Browse'),el('nav',{class:'nav-group','aria-label':'Community'},nav('Home','/home','home'),nav('Main board','/board/0','message'),nav('Explore boards','/directory','compass'),nav('Following','/following','users'),nav('Bookmarks','/bookmarks','bookmark')),el('p',{class:'rail-foot'},'Say it in public. Stay private.',el('br'),el('a',{href:'/archive/'},'Earlier conversations')));
 for(const entry of rail.querySelectorAll('nav a'))if(entry.hash.slice(1)===route||entry.hash==='#/directory'&&route.startsWith('/directory/')){entry.setAttribute('aria-current','page');entry.classList.add('active');}
 const closeMenu=()=>{rail.classList.remove('open');rail.inert=narrow.matches;document.querySelector('.workspace').inert=false;menu.setAttribute('aria-expanded','false');menu.focus();};
 const menu=button(createIcon('menu'),()=>{rail.inert=false;rail.classList.add('open');document.querySelector('.workspace').inert=true;menu.setAttribute('aria-expanded','true');rail.querySelector('a').focus();},{class:'menu-toggle','aria-label':'Open navigation','aria-expanded':'false','aria-controls':'community-navigation'});
 rail.append(button(createIcon('close'),closeMenu,{class:'mobile-close','aria-label':'Close navigation'}));rail.inert=narrow.matches;
 rail.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu();if(event.key==='Tab'&&rail.classList.contains('open')){const targets=[...rail.querySelectorAll('a,button')],first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
 // A route returning to a saved position skips entrance motion: the restore measures the anchor's box, which a transform would shift.
 main=el('main',{id:'content',tabindex:'-1',...(positions.get(route)?{class:'restored'}:{})},el('header',{class:'page-head'},el('div',{},el('h1',{tabindex:'-1'},title),el('p',{class:'intro'},title==='Home'?'Fresh conversations from the main board and featured boards.':title==='Conversation'?'Join in with a reply.':'Public conversations. Private participation.'))));
 if(boardId!==null||route==='/home')main.querySelector('.page-head').append(button([createIcon('pen'),'Write a post'],()=>openWallet({type:'post',subboard:boardId??'0'}),{class:'button primary',...(boardId!==null?{'data-board-compose':'',disabled:''}:{})}));
 const bokBalance=el('section',{class:'bok-balance','aria-label':'Bok balance',hidden:''});
 const postingName=el('div',{class:'posting-name','data-posting-name':''});main.insertBefore(postingName,main.querySelector('.page-head').nextSibling);
 void accountPanel().then(panel=>{if(postingName.isConnected){panel.attachIdentityControls(postingName);panel.attachBokControls(bokBalance);}}).catch(()=>{walletPanel=null;postingName.append(button('Load posting names',()=>render()));});
 main.insertBefore(bokBalance,postingName.nextSibling);
 const context=el('aside',{class:'context'},
  el('section',{},el('h2',{},createIcon('message'),'Your place to talk'),el('p',{},'Start a conversation, join a board, or reply to someone. Post anonymously or under a name you choose.'),link([createIcon('compass'),'Find a board'],'/directory',{class:'button'})),
  el('section',{class:'context-help'},el('h2',{},createIcon('sparkle'),'Meet Bok'),el('p',{},'Bok is the AI assistant in every thread. Mention @bok in a post or reply, set a spending limit, and pay only for the work it does.')),
  el('section',{},el('h2',{},createIcon('shield'),'How it works'),el('ol',{},el('li',{},'Read everything. No account needed.'),el('li',{},'Connect a wallet to post, reply and like.'),el('li',{},'Nobody can tell which posts share an account.'))));
 app.replaceChildren(el('div',{class:'shell'},el('header',{class:'topbar'},menu,link(createBrand(),'/home',{class:'brand'}),link([createIcon('search'),'Explore boards'],'/directory',{class:'search-link'}),el('div',{class:'topbar-actions'},button([createIcon('user'),el('span',{class:'label'},'Your account')],()=>openWallet(),{'aria-label':'Your account'}))),el('div',{class:'shell-body'},rail,el('div',{class:'workspace'},el('div',{class:'layout'},main,context)))));
 return main;
}
function boardCard(board){
 const rules=el('details',{},el('summary',{},'Board rules'),el('h3',{},'Site rules'),richText(board.mainRules),el('h3',{},'Additional rules'),richText(board.rules));
 const history=el('details',{},el('summary',{},'Rule history'),policyVersion(board.mainVersion)?el('p',{class:'quiet'},'Current parent policy v'+board.mainVersion):null,board.rejected&&policyVersion(board.rejection?.mainVersion)?el('p',{class:'quiet'},'Subboard rejected under parent policy v'+board.rejection.mainVersion):null);
 if(history.childElementCount>1)rules.append(history);
 const name=text(board.name);
 return el('article',{class:'directory-item'},el('span',{class:'board-tile '+boardTone(board.id),'aria-hidden':'true'},boardInitial(name)),el('div',{},el('h2',{},field(board.id)?link(name,'/board/'+board.id):name),el('p',{class:'board-slug'},'/'+text(board.slug)),el('p',{},text(board.description)),board.rejected?el('p',{class:'removed'},'Board closed: '+text(board.rejection?.reason)):null,rules,board.rejected?null:moderatorButton('Reject this subboard',{type:'reject-subboard',subboard:board.id})));
}
function boardOverview(data){
 const board=data.board,policy=data.mainPolicy,name=board?text(board.name):'Main board';
 const section=el('div',{class:'board-head-body'}),head=el('section',{class:'board-head','aria-label':'Board information'},el('span',{class:'board-tile large '+boardTone(board?board.id:'0'),'aria-hidden':'true'},boardInitial(name)),section);
 const history=el('details',{},el('summary',{},'Rule history'),el('p',{class:'quiet'},'Current parent policy v'+policy.version));
 if(board){
  section.append(el('p',{class:'board-slug'},'/'+text(board.slug)),el('p',{},text(board.description)));
  if(policyVersion(board.creationVersion))history.append(el('p',{class:'quiet'},'Created under parent policy v'+board.creationVersion));
  if(board.rejected)section.append(el('p',{class:'removed',role:'status'},'This board is closed to new posts.'),el('p',{class:'removed'},'Rejection reason: '+text(board.rejection?.reason)));
 }else section.append(el('p',{},'The whole community in one place. Every board on rollingchat shares these rules.'));
 const rules=el('details',{},el('summary',{},'Board rules'),el('h2',{},'Site rules'),richText(policy.text));
 if(board)rules.append(el('h2',{},'Additional rules'),richText(board.rules));
 rules.append(history);
 section.append(rules);
 if(!board)section.append(moderatorButton('Update parent rules',{type:'set-main-policy'}));
 else if(!board.rejected)section.append(moderatorButton('Reject this subboard',{type:'reject-subboard',subboard:board.id}));
 if(board?.rejection&&policyVersion(board.rejection.mainVersion)){
  const applied=data.policies.find(p=>p.version===board.rejection.mainVersion);
  if(applied)history.append(el('details',{},el('summary',{},'Parent rules at rejection · v'+applied.version),richText(applied.text)));
 }
 return head;
}
function capturePosition(){return renderedRoute===route?{...captureRoutePosition(loadedPages),threadEnd:loadedThreadEnd}:positions.get(route);}
async function render({live=false,publicationRevision}={}){
 const finishTiming=beginRollingMeasure(live?'reader.update':'reader.load');
 if(live)positions.set(route,capturePosition());
 controller?.abort();controller=new AbortController();const signal=controller.signal,current=++sequence;renderActive=current;
 try{
 // Reload the viewed extent against one fresh public snapshot. A conversation
 // already read through its end also includes replies added on another page.
 // Navigation cancellation owns this sequence; each request handles transport errors.
 const restoreSignal=signal,saved=positions.get(route);let pages=1;
 const parts=route.split('/').filter(Boolean);let api='home',parameters={limit:30},title='Home',expectedRoot,privateView=null;
 if(privateViews.has(parts[0])&&parts.length===1){privateView=parts[0];api=privateView;title=privateView[0].toUpperCase()+privateView.slice(1);}
 else if(parts[0]==='directory'){api='directory';title='Explore boards';try{parameters.query=parts[1]?decodeURIComponent(parts[1]):'';}catch{shell('Page not found');return;}}
 else if(parts[0]==='board'){if(parts.length!==2||!field(parts[1])){shell('Page not found',{boardId:''});return;}api='board';parameters={id:parts[1],limit:30};title=parts[1]==='0'?'Main board':'Subboard';}
 else if(['thread','profile','post'].includes(parts[0])){if(!field(parts[1])||parts[2]&&!field(parts[2])){shell('Page not found');return;}api=parts[0];parameters=api==='post'?{id:parts[1]}:{limit:30,[api==='thread'?'root':'nameId']:parts[1]};title=api==='thread'?'Conversation':api==='profile'?'Profile':'Post';
  if(api==='thread'&&parts[2]){expectedRoot=parts[1];api='post';parameters={id:parts[2]};title='Linked post';}
 }
 else if(parts[0]!=='home'){shell('Page not found');return;}
 if(!live)shell(title,{boardId:api==='board'?parameters.id:null});
 if(privateView){
  main.querySelector('.intro').textContent={following:'Posts from the people and boards you follow.',bookmarks:'Posts you saved for later.'}[privateView];
  if(privatePanel?.privateStatus?.()!=='complete'){
   const signedIn=privatePanel?.privateStatus?.()==='recovering';
   if(signedIn&&typeof privatePanel.loadSavedItems==='function'){
    const state=el('div',{class:'empty',role:'status'},el('p',{},'Loading your '+title.toLowerCase()+'…'));main.append(state);
    const pending=loadSavedItems();
    void pending.then(ok=>{if(current!==sequence||signal.aborted||ok)return;state.replaceChildren(el('p',{},'Your saved items could not load.'),button('Try again',()=>render()));});
    return;
   }
   main.append(el('div',{class:'empty'},el('h2',{},signedIn?'Load your '+title.toLowerCase():'Your '+title.toLowerCase()),el('p',{},signedIn?'Your saved items are kept with your account.':{following:'Sign in to see posts from people and boards you follow.',bookmarks:'Sign in to see the posts you have saved.'}[privateView]),button(signedIn?'Load '+title.toLowerCase():'Sign in',()=>openWallet())));
   focusRoute(route,positions.get(route),current===1);
   announce(title+': sign in to see your saved conversations.');return;
  }
 }
 const savedSelection=privateView?savedReaderSelection(privateView,privatePanel.savedItemsSnapshot()):null;if(savedSelection)parameters=savedSelection.parameters;
 const contentHost=el('section',{class:'public-content'});if(!live)main.append(contentHost);
 let followingList;
 function showFollowing(metadata){
  if(privateView!=='following')return;
  const list=el('ul',{class:'saved-follow-list','aria-label':'People and boards you follow'});
  for(const entry of savedSelection.following){
   const current=entry.kind==='board'?metadata?.boards?.find(v=>v.id===entry.id):metadata?.names?.find(v=>v.id===entry.id);
   const label=entry.kind==='board'?(text(current?.name)||entry.label):current&&text(current.first)?text(current.first)+' '+text(current.last):entry.label;
   list.append(el('li',{},link(label,'/'+entry.kind+'/'+entry.id),preferenceButton(entry.kind==='board'?'Follow board':'Follow name',entry.kind==='board'?2:3,entry.id,label)));
  }
  const section=el('section',{'aria-label':'Following'},el('h2',{},'People and boards you follow'),list,link('Find a board','/directory'));
  if(followingList)followingList.replaceWith(section);else contentHost.append(section);followingList=section;
 }
 showFollowing();
 if(savedSelection&&(privateView==='bookmarks'?savedSelection.bookmarks.length:savedSelection.following.length)===0){
  contentHost.append(el('div',{class:'empty'},el('h2',{},privateView==='following'?'Find your people':'Save something worth returning to'),el('p',{},privateView==='following'?'Follow a board or a named author to see their posts here.':'Select Bookmark on a post to keep it here.'),link('Browse conversations','/home')));
  if(live)main.querySelector('.public-content')?.replaceWith(contentHost);renderedRoute=route;loadedPages=1;focusRoute(route,positions.get(route),current===1);return;
 }
 const loading=el('div',{class:'feed-loading',role:'status','aria-busy':'true'},createSkeletonFeed(3),el('p',{},'Loading conversations…'));contentHost.append(loading);
 if(api==='directory'){
  main.querySelector('.intro').textContent='Find a community around something you care about.';contentHost.append(button([createIcon('plus'),'Create a board'],()=>openWallet({type:'subboard'})));
  const input=el('input',{type:'search',value:parameters.query,placeholder:'Find a topic or board','aria-label':'Search boards',maxlength:120});
  const form=el('form',{class:'directory-search',onSubmit:event=>{event.preventDefault();location.hash='/directory/'+encodeURIComponent(input.value.trim());}},input,el('button',{class:'button',type:'submit'},'Search'));contentHost.insertBefore(form,loading);
 }
 const container=el('section',{class:'feed'+(api==='thread'?' thread':'')+(live?' live':''),'aria-label':title});let data;
 // A conversation nests each reply under the post it answers; other feeds stay flat.
 const thread=api==='thread'?createThreadView({root:parameters.root,state:threadState(parameters.root),announce,signals:post=>({likes:Number(post.likes)||0,bot:Boolean(post.bot),removed:post.text===null||Boolean(post.removal),pending:post.confirmation==='pending'})}):null;
 if(thread)thread.mount(container);activeThread=thread;
 const seenIds=new Set(),seenCursors=new Set();let lastPosition=null,lastPositionHash=null;
 const pendingPublicPages=[];
 function notifyRenderedPosts(){
  if(!container.isConnected||!pendingPublicPages.length)return;
  const pages=pendingPublicPages.splice(0);currentLikeSnapshot=pages.at(-1).snapshot;
  void walletPanel?.then(panel=>{if(current===sequence&&!signal.aborted&&container.isConnected){updateLikeControls();for(const page of pages)panel.observePublicPosts?.(page.items,page.snapshot);}}).catch(()=>{});
 }
 const position=p=>['blockNumber','txIndexWithinBlock','logIndexWithinTx'].map(key=>{const v=p?.position?.[key];if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v))throw Error('Invalid position');return BigInt(v);});
 const descending=(a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;};
 function append(response){
  const confirmed=response.confirmationCheckpoint;
  if(confirmed!==undefined&&(!Number.isSafeInteger(confirmed?.number)||confirmed.number<0||typeof confirmed.hash!=='string'||!/^0x[0-9a-f]{64}$/.test(confirmed.hash)))throw Error('Invalid confirmation checkpoint');
  if(typeof response.revision!=='string'||response.revision!==data.revision||response.scope.boardAddress!==data.scope.boardAddress||
   response.checkpoint?.number!==data.checkpoint?.number||response.checkpoint?.hash!==data.checkpoint?.hash||
   confirmed?.number!==data.confirmationCheckpoint?.number||confirmed?.hash!==data.confirmationCheckpoint?.hash)throw Error('Changed public snapshot');
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
   if(items.some(item=>privateView==='bookmarks'?!savedSelection.bookmarks.includes(item.id):!savedSelection.boards.includes(item.record?.subboard)&&!savedSelection.names.includes(item.record?.name_id)))throw Error('Unrequested saved item');
  }
  const nodes=visible.map(item=>api==='directory'?boardCard(item):postCard(item,response));
  // Rows rise in sequence on a fresh page; a live refresh swaps content without replaying the motion.
  if(!live)nodes.forEach((node,index)=>node.style.setProperty('--i',String(Math.min(index,8))));
  if(nodes.length)container.querySelector('.empty')?.remove();lastPosition=nextPosition;lastPositionHash=nextPositionHash;
  if(thread){visible.forEach((item,index)=>thread.add(item,nodes[index]));thread.commit();}else container.append(...nodes);
  for(const id of ids)seenIds.add(id);if(next)seenCursors.add(next);
  if(api!=='directory'){pendingPublicPages.push({items,snapshot:{checkpoint:response.checkpoint,confirmationCheckpoint:response.confirmationCheckpoint,revision:response.revision,renderedPosts:visible}});notifyRenderedPosts();}
  return nodes;
 }

 try{
  data=await read(api,parameters,restoreSignal,{revision:publicationRevision});if(current!==sequence)return;
  if(expectedRoot&&(!data.post||data.post.record?.root!==expectedRoot))throw Error('Linked post does not belong to this conversation');
  const finishDOM=beginRollingMeasure('reader.dom');
  append(data);showFollowing(data.following);
  let cursor=data.nextCursor;
  while(api!=='directory'&&cursor&&(pages<(saved?.pages??1)||api==='thread'&&saved?.threadEnd||saved?.anchor&&!seenIds.has(saved.anchor.id.slice(5)))){
   const page=await read(api,{...parameters,cursor},restoreSignal,{revision:data.revision});if(current!==sequence)return;append(page);cursor=page.nextCursor;pages++;
  }
  loading.remove();
  if(api==='board'){
   main.querySelector('h1').textContent=data.board?text(data.board.name):'Main board';container.setAttribute('aria-label','Posts in '+(data.board?text(data.board.name):'Main board'));
   const overview=boardOverview(data);overview.querySelector('.board-head-body').append(preferenceButton('Follow board',2,parameters.id,data.board?.name??'Main board'));contentHost.append(overview);
   const compose=document.querySelector('[data-board-compose]');if(compose)compose.disabled=Boolean(data.board?.rejected);
  }
  if(api==='profile'&&data.identity){main.querySelector('h1').textContent=text(data.identity.first)+' '+text(data.identity.last);contentHost.append(createPublicProfile(data.identity,{signal}),preferenceButton('Follow name',3,parameters.nameId,text(data.identity.first)+' '+text(data.identity.last)),moderatorButton('Remove this avatar',{type:'moderate-avatar',name:parameters.nameId}));}
  document.title=main.querySelector('h1').textContent+' · rollingchat';
  if(!container.childElementCount){
   const copy=privateView?{following:['No posts from your follows yet','The people and boards above have no available posts.'],bookmarks:['Saved posts unavailable','Your saved posts are not available in the current public feed.']}[privateView]:api==='directory'?['Find a board',cursor?'No matches on this page. Check the next page or try another search.':'No boards match. Try another topic or create a board.']:['Start the conversation','There are no posts here yet.'];
   const empty=el('div',{class:'empty'},el('h2',{},copy[0]),el('p',{},copy[1]));
   if(privateView)empty.append(link(privateView==='following'?'Explore boards':'Browse conversations',privateView==='following'?'/directory':'/home',{class:'button'}));
   else if(api==='home'||api==='board'&&!data.board?.rejected)empty.append(button('Write the first post',()=>openWallet({type:'post',subboard:api==='board'?parameters.id:'0'}),{class:'button primary'}));
   container.append(empty);
  }
  contentHost.append(container);
  if(expectedRoot)contentHost.append(el('p',{},link('Read the conversation from the beginning','/thread/'+expectedRoot)));
  let observer,inFlight=false,stopped=false;
  const stop=()=>{stopped=true;observer?.disconnect();};
  signal.addEventListener('abort',stop,{once:true});
  const more=button('Load more',()=>void loadMore(true),{class:'button load-more'});
  async function loadMore(explicit=false){
   if(inFlight||stopped||signal.aborted||current!==sequence||!cursor)return;
   const ownedFocus=explicit&&document.activeElement===more;
   const focusResult=node=>{if(ownedFocus&&(document.activeElement===document.body||document.activeElement===more)){node.tabIndex=-1;node.focus({preventScroll:true});}};
   inFlight=true;more.disabled=true;more.setAttribute('aria-busy','true');observer?.unobserve(more);
   try{
    const page=await read(api,{...parameters,cursor},signal,{revision:data.revision});
    if(signal.aborted||current!==sequence||stopped)return;
    const added=append(page);cursor=page.nextCursor;pages++;loadedPages=pages;loadedThreadEnd=api==='thread'&&!cursor;
    if(api==='directory'&&container.querySelector('.empty'))container.querySelector('.empty p').textContent=cursor?'No matches in this page. Continue searching.':'No subboards match this search.';
    if(!cursor){stop();more.remove();}else more.disabled=false;
    if(added.length)focusResult(added[0]);
    else if(cursor){if(ownedFocus&&document.activeElement===document.body)more.focus({preventScroll:true});}
    else{const end=el('p',{role:'status'},api==='directory'?'No more subboards.':'No more conversations.');contentHost.append(end);focusResult(end);}
    announce(api==='directory'?'Next search page checked.':'More conversations loaded.');
   }catch(error){
    if(signal.aborted||current!==sequence||stopped)return;
    stop();more.remove();const failed=el('p',{role:'alert'},'The conversation changed or could not load. ',button('Refresh',()=>render()));contentHost.append(failed);focusResult(failed);
   }finally{
    inFlight=false;more.removeAttribute('aria-busy');
    if(!stopped&&!signal.aborted&&current===sequence&&cursor)observer?.observe(more);
   }
  }
  if(cursor)contentHost.append(more);
  contentHost.append(el('details',{class:'feed-details'},el('summary',{},'About this feed'),el('p',{class:'quiet'},'Checked against chain block '+String(data.checkpoint?.number??''))));
  if(live){main.querySelector('.public-content')?.replaceWith(contentHost);announce('Conversations updated.');}
  notifyRenderedPosts();
  renderedRoute=route;loadedPages=pages;loadedThreadEnd=api==='thread'&&!cursor;
  finishDOM();
  updates.rendered(data.revision);
  finishTiming();
  focusRoute(route,positions.get(route),current===1);
  // One request owner serves both automatic and keyboard paging. Re-observation
  // after each page fills short viewports, but never creates parallel requests.
  if(api!=='directory'&&cursor&&typeof IntersectionObserver==='function'){
   observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.target===more&&entry.isIntersecting))void loadMore();},{rootMargin:'300px 0px',threshold:0});
   observer.observe(more);
  }

 }catch(error){if(signal.aborted)return;if(live){announce('Conversations could not refresh.');return false;}loading.remove();contentHost.append(el('div',{class:'empty',role:'alert'},el('h2',{},error.code==='READER_SYNCING'?'Conversations are being checked':error.code==='READER_NOT_FOUND'?({board:'Board',profile:'Profile',post:'Post',thread:'Conversation'}[api]??'Page')+' not found':'Conversations could not load'),el('p',{},error.code==='READER_SYNCING'?'The feed is catching up with new posts. Try again shortly.':error.code==='READER_NOT_FOUND'?'This link does not point to an available '+({board:'board',profile:'profile',post:'post',thread:'conversation'}[api]??'page')+'.':'Check your connection, then try loading the conversations again.'),button('Try again',()=>render())));focusRoute(route,positions.get(route),current===1);}
 }finally{finishTiming();if(renderActive===current)renderActive=0;void updates.flush();}
}
const updates=createReaderUpdates({refresh:publicationRevision=>render({live:!!main?.querySelector('.public-content'),publicationRevision}),canRefresh:()=>!renderActive&&!document.hidden&&route.split('/')[1]!=='directory'&&!!main?.querySelector('.public-content')});
addEventListener('pagehide',()=>{sequence++;controller?.abort();updates.stop();});
addEventListener('pageshow',event=>{updates.start();if(event.persisted)render();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void updates.flush();});
document.querySelector('.skip').addEventListener('click',skipToContent);
addEventListener('hashchange',()=>{positions.set(route,capturePosition());if(positions.size>40)positions.delete(positions.keys().next().value);route=currentRoute();render();});
narrow.addEventListener('change',()=>{const rail=document.querySelector('.rail'),workspace=document.querySelector('.workspace');if(rail){rail.classList.remove('open');rail.inert=narrow.matches;workspace.inert=false;document.querySelector('.menu-toggle')?.setAttribute('aria-expanded','false');}});
updates.start();
// Account-independent worker preparation starts with the page, not with a panel
// click or completion of service-worker installation.
void prepareAccountTools().catch(()=>{});
render();
// Restore this browser’s saved account without opening the panel or prompting a wallet.
void accountPanel().catch(()=>{});
