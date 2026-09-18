import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {validateJourneySignal,writeJourneySignal,waitJourneyRelease,transactionHashes} from './t04-browser-journey.mjs';
const hash='0x'+'ab'.repeat(32),signal={stage:'exit',transactionHashes:[hash]};
test('rendezvous accepts only fixed stages and bounded unique public transaction identifiers',()=>{
 assert.deepEqual(validateJourneySignal(signal),signal);
 for(const value of [{...signal,stage:'../../outside'},{...signal,secret:'SECRET'},{...signal,transactionHashes:[]},{...signal,transactionHashes:[hash,hash]},{...signal,transactionHashes:['SECRET']}])assert.throws(()=>validateJourneySignal(value));
 assert.deepEqual(transactionHashes(`Transaction hash: ${hash}\nTransaction hash: ${hash}`),[hash]);
});
test('atomic rendezvous cannot overwrite a prior stage or accept an unverified release',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await writeJourneySignal(dir,signal);await assert.rejects(writeJourneySignal(dir,signal),{code:'EEXIST'});
 await fs.writeFile(path.join(dir,'browser-journey-exit-verified.json'),JSON.stringify({stage:'exit',verified:false}));
 await assert.rejects(waitJourneyRelease(dir,'exit',()=>100));
 await fs.writeFile(path.join(dir,'browser-journey-exit-verified.json'),JSON.stringify({stage:'exit',verified:true}));
 await waitJourneyRelease(dir,'exit',()=>100);
});
test('missing release respects remaining parent budget',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await assert.rejects(waitJourneyRelease(dir,'exit',()=>0),/T04_RENDEZVOUS_DEADLINE/);
});
test('canonical exit rejects wrong leaf, duplicate leaf, wrong nullifier and ineligible anchor',async()=>{
 const {assertJourneyExit}=await import('./t04-browser-journey-verify.mjs');
 const value=n=>({equals(other){return other.id===n;},id:n}),leaf=value(1),nullifier=value(2);
 const good={effect:{l2ToL1Msgs:[leaf],nullifiers:[nullifier]},leaf,consumedNullifier:nullifier,anchorTimestamp:10n,nextAllowedTime:10n};
 assertJourneyExit(good);
 for(const mutation of [{anchorTimestamp:9n},{effect:{l2ToL1Msgs:[value(3)],nullifiers:[nullifier]}},{effect:{l2ToL1Msgs:[leaf,leaf],nullifiers:[nullifier]}},{effect:{l2ToL1Msgs:[leaf],nullifiers:[value(3)]}}])assert.throws(()=>assertJourneyExit({...good,...mutation}));
});
test('aborted lifecycle terminates a rendezvous even with a clamped legacy time callback',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'t04-signal-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const abort=new AbortController(),waiting=waitJourneyRelease(dir,'exit',()=>1,abort.signal);abort.abort();await assert.rejects(waiting,/T04_RENDEZVOUS_ABORTED/);
});
test('actual shared producer builder roundtrips both strict parent handoff modes',async()=>{
 const {createBrowserHandoff,validateBrowserHandoff,validateBrowserControl}=await import('./t04-browser-journey.mjs');
 const directory='/private/tmp/t04-fixture',address='0x'+'12'.repeat(20),board='0x'+'01'.repeat(32);
 const publicConfig={schemaVersion:1,network:{nodeUrl:'https://127.0.0.1:1234/rpc/aztec',ethRpcUrl:'https://127.0.0.1:1234/rpc/ethereum',chainId:'31337',rollupVersion:'1',rollupAddress:address},board:{portalAddress:address,contractAddress:board}};
 const base={nodeUrl:'http://127.0.0.1:1235',ethereumUrl:'http://127.0.0.1:1236',publicConfig,backupPath:directory+'/browser-wallet.encrypted.json',ethereumAccount:address,message:'Fixture GUI message'};
 for(const browserJourney of [false,true]){
  const actual=createBrowserHandoff(base,{directory,browserJourney,depositAmount:'0.001'});
  assert.deepEqual(validateBrowserHandoff(JSON.parse(JSON.stringify(actual)),{directory,browserJourney}),actual);
  assert.throws(()=>validateBrowserHandoff(actual,{directory,browserJourney:!browserJourney}));
  for(const mutation of [{...actual,secret:'SECRET'},{...actual,backupPath:'/private/tmp/elsewhere/browser-wallet.encrypted.json'},{...actual,backupPath:directory+'/../escape'},{...actual,nodeUrl:'https://outside.example'}])assert.throws(()=>validateBrowserHandoff(mutation,{directory,browserJourney}));
 }
 for(const depositAmount of ['0.0','-1.0','1e-3','1.0000000000000000001'])assert.throws(()=>createBrowserHandoff(base,{directory,browserJourney:true,depositAmount}));
 const control={browserJourney:true,origin:'https://127.0.0.1:1234',rpcToken:'a'.repeat(32),backupPassword:'b'.repeat(32)};assert.equal(validateBrowserControl(control),control);
 assert.throws(()=>validateBrowserControl({...control,arbitrary:'SECRET'}));assert.throws(()=>validateBrowserControl({...control,browserJourney:'true'}));
});
test('journey diagnostic outputs fixed milestones and allowlisted exception only',async()=>{
 const {readJourneyUiDiagnostic,safeJourneyDriverFailure}=await import('./t04-browser-journey.mjs');
 const previous=globalThis.document;
 try{globalThis.document={getElementById:id=>({textContent:id==='depositStatus'?'Making new L1 deposit Claim secret saved locally SECRET_PRIVATE_KEY':id==='withdrawStatus'?'SECRET_WITNESS':'ETH claimed successfully! SECRET_RPC_URL'}),querySelector:selector=>selector==='#depositStatus .error'?{}:null};
  const result=readJourneyUiDiagnostic();assert.equal(result.depositHasError,true);assert.equal(result.milestones.claimSecretSaved,true);assert.equal(result.milestones.depositConfirmed,false);assert.equal(result.milestones.refundComplete,true);assert.ok(!JSON.stringify(result).includes('SECRET'));
 }finally{globalThis.document=previous;}
 assert.deepEqual(safeJourneyDriverFailure({name:'AssertionError',message:'SECRET',code:'SECRET'},'await-deposit-claim'),{exceptionClass:'AssertionError',substage:'await-deposit-claim'});
 assert.deepEqual(safeJourneyDriverFailure({name:'SECRET'},'SECRET'),{exceptionClass:'OtherError',substage:'other'});
});

const {retryT04PendingClaim,T04_PENDING_CLAIM_MESSAGE}=await import('./t04-browser-journey.mjs');
const pendingClaim=()=>({success:false,errors:[T04_PENDING_CLAIM_MESSAGE],depositHash:hash,existingVisible:true,newVisible:false,pageVisible:true,transactionHashes:[]});
test('pending claim retries once through supplied GUI action then succeeds',async()=>{
 let reads=0,retries=0;const result=await retryT04PendingClaim({remaining:()=>1000,outcome:async()=>++reads===1?pendingClaim():{...pendingClaim(),success:true,errors:[]},retry:async receipt=>{assert.equal(receipt,hash);retries++;}});
 assert.deepEqual(result,{claimAttempts:2,claimRetries:1});assert.equal(retries,1);
});
test('unexpected claim errors never retry',async()=>{
 for(const errors of [['unavailable'],[T04_PENDING_CLAIM_MESSAGE,'invalid receipt']]){
 let retries=0;await assert.rejects(retryT04PendingClaim({remaining:()=>1000,outcome:async()=>({...pendingClaim(),errors}),retry:async()=>retries++}),/UNEXPECTED_ERROR/);assert.equal(retries,0);
 }
});
test('repeated pending claims stop after three total attempts',async()=>{
 let reads=0,retries=0;await assert.rejects(retryT04PendingClaim({remaining:()=>1000,outcome:async()=>{reads++;return pendingClaim();},retry:async()=>retries++}),/ATTEMPTS_EXHAUSTED/);assert.equal(reads,3);assert.equal(retries,2);
});
test('receipt changes, lost pending controls and existing submission prohibit further retry',async()=>{
 for(const change of [{depositHash:'0x'+'cd'.repeat(32)},{newVisible:true},{existingVisible:false},{pageVisible:false},{transactionHashes:[hash]}]){
 let reads=0,retries=0;await assert.rejects(retryT04PendingClaim({remaining:()=>1000,outcome:async()=>++reads===1?pendingClaim():{...pendingClaim(),...change},retry:async()=>retries++}));assert.equal(retries,1);
 }
});

test('actual shared log timestamp is removed once before strict pending classification',async()=>{
 const vm=await import('node:vm');const {normalizeT04StatusMessage}=await import('./t04-browser-journey.mjs');
 const children=[],container={appendChild:element=>children.push(element)};
 const context=vm.createContext({document:{getElementById:()=>container,createElement:()=>({})}});
 vm.runInContext(await fs.readFile(new URL('../shared/helpers.js',import.meta.url),'utf8'),context);
 context.message=T04_PENDING_CLAIM_MESSAGE;vm.runInContext("log(message,'error','depositStatus')",context);
 const rendered=children[0].textContent;assert.notEqual(rendered,T04_PENDING_CLAIM_MESSAGE);
 assert.equal(normalizeT04StatusMessage(rendered),T04_PENDING_CLAIM_MESSAGE);
 let attempts=0,retries=0;
 await retryT04PendingClaim({remaining:()=>1000,outcome:async()=>++attempts===1?{...pendingClaim(),errors:[normalizeT04StatusMessage(rendered)]}:{...pendingClaim(),success:true,errors:[]},retry:async()=>retries++});assert.equal(retries,1);
 for(const unsafe of ['[12:34:56] '+rendered,'[12:34:56] unexpected '+T04_PENDING_CLAIM_MESSAGE,'['+'1'.repeat(41)+'] '+T04_PENDING_CLAIM_MESSAGE]){
 let clicked=0;await assert.rejects(retryT04PendingClaim({remaining:()=>1000,outcome:async()=>({...pendingClaim(),errors:[normalizeT04StatusMessage(unsafe)]}),retry:async()=>clicked++}),/UNEXPECTED_ERROR/);assert.equal(clicked,0);
 }
 context.message='RPC unavailable';vm.runInContext("log(message,'error','depositStatus')",context);
 assert.equal(normalizeT04StatusMessage(children[1].textContent),'RPC unavailable');
});
