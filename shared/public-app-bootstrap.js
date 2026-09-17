// Public settings only. No network or wallet action occurs during bootstrap.
(function(root){
  let storage;try{storage=root.localStorage;}catch{}
  root.billboardConfigStore=root.BillboardConfig.createStore({storage:storage||null,eventTarget:root});
  const mount=()=>{
    if(document.getElementById('deploymentManifest'))return;
    const container=document.createElement('div');container.id='boardConfiguration';container.className='card';
    document.body.prepend(container);root.BillboardConfigUI.mount(container,root.billboardConfigStore);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(globalThis);
