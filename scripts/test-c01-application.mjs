// Explicit application scenarios. No implicit scenario or legacy flag aliases.
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export {verifyCensorPackage} from './testing/assets.mjs';
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [name,...args]=process.argv.slice(2);
  if(name==='fixture-worker'){
    assert.equal(args.length,2);
    const {getScenario}=await import('./testing/scenarios.mjs');
    const {readControl}=await import('./testing/browser-worker.mjs');
    const {runFixture}=await import('./testing/fixture-worker.mjs');
    const {browserControl,operatorPackage}=await readControl();
    await runFixture(path.resolve(args[1]),getScenario(args[0]),browserControl,operatorPackage);
  }else if(name==='browser-worker'){
    assert.equal(args.length,1);
    const {runBrowser,readControl}=await import('./testing/browser-worker.mjs');
    await runBrowser(path.resolve(args[0]),await readControl());
  }else{
    assert.equal(args.length,0);
    const {runApplication}=await import('./testing/run-application.mjs');
    await runApplication(name);
  }
}
