(function(root){
  'use strict';
  function mount(container,store){
    const api=root.BillboardConfig,doc=container.ownerDocument;
    const panel=doc.createElement('section');panel.setAttribute('aria-label','Board configuration');
    function element(tag,text){const node=doc.createElement(tag);if(text)node.textContent=text;panel.append(node);return node;}
    element('h2','Board configuration');
    element('p','Import public connection settings for this board. Never paste a wallet backup, password, recovery claim or RPC API key. Endpoints can observe connection metadata; do not share URLs containing secret path tokens.');
    const summary=element('p'),status=element('p');status.setAttribute('role','status');
    const label=element('label','Public configuration JSON');const input=doc.createElement('textarea');input.rows=7;input.maxLength=api.MAX_BYTES;label.append(input);
    const fileLabel=element('label','Choose configuration file');const file=doc.createElement('input');file.type='file';file.accept='.json,application/json';fileLabel.append(file);
    function button(text,action){const b=element('button',text);b.type='button';b.addEventListener('click',action);return b;}
    let destroyed=false;
    const imported=button('Import configuration',()=>{try{store.install(api.parse(input.value));input.value='';status.textContent=store.snapshot().error??'Public configuration imported. Live network checks run when connecting.';}catch(error){status.textContent=error.message;}});
    file.addEventListener('change',async()=>{const chosen=file.files?.[0];if(!chosen)return;const snapshot=store.snapshot();imported.disabled=true;try{if(chosen.size>api.MAX_BYTES)throw new Error('Configuration exceeds size limit');const text=await chosen.text();if(destroyed)return;if(store.snapshot()!==snapshot)throw new Error('Configuration changed while reading file; select it again');store.install(api.parse(text));input.value='';status.textContent=store.snapshot().error??'Public configuration imported. Live network checks run when connecting.';}catch(error){if(!destroyed)status.textContent=error.message;}finally{if(!destroyed){imported.disabled=false;file.value='';}}});
    const exported=button('Export configuration',()=>{const {config}=store.snapshot();if(!config)return;const url=URL.createObjectURL(new Blob([JSON.stringify(config,null,2)+'\n'],{type:'application/json'}));const anchor=doc.createElement('a');anchor.href=url;anchor.download='board-public-config.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),0);});
    button('Clear configuration',()=>{store.clear();input.value='';});
    function render(snapshot){const c=snapshot.config;exported.disabled=!c;
      summary.textContent=c?`Ethereum chain ${c.network.chainId}; rollup version ${c.network.rollupVersion}. Board ${c.board.contractAddress}. Portal ${c.board.portalAddress}. Node ${c.network.nodeUrl}. Ethereum RPC ${c.network.ethRpcUrl}. ${c.privateFee?`Private fee contract ${c.privateFee.contractAddress}. Reservation ceiling ${api.maximumFee(c)} Fee Juice base units per transaction. Unused reserved credit is returned privately.`:'Public reading only: private fee settings are missing; wallet actions are unavailable.'} Imported settings are not proof of live chain verification.`:'No board configuration selected. Import settings to connect.';
      status.textContent=snapshot.error??(snapshot.persisted?'Public settings are saved for this browser origin.':'');
    }
    const unsubscribe=store.subscribe(render);render(store.snapshot());container.append(panel);
    return {destroy(){destroyed=true;unsubscribe();panel.remove();}};
  }
  root.BillboardConfigUI=Object.freeze({mount});
})(globalThis);
