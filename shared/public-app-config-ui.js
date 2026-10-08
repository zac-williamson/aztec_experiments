(function(root){
  'use strict';
  function mount(container,store){
    const api=root.BillboardConfig,doc=container.ownerDocument;
    const panel=doc.createElement('section');panel.setAttribute('aria-label','Board configuration');
    function element(tag,text){const node=doc.createElement(tag);if(text)node.textContent=text;panel.append(node);return node;}
    element('h2','Select a board');
    element('p','Paste a board link or choose its public configuration file.');
    const summary=element('p'),status=element('p');status.setAttribute('role','status');
    const label=element('label','Public configuration JSON');const input=doc.createElement('textarea');input.rows=7;input.maxLength=api.MAX_BYTES;label.append(input);
    const advanced=doc.createElement('details'),advancedTitle=doc.createElement('summary');advancedTitle.textContent='Advanced connection settings';advanced.append(advancedTitle,label);panel.append(advanced);
    const fileLabel=element('label','Choose configuration file');const file=doc.createElement('input');file.type='file';file.accept='.json,application/json';fileLabel.append(file);
    function button(text,action){const b=element('button',text);b.type='button';b.addEventListener('click',action);return b;}
    let destroyed=false;
    const linkLabel=element('label','Board link'),boardLink=doc.createElement('input');boardLink.type='url';boardLink.placeholder='https://…';linkLabel.append(boardLink);
    const openLink=button('Use board link',async()=>{const selected=store.snapshot();openLink.disabled=true;try{if(!boardLink.value.trim())throw Object.assign(Error(),{code:'BB_BOARD_LINK_INVALID'});const result=await root.loadHostedBoard(boardLink.value.trim());if(destroyed)return;if(store.snapshot()!==selected)throw Error('Selection changed');store.install(result.config);status.textContent='Board selected.';}catch(error){if(!destroyed)status.textContent=root.boardConnectionFailure(error).message;}finally{if(!destroyed)openLink.disabled=false;}});
    const imported=button('Import configuration',()=>{try{store.install(api.parse(input.value));input.value='';status.textContent=store.snapshot().error??'Public configuration imported. Live network checks run when connecting.';}catch(error){status.textContent=error.message;}});
    advanced.append(imported);
    file.addEventListener('change',async()=>{const chosen=file.files?.[0];if(!chosen)return;const snapshot=store.snapshot();imported.disabled=true;try{if(chosen.size>api.MAX_BYTES)throw new Error('Configuration exceeds size limit');const text=await chosen.text();if(destroyed)return;if(store.snapshot()!==snapshot)throw new Error('Configuration changed while reading file; select it again');store.install(api.parse(text));input.value='';status.textContent=store.snapshot().error??'Public configuration imported. Live network checks run when connecting.';}catch(error){if(!destroyed)status.textContent=error.message;}finally{if(!destroyed){imported.disabled=false;file.value='';}}});
    const exported=button('Export configuration',()=>{const {config}=store.snapshot();if(!config)return;const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}));const anchor=doc.createElement('a');anchor.href=url;anchor.download='board-public-config.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
    button('Clear configuration',()=>{store.clear();input.value='';});
    function render(snapshot){const c=snapshot.config;exported.disabled=!c;
      summary.textContent=c?'Selected board '+c.board.contractAddress.slice(2,8)+(c.privateFee?' · Posting configured.':' · Reading only.'): 'No board selected.';
      status.textContent=snapshot.error??(c?(snapshot.persisted?'Board selection saved on this device.':'Board selected for this page.'):'');
    }
    const unsubscribe=store.subscribe(render);render(store.snapshot());container.append(panel);
    return {destroy(){destroyed=true;unsubscribe();panel.remove();}};
  }
  root.BillboardConfigUI=Object.freeze({mount});
})(globalThis);
