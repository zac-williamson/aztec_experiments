import fs from 'node:fs/promises';
import {startProverService} from './service.mjs';
const file=process.argv[2];if(!file)throw Error('Usage: node prover/start.mjs config.json');
const config=JSON.parse(await fs.readFile(file,'utf8'));
const service=await startProverService(config);
console.log(JSON.stringify(config.serviceMode==='query-only'?{listening:service.address,serviceMode:'query-only',proofs:'not-offered',nodeProofs:config.proofs}:{listening:service.address,board:config.board,proofs:config.proofs}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void service.close().catch(()=>{process.exitCode=1;}));
