// Mark only this application's history entries. history.length also counts
// unrelated sites, so it cannot tell a directly opened conversation where to go.
export function createConversationNavigation(browser = window) {
  const key = 'rollingNavigation';
  let index = 0, returning = false;
  const record = (initial = false) => {
    const saved = browser.history.state?.[key];
    index = saved?.hash === browser.location.hash && Number.isSafeInteger(saved.index) && saved.index >= 0
      ? saved.index : initial ? 0 : index + 1;
    browser.history.replaceState({...browser.history.state, [key]: {index, hash: browser.location.hash}}, '');
    returning = false;
  };
  record(true);
  return {
    changed: () => record(),
    back() {
      if (returning) return;
      returning = true;
      if (index > 0) browser.history.back();
      else browser.location.replace('#/home');
    }
  };
}

// Keep a public post and its viewport offset, rather than only a pixel position
// in a feed that may have gained newer rows while another route was open.
export function captureRoutePosition(pages, browser = window) {
  const {document}=browser, focused=document.activeElement;
  const visible=[...document.querySelectorAll('.feed article[id]')].find(node=>{
    const box=node.getBoundingClientRect();return box.bottom>0&&box.top<browser.innerHeight;
  });
  return {y:browser.scrollY,pages,focus:focused?.getAttribute('href'),focusPost:focused?.closest('article[id]')?.id,
    ...(visible?{anchor:{id:visible.id,offset:visible.getBoundingClientRect().top}}:{})};
}

// Shared by fresh loads and hash navigation, so stable links use one focus policy.
export function focusRoute(route, savedPosition, initial = false, browser = window) {
  const {document} = browser;
  if (savedPosition) {
    const anchor=savedPosition.anchor&&document.getElementById(savedPosition.anchor.id);
    if(savedPosition.anchor&&!anchor){
      browser.scrollTo(0,0);document.querySelector('h1')?.focus({preventScroll:true});
      const status=document.getElementById('announcement');if(status)status.textContent='The previously visible post is no longer available in this feed.';
      return;
    }
    browser.scrollTo(0,anchor?browser.scrollY+anchor.getBoundingClientRect().top-savedPosition.anchor.offset:savedPosition.y);
    if (savedPosition.focus) {
      const scope=savedPosition.focusPost?document.getElementById(savedPosition.focusPost):document;
      [...(scope?.querySelectorAll('a')??[])].find(a => a.getAttribute('href') === savedPosition.focus)?.focus({preventScroll:true});
    }
    return;
  }
  const focusPost = route.startsWith('/thread/') ? route.split('/')[3] : null;
  if (focusPost) {
    const target = document.getElementById(`post-${focusPost}`);
    if (target) {
      target.tabIndex = -1;
      target.focus({preventScroll:true});
      target.scrollIntoView({block:'center'});
      return;
    }
  }
  // Preserve ordinary initial tab order, including the skip link, on page loads.
  if (!initial) {
    browser.scrollTo(0, 0);
    document.querySelector('h1')?.focus({preventScroll:true});
  }
}
export function skipToContent(event, document = window.document) {
  event.preventDefault();
  document.getElementById('content')?.focus();
}

// Called once for the submitted transaction after its actual row is connected.
export function revealIncludedPost({id,txHash},browser=window){
 if(typeof id!=='string'||!/^(0|[1-9][0-9]{0,76})$/.test(id)||!/^0x[0-9a-f]{64}$/.test(txHash))return false;
 const node=browser.document.getElementById('post-'+id);
 if(!node?.isConnected||node.getAttribute('data-tx-hash')!==txHash||browser.document.querySelector('dialog[open]')||!node.getClientRects().length||node.checkVisibility?.({visibilityProperty:true,opacityProperty:true})===false)return false;
 node.tabIndex=-1;node.focus({preventScroll:true});
 const rect=node.getBoundingClientRect();
 if(rect.top<0||rect.bottom>browser.innerHeight)node.scrollIntoView({block:'nearest'});
 return true;
}
