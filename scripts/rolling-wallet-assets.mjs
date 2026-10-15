import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {ROOT,assertNodeVersion} from './toolchain.mjs';
import {checkSdk} from './check-sdk.mjs';
import {contractInputs} from './artifact-provenance.mjs';
import {checkNoirEmbeddedSources} from './check-noir-dependencies.mjs';
import {validateCrsManifest} from './build-crs.mjs';
import {ARTIFACT as bokArtifactPath,MANIFEST as bokManifestPath,buildInputs as bokInputs} from '../experiments/private-bok/build.mjs';
const out='.build/rolling-wallet',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const scripts={
 'ethers.js':'node_modules/ethers/dist/ethers.umd.min.js',
 'aztec_bundle.js':'.build/sdk/aztec_bundle.js',
 'crs-client.js':'shared/crs-client.js',
 'wallet-providers.js':'shared/wallet-providers.js',
 'passkey-wallet.js':'shared/passkey-wallet.js',
 'wallet-backup.js':'shared/wallet-backup.js',
 'claim-secret-store.js':'shared/claim-secret-store.js',
 'account.js':'shared/account.js',
 'engine.js':'apps/src/billboard/user/engine.js',
};
const sources={...Object.fromEntries(Object.entries(scripts).map(([name,file])=>['/wallet/'+name,file])),
 '/wallet/runtime.mjs':out+'/runtime.mjs',
 '/wallet/board.json':'billboard/target/rolling_contract-RollingBoard.json',
 '/wallet/private-fee.json':'apps/src/billboard/private_fee_artifact.json',
 '/wallet/bok.json':'experiments/private-bok/target/private_bok-PrivateBok.json',
 '/crs/crs-manifest.json':'crs-manifest.json',
};
const invalid=()=>Error('Invalid Rolling wallet assets or public configuration');
const requiredInputs=['apps/rolling/wallet-runtime.mjs','apps/rolling/wallet-session.mjs',
 'shared/rolling/aggregate-wallet.mjs','shared/rolling/application.mjs','shared/rolling/synchronized-application.mjs','shared/rolling/deployment.mjs','shared/rolling/name-policy.mjs','shared/rolling/invocation.mjs',
 'shared/journal-record.mjs','shared/l2-journal.mjs','shared/transaction-outcomes.mjs','shared/protocol-commitments.mjs','shared/protocol-schema.mjs',
 'scripts/rolling-wallet-assets.mjs',...Object.values(scripts),'crs-manifest.json','.build/contracts-manifest.json','.build/sdk/sdk-manifest.json'];
const keys=(value,names)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==names.sort().join())throw invalid();};
function endpoint(value,local){
 if(typeof value!=='string'||value.length>2048||/[\s\\]/.test(value))throw invalid();
 const url=new URL(value);if(url.username||url.password||url.search||url.hash||value.includes('?')||value.includes('#')||
  !(url.protocol==='https:'||local&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw invalid();
 return url.origin;
}
function address(value,bytes){if(typeof value!=='string'||!new RegExp('^0x[0-9a-f]{'+bytes*2+'}$').test(value)||BigInt(value)===0n)throw invalid();}
/** Only these public values can reach the browser. Operator files, authentication
 * capabilities and arbitrary config properties are rejected, never projected. */
export function validateRollingWalletConfig(value,scope){
 keys(value,['config','trustedQuery','remoteProver','proofsEnabled']);
 const copy=structuredClone(value),{config:c,trustedQuery:q,remoteProver:r,proofsEnabled}=copy;
 keys(c,['network','board','privateFee',...(c.bok===undefined?[]:['bok']),...(c.aggregateFunding===undefined?[]:['aggregateFunding'])]);
 if(c.aggregateFunding!==undefined){
  const a=c.aggregateFunding;keys(a,['chainId','router','routerCodeHash','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','privateFpc','quoter','quoterCodeHash',...(a.usdcRelayAddress===undefined?[]:['usdcRelayAddress','usdcCodeHash','usdcImplementation','usdcImplementationCodeHash','usdcDomain'])]);
  if(a.usdcRelayAddress!==undefined){
   address(a.usdcRelayAddress,20);address(a.usdcImplementation,20);address(a.usdcCodeHash,32);address(a.usdcImplementationCodeHash,32);
   keys(a.usdcDomain,['name','version']);for(const value of Object.values(a.usdcDomain))if(typeof value!=='string'||!/^[-A-Za-z0-9 .]{1,64}$/.test(value))throw invalid();
  }
  if(!c.bok||a.chainId!==c.network.chainId||a.collateralPortal!==c.board.portalAddress||a.privateFpc!==c.privateFee.contractAddress)throw invalid();
  for(const name of ['router','collateralPortal','feePortal','bokPortal','weth','swapRouter','feeToken','bokToken','quoter'])address(a[name],20);
  for(const name of ['routerCodeHash','quoterCodeHash','privateFpc'])address(a[name],32);
 }
 if(c.bok!==undefined){keys(c.bok,['contractAddress','operatorAddress','pluginId']);for(const v of Object.values(c.bok))address(v,32);}keys(c.network,['chainId','rollupVersion','rollupAddress','ethRpcUrl']);
 keys(c.board,['contractAddress','portalAddress']);keys(c.privateFee,['contractAddress','gasSettings']);
 if(typeof c.network.chainId!=='string'||!/^[1-9][0-9]{0,19}$/.test(c.network.chainId)||typeof c.network.rollupVersion!=='string'||!/^[1-9][0-9]{0,9}$/.test(c.network.rollupVersion))throw invalid();
 const local=c.network.chainId==='31337';if(typeof proofsEnabled!=='boolean'||!proofsEnabled&&!local)throw invalid();
 address(c.network.rollupAddress,20);address(c.board.contractAddress,32);address(c.board.portalAddress,20);address(c.privateFee.contractAddress,32);
 if(scope&&(String(scope.chainId)!==c.network.chainId||String(scope.rollupVersion)!==c.network.rollupVersion||scope.rollupAddress!==c.network.rollupAddress||scope.boardAddress!==c.board.contractAddress))throw invalid();
 keys(c.privateFee.gasSettings,['gasLimits','teardownGasLimits','maxFeesPerGas','maxPriorityFeesPerGas']);
 for(const [name,fields] of Object.entries({gasLimits:['daGas','l2Gas'],teardownGasLimits:['daGas','l2Gas'],maxFeesPerGas:['feePerDaGas','feePerL2Gas'],maxPriorityFeesPerGas:['feePerDaGas','feePerL2Gas']})){
  keys(c.privateFee.gasSettings[name],fields);for(const v of Object.values(c.privateFee.gasSettings[name]))if(typeof v!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(v))throw invalid();
 }
 keys(q,['url','allowLocalDev']);if(typeof q.allowLocalDev!=='boolean'||q.allowLocalDev&&!local)throw invalid();
 const origins=new Set([endpoint(c.network.ethRpcUrl,local),endpoint(q.url,q.allowLocalDev)]);
 if(r!==null){keys(r,['url','board','chainId','rollupVersion','proofsEnabled']);if(r.board!==c.board.contractAddress||r.chainId!==c.network.chainId||r.rollupVersion!==c.network.rollupVersion||r.proofsEnabled!==proofsEnabled)throw invalid();origins.add(endpoint(r.url,local));}
 return {value:copy,connectOrigins:[...origins].sort()};
}
async function inventory(){
 const sdk=checkSdk(),crs=JSON.parse(await fs.readFile(path.join(ROOT,'crs-manifest.json'),'utf8'));validateCrsManifest(crs);
 const result={...sources};
 const bokBytes=await fs.readFile(bokArtifactPath),bokManifest=JSON.parse(await fs.readFile(bokManifestPath,'utf8')),bokRaw=JSON.parse(bokBytes);
 if(JSON.stringify(bokInputs())!==JSON.stringify(bokManifest.inputs)||sha(bokBytes)!==bokManifest.artifactSha256||bokRaw.name!=='PrivateBok'||bokRaw.transpiled!==true||!bokRaw.functions.filter(f=>f.custom_attributes?.includes('abi_private')).every(f=>f.verification_key))throw invalid();
 checkNoirEmbeddedSources(bokRaw);
 for(const name of Object.keys(sdk.outputs))result['/wallet/'+name]='.build/sdk/'+name;
 // The browser consumes the pinned uncompressed derivation as well as the
 // downloaded CRS inputs. Validate every served file before publishing assets.
 const crsFiles=[...crs.files,crs.derivedG1];
 for(const file of crsFiles)result['/crs/'+file.name]='apps/dist/crs/'+file.name;
 for(const file of crsFiles){const bytes=await fs.readFile(path.join(ROOT,result['/crs/'+file.name]));if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw invalid();}
 return result;
}
export async function buildRollingWalletAssets(){
 assertNodeVersion();
 const current=contractInputs(ROOT),manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json'),'utf8'));
 if(JSON.stringify(current)!==JSON.stringify(manifest.inputs))throw invalid();
 const raw=JSON.parse(await fs.readFile(path.join(ROOT,sources['/wallet/board.json']),'utf8'));
 if(raw.name!=='RollingBoard'||raw.transpiled!==true||!raw.functions.filter(f=>f.custom_attributes?.includes('abi_private')).every(f=>f.verification_key))throw invalid();
 checkNoirEmbeddedSources(raw);
 for(const name of ['main.nr','admission.nr','profiles.nr', 'posting.nr','encoding.nr']){
  const file='billboard/rolling_contract/src/'+name,embedded=Object.values(raw.file_map).find(entry=>entry.path===file);
  if(embedded?.source!==await fs.readFile(path.join(ROOT,file),'utf8'))throw invalid();
 }
 await fs.mkdir(path.join(ROOT,out),{recursive:true});
 // invocation.mjs supplies only a scalar constant here. Its unused hashing
 // helper must tree-shake away; do not resolve another copy of the Aztec SDK.
 const built=await build({absWorkingDir:ROOT,entryPoints:['apps/rolling/wallet-runtime.mjs'],outfile:out+'/runtime.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',metafile:true,logLevel:'silent',external:['@aztec-labs/foundation/crypto/poseidon']});
 if(Object.values(built.metafile.outputs).some(output=>output.imports.length))throw invalid();
 if(Object.keys(built.metafile.inputs).some(name=>name.includes('node_modules')))throw invalid();
 const inputs={...current,...bokInputs()};
 for(const file of [bokManifestPath,bokArtifactPath])inputs[path.relative(ROOT,file)]=sha(await fs.readFile(file));
 for(const name of [...Object.keys(built.metafile.inputs),'scripts/rolling-wallet-assets.mjs',...Object.values(scripts),'crs-manifest.json','.build/contracts-manifest.json','.build/sdk/sdk-manifest.json'])inputs[name]=sha(await fs.readFile(path.join(ROOT,name)));
 const files={};for(const [url,file] of Object.entries(await inventory())){const bytes=await fs.readFile(path.join(ROOT,file));files[url]={file,bytes:bytes.length,sha256:sha(bytes)};}
 await fs.writeFile(path.join(ROOT,out,'manifest.json'),JSON.stringify({schemaVersion:1,inputs,files},null,2)+'\n');
 return {files:Object.keys(files).length,inputs:Object.keys(inputs).length};
}
export async function loadRollingWalletAssets(configuration,scope){
 const {value,connectOrigins}=validateRollingWalletConfig(configuration,scope),expected=await inventory();
 const manifest=JSON.parse(await fs.readFile(path.join(ROOT,out,'manifest.json'),'utf8'));
 keys(manifest,['schemaVersion','inputs','files']);if(manifest.schemaVersion!==1||!manifest.inputs||!manifest.files)throw invalid();
 for(const file of requiredInputs)if(!Object.hasOwn(manifest.inputs,file))throw invalid();
 for(const [file,hash] of Object.entries(contractInputs(ROOT)))if(manifest.inputs[file]!==hash)throw invalid();
 if(Object.keys(expected).sort().join()!==Object.keys(manifest.files).sort().join())throw invalid();
 for(const [file,hash] of Object.entries(manifest.inputs)){
  if(!/^[a-zA-Z0-9_./@-]+$/.test(file)||file.startsWith('/')||file.split('/').includes('..')||typeof hash!=='string'||sha(await fs.readFile(path.join(ROOT,file)))!==hash)throw invalid();
 }
 for(const [url,file] of Object.entries(expected)){
  const entry=manifest.files[url];keys(entry,['file','bytes','sha256']);
  if(entry.file!==file)throw invalid();const bytes=await fs.readFile(path.join(ROOT,file));if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw invalid();
 }
 const describe=url=>{const {bytes,sha256}=manifest.files[url];return {url,bytes,sha256};};
 const runtime={schemaVersion:1,...value,scripts:Object.keys(scripts).map(name=>describe('/wallet/'+name)),crs:describe('/crs/crs-manifest.json'),artifacts:{board:describe('/wallet/board.json'),privateFee:describe('/wallet/private-fee.json'),...(value.config.bok?{bok:describe('/wallet/bok.json')}:{})}};
 return Object.freeze({connectOrigins,runtime,async read(url){
  if(url==='/wallet/runtime.json')return {body:Buffer.from(JSON.stringify(runtime)),type:'application/json'};
  const file=manifest.files[url];if(!file)return null;
  const body=await fs.readFile(path.join(ROOT,file.file));if(body.length!==file.bytes||sha(body)!==file.sha256)throw invalid();
  return {body,type:/\.m?js$/.test(url)?'text/javascript':url.endsWith('.json')?'application/json':url.endsWith('.wasm')?'application/wasm':'application/octet-stream'};
 }});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await buildRollingWalletAssets()));
