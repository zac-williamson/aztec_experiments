// Discovery owns injected-provider compatibility. Consumers use the selected
// EIP-1193 object and never read or replace the browser's global provider.
(function(root){
  // Official Phantom Connect SDK mark; embedded so discovery never fetches an icon.
  // https://github.com/phantom/phantom-connect-sdk/blob/main/packages/constants/src/icons.ts
  /* Phantom icon license:
   * MIT License
   *
   * Copyright (c) 2024 Phantom Technologies, Inc
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in all
   * copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   * SOFTWARE.
   */
  const phantomIcon="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTA4IiBoZWlnaHQ9IjEwOCIgdmlld0JveD0iMCAwIDEwOCAxMDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMDgiIGhlaWdodD0iMTA4IiByeD0iMjYiIGZpbGw9IiNBQjlGRjIiLz4KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik00Ni41MjY3IDY5LjkyMjlDNDIuMDA1NCA3Ni44NTA5IDM0LjQyOTIgODUuNjE4MiAyNC4zNDggODUuNjE4MkMxOS41ODI0IDg1LjYxODIgMTUgODMuNjU2MyAxNSA3NS4xMzQyQzE1IDUzLjQzMDUgNDQuNjMyNiAxOS44MzI3IDcyLjEyNjggMTkuODMyN0M4Ny43NjggMTkuODMyNyA5NCAzMC42ODQ2IDk0IDQzLjAwNzlDOTQgNTguODI1OCA4My43MzU1IDc2LjkxMjIgNzMuNTMyMSA3Ni45MTIyQzcwLjI5MzkgNzYuOTEyMiA2OC43MDUzIDc1LjEzNDIgNjguNzA1MyA3Mi4zMTRDNjguNzA1MyA3MS41NzgzIDY4LjgyNzUgNzAuNzgxMiA2OS4wNzE5IDY5LjkyMjlDNjUuNTg5MyA3NS44Njk5IDU4Ljg2ODUgODEuMzg3OCA1Mi41NzU0IDgxLjM4NzhDNDcuOTkzIDgxLjM4NzggNDUuNjcxMyA3OC41MDYzIDQ1LjY3MTMgNzQuNDU5OEM0NS42NzEzIDcyLjk4ODQgNDUuOTc2OCA3MS40NTU2IDQ2LjUyNjcgNjkuOTIyOVpNODMuNjc2MSA0Mi41Nzk0QzgzLjY3NjEgNDYuMTcwNCA4MS41NTc1IDQ3Ljk2NTggNzkuMTg3NSA0Ny45NjU4Qzc2Ljc4MTYgNDcuOTY1OCA3NC42OTg5IDQ2LjE3MDQgNzQuNjk4OSA0Mi41Nzk0Qzc0LjY5ODkgMzguOTg4NSA3Ni43ODE2IDM3LjE5MzEgNzkuMTg3NSAzNy4xOTMxQzgxLjU1NzUgMzcuMTkzMSA4My42NzYxIDM4Ljk4ODUgODMuNjc2MSA0Mi41Nzk0Wk03MC4yMTAzIDQyLjU3OTVDNzAuMjEwMyA0Ni4xNzA0IDY4LjA5MTYgNDcuOTY1OCA2NS43MjE2IDQ3Ljk2NThDNjMuMzE1NyA0Ny45NjU4IDYxLjIzMyA0Ni4xNzA0IDYxLjIzMyA0Mi41Nzk1QzYxLjIzMyAzOC45ODg1IDYzLjMxNTcgMzcuMTkzMSA2NS43MjE2IDM3LjE5MzFDNjguMDkxNiAzNy4xOTMxIDcwLjIxMDMgMzguOTg4NSA3MC4yMTAzIDQyLjU3OTVaIiBmaWxsPSIjRkZGREY4Ii8+Cjwvc3ZnPgo=";
  const announced=new Map(),subscribers=new Set();
  function notify(){for(const subscriber of subscribers)subscriber();}
  root.addEventListener('eip6963:announceProvider',event=>{
    const detail=event.detail,info=detail?.info,provider=detail?.provider;
    if(!info||typeof info.uuid!=='string'||!info.uuid||info.uuid.length>128||typeof info.name!=='string'||!info.name.trim()||info.name.length>128||typeof provider?.request!=='function')return;
    if(announced.has(info.uuid)||[...announced.values()].some(entry=>entry.provider===provider)||announced.size>=32)return;
    announced.set(info.uuid,Object.freeze({id:info.uuid,name:info.name,rdns:info.rdns,icon:typeof info.icon==='string'&&info.icon.length<131072&&/^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(info.icon)?info.icon:null,provider}));notify();
  });
  function list(){
    const choices=[...announced.values()];
    // Phantom documents its namespaced Ethereum provider for both the extension
    // and mobile browser. It must remain visible beside EIP-6963 wallets even
    // when it does not announce. Never select the Solana provider or overwrite
    // window.ethereum; signing uses this exact EIP-1193 transport.
    try{
      const provider=root.phantom?.ethereum;
      if(provider?.isPhantom===true&&typeof provider.request==='function'){
        const index=choices.findIndex(entry=>entry.provider===provider);
        if(index<0&&!choices.some(entry=>entry.id==='injected:phantom-ethereum'))choices.push(Object.freeze({id:'injected:phantom-ethereum',name:'Phantom',rdns:'app.phantom',icon:phantomIcon,provider}));
        else if(index>=0&&!choices[index].icon)choices[index]=Object.freeze({...choices[index],icon:phantomIcon});
      }
    }catch{ /* An unavailable injected namespace does not hide announced wallets. */ }
    // Retain the explicit legacy choice only without announcements. Avoid a
    // duplicate when Phantom also owns the legacy global.
    if(!announced.size)try{const provider=root.ethereum;if(typeof provider?.request==='function'&&!choices.some(entry=>entry.provider===provider))choices.push({id:'legacy',name:'Browser wallet (legacy)',provider});}catch{}
    return choices;
  }
  function refresh(){root.dispatchEvent(new Event('eip6963:requestProvider'));notify();}
  root.BillboardWalletProviders=Object.freeze({list,refresh,subscribe(listener){subscribers.add(listener);return()=>subscribers.delete(listener);}});
  refresh();
})(window);
