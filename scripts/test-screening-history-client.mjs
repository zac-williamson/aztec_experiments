// Application history adapter; utility failures are doubles, contract authentication is separately tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({console,Buffer,TextEncoder,TextDecoder,Uint8Array,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(new URL('../apps/src/billboard/user/engine.js',import.meta.url),'utf8'),context);
const read=context.BillboardScreeningHistory.readScreeningHints;
const owner={},chain={};
function contract(result,error){return {methods:{get_screen_hints:(o,c)=>{assert.equal(o,owner);assert.equal(c,chain);return {simulate:async options=>{assert.equal(options.from,owner);if(error)throw error;return result;}};}}};}
test('valid no-screening and linked hints survive SDK result wrappers',async()=>{
  for(const value of [[undefined,undefined],[{note:'child'},undefined],[{note:'child'},{note:'grandchild'}]]){
    for(const result of [value,{result:value},{value},{result:{value}}])assert.equal(await read(contract(result),owner,chain),value);
  }
});
test('malformed result never silently becomes empty hints',async()=>{
  for(const value of [null,{},[],[{}],[undefined,{}],[{},{},{}],[false,false],[0,0],['x',undefined],[[],undefined]])await assert.rejects(read(contract({result:value}),owner,chain),e=>e.code==='BB_SCREENING_HISTORY_UNAVAILABLE');
});
test('missing, conflicting, stale and transport errors are explicit and redact raw data',async()=>{
  for(const marker of ['BB_HISTORY_CHILD_MISSING','BB_HISTORY_CHILD_AMBIGUOUS','BB_HISTORY_STALE','BB_HISTORY_DEPOSIT_MISSING','NETWORK_FAILURE']){
    await assert.rejects(read(contract(null,new Error(marker+' private-note-data')),owner,chain),e=>e.code==='BB_SCREENING_HISTORY_UNAVAILABLE'&&!e.message.includes('private-note-data')&&/Sync/.test(e.message));
  }
});
