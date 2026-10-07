// View adapter only. No operation state or wallet lifecycle is owned here.
(function bindRemoteProving(){
  const toggle=document.getElementById('remoteProving');if(!toggle)return;
  const preference=window.BillboardProving;
  const render=()=>{
    const endpoint=window.billboardConfigStore?.snapshot().config?.remoteProver?.url;const available=!!endpoint;const host=available?new URL(endpoint,location.href).host:'';
    toggle.checked=available&&preference.snapshot()==='remote';
    toggle.disabled=!available;
    toggle.title=available?'Use this board’s prover for the next operation. Changes do not affect an operation already in progress. Private witness data is shared with its operator.':'This board has not configured a remote prover.';
    toggle.setAttribute('aria-description',toggle.title);
    const explanation=document.getElementById('provingExplanation');if(explanation)explanation.textContent=available?'The board’s server ('+host+') creates your proof and can see the private data needed to do so. Turn this off to prove on this device. Your signing keys stay here. Changes apply to your next operation.':'This board has no remote prover. Proofs are created on this device.';
  };
  toggle.addEventListener('change',()=>preference.setMode(toggle.checked?'remote':'local'));
  preference.subscribe(render);
  window.billboardConfigStore?.subscribe(render);
  render();
})();
