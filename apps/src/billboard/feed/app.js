const view=BillboardView,element=id=>document.getElementById(id);
view.header({section:'Read'});
let connection=null,cursor=null,busy=false,generation=0,signature='',older=false,targetResolved=false,historyComplete=false;
const target=new URL(location.href).searchParams.get('message');
async function refresh(append=false){
 if(busy||!connection)return;busy=true;const selected=connection;
 try{
  let progress;if(!append)progress=await selected.feed.sync();
  const page=await selected.feed.page({limit:50,cursor:append?cursor:null});if(connection!==selected)return;
  older=append||false;if(progress)historyComplete=progress.complete;cursor=page.nextCursor;view.renderMessages(element('messages'),page.posts,{append});view.rules(element('boardRules'),page.policies,selected.participation);if(!append)signature=JSON.stringify(page.posts);
  element('more').hidden=!cursor;element('refresh').hidden=true;element('status').textContent=progress&&!progress.complete?'Loading message history…':'';
  if(target&&!targetResolved){const found=document.getElementById('message-'+target);if(found){targetResolved=true;found.tabIndex=-1;found.focus({preventScroll:true});found.scrollIntoView({block:'center'});}else if(!cursor&&historyComplete)element('status').textContent='This message is not available on this board.';}
  if(progress&&!progress.complete)setTimeout(()=>{if(connection===selected)refresh();},1000);
  else if(target&&!targetResolved&&!document.getElementById('message-'+target)&&cursor)setTimeout(()=>{if(connection===selected)refresh(true);},0);
 }catch(error){if(connection!==selected)return;element('connect').hidden=false;element('status').textContent='Messages could not be updated. Your displayed messages are still available.';}
 finally{if(connection===selected)busy=false;}
}
async function openBoard(){
 const selected=++generation;view.identity(null);element('boardRules').hidden=true;element('availability').textContent='';element('more').hidden=true;element('refresh').hidden=true;connection=null;cursor=null;busy=false;older=false;targetResolved=false;signature='';historyComplete=false;element('messages').replaceChildren();element('connect').hidden=true;element('status').textContent='Loading messages…';
 try{const result=await loadHostedBoard();if(selected!==generation)return;connection=result;const canonical=new URL(location.href);canonical.hash=result.fragment;history.replaceState(null,'',canonical);view.identity(result.config);element('availability').textContent=result.config.privateFee?'':'This board is open for reading. Posting is not enabled by its operator.';await refresh();}
 catch(error){if(selected!==generation)return;const failure=boardConnectionFailure(error);element('status').textContent=failure.message;element('connect').hidden=!failure.retry;}
}
element('connect').onclick=openBoard;element('more').onclick=()=>refresh(true);element('refresh').onclick=()=>refresh();window.addEventListener('hashchange',openBoard);
setInterval(async()=>{
 if(!connection||busy||document.hidden||older)return;busy=true;const selected=connection;
 try{await selected.feed.sync();const page=await selected.feed.page({limit:50});if(connection!==selected)return;
   if(JSON.stringify(page.posts)!==signature){element('refresh').hidden=false;element('more').hidden=true;}
 }catch{if(connection===selected)element('status').textContent='Updates are temporarily unavailable.';}
 finally{if(connection===selected)busy=false;}
},15000);
openBoard();
