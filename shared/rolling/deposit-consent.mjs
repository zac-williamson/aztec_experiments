// DepositFor accepts ERC-1271 signatures as well as ordinary EOA signatures.
// EIP-7702 does not remove the EOA key, but the portal sees deployed account
// code and therefore calls that account's signature validator.
const ALCHEMY_SMA_7702 = new Set([
 '0x69007702764179f14f51cdce752f4f775d74e139', // alchemy.sma-7702.1.0.0
 '0x77021100bd87b7008e5e1989d0eb38555d0d0000', // alchemy.sma-7702.1.1.0
]);
const invalid=()=>Object.assign(new Error('The wallet could not authorize this deposit.'),{code:'ROLLING_FUNDING_CONSENT'});
export async function signDepositConsent({ethers,provider,wallet,typed}) {
 const code=(await provider.getCode(wallet.address)).toLowerCase();
 const delegate=/^0xef0100[0-9a-f]{40}$/.test(code)?'0x'+code.slice(8):null;
 const digest=ethers.TypedDataEncoder.hash(typed.domain,typed.types,typed.value);
 let signature;
 if(ALCHEMY_SMA_7702.has(delegate)) {
  // Alchemy's native fallback validator wraps the original digest in its
  // account-bound ReplaySafeHash domain. Prefix: fallback validation ID 0,
  // final signature segment 0xff, EOA signature type 0x00.
  const domain={chainId:typed.domain.chainId,verifyingContract:wallet.address};
  const types={ReplaySafeHash:[{name:'hash',type:'bytes32'}]},value={hash:digest};
  const raw=await wallet.signer.signTypedData(domain,types,value);
  if(ethers.verifyTypedData(domain,types,value,raw).toLowerCase()!==wallet.address.toLowerCase())throw invalid();
  signature=ethers.concat(['0x0000000000ff00',raw]);
 }else {
  signature=await wallet.signer.signTypedData(typed.domain,typed.types,typed.value);
 }
 if(code==='0x') {
  if(ethers.verifyTypedData(typed.domain,typed.types,typed.value,signature).toLowerCase()!==wallet.address.toLowerCase())throw invalid();
 }else {
  // Check the same validator the portal uses, including any installed hooks.
  // Unknown smart wallets may already return their own ERC-1271 envelope.
  const abi=new ethers.Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
  let result;
  try {result=await provider.call({to:wallet.address,data:abi.encodeFunctionData('isValidSignature',[digest,signature])});}
  catch(error){if(error?.code==='CALL_EXCEPTION')throw invalid();throw error;}
  if(abi.decodeFunctionResult('isValidSignature',result)[0]!=='0x1626ba7e')throw invalid();
 }
 return signature;
}
