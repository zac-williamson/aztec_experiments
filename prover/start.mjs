import fs from 'node:fs/promises';
import {startProverService} from './service.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node prover/start.mjs config.json');
const config=JSON.parse(await fs.readFile(file,'utf8'));
const service=await startProverService(config);
console.log(JSON.stringify({listening:service.address,board:config.board,proofs:config.proofs}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void service.close().catch(()=>{process.exitCode=1;}));
