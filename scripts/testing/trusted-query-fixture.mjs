// TEST ONLY. C01 owns the actual node, L1, sequencer, mining and process budget.
// This consumer owns only its two ephemeral HTTP adapters and service queue.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {createConnection} from 'node:net';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROOT,assertNodeVersion,assertAztecPackages} from '../toolchain.mjs';
const silent=Object.assign(()=>{},Object.fromEntries(['trace','debug','verbose','info','warn','error','fatal'].map(k=>[k,()=>{}])));
async function portClosed(port){
  await new Promise((resolve,reject)=>{
    const socket=createConnection({host:'127.0.0.1',port});
    socket.setTimeout(2000,()=>{socket.destroy();reject(Error('Query listener cleanup unverified'));});
    socket.once('connect',()=>{socket.destroy();reject(Error('Query listener remains open'));});
    socket.once('error',e=>e.code==='ECONNREFUSED'?resolve():reject(Error('Query listener cleanup unverified')));
  });
}
async function startNodeRpc(node){
  const {createNamespacedSafeJsonRpcServer}=await import('@aztec-labs/foundation/json-rpc/server');
  const {AztecNodeApiSchema}=await import('@aztec-labs/stdlib/interfaces/client');
  const rpc=createNamespacedSafeJsonRpcServer({aztec:[node,AztecNodeApiSchema]},
    {maxBatchSize:8,maxBodySizeBytes:8*1024*1024,corsAllowedOrigins:[],log:silent});
  const callback=rpc.getApp().callback();
  const server=http.createServer((req,res)=>{
    if(req.method!=='POST'||req.url!=='/'||req.headers.origin!==undefined||!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){res.writeHead(403);res.end();return;}
    callback(req,res);
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
  catch(error){server.close();server.closeAllConnections();throw error;}
  const port=server.address().port;
  return {url:`http://127.0.0.1:${port}/`,close:async()=>{
    await new Promise((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});await portClosed(port);
  }};
}
async function sourceBinding(){
  assertNodeVersion();assertAztecPackages();
  const files=['scripts/testing/trusted-query-fixture.mjs','scripts/toolchain.mjs','toolchain.json','package-lock.json',
    'prover/service.mjs','prover/server.mjs','prover/private-query.mjs','prover/catalog.mjs','prover/queue.mjs','shared/trusted-private-node.mjs',
    'apps/src/billboard/billboard_artifact.json','apps/src/billboard/private_fee_artifact.json','plugins/adapter_artifact.json'];
  return {revision:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim(),
    hashes:Object.fromEntries(await Promise.all(files.map(async relative=>[relative,createHash('sha256').update(await fs.readFile(path.join(ROOT,relative))).digest('hex')])))};
}
export async function runTrustedQueryFixture(ctx){
  const {startProverService}=await import('../../prover/service.mjs');
  const {createTrustedPrivateNode,inspectTrustedNode}=await import('../../shared/trusted-private-node.mjs');
  return createTrustedQueryFixtureForTests({sourceBinding,startNodeRpc,createTrustedPrivateNode,inspectTrustedNode,now:Date.now,
    startService:async config=>{
      const service=await startProverService(config),port=service.address.port;
      return {url:`http://127.0.0.1:${port}`,stats:service.stats,close:async()=>{await service.close();await portClosed(port);}};
    },health:async url=>{const r=await fetch(url+'/healthz',{redirect:'error',signal:AbortSignal.timeout(30000)});assert(r.ok);return r.json();},
    save:async(directory,observation)=>fs.writeFile(path.join(directory,'trusted-query-qualification.json'),JSON.stringify(observation,null,2)+'\n',{mode:0o600})})(ctx);
}

// Explicit seam only for labelled pure-fake tests. Production entry above uses
// actual SDK/server/client implementations and never replaces their inspector.
export function createTrustedQueryFixtureForTests(deps){
  return async ctx=>{
    assert(path.isAbsolute(ctx.directory));
    const observation={schemaVersion:1,passed:false,scope:'Actual local SDK disabled-node proof-policy mismatch; separate from Linux runtime qualification',
      boardDeployed:true,proofJobScope:'parent included-board address; no proof jobs',proofModeMutated:false,proofJobs:0,checks:{},
      cleanup:{nodeRpcClosed:false,queryServiceClosed:false},publicReadiness:{},stage:'preflight'};
    let rpc,service,failure;
    const stage=async value=>{observation.stage=value;await deps.save(ctx.directory,observation);await ctx.mark?.('trusted-query-'+value);};
    const noJobs=()=>{const stats=service.stats();for(const key of ['submitted','completed','failed','jobs','bytes'])assert.equal(stats[key],0);assert.equal(stats.running,false);return {submitted:0,completed:0,failed:0,jobs:0};};
    try{
      observation.source=await deps.sourceBinding();
      const board=String(ctx.instance?.address);assert(/^0x[a-f0-9]{64}$/.test(board)&&BigInt(board)!==0n,'Parent included-board instance required');
      observation.board=board;
      const info=await ctx.node.getNodeInfo();assert.equal(info.l1ChainId,31337);assert.equal(info.realProofs,false,'Actual proofs-disabled node required');
      const scope={chainId:'31337',version:String(info.rollupVersion),rollup:String(info.l1ContractAddresses.rollupAddress).toLowerCase()};
      assert(/^[1-9][0-9]*$/.test(scope.version));assert(/^0x[a-f0-9]{40}$/.test(scope.rollup)&&BigInt(scope.rollup)!==0n);
      assert.equal(scope.rollup,String(ctx.rollupAddress).toLowerCase());
      const tips=await ctx.node.getChainTips(),anchor=tips.checkpointed.block;
      // Parent's existing included-board fixture supplies a real checkpoint.
      // This helper adds no wallet, deployment, miner or sequencer lifecycle.
      assert(Number.isSafeInteger(anchor.number)&&anchor.number>0,'Parent must prepare a genuine checkpoint before query qualification');
      const block=await ctx.node.getBlockData(anchor.number);
      assert(block&&String(block.blockHash)===String(anchor.hash));assert.equal(block.header.globalVariables.blockNumber,anchor.number);
      observation.network={...scope,actualNodeProofs:false};observation.anchor={number:anchor.number,hash:String(anchor.hash)};
      await stage('start-adapters');rpc=await deps.startNodeRpc(ctx.node);
      service=await deps.startService({host:'127.0.0.1',port:0,board,chainId:31337,rollupVersion:info.rollupVersion,
        applicationProfile:'legacy',proofs:'disabled',origins:[],threads:1,queueDirectory:ctx.directory,
        queryNode:{url:rpc.url,rollupAddress:scope.rollup,maxLagSeconds:120}});
      const options={url:service.url+'/v1/node',expectedNetworkScope:scope,proofsEnabled:false,allowLocalDev:true,maxLagSeconds:120};
      const captureReadiness=async label=>{
        const row={scope:'public node timestamp and production readiness inspector',ready:false};
        observation.publicReadiness[label]=row;
        try{
          const timestamp=await ctx.node.getSyncedL1Timestamp();
          assert(typeof timestamp==='bigint'&&timestamp>=0n&&timestamp<=BigInt(Number.MAX_SAFE_INTEGER));
          const wallTimeMs=deps.now();assert(Number.isSafeInteger(wallTimeMs)&&wallTimeMs>=0);
          Object.assign(row,{syncedL1Timestamp:String(timestamp),wallTimeMs,wallTimeSeconds:Math.floor(wallTimeMs/1000),lagSeconds:Math.floor(wallTimeMs/1000)-Number(timestamp)});
          // No nowSeconds option: production inspector uses its actual wall clock.
          const result=await deps.inspectTrustedNode(ctx.node,{expectedNetworkScope:scope,proofsEnabled:false,maxLagSeconds:120});
          assert.equal(result.ready,true);row.ready=true;
        }catch(error){
          const codes=['BB_TRUSTED_NODE_CONFIG','BB_TRUSTED_NODE_IDENTITY','BB_TRUSTED_NODE_UNAVAILABLE','BB_TRUSTED_NODE_UNSYNCED','BB_TRUSTED_NODE_STALE'];
          row.code=codes.includes(error?.code)?error.code:'UNCLASSIFIED';throw error;
        }
        await deps.save(ctx.directory,observation);
      };
      const healthy=async()=>{
        const health=await deps.health(service.url);assert.equal(health.proofs,'disabled');assert.deepEqual(health.query,{enabled:true,ready:true});
        const client=await deps.createTrustedPrivateNode(options),observed=await client.getNodeInfo();assert.equal(observed.realProofs,false);assert.equal(observed.l1ChainId,31337);
        const actual=await client.getBlockData(anchor.number);assert(actual);assert.equal(String(actual.blockHash),String(anchor.hash));assert.equal(actual.header.globalVariables.blockNumber,anchor.number);
        noJobs();return {passed:true,actualNodeProofs:false,expectedProofs:false,canonicalAnchorVerified:true};
      };
      await stage('healthy-before');await captureReadiness('beforeHttp');observation.checks.healthyBefore=await healthy();
      await stage('observed-policy-mismatch');
      let mismatch;
      try{await deps.createTrustedPrivateNode({...options,proofsEnabled:true});}
      catch(error){if(error.code!=='BB_TRUSTED_NODE_IDENTITY')throw error;mismatch=error.code;}
      assert.equal(mismatch,'BB_TRUSTED_NODE_IDENTITY','Expected observed proof-mode mismatch was accepted');
      observation.checks.mismatch={passed:true,actualNodeProofs:false,expectedProofs:true,code:'BB_TRUSTED_NODE_IDENTITY'};
      await stage('healthy-after');observation.checks.healthyAfter=await healthy();await captureReadiness('afterHttp');observation.jobs=noJobs();
      assert.deepEqual(await deps.sourceBinding(),observation.source,'Qualification source changed');
      observation.passed=true;observation.stage='complete';
    }catch(error){failure=error;observation.passed=false;}
    finally{
      const cleanupErrors=[];
      if(service)try{await service.close();observation.cleanup.queryServiceClosed=true;}catch(error){cleanupErrors.push(error);}
      if(rpc)try{await rpc.close();observation.cleanup.nodeRpcClosed=true;}catch(error){cleanupErrors.push(error);}
      if(cleanupErrors.length){observation.passed=false;observation.stage='cleanup';failure=failure?new AggregateError([failure,...cleanupErrors],'Query qualification and cleanup failed'):new AggregateError(cleanupErrors,'Query qualification cleanup failed');}
      try{await deps.save(ctx.directory,observation);}catch(error){failure=failure?new AggregateError([failure,error],'Query qualification evidence failed'):error;observation.passed=false;}
    }
    if(failure){if(typeof failure==='object'&&failure!==null)failure.trustedQueryObservation=observation;throw failure;}
    return observation;
  };
}
