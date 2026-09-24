// Application preference, independent of views, wallet identity and board state.
// Each operation samples this once. Changes affect only subsequent operations.
function createProvingPreference() {
  let mode='remote';
  const listeners=new Set();
  return Object.freeze({
    snapshot:()=>mode,
    setMode(next) {
      if(next!=='local'&&next!=='remote')throw new Error('Invalid proving mode.');
      if(mode===next)return;
      mode=next;
      for(const listener of listeners)listener(mode);
    },
    subscribe(listener) {listeners.add(listener);return ()=>listeners.delete(listener);},
  });
}
window.BillboardProving=createProvingPreference();
