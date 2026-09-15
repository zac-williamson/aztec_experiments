// Preparation only. Coupon issuance must keep the owner/blind local; this module never sends.
import { Contract } from '@aztec/aztec.js/contracts';
import { NO_FROM } from '@aztec/aztec.js/account';
import { getFeeJuiceBalance } from '@aztec/aztec.js/utils';
import { Fr } from '@aztec/foundation/curves/bn254';
import { DomainSeparator } from '@aztec/constants';
import { poseidon2HashWithSeparator } from '@aztec/foundation/crypto/poseidon';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { loadContractArtifact, encodeArguments, decodeFromAbi } from '@aztec/stdlib/abi';
import { getContractClassFromArtifact, computeContractAddressFromInstance } from '@aztec/stdlib/contract';
import { Gas, GasFees, GasSettings } from '@aztec/stdlib/gas';

export class SponsorPreparationError extends Error {
  constructor(code) { super(code); this.name = 'SponsorPreparationError'; this.code = code; }
}
const requireValue = (ok, code) => { if (!ok) throw new SponsorPreparationError(code); };
function uint(value, bits, code = 'SPONSOR_INVALID_VALUE') {
  if (value?.toBigInt) value = value.toBigInt();
  if (typeof value === 'number') { requireValue(Number.isSafeInteger(value), code); value = BigInt(value); }
  if (typeof value === 'string') { requireValue(/^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78, code); value = BigInt(value); }
  requireValue(typeof value === 'bigint' && value >= 0n && value < (1n << BigInt(bits)), code);
  return value;
}
function field(value) {
  if (value instanceof Fr) return new Fr(value.toBigInt());
  if (typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)) return Fr.fromString(value);
  return new Fr(uint(value, 254));
}
function address(value) {
  const text = value instanceof AztecAddress ? value.toString() : value;
  requireValue(typeof text === 'string' && /^0x[0-9a-f]{64}$/.test(text), 'SPONSOR_INVALID_ADDRESS');
  const result = new AztecAddress(Fr.fromString(text));
  requireValue(!result.isZero(), 'SPONSOR_INVALID_ADDRESS'); return result;
}
const equal = (a, b) => a.toString() === b.toString();
/** Exact production depth10 coupon tree; SDK MERKLE_HASH matches pinned Noir merkle_hash. */
export async function computeSponsorCouponRoot({chainId,version,sponsorAddress,window,batchId,index,owner,blind,siblings}) {
  const position=uint(index,32);
  requireValue(position<1024n && Array.isArray(siblings) && siblings.length===10,'SPONSOR_INVALID_COUPON');
  let root=await poseidon2HashWithSeparator([new Fr(uint(chainId,64)),new Fr(uint(version,32)),address(sponsorAddress),
    new Fr(uint(window,64)),new Fr(uint(batchId,64)),new Fr(position),address(owner),field(blind)],0x42420104);
  for(let level=0;level<10;level++) {
    const sibling=field(siblings[level]);
    root=await poseidon2HashWithSeparator((position>>BigInt(level))&1n?[sibling,root]:[root,sibling],DomainSeparator.MERKLE_HASH);
  }
  return root;
}
const routes = Object.freeze({ claim: ['delegated_claim_deposit', 'sponsor_claim', 5], post: ['delegated_post', 'sponsor_post', 7], withdraw: ['delegated_withdraw', 'sponsor_withdraw', 1] });

/** All checks use actual SDK codecs/hashes. Providers remain trusted deployment-scope inputs.
 * The caller supplies bundled local artifacts and a locally held coupon; do not log arguments/result.
 * Re-prepare after changing gas/action/state. Expiry/budget are still enforced by the actual contract.
 */
export async function prepareSponsoredAction(input) {
  try { return await prepare(input); }
  catch (error) { if (error instanceof SponsorPreparationError) throw error; const wrapped = new SponsorPreparationError('SPONSOR_PREPARATION_FAILED'); wrapped.sdkFrame = String(error?.stack || '').split('\n').find(line => line.trimStart().startsWith('at '))?.trim().slice(0,240); throw wrapped; }
}
async function prepare({ wallet, node, sponsorAddress, sponsorArtifact, boardAddress, boardArtifact, owner,
  expectedChainId, expectedVersion, coupon, action, gasSettings } = {}) {
  requireValue(wallet?.getChainInfo && wallet?.createAuthWit && wallet?.registerContract && node?.getNodeInfo && node?.getContract && node?.getBlock,
    'SPONSOR_PROVIDER_REQUIRED');
  requireValue(sponsorArtifact && boardArtifact && sponsorAddress && coupon && gasSettings, 'SPONSOR_CONFIGURATION_REQUIRED');
  requireValue(action && Object.hasOwn(routes, action.kind) && Array.isArray(action.args), 'SPONSOR_UNSUPPORTED_ACTION');
  const [delegatedName, sponsorName, argc] = routes[action.kind];
  requireValue(action.args.length === argc, 'SPONSOR_INVALID_ACTION');
  const sponsorAddr = address(sponsorAddress), boardAddr = address(boardAddress), author = address(owner);
  requireValue(!equal(author, sponsorAddr), 'SPONSOR_OWNER_IS_PAYER');
  const chainId = uint(expectedChainId, 64, 'SPONSOR_CHAIN_REQUIRED'), version = uint(expectedVersion, 32, 'SPONSOR_CHAIN_REQUIRED');
  const [walletChain, nodeInfo] = await Promise.all([wallet.getChainInfo(), node.getNodeInfo()]);
  requireValue(uint(walletChain.chainId, 64) === chainId && uint(walletChain.version, 32) === version &&
    uint(nodeInfo.l1ChainId, 64) === chainId && uint(nodeInfo.rollupVersion, 32) === version, 'SPONSOR_CHAIN_MISMATCH');
  const artifact = loadContractArtifact(sponsorArtifact), boardAbi = loadContractArtifact(boardArtifact);
  const privateNames = artifact.functions.filter(f => f.functionType === 'private').map(f => f.name).sort();
  requireValue(artifact.name === 'BillboardSponsor' && JSON.stringify(privateNames) === JSON.stringify(['sponsor_claim','sponsor_post','sponsor_withdraw']), 'SPONSOR_ARTIFACT_INVALID');
  const localClass = await getContractClassFromArtifact(artifact);
  const instance = await node.getContract(sponsorAddr, 'latest');
  requireValue(instance && equal(instance.address, sponsorAddr), 'SPONSOR_NOT_DEPLOYED');
  requireValue(equal(instance.currentContractClassId, localClass.id) && equal(instance.originalContractClassId, localClass.id) &&
    equal(await computeContractAddressFromInstance(instance), sponsorAddr), 'SPONSOR_CLASS_MISMATCH');
  const boardClass = await getContractClassFromArtifact(boardAbi);
  const boardInstance = await node.getContract(boardAddr, 'latest');
  requireValue(boardInstance && equal(boardInstance.address, boardAddr) &&
    equal(boardInstance.currentContractClassId, boardClass.id) && equal(boardInstance.originalContractClassId, boardClass.id) &&
    equal(await computeContractAddressFromInstance(boardInstance), boardAddr), 'SPONSOR_BOARD_CLASS_MISMATCH');
  await wallet.registerContract(instance, artifact);
  const sponsor = Contract.at(sponsorAddr, artifact, wallet), board = Contract.at(boardAddr, boardAbi, wallet);
  const batchId = uint(coupon.batchId, 64), index = uint(coupon.index, 32), blind = field(coupon.blind);
  requireValue(batchId > 0n && !blind.isZero() && Array.isArray(coupon.siblings) && coupon.siblings.length === 10, 'SPONSOR_INVALID_COUPON');
  const siblings = coupon.siblings.map(field);
  // Static public reads use NO_FROM and do not ask the author to authorize an application call.
  const readOptions = { from: NO_FROM, skipFeeEnforcement: true };
  const [{ result: config }, { result: batch }, latest] = await Promise.all([
    sponsor.methods.get_config().simulate(readOptions), sponsor.methods.get_batch(batchId).simulate(readOptions), node.getBlock('latest'),
  ]);
  requireValue(config && batch && latest?.header?.globalVariables, 'SPONSOR_STATE_UNAVAILABLE');
  requireValue(equal(address(config.board), boardAddr), 'SPONSOR_BOARD_MISMATCH');
  const duration = uint(config.window_duration, 64), budget = uint(config.window_budget, 128), ticket = uint(config.max_fee_per_ticket, 128);
  requireValue(duration > 0n && duration <= 86400n && ticket > 0n && ticket <= budget, 'SPONSOR_POLICY_INVALID');
  const window = uint(batch.window, 64), count = uint(batch.ticket_count, 32), start = window * duration, end = start + duration - 1n;
  requireValue(end < 1n << 64n && count > 0n && count <= 1024n && index < count, 'SPONSOR_INVALID_COUPON');
  const now = uint(latest.header.globalVariables.timestamp, 64);
  requireValue(now >= start && now <= end, 'SPONSOR_COUPON_INACTIVE');
  const root = await computeSponsorCouponRoot({chainId,version,sponsorAddress:sponsorAddr,window,batchId,index,owner:author,blind,siblings});
  requireValue(equal(root, field(batch.root)) && !root.isZero(), 'SPONSOR_COUPON_MISMATCH');
  const cap = name => uint(config[name], name.includes('gas') || name.includes('teardown') ? 32 : 128);
  const da = uint(gasSettings.gasLimits?.daGas,32), l2 = uint(gasSettings.gasLimits?.l2Gas,32);
  const tda = uint(gasSettings.teardownGasLimits?.daGas,32), tl2 = uint(gasSettings.teardownGasLimits?.l2Gas,32);
  const fda = uint(gasSettings.maxFeesPerGas?.feePerDaGas,128), fl2 = uint(gasSettings.maxFeesPerGas?.feePerL2Gas,128);
  const pda = uint(gasSettings.maxPriorityFeesPerGas?.feePerDaGas,128), pl2 = uint(gasSettings.maxPriorityFeesPerGas?.feePerL2Gas,128);
  requireValue(cap('max_da_gas') > 0n && cap('max_l2_gas') > 0n && cap('max_fee_da') > 0n && cap('max_fee_l2') > 0n &&
    cap('max_fee_da') < 1n << 64n && cap('max_fee_l2') < 1n << 64n &&
    cap('max_teardown_da') <= cap('max_da_gas') && cap('max_teardown_l2') <= cap('max_l2_gas') &&
    cap('max_priority_da') <= cap('max_fee_da') && cap('max_priority_l2') <= cap('max_fee_l2'), 'SPONSOR_POLICY_INVALID');
  requireValue(da <= cap('max_da_gas') && l2 <= cap('max_l2_gas') && tda <= cap('max_teardown_da') && tl2 <= cap('max_teardown_l2') &&
    tda <= da && tl2 <= l2 && fda <= cap('max_fee_da') && fl2 <= cap('max_fee_l2') &&
    pda <= cap('max_priority_da') && pl2 <= cap('max_priority_l2') && pda <= fda && pl2 <= fl2, 'SPONSOR_GAS_EXCEEDS_CAP');
  const maxFee = da * fda + l2 * fl2;
  requireValue(maxFee <= ticket, 'SPONSOR_TICKET_EXHAUSTED');
  requireValue(await getFeeJuiceBalance(sponsorAddr, node) >= maxFee, 'SPONSOR_BALANCE_INSUFFICIENT');
  const fixedGas = new GasSettings(new Gas(Number(da),Number(l2)),new Gas(Number(tda),Number(tl2)),new GasFees(fda,fl2),new GasFees(pda,pl2));
  let authNonce = Fr.random(); while (authNonce.isZero()) authNonce = Fr.random();
  // Encode/decode each argument to detach caller-owned mutable hint/array objects before signing.
  const fn = boardAbi.functions.find(f => f.name === delegatedName && f.functionType === 'private');
  requireValue(fn && fn.parameters.length === argc + 2, 'SPONSOR_BOARD_ABI_INVALID');
  const args = [author,...action.args,authNonce];
  const snapshot = args.map((arg,i) => decodeFromAbi([fn.parameters[i].type], encodeArguments({parameters:[fn.parameters[i]]},[arg])));
  const delegated = board.methods[delegatedName](...snapshot);
  const call = await delegated.getFunctionCall();
  const interaction = sponsor.methods[sponsorName](author,batchId,index,blind,siblings,...snapshot.slice(1));
  await interaction.getFunctionCall(); // Reject malformed sponsor encoding before the authorization request.
  const authwit = await wallet.createAuthWit(author, { caller: sponsorAddr, call });
  requireValue(authwit, 'SPONSOR_AUTHORIZATION_FAILED');
  return { interaction, options: { from: NO_FROM, additionalScopes: [author], sendMessagesAs: author, authWitnesses: [authwit], fee: {gasSettings:fixedGas} },
    metadata: { maximumFee: maxFee.toString(), expiresAt: end.toString() } };
}
