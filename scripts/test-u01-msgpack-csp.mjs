// Small codec-only browser build: no full SDK build, browser or prover process.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {build} from 'esbuild';
import {Encoder as Ordinary} from 'msgpackr';
const source=fs.readFileSync(new URL('./build-sdk.mjs',import.meta.url),'utf8');
const matched=source.match(/  alias: (\{[^\n]+\}),/);assert(matched,'Canonical SDK codec aliases must be present');
const alias=vm.runInNewContext('('+matched[1]+')');
const result=await build({stdin:{contents:"export {Encoder as Default} from 'msgpackr';export {Encoder as Pack} from 'msgpackr/pack';export {Decoder as Unpack} from 'msgpackr/unpack';export {Encoder as Direct} from 'msgpackr/index-no-eval';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Codec',alias,write:false,metafile:true});
const context=vm.createContext({Uint8Array,Uint16Array,Uint32Array,BigInt64Array,ArrayBuffer,DataView,Map,Set,Date,TextEncoder,TextDecoder,console},{codeGeneration:{strings:false,wasm:false}});
vm.runInContext(result.outputFiles[0].text,context);
const {Default,Pack,Unpack,Direct}=context.Codec;
// VM objects have distinct prototypes; preserve value and container/type information
// while comparing data across the actual browser and Node codec implementations.
function comparable(value){
 if(ArrayBuffer.isView(value))return {typedArray:Object.prototype.toString.call(value),bytes:Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
 if(value instanceof Map)return {map:Array.from(value,([key,item])=>[comparable(key),comparable(item)])};
 if(Array.isArray(value))return Array.from(value,comparable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,comparable(item)]));
 return value;
}
test('canonical browser aliases retain only upstream no-eval codec',()=>{
 const inputs=Object.keys(result.metafile.inputs);assert(inputs.some(p=>p.endsWith('msgpackr/dist/index-no-eval.cjs')));assert(!inputs.some(p=>/msgpackr\/(pack|unpack)\.js$/.test(p)));
 assert.equal(Default,Pack);assert.equal(Default,Direct);assert.equal(typeof Unpack,'function');
});
test('no-eval browser record/map/bigint codecs interoperate with existing persisted bytes',()=>{
 const options={useRecords:true,mapsAsObjects:false,structuredClone:true};const ordinary=new Ordinary(options),browser=new Default(options);
 const rows=Array.from({length:8},(_,i)=>({slot:i,owner:'0x'+'ab'.repeat(32),value:1n<<80n,bytes:new Uint8Array([0,128,255]),map:new Map([['balance',123n],['note',new Uint8Array([1,2])]])}));
 for(const row of rows){const old=ordinary.encode(row),fresh=browser.encode(row);assert.deepEqual(comparable(browser.decode(old)),comparable(ordinary.decode(old)));assert.deepEqual(comparable(ordinary.decode(fresh)),comparable(ordinary.decode(old)));}
 // Repeated records trigger the normal codec's optimizing record-read path.
 const bytes=ordinary.encode(rows);for(let i=0;i<10;i++)assert.deepEqual(comparable(browser.decode(bytes)),comparable(ordinary.decode(bytes)));
});
