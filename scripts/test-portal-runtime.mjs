import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './toolchain.mjs';
import {PORTAL_IMMUTABLES,expectedPortalRuntime,verifyPortalRuntime} from '../shared/portal-runtime.mjs';
import {portalRuntimeMetadata} from './build-portal-runtime.mjs';
const metadata=JSON.parse(fs.readFileSync(path.join(ROOT,'shared/portal-runtime.json')));
const values=Object.fromEntries(PORTAL_IMMUTABLES.map((name,i)=>[name,BigInt(i+1)]));
const clone=x=>structuredClone(x);
const runtime=expectedPortalRuntime(metadata,values);
test('full current compiler runtime verifies with all nine substitutions',()=>assert.equal(verifyPortalRuntime(runtime,metadata,values),true));
for(const name of PORTAL_IMMUTABLES)test('reject changed immutable '+name,()=>assert.throws(()=>verifyPortalRuntime(runtime,metadata,{...values,[name]:values[name]+1n}),/does not match/));
test('reject outside-reference runtime mutation',()=>{
 const occupied=new Set(Object.values(metadata.immutables).flatMap(refs=>refs.flatMap(r=>Array.from({length:r.length},(_,i)=>r.start+i))));
 const offset=Array.from({length:(runtime.length-2)/2},(_,i)=>i).find(i=>!occupied.has(i)),index=2+offset*2;
 const altered=runtime.slice(0,index)+(runtime.slice(index,index+2)==='00'?'01':'00')+runtime.slice(index+2);
 assert.throws(()=>verifyPortalRuntime(altered,metadata,values),/does not match/);
});
for(const mutation of ['missing','extra','overlap','range','length','template','empty'])test('reject metadata '+mutation,()=>{
 const m=clone(metadata),first=m.immutables.MIN_DEPOSIT[0];
 if(mutation==='missing')delete m.immutables.INBOX;
 if(mutation==='extra')m.immutables.UNKNOWN=[first];
 if(mutation==='overlap')m.immutables.MAX_DEPOSIT.push(first);
 if(mutation==='range')first.start=1000000;
 if(mutation==='length')first.length=31;
 if(mutation==='template')m.runtimeTemplate=m.runtimeTemplate.slice(0,2+first.start*2)+'01'+m.runtimeTemplate.slice(4+first.start*2);
 if(mutation==='empty')m.immutables.INBOX=[];
 assert.throws(()=>expectedPortalRuntime(m,values),/Invalid/);
});
test('reject absent/malformed runtime and lossy/out-of-range immutable input',()=>{
 for(const code of ['0x',null,'0xzz',runtime+'00'])assert.throws(()=>verifyPortalRuntime(code,metadata,values));
 for(const value of [1,-1n,1n<<256n,'01'])assert.throws(()=>expectedPortalRuntime(metadata,{...values,MIN_DEPOSIT:value}));
 assert.throws(()=>expectedPortalRuntime(metadata,{...values,INBOX:1n<<160n}));
});
const source=Buffer.from('test compiler source');
// A small compiler-output fixture tests mapping and source authentication without
// requiring a compiler subprocess or trusting handwritten production AST IDs.
import {keccak256} from 'ethers';
const fixture=()=>({bytecode:{object:'0x01',linkReferences:{}},deployedBytecode:{object:'0x'+'00'.repeat(32*9),linkReferences:{},immutableReferences:Object.fromEntries(PORTAL_IMMUTABLES.map((n,i)=>[String(100+i),[{start:i*32,length:32}]]))},metadata:{compiler:{version:'0.8.27+test'},sources:{'src/BillboardPortal.sol':{keccak256:keccak256(source)}}},ast:{absolutePath:'src/BillboardPortal.sol',nodes:[{nodeType:'ContractDefinition',name:'BillboardPortal',nodes:PORTAL_IMMUTABLES.map((name,i)=>({id:100+i,name,nodeType:'VariableDeclaration',mutability:'immutable'}))}]}});
test('derive names from AST IDs rather than ordering',()=>{const a=fixture();a.ast.nodes[0].nodes.reverse();const result=portalRuntimeMetadata(a,clone(a),()=>source);assert.deepEqual(result.immutables.INBOX,[{start:4*32,length:32}]);});
for(const mutation of ['source','id','name','bytecode','links'])test('builder rejects '+mutation+' drift',()=>{
 const a=fixture(),canonical=clone(a);
 if(mutation==='id')a.ast.nodes[0].nodes[0].id=999;
 if(mutation==='name')a.ast.nodes[0].nodes[0].name='WRONG';
 if(mutation==='bytecode')a.bytecode.object='0x02';
 if(mutation==='links')a.bytecode.linkReferences={unexpected:[]};
 assert.throws(()=>portalRuntimeMetadata(a,canonical,()=>mutation==='source'?Buffer.from('different'):source));
});
