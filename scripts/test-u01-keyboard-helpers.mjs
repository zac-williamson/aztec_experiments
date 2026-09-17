import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shared/helpers.js',import.meta.url),'utf8');
function fixture(){
 const elements=new Map(),pages=[],queue=[];let active;
 class Element{
  constructor(id){this.id=id;this.attributes=new Map();this.events={};this.style={};this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};elements.set(id,this);}
  setAttribute(k,v){this.attributes.set(k,v);}getAttribute(k){return this.attributes.get(k)??null;}removeAttribute(k){this.attributes.delete(k);}
  focus(){active=this;}remove(){elements.delete(this.id);}insertAdjacentElement(where,el){assert.equal(where,'afterend');elements.set(el.id,el);}addEventListener(name,fn){this.events[name]=fn;}
 }
 const doc={getElementById:id=>elements.get(id),createElement:()=>new Element('temporary'),querySelectorAll:selector=>selector==='.page'?pages:[...elements.values()].filter(el=>el.classes.has('missing')),querySelector:()=>pages.find(p=>p.classes.has('active'))?.heading};
 for(let i=0;i<3;i++){const page=new Element('page-'+i);page.heading=new Element('heading-'+i);pages.push(page);}
 for(const name of ['navBack','navNext','navProgress','msgText','depositAmount'])new Element(name);
 const context=vm.createContext({document:doc,queueMicrotask:fn=>queue.push(fn),console,setTimeout});vm.runInContext(source,context);
 return {context,elements,queue,get active(){return active;}};
}
test('transition focuses final page after automatic completed-step skip',()=>{
 const f=fixture();vm.runInContext("initPages([{label:'Setup'},{label:'Deposit',onShow:()=>nextPage()},{label:'Post'}]);showPage(1)",f.context);for(const run of f.queue)run();assert.equal(f.active.id,'heading-2');assert.equal(f.active.getAttribute('tabindex'),'-1');assert.equal(f.elements.get('navProgress').textContent,'3 / 3');
});
test('message validation focuses textarea, associates fixed error, preserves help and clears on edit',()=>{
 const f=fixture(),el=f.elements.get('msgText');el.setAttribute('aria-describedby','message-help');f.context.highlightMissing(['msgText']);assert.equal(f.active,el);assert.equal(el.getAttribute('aria-invalid'),'true');assert.equal(el.getAttribute('aria-describedby'),'message-help msgText-validation-error');assert.equal(f.elements.get('msgText-validation-error').textContent,'Enter a message before posting.');el.events.input();assert.equal(el.getAttribute('aria-invalid'),null);assert.equal(el.getAttribute('aria-describedby'),'message-help');assert(!f.elements.has('msgText-validation-error'));assert(!el.classes.has('missing'));
});
test('revalidation removes earlier input and textarea errors and focuses first invalid field',()=>{
 const f=fixture();f.context.highlightMissing(['msgText','depositAmount']);f.context.highlightMissing(['depositAmount']);assert(!f.elements.get('msgText').classes.has('missing'));assert(!f.elements.has('msgText-validation-error'));assert.equal(f.active.id,'depositAmount');assert.equal(f.elements.get('depositAmount').getAttribute('aria-describedby'),'depositAmount-validation-error');
});
