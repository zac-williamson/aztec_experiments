import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {awaitCoordinatorAndBrowser} from './c01-browser-supervision.mjs';
import {OwnedBuildTree} from './owned-test-process-tree.mjs';
function child(source,args=[]){
 const processChild=spawn(process.execPath,['-e',source,...args],{detached:true,stdio:['ignore','pipe','ignore']});
 const ended=new Promise(resolve=>{processChild.once('error',error=>resolve({errorClass:error.name}));processChild.once('close',(code,signal)=>resolve({code,signal}));});
 return {processChild,ended,tree:new OwnedBuildTree(processChild.pid)};
}
test('real failed coordinator promptly stops waiting browser and preserves native report',{timeout:10000},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'c01-supervision-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const browser=child("console.log('ready');setInterval(()=>{},1000)");t.after(()=>browser.tree.cleanup());await once(browser.processChild.stdout,'data');await browser.tree.sample();
 const reportPath=path.join(directory,'worker-result.json');
 const coordinator=child("require('node:fs').writeFileSync(process.argv[1],JSON.stringify({passed:false,failure:'TypeError'}));process.exitCode=1",[reportPath]);t.after(()=>coordinator.tree.cleanup());
 let stopped,cleanup;const started=Date.now();
 const exit=await awaitCoordinatorAndBrowser({coordinator:coordinator.ended,getBrowser:()=>browser.ended,stop:reason=>{stopped=reason;cleanup=browser.tree.cleanup();}});
 await cleanup;assert.equal(exit.code,1);assert.equal(stopped,'native-coordinator-failed');assert(Date.now()-started<5000);
 assert.equal((await browser.ended).signal,'SIGKILL');assert.equal((await browser.tree.sample()).members.length,0);
 assert.deepEqual(JSON.parse(await fs.readFile(reportPath,'utf8')),{passed:false,failure:'TypeError'});
});
test('successful coordinator allows real browser to finish afterward without cancellation',{timeout:10000},async t=>{
 const browser=child("console.log('ready');setTimeout(()=>{console.log('completed')},300)");t.after(()=>browser.tree.cleanup());await once(browser.processChild.stdout,'data');
 const coordinator=child('process.exitCode=0');t.after(()=>coordinator.tree.cleanup());let stopped=false,browserCompleted=false;
 const browserDone=browser.ended.then(exit=>{browserCompleted=true;assert.equal(exit.code,0);return exit;});
 const nativeExit=await coordinator.ended;assert.equal(browserCompleted,false);
 const exit=await awaitCoordinatorAndBrowser({coordinator:Promise.resolve(nativeExit),getBrowser:()=>browserDone,stop:()=>{stopped=true;}});
 assert.equal(exit.code,0);assert.equal(browserCompleted,true);assert.equal(stopped,false);
});
test('timeout, signal and spawn error stop before browser wait; missing browser is supported',async()=>{
 for(const exit of [{supervisionTimeout:true},{code:null,signal:'SIGTERM'},{errorClass:'Error'}]){
 const events=[];assert.deepEqual(await awaitCoordinatorAndBrowser({coordinator:Promise.resolve(exit),stop:()=>events.push('stop'),getBrowser:()=>{events.push('browser');}}),exit);assert.deepEqual(events,['stop','browser']);
 }
 let stopped=false;assert.deepEqual(await awaitCoordinatorAndBrowser({coordinator:Promise.reject(new TypeError()),getBrowser:()=>undefined,stop:()=>{stopped=true;}}),{errorClass:'TypeError'});assert(stopped);
});
