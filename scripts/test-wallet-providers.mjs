import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture(legacy){
 const listeners=new Map();const root={addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>listeners.get(event.type)?.(event)};
 Object.defineProperty(root,'ethereum',{get:legacy??(()=>{throw Error('Conflicting extension');})});
 vm.runInNewContext(fs.readFileSync(new URL('../shared/wallet-providers.js',import.meta.url),'utf8'),{window:root,Event});
 return {registry:root.BillboardWalletProviders,announce:detail=>root.dispatchEvent({type:'eip6963:announceProvider',detail})};
}
test('multiple announced wallets work with an immutable throwing legacy global',()=>{
 const f=fixture(),first={request(){}},second={request(){}};
 f.announce({info:{uuid:'one',name:'Wallet A'},provider:first});f.announce({info:{uuid:'two',name:'Wallet B'},provider:second});
 assert.equal(f.registry.list().length,2);assert.equal(f.registry.list()[0].provider,first);assert.equal(f.registry.list()[1].provider,second);
});
test('late announcements notify only live subscribers; duplicates cannot replace a wallet',()=>{
 const f=fixture(),provider={request(){}},info={uuid:'one',name:'Wallet'};let calls=0;const stop=f.registry.subscribe(()=>calls++);
 f.announce({info,provider});f.announce({info,provider:{request(){}}});f.announce({info:{...info,uuid:'two'},provider});
 assert.equal(calls,1);assert.equal(f.registry.list()[0].provider,provider);stop();f.registry.refresh();assert.equal(calls,1);
});
test('invalid announcements are ignored; legacy is an explicit choice only when no wallet announces',()=>{
 const legacy={request(){}},f=fixture(()=>legacy);
 for(const detail of [null,{}, {info:{uuid:'id',name:''},provider:legacy},{info:{uuid:'id',name:'name'},provider:{}}])f.announce(detail);
 assert.equal(f.registry.list()[0].id,'legacy');f.announce({info:{uuid:'one',name:'<script>untrusted</script>'},provider:{request(){}}});
 assert.equal(f.registry.list().length,1);assert.equal(f.registry.list()[0].name,'<script>untrusted</script>');
});
