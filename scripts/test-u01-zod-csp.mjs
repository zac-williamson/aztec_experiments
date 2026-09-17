import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from 'esbuild';

const entry = fs.readFileSync(new URL('../shared/sdk-entry.mjs', import.meta.url), 'utf8');
assert.match(entry, /^import '\.\/browser-runtime-policy\.mjs';/);
const schema = `import { z } from 'zod';
const schema = z.object({ id: z.string().regex(/^0x[0-9a-f]+$/), count: z.bigint().nonnegative(), values: z.array(z.number().int()), nested: z.object({ ready: z.boolean() }) }).strict();
export function check() {
 for (let i=0;i<20;i++) {
  const value=schema.parse({id:'0xab',count:123n,values:[1,2],nested:{ready:true}});
  if(value.count!==123n || value.values[1]!==2 || !value.nested.ready) throw Error('valid data changed');
 }
 return [schema.safeParse({id:'bad',count:-1n,values:[1.5],nested:{ready:'yes'}}).success,
 schema.safeParse({id:'0xab',count:0n,values:[],nested:{ready:false},extra:true}).success];
}`;
async function run(policy) {
 const built=await build({stdin:{contents:(policy?"import './shared/browser-runtime-policy.mjs';\n":'')+schema,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',globalName:'Validation',write:false});
 let attempts=0;
 const context=vm.createContext({},{codeGeneration:{strings:false,wasm:false}});
 // Count even caught feature-detection attempts, which still violate browser CSP.
 context.Function=new Proxy(vm.runInContext('Function',context),{
  apply(target,self,args){attempts++;return Reflect.apply(target,self,args);},
  construct(target,args){attempts++;return Reflect.construct(target,args);}
 });
 vm.runInContext(built.outputFiles[0].text,context);
 const rejected=Array.from(context.Validation.check());
 return {attempts,rejected};
}
test('first SDK import disables Zod eval attempts without weakening object validation',async()=>{
 const actual=await run(true);assert.equal(actual.attempts,0);assert.deepEqual(actual.rejected,[false,false]);
});
test('regression detects caught eval probes without the supported runtime policy',async()=>{
 const control=await run(false);assert.ok(control.attempts>0);assert.deepEqual(control.rejected,[false,false]);
});
