import test from 'node:test';
import assert from 'node:assert/strict';
import * as ethers from 'ethers';
import {signDepositConsent} from './deposit-consent.mjs';
const signer=new ethers.Wallet('0x'+'11'.repeat(32));
const wallet={address:signer.address.toLowerCase(),signer};
const typed={domain:{name:'RollingCollateral',version:'1',chainId:1,verifyingContract:'0x'+'22'.repeat(20)},types:{DepositFor:[{name:'beneficiary',type:'address'},{name:'amount',type:'uint256'}]},value:{beneficiary:wallet.address,amount:100n}};
const abi=new ethers.Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)']);
test('ordinary EOA deposit signs original consent without contract validation',async()=>{
 const signature=await signDepositConsent({ethers,wallet,typed,provider:{getCode:async()=> '0x',call:()=>assert.fail('EOA has no signature contract')}});
 assert.equal(ethers.verifyTypedData(typed.domain,typed.types,typed.value,signature),signer.address);
});
for(const delegate of ['69007702764179f14f51cdce752f4f775d74e139','77021100bd87b7008e5e1989d0eb38555d0d0000']) {
 test(`Alchemy ${delegate} wraps consent for its deployed ERC1271 validator`,async()=>{
  let validated=false;
  const provider={getCode:async()=> '0xef0100'+delegate,call:async({to,data})=>{
   assert.equal(to,wallet.address);
   const [hash,signature]=abi.decodeFunctionData('isValidSignature',data);
   assert.equal(hash,ethers.TypedDataEncoder.hash(typed.domain,typed.types,typed.value));
   assert.equal(signature.slice(0,16),'0x0000000000ff00');
   const raw='0x'+signature.slice(16);
   assert.equal(ethers.verifyTypedData({chainId:1,verifyingContract:to},{ReplaySafeHash:[{name:'hash',type:'bytes32'}]},{hash},raw),signer.address);
   assert.notEqual(ethers.recoverAddress(hash,raw),signer.address,'raw portal digest is not the account replay-safe digest');
   validated=true;return abi.encodeFunctionResult('isValidSignature',['0x1626ba7e']);
  }};
  const signature=await signDepositConsent({ethers,wallet,typed,provider});
  assert.equal(signature.length,146);assert.equal(validated,true);
 });
}
test('unsupported smart wallet signature is checked by its own contract, never EOA recovery',async()=>{
 const smartWallet={...wallet,signer:{signTypedData:async()=> '0x123456'}};
 const signature=await signDepositConsent({ethers,wallet:smartWallet,typed,provider:{getCode:async()=> '0x6000',call:async({data})=>{
  assert.equal(abi.decodeFunctionData('isValidSignature',data)[1],'0x123456');return abi.encodeFunctionResult('isValidSignature',['0x1626ba7e']);
 }}});assert.equal(signature,'0x123456');
});
test('rejected contract signature stops before payment with consent error',async()=>{
 await assert.rejects(signDepositConsent({ethers,wallet,typed,provider:{getCode:async()=> '0x6000',call:async()=>abi.encodeFunctionResult('isValidSignature',['0xffffffff'])}}),{code:'ROLLING_FUNDING_CONSENT'});
});
