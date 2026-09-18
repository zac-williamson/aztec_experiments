import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {BackendType} from '@aztec/bb.js';
const source=await fs.readFile(new URL('../shared/private-pxe.mjs',import.meta.url),'utf8');
function fixture(){
 let singleton,configured,initializations=0,fail=false;const calls=[];
 class Prover{constructor(simulator,options){this.simulator=simulator;this.options=options;}}
 class Simulator{}
 const context=vm.createContext({Buffer,BackendType,BBLazyPrivateKernelProver:Prover,WASMSimulator:Simulator,ChonkProofWithPublicInputs:{},proveBrowserChonk(){},Barretenberg:{async initSingleton(options){return singleton??=( {options} );}},createSdkPXE:async(node,config,options)=>{calls.push({node,config,options});return options;}});
 context.BillboardCRS={async initialize(bb,options){initializations++;configured=options;assert.equal(bb,singleton);assert.equal(options.bn254NumPoints,524288);await assert.rejects(options.fetch());if(fail)throw Error('private local path');const bytes=await options.loadLocal({name:'verified-test-file'});assert.equal(await options.sha256(bytes),'verified-hash');}};
 vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/export /g,''),context);
 return {context,calls,get configured(){return configured;},get initializations(){return initializations;},fail(){fail=true;},replace(){singleton=undefined;},wrong(){singleton={options:{backend:BackendType.WasmWorker,threads:2,skipSrsInit:false}};},input:{manifest:{fixture:true},loadLocal:async()=>new Uint8Array([1]),sha256:async()=> 'verified-hash'}};
}
test('Node proving fails closed before initialization and rejects backend/custom prover overrides',async()=>{
 const f=fixture();await assert.rejects(f.context.createPXE({}, {proverEnabled:true}),e=>e.code==='BB_CLI_PROVER_CONFIGURATION');
 for(const extra of [{backend:BackendType.NativeUnixSocket},{proverOrOptions:{}},{threads:2}])await assert.rejects(f.context.initializeCliProver({...f.input,...extra}));assert.equal(f.initializations,0);assert.equal(f.calls.length,0);
});
test('verified CLI setup routes exact direct-WASM singleton through streaming prover and WASM simulator',async()=>{
 const f=fixture();const options=await f.context.initializeCliProver(f.input);assert.equal(options.backend,BackendType.Wasm);assert.equal(options.threads,1);assert.equal(options.skipSrsInit,true);
 const result=await f.context.createPXE({}, {proverEnabled:true});assert.equal(result.proverOrOptions.constructor.name,'BrowserPrivateKernelProver');assert.equal(result.simulator.constructor.name,'Simulator');assert.equal(result.proverOrOptions.options.backend,BackendType.Wasm);
 for(const extra of [{proverOrOptions:{}},{simulator:{}}])await assert.rejects(f.context.createPXE({}, {proverEnabled:true},extra));await assert.rejects(f.context.createPXE({}, {proverEnabled:true,proverOrOptions:{}}));
});
test('failed local verification, wrong existing backend and replaced singleton cannot prove',async()=>{
 const f=fixture();await f.context.initializeCliProver(f.input);f.fail();await assert.rejects(f.context.initializeCliProver(f.input),e=>e.code==='BB_CLI_PROVER_CONFIGURATION'&&!e.message.includes('private local'));await assert.rejects(f.context.createPXE({}, {proverEnabled:true}));
 const g=fixture();g.wrong();await assert.rejects(g.context.initializeCliProver(g.input));assert.equal(g.initializations,0);
 const h=fixture();await h.context.initializeCliProver(h.input);h.replace();await assert.rejects(h.context.createPXE({}, {proverEnabled:true}));assert.equal(h.calls.length,0);
});
test('Node read-only PXE retains SDK behavior without proving setup',async()=>{const f=fixture();await f.context.createPXE({}, {proverEnabled:false});assert.equal(f.calls.length,1);assert.equal(f.initializations,0);});
