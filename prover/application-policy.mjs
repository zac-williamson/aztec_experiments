import {FunctionSelector, FunctionType, loadContractArtifact} from '@aztec-labs/stdlib/abi';
import {ProtocolContractAddress} from '@aztec-labs/protocol-contracts';
import {pluginSelectors} from './plugin-policy.mjs';

const boardPrivate = ['register_name', 'authenticate_name', 'create_subboard', 'claim_deposit', 'withdraw', 'post', 'post_with_bok', 'screen', 'set_like', 'set_bio', 'set_avatar', 'set_preference', 'mark_thread_read'];
const boardPublic = ['set_main_policy', 'reject_subboard', 'configure_plugin', 'remove_post', 'remove_avatar'];
const bokBoard = new Set(['post_with_bok', 'configure_plugin']);
const bokPrivate = ['claim', 'authorize_request', 'cancel', 'expire', 'withdraw'];
const bokPublic = ['publish_reply', 'reserve', 'settle', 'finish', 'close_uncertain', 'reconcile', 'withdraw_earnings'];
export async function rollingSelectors(rawArtifacts) {
  const result = {fee: await pluginSelectors(), bokRequired: new Set()};
  for (const [name, privateNames, publicNames] of [['RollingBoard', boardPrivate, boardPublic], ['PrivateBok', bokPrivate, bokPublic]]) {
    const raw = rawArtifacts.find(raw => raw.name === name);
    if (!raw) throw Error('Missing rolling policy artifact');
    const artifact = loadContractArtifact(raw);
    const selectors = {private: new Set(), public: new Set()};
    for (const [visibility, names] of [['private', privateNames], ['public', publicNames]]) {
      for (const name of names) {
        const fn = [...artifact.functions, ...artifact.nonDispatchPublicFunctions].find(fn => fn.name === name);
        // Explicit known selectors only; later contract additions need policy review.
        if (fn) {
          if (fn.functionType !== (visibility === 'private' ? FunctionType.PRIVATE : FunctionType.PUBLIC)) throw Error('Rolling selector visibility changed');
          const selector=BigInt((await FunctionSelector.fromNameAndParameters(fn)).toString());
          selectors[visibility].add(selector);
          if(name && raw.name==='RollingBoard' && bokBoard.has(name))result.bokRequired.add(selector);
        }
      }
    }
    if (!selectors.private.size || !selectors.public.size) throw Error('Incomplete rolling policy artifact');
    result[name] = selectors;
  }
  return result;
}
const equal = (actual, expected) => expected !== undefined && BigInt(actual) === BigInt(expected);
function network(input, metadata) {
  if (!equal(input.tx_context.chain_id, metadata.chainId) || !equal(input.tx_context.version, metadata.rollupVersion)) throw Error('Wrong rolling network');
}
export function bindRollingCircuit(functionName, decoded, {metadata, privateBokAddress, privateFeeAddress}) {
  const [contract, name] = functionName.split(':');
  if(privateBokAddress===undefined&&(contract==='PrivateBok'||(contract==='RollingBoard'&&bokBoard.has(name))))throw Error('Bok capability disabled');
  if (contract === 'RollingBoard' || contract === 'PrivateBok' || contract === 'PrivateFPC') {
    const input = decoded.inputs;
    network(input, metadata);
    const address = contract === 'RollingBoard' ? metadata.board : contract === 'PrivateBok' ? privateBokAddress : privateFeeAddress;
    if (!equal(input.call_context.contract_address.inner, address)) throw Error('Wrong rolling contract');
    const allowed = contract === 'RollingBoard' ? boardPrivate : contract === 'PrivateBok' ? [...bokPrivate, 'subtract_more'] : ['pay_fee', 'mint_and_pay_fee', 'recurse_subtract_balance_internal'];
    if (!allowed.includes(name)) throw Error('Unapproved rolling private function');
    if (contract === 'PrivateBok' && name === 'subtract_more' && !equal(input.call_context.msg_sender.inner, privateBokAddress)) throw Error('Bok continuation must be self-called');
    if (contract === 'PrivateFPC' && name === 'recurse_subtract_balance_internal' && !equal(input.call_context.msg_sender.inner, privateFeeAddress)) throw Error('Fee continuation must be self-called');
    return;
  }
  if (contract === 'Billboard' || contract === 'PluginAdapter' || contract === 'MultiCallEntrypoint') throw Error('Foreign application circuit');
}
export function validateRollingPayload(decoded, {metadata, privateBokAddress, privateFeeAddress, selectors, allowFeeClaim = false}) {
  network(decoded.inputs, metadata);
  if(privateBokAddress===undefined&&!(selectors.bokRequired instanceof Set))throw Error('Missing restricted rolling selectors');
  let applications = 0, fees = 0;
  for (const call of decoded.app_payload.function_calls) {
    const target = BigInt(call.target_address.inner), selector = BigInt(call.function_selector.inner);
    if (target === 0n && selector === 0n && BigInt(call.args_hash) === selectors.fee.paddingHash && call.is_public === true && call.hide_msg_sender === false && call.is_static === false) continue;
    if (call.hide_msg_sender !== false || call.is_static !== false || typeof call.is_public !== 'boolean') throw Error('Invalid rolling call flags');
    if(privateBokAddress===undefined&&equal(target,metadata.board)&&selectors.bokRequired.has(selector))throw Error('Bok capability disabled');
    const role = equal(target, metadata.board) ? 'RollingBoard' : equal(target, privateBokAddress) ? 'PrivateBok' : undefined;
    if (role && selectors[role][call.is_public ? 'public' : 'private'].has(selector)) { applications++; continue; }
    if (equal(target, privateFeeAddress) && !call.is_public && selectors.fee.fee.has(selector)) { fees++; continue; }
    if (allowFeeClaim && equal(target, ProtocolContractAddress.FeeJuice.toString()) && !call.is_public && selector === selectors.fee.feeClaim) continue;
    throw Error('Unapproved rolling payload call');
  }
  if (!fees) throw Error('Private fee payment required');
  if (!applications && !allowFeeClaim) throw Error('Rolling application operation required');
  return {applications, fees};
}

export function validateRollingJob(circuits, decoded, options) {
  for (let i=0;i<circuits.length;i++) bindRollingCircuit(circuits[i].functionName, decoded[i], options);
  const allowFeeClaim=circuits.some(c=>c.functionName==='PrivateFPC:mint_and_pay_fee');
  if (!circuits.some(c=>['PrivateFPC:pay_fee','PrivateFPC:mint_and_pay_fee'].includes(c.functionName))) throw Error('Private fee circuit required');
  let accounts=0;
  for (let i=0;i<circuits.length;i++) if(circuits[i].functionName==='SchnorrInitializerlessAccount:entrypoint') {
    validateRollingPayload(decoded[i], {...options,allowFeeClaim}); accounts++;
  }
  if (!accounts) throw Error('Signed rolling account payload required');
}
