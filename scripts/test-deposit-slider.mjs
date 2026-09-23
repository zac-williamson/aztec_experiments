import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {formatEther} from 'ethers';
const source=fs.readFileSync('apps/src/billboard/user/app.js','utf8').split('let _depositTerms = null;')[1].split('function onShowDeposit()')[0];
function fixture(terms){
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'0',setAttribute(k,v){this[k]=v;}});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:element},ethers:{formatEther},application:{readDepositTerms:async()=>terms},_currentPage:1,_pageActionsEnabled:true,log(){},publicOperationFailure:()=>({message:'Request failed'})});
 vm.runInContext('let _depositTerms=null;'+source,context);return {context,element};
}
test('slider exact endpoints, midpoint, rounded cooldown and large wei amounts',async()=>{
 for(const min of [1000000000000n,1000000000000000001n]){
 const f=fixture({minWei:min,maxWei:min*10n,baseCooldown:60n});await f.context.loadDepositTerms();
 for(const [position,multiplier,seconds] of [[0,1n,60],[1000,10n,6]]){f.element('depositAmount').value=String(position);f.context.renderDepositSelection();assert.equal(f.context.selectedDepositWei(),min*multiplier);assert.match(f.element('depositCooldown').textContent,new RegExp(' '+seconds+' seconds'));}
 f.element('depositAmount').value='500';f.context.renderDepositSelection();assert.match(f.element('depositCooldown').textContent,/11 seconds/);
 }
});
test('unloaded and invalid selections cannot produce a deposit amount; failed terms stay disabled',async()=>{
 const f=fixture(null);assert.throws(()=>f.context.selectedDepositWei());f.context.application.readDepositTerms=async()=>{throw Error();};await f.context.loadDepositTerms();assert.equal(f.element('navNext').disabled,true);assert.throws(()=>f.context.selectedDepositWei());
});
test('fixed board deposit stays selectable and wallet invalidation remains gated',async()=>{
 const f=fixture({minWei:1n,maxWei:1n,baseCooldown:1n});f.context._pageActionsEnabled=false;await f.context.loadDepositTerms();assert.equal(f.element('depositAmount').disabled,true);assert.equal(f.element('navNext').disabled,true);assert.equal(f.context.selectedDepositWei(),1n);
});
test('older term responses cannot overwrite a later page request',async()=>{
 const f=fixture(null);const resolvers=[];f.context.application.readDepositTerms=()=>new Promise(r=>resolvers.push(r));const old=f.context.loadDepositTerms(),latest=f.context.loadDepositTerms();resolvers[1]({minWei:2n,maxWei:3n,baseCooldown:60n});await latest;resolvers[0]({minWei:1n,maxWei:1n,baseCooldown:60n});await old;assert.equal(f.context.selectedDepositWei(),2n);
});
