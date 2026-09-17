import {encodePolicyCommitment,sha256Field} from './protocol-commitments.mjs';
import {boundedTransactionRead} from './transaction-outcomes.mjs';
const FR=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const fail=message=>{throw Object.assign(Error(message),{code:'BB_DEPLOYMENT_MANIFEST'});};
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join()!==[...keys].sort().join())fail('Invalid '+label+' fields');}
function uint(v,bits,label){if(typeof v!=='string'||!/^[1-9][0-9]*$/.test(v)||v.length>78||BigInt(v)>=1n<<BigInt(bits))fail('Invalid '+label);return v;}
function hex(v,size,label){if(typeof v!=='string'||!new RegExp('^0x[0-9a-f]{'+size*2+'}$').test(v)||BigInt(v)===0n)fail('Invalid '+label);return v;}
function field(v,label){hex(v,32,label);if(BigInt(v)>=FR)fail('Invalid '+label);return v;}
function endpoint(v){if(typeof v!=='string'||v.length>4096||v!==v.trim())fail('Invalid deployment endpoint');let u;try{u=new URL(v);}catch{fail('Invalid deployment endpoint');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail('Deployment endpoints must exclude credentials, query and fragment');return u.href;}
export function validateDeploymentManifest(value){
 exact(value,['schemaVersion','profile','network','actors','board','artifacts'],'deployment manifest');
 if(value.schemaVersion!==1||!['local-test','operator'].includes(value.profile))fail('Invalid deployment profile');
 const n=value.network,b=value.board,a=value.actors,f=value.artifacts;
 exact(n,['nodeUrl','ethRpcUrl','chainId','rollupVersion','rollup','inbox','outbox'],'network');
 endpoint(n.nodeUrl);endpoint(n.ethRpcUrl);uint(n.chainId,64,'chain');uint(n.rollupVersion,32,'rollup version');for(const k of ['rollup','inbox','outbox'])hex(n[k],20,k);
 exact(a,['aztecDeployer','ethereumDeployer'],'actors');field(a.aztecDeployer,'Aztec deployer');hex(a.ethereumDeployer,20,'Ethereum deployer');
 exact(b,['salt','minDeposit','maxDeposit','baseCooldown','kMultiplier','censorWindow','maxSaveUp','censor','policy'],'board');
 if(typeof b.salt!=='string'||!/^(0|[1-9][0-9]*)$/.test(b.salt)||b.salt.length>78||BigInt(b.salt)>=FR)fail('Invalid contract salt');
 uint(b.minDeposit,96,'minimum deposit');uint(b.maxDeposit,96,'maximum deposit');if(BigInt(b.minDeposit)>BigInt(b.maxDeposit))fail('Reversed deposit bounds');
 for(const k of ['baseCooldown','censorWindow'])uint(b[k],32,k);for(const k of ['kMultiplier','maxSaveUp'])uint(b[k],16,k);field(b.censor,'censor');
 if(typeof b.policy!=='string'||!b.policy.isWellFormed()||b.policy.includes('\0')||!b.policy.trim()||new TextEncoder().encode(b.policy).length>1488)fail('Explicit nonempty policy required');
 exact(f,['boardJsonSha256','boardClassId','portalCreationSha256','portalRuntimeMetadataSha256'],'artifacts');for(const k of Object.keys(f))hex(f[k],32,k);field(f.boardClassId,'board class');
 return structuredClone(value);
}
export function deploymentManifestConfig(manifest){const m=validateDeploymentManifest(manifest),b=m.board;return {deploymentManifest:m,aztecNodeUrl:m.network.nodeUrl,ethRpcUrl:m.network.ethRpcUrl,contractSalt:BigInt(b.salt),minDepositWei:BigInt(b.minDeposit),maxDepositWei:BigInt(b.maxDeposit),baseCooldown:Number(b.baseCooldown),kMultiplier:Number(b.kMultiplier),censorWindow:Number(b.censorWindow),maxSaveUp:Number(b.maxSaveUp),censor:b.censor,moderationPolicy:b.policy};}
export function verifyDeploymentInputs(manifest,{artifact,portalBytecode,runtimeMetadata,config,ethers}){
 const m=validateDeploymentManifest(manifest),expected=deploymentManifestConfig(m);
 for(const k of ['aztecNodeUrl','ethRpcUrl'])if(endpoint(config[k])!==endpoint(expected[k]))fail('Manifest endpoint mismatch');
 for(const k of ['contractSalt','minDepositWei','maxDepositWei','baseCooldown','kMultiplier','censorWindow','maxSaveUp'])if(config[k]===undefined||BigInt(config[k])!==BigInt(expected[k]))fail('Manifest parameter mismatch: '+k);
 if(config.censor?.toLowerCase()!==m.board.censor||config.moderationPolicy!==m.board.policy)fail('Manifest policy/censor mismatch');
 const hash=o=>ethers.sha256(ethers.toUtf8Bytes(JSON.stringify(o)));
 if(hash(artifact)!==m.artifacts.boardJsonSha256||ethers.sha256(portalBytecode)!==m.artifacts.portalCreationSha256||hash(runtimeMetadata)!==m.artifacts.portalRuntimeMetadataSha256)fail('Deployment artifact identity mismatch');
 return {manifest:m,intentDigest:hash(m)};
}
export async function preflightDeploymentNetwork(manifest,{node,provider,ethers,timeoutMs=20000}){
 const m=validateDeploymentManifest(manifest),n=m.network,deadline=Date.now()+timeoutMs;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>20000)fail('Invalid preflight timeout');
 const read=fn=>boundedTransactionRead(fn,deadline-Date.now());
 const [info,contracts,network]=await read(()=>Promise.all([node.getNodeInfo(),node.getL1ContractAddresses(),provider.getNetwork()]));
 if(String(info.l1ChainId)!==n.chainId||String(network.chainId)!==n.chainId||String(info.rollupVersion)!==n.rollupVersion||contracts.rollupAddress?.toString().toLowerCase()!==n.rollup)fail('Deployment network identity mismatch');
 for(const [key,name] of [['inboxAddress','inbox'],['outboxAddress','outbox']])if(contracts[key]&&contracts[key].toString().toLowerCase()!==n[name])fail('Node bridge identity mismatch');
 const rollup=new ethers.Contract(n.rollup,['function getInbox() view returns (address)','function getOutbox() view returns (address)'],provider);
 const [inbox,outbox,...codes]=await read(()=>Promise.all([rollup.getInbox(),rollup.getOutbox(),...['rollup','inbox','outbox'].map(k=>provider.getCode(n[k]))]));
 if(inbox.toLowerCase()!==n.inbox||outbox.toLowerCase()!==n.outbox||codes.some(c=>typeof c!=='string'||!/^0x(?:[0-9a-fA-F]{2})+$/.test(c)))fail('Deployment bridge/code mismatch');
 return {nodeInfo:info,l1Contracts:contracts};
}
export async function deploymentPolicyVersion(board,policy){return sha256Field(encodePolicyCommitment(board,policy));}
