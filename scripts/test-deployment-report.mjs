// Exercises the actual CLI filesystem boundary without SDK startup or signing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const source=fs.readFileSync(new URL('../apps/src/billboard/deploy/cli.mjs',import.meta.url),'utf8');
const start=source.indexOf('  // Validate and reserve report output before any deployment transaction.');
const run=source.indexOf('  try {\n    const result = await globalThis.runDeploy(env, config);',start);
const end=source.indexOf("    log('Deployment report: '",run);
assert.ok(start>=0&&run>start&&end>run,'CLI report boundary markers must remain identifiable');
const preflight=source.slice(start,run);
const write=source.slice(run,end);
const manifest={fixture:'explicit deployment intent'};
const digest='0x'+createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'billboard-report-test-'));
 const report=path.join(directory,'report.json');let transactions=0;
 const context={fs,path,createHash,args:{report},manifestConfig:{deploymentManifest:manifest},__realProcess:{pid:process.pid},env:{},config:{},runDeploy:async()=>{transactions++;return{intentDigest:digest,status:'pending-settlement'};}};
 return {directory,report,context,get transactions(){return transactions;},close(){fs.rmSync(directory,{recursive:true,force:true});}};
}
async function execute(f){
 return vm.runInNewContext('(async()=>{'+preflight+write+'}finally{fs.closeSync(reportFd);if(fs.existsSync(temporary))fs.unlinkSync(temporary);}})()',f.context);
}
for(const kind of ['new report','same intent'])test('report output accepts '+kind,async()=>{
 const f=fixture();try{
  if(kind==='same intent')fs.writeFileSync(f.report,JSON.stringify({schemaVersion:1,intentDigest:digest}));
  await execute(f);assert.equal(f.transactions,1);
  const result=JSON.parse(fs.readFileSync(f.report,'utf8'));assert.equal(result.intentDigest,digest);assert.equal(result.status,'pending-settlement');
  assert.equal(fs.statSync(f.report).mode&0o777,0o600);
 }finally{f.close();}
});
for(const kind of ['unrelated report','dangling symlink','missing parent'])test('report preflight rejects '+kind+' before transactions',async()=>{
 const f=fixture();try{
  if(kind==='unrelated report')fs.writeFileSync(f.report,'{}');
  if(kind==='dangling symlink')fs.symlinkSync(path.join(f.directory,'absent'),f.report);
  if(kind==='missing parent')f.context.args.report=path.join(f.directory,'absent','report.json');
  await assert.rejects(execute(f),kind==='unrelated report'?/unrelated deployment report/:kind==='dangling symlink'?/Invalid deployment report/:/ENOENT/);
  assert.equal(f.transactions,0);
 }finally{f.close();}
});
test('result intent mismatch cannot create a misleading report',async()=>{
 const f=fixture();try{
  f.context.runDeploy=async()=>({intentDigest:'0x'+'00'.repeat(32)});
  await assert.rejects(execute(f),/report identity mismatch/);assert.equal(fs.existsSync(f.report),false);
  assert.deepEqual(fs.readdirSync(f.directory),[]);
 }finally{f.close();}
});
test('destination changed during deployment is preserved',async()=>{
 const f=fixture();try{
  f.context.runDeploy=async()=>{fs.writeFileSync(f.report,'other writer');return{intentDigest:digest};};
  await assert.rejects(execute(f),/report changed during deployment/);
  assert.equal(fs.readFileSync(f.report,'utf8'),'other writer');assert.deepEqual(fs.readdirSync(f.directory),['report.json']);
 }finally{f.close();}
});
