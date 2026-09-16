let connection=null,cursor=null,busy=false;
const element=id=>document.getElementById(id);
function render(posts,append){
 if(!append)element('messages').replaceChildren();
 for(const p of posts){const article=document.createElement('article');article.className='card';const label=document.createElement('p');label.textContent='#'+p.orderIndex;article.append(label);
 const text=document.createElement('p');text.textContent=p.text;
 if(p.flagged){const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Flagged message — show content';detail.append(summary,text);const reason=document.createElement('p');reason.textContent='Reason: '+p.flag.reason;detail.append(reason);article.append(detail);}else article.append(text);
 element('messages').append(article);}
}
async function refresh(append=false){if(busy||!connection)return;busy=true;try{
 const progress=append?null:await connection.feed.sync(),page=await connection.feed.page({limit:50,cursor:append?cursor:null});cursor=page.nextCursor;render(page.posts,append);
 element('more').hidden=!cursor;element('refresh').hidden=false;element('status').textContent=progress&&!progress.complete?'Loading history through block '+progress.lastBlock+'. Refresh to continue.':'Public messages through block '+page.lastBlock+'.';
}catch(error){element('status').textContent=error.code==='BB_PUBLIC_FEED_CURSOR_STALE'?'The chain changed. Refresh to restart pagination.':'Could not update messages. Previously displayed data may be stale; retry.';}finally{busy=false;}}
element('connect').onclick=async()=>{if(busy)return;busy=true;try{connection=await BillboardPublic.connectPublicFeed({portalAddress:element('portal').value.trim(),nodeUrl:element('node').value.trim(),ethereumUrl:element('ethereum').value.trim(),metadata:BillboardPublic.metadata,storage:BillboardPublic.browserPublicFeedStorage()});cursor=null;}catch{connection=null;element('status').textContent='Could not verify this board. Check the address and endpoints.';}finally{busy=false;}await refresh();};
element('more').onclick=()=>refresh(true);element('refresh').onclick=()=>refresh();
const query=new URLSearchParams(location.search);if(query.has('portal'))element('portal').value=query.get('portal');
