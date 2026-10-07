// Shared presentation of verified public board data. No wallet or SDK dependencies.
(function(root){
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  function url(page,fragment=location.hash){const target=new URL(page,location.href);target.hash=fragment;return target;}
  function header({title='Message board',section='Read'}={}){
    const head=el('header',undefined,'site-header');head.id='siteHeader';
    const brand=el('a','Message boards','brand');brand.href='boards.html';
    const nav=el('nav');nav.setAttribute('aria-label','Main navigation');
    for(const [label,page]of [['Read','feed.html'],['Write','user.html']]){const link=el('a',label);link.href=url(page);link.dataset.boardLink='';if(label===section)link.setAttribute('aria-current','page');nav.append(link);}
    const share=el('button','Copy board link','secondary');share.type='button';share.onclick=async()=>{const target=url('feed.html');target.search='';try{await navigator.clipboard.writeText(target.href);share.textContent='Link copied';}catch{share.textContent='Copy unavailable';}};nav.append(share);
    const account=el('div');account.id='accountSlot';head.append(brand,nav,account);document.body.prepend(head);
    const notice=el('p','Testnet · Test funds only','testnet-notice');head.after(notice);
    document.querySelector('h1')?.replaceChildren(document.createTextNode(title));return head;
  }
  function identity(config){
    const address=config?.board?.contractAddress;if(!address)return;
    const notice=document.querySelector('.testnet-notice');if(notice)notice.textContent=String(config.network.chainId)==='11155111'?'Testnet · Test funds only':String(config.network.chainId)==='1'?'Ethereum mainnet':'Ethereum network '+config.network.chainId;
    const name='Board '+address.slice(2,8);const heading=document.querySelector('[data-board-title]');if(heading)heading.textContent=name;
    document.title=name+' · Message board';
    root.BillboardCatalog?.load(config.network).then(labels=>{const label=labels.find(x=>x.address===address);if(label&&heading){heading.textContent=label.name;document.title=label.name;}}).catch(()=>{});
    for(const anchor of document.querySelectorAll('[data-board-link]'))anchor.href=url(anchor.getAttribute('href'),location.hash);
  }
  function renderMessages(container,posts,{append=false,onModerate}={}){
    const previous=new Map([...container.querySelectorAll('article[data-post-id]')].map(node=>[node.dataset.postId,node]));
    const nodes=[];
    for(const post of posts){
      const signature=JSON.stringify([post.text,post.flagged,post.flag?.reason,post.publishedAt,Boolean(onModerate)]);let article=previous.get(post.postId);
      if(!article||article.dataset.signature!==signature){
        article=el('article',undefined,'message');article.dataset.postId=post.postId;article.dataset.signature=signature;article.id='message-'+post.postId;
        const meta=el('div',undefined,'message-meta'),time=el('time');const seconds=Number(post.publishedAt);
        if(Number.isSafeInteger(seconds)&&seconds>0){const date=new Date(seconds*1000);time.dateTime=date.toISOString();time.textContent=date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}else time.textContent='Publication time unavailable';
        const link=el('a','Link');const target=url('feed.html');target.searchParams.set('message',post.postId);link.href=target;link.setAttribute('aria-label','Link to message '+post.orderIndex);
        meta.append(time,link);article.append(meta,el('p',post.flagged?'Message removed by moderator.':post.text,'message-text'));
        if(post.flagged){article.append(el('p','Reason: '+(post.flag?.reason||'No reason supplied'),'small'));if(onModerate){const original=el('details');original.append(el('summary','Show removed message'),el('p',post.text,'message-text'));article.append(original);}}
        if(onModerate&&!post.flagged){const button=el('button','Moderate','secondary');button.onclick=()=>onModerate(post);article.append(button);}
      }
      nodes.push(article);
    }
    if(append){for(const node of nodes)if(!previous.has(node.dataset.postId))container.append(node);}
    else {const active=document.activeElement,card=active?.closest('article[data-post-id]'),focusIndex=card?[...card.querySelectorAll('a,button,summary')].indexOf(active):-1;container.replaceChildren(...nodes);if(active?.isConnected)active.focus({preventScroll:true});else if(card){const replacement=nodes.find(node=>node.dataset.postId===card.dataset.postId);const target=replacement?.querySelectorAll('a,button,summary')[focusIndex]||replacement?.querySelector('a');target?.focus({preventScroll:true});}}
    if(!container.children.length)container.append(el('p','No messages yet. Be the first to write one.','empty-state'));
  }
  function rules(container,policies){const text=policies?.at(-1)?.text;container.hidden=!text;if(text){let body=container.querySelector('[data-rules-text]');if(!body){container.replaceChildren(el('summary','Board rules'));body=el('p',undefined,'policy-text');body.dataset.rulesText='';container.append(body);}body.textContent=text;}}
  function bindOperation(application,container){
    const status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const hint=el('p',undefined,'small');const pause=el('button','Pause and continue later','secondary');pause.onclick=()=>{if(application.requestPause()){pause.disabled=true;pause.textContent='Pausing…';}};const details=el('details');details.append(el('summary','Details'));
    const elapsed=el('p',undefined,'small'),history=el('ol');history.setAttribute('aria-label','Operation stages reached');let current=null;const showElapsed=()=>{elapsed.textContent=current?.startedAt?'Elapsed: '+Math.floor(((current.endedAt||Date.now())-current.startedAt)/1000)+' seconds':'';};const timer=setInterval(showElapsed,1000);
    const report=el('pre'),copy=el('button','Copy diagnostic report','secondary');copy.type='button';copy.onclick=async()=>{await navigator.clipboard.writeText(application.diagnosticReport());copy.textContent='Copied';};details.append(history,report,copy);container.replaceChildren(status,hint,elapsed,pause,details);
    const unsubscribe=application.subscribe(state=>{current=state;showElapsed();history.replaceChildren(...(state.history||[]).map(stage=>el('li',root.BillboardOperations?.stages[stage]||stage)));pause.hidden=!['bridge','settlement','screening'].includes(state.stage)||!['working','waiting'].includes(state.status);if(pause.hidden){pause.disabled=false;pause.textContent='Pause and continue later';}container.hidden=state.status==='idle';status.textContent=state.message;status.className=state.status==='failed'?'error':state.status==='complete'?'success':'';
      hint.textContent=state.stage==='bridge'?'Your payment is confirmed. Setup continues automatically when the network is ready.':state.stage==='queued'?'Your request is accepted. It starts when the board’s prover is free.':state.stage==='proving'?'Proof generation can take several minutes. '+(state.mode==='remote'?'Using this board’s prover.':'Using this device.') :state.stage==='settlement'?'Your withdrawal is recorded. This can take longer than posting; we will ask for the final wallet approval when it is ready.':'';
      report.textContent=application.diagnosticReport();copy.textContent='Copy diagnostic report';});return()=>{clearInterval(timer);unsubscribe();};
  }
  root.BillboardView=Object.freeze({header,identity,renderMessages,rules,bindOperation,url,element:el});
})(globalThis);
