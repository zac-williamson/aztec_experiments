// Fail-fast hierarchy: a failed file stops the tier. No retries or alternate commands.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {assertNodeVersion,ROOT} from './toolchain.mjs';
assertNodeVersion();
const tiers={
  harness:[
    'scripts/testing/supervisor.test.mjs',
    'scripts/testing/process-tree.test.mjs',
    'scripts/test-c01-native-profile.mjs',
    'scripts/test-application-action-routing.mjs',
    'scripts/test-o01-censor-command-io.mjs',
    'scripts/test-t04-browser-journey.mjs',
    'scripts/test-t04-proof-timing.mjs',
    'scripts/test-browser-error-observer.mjs',
    'scripts/test-t04-browser-post-recovery.mjs',
  ],
  components:[
    'scripts/test-artifacts.mjs',
    'scripts/test-public-feed-rpc.mjs',
    'scripts/test-public-feed.mjs',
    'scripts/test-public-feed-review.mjs',
    'scripts/test-public-feed-storage.mjs',
    'scripts/test-cli-prover.mjs',
    'scripts/test-cli-crs.mjs',
    'scripts/test-crs-consumers.mjs',
    'scripts/test-crs-build.mjs',
    'scripts/test-private-pxe-browser.mjs',
    'scripts/test-browser-chonk-stream.mjs',
    'scripts/test-c01-user.mjs',
    'scripts/test-c01-deploy-activation.mjs',
  ],
};
const [tier,...extra]=process.argv.slice(2);
assert(extra.length===0&&Object.hasOwn(tiers,tier),'Choose harness or components explicitly');
for(const file of tiers[tier]){
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',file],{cwd:ROOT,stdio:'inherit',timeout:60000});
  if(result.error||result.status!==0){
    console.error(JSON.stringify({failedTier:tier,failedFile:file,stopped:true}));
    process.exit(1);
  }
}
