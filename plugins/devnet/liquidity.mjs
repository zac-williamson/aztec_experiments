// Genuine local-only liquidity dependencies. Public artifacts are prepared before
// service startup; no downloaded package scripts or untrusted commands execute.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {Contract,ContractFactory,Wallet,Transaction,Interface,keccak256,getCreateAddress,encodeBytes32String,TypedDataEncoder} from 'ethers';
import {fileState,onceAztecOperation,reconcileRollingEthereum,matchRollingEthereumSigned} from '../operations.mjs';
const require=createRequire(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const liquidityPins=Object.freeze({"circleCommit":"fc85788bc7c23cefe3df1a757133048bfddadeaa","circleArchiveSha256":"df0162e9e09c0bd08f8f9ea70b3dd0a95954cbc1ba95a61f9dd1b705b369ebf9","circleSources":{"@openzeppelin/contracts/math/SafeMath.sol":"4a04d0a20a19e3ef1dcabae9cad9ba006430a4e7eec4d9b519db87999722c98a","@openzeppelin/contracts/token/ERC20/IERC20.sol":"0573c2961569aa4906845d0cd428b5b7394956170054ceeaa8f8af96cd44875c","@openzeppelin/contracts/token/ERC20/SafeERC20.sol":"eea796f96939e7dd6119de00941717ce5772d8a942b184f5e48d2b962d0ab655","@openzeppelin/contracts/utils/Address.sol":"11ad5e3e21434e00c4ceba1f5a977b7a68bdd7d16b849276ce4ff4495129eec7","contracts/interface/IERC1271.sol":"90706e1c5c0164828819bc991154da862569b6040d1a4836538b0fff44dc1c3e","contracts/minting/Controller.sol":"ac98c81a4997b0ae5c0ef84a480174c93df1bb8fad0aa817e539dd58bf3c3bf7","contracts/minting/MasterMinter.sol":"d905a13a909c2f7ec37fc398c490b765977d726fe7206f0db6e50d247e2bc972","contracts/minting/MintController.sol":"311d489760ba230cafe17be7ab16232e9edeb2e127ea3adf7971ca1ee8eeb109","contracts/minting/MinterManagementInterface.sol":"73ff178bccd7a1430d065479765058a1983c2962b45f0bd32ad69fd82178ca0e","contracts/upgradeability/AdminUpgradeabilityProxy.sol":"d6dc1555e31406e06a5953ea7eab6e688d2ead1ebb5b9a344d55354123c36bc4","contracts/upgradeability/Proxy.sol":"d632b4eee21c950d0a39e7727baf3586a1c681f576267c34c72bd7b9d4c353bf","contracts/upgradeability/UpgradeabilityProxy.sol":"51f3c781cbe1c6556a0c4b795046f5cd12e69b465631f6e85f239f0bf7443036","contracts/util/ECRecover.sol":"7757042c1411869fef5d590a624afb29fbe205dfe2f56dcc22c8db4dd7f635dc","contracts/util/EIP712.sol":"1fb1f03d1631f442e2ba005fe5289f00b93be7cc49022078069969273dfc4def","contracts/util/MessageHashUtils.sol":"c515584f13890da8fd49c4a8d364f11c7dd82c3321df1563064d947ad8374b2b","contracts/util/SignatureChecker.sol":"908c403abbf2ddeaad3005e8a80f75d96abfa546a59f53ee97c18b80fe336afe","contracts/v1.1/FiatTokenV1_1.sol":"f69c5a0b774b213eaead9641a2d5a40d6bb459207a3b2b8cf580bc2622a50ffc","contracts/v1.1/Rescuable.sol":"dcbfd372225bef5d8b4e76cea28bf172260a0eb85eeda666b0447e37123e100c","contracts/v1/AbstractFiatTokenV1.sol":"b24c578f4d3994cf734986b43e973c825ca553ceb084adf957bb86c4b9767dbc","contracts/v1/Blacklistable.sol":"c788c40515a7255735bae06bebe0025af70a3713097bcc10293bd263f098ba90","contracts/v1/FiatTokenProxy.sol":"73d8c4146e057604868713c8acd4e19bec97d0b7cc1cedba423b075c66809be5","contracts/v1/FiatTokenV1.sol":"423a0c805f7bfff28c89432f671a38d19717fb4b6c3e5591fa46d5d4b04f2c21","contracts/v1/Ownable.sol":"75f378c6a232f5cc85f2a46b5b2296c14bcbdf864114c3fee3996102e93aa946","contracts/v1/Pausable.sol":"3aac2a3b16249fdfe82357649fb5ad2bd5887cb521b59f0833851457a8e845b8","contracts/v2/AbstractFiatTokenV2.sol":"c59e30154c8747ffc496707ca8b81ec8d0c1b3496ea9155d9baa9243ed48c6c0","contracts/v2/EIP2612.sol":"eb2460cf7b348afc3e922757b31c85a92cca03871579cabbf62941cd6e4b8304","contracts/v2/EIP3009.sol":"2da3daad1073a9fd5984522fa635c7a175e6acf07631f4ab0fb787c54595ce55","contracts/v2/EIP712Domain.sol":"15a9941af7b307e0755ce3f37bbb7c4f0b204b9496005fd45ec9705f44c1b9c1","contracts/v2/FiatTokenV2.sol":"e50ea04584155d83d326b4dcdfe9668fc29d4d351f0f9ba87bd49897bede8af8","contracts/v2/FiatTokenV2_1.sol":"ec3a38d994c9880e318cfa5543f0b7847f77e197d67e7164c9a0313006e8b1eb","contracts/v2/FiatTokenV2_2.sol":"d1f045f392042e4e8ac04d4c53a8e6d2f599085025a6ff979252bc9783b3fc3a"},"compilerSha256":"3e1956c550ca48e289044c7c0bd892403081b4b5e17e77ce707c815ce6c4228f","packages":[{"package":"@uniswap/v3-core","version":"1.0.1","integrity":"sha512-7pVk4hEm00j9tc71Y9+ssYpO6ytkeI0y7WE9P6UcmNzhxPePwyAxImuhVsTqWK9YFvzgtvzJHi64pBl4jUzKMQ==","artifacts":[{"path":"package/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json","sha256":"599479f60ebb056804aff7b2d05bdd0830ddbb1fdfaa0b6c62c02294ca7188b0","constructor":[{"inputs":[],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":24939},{"path":"package/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json","sha256":"204fb2fa7ad1a639b1df5601f035f9924b064b721b97adf60c7d5d4712643e34","constructor":[{"inputs":[],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":22728}]},{"package":"@uniswap/v3-periphery","version":"1.4.4","integrity":"sha512-S4+m+wh8HbWSO3DKk4LwUCPZJTpCugIsHrWR86m/OrUyvSqGDTXKFfc2sMuGXCZrD1ZqO3rhQsKgdWg3Hbb2Kw==","artifacts":[{"path":"package/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json","sha256":"bb4f9f1ca393293831e73db52c5425cc336b49dbda2cd9cd2708c4c885221675","constructor":[{"inputs":[{"internalType":"address","name":"_factory","type":"address"},{"internalType":"address","name":"_WETH9","type":"address"},{"internalType":"address","name":"_tokenDescriptor_","type":"address"}],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":25321},{"path":"package/artifacts/contracts/NonfungibleTokenPositionDescriptor.sol/NonfungibleTokenPositionDescriptor.json","sha256":"8f95d18a9ba03723534d5683d79672c5970433821b4b0e2795a55e217bf51a86","constructor":[{"inputs":[{"internalType":"address","name":"_WETH9","type":"address"},{"internalType":"bytes32","name":"_nativeCurrencyLabelBytes","type":"bytes32"}],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{"contracts/libraries/NFTDescriptor.sol":{"NFTDescriptor":[{"length":20,"start":1681}]}},"bytecodeBytes":5504},{"path":"package/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json","sha256":"9d0b8700b8b144aced9b5dd95bce4a68e03eb9a809eac53ac2e3ce739cc7d289","constructor":[{"inputs":[{"internalType":"address","name":"_factory","type":"address"},{"internalType":"address","name":"_WETH9","type":"address"}],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":8492},{"path":"package/artifacts/contracts/libraries/NFTDescriptor.sol/NFTDescriptor.json","sha256":"fbea8e331a38c954ae3ae016f06d3dcdcd747e63dd9e494096899b008ce2ab33","constructor":[],"linkReferences":{},"bytecodeBytes":24579}]},{"package":"@uniswap/swap-router-contracts","version":"1.3.1","integrity":"sha512-mh/YNbwKb7Mut96VuEtL+Z5bRe0xVIbjjiryn+iMMrK2sFKhR4duk/86mEz0UO5gSx4pQIw9G5276P5heY/7Rg==","artifacts":[{"path":"package/artifacts/contracts/lens/QuoterV2.sol/QuoterV2.json","sha256":"9d0b8700b8b144aced9b5dd95bce4a68e03eb9a809eac53ac2e3ce739cc7d289","constructor":[{"inputs":[{"internalType":"address","name":"_factory","type":"address"},{"internalType":"address","name":"_WETH9","type":"address"}],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":8492},{"path":"package/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json","sha256":"210a7bf29f26de9f45d35dac1214943eca41c3a002007dd6a0e1aa870bf2d2d1","constructor":[{"inputs":[{"internalType":"address","name":"_factoryV2","type":"address"},{"internalType":"address","name":"factoryV3","type":"address"},{"internalType":"address","name":"_positionManager","type":"address"},{"internalType":"address","name":"_WETH9","type":"address"}],"stateMutability":"nonpayable","type":"constructor"}],"linkReferences":{},"bytecodeBytes":24885}]},{"package":"@uniswap/v2-periphery","version":"1.1.0-beta.0","integrity":"sha512-6dkwAMKza8nzqYiXEr2D86dgW3TTavUvCR0w2Tu33bAbM8Ah43LKAzH7oKKPRT5VJQaMi1jtkGs1E8JPor1n5g==","artifacts":[{"path":"package/build/WETH9.json","sha256":"ba02494a1f4d2ca3873f74969d4ff57fc885f37b856486605afa214e4155d18d","constructor":[],"linkReferences":null,"bytecodeBytes":2518}]}]});
// Measured official compile/package output; corruption fails before any signer is used.
export const preparedLiquiditySha256='dbdb4aa0db4de4a11b0ac53d3b756b007a6b614b7d568e644310793163de7d21';
const circleTargets={SignatureChecker:'contracts/util/SignatureChecker.sol',FiatTokenV2_2:'contracts/v2/FiatTokenV2_2.sol',FiatTokenProxy:'contracts/v1/FiatTokenProxy.sol',MasterMinter:'contracts/minting/MasterMinter.sol'};
async function exactBytes(filename,expected){const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||st.size>32*1024**2)throw Error('Liquidity artifact type/size differs');const bytes=await fs.readFile(filename);if(sha(bytes)!==expected)throw Error('Liquidity artifact pin differs');return bytes;}
export function linkLiquidityBytecode(artifact,addresses){
 let code=artifact.bytecode.startsWith('0x')?artifact.bytecode.slice(2):artifact.bytecode;const used=new Set();
 for(const libraries of Object.values(artifact.linkReferences??{}))for(const [name,refs]of Object.entries(libraries)){
  const address=addresses[name];if(!/^0x[0-9a-f]{40}$/.test(address??''))throw Error('Pinned library address unavailable');
  for(const ref of refs){if(ref.length!==20||!Number.isSafeInteger(ref.start)||ref.start<0||ref.start*2+40>code.length)throw Error('Invalid library reference');for(let i=ref.start;i<ref.start+20;i++){if(used.has(i))throw Error('Overlapping library references');used.add(i);}code=code.slice(0,ref.start*2)+address.slice(2)+code.slice(ref.start*2+40);}
 }
 if(!/^(?:[0-9a-f]{2})+$/i.test(code))throw Error('Unresolved linked bytecode');return '0x'+code;
}
export function localPoolPrice(tokenA,tokenB,amountA,amountB){
 if(!/^0x[0-9a-f]{40}$/.test(tokenA)||!/^0x[0-9a-f]{40}$/.test(tokenB)||tokenA===tokenB||typeof amountA!=='bigint'||typeof amountB!=='bigint'||amountA<=0n||amountB<=0n)throw Error('Invalid development pool inventory');
 const forward=BigInt(tokenA)<BigInt(tokenB),amount0=forward?amountA:amountB,amount1=forward?amountB:amountA,n=(amount1<<192n)/amount0;
 let x=n,y=(x+1n)/2n;while(y<x){x=y;y=(x+n/x)/2n;}
 if(x<=4295128739n||x>=1461446703485210103287273052203988822378723970342n)throw Error('Development pool price outside V3 range');
 return {token0:forward?tokenA:tokenB,token1:forward?tokenB:tokenA,amount0,amount1,sqrtPriceX96:x};
}
async function packageRoot(name,version,dependencyRoot){const resolver=dependencyRoot?createRequire(path.join(dependencyRoot,'package.json')):require;const filename=resolver.resolve(name+'/package.json'),p=JSON.parse(await fs.readFile(filename,'utf8'));if(p.version!==version)throw Error('Liquidity package version differs');return path.dirname(filename);}
export async function prepareLiquidityArtifacts({directory=path.resolve('.build/local-liquidity'),dependencyRoot=path.resolve('.')}={}){
 await fs.mkdir(directory,{recursive:true,mode:0o700});if(await fs.realpath(directory)!==directory)throw Error('Liquidity cache must be canonical');
 const artifacts={};
 for(const p of liquidityPins.packages){const root=await packageRoot(p.package,p.version,dependencyRoot);for(const item of p.artifacts){const bytes=await exactBytes(path.join(root,item.path.replace(/^package\//,'')),item.sha256),a=JSON.parse(bytes);if(a.contractName==='UniswapV3Pool')continue;const name=a.contractName??'WETH9';artifacts[name]={abi:a.abi,bytecode:a.bytecode??a.evm?.bytecode?.object,linkReferences:a.linkReferences??{},sourceSha256:item.sha256};}}
 const archive=path.join(directory,'circle-source.tgz');let raw;
 try{raw=await exactBytes(archive,liquidityPins.circleArchiveSha256);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch('https://codeload.github.com/circlefin/stablecoin-evm/tar.gz/'+liquidityPins.circleCommit,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});if(response.status!==200)throw Error('Pinned Circle source unavailable');const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16*1024**2)throw Error('Circle source download limit');parts.push(Buffer.from(value));}}finally{await reader.cancel();}raw=Buffer.concat(parts);if(sha(raw)!==liquidityPins.circleArchiveSha256)throw Error('Circle source pin differs');await fs.writeFile(archive,raw,{flag:'wx',mode:0o600});}
 const oz=await packageRoot('circle-openzeppelin','3.4.2',dependencyRoot),compiler=await packageRoot('circle-solc','0.6.12',dependencyRoot);await exactBytes(path.join(compiler,'soljson.js'),liquidityPins.compilerSha256);
 const sources={};for(const [name,expected]of Object.entries(liquidityPins.circleSources)){
  const bytes=name.startsWith('@openzeppelin/contracts/')?await fs.readFile(path.join(oz,name.slice('@openzeppelin/contracts/'.length))):execFileSync('/usr/bin/tar',['-xOf',archive,'stablecoin-evm-'+liquidityPins.circleCommit+'/'+name],{maxBuffer:1024**2,timeout:5000,env:{PATH:'/usr/bin:/bin'}});
  if(sha(bytes)!==expected)throw Error('Circle dependency source differs');sources[name]={content:bytes.toString('utf8')};
 }
 const input={language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:10000000},evmVersion:'istanbul',metadata:{bytecodeHash:'ipfs'},outputSelection:{'*':{'*':['abi','evm.bytecode','evm.deployedBytecode']}}}};
 const inputPath=path.join(directory,'circle-input.json'),outputPath=path.join(directory,'circle-output.json');await fs.writeFile(inputPath,JSON.stringify(input),{mode:0o600});
 const child=spawn(process.execPath,['--max-old-space-size=768',fileURLToPath(import.meta.url),'--compile-circle',inputPath,outputPath,dependencyRoot],{env:{PATH:'/usr/bin:/bin',HOME:directory,TMPDIR:directory},stdio:['ignore','ignore','ignore']});
 let expired=false;const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},60000);try{const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(code!==0||expired)throw Error('Circle compiler failed or exceeded 60 seconds');}finally{clearTimeout(timer);}
 const output=JSON.parse(await fs.readFile(outputPath,'utf8'));if(output.errors?.some(x=>x.severity==='error'))throw Error('Official Circle source did not compile');
 for(const [name,source]of Object.entries(circleTargets)){const c=output.contracts?.[source]?.[name];if(!c?.evm?.bytecode?.object)throw Error('Circle compiler output incomplete');artifacts[name]={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,linkReferences:c.evm.bytecode.linkReferences,sourceSha256:sha(JSON.stringify(input))};}
 const result={schemaVersion:1,pinsSha256:sha(JSON.stringify(liquidityPins)),compilerInputSha256:sha(JSON.stringify(input)),artifacts};
 if(sha(JSON.stringify(result)+'\n')!==preparedLiquiditySha256)throw Error('Reproduced liquidity artifact bytes differ');
 await fs.writeFile(path.join(directory,'artifacts.json'),JSON.stringify(result)+'\n',{mode:0o600});return {artifactCount:Object.keys(artifacts).length,inputSha256:result.compilerInputSha256,outputSha256:sha(JSON.stringify(result)+'\n')};
}
export async function readLiquidityArtifacts(directory=path.resolve('.build/local-liquidity')){const r=JSON.parse(await exactBytes(path.join(directory,'artifacts.json'),preparedLiquiditySha256));if(r.schemaVersion!==1||r.pinsSha256!==sha(JSON.stringify(liquidityPins))||Object.keys(r.artifacts??{}).length!==11)throw Error('Prepared genuine liquidity artifacts unavailable');return r.artifacts;}
export async function readFundingRouterArtifact(root=path.resolve('.')) {
 const {checkArtifacts}=await import('../../scripts/check-artifacts.mjs');checkArtifacts(root);
 const manifest=JSON.parse(await fs.readFile(path.join(root,'.build/contracts-manifest.json'),'utf8'));
 if(!/^[a-f0-9]{64}$/.test(manifest.fundingRouter??''))throw Error('Normal funding router output binding missing');
 const artifact=JSON.parse(await exactBytes(path.join(root,'billboard/portal/out/RollingFundingRouter.sol/RollingFundingRouter.json'),manifest.fundingRouter));
 const metadata=typeof artifact.metadata==='string'?JSON.parse(artifact.metadata):artifact.metadata;
 if(metadata?.sources?.['src/RollingFundingRouter.sol']?.keccak256!==keccak256(await fs.readFile(path.join(root,'billboard/portal/src/RollingFundingRouter.sol'))))throw Error('Funding router source provenance differs');
 return artifact;
}
const zero='0x'+'0'.repeat(40),dead='0x'+'0'.repeat(39)+'1';
const abiToken=['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)','function decimals() view returns(uint8)'];
/** One private file per fixed stage reuses the existing signed-once state machine.
 * An unresolved write/send is terminal to this startup, never a permission to send.
 */
async function liquidityProgress(directory,identity){
 const filename=path.join(directory,'progress.json');let exists=true;try{await fs.access(filename);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
 const store=await fileState(filename);let p=store.read();
 if(!exists){if((await fs.readdir(directory)).some(n=>!['scope.json','circle-admin.json'].includes(n)))throw Error('Original liquidity progress missing');p={schemaVersion:1,identity,entered:[]};await store.write(p);}
 if(p.schemaVersion!==1||p.identity!==identity||!Array.isArray(p.entered)||p.entered.length>100||new Set(p.entered).size!==p.entered.length)throw Error('Liquidity progress scope mismatch');
 for(const name of p.entered){
  if(!/^[a-z][a-z0-9-]{0,79}$/.test(name))throw Error('Invalid retained liquidity stage');
  let r;try{const f=path.join(directory,name+'.json'),st=await fs.lstat(f);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.size>16*1024**2)throw Error();r=JSON.parse(await fs.readFile(f,'utf8'));}catch{throw Error('Original entered liquidity stage missing or invalid');}
  const operation=r.operations?.['relay-funding'];let binding;try{binding=JSON.parse(operation.identity);}catch{throw Error('Original liquidity operation missing');}
  if(operation.schemaVersion!==1||operation.policy!=='reconcile-only'||binding.identity!==identity||binding.name!==name)throw Error('Original liquidity operation scope differs');
 }
 return {store,p};
}
export async function liquidityStage({directory,name,identity,provider,signer,transaction,effect,timeoutMs=30000}){
 if(typeof identity!=='string'||identity.length>65536||['scope','progress','circle-admin','relay-signer','relay-policy'].includes(name)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!/^[a-z][a-z0-9-]{0,79}$/.test(name)||String((await provider.getNetwork()).chainId)!=='31337')throw Error('Invalid local liquidity stage');
 const {store:progress,p}=await liquidityProgress(directory,identity);
 if(!p.entered.includes(name)){try{await fs.access(path.join(directory,name+'.json'));throw Error('Untracked liquidity stage retained');}catch(e){if(e.code!=='ENOENT')throw e;}await progress.write({...p,entered:[...p.entered,name]});}
 const store=await fileState(path.join(directory,name+'.json')),from=signer.address.toLowerCase(),to=transaction.to?.toLowerCase()??null,data=(transaction.data??'0x').toLowerCase(),value=BigInt(transaction.value??0);
 const binding=JSON.stringify({kind:'local-liquidity-v1',identity,name,from,to,data,value:String(value)});
 let reconciledReceipt;
 const reconcile=record=>reconcileRollingEthereum({record,development:true,reads:{
  signed:async r=>{if(value===0n)return matchRollingEthereumSigned({parse:Transaction.from,record:r,chainId:'31337',from,nonce:r.deployment?.nonce,to,data});try{const t=Transaction.from('0x'+r.raw);return t.hash===r.hash&&t.chainId===31337n&&t.from.toLowerCase()===from&&t.nonce===r.deployment.nonce&&(t.to?.toLowerCase()??null)===to&&t.data===data&&t.value===value;}catch{return false;}},
  receipt:async h=>(reconciledReceipt=await provider.getTransactionReceipt(h)),block:n=>provider.getBlock(n),head:tag=>provider.getBlock(tag),effect:async(record,anchor,receipt)=>{
   if(to===null&&receipt.contractAddress?.toLowerCase()!==getCreateAddress({from,nonce:record.deployment.nonce}).toLowerCase())return false;
   return await effect(receipt,anchor);
  },
 }});
 const execute=()=>onceAztecOperation({store,name:'relay-funding',identity:binding,scope:'local-liquidity',reconcile,execute:async({bindDeployment,submit})=>{
  const populated=await signer.populateTransaction(transaction);if(populated.chainId!==31337n)throw Error('Local chain differs');await bindDeployment({from,nonce:populated.nonce});
  const raw=await signer.signTransaction(populated);await submit({hash:keccak256(raw),raw:raw.slice(2)},()=>provider.broadcastTransaction(raw));
 }});
 const deadline=Date.now()+timeoutMs;let result;
 do{result=await execute();if(result.status==='succeeded'){if(reconciledReceipt?.hash!==result.transactionHash||reconciledReceipt.blockNumber!==result.blockNumber||reconciledReceipt.blockHash!==result.blockHash)throw Error('Canonical liquidity receipt changed');return reconciledReceipt;}if(result.status!=='unresolved'||Date.now()>=deadline)throw Error('Local liquidity stage requires original transaction reconciliation');await pause(250);}while(true);
}
async function localContext({directory,provider,signer,artifacts,scope}){
 if(String((await provider.getNetwork()).chainId)!=='31337'||!scope?.rollupAddress)throw Error('Local liquidity network unavailable');
 const url=provider._getConnection().url,u=new URL(url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search)throw Error('Local liquidity requires loopback');
 await fs.mkdir(directory,{recursive:true,mode:0o700});const st=await fs.lstat(directory);if(st.isSymbolicLink()||await fs.realpath(directory)!==directory||(st.mode&0o777)!==0o700||st.uid!==process.getuid())throw Error('Private liquidity directory required');
 const identity=JSON.stringify({scope,artifactsSha256:sha(JSON.stringify(artifacts))}),manifestPath=path.join(directory,'scope.json');
 try{if(await fs.readFile(manifestPath,'utf8')!==identity+'\n')throw Error('Retained liquidity scope differs');}catch(e){if(e.code!=='ENOENT')throw e;if((await fs.readdir(directory)).length)throw Error('Original liquidity scope missing');await fs.writeFile(manifestPath,identity+'\n',{flag:'wx',mode:0o600});await (await fileState(path.join(directory,'progress.json'))).write({schemaVersion:1,identity,entered:[]});}
 try{await fs.access(path.join(directory,'progress.json'));}catch{throw Error('Original liquidity progress missing');}
 await liquidityProgress(directory,identity);
 const stage=(name,transaction,effect)=>liquidityStage({directory,name,identity,provider,signer,transaction,effect});
 const deploy=async(name,artifact,args=[],libraries={})=>{
  const factory=new ContractFactory(artifact.abi,linkLiquidityBytecode(artifact,libraries));const tx=await factory.getDeployTransaction(...args);
  const receipt=await stage(name,tx,async(r,a)=>{const code=await provider.getCode(r.contractAddress,a.number);return code!=='0x'&&code===await provider.getCode(r.contractAddress);});
  return new Contract(receipt.contractAddress,artifact.abi,provider);
 };
 const call=async(name,contract,method,args,effect=async()=>true,value=0n)=>stage(name,{to:await contract.getAddress(),data:contract.interface.encodeFunctionData(method,args),value},async(r,a)=>{
  const original=await provider.getCode(await contract.getAddress(),a.number);return original!=='0x'&&original===await provider.getCode(await contract.getAddress())&&await effect(r,a);
 });
 return {deploy,call,stage,identity};
}
/** Actual Circle FiatTokenV2_2, separately administered proxy, capped local mint.
 * No DevUSDC substitution, no faucet issuance represented as user conversion.
 */
export async function deployCircleInventory(args){
 const {directory,provider,signer,artifacts}=args,{deploy,call}=await localContext(args),owner=signer.address.toLowerCase();
 const adminFile=path.join(directory,'circle-admin.json');let admin;
 try{const st=await fs.lstat(adminFile);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))throw Error('Private Circle administrator required');admin=JSON.parse(await fs.readFile(adminFile,'utf8'));if(new Wallet(admin.privateKey).address.toLowerCase()!==admin.address||admin.address===owner)throw Error('Circle administrator identity differs');}
 catch(e){if(e.code!=='ENOENT')throw e;if((await fs.readdir(directory)).some(n=>!['scope.json','progress.json'].includes(n)))throw Error('Original Circle administrator missing');const w=Wallet.createRandom();admin={address:w.address.toLowerCase(),privateKey:w.privateKey};await fs.writeFile(adminFile,JSON.stringify(admin)+'\n',{flag:'wx',mode:0o600});}
 const checker=await deploy('circle-signature-checker',artifacts.SignatureChecker),impl=await deploy('circle-implementation',artifacts.FiatTokenV2_2,[],{SignatureChecker:(await checker.getAddress()).toLowerCase()});
 await call('circle-lock-v1',impl,'initialize',['','','',0,dead,dead,dead,dead]);await call('circle-lock-v2',impl,'initializeV2',['']);await call('circle-lock-v21',impl,'initializeV2_1',[dead]);await call('circle-lock-v22',impl,'initializeV2_2',[[],'']);
 const proxy=await deploy('circle-proxy',artifacts.FiatTokenProxy,[await impl.getAddress()]),tokenAddress=(await proxy.getAddress()).toLowerCase(),master=await deploy('circle-master-minter',artifacts.MasterMinter,[tokenAddress]);
 // Deployment transaction already makes this actor MasterMinter owner.
 if((await master.owner()).toLowerCase()!==owner)throw Error('Circle master-minter owner differs');
 await call('circle-proxy-admin',proxy,'changeAdmin',[admin.address],async(_r,a)=>(await proxy.admin({from:admin.address,blockTag:a.number})).toLowerCase()===admin.address);
 const token=new Contract(tokenAddress,artifacts.FiatTokenV2_2.abi,provider);
 await call('circle-initialize-v1',token,'initialize',['Local USD Coin','USDC','USD',6,await master.getAddress(),owner,owner,owner]);
 await call('circle-initialize-v2',token,'initializeV2',['Local USD Coin']);await call('circle-initialize-v21',token,'initializeV2_1',[owner]);await call('circle-initialize-v22',token,'initializeV2_2',[[],'USDC']);
 await call('circle-controller',master,'configureController',[owner,owner]);await call('circle-minter-allowance',master,'configureMinter',[1000000000000n]);
 await call('circle-inventory',token,'mint',[owner,1000000000000n],async(_r,a)=>await token.totalSupply({blockTag:a.number})===1000000000000n&&await token.balanceOf(owner,{blockTag:a.number})===1000000000000n);
 if((await proxy.implementation({from:admin.address})).toLowerCase()!==(await impl.getAddress()).toLowerCase()||(await proxy.admin({from:admin.address})).toLowerCase()!==admin.address||Number(await token.decimals())!==6||await token.symbol()!=='USDC'||await token.version()!=='2'||(await token.masterMinter()).toLowerCase()!==(await master.getAddress()).toLowerCase())throw Error('Canonical Circle scope differs');
 const domain=await token.DOMAIN_SEPARATOR();if(domain!==TypedDataEncoder.hashDomain({name:'Local USD Coin',version:'2',chainId:31337,verifyingContract:tokenAddress})||await token.authorizationState(owner,'0x'+'0'.repeat(64))!==false)throw Error('Circle authorization domain unavailable');
 return {tokenAddress,inventory:'1000000000000',decimals:6,kind:'official-circle-development-issuance',domain,implementation:(await impl.getAddress()).toLowerCase(),codeHash:keccak256(await provider.getCode(tokenAddress)),implementationCodeHash:keccak256(await provider.getCode(await impl.getAddress()))};
}
export async function prepareDevelopmentRelay({directory,provider,stage,scope,circle,quoter,anchor,fundingSender}) {
 const signerFile=path.join(directory,'relay-signer.json'),policyFile=path.join(directory,'relay-policy.json'),stateDirectory=path.join(directory,'relay-state');
 const progress=JSON.parse(await fs.readFile(path.join(directory,'progress.json'),'utf8'));
 async function readPrivate(filename){try{const st=await fs.lstat(filename);if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||st.uid!==process.getuid()||st.size>16384)throw Error('Invalid private relay record');return JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 // The host writes this marker before opening the funded signer's ledger.
 // Even a partial first initialization is operator-reconciled, never recreated.
 const marker=stateDirectory+'.initialized.json';let markerExists=false;try{await fs.lstat(marker);markerExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(markerExists){
  const initialized=await readPrivate(marker);if(initialized?.schemaVersion!==1||!/^0x[0-9a-f]{64}$/.test(initialized.identity??''))throw Error('Invalid original relay initialization');
  let st;try{st=await fs.lstat(stateDirectory);}catch{throw Error('Original initialized relay state missing');}
  if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(stateDirectory)!==stateDirectory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700||(await readPrivate(path.join(stateDirectory,'funding-budget.json')))?.identity!==initialized.identity)throw Error('Original initialized relay budget missing or invalid');
 }
 let key=await readPrivate(signerFile),saved=await readPrivate(policyFile);
 if(!key){if(saved||progress.entered.includes('relay-fund')||(await fs.readdir(directory)).includes('relay-state'))throw Error('Original relay signer missing');const wallet=Wallet.createRandom();key={ethereumKey:wallet.privateKey};await (await fileState(signerFile)).write(key);}
 if(Object.keys(key).join()!=='ethereumKey')throw Error('Invalid private relay signer');const relayer=new Wallet(key.ethereumKey).address.toLowerCase();if(!/^0x[0-9a-f]{40}$/.test(fundingSender??'')||relayer===fundingSender)throw Error('Dedicated relay signer required');
 const fixed={chainId:'31337',development:true,router:scope.router,routerCodeHash:scope.routerCodeHash,collateralPortal:scope.collateralPortal,feePortal:scope.feePortal,bokPortal:scope.bokPortal,privateFpc:scope.privateFpc,usdc:scope.bokToken,usdcCodeHash:circle.codeHash,usdcImplementation:circle.implementation,usdcImplementationCodeHash:circle.implementationCodeHash,weth:scope.weth,quoter:scope.quoter,quoterCodeHash:scope.quoterCodeHash,gasPoolFee:3000,relayer,maxGasWei:'10000000000000000',totalGasBudgetWei:'100000000000000000'};
 if(!saved){
  if(progress.entered.includes('relay-fund')||(await fs.readdir(directory)).includes('relay-state'))throw Error('Original relay policy missing');
  const quote=await quoter.quoteExactOutputSingle.staticCall([scope.bokToken,scope.weth,BigInt(fixed.maxGasWei),3000,0],{blockTag:anchor.number});
  if(quote[0]<=0n||(await provider.getBlock(anchor.number))?.hash!==anchor.hash)throw Error('Relay reimbursement quote unavailable');
  saved={policy:{...fixed,feeUsdc:String((quote[0]*105n+99n)/100n)},quote:{amountIn:String(quote[0]),amountOut:fixed.maxGasWei,blockNumber:anchor.number,blockHash:anchor.hash}};
  await (await fileState(policyFile)).write(saved);
 }
 if(Object.keys(saved.policy??{}).length!==Object.keys(fixed).length+1||Object.entries(fixed).some(([k,v])=>saved.policy[k]!==v)||!/^[1-9][0-9]{0,76}$/.test(saved.policy.feeUsdc??'')||saved.quote?.amountOut!==fixed.maxGasWei||!Number.isSafeInteger(saved.quote.blockNumber)||!/^[1-9][0-9]{0,76}$/.test(saved.quote.amountIn??'')||String((BigInt(saved.quote.amountIn)*105n+99n)/100n)!==saved.policy.feeUsdc||(await provider.getBlock(saved.quote.blockNumber))?.hash!==saved.quote.blockHash)throw Error('Original relay policy or quote differs');
 await stage('relay-fund',{to:relayer,data:'0x',value:BigInt(fixed.totalGasBudgetWei)},async(_r,a)=>(await provider.getBalance(relayer,a.number))-(await provider.getBalance(relayer,a.number-1))===BigInt(fixed.totalGasBudgetWei));
 await fs.mkdir(stateDirectory,{mode:0o700,recursive:true});const st=await fs.lstat(stateDirectory);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(stateDirectory)!==stateDirectory||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw Error('Private relay state directory differs');
 return {ethereumUrl:new URL(provider._getConnection().url).href,signerFile,stateDirectory,policy:saved.policy};
}

/** Real V3 pools and actual exact-output quotes. Seed prices are declared local
 * inventory policy; only the Quoter's canonical reads become funding quotes.
 */
export async function verifyDevelopmentV3({swap,quoter,factory,weth}) {
 // SwapRouter02 calls the constructor argument factoryV3; its inherited
 // PeripheryImmutableState public getter is factory(), as in QuoterV2.
 if((await swap.factory()).toLowerCase()!==factory||(await swap.WETH9()).toLowerCase()!==weth||(await quoter.factory()).toLowerCase()!==factory||(await quoter.WETH9()).toLowerCase()!==weth)throw Error('V3 dependency identity differs');
}
export async function deployDevelopmentLiquidity(args){
 const {provider,signer,artifacts,scope}=args,{deploy,call,stage}=await localContext(args),owner=signer.address.toLowerCase();
 for(const name of ['collateralPortal','feePortal','bokPortal','feeToken','bokToken','feeAssetHandler','privateFpc'])if(!new RegExp('^0x[0-9a-f]{'+(name==='privateFpc'?64:40)+'}$').test(scope[name]??'')||BigInt(scope[name])===0n)throw Error('Current liquidity scope missing');
 const weth=await deploy('weth',artifacts.WETH9),factory=await deploy('v3-factory',artifacts.UniswapV3Factory),descriptorLibrary=await deploy('nft-descriptor-library',artifacts.NFTDescriptor);
 const wa=(await weth.getAddress()).toLowerCase(),fa=(await factory.getAddress()).toLowerCase();
 const descriptor=await deploy('position-descriptor',artifacts.NonfungibleTokenPositionDescriptor,[wa,encodeBytes32String('ETH')],{NFTDescriptor:(await descriptorLibrary.getAddress()).toLowerCase()});
 const positions=await deploy('positions',artifacts.NonfungiblePositionManager,[fa,wa,await descriptor.getAddress()]),pa=(await positions.getAddress()).toLowerCase();
 const swap=await deploy('swap-router',artifacts.SwapRouter02,[zero,fa,pa,wa]),quoter=await deploy('quoter',artifacts.QuoterV2,[fa,wa]);
 await verifyDevelopmentV3({swap,quoter,factory:fa,weth:wa});
 const fee=new Contract(scope.feeToken,abiToken,provider),usdc=new Contract(scope.bokToken,abiToken,provider),handler=new Contract(scope.feeAssetHandler,['function mintAmount() view returns(uint256)','function mint(address)'],provider);
 const minted=await handler.mintAmount();if(minted<1000000n||Number(await fee.decimals())!==18||Number(await usdc.decimals())!==6)throw Error('Development fee inventory prerequisite differs');
 await call('fee-inventory',handler,'mint',[owner],async(_r,a)=>await fee.balanceOf(owner,{blockTag:a.number})-await fee.balanceOf(owner,{blockTag:a.number-1})===minted);
 await call('wrap-inventory',weth,'deposit',[],async(_r,a)=>await weth.balanceOf(owner,{blockTag:a.number})-await weth.balanceOf(owner,{blockTag:a.number-1})===10000000000000000000n,10000000000000000000n);
 const pairs=[['weth-fee',wa,scope.feeToken,5000000000000000000n,minted/2n],['weth-usdc',wa,scope.bokToken,5000000000000000000n,100000000000n],['usdc-fee',scope.bokToken,scope.feeToken,100000000000n,minted/2n]];
 const poolAbi=['function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)'];
 const pools=[];
 for(const [name,a,b,amountA,amountB]of pairs){
  const p=localPoolPrice(a,b,amountA,amountB),token0=new Contract(p.token0,abiToken,provider),token1=new Contract(p.token1,abiToken,provider);
  await call(name+'-initialize',positions,'createAndInitializePoolIfNecessary',[p.token0,p.token1,3000,p.sqrtPriceX96],async(_r,anchor)=>(await factory.getPool(p.token0,p.token1,3000,{blockTag:anchor.number}))!==zero);
  const address=(await factory.getPool(p.token0,p.token1,3000)).toLowerCase(),pool=new Contract(address,poolAbi,provider);
  if((await pool.token0()).toLowerCase()!==p.token0||(await pool.token1()).toLowerCase()!==p.token1||Number(await pool.fee())!==3000)throw Error('Pool identity differs');
  await call(name+'-approve0',token0,'approve',[pa,p.amount0],async(_r,anchor)=>await token0.allowance(owner,pa,{blockTag:anchor.number})===p.amount0);
  await call(name+'-approve1',token1,'approve',[pa,p.amount1],async(_r,anchor)=>await token1.allowance(owner,pa,{blockTag:anchor.number})===p.amount1);
  // Full-range spacing60 positions; unused approved inventory is revoked below.
  await call(name+'-position',positions,'mint',[[p.token0,p.token1,3000,-887220,887220,p.amount0,p.amount1,0,0,owner,(1n<<256n)-1n]],async(receipt,anchor)=>{
   const mintedPositions=receipt.logs.map(l=>{try{return positions.interface.parseLog(l);}catch{return null;}}).filter(l=>l?.name==='IncreaseLiquidity');
   return mintedPositions.length===1&&mintedPositions[0].args.liquidity>0n&&await pool.liquidity({blockTag:anchor.number})>0n;
  });
  await call(name+'-revoke0',token0,'approve',[pa,0],async(_r,anchor)=>await token0.allowance(owner,pa,{blockTag:anchor.number})===0n);
  await call(name+'-revoke1',token1,'approve',[pa,0],async(_r,anchor)=>await token1.allowance(owner,pa,{blockTag:anchor.number})===0n);
  if(await pool.liquidity()<=0n)throw Error('Actual pool liquidity unavailable');pools.push({address,token0:p.token0,token1:p.token1,fee:3000,liquidity:String(await pool.liquidity())});
 }
 const portalArtifact=args.fundingRouterArtifact;if(!portalArtifact?.bytecode?.object)throw Error('Preflighted normal funding router artifact required');
 const router=await deploy('rolling-funding-router',{abi:portalArtifact.abi,bytecode:portalArtifact.bytecode.object,linkReferences:portalArtifact.bytecode.linkReferences},[scope.collateralPortal,scope.feePortal,scope.bokPortal,wa,await swap.getAddress(),scope.privateFpc]);
 const routerAddress=(await router.getAddress()).toLowerCase(),quoterAddress=(await quoter.getAddress()).toLowerCase();
 const result={chainId:'31337',router:routerAddress,routerCodeHash:keccak256(await provider.getCode(routerAddress)),collateralPortal:scope.collateralPortal,feePortal:scope.feePortal,bokPortal:scope.bokPortal,weth:wa,swapRouter:(await swap.getAddress()).toLowerCase(),feeToken:scope.feeToken,bokToken:scope.bokToken,privateFpc:scope.privateFpc,quoter:quoterAddress,quoterCodeHash:keccak256(await provider.getCode(quoterAddress))};
 for(const name of ['collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','chainId'])if(String(await router[name]()).toLowerCase()!==result[name])throw Error('Canonical aggregate router scope differs');
 const head=await provider.getBlock('latest'),quotes=[];
 for(const [tokenIn,tokenOut,amount]of [[wa,scope.feeToken,1000000000000000n],[wa,scope.bokToken,1000000n],[scope.bokToken,wa,1000000000000000n],[scope.bokToken,scope.feeToken,1000000000000000n]]){
  const quote=await quoter.quoteExactOutputSingle.staticCall([tokenIn,tokenOut,amount,3000,0],{blockTag:head.number});if(quote[0]<=0n)throw Error('Actual exact-output liquidity unavailable');quotes.push({tokenIn,tokenOut,amountOut:String(amount),amountIn:String(quote[0])});
 }
 if((await provider.getBlock(head.number))?.hash!==head.hash)throw Error('Liquidity quote anchor changed');
 const fundingRelayConfig=await prepareDevelopmentRelay({directory:args.directory,provider,stage,scope:result,circle:args.circle,quoter,anchor:head,fundingSender:owner});
 Object.assign(result,{usdcCodeHash:args.circle.codeHash,usdcImplementation:args.circle.implementation,usdcImplementationCodeHash:args.circle.implementationCodeHash,usdcDomain:{name:'Local USD Coin',version:'2'},usdcRelayAddress:fundingRelayConfig.policy.relayer});
 return {scope:result,pools,quotes,anchor:{number:head.number,hash:head.hash},developmentInventory:true,userFundingCompleted:false,fundingRelayConfig};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--compile-circle'){
  const [input,output,dependencies]=process.argv.slice(3);const compilerRequire=createRequire(path.join(dependencies,'package.json')),solc=compilerRequire('circle-solc');
  if(!solc.version().startsWith('0.6.12+'))throw Error('Circle compiler version differs');
  await fs.writeFile(output,solc.compile(await fs.readFile(input,'utf8')),{mode:0o600});
 }else if(process.argv[2]==='--prepare-artifacts')console.log(JSON.stringify(await prepareLiquidityArtifacts({dependencyRoot:process.argv[3]?path.resolve(process.argv[3]):path.resolve('.')})));
 else throw Error('Explicit artifact preparation required; deployment is owned by development bootstrap');
}
