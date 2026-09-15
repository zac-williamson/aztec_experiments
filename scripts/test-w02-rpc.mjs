import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
for(const app of ['user','deploy'])test(`${app} CLI keeps RPC credentials at the exact configured endpoint`,async()=>{
 const source=fs.readFileSync(new URL(`../apps/src/billboard/${app}/cli.mjs`,import.meta.url),'utf8');
 const start=source.indexOf('function createCliRpcFetch('),end=source.indexOf('\nif',start);
 const c=vm.createContext({URL,Headers,Request});vm.runInContext(source.slice(start,end),c);
 const calls=[],fetch=c.createCliRpcFetch(async(url,options)=>{calls.push({url,options});},'https://rpc.example/rpc','test-api-key');
 await fetch('https://rpc.example/rpc',{headers:{Existing:'value'}});
 assert.equal(calls[0].options.headers.get('x-aztec-api-key'),'test-api-key');assert.equal(calls[0].options.redirect,'error');
 for(const url of ['https://rpc.example/elsewhere','https://evil.example/?next=rpc.example/rpc','https://rpc.example.evil.example/rpc'])await fetch(url);
 for(const call of calls.slice(1))assert.equal(call.options?.headers?.get?.('x-aztec-api-key'),undefined);
 await fetch('https://rpc.example/rpc',{credentials:'omit',referrerPolicy:'no-referrer'});
 assert.equal(calls.at(-1).options.headers,undefined);
});
