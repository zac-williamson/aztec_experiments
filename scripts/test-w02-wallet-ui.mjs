// Account/UI behavior uses provider, SDK and session-store doubles. Actual signing,
// encryption and remembered custody are covered by ethereum-account-session tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=['account.js','wallet-buttons.js'].map(p=>fs.readFileSync(new URL('../shared/'+p,import.meta.url),'utf8')).join('\n');
const field=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const key=field(1),salt=field((1n<<200n)+13n),owner='0x'+'12'.repeat(20);
async function fixture({fail=false}={}) {
 const elements=new Map(),logs=[],warnings=[],derived=[],listeners={},calls={sign:0,save:[],clear:0};
 let saved=null;
 function element(id){if(!elements.has(id))elements.set(id,{value:'prior',disabled:false,append(){},prepend(){},appendChild(){},setAttribute(){},addEventListener(name,fn){this[name]=fn;},click(){},remove(){}});return elements.get(id);}
 class Fr {constructor(value){this.value=BigInt(value);} static fromHexString(value){return new Fr(value);}}
 const session={load:async()=>saved,clear:async()=>{calls.clear++;saved=null;},selectedTestAccount:async()=> '0',createMessage:()=> 'private-signature-request',derive:async()=>({secretKey:key,salt}),save:async(scope,wallet,metadata)=>{calls.save.push({scope,wallet,metadata});saved={wallet,metadata};}};
 const context=vm.createContext({console:{warn:(...args)=>warnings.push(args.join(' '))},BigInt,Uint8Array,setTimeout:()=>{},log:message=>logs.push(message),publicOperationFailure:e=>({message:'Safe wallet error '+(e.code||'unknown')}),
  location:{origin:'https://rolling.example',reload(){}},navigator:{locks:{request:async(_name,options,run)=>typeof options==='function'?options():run({})}},_getPublicConfig:()=>({network:{chainId:'31337'}}),
  document:{querySelector:()=>null,getElementById:element,createElement:()=>element('download'),body:{appendChild(){}}},
  window:{BillboardEthereumSession:session,ethereum:{request:async({method})=>method==='eth_accounts'?new context.ethers.BrowserProvider().send('eth_accounts'):'0x7a69',on(name,fn){listeners[name]=fn;}},__aztec:{Fr,deriveSigningKey:()=>0,deriveKeys:async()=>({publicKeys:[]}),SchnorrInitializerlessAccountContract:class {async getContractArtifact(){return{};}async getImmutablesHash(){return 0;}},getContractInstanceFromInstantiationParams:async(_artifact,args)=>{derived.push(args.salt.value);if(fail)throw Error('secret-fixture-diagnostic');return{address:{toString:()=>key}};},computePartialAddress:async()=>({toString:()=>field(2)})}},
 });
 vm.runInContext(source,context);await context.initWalletButtons('container',{requireEth:false});
 return{context,element,logs,warnings,derived,listeners,calls,session,setSaved:value=>{saved=value;},getSaved:()=>saved};
}
async function accountFixture(options={}) {
 const f=await fixture(options);browserConnection(f);
 const BrowserProvider=f.context.ethers.BrowserProvider;
 f.context.ethers.BrowserProvider=class extends BrowserProvider {async getSigner(){return {getAddress:async()=>owner,signMessage:async()=>{f.calls.sign++;if(options.cancel)throw Object.assign(Error('private-signature-sentinel'),{code:4001});if(options.change)f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);return 'private-signature-sentinel';}};}};
 return f;
}
const open=f=>f.context.window.BillboardAccount.connect(f.context.window.ethereum,'Test wallet',{deriveAccount:true,providerId:'test-wallet'});
test('full Field salt reaches current derivation without placing keys in DOM or public state',async()=>{
 const f=await accountFixture();await open(f);
 assert.equal(f.derived[0],BigInt(salt));assert.equal(f.element('salt').value,'prior');assert.equal(f.context.window.walletState.aztec.salt,salt);
 const publicState=JSON.stringify(f.context.window.BillboardAccount.snapshot());assert(!publicState.includes(salt));assert(!publicState.includes('secretKey'));
 assert.equal(f.calls.sign,1);assert.equal(f.calls.save.length,1);assert.equal(f.calls.save[0].wallet.salt,salt);
});
test('failed derivation does not activate or persist the account or expose diagnostics',async()=>{
 const f=await accountFixture({fail:true});await assert.rejects(open(f));
 assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.calls.save.length,0);assert.equal(f.element('secretKey').value,'prior');
 assert(![...f.logs,...f.warnings].join('').includes('secret-fixture-diagnostic'));
});
test('retired file, random-account and passkey operations are absent from the public UI and API',async()=>{
 const f=await fixture();for(const name of ['createPasskey','importPasskey','exportBackup','importBackup'])assert.equal(f.context.window.BillboardAccount[name],undefined);
 for(const name of ['_loadAztecWallet','_generateAztecFromEth','_importPasskeyAccount'])assert.equal(f.context[name],undefined);
 assert.doesNotMatch(f.element('container').innerHTML,/type="file"|password|passkey|backup/i);
 f.context.resetWalletState();assert.equal(f.context.window.walletState.invalidated,true);
});
test('final network mismatch prevents activating a signer',async()=>{
 const f=await fixture();browserConnection(f);const request=f.context.window.ethereum.request;let reads=0;
 f.context.window.ethereum.request=async arg=>arg.method==='eth_chainId'?(++reads===1?'0x7a69':'0x1'):request(arg);
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),{code:'BB_WALLET_NETWORK'});assert.equal(f.context.window.walletState.ethSigner,null);
});
test('callback failure invalidates activated session without logging callback diagnostics',async()=>{
 const f=await accountFixture();await f.context.initWalletButtons('container',{requireEth:false,onAztecLoad(){throw Error('private-callback-fixture');}});await open(f);
 assert.equal(f.context.window.walletState.invalidated,true);assert(!f.logs.join('').includes('private-callback-fixture'));
});
test('initial account authorization event permits the matching browser signer',async()=>{
 const f=await fixture(),account='0x'+'12'.repeat(20);
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
for(const [name,event] of [['different account',['0x'+'34'.repeat(20)]],['empty authorization',[]],['malformed authorization',['not-an-address']]])test('preactivation notification does not override final account: '+name,async()=>{
 const f=await fixture(),account=browserConnection(f,{event});await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.ethAccount,account);assert.equal(f.context.window.walletState.invalidated,false);
});
test('final account read rejects a replacement even without an event',async()=>{
 const f=await fixture();browserConnection(f,{current:'0x'+'34'.repeat(20)});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,true);
});
test('same-account notification after connection is not a replacement',async()=>{
 const f=await fixture(),account=browserConnection(f);await f.context.window.BillboardAccount.connect(f.context.window.ethereum);f.listeners.accountsChanged([account.toUpperCase().replace('0X','0x')]);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);assert.equal(f.context.window.walletState.invalidated,true);
});
test('disconnect during authorization prevents activating a signer',async()=>{
 const f=await fixture();browserConnection(f,{afterNetwork:()=>f.listeners.disconnect()});await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),e=>e.code==='BB_WALLET_DISCONNECTED');assert.equal(f.context.window.walletState.ethSigner,null);
});
test('transient selection events before activation are reconciled with final provider reads',async()=>{
 const f=await fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>{f.listeners.accountsChanged(['0x'+'34'.repeat(20)]);f.listeners.chainChanged('0x1');f.listeners.accountsChanged([account]);}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.ethAccount,account);assert.equal(f.context.window.walletState.invalidated,false);
});
test('repeated matching authorization notifications permit connection',async()=>{
 const f=await fixture(),account='0x'+'12'.repeat(20);
 browserConnection(f,{event:[account],afterNetwork:()=>f.listeners.accountsChanged([account])});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.ethAccount,account);assert.equal(f.context.window.walletState.invalidated,false);
});

test('absent browser wallet returns an actionable code without opening an account',async()=>{
 const f=await fixture();delete f.context.window.ethereum;
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),error=>error.code==='BB_BROWSER_WALLET_MISSING');
 assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.aztec,null);
});

test('the selected provider owns signing and event invalidation, not the global',async()=>{
 const f=await fixture(),old=f.context.window.ethereum;browserConnection(f);
 await assert.rejects(f.context.window.BillboardAccount.connect(undefined));
 const selected={request:old.request,on(name,fn){f.listeners[name]=fn;}};
 Object.defineProperty(f.context.window,'ethereum',{get(){throw Error('Conflicting extension');}});
 await f.context.window.BillboardAccount.connect(selected);
 assert.equal(f.context.window.walletState.ethTransport,selected);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.disconnect();assert.equal(f.context.window.walletState.invalidated,true);
});
test('requested network switch is accepted but unexpected network changes still invalidate',async()=>{
 const f=await fixture();browserConnection(f);f.context._getPublicConfig=()=>({network:{chainId:'31337'}});let chain='0x1';const calls=[];
 f.context.window.ethereum.request=async request=>{calls.push(request.method);if(request.method==='eth_accounts')return['0x'+'12'.repeat(20)];if(request.method==='wallet_switchEthereumChain'){assert.equal(request.params[0].chainId,'0x7a69');chain='0x7a69';f.listeners.chainChanged(chain);return null;}return chain;};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.walletState.invalidated,false);
 assert.deepEqual(calls,['eth_chainId','wallet_switchEthereumChain','eth_chainId','eth_chainId','eth_accounts']);f.listeners.chainChanged('0x1');assert.equal(f.context.window.walletState.invalidated,true);
});
test('rejecting a network switch leaves the session disconnected',async()=>{
 const f=await fixture();browserConnection(f);f.context._getPublicConfig=()=>({network:{chainId:'31337'}});
 f.context.window.ethereum.request=async({method})=>{if(method==='eth_chainId')return '0x1';throw Object.assign(Error('private diagnostic'),{code:4001});};
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum),error=>error.code==='BB_WALLET_REJECTED');assert.equal(f.context.window.walletState.ethSigner,null);assert.equal(f.context.window.walletState.invalidated,false);
});

test('events from a previously rejected wallet cannot invalidate the newly selected wallet',async()=>{
 const f=await fixture(),oldListeners={};
 const first={request:async()=>{},on(name,fn){oldListeners[name]=fn;},removeListener(){}};
 f.context.ethers={BrowserProvider:class {async send(){throw Object.assign(Error('Rejected'),{code:4001});}}};
 await assert.rejects(f.context.window.BillboardAccount.connect(first));
 browserConnection(f);await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
 oldListeners.chainChanged('0x2');oldListeners.accountsChanged([]);oldListeners.disconnect();
 assert.equal(f.context.window.walletState.invalidated,false);
});


test('selected wallet identity is shown with its exact authorized account',async()=>{
 const f=await fixture(),account=browserConnection(f);
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask');
 const state=f.context.window.BillboardAccount.snapshot();
 assert.equal(state.ethereumWalletName,'MetaMask');assert.equal(state.ethereumAddress,account);
 assert.equal(f.element('wbConnectionStatus').textContent,'MetaMask · '+account.slice(0,6)+'…'+account.slice(-4));
 assert(f.logs.some(message=>message==='MetaMask connected: '+account));
});
for(const event of ['disconnect','accountsChanged','chainChanged'])test(event+' immediately clears connected status and shows reconnect guidance',async()=>{
 const f=await fixture();browserConnection(f);let latest;
 f.context.initWalletButtons('container',{onChange:state=>{latest=state;}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask');
 f.listeners[event](event==='accountsChanged'?[]:'0x2');
 assert.equal(latest.ethereumConnected,false);assert.equal(latest.invalidated,true);
 assert.match(f.element('wbConnectionStatus').textContent,/Sign out before connecting again/);
 assert.equal(f.element('wbEthBrowserBtn').disabled,true);
});
test('explicit invalidation notifies consumers, including outside wallet events',async()=>{
 const f=await fixture();browserConnection(f);let notifications=0;
 f.context.initWalletButtons('container',{onChange:()=>{notifications++;}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'Other wallet');
 const before=notifications;f.context.window.BillboardAccount.invalidate();
 assert.equal(notifications,before+1);assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);
 f.context.window.BillboardAccount.invalidate();assert.equal(notifications,before+1);
});


test('explicit account selection requests fresh permission before activating a signer',async()=>{
 const f=await fixture(),calls=[];browserConnection(f);
 const request=f.context.window.ethereum.request;f.context.window.ethereum.request=async arg=>{if(arg.method!=='wallet_requestPermissions')return request(arg);calls.push(arg);assert.equal(f.context.window.walletState.ethSigner,null);return[];};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'wallet_requestPermissions');
 assert.equal(JSON.stringify(calls[0].params),'[{"eth_accounts":{}}]');
});
test('rejected account selection cannot silently reuse a previously authorized account',async()=>{
 const f=await fixture();browserConnection(f);f.context.window.ethereum.request=async()=>{throw Object.assign(Error('Rejected'),{code:4001});};
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true}));
 assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);assert.equal(f.context.window.walletState.ethSigner,null);
});


test('permission selection can replace an older origin grant before signer activation',async()=>{
 const f=await fixture(),old='0x'+'12'.repeat(20),selected='0x'+'34'.repeat(20);let authorized=old;
 f.context.window.ethereum.request=async({method})=>{if(method==='eth_accounts')return[authorized];if(method==='eth_chainId')return '0x7a69';assert.equal(method,'wallet_requestPermissions');authorized=selected;f.listeners.accountsChanged([selected]);return[];};
 f.context.ethers={BrowserProvider:class {
  async send(method){assert(['eth_requestAccounts','eth_accounts'].includes(method));return[authorized];}
  async getSigner(){return{getAddress:async()=>authorized};}
  async getNetwork(){return{chainId:31337n};}
 }};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true});
 assert.equal(f.context.window.BillboardAccount.snapshot().ethereumAddress,selected);
 assert.notEqual(f.context.window.BillboardAccount.snapshot().ethereumAddress,old);
});


test('permission dialog may clear and replace accounts and announce its network before activation',async()=>{
 const f=await fixture(),selected=browserConnection(f,{requested:'0x'+'34'.repeat(20)});
 const request=f.context.window.ethereum.request;f.context.window.ethereum.request=async arg=>{if(arg.method!=='wallet_requestPermissions')return request(arg);f.listeners.accountsChanged([]);f.listeners.accountsChanged(['0x'+'12'.repeat(20)]);f.listeners.chainChanged('0x1');f.listeners.accountsChanged([selected]);return[];};
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true});
 assert.equal(f.context.window.BillboardAccount.snapshot().ethereumAddress,selected);assert.equal(f.context.window.walletState.invalidated,false);
 f.listeners.accountsChanged([]);assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);
});
test('disconnect while choosing an account still prevents activating a signer',async()=>{
 const f=await fixture();browserConnection(f);const request=f.context.window.ethereum.request;f.context.window.ethereum.request=async arg=>{if(arg.method!=='wallet_requestPermissions')return request(arg);f.listeners.disconnect();return[];};
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum,'MetaMask',{selectAccount:true}));
 assert.equal(f.context.window.walletState.ethSigner,null);
});

test('final account validation reads the transport rather than a cached provider result',async()=>{
 const f=await fixture();browserConnection(f);const request=f.context.window.ethereum.request;
 f.context.window.ethereum.request=async arg=>arg.method==='eth_accounts'?['0x'+'34'.repeat(20)]:request(arg);
 await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum));assert.equal(f.context.window.walletState.ethSigner,null);
});
test('preactivation disconnect followed by reconnect permits a validated session',async()=>{
 const f=await fixture();browserConnection(f,{afterNetwork:()=>{f.listeners.disconnect();f.listeners.connect({chainId:'0x7a69'});}});
 await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,true);
});
test('same-chain announcements after activation preserve the session; a changed chain invalidates it',async()=>{
 const f=await fixture();browserConnection(f);await f.context.window.BillboardAccount.connect(f.context.window.ethereum);
 f.listeners.chainChanged('0x07A69');assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,true);
 f.listeners.chainChanged('0x1');assert.equal(f.context.window.BillboardAccount.snapshot().ethereumConnected,false);
});


test('opening a remembered account is silent and preserves its full key and salt',async()=>{
 const f=await accountFixture();await f.context.window.BillboardAccount.connect(f.context.window.ethereum);assert.equal(f.calls.sign,0);assert.equal(f.context.window.walletState.aztec,null);
 f.setSaved({wallet:{secretKey:key,salt,address:key},metadata:{ethereumAddress:owner,providerId:'test-wallet'}});
 assert.equal(await f.context.window.BillboardAccount.restoreRemembered(),true);assert.equal(f.calls.sign,0);assert.equal(f.calls.save.length,0);assert.equal(f.context.window.walletState.aztec.salt,salt);
});
test('cancelled signatures and changed context never activate or persist an account',async()=>{
 for(const options of [{cancel:true},{change:true}]){const f=await accountFixture(options);await assert.rejects(open(f));assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.calls.save.length,0);assert(![...f.logs,...f.warnings].join('').includes('private-signature-sentinel'));}
});
test('after signature cancellation a retry requests account selection again',async()=>{
 const f=await accountFixture({cancel:true});let selections=0;const request=f.context.window.ethereum.request;
 f.context.window.ethereum.request=async arg=>{if(arg.method!=='wallet_requestPermissions')return request(arg);selections++;return[];};
 for(let i=0;i<2;i++)await assert.rejects(f.context.window.BillboardAccount.connect(f.context.window.ethereum,'Test wallet',{selectAccount:true,deriveAccount:true}));
 assert.equal(selections,2);assert.equal(f.calls.sign,2);assert.equal(f.context.window.walletState.aztec,null);
});
for(const wallet of [{secretKey:key,salt:'0x1'},{secretKey:field(0),salt},{secretKey:key,salt:field(1n<<255n)},{secretKey:key,salt,address:field(3)}])test('obsolete remembered wallet is discarded before any account activation: '+JSON.stringify(wallet),async()=>{
 const f=await accountFixture();f.setSaved({wallet,metadata:{ethereumAddress:owner}});
 assert.equal(await f.context.window.BillboardAccount.restoreRemembered(),false);assert.equal(f.calls.clear,1);assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.calls.sign,0);
 await open(f);assert.equal(f.calls.sign,1);assert.equal(f.calls.save.length,1);assert(f.context.window.walletState.aztec);
});
test('authentication failure in remembered custody fails closed without replacement signing',async()=>{
 const f=await accountFixture();f.session.load=async()=>{throw Object.assign(Error('private-ciphertext-sentinel'),{code:'BB_ETHEREUM_SESSION_INVALID'});};
 await assert.rejects(f.context.window.BillboardAccount.restoreRemembered(),{code:'BB_ETHEREUM_SESSION_INVALID'});
 await assert.rejects(open(f),{code:'BB_ETHEREUM_SESSION_INVALID'});assert.equal(f.calls.sign,0);assert.equal(f.calls.save.length,0);assert.equal(f.calls.clear,0);assert.equal(f.context.window.walletState.aztec,null);
 assert(![...f.logs,...f.warnings].join('').includes('private-ciphertext-sentinel'));
});
test('freshly derived invalid fields and mismatched addresses cannot enter custody',async()=>{
 for(const raw of [{secretKey:key,salt:'0x1'},{secretKey:field(0),salt},{secretKey:key,salt,address:field(3)}]){
  const f=await accountFixture();f.session.derive=async()=>raw;await assert.rejects(open(f),{code:'BB_ACCOUNT_RECORD_INVALID'});assert.equal(f.context.window.walletState.aztec,null);assert.equal(f.calls.save.length,0);
 }
});
test('an active wallet and its remembered record cannot be silently replaced',async()=>{
 const f=await accountFixture();await open(f);const active=f.context.window.walletState.aztec,saved=f.getSaved();
 await assert.rejects(open(f));assert.equal(f.context.window.walletState.aztec,active);assert.equal(f.getSaved(),saved);assert.equal(f.calls.sign,1);assert.equal(f.calls.save.length,1);
});
test('active application work and another tab prevent sign-out',async()=>{
 const f=await accountFixture();await open(f);f.context.window.BillboardAccount.configure({canEndSession:()=>false});
 await assert.rejects(f.context.window.BillboardAccount.endSession(),{code:'BB_OPERATION_BUSY'});assert.equal(f.calls.clear,0);assert.equal(f.context.window.walletState.invalidated,false);
 f.context.window.BillboardAccount.configure({});f.context.navigator.locks.request=async(_name,options,run)=>typeof options==='function'?options():run(null);
 await assert.rejects(f.context.window.BillboardAccount.endSession(),{code:'BB_OPERATION_BUSY'});assert.equal(f.calls.clear,0);assert.equal(f.context.window.BillboardAccount.snapshot().busy,false);
});
test('sign-out clears remembered custody and invalidates the current session',async()=>{
 const f=await accountFixture();await open(f);assert.equal((await f.context.window.BillboardAccount.endSession()).reload,true);
 assert.equal(f.calls.clear,1);assert.equal(f.getSaved(),null);assert.equal(f.context.window.BillboardAccount.snapshot().invalidated,true);assert.equal(f.context.window.BillboardAccount.snapshot().busy,false);
});
test('a throwing rendering listener cannot leave custody busy',async()=>{
 const f=await accountFixture();f.context.window.BillboardAccount.configure({onChange:()=>{throw Error('private-render-sentinel');},requireEth:false});await open(f);
 assert.equal(f.context.window.BillboardAccount.snapshot().busy,false);assert(f.context.window.walletState.aztec);assert(!f.warnings.join('').includes('private-render-sentinel'));
});
for(const code of ['BB_OPERATION_BUSY','BB_ETHEREUM_SESSION_INVALID','UNRECOGNIZED'])test('current wallet action safely reports '+code,async()=>{
 const f=await accountFixture();await open(f);
 const env=fs.readFileSync(new URL('../shared/app-env.js',import.meta.url),'utf8');vm.runInContext(env.slice(env.indexOf('function publicOperationFailure('),env.indexOf('function makeCallEngine(')),f.context);
 f.session.clear=async()=>{throw Object.assign(Error('PRIVATE_ERROR_DETAIL'),{code});};await f.element('wbLockBtn').click();
 assert(!f.logs.some(message=>message.includes('PRIVATE_ERROR_DETAIL')));assert(f.logs.some(message=>message===f.context.publicOperationFailure({code}).message));assert.equal(f.context.window.BillboardAccount.snapshot().busy,false);
});
