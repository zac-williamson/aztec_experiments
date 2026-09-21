/** Only the disposable Ethereum devnet may opt out of application proofs.
 * Transactions still execute the SDK simulation, authentication and fee path.
 */
export function provingEnabledForNode(info) {
  return !(String(info.l1ChainId) === '31337' && info.realProofs === false);
}
