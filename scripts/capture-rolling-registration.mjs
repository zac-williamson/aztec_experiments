// Release-time public attestation. Reads only; never loads a signer or sends a transaction.
// Run before the wallet build; keep this file for later releases of the same exact
// config/artifacts. Changed bindings require a new explicit capture, not a fallback.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as ethers from 'ethers';
import {Fr} from '@aztec-labs/foundation/curves/bn254';
import {AztecAddress} from '@aztec-labs/stdlib/aztec-address';
import {loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {getContractClassFromArtifact,computeContractAddressFromInstance,SerializableContractInstance} from '@aztec-labs/stdlib/contract';
import {sha256ToField} from '@aztec-labs/foundation/crypto/sha256';
import {BarretenbergSync,BackendType} from '@aztec-foundation/bb.js';
import {createTrustedPrivateNode,inspectTrustedNode,isTrustedPrivateNode,getTrustedNodeCanonicalBlock} from '../shared/trusted-private-node.mjs';
import {derivePrivateFeeInstance,normalizePrivateFeeGasSettings} from '../shared/private-fee-client.mjs';
import {verifyPortalRuntime} from '../shared/portal-runtime.mjs';
import {createRollingDeploymentPreparation,prepareRollingDeployment,exportRollingDeploymentRegistration} from '../shared/rolling/deployment.mjs';
import {validateRollingWalletConfig} from './rolling-wallet-assets.mjs';
import {ROOT,assertNodeVersion} from './toolchain.mjs';

assertNodeVersion();
const [configurationPath,outputPath]=process.argv.slice(2);
if(!configurationPath||!outputPath||process.argv.length!==4)throw Error('Expected public wallet configuration and new descriptor output paths.');
const {value}=validateRollingWalletConfig(JSON.parse(await fs.readFile(configurationPath,'utf8')));
if(!['11155111','31337'].includes(value.config.network.chainId))throw Error('Registration assertion is testnet-only.');
const bytes=await Promise.all(['billboard/target/rolling_contract-RollingBoard.json','apps/src/billboard/private_fee_artifact.json'].map(file=>fs.readFile(path.join(ROOT,file))));
const artifactHashes=Object.fromEntries(['board','privateFee'].map((name,index)=>[name,createHash('sha256').update(bytes[index]).digest('hex')]));
const manifest=JSON.parse(await fs.readFile(path.join(ROOT,'.build/contracts-manifest.json'),'utf8'));
if(manifest.rollingBoard!==artifactHashes.board)throw Error('Board artifact is not the qualified build.');
const [boardArtifact,privateFeeArtifact]=bytes.map(data=>loadContractArtifact(JSON.parse(data)));
const portalRuntimeMetadata=JSON.parse(await fs.readFile(path.join(ROOT,'shared/portal-runtime.json'),'utf8'));
const sdk={Fr,AztecAddress,SerializableContractInstance,getContractClassFromArtifact,computeContractAddressFromInstance,sha256ToField,
 createTrustedPrivateNode,inspectTrustedNode,isTrustedPrivateNode,getTrustedNodeCanonicalBlock,derivePrivateFeeInstance,normalizePrivateFeeGasSettings,verifyPortalRuntime,portalRuntimeMetadata};
try{
 await BarretenbergSync.initSingleton({backend:BackendType.Wasm});
 const preparation=createRollingDeploymentPreparation({sdk,ethers,...value,boardArtifact,privateFeeArtifact});
 const deployment=await prepareRollingDeployment(preparation,{contextGuard:async()=>{}});
 const minimum=await deployment.node.getCurrentMinFees();
 const configured=normalizePrivateFeeGasSettings(value.config.privateFee.gasSettings).gasSettings.maxFeesPerGas;
 for(const key of ['feePerDaGas','feePerL2Gas'])if(configured[key]<BigInt(minimum[key]))
  throw Error('Configured '+key+' is below the current network minimum. Refresh the release fee settings before registration.');
 const record=exportRollingDeploymentRegistration(preparation,artifactHashes);
 await fs.mkdir(path.dirname(path.resolve(outputPath)),{recursive:true});
 await fs.writeFile(outputPath,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o644});
 console.log(JSON.stringify({schemaVersion:1,readOnly:true,board:record.instances.board.address,privateFee:record.instances.privateFee.address,publication:record.publication,sha256:createHash('sha256').update(await fs.readFile(outputPath)).digest('hex')}));
}finally{await BarretenbergSync.destroySingleton();}
