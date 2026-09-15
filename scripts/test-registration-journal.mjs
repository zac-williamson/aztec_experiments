// Real SQLite and pinned Tx codecs; SDK mock proofs are NOT cryptographically valid.
import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {BarretenbergSync} from '@aztec/bb.js';
import {Fr} from '@aztec/foundation/curves/bn254';
import {AztecAddress} from '@aztec/stdlib/aztec-address';
import {Tx,HashedValues} from '@aztec/stdlib/tx';
import {ChonkProof} from '@aztec/stdlib/proofs';
import {mockTx} from '@aztec/stdlib/testing';
import {loadContractArtifact,getAllFunctionAbis,encodeArguments,FunctionSelector} from '@aztec/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec/stdlib/contract';
import {openRegistrationJournal} from '../sponsor-service/registration-journal.mjs';

const artifactPath=new URL('../apps/src/billboard/sponsor_artifact.json',import.meta.url);
const sponsorArtifact=JSON.parse(fs.readFileSync(artifactPath));
const f=n=>new Fr(n).toString();
const planned={batchId:'1',root:f(51),window:'20',ticketCount:'4'};
const payer=AztecAddress.fromFieldUnsafe(new Fr(61));
const code=expected=>error=>error.code===expected&&error.message===expected;

if(['--claim-child','--crash-child'].includes(process.argv[2])){
  let journal;
  try{
    const config=JSON.parse(fs.readFileSync(process.argv[3]));
    journal=await openRegistrationJournal({...config,sponsorArtifact});
    if(process.argv[2]==='--crash-child'){
      await journal.claim({batchId:'1',expectedRevision:1});
      await journal.savePrepared({batchId:'1',expectedRevision:2,txBytes:fs.readFileSync(process.argv[4])});
      await journal.beginSubmission({batchId:'1',expectedRevision:3});
      process.kill(process.pid,'SIGKILL');
      await new Promise(()=>{});
    }
    process.send({ready:true});
    await new Promise(resolve=>process.once('message',resolve));
    try{await journal.claim({batchId:planned.batchId,expectedRevision:1});process.send({outcome:'claimed'});}
    catch(error){process.send({outcome:error.code==='REGISTRATION_JOURNAL_REVISION_CONFLICT'?'conflict':'unexpected'});}
  }finally{journal?.close();await BarretenbergSync.destroySingleton();process.disconnect();}
}else{
  let root,scope,abi,selector,bytes;
  const handles=new Set();let counter=0;
  before(async()=>{
    root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'registration-journal-test-'));fs.chmodSync(root,0o700);
    const artifact=loadContractArtifact(sponsorArtifact);
    scope={chainId:'31337',version:'1',rollupAddress:'0x0000000000000000000000000000000000000011',sponsorAddress:f(41),boardAddress:f(42),sponsorClassId:(await getContractClassFromArtifact(artifact)).id.toString()};
    abi=getAllFunctionAbis(artifact).find(fn=>fn.name==='register_batch');selector=await FunctionSelector.fromNameAndParameters(abi.name,abi.parameters);
    bytes=(await makeTx()).toBuffer();
  });
  after(async()=>{for(const h of handles)h.close();await BarretenbergSync.destroySingleton();fs.rmSync(root,{recursive:true,force:true});});
  async function makeTx(change=()=>{}){
    const tx=await mockTx(700,{numberOfNonRevertiblePublicCallRequests:0,numberOfRevertiblePublicCallRequests:1,publicCalldataSize:5,feePayer:payer,chainId:new Fr(31337),version:new Fr(1)});
    const calldata=await HashedValues.fromCalldata([selector.toField(),...encodeArguments(abi,[1n,new Fr(51),20n,4n])]);
    const call=tx.data.forPublic.revertibleAccumulatedData.publicCallRequests[0];
    call.contractAddress=AztecAddress.fromFieldUnsafe(Fr.fromString(scope.sponsorAddress));call.msgSender=payer;call.isStaticCall=false;call.calldataHash=calldata.hash;
    const fields={data:tx.data,chonkProof:tx.chonkProof,contractClassLogFields:[],publicFunctionCalldata:[calldata]};
    await change(fields,call);return Tx.create(fields);
  }
  async function open(config){const h=await openRegistrationJournal({...config,sponsorArtifact});handles.add(h);return h;}
  async function fixture(options={}){const config={dbPath:path.join(root,`case-${++counter}`,'journal.sqlite'),scope,...options};return {config,j:await open(config)};}
  async function prepared(j){await j.enqueue(planned);await j.claim({batchId:'1',expectedRevision:1});return j.savePrepared({batchId:'1',expectedRevision:2,txBytes:bytes});}
  const mined=(r,status='finalized',extra={})=>({status,txHash:r.txHash,executionResult:'success',blockNumber:'17',blockHash:f(62),canonicalBlockHash:f(62),registeredBatch:{...planned},...extra});

  test('immutable bounded intent survives reopen, canonical key ordering and scope binding',async()=>{
    const {j,config}=await fixture({maxJobs:2});await j.enqueue(planned);
    assert.equal((await j.enqueue({ticketCount:'4',window:'20',root:f(51),batchId:'1'})).revision,1);
    await assert.rejects(()=>j.enqueue({...planned,root:f(52)}),code('REGISTRATION_JOURNAL_INTENT_CONFLICT'));
    await j.enqueue({...planned,batchId:'2'});await assert.rejects(()=>j.enqueue({...planned,batchId:'3'}),code('REGISTRATION_JOURNAL_LIMIT'));
    assert.deepEqual((await j.list({limit:1,cursor:'1'})).map(v=>v.intent.batchId),['2']);j.close();
    const reopened=await open(config);assert.deepEqual((await reopened.get('1')).intent,planned);reopened.close();
    await assert.rejects(()=>open({...config,scope:{...scope,boardAddress:f(99)}}),code('REGISTRATION_JOURNAL_SCOPE_MISMATCH'));
    await assert.rejects(()=>open({...config,scope:{...scope,sponsorClassId:f(99)}}),code('REGISTRATION_JOURNAL_ARTIFACT_MISMATCH'));
  });
  test('prepared bytes persist exactly before submission and cannot be replaced',async()=>{
    const {j,config}=await fixture();const p=await prepared(j);assert.equal(p.state,'prepared');assert.equal(p.txBytesLength,bytes.length);assert(!('txBytes' in p));
    const copied=await j.loadPrepared('1');assert(copied.txBytes.equals(bytes));copied.txBytes.fill(0);assert((await j.loadPrepared('1')).txBytes.equals(bytes));
    await assert.rejects(()=>j.savePrepared({batchId:'1',expectedRevision:3,txBytes:bytes}),code('REGISTRATION_JOURNAL_TRANSITION'));
    j.close();const reopened=await open(config);assert((await reopened.loadPrepared('1')).txBytes.equals(bytes));
    const r=await reopened.beginSubmission({batchId:'1',expectedRevision:3});assert.equal(r.state,'submission-uncertain');
    await assert.rejects(()=>reopened.beginSubmission({batchId:'1',expectedRevision:4}),code('REGISTRATION_JOURNAL_TRANSITION'));
  });
  test('one durable claim and uncertainty survive restart; stale revision cannot submit',async()=>{
    const {j,config}=await fixture();await prepared(j);await j.enqueue({...planned,batchId:'2'});
    await assert.rejects(()=>j.claim({batchId:'2',expectedRevision:1}),code('REGISTRATION_JOURNAL_BUSY'));
    await assert.rejects(()=>j.beginSubmission({batchId:'1',expectedRevision:2}),code('REGISTRATION_JOURNAL_REVISION_CONFLICT'));
    await j.beginSubmission({batchId:'1',expectedRevision:3});j.close();const reopened=await open(config);
    assert.equal((await reopened.get('1')).state,'submission-uncertain');
    await assert.rejects(()=>reopened.claim({batchId:'2',expectedRevision:1}),code('REGISTRATION_JOURNAL_BUSY'));
  });
  test('caller observations require exact hash, canonical block and tuple; pending is not confirmed',async()=>{
    const {j}=await fixture();await prepared(j);let r=await j.beginSubmission({batchId:'1',expectedRevision:3});
    for(const bad of [mined(r,'finalized',{txHash:f(95)}),mined(r,'finalized',{canonicalBlockHash:f(96)}),mined(r,'finalized',{registeredBatch:{...planned,window:'21'}})]){
      await assert.rejects(()=>j.observe({batchId:'1',expectedRevision:r.revision,observation:bad}),code('REGISTRATION_JOURNAL_RECEIPT_MISMATCH'));
    }
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'pending',txHash:r.txHash}});assert.equal(r.state,'pending');assert(r.claimed);
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:mined(r,'checkpointed')});assert.equal(r.state,'included');assert(!r.claimed);
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:mined(r)});assert.equal(r.state,'confirmed');assert(!r.claimed);
    assert.equal((await j.observe({batchId:'1',expectedRevision:r.revision,observation:mined(r)})).revision,r.revision);
    // These are intentionally caller-supplied observations, NOT chain verification.
  });
  test('reverted receipt is never confirmed; dropped/unknown and rollback fence new work',async()=>{
    const {j,config}=await fixture();await prepared(j);let r=await j.beginSubmission({batchId:'1',expectedRevision:3});
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'unknown',txHash:r.txHash}});assert.equal(r.state,'blocked');
    await assert.rejects(()=>j.enqueue({...planned,batchId:'2'}),code('REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED'));
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:mined(r,'finalized',{executionResult:'reverted',registeredBatch:null})});assert.equal(r.state,'reverted');assert(!r.claimed);
    await j.enqueue({...planned,batchId:'2'});await j.claim({batchId:'2',expectedRevision:1});
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'rollback',txHash:r.txHash}});assert.equal(r.state,'blocked');
    await assert.rejects(()=>j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'pending',txHash:r.txHash}}),code('REGISTRATION_JOURNAL_BUSY'));
    assert.equal((await j.get('1')).state,'blocked');
    await assert.rejects(()=>j.savePrepared({batchId:'2',expectedRevision:2,txBytes:bytes}),code('REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED'));
    j.close();const reopened=await open(config);await assert.rejects(()=>reopened.enqueue({...planned,batchId:'3'}),code('REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED'));
  });
  test('wrong scope/target/operator/static flag or registration arguments fail actual codec checks',async()=>{
    const {j}=await fixture();await j.enqueue(planned);await j.claim({batchId:'1',expectedRevision:1});
    const mutations=[fields=>{fields.data.constants.txContext.version=new Fr(2);},(_,call)=>{call.contractAddress=AztecAddress.fromFieldUnsafe(new Fr(99));},(_,call)=>{call.msgSender=AztecAddress.fromFieldUnsafe(new Fr(99));},(_,call)=>{call.isStaticCall=true;},async(fields,call)=>{
      fields.publicFunctionCalldata=[await HashedValues.fromCalldata([selector.toField(),...encodeArguments(abi,[1n,new Fr(51),20n,5n])])];call.calldataHash=fields.publicFunctionCalldata[0].hash;
    }];
    for(const mutate of mutations){const invalid=(await makeTx(mutate)).toBuffer();await assert.rejects(()=>j.savePrepared({batchId:'1',expectedRevision:2,txBytes:invalid}),code('REGISTRATION_JOURNAL_INVALID_TX'));}
    assert.equal((await j.get('1')).state,'preparing');
  });
  test('cached hash cannot authorize substituted calldata even when lookup returns intended args',async()=>{
    const malicious=await makeTx(async(fields,call)=>{
      const different=await HashedValues.fromCalldata([selector.toField(),...encodeArguments(abi,[1n,new Fr(51),20n,5n])]);
      call.calldataHash=different.hash;
      fields.publicFunctionCalldata=[new HashedValues(fields.publicFunctionCalldata[0].values,different.hash)];
    });
    assert((await Tx.computeTxHash(malicious)).equals(malicious.getTxHash()));
    assert.equal(malicious.getPublicCallRequestsWithCalldata()[0].args.at(-1).toBigInt(),4n);
    const {j}=await fixture();await j.enqueue(planned);await j.claim({batchId:'1',expectedRevision:1});
    await assert.rejects(()=>j.savePrepared({batchId:'1',expectedRevision:2,txBytes:malicious.toBuffer()}),code('REGISTRATION_JOURNAL_INVALID_TX'));
  });
  test('empty proof, stale cached Tx hash, trailing bytes and size overflow cannot persist',async()=>{
    const {j}=await fixture();await j.enqueue(planned);await j.claim({batchId:'1',expectedRevision:1});
    const stale=Buffer.from(bytes);stale.fill(0,0,32);
    const empty=(await makeTx(fields=>{fields.chonkProof=ChonkProof.empty();})).toBuffer();
    for(const value of [stale,empty,Buffer.concat([bytes,Buffer.from([0])]),Buffer.alloc(1048577)])await assert.rejects(()=>j.savePrepared({batchId:'1',expectedRevision:2,txBytes:value}),code('REGISTRATION_JOURNAL_INVALID_TX'));
    assert.equal((await j.get('1')).txBytesLength,0);
  });
  test('reopen detects stored bytes/hash/observation tampering',async()=>{
    for(const mutation of [db=>db.prepare("UPDATE jobs SET tx_sha256='bad'").run(),db=>db.prepare("UPDATE jobs SET state='confirmed',observation='{}'").run(),db=>db.prepare('UPDATE jobs SET tx_bytes=?').run(Buffer.concat([bytes,Buffer.from([1])]))]){
      const {j,config}=await fixture();await prepared(j);j.close();const db=new DatabaseSync(config.dbPath);mutation(db);db.close();
      await assert.rejects(()=>open(config),error=>typeof error.code==='string'&&error.code.startsWith('REGISTRATION_JOURNAL_'));
    }
  });
  test('stored pending/included claim state is validated; rollback to pending reacquires it',async()=>{
    for(const status of ['pending','checkpointed']){
      const {j,config}=await fixture();await prepared(j);let r=await j.beginSubmission({batchId:'1',expectedRevision:3});
      r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:status==='pending'?{status,txHash:r.txHash}:mined(r,status)});assert.equal(r.claimed,status==='pending');j.close();
      const db=new DatabaseSync(config.dbPath);db.prepare('UPDATE jobs SET claimed=?').run(status==='pending'?0:1);db.close();
      await assert.rejects(()=>open(config),code('REGISTRATION_JOURNAL_INVALID'));
    }
    const {j,config}=await fixture();await prepared(j);let r=await j.beginSubmission({batchId:'1',expectedRevision:3});
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:mined(r)});
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'rollback',txHash:r.txHash}});assert(!r.claimed);
    r=await j.observe({batchId:'1',expectedRevision:r.revision,observation:{status:'pending',txHash:r.txHash}});assert(r.claimed);j.close();
    const reopened=await open(config);assert((await reopened.get('1')).claimed);await reopened.enqueue({...planned,batchId:'2'});
    await assert.rejects(()=>reopened.claim({batchId:'2',expectedRevision:1}),code('REGISTRATION_JOURNAL_BUSY'));
  });
  test('canonical inclusion permits the next batch without waiting for network finality',async()=>{
    const {j,config}=await fixture();await prepared(j);let first=await j.beginSubmission({batchId:'1',expectedRevision:3});
    first=await j.observe({batchId:'1',expectedRevision:first.revision,observation:mined(first,'checkpointed')});
    assert.equal(first.state,'included');assert(!first.claimed);
    await j.enqueue({...planned,batchId:'2'});assert((await j.claim({batchId:'2',expectedRevision:1})).claimed);
    j.close();const restored=await open(config);assert.equal((await restored.get('1')).state,'included');assert((await restored.get('2')).claimed);
    first=await restored.observe({batchId:'1',expectedRevision:first.revision,observation:{status:'rollback',txHash:first.txHash}});
    assert.equal(first.state,'blocked');
    await assert.rejects(()=>restored.savePrepared({batchId:'2',expectedRevision:2,txBytes:bytes}),code('REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED'));
    await assert.rejects(()=>restored.enqueue({...planned,batchId:'3'}),code('REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED'));
  });
  test('two real connections enforce CAS and one job claim',async()=>{
    const {j,config}=await fixture();await j.enqueue(planned);const other=await open(config);
    await j.claim({batchId:'1',expectedRevision:1});await assert.rejects(()=>other.claim({batchId:'1',expectedRevision:1}),code('REGISTRATION_JOURNAL_REVISION_CONFLICT'));
    const p=await j.savePrepared({batchId:'1',expectedRevision:2,txBytes:bytes});assert.equal((await other.get('1')).txHash,p.txHash);
  });
  test('two actual worker processes released together produce exactly one durable claimant',{timeout:20000},async()=>{
    const {j,config}=await fixture();await j.enqueue(planned);j.close();const configFile=path.join(path.dirname(config.dbPath),'child-config.json');fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});
    const workers=Array.from({length:2},()=>{
      const child=fork(fileURLToPath(import.meta.url),['--claim-child',configFile],{stdio:['ignore','ignore','pipe','ipc'],execArgv:[]});let stderrBytes=0;
      child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>8192)child.kill('SIGKILL');});
      let outcome;const ready=new Promise((resolve,reject)=>{child.on('message',message=>{if(message.ready)resolve();else outcome=message.outcome;});child.once('error',reject);child.once('exit',()=>reject(new Error('CHILD_EXIT_BEFORE_READY')));});
      const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exitCode,signal)=>exitCode===0&&!signal?resolve(outcome):reject(new Error('CHILD_FAILED')));});
      // Attach rejection observers before awaiting the independent readiness gates.
      ready.catch(()=>{});done.catch(()=>{});return {child,ready,done};
    });
    const timer=setTimeout(()=>workers.forEach(w=>w.child.kill('SIGKILL')),15000);
    try{await Promise.all(workers.map(w=>w.ready));workers.forEach(w=>w.child.send('go'));assert.deepEqual((await Promise.all(workers.map(w=>w.done))).sort(),['claimed','conflict']);}
    finally{clearTimeout(timer);for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill('SIGKILL');await Promise.allSettled(workers.map(w=>w.done));}
    const reopened=await open(config);assert.equal((await reopened.get('1')).revision,2);assert((await reopened.get('1')).claimed);
  });
  test('abrupt worker death after commit retains exact transaction and submission uncertainty',{timeout:20000},async()=>{
    const {j,config}=await fixture();await j.enqueue(planned);j.close();
    const configFile=path.join(path.dirname(config.dbPath),'crash-config.json'),txFile=path.join(path.dirname(config.dbPath),'private-tx.bin');
    fs.writeFileSync(configFile,JSON.stringify(config),{mode:0o600});fs.writeFileSync(txFile,bytes,{mode:0o600});
    const child=fork(fileURLToPath(import.meta.url),['--crash-child',configFile,txFile],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},15000);
    try{const outcome=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(exitCode,signal)=>resolve({exitCode,signal}));});assert(!timedOut);assert.deepEqual(outcome,{exitCode:null,signal:'SIGKILL'});}
    finally{clearTimeout(timer);fs.rmSync(txFile);}
    const reopened=await open(config);assert.equal((await reopened.get('1')).state,'submission-uncertain');assert((await reopened.loadPrepared('1')).txBytes.equals(bytes));
    await assert.rejects(()=>reopened.beginSubmission({batchId:'1',expectedRevision:4}),code('REGISTRATION_JOURNAL_TRANSITION'));
  });
  test('unsafe permissions and symlink database fail closed',async()=>{
    const {j,config}=await fixture();j.close();fs.chmodSync(config.dbPath,0o644);await assert.rejects(()=>open(config),code('REGISTRATION_JOURNAL_PERMISSIONS'));fs.chmodSync(config.dbPath,0o600);
    const link=path.join(path.dirname(config.dbPath),'link.sqlite');fs.symlinkSync(config.dbPath,link);await assert.rejects(()=>open({...config,dbPath:link}),code('REGISTRATION_JOURNAL_PERMISSIONS'));
  });
  test('symlink ancestors and unsafe or dangling SQLite sidecars fail before opening',async()=>{
    const {j,config}=await fixture();j.close();const alias=path.join(root,'ancestor-link');fs.symlinkSync(root,alias);
    await assert.rejects(()=>open({...config,dbPath:path.join(alias,path.relative(root,config.dbPath))}),code('REGISTRATION_JOURNAL_PERMISSIONS'));
    fs.unlinkSync(alias);
    for(const suffix of ['-journal','-wal','-shm']){
      fs.symlinkSync(path.join(root,'missing-target'),config.dbPath+suffix);await assert.rejects(()=>open(config),code('REGISTRATION_JOURNAL_PERMISSIONS'));fs.unlinkSync(config.dbPath+suffix);
      fs.writeFileSync(config.dbPath+suffix,'',{mode:0o644});await assert.rejects(()=>open(config),code('REGISTRATION_JOURNAL_PERMISSIONS'));fs.unlinkSync(config.dbPath+suffix);
    }
    const reopened=await open(config);assert.deepEqual(await reopened.list(),[]);
  });
}
