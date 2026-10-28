import {executeRollingAction} from './wallet-action.mjs';
// Labelled DOM and session doubles. No browser, crypto, RPC or real account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mountRollingWalletPanel,runTopupPayment,compactAmount,fundingProgressMessage} from './wallet-panel.mjs';
function dom(t){
 let document;const observers=new Set(),changed=()=>{for(const fn of observers)fn();};
 class Element{
  static TEXT_NODE=3;
  constructor(tag,text=''){this.tagName=tag.toUpperCase();this.nodeType=tag==='#text'?3:1;this._text=text;this.childNodes=[];this.attributes=new Map();this.dataset={};this.style={setProperty(){}};this.events=new Map();this.disabled=false;this.hidden=false;this.value='';}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);} get parentElement(){return this.parentNode;} get nextSibling(){const list=this.parentNode?.childNodes??[];return list[list.indexOf(this)+1]??null;}
  get isConnected(){return this===document.body||!!this.parentNode?.isConnected;}get options(){return this.children.filter(n=>n.tagName==='OPTION');}get labels(){return this.parentNode?.tagName==='LABEL'?[this.parentNode]:[];}
  get textContent(){return this._text+this.childNodes.map(n=>n.textContent).join('');}set textContent(v){this.replaceChildren();this._text=String(v);changed();}
  setAttribute(k,v){this.attributes.set(k,String(v));if(k==='class')this.className=v;if(k==='hidden')this.hidden=true;if(k==='value')this.value=String(v);changed();}
  getAttribute(k){return this.attributes.get(k)??null;}removeAttribute(k){this.attributes.delete(k);if(k==='hidden')this.hidden=false;changed();}
  append(...items){for(let item of items){if(!(item instanceof Element))item=new Element('#text',String(item));item.remove();item.parentNode=this;this.childNodes.push(item);}changed();}
  replaceChildren(...items){for(const n of this.childNodes)n.parentNode=null;this.childNodes=[];this._text='';this.append(...items);}
  insertBefore(item,next){if(!next)return this.append(item);item.remove();item.parentNode=this;this.childNodes.splice(this.childNodes.indexOf(next),0,item);changed();}
  remove(){if(this.parentNode){const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;changed();}}
  contains(n){return n===this||this.childNodes.some(child=>child.contains(n));}
  matches(selector){selector=selector.trim();if(selector.startsWith(':scope > '))selector=selector.slice(9);
   const attr=selector.match(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/);if(attr){const val=attr[1].startsWith('data-')?this.dataset[attr[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??this.getAttribute(attr[1]):this.getAttribute(attr[1]);if(val==null||attr[2]!==undefined&&val!==attr[2])return false;selector=selector.replace(attr[0],'');}
   const parts=selector.split('.');return (!parts[0]||this.tagName===parts[0].toUpperCase())&&parts.slice(1).every(c=>(this.className??'').split(' ').includes(c));
  }
  querySelectorAll(selector){return this.children.flatMap(n=>[...(selector.split(',').some(s=>n.matches(s))?[n]:[]),...n.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  addEventListener(type,fn){const list=this.events.get(type)??[];list.push(fn);this.events.set(type,list);}fire(type){for(const fn of this.events.get(type)??[])fn({target:this,preventDefault(){}});}
  focus(){document.activeElement=this;}getClientRects(){return this.hidden?[]:[{}];}scrollIntoView(){this.scrollCount=(this.scrollCount??0)+1;}showModal(){this.open=true;}close(){this.open=false;this.fire('close');}reportValidity(){return true;}
 }
 document={createElementNS:(_namespace,t)=>new Element(t),createElement:t=>new Element(t),createTextNode:t=>new Element('#text',t),body:new Element('body')};document.activeElement=document.body;
 document.querySelector=s=>document.body.querySelector(s);document.querySelectorAll=s=>document.body.querySelectorAll(s);
 document.until=predicate=>new Promise(resolve=>{const observe=()=>{const value=predicate();if(value){observers.delete(observe);resolve(value);}};observers.add(observe);observe();});
 const old={document:globalThis.document,Node:globalThis.Node,fetch:globalThis.fetch};Object.assign(globalThis,{document,Node:Element,fetch:async()=>{document.ruleReads=(document.ruleReads??0)+1;return new Response(JSON.stringify({schemaVersion:1,complete:true,scope:{chainId:'31337',rollupVersion:'1',boardAddress:'0x'+'1'.repeat(64)},boardId:'0',board:null,mainPolicy:document.rules??{version:'1',text:''}}),{headers:{'content-type':'application/json'}});}});
 t.after(()=>Object.assign(globalThis,old));return document;
}
async function fixture(t,{fee='fee-ready',defaults={type:'post'},posting=null,topup=null,profile=false,balanceRead=null,ordinaryLimit='1000000000000000',warm=null,depositIds=['9'],moderator=false,moderatorRead=null}={}){
 const document=dom(t),balance=Promise.withResolvers(),started=Promise.withResolvers(),account={};let reads=0,prepared=null,onProgress;const submissions=[],prepareOptions=[];const core={sessions:0,status:0,names:0,moderator:0};
 const session={...(warm?{preparePostingState:async(deposit,options)=>{session.busy=true;try{return await warm(deposit,options);}finally{session.busy=false;}}}:{}),ordinaryPostingFeeLimit:ordinaryLimit,postingFeeLimit:'1000000000000000',bokConfigured:true,busy:false,topup:{bok:topup??{}},application:{
  readAccountStatus:async()=>{core.status++;if(core.status>1)await posting?.balanceRefresh?.();return {status:fee,privateFeeCredit:'1000000000000000000',depositIds};},ownedIdentities:async options=>{if(session.busy)throw Object.assign(Error('busy'),{code:'ROLLING_BUSY'});core.names++;const names=await posting?.namesRead?.(core.names,options);if(names)return names;return {identities:profile?['5']:[],records:profile?[{id:'5',first:'River',last:'Lane'}]:[],nextCursor:null};},readModeratorStatus:async()=>{core.moderator++;if(!moderatorRead)return {authorized:moderator};session.busy=true;try{return await moderatorRead();}finally{session.busy=false;}},
  readProfile:async({name})=>await posting?.profileRead?.(name)??({name,bioVersion:'3',avatarVersion:'4'}),
  readBokStatus(){reads++;started.resolve();return balanceRead?balanceRead(reads):balance.promise;},async prepare(action,options){if(options?.postingRules&&options.postingRules.parentVersion!==(document.rules?.version??'1'))throw Object.assign(Error('rules changed'),{code:'ROLLING_POSTING_RULES_CHANGED'});prepared=action;prepareOptions.push(options);if(!posting)throw Error('stop at authoritative preparation boundary');await posting.prepare?.();return {intentId:'post-1',action,status:'prepared',maximumFee:'100'};},
  async submitPrepared(id){submissions.push(id);await posting.submit?.(id);return {intentId:id,action:prepared,status:posting.status??'confirmed',...(posting.txHash?{txHash:posting.txHash}:{}),...(posting.inclusion?{inclusion:posting.inclusion}:{}),...(posting.nameAvailability?{nameAvailability:posting.nameAvailability}:{})};},
  async prepareBokPost(id,options){prepareOptions.push(options);return {intentId:'post-2',action:prepared,status:'prepared',maximumFee:'100'};}
 }};
 session.application.executeAction=(action,options)=>executeRollingAction(session.application,structuredClone(action),options);
 const runtime={getAccount:()=>account,account:{configure(){}},createSession:async options=>{onProgress=options.onProgress;core.sessions++;return session;}};
 const panel=mountRollingWalletPanel({loadRuntime:async()=>runtime,onPublicEffect:()=>posting?.effect?.(),onIncludedPostRendered:post=>posting?.reveal?.(post)});const host=document.createElement('section');document.body.append(host);panel.attachBokControls(host);panel.open(defaults);
 await document.until(()=>(defaults.type?document.querySelector('[data-action-review]'):document.querySelectorAll('button').find(b=>b.textContent==='Write a post'))&&document.querySelector('dialog').getAttribute('aria-busy')==='false');
 return {document,panel,host,balance,started,session,runtime,progress:value=>onProgress(value),reads:()=>reads,prepared:()=>prepared,submissions,prepareOptions,core:()=>({...core})};
}
test('typing @bok and editing/removing it stays immediate while a shared balance read is pending',{timeout:3000},async t=>{
 const f=await fixture(t);await f.started.promise;const editor=f.document.querySelector('textarea'),dialog=f.document.querySelector('dialog');
 editor.value='Hello @bok, help with this';editor.fire('input');
 assert.equal(f.document.querySelector('textarea'),editor);assert.equal(editor.disabled,false);assert.equal(dialog.getAttribute('aria-busy'),'false');
 assert.equal(f.document.querySelector('.bok-invitation').hidden,false);assert.equal(f.document.querySelector('[data-action-review]').disabled,true);assert.equal(f.reads(),1);
 editor.value='Hello @bok, keep my latest draft';editor.fire('input');assert.equal(editor.value,'Hello @bok, keep my latest draft');
 editor.value='A normal post';editor.fire('input');assert.equal(f.document.querySelector('.bok-invitation').hidden,true);assert.equal(editor.disabled,false);
 editor.value='@bok this draft is still editable';editor.fire('input');f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 assert.equal(f.document.querySelector('textarea'),editor);assert.equal(editor.value,'@bok this draft is still editable');assert.equal(f.reads(),1);
 assert.equal(f.document.querySelector('input[type=checkbox]'),null);assert(f.host.textContent.includes('Add credit'));
});
test('reopening a composer refreshes refunded Bok credit without replacing the draft or loading the account',{timeout:3000},async t=>{
 const refund=Promise.withResolvers();
 const f=await fixture(t,{balanceRead:count=>count===1?Promise.resolve({available:true,availableCredit:'326486'}):refund.promise});
 await f.document.until(()=>f.host.textContent.includes('0.326486 USDC available'));const before=f.core();
 assert.equal(f.panel.close(),true);f.panel.open({type:'reply',parent:'10',root:'1',subboard:'0'});
 const editor=f.document.querySelector('textarea');editor.value='@bok keep my edited reply';editor.fire('input');
 const budget=f.document.querySelector('.bok-invitation').querySelector('input');budget.value='0.5';budget.fire('input');
 assert.equal(editor.disabled,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');
 assert.equal(f.document.querySelector('[data-action-review]').disabled,true);assert(f.host.textContent.includes('0.326486 USDC available · updating'));
 await Promise.resolve();assert.equal(f.reads(),2);assert.deepEqual(f.core(),before);
 editor.value+=' while the balance updates';editor.fire('input');assert.equal(f.reads(),2);
 refund.resolve({available:true,availableCredit:'709008'});
 await f.document.until(()=>f.host.textContent.includes('0.709008 USDC available'));assert.equal(f.document.querySelector('[data-action-review]').disabled,false);
 assert.equal(f.document.querySelector('textarea'),editor);assert.equal(editor.value,'@bok keep my edited reply while the balance updates');
 assert.equal(budget.value,'0.5');assert(f.host.textContent.includes('0.709008 USDC available'));assert.equal(f.reads(),2);assert.deepEqual(f.core(),before);
});
test('account-page Write a post also refreshes credit without reopening the account',{timeout:3000},async t=>{
 const refund=Promise.withResolvers();
 const f=await fixture(t,{defaults:{},balanceRead:count=>count===1?Promise.resolve({available:true,availableCredit:'3'}):refund.promise});
 await f.document.until(()=>f.host.textContent.includes('0.000003 USDC available'));const before=f.core();
 f.document.querySelectorAll('button').find(b=>b.textContent==='Write a post').fire('click');
 const editor=f.document.querySelector('textarea');assert(editor);assert.equal(editor.disabled,false);
 await Promise.resolve();assert.equal(f.reads(),2);assert.deepEqual(f.core(),before);
 refund.resolve({available:true,availableCredit:'7'});await f.document.until(()=>f.host.textContent.includes('0.000007 USDC available'));
 assert.equal(f.document.querySelector('textarea'),editor);assert.deepEqual(f.core(),before);
});
test('basic signup does not start optional Bok work',{timeout:3000},async t=>{
 const f=await fixture(t,{fee:'collateral-pending'});assert.equal(f.reads(),0);assert.equal(f.document.querySelector('textarea').disabled,false);
});
test('failed optional balance leaves ordinary posting editable and displays its own unavailable status',{timeout:3000},async t=>{
 const f=await fixture(t);await f.started.promise;const editor=f.document.querySelector('textarea');editor.value='A normal message';editor.fire('input');f.balance.reject(Error('private diagnostic'));
 await f.document.until(()=>f.host.textContent.includes('Balance unavailable'));
 assert.equal(f.document.querySelector('textarea'),editor);assert.equal(editor.disabled,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert(!f.document.body.textContent.includes('private diagnostic'));
});

test('mention preparation retains reply ancestry and the exact edited budget; it never sends',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{type:'reply',parent:'10',root:'1',subboard:'0'}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='@bok keep this reply';editor.fire('input');
 const budgetInput=f.document.querySelector('.bok-invitation').querySelector('input');budgetInput.value='0.10';budgetInput.fire('input');
 const review=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});review.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.prepared().type,'bok');assert.equal(f.prepared().content,'@bok keep this reply');assert.equal(f.prepared().budget,'100000');assert.equal(f.prepared().parent,'10');assert.equal(f.prepared().root,'1');assert.equal(f.prepared().subboard,'0');
});

test('main-page credit action is available without a balance dialog and preserves the compose draft',{timeout:3000},async t=>{
 const f=await fixture(t);await f.started.promise;const editor=f.document.querySelector('textarea');editor.value='@bok preserve this while I add credit';editor.fire('input');
 assert.equal(f.panel.close(),true);const add=f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit');assert(add);add.fire('click');
 assert.equal(f.document.querySelector('dialog').open,true);const back=f.document.querySelectorAll('button').find(b=>b.textContent==='Back to your post');assert(back);back.fire('click');
 assert.equal(f.document.querySelector('textarea').value,'@bok preserve this while I add credit');assert.equal(f.reads(),1);f.balance.resolve({available:true,availableCredit:'0'});
});

test('existing deposited account can read Bok balance even when its posting credit is empty',{timeout:3000},async t=>{
 const f=await fixture(t,{fee:'fee-needed'});await f.started.promise;assert.equal(f.reads(),1);f.balance.resolve({available:true,availableCredit:'8'});
 await f.document.until(()=>f.host.textContent.includes('0.000008 USDC available'));
});

test('opening and reopening the social composer reuses the unlocked session while optional balance is pending',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{}});await f.started.promise;const before=f.core();
 const write=f.document.querySelectorAll('button').find(b=>b.textContent==='Write a post');write.fire('click');
 const editor=f.document.querySelector('textarea');assert(editor);assert.equal(editor.disabled,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert.deepEqual(f.core(),before);
 assert.equal(f.panel.close(),true);f.panel.open({type:'reply',parent:'10',root:'1',subboard:'0'});
 assert(f.document.querySelector('textarea'));assert.equal(f.document.querySelector('textarea').disabled,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert.deepEqual(f.core(),before);assert.equal(f.reads(),1);
 f.balance.resolve({available:true,availableCredit:'0'});
});

function signInFixture(t,{restored=false,restoreGate=null,sessionGate=null,statusGate=null,signInGate=null,status='fee-ready',freshAccount=false,savedClient=null,funding=null,prepareOpening=null}={}){
 const document=dom(t),statusStarted=Promise.withResolvers(),calls={load:0,restore:0,signIn:0,sessions:0,status:0,names:0,moderator:0,signOut:0};let account=null,configured;
 const identity=document.createElement('section');document.body.append(identity);
 const session={busy:false,...(funding?{funding}:{}),...(prepareOpening?{prepareOpening}:{}),application:{
  async readAccountStatus(){calls.status++;statusStarted.resolve();if(statusGate){session.busy=true;await statusGate.promise;session.busy=false;}return {status,depositIds:status==='fee-ready'?['9']:[]};},
  async ownedIdentities(){calls.names++;return {identities:[],records:[],nextCursor:null};},
  async readModeratorStatus(){calls.moderator++;return {authorized:false};}
 },async close(){}};
 const runtime={...(savedClient?{savedItems:async()=>savedClient}:{}),canStartTestAccount:true,startingTestAccount:()=>freshAccount,startedFreshAccount:()=>freshAccount&&!!funding,account:{configure(value){configured=value;},async endSession(){calls.signOut++;account=null;configured.onChange({});}},
  getAccount:()=>account,
  fundingWallets:()=>[{id:'metamask',name:'MetaMask',icon:'data:image/png;base64,AA=='}],
  fundingWalletStatus:()=>({connected:!!account,name:'MetaMask',address:'0x'+'1'.repeat(40)}),
  async restoreAccount(){calls.restore++;if(restoreGate)await restoreGate.promise;if(restored)account={};return restored;},
  async signInWallet(id){assert.equal(id,'metamask');calls.signIn++;if(signInGate)await signInGate.promise;account={};},
  async createSession(){calls.sessions++;if(sessionGate)await sessionGate.promise;return session;}
 };
 const panel=mountRollingWalletPanel({loadRuntime:async()=>{calls.load++;return runtime;}});panel.attachIdentityControls(identity);
 return {document,panel,runtime,calls,identity,statusStarted:statusStarted.promise,replaceAccount(){account={};configured.onChange({});}};
}

test('wallet chooser has icons and no password, files, passkey or backup path; one click preserves a reply',{timeout:3000},async t=>{
 const signInGate=Promise.withResolvers(),f=signInFixture(t,{signInGate});
 f.panel.open({accountMode:'signin',type:'reply',parent:'10',root:'1',subboard:'0',content:'Keep my reply'});
 await f.panel.initialize();const chooser=f.document.querySelectorAll('button').find(b=>b.textContent.includes('Connect MetaMask'));
 assert(chooser);assert(chooser.querySelector('img'));assert.equal(f.calls.signIn,0);
 assert.equal(f.document.querySelector('input[type=password]'),null);assert.equal(f.document.querySelector('input[type=file]'),null);
 assert(!/backup|passkey|older account/i.test(f.document.body.textContent));
 chooser.fire('click');chooser.fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('Opening your account…'));signInGate.resolve();
 await f.document.until(()=>f.document.querySelector('textarea')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.calls.signIn,1);assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,1);assert.equal(f.document.querySelector('textarea').value,'Keep my reply');
 assert.equal(f.document.querySelector('h2').textContent,'Reply');
 assert.equal(f.document.querySelector('input[type=password]'),null);assert(!/backup|passkey/i.test(f.document.body.textContent));
});

test('initialize silently restores once, shares one session, and updates main-page identity without opening a dialog',{timeout:3000},async t=>{
 const f=signInFixture(t,{restored:true}),first=f.panel.initialize();assert.equal(f.panel.initialize(),first);
 assert.equal(await first,true);assert.equal(await f.panel.initialize(),true);
 assert.equal(!!f.document.querySelector('dialog').open,false);
 assert.equal(f.calls.load,1);assert.equal(f.calls.restore,1);assert.equal(f.calls.signIn,0);assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,1);
 assert.equal(f.identity.querySelector('select').disabled,false);
 f.panel.open({type:'post',content:'An already signed-in post'});assert.equal(f.document.querySelector('textarea').value,'An already signed-in post');assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,1);
});

test('opening and closing during background restoration stays immediate and keeps the latest requested draft',{timeout:3000},async t=>{
 const restoreGate=Promise.withResolvers(),sessionGate=Promise.withResolvers(),f=signInFixture(t,{restored:true,restoreGate,sessionGate});
 const init=f.panel.initialize();f.panel.open({type:'post',content:'First draft'});
 const dialog=f.document.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(dialog.getAttribute('aria-busy'),'false');assert.equal(f.panel.close(),true);
 f.panel.open({type:'reply',parent:'10',root:'1',subboard:'0',content:'Latest draft'});assert.equal(dialog.open,true);assert.equal(dialog.getAttribute('aria-busy'),'false');
 restoreGate.resolve();sessionGate.resolve();await init;
 assert.equal(f.document.querySelector('textarea').value,'Latest draft');assert.equal(f.document.querySelector('textarea').disabled,false);
 assert.equal(f.calls.signIn,0);assert.equal(f.calls.restore,1);assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,1);
});

test('an unfunded wallet opens posting setup after sign-in without a password or automatic payment',{timeout:3000},async t=>{
 const f=signInFixture(t,{status:'collateral-pending'});f.panel.open({type:'post',content:'My first post'});await f.panel.initialize();
 f.document.querySelectorAll('button').find(b=>b.textContent.includes('Connect MetaMask')).fire('click');
 await f.document.until(()=>f.document.querySelector('h2').textContent==='Set up posting'&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.calls.signIn,1);assert.equal(f.calls.sessions,1);assert.equal(f.document.querySelector('input[type=password]'),null);
});


test('closing while background account status owns the SDK remains available',{timeout:3000},async t=>{
 const statusGate=Promise.withResolvers(),f=signInFixture(t,{restored:true,statusGate});
 const init=f.panel.initialize();f.panel.open({type:'post',content:'Preserved during account status'});
 // createSession progress is observed via the actual status method call, not a delay.
 await f.statusStarted;
 assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert.equal(f.panel.close(),true);
 statusGate.resolve();await init;assert.equal(!!f.document.querySelector('dialog').open,false);
 assert.equal(f.calls.sessions,1);assert.equal(f.calls.signIn,0);
});

for(const type of ['post','reply','quote','repost'])test(`one ${type} click submits the captured draft once and prevents double clicks`,{timeout:3000},async t=>{
 const hold=Promise.withResolvers(),entered=Promise.withResolvers();
 const defaults={type,subboard:'0',...(type==='reply'?{parent:'10',root:'1'}:{}),...(['quote','repost'].includes(type)?{reference:'12'}:{})};
 const f=await fixture(t,{defaults,posting:{prepare:()=>{entered.resolve();return hold.promise;}}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});
 const editor=f.document.querySelector('textarea');editor.value='My exact message';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});
 assert(!button.textContent.includes('Review'));button.fire('click');button.fire('click');
 assert.equal(button.textContent,'Posting…');assert(button.disabled);await entered.promise;assert.equal(f.submissions.length,0);
 hold.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 await f.document.until(()=>f.core().status===2&&f.host.textContent.includes('0 USDC available'));assert.equal(f.reads(),1);
 assert.equal(f.document.querySelector('dialog').open,false);
 assert.deepEqual(f.submissions,['post-1']);assert.deepEqual(f.prepareOptions,[{immediate:true,postingRules:{chainId:'31337',rollupVersion:'1',boardAddress:'0x'+'1'.repeat(64),subboard:'0',parentVersion:'1',localVersion:'0'}}]);assert.equal(f.document.ruleReads,1,'no second public read at Post click');assert.equal(f.prepared().content,'My exact message');assert.equal(f.prepared().type,type);
 if(type==='reply'){assert.equal(f.prepared().parent,'10');assert.equal(f.prepared().root,'1');}
 if(['quote','repost'].includes(type))assert.equal(f.prepared().reference,'12');
});
for(const status of ['authorized','unknown','reverted'])test(`one Bok post click continues only confirmed authorization: ${status}`,{timeout:3000},async t=>{
 let sends=0;const posting={status,submit:()=>{if(++sends===2)posting.status='confirmed';}};
 const f=await fixture(t,{posting});await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));const editor=f.document.querySelector('textarea');editor.value='@bok please reply';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});assert.equal(button.textContent,'Post');button.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 if(status!=='unknown')await f.document.until(()=>f.reads()>=2&&f.host.textContent.includes('1 USDC available'));
 assert.equal(f.document.querySelector('dialog').open,status!=='authorized');
 assert.deepEqual(f.submissions,status==='authorized'?['post-1','post-2']:['post-1']);assert(f.prepareOptions.every(o=>o.immediate===true));
});

test('changed displayed rules stop one-click posting before preparation or sending',{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});
 const editor=f.document.querySelector('textarea');editor.value='Do not send under changed rules';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});
 f.document.rules={version:'2',text:'Changed rules'};
 button.fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.prepared(),null);assert.deepEqual(f.submissions,[]);assert(f.document.body.textContent.includes('Current board rules are unavailable, changed'));assert.equal(f.document.ruleReads,2,'mismatch refreshes displayed rules after failed preparation');
});
test('submission rejection retains the exact draft and unresolved action without a second Post send',{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{submit:()=>{throw Error('ambiguous response');}}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});
 const editor=f.document.querySelector('textarea');editor.value='Keep this exact draft';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});button.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('[data-action-review]'),null);assert.equal(f.document.querySelector('[data-action-confirm]'),null);assert(f.document.body.textContent.includes('Keep this exact draft'));
});

test('composer shows two compact fee numbers without extra account reads or review disclaimer',{timeout:3000},async t=>{
 const f=await fixture(t);const summary=f.document.querySelector('.composer-cost');assert(summary);assert.equal(summary.querySelectorAll('strong').length,2);assert(summary.textContent.includes('Balance 1'));assert(summary.textContent.includes('Max cost 0.001'));assert(!f.document.body.textContent.includes('Published content cannot be erased'));
 assert.deepEqual(f.core(),{sessions:1,status:1,names:0,moderator:0});f.balance.resolve({available:true,availableCredit:'0'});
});
test('main name dropdown loads names on request and leaves Create available without signup reads',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});const host=f.document.createElement('section');f.document.body.append(host);f.panel.attachIdentityControls(host);
 let select=host.querySelector('select');assert.equal(select.disabled,false);assert(select.options.some(o=>o.value==='create'));assert(select.options.some(o=>o.value==='load'));assert.equal(f.core().names,0);assert.equal(f.core().moderator,0);
 select.value='load';select.fire('change');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.core().names,1);assert.equal(f.core().moderator,0);
});
test('moderator discovery runs only when account settings are opened',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});assert.equal(f.core().moderator,0);
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.core().moderator,1);assert.equal(f.core().names,0);assert.equal(f.document.querySelector('.account-links').open,true);
});

test('confirmed post closes immediately while public feed refresh is still pending',{timeout:3000},async t=>{
 const refresh=Promise.withResolvers(),started=Promise.withResolvers();const f=await fixture(t,{posting:{effect:()=>{started.resolve();return refresh.promise;}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});const editor=f.document.querySelector('textarea');editor.value='Confirmed before feed refresh';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});button.fire('click');await started.promise;
 assert.equal(f.document.querySelector('dialog').open,false);await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.deepEqual(f.submissions,['post-1']);
 await f.document.until(()=>f.core().status===2);assert.equal(f.reads(),1);refresh.resolve();
});

test('Bok credit automatically quotes and keeps amount editable, discarding an obsolete price',{timeout:3000},async t=>{
 const gate=Promise.withResolvers(),started=Promise.withResolvers(),quotes=[];let payments=0;
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){quotes.push(input);if(quotes.length===1){started.resolve();await gate.promise;}return {...input,phase:'deposit',maximumSwapWei:'2000000000000000'};},async confirm(){payments++;return {};},async advanceClaim(){return {state:'complete'};},async inspect(){return null;}};
 const f=await fixture(t,{topup:cap});await f.started.promise;f.balance.resolve({available:true,availableCredit:'2000000'});await f.document.until(()=>f.host.textContent.includes('2 USDC available'));f.panel.close();f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit').fire('click');await started.promise;
 const amount=f.document.querySelector('input[aria-label="Amount (USD)"]');assert(amount);assert.equal(amount.disabled,false);assert.equal(f.document.querySelector('select[aria-label="Top-up credit"]'),null);assert(!f.document.body.textContent.includes('Review cost'));assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Continue top-up'));
 amount.value='5';amount.fire('input');amount.fire('change');assert.equal(amount.disabled,false);assert.equal(f.document.querySelector('input[aria-label="Amount (USD)"]'),amount);gate.resolve();
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled&&!b.hidden));assert.deepEqual(quotes.map(q=>q.amount),['1000000','5000000']);assert(f.document.querySelector('.credit-total').textContent.includes('2 USDC'));assert(f.document.querySelector('.credit-total').textContent.includes('0.002 ETH'));
 pay.fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(payments,1);assert.equal(quotes.length,2);
});
for(const completed of [false,true])test(`failed automatic Bok quote offers price retry without unrelated payment continuation (${completed?'completed payment':'no payment'})`,{timeout:3000},async t=>{
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(){throw Object.assign(Error('PRIVATE_SENTINEL'),{code:'BB_ETH_READ_FAILED'});},async inspect(){return completed?{paymentSaved:true,completed:true}:null;}};
 const f=await fixture(t,{topup:cap});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit').fire('click');
 await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh price'&&!b.hidden));assert(!f.document.body.textContent.includes('PRIVATE_SENTINEL'));assert(f.document.querySelectorAll('button').find(b=>b.textContent==='Continue payment').hidden);assert(f.document.querySelectorAll('button').find(b=>b.textContent==='Pay').disabled);
});

test('cancelled Bok payment exposes a fresh price without enabling an unquoted resend',{timeout:3000},async t=>{
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){return {...input,phase:'deposit',maximumSwapWei:'1000'};},async confirm(){throw Object.assign(Error('cancelled'),{code:'BB_ETH_REQUEST_CANCELLED'});},async inspect(){return null;}};
 const f=await fixture(t,{topup:cap});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled));pay.fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(f.document.querySelectorAll('button').find(b=>b.textContent==='Pay').disabled);assert(!f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh price').hidden);assert(f.document.querySelectorAll('button').find(b=>b.textContent==='Continue payment').hidden);
});

test('credit payment errors retain only approved Ethereum diagnostic fields',async()=>{
 for(const safe of [true,false]){const failure=Object.assign(Error('PRIVATE_SENTINEL'),{code:'BB_ETH_PREFLIGHT_FAILED',providerCode:safe?'CALL_EXCEPTION':'PRIVATE_SENTINEL',ethereumStage:safe?'preflight':'PRIVATE_SENTINEL'});
 await assert.rejects(runTopupPayment({confirm:async()=>{throw failure;}},{},{phase:'deposit'}),error=>{assert.equal(error.code,'BB_ETH_PREFLIGHT_FAILED');assert.equal(error.providerCode,safe?'CALL_EXCEPTION':undefined);assert.equal(error.ethereumStage,safe?'preflight':undefined);return true;});}
});

test('compact monetary displays round balances down and payment caps up',()=>{
 assert.equal(compactAmount('1234567890123456789',18,4),'1.2345');
 assert.equal(compactAmount('1234567890123456789',18,4,true),'1.2346');
 assert.equal(compactAmount('1',18,4,true),'0.0001');
 assert.equal(compactAmount('1234567890123456789',18,8,true),'1.2345679');
 assert.equal(compactAmount('1',18,8,true),'0.00000001');
 assert.equal(compactAmount('1000000000000000000',18,8,true),'1');
 for(const amount of ['0','1','9999999999','1234567890123456789','999999999999999999999999'])for(const places of [4,8]){
  const shown=compactAmount(amount,18,places,true),[whole,fraction='']=shown.split('.'),displayed=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));assert(displayed>=BigInt(amount));
 }
});


test('reader action captures target before waiting and blocks double clicks',{timeout:3000},async t=>{
 const gate=Promise.withResolvers(),started=Promise.withResolvers(),f=await fixture(t,{posting:{prepare:()=>{started.resolve();return gate.promise;}}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();
 const action={type:'like',post:'42'},first=f.panel.act(action);action.post='99';await started.promise;assert.deepEqual(await f.panel.act({type:'like',post:'42'}),{status:'blocked',reason:'busy'});assert.equal(f.document.querySelector('dialog').open,false);gate.resolve();assert.equal((await first).status,'confirmed');await new Promise(setImmediate);assert.equal(f.reads(),1,'unrelated Bok balance is not rescanned');assert.equal(f.prepared().post,'42');assert.equal(f.submissions.length,1);
});
for(const status of ['unknown','reverted'])test(`reader ${status} is not reported as successful or resent automatically`,{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{status}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();assert.equal((await f.panel.act({type:'like',post:'42'})).status,status);assert.equal(f.submissions.length,1);assert.equal(f.document.querySelector('dialog').open,false);
 if(status==='reverted')await f.document.until(()=>f.reads()>=2&&f.host.textContent.includes('0 USDC available'));if(status==='unknown'){assert.equal((await f.panel.act({type:'like',post:'42'})).reason,'existing-action');assert.equal(f.submissions.length,1);}
});
test('missing posting credit opens setup without sending the reader action',{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{},fee:'fee-needed'});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();assert.deepEqual(await f.panel.act({type:'like',post:'42'}),{status:'blocked',reason:'setup'});assert.equal(f.submissions.length,0);assert.equal(f.document.querySelector('dialog').open,true);
});
for(const type of ['name','bio','avatar'])test(`one ${type} save creates and submits exact edited action`,{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{},profile:true,defaults:{type,name:'5'}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));
 if(type==='name'){const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');}
 else if(type==='bio'){const input=f.document.querySelector('textarea');input.value='My exact bio';input.fire('input');}
 else f.document.querySelectorAll('button').find(b=>b.textContent==='Clear avatar').fire('click');
 const save=f.document.querySelector('[data-action-review]');assert(!save.textContent.includes('Review'));assert.equal(save.disabled,false);save.fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.submissions.length,1);assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.equal(f.document.querySelector('dialog').open,false);
 await new Promise(setImmediate);assert.equal(f.reads(),1,'name/profile changes do not invalidate unrelated Bok credit');if(type==='bio')assert.deepEqual(f.prepared(),{type,name:'5',expectedVersion:'3',content:'My exact bio'});if(type==='avatar')assert.deepEqual(f.prepared(),{type,name:'5',expectedVersion:'4',width:0,height:0,data:''});
});



test('funding progress only reports confirmed payment after reaching the private-credit stages',()=>{
 assert.equal(fundingProgressMessage({step:'recover',state:'started'}),'Waiting for your payment to confirm…');
 assert(!fundingProgressMessage({step:'recover',state:'complete'}).includes('Payment confirmed'));
 assert.equal(fundingProgressMessage({step:'prepare',state:'started'}),'Payment confirmed. Adding your posting balance on Aztec…');
 assert.equal(fundingProgressMessage({step:'prepare',state:'started'},'bok'),'Payment confirmed. Adding your Bok credit on Aztec…');
 assert.equal(fundingProgressMessage({step:'reconcile',state:'started'},'bok'),'Waiting for your Bok credit to confirm…');
 assert(!fundingProgressMessage({step:'prepare',state:'failed'},'bok').includes('Payment confirmed'));
});
for(const state of ['complete','included'])test('Bok continuation replaces stale Ethereum notice with the observed credit stage: '+state,{timeout:3000},async t=>{
 let f;const gate=Promise.withResolvers(),started=Promise.withResolvers();
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){return {...input,phase:'deposit',maximumSwapWei:'1000'};},async confirm(){return {};},async inspect(){return null;},async advanceClaim(){started.resolve();await gate.promise;return {state,intent:{intentId:'0x'+'9'.repeat(64),status:state==='included'?'included':'confirmed',txHash:'0x'+'8'.repeat(64),inclusion:{blockNumber:3,blockHash:'0x'+'7'.repeat(64)},action:{type:'claim-bok'}}};}};
 f=await fixture(t,{topup:cap});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled));pay.fire('click');await started.promise;
 const stale=f.document.createElement('p');stale.setAttribute('data-operation-feedback','');stale.textContent='Payment submitted. Waiting for confirmation…';f.document.querySelector('dialog').append(stale);
 // Put the existing notice in the rendered content container, as fundingView does.
 f.document.querySelector('.credit-total').parentElement.append(stale);
 f.progress({stage:'funding-claim',step:'prepare',deploymentStep:null,state:'started',code:null});
 assert(!f.document.body.textContent.includes('Payment submitted. Waiting for confirmation'));assert(f.document.body.textContent.includes('Payment confirmed. Adding your Bok credit on Aztec…'));
 f.progress({stage:'submitting'});assert(f.document.body.textContent.includes('Adding your Bok credit…'));assert(!f.document.body.textContent.includes('Sending your action'));
 f.progress({stage:'proof-progress'});assert(f.document.body.textContent.includes('Adding your Bok credit…'));assert(!f.document.body.textContent.includes('Loading your account…'));
 f.progress({stage:'proving'});assert(f.document.body.textContent.includes('Preparing your Bok credit…'));
 gate.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await f.document.until(()=>f.reads()>=2&&f.host.textContent.includes('0 USDC available'));if(state==='included'){assert.match(f.document.body.textContent,/confirmation pending/i);assert(!f.document.body.textContent.includes('Credit added: confirmed'));}
});

test('explicit fresh account route opens wallet selection and continues into unfunded onboarding',async t=>{
 const f=signInFixture(t,{freshAccount:true,status:'collateral-pending'});await f.panel.initialize();
 assert.equal(f.document.querySelector('dialog').open,true);
 assert(f.document.body.textContent.includes('start a new test account with an empty posting balance'));
 const connect=f.document.querySelectorAll('button').find(b=>b.textContent.includes('Connect MetaMask'));assert(connect);connect.fire('click');
 await f.document.until(()=>f.calls.status===1&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.calls.signIn,1);assert.equal(f.calls.sessions,1);assert(!f.document.body.textContent.includes('Recover the existing deposit'));
});

test('fresh account action reloads the existing page with a client-side route',async t=>{
 const f=signInFixture(t);const old=globalThis.location,location={hash:'#/home',reloads:0,reload(){this.reloads++;}};globalThis.location=location;t.after(()=>{globalThis.location=old;});
 await f.panel.initialize();f.panel.open();const start=f.document.querySelectorAll('button').find(b=>b.textContent==='Start new test account');assert(start);start.fire('click');assert.equal(location.hash,'#/new-account');assert.equal(location.reloads,1);
});


test('confirmed post releases UI while balance refresh runs; typing survives its completion',{timeout:3000},async t=>{
 const pending=Promise.withResolvers(),started=Promise.withResolvers();const f=await fixture(t,{posting:{balanceRefresh:()=>{started.resolve();return pending.promise;}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));const editor=f.document.querySelector('textarea');editor.value='First post';editor.fire('input');const first=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});first.fire('click');
 await started.promise;await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.document.querySelector('dialog').open,false);
 f.panel.open({type:'post'});const next=f.document.querySelector('textarea');next.value='Next draft while balance updates';next.fire('input');assert(f.document.body.textContent.includes('Balance (updating)'));
 pending.resolve();await f.document.until(()=>!f.document.body.textContent.includes('Balance (updating)'));
 assert.equal(f.document.querySelector('textarea'),next);assert.equal(next.value,'Next draft while balance updates');assert.equal(f.submissions.length,1);
});

const ownBokHash='0x'+'a'.repeat(64);
const publicBokParent=(reply=null)=>({id:'20',position:{txHash:ownBokHash},invocation:{pluginId:'7',requestId:'91',reply}});
async function postedBokFixture(t,{balanceRead,posting={}}={}){
 const f=await fixture(t,{balanceRead:balanceRead??(()=>Promise.resolve({available:true,availableCredit:'582972'})),posting:{txHash:ownBokHash,...posting}});
 await f.document.until(()=>f.host.textContent.includes('0.582972 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='@bok make the change';editor.fire('input');
 const budget=f.document.querySelector('.bok-invitation').querySelector('input');budget.value='0.25';budget.fire('input');
 f.document.querySelector('[data-action-review]').fire('click');
 await f.document.until(()=>!f.document.querySelector('dialog').open&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 return f;
}
test('live own Bok reply refreshes refunded credit without private reads for unrelated posts or draft replacement',{timeout:3000},async t=>{
 const refund=Promise.withResolvers();
 const f=await postedBokFixture(t,{balanceRead:count=>count<=2?Promise.resolve({available:true,availableCredit:'582972'}):refund.promise});
 await f.document.until(()=>f.reads()===2&&f.host.textContent.includes('0.582972 USDC available')&&!f.host.textContent.includes('updating'));
 const before=f.core();f.panel.observePublicPosts([publicBokParent()]);
 f.panel.observePublicPosts([{id:'30',bot:{pluginId:'7',requestId:'999'},position:{txHash:'0x'+'b'.repeat(64)}}]);
 await Promise.resolve();assert.equal(f.reads(),2);
 f.panel.observePublicPosts([publicBokParent('21')]);
 await Promise.resolve();assert.equal(f.reads(),3);assert(f.host.textContent.includes('0.582972 USDC available · updating'));
 f.panel.open({type:'reply',parent:'20',root:'20'});const editor=f.document.querySelector('textarea');editor.value='Draft stays editable';editor.fire('input');
 f.panel.observePublicPosts([publicBokParent('21'),{id:'21',bot:{pluginId:'7',requestId:'91'}}]);
 refund.resolve({available:true,availableCredit:'790268'});
 await f.document.until(()=>f.host.textContent.includes('0.790268 USDC available'));
 assert.equal(f.document.querySelector('textarea'),editor);assert.equal(editor.value,'Draft stays editable');assert.equal(editor.disabled,false);assert.deepEqual(f.core(),before);
});
test('own reply arriving during post balance refresh is queued once and consumed after existing work finishes',{timeout:3000},async t=>{
 const account=Promise.withResolvers(),refund=Promise.withResolvers(),reading=Promise.withResolvers();
 const f=await postedBokFixture(t,{posting:{balanceRefresh:()=>account.promise},balanceRead:count=>{if(count===1)return Promise.resolve({available:true,availableCredit:'582972'});reading.resolve();return refund.promise;}});
 f.panel.observePublicPosts([publicBokParent()]);
 f.panel.observePublicPosts([{id:'21',bot:{pluginId:'7',requestId:'91'}}]);
 f.panel.observePublicPosts([{id:'21',bot:{pluginId:'7',requestId:'91'}}]);
 await Promise.resolve();assert.equal(f.reads(),1);
 account.resolve();await reading.promise;assert.equal(f.reads(),2);
 refund.resolve({available:true,availableCredit:'790268'});
 await f.document.until(()=>f.host.textContent.includes('0.790268 USDC available'));await Promise.resolve();assert.equal(f.reads(),2);
});
test('own settlement during an older balance read gets one fresh read after it settles',{timeout:3000},async t=>{
 const old=Promise.withResolvers(),reading=Promise.withResolvers();
 const f=await postedBokFixture(t,{balanceRead:count=>{if(count===1)return Promise.resolve({available:true,availableCredit:'582972'});if(count===2){reading.resolve();return old.promise;}return Promise.resolve({available:true,availableCredit:'790268'});}});
 await reading.promise;f.panel.observePublicPosts([publicBokParent()]);f.panel.observePublicPosts([publicBokParent('21')]);f.panel.observePublicPosts([publicBokParent('21')]);
 assert.equal(f.reads(),2);old.resolve({available:true,availableCredit:'582972'});
 await f.document.until(()=>f.host.textContent.includes('0.790268 USDC available'));await Promise.resolve();assert.equal(f.reads(),3);
 f.panel.observePublicPosts([publicBokParent('21')]);await Promise.resolve();assert.equal(f.reads(),3);
});

for(const homeOnly of [false,true])test(`checkpointed own Bok refund refreshes once after ${homeOnly?'parent-only snapshot':'reply'} promotion`,{timeout:3000},async t=>{
 const f=await postedBokFixture(t,{balanceRead:count=>Promise.resolve({available:true,availableCredit:count<=2?'582972':'790268'})});
 await f.document.until(()=>f.reads()===2&&!f.host.textContent.includes('updating'));
 const before=f.core(),snapshot=number=>({checkpoint:{number:110},confirmationCheckpoint:{number}});
 const rows=confirmation=>[publicBokParent('21'),...(homeOnly?[]:[{id:'21',confirmation,position:{blockNumber:108},bot:{pluginId:'7',requestId:'91'}}])];
 f.panel.observePublicPosts(rows('pending'),snapshot(100));
 f.panel.observePublicPosts(rows('pending'),snapshot(105));
 await Promise.resolve();assert.equal(f.reads(),2);assert(f.host.textContent.includes('0.582972 USDC available'));
 f.panel.observePublicPosts(rows('confirmed'),snapshot(homeOnly?110:108));
 f.panel.observePublicPosts(rows('confirmed'),snapshot(110));
 await f.document.until(()=>f.host.textContent.includes('0.790268 USDC available'));
 assert.equal(f.reads(),3);assert.deepEqual(f.core(),before);
 f.panel.observePublicPosts(rows('confirmed'),snapshot(115));await Promise.resolve();assert.equal(f.reads(),3);
});

test('orphaned pending Bok reply cannot refresh refunded balance; replacement waits for its own confirmation',{timeout:3000},async t=>{
 const f=await postedBokFixture(t);
 await f.document.until(()=>f.reads()===2&&!f.host.textContent.includes('updating'));
 const snapshot=(number,confirmed)=>({checkpoint:{number},confirmationCheckpoint:{number:confirmed}});
 f.panel.observePublicPosts([publicBokParent('21')],snapshot(110,100));
 f.panel.observePublicPosts([publicBokParent()],snapshot(112,110));
 f.panel.observePublicPosts([publicBokParent('22')],snapshot(114,110));
 await Promise.resolve();assert.equal(f.reads(),2);
 f.panel.observePublicPosts([publicBokParent('22')],snapshot(115,112));await Promise.resolve();assert.equal(f.reads(),2);
 f.panel.observePublicPosts([publicBokParent('22')],snapshot(116,114));
 await f.document.until(()=>f.reads()===3&&!f.host.textContent.includes('updating'));
});

const includedPost=(intentId='post-1')=>({stage:'included',intentId,txHash:'0x'+'c'.repeat(64),blockNumber:108,blockHash:'0x'+'d'.repeat(64)});
for(const outcome of ['confirmed','unknown','reverted','error'])test(`regular post inclusion releases composer before ${outcome} while preserving account serialization`,{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers(),reveals=[];let effects=0;
 const f=await fixture(t,{posting:{status:outcome,submit:()=>{sending.resolve();return canonical.promise;},effect:()=>effects++,reveal:post=>{reveals.push(post);return true;}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Regular post, no assistant';editor.fire('input');
 f.document.querySelector('[data-action-review]').fire('click');await sending.promise;
 const before=f.core();f.progress(includedPost('unrelated'));assert.equal(f.document.querySelector('dialog').open,true);assert.equal(effects,0);
 f.progress({...includedPost(),blockNumber:0});assert.equal(f.document.querySelector('dialog').open,true);
 f.progress(includedPost());await Promise.resolve();
 assert.equal(f.document.querySelector('dialog').open,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 assert.equal(effects,1);assert.equal(editor.value,'Regular post, no assistant');assert.deepEqual(f.core(),before);assert.equal(f.reads(),1);
 f.progress(includedPost());assert.equal(effects,1);
 assert.deepEqual(await f.panel.act({type:'like',post:'1'}),{status:'blocked',reason:'busy'});
 if(outcome==='confirmed'){
  f.panel.open({type:'post'});assert.equal(f.document.querySelector('dialog').open,true);assert.equal(f.panel.close(),true);f.panel.open({type:'post'});
 }
 if(outcome==='error')canonical.reject(Error('failed checkpoint'));else canonical.resolve();
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.document.querySelector('dialog').open,true,'reopened view or subsequent failure remains visible');
 if(outcome==='confirmed')assert.equal(effects,1);else assert(f.document.querySelector('[role=alert]')||f.document.body.textContent.includes('unconfirmed')||f.document.body.textContent.includes('reverted'));
 await new Promise(setImmediate);
});

for(const outcome of ['confirmed','unknown','reverted','error'])test(`inline inclusion is visible but keeps its transaction locked until ${outcome}`,{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers(),refresh=Promise.withResolvers();let effects=0,inclusions=0;
 const f=await fixture(t,{posting:{status:outcome,submit:()=>{sending.resolve();return canonical.promise;},effect:()=>effects++,balanceRefresh:()=>outcome==='confirmed'?refresh.promise:undefined}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Unrelated draft';editor.fire('input');
 let settled=false;const action=f.panel.act({type:'like',post:'10'},{onIncluded:()=>inclusions++}).then(value=>{settled=true;return value;});await sending.promise;
 const before=f.core();f.progress(includedPost('other'));f.progress({...includedPost(),blockHash:'bad'});assert.equal(inclusions,0);
 f.progress({stage:'submitting',intentId:'post-1',txHash:includedPost().txHash});
 f.progress({...includedPost(),txHash:'0x'+'e'.repeat(64)});assert.equal(inclusions,0);
 f.progress(includedPost());await Promise.resolve();f.progress(includedPost());
 assert.equal(inclusions,1);assert.equal(settled,false);assert.equal(effects,1);assert.deepEqual(f.core(),before);
 assert(identity.textContent.includes('confirmation pending'));assert.equal(f.document.querySelector('dialog').open,true,'inline action cannot close unrelated composer');assert.equal(editor.value,'Unrelated draft');
 assert.deepEqual(await f.panel.act({type:'like',post:'11'}),{status:'blocked',reason:'busy'});
 if(outcome==='error')canonical.reject(Error('private provider failure'));else canonical.resolve();
 const result=await action;assert.equal(result.status,outcome==='error'?'unknown':outcome);
 if(outcome==='confirmed'){assert(identity.textContent.includes('confirmed'));assert.equal(effects,1);assert.equal(f.document.querySelector('dialog').open,true);refresh.resolve();}
 else{assert(!identity.textContent.includes(': confirmed.'));if(outcome==='reverted')assert(identity.textContent.includes('The change reverted.'));}
 await new Promise(setImmediate);
});

test('profile inclusion closes only its own modal while canonical confirmation remains pending',{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers();let effects=0;
 const f=await fixture(t,{profile:true,defaults:{type:'bio',name:'5'},posting:{submit:()=>{sending.resolve();return canonical.promise;},effect:()=>effects++}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='My new bio';editor.fire('input');f.document.querySelector('[data-action-review]').fire('click');await sending.promise;
 f.progress(includedPost());await Promise.resolve();assert.equal(f.document.querySelector('dialog').open,false);assert(identity.textContent.includes('confirmation pending'));assert.equal(effects,1);
 f.panel.open({type:'bio',name:'5'});assert.equal(f.document.querySelector('dialog').open,true);
 canonical.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.document.querySelector('dialog').open,true,'confirmation does not close a reopened view');assert.equal(effects,1);
 await new Promise(setImmediate);
});


const warmHead=(number,hash='1')=>({checkpoint:{number:number+3,hash:'0x'+'f'.repeat(64)},confirmationCheckpoint:{number,hash:'0x'+hash.repeat(64)}});
test('checkpoint observations never scan private balances while editing or reopening the composer',{timeout:3000},async t=>{
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{}});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Keep typing';editor.fire('input');
 const before=f.core();for(const number of [10,10,11,12])f.panel.observePublicPosts([],warmHead(number));
 await new Promise(setImmediate);assert.deepEqual(f.core(),before);assert.equal(editor.disabled,false);assert.equal(editor.value,'Keep typing');
 assert.equal(f.panel.close(),true);f.panel.observePublicPosts([],warmHead(13));f.panel.open({type:'post',content:'Kept'});
 await new Promise(setImmediate);assert.deepEqual(f.core(),before);assert.deepEqual(f.submissions,[]);
});
test('checkpoint updates during Post do not queue a competing account refresh',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),started=Promise.withResolvers(),f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{submit:()=>{started.resolve();return held.promise;}}});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Post without balance scan';editor.fire('input');
 f.panel.observePublicPosts([],warmHead(30));f.document.querySelector('[data-action-review]').fire('click');await started.promise;
 assert.equal(f.core().status,1);for(const number of [31,32,33])f.panel.observePublicPosts([],warmHead(number));
 await new Promise(setImmediate);assert.equal(f.core().status,1);assert.deepEqual(f.submissions,['post-1']);
 held.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.prepared().content,'Post without balance scan');
});

test('initial account refresh is not repeated by checkpoint observations',{timeout:3000},async t=>{
 const f=signInFixture(t,{restored:true});
 f.panel.observePublicPosts([],warmHead(50));f.panel.open({type:'post',content:'Keep initial draft'});
 await f.panel.initialize();assert.equal(f.calls.status,1);
 f.panel.observePublicPosts([],warmHead(50));await Promise.resolve();assert.equal(f.calls.status,1);
});

test('a bounded fee reservation failure explains the outcome without exposing private errors',{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{prepare:()=>{throw Object.assign(Error('PRIVATE_BALANCE_SENTINEL'),{code:'BB_FEE_RESERVATION_UNAFFORDABLE'});}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});
 const editor=f.document.querySelector('textarea');editor.value='Keep my post';editor.fire('input');
 const button=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});button.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(f.document.body.textContent.includes('A fee estimate could not fit your posting credit. No transaction was sent.'));
 assert(!f.document.body.textContent.includes('PRIVATE_BALANCE_SENTINEL'));assert.deepEqual(f.submissions,[]);assert(f.document.body.textContent.includes('Keep my post'));
});

test('ordinary and Bok composers show their respective maximum posting costs',{timeout:3000},async t=>{
 const f=await fixture(t,{ordinaryLimit:'200000000000000'});await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 assert(f.document.querySelector('.composer-cost').textContent.includes('Max cost 0.0002'));
 const editor=f.document.querySelector('textarea');editor.value='@bok help';editor.fire('input');
 assert(f.document.querySelector('.composer-cost').textContent.includes('Max cost 0.001'));
 editor.value='Ordinary post';editor.fire('input');assert(f.document.querySelector('.composer-cost').textContent.includes('Max cost 0.0002'));
});

test('native insufficient-credit failure keeps a usable composer and its draft',{timeout:3000},async t=>{
 let tries=0;const f=await fixture(t,{posting:{submit:async()=>{if(++tries===1)throw Object.assign(Error('Add credit'),{code:'BB_POST_FEE_CREDIT_REQUIRED'});}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 const editor=f.document.querySelector('textarea');editor.value='Keep my unsent post';editor.fire('input');const first=await f.document.until(()=>{const b=f.document.querySelector('[data-action-review]');return b&&!b.disabled&&b;});first.fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('Add posting credit to cover this post'));
 assert(f.document.body.textContent.includes('Keep my unsent post'));const retry=f.document.querySelector('[data-action-review]');assert(retry&&!retry.disabled);assert.equal(retry.textContent,'Post');
 retry.fire('click');await f.document.until(()=>f.submissions.length===2&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);assert.equal(f.prepared().content,'Keep my unsent post');
});

for(const outcome of ['confirmed','unknown'])test(`rendered exact submitted post releases composer before receipt ${outcome}`,{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers(),reveals=[];let effects=0;
 const f=await fixture(t,{posting:{status:outcome,submit:()=>{sending.resolve();return canonical.promise;},effect:()=>effects++,reveal:post=>{reveals.push(post);return true;}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Actual feed inclusion';editor.fire('input');
 f.document.querySelector('[data-action-review]').fire('click');await sending.promise;
 const inclusion=includedPost(),post={id:'17',confirmation:'pending',position:{txHash:inclusion.txHash,blockHash:inclusion.blockHash,blockNumber:String(inclusion.blockNumber)}};
 const snapshot={checkpoint:{number:108,hash:inclusion.blockHash},renderedPosts:[post]};
 f.panel.observePublicPosts([post],snapshot);assert.equal(f.document.querySelector('dialog').open,true,'unbound feed rows cannot close the composer');
 f.progress({stage:'submitting',intentId:'other',txHash:inclusion.txHash});f.panel.observePublicPosts([post],snapshot);assert.equal(f.document.querySelector('dialog').open,true);
 f.progress({stage:'submitting',intentId:inclusion.intentId,txHash:inclusion.txHash});
 for(const bad of [
  {...snapshot,renderedPosts:undefined},
  {...snapshot,renderedPosts:[]},
  {...snapshot,renderedPosts:[{...post,confirmation:undefined}]},
  {...snapshot,renderedPosts:[{...post,position:{...post.position,txHash:'0x'+'e'.repeat(64)}}]},
  {...snapshot,checkpoint:{number:107,hash:inclusion.blockHash}},
  {...snapshot,checkpoint:{number:108,hash:'0x'+'e'.repeat(64)}}
 ]){f.panel.observePublicPosts([post],bad);assert.equal(f.document.querySelector('dialog').open,true);}
 assert.deepEqual(reveals,[]);
 const before=f.core();f.panel.observePublicPosts([post],snapshot);await Promise.resolve();
 assert.deepEqual(reveals,[{id:'17',txHash:inclusion.txHash}]);
 f.panel.observePublicPosts([post],snapshot);assert.equal(reveals.length,1);
 assert.equal(f.document.querySelector('dialog').open,false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 assert.equal(effects,0,'already rendered inclusion needs no second feed refresh');assert.deepEqual(f.core(),before);assert.equal(editor.value,'Actual feed inclusion');
 assert.deepEqual(await f.panel.act({type:'like',post:'1'}),{status:'blocked',reason:'busy'});
 f.progress(inclusion);await Promise.resolve();assert.equal(effects,0);
 canonical.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.document.querySelector('dialog').open,outcome!=='confirmed');
 f.panel.observePublicPosts([post],snapshot);assert.equal(reveals.length,1,'completion cannot re-arm a revealed post');
});

 test('Post supersedes speculative work but joins its active native phase; checkpoints never rewarm',{timeout:3000},async t=>{
 const gate=Promise.withResolvers(),started=Promise.withResolvers();let warms=0,signal;
 const f=await fixture(t,{warm:async(_deposit,options)=>{warms++;signal=options.signal;started.resolve();await gate.promise;},posting:{}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await started.promise;
 const editor=f.document.querySelector('textarea');editor.value='Current submitted content';editor.fire('input');
 assert.equal(editor.disabled,false);f.panel.observePublicPosts([],warmHead(80));f.panel.observePublicPosts([],warmHead(81));assert.equal(warms,1);
 f.document.querySelector('[data-action-review]').fire('click');await Promise.resolve();assert.equal(signal.aborted,true);assert.equal(f.prepared(),null);
 gate.resolve();await f.document.until(()=>!f.document.querySelector('dialog').open);assert.equal(f.prepared().content,editor.value);assert.equal(warms,1);assert.equal(f.submissions.length,1);
 });
 test('completed composer prewarm is not restarted by later checkpoints before Post',{timeout:3000},async t=>{
 let warms=0;const f=await fixture(t,{balanceRead:async()=>({available:true,availableCredit:'0'}),warm:async()=>{if(++warms>1)await new Promise(()=>{});},posting:{}});
 await new Promise(setImmediate);assert.equal(warms,1);
 for(let n=80;n<90;n++)f.panel.observePublicPosts([],warmHead(n));await new Promise(setImmediate);assert.equal(warms,1);
 const editor=f.document.querySelector('textarea');editor.value='Edited after checkpoint';editor.fire('input');f.document.querySelector('[data-action-review]').fire('click');
 await f.document.until(()=>!f.document.querySelector('dialog').open);assert.equal(f.prepared().content,'Edited after checkpoint');assert.equal(warms,1);
 });
 test('closing composer stops follow-up preparation and background failure stays invisible',{timeout:3000},async t=>{
 const gate=Promise.withResolvers(),started=Promise.withResolvers();let warms=0;
 const f=await fixture(t,{warm:async()=>{warms++;started.resolve();await gate.promise;throw Error('PRIVATE_WARM_FAILURE');},posting:{}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await started.promise;
 assert.equal(f.panel.close(),true);f.panel.observePublicPosts([],warmHead(82));gate.resolve();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(warms,1);assert.equal(f.document.querySelector('dialog').open,false);assert(!f.document.body.textContent.includes('PRIVATE_WARM_FAILURE'));
 f.panel.open({type:'post',content:'Retry through fresh authoritative checks'});await new Promise(resolve=>setImmediate(resolve));assert.equal(warms,2);
 f.document.querySelector('[data-action-review]').fire('click');await f.document.until(()=>!f.document.querySelector('dialog').open);assert.equal(f.submissions.length,1);
 });

test('opening the composer from the account page starts native preparation only for the composer',{timeout:3000},async t=>{
 let warms=0;const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),warm:async()=>{warms++;}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(warms,0);
 f.document.querySelectorAll('button').find(button=>button.textContent==='Write a post').fire('click');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(warms,1);assert.equal(f.document.querySelector('textarea').disabled,false);
});

test('leaving the composer before a queued checkpoint preparation starts prevents native work',{timeout:3000},async t=>{
 let warms=0;const f=await fixture(t,{balanceRead:async()=>({available:true,availableCredit:'0'}),warm:async()=>{warms++;}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(warms,1);
 f.panel.observePublicPosts([],warmHead(90));f.panel.open({});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(warms,1);
});

test('background screening captures the selected deposit and coalesces a changed selection', {timeout:3000},async t=>{
 const gate=Promise.withResolvers(),started=Promise.withResolvers(),seen=[];
 const f=await fixture(t,{depositIds:['9','10'],balanceRead:async()=>({available:true,availableCredit:'0'}),warm:async deposit=>{seen.push(deposit);if(seen.length===1){started.resolve();await gate.promise;}}});
 await started.promise;assert.deepEqual(seen,['9']);
 const select=f.document.querySelectorAll('select').find(value=>value.options.some(option=>option.value==='10'));
 assert(select);select.value='10';select.fire('change');assert.deepEqual(seen,['9']);gate.resolve();await new Promise(setImmediate);assert.deepEqual(seen,['9','10']);
 f.panel.observePublicPosts([],warmHead(91));select.value='9';select.fire('change');await new Promise(setImmediate);assert.deepEqual(seen,['9','10','9'],'queued work reads only the final selection');
});



test('a confirmed name is not relabeled failed if native owned names cannot refresh',{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers();let effects=0;
 const f=await fixture(t,{profile:true,defaults:{type:'name'},posting:{submit:()=>{sending.resolve();return canonical.promise;},namesRead:()=>{throw Error('read unavailable');},effect:()=>effects++}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));
 const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');
 f.document.querySelector('[data-action-review]').fire('click');await sending.promise;f.progress(includedPost());await Promise.resolve();assert.equal(effects,1);
 canonical.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(identity.textContent.includes('Confirmed. Account details could not refresh.'));assert.equal(effects,1);assert.equal(f.document.querySelector('dialog').open,true);
});

for(const outcome of ['unknown','reverted','error'])test(`inline ${outcome} after inclusion leaves the closed composer closed`,{timeout:3000},async t=>{
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers();
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:outcome,submit:()=>{sending.resolve();return canonical.promise;}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();
 const pending=f.panel.act({type:'like',post:'10'});await sending.promise;f.progress(includedPost());assert.equal(f.document.querySelector('dialog').open,false);
 if(outcome==='error')canonical.reject(Error('private detail'));else canonical.resolve();await pending;
 assert.equal(f.document.querySelector('dialog').open,false);assert(!identity.textContent.includes(': confirmed.'));assert(identity.textContent.includes(outcome==='reverted'?'reverted':outcome==='error'?'could not be confirmed':'pending'));await new Promise(setImmediate);
});

test('transaction confirmation timing stops before required native name discovery',{timeout:3000},async t=>{
 const original=globalThis.performance,measures=new Map();let now=10;
 globalThis.performance={now:()=>now,clearMeasures:name=>measures.delete(name),measure:(name,entry)=>measures.set(name,{...entry})};t.after(()=>{globalThis.performance=original;});
 const canonical=Promise.withResolvers(),sending=Promise.withResolvers(),refresh=Promise.withResolvers(),refreshStarted=Promise.withResolvers();
 const f=await fixture(t,{profile:true,defaults:{type:'name'},balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{submit:()=>{sending.resolve();return canonical.promise;},namesRead:()=>{refreshStarted.resolve();return refresh.promise;}}});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');f.document.querySelector('[data-action-review]').fire('click');await sending.promise;
 now=100;f.progress({stage:'confirming'});now=150;canonical.resolve();await refreshStarted.promise;
 assert.deepEqual(measures.get('rolling.transaction.confirming'),{start:100,end:150});assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 now=999;refresh.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(measures.get('rolling.transaction.confirming'),{start:100,end:150});assert.deepEqual(measures.get('rolling.action.required-account-refresh'),{start:150,end:999});assert.equal(measures.get('rolling.action.interaction').end,999);await new Promise(setImmediate);
});

for(const [type,values] of [
 ['subboard',{slug:'new-board',name:'New board',description:'A new community',rules:'Be civil'}],
 ['moderate-post',{post:'8',reason:'Spam'}],['moderate-avatar',{name:'7',reason:'Unsafe image'}],
 ['reject-subboard',{subboard:'9',reason:'Spam'}],['set-main-policy',{rules:'Be civil'}],
])test('manual '+type+' executes directly with generic maximum and no cost review',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{type},moderator:true,posting:{},balanceRead:async()=>({available:true,availableCredit:'0'}),ordinaryLimit:'9000000000000000'});
 const controls=f.document.querySelectorAll('input,textarea').filter(n=>n.getAttribute('type')!=='hidden');
 for(const [i,value]of Object.values(values).entries()){controls[i].value=value;controls[i].fire('input');}
 const action=f.document.querySelector('[data-action-review]');assert.notEqual(action.textContent,'Review cost');assert.equal(action.disabled,false);assert(f.document.querySelector('.composer-cost').textContent.includes('0.001'));
 action.fire('click');await f.document.until(()=>f.submissions.length===1&&!f.document.querySelector('dialog').open);
 assert.deepEqual(f.prepared(),{type,...values});assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.equal(f.submissions.length,1);
});
test('moderator transfer requires explicit consent to the current successor but no cost-review simulation',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{type:'transfer-moderator'},moderator:true,posting:{},balanceRead:async()=>({available:true,availableCredit:'0'})});
 const recipient=f.document.querySelector('input[type=text]'),consent=f.document.querySelector('input[type=checkbox]'),send=f.document.querySelector('[data-action-review]');
 recipient.value='0x'+'3'.repeat(64);recipient.fire('input');assert.equal(send.disabled,true);assert.equal(f.prepared(),null);
 consent.checked=true;consent.fire('change');assert.equal(send.disabled,false);
 recipient.value='0x'+'4'.repeat(64);recipient.fire('input');assert.equal(consent.checked,false);assert.equal(send.disabled,true);
 consent.checked=true;consent.fire('change');send.fire('click');await f.document.until(()=>f.submissions.length===1&&!f.document.querySelector('dialog').open);
 assert.deepEqual(f.prepared(),{type:'transfer-moderator',successor:recipient.value});assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.equal(f.panel.moderatorAuthorized(),false);
});

async function exitFixture(t,type,exitStatus='confirmed'){
 const f=await fixture(t,{defaults:{},posting:{},balanceRead:async()=>({available:true,availableCredit:'0'})});
 const recipient='0x'+'3'.repeat(40);let selected=recipient,saved=null,refundPrepare=0,refundRequest=0;
 f.runtime.fundingWalletStatus=()=>({connected:true,name:'Test wallet',address:selected});f.runtime.fundingWallets=()=>[];f.runtime.connectFundingWallet=async()=>{};
 f.session.withdrawal={};f.session.application.readBalances=async()=>({fee:{available:'1000000000000000000'},bok:{available:'10000000'},collateral:{deposits:[],nextCursor:null}});
 const prepare=f.session.application.prepare;
 f.session.application.prepare=async(action,options)=>{const value=await prepare(action,options);return {...value,withdrawal:{kind:action.type==='withdraw-bok'?'bok':'cancelled-collateral',amount:action.amount??'100',depositor:action.recipient??recipient,eligible:true}};};
 f.session.application.submitPrepared=async id=>{f.submissions.push(id);if(!['withdraw-bok','cancel-deposit'].includes(f.prepared().type))return {intentId:id,status:'included',action:f.prepared(),txHash:'0x'+'8'.repeat(64)};saved={intentId:id,status:exitStatus,txHash:'0x'+'7'.repeat(64),action:f.prepared(),withdrawal:{kind:type==='withdraw-bok'?'bok':'cancelled-collateral',amount:type==='withdraw-bok'?'1500000':'100',depositor:recipient,eligible:true}};return saved;};
 f.session.application.readAccountStatus=async()=>({status:'fee-ready',privateFeeCredit:'1000000000000000000',depositIds:['9'],pendingWithdrawal:saved});
 f.session.withdrawal.observe=async()=>({status:'waiting',intentId:saved.intentId,txHash:saved.txHash});
 if(type==='cancel-deposit')f.session.depositRefunds={list:async()=>({deposits:[{status:'available',depositId:'17',amount:'100'}],nextOffset:null}),request:async id=>{refundRequest++;assert.equal(id,'17');return {depositId:id};},prepare:async receipt=>{refundPrepare++;return f.session.application.prepare({type:'cancel-deposit',receipt},{immediate:true});}};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Balance and withdrawals').fire('click');
 await f.document.until(()=>f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]')&&!f.session.busy&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 return {...f,recipient,setRecipient:value=>selected=value,refundCounts:()=>({refundPrepare,refundRequest})};
}
test('Bok withdrawal goes directly to private submission and keeps the saved Ethereum refund',{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok');assert(f.document.body.textContent.includes('Receive at '+f.recipient));
 const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.prepared(),{type:'withdraw-bok',amount:'1500000',recipient:f.recipient});assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('dialog').open,true);
 assert(!f.document.body.textContent.includes('Review cost'));await new Promise(resolve=>setImmediate(resolve));
});
test('Bok withdrawal rejects a connected recipient changed since its displayed action',{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok'),amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1';amount.fire('input');f.setRecipient('0x'+'4'.repeat(40));
 f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.querySelector('[role=alert]'));assert.equal(f.prepared(),null);assert.deepEqual(f.submissions,[]);
});
test('unfinished deposit refund runs its private step once and retains the Ethereum continuation',{timeout:3000},async t=>{
 const f=await exitFixture(t,'cancel-deposit');f.document.querySelectorAll('button').find(b=>b.textContent==='Find refundable deposits').fire('click');
 const button=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund '))&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund ')).fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.refundCounts(),{refundPrepare:1,refundRequest:1});assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('dialog').open,true);
});

test('unfinished refund send failure exposes saved unknown action without another submit button',{timeout:3000},async t=>{
 const f=await exitFixture(t,'cancel-deposit');f.session.application.submitPrepared=async id=>{f.submissions.push(id);throw Error('unknown transport');};
 f.document.querySelectorAll('button').find(b=>b.textContent==='Find refundable deposits').fire('click');
 await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund '))&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund ')).fire('click');
 await f.document.until(()=>f.document.querySelector('[role=alert]')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('[data-action-confirm]'),null);assert(f.document.body.textContent.includes('Check your action'));
});

test('included completion releases inline action for the next explicit action before checkpoint', {timeout:3000},async t=>{
 const gate=Promise.withResolvers(),entered=Promise.withResolvers();let calls=0;
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash},submit:()=>{calls++;if(calls===1){entered.resolve();return gate.promise;}}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));
 const first=f.panel.act({type:'like',post:'10'});await entered.promise;f.progress(includedPost());gate.resolve();
 assert.equal((await first).status,'included');assert(identity.textContent.includes('confirmation pending'));
 assert.equal((await f.panel.act({type:'like',post:'11'})).status,'included');assert.equal(calls,2);
 await new Promise(setImmediate);
});
test('checkpoint observer is display-only, deduplicated, and cannot overwrite newer action feedback', {timeout:3000},async t=>{
 const held=Promise.withResolvers();let reads=0;
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);f.session.observeIncluded=async()=>++reads===1?held.promise:{status:'included',txHash:includedPost().txHash};
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));assert.equal((await f.panel.act({type:'like',post:'10'})).status,'included');
 const head={checkpoint:{number:110,hash:'0x'+'a'.repeat(64)}};f.panel.observePublicPosts([],head);f.panel.observePublicPosts([],head);await Promise.resolve();assert.equal(reads,1);
 assert.equal((await f.panel.act({type:'like',post:'11'})).status,'included');held.resolve({status:'confirmed',txHash:includedPost().txHash});await new Promise(setImmediate);
 assert(identity.textContent.includes('confirmation pending'));assert(!identity.textContent.includes(': confirmed.'));
});
test('checkpoint observer promotes matching latest included action without another send or account operation', {timeout:3000},async t=>{
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);f.session.observeIncluded=async()=>({status:'confirmed',txHash:includedPost().txHash});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));await f.panel.act({type:'like',post:'10'});await new Promise(setImmediate);const before=f.core();
 f.panel.observePublicPosts([],{checkpoint:{number:110,hash:'0x'+'a'.repeat(64)}});await new Promise(setImmediate);
 assert(identity.textContent.includes(': confirmed.'));assert.deepEqual(f.core(),before);assert.equal(f.submissions.length,1);
});

test('same proposed head checkpoint promotion coalesces behind pending observation', {timeout:3000},async t=>{
 const held=Promise.withResolvers();let reads=0;
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);f.session.observeIncluded=async()=>++reads===1?held.promise:{status:'confirmed',txHash:includedPost().txHash};
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));await f.panel.act({type:'like',post:'10'});
 const checkpoint={number:110,hash:'0x'+'a'.repeat(64)},prior={number:107,hash:'0x'+'b'.repeat(64)},next={number:108,hash:includedPost().blockHash};
 f.panel.observePublicPosts([],{checkpoint,confirmationCheckpoint:prior});await Promise.resolve();assert.equal(reads,1);
 f.panel.observePublicPosts([],{checkpoint,confirmationCheckpoint:next});f.panel.observePublicPosts([],{checkpoint,confirmationCheckpoint:next});assert.equal(reads,1);
 held.resolve({status:'included',txHash:includedPost().txHash});await new Promise(setImmediate);assert.equal(reads,2);assert(identity.textContent.includes(': confirmed.'));
 f.panel.observePublicPosts([],{checkpoint,confirmationCheckpoint:next});await new Promise(setImmediate);assert.equal(reads,2);
});

test(`qualified like native credit shortage leaves no blocking action and permits an explicit retry`,{timeout:3000},async t=>{
 let tries=0;const f=await fixture(t,{posting:{submit:async()=>{if(++tries===1)throw Object.assign(Error('PRIVATE_BALANCE_SENTINEL'),{code:'BB_LIKE_FEE_CREDIT_REQUIRED'});}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();
 const action={type:'like',post:'42'};
 const first=await f.panel.act(action);assert.equal(first.status,'failed');assert(first.message.includes('Add posting credit to cover this action'));assert(!first.message.includes('PRIVATE_BALANCE_SENTINEL'));
 assert.equal((await f.panel.act(action)).status,'confirmed');assert.equal(tries,2);assert.equal(f.document.querySelector('dialog').open,false);
});

for(const completion of ['included','confirmed'])test(`new ${completion} name becomes selectable without unrelated account refresh and survives explicit refresh`,{timeout:3000},async t=>{
 const names=Promise.withResolvers(),namesStarted=Promise.withResolvers(),balance=Promise.withResolvers(),balanceStarted=Promise.withResolvers();
 const f=await fixture(t,{defaults:{type:'name'},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{status:completion,txHash:includedPost().txHash,inclusion:includedPost(),nameAvailability:{id:'7'},namesRead:()=>{namesStarted.resolve();return names.promise;},balanceRefresh:()=>{balanceStarted.resolve();return balance.promise;}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');
 f.document.querySelector('[data-action-review]').fire('click');await namesStarted.promise;
 assert.equal(identity.querySelector('select').value,'0');assert.equal(f.core().status,1,'no fee/deposit refresh before owned-name discovery');
 assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 names.resolve({identities:['7'],records:[{id:'7',first:'River',last:'Moss'}],nextCursor:null});await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);assert.equal(f.core().status,1);
 assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert.equal(identity.querySelector('select').disabled,false);assert.equal(identity.querySelector('select').value,'7');
 identity.querySelector('select').value='0';identity.querySelector('select').fire('change');f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh account').fire('click');await balanceStarted.promise;balance.resolve();await new Promise(setImmediate);
 assert.equal(identity.querySelector('select').value,'0','later balance refresh does not restore the old selection');assert.equal(f.core().names,1);assert.equal(f.core().status,2);
});

test('inline name completion reveals its verified selected identity once, not on later balance refresh', {timeout:3000},async t=>{
 const balance=Promise.withResolvers(),balanceStarted=Promise.withResolvers();
 const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{nameAvailability:{id:'7'},namesRead:async()=>({identities:['7'],records:[{id:'7',first:'River',last:'Moss'}],nextCursor:null}),balanceRefresh:()=>{balanceStarted.resolve();return balance.promise;}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);f.panel.close();
 const select=identity.querySelector('select');select.value='create';select.fire('change');await f.document.until(()=>f.document.querySelector('[data-action-review]')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');f.document.querySelector('[data-action-review]').fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);assert.equal(f.core().status,1);
 const selected=identity.querySelector('select');assert.equal(selected.value,'7');assert.equal(f.document.activeElement,selected);assert.equal(selected.scrollCount,1);assert.equal(f.document.querySelector('dialog').open,false);
 selected.value='0';selected.fire('change');const changed=identity.querySelector('select'),scrolls=changed.scrollCount??0;f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh account').fire('click');await balanceStarted.promise;balance.resolve();await new Promise(setImmediate);assert.equal(identity.querySelector('select').value,'0');assert.equal(selected.scrollCount,1);assert.equal(changed.scrollCount??0,scrolls);
});

async function bokAccountingActionFixture(t,posting){
 const f=await fixture(t,{defaults:{},posting,balanceRead:async()=>({available:true,availableCredit:'10000000'})});
 f.session.withdrawal={};f.session.application.readBalances=async()=>({fee:{available:'1000000000000000000'},bok:{available:'10000000'},collateral:{deposits:[],nextCursor:null}});
 f.session.application.readBokAccounting=async()=>({complete:true,anchor:{blockNumber:108},available:'10000000',totals:{available:'60',reserved:'0',charged:'30',refunded:'10'},requests:[{requestId:'42',state:'2',available:'60',reserved:'0',charged:'30',refunded:'10'}]});
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Balance and withdrawals').fire('click');
 await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Check all Bok requests')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check all Bok requests').fire('click');
 await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Release unused credit')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 return f;
}
for(const [label,type] of [['Release unused credit','cancel-bok-request'],['Expire request','expire-bok-request']])test(`Bok ${type} submits once directly and releases UI at included completion`,{timeout:3000},async t=>{
 const held=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=await bokAccountingActionFixture(t,{status:'included',txHash:includedPost().txHash,inclusion:includedPost(),submit:()=>{entered.resolve();return held.promise;}});
 f.document.querySelectorAll('button').find(b=>b.textContent===label).fire('click');await entered.promise;
 assert.deepEqual(f.prepared(),{type,requestId:'42'});assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.equal(f.document.querySelector('[data-action-confirm]'),null);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 held.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('[data-action-confirm]'),null);assert(!f.document.body.textContent.includes('Review cost'));
 await new Promise(setImmediate);
});
test('Bok cancellation with uncertain submit leaves saved unknown action and no duplicate confirm',{timeout:3000},async t=>{
 const f=await bokAccountingActionFixture(t,{submit:async()=>{throw Error('transport unknown');}});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Release unused credit').fire('click');
 await f.document.until(()=>f.document.querySelector('[role=alert]')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(f.submissions,['post-1']);assert.equal(f.document.querySelector('[data-action-confirm]'),null);assert(f.document.body.textContent.includes('Check your action'));
});


test('optional moderator menu lookup leaves ordinary account navigation available and is single-flight',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=await fixture(t,{defaults:{},profile:true,balanceRead:async()=>({available:true,availableCredit:'0'}),moderatorRead:()=>{entered.resolve();return held.promise;}});
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await entered.promise;settings.fire('toggle');
 assert.equal(f.core().moderator,1);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');
 const names=f.document.querySelectorAll('button').find(b=>b.textContent==='Your names');assert.equal(names.disabled,false);names.fire('click');
 await Promise.resolve();assert.equal(f.core().names,0,'dependent native read joins the existing lease');held.resolve({authorized:true});
 await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Edit bio for River Lane'));await new Promise(resolve=>setImmediate(resolve));
 assert(f.document.querySelectorAll('button').some(b=>b.textContent==='Edit bio for River Lane'));assert.equal(f.panel.moderatorAuthorized(),true);
});
test('optional moderator failure grants no authority and does not interrupt account settings',{timeout:3000},async t=>{
 const held=Promise.withResolvers();const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),moderatorRead:()=>held.promise});
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await Promise.resolve();held.reject(Error('private failure'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.panel.moderatorAuthorized(),false);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');
 assert(!f.document.body.textContent.includes('private failure'));assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Transfer moderator authority'));
 assert.equal(f.document.querySelectorAll('button').find(b=>b.textContent==='Your names').disabled,false);
});
test('optional moderator result after sign out cannot restore authority',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),entered=Promise.withResolvers();const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),moderatorRead:()=>{entered.resolve();return held.promise;}});
 f.session.close=async()=>{};f.runtime.account.endSession=async()=>{};
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await entered.promise;
 f.document.querySelectorAll('button').find(b=>b.textContent==='Sign out').fire('click');
 await Promise.resolve();held.resolve({authorized:true});await f.document.until(()=>f.document.body.textContent.includes('You are signed out.'));await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.panel.moderatorAuthorized(),false);assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Transfer moderator authority'));
});

test('optional moderator lookup ignores an external account replacement before resolution',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),entered=Promise.withResolvers();const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),moderatorRead:()=>{entered.resolve();return held.promise;}});
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await entered.promise;
 f.runtime.getAccount=()=>null;held.resolve({authorized:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.panel.moderatorAuthorized(),false);assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Transfer moderator authority'));
});

for(const type of ['withdraw-bok','cancel-deposit'])test(`included ${type} leaves account usable and pending refund reachable after another action`,{timeout:3000},async t=>{
 const f=await exitFixture(t,type,'included');
 if(type==='withdraw-bok'){
  const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 }else{
  f.document.querySelectorAll('button').find(b=>b.textContent==='Find refundable deposits').fire('click');await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund '))&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');f.document.querySelectorAll('button').find(b=>b.textContent.startsWith('Refund ')).fire('click');
 }
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(f.document.body.textContent.includes('included on Aztec; confirmation is pending'));assert(!f.document.body.textContent.includes('exit is confirmed'));assert(!f.document.body.textContent.includes('Ethereum refund confirmed:'));
 assert.equal(f.panel.close(),true);const result=await f.panel.act({type:'like',post:'42'});assert.equal(result.status,'included');
 f.panel.open({});await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pending Ethereum refund'));
 const pending=f.document.querySelectorAll('button').find(b=>b.textContent==='Pending Ethereum refund');assert.equal(pending.disabled,false);pending.fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('waiting for settlement')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum'));assert.equal(f.submissions.length,2);await new Promise(resolve=>setImmediate(resolve));
});
test('pending refund readiness is identity-bound and never marks Ethereum payment complete',{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok','included'),amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 let prepares=0;f.session.withdrawal.prepare=async()=>{prepares++;return {};};
 f.session.withdrawal.observe=async()=>({status:'ready',intentId:'other',txHash:'0x'+'7'.repeat(64)});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check refund readiness').fire('click');await f.document.until(()=>f.document.querySelector('[role=alert]')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum'));assert.equal(prepares,0);
 f.session.withdrawal.observe=async()=>({status:'ready',intentId:'post-1',txHash:'0x'+'7'.repeat(64)});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check refund readiness').fire('click');await f.document.until(()=>f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(f.document.body.textContent.includes('has not been paid')||f.document.body.textContent.includes('refund remains saved'));assert.equal(prepares,0);assert.equal(f.submissions.length,1);
 f.session.withdrawal.observe=async()=>({status:'unknown',intentId:'post-1',txHash:'0x'+'7'.repeat(64)});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check refund readiness').fire('click');await f.document.until(()=>f.document.body.textContent.includes('not currently verified')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum'));assert.equal(prepares,0);
});

test('pending refund stays reachable beside a newer unresolved action without discarding it',{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok','included'),amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const status=f.session.application.readAccountStatus;const newer={intentId:'newer',action:{type:'like',post:'42'},status:'unknown',txHash:'0x'+'8'.repeat(64)};f.session.application.readAccountStatus=async()=>({...await status(),status:'recovering',intent:newer});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Back to account').fire('click');f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh account').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('Check your action')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Pending Ethereum refund').fire('click');await f.document.until(()=>f.document.body.textContent.includes('waiting for settlement')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.submissions.length,1);f.document.querySelectorAll('button').find(b=>b.textContent==='Back to saved action').fire('click');assert(f.document.body.textContent.includes('Check your action'));assert.equal(f.submissions.length,1);await new Promise(setImmediate);
});

for(const leave of ['none','close','view','account'])test(`pending refund follows native readiness without busy lease and ignores departed context=${leave}`,{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok','included'),gate=Promise.withResolvers(),entered=Promise.withResolvers();let signal,waits=0;
 f.session.withdrawal.waitUntilReady=async options=>{signal=options.signal;waits++;entered.resolve();return gate.promise;};
 const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');await entered.promise;
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(signal.aborted,false);assert.equal(waits,1);assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum'));
 if(leave==='close'){assert.equal(f.panel.close(),true);assert.equal(signal.aborted,true);}
 if(leave==='view'){f.document.querySelectorAll('button').find(b=>b.textContent==='Back to account').fire('click');assert.equal(signal.aborted,true);}
 if(leave==='account')f.runtime.getAccount=()=>null;
 gate.resolve({status:'ready',intentId:'post-1',txHash:'0x'+'7'.repeat(64)});await new Promise(setImmediate);
 assert.equal(f.document.querySelectorAll('button').some(b=>b.textContent==='Withdraw to Ethereum'),leave==='none');assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');assert.equal(f.submissions.length,1);assert.equal(waits,1);
});

for(const orphaned of [false,true])test('included Bok funding keeps only independently requested account refresh: '+orphaned,{timeout:3000},async t=>{
 const native=Promise.withResolvers(),nativeStarted=Promise.withResolvers();let claims=0;
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){return {...input,phase:'deposit',maximumSwapWei:'1000'};},async confirm(){return {};},async inspect(){return null;},async advanceClaim(){claims++;return {state:'included',intent:{intentId:'claim',txHash:'0x'+'8'.repeat(64),inclusion:{blockNumber:3,blockHash:'0x'+'7'.repeat(64)},action:{type:'claim-bok'}}};}};
 const f=await fixture(t,{topup:cap,balanceRead:count=>{if(count===1)return Promise.resolve({available:true,availableCredit:'0'});nativeStarted.resolve();return native.promise;},posting:{balanceRefresh:async()=>assert.equal(orphaned,true,'only an independent invalidation requests a refresh')}});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();f.host.querySelectorAll('button').find(b=>b.textContent==='Add credit').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled));pay.fire('click');await nativeStarted.promise;
 assert.equal(f.core().status,1,'no unrelated account scan ahead of native Bok balance');assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');assert(!f.host.textContent.includes('1 USDC available'));
 if(orphaned){
  f.session.observeIncluded=async({txHash})=>({txHash,status:'orphaned'});
  f.panel.observePublicPosts([],{checkpoint:{number:4,hash:'0x'+'6'.repeat(64)}});await new Promise(setImmediate);assert.equal(f.core().status,1,'orphan refresh waits for held claim balance');
 }
 native.resolve({available:true,availableCredit:'1000000'});
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert(f.host.textContent.includes('1 USDC available'));assert.equal(f.reads(),2);assert.equal(claims,1);assert.match(f.document.body.textContent,/Confirmation pending/i);
 await new Promise(setImmediate);assert.equal(f.core().status,orphaned?2:1);
 f.panel.close();f.panel.open({type:'post'});if(!orphaned)assert.match(f.document.querySelector('.composer-cost').textContent,/Balance —/,'spent fee display is invalidated');
 assert.equal((await f.panel.act({type:'like',post:'42'})).status,'confirmed');assert.equal(f.submissions.length,1);assert.equal(f.core().status,orphaned?2:1);
});

test('top-up changes wallet prompt to Ethereum waiting after acknowledged submission, before receipt',{timeout:3000},async()=>{
 const receipt=Promise.withResolvers(),submitted=Promise.withResolvers(),steps=[];let completed=false;
 const cap={async confirm({onSubmitted}){onSubmitted();submitted.resolve();await receipt.promise;return {paid:true};}};
 const pending=runTopupPayment(cap,{}, {phase:'deposit'},stage=>steps.push(stage)).then(value=>{completed=true;return value;});
 await submitted.promise;assert.deepEqual(steps,['deposit','confirmation']);assert.equal(completed,false);
 receipt.resolve();assert.deepEqual(await pending,{paid:true});
});

test('new subboard title starts empty instead of inheriting anonymous or selected identity',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},profile:true,balanceRead:async()=>({available:true,availableCredit:'0'})});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Create a board').fire('click');await f.document.until(()=>f.document.querySelector('[data-action-review]')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const textInputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');assert(textInputs.length>0);assert.equal(textInputs[0].value,'');assert.equal(f.document.querySelector('[data-action-review]').disabled,true);
 f.panel.close();f.panel.open({type:'subboard'});assert.equal(f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text')[0].value,'');
});

for(const mode of ['success','prepare-failure','confirm-failure','recipient-change','saved-success','saved-already-paid'])test(`Ethereum withdrawal prepares and requests wallet approval in one app action: ${mode}`,{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok','included'),calls=[];
 const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.session.withdrawal.observe=async()=>({status:'ready',intentId:'post-1',txHash:'0x'+'7'.repeat(64)});
 const prepared=Promise.withResolvers(),confirmed=Promise.withResolvers();
 f.session.withdrawal.prepare=async()=>{calls.push('prepare');return prepared.promise;};f.session.withdrawal.prepareSaved=async()=>{calls.push('prepareSaved');return prepared.promise;};f.session.withdrawal.confirm=async()=>{calls.push('confirm');return confirmed.promise;};
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check refund readiness').fire('click');await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw to Ethereum')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert(f.document.body.textContent.includes('1.5 USDC'));assert(f.document.body.textContent.includes(f.recipient));assert(!f.document.body.textContent.includes('Maximum Ethereum gas cost'));
 f.document.querySelectorAll('button').find(b=>b.textContent===(mode.startsWith('saved-')?'Continue saved withdrawal':'Withdraw to Ethereum')).fire('click');await new Promise(setImmediate);
 assert.deepEqual(calls,[mode.startsWith('saved-')?'prepareSaved':'prepare']);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 if(mode==='prepare-failure')prepared.reject(Error('not ready'));
 else prepared.resolve(mode==='saved-already-paid'?{status:'refunded',amount:'1500000'}:{amount:'1500000',recipient:mode==='recipient-change'?'0x'+'4'.repeat(40):f.recipient,maximumGasWei:'123',walletName:'Test wallet',savedRequest:mode==='saved-success'});
 if(['success','confirm-failure','saved-success'].includes(mode)){
  await new Promise(setImmediate);assert.deepEqual(calls,[mode==='saved-success'?'prepareSaved':'prepare','confirm']);assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Confirm Ethereum refund'));
  if(mode==='confirm-failure')confirmed.reject(Error('ambiguous wallet response'));else confirmed.resolve({status:'refunded',amount:'1500000',txHash:'0x'+'a'.repeat(64)});
 }
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 if(['prepare-failure','confirm-failure','recipient-change'].includes(mode)){assert(f.document.querySelector('[role=alert]'));assert(!f.document.body.textContent.includes('Withdrawn to Ethereum:'));assert(f.document.body.textContent.includes('refund remains saved'));}
 else assert(f.document.body.textContent.includes('Withdrawn to Ethereum: 1.5 USDC.'));
 assert.equal(calls.filter(x=>x==='confirm').length,['success','confirm-failure','saved-success'].includes(mode)?1:0);assert.equal(f.submissions.length,1);await new Promise(setImmediate);
});

test('receipt-first post reveal waits for an exact rendered row after completion and fires once',{timeout:3000},async t=>{
 const sending=Promise.withResolvers(),completion=Promise.withResolvers(),reveals=[];
 const inclusion=includedPost();
 const f=await fixture(t,{posting:{txHash:inclusion.txHash,status:'included',submit:()=>{sending.resolve();return completion.promise;},reveal:post=>{reveals.push(post);return true;}}});
 await f.started.promise;f.balance.resolve({available:true,availableCredit:'1000000'});await f.document.until(()=>f.host.textContent.includes('1 USDC available'));
 const editor=f.document.querySelector('textarea');editor.value='Receipt first';editor.fire('input');f.document.querySelector('[data-action-review]').fire('click');await sending.promise;
 f.progress(inclusion);assert.deepEqual(reveals,[]);completion.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const post={id:'19',confirmation:'pending',position:{txHash:inclusion.txHash,blockHash:inclusion.blockHash,blockNumber:String(inclusion.blockNumber)}};
 const snapshot={checkpoint:{number:108,hash:inclusion.blockHash}};
 f.panel.observePublicPosts([post],snapshot);assert.deepEqual(reveals,[],'unrendered page cannot move focus');
 f.panel.open({type:'post'});f.panel.observePublicPosts([post],{...snapshot,renderedPosts:[post]});assert.deepEqual(reveals,[],'newly opened dialog defers background reveal');f.panel.close();
 f.panel.observePublicPosts([post],{...snapshot,renderedPosts:[post]});f.panel.observePublicPosts([post],{...snapshot,renderedPosts:[post]});assert.deepEqual(reveals,[{id:'19',txHash:inclusion.txHash}]);
});

test('background moderator progress cannot leave an idle loading message or clear a later action',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),moderatorRead:()=>{entered.resolve();return held.promise;},posting:{status:'unknown'}});
 const settings=f.document.querySelector('.account-links');settings.open=true;settings.fire('toggle');await entered.promise;
 f.progress({stage:'preparing'});assert(!f.document.body.textContent.includes('Loading your account…'));assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'false');
 const action=f.panel.act({type:'like',post:'42'});await Promise.resolve();held.resolve({authorized:false});await action;
 assert(f.document.body.textContent.includes('unconfirmed or unknown'));await new Promise(setImmediate);assert(f.document.body.textContent.includes('unconfirmed or unknown'),'background completion cannot erase an explicit outcome');
});
test('foreground read clears only its own progress when it settles',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'})}),held=Promise.withResolvers(),entered=Promise.withResolvers();
 f.session.application.readBalances=async()=>{f.progress({stage:'preparing'});entered.resolve();await held.promise;return {fee:{available:'1'},collateral:{deposits:[],nextCursor:null}};};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Balance and withdrawals').fire('click');await entered.promise;assert(f.document.body.textContent.includes('Loading your account…'));
 held.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert(!f.document.body.textContent.includes('Loading your account…'));await new Promise(setImmediate);
});

for(const mode of ['success','no-collateral','zero-credit','native-failure','account-change'])test(`standalone posting-credit completion waits only for fresh native credit: ${mode}`,{timeout:3000},async t=>{
 const native=Promise.withResolvers(),nativeStarted=Promise.withResolvers();let claims=0,reads=0;
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){return {...input,phase:'deposit',maximumSwapWei:'1000'};},async confirm(){return {};},async inspect(){return null;},async advanceClaim(){claims++;return {state:'included',intent:{intentId:'claim',txHash:'0x'+'8'.repeat(64),inclusion:{blockNumber:3,blockHash:'0x'+'7'.repeat(64)},action:{type:'claim-private-fee'}}};}};
 const f=await fixture(t,{fee:'fee-needed',depositIds:mode==='no-collateral'?[]:['9'],balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{balanceRefresh:async()=>assert.fail('unrelated account refresh')}});
 f.session.topup['private-fee']=cap;f.session.application.readPrivateFeeCredit=async()=>{reads++;nativeStarted.resolve();return native.promise;};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Add posting credit').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled));pay.fire('click');await nativeStarted.promise;
 assert.equal(f.core().status,1);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 if(mode==='account-change')f.runtime.getAccount=()=>null;
 if(mode==='native-failure')native.reject(Error('native unavailable'));else native.resolve({availableCredit:mode==='zero-credit'?'0':'2000000000000000000'});
 if(['success','no-collateral','zero-credit'].includes(mode)){await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
  assert.match(f.document.body.textContent,/Posting credit added/);
  assert.equal(f.document.querySelectorAll('button').some(b=>b.textContent==='Write a post'),mode==='success');
  if(mode==='no-collateral')assert(f.document.querySelectorAll('button').some(b=>b.textContent==='Set up posting'));
  if(mode==='zero-credit')assert(f.document.body.textContent.includes('Your deposit is already in place.'));
  f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Add posting credit').fire('click');assert(f.document.querySelectorAll('strong').some(n=>n.textContent===(mode==='zero-credit'?'0':'2')));
  if(mode==='success'){f.panel.close();assert.equal((await f.panel.act({type:'like',post:'42'})).status,'confirmed');assert.equal(f.submissions.length,1);}
 }else{
  await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert(!f.document.body.textContent.includes('Posting credit added'));assert.equal(f.core().status,1);
 }
 assert.equal(claims,1);assert.equal(reads,1);await new Promise(setImmediate);assert.equal(f.core().status,1);
});

test('withdrawal interaction completes at Ethereum settlement before unrelated account refresh',{timeout:3000},async t=>{
 const original=globalThis.performance,measures=new Map();let now=10;
 globalThis.performance={now:()=>now,clearMeasures:name=>measures.delete(name),measure:(name,entry)=>measures.set(name,{...entry})};t.after(()=>{globalThis.performance=original;});
 const f=await exitFixture(t,'withdraw-bok','included'),submit=f.session.application.submitPrepared,held=Promise.withResolvers(),started=Promise.withResolvers();
 f.session.application.submitPrepared=async id=>{f.progress({stage:'proving'});started.resolve();await held.promise;return submit(id);};
 const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');now=100;f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');await started.promise;
 assert(f.document.body.textContent.includes('Creating the proof…'));assert(!f.document.body.textContent.includes('Loading your account…'));
 now=200;held.resolve();await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(measures.get('rolling.action.interaction'),{start:100,end:200});
 f.session.withdrawal.observe=async()=>({status:'ready',intentId:'post-1',txHash:'0x'+'7'.repeat(64)});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check refund readiness').fire('click');await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw to Ethereum')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const payment=Promise.withResolvers(),paymentStarted=Promise.withResolvers(),refresh=Promise.withResolvers(),refreshStarted=Promise.withResolvers();
 f.session.withdrawal.prepare=async()=>({amount:'1500000',recipient:f.recipient});f.session.withdrawal.confirm=async()=>{paymentStarted.resolve();await payment.promise;return {status:'refunded',amount:'1500000',txHash:'0x'+'a'.repeat(64)};};
 const status=f.session.application.readAccountStatus;f.session.application.readAccountStatus=async()=>{refreshStarted.resolve();await refresh.promise;return status();};
 now=300;f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw to Ethereum').fire('click');await paymentStarted.promise;
 now=500;payment.resolve();await refreshStarted.promise;assert.deepEqual(measures.get('rolling.withdrawal.ethereum'),{start:300,end:500});
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.deepEqual(measures.get('rolling.action.interaction'),{start:300,end:500});assert(f.document.body.textContent.includes('Withdrawn to Ethereum: 1.5 USDC.'));
 now=900;refresh.resolve();await new Promise(setImmediate);assert.deepEqual(measures.get('rolling.action.interaction'),{start:300,end:500});
});

for(const mode of ['paid','wrong-amount','owner-change','uncertain'])test(`saved Ethereum payment completion preserves unrelated workflow and does not await inventory: ${mode}`,{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok','included');const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const nativeStatus=f.session.application.readAccountStatus,newer={intentId:'newer',action:{type:'like',post:'42'},status:'unknown',txHash:'0x'+'8'.repeat(64)};
 f.session.application.readAccountStatus=async()=>({...await nativeStatus(),status:'recovering',intent:newer});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Back to account').fire('click');f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh account').fire('click');await f.document.until(()=>f.document.body.textContent.includes('Check your action')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Pending Ethereum refund').fire('click');await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const payment=Promise.withResolvers(),started=Promise.withResolvers(),inventory=Promise.withResolvers(),inventoryStarted=Promise.withResolvers();let checks=0,inventoryReads=0;
 f.session.withdrawal.recover=async()=>{checks++;started.resolve();return payment.promise;};
 f.session.application.readAccountStatus=async()=>{inventoryReads++;inventoryStarted.resolve();await inventory.promise;return {...await nativeStatus(),status:'recovering',intent:newer,pendingWithdrawal:null};};
 f.document.querySelectorAll('button').find(b=>b.textContent==='Check existing refund').fire('click');await started.promise;assert.equal(inventoryReads,0);
 if(mode==='owner-change')f.runtime.getAccount=()=>null;
 payment.resolve({status:mode==='uncertain'?'unknown':'refunded',amount:mode==='wrong-amount'?'1':'1500000',txHash:'0x'+'a'.repeat(64)});
 if(mode==='paid')await inventoryStarted.promise;
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(checks,1);assert.equal(f.submissions.length,1);
 if(mode==='paid'){
  assert(f.document.body.textContent.includes('The saved Ethereum refund is confirmed.'));assert(f.document.body.textContent.includes('Check your action'),'newer workflow remains present before inventory finishes');
  assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Pending Ethereum refund'));
 }else{assert(!f.document.body.textContent.includes('The saved Ethereum refund is confirmed.'));assert.equal(inventoryReads,0);}
 inventory.resolve();await new Promise(setImmediate);
});

test('signup funding shows Ethereum waiting after acknowledgment while confirm still holds receipt',{timeout:3000},async t=>{
 const f=await fixture(t,{fee:'collateral-pending',balanceRead:async()=>({available:true,availableCredit:'0'})}),started=Promise.withResolvers(),held=Promise.withResolvers();let submitted,claims=0;
 f.session.funding={defaultPrivateFeeCap:'100',async prepareStarter(){return {kind:'rolling-aggregate-eth-v1',privateFeeCap:'100',slippageBps:100,breakdown:{collateralWei:'100',fee:{maxEth:'20',amount:'200'},bok:{maxEth:'0',amount:'0'},gasBudgetWei:'10',maximumTotalWei:'130'}};},async confirm({onSubmitted}){submitted=onSubmitted;started.resolve();await held.promise;return {pending:true};},async advanceClaim(){claims++;return {state:'complete'};},pauseClaim(){}};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Set up posting').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Confirm payment'&&!b.disabled));pay.fire('click');await started.promise;
 assert(f.document.body.textContent.includes('Approve the payment in your wallet'));assert.equal(claims,0);submitted();
 assert(f.document.body.textContent.includes('Waiting for Ethereum confirmation…'));assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');assert.equal(claims,0);
 held.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(claims,1);
});




const ownedNamePage=(id,nextCursor)=>({identities:[id],records:[{id,first:'River',last:'Lane'}],nextCursor});
for(const type of ['bio','avatar'])test(`profile pagination ${type} stops at selected owned name and preserves version through explicit load more`,{timeout:3000},async t=>{
 const cursors=[],profiles=[];
 const f=await fixture(t,{defaults:{type,name:'5'},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{
  namesRead:async(_count,{cursor})=>{cursors.push(cursor);return cursor===0?ownedNamePage('5',8):ownedNamePage('6',16);},
  profileRead:async name=>{profiles.push(name);return {name,bioVersion:'11',avatarVersion:'12'};}
 }});
 assert.deepEqual(cursors,[0]);assert.deepEqual(profiles,['5']);
 f.document.querySelectorAll('button').find(b=>b.textContent==='Load more owned names').fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(cursors,[0,8]);assert.deepEqual(profiles,['5']);
 assert.equal(f.document.querySelector('select[aria-label="Profile name"]').value,'5');
 if(type==='bio'){const input=f.document.querySelector('textarea');input.value='Current profile';input.fire('input');}
 else f.document.querySelectorAll('button').find(b=>b.textContent==='Clear avatar').fire('click');
 f.document.querySelector('[data-action-review]').fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.submissions.length,1);assert.equal(f.prepared().name,'5');assert.equal(f.prepared().expectedVersion,type==='bio'?'11':'12');
});
test('profile pagination finds a requested later name without reading unrelated remaining pages',{timeout:3000},async t=>{
 const cursors=[];
 const f=await fixture(t,{defaults:{type:'bio',name:'7'},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{namesRead:async(_count,{cursor})=>{cursors.push(cursor);return cursor===0?ownedNamePage('5',8):ownedNamePage('7',16);}}});
 assert.deepEqual(cursors,[0,8]);assert.equal(f.document.querySelector('select[aria-label="Profile name"]').value,'7');
 assert(f.document.querySelectorAll('button').some(b=>b.textContent==='Load more owned names'));
});
test('profile pagination still discovers new names across every page after creation',{timeout:3000},async t=>{
 const cursors=[];
 const f=await fixture(t,{defaults:{type:'name'},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{nameAvailability:{id:'7'},namesRead:async(_count,{cursor})=>{cursors.push(cursor);return cursor===0?ownedNamePage('5',8):cursor===8?ownedNamePage('7',16):ownedNamePage('9',null);}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');
 f.document.querySelector('[data-action-review]').fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(cursors,[0,8,16]);assert.equal(identity.querySelector('select').value,'7');assert.equal(f.submissions.length,1);
});
test('profile pagination discards a held profile version after account replacement',{timeout:3000},async t=>{
 const held=Promise.withResolvers(),started=Promise.withResolvers();
 const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{namesRead:async()=>ownedNamePage('5',8),profileRead:async()=>{started.resolve();return held.promise;}}});
 f.panel.close();f.panel.open({type:'bio',name:'5'});await started.promise;
 f.runtime.getAccount=()=>null;held.resolve({name:'5',bioVersion:'11',avatarVersion:'12'});
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(f.submissions.length,0);assert.equal(f.prepared(),null);assert.equal(f.document.querySelector('select[aria-label="Profile name"]'),null);assert.equal(f.document.querySelector('[data-action-review]'),null);
});














for(const outcome of ['success','failure','account-change'])test(`opening composer refreshes only invalidated native fee display: ${outcome}`,{timeout:3000},async t=>{
 const action={type:'like',post:'42'},gate=Promise.withResolvers(),entered=Promise.withResolvers();let feeReads=0,warms=0;
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),warm:async(deposit,options)=>{warms++;if(!options.refreshFeeCredit)return;feeReads++;entered.resolve();await gate.promise;if(outcome==='failure')throw Error('unavailable fee display');return {availableCredit:'700000000000000000'};},posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash}}});
 await new Promise(setImmediate);await f.panel.act(action);await new Promise(setImmediate);assert.equal(feeReads,0,'no completion-tail credit read');
 f.panel.close();f.panel.open({type:'post'});await entered.promise;assert.equal(f.core().status,1);assert.equal(feeReads,1);const editor=f.document.querySelector('textarea');editor.value='A new post';editor.fire('input');assert.equal(editor.disabled,false);assert.equal(f.document.querySelector('[data-action-review]').disabled,false);assert(f.document.querySelector('.composer-cost').textContent.includes('Balance —'));
 if(outcome==='account-change')f.runtime.getAccount=()=>({});gate.resolve();await new Promise(setImmediate);await new Promise(setImmediate);
 assert.equal(f.core().status,1);assert.equal(feeReads,1);assert.equal(f.submissions.length,1);assert.equal(f.document.querySelector('.composer-cost')?.textContent.includes('Balance 0.7')??false,outcome==='success');
});

for(const completion of ['included','confirmed'])test(`successive ${completion} likes on separate posts preserve reaction refresh without full account reads`,{timeout:3000},async t=>{
 let effects=0,payments=0;const entered=Promise.withResolvers(),gate=Promise.withResolvers();
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:completion,txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash},effect:()=>effects++,prepare:async()=>{payments++;},submit:async()=>{if(payments===1){entered.resolve();await gate.promise;}},balanceRefresh:async()=>{throw Error('unexpected account inventory read');}}});
 await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();const before=f.core().status;
 const first=f.panel.act({type:'like',post:'42'});await entered.promise;assert.equal(effects,0);assert.equal(f.core().status,before);assert.deepEqual(await f.panel.act({type:'like',post:'43'}),{status:'blocked',reason:'busy'});
 f.progress(includedPost());await new Promise(setImmediate);assert.equal(effects,1,'receipt-bound inclusion refresh retained');gate.resolve();assert.equal((await first).status,completion);await new Promise(setImmediate);assert.equal(effects,1,'same inclusion is not refreshed twice');
 assert.equal((await f.panel.act({type:'like',post:'43'})).status,completion);await new Promise(setImmediate);
 assert.equal(effects,2,'second successful action retains its public reaction refresh');assert.equal(payments,2,'each action still enters native payment preparation');assert.equal(f.submissions.length,2);assert.equal(f.core().status,before,'neither action queues full inventory');
 f.panel.open({type:'post'});assert(f.document.querySelector('.composer-cost').textContent.includes('Balance —'));assert.equal(f.document.querySelector('.composer-cost').querySelectorAll('strong')[0].getAttribute('title'),null);await new Promise(setImmediate);
});

test('signup confirmation ends before its one authoritative readiness read, with a separate full readiness span',{timeout:3000},async t=>{
 const prior=globalThis.performance,measures=new Map();let now=10;
 globalThis.performance={now:()=>now,clearMeasures:name=>measures.delete(name),measure:(name,value)=>measures.set(name,{...value})};t.after(()=>{globalThis.performance=prior;});
 const entered=Promise.withResolvers(),held=Promise.withResolvers();
 const f=await fixture(t,{fee:'collateral-pending',balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{balanceRefresh:async()=>{entered.resolve();await held.promise;}}});
 f.session.funding={async prepareStarter(){return {kind:'rolling-aggregate-eth-v1',privateFeeCap:'100',slippageBps:100,breakdown:{collateralWei:'100',fee:{maxEth:'20',amount:'200'},bok:{maxEth:'0',amount:'0'},gasBudgetWei:'10',maximumTotalWei:'130'}};},async confirm(){return {pending:true};},async advanceClaim(){now=100;f.progress({stage:'confirming'});now=150;return {state:'complete'};},pauseClaim(){}};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Set up posting').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Confirm payment'&&!b.disabled));pay.fire('click');await entered.promise;
 assert.deepEqual(measures.get('rolling.transaction.confirming'),{start:100,end:150});assert.equal(measures.has('rolling.funding.readiness'),false);assert.equal(f.core().status,2);assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');
 now=999;held.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.deepEqual(measures.get('rolling.funding.readiness'),{start:150,end:999});assert.deepEqual(measures.get('rolling.transaction.confirming'),{start:100,end:150});assert.equal(f.core().status,2);assert(!f.document.body.textContent.includes('Your posting balance is set up.'));
});

for(const type of ['bio','avatar'])for(const completion of ['included','confirmed'])test(`successive ${completion} ${type} edits retain fresh profile versions without full inventory`,{timeout:3000},async t=>{
 let effects=0,version=3,feeReads=0;const feeEntered=Promise.withResolvers(),feeHeld=Promise.withResolvers(),profiles=[];
 const f=await fixture(t,{defaults:{type,name:'5'},profile:true,balanceRead:async()=>({available:true,availableCredit:'0'}),warm:async(_deposit,options)=>{assert.equal(options.refreshFeeCredit,true);feeReads++;feeEntered.resolve();await feeHeld.promise;return {availableCredit:'700000000000000000'};},posting:{status:completion,txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash},effect:()=>effects++,profileRead:async name=>{profiles.push(name);return {name,bioVersion:String(version),avatarVersion:String(version)};},balanceRefresh:async()=>assert.fail('Profile changes do not need collateral/account inventory')}});
 async function save(){if(type==='bio'){const input=f.document.querySelector('textarea');input.value='Fresh biography '+version;input.fire('input');}else f.document.querySelectorAll('button').find(b=>b.textContent==='Clear avatar').fire('click');f.document.querySelector('[data-action-review]').fire('click');await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);}
 await save();assert.equal(f.submissions.length,1);assert.equal(f.prepared().expectedVersion,'3');assert.equal(effects,1);assert.equal(f.core().status,1);
 version=4;f.panel.close();f.panel.open({type,name:'5'});await f.document.until(()=>profiles.length===2&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.document.querySelectorAll('button').some(b=>b.textContent==='Load profile'),false,'opening the next edit loads its native version automatically');await save();
 assert.equal(f.submissions.length,2);assert.equal(f.prepared().expectedVersion,'4');assert.equal(effects,2);assert.deepEqual(profiles,['5','5']);assert.equal(f.core().status,1);
 f.panel.open({type:'post'});await feeEntered.promise;assert(f.document.querySelector('.composer-cost').textContent.includes('Balance —'));assert.equal(f.document.querySelector('textarea').disabled,false);assert.equal(f.core().status,1);
 feeHeld.resolve();await f.document.until(()=>f.document.querySelector('.composer-cost')?.textContent.includes('Balance 0.7'));assert.equal(feeReads,1);assert.equal(f.core().status,1);
});
for(const completion of ['included','confirmed'])test(`${completion} name creation still awaits native ownership but queues no unrelated inventory`,{timeout:3000},async t=>{
 const namesEntered=Promise.withResolvers(),namesHeld=Promise.withResolvers();let effects=0;
 const f=await fixture(t,{defaults:{type:'name'},balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{status:completion,txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash},nameAvailability:{id:'7'},effect:()=>effects++,namesRead:async()=>{namesEntered.resolve();await namesHeld.promise;return ownedNamePage('7',null);},balanceRefresh:async()=>assert.fail('Name completion does not need collateral/account inventory')}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 const inputs=f.document.querySelectorAll('input').filter(n=>n.getAttribute('type')==='text');inputs[0].value='River';inputs[0].fire('input');inputs[1].value='Moss';inputs[1].fire('input');f.document.querySelector('[data-action-review]').fire('click');
 await namesEntered.promise;assert.equal(f.document.querySelector('dialog').getAttribute('aria-busy'),'true');assert.notEqual(identity.querySelector('select')?.value,'7');assert.equal(f.core().status,1);
 namesHeld.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);
 assert.equal(identity.querySelector('select').value,'7');assert.equal(f.core().names,1);assert.equal(f.core().status,1);assert.equal(effects,1);
 assert.equal((await f.panel.act({type:'like',post:'42'})).status,completion);await new Promise(setImmediate);assert.equal(f.submissions.length,2);assert.equal(f.core().status,1);assert.equal(effects,2);
});




for(const action of [{type:'like',post:'42'},{type:'like',post:'43'}])test(`reader ${action.type} acts once without opening a modal (${action.kind??''})`,{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{}});await f.started.promise;f.balance.resolve({available:true,availableCredit:'0'});await f.document.until(()=>f.host.textContent.includes('0 USDC available'));f.panel.close();
 const result=await f.panel.act(action);await new Promise(setImmediate);assert.equal(f.reads(),1,'unrelated Bok balance is not rescanned');assert.equal(result.status,'confirmed');assert.equal(f.document.querySelector('dialog').open,false);assert.equal(f.submissions.length,1);assert.deepEqual(f.prepareOptions,[{immediate:true}]);assert.deepEqual(f.prepared(),{...action,});
});

test('explicit balance view replaces invalidated reaction fee display only after its native read',{timeout:3000},async t=>{
 const action={type:'like',post:'42'},gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'}),posting:{status:'included',txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash}}});
 await f.panel.act(action);
 let reads=0;f.session.application.readBalances=async()=>{reads++;entered.resolve();await gate.promise;return {fee:{available:'700000000000000000'},collateral:{deposits:[],nextCursor:null}};};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Balance and withdrawals').fire('click');await entered.promise;
 assert(!f.document.body.textContent.includes('Posting balance: 1'));assert.equal(reads,1);gate.resolve();await f.document.until(()=>f.document.body.textContent.includes('Posting balance: 0.7'));
 f.panel.close();f.panel.open({type:'post'});assert(f.document.querySelector('.composer-cost').textContent.includes('Balance 0.7'));assert.equal(f.core().status,1);await new Promise(setImmediate);
});



function savedFixture(){let state={bookmarks:[],followedBoards:[],followedNames:[],labels:{boards:{},names:{}}};const listeners=new Set();return {ready:Promise.resolve(),snapshot:()=>structuredClone(state),status:()=> 'ready',subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){},async refresh(){},async set({kind,target,enabled,label}){const key={1:'bookmarks',2:'followedBoards',3:'followedNames'}[kind],set=new Set(state[key]);(enabled??!set.has(target))?set.add(target):set.delete(target);state={...state,[key]:[...set]};for(const fn of listeners)fn();}};}
for(const kind of [1,2,3])test('offchain saved item '+kind+' bypasses busy account, posting balance and Aztec calls',{timeout:3000},async t=>{
 const f=await fixture(t,{fee:'fee-needed',balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'})});const client=savedFixture();f.runtime.savedItems=async()=>client;
 f.session.busy=true;f.session.application.readPreferences=()=>{throw Error('no private scan');};f.session.application.executeAction=()=>{throw Error('no transaction');};
 const before=f.core();const target=kind===2?'0':'42';assert.equal((await f.panel.act({type:'preference',kind,target})).status,'confirmed');assert.equal(f.panel.preferenceEnabled(kind,target),true);assert.deepEqual(f.core(),before);assert.equal(f.submissions.length,0);
 assert.equal((await f.panel.act({type:'preference',kind,target})).status,'confirmed');assert.equal(f.panel.preferenceEnabled(kind,target),false);assert.deepEqual(f.core(),before);
});
test('saved item restore and retry use only offchain client and ignore replaced account',{timeout:3000},async t=>{
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'})}),gate=Promise.withResolvers(),client=savedFixture();let calls=0,closed=0;client.close=()=>closed++;
 f.runtime.savedItems=()=>{calls++;return gate.promise;};const load=f.panel.loadSavedItems();const before=f.core();f.runtime.getAccount=()=>({});gate.resolve(client);assert.equal(await load,false);assert.equal(f.panel.savedItemsSnapshot(),null);assert.equal(calls,1);assert.equal(closed,1);assert.deepEqual(f.core(),before);
});
for(const kind of [4,5])test('subscriptions and notifications remain unavailable kind='+kind,async t=>{
 const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'})});let calls=0;f.runtime.savedItems=()=>{calls++;throw Error('not called');};assert.equal((await f.panel.act({type:'preference',kind,target:'1'})).status,'failed');assert.equal(calls,0);assert.equal(f.panel.open({type:'read-marker',thread:'1',throughBlock:'2'}),false);
});

for(const kind of [1,2,3])test('saved item capacity is explained inline without a transaction kind='+kind,{timeout:3000},async t=>{const f=await fixture(t,{balanceRead:()=>Promise.resolve({available:true,availableCredit:'0'})}),client=savedFixture();client.set=async()=>{throw Object.assign(Error('cap'),{code:'ROLLING_SAVED_ITEMS_LIMIT',kind});};f.runtime.savedItems=async()=>client;const result=await f.panel.act({type:'preference',kind,target:'42',enabled:true});assert.equal(result.status,'failed');assert.equal(result.message,kind===1?'You can save up to 100 bookmarks. Remove one first.':'You can follow up to 100 people and boards. Remove one first.');assert.equal(f.submissions.length,0);});

test('saved items restore before a held native session or financial account read',{timeout:3000},async t=>{const sessionGate=Promise.withResolvers(),client=savedFixture();await client.set({kind:1,target:'42',enabled:true});const f=signInFixture(t,{restored:true,sessionGate,savedClient:client});let done=false;const initializing=f.panel.initialize().then(()=>done=true);await new Promise(setImmediate);assert.equal(done,false);assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,0);assert.deepEqual(f.panel.savedItemsSnapshot().bookmarks,['42']);assert.equal(f.panel.preferenceEnabled(1,'42'),true);sessionGate.resolve();await initializing;assert.equal(f.calls.status,1);});

for(const replaceOwner of [false,true])test(`fresh setup quote failure preserves diagnosis and session; account replacement=${replaceOwner}`,{timeout:3000},async t=>{
 const entered=Promise.withResolvers(),held=Promise.withResolvers();let quotes=0,sends=0;
 const funding={async prepareStarter(){quotes++;if(quotes===1){entered.resolve();await held.promise;throw Object.assign(Error('private provider detail'),{code:'AGGREGATE_LIQUIDITY_UNAVAILABLE'});}return {kind:'rolling-aggregate-eth-v1',privateFeeCap:'100',slippageBps:100,breakdown:{collateralWei:'100',fee:{maxEth:'20',amount:'200'},bok:{maxEth:'0',amount:'0'},gasBudgetWei:'10',maximumTotalWei:'130'}};},async confirm(){sends++;}};
 const f=signInFixture(t,{freshAccount:true,funding});await f.panel.initialize();
 f.document.querySelectorAll('button').find(b=>b.textContent.includes('Connect MetaMask')).fire('click');await entered.promise;
 if(replaceOwner)f.replaceAccount();held.resolve();
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(sends,0);assert.equal(f.calls.sessions,1);assert.equal(f.calls.status,0);assert(!f.document.body.textContent.includes('private provider detail'));
 if(replaceOwner){assert(!f.document.body.textContent.includes('The exchange cannot currently quote'));assert.match(f.document.body.textContent,/account.*(connect|changed)/i);return;}
 assert(f.document.body.textContent.includes('The exchange cannot currently quote this amount. No payment was sent.'));
 assert(!f.document.body.textContent.includes('Your account could not connect'));assert(!f.document.body.textContent.includes('Wallet sign-in could not complete'));
 const refresh=f.document.querySelectorAll('button').find(b=>b.textContent==='Refresh price');assert(refresh);assert.equal(refresh.disabled,false);refresh.fire('click');
 await f.document.until(()=>quotes===2&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');assert.equal(f.calls.sessions,1);assert.equal(sends,0);
});

for(const failQuote of [false,true])test(`normal sign-in uses checked opening status without reread; quote failure=${failQuote}`,{timeout:3000},async t=>{
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();let openingCalls=0,quotes=0,sends=0;
 const quote={kind:'rolling-aggregate-eth-v1',privateFeeCap:'100',slippageBps:100,breakdown:{collateralWei:'100',fee:{maxEth:'20',amount:'200'},bok:{maxEth:'0',amount:'0'},gasBudgetWei:'10',maximumTotalWei:'130'}};
 const f=signInFixture(t,{funding:{prepareStarter:async()=>{quotes++;return quote;},confirm:async()=>{sends++;}},prepareOpening:async()=>{openingCalls++;entered.resolve();await gate.promise;return {status:{status:'fee-needed',depositIds:[]},...(failQuote?{quoteError:Object.assign(Error('private quote detail'),{code:'AGGREGATE_LIQUIDITY_UNAVAILABLE'})}:{quote})};}});
 await f.panel.initialize();f.panel.open({type:'post'});f.document.querySelectorAll('button').find(b=>b.textContent.includes('Connect MetaMask')).fire('click');await entered.promise;
 assert(!f.document.querySelectorAll('button').some(b=>b.textContent==='Confirm payment'));gate.resolve();await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.equal(openingCalls,1);assert.equal(f.calls.status,0);assert.equal(quotes,0);assert.equal(sends,0);assert(!f.document.body.textContent.includes('private quote detail'));assert(!f.document.body.textContent.includes('Your account could not connect'));
 if(failQuote)assert(f.document.body.textContent.includes('The exchange cannot currently quote this amount. No payment was sent.'));
 else{const pay=f.document.querySelectorAll('button').find(b=>b.textContent==='Confirm payment');assert(pay);assert.equal(pay.disabled,false);}
});


for(const [type,values] of [
 ['subboard',{slug:'new-board',name:'New board',description:'A new community',rules:'Be civil'}],
 ['moderate-post',{post:'8',reason:'Spam'}],['moderate-avatar',{name:'7',reason:'Unsafe image'}],
 ['reject-subboard',{subboard:'9',reason:'Spam'}],['set-main-policy',{rules:'Be civil'}],
 ['transfer-moderator',{successor:'0x'+'4'.repeat(64)}],
])for(const completion of ['included','confirmed'])test(`${completion} ${type} completion refreshes public effects without queuing private inventory`,{timeout:3000},async t=>{
 let effects=0,feeReads=0;const feeEntered=Promise.withResolvers(),feeHeld=Promise.withResolvers();
 const f=await fixture(t,{defaults:{type},moderator:true,balanceRead:async()=>({available:true,availableCredit:'0'}),
  warm:async(_deposit,options)=>{assert.equal(options.refreshFeeCredit,true);feeReads++;feeEntered.resolve();await feeHeld.promise;return {availableCredit:'700000000000000000'};},
  posting:{status:completion,txHash:includedPost().txHash,inclusion:{blockNumber:108,blockHash:includedPost().blockHash},effect:()=>effects++,balanceRefresh:async()=>assert.fail('Public Board actions do not need full private account inventory')}});
 const controls=f.document.querySelectorAll('input,textarea').filter(n=>n.getAttribute('type')!=='hidden'&&n.getAttribute('type')!=='checkbox');
 for(const [i,value]of Object.values(values).entries()){controls[i].value=value;controls[i].fire('input');}
 if(type==='transfer-moderator'){const consent=f.document.querySelector('input[type=checkbox]');consent.checked=true;consent.fire('change');}
 const action=f.document.querySelector('[data-action-review]');assert.equal(action.disabled,false);action.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');await new Promise(setImmediate);
 assert.deepEqual(f.prepared(),{type,...values});assert.equal(f.submissions.length,1);assert.equal(effects,1);assert.equal(f.core().status,1);
 if(type==='transfer-moderator')assert.equal(f.panel.moderatorAuthorized(),false,'transfer discards prior menu authority');
 assert.equal((await f.panel.act({type:'like',post:'42'})).status,completion);assert.equal(f.submissions.length,2);assert.equal(f.core().status,1);assert.equal(effects,2);
 f.panel.open({type:'post'});await feeEntered.promise;
 assert(f.document.querySelector('.composer-cost').textContent.includes('Balance —'),'spent fee is not displayed as a known balance');
 assert.equal(f.document.querySelector('textarea').disabled,false);assert.equal(f.core().status,1);
 feeHeld.resolve();await f.document.until(()=>f.document.querySelector('.composer-cost')?.textContent.includes('Balance 0.7'));
 assert.equal(feeReads,1);assert.equal(f.core().status,1);
});

test('pending Ethereum refund keeps balances usable without offering another withdrawal',{timeout:3000},async t=>{
 const f=await exitFixture(t,'withdraw-bok');
 const amount=f.document.querySelector('input[aria-label="Bok credit to withdraw in USDC"]');amount.value='1.5';amount.fire('input');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Withdraw Bok credit').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('refund remains saved')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 f.session.depositRefunds={list:async()=>{throw Error('Unfinished refund must not be offered');},request:async()=>{throw Error('No second Ethereum request');}};
 f.session.application.readBalances=async()=>({fee:{available:'1000000000000000000'},bok:{available:'8500000'},collateral:{deposits:[{id:'9',amount:'1000000000000000'}],nextCursor:null}});
 f.document.querySelectorAll('button').find(b=>b.textContent==='Back to account').fire('click');
 f.document.querySelectorAll('button').find(b=>b.textContent==='Balance and withdrawals').fire('click');
 await f.document.until(()=>f.document.body.textContent.includes('Complete your pending Ethereum refund')&&f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 const labels=f.document.querySelectorAll('button').map(b=>b.textContent);
 for(const unavailable of ['Withdraw Bok credit','Withdraw deposit','Find refundable deposits'])assert(!labels.includes(unavailable));
 assert(labels.includes('Pending Ethereum refund'));assert(labels.includes('Refresh balances'));assert.deepEqual(f.submissions,['post-1']);
 await new Promise(resolve=>setImmediate(resolve));
});

test('one account Like becomes Liked and a repeated click does not submit again',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},posting:{status:'confirmed'}});f.balance.resolve({available:false});await f.started.promise;await new Promise(setImmediate);
 assert.equal((await f.panel.act({type:'like',post:'9'})).status,'confirmed');assert.equal(f.panel.likeState('9'),true);
 assert.deepEqual(await f.panel.act({type:'like',post:'9'}),{status:'confirmed',alreadyLiked:true});assert.equal(f.submissions.length,1);
 assert.equal((await f.panel.act({type:'unlike',post:'9'})).status,'failed');assert.equal(f.submissions.length,1);
});
test('reload hydration uses public tag state and no send',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},posting:{}});f.balance.resolve({available:false});await new Promise(setImmediate);
 const snapshot={checkpoint:{number:3,hash:'0x'+'8'.repeat(64)},revision:'1'};let calls=0;f.session.application.readLikes=async posts=>{calls++;return {posts:posts.map(post=>({post,liked:post==='9'})),anchor:snapshot.checkpoint,revision:'1'};};
 f.panel.loadLikes(['9','10'],snapshot);await new Promise(setImmediate);
 assert.equal(f.panel.likeState('9'),true);assert.equal(f.panel.likeState('10'),false);assert.equal(calls,1);assert.equal(f.submissions.length,0);
 f.panel.loadLikes(['9','10']);await new Promise(setImmediate);assert.equal(calls,1,'Feed rerenders reuse the account-scoped result');
});
test('included feedback immediately observes an already rendered checkpoint',{timeout:3000},async t=>{
 const txHash='0x'+'7'.repeat(64),blockHash='0x'+'8'.repeat(64),f=await fixture(t,{defaults:{},posting:{status:'included',txHash,inclusion:{blockNumber:3,blockHash}}});
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 f.balance.resolve({available:false});await new Promise(setImmediate);let observations=0;
 f.session.observeIncluded=async input=>{observations++;assert.equal(input.txHash,txHash);return {status:'confirmed',txHash};};
 f.panel.observePublicPosts([],{checkpoint:{number:3,hash:blockHash},confirmationCheckpoint:{number:3,hash:blockHash}});
 await f.panel.act({type:'like',post:'9'});await new Promise(setImmediate);
 assert.equal(observations,1);assert.equal(f.panel.likeState('9'),true);assert(f.document.body.textContent.includes('Like post: confirmed.'));
});
test('native duplicate detection marks Liked without starting a payment',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},posting:{}});f.balance.resolve({available:false});await new Promise(setImmediate);
 f.session.application.executeAction=async()=>{throw Object.assign(Error('already liked'),{code:'ROLLING_ALREADY_LIKED'});};
 assert.equal((await f.panel.act({type:'like',post:'9'})).status,'confirmed');assert.equal(f.panel.likeState('9'),true);assert.equal(f.submissions.length,0);
});

const likeFeed=(revision='1',hash='8')=>({checkpoint:{number:3,hash:'0x'+hash.repeat(64)},revision});
const likeRows=(posts,snapshot,liked)=>({posts:posts.map(post=>({post,liked})),anchor:snapshot.checkpoint,revision:snapshot.revision});
test('held public like hydration does not own wallet work or delay a post',{timeout:3000},async t=>{
 const f=await fixture(t,{posting:{}});f.balance.resolve({available:false});await new Promise(setImmediate);
 const held=Promise.withResolvers();let reads=0;f.session.application.readLikes=()=>{reads++;return held.promise;};f.panel.loadLikes(['9'],likeFeed());await new Promise(setImmediate);assert.equal(reads,1);
 const editor=f.document.querySelector('textarea');editor.value='Keep posting while likes load';editor.fire('input');f.document.querySelector('[data-action-review]').fire('click');
 await f.document.until(()=>f.submissions.length===1);assert.equal(f.session.busy,false);held.resolve(likeRows(['9'],likeFeed(),true));await new Promise(setImmediate);assert.equal(f.panel.likeState('9'),true);
});
test('public like failure waits for the next feed revision and never spins',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},posting:{}});f.balance.resolve({available:false});await new Promise(setImmediate);let reads=0;
 f.session.application.readLikes=async posts=>{reads++;if(reads===1)throw Error('Public index unavailable');return likeRows(posts,likeFeed('2'),true);};
 f.panel.loadLikes(['9'],likeFeed());await new Promise(setImmediate);f.panel.loadLikes(['9'],likeFeed());await new Promise(setImmediate);assert.equal(reads,1);assert.equal(f.panel.likeState('9'),null);
 f.panel.loadLikes(['9'],likeFeed('2'));await new Promise(setImmediate);assert.equal(reads,2);assert.equal(f.panel.likeState('9'),true);
});
test('public like cache invalidates on a same-height reorg and discards the old read',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},posting:{}});f.balance.resolve({available:false});await new Promise(setImmediate);const old=Promise.withResolvers();let reads=0;
 f.session.application.readLikes=async posts=>++reads===1?old.promise:likeRows(posts,likeFeed('1','9'),false);
 f.panel.loadLikes(['9'],likeFeed());await new Promise(setImmediate);f.panel.loadLikes(['9'],likeFeed('1','9'));old.resolve(likeRows(['9'],likeFeed(),true));await new Promise(setImmediate);
 assert.equal(reads,2);assert.equal(f.panel.likeState('9'),false);
});
test('a later action cannot strand an included like when its independent observation reverts',{timeout:3000},async t=>{
 const txHash='0x'+'7'.repeat(64),blockHash='0x'+'8'.repeat(64),posting={status:'included',txHash,inclusion:{blockNumber:3,blockHash}},f=await fixture(t,{defaults:{},posting});
 f.balance.resolve({available:false});await new Promise(setImmediate);const observation=Promise.withResolvers();let reads=0;f.session.observeIncluded=async()=>{reads++;return observation.promise;};
 await f.panel.act({type:'like',post:'9'});assert.equal(f.panel.likeState('9'),true);assert.equal(reads,1);
 posting.status='confirmed';await f.panel.act({type:'like',post:'10'});assert.equal(f.panel.likeState('10'),true);
 observation.resolve({status:'reverted',txHash});await new Promise(setImmediate);assert.equal(f.panel.likeState('9'),false);assert.equal(f.panel.likeState('10'),true);assert.equal(f.submissions.length,2);
});

for(const completion of ['confirmed','receipt-promoted'])test(`older public hydration cannot overwrite ${completion} Like`,{timeout:3000},async t=>{
 const txHash='0x'+'7'.repeat(64),blockHash='0x'+'8'.repeat(64),posting={status:completion==='confirmed'?'confirmed':'included',txHash,inclusion:{blockNumber:3,blockHash}},f=await fixture(t,{defaults:{},posting});
 f.balance.resolve({available:false});await new Promise(setImmediate);
 const hydration=Promise.withResolvers(),observation=Promise.withResolvers();let reads=0;
 f.session.application.readLikes=()=>{reads++;return hydration.promise;};f.session.observeIncluded=()=>observation.promise;
 f.panel.loadLikes(['9'],likeFeed());await new Promise(setImmediate);assert.equal(reads,1);
 await f.panel.act({type:'like',post:'9'});assert.equal(f.panel.likeState('9'),true);
 if(completion==='receipt-promoted'){observation.resolve({status:'confirmed',txHash});await new Promise(setImmediate);}
 hydration.resolve(likeRows(['9'],likeFeed(),false));await new Promise(setImmediate);
 assert.equal(f.panel.likeState('9'),true);assert.deepEqual(await f.panel.act({type:'like',post:'9'}),{status:'confirmed',alreadyLiked:true});assert.equal(f.submissions.length,1);
});


test('successful posting-credit claim survives unavailable display read and refreshes once without another payment',{timeout:3000},async t=>{
 let payments=0,claims=0,reads=0;const refreshed=Promise.withResolvers(),entered=Promise.withResolvers();
 const cap={ethAvailable:true,defaultPrivateFeeCap:'100',async prepare(input){return {...input,phase:'deposit',maximumSwapWei:'1000'};},async confirm(){payments++;return {};},async inspect(){return null;},async advanceClaim(){claims++;return {state:'complete',intent:{intentId:'claim',action:{type:'claim-private-fee'}}};}};
 const f=await fixture(t,{balanceRead:async()=>({available:true,availableCredit:'0'}),posting:{balanceRefresh:async()=>assert.fail('unrelated account refresh')}});
 f.session.topup['private-fee']=cap;f.session.application.readPrivateFeeCredit=async()=>{reads++;if(reads===1)throw new AggregateError([new AggregateError([Error('transport')]),Object.assign(Error('unavailable'),{code:'BB_TRUSTED_NODE_UNAVAILABLE'})]);entered.resolve();return refreshed.promise;};
 f.panel.close();f.panel.open({});f.document.querySelectorAll('button').find(b=>b.textContent==='Add posting credit').fire('click');
 const pay=await f.document.until(()=>f.document.querySelectorAll('button').find(b=>b.textContent==='Pay'&&!b.disabled));pay.fire('click');
 await f.document.until(()=>f.document.querySelector('dialog').getAttribute('aria-busy')==='false');
 assert.match(f.document.body.textContent,/Posting credit added/);assert(!f.document.body.textContent.includes('Account setup could not finish'));
 const identity=f.document.createElement('section');f.document.body.append(identity);f.panel.attachIdentityControls(identity);
 assert.match(identity.textContent,/Updating/);assert.equal(identity.querySelector('[data-posting-credit]').title,undefined);
 await entered.promise;assert.equal(payments,1);assert.equal(claims,1);assert.equal(reads,2);
 refreshed.resolve({availableCredit:'539000000000000000000'});
 await f.document.until(()=>identity.querySelector('[data-posting-credit]')?.textContent==='539');
 assert.equal(payments,1);assert.equal(claims,1);assert.equal(reads,2);assert.equal(f.core().status,1);
});


test('signed-out connection offers official installation links when no wallet is detected',{timeout:3000},async t=>{
 const f=signInFixture(t);f.runtime.fundingWallets=()=>[];await f.panel.initialize();f.panel.open({});
 const install=await f.document.until(()=>f.document.querySelector('.wallet-install'));
 assert.match(install.textContent,/Get a wallet to connect/);
 const links=install.querySelectorAll('a');assert.deepEqual(links.map(a=>a.getAttribute('href')),['https://metamask.io/download/','https://phantom.com/download']);
 assert(links.every(a=>a.getAttribute('rel')==='noopener noreferrer'));assert.equal(f.calls.signIn,0);
});

test('account overview exposes names and balances without opening settings or a composer',{timeout:3000},async t=>{
 const f=await fixture(t,{defaults:{},balanceRead:async()=>({available:true,availableCredit:'1000000'})});
 f.session.application.readBalances=async()=>assert.fail('Opening account does not fetch balances');f.panel.close();f.panel.open({});
 const menu=f.document.querySelector('.wallet-account-menu');assert(menu);
 assert.deepEqual(menu.querySelectorAll('button').map(b=>b.textContent),['Your names','Follows and bookmarks','Balance and withdrawals']);
 assert.equal(f.document.querySelector('textarea'),null);
 assert(!f.document.querySelectorAll('button').find(b=>b.textContent==='Write a post').className.includes('primary'));
 assert.match(f.document.querySelector('.wallet-credit-context').textContent,/mentioning @bok/);
 assert(f.document.querySelectorAll('button').some(b=>b.textContent==='Sign out'));
});

for(const asset of ['ETH','USDC'])test('signup shows total before a collapsed cost breakdown for '+asset,{timeout:3000},async t=>{
 const f=await fixture(t,{fee:'collateral-pending',depositIds:[]});let payments=0;
 f.session.funding={usdcAvailable:true,async prepareStarter({asset}){return asset==='USDC'?{kind:'rolling-aggregate-usdc-v1',privateFeeCap:'100',slippageBps:100,breakdown:{collateral:{amount:'100',maxUsdc:'1000000'},fee:{maxUsdc:'2000000',amount:'200'},bokAmount:'0',relayFeeUsdc:'100000',maximumUsdc:'3100000'}}:{kind:'rolling-aggregate-eth-v1',usdEstimate:'3.10',privateFeeCap:'100',slippageBps:100,breakdown:{collateralWei:'100',fee:{maxEth:'20',amount:'200'},bok:{maxEth:'0',amount:'0'},gasBudgetWei:'10',maximumTotalWei:'130'}};},async confirm(){payments++;}};
 f.document.querySelectorAll('button').find(b=>b.textContent==='Set up posting').fire('click');
 await f.document.until(()=>f.document.querySelector('.wallet-payment-total'));
 if(asset==='USDC'){const select=f.document.querySelector('select[aria-label="Pay with"]');select.value='USDC';select.fire('change');await f.document.until(()=>f.document.querySelector('.wallet-payment-total')?.textContent.includes('3.1 USDC'));}
 const total=f.document.querySelector('.wallet-payment-total'),details=f.document.querySelector('.wallet-cost-breakdown');
 assert.match(total.textContent,/≈ \$3.10 USD/);assert.match(total.textContent,/Includes your deposit, posting credit and payment fees/);
 assert.equal(!!details.open,false);assert.equal(details.querySelector('summary').textContent,'Cost breakdown');assert.match(details.textContent,/Posting credit/);
 assert(total.parentNode.childNodes.indexOf(total)<details.parentNode.childNodes.indexOf(details));assert.equal(payments,0);
});
