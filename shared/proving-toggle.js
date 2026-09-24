// View adapter only. No operation state or wallet lifecycle is owned here.
(function bindRemoteProving(){
  const toggle=document.getElementById('remoteProving');if(!toggle)return;
  const preference=window.BillboardProving;
  const render=()=>{
    const available=!!window.billboardConfigStore?.snapshot().config?.remoteProver?.url;
    toggle.checked=available&&preference.snapshot()==='remote';
    toggle.disabled=!available;
    toggle.title=available?'Use this board’s prover for the next operation. Changes do not affect an operation already in progress. Private witness data is shared with its operator.':'This board has not configured a remote prover.';
    toggle.setAttribute('aria-description',toggle.title);
  };
  toggle.addEventListener('change',()=>preference.setMode(toggle.checked?'remote':'local'));
  preference.subscribe(render);
  window.billboardConfigStore?.subscribe(render);
  render();
})();
