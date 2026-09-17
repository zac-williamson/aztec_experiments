let connection=null,cursor=null,busy=false;
const element=id=>document.getElementById(id);
function render(posts,append){
 if(!append)element('messages').replaceChildren();
 for(const p of posts){const article=document.createElement('article');article.className='card';const label=document.createElement('p');label.textContent='#'+p.orderIndex;article.append(label);
 const text=document.createElement('p');text.textContent=p.text;
 if(p.flagged){const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Flagged message — show content';detail.append(summary,text);const reason=document.createElement('p');reason.textContent='Reason: '+p.flag.reason;detail.append(reason);article.append(detail);}else article.append(text);
 element('messages').append(article);}
}
function resetConnection(){connection=null;cursor=null;busy=false;element('messages').replaceChildren();element('more').hidden=true;element('refresh').hidden=true;element('status').textContent='Configuration changed. Open the configured board to verify its live state.';}
async function refresh(append=false){if(busy||!connection)return;busy=true;const snapshot=billboardConfigStore.snapshot(),selected=connection;try{
 const progress=append?null:await selected.feed.sync(),page=await selected.feed.page({limit:50,cursor:append?cursor:null});
 billboardConfigStore.assertCurrent(snapshot);if(connection!==selected)return;
 cursor=page.nextCursor;render(page.posts,append);
 element('more').hidden=!cursor;element('refresh').hidden=false;element('status').textContent=progress&&!progress.complete?'Loading history through block '+progress.lastBlock+'. Refresh to continue.':'Public messages through block '+page.lastBlock+'.';
}catch{if(billboardConfigStore.snapshot()===snapshot)element('status').textContent='Could not update messages. Previously displayed data may be stale; retry.';}finally{if(billboardConfigStore.snapshot()===snapshot)busy=false;}}
element('connect').onclick=async()=>{if(busy)return;busy=true;const snapshot=billboardConfigStore.snapshot();try{
 const c=snapshot.config;if(!c)throw Error('Missing configuration');
 const result=await BillboardPublic.connectPublicFeed({portalAddress:c.board.portalAddress,nodeUrl:c.network.nodeUrl,ethereumUrl:c.network.ethRpcUrl,expectedConfig:c,metadata:BillboardPublic.metadata,storage:BillboardPublic.browserPublicFeedStorage()});
 billboardConfigStore.assertCurrent(snapshot);connection=result;cursor=null;
}catch{if(billboardConfigStore.snapshot()===snapshot){resetConnection();element('status').textContent='Could not verify this board. Check the imported configuration and endpoints.';}}finally{if(billboardConfigStore.snapshot()===snapshot)busy=false;}if(billboardConfigStore.snapshot()===snapshot)await refresh();};
element('more').onclick=()=>refresh(true);element('refresh').onclick=()=>refresh();
billboardConfigStore.subscribe(resetConnection);
