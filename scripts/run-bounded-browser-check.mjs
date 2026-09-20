// UI component adapter; the same supervisor owns resources as application scenarios.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion,anvilBinary} from './toolchain.mjs';
import {Supervisor,describeFailure} from './testing/supervisor.mjs';
assertNodeVersion();
const [script,output,...args]=process.argv.slice(2);
const publicFeed=script==='scripts/test-public-feed-browser.mjs';
const walletExtension=script==='scripts/test-wallet-extension-browser.mjs';
assert(['scripts/test-wallet-extension-browser.mjs','scripts/test-public-feed-browser.mjs','scripts/test-u01-hosting-browser.mjs','scripts/test-u01-config-browser.mjs','scripts/test-u01-keyboard-browser.mjs','scripts/test-u01-journey-browser.mjs','scripts/test-u01-fee-deploy-ui.mjs'].includes(script),'Choose a UI component test; run application scenarios directly');
const reportPath=path.resolve(ROOT,output);
assert(reportPath.startsWith(path.join(ROOT,'execution/evidence',(publicFeed||walletExtension)?'T04':'U01')+path.sep));
const file=await fs.open(reportPath,'wx');
const directory=await fs.mkdtemp('/private/tmp/board-ui-');
const report={script,args,passed:false,observations:[]};
const owner=new Supervisor({deadlineMs:walletExtension?120000:540000,report});
try{
 const names=[script,...(walletExtension?[path.relative(ROOT,anvilBinary()),'toolchain.json','scripts/t04-extension-collateral.mjs','shared/protocol-commitments.mjs','billboard/portal/out/BillboardPortal.sol/BillboardPortal.json','scripts/toolchain.mjs','shared/private-fee-client.mjs','apps/src/billboard/private_fee_artifact.json','apps/dist/fee-juice.html','apps/dist/aztec_bundle.js','shared/wallet-backup.js','shared/wallet-buttons.js','shared/private-fee-funding.mjs','shared/ethereum-journal.mjs','apps/src/fee-juice/engine.js','.build/metamask-13.49.0/metamask-chrome-13.49.0.zip','.build/portal-tests/out/PortalV1.t.sol/RootPublisher.json','package-lock.json']:[]),...(publicFeed?['shared/public-feed-projection.mjs','shared/public-feed-storage.mjs','shared/public-feed-file-storage.mjs','shared/public-feed-connection.mjs','shared/public-feed-cli.mjs','shared/public-feed.mjs','shared/public-feed-source.mjs','apps/dist/public-feed.js','apps/dist/feed.html']:[]),...(script==='scripts/test-u01-hosting-browser.mjs'?['scripts/browser-history-entry.mjs','scripts/screening-history-fixture.mjs','shared/sdk-store.mjs','package-lock.json']:[]),'scripts/run-bounded-browser-check.mjs','scripts/testing/supervisor.mjs','scripts/owned-test-process-tree.mjs','deploy/hosting-config.mjs','.build/apps-manifest.json','.build/sdk/sdk-manifest.json'];
 const fingerprints=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex')])));
 report.sourceHashes=await fingerprints();
 const exit=await owner.start('ui',process.execPath,['--max-old-space-size='+String(walletExtension?256:publicFeed?128:64),path.join(ROOT,script),...args],{
  cwd:ROOT,env:{...process.env,NODE_OPTIONS:'',U01_BOUNDED_BROWSER:'true',BILLBOARD_TEST_TMPDIR:directory,TMPDIR:directory,TMP:directory,TEMP:directory},
  onRecord:record=>report.observations.push(record),
 });
 assert.equal(exit.code,0);assert(report.observations.length>0);assert(report.observations.every(record=>record.passed===true));
 assert.deepEqual(await fingerprints(),report.sourceHashes);report.passed=true;
}catch(error){owner.fail('ui-check',error);}
finally{
 await owner.close();
 if(report.ownedTreeAbsent)try{await fs.rm(directory,{recursive:true});report.temporaryDirectoryRemoved=true;}catch(error){report.failures.push({stage:'directory-cleanup',...describeFailure(error)});}
 report.passed=report.passed&&report.failures.length===0&&report.temporaryDirectoryRemoved===true;
 await file.writeFile(JSON.stringify(report,null,2)+'\n');await file.close();
 console.log(JSON.stringify({passed:report.passed,evidence:reportPath}));process.exitCode=report.passed?0:1;
}
