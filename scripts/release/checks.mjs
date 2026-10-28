import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
// Dependency-free tests run on untrusted PR runners with no cloud credentials.
// Full build checks remain in build.yml and gate the deployment workflow.
const tests=['scripts/release/release.test.mjs','apps/rolling/feed-ranking.test.mjs','apps/rolling/home-reader.test.mjs'];
for(const file of tests)if(!fs.existsSync(file))throw Error('Missing required check: '+file);
execFileSync(process.execPath,['--test',...tests],{stdio:'inherit',timeout:300000});
