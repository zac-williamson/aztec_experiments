// Test-only observation. Preserve the real simulation result/error and record no
// private diagnostics; the application intentionally redacts errors before UI.
export async function observeUnfundedRejection(page) {
 await page.evaluate(()=>{
  const prototype=window.__aztec.BaseWallet.prototype,simulate=prototype.simulateViaEntrypoint;
  const observe=error=>{if(/Fund plugin account first/.test(error?.message??''))window.__pluginInsufficientBalance=true;};
  prototype.simulateViaEntrypoint=async function(...args){
   try{const result=await simulate.apply(this,args);observe(result.publicOutput?.revertReason);return result;}
   catch(error){observe(error);throw error;}
  };
 });
}
