// TEST ONLY: two actual posts, one live browser wallet/prover, existing rendezvous.
import assert from 'node:assert/strict';
import os from 'node:os';
import {GasSettings} from '@aztec/stdlib/gas';
import {writeJourneySignal,waitJourneyRelease,transactionHashes} from './t04-browser-journey.mjs';
export function readProofIntervals(){
 const result={};
 for(const name of ['crs','pxe','proveTx','toTx']){
  const key='billboard.'+name,values=performance.getEntriesByName(key,'measure');
  if(values.length!==1||performance.getEntriesByName(key,'mark').length)throw Error('Incomplete proving timing');
  const value=values[0].duration;if(!Number.isFinite(value)||value<0)throw Error('Invalid proving timing');result[name]=value;
 }
 return result;
}
export function clearProofIntervals(){for(const name of ['proveTx','toTx']){performance.clearMeasures('billboard.'+name);performance.clearMarks('billboard.'+name);}}
export async function driveT04BrowserPerformance({page,directory,message,remaining,signal,mark}){
 const samples=[];
 for(const [index,stage] of ['post','warm-post'].entries()){
  if(index===1){
   await page.getByRole('button',{name:'Refresh chain status',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('postCountdown')?.textContent==='Posting time lock has expired at the latest chain block.',{},{timeout:remaining()});
  }
  mark(index===0?'performance-cold-post':'performance-warm-post');
  const text=index===0?message:message+' warm';await page.locator('#msgText').fill(text);
  await page.evaluate(clearProofIntervals);
  const started=Date.now();await page.locator('#postBtn').click();
  await page.waitForFunction(()=>document.getElementById('postStatus')?.textContent.includes('Message included. Public content and transaction timing remain observable.')||!!document.querySelector('#postStatus .error'),{},{timeout:remaining()});
  const status=await page.locator('#postStatus').textContent();assert(status.includes('Message included. Public content and transaction timing remain observable.'));
  const hashes=transactionHashes(status);assert.equal(hashes.length,1);
  const timing=await page.evaluate(readProofIntervals);
  samples.push({state:index===0?'cold':'warm',transactionHash:hashes[0],proveTxMs:timing.proveTx,toTxMs:timing.toTx,proofMs:timing.proveTx+timing.toTx,
   ...(index===0?{crsMs:timing.crs,pxeMs:timing.pxe,coldMeasuredInitializationAndProofMs:timing.crs+timing.pxe+timing.proveTx+timing.toTx}:{}),guiElapsedMs:Date.now()-started});
  await writeJourneySignal(directory,{stage,transactionHashes:hashes});await waitJourneyRelease(directory,stage,remaining,signal);
 }
 assert.notEqual(samples[0].transactionHash,samples[1].transactionHash);
 return {passed:true,samples,hardware:{platform:os.platform(),architecture:os.arch(),totalMemoryBytes:os.totalmem(),cpuModel:os.cpus()[0].model},performanceQualified:false,scope:'Fresh browser process/profile; cold first proof and warm second proof. OS asset cache not flushed. Proving excludes inclusion and cooldown; SDK delivery recorded separately.'};
}

// Fixed successful136-01 fixture, only for comparable performance measurements.
export function performanceGasSettings(){return GasSettings.from({
 gasLimits:{daGas:271200,l2Gas:6540000},teardownGasLimits:{daGas:135600,l2Gas:817500},
 maxFeesPerGas:{feePerDaGas:1n,feePerL2Gas:669090960n},maxPriorityFeesPerGas:{feePerDaGas:0n,feePerL2Gas:0n},
});}
// Existing application timings, observed without replacing any proving method.
export function observeProofPhases(){
 if(location.protocol==='chrome-extension:')return;
 const names=new Set(['billboard.crs','billboard.pxe','billboard.proveTx','billboard.toTx']);
 const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(names.has(entry.name))void globalThis.recordProofPhase('proof-'+entry.name.slice(10)+(entry.entryType==='mark'?'-start':'-complete'));});
 observer.observe({entryTypes:['mark','measure']});
 // The page/context owner disposes this observer when it closes the page.
}
