// Inspect actual generated consumers; no live wallet, RPC or proof is substituted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const canonical=JSON.parse(fs.readFileSync(new URL('../apps/src/billboard/private_fee_artifact.json',import.meta.url)));
for(const name of ['user','censor','deploy','fee-juice']) test(`${name} generated page binds canonical fee artifact and public config without credential interception`,async()=>{
  const html=fs.readFileSync(new URL(`../apps/dist/${name}.html`,import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
  for(const source of scripts)new vm.Script(source);
  const artifacts=scripts.filter(source=>source.includes('const BILLBOARD_PRIVATE_FEE_ARTIFACT ='));assert.equal(artifacts.length,1);
  const artifactContext=vm.createContext({});vm.runInContext(artifacts[0],artifactContext);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(BILLBOARD_PRIVATE_FEE_ARTIFACT)',artifactContext)),canonical);
  const environments=scripts.filter(source=>source.includes('function setupRpcAuth()'));assert.equal(environments.length,1);
  const calls=[],fetch=async(input,init)=>{calls.push({input,init});return {};};
  const window={RPC_CONFIG:{nodeUrl:'https://rpc.example/rpc',apiKey:'private-test-marker'},fetch};
  const context=vm.createContext({window,URL,Request,Headers,document:{getElementById:()=>null}});vm.runInContext(environments[0],context);
  context.setupRpcAuth();assert.equal(window.fetch,fetch);assert.equal(context._getApiKey(),'');
  assert.throws(()=>context._getNodeUrl(),/Import/);
  await window.fetch('https://rpc.example/rpc');assert.equal(calls.at(-1).init,undefined);
  assert.match(environments[0],/window\.BillboardReadiness\.check\(\)/);
  assert.match(html,/BillboardConfig/);assert.match(html,/BillboardReadiness/);
  assert(!html.includes('window.RPC_CONFIG ='),'build must not embed credential configuration');
});
