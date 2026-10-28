import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRollingRegistration} from './deployment-registration.mjs';
const hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),eth=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
// Structural validation unit fixture only; this does not claim a chain receipt,
// class/instance cryptographic roundtrip, proof, or deployment acceptance.
function registrationFixture(){
 const config={network:{chainId:'11155111',rollupVersion:'6',rollupAddress:eth(1),ethRpcUrl:'https://example.invalid'},board:{contractAddress:hex(2),portalAddress:eth(3)},privateFee:{contractAddress:hex(4),gasSettings:{gasLimits:{l2Gas:'1000'}}}};
 return {schemaVersion:1,purpose:'testnet-registration',config,proofsEnabled:true,artifactHashes:{board:'1'.repeat(64),privateFee:'2'.repeat(64)},instances:{board:{address:hex(2),classId:hex(5),bytes:'aa'},privateFee:{address:hex(4),classId:hex(6),bytes:'bb'}},economics:{minDeposit:'1',maxDeposit:'2',baseCooldown:'1',kMultiplier:'1',censorWindow:'1',maxSaveUp:'1'},configHash:hex(7),publication:{ethereum:{number:1,hash:hex(8)},aztec:{number:1,hash:hex(9)}}};
}
test('registration with no optional relay remains exactly bound',()=>{
 const r=registrationFixture(),config=structuredClone(r.config);assert.equal(validateRollingRegistration(r,{config}),r);
 config.network.chainId='1';assert.throws(()=>validateRollingRegistration(r,{config}),{code:'ROLLING_DEPLOYMENT_INVALID'});
});
test('registration permits an isolated runtime relay while retaining all deployed configuration bindings',async()=>{
 const r=registrationFixture();
 r.config.aggregateFunding={usdcRelayAddress:eth(80),router:eth(81),quoter:eth(82),feeToken:eth(83),usdcCodeHash:hex(84),usdcImplementation:eth(85),usdcImplementationCodeHash:hex(86),usdcDomain:{name:'USDC',version:'2'}};
 const config=structuredClone(r.config);config.aggregateFunding.usdcRelayAddress=eth(90);
 assert.equal(validateRollingRegistration(r,{config}),r);
 assert.equal(r.config.aggregateFunding.usdcRelayAddress,eth(80),'validation must not mutate the published registration');
 for(const fields of [['aggregateFunding','router'],['aggregateFunding','quoter'],['aggregateFunding','feeToken'],['aggregateFunding','usdcCodeHash'],['aggregateFunding','usdcImplementation'],['aggregateFunding','usdcImplementationCodeHash'],['network','chainId'],['network','rollupVersion'],['network','rollupAddress'],['network','ethRpcUrl'],['board','contractAddress'],['board','portalAddress'],['privateFee','contractAddress'],['privateFee','gasSettings','gasLimits','l2Gas'],['aggregateFunding','usdcDomain','name']]){
  const changed=structuredClone(config);let at=changed;for(const field of fields.slice(0,-1))at=at[field];at[fields.at(-1)]+='1';
  assert.throws(()=>validateRollingRegistration(r,{config:changed}),{code:'ROLLING_DEPLOYMENT_INVALID'},fields.join('.'));
 }
 for(const side of ['registration','runtime'])for(const relay of [undefined,null,'0x'+'0'.repeat(40),'0x1234',42]){
  const registration=structuredClone(r),runtime=structuredClone(config),target=side==='registration'?registration.config:runtime;
  if(relay===undefined)delete target.aggregateFunding.usdcRelayAddress;else target.aggregateFunding.usdcRelayAddress=relay;
  assert.throws(()=>validateRollingRegistration(registration,{config:runtime}),{code:'ROLLING_DEPLOYMENT_INVALID'});
 }
});
