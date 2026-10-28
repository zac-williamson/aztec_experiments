import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {noirTestBatches,noirTestRuntime} from './noir-test-batches.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { runWithService, probeTcp } from './process-lifecycle.mjs';
import { ROOT, assertNodeVersion, assertAztecPackages, nargoBinary, bbBinary } from './toolchain.mjs';
import { checkArtifacts } from './check-artifacts.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--filter' || !/^[a-zA-Z0-9_:]+$/.test(args[1]))) throw new Error('Usage: test-noir.mjs [--filter test_name]');
const threads = process.env.NOIR_TEST_THREADS ?? '2';
if (!['1','2'].includes(threads)) throw new Error('NOIR_TEST_THREADS must be 1 or 2');
const filter = args.length ? [args[1]] : [];
assertNodeVersion(); assertAztecPackages(); checkArtifacts();
const compiler=nargoBinary();
const listing=execFileSync(compiler,['test',...filter,'--workspace','--list-tests','--silence-warnings'],{cwd:path.join(ROOT,'billboard'),encoding:'utf8',timeout:60000});
const batches=noirTestBatches(listing),prepared=new Set();
try {
for(const batch of batches){
const runtime=noirTestRuntime(batch.packageName);
if(runtime.artifact&&!prepared.has(runtime.artifact)){
 const artifact=path.join(ROOT,'billboard/target',runtime.artifact),output=artifact+'.test-processing';
 if(JSON.parse(fs.readFileSync(artifact,'utf8')).name!==runtime.contract)throw Error('Unexpected Noir test artifact');
 // The clean workspace build already compiled this test-only contract. Process
 // only its output; do not rebuild or modify any production artifact/manifest.
 try{
  execFileSync(bbBinary(),['aztec_process','--force','-i',artifact,'-o',output],{cwd:ROOT,stdio:'inherit',timeout:300000,env:{...process.env,HARDWARE_CONCURRENCY:'2'}});
  const processed=JSON.parse(fs.readFileSync(output,'utf8'));
  if(processed.name!==runtime.contract||processed.transpiled!==true||processed.functions.filter(f=>f.custom_attributes?.includes('abi_private')).some(f=>!f.verification_key))throw Error('Unprocessed Noir test artifact');
  fs.renameSync(output,artifact);prepared.add(runtime.artifact);
 }finally{fs.rmSync(output,{force:true});}
}
console.log(`Noir batch: ${batch.packageName}, ${batch.names.length} exact tests`);
const reservation = net.createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
  await runWithService({
    service: {
      command: process.execPath,
      args: runtime.serviceArgs,
      options: { cwd: ROOT, stdio: 'inherit', env: { ...process.env, TXE_PORT: String(port), TXE_WORKERS: '1', NODE_BACKEND: 'js' } },
    },
    tests: {
      command: compiler,
      args: ['test', ...batch.names, '--exact', ...(process.env.NOIR_SHOW_TEST_OUTPUT === '1' ? ['--show-output'] : []), '--package', batch.packageName, '--oracle-resolver', `http://127.0.0.1:${port}`, '--test-threads', runtime.threads??threads, '--silence-warnings'],
      options: { cwd: path.join(ROOT, 'billboard'), stdio: 'inherit', timeout: 540000, killSignal: 'SIGTERM' },
    },
    probe: () => probeTcp(port),
  });
}
} catch (error) {
  console.error(error);
  process.exitCode = error.exitCode || 1;
}
