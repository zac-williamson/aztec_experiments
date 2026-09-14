// TEST ONLY: direct local protocol deployment; genuine verifier identity, not epoch-proof acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createPublicClient, http, keccak256 } from 'viem';
import { foundry } from 'viem/chains';
import { deployAztecL1Contracts } from '@aztec/ethereum/deploy-aztec-l1-contracts';
import { getL1ContractsConfigEnvVars } from '@aztec/ethereum/config';
import { getVKTreeRoot } from '@aztec/noir-protocol-circuits-types/vk-tree';
import { protocolContractsHash } from '@aztec/protocol-contracts';
import { RollupAbi, InboxAbi, OutboxAbi } from '@aztec/l1-artifacts';
import { ROOT, assertNodeVersion, assertAztecPackages } from './toolchain.mjs';
const BASE = 'node_modules/@aztec/l1-artifacts/l1-contracts/';
const ARTIFACT = BASE + 'out/HonkVerifier.sol/HonkVerifier.json';
const SOURCE = BASE + 'generated/HonkVerifier.sol';
const PINS = {
  [ARTIFACT]: '3fba3b75fdb2eec44554cefeb387704caa65f05a3eb1b4049bf2fe6b9d3367df',
  [SOURCE]: '5aeb653a8c004674f226f751c6ea09d316593daaadac4dcecd1e2d44749b35bd',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const nonzeroAddress = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
async function pinnedInputs() {
  const bytes = {};
  for (const [name, digest] of Object.entries(PINS)) {
    const filename = path.join(ROOT, name); const stat = await fs.lstat(filename);
    assert(stat.isFile() && !stat.isSymbolicLink(), 'Expected regular pinned deployment input');
    bytes[name] = await fs.readFile(filename);
    assert.equal(sha(bytes[name]), digest, 'Deployment input pin mismatch');
  }
  const artifact = JSON.parse(bytes[ARTIFACT]);
  assert.deepEqual(artifact.metadata.settings.compilationTarget, { 'generated/HonkVerifier.sol': 'HonkVerifier' });
  assert.equal(keccak256(bytes[SOURCE]), artifact.metadata.sources['generated/HonkVerifier.sol'].keccak256);
  for (const bytecode of [artifact.bytecode, artifact.deployedBytecode]) {
    assert.deepEqual(bytecode.linkReferences ?? {}, {}, 'Verifier linking is unsupported');
    assert.deepEqual(bytecode.immutableReferences ?? {}, {}, 'Verifier immutable patching is unsupported');
    assert(/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode.object), 'Unresolved verifier bytecode');
  }
  assert.deepEqual(artifact.abi.filter(item => item.type === 'constructor'),
    [{ type: 'constructor', inputs: [], stateMutability: 'nonpayable' }]);
  assert.equal((artifact.deployedBytecode.object.length - 2) / 2, 16996);
  return artifact.deployedBytecode.object.toLowerCase();
}

/** Caller owns fresh Anvil, fresh keys, minimal environment, deadline/RSS supervision and teardown.
 * Returns the actual SDK deployment object (contains a signing client: never serialize it),
 * plus an explicitly sanitized observation. No node, wallet or prover is started here.
 */
export async function deployC01RealProtocol({ rpcUrl, privateKey, config, genesisArchiveRoot, fundingNeeded }) {
  let stage = 'preflight';
  try {
    assertNodeVersion(); assertAztecPackages();
    const url = new URL(rpcUrl);
    assert(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
    'Explicit loopback Anvil URL required');
    assert(config && Number(config.l1ChainId) === 31337, 'Disposable chain31337 required');
    assert(/^0x[0-9a-fA-F]{64}$/.test(privateKey) && BigInt(privateKey) !== 0n, 'Fresh caller key required');
    assert(process.env.LOG_LEVEL === 'warn', 'Captured warning-only SDK logging required for test-key custody');
    assert(process.env.FORGE_BIN && path.isAbsolute(process.env.FORGE_BIN), 'Caller must select pinned Forge explicitly');
    assert(!config.existingTokenAddress, 'Fresh protocol assets required');
    assert(genesisArchiveRoot && typeof genesisArchiveRoot.toString === 'function', 'Explicit genesis root required');
    assert(typeof fundingNeeded === 'bigint' && fundingNeeded >= 0n, 'Explicit genesis funding required');
    const pinnedRuntime = await pinnedInputs();
    let expectedRuntime = pinnedRuntime;
    const client = createPublicClient({ chain: foundry,
      transport: http(url.href, { retryCount: 0, timeout: 10000, fetchOptions: { redirect: 'error' } }) });
    assert.equal(await client.getChainId(), 31337);
    const clientVersion = await client.request({ method: 'web3_clientVersion' });
    assert(/^anvil\//i.test(clientVersion), 'Anvil endpoint required');
    const beforeBlock = await client.getBlock();
    // Select only the deployment configuration keys: never spread node wallet/private-key config into SDK logging.
    const defaults = getL1ContractsConfigEnvVars();
    const settings = Object.fromEntries(Object.keys(defaults).map(key => [key, config[key] ?? defaults[key]]));
    const initialValidators = config.initialValidators ?? [];
    assert(Array.isArray(initialValidators), 'Explicit validator list shape required');
    for (const validator of initialValidators) {
      assert(nonzeroAddress(validator.attester?.toString()) && nonzeroAddress(validator.withdrawer?.toString())
        && typeof validator.bn254SecretKey?.getValue === 'function', 'Invalid validator shape');
    }
    stage = 'direct-deployment';
    const deployment = await deployAztecL1Contracts(url.href, privateKey, 31337, {
      ...settings, initialValidators, genesisArchiveRoot, feeJuicePortalInitialBalance: fundingNeeded,
      vkTreeRoot: getVKTreeRoot(), protocolContractsHash, realVerifier: true,
    });
    stage = 'runtime-identity';
    // A forced production rebuild changes Solidity metadata's remapping table.
    // Require identical executable verifier code and source identity, then compare
    // the complete deployed runtime against that rebuilt artifact including metadata.
    const prepared=JSON.parse(await fs.readFile(path.join(process.env.C01_NETWORK_ROOT,'deployment-directory.json'),'utf8'));
    assert.equal(path.dirname(await fs.realpath(prepared.directory)),await fs.realpath(process.env.C01_NETWORK_ROOT));
    const rebuiltBytes=await fs.readFile(path.join(prepared.directory,'out/HonkVerifier.sol/HonkVerifier.json'));
    const rebuilt=JSON.parse(rebuiltBytes);
    assert.deepEqual(rebuilt.metadata.settings.compilationTarget,{'generated/HonkVerifier.sol':'HonkVerifier'});
    assert.equal(rebuilt.metadata.sources['generated/HonkVerifier.sol'].keccak256,keccak256(await fs.readFile(path.join(ROOT,SOURCE))));
    assert.deepEqual(rebuilt.deployedBytecode.linkReferences??{},{});
    assert.deepEqual(rebuilt.deployedBytecode.immutableReferences??{},{});
    const executable=hex=>{const bytes=Buffer.from(hex.slice(2),'hex');const size=bytes.readUInt16BE(bytes.length-2);assert(size>0&&size<bytes.length-2);return bytes.subarray(0,bytes.length-2-size);};
    assert(executable(rebuilt.deployedBytecode.object).equals(executable(expectedRuntime)),'Rebuilt verifier executable differs from pinned verifier');
    expectedRuntime=rebuilt.deployedBytecode.object.toLowerCase();

    const addresses = deployment.l1ContractAddresses;
    const rollup = addresses.rollupAddress.toString();
    const inbox = addresses.inboxAddress.toString(); const outbox = addresses.outboxAddress.toString();
    assert([rollup, inbox, outbox].every(nonzeroAddress), 'Invalid deployed protocol address');
    const blockNumber = await client.getBlockNumber();
    const read = (address, abi, functionName) => client.readContract({ address, abi, functionName, blockNumber });
    const verifier = await read(rollup, RollupAbi, 'getEpochProofVerifier');
    assert(nonzeroAddress(verifier), 'Verifier address missing');
    const code = await client.getCode({ address: verifier, blockNumber });
    assert(code?.toLowerCase() === expectedRuntime, 'Deployed verifier differs from complete pinned Honk runtime');
    assert.equal((await read(rollup, RollupAbi, 'getInbox')).toLowerCase(), inbox.toLowerCase());
    assert.equal((await read(rollup, RollupAbi, 'getOutbox')).toLowerCase(), outbox.toLowerCase());
    assert.equal((await read(inbox, InboxAbi, 'ROLLUP')).toLowerCase(), rollup.toLowerCase());
    assert.equal((await read(outbox, OutboxAbi, 'ROLLUP')).toLowerCase(), rollup.toLowerCase());
    const actualVersion = await read(rollup, RollupAbi, 'getVersion');
    const proofSubmissionEpochs=await read(rollup,RollupAbi,'getProofSubmissionEpochs');
    assert.equal(Number(proofSubmissionEpochs),Number(settings.aztecProofSubmissionEpochs));
    assert.equal(BigInt(actualVersion), BigInt(deployment.rollupVersion));
    const codeHashes = {};
    for (const [name, address] of Object.entries({ rollup, inbox, outbox, verifier })) {
      const runtime = await client.getCode({ address, blockNumber });
      assert(runtime && runtime !== '0x', 'Protocol runtime missing'); codeHashes[name] = keccak256(runtime);
    }
    assert.equal(await pinnedInputs(), pinnedRuntime);
    const {checkC01ProductionBlob}=await import('./c01-check-production-blob.mjs');
    const blobQualification=await checkC01ProductionBlob({client,rollupAddress:rollup,buildDirectory:prepared.directory,allowedRoot:process.env.C01_NETWORK_ROOT});
    const afterBlock = await client.getBlock({ blockNumber });
    return { deployment, observation: {
      profile: 'local direct protocol deployment; pinned genuine Honk verifier identity only',
      passed: true, realVerifier: true, provesEpoch: false, productionBlobLibQualified: true, blobQualification, chainId: '31337', clientVersion,
      rollupVersion: String(actualVersion),proofSubmissionEpochs:Number(proofSubmissionEpochs), addresses: { rollup, inbox, outbox, verifier }, codeHashes,
      verifierBytes: (expectedRuntime.length - 2) / 2, verifierMatch: 'whole runtime including metadata; no masking',
      sourceHashes: PINS, rebuiltVerifierArtifactSha256:sha(rebuiltBytes), verifierExecutableMatchesPinned:true, initialValidatorCount: initialValidators.length,
      genesisArchiveRoot: genesisArchiveRoot.toString(), fundingNeeded: String(fundingNeeded),
      beforeBlock: String(beforeBlock.number), beforeTimestamp: String(beforeBlock.timestamp),
      identityBlock: String(blockNumber), identityBlockHash: afterBlock.hash, afterTimestamp: String(afterBlock.timestamp),
      sdkTimeAdjustments: 'SDK sets Anvil block timestamp interval and may mine to slot1; no proven-state override',
    } };
  } catch (error) {
    // SDK exceptions can carry Forge arguments and fresh signing keys. Never propagate their text/cause.
    const failure = new Error(`C01 real deployment failed at ${stage}`);
    failure.deploymentObservation = { passed: false, stage, errorClass: error?.name ?? 'UnknownError', diagnostic: String(error?.message ?? '').replaceAll(privateKey,'[test key]').replace(/0x[0-9a-fA-F]{64}/g,'[32-byte value]').slice(0,1500) };
    throw failure;
  }
}
