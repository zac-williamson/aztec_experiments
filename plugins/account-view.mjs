/** Presentation only: transactions and concurrency belong to the application. */
export function mountAccountPanel({container,application,formatError}) {
 const renderEnabled=()=>{const busy=['working','waiting'].includes(application.operation().status);for(const button of container.querySelectorAll('button'))button.disabled=busy||!application.connected;};
 container.addEventListener('click',event=>{const action=event.target.closest('[data-plugin-action]')?.dataset.pluginAction;if(action)pluginAccountAction(action);});
 const unsubscribe=application.subscribe(renderEnabled);
async function pluginAccountAction(action,extra={}) {
  const buttons=container.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);
  const status=container.querySelector('#pluginStatus');status.textContent='';delete status.dataset.outcome;
  try {
    const result=await application.pluginAccount(action,{handle:container.querySelector('#pluginHandle').value,amount:container.querySelector('#pluginAmount').value,...extra},message=>status.textContent=message);
    if(result.requests){
      const list=container.querySelector('#pluginRequestsList');list.replaceChildren();
      for(const request of result.requests){
        const row=document.createElement('p');
        row.textContent=request.postId.slice(0,12)+'… — '+request.status+'; charged '+(Number(request.charged)/1e6).toFixed(6)+' USDC; reserved '+(Number(request.reserved)/1e6).toFixed(6)+' USDC. ';
        if(request.deadline&&request.reserved!=='0')row.append('Release after '+new Date(request.deadline*1000).toLocaleString()+'. ');
        for(const [allowed,action,label]of [[request.canCancel,'cancel','Cancel'],[request.canRelease,'release','Release funds']]){
          if(!allowed)continue;const button=document.createElement('button');button.textContent=label;
          button.onclick=()=>pluginAccountAction(action,{postId:request.postId});row.append(button);
        }list.append(row);
      }
      if(result.nextCursor!==null){const more=document.createElement('button');more.textContent='Older requests';more.onclick=()=>pluginAccountAction('requests',{cursor:result.nextCursor});list.append(more);}
    }
    status.textContent=result.requests?'Request status read from Aztec':result.balance!==undefined?'Available: '+result.balance+' USDC':'Completed';status.dataset.outcome='success';
  }catch(error){status.textContent=formatError(error).message;status.dataset.outcome='error';}
  finally{renderEnabled();}

}

 return unsubscribe;
}
