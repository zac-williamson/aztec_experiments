import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/app-env.js',import.meta.url),'utf8');
test('legacy RPC_CONFIG has no endpoint or credential authority and fetch stays untouched',async()=>{
 const calls=[],fetch=async(input,init)=>{calls.push({input,init});return {};};
 const window={RPC_CONFIG:{nodeUrl:'https://unselected.example/',ethRpcUrl:'https://wrong.example/',apiKey:'private-marker'},fetch};
 const c=vm.createContext({window,URL,Headers,Request,document:{getElementById:()=>null}});vm.runInContext(source,c);
 c.setupRpcAuth();c.setupRpcAuth();assert.equal(window.fetch,fetch);assert.equal(c._getApiKey(),'');assert.throws(()=>c._getNodeUrl(),/Import/);assert.throws(()=>c._getEthRpcUrl(),/Import/);
 for(const input of ['https://unselected.example/',new URL('https://elsewhere.example/'),new Request('https://elsewhere.example/')]){await window.fetch(input);assert.equal(calls.at(-1).input,input);assert.equal(calls.at(-1).init,undefined);}
 const options={credentials:'omit',referrerPolicy:'no-referrer',headers:{'content-type':'application/json'}};await window.fetch('https://unselected.example/',options);assert.equal(calls.at(-1).init,options);assert.equal(new Headers(options.headers).has('x-aztec-api-key'),false);
});
