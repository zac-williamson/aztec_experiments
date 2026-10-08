import path from 'node:path';
import {startProverService} from '../../prover/service.mjs';
import {applicationProofsEnabled} from './proof-policy.mjs';
export async function startRemoteProverFixture({directory,board,info,bbPath,privateFeeAddress,origins=[]}){
 const service=await startProverService({host:'127.0.0.1',port:0,board,chainId:info.l1ChainId,rollupVersion:info.rollupVersion,proofs:applicationProofsEnabled()?'real':'disabled',origins,privateFeeAddress,threads:1,bbPath,crsPath:process.env.CRS_PATH,queueDirectory:directory});
 return {config:{url:'http://127.0.0.1:'+service.address.port,board,chainId:info.l1ChainId,rollupVersion:info.rollupVersion},stats:service.stats,close:service.close};
}
export function assertRemoteJobs(fixture,minimum=1){
 if(!fixture)return undefined;
 const stats=fixture.stats();if(stats.completed<minimum||stats.failed!==0)throw Error('Expected successful remote proof jobs');
 return {submitted:stats.submitted,completed:stats.completed,failed:stats.failed};
}
