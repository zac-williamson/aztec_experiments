// Wallet UI logic with DOM/SDK/backup doubles; cryptographic backup tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=['account.js','wallet-buttons.js'].map(p=>fs.readFileSync(new URL('../shared/'+p,import.meta.url),'utf8')).join('\n');
const key='0x'+'1'.padStart(64,'0'),salt='0x'+((1n<<200n)+13n).toString(16).padStart(64,'0');
function fixture({fail=false}={}) {
 const elements=new Map(),logs=[],derived=[],listeners={};
 function element(id){if(!elements.has(id))elements.set(id,{value:'prior',disabled:false,setAttribute(){},addEventListener(name,fn){this[name]=fn;},click(){},remove(){}});return elements.get(id);}
 class Fr {constructor(value){this.value=BigInt(value);} static fromHexString(value){return new Fr(value);}}
 const context=vm.createContext({console,BigInt,Uint8Array,setTimeout:()=>{},log:message=>logs.push(message),
  document:{getElementById:element,createElement:()=>element('download'),body:{appendChild(){}}},
  window:{ethereum:{request:async()=>{},on(name,fn){listeners[name]=fn;}},BillboardWalletBackup:{validateWallet:raw=>({...raw})},__aztec:{Fr,deriveSigningKey:()=>0,deriveKeys:async()=>({publicKeys:[]}),SchnorrInitializerlessAccountContract:class {async getContractArtifact(){return{};}async getImmutablesHash(){return 0;}},getContractInstanceFromInstantiationParams:async(_artifact,args)=>{derived.push(args.salt.value);if(fail)throw new Error('secret-fixture-diagnostic');return{address:{toString:()=>key}};},computePartialAddress:async()=>0}},
 });
 vm.runInContext(source,context);context.initWalletButtons('container',{requireEth:false});
 return{context,element,logs,derived,listeners};
}
const file=raw=>({size:100,text:async()=>JSON.stringify(raw)});
test('full Field salt reaches derivation without placing keys in DOM',async()=>{
 const f=fixture();await f.context._loadAztecWallet(file({secretKey:key,salt}));
 assert.equal(f.derived[0],BigInt(salt));assert.equal(f.element('salt').value,'prior');assert.equal(f.context.window.walletState.aztec.salt,salt);
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
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));
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
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
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
 const f=fixture();browserConnection(f,{event});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('final account read rejects a replacement even without an event',async()=>{
 const f=fixture();browserConnection(f,{current:'0x'+'34'.repeat(20)});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('same-account notification after connection is not a replacement',async()=>{
 const f=fixture(),account=browserConnection(f);await f.context.window.BillboardAccount.connect(f.context.window.ethereum);f.listeners.accountsChanged([account.toUpperCase().replace('0X','0x')]);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);assert.equal(f.context.window.walletState.invalidated,true);
});
for(const event of ['chainChanged','disconnect'])test(event+' during authorization still invalidates the session',async()=>{
 const f=fixture();browserConnection(f,{afterNetwork:()=>f.listeners[event]('0x1')});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});

test('account replacement then restoration during authorization remains invalid',async()=>{
 const f=fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>{f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);f.listeners.accountsChanged([account]);}});
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('repeated matching authorization notifications permit connection',async()=>{
 const f=fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>f.listeners.accountsChanged([account])});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.ethAccount,account);assert.equal(f.context.window.walletState.invalidated,false);
});

function passkeyFixture({saved,fail=false,change=false}={}) {
 const f=fixture(),records=new Map(),calls=[];const account=browserConnection(f);
 const storageKey='billboard-passkey-v1:'+account;
 if(saved!==undefined)records.set(storageKey,saved);
 f.context.localStorage={getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v)};
 f.context.navigator={locks:{request:async(_name,fn)=>fn()}};
 f.context.BillboardPasskey={ceremony:async(_account,options)=>{calls.push(options);if(change)f.listeners.chainChanged();if(fail)throw Error('cancelled');return {wallet:{secretKey:key,salt},credentialId:'AQID'};}};
 f.context.initWalletButtons('container',{autoPasskey:true});
 return {...f,records,calls,storageKey};
}
test('Ethereum connection creates passkey account automatically, saves no secret',async()=>{
 const f=passkeyFixture();await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
 assert.equal(f.calls[0].create,true);assert(f.context.window.walletState.aztec);
 const saved=JSON.parse(f.records.get(f.storageKey));assert.deepEqual(Object.keys(saved).sort(),['address','credentialId','version']);
 assert(!f.element('container').innerHTML.includes('Create wallet'));
});
test('saved metadata unlocks the exact passkey instead of creating',async()=>{
 const f=passkeyFixture({saved:JSON.stringify({version:1,address:key,credentialId:'AQID'})});await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
 assert.equal(f.calls[0].create,false);assert.equal(f.calls[0].credentialId,'AQID');
});
test('cancelled passkey or changed Ethereum context never activates an account',async()=>{
 for(const options of [{fail:true},{change:true}]){const f=passkeyFixture(options);await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.records.size,0);}
});
test('corrupt metadata fails closed, explicit import repairs it',async()=>{
 const f=passkeyFixture({saved:'invalid json'});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.calls.length,0);
 await f.context._importPasskeyAccount();assert.equal(f.calls[0].create,false);assert.equal(JSON.parse(f.records.get(f.storageKey)).credentialId,'AQID');
});

test('absent browser wallet returns an actionable code without opening an account',async()=>{
 const f=fixture();delete f.context.window.ethereum;
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),error=>error.code==='BB_BROWSER_WALLET_MISSING');
 assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.aztec,null);
});

test('the selected provider owns signing and event invalidation, not the global',async()=>{
 const f=fixture(),old=f.context.window.ethereum;browserConnection(f);
 await assert.rejects(f.context.window.BillboardAccount.connect(undefined));
 const selected={request:async()=>{},on(name,fn){f.listeners[name]=fn;}};
 Object.defineProperty(f.context.window,'ethereum',{get(){throw Error('Conflicting extension');}});
 await f.context.window.BillboardAccount.connect(selected);
 assert.equal(f.context.window.walletState.ethTransport,selected);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.disconnect();assert.equal(f.context.window.walletState.invalidated,true);
});
test('requested network switch is accepted but unexpected network changes still invalidate',async()=>{
 const f=fixture();browserConnection(f);f.context._getPublicConfig=()=>({network:{chainId:'31337'}});let chain='0x1';const calls=[];
 f.context.window.ethereum.request=async request=>{calls.push(request.method);if(request.method==='wallet_switchEthereumChain'){assert.equal(request.params[0].chainId,'0x7a69');chain='0x7a69';f.listeners.chainChanged(chain);return null;}return chain;};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.invalidated,false);
 assert.deepEqual(calls,['eth_chainId','wallet_switchEthereumChain','eth_chainId']);f.listeners.chainChanged('0x1');assert.equal(f.context.window.walletState.invalidated,true);
});
test('rejecting a network switch leaves the session disconnected',async()=>{
 const f=fixture();browserConnection(f);f.context._getPublicConfig=()=>({network:{chainId:'31337'}});
 f.context.window.ethereum.request=async({method})=>{if(method==='eth_chainId')return '0x1';throw Object.assign(Error('private diagnostic'),{code:4001});};
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),error=>error.code==='BB_WALLET_REJECTED');assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,false);
});

test('events from a previously rejected wallet cannot invalidate the newly selected wallet',async()=>{
 const f=fixture(),oldListeners={};
 const first={request:async()=>{},on(name,fn){oldListeners[name]=fn;},removeListener(){}};
 f.context.ethers={BrowserProvider:class {async send(){throw Object.assign(Error('Rejected'),{code:4001});}}};
 await assert.rejects(f.context.window.BillboardAccount.connect(first));
 browserConnection(f);await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
 oldListeners.chainChanged('0x2');oldListeners.accountsChanged([]);oldListeners.disconnect();
 assert.equal(f.context.window.walletState.invalidated,false);
});


test('selected wallet identity is shown with its exact authorized account',async()=>{
 const f=fixture(),account=browserConnection(f);
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask');
 const state=f.context.window.BillboardAccount.snapshot();
 assert.equal(state.ethereumWalletName,'MetaMask');assert.equal(state.ethereumAddress,account);
 assert.equal(f.element('wbConnectionStatus').textContent,'MetaMask · '+account);
 assert(f.logs.some(message=>message==='MetaMask connected: '+account));
});
for(const event of ['disconnect','accountsChanged','chainChanged'])test(event+' immediately clears connected status and shows reconnect guidance',async()=>{
 const f=fixture();browserConnection(f);let latest;
 f.context.initWalletButtons('container',{onChange:state=>{latest=state;}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask');
 f.listeners[event](event==='accountsChanged'?[]:'0x2');
 assert.equal(latest.ethereumConnected,false);assert.equal(latest.invalidated,true);
 assert.match(f.element('wbConnectionStatus').textContent,/Reload to reconnect/);
 assert.equal(f.element('wbEthBrowserBtn').disabled,true);
});
test('explicit invalidation notifies consumers, including outside wallet events',async()=>{
 const f=fixture();browserConnection(f);let notifications=0;
 f.context.initWalletButtons('container',{onChange:()=>{notifications++;}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'Other wallet');
 const before=notifications;f.context.window.BillboardAccount.invalidate();
 assert.equal(notifications,before+1);assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);
 f.context.window.BillboardAccount.invalidate();assert.equal(notifications,before+1);
});


test('explicit account selection requests fresh permission before activating a signer',async()=>{
 const f=fixture(),calls=[];browserConnection(f);
 f.context.window.ethereum.request=async request=>{calls.push(request);assert.equal(f.context.window.walletState.ethSigner,null);return[];};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'wallet_requestPermissions');
 assert.equal(JSON.stringify(calls[0].params),'[{"eth_accounts":{}}]');
});
test('rejected account selection cannot silently reuse a previously authorized account',async()=>{
 const f=fixture();browserConnection(f);f.context.window.ethereum.request=async()=>{throw Object.assign(Error('Rejected'),{code:4001});};
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true}));
 assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);assert.equal(f.context.window.walletState.ethSigner,null);
});


test('after passkey cancellation a new connection still requests account selection',async()=>{
 const f=passkeyFixture({fail:true});let selections=0;
 f.context.window.ethereum.request=async()=>{selections++;return[];};
 for(let i=0;i<2;i++)await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true}));
 assert.equal(selections,2);assert.equal(f.context.window.walletState.aztec,null);
});

test('permission selection can replace an older origin grant before signer activation',async()=>{
 const f=fixture(),old='0x'+'12'.repeat(20),selected='0x'+'34'.repeat(20);let authorized=old;
 f.context.window.ethereum.request=async({method})=>{assert.equal(method,'wallet_requestPermissions');authorized=selected;f.listeners.accountsChanged([selected]);return[];};
 f.context.ethers={BrowserProvider:class {
  async send(method){assert(['eth_requestAccounts','eth_accounts'].includes(method));return[authorized];}
  async getSigner(){return{getAddress:async()=>authorized};}
  async getNetwork(){return{chainId:31337n};}
 }};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true});
 assert.equal(f.context.window.BillboardAccount.snapshot().ethereumAddress,selected);
 assert.notEqual(f.context.window.BillboardAccount.snapshot().ethereumAddress,old);
});
