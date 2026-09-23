import {mentions,handleField,packText} from '../plugins/protocol.mjs';
import {prepareInvocation} from '../plugins/client.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const source=fs.readFileSync(new URL('../shared/application.js',import.meta.url),'utf8');
function fixture(kind='author') {
 let configuration=0,fail=false,result={state:'postable'},subscriber;
 const calls=[],state={aztec:{address:{toString:()=> '1'},secretKey:'private',salt:'salt',raw:{secretKey:'private'}}};
 const ctx={window:{BillboardPlugins:{mentions:()=>[]},walletState:state,billboardConfigStore:{subscribe:f=>subscriber=f},__aztec:{NO_FROM:0},BillboardPublic:{readFeed:async()=>({posts:[]})}},
  BILLBOARD_ARTIFACT:{},PORTAL_BYTECODE:'',BILLBOARD_PRIVATE_FEE_ARTIFACT:{},_getConfigRevision:()=>configuration,_getPublicConfig:()=>({board:{portalAddress:'portal'},network:{}}),_walletGeneration:0,
  _assertWalletLive:()=>{if(state.invalidated)throw Error('invalidated');},_invalidateWalletContext:()=>state.invalidated=true,
  makeClaimSecretStore:()=>({}),extractInt:v=>v,readBillboardDepositInfo:async()=>({amount:1n,depositChainId:2n}),getL2Timestamp:async()=>100,
  makeCallEngine:()=>async(action,progress,input)=>{calls.push({action,input});progress('Working','info');if(fail)throw Error('failed');return result;}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 return {api:ctx.createBillboardApplication({kind}),ctx,calls,state,setResult:r=>result=r,fail:()=>fail=true,change:()=>{configuration++;subscriber();}};
}
test('interface hides SDK objects and owns acknowledgements and withdrawal state',async()=>{
 const f=fixture();const privateHandles={wallet:{secretKey:'private'}};
 f.setResult({state:'postable',handles:privateHandles,receipt:{sdk:true},lastL2TxHash:'tx',lastEthereumTxHash:'eth',withdrawTxHash:'withdraw'});
 const messages=[],data=await f.api.run('status',{},(...args)=>messages.push(args));
 assert(!('handles'in data));assert(!('receipt'in data));assert.deepEqual(messages,[['Working','info']]);
 await f.api.run('post',{message:'hello'});assert.equal(f.calls[1].input.acknowledgeTx,'tx');assert.equal(f.calls[1].input.acknowledgeEthereumTx,'eth');assert.equal(f.calls[1].input.withdrawTxHash,'withdraw');
 assert.equal(f.api.connected,true);f.change();assert.equal(f.api.connected,false);
 f.setResult({});await f.api.run('status');assert.equal(f.calls[2].input.acknowledgeTx,undefined);
});
test('failed operations do not acknowledge a new transaction',async()=>{
 const f=fixture();f.setResult({lastL2TxHash:'confirmed'});await f.api.run('post');f.fail();await assert.rejects(f.api.run('post'));assert.equal(f.calls[1].input.acknowledgeTx,'confirmed');
});
test('public feed remains readable after wallet disconnect',async()=>{const f=fixture();f.state.invalidated=true;assert.equal((await f.api.readFeed()).posts.length,0);});
test('reads expose deposit values and chain time without a node or contract',async()=>{
 const f=fixture();f.setResult({handles:{contract:{},address:'1'}});await f.api.run('status');
 const info=await f.api.readDeposit();assert.equal(info.chainTime,100);assert.equal(info.depositChainId,2n);assert(!('contract'in info));
});
test('account and application modules do not read DOM; transaction pages do not use private handles',()=>{
 const account=fs.readFileSync(new URL('../shared/account.js',import.meta.url),'utf8');assert.doesNotMatch(account,/document\./);assert.doesNotMatch(source,/document\./);
 for(const path of ['billboard/user','billboard/censor','fee-juice']){const ui=fs.readFileSync(new URL('../apps/src/'+path+'/app.js',import.meta.url),'utf8');assert.doesNotMatch(ui,/walletState|\.contract\.methods|\.handles|journalAcknowledgements|ethereumAcknowledgements/);}
 const env=fs.readFileSync(new URL('../shared/app-env.js',import.meta.url),'utf8');assert.doesNotMatch(env,/getElementById\('deploymentManifest'\)/);
});

test('public JSDoc interfaces typecheck with the lockfile compiler',()=>{
 execFileSync(process.execPath,[createRequire(import.meta.url).resolve('typescript/bin/tsc'),'--allowJs','--checkJs','--noImplicitAny','false','--noEmit','--skipLibCheck','--target','es2022','--types','node','shared/application.js','shared/account.js','scripts/application-type-environment.d.ts'],{cwd:fileURLToPath(new URL('../',import.meta.url)),timeout:10000,stdio:'pipe'});
});

test('an operation completed after a configuration change cannot acknowledge its result',async()=>{
 const f=fixture();let release;const gate=new Promise(resolve=>release=resolve);
 f.ctx.makeCallEngine=()=>async()=>{await gate;return {lastL2TxHash:'stale',handles:{}};};
 const api=f.ctx.createBillboardApplication({kind:'author'});const pending=api.run('post');f.change();release();
 await assert.rejects(pending,/configuration changed/);assert.equal(api.connected,false);
});

test('deployment settings export uses the captured manifest, never a later edited one',async()=>{
 const f=fixture('deploy');f.ctx.window.BillboardConfig={validate:value=>value};
 const api=f.ctx.createBillboardApplication({kind:'deploy',deploymentConfig:()=>{throw Error('Later edited manifest must not be read');}});
 const network={nodeUrl:'old-node',ethRpcUrl:'old-eth',chainId:'1',rollupVersion:'5',rollup:'old-rollup'};
 const config=await api.publicConfiguration({portalAddr:'0xABC',l2Addr:'0xDEF'},null,{network});
 assert.equal(config.network.nodeUrl,'old-node');assert.equal(config.network.rollupAddress,'old-rollup');assert.equal(config.board.contractAddress,'0xdef');
});

test('posting adapter connects portable plugin APIs without exposing private handles',async()=>{
 const f=fixture(),values=new Map(),id='0x'+'1'.padStart(64,'0'),receiver='0x'+'2'.padStart(64,'0');
 const scope={chainId:'31337',rollupVersion:'1',rollupAddress:'0x'+'12'.repeat(20),boardAddress:id};
 const descriptor={protocol:'billboard-plugin/v2',scope:{...scope,receiver},description:'bok',funding:{protocol:'aztec-escrow-usdc/v1',portalAddress:'0x'+'34'.repeat(20),tokenAddress:'0x'+'56'.repeat(20)}};
 f.ctx._getPublicConfig=()=>({network:scope,board:{contractAddress:id}});
 f.ctx.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 f.ctx.getBrowserSigner=async()=>({provider:'wallet'});f.ctx.window.__aztec.Fr={fromString:x=>x};
 const url=packText('https://example.test/descriptor',8);
 f.setResult({handles:{address:id,contract:{methods:{get_plugin:handle=>{assert.equal(handle,handleField('bok'));return {simulate:async()=>({result:[receiver,true,url.fields,url.length]})};}}}}});
 await f.api.run('status');f.setResult({postId:id,lastL2TxHash:'post-tx'});
 f.ctx.getBrowserSigner=async()=>{throw Error('Posting must not request an Ethereum signature');};
 f.ctx.window.BillboardPlugins={mentions,prepareInvocation:args=>prepareInvocation({...args,loadDescriptor:async()=>descriptor})};
 const result=await f.api.run('post',{message:'@bok help'});
 assert.equal(f.calls.at(-1).input.pluginHandle,handleField('bok'));assert.equal(values.size,0);assert.equal(result.postId,id);assert(!('handles' in result));
});
