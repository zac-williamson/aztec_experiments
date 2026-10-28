import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function fixture(legacy,phantom){
 const listeners=new Map();const root={addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>listeners.get(event.type)?.(event)};
 Object.defineProperty(root,'phantom',{get:()=>typeof phantom==='function'?phantom():phantom});
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

test('namespaced Phantom remains selectable beside announced MetaMask without reading Solana or colliding globals',()=>{
 let ethereumReads=0,solanaReads=0,requests=0;
 const provider={isPhantom:true,request(){requests++;}},phantom={ethereum:provider};
 Object.defineProperty(phantom,'solana',{get(){solanaReads++;throw Error('Solana is not Ethereum');}});
 const f=fixture(()=>{ethereumReads++;throw Error('Another extension owns the global');},phantom);
 f.announce({info:{uuid:'metamask',name:'MetaMask',rdns:'io.metamask'},provider:{request(){}}});
 const choices=f.registry.list(),choice=choices.find(row=>row.name==='Phantom');
 assert.equal(choices.length,2);assert.equal(choice.provider,provider);assert.equal(choice.rdns,'app.phantom');
 assert.match(choice.icon,/^data:image\/svg\+xml;base64,/);assert.match(Buffer.from(choice.icon.split(',')[1],'base64').toString(),/<svg /);
 assert.equal(ethereumReads,0);assert.equal(solanaReads,0);assert.equal(requests,0);
});
test('Phantom legacy and late announcement deduplicate by provider identity and preserve its supplied icon',()=>{
 const provider={isPhantom:true,request(){}},f=fixture(()=>provider,{ethereum:provider});
 assert.equal(f.registry.list().length,1);assert.equal(f.registry.list()[0].name,'Phantom');
 const icon='data:image/png;base64,test';f.announce({info:{uuid:'phantom-announced',name:'Phantom',rdns:'app.phantom',icon},provider});
 assert.equal(f.registry.list().length,1);assert.equal(f.registry.list()[0].id,'phantom-announced');assert.equal(f.registry.list()[0].icon,icon);
});
test('namespaced Phantom supplies a missing announced icon without replacing the transport',()=>{
 const provider={isPhantom:true,request(){}},f=fixture(undefined,{ethereum:provider});
 f.announce({info:{uuid:'phantom-announced',name:'Phantom'},provider});
 assert.equal(f.registry.list().length,1);assert.equal(f.registry.list()[0].provider,provider);assert.match(f.registry.list()[0].icon,/^data:image/);
});
test('late namespaced injection is discovered on refresh and malformed namespaces leave announcements usable',()=>{
 let phantom;const f=fixture(undefined,()=>phantom),other={request(){}};
 f.announce({info:{uuid:'other',name:'Other'},provider:other});let changes=0;f.registry.subscribe(()=>changes++);
 phantom={ethereum:{isPhantom:true,request(){}}};f.registry.refresh();assert.equal(changes,1);assert.equal(f.registry.list().length,2);
 for(const value of [{solana:{isPhantom:true,request(){}}},{ethereum:{isPhantom:true}},{ethereum:{request(){}}}]){phantom=value;assert.equal(f.registry.list().length,1);}
 phantom={get ethereum(){throw Error('Unavailable');}};assert.equal(f.registry.list()[0].provider,other);
});
test('selected Phantom transport receives actual ethers personal and EIP-712 signing with no global provider request',async()=>{
 const ethers=await import('ethers'),wallet=ethers.Wallet.createRandom(),calls=[];
 const provider={isPhantom:true,async request({method,params}){
   calls.push(method);
   if(method==='eth_chainId')return '0xaa36a7';
   if(method==='eth_accounts'||method==='eth_requestAccounts')return [wallet.address];
   if(method==='personal_sign'){assert.equal(params[1],wallet.address.toLowerCase());return wallet.signMessage(ethers.getBytes(params[0]));}
   if(method==='eth_signTypedData_v4'){const {domain,types,message}=JSON.parse(params[1]);delete types.EIP712Domain;return wallet.signTypedData(domain,types,message);}
   throw Error('Unexpected RPC '+method);
 }};
 const f=fixture(()=>({request(){throw Error('Wrong provider');}}),{ethereum:provider});
 const selected=f.registry.list().find(row=>row.name==='Phantom'),browser=new ethers.BrowserProvider(selected.provider);
 try{
   const signer=await browser.getSigner(),message='Disposable provider compatibility test';
   assert.equal(ethers.verifyMessage(message,await signer.signMessage(message)),wallet.address);
   const domain={name:'RollingCollateral',version:'1',chainId:11155111,verifyingContract:'0x1111111111111111111111111111111111111111'};
   const types={DepositFor:[{name:'beneficiary',type:'address'},{name:'executor',type:'address'},{name:'amount',type:'uint256'},{name:'secretHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
   const value={beneficiary:wallet.address,executor:'0x2222222222222222222222222222222222222222',amount:'1',secretHash:'0x'+'03'.repeat(32),nonce:'0',deadline:'1000'};
   assert.equal(ethers.verifyTypedData(domain,types,value,await signer.signTypedData(domain,types,value)),wallet.address);
   assert(calls.includes('personal_sign'));assert(calls.includes('eth_signTypedData_v4'));assert(!calls.includes('eth_sign'));
 }finally{browser.destroy();}
});
