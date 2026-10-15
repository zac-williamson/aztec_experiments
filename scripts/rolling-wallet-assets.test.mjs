import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRollingWalletConfig} from './rolling-wallet-assets.mjs';
const address=n=>'0x'+n.toString(16).padStart(64,'0'),eth=n=>'0x'+n.toString(16).padStart(40,'0');
const fixture=()=>({config:{network:{chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),ethRpcUrl:'http://127.0.0.1:8545'},
 board:{contractAddress:address(2),portalAddress:eth(3)},privateFee:{contractAddress:address(4),gasSettings:{gasLimits:{daGas:'1',l2Gas:'1'},teardownGasLimits:{daGas:'1',l2Gas:'1'},maxFeesPerGas:{feePerDaGas:'1',feePerL2Gas:'1'},maxPriorityFeesPerGas:{feePerDaGas:'0',feePerL2Gas:'0'}}}},
 trustedQuery:{url:'http://127.0.0.1:8080/v1/node',allowLocalDev:true},remoteProver:null,proofsEnabled:true});
test('public wallet config is detached, exact and scoped to the same public reader deployment',()=>{
 const v=fixture(),scope={chainId:'31337',rollupVersion:'1',rollupAddress:eth(1),boardAddress:address(2)};
 const result=validateRollingWalletConfig(v,scope);assert.deepEqual(result.connectOrigins,['http://127.0.0.1:8080','http://127.0.0.1:8545']);
 v.config.board.contractAddress=address(99);assert.equal(result.value.config.board.contractAddress,address(2));
 assert.throws(()=>validateRollingWalletConfig(v,scope));
 for(const key of ['chainId','rollupVersion','rollupAddress','boardAddress'])assert.throws(()=>validateRollingWalletConfig(fixture(),{...scope,[key]:'wrong'}));
});
test('operator capabilities, extra properties and unsafe endpoints cannot enter browser metadata or CSP',()=>{
 for(const mutate of [v=>v.token='private',v=>v.config.privateKey='private',v=>v.config.network.nodeUrl='https://ordinary.example',
  v=>v.config.board.secret='private',v=>v.trustedQuery.headers={authorization:'private'},v=>v.config.privateFee.gasSettings.gasLimits.secret='private',
  v=>v.trustedQuery.url='https://name:password@example.test/node',v=>v.trustedQuery.url='https://example.test/node?token=private',
  v=>v.trustedQuery.url='https://example.test/node#private',v=>v.trustedQuery.url="https://example.test/; script-src *",
  v=>v.config.network.ethRpcUrl='file:///private/key',v=>v.trustedQuery.url='http://192.168.1.1/node',
  v=>v.config.network.chainId='11155111',v=>v.config.network.chainId=31337,v=>v.proofsEnabled='true']){
  const v=fixture();mutate(v);assert.throws(()=>validateRollingWalletConfig(v));
 }
});
test('remote proof metadata binds board, chain, version and mode; nonlocal disabled proofs fail closed',()=>{
 const v=fixture();v.remoteProver={url:'http://127.0.0.1:8080',board:address(2),chainId:'31337',rollupVersion:'1',proofsEnabled:true};
 assert.equal(validateRollingWalletConfig(v).value.remoteProver.board,address(2));
 for(const [key,value] of Object.entries({board:address(5),chainId:'1',rollupVersion:'2',proofsEnabled:false,token:'private'})){
  const bad=structuredClone(v);bad.remoteProver[key]=value;assert.throws(()=>validateRollingWalletConfig(bad));
 }
 const remote=fixture();remote.config.network.chainId='11155111';remote.config.network.ethRpcUrl='https://ethereum.example';remote.trustedQuery={url:'https://private.example/v1/node',allowLocalDev:false};
 assert.equal(validateRollingWalletConfig(remote).value.proofsEnabled,true);remote.proofsEnabled=false;assert.throws(()=>validateRollingWalletConfig(remote));
});

test('optional Bok browser scope is exact, detached and cannot carry operator credentials',()=>{
 const v=fixture();v.config.bok={contractAddress:address(5),operatorAddress:address(6),pluginId:address(7)};
 const result=validateRollingWalletConfig(v);v.config.bok.contractAddress=address(8);assert.equal(result.value.config.bok.contractAddress,address(5));
 for(const alter of [b=>b.token='PRIVATE_SENTINEL',b=>delete b.pluginId,b=>b.contractAddress=address(0),b=>b.operatorAddress='https://private.example',b=>b.pluginId=7]){
  const current=structuredClone(result.value);alter(current.config.bok);assert.throws(()=>validateRollingWalletConfig(current));
 }
});
test('aggregate wallet metadata requires an explicit exact router/quoter scope and matching authenticated deployment',()=>{
 const v=fixture();v.config.bok={contractAddress:address(5),operatorAddress:address(6),pluginId:address(7)};
 v.config.aggregateFunding={chainId:'31337',router:eth(8),routerCodeHash:address(9),collateralPortal:v.config.board.portalAddress,feePortal:eth(10),bokPortal:eth(11),weth:eth(12),swapRouter:eth(13),feeToken:eth(14),bokToken:eth(15),privateFpc:v.config.privateFee.contractAddress,quoter:eth(16),quoterCodeHash:address(17)};
 assert.deepEqual(validateRollingWalletConfig(v).value.config.aggregateFunding,v.config.aggregateFunding);
 for(const mutate of [x=>delete x.config.bok,x=>x.config.aggregateFunding.chainId='1',x=>x.config.aggregateFunding.privateFpc=address(99),x=>x.config.aggregateFunding.collateralPortal=eth(99),x=>x.config.aggregateFunding.quoterCodeHash='',x=>x.config.aggregateFunding.secret='PRIVATE_SENTINEL']){
  const bad=structuredClone(v);mutate(bad);assert.throws(()=>validateRollingWalletConfig(bad));
 }
});

test('USDC wallet scope requires the complete pinned proxy implementation domain and trusted relayer together',()=>{
 const v=fixture();v.config.bok={contractAddress:address(5),operatorAddress:address(6),pluginId:address(7)};
 v.config.aggregateFunding={chainId:'31337',router:eth(8),routerCodeHash:address(9),collateralPortal:v.config.board.portalAddress,feePortal:eth(10),bokPortal:eth(11),weth:eth(12),swapRouter:eth(13),feeToken:eth(14),bokToken:eth(15),privateFpc:v.config.privateFee.contractAddress,quoter:eth(16),quoterCodeHash:address(17),usdcRelayAddress:eth(18),usdcCodeHash:address(19),usdcImplementation:eth(20),usdcImplementationCodeHash:address(21),usdcDomain:{name:'USDC',version:'2'}};
 assert.deepEqual(validateRollingWalletConfig(v).value.config.aggregateFunding,v.config.aggregateFunding);
 for(const key of ['usdcRelayAddress','usdcCodeHash','usdcImplementation','usdcImplementationCodeHash','usdcDomain']){const bad=structuredClone(v);delete bad.config.aggregateFunding[key];assert.throws(()=>validateRollingWalletConfig(bad));}
 const bad=structuredClone(v);bad.config.aggregateFunding.usdcDomain.endpoint='https://untrusted';assert.throws(()=>validateRollingWalletConfig(bad));
});
