import path from 'node:path';
import {createProofQueue} from '../../prover/queue.mjs';
import {createProcessWorker} from '../../prover/process-worker.mjs';
import {createProverServer} from '../../prover/server.mjs';
import {applicationProofsEnabled} from './proof-policy.mjs';
export async function startRemoteProverFixture({directory,board,info,bbPath}){
 const proofsEnabled=applicationProofsEnabled();
 const queue=await createProofQueue({directory:path.join(directory,'remote-queue'),worker:createProcessWorker({proofsEnabled,bbPath,crsPath:process.env.CRS_PATH})});
 const server=createProverServer({queue,board,chainId:info.l1ChainId,rollupVersion:info.rollupVersion,proofsEnabled});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {config:{url:'http://127.0.0.1:'+server.address().port,board,chainId:info.l1ChainId,rollupVersion:info.rollupVersion},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await queue.close();}};
}
