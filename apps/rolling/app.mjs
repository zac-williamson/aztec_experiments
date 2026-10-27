import {boards, profiles, ownNames, posts as fixtures, mainRules} from './fixtures.mjs';
import {allowance, createMessageBudget, rankPosts, searchBoards, createMessageContent, createIcon, createBrand, createSkeletonFeed, createThreadView, mentionsBok} from './model.mjs';
import {focusRoute, skipToContent} from './navigation.mjs';

const posts = structuredClone(fixtures);
const followedBoards = new Set(['building', 'commons']);
const followedNames = new Set(['Rowan Lake']);
const liked = new Set(), saved = new Set(), reposted = new Set();
const curated = new Set(boards.filter(b => b.curated).map(b => b.id));
const positions = new Map();
const threadStates = new Map(); // Collapse choices per conversation; survive Back and re-render.
const observers = new Set();
let route = location.hash.slice(1) || '/home', limit = 6, previewState = 'normal', sequence = 0;
const narrowScreen = matchMedia('(max-width: 700px)');
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog');
let opener;
function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(),value);
    else if (key === 'class') node.className=value;
    else if (value !== null && value !== undefined) node.setAttribute(key,String(value));
  }
  for (const child of children.flat(Infinity)) if(child!==null&&child!==undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(label, action, className='button', attrs={}) {return el('button',{type:'button',class:className,onClick:action,...attrs},label);}
function link(label,to,attrs={}) {return el('a',{href:`#${to}`,...attrs},label);}
function announce(text) {document.querySelector('#announcement').textContent=''; requestAnimationFrame(()=>{document.querySelector('#announcement').textContent=text;});}
function board(id) {return boards.find(b=>b.id===id);}
function notice(text,kind='') {return el('div',{class:`notice ${kind}`},text);}
function field(label,node) {return el('label',{class:'form-field'},label,node);}
function head(title,description,action) {return el('header',{class:'page-head'},el('div',{},el('h1',{tabindex:'-1'},title),description?el('p',{class:'intro'},description):null),action);}
function avatar(name) {const p=profiles[name];return el('span',{class:`avatar ${p?.color||'anonymous'} ${p?.bot?'bot':''}`,'aria-hidden':'true'},p?.bot?createIcon('sparkle'):p?.initials||createIcon('user'));}
function tile(topic,large=false) {return el('span',{class:`board-tile ${topic.color}${large?' large':''}`,'aria-hidden':'true'},topic.name[0]);}
// Feed rows arrive staggered: the index travels as a custom property, never inline CSS text.
function stagger(node,index) {node.style.setProperty('--i',String(Math.min(index,8)));return node;}
function modal(title,content) {
  opener=document.activeElement;
  dialog.replaceChildren(el('div',{class:'dialog-top'},el('h2',{id:'dialog-title'},title),button(createIcon('close'),()=>dialog.close(),'close',{'aria-label':'Close dialog'})),content);
  dialog.showModal();
}
document.querySelector('.skip').addEventListener('click', skipToContent);
dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();else document.querySelector('h1')?.focus();});
function explain(title,text) {modal(title,el('div',{},notice('Design preview · no transaction or external request will be sent.'),el('p',{},text),button('Close preview',()=>dialog.close())));}
const richText=createMessageContent;
function toggle(set,id,message) {set.has(id)?set.delete(id):set.add(id);announce(message);}
function actionToggle(label,icon,set,id,count=0,onChange) {
  const b=button('',()=>{toggle(set,id,`${label} ${set.has(id)?'removed':'added'} in this preview only.`);update();onChange?.();},'action');
  function update(){b.replaceChildren(createIcon(icon),`${label}${count||label==='Like'?` ${count+(set.has(id)?1:0)}`:''}${set.has(id)&&label!=='Like'?' ✓':''}`);b.setAttribute('aria-pressed',String(set.has(id)));}
  update();return b;
}
function postCard(post,thread=false) {
  const topic=board(post.board), profile=profiles[post.author];
  const author=post.author==='Anonymous'?el('span',{class:'author'},'Anonymous'):link(post.author,`/profile/${encodeURIComponent(post.author)}`,{class:'author'});
  const article=el('article',{class:`post${profile?.bot?' bot-post':''}`,id:`post-${post.id}`,'aria-label':post.removed?'Removed post':`Post by ${post.author}`});
  if(thread&&post.parent) article.append(el('div',{class:'reply-line','data-parent-line':''},createIcon('reply'),'Reply to ',link(posts.find(p=>p.id===post.parent)?.removed?'removed post':posts.find(p=>p.id===post.parent)?.author||'post',`/thread/${post.root}/${post.parent}`)));
  if(post.removed) {article.append(el('div',{class:'removed'},'Post removed by a moderator. The public chain record remains. ',link('View thread',`/thread/${post.root}`)));return article;}
  article.append(el('div',{class:'post-top'},avatar(post.author),el('div',{class:'post-meta'},author,profile?.bot?el('span',{class:'bot-badge'},createIcon('sparkle'),'Registered bot · fixture'):null,el('div',{class:'post-context'},link(topic.name,`/board/${topic.id}`),el('span',{class:'post-time'},post.age)))),...(post.tag?[el('span',{class:'post-tag'},post.tag)]:[]),richText(post.text));
  if(post.quote)article.append(el('blockquote',{},link('Quoted post',`/thread/${posts.find(p=>p.id===post.quote)?.root||post.quote}/${post.quote}`)));
  if(post.pending)article.append(el('p',{class:'quiet pending'},'Local draft preview · not published or proved.'));
  if(post.artifact)article.append(el('div',{class:'artifact-links'},button([createIcon('eye'),'Page preview'],()=>explain('Thread artifact','The live product will open the latest artifact on a separate origin. This fixture has no published artifact.'),'button'),button([createIcon('archive'),'Thread repository'],()=>explain('Thread repository','One persistent repository belongs to this thread. This fixture is not connected to GitHub.'))));
  const replyCount=posts.filter(p=>p.parent===post.id).length;
  article.append(el('div',{class:'post-actions'},button([createIcon('reply'),replyCount?`Reply ${replyCount}`:'Reply'],()=>composer('reply',post),'action'),actionToggle('Like','heart',liked,post.id,post.likes),button([createIcon('quote'),'Quote'],()=>composer('quote',post),'action'),actionToggle('Repost','repeat',reposted,post.id),actionToggle('Save','bookmark',saved,post.id),link([createIcon('message'),thread?'Permalink':'Open thread'],`/thread/${post.root}/${post.id}`,{class:'post-link','aria-label':`Open post by ${post.author}`})));
  return article;
}
function rules(topic) {return el('details',{class:'detail-rules'},el('summary',{},'Effective rules · main policy v3'),el('ol',{},mainRules.map(r=>el('li',{},r)),(topic?.rules||[]).map(r=>el('li',{},r))),el('p',{class:'quiet'},'Local rules add to the main board rules. Human and Bok posts follow the same policy.'));}
function composer(mode='post',parent=null) {
  const topic=board(parent?.board||route.split('/')[2])||boards[0];
  if(topic.rejected){explain('Posting unavailable',topic.reason);return;}
  const input=el('textarea',{placeholder:mode==='reply'?`Reply to ${parent.author}…`:'What is on your mind?','aria-describedby':'allowance','aria-label':'Post text'});
  const identity=el('select',{'aria-label':'Posting identity'},['Anonymous',...ownNames].map(n=>el('option',{value:n},n)));
  const budgetMeter=createMessageBudget(),counter=budgetMeter.node;counter.id='allowance';
  const preview=el('div',{class:'preview-body',hidden:true});
  const bokHint=el('div',{class:'bok-invitation',hidden:true},el('p',{},'Bok will reply to this message. In the live product you set a spending limit and only pay for the work it does.'));
  // X-style tagging: the chip inserts the mention at the caret and lets the input listener react.
  const chip=button('@bok',()=>{if(mentionsBok(input.value)){input.focus();return;}const at=input.selectionStart??input.value.length,before=input.value.slice(0,at),after=input.value.slice(at);input.setRangeText(`${before&&!/\s$/.test(before)?' ':''}@bok${after&&!/^\s/.test(after)?' ':''}`,at,at,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();},'button bok-chip',{'aria-label':'Mention Bok'});
  const submit=button('Add local preview',()=>{
    if(!allowance(input.value).valid)return;
    const id=`local-${++sequence}`;
    posts.unshift({id,root:mode==='reply'?parent.root:id,parent:mode==='reply'?parent.id:null,quote:mode==='quote'?parent.id:null,board:topic.id,author:identity.value,text:input.value,likes:0,time:1000+sequence,age:'just now',pending:true});
    dialog.close(); location.hash=`/thread/${mode==='reply'?parent.root:id}/${id}`;announce('Added a local preview. Nothing has been published.');
  },'button primary');
  function update(){const a=allowance(input.value);budgetMeter.update(a);submit.disabled=!a.valid;preview.replaceChildren(richText(input.value||'Your formatted preview will appear here.'));const bok=mentionsBok(input.value);bokHint.hidden=!bok;chip.setAttribute('aria-pressed',String(bok));}
  input.addEventListener('input',update);
  modal(mode==='reply'?'Reply to this post':mode==='quote'?'Quote this post':'Start a conversation',el('div',{},notice('Local design preview. No proof, payment or publication.'),field('Post as',identity),el('p',{class:'quiet'},'Only you see your available names. Anonymous displays no reusable author identity.'),el('p',{class:'quiet'},`Posting in ${topic.name}`),rules(topic),parent?[el('p',{class:'quiet'},`${mode==='quote'?'Quoting':'Replying to'} ${parent.author}`),el('blockquote',{class:'reply-context'},el('strong',{},parent.author),el('p',{},parent.removed?'Removed post':parent.text.slice(0,200)))]:null,field('Your message',input),el('div',{class:'composer-tools'},chip,button([createIcon('eye'),'Toggle formatting preview'],()=>{preview.hidden=!preview.hidden;},'action'),counter),preview,bokHint,el('div',{class:'dialog-actions'},button('Cancel',()=>dialog.close()),submit)));
  update();input.focus();
}
function followButton(set,id,label='Follow') {
  const b=button('',()=>{toggle(set,id,'Follow preference changed in this preview only.');update();});
  function update(){b.replaceChildren(set.has(id)?createIcon('check'):createIcon('plus'),set.has(id)?'Following':label);b.setAttribute('aria-pressed',String(set.has(id)));}update();return b;
}
function renderFeed(items) {
  if(previewState==='loading')return el('div',{class:'feed-loading',role:'status','aria-busy':'true'},createSkeletonFeed(3),el('p',{},'Loading conversations… Design-state preview.'));
  if(previewState==='failure')return el('div',{class:'empty'},el('h2',{},'Conversations could not load'),el('p',{},'Your account and drafts have not changed.'),button('Retry preview',()=>{previewState='normal';render();announce('Fixture feed restored.');}));
  if(previewState==='empty'||!items.length)return el('div',{class:'empty'},el('h2',{},'A little quiet here'),el('p',{},'Explore a subboard to find your next conversation.'),link('Explore subboards','/directory',{class:'button'}));
  const shown=previewState==='pending'?[{...items[0],pending:true},...items.slice(1)]:items;
  const feed=el('section',{class:'feed','aria-label':'Conversations'},shown.slice(0,limit).map((p,i)=>stagger(postCard(p),i)));
  const end=el('p',{class:'quiet feed-end'},'You’re caught up with this preview.');
  const more=button('Load more conversations',()=>appendMore(),'button load-more');
  function appendMore(){if(!more.isConnected)return;const previous=limit;limit+=6;feed.append(...shown.slice(previous,limit).map((p,i)=>stagger(postCard(p),i)));announce('More conversations loaded.');if(limit>=shown.length){const wasFocused=document.activeElement===more;more.replaceWith(end);if(wasFocused){end.tabIndex=-1;end.focus({preventScroll:true});}observer?.disconnect();}}
  const observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))appendMore();},{rootMargin:'120px'}):null;
  if(observer)observers.add(observer);
  if(shown.length>limit)requestAnimationFrame(()=>{if(more.isConnected)observer?.observe(more);});
  return el('div',{},feed,shown.length>limit?more:end);
}
function home(mode) {return [head(mode==='following'?'Your corner of the conversation':'Good conversations start here.',mode==='following'?'The latest from boards and identities you follow.':'A place to think out loud, find your people, and build something together.'),el('nav',{class:'tabs','aria-label':'Feed views'},link('Home','/home',{class:mode==='home'?'active':''}),link('Following','/following',{class:mode==='following'?'active':''})),el('div',{class:'compose-invite'},avatar('Anonymous'),button('Share a thought. Ask a question.',()=>composer())),renderFeed(rankPosts(posts,mode,followedBoards,followedNames,curated))];}
function directory() {
  const results=el('section',{'aria-label':'Subboard search results'});
  const count=el('p',{class:'quiet',role:'status'});
  const input=el('input',{type:'search',placeholder:'Try “building” or “maps”…','aria-label':'Search subboards'});
  function update(){const matches=searchBoards(boards,input.value);count.textContent=`${matches.length} subboards`;results.replaceChildren(...matches.map((b,i)=>stagger(el('article',{class:'directory-item'},tile(b),el('div',{},el('h2',{},link(b.name,`/board/${b.id}`)),el('p',{},b.description),b.rejected?el('span',{class:'quiet'},'Rejected · inspect reason'):followButton(followedBoards,b.id))),i)));if(!matches.length)results.append(notice('No subboards match. Try a different word.'));}
  input.addEventListener('input',update);update();
  return [head('Find your next conversation','Every board on rollingchat, including those outside Home.',button([createIcon('plus'),'Create subboard'],createBoard)),field('Search subboards',input),count,results];
}
function createBoard(){modal('Create a subboard',el('div',{},notice('Preview only. Creation requires transaction fees, not posting collateral.'),field('Name',el('input',{placeholder:'A place for…'})),field('Description',el('input',{placeholder:'What brings people here?'})),field('Immutable identifier',el('input',{placeholder:'your-subboard'})),field('Additional rules',el('textarea',{placeholder:'Local rules add to the main board policy.'})),el('p',{class:'quiet'},'Subboards cannot have subboards, be renamed, archived or transferred by their creators. Creation does not promote a subboard to Home.'),button('Review preview',()=>explain('Subboard creation preview','The live product must check identifier availability, policy compatibility and fees before you approve creation. Nothing was created.'))));}
function boardView(id) {
  if(id==='main')return [head('Main board','One community. Many ways into the conversation.',link('All subboards','/directory',{class:'button'})),rules(),renderFeed(posts.filter(p=>!p.parent&&!board(p.board)?.rejected))];
  const topic=board(id);if(!topic)return notFound();
  if(topic.rejected)return [head(topic.name,'Subboard rejected'),notice(topic.reason,'error'),el('p',{},'New posts are unavailable. Existing account funds remain recoverable. The rejection record belongs to main policy v3.'),link('Balances and withdrawals','/balances',{class:'button'}),link('Back to directory','/directory',{class:'button'})];
  return [el('header',{class:'board-head'},tile(topic,true),el('div',{class:'board-head-body'},el('h1',{tabindex:'-1'},topic.name),el('p',{class:'board-slug'},`/${topic.id}`),el('p',{},topic.description),el('div',{class:'board-head-actions'},followButton(followedBoards,id),button([createIcon('pen'),'Post in this subboard'],()=>composer(),'button primary')))),rules(topic),renderFeed(posts.filter(p=>p.board===id&&!p.parent))];
}
function threadView(rootId) {
  const root=posts.find(p=>p.id===rootId);if(!root)return notFound();
  // Chain order (oldest first) so every parent is placed before its replies.
  const members=posts.filter(p=>p.root===rootId).sort((a,b)=>(b.id===rootId)-(a.id===rootId)||a.time-b.time||a.id.localeCompare(b.id));
  if(!threadStates.has(rootId))threadStates.set(rootId,{collapsed:new Set(),expanded:new Set()});
  const thread=createThreadView({root:rootId,state:threadStates.get(rootId),announce,parentOf:p=>p.parent||null,signals:p=>({likes:p.likes,bot:Boolean(profiles[p.author]?.bot),removed:Boolean(p.removed),pending:Boolean(p.pending)})});
  const section=el('section',{class:'feed thread','aria-label':'Thread'});thread.mount(section);
  for(const p of members)thread.add(p,postCard(p,true));thread.commit();
  const target=route.split('/')[3];if(target)thread.reveal(target);
  return [button([createIcon('chevron-left'),'Back to conversations'],()=>{if(history.state?.rolling)history.back();else location.hash='/home';},'button ghost back'),head('The conversation',board(root.board).name,button([createIcon('reply'),'Reply'],()=>composer('reply',root))),section,el('p',{class:'quiet feed-end'},'Replies belong to the post they answer. Deep or quiet branches start folded; removed posts keep their place.')];
}
function profile(name) {
  const p=profiles[name];if(!p)return notFound();
  return [el('header',{class:'profile-header'},avatar(name),head(name,p.bio,followButton(followedNames,name)),p.bot?el('p',{class:'quiet'},'Registered bot identity · fixture. Live replies require chain authentication.'):el('p',{class:'quiet'},'A global identity on rollingchat.')),el('h2',{},'Posts'),renderFeed(posts.filter(p=>p.author===name))];
}
function names(){return [head('Your names','Private account preview. This list is only shown to you.'),notice('Fixture names only. No account is connected.'),el('section',{class:'rows'},ownNames.map(n=>el('div',{class:'row'},el('div',{},el('strong',{},n),el('small',{},'Global name · cannot be retired')),button('Profile preview',()=>explain('Edit profile','The live product lets you update your bio and preview a compressed 100 × 100 raster avatar, limited to 8,192 encoded bytes before publishing onchain.'))))),button([createIcon('plus'),'Register another name'],()=>{const first=el('input',{placeholder:'First name'}),last=el('input',{placeholder:'Last name'});modal('Register a global name',el('div',{},notice('Preview only. Availability and ownership require chain verification.'),field('First name',first),field('Last name',last),button('Suggest a name',()=>{first.value='Ellis';last.value='Moss';}),el('p',{class:'quiet'},'Each name part uses 1–32 ASCII letters, spaces, apostrophes or hyphens, starting and ending with a letter. Full names compare case-insensitively with repeated spaces collapsed. Bok is reserved as a first name. Registration is immutable in the proposed default.'),button('Check availability preview',()=>explain('Availability not checked','No chain is connected. A live registration must enforce uniqueness even when two people register concurrently.'))));},'button primary'),el('p',{class:'footer-note'},'Public profiles never list other names owned by this account.')];}
function balances(){return [head('Your account','Illustrative balances. No wallet is connected.',button([createIcon('wallet'),'Add funds'],onboard)),notice('Design fixtures, not spendable funds. Costs shown here are examples, not a quote.'),el('section',{class:'rows'},[['Refundable collateral','0.010 ETH','Available after eligibility checks'],['Chain fee credit','0.002 ETH','Pays Aztec transaction fees'],['Bok credit','$5.00 USDC available','$0.00 reserved'],['Conversion and bridge costs','Not quoted','Calculated before an actual funding approval']].map(([name,value,desc])=>el('div',{class:'row'},el('div',{},el('strong',{},name),el('small',{},desc)),el('strong',{class:'nowrap'},value)))),el('h2',{class:'visually-heading'},'Withdrawals'),el('p',{class:'intro'},'Eligible collateral and unused Bok credit can be withdrawn. Reserved credit and pending exits are shown separately.'),button('Preview withdrawal',()=>explain('Withdrawal preview','The live flow must verify eligibility, exact available amount and recipient; preserve the original exit through interruptions; and reconcile settlement before retrying. This preview submits nothing.')),el('h2',{class:'visually-heading'},'Keep your account recoverable'),link([createIcon('shield'),'Backup and recovery'],'/recovery',{class:'button'})];}
function onboard(){let stage=0;const stageNode=el('div');const wallet=el('select',{},el('option',{},'MetaMask · Ethereum'),el('option',{},'Phantom · Ethereum'));const asset=el('select',{},el('option',{},'ETH'),el('option',{},'USDC'));const stages=['Choose your wallet and funding asset','Review funding purposes','Preview asynchronous setup'];const next=button('Continue preview',()=>{stage++;draw();},'button primary');function draw(){stageNode.replaceChildren(el('ol',{class:'setup-steps','aria-label':'Setup steps'},['Wallet','Review','Setup'].map((s,i)=>el('li',{'data-state':i<stage?'done':i===stage?'current':'todo'},s))),el('h3',{},stages[stage]));if(stage===0)stageNode.append(field('Wallet',wallet),field('Starting asset',asset),notice('No wallet connection will be requested. Wallet capability and gas checks are not implemented in this fixture.'));else if(stage===1)stageNode.append(el('p',{},`${wallet.value} / ${asset.value}`),el('ul',{},['Refundable posting collateral','Chain fees and any conversion costs','Bok credit'].map(t=>el('li',{},t))),el('p',{class:'quiet'},'A live quote must show exact allocations, approvals and transaction count before taking funds. USDC routes must resolve Ethereum gas without sponsorship.'));else{stageNode.append(el('ol',{class:'stage-list'},['Connect wallet and unlock the private account','Check wallet support and show a complete quote','Approve initial funding where the wallet route supports it','Wait for bridge delivery; complete claims automatically','Verify usable collateral, fees and Bok credit'].map(t=>el('li',{},t))),notice('Preview complete. Account is not funded or ready to post. No transaction was sent.'),el('p',{class:'quiet'},'The live flow resumes after reload and reconciles existing receipts before any retry.'));next.hidden=true;}}modal('Get ready to join in',el('div',{},notice('Interactive onboarding design · no payments or account creation.'),stageNode,el('div',{class:'dialog-actions'},button('Close',()=>dialog.close()),next)));draw();}
function recovery(){return [head('Backup and recovery','Keep encrypted recovery material under your control.'),notice('Preview only. Do not enter real keys, seed phrases or passwords here.'),el('section',{class:'rows'},el('div',{class:'row'},el('div',{},el('strong',{},'Encrypted account backup'),el('small',{},'Includes private account and preference recovery material')),button('Preview backup',()=>explain('Encrypted backup','The live product exports encrypted recovery material on your device. This preview does not generate or download a backup.'))),el('div',{class:'row'},el('div',{},el('strong',{},'Restore an account'),el('small',{},'Reconcile prior transactions before sending anything new')),button('Preview restore',()=>explain('Restore account','Restoration needs user-held recovery keys plus authenticated chain records. It must recover owned names, private preferences and pending funding journals. No restore has run.')))),el('p',{class:'footer-note'},'A chain scan cannot recreate lost recovery secrets.')];}
function moderation(){return [head('Moderator workspace','Policy and rejection preview. No moderator authority is connected.'),el('h2',{},'Effective policy'),rules(boards[1]),notice('Main policy v3 plus Building things policy v1. The same policy applies to human and Bok messages.'),el('h2',{class:'visually-heading'},'Rejected subboard'),el('section',{class:'rows'},el('div',{class:'row'},el('div',{},el('strong',{},'No rules'),el('small',{},boards.at(-1).reason)),link('Inspect','/board/no-rules',{class:'button'}))),el('h2',{class:'visually-heading'},'Record a moderation decision'),field('Reason',el('textarea',{placeholder:'Explain which effective rule was violated.'})),button('Review decision preview',()=>explain('Review moderation decision','The live flow must bind the decision to the board or post, authorized moderator and policy version, then record it onchain. This fixture cannot moderate content.'))];}
function follows(){return [head('Following','Private preferences in this preview; changes reset on refresh.'),el('h2',{},'Subboards'),el('section',{class:'rows'},boards.filter(b=>followedBoards.has(b.id)).map(b=>el('div',{class:'row'},el('div',{class:'row-label'},tile(b),link(b.name,`/board/${b.id}`)),followButton(followedBoards,b.id)))),el('h2',{class:'visually-heading'},'Identities'),el('section',{class:'rows'},[...followedNames].map(n=>el('div',{class:'row'},el('div',{class:'row-label'},avatar(n),link(n,`/profile/${encodeURIComponent(n)}`)),followButton(followedNames,n)))),link([createIcon('compass'),'Find more subboards'],'/directory',{class:'button'})];}
function notifications(){return [head('Notifications','In-app reply notifications · example delivery, not a live subscription.'),el('section',{class:'rows'},el('div',{class:'row'},el('div',{},el('strong',{},'Bok replied in Building things'),el('small',{},'A small map of working fountains')),link('View reply','/thread/first-tools/r3',{class:'button'})),el('div',{class:'row'},el('div',{},el('strong',{},'Rowan Lake replied to your post'),el('small',{},'What would you build for ten people?')),link('View reply','/thread/first-tools/r1',{class:'button'}))),button('Notification preferences',()=>explain('Private notification preferences','The live product stores encrypted preferences and must avoid revealing the relationship between your identities through subscriptions. Email and push are not part of this preview.'))];}
function notFound(){return [head('This page is unavailable','The preview may not include this link.'),link('Return home','/home',{class:'button'})];}
function decodeName(value){try{return decodeURIComponent(value||'');}catch{return '';}}
function page(){const [_,kind,id]=route.split('/');switch(kind){case'home':return home('home');case'following':return home('following');case'directory':return directory();case'board':return boardView(id);case'thread':return threadView(id);case'profile':return profile(decodeName(id));case'names':return names();case'balances':return balances();case'recovery':return recovery();case'moderation':return moderation();case'follows':return follows();case'notifications':return notifications();case'bookmarks':return [head('Saved for later','Private bookmarks · stored in memory for this preview.'),renderFeed(posts.filter(p=>saved.has(p.id)))];default:return notFound();}}
function render(){
  for(const observer of observers)observer.disconnect();observers.clear();
  const current=path=>({class:route===path?'active':'','aria-current':route===path?'page':null});
  const nav=(label,path,icon)=>link([el('span',{class:'nav-icon','aria-hidden':'true'},createIcon(icon)),label],path,current(path));
  const boardNav=b=>link([tile(b),b.name],`/board/${b.id}`,current(`/board/${b.id}`));
  const rail=el('aside',{class:'rail','aria-label':'Community navigation'},link(createBrand(),'/home',{class:'brand'}),button(createIcon('close'),()=>closeMenu(),'mobile-close',{'aria-label':'Close menu'}),el('nav',{class:'nav-group','aria-label':'Main'},nav('Home','/home','home'),nav('Following','/following','users'),nav('Explore subboards','/directory','compass'),nav('Notifications','/notifications','bell'),nav('Bookmarks','/bookmarks','bookmark')),el('p',{class:'rail-label'},'Your community'),el('nav',{class:'nav-group','aria-label':'Community'},nav('Main board','/board/main','message'),...boards.filter(b=>b.curated).map(boardNav)),el('p',{class:'rail-label'},'Your private account'),el('nav',{class:'nav-group','aria-label':'Account'},nav('Names & profiles','/names','user'),nav('Follows','/follows','plus'),nav('Balances','/balances','wallet'),nav('Backup & recovery','/recovery','shield')),el('div',{class:'rail-foot'},'Say it in public. Stay private.',el('br'),link('Moderator preview','/moderation')));
  function closeMenu(){rail.classList.remove('open');rail.inert=narrowScreen.matches;document.querySelector('.workspace').inert=false;menuButton.setAttribute('aria-expanded','false');menuButton.focus();}
  const menuButton=button(createIcon('menu'),()=>{rail.inert=false;rail.classList.add('open');document.querySelector('.workspace').inert=true;menuButton.setAttribute('aria-expanded','true');rail.querySelector('a').focus();},'menu-toggle',{'aria-label':'Open navigation','aria-expanded':'false'});
  rail.inert=narrowScreen.matches;
  rail.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();if(e.key==='Tab'&&rail.classList.contains('open')){const targets=[...rail.querySelectorAll('a,button')];const first=targets[0],last=targets.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
  const currentTopic=board(route.split('/')[2]);
  const stateSelect=el('select',{'aria-label':'Preview feed state',onChange:e=>{previewState=e.target.value;render();announce(`Showing ${previewState} preview state.`);document.querySelector('[aria-label="Preview feed state"]')?.focus();}},['normal','loading','empty','pending','failure'].map(s=>el('option',{value:s,...(previewState===s?{selected:true}:{})},s[0].toUpperCase()+s.slice(1))));
  const aside=el('aside',{class:'aside','aria-label':'Community context'},el('section',{class:'context-panel'},el('div',{class:'context-title'},el('span',{class:'board-tile lilac','aria-hidden':'true'},createIcon('message')),el('h2',{},'Make yourself at home.')),el('p',{},'Read freely. Join a conversation under a name you choose, or as Anonymous.'),button('Join the conversation',onboard,'button primary')),el('section',{class:'context-panel'},el('h2',{},createIcon('shield'),currentTopic?'Before you post':'A shared foundation'),el('ol',{},mainRules.map(r=>el('li',{},r))),currentTopic?rules(currentTopic):link('About the main board','/board/main')),el('section',{class:'context-panel context-help'},el('h2',{},createIcon('sparkle'),'Meet Bok'),el('p',{},'Bok is the AI assistant in every thread. Mention @bok, set a spending limit, and pay only for the work it does.')),el('section',{class:'context-panel'},el('h2',{},createIcon('compass'),'Find your people'),boards.filter(b=>b.curated).map(b=>link([tile(b),el('span',{},b.name,el('small',{},b.id==='building'?'Make something together':b.id==='ideas'?'A little room to wonder':'Everyday conversations'))],`/board/${b.id}`,{class:'topic-link'})),link('Browse every subboard','/directory')),el('label',{class:'state-control'},'Design review: feed states',stateSelect),el('p',{class:'footer-note'},'Fixture content. Likes, follows and bookmarks are local previews and reset on reload. No wallet, prover or model is connected.'));
  app.replaceChildren(el('div',{class:'shell'},el('header',{class:'topbar'},menuButton,link(createBrand(),'/home',{class:'brand'}),link([createIcon('search'),'Search all subboards…'],'/directory',{class:'search-link'}),el('div',{class:'topbar-actions'},button([createIcon('user'),el('span',{class:'label'},'Get started')],onboard,'button primary',{'aria-label':'Get started'}))),el('div',{class:'shell-body'},rail,el('div',{class:'workspace'},el('div',{class:'preview-banner'},el('span',{},'Design preview · fictional content and local actions only'),link('Account preview','/balances')),el('div',{class:'layout'},el('main',{id:'content',tabindex:'-1'},page()),aside)))));
  document.title=`${document.querySelector('h1')?.textContent||'rollingchat'} · rollingchat preview`;
}
window.addEventListener('hashchange',()=>{
  positions.set(route,{y:scrollY,limit,focus:document.activeElement?.getAttribute('href')});
  route=location.hash.slice(1)||'/home';limit=positions.get(route)?.limit||6;previewState='normal';render();
  if(!history.state?.rolling)history.replaceState({rolling:true},'');
  requestAnimationFrame(()=>focusRoute(route, positions.get(route)));
});
narrowScreen.addEventListener('change',()=>render());
render();
requestAnimationFrame(()=>focusRoute(route, undefined, true));
