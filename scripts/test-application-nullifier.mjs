// Controlled execution fixtures with real field hashing; no genuine proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Fr } from '@aztec/foundation/curves/bn254';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { siloNullifier } from '@aztec/stdlib/hash';
import { extractApplicationNullifier } from '../shared/application-nullifier.mjs';
const board = AztecAddress.fromFieldUnsafe(new Fr(42));
const other = AztecAddress.fromFieldUnsafe(new Fr(43));
const zero = () => ({value:Fr.ZERO,noteHash:Fr.ZERO,counter:0});
function call(address, value=7) {return {publicInputs:{callContext:{contractAddress:address},nullifiers:{claimedLength:1,array:[{value:new Fr(value),noteHash:Fr.ZERO,counter:3},zero()]}},nestedExecutionResults:[]};}
async function fixture() {
 const app=call(board),root=call(other,9);root.nestedExecutionResults=[app];
 const expected=await siloNullifier(board,new Fr(7)),fee=await siloNullifier(other,new Fr(9));
 const data={toBuffer:()=>Buffer.from('same inputs'),getNonEmptyNullifiers:()=>[fee,expected]};
 return {app,root,expected,result:{privateExecutionResult:{entrypoint:root},publicInputs:data},tx:{data}};
}
const rejects = h => assert.rejects(extractApplicationNullifier(h.result,h.tx,board),e=>e.code==='BB_APPLICATION_ATTRIBUTION_UNSUPPORTED');
test('attributes only the billboard nullifier, independently of fee nullifier',async()=>{const h=await fixture();assert((await extractApplicationNullifier(h.result,h.tx,board)).equals(h.expected));});
for(const [name,mutate] of [
 ['missing execution',h=>delete h.result.privateExecutionResult],
 ['missing board call',h=>h.root.nestedExecutionResults=[]],
 ['multiple nested board calls',h=>h.app.nestedExecutionResults=[call(board)]],
 ['cyclic execution',h=>h.app.nestedExecutionResults=[h.root]],
 ['zero nullifier',h=>h.app.publicInputs.nullifiers.array[0].value=Fr.ZERO],
 ['multiple nullifiers',h=>h.app.publicInputs.nullifiers.claimedLength=2],
 ['hidden trailing nullifier',h=>h.app.publicInputs.nullifiers.array[1].value=new Fr(1)],
 ['malformed field',h=>h.app.publicInputs.nullifiers.array[0].value='7'],
 ['missing global match',h=>h.tx.data.getNonEmptyNullifiers=()=>[new Fr(9)]],
 ['duplicate global match',h=>h.tx.data.getNonEmptyNullifiers=()=>[h.expected,h.expected]],
 ['different proof inputs',h=>h.result.publicInputs={toBuffer:()=>Buffer.from('different')}],
 ['oversized tree',h=>h.root.nestedExecutionResults=Array.from({length:129},()=>call(other))],
])test(name,async()=>{const h=await fixture();mutate(h);await rejects(h);});
test('diagnostics identify missing final membership without field/address contents',async()=>{
 const h=await fixture();h.tx.data.getNonEmptyNullifiers=()=>[new Fr(123)];
 await assert.rejects(extractApplicationNullifier(h.result,h.tx,board),error=>{
  assert.equal(error.attributionStage,'final-membership');
  assert.equal(error.attributionDiagnostics.boardCalls,1);
  assert.equal(error.attributionDiagnostics.matchCount,0);
  assert.equal(error.attributionDiagnostics.claimedLength,1);
  const encoded=JSON.stringify(error.attributionDiagnostics);
  assert(!encoded.includes('0x'));assert(!encoded.includes('123'));
  assert(Object.values(error.attributionDiagnostics).every(value=>value===null||['string','boolean','number'].includes(typeof value)));
  return true;
 });
});
test('malformed claimed length reports only type, never arbitrary string content',async()=>{
 const h=await fixture();h.app.publicInputs.nullifiers.claimedLength='private-secret-sentinel';
 await assert.rejects(extractApplicationNullifier(h.result,h.tx,board),error=>{
  assert.equal(error.attributionStage,'nullifier-shape');assert.equal(error.attributionDiagnostics.claimedLengthType,'string');
  assert.equal(error.attributionDiagnostics.claimedLength,null);
  assert(!JSON.stringify(error).includes('private-secret-sentinel'));return true;
 });
});
async function multipleFixture() {
 const h=await fixture();
 h.app.publicInputs.nullifiers={claimedLength:3,array:[7,8,10].map(value=>({value:new Fr(value),noteHash:Fr.ZERO,counter:3})).concat([zero()])};
 const all=await Promise.all([7,8,10].map(value=>siloNullifier(board,new Fr(value))));
 const fee=await siloNullifier(other,new Fr(9));
 h.tx.data.getNonEmptyNullifiers=()=>[fee,...all];
 return {...h,fee};
}
test('multiple board nullifiers select only the authenticated expected deposit note',async()=>{
 const h=await multipleFixture();assert((await extractApplicationNullifier(h.result,h.tx,board,h.expected)).equals(h.expected));
});
for(const [name,mutate,expected] of [
 ['multiple board nullifiers require expected identity',()=>{},()=>undefined],
 ['fee nullifier cannot be selected from board call',()=>{},h=>h.fee],
 ['unrelated expected nullifier rejected',()=>{},()=>new Fr(123)],
 ['duplicate expected board nullifier rejected',h=>h.app.publicInputs.nullifiers.array[1].value=new Fr(7),h=>h.expected],
 ['expected note absent from final transaction',h=>h.tx.data.getNonEmptyNullifiers=()=>[h.fee],h=>h.expected],
 ['zero active board nullifier rejected',h=>h.app.publicInputs.nullifiers.array[1].value=Fr.ZERO,h=>h.expected],
 ['zero expected identity rejected',()=>{},()=>Fr.ZERO],
 ['malformed expected identity rejected',()=>{},()=> 'secret-sentinel'],
 ['out of bounds claimed length rejected',h=>h.app.publicInputs.nullifiers.claimedLength=5,h=>h.expected],
])test(name,async()=>{const h=await multipleFixture();mutate(h);await assert.rejects(extractApplicationNullifier(h.result,h.tx,board,expected(h)),error=>error.code==='BB_APPLICATION_ATTRIBUTION_UNSUPPORTED');});
