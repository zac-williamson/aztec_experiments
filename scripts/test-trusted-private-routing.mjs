// Development-only browser/CLI routing tests. No network, wallet, proofs or service.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const [appSource,configSource,bootstrapSource,engineSource,cliSource,sdkSource]=await Promise.all([
 'shared/app-env.js','shared/public-app-config.js','shared/public-app-bootstrap.js','apps/src/billboard/user/engine.js','apps/src/billboard/user/cli.mjs','shared/sdk-entry.mjs'].map(read));
const settings=()=>({schemaVersion:1,network:{nodeUrl:'https://ordinary.example',ethRpcUrl:'https://eth.example',chainId:'1',rollupVersion:'1',rollupAddress:'0x'+'11'.repeat(20)},board:{portalAddress:'0x'+'22'.repeat(20),contractAddress:'0x'+'01'.repeat(32)},trustedProverNode:{url:'https://trusted.example/prover/v1/node'},remoteProver:{url:'https://proof.example/prover'}});
function browser(mode){
 let config=settings(),revision=1;
 const c=vm.createContext({URL,TextEncoder,structuredClone,_walletGeneration:0,_assertWalletLive(){},navigator:{locks:{request:async(_name,_options,run)=>run({})}}});
 c.window={walletState:{aztec:{address:'owner',secretKey:'private',salt:0},ethType:'none'},BillboardProving:{snapshot:()=>mode},BillboardReadiness:{check:async()=>{}},billboardConfigStore:{snapshot:()=>({config,revision}),subscribe(){}}};
 vm.runInContext(appSource,c);c.buildEnv=extra=>extra;
 return {c,change(){config={...config,trustedProverNode:{url:'https://second-trusted.example'}};revision++;}};
}
for(const mode of ['local','remote'])test('browser mock: '+mode+' proving retains independently configured trusted queries',async()=>{
 const {c}=browser(mode);let capture;
 const run=c.makeCallEngine(async(env,config)=>{capture=config;return {ok:true};},{});
 assert.equal((await run('status',()=>{})).ok,true);assert.equal(capture.aztecNodeUrl,'https://ordinary.example');
 assert.equal(capture.trustedProverNode.url,'https://trusted.example/prover/v1/node');assert.equal(Object.isFrozen(capture.trustedProverNode),true);
 assert.equal(capture.remoteProver?.url,mode==='remote'?'https://proof.example/prover':undefined);
 assert.equal(capture.expectedNetworkScope.rollup,settings().network.rollupAddress);
});
test('browser mock: trusted endpoint changes invalidate in-flight wallet operation',async()=>{
 const h=browser('local');const run=h.c.makeCallEngine(async()=>{h.change();return {ok:true};},{});
 await assert.rejects(run('status',()=>{}),error=>error.code==='BB_OPERATION_FAILED');
});
test('browser mock: public board navigation retains network trusted endpoint for another board',async()=>{
 const c=vm.createContext({URL,TextEncoder,document:{body:{hasAttribute:()=>true}},location:{href:'https://rolling.example/'}});vm.runInContext(configSource,c);vm.runInContext(bootstrapSource,c);
 const hosted=c.BillboardConfig.validate(settings()),other='0x'+'02'.repeat(32);c.loadHostedSettings=async()=>hosted;let received;
 c.BillboardPublic={metadata:{},browserPublicFeedStorage:()=>({}),connectPublicBoard:async input=>{received=input;return {config:{schemaVersion:1,network:input.network,board:{...hosted.board,contractAddress:input.boardAddress}}};}};
 const result=await c.loadHostedBoard('https://rolling.example/#network=1:'+hosted.network.rollupAddress+':1&board='+other);
 assert.equal(received.network.nodeUrl,'https://ordinary.example/');assert.equal(result.config.trustedProverNode.url,hosted.trustedProverNode.url);assert.equal(result.config.remoteProver,undefined);
});
test('routing helper mock: disabled proofs require explicit loopback local chain, no provider identity claims',async()=>{
 const c=vm.createContext({URL});vm.runInContext(engineSource,c);const connect=c.BillboardPrivateFeeRouting.connectTrustedPrivateNode,node={};let calls=[];
 const a={createTrustedPrivateNode:async options=>{calls.push(options);return node;},isTrustedPrivateNode:value=>value===node};
 const base={expectedNetworkScope:{chainId:'31337',version:'1',rollup:settings().network.rollupAddress},trustedProverNode:{url:'http://127.0.0.1:8081',proofs:'disabled'}};
 assert.equal(await connect(a,base),node);assert.equal(calls[0].allowLocalDev,true);assert.equal(calls[0].proofsEnabled,false);
 for(const config of [{...base,trustedProverNode:{url:'https://ordinary.example',proofs:'disabled'}},{...base,expectedNetworkScope:{...base.expectedNetworkScope,chainId:'1'}},{...base,trustedProverNode:{url:base.trustedProverNode.url,proofs:'invalid'}}])await assert.rejects(connect(a,config),{code:'BB_TRUSTED_NODE_CONFIG'});
 assert.equal(calls.length,1);
});
test('source gate: CLI ordinary node use is identity preflight; scope bound before inspectOnly',()=>{
 assert(cliSource.includes("typeof args['trusted-node-url']!=='string'"));
 assert(cliSource.indexOf("if(ACTION==='list')")<cliSource.indexOf("typeof args['trusted-node-url']!=='string'"));
 const start=cliSource.indexOf('const node = a.createAztecNodeClient(AZTEC_NODE_URL);'),end=cliSource.indexOf('if(config.inspectOnly)',start),segment=cliSource.slice(start,end);
 assert(start>0&&end>start);assert(segment.includes('config.expectedNetworkScope = { chainId, rollup, version };'));
 assert.equal((segment.match(/node\.[A-Za-z]+\(/g)||[]).join(','),'node.getNodeInfo(');
 assert(!engineSource.includes('a.createAztecNodeClient('));assert(sdkSource.includes("from './trusted-private-node.mjs'"));
});
