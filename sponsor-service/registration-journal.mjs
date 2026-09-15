// Local persistence only: caller observes chain state and owns signer/process/recovery fences.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Tx} from '@aztec/stdlib/tx';
import {Fr} from '@aztec/foundation/curves/bn254';
import {loadContractArtifact,getAllFunctionAbis,encodeArguments,FunctionSelector} from '@aztec/stdlib/abi';
import {getContractClassFromArtifact} from '@aztec/stdlib/contract';
import {computeCalldataHash} from '@aztec/stdlib/hash';
import {assertNodeVersion} from '../scripts/toolchain.mjs';
export class RegistrationJournalError extends Error{constructor(code){super(code);this.code=code;}}
const need=(ok,code='REGISTRATION_JOURNAL_INVALID')=>{if(!ok)throw new RegistrationJournalError(code);};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const exact=(value,keys)=>need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));
function uint(value,bits){need(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&value.length<=39);const n=BigInt(value);need(n<1n<<BigInt(bits));return n;}
function field(value){need(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value));need(Fr.fromString(value).toString()===value&&value!==Fr.ZERO.toString());return value;}
function intent(value){exact(value,['batchId','root','window','ticketCount']);need(uint(value.batchId,64)>0n);field(value.root);uint(value.window,64);need(uint(value.ticketCount,32)>0n&&BigInt(value.ticketCount)<=1024n);return {batchId:value.batchId,root:value.root,window:value.window,ticketCount:value.ticketCount};}
const states=['sealed','preparing','prepared','submission-uncertain','pending','included','confirmed','reverted','blocked'];
const safe=fn=>async(...args)=>{try{return await fn(...args);}catch(error){if(error instanceof RegistrationJournalError)throw error;throw new RegistrationJournalError('REGISTRATION_JOURNAL_UNAVAILABLE');}};
export const openRegistrationJournal=safe(async({dbPath,scope,sponsorArtifact,maxJobs=64,maxTxBytes=1048576}={})=>{
  assertNodeVersion();exact(scope,['chainId','version','rollupAddress','sponsorAddress','boardAddress','sponsorClassId']);
  uint(scope.chainId,64);uint(scope.version,32);for(const key of ['sponsorAddress','boardAddress','sponsorClassId'])field(scope[key]);
  need(/^0x[0-9a-f]{40}$/.test(scope.rollupAddress));
  need(Number.isInteger(maxJobs)&&maxJobs>=1&&maxJobs<=64&&Number.isInteger(maxTxBytes)&&maxTxBytes>=1024&&maxTxBytes<=4194304);
  const artifact=loadContractArtifact(sponsorArtifact),contractClass=await getContractClassFromArtifact(artifact);
  need(artifact.name==='BillboardSponsor'&&contractClass.id.toString()===scope.sponsorClassId,'REGISTRATION_JOURNAL_ARTIFACT_MISMATCH');
  const matches=getAllFunctionAbis(artifact).filter(fn=>fn.name==='register_batch'&&fn.functionType==='public'&&!fn.isStatic);
  need(matches.length===1&&matches[0].parameters.length===4,'REGISTRATION_JOURNAL_ARTIFACT_MISMATCH');const abi=matches[0];
  const selector=await FunctionSelector.fromNameAndParameters(abi.name,abi.parameters);
  const binding=JSON.stringify({scope:{...scope},abiSha256:digest(JSON.stringify(abi)),maxJobs,maxTxBytes});
  scope=JSON.parse(binding).scope;
  need(typeof dbPath==='string'&&path.isAbsolute(dbPath)&&path.resolve(dbPath)===dbPath);const directory=path.dirname(dbPath);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});const dir=fs.lstatSync(directory);
  need(dir.isDirectory()&&!dir.isSymbolicLink()&&dir.uid===process.getuid()&&(dir.mode&0o077)===0&&fs.realpathSync(directory)===directory,'REGISTRATION_JOURNAL_PERMISSIONS');
  let fd;try{fd=fs.openSync(dbPath,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW,0o600);}catch(error){if(error.code!=='EEXIST')throw error;}finally{if(fd!==undefined)fs.closeSync(fd);}
  const privateFile=(file,stat=fs.lstatSync(file))=>{need(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o600,'REGISTRATION_JOURNAL_PERMISSIONS');};
  const checkFiles=()=>{privateFile(dbPath);for(const suffix of ['-journal','-wal','-shm']){let stat;try{stat=fs.lstatSync(dbPath+suffix);}catch(error){if(error.code==='ENOENT')continue;throw error;}privateFile(dbPath+suffix,stat);}};
  checkFiles();
  const db=new DatabaseSync(dbPath,{enableForeignKeyConstraints:true,timeout:5000});let closed=false;
  const tx=fn=>{need(!closed,'REGISTRATION_JOURNAL_CLOSED');checkFiles();db.exec('BEGIN IMMEDIATE');try{const result=fn();checkFiles();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const row=id=>{uint(id,64);const result=db.prepare('SELECT * FROM jobs WHERE batch_id=?').get(id);need(result,'REGISTRATION_JOURNAL_NOT_FOUND');return result;};
  const unblocked=()=>need(!db.prepare("SELECT 1 FROM jobs WHERE state='blocked' LIMIT 1").get(),'REGISTRATION_JOURNAL_RECONCILIATION_REQUIRED');
  const current=(id,revision)=>{need(Number.isSafeInteger(revision)&&revision>0&&revision<1000000);const r=row(id);need(r.revision===revision,'REGISTRATION_JOURNAL_REVISION_CONFLICT');return r;};
  const view=r=>({intent:JSON.parse(r.intent),revision:r.revision,state:r.state,claimed:r.claimed===1,txHash:r.tx_hash,txSha256:r.tx_sha256,txBytesLength:r.tx_bytes?.length??0,observation:r.observation?JSON.parse(r.observation):null});
  async function verifyBytes(bytes,planned){
    need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=maxTxBytes,'REGISTRATION_JOURNAL_INVALID_TX');const buffer=Buffer.from(bytes);
    const transaction=Tx.fromBuffer(buffer);need(transaction.toBuffer().equals(buffer)&&!transaction.chonkProof.isEmpty(),'REGISTRATION_JOURNAL_INVALID_TX');
    const hash=await Tx.computeTxHash(transaction);need(hash.equals(transaction.getTxHash()),'REGISTRATION_JOURNAL_INVALID_TX');
    const context=transaction.data.constants.txContext;need(context.chainId.toBigInt()===BigInt(scope.chainId)&&context.version.toBigInt()===BigInt(scope.version),'REGISTRATION_JOURNAL_INVALID_TX');
    const expected=encodeArguments(abi,[BigInt(planned.batchId),Fr.fromString(planned.root),BigInt(planned.window),BigInt(planned.ticketCount)]);
    // Tx combines calldata through a cached hash map; independently bind the values to that hash.
    need(transaction.publicFunctionCalldata.length===1,'REGISTRATION_JOURNAL_INVALID_TX');
    const calldata=transaction.publicFunctionCalldata[0];
    need(calldata.values.length===expected.length+1&&(await computeCalldataHash(calldata.values)).equals(calldata.hash),'REGISTRATION_JOURNAL_INVALID_TX');
    const calls=transaction.getPublicCallRequestsWithCalldata();need(calls.length===1,'REGISTRATION_JOURNAL_INVALID_TX');const call=calls[0];
    need(call.request.contractAddress.toString()===scope.sponsorAddress&&!call.request.isStaticCall&&call.functionSelector.equals(selector)&&call.calldata[0].equals(selector.toField())&&!transaction.data.feePayer.isZero()&&call.request.msgSender.equals(transaction.data.feePayer),'REGISTRATION_JOURNAL_INVALID_TX');
    need(call.args.length===expected.length&&call.args.every((value,index)=>value.equals(expected[index])),'REGISTRATION_JOURNAL_INVALID_TX');
    return {bytes:buffer,hash:hash.toString(),sha256:digest(buffer)};
  }
  function checkedObservation(observation,r){
    need(observation&&typeof observation==='object');need(observation.txHash===r.tx_hash,'REGISTRATION_JOURNAL_RECEIPT_MISMATCH');
    if(['pending','proposed','unknown','dropped','rollback'].includes(observation.status)){
      exact(observation,['status','txHash']);return {value:{...observation},state:['pending','proposed'].includes(observation.status)?'pending':'blocked'};
    }
    exact(observation,['status','txHash','executionResult','blockNumber','blockHash','canonicalBlockHash','registeredBatch']);
    need(['checkpointed','proven','finalized'].includes(observation.status)&&['success','reverted'].includes(observation.executionResult));
    need(uint(observation.blockNumber,64)>0n);field(observation.blockHash);need(observation.blockHash===observation.canonicalBlockHash,'REGISTRATION_JOURNAL_RECEIPT_MISMATCH');
    if(observation.executionResult==='success')need(JSON.stringify(intent(observation.registeredBatch))===r.intent,'REGISTRATION_JOURNAL_RECEIPT_MISMATCH');else need(observation.registeredBatch===null);
    return {value:JSON.parse(JSON.stringify(observation)),state:observation.executionResult==='reverted'?'reverted':observation.status==='finalized'?'confirmed':'included'};
  }
  try{
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(batch_id TEXT PRIMARY KEY,intent TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),state TEXT NOT NULL,claimed INTEGER NOT NULL CHECK(claimed IN (0,1)),tx_bytes BLOB,tx_hash TEXT,tx_sha256 TEXT,observation TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_claim ON jobs(claimed) WHERE claimed=1;`);
    const snapshot=tx(()=>{
      const existing=db.prepare("SELECT value FROM meta WHERE key='binding'").get();
      if(existing)need(existing.value===binding,'REGISTRATION_JOURNAL_SCOPE_MISMATCH');else{need(!db.prepare('SELECT 1 FROM jobs LIMIT 1').get());db.prepare("INSERT INTO meta VALUES('binding',?)").run(binding);}
      need(db.prepare('SELECT count(*) AS n FROM meta').get().n===1);need(db.prepare('SELECT count(*) AS n FROM jobs').get().n<=maxJobs,'REGISTRATION_JOURNAL_LIMIT');
      need(!db.prepare('SELECT 1 FROM jobs WHERE length(tx_bytes)>? OR length(intent)>1024 OR length(observation)>4096 LIMIT 1').get(maxTxBytes));
      return {generation:db.prepare('PRAGMA data_version').get().data_version,rows:db.prepare('SELECT * FROM jobs').all()};
    });
    let claims=0;
    for(const r of snapshot.rows){
      const planned=intent(JSON.parse(r.intent));need(planned.batchId===r.batch_id&&JSON.stringify(planned)===r.intent&&states.includes(r.state)&&Number.isSafeInteger(r.revision)&&r.revision>0&&r.revision<1000000);need([0,1].includes(r.claimed));claims+=r.claimed;
      if(['sealed','preparing'].includes(r.state)){need(r.tx_bytes===null&&r.tx_hash===null&&r.tx_sha256===null&&r.observation===null&&r.claimed===(r.state==='preparing'?1:0));}
      else{const checked=await verifyBytes(r.tx_bytes,planned);need(checked.hash===r.tx_hash&&checked.sha256===r.tx_sha256);if(r.state==='prepared'||r.state==='submission-uncertain')need(r.observation===null&&r.claimed===1);else{need(r.observation!==null);const checked=checkedObservation(JSON.parse(r.observation),r);need(checked.state===r.state&&JSON.stringify(checked.value)===r.observation);}}
    }
    need(snapshot.rows.every(r=>!['included','confirmed','reverted'].includes(r.state)||r.claimed===0));
    need(snapshot.rows.every(r=>r.state!=='pending'||r.claimed===1));
    need(claims<=1);tx(()=>need(db.prepare('PRAGMA data_version').get().data_version===snapshot.generation,'REGISTRATION_JOURNAL_STATE_CHANGED'));
  }catch(error){db.close();closed=true;throw error;}
  return Object.freeze({
    enqueue:safe(async value=>tx(()=>{unblocked();const planned=intent(value),existing=db.prepare('SELECT * FROM jobs WHERE batch_id=?').get(planned.batchId);if(existing){need(existing.intent===JSON.stringify(planned),'REGISTRATION_JOURNAL_INTENT_CONFLICT');return view(existing);}need(db.prepare('SELECT count(*) AS n FROM jobs').get().n<maxJobs,'REGISTRATION_JOURNAL_LIMIT');db.prepare("INSERT INTO jobs(batch_id,intent,revision,state,claimed) VALUES(?,?,1,'sealed',0)").run(planned.batchId,JSON.stringify(planned));return view(row(planned.batchId));})),
    get:safe(async id=>tx(()=>view(row(id)))),
    list:safe(async({limit=16,cursor='0'}={})=>tx(()=>{need(Number.isInteger(limit)&&limit>0&&limit<=64);uint(cursor,64);return db.prepare('SELECT * FROM jobs').all().filter(r=>BigInt(r.batch_id)>BigInt(cursor)).sort((a,b)=>BigInt(a.batch_id)<BigInt(b.batch_id)?-1:1).slice(0,limit).map(view);})),
    claim:safe(async({batchId,expectedRevision})=>tx(()=>{unblocked();const r=current(batchId,expectedRevision);need(r.state==='sealed','REGISTRATION_JOURNAL_TRANSITION');need(!db.prepare('SELECT 1 FROM jobs WHERE claimed=1').get(),'REGISTRATION_JOURNAL_BUSY');db.prepare("UPDATE jobs SET state='preparing',claimed=1,revision=revision+1 WHERE batch_id=?").run(batchId);return view(row(batchId));})),
    savePrepared:safe(async({batchId,expectedRevision,txBytes})=>{
      const snapshot=tx(()=>{unblocked();const r=current(batchId,expectedRevision);need(r.state==='preparing'&&r.claimed===1,'REGISTRATION_JOURNAL_TRANSITION');return JSON.parse(r.intent);});
      const prepared=await verifyBytes(txBytes,snapshot);
      return tx(()=>{unblocked();const r=current(batchId,expectedRevision);need(r.state==='preparing'&&r.claimed===1,'REGISTRATION_JOURNAL_TRANSITION');db.prepare("UPDATE jobs SET state='prepared',revision=revision+1,tx_bytes=?,tx_hash=?,tx_sha256=? WHERE batch_id=?").run(prepared.bytes,prepared.hash,prepared.sha256,batchId);return view(row(batchId));});
    }),
    beginSubmission:safe(async({batchId,expectedRevision})=>tx(()=>{unblocked();const r=current(batchId,expectedRevision);need(r.state==='prepared'&&r.claimed===1,'REGISTRATION_JOURNAL_TRANSITION');db.prepare("UPDATE jobs SET state='submission-uncertain',revision=revision+1 WHERE batch_id=?").run(batchId);return view(row(batchId));})),
    loadPrepared:safe(async batchId=>{const r=tx(()=>row(batchId));need(r.tx_bytes,'REGISTRATION_JOURNAL_TRANSITION');const prepared=await verifyBytes(r.tx_bytes,JSON.parse(r.intent));need(prepared.sha256===r.tx_sha256&&prepared.hash===r.tx_hash);return {txBytes:prepared.bytes,txHash:prepared.hash,txSha256:prepared.sha256};}),
    observe:safe(async({batchId,expectedRevision,observation})=>tx(()=>{
      const r=current(batchId,expectedRevision);need(['submission-uncertain','pending','included','confirmed','reverted','blocked'].includes(r.state),'REGISTRATION_JOURNAL_TRANSITION');
      const checked=checkedObservation(observation,r),encoded=JSON.stringify(checked.value);
      if(encoded===r.observation)return view(r);
      if(['confirmed','reverted'].includes(r.state))need(observation.status==='rollback','REGISTRATION_JOURNAL_TRANSITION');
      if(r.state==='included'&&checked.state==='pending')throw new RegistrationJournalError('REGISTRATION_JOURNAL_TRANSITION');
      // A rollback blocks new claims/submissions globally, even if another job already owns the claim.
      // Canonical inclusion releases the submission slot; finality is monitored separately.
      let claimed=['included','confirmed','reverted'].includes(checked.state)?0:r.claimed;
      if(checked.state==='pending'&&!claimed){
        need(!db.prepare('SELECT 1 FROM jobs WHERE claimed=1').get(),'REGISTRATION_JOURNAL_BUSY');claimed=1;
      }
      db.prepare('UPDATE jobs SET state=?,observation=?,claimed=?,revision=revision+1 WHERE batch_id=?').run(checked.state,encoded,claimed,batchId);return view(row(batchId));
    })),
    close:()=>{if(!closed){db.close();closed=true;}},
  });
});
