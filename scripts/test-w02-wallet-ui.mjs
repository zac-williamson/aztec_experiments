// Wallet UI logic with DOM/SDK/backup doubles; cryptographic backup tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/wallet-buttons.js',import.meta.url),'utf8');
const key='0x'+'1'.padStart(64,'0'),salt='0x'+((1n<<200n)+13n).toString(16).padStart(64,'0');
function fixture({fail=false}={}) {
 const elements=new Map(),logs=[],derived=[],listeners={};
 function element(id){if(!elements.has(id))elements.set(id,{value:'prior',disabled:false,addEventListener(name,fn){this[name]=fn;},click(){},remove(){}});return elements.get(id);}
 class Fr {constructor(value){this.value=BigInt(value);} static fromHexString(value){return new Fr(value);}}
 const context=vm.createContext({console,BigInt,Uint8Array,setTimeout:()=>{},log:message=>logs.push(message),
  document:{getElementById:element,createElement:()=>element('download'),body:{appendChild(){}}},
  window:{ethereum:{on(name,fn){listeners[name]=fn;}},BillboardWalletBackup:{validateWallet:raw=>({...raw})},__aztec:{Fr,deriveSigningKey:()=>0,deriveKeys:async()=>({publicKeys:[]}),SchnorrInitializerlessAccountContract:class {async getContractArtifact(){return{};}async getImmutablesHash(){return 0;}},getContractInstanceFromInstantiationParams:async(_artifact,args)=>{derived.push(args.salt.value);if(fail)throw new Error('secret-fixture-diagnostic');return{address:{toString:()=>key}};},computePartialAddress:async()=>0}},
 });
 vm.runInContext(source,context);context.initWalletButtons('container',{requireEth:false});
 return{context,element,logs,derived,listeners};
}
const file=raw=>({size:100,text:async()=>JSON.stringify(raw)});
test('full Field salt reaches derivation and DOM without retaining old salt',async()=>{
 const f=fixture();await f.context._loadAztecWallet(file({secretKey:key,salt}));
 assert.equal(f.derived[0],BigInt(salt));assert.equal(f.element('salt').value,salt);assert.equal(f.context.window.walletState.aztec.salt,salt);
 await assert.rejects(f.context._loadAztecWallet(file({secretKey:key,salt:'0x00'})),/already loaded/);
 assert.equal(f.context.window.walletState.aztec.salt,salt);
});
test('failed derivation does not activate or overwrite secret fields',async()=>{
 const f=fixture({fail:true});await assert.rejects(f.context._loadAztecWallet(file({secretKey:key,salt})));
 assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.element('secretKey').value,'prior');
 assert(!f.logs.join('').includes('secret-fixture-diagnostic'));
});
test('malformed import event emits bounded diagnostics and clears selection',async()=>{
 const f=fixture(),target={files:[{size:100,text:async()=>'{private-secret-fixture'}],value:'file'};
 await f.element('wbAztecFile').change({target});
 assert.equal(target.value,'');assert.equal(f.context.window.walletState.aztec,null);assert(!f.logs.join('').includes('private-secret-fixture'));
});
test('signature generation and silent wallet replacement are unavailable',()=>{
 const f=fixture();assert.equal(f.context._generateAztecFromEth,undefined);assert(!f.element('container').innerHTML.includes('signMessage'));
 f.context.resetWalletState();assert.equal(f.context.window.walletState.invalidated,true);
});

test('provider change during initial connection prevents activating a stale signer',async()=>{
 const f=fixture();
 f.context.ethers={BrowserProvider:class {async send(){f.listeners.chainChanged();}async getSigner(){return{getAddress:async()=>key};}async getNetwork(){return{chainId:1n};}}};
 await assert.rejects(f.context._loadEthBrowser());
 assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('callback failure invalidates activated session without logging callback diagnostics',async()=>{
 const f=fixture();f.context.initWalletButtons('container',{requireEth:false,onAztecLoad(){throw new Error('private-callback-fixture');}});
 await f.context._loadAztecWallet(file({secretKey:key,salt}));
 assert.equal(f.context.window.walletState.invalidated,true);assert(!f.logs.join('').includes('private-callback-fixture'));
});

test('initial account authorization event permits the matching browser signer',async()=>{
 const f=fixture(),account='0x'+'12'.repeat(20);
 f.context.ethers={BrowserProvider:class {
  async send(method){if(method==='eth_requestAccounts')f.listeners.accountsChanged([account]);assert(['eth_requestAccounts','eth_accounts'].includes(method));return[account];}
  async getSigner(){return{getAddress:async()=>account};}
  async getNetwork(){return{chainId:31337n};}
 }};
 await f.context._loadEthBrowser();
 assert.equal(f.context.window.walletState.ethAccount,account);
 assert.equal(f.context.window.walletState.invalidated,false);
});

function browserConnection(f,{requested='0x'+'12'.repeat(20),current=requested,event,afterNetwork}={}) {
 f.context.ethers={BrowserProvider:class {
  async send(method){if(method==='eth_requestAccounts'){if(event)f.listeners.accountsChanged(event);return[requested];}assert.equal(method,'eth_accounts');return[current];}
  async getSigner(){return{getAddress:async()=>requested};}
  async getNetwork(){afterNetwork?.();return{chainId:31337n};}
 }};
 return requested;
}
for(const [name,event] of [['different account',['0x'+'34'.repeat(20)]],['empty authorization',[]],['malformed authorization',['not-an-address']]])test('initial connection rejects '+name,async()=>{
 const f=fixture();browserConnection(f,{event});await assert.rejects(f.context._loadEthBrowser());assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('final account read rejects a replacement even without an event',async()=>{
 const f=fixture();browserConnection(f,{current:'0x'+'34'.repeat(20)});await assert.rejects(f.context._loadEthBrowser());assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('same-account notification after connection is not a replacement',async()=>{
 const f=fixture(),account=browserConnection(f);await f.context._loadEthBrowser();f.listeners.accountsChanged([account.toUpperCase().replace('0X','0x')]);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);assert.equal(f.context.window.walletState.invalidated,true);
});
for(const event of ['chainChanged','disconnect'])test(event+' during authorization still invalidates the session',async()=>{
 const f=fixture();browserConnection(f,{afterNetwork:()=>f.listeners[event]('0x1')});await assert.rejects(f.context._loadEthBrowser());assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});

test('account replacement then restoration during authorization remains invalid',async()=>{
 const f=fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>{f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);f.listeners.accountsChanged([account]);}});
 await assert.rejects(f.context._loadEthBrowser());assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('repeated matching authorization notifications permit connection',async()=>{
 const f=fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>f.listeners.accountsChanged([account])});
 await f.context._loadEthBrowser();assert.equal(f.context.window.walletState.ethAccount,account);assert.equal(f.context.window.walletState.invalidated,false);
});
