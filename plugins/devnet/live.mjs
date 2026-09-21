// Explicit paid integration-test entrypoint. GitHub credentials stay in memory.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

if(!process.env.GITHUB_TOKEN){
  try{process.env.GITHUB_TOKEN=(await promisify(execFile)('gh',['auth','token'],{timeout:10000})).stdout.trim();}
  catch{throw Error('Configure GITHUB_TOKEN locally or sign in with gh auth login');}
}
process.env.PLUGIN_GITHUB_WRITES='true';
process.argv.push('--live');
await import('./test-e2e.mjs');
