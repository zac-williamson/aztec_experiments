let connection=null,cursor=null,busy=false,generation=0;
const element=id=>document.getElementById(id);
function render(posts,append){
 if(!append)element('messages').replaceChildren();
 for(const p of posts){const article=document.createElement('article');article.className='card';const label=document.createElement('p');label.textContent=(p.pluginReply?'Bot reply · ':'')+'#'+p.orderIndex;article.append(label);
 const text=document.createElement('p');text.textContent=p.flagged?'Message removed by moderator.':p.text;article.append(text);
 if(p.flagged){const reason=document.createElement('p');reason.textContent='Reason: '+p.flag.reason;article.append(reason);}
 element('messages').append(article);}
}
function resetConnection(){element('post-link').removeAttribute('href');element('post-link').hidden=true;element('board-link').removeAttribute('href');element('board-link').hidden=true;connection=null;cursor=null;busy=false;element('messages').replaceChildren();element('more').hidden=true;element('refresh').hidden=true;element('connect').hidden=true;}
async function refresh(append=false){
 if(busy||!connection)return;busy=true;const selected=connection;
 try{
  const progress=append?null:await selected.feed.sync(),page=await selected.feed.page({limit:50,cursor:append?cursor:null});
  if(connection!==selected)return;
  cursor=page.nextCursor;render(page.posts,append);
  element('more').hidden=!cursor;element('refresh').hidden=false;
  element('status').textContent=progress&&!progress.complete?'Loading older history. Refresh to continue.':element('messages').children.length?'Messages loaded.':'No messages yet.';
 }catch(error){
  if(connection===selected){
   if(error.code==='PUBLIC_FEED_CONFLICT'){connection=null;element('more').hidden=true;element('refresh').hidden=true;}
   element('connect').hidden=false;element('status').textContent='Could not update messages. Try again.';
  }
 }finally{if(connection===selected)busy=false;}
}
async function openBoard(){
 const selected=++generation;resetConnection();busy=true;element('status').textContent='Loading messages…';
 try{
  const result=await loadHostedBoard();
  if(selected!==generation)return;
  connection=result;
  const link=new URL(location.href);link.hash=result.fragment;
  history.replaceState(null,'',link);element('board-link').href=link.href;element('board-link').hidden=false;
  if(result.config.privateFee){const postLink=new URL('user.html',location.href);postLink.hash=result.fragment;element('post-link').href=postLink.href;element('post-link').hidden=false;}
 }catch{
  if(selected===generation){element('status').textContent='Could not load this board. Try again.';element('connect').hidden=false;}
 }finally{if(selected===generation)busy=false;}
 if(selected===generation&&connection)await refresh();
}
element('connect').onclick=openBoard;element('more').onclick=()=>refresh(true);element('refresh').onclick=()=>refresh();
window.addEventListener('hashchange',openBoard);
openBoard();
