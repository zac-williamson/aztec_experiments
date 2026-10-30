import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
// Dependency-free tests run on untrusted PR runners with no cloud credentials.
// Full build checks remain in build.yml and gate the deployment workflow.
const tests=[
 'scripts/release/release.test.mjs',
 'shared/rolling/deployment-registration.test.mjs',
 'apps/rolling/feed-ranking.test.mjs','apps/rolling/home-reader.test.mjs',
 'apps/rolling/analytics.test.mjs','shared/network-fee-pricing.test.mjs',
 'ops/analytics.test.mjs','ops/auth.test.mjs','ops/server.test.mjs',
 'ops/community.test.mjs','ops/monitor.test.mjs',
 'ops/backup.test.mjs','ops/backup-job.test.mjs',
 'scripts/rolling-public-capacity.test.mjs',
];
const pythonTests=[
 'scripts/release/bootstrap.test.py',
 'ops/observer_test.py','ops/backup_cloud_test.py',
 'deploy/launch-ops/install_host_test.py',
];
for(const file of [...tests,...pythonTests])if(!fs.existsSync(file))throw Error('Missing required check: '+file);
execFileSync(process.execPath,['--test',...tests],{stdio:'inherit',timeout:300000});
for(const file of pythonTests)execFileSync('python3',[file],{stdio:'inherit',timeout:30000});
