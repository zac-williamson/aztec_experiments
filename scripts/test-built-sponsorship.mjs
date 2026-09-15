// Inspect actual generated consumers; no live wallet, RPC or proof is substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const canonical=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/sponsor_artifact.json',import.meta.url)));
for(const name of ['user','censor','deploy','fee-juice']) test(`${name} generated page binds the canonical sponsor and isolated RPC credential`,async()=>{
  const html=fs.readFileSync(new URL(`../apps/dist/${name}.html`,import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  for(const source of scripts)new vm.Script(source);
  if(name!=='fee-juice'){
  const artifacts=scripts.filter(source=>source.includes('const BILLBOARD_SPONSOR_ARTIFACT ='));
  assert.equal(artifacts.length,1);
  const artifactContext=vm.createContext({});vm.runInContext(artifacts[0],artifactContext);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(BILLBOARD_SPONSOR_ARTIFACT)',artifactContext)),canonical);
  }
  const wrappers=scripts.filter(source=>source.includes('function setupRpcAuth()'));
  assert.equal(wrappers.length,1);
  const calls=[];const window={location:{href:'https://board.example/'},
    RPC_CONFIG:{nodeUrl:'https://rpc.example/rpc',apiKey:'public-test-marker'},
    fetch:async(input,init)=>{calls.push({input,init});return {};}};
  const context=vm.createContext({window,URL,Request,Headers});vm.runInContext(wrappers[0],context);
  vm.runInContext('setupRpcAuth()',context);
  await window.fetch('https://rpc.example/rpc');assert.equal(calls.at(-1).init.headers.get('x-aztec-api-key'),'public-test-marker');
  assert.equal(calls.at(-1).init.redirect,'error');
  await window.fetch('https://rpc.example/issuer/submit');assert.equal(calls.at(-1).init,undefined);
  await window.fetch('https://other.example/?aztec-labs.com');assert.equal(calls.at(-1).init,undefined);
});
