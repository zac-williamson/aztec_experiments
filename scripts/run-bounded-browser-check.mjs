// UI component adapter; the same supervisor owns resources as application scenarios.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ROOT,assertNodeVersion,anvilBinary} from './toolchain.mjs';
import {walletExtensionMode,phantomPackage} from './t04-phantom.mjs';
import {Supervisor,describeFailure} from './testing/supervisor.mjs';
// Keep the existing wallet cap unless the operator explicitly selects the full
// aggregate/Bok application journey. One owner deadline covers every phase.
export function browserCheckDeadline({passkey,walletExtension,aggregate,retainedBok,networkOnly,exportOnly,refundReadOnly,testnet=false}){
 if(refundReadOnly!==undefined&&!['true','false'].includes(refundReadOnly))throw Error('Invalid readonly refund flag');
 if(refundReadOnly==='true'){assert(walletExtension&&aggregate&&retainedBok==='true'&&networkOnly!=='true'&&exportOnly!=='true');return 120000;}
 if(exportOnly!==undefined&&!['true','false'].includes(exportOnly))throw Error('Invalid export-only flag');
 if(exportOnly==='true'){assert(walletExtension&&aggregate&&retainedBok!=='true'&&networkOnly!=='true');return 60000;}
 if(networkOnly!==undefined&&!['true','false'].includes(networkOnly))throw Error('Invalid network-only flag');
 if(networkOnly==='true'){assert(walletExtension&&aggregate&&retainedBok!=='true');return 60000;}
 if(retainedBok!==undefined&&!['true','false'].includes(retainedBok))throw Error('Invalid retained Bok flag');
 if(retainedBok==='true'&&!(walletExtension&&aggregate))throw Error('Bok continuation requires aggregate wallet mode');
 if(testnet){if(!walletExtension||!aggregate||retainedBok==='true')throw Error('Real proofs require the explicit testnet aggregate mode');return 3600000;}
 return passkey?60000:walletExtension?(retainedBok==='true'||aggregate?540000:120000):540000;
}
assertNodeVersion();
const [script,output,...args]=process.argv.slice(2);
const passkey=['scripts/test-passkey-browser.mjs','scripts/test-w02-browser.mjs'].includes(script);
const publicFeed=script==='scripts/test-public-feed-browser.mjs';
const walletExtension=script==='scripts/test-wallet-extension-browser.mjs';
const extensionMode=walletExtension?walletExtensionMode(args):null;
const phantom=extensionMode?.startsWith('phantom');
const aggregate=extensionMode?.startsWith('metamask-aggregate-');
const deadlineMs=browserCheckDeadline({passkey,walletExtension,aggregate,testnet:extensionMode?.startsWith('metamask-aggregate-testnet-'),retainedBok:process.env.T04_RETAINED_BOK,networkOnly:process.env.T04_AGGREGATE_NETWORK_ONLY,exportOnly:process.env.T04_AGGREGATE_EXPORT_ONLY,refundReadOnly:process.env.T04_RETAINED_BOK_REFUND_READONLY});
assert(['scripts/test-w02-browser.mjs','scripts/test-passkey-browser.mjs','scripts/test-wallet-extension-browser.mjs','scripts/test-public-feed-browser.mjs','scripts/test-u01-hosting-browser.mjs','scripts/test-u01-config-browser.mjs','scripts/test-u01-keyboard-browser.mjs','scripts/test-u01-journey-browser.mjs','scripts/test-u01-fee-deploy-ui.mjs'].includes(script),'Choose a UI component test; run application scenarios directly');
const reportPath=path.resolve(ROOT,output);
assert(reportPath.startsWith(path.join(ROOT,'execution/evidence',(passkey||publicFeed||walletExtension)?'T04':'U01')+path.sep));
await fs.mkdir(path.dirname(reportPath),{recursive:true});
const file=await fs.open(reportPath,'wx');
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'board-ui-'));
const report={script,args,passed:false,observations:[]};
const browserDeadlineAt=Date.now()+deadlineMs-15000;
const owner=new Supervisor({deadlineMs,report});
try{
 const names=[script,...(script==='scripts/test-w02-browser.mjs'?['shared/ethereum-account-session.js','shared/account.js','shared/application.js','shared/wallet-buttons.js','shared/wallet-providers.js','shared/claim-secret-store.js','shared/journal-backup.mjs','shared/journal-indexeddb.mjs','shared/l2-journal.mjs','shared/ethereum-journal.mjs']:passkey?['shared/passkey-wallet.js','shared/account.js','shared/application.js','shared/wallet-buttons.js','shared/wallet-backup.js']:[]),...(phantom?['scripts/t04-phantom.mjs',phantomPackage.archive,'shared/app-env.js','shared/wallet-providers.js','shared/account.js','shared/wallet-buttons.js','shared/rolling/aggregate-funding.mjs','node_modules/ethers/dist/ethers.umd.min.js','package-lock.json']:[]),...(aggregate?['apps/rolling/wallet-panel.mjs','scripts/t04-metamask.mjs','scripts/t04-phantom.mjs','shared/rolling/aggregate-funding.mjs','shared/rolling/aggregate-recovery.mjs','shared/ethereum-journal.mjs','.build/metamask-13.49.0/metamask-chrome-13.49.0.zip','package-lock.json',process.env.T04_AGGREGATE_CONTROL,...[process.env.T04_RETAINED_BOK_APPROVAL,process.env.T04_RETAINED_BOK_OBSERVE,process.env.T04_AGGREGATE_READY_EXPORT_SHA256?path.join(JSON.parse(await fs.readFile(process.env.T04_AGGREGATE_CONTROL,'utf8')).recoveryDirectory,'ready-recovery-export.json'):null].filter(Boolean)]:[]),...(walletExtension&&!phantom&&!aggregate?[path.relative(ROOT,anvilBinary()),'toolchain.json','scripts/t04-metamask.mjs','scripts/t04-extension-collateral.mjs','shared/protocol-commitments.mjs','billboard/portal/out/BillboardPortal.sol/BillboardPortal.json','scripts/toolchain.mjs','shared/private-fee-client.mjs','apps/src/billboard/private_fee_artifact.json','apps/dist/fee-juice.html','apps/dist/aztec_bundle.js','shared/wallet-backup.js','shared/wallet-buttons.js','shared/private-fee-funding.mjs','shared/ethereum-journal.mjs','apps/src/fee-juice/engine.js','.build/metamask-13.49.0/metamask-chrome-13.49.0.zip','.build/portal-tests/out/PortalV1.t.sol/RootPublisher.json','package-lock.json']:[]),...(publicFeed?['shared/public-feed-projection.mjs','shared/public-feed-storage.mjs','shared/public-feed-file-storage.mjs','shared/public-feed-connection.mjs','shared/public-feed-cli.mjs','shared/public-feed.mjs','shared/public-feed-source.mjs','apps/dist/public-feed.js','apps/dist/feed.html']:[]),...(script==='scripts/test-u01-hosting-browser.mjs'?['scripts/browser-history-entry.mjs','scripts/screening-history-fixture.mjs','shared/sdk-store.mjs','package-lock.json']:[]),'scripts/run-bounded-browser-check.mjs','scripts/testing/supervisor.mjs','scripts/owned-test-process-tree.mjs','deploy/hosting-config.mjs',...(phantom||aggregate?[]:['.build/apps-manifest.json','.build/sdk/sdk-manifest.json'])];
 const fingerprints=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.resolve(ROOT,name))).digest('hex')])));
 report.sourceHashes=await fingerprints();
 // W02 loads real SDK receipts beside Playwright; 64 MiB exhausts the heap during imports.
 // Keep this script at 128 MiB inside the unchanged supervisor process-tree cap.
 const heapMiB=walletExtension?256:(publicFeed||script==='scripts/test-w02-browser.mjs')?128:64;
 const exit=await owner.start('ui',process.execPath,['--max-old-space-size='+String(heapMiB),path.join(ROOT,script),...args],{
  cwd:ROOT,env:{...process.env,T04_BROWSER_DEADLINE_AT:String(browserDeadlineAt),NODE_OPTIONS:'',U01_BOUNDED_BROWSER:'true',BILLBOARD_TEST_TMPDIR:directory,TMPDIR:directory,TMP:directory,TEMP:directory},
  onRecord:record=>{if(aggregate&&record.kind==='wallet-stage'){process.stderr.write(JSON.stringify({stage:record.stage})+'\n');(report.walletStages??=[]).length<64&&report.walletStages.push(record);}else report.observations.push(record);},
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
