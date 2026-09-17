#!/usr/bin/env node
// Actual isolated-model evaluation only. This module has no signer or wallet API.
import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {startModelRuntime} from './model-runtime.mjs';
import {moderatePost,buildUserPrompt} from './moderation.mjs';
import {identifyModel,sha256Bytes} from './model-version.mjs';

export const THRESHOLDS=Object.freeze({minLabeled:300,minMultilingual:50,minInjection:50,maxFalsePositiveRate:0.02,maxFalseNegativeRate:0.05,maxP95Ms:10000});
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const digest=value=>sha256Bytes(Buffer.from(JSON.stringify(value)));
export function validateCorpus(corpus){
 if(corpus?.schemaVersion!==1||!Array.isArray(corpus.policies)||!corpus.policies.length||!Array.isArray(corpus.cases)||!corpus.cases.length||corpus.cases.length>10000)throw Error('Invalid evaluation corpus');
 const policies=new Map();
 for(const policy of corpus.policies){
  if(typeof policy.id!=='string'||!policy.id||policies.has(policy.id)||typeof policy.text!=='string'||!policy.text||!integer(policy.censorWindowSeconds)||policy.censorWindowSeconds<1)throw Error('Invalid evaluation policy');
  policies.set(policy.id,policy);
 }
 const ids=new Set();
 for(const item of corpus.cases){
  if(typeof item.id!=='string'||!item.id||ids.has(item.id)||!policies.has(item.policyId)||typeof item.text!=='string'||!['allowed','violation','ambiguous','boundary-rejection'].includes(item.expected)||typeof item.language!=='string'||!Array.isArray(item.tags)||item.tags.some(tag=>typeof tag!=='string'))throw Error('Invalid evaluation case');
  if(item.expected==='boundary-rejection'){
   if(item.expectedErrorCode!=='INVALID_INPUT')throw Error('Unsupported expected boundary rejection');
   let rejected=false;try{buildUserPrompt(item.text,policies.get(item.policyId).text);}catch(error){if(error.code==='INVALID_INPUT')rejected=true;else throw error;}
   if(!rejected)throw Error('Boundary case must actually violate the input contract');
  }else if(Object.hasOwn(item,'expectedErrorCode'))throw Error('Semantic case cannot expect a boundary error');
  ids.add(item.id);
 }
 return {policies,ids};
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]:null;
function validateResults(corpus,results){
 const {policies}=validateCorpus(corpus),cases=new Map(corpus.cases.map(item=>[item.id,item])),seen=new Set();
 if(!Array.isArray(results))throw Error('Invalid evaluation results');
 for(const result of results){
  const item=cases.get(result.caseId);
  if(!item||seen.has(result.caseId)||result.inputDigest!==digest({case:item,policy:policies.get(item.policyId)})||!Number.isFinite(result.durationMs)||result.durationMs<0||!['decision','error'].includes(result.status)||
   (result.status==='decision'&&(typeof result.isViolation!=='boolean'||(result.reason!==undefined&&(typeof result.reason!=='string'||Buffer.byteLength(result.reason)>200))))||(result.status==='error'&&(typeof result.errorCode!=='string'||!result.errorCode)))throw Error('Invalid or mismatched evaluation result');
  seen.add(result.caseId);
 }
 return {cases,policies};
}
function rateBreakdown(items,results,expected,misclassified){
 const wanted=new Set(items.filter(item=>item.expected===expected).map(item=>item.id));
 const attempted=results.filter(result=>wanted.has(result.caseId)),evaluated=attempted.filter(result=>result.status==='decision');
 const count=evaluated.filter(result=>result.isViolation===misclassified).length;
 return {count,denominator:wanted.size,rate:wanted.size?count/wanted.size:null,attemptedDenominator:attempted.length,evaluatedDenominator:evaluated.length,evaluatedRate:evaluated.length?count/evaluated.length:null,provisional:attempted.length!==wanted.size};
}
function sliceMetrics(items,results){
 const ids=new Set(items.map(item=>item.id)),selected=results.filter(result=>ids.has(result.caseId));
 return {total:items.length,attempted:selected.length,complete:selected.length===items.length,
  falsePositives:rateBreakdown(items,selected,'allowed',true),falseNegatives:rateBreakdown(items,selected,'violation',false),
  errors:selected.filter(result=>result.status==='error').length,
  latency:{p50Ms:percentile(selected.map(r=>r.durationMs),0.5),p95Ms:percentile(selected.map(r=>r.durationMs),0.95),maxMs:selected.length?Math.max(...selected.map(r=>r.durationMs)):null}};
}
export function buildEvaluationReport(corpus,results,{flagSubmissionP95Ms=null,flagSubmissionEvidence=null,evidenceKind='unqualified'}={}){
 const {cases}=validateResults(corpus,results);
 if(flagSubmissionP95Ms!==null&&(!Number.isFinite(flagSubmissionP95Ms)||flagSubmissionP95Ms<0))throw Error('Invalid flag submission latency');
 const boundaryCases=corpus.cases.filter(item=>item.expected==='boundary-rejection'),boundaryIds=new Set(boundaryCases.map(item=>item.id));
 const boundaryResults=results.filter(result=>boundaryIds.has(result.caseId));
 const expectedRejection=result=>boundaryIds.has(result.caseId)&&result.status==='error'&&result.errorCode===cases.get(result.caseId).expectedErrorCode;
 const boundary={total:boundaryCases.length,attempted:boundaryResults.length,passed:boundaryResults.filter(expectedRejection).length,failed:boundaryResults.filter(result=>!expectedRejection(result)).length,complete:boundaryResults.length===boundaryCases.length};
 const semanticResults=results.filter(result=>!boundaryIds.has(result.caseId));
 const labeled=corpus.cases.filter(item=>['allowed','violation'].includes(item.expected)),allowed=labeled.filter(item=>item.expected==='allowed'),violations=labeled.filter(item=>item.expected==='violation');
 const errors=results.filter(result=>result.status==='error'&&!expectedRejection(result)),scored=semanticResults.filter(result=>cases.get(result.caseId).expected!=='ambiguous'),ambiguous=results.filter(result=>cases.get(result.caseId).expected==='ambiguous');
 const fp=scored.filter(result=>result.status==='decision'&&cases.get(result.caseId).expected==='allowed'&&result.isViolation).length;
 const fn=scored.filter(result=>result.status==='decision'&&cases.get(result.caseId).expected==='violation'&&!result.isViolation).length;
 const latency={p50Ms:percentile(semanticResults.map(r=>r.durationMs),0.5),p95Ms:percentile(semanticResults.map(r=>r.durationMs),0.95),maxMs:semanticResults.length?Math.max(...semanticResults.map(r=>r.durationMs)):null};
 const coverage={labeled:labeled.length,multilingual:labeled.filter(item=>item.tags.includes('multilingual')&&!/^en(?:-|$)/i.test(item.language)).length,injection:labeled.filter(item=>item.tags.includes('injection')).length,ambiguous:corpus.cases.filter(item=>item.expected==='ambiguous').length,boundary:boundaryCases.length};
 const complete=results.length===corpus.cases.length;
 const fpr=allowed.length?fp/allowed.length:null,fnr=violations.length?fn/violations.length:null;
 const qualifiedCoverage=coverage.labeled>=THRESHOLDS.minLabeled&&coverage.multilingual>=THRESHOLDS.minMultilingual&&coverage.injection>=THRESHOLDS.minInjection;
 const qualityPass=complete&&qualifiedCoverage&&boundary.failed===0&&errors.length===0&&fpr!==null&&fnr!==null&&fpr<=THRESHOLDS.maxFalsePositiveRate&&fnr<=THRESHOLDS.maxFalseNegativeRate;
 const latencyPass=complete&&boundary.failed===0&&errors.length===0&&latency.p95Ms!==null&&latency.p95Ms<=THRESHOLDS.maxP95Ms;
 const modelCapacity=latency.p95Ms===null?null:capacity(corpus,latency.p95Ms);
 const endToEndCapacity=flagSubmissionEvidence===null||flagSubmissionP95Ms===null||latency.p95Ms===null?null:capacity(corpus,latency.p95Ms+flagSubmissionP95Ms);
 return {schemaVersion:1,evidenceKind,thresholds:THRESHOLDS,complete,attempted:results.length,total:corpus.cases.length,coverage,boundary,
  falsePositives:rateBreakdown(labeled,results,'allowed',true),falseNegatives:rateBreakdown(labeled,results,'violation',false),
  slices:{multilingual:sliceMetrics(labeled.filter(item=>item.tags.includes('multilingual')&&!/^en(?:-|$)/i.test(item.language)),results),injection:sliceMetrics(labeled.filter(item=>item.tags.includes('injection')),results)},
  errors:{total:errors.length,boundary:errors.filter(r=>boundaryIds.has(r.caseId)).length,labeled:scored.filter(r=>r.status==='error').length,ambiguous:ambiguous.filter(r=>r.status==='error').length},
  ambiguous:{attempted:ambiguous.length,violation:ambiguous.filter(r=>r.status==='decision'&&r.isViolation).length,allowed:ambiguous.filter(r=>r.status==='decision'&&!r.isViolation).length},
  latency,qualityPass,latencyPass,modelCapacity,endToEndCapacity,flagSubmissionEvidence,
  capacityStatus:!complete?'incomplete':endToEndCapacity===null?'unresolved-missing-flag-latency':endToEndCapacity.pass?'analytical-pass-not-soak':'unresolved-overload',
  pass:evidenceKind==='actual-isolated-model'&&qualityPass&&latencyPass&&endToEndCapacity?.pass===true,
  provenance:corpus.provenance??null,limitations:['Capacity is a deterministic workload calculation, not an elapsed two-hour test.','Labels retain their recorded provenance; generated labels are not an independent human gold standard.']};
}
function capacity(corpus,serviceMs){
 const minimumWindowMs=Math.min(...corpus.policies.map(p=>p.censorWindowSeconds*1000));
 const arrivalIntervalMs=60000,burst=10,headroom=0.2,burstDrainMs=burst*serviceMs;
 return {method:'single-worker worst-case all posts flagged; p95 service estimate',arrivalIntervalMs,burst,headroom,serviceMs,minimumWindowMs,burstDrainMs,
  steadyStateStable:serviceMs<arrivalIntervalMs,windowHeadroomFraction:1-burstDrainMs/minimumWindowMs,pass:serviceMs<arrivalIntervalMs&&burstDrainMs<=minimumWindowMs*(1-headroom)};
}
export function readFlagLatencyEvidence(filename){
 if(filename===null)return null;
 const bytes=fs.readFileSync(filename);if(bytes.length>5*1024*1024)throw Error('Oversized flag latency evidence');
 const value=JSON.parse(bytes),seen=new Set();
 if(value.schemaVersion!==1||value.kind!=='actual-application-transactions'||!Array.isArray(value.samples)||value.samples.length<20||value.samples.length>10000)throw Error('At least twenty measured flag submissions are required');
 for(const sample of value.samples){if(!Number.isFinite(sample.durationMs)||sample.durationMs<=0||!/^0x[0-9a-f]{64}$/.test(sample.transactionHash)||!/^0x[0-9a-f]{64}$/.test(sample.evidenceDigest)||seen.has(sample.transactionHash))throw Error('Invalid flag latency sample');seen.add(sample.transactionHash);}
 return {path:path.resolve(filename),sha256:sha256Bytes(bytes),samples:value.samples.length,p95Ms:percentile(value.samples.map(sample=>sample.durationMs),0.95)};
}
function saveAtomic(filename,value){
 const temp=filename+'.'+process.pid+'.tmp';let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,filename);
  const dir=fs.openSync(path.dirname(filename),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
export async function evaluateModel({corpusPath,outputPath,runtimeOptions,maxCases=10000,workBudgetMs=480000,flagLatencyEvidencePath=null},{startRuntime=startModelRuntime,evaluate=moderatePost}={}){
 if(!integer(maxCases)||maxCases<1||!integer(workBudgetMs)||workBudgetMs<1000||workBudgetMs>480000)throw Error('Invalid evaluation work bound');
 const latencyEvidence=readFlagLatencyEvidence(flagLatencyEvidencePath),flagSubmissionP95Ms=latencyEvidence?.p95Ms??null,flagSubmissionEvidence=latencyEvidence;
 const corpusBytes=fs.readFileSync(corpusPath);if(corpusBytes.length>16*1024*1024)throw Error('Oversized corpus');
 const corpus=JSON.parse(corpusBytes),{policies}=validateCorpus(corpus),corpusDigest=sha256Bytes(corpusBytes);
 const filename=path.resolve(outputPath);fs.mkdirSync(path.dirname(filename),{recursive:true,mode:0o700});
 const lock=filename+'.lock',lockFd=fs.openSync(lock,'wx',0o600),started=performance.now(),startedAt=new Date().toISOString();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error('Evaluation work deadline')),workBudgetMs);
 let runtime,state,failure,cleanup='not-started',verification={status:'not-started'};
 const shutdown=()=>{controller.abort(Error('Evaluation interrupted'));runtime?.stop().catch(()=>{});};
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
 const evidenceKind=startRuntime===startModelRuntime&&evaluate===moderatePost?'actual-isolated-model':'fixture';
 try{
  fs.writeFileSync(lockFd,JSON.stringify({pid:process.pid,startedAt}));fs.fsyncSync(lockFd);
  runtime=await startRuntime({...runtimeOptions,signal:controller.signal});
  const modelIdentity=identifyModel({...runtime.modelIdentity,configurationBytes:runtime.configurationBytes,promptBytes:runtime.promptBytes});
  if(modelIdentity.modelVersion!==runtime.modelIdentity.modelVersion)throw Error('Runtime model identity mismatch');
  const binding={corpusDigest,evaluatorDigest:sha256Bytes(fs.readFileSync(fileURLToPath(import.meta.url))),modelIdentity,platformIdentity:runtime.platformIdentity??null,configurationBase64:runtime.configurationBytes.toString('base64'),promptBase64:runtime.promptBytes.toString('base64'),evidenceKind,flagSubmissionP95Ms,flagSubmissionEvidence};
  if(fs.existsSync(filename)){
   const bytes=fs.readFileSync(filename);if(bytes.length>32*1024*1024)throw Error('Oversized saved evaluation');const saved=JSON.parse(bytes);
   if(saved.schemaVersion!==1||JSON.stringify(saved.binding)!==JSON.stringify(binding)||!Array.isArray(saved.sessions))throw Error('Saved evaluation does not match exact corpus/model/runtime/prompt binding');
   validateResults(corpus,saved.results);state=saved;
  }else state={schemaVersion:1,binding,results:[],sessions:[]};
  const completed=new Set(state.results.map(result=>result.caseId));let attempted=0;
  for(const item of corpus.cases){
   if(completed.has(item.id))continue;
   const remaining=Math.floor(workBudgetMs-(performance.now()-started));
   if(controller.signal.aborted||remaining<1000||attempted>=maxCases)break;
   const begin=performance.now(),result={caseId:item.id,inputDigest:digest({case:item,policy:policies.get(item.policyId)})};
   try{const verdict=await evaluate(item.text,policies.get(item.policyId).text,runtime.port,{timeoutMs:Math.min(120000,remaining)});
    if(typeof verdict.isViolation!=='boolean')throw Error('Invalid evaluation verdict');
    Object.assign(result,{status:'decision',isViolation:verdict.isViolation,...(typeof verdict.reason==='string'?{reason:verdict.reason}:{})});
   }catch(error){Object.assign(result,{status:'error',errorCode:typeof error.code==='string'&&/^[A-Z0-9_]{1,80}$/.test(error.code)?error.code:'MODEL_EVALUATION_FAILED'});}
   result.durationMs=performance.now()-begin;state.results.push(result);attempted++;
   state.report=buildEvaluationReport(corpus,state.results,{flagSubmissionP95Ms,flagSubmissionEvidence,evidenceKind});state.report.runState='running';state.report.pass=false;saveAtomic(filename,state);
  }
 }catch(error){failure=error;}
 finally{
  clearTimeout(timer);process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);
  if(runtime){
   try{
    if(typeof runtime.verify==='function'){
     const checked=await runtime.verify({signal:AbortSignal.timeout(10000)});
     if(checked?.weightsVerified!==true||JSON.stringify(checked.platformIdentity)!==JSON.stringify(runtime.platformIdentity))throw Error('Post-evaluation runtime identity mismatch');
     verification={status:'verified',...checked};
    }else if(evidenceKind==='actual-isolated-model')throw Error('Post-evaluation runtime verification unavailable');
    else verification={status:'fixture-not-qualified'};
   }catch(error){verification={status:'failed'};failure??=error;}
   try{await runtime.stop();cleanup='complete';}catch(error){cleanup='failed';failure??=error;}}
  try{if(state){state.sessions.push({startedAt,finishedAt:new Date().toISOString(),durationMs:performance.now()-started,cleanup,verification,interrupted:controller.signal.aborted,error:failure?'EVALUATION_RUN_FAILED':null});state.report=buildEvaluationReport(corpus,state.results,{flagSubmissionP95Ms,flagSubmissionEvidence,evidenceKind});state.report.runState=cleanup==='complete'&&!failure?'stopped-cleanly':'failed';state.report.runtimeVerified=state.sessions.every(session=>session.verification?.status==='verified');state.report.pass&&=state.report.runtimeVerified&&state.sessions.every(session=>session.cleanup==='complete'&&!session.error);saveAtomic(filename,state);}}
  finally{fs.closeSync(lockFd);fs.unlinkSync(lock);}
 }
 if(failure)throw failure;
 return state;
}
async function main(){
 const args=Object.create(null),allowed=new Set(['corpus','output','runtime-config','model-manifest','max-cases','work-budget-ms','flag-latency-evidence']);
 for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i].slice(2);if(!process.argv[i].startsWith('--')||!allowed.has(key)||Object.hasOwn(args,key)||!process.argv[i+1])throw Error('Invalid evaluator option');args[key]=process.argv[i+1];}
 if(!args.corpus||!args.output||!args['runtime-config'])throw Error('--corpus, --output and --runtime-config are required');
 const runtimeOptions=JSON.parse(fs.readFileSync(args['runtime-config'],'utf8'));if(args['model-manifest'])runtimeOptions.imageManifestPath=path.resolve(args['model-manifest']);
 const state=await evaluateModel({corpusPath:args.corpus,outputPath:args.output,runtimeOptions,maxCases:args['max-cases']===undefined?10000:Number(args['max-cases']),workBudgetMs:args['work-budget-ms']===undefined?480000:Number(args['work-budget-ms']),flagLatencyEvidencePath:args['flag-latency-evidence']??null});
 console.log(JSON.stringify(state.report));if(!state.report.pass)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
