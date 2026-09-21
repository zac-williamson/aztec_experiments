import {Barretenberg,BarretenbergSync} from '@aztec/bb.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {bootstrapPluginDevnet} from './bootstrap.mjs';
import {runHostedService} from '../main.mjs';
if(!process.env.OPENROUTER_API_KEY)throw Error('Set OPENROUTER_API_KEY in plugins/.env before starting the live bot');
const host=process.env.PLUGIN_PUBLIC_HOST||Object.values(os.networkInterfaces()).flat().find(x=>x&&!x.internal&&x.family==='IPv4')?.address||'127.0.0.1';
const directory=await fs.mkdtemp(path.resolve('.build/plugin-devnet-'));
let fixture,service,closed=false;
async function close(){if(closed)return;closed=true;const errors=[];for(const stop of [()=>service?.close(),()=>fixture?.close(),()=>Barretenberg.destroySingleton(),()=>BarretenbergSync.destroySingleton()]){try{await stop();}catch(error){errors.push(error);}}if(errors.length)throw new AggregateError(errors,'Local service cleanup failed');}
try{
 fixture=await bootstrapPluginDevnet({directory,host,proofs:process.env.PLUGIN_PROOFS==='true'});
 service=await runHostedService({config:fixture.serviceConfig});
 console.log('Local bot running:',`http://${host}:8787/health`);
 console.log('Local service configuration:',path.join(directory,'service.json'));
 const shutdown=()=>close().then(()=>process.exit(0),()=>process.exit(1));
 process.once('SIGINT',shutdown);
 process.once('SIGTERM',shutdown);
}catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup]);}throw error;}
